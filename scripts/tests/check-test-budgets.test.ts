/**
 * Unit suite for `scripts/check-test-budgets.ts`'s pure `scanFile` algorithm
 * (`spec-a-test-case-s-timeout-budget-must-be-declared-when-its`, task
 * `task-t1-structural-test-budget-oracle`, AC-TB-1/2/3/5).
 *
 * Every case here drives `scanFile` directly against an injected fixture
 * SOURCE STRING — no subprocess, no real filesystem walk — mirroring
 * `packages/lore/tests/unit/scripts/changed-tests-selector.test.ts`'s
 * established pattern for unit-testing a `scripts/*.ts` algorithm apart from
 * its CLI/IO shell. `bun run check:test-budgets` (the real repo-tree scan,
 * AC-TB-1) is a SEPARATE, deliberately un-mocked invocation — see that
 * task's completion report for why it is expected to exit non-zero at this
 * commit (AC-TB-4/task T2, a different task, has not yet declared the
 * reported instance's budget).
 *
 * Coverage (six dimensions):
 *   HAPPY — a clean 2-spawn body (no violation), plus 3-spawn bodies that
 *     DO declare an explicit timeout (numeric and `{ timeout }` object
 *     forms) — declaration alone must satisfy the oracle regardless of the
 *     number (D1).
 *   NEGATIVE — the AC-TB-2 control fixture (3 spawns, no timeout) IS
 *     reported, naming its exact test title; a bare trailing comma is never
 *     mistaken for an explicit-timeout declaration; a `.spawn(` member call
 *     on an unrelated, non-imported, non-wrapper object is never miscounted.
 *   BOUNDARY — AC-TB-3's matched pair: the SAME fixture at 2 spawns (clean)
 *     and 3 spawns (reported).
 *   ERROR — AC-TB-5: a file with a genuinely unbalanced paren count throws
 *     `TestBudgetParseError` naming its path, never returns a result.
 *   STATE — `scanFile` is idempotent: two calls on the same source produce
 *     structurally identical violations.
 *   REGRESSION — a fixture mirroring the ACTUAL reported incident's shape
 *     (`cli-plan-promote-advisory.bun.test.ts`'s AC-VRW-5b case) is
 *     reported with its EXACT verbatim title text.
 *
 * @spec_ref spec-a-test-case-s-timeout-budget-must-be-declared-when-its
 *   §Acceptance Criteria AC-TB-1, AC-TB-2, AC-TB-3, AC-TB-5
 */

import { describe, it, expect } from "vitest";
import { scanFile, SPAWN_THRESHOLD, TestBudgetParseError } from "../check-test-budgets.js";
import {
  boundaryFixture,
  CONTROL_THREE_SPAWNS_NO_TIMEOUT,
  THREE_SPAWNS_WITH_NUMERIC_TIMEOUT,
  THREE_SPAWNS_WITH_OPTIONS_TIMEOUT,
  THREE_SPAWNS_TRAILING_COMMA,
  UNRELATED_SPAWN_WORD_NO_FALSE_POSITIVE,
  REGRESSION_AC_VRW_5B_SHAPE,
  UNPARSEABLE_MISSING_CLOSE_PAREN,
} from "./fixtures.js";

const FIXTURE_PATH = "scripts/tests/fixtures/probe.test.ts";

describe("check-test-budgets: threshold sanity", () => {
  it("SPAWN_THRESHOLD is 3 (spec D2)", () => {
    expect(SPAWN_THRESHOLD).toBe(3);
  });
});

// ─── HAPPY ───────────────────────────────────────────────────────────────

describe("check-test-budgets: HAPPY — declaration satisfies regardless of spawn count", () => {
  it("a 2-spawn body with no timeout produces zero violations", () => {
    const violations = scanFile(FIXTURE_PATH, boundaryFixture(2));
    expect(violations).toEqual([]);
  });

  it("a 3-spawn body WITH an explicit numeric timeout produces zero violations", () => {
    const violations = scanFile(FIXTURE_PATH, THREE_SPAWNS_WITH_NUMERIC_TIMEOUT);
    expect(violations).toEqual([]);
  });

  it("a 3-spawn body WITH an explicit { timeout } options object produces zero violations", () => {
    const violations = scanFile(FIXTURE_PATH, THREE_SPAWNS_WITH_OPTIONS_TIMEOUT);
    expect(violations).toEqual([]);
  });
});

// ─── NEGATIVE ────────────────────────────────────────────────────────────

describe("check-test-budgets: NEGATIVE", () => {
  it("control fixture is reported", () => {
    const violations = scanFile("scripts/tests/fixtures/control.test.ts", CONTROL_THREE_SPAWNS_NO_TIMEOUT);
    expect(violations.length).toBe(1);
    expect(violations[0]?.title).toBe("control fixture is reported");
    expect(violations[0]?.spawnCount).toBeGreaterThanOrEqual(SPAWN_THRESHOLD);
  });

  it("a bare trailing comma after the callback is never mistaken for an explicit timeout", () => {
    const violations = scanFile(FIXTURE_PATH, THREE_SPAWNS_TRAILING_COMMA);
    expect(violations.length).toBe(1);
    expect(violations[0]?.title).toBe("trailing comma is not an explicit timeout");
  });

  it("a .spawn( call on an unrelated, non-imported, non-wrapper object is never miscounted", () => {
    const violations = scanFile(FIXTURE_PATH, UNRELATED_SPAWN_WORD_NO_FALSE_POSITIVE);
    expect(violations).toEqual([]);
  });
});

// ─── BOUNDARY ────────────────────────────────────────────────────────────

describe("check-test-budgets: BOUNDARY", () => {
  it("threshold boundary two versus three", () => {
    const twoSpawns = scanFile(FIXTURE_PATH, boundaryFixture(2));
    expect(twoSpawns).toEqual([]);

    const threeSpawns = scanFile(FIXTURE_PATH, boundaryFixture(3));
    expect(threeSpawns.length).toBe(1);
    expect(threeSpawns[0]?.title).toBe("boundary case with two spawns");
    expect(threeSpawns[0]?.spawnCount).toBe(3);
  });
});

// ─── ERROR ───────────────────────────────────────────────────────────────

describe("check-test-budgets: ERROR", () => {
  it("unparseable file is loud", () => {
    const path = "scripts/tests/fixtures/unparseable.test.ts";
    let threw = false;
    try {
      scanFile(path, UNPARSEABLE_MISSING_CLOSE_PAREN);
    } catch (e) {
      threw = true;
      expect(e).toBeInstanceOf(TestBudgetParseError);
      const parseError = e as TestBudgetParseError;
      expect(parseError.file).toBe(path);
      expect(parseError.message).toContain(path);
    }
    // reason: failure-first discipline — a silent skip (no throw) is
    // EXACTLY the defect D5 exists to prevent. Fail the assertion loudly
    // rather than let a missing throw read as "0 violations = clean".
    expect(threw).toBe(true);
  });

  it("never returns a result for an unparseable file (no silent partial scan)", () => {
    expect(() => scanFile("scripts/tests/fixtures/unparseable-2.test.ts", UNPARSEABLE_MISSING_CLOSE_PAREN)).toThrow(TestBudgetParseError);
  });
});

// ─── STATE ───────────────────────────────────────────────────────────────

describe("check-test-budgets: STATE", () => {
  it("scanFile is idempotent across repeated runs on the same source", () => {
    const first = scanFile("scripts/tests/fixtures/idempotent.test.ts", CONTROL_THREE_SPAWNS_NO_TIMEOUT);
    const second = scanFile("scripts/tests/fixtures/idempotent.test.ts", CONTROL_THREE_SPAWNS_NO_TIMEOUT);
    expect(second).toEqual(first);
    expect(second.length).toBe(1);
  });

  it("scanFile is idempotent on a clean (zero-violation) source too", () => {
    const first = scanFile(FIXTURE_PATH, boundaryFixture(2));
    const second = scanFile(FIXTURE_PATH, boundaryFixture(2));
    expect(second).toEqual(first);
    expect(second).toEqual([]);
  });
});

// ─── REGRESSION ──────────────────────────────────────────────────────────

describe("check-test-budgets: REGRESSION — reported instance shape", () => {
  it("reports the AC-VRW-5b shape with its exact verbatim title", () => {
    const violations = scanFile("packages/lore/tests/unit/adapters/cli-plan-promote-advisory.bun.test.ts", REGRESSION_AC_VRW_5B_SHAPE);
    expect(violations.length).toBe(1);
    expect(violations[0]?.title).toBe("prints ZERO advisory lines and exits 0 when the ancestor spec declares >= 1 script-mode AC");
    expect(violations[0]?.spawnCount).toBeGreaterThanOrEqual(SPAWN_THRESHOLD);
  });
});
