/**
 * The CLI entry sequence, shared by the real binary (`src/index.ts`) and the in-process test runner
 * (`tests/helpers/run-lore-in-process.ts`, adr-tg-1 option b).
 *
 * Public surface: `runCli(inv, options)` (dispatch one resolved Invocation, RETURN its exit code),
 * `resolveEntryInvocation(rawArgv)` (read the process ONCE into an Invocation), `invocationResolvers` (the path and
 * identity policy both builders use), `runCliFromProcess(options)` (the two, plus the identity-flag refusal).
 * Invariants:
 *   - `runCli` reads nothing ambient to decide WHAT to run: argv, cwd, env and identity all come from `inv`.
 *     It hands `inv` to `buildMain(inv)`, which delivers that same object to every command's `run`
 *     (spec-ambient-state-is-read-once-at-the-entry-owned-only-prune D4, AC-IV-5).
 *   - `runCli` RETURNS the exit code and never calls `process.exit` or sets `process.exitCode`
 *     (spec-process-state-end-state-one-invocation-per-entry-returned D2, AC-ES-2). The code is, in order: what a command
 *     ended the run with (`exitCli(code)`), else what it recorded (`setExitCode(code)`), else 0, with ONE mapping
 *     (`exitCode(error)` in utils.ts). citty's own exits (`--help`, an unknown command, a thrown error) are decided by
 *     `dispatch` below with the codes `runMain` used (0, 1, 1), not by citty. `src/index.ts` is the only place that
 *     turns the code into `process.exit(code)`.
 *   - Nothing here assigns a process global (`process.argv`, `process.exit`, `process.exitCode`, `process.env`,
 *     `process.chdir`); a run's output and code live in its run scope (`run-scope.ts`).
 * Side-effect class: stateful (installs the synchronous console when asked) plus whatever the dispatched command does.
 *
 * reason: extracted verbatim from the CLI branch of `src/index.ts` (the MCP branch stays there: stdout is its
 * protocol channel and it never runs in-process). Do NOT inline the in-process runner's own copy of this
 * sequence: a second copy would drift from the binary.
 */

import type { CommandDef } from "citty";
import type { Invocation } from "@lore/core";
import type { InvocationResolvers } from "@lore/core/node";
import { CliExit, exitCli, runInScope } from "./run-scope.js";
import { resolveTargetDir } from "./setup-args.js";
import { detectWorktreeDerivedActor } from "./utils.js";
import { resolveUserConfigDir } from "../../service/context-fragments/user-config-dir.js";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** Options for {@link runCli}. */
export interface RunCliOptions {
  /**
   * Install the non-blocking-fd1-safe console (`stdio-sync.ts`). `true` for the real process; the in-process
   * runner passes `false` because it owns console and stdout capture itself.
   */
  readonly installSyncStdout: boolean;
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
  claudeDir: ({ argv, env, home }) => {
    const claudeDirFlag = findClaudeDirFlag(argv);
    return resolveTargetDir({ ...(claudeDirFlag === undefined ? {} : { claudeDirFlag }), env, homeDir: home });
  },
  userConfigDir: (env, home) => resolveUserConfigDir(env, home),
  worktreeActor: (cwd) => detectWorktreeDerivedActor(cwd),
  projectRoot: findProjectRoot,
};

/**
 * Read the running process ONCE into an {@link Invocation}: argv (minus the harness-owned `--harness-run`),
 * cwd, env, home, claude/user-config dirs, project root, temp dir, host, exec path, run identity, stdio.
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
 * (0), `--version` prints the version (0 by falling through), a thrown error prints itself and ends the run with 1
 * (a `CLIError` also prints usage first). A `CliExit` a command threw is NOT an error: it is passed on to
 * `runInScope`, which returns its code.
 */
async function dispatch(main: CommandDef<any>, rawArgs: readonly string[]): Promise<void> {
  const { runCommand } = await import("citty");
  const { renderUsageDoubleDash } = await import("./usage-render.js");
  try {
    if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
      await renderUsageDoubleDash(...(await resolveUsageTarget(main, rawArgs)));
      return;
    }
    if (rawArgs.length === 1 && rawArgs[0] === "--version") {
      const meta = await resolveMaybe(main.meta);
      if (meta?.version === undefined) throw Object.assign(new Error("No version specified"), { name: "CLIError", code: "E_NO_VERSION" });
      console.log(meta.version);
      return;
    }
    await runCommand(main, { rawArgs: [...rawArgs] });
  } catch (error) {
    if (error instanceof CliExit) throw error;
    const isUsageError = error instanceof Error && error.name === "CLIError";
    if (!isUsageError) console.error(error, "\n");
    if (isUsageError) await renderUsageDoubleDash(...(await resolveUsageTarget(main, rawArgs)));
    console.error(error instanceof Error ? error.message : String(error));
    exitCli(1);
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
export async function runCli(inv: Invocation, options: RunCliOptions): Promise<number> {
  // reason: CLI branch ONLY — installSyncStdio replaces console.log/info/warn/
  // error/debug with a writeAllSync-backed implementation immune to the
  // non-blocking-fd1 stdout truncation defect (see stdio-sync.ts's module
  // header for the full empirical root-cause chain + verified repro). MUST
  // run BEFORE citty/consola are imported (consola's own process.stdout
  // access is what triggers Bun's non-blocking-fd1 side effect) and MUST
  // NEVER run on the --mcp-server branch — stdout there IS the MCP
  // JSON-RPC protocol channel, not free-form CLI output.
  if (options.installSyncStdout) {
    const { installSyncStdio } = await import("./stdio-sync.js");
    installSyncStdio();
  }
  return runInScope(inv, async () => {
    const { buildMain } = await import("./index.js");
    const main = buildMain(inv, options.transformCommand === undefined ? {} : { transformCommand: options.transformCommand });
    await dispatch(main, inv.argv);
  });
}

/**
 * The binary's entry: install the console (when asked), resolve the Invocation from the process once, refuse a
 * malformed identity flag with exit 2, then {@link runCli}.
 *
 * @param options - see {@link RunCliOptions}
 * @returns the exit code `src/index.ts` ends the process with
 */
export async function runCliFromProcess(options: RunCliOptions): Promise<number> {
  if (options.installSyncStdout) {
    const { installSyncStdio } = await import("./stdio-sync.js");
    installSyncStdio();
  }
  const { RunIdentityArgumentError } = await import("@lore/core/node");
  let inv: Invocation;
  try {
    inv = await resolveEntryInvocation(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof RunIdentityArgumentError)) throw error;
    process.stderr.write(`Error: ${error.message}\n`); // CLI surface
    return 2;
  }
  return runCli(inv, { ...options, installSyncStdout: false });
}
