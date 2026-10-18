/**
 * The scope of ONE `runCli` call: where its output goes and what exit code it reports, held per run, never per process
 * (spec-process-state-end-state-one-invocation-per-entry-returned Goal 2 / D2, rule AS-26).
 *
 * Purpose: a command ends a run with `exitCli(code)` (stop now) or `setExitCode(code)` (record, keep going) instead of
 * `process.exit` / `process.exitCode`, and writes with `console` / `process.stdout.write` / `writeAllSync` as before; this
 * module makes all three land in the run that issued them. Two runs in one process (the in-process test runner) overlap
 * without sharing a code, an output stream, or any process global.
 * Public surface: `CliExit`, `exitCli`, `setExitCode`, `getExitCode`, `runInScope`, `activeScopeWriter`,
 *   `NoRunScopeError`.
 * Invariants:
 *   - The scope lives in an `AsyncLocalStorage`, so it follows the run through every `await`, timer and callback the run
 *     started, and is invisible to every other run. Nothing here assigns `process.exitCode` or calls `process.exit`;
 *     `src/index.ts` is the one place that turns the returned code into `process.exit(code)`.
 *   - `exitCli` THROWS `CliExit` (type `never`), exactly the control flow of `process.exit` for the code after it. A
 *     `catch` that swallows it swallows the exit: catch narrowly, or rethrow `CliExit`.
 *   - `setExitCode` / `getExitCode` outside a run are a defect and throw {@link NoRunScopeError}; there is no fallback
 *     to `process.exitCode`.
 *   - After the first `exitCli` the run is over: its later output (a `catch` printing the unwind) and later codes are
 *     dropped, as the dead process would have dropped them.
 *   - Output is redirected ONLY when the run's `io` is not the real process streams. The real binary writes to the real
 *     process streams untouched (so its non-blocking-fd1 handling in `stdio-sync.ts` stays the only writer).
 *   - `installScopedStdio` patches `console.*` and `process.stdout/stderr.write` ONCE per process, each patch a pure
 *     dispatch on the active scope (pass-through when there is none); it is idempotent and assigns nothing per run.
 * Side-effect class: stateful (the per-run scope) plus a one-time, idempotent patch of console and the process streams.
 *
 * reason: ~600 command sites print through `console` / `process.stdout.write` and ~500 set an exit code from helpers
 * that hold no `inv`; routing them through one scope seam keeps every site's behaviour while the process stays free of
 * per-run assignment. Do NOT replace this with a `process.exitCode` write "for the binary": that is the global this removes.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { format } from "node:util";
import type { Invocation, InvocationWriter } from "@lore/core";

/** Thrown by {@link exitCli}; carries the code the run ends with. */
export class CliExit extends Error {
  constructor(readonly code: number) {
    super(`lore exited with code ${String(code)}`);
    this.name = "CliExit";
  }
}

/** A code was set, or read, with no run active: the caller is not under `runCli`. */
export class NoRunScopeError extends Error {
  constructor(operation: string) {
    super(`${operation} was called outside a runCli run: run the command through runCli(inv) (adapters/cli/run-cli.ts)`);
    this.name = "NoRunScopeError";
  }
}

interface RunScope {
  readonly io: Invocation["io"];
  /** The code of the first `exitCli`; once set the run is over and its later output and codes are dropped. */
  endedWith: number | undefined;
  exitCode: number;
}

/** Where output of a run that already ended goes: nowhere, as after a real `process.exit`. */
const ENDED_RUN_WRITER: InvocationWriter = { write: () => undefined };

const storage = new AsyncLocalStorage<RunScope>();

function requireScope(operation: string): RunScope {
  const scope = storage.getStore();
  if (scope === undefined) throw new NoRunScopeError(operation);
  return scope;
}

/**
 * End the run now with `code`; the code after the call never runs.
 *
 * @param code - the process exit code the run reports
 * @throws {CliExit} always; `runInScope` turns it into the returned code
 */
export function exitCli(code: number): never {
  const scope = storage.getStore();
  if (scope === undefined) throw new CliExit(code);
  // reason: like `process.exit`, only the FIRST exit counts; a `catch` that swallowed it and exits again changes nothing.
  scope.endedWith ??= code;
  throw new CliExit(scope.endedWith);
}

/**
 * Record the exit code of this run without ending it (the later of two sets wins, as with `process.exitCode`).
 *
 * @throws {NoRunScopeError} outside a run
 */
export function setExitCode(code: number): void {
  const scope = requireScope("setExitCode");
  if (scope.endedWith === undefined) scope.exitCode = code;
}

/**
 * The exit code recorded so far in this run (0 until a command sets one).
 *
 * @throws {NoRunScopeError} outside a run
 */
export function getExitCode(): number {
  return requireScope("getExitCode").exitCode;
}

/**
 * The writer the active run redirected `fd` to, or `null` when output must go to the real process stream (no run
 * active, or the run's io IS the process stream).
 */
export function activeScopeWriter(fd: 1 | 2): InvocationWriter | null {
  const scope = storage.getStore();
  if (scope === undefined) return null;
  if (scope.endedWith !== undefined) return ENDED_RUN_WRITER;
  const writer = fd === 1 ? scope.io.stdout : scope.io.stderr;
  const real = fd === 1 ? process.stdout : process.stderr;
  return writer === real ? null : writer;
}

/**
 * Run `body` as the one run of `inv` and return its exit code.
 *
 * @param inv - the run's Invocation (its `io` is where output goes)
 * @param body - the dispatch; a `CliExit` thrown anywhere under it ends the run with that code
 * @returns the code of the first `exitCli`, else the last `setExitCode`, else 0
 */
export async function runInScope(inv: Invocation, body: () => Promise<void>): Promise<number> {
  installScopedStdio();
  const scope: RunScope = { io: inv.io, endedWith: undefined, exitCode: 0 };
  return storage.run(scope, async () => {
    try {
      await body();
    } catch (error) {
      if (error instanceof CliExit) return scope.endedWith ?? error.code;
      throw error;
    }
    return scope.endedWith ?? scope.exitCode;
  });
}

let stdioInstalled = false;

/** `process.stdout.write` / `process.stderr.write` argument shapes. */
type WriteArgs = [chunk: string | Uint8Array, encodingOrCallback?: unknown, callback?: unknown];

function textOf(chunk: string | Uint8Array): string {
  return typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
}

/**
 * Patch `console.*` and the process streams so output written under a run whose io is not the process streams goes to
 * that io. Idempotent; a no-op effect for code running outside such a run.
 */
export function installScopedStdio(): void {
  if (stdioInstalled) return;
  stdioInstalled = true;

  const consoleFd: Record<"log" | "info" | "debug" | "warn" | "error", 1 | 2> = { log: 1, info: 1, debug: 1, warn: 2, error: 2 };
  for (const method of Object.keys(consoleFd) as Array<keyof typeof consoleFd>) {
    const original = console[method];
    const fd = consoleFd[method];
    console[method] = (...args: unknown[]): void => {
      const writer = activeScopeWriter(fd);
      if (writer === null) original.apply(console, args);
      else writer.write(`${format(...args)}\n`);
    };
  }

  for (const [stream, fd] of [[process.stdout, 1], [process.stderr, 2]] as const) {
    const original = stream.write;
    stream.write = function patchedWrite(this: unknown, ...args: WriteArgs): boolean {
      const writer = activeScopeWriter(fd);
      if (writer === null) return (original as (...a: WriteArgs) => boolean).apply(stream, args);
      writer.write(textOf(args[0]));
      const done = typeof args[1] === "function" ? args[1] : args[2];
      if (typeof done === "function") (done as () => void)();
      return true;
    } as typeof stream.write;
  }
}
