/**
 * The CLI entry sequence, shared by the real binary (`src/index.ts`) and the in-process test runner
 * (`tests/helpers/run-lore-in-process.ts`, adr-tg-1 option b).
 *
 * Public surface: `runCli(inv, options)` (dispatch one resolved Invocation), `resolveEntryInvocation(rawArgv)`
 * (read the process ONCE into an Invocation), `runCliFromProcess(options)` (the two, plus the identity-flag
 * refusal).
 * Invariants:
 *   - `runCli` reads nothing ambient to decide WHAT to run: argv, cwd, env and identity all come from `inv`.
 *     It hands `inv` to `buildMain(inv)`, which delivers that same object to every command's `run`
 *     (spec-ambient-state-is-read-once-at-the-entry-owned-only-prune D4, AC-IV-5).
 *   - every exit goes through `process.exit(code)`: a command's own `exitCode()` mapping (utils.ts), the
 *     identity-argument refusal (2), or citty's `runMain` catch-all (1). There is no second mapping, so a test
 *     that replaces `process.exit` observes the exact code the binary would have returned.
 *   - a run that never calls `process.exit` finished with code 0.
 * Side-effect class: stateful (rewrites `process.argv` for commands that still read it, may patch `console`)
 *   plus whatever the dispatched command does.
 *
 * reason: extracted verbatim from the CLI branch of `src/index.ts` (the MCP branch stays there: stdout is its
 * protocol channel and it never runs in-process). Do NOT inline the in-process runner's own copy of this
 * sequence: a second copy would drift from the binary.
 */

import type { CommandDef } from "citty";
import type { Invocation } from "@lore/core";
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
 * Read the running process ONCE into an {@link Invocation}: argv (minus the harness-owned `--harness-run`),
 * cwd, env, home, claude/user-config dirs, project root, temp dir, host, exec path, run identity, stdio.
 *
 * @param rawArgv - `process.argv.slice(2)` as typed
 * @throws {RunIdentityArgumentError} on an empty or valueless `--by` / `--harness-run`
 */
export async function resolveEntryInvocation(rawArgv: readonly string[]): Promise<Invocation> {
  const { resolveInvocation } = await import("@lore/core/node");
  const { resolveTargetDir } = await import("./setup-args.js");
  const { detectWorktreeDerivedActor } = await import("./utils.js");
  const { resolveUserConfigDir } = await import("../../service/context-fragments/user-config-dir.js");
  return resolveInvocation(rawArgv, {
    claudeDir: ({ argv, env, home }) => {
      const claudeDirFlag = findClaudeDirFlag(argv);
      return resolveTargetDir({ ...(claudeDirFlag === undefined ? {} : { claudeDirFlag }), env, homeDir: home });
    },
    userConfigDir: (env, home) => resolveUserConfigDir(env, home),
    worktreeActor: (cwd) => detectWorktreeDerivedActor(cwd),
    projectRoot: findProjectRoot,
  });
}

/**
 * Dispatch `inv.argv` through the CLI command tree, delivering `inv` to every command's `run`.
 *
 * @param inv - the one resolved Invocation of this run
 * @param options - see {@link RunCliOptions}
 * @returns resolves when the command finished normally; exits through `process.exit` otherwise
 */
export async function runCli(inv: Invocation, options: RunCliOptions): Promise<void> {
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
  // reason: several commands still read `process.argv` directly (`rawArgv`) besides citty's own `rawArgs`;
  // keep it equal to the identity-stripped argv of `inv` until IV-6..IV-8 move them onto `inv.argv`.
  process.argv = [...process.argv.slice(0, 2), ...inv.argv];
  const { runMain } = await import("citty");
  const { buildMain } = await import("./index.js");
  // SPEC-073 D2: citty's own built-in `showUsage` renders a multi-char
  // alias (`lore verify`'s `--yes`) with a single dash (`-yes`) — exactly
  // the broken form D1's strict-flag scan now rejects. `renderUsageDoubleDash`
  // is citty's own documented `RunMainOptions.showUsage` override point
  // (`usage-render.ts`'s module header has the full root-cause chain), the
  // ONE composition-site seam this fix needs — no per-command edit, no fork.
  const { renderUsageDoubleDash } = await import("./usage-render.js");
  const main = buildMain(inv, options.transformCommand === undefined ? {} : { transformCommand: options.transformCommand });
  await runMain(main, { rawArgs: [...inv.argv], showUsage: renderUsageDoubleDash });
}

/**
 * The binary's / in-process runner's entry: install the console (when asked), resolve the Invocation from the
 * process once, refuse a malformed identity flag with exit 2, then {@link runCli}.
 *
 * @param options - see {@link RunCliOptions}
 */
export async function runCliFromProcess(options: RunCliOptions): Promise<void> {
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
    process.exit(2);
  }
  await runCli(inv, { ...options, installSyncStdout: false });
}
