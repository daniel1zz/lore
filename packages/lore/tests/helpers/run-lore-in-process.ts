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
 * Public surface: `runLoreInProcess(args, options)` and the `InProcessRunResult` it resolves to.
 *
 * Invariants:
 *   - Same startup sequence and same exit-code mapping as the binary: it calls `runCliFromProcess`
 *     (`src/adapters/cli/run-cli.ts`), the function `src/index.ts` itself calls, and observes the code the
 *     command passes to `process.exit` (`exitCode()` in `utils.ts`, or citty's `runMain` catch-all). A run
 *     that never calls `process.exit` exits 0. There is no mapping in this file.
 *   - Process-wide state a command reads (`process.cwd()`, `process.env`, `process.argv`, `process.exit`,
 *     `process.stdout`/`process.stderr`, `console`) is replaced for the duration of ONE run and restored in
 *     `finally`. It cannot be replaced per async task, so runs are SERIALISED through one queue: two
 *     `runLoreInProcess` calls started together (`it.concurrent`, `Promise.all`) run one after the other and
 *     never see each other's cwd, env or output. Separate test files run in separate worker processes and
 *     do not share this state.
 *   - `options.env` is the WHOLE environment of the run (like `Bun.spawnSync({ env })`); default is the
 *     current `process.env`. The sandbox marker (`LORE_TEST_SANDBOX`, `LORE_TEST_SANDBOX_REPO`) is always
 *     carried over from the test process, so the repository's own corpus is refused exactly as for a spawned
 *     binary. A test process without the marker armed makes the call throw (never runs unguarded).
 *   - Output written after the command exited (a `catch` that ran because the exit unwound the stack, citty's
 *     catch-all printing the unwind) is dropped, and only the FIRST exit code counts.
 * Side-effect class: stateful (process-wide state, restored) plus whatever the command does to the corpus.
 *
 * reason: `process.exit` is replaced by a function that throws `InProcessExit` rather than returning,
 * because the code after a `process.exit(...)` call in a command assumes it never runs.
 */

import { format } from "node:util";
import { setStdioInterceptor } from "../../src/adapters/cli/stdio-sync";
import { runCliFromProcess } from "../../src/adapters/cli/run-cli";

/** Environment bag, same shape as `process.env`. */
export type InProcessEnv = Readonly<Record<string, string | undefined>>;

/** Options of {@link runLoreInProcess}. */
export interface InProcessRunOptions {
  /** Working directory of the command: a throwaway corpus (`mkdtemp` + `lore init`), never the repository. */
  readonly cwd: string;
  /** The whole environment of the run; default is the current `process.env`. */
  readonly env?: InProcessEnv;
}

/** What a run produced; identical in shape to what the spawn-based helpers return. */
export interface InProcessRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Thrown by the replacement `process.exit`; carries the code the command asked for. */
class InProcessExit extends Error {
  constructor(readonly code: number) {
    super(`lore exited with code ${String(code)}`);
    this.name = "InProcessExit";
  }
}

/** The sandbox-marker keys that must reach every run (scripts/test-isolation-env.ts arms them). */
const SANDBOX_KEYS = ["LORE_TEST_SANDBOX", "LORE_TEST_SANDBOX_REPO"] as const;

/** Tail of the run queue: each run starts when the previous one settled. */
let queueTail: Promise<unknown> = Promise.resolve();

/**
 * Build the environment of one run: the caller's env plus the sandbox marker taken from the test process.
 *
 * @throws Error when the test process has no armed sandbox marker (running unguarded is never allowed)
 */
function buildRunEnv(requested: InProcessEnv | undefined): Record<string, string> {
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
  return env;
}

/** Execute one run with process-wide state already owned by the caller of the queue. */
async function executeRun(args: readonly string[], options: InProcessRunOptions): Promise<InProcessRunResult> {
  const env = buildRunEnv(options.env);
  const savedEnv = { ...process.env };
  const savedCwd = process.cwd();
  const savedArgv = process.argv;
  const savedExit = process.exit;
  const savedExitCode = process.exitCode;
  const savedStdoutWrite = process.stdout.write;
  const savedStderrWrite = process.stderr.write;
  const savedConsole = {
    log: console.log,
    info: console.info,
    debug: console.debug,
    warn: console.warn,
    error: console.error,
  };

  const out: string[] = [];
  const err: string[] = [];
  let exitCode: number | null = null;
  const capture = (fd: 1 | 2, text: string): void => {
    if (exitCode !== null) return; // reason: post-exit output is the unwind of the exit itself, not command output
    (fd === 1 ? out : err).push(text);
  };
  const captureWrite =
    (fd: 1 | 2) =>
    (chunk: string | Uint8Array, encodingOrCallback?: unknown, callback?: unknown): boolean => {
      capture(fd, typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      const done = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
      if (typeof done === "function") (done as () => void)();
      return true;
    };
  const captureConsole =
    (fd: 1 | 2) =>
    (...logArgs: unknown[]): void =>
      capture(fd, `${format(...logArgs)}\n`);

  try {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, env);
    process.chdir(options.cwd);
    process.argv = [savedArgv[0] ?? "bun", "lore", ...args];
    process.exitCode = 0; // reason: Bun ignores `= undefined` (measured: a stale 3 survives), so reset with 0
    process.exit = ((code?: number): never => {
      if (exitCode === null) exitCode = code ?? 0;
      throw new InProcessExit(exitCode);
    }) as typeof process.exit;
    process.stdout.write = captureWrite(1) as typeof process.stdout.write;
    process.stderr.write = captureWrite(2) as typeof process.stderr.write;
    console.log = captureConsole(1);
    console.info = captureConsole(1);
    console.debug = captureConsole(1);
    console.warn = captureConsole(2);
    console.error = captureConsole(2);
    setStdioInterceptor(capture);

    try {
      await runCliFromProcess({ installSyncStdout: false });
    } catch (error) {
      if (!(error instanceof InProcessExit)) {
        // reason: an exception that escaped runCli is a defect in the command or the helper; show it, never swallow it.
        capture(2, `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
        if (exitCode === null) exitCode = 1;
      }
    }
    const naturalExit = typeof process.exitCode === "number" ? process.exitCode : 0;
    return { stdout: out.join(""), stderr: err.join(""), exitCode: exitCode ?? naturalExit };
  } finally {
    setStdioInterceptor(null);
    Object.assign(console, savedConsole);
    process.stdout.write = savedStdoutWrite;
    process.stderr.write = savedStderrWrite;
    process.exit = savedExit;
    process.exitCode = savedExitCode ?? 0;
    process.argv = savedArgv;
    process.chdir(savedCwd);
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, savedEnv);
  }
}

/**
 * Run `lore <args>` in this process with `options.cwd` as its working directory.
 *
 * @param args - argv after the program name, exactly what is typed after `lore` (`["get", slug, "--json"]`)
 * @param options - cwd (required) and the whole env (optional)
 * @returns captured stdout, stderr and the exit code the command chose
 * @example
 *   const result = await runLoreInProcess(["init"], { cwd: tmpDir });
 */
export function runLoreInProcess(args: readonly string[], options: InProcessRunOptions): Promise<InProcessRunResult> {
  const run = queueTail.then(() => executeRun(args, options));
  // reason: the queue must keep moving when one run rejects (a refused sandbox, say); the caller still sees the rejection on `run`.
  queueTail = run.catch(() => undefined);
  return run;
}
