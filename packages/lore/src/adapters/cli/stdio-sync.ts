/**
 * Non-blocking-fd1-safe synchronous stdout/stderr writer — composition-root
 * chokepoint fixing a whole-CLI stdout truncation defect (SPEC-048 follow-up,
 * task `task-skill-implement-cli-stdout-non-blocking-truncation-fix-writ`).
 *
 * Public surface:
 *   - writeAllSync(fd, text) — write the FULL utf8-encoded text to fd 1 or 2,
 *     looping through short/EAGAIN writes until every byte is delivered.
 *   - installSyncStdio() — monkey-patches console.log/info/debug (fd 1) and
 *     console.warn/error (fd 2) to route through writeAllSync instead of
 *     Node's/consola's own (buffered, async-capable) stream writers.
 *
 * ── Full empirical root-cause chain (do NOT re-derive — re-verify only) ────
 *
 * 1. Bun 1.3.10 sets fd 1 to O_NONBLOCK the first time `process.stdout` is
 *    GETTER-ACCESSED in a process (confirmed empirically, not documented
 *    Bun behavior — see reproduction below). `consola` (imported by `citty`,
 *    imported by every `lore` CLI command via `index.ts`) touches
 *    `process.stdout` at import time, so EVERY CLI invocation's fd 1 ends up
 *    non-blocking, whether or not the command's own code ever mentions
 *    `process.stdout` directly.
 * 2. Once fd 1 is O_NONBLOCK, a SINGLE `write(2)` syscall (whether issued via
 *    `console.log` or a one-shot `fs.writeSync`) delivers AT MOST the pipe's
 *    kernel buffer size (64KiB / 65536 bytes on Linux/macOS) to a reader that
 *    hasn't drained yet — the syscall returns immediately with a partial
 *    byte count (or throws EAGAIN if the buffer is already full), it does
 *    NOT block waiting for the reader. Code that calls `console.log`/
 *    `fs.writeSync` exactly once and ignores the return value silently drops
 *    every byte past the first 64KiB when the process exits before the
 *    reader can catch up.
 * 3. Minimal reproduction (bare shell, no lore code):
 *      bun -e 'void process.stdout; console.log("x".repeat(135000))' \
 *        | { sleep 1; cat; } | wc -c
 *      => 65536   (truncated; the trailing ~70KB is silently dropped)
 *    Control (omit the `void process.stdout` access — fd 1 stays blocking):
 *      bun -e 'console.log("x".repeat(135000))' | { sleep 1; cat; } | wc -c
 *      => 135001  (full delivery, +1 for console.log's trailing newline)
 * 4. Real-world failure this caused: `lore setup --dry-run --json` emits a
 *    ~135KB JSON payload; under full-test-suite CPU load the consuming
 *    reader (`npm-install-simulation.test.ts`'s `spawnSync`) was slow enough
 *    to trigger the truncation, producing
 *    `SyntaxError: Unterminated string in JSON at position 64651` — a
 *    corpus-blast-radius, load-dependent flake with zero application-level
 *    cause; the defect is entirely in HOW output is written, not what.
 * 5. Verified fix primitive: loop `fs.writeSync(1, buf, offset, remaining)`,
 *    advancing `offset` by the (possibly partial) byte count each call
 *    succeeds with, and on an `EAGAIN` throw (pipe buffer currently full)
 *    sleep briefly and retry the SAME remaining slice — never skip bytes,
 *    never give up. This is `writeAllSync` below.
 *
 * Invariants:
 *   - `writeAllSync` NEVER returns having written fewer bytes than `text`'s
 *     utf8-encoded length — it blocks (via retry+sleep) until the OS accepts
 *     every byte, or an error OTHER than EAGAIN propagates (e.g. EPIPE from a
 *     genuinely closed reader — that failure is real and must not be
 *     swallowed).
 *   - `installSyncStdio()` is idempotent-safe to call more than once (each
 *     call just re-assigns the same five `console.*` methods to freshly
 *     built closures) but is intended to be called EXACTLY ONCE, at process
 *     startup, before any command output is produced — see `../../index.ts`.
 *   - This module MUST be wired on the CLI entry branch ONLY, never the MCP
 *     branch — stdout IS the MCP JSON-RPC protocol channel there, and
 *     `installSyncStdio` must not touch it.
 *   - `Bun.sleepSync` (a true OS-thread-blocking sleep) is used when running
 *     under Bun; a `typeof Bun !== "undefined"` guard keeps this module
 *     resolvable under vitest/Node, where it falls back to a real blocking
 *     `Atomics.wait` on a throwaway `SharedArrayBuffer` slot (Node permits
 *     `Atomics.wait` on its main thread, unlike browser main threads) — both
 *     paths block the CALLING thread/process for the requested duration
 *     without spinning the CPU.
 *
 * Side-effect class: IO (direct fd writes via `node:fs`); `installSyncStdio`
 *   additionally mutates the global `console` object.
 *
 * Source: SPEC-048 follow-up task
 *   `task-skill-implement-cli-stdout-non-blocking-truncation-fix-writ`
 *   (root cause diagnosed + fix verified by the dispatching orchestrator
 *   before this task was created; this module is the composition-root fix).
 */

import { writeSync } from "node:fs";
import { format } from "node:util";

/** Milliseconds to block before retrying a write that hit EAGAIN (pipe buffer full). */
const EAGAIN_RETRY_DELAY_MS = 5;

/**
 * True iff `err` is a Node/Bun filesystem error with `code === "EAGAIN"`
 * (the pipe's kernel buffer is currently full on a non-blocking fd — retry,
 * don't fail). Any other error code (e.g. `EPIPE` — reader gone) is a real
 * failure and must propagate.
 */
function isEagainError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "EAGAIN"
  );
}

/**
 * Block the calling thread/process for `ms` milliseconds without spinning
 * the CPU. Prefers `Bun.sleepSync` (true OS sleep) under Bun; falls back to
 * `Atomics.wait` on Node so this module stays resolvable — and its retry
 * loop stays genuinely throttled, not busy-spinning — under vitest.
 *
 * @param ms - milliseconds to block
 */
function sleepSyncMs(ms: number): void {
  if (
    typeof Bun !== "undefined" &&
    typeof Bun.sleepSync === "function"
  ) {
    Bun.sleepSync(ms);
    return;
  }
  // reason: Node (unlike a browser main thread) permits Atomics.wait on its
  // main thread — this blocks the calling thread on a throwaway shared-memory
  // slot for exactly `ms`, matching Bun.sleepSync's blocking semantics
  // without a busy-spin. Only exercised under vitest/Node — production CLI
  // runs are always Bun (see this file's module doc, "wired on the CLI entry
  // branch" — the entry's shebang is `#!/usr/bin/env bun`).
  const sharedFlag = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(sharedFlag, 0, 0, ms);
}

/**
 * Write the FULL utf8-encoded `text` to `fd`, looping through short writes
 * and EAGAIN retries until every byte is delivered — the fix for the
 * non-blocking-fd1 truncation defect documented in this module's header.
 *
 * @param fd - 1 (stdout) or 2 (stderr)
 * @param text - the string to write; NOT newline-terminated by this
 *   function — callers append their own line endings (see `installSyncStdio`)
 * @throws whatever `node:fs.writeSync` throws for a non-EAGAIN error (e.g.
 *   `EPIPE` when the reader has genuinely closed) — never swallowed
 * @example
 *   writeAllSync(1, JSON.stringify(bigPayload) + "\n");
 */
export function writeAllSync(fd: 1 | 2, text: string): void {
  const buffer = Buffer.from(text, "utf8");
  let offset = 0;
  while (offset < buffer.length) {
    try {
      const written = writeSync(fd, buffer, offset, buffer.length - offset);
      offset += written;
    } catch (err) {
      if (isEagainError(err)) {
        sleepSyncMs(EAGAIN_RETRY_DELAY_MS);
        continue;
      }
      throw err;
    }
  }
}

/**
 * Replace `console.log`/`info`/`debug` (fd 1) and `console.warn`/`error`
 * (fd 2) with implementations that format arguments exactly like the
 * built-in console (`node:util.format`, same as Node's own console
 * internals) but write via `writeAllSync` — immune to the non-blocking-fd1
 * truncation defect this module's header documents.
 *
 * Call exactly once, at CLI process startup, BEFORE any command output is
 * produced (see `../../index.ts`'s CLI branch). Do NOT call this on the MCP
 * server branch — stdout is the MCP JSON-RPC transport there.
 */
export function installSyncStdio(): void {
  const writeLine = (fd: 1 | 2, args: unknown[]): void => {
    writeAllSync(fd, `${format(...args)}\n`);
  };
  console.log = (...args: unknown[]): void => writeLine(1, args);
  console.info = (...args: unknown[]): void => writeLine(1, args);
  console.debug = (...args: unknown[]): void => writeLine(1, args);
  console.warn = (...args: unknown[]): void => writeLine(2, args);
  console.error = (...args: unknown[]): void => writeLine(2, args);
}
