/**
 * Run one `lore` command inside the test process instead of starting `dist/lore`
 * (adr-tg-1-test-runner-decision-measured-comparison-of-bun-only, option b; task tg-25).
 *
 * Why: starting the compiled binary costs about 260 ms per call against about 91 ms in-process
 * (`list --json`, measured in the ADR). A test that checks COMMAND LOGIC (exit code, rendered text, what
 * the store holds afterwards) needs the command, not the binary. A test that checks the BINARY itself
 * (embedded assets, provenance, native libsql, signals, MCP stdio, hooks as Claude Code runs them) keeps
 * spawning `dist/lore` and declares `// @spawns dist/lore`.
 *
 * Public surface: `runLoreInProcess(args, options)`, `InProcessRunOptions`, `InProcessRunResult`.
 *
 * Invariants:
 *   - It builds one `Invocation` (cwd, env, argv, paths from `home`, io capturing stdout and stderr) and calls
 *     `runCli(inv)`, the function the binary's entry calls; the exit code is what `runCli` RETURNS. There is no
 *     mapping and no startup copy in this file.
 *   - It assigns NO process global: not `process.env`, `process.chdir`, `process.argv`, `process.exit`,
 *     `process.exitCode`, `console.*`, nor `process.stdout/stderr.write`. Every command writes through `inv.io` and
 *     reports its code by return value, so there is NO serial queue: two calls started together
 *     (`Promise.all`, `it.concurrent`) overlap, each with its own cwd, env, home, output and code.
 *   - `options.home` is required and is the run's home directory; a call without one throws (a default would be the
 *     developer's real home, AS-27). `options.env` is the WHOLE environment of the run (like
 *     `Bun.spawnSync({ env })`, default: a copy of the current `process.env`); it must not name another HOME.
 *     The sandbox marker (`LORE_TEST_SANDBOX`, `LORE_TEST_SANDBOX_REPO`) is always carried over from the test process,
 *     so the repository's own corpus is refused exactly as for a spawned binary. A test process without the marker
 *     armed makes the call throw (never runs unguarded).
 * Side-effect class: IO (whatever the command does to the corpus and under `home`); reads the test process's env once
 * per call to build the default env and to carry the sandbox marker.
 */

import type { CommandDef } from "citty";
import { Readable } from "node:stream";
import { RunIdentityArgumentError } from "@lore/core/node";
import type { Invocation, InvocationReader } from "@lore/core";
import { runCli } from "../../src/adapters/cli/run-cli";
import { buildTestInvocation } from "./test-invocation";

/** Environment bag, same shape as `process.env`. */
export type InProcessEnv = Readonly<Record<string, string | undefined>>;

/** Options of {@link runLoreInProcess}. */
export interface InProcessRunOptions {
  /** Working directory of the command: a throwaway corpus (`mkdtemp` + `lore init`), never the repository. */
  readonly cwd: string;
  /** The run's home directory: a throwaway directory, never the developer's. */
  readonly home: string;
  /** The whole environment of the run; default is a copy of the current `process.env`. */
  readonly env?: InProcessEnv;
  /** Test seam, forwarded to `runCli`: rewrite each command tree before strict/delivery wrapping. */
  readonly transformCommand?: (name: string, command: CommandDef<any>) => CommandDef<any> | Promise<CommandDef<any>>;
  /** The run's input (what a prompt reads); default: an empty stream. */
  readonly stdin?: InvocationReader;
  /** Whether the run's input is an interactive terminal; default: `false`, so a prompt command takes its non-interactive path. */
  readonly stdinIsTTY?: boolean;
}

/** What a run produced; identical in shape to what the spawn-based helpers return. */
export interface InProcessRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** The sandbox-marker keys that must reach every run (scripts/test-isolation-env.ts arms them). */
const SANDBOX_KEYS = ["LORE_TEST_SANDBOX", "LORE_TEST_SANDBOX_REPO"] as const;

/**
 * Build the environment of one run: the caller's env plus the sandbox marker taken from the test process.
 *
 * @throws Error when the test process has no armed sandbox marker (running unguarded is never allowed), or when
 *   `env.HOME` names a home other than `home`
 */
function buildRunEnv(requested: InProcessEnv | undefined, home: string): Record<string, string> {
  const base = requested ?? process.env;
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined) env[key] = value;
  }
  if (process.env.LORE_TEST_SANDBOX !== "1") {
    throw new Error(
      "runLoreInProcess: LORE_TEST_SANDBOX is not armed in this test process; refusing to run a command that could " +
        "write this repository's own .lore corpus. Run through vitest (scripts/test-isolation-setup.ts arms it).",
    );
  }
  for (const key of SANDBOX_KEYS) {
    const armed = process.env[key];
    if (armed !== undefined) env[key] = armed;
  }
  const envHome = requested === undefined ? undefined : env["HOME"];
  if (envHome !== undefined && envHome !== home) {
    throw new Error(`runLoreInProcess: env.HOME (${envHome}) differs from options.home (${home}); one run has one home`);
  }
  env["HOME"] = home;
  return env;
}

/**
 * Run `lore <args>` in this process with `options.cwd` as its working directory and `options.home` as its home.
 *
 * @param args - argv after the program name, exactly what is typed after `lore` (`["get", slug, "--json"]`)
 * @param options - cwd and home (required), the whole env, a command-tree seam, stdin and stdinIsTTY (optional)
 * @returns captured stdout, stderr and the exit code `runCli` returned
 * @throws Error when `home` is missing or empty, or the sandbox marker is not armed
 * @example
 *   const result = await runLoreInProcess(["init"], { cwd: tmpDir, home: tmpHome });
 */
export async function runLoreInProcess(args: readonly string[], options: InProcessRunOptions): Promise<InProcessRunResult> {
  const home = (options as { home?: string }).home;
  if (typeof home !== "string" || home === "") {
    throw new Error("runLoreInProcess: options.home is required (a throwaway home directory); it has no default");
  }
  const env = buildRunEnv(options.env, home);
  const out: string[] = [];
  const err: string[] = [];
  let inv: Invocation;
  try {
    inv = buildTestInvocation({
      argv: args,
      cwd: options.cwd,
      env,
      home,
      // reason: a run has no terminal and no input unless a test gives it one: an empty, non-TTY stdin.
      io: {
        stdout: { write: (text) => out.push(text) },
        stderr: { write: (text) => err.push(text) },
        stdin: options.stdin ?? Readable.from([]),
        stdinIsTTY: options.stdinIsTTY ?? false,
      },
    });
  } catch (error) {
    if (!(error instanceof RunIdentityArgumentError)) throw error;
    // reason: the binary's entry (`src/index.ts`) refuses a malformed identity flag with exit 2; same here.
    return { stdout: "", stderr: `Error: ${error.message}\n`, exitCode: 2 };
  }
  let exitCode: number;
  try {
    exitCode = await runCli(inv, options.transformCommand === undefined ? {} : { transformCommand: options.transformCommand });
  } catch (error) {
    // reason: an exception that escaped runCli is a defect in the command or the helper; show it, never swallow it.
    err.push(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    exitCode = 1;
  }
  return { stdout: out.join(""), stderr: err.join(""), exitCode };
}
