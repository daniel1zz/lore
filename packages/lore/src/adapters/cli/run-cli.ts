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
 *     ended the run with (`exitCli(code)` throws `CliExit`), else what the command RETURNED (reported through
 *     `buildMain`'s `reportExit`), else 0, with ONE mapping (`exitCode(error)` in utils.ts). citty's own exits
 *     (`--help`, an unknown command, a thrown error) are decided by `dispatch` below with the codes `runMain` used
 *     (0, 1, 1), not by citty. `src/index.ts` is the only place that turns the code into `process.exit(code)`.
 *   - Nothing here reads or assigns a process global (`process.argv`, `process.exit`, `process.exitCode`,
 *     `process.env`, `process.chdir`, `console`, `process.stdout`); a run writes through `inv.io` and reports its
 *     code by return value, so two runs in one process share nothing.
 * Side-effect class: whatever the dispatched command does, through `inv`.
 *
 * reason: extracted verbatim from the CLI branch of `src/index.ts` (the MCP branch stays there: stdout is its
 * protocol channel and it never runs in-process). Do NOT inline the in-process runner's own copy of this
 * sequence: a second copy would drift from the binary.
 */

import type { CommandDef } from "citty";
import type { Invocation } from "@lore/core";
import type { InvocationResolvers } from "@lore/core/node";
import { CliExit } from "./cli-exit.js";
import type { ExitReport } from "./cli-exit.js";
import { printLine } from "./output.js";
import { resolveTargetDir } from "./setup-args.js";
import { detectWorktreeDerivedActor } from "./utils.js";
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
  worktreeActor: (cwd) => detectWorktreeDerivedActor(cwd),
  projectRoot: findProjectRoot,
};

/**
 * Read the running process ONCE into an {@link Invocation}: argv (minus the harness-owned `--harness-run`),
 * cwd, env, home, claude/user-config dirs, project root, temp dir, host, exec path, run identity, stdio.
 * Called by the program entries only (`src/index.ts`, each `scripts/*.ts`).
 *
 * @param rawArgv - `process.argv.slice(2)` as typed
 * @throws {RunIdentityArgumentError} on an empty or valueless `--by` / `--harness-run`
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
 * What citty's `runMain` does, with its three `process.exit` calls turned into return values: `--help` prints usage
 * (0), `--version` prints the version (0), a thrown error prints itself and ends the run with 1 (a `CLIError` also
 * prints usage first). A `CliExit` a command threw is NOT an error: it is passed on to `runCli`, which returns its code.
 *
 * @returns 1 when citty's own error path ended the run, `undefined` otherwise
 */
async function dispatch(inv: Invocation, main: CommandDef<any>): Promise<ExitReport> {
  const { runCommand } = await import("citty");
  const { renderUsageDoubleDash } = await import("./usage-render.js");
  const rawArgs = inv.argv;
  try {
    if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
      await renderUsageDoubleDash(inv.io, ...(await resolveUsageTarget(main, rawArgs)));
      return undefined;
    }
    if (rawArgs.length === 1 && rawArgs[0] === "--version") {
      const meta = await resolveMaybe(main.meta);
      if (meta?.version === undefined) throw Object.assign(new Error("No version specified"), { name: "CLIError", code: "E_NO_VERSION" });
      printLine(inv.io.stdout, meta.version);
      return undefined;
    }
    await runCommand(main, { rawArgs: [...rawArgs] });
    return undefined;
  } catch (error) {
    if (error instanceof CliExit) throw error;
    const isUsageError = error instanceof Error && error.name === "CLIError";
    if (!isUsageError) printLine(inv.io.stderr, error, "\n");
    if (isUsageError) await renderUsageDoubleDash(inv.io, ...(await resolveUsageTarget(main, rawArgs)));
    printLine(inv.io.stderr, error instanceof Error ? error.message : String(error));
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
  let returned: number | undefined;
  const { buildMain } = await import("./index.js");
  const main = buildMain(inv, {
    ...(options.transformCommand === undefined ? {} : { transformCommand: options.transformCommand }),
    reportExit: (code) => {
      returned = code;
    },
  });
  try {
    const dispatched = await dispatch(inv, main);
    return dispatched ?? returned ?? 0;
  } catch (error) {
    if (error instanceof CliExit) return error.code;
    throw error;
  }
}
