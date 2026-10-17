/**
 * Gives the worker's event loop one turn after every test (task-skill-implement-tg-15, AC-TG-11).
 *
 * Purpose: vitest runs a file's tests back to back inside promise continuations. When the tests block
 * synchronously (Bun.spawnSync of the CLI, spawnSync of tsc) the loop never turns between them, so for the
 * whole file the worker answers no RPC and fires no timer. Past 60 s of that, vitest's RPC to the main
 * process times out and the run ends with `Timeout calling "onTaskUpdate"` as an unhandled error even though
 * every test passed (measured with 8 workers: tree-consistency 74 s, cli.bun 76 s, verify 86 s with no loop turn;
 * at 4 workers the same files took under 45 s, which is why the error was intermittent). Yielding after each test
 * bounds an unanswered stretch to ONE test, not one file.
 * Public surface: none (registers an `afterEach` for every test file; listed in `setupFiles`, vitest.shared.ts).
 * Side-effect class: adds one 0 ms timer turn per test (not setImmediate: that runs before due timers, so it would not let a timed-out RPC settle in order); no state.
 * Proof: scripts/tests/test-yield-setup.test.ts.
 */
import { afterEach } from "vitest";

afterEach(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
