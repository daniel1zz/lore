// @reads vitest.shared.ts
/** @spec_ref AC-TG-11 */
/**
 * test-yield-setup: the worker's event loop gets a turn between two tests (task-skill-implement-tg-15).
 *
 * Why: a test file whose tests all block synchronously (Bun.spawnSync of the CLI) runs test after test inside
 * promise continuations without ever returning to the event loop. Past 60 s of that the worker cannot answer
 * vitest's RPC and the run ends with `Timeout calling "onTaskUpdate"` although every test passed (measured at
 * 8 workers: tree-consistency 74 s, cli.bun 76 s, verify 86 s without one loop turn). scripts/test-yield-setup.ts
 * registers a global `afterEach` that yields one loop turn, so a stall is bounded by ONE test, not one file.
 *
 * Six dimensions: HAPPY (a timer scheduled by test A has fired when test B starts) / NEGATIVE (the timer has NOT fired
 * inside test A itself: A is synchronous, so the turn really comes from the gap) / STATE (a second gap works the same) /
 * REGRESSION (the setup file is registered in the shared config the two runner invocations use).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const state = { firedFirst: false, firedSecond: false, sawFiredInsideA: true };

describe("a loop turn between two synchronous tests", () => {
  it("A: schedules a timer and blocks synchronously; the timer cannot have fired inside A", () => {
    state.firedFirst = false;
    setTimeout(() => {
      state.firedFirst = true;
    }, 0);
    const end = Date.now() + 20;
    while (Date.now() < end) {
      // synchronous busy wait: no loop turn can happen in here
    }
    state.sawFiredInsideA = state.firedFirst;
    expect(state.sawFiredInsideA).toBe(false);
  });

  it("B: the timer scheduled by A fired in the gap between A and B", () => {
    expect(state.firedFirst).toBe(true);
    setTimeout(() => {
      state.firedSecond = true;
    }, 0);
  });

  it("C: and again in the gap between B and C", () => {
    expect(state.firedSecond).toBe(true);
  });
});

describe("registration", () => {
  it("REGRESSION: vitest.shared.ts registers scripts/test-yield-setup.ts as a setup file", () => {
    const shared = readFileSync(join(fileURLToPath(import.meta.url), "..", "..", "..", "vitest.shared.ts"), "utf8");
    expect(shared).toContain('"scripts/test-yield-setup.ts"');
  });
});
