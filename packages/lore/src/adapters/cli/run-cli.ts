/**
 * The CLI entry sequence, shared by the real binary (`src/index.ts`) and the in-process test runner
 * (`tests/helpers/run-lore-in-process.ts`, adr-tg-1 option b).
 *
 * Public surface: `runCli(inv, options)` (dispatch one resolved Invocation, RETURN its exit code),
 * `resolveEntryInvocation(rawArgv)` (read the process ONCE into an Invocation), `invocationResolvers` (the path and
 * identity policy both builders use).
 * Invariants:
 *   - `runCli` reads nothing ambient to decide WHAT to run: argv, cwd, env and identity all come from `inv`.
 *     It hands `inv` to `buildMain(inv)`, which delivers that same object to every command's `run`
 *     (spec-ambient-state-is-read-once-at-the-entry-owned-only-prune D4, AC-IV-5).
 *   - `runCli` RETURNS the exit code and never calls `process.exit` or sets `process.exitCode`
 *     (spec-process-state-end-state-one-invocation-per-entry-returned D2, AC-ES-2). The code is, in order: what a command
 *     ended the run with (`exitCli(code)` throws `CliExit`), else what the command RETURNED (a required number,
 *     reported through `buildMain`'s `reportExit`), with ONE mapping (`exitCode(error)` in utils.ts). citty's own exits
 *     (`--help`, an unknown command, a thrown error) are decided by `dispatch` below with the codes `runMain` used
 *     (0, 1, 1), not by citty. A write that finds the invocation without a known party (`UnknownPartyError`) ends with 4. `src/index.ts` is the only place that turns the code into `process.exit(code)`.
 *   - Nothing here reads or assigns a process global (`process.argv`, `process.exit`, `process.exitCode`,
 *     `process.env`, `process.chdir`, `console`, `process.stdout`); a run writes through `inv.io` and reports its
 *     code by return value, so two runs in one process share nothing.
 *   - A delegated detached job (`LORE_DELEGATED_JOB` set by its spawning caller, #501) waits for the start gate on `inv.io.stdin`
 *     before anything else, exits 0 having written nothing when stdin ends without it, and ends its child run when it exits.
 * Side-effect class: whatever the dispatched command does, through `inv`.
 *
 * reason: extracted verbatim from the CLI branch of `src/index.ts` (the MCP branch stays there: stdout is its
 * protocol channel and it never runs in-process). Do NOT inline the in-process runner's own copy of this
 * sequence: a second copy would drift from the binary.
 */

import type { CommandDef } from "citty";
import { HARNESS_RUN_ENV, type Invocation } from "@lore/core";
import { UnknownPartyError } from "@lore/core/node";
import { DELEGATED_JOB_ENV, awaitStartGate, endDelegatedJobRun } from "../../service/delegated-run.js";
import type { InvocationResolvers } from "@lore/core/node";
import { CliExit } from "./cli-exit.js";
import { resolveHumanSessionBinding } from "./human-session-file.js";
import { primeReplicaClientWhenSyncEnabled } from "./replica-priming.js";
import type { ExitReport } from "./cli-exit.js";
import { printLine } from "./output.js";
import { resolveTargetDir } from "./setup-args.js";
import { resolveUserConfigDir } from "../../service/context-fragments/user-config-dir.js";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** Options for {@link runCli}. */
export interface RunCliOptions {
  /** Test seam, forwarded to `buildMain`: rewrite each command tree before strict/delivery wrapping. */
  readonly transformCommand?: (name: string, command: CommandDef<any>) => CommandDef<any> | Promise<CommandDef<any>>;
}

/** `--claude-dir <path>` / `--claude-dir=<path>` from argv (BR-813's highest tier), or `undefined`. */
function findClaudeDirFlag(argv: readonly string[]): string | undefined {
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index] as string;
    if (token === "--claude-dir") return argv[index + 1];
    if (token.startsWith("--claude-dir=")) return token.slice("--claude-dir=".length);
  }
  return undefined;
}

/** Nearest ancestor of `cwd` (itself included) holding `.lore/lore.db`, or `null`. */
function findProjectRoot(cwd: string): string | null {
  let dir = cwd;
  for (;;) {
    if (existsSync(join(dir, ".lore", "lore.db"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The lore-owned path and identity POLICY an Invocation is built with (BR-813 claude dir, BR-1012 user config dir,
 * working-copy actor, project root). Pure functions of already-read values: the entry hands them to core's
 * `resolveInvocation`, and the in-process test runner hands the SAME object to its own builder, so a test run and
 * the binary cannot disagree on where a path comes from.
 */
export const invocationResolvers: InvocationResolvers = {
  claudeDir: ({ argv, env, home, cwd }) => {
    const claudeDirFlag = findClaudeDirFlag(argv);
    return resolveTargetDir({ ...(claudeDirFlag === undefined ? {} : { claudeDirFlag }), env, homeDir: home, cwd });
  },
  userConfigDir: (env, home) => resolveUserConfigDir(env, home),
  projectRoot: findProjectRoot,
  // reason: a damaged token file must not crash a READ (BR-1351); see resolveHumanSessionBinding.
  humanSession: ({ env, home, projectRoot }) => resolveHumanSessionBinding(env, home, projectRoot),
};

/**
 * Read the running process ONCE into an {@link Invocation}: argv as typed, cwd, env, home,
 * claude/user-config dirs, project root, temp dir, host, exec path, run identity (the per-call
 * `LORE_HARNESS_RUN` exported by the hook before each Bash call, verified by process ancestry), stdio.
 * Called by the program entries only (`src/index.ts`, each `scripts/*.ts`).
 *
 * @param rawArgv - `process.argv.slice(2)` as typed
 * @throws {RunIdentityArgumentError} on an empty or valueless `--by`, or on the retired run-identity command-line flag (exit 2)
 */
export async function resolveEntryInvocation(rawArgv: readonly string[]): Promise<Invocation> {
  const { resolveInvocation } = await import("@lore/core/node");
  return resolveInvocation(rawArgv, invocationResolvers);
}

/** Resolve a citty `Resolvable` (value, promise or thunk). */
async function resolveMaybe<T>(value: T | Promise<T> | (() => T | Promise<T>) | undefined): Promise<T | undefined> {
  return typeof value === "function" ? (value as () => T | Promise<T>)() : value;
}

/** The command (and its parent) citty would render usage for: the same walk as citty's own `resolveSubCommand`. */
async function resolveUsageTarget(
  cmd: CommandDef<any>,
  rawArgs: readonly string[],
  parent?: CommandDef<any>,
): Promise<[CommandDef<any>, CommandDef<any> | undefined]> {
  const subCommands = await resolveMaybe(cmd.subCommands);
  if (subCommands !== undefined && Object.keys(subCommands).length > 0) {
    const nameIndex = rawArgs.findIndex((arg) => !arg.startsWith("-"));
    const name = rawArgs[nameIndex];
    const subCommand = name === undefined ? undefined : await resolveMaybe(subCommands[name]);
    if (subCommand !== undefined) return resolveUsageTarget(subCommand, rawArgs.slice(nameIndex + 1), cmd);
  }
  return [cmd, parent];
}

/**
 * The command words of `rawArgs` that resolve to a (sub)command, outermost first: `["phase"]` for `lore phase bogus`.
 *
 * @param cmd - the root command
 * @param rawArgs - the invocation's arguments
 * @returns the resolved command names, `[]` when the first word is not a subcommand
 */
async function resolveCommandPath(cmd: CommandDef<any>, rawArgs: readonly string[]): Promise<string[]> {
  const subCommands = await resolveMaybe(cmd.subCommands);
  if (subCommands === undefined) return [];
  const nameIndex = rawArgs.findIndex((arg) => !arg.startsWith("-"));
  const name = rawArgs[nameIndex];
  const subCommand = name === undefined ? undefined : await resolveMaybe(subCommands[name]);
  if (name === undefined || subCommand === undefined) return [];
  return [name, ...(await resolveCommandPath(subCommand, rawArgs.slice(nameIndex + 1)))];
}

/**
 * What citty's `runMain` does, with its three `process.exit` calls turned into return values: `--help` prints usage
 * (0), `--version` prints the version (0), a thrown error prints itself and ends the run with 1 (a `CLIError` also
 * prints usage first). A `CliExit` a command threw is NOT an error: it is passed on to `runCli`, which returns its code.
 *
 * @param reported - the code of the command that ran: 0 until the command's `run` returns, then the code it returned
 * @returns the run's exit code: 1 when citty's own error path ended it, 0 for `--help` / `--version`, else the code the
 *   command returned
 */
async function dispatch(inv: Invocation, main: CommandDef<any>, reported: { code: ExitReport }): Promise<ExitReport> {
  const { runCommand } = await import("citty");
  const { renderUsageDoubleDash } = await import("./usage-render.js");
  const rawArgs = inv.argv;
  try {
    if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
      await renderUsageDoubleDash(inv.io, ...(await resolveUsageTarget(main, rawArgs)));
      return 0;
    }
    if (rawArgs.length === 1 && rawArgs[0] === "--version") {
      const meta = await resolveMaybe(main.meta);
      if (meta?.version === undefined) throw Object.assign(new Error("No version specified"), { name: "CLIError", code: "E_NO_VERSION" });
      printLine(inv.io.stdout, meta.version);
      return 0;
    }
    await runCommand(main, { rawArgs: [...rawArgs] });
    return reported.code;
  } catch (error) {
    if (error instanceof CliExit) throw error;
    if (error instanceof UnknownPartyError) {
      // reason: a write needed an actor and the invocation has no known party (BR-1351): a validation refusal
      // (exit 4, before anything is written), the same code the rest of the validation family ends with.
      printLine(inv.io.stderr, `Error: ${error.loreError.message}`);
      return 4;
    }
    const isUsageError = error instanceof Error && error.name === "CLIError";
    if (!isUsageError) printLine(inv.io.stderr, error, "\n");
    const message = error instanceof Error ? error.message : String(error);
    if (isUsageError && (error as { code?: unknown }).code === "E_UNKNOWN_COMMAND") {
      // reason: BR-1371 — an unknown subcommand prints that command's usage line and a pointer to --help, not the
      // whole help (84 KB at the root).
      const { formatUnknownCommandUsage } = await import("./usage-render.js");
      printLine(inv.io.stderr, formatUnknownCommandUsage(await resolveCommandPath(main, rawArgs), message));
      return 1;
    }
    if (isUsageError) await renderUsageDoubleDash(inv.io, ...(await resolveUsageTarget(main, rawArgs)));
    printLine(inv.io.stderr, message);
    return 1;
  }
}

/**
 * Dispatch `inv.argv` through the CLI command tree, delivering `inv` to every command's `run`.
 *
 * SPEC-073 D2: citty's own built-in `showUsage` renders a multi-char alias (`lore verify`'s `--yes`) with a single dash
 * (`-yes`), exactly the broken form D1's strict-flag scan rejects; `renderUsageDoubleDash` (usage-render.ts has the
 * root-cause chain) is the ONE composition-site seam this fix needs.
 *
 * @param inv - the one resolved Invocation of this run
 * @param options - see {@link RunCliOptions}
 * @returns the exit code of the run (see the module header for how it is decided)
 */
export async function runCli(inv: Invocation, options: RunCliOptions = {}): Promise<number> {
  const job = inv.env[DELEGATED_JOB_ENV];
  if (job === undefined || job === "") return runCliCommand(inv, options);
  // reason: #501 — a delegated detached job (the post-integrate review batch) is its own harness under a child run its verified
  // caller registers AFTER spawning it. It does nothing, not even verify its identity, until the caller sends the gate line;
  // stdin ending without it means the caller aborted: exit 0 having written nothing (spec-a-detached-lore-job-writes-under-a-child-run-delegated-by I3).
  if (!(await awaitStartGate(inv.io.stdin))) return 0;
  try {
    return await runCliCommand(inv, options);
  } finally {
    // reason: I4 — the child run ends when the job exits; a SIGKILLed job never gets here and the run-reap service ends its run (dead harness pid).
    await endDelegatedJobRunOfInvocation(inv, job);
  }
}

/** Ends the child run a delegated job carried (`LORE_HARNESS_RUN`); a failure is printed, never swallowed. */
async function endDelegatedJobRunOfInvocation(inv: Invocation, job: string): Promise<void> {
  const run = inv.env[HARNESS_RUN_ENV];
  if (run === undefined || run === "") return;
  try {
    const { loadLoreApp } = await import("./loader.js");
    const { app } = loadLoreApp({ inv });
    try {
      if (app.runService === undefined) throw new Error("App was built without a runService");
      const ended = await endDelegatedJobRun(app.runService, run, job);
      if (!ended.ok) printLine(inv.io.stderr, `Error: could not end delegated run ${run}: ${ended.error.code}: ${"message" in ended.error ? ended.error.message : ""}`);
    } finally {
      app.close();
    }
  } catch (error) {
    printLine(inv.io.stderr, `Error: could not end delegated run ${run}: ${error instanceof CliExit ? `exit ${String(error.code)}` : error instanceof Error ? error.message : String(error)}`);
  }
}

async function runCliCommand(inv: Invocation, options: RunCliOptions): Promise<number> {
  const reported: { code: ExitReport } = { code: 0 };
  const { buildMain } = await import("./index.js");
  const main = buildMain(inv, {
    ...(options.transformCommand === undefined ? {} : { transformCommand: options.transformCommand }),
    reportExit: (code) => {
      reported.code = code;
    },
  });
  try {
    // reason: D22 — a corpus with `sync.enabled` opens through the embedded replica, whose client the compiled binary
    // can only load asynchronously. Loaded here, once, before any command builds its App; a no-op without sync.
    await primeReplicaClientWhenSyncEnabled(inv.io, inv);
    return await dispatch(inv, main, reported);
  } catch (error) {
    if (error instanceof CliExit) return error.code;
    throw error;
  }
}
