/**
 * Tests for `lore ac list`'s coverage badge rendering (SPEC-039 §2 D8, AC-VRF-8 render
 * half). `coverageBadge` is a pure formatting function over `AcCoverageFact[]` — it never
 * derives attested/self-reported itself, only reads `fact.attested_pass`/`attested_fail`,
 * which are constructed directly in each fixture below (no `computeAcCoverage` call
 * needed — this test owns rendering, not derivation).
 *
 * Uses bun:test (not vitest): `commands/ac.ts` imports `loadLoreApp` from `../loader.js`,
 * which imports `bun:sqlite` transitively via `app.ts` — the module cannot be loaded under
 * Vite/vitest at all (mirrors this directory's other `.bun.test.ts` files, e.g.
 * `cli-evidence-ac-ref.bun.test.ts`). No store, no App, no DB is actually exercised here —
 * `coverageBadge` itself takes plain data — the bun runtime is required purely so the
 * import resolves.
 *
 * Six-dimension coverage:
 *   HAPPY    — attested-pass renders the `⚑✔` prefix + `(n attested)` suffix
 *   NEGATIVE — self-reported-only pass/fail keeps the pre-existing plain `✔`/`✘` (no
 *              attested annotation) — proves the annotation is conditional, not default
 *   BOUNDARY — nonzero pass and fail, both attested counts zero, renders unannotated
 *   ERROR    — unknown ac_id (no matching fact) and `coverage: null` degrade to `"·"`
 *   STATE    — a fail-dominant fact carrying BOTH attested pass and attested fail still
 *              renders the `✘` branch (fail precedence, pre-existing rule) with its own
 *              attested annotation, not the pass side's
 *   REGRESSION — zero-evidence fact (`pass: 0, fail: 0`) still renders bare `"·"`,
 *              matching pre-SPEC-039 behaviour byte-for-byte
 *
 * @layer unit-coverage-badge-render (coverageBadge glyph rendering; owners are the core acceptance and service workflow tests)
 * @spec_ref AC-VRF-8
 *
 * SPEC-061 §Scope D5 addition (task-t2-close-spec-061-deferred-gaps): a separate
 * `describe` block below covers the `⚑?` inconclusive-only badge — the fixture's
 * `refs[]` now matters (the inconclusive count is derived from `fact.refs`, not a
 * dedicated `AcCoverageFact` field; see `coverageBadge`'s own JSDoc for why). The
 * REGRESSION block above already proves `·` for a fact with an EMPTY `refs` array;
 * this addition's own REGRESSION case proves the SAME `·` outcome for a fact whose
 * `refs` is empty even after this change (byte-identical), plus a dedicated
 * AC-061-G2 case proving an attested-pass fact still renders `⚑✔` unaffected by the
 * new branch (it is checked strictly AFTER pass/fail, never before).
 * @spec_ref AC-061-G2
 *
 * spec-workflow-hardening-evidence-red-vocabulary-claim-worktree §M1 addition
 * (task-t5-close-ac-wh-1-rendering-clause-oracle-coverage-assess, closing the
 * 2026-07-27 assess major gap on AC-WH-1): a further `describe` block below covers
 * the NEW `⚑R` expected-fail-only badge. Before this task's `coverageBadge` change,
 * an AC whose only evidence was `"expected-fail"` fell all the way to `·` — the SAME
 * rendering as an AC no oracle has ever run against, which is exactly the gap the
 * assessment flagged ("stored verbatim with distinct rendering" was asserted only in
 * prose, no renderer had actually changed). These are RED-first: they fail against
 * pre-change `coverageBadge` (falls to `·`) and pass once the `⚑R` branch lands.
 * @spec_ref AC-WH-1
 */

import { describe, it, expect } from "vitest";
import { coverageBadge } from "../../../src/adapters/cli/commands/ac.js";
import type { AcCoverageFact } from "@lore/core";

function fact(overrides: Partial<AcCoverageFact>): AcCoverageFact {
  return {
    ac_id: "AC-1",
    mode: "script",
    pass: 0,
    fail: 0,
    refs: [],
    attested_pass: 0,
    attested_fail: 0,
    falsified: 0,
    ...overrides,
  };
}

describe("coverageBadge — HAPPY", () => {
  it("an attested-pass criterion renders the ⚑✔ prefix with an attested count suffix", () => {
    const coverage = [fact({ pass: 2, fail: 0, attested_pass: 1 })];
    expect(coverageBadge(coverage, "AC-1")).toBe("⚑✔(2/0, 1 attested)");
  });
});

describe("coverageBadge — NEGATIVE", () => {
  it("a self-reported-only pass (attested_pass = 0) keeps the plain ✔ prefix, no annotation", () => {
    const coverage = [fact({ pass: 3, fail: 0, attested_pass: 0 })];
    expect(coverageBadge(coverage, "AC-1")).toBe("✔(3/0)");
  });

  it("a self-reported-only fail (attested_fail = 0) keeps the plain ✘, no annotation", () => {
    const coverage = [fact({ pass: 0, fail: 2, attested_fail: 0 })];
    expect(coverageBadge(coverage, "AC-1")).toBe("✘(0/2)");
  });
});

describe("coverageBadge — BOUNDARY", () => {
  it("nonzero pass and fail, both attested counts zero, renders the ✘ branch (fail precedence) unannotated", () => {
    const coverage = [fact({ pass: 1, fail: 1, attested_pass: 0, attested_fail: 0 })];
    expect(coverageBadge(coverage, "AC-1")).toBe("✘(1/1)");
  });
});

describe("coverageBadge — ERROR", () => {
  it("an ac_id with no matching fact in the coverage array renders '·'", () => {
    const coverage = [fact({ ac_id: "AC-OTHER", pass: 5, fail: 0, attested_pass: 5 })];
    expect(coverageBadge(coverage, "AC-1")).toBe("·");
  });

  it("coverage: null renders '·' (no plan to aggregate against)", () => {
    expect(coverageBadge(null, "AC-1")).toBe("·");
  });
});

describe("coverageBadge — STATE", () => {
  it("a fail-dominant fact carrying BOTH attested_pass and attested_fail renders only the fail side's annotation", () => {
    const coverage = [fact({ pass: 1, fail: 1, attested_pass: 1, attested_fail: 1 })];
    expect(coverageBadge(coverage, "AC-1")).toBe("✘(1/1, 1 attested)");
  });
});

describe("coverageBadge — REGRESSION", () => {
  it("a zero-evidence fact (pass=0, fail=0) still renders bare '·', matching pre-SPEC-039 behaviour", () => {
    const coverage = [fact({ pass: 0, fail: 0, attested_pass: 0, attested_fail: 0 })];
    expect(coverageBadge(coverage, "AC-1")).toBe("·");
  });
});

// ─── SPEC-061 §Scope D5 — inconclusive badge (task-t2-close-spec-061-deferred-gaps) ──

describe("coverageBadge — SPEC-061 inconclusive badge — HAPPY", () => {
  it("an AC whose only evidence is inconclusive renders ⚑?(n), distinct from · (AC-061-G2)", () => {
    const coverage = [
      fact({
        pass: 0,
        fail: 0,
        refs: [
          { task_id: "t1", result: "inconclusive" },
          { task_id: "t2", result: "inconclusive" },
        ],
      }),
    ];
    expect(coverageBadge(coverage, "AC-1")).toBe("⚑?(2)");
  });
});

describe("coverageBadge — SPEC-061 inconclusive badge — BOUNDARY", () => {
  it("exactly one inconclusive ref renders ⚑?(1)", () => {
    const coverage = [fact({ pass: 0, fail: 0, refs: [{ task_id: "t1", result: "inconclusive" }] })];
    expect(coverageBadge(coverage, "AC-1")).toBe("⚑?(1)");
  });
});

describe("coverageBadge — SPEC-061 inconclusive badge — STATE", () => {
  it("a real pass alongside an inconclusive ref renders the pass badge, never the inconclusive one (pass/fail precedence)", () => {
    const coverage = [
      fact({
        pass: 1,
        fail: 0,
        attested_pass: 0,
        refs: [
          { task_id: "t1", result: "pass" },
          { task_id: "t2", result: "inconclusive" },
        ],
      }),
    ];
    expect(coverageBadge(coverage, "AC-1")).toBe("✔(1/0)");
  });

  it("a real fail alongside an inconclusive ref renders the fail badge, never the inconclusive one (fail precedence)", () => {
    const coverage = [
      fact({
        pass: 0,
        fail: 1,
        attested_fail: 0,
        refs: [
          { task_id: "t1", result: "fail" },
          { task_id: "t2", result: "inconclusive" },
        ],
      }),
    ];
    expect(coverageBadge(coverage, "AC-1")).toBe("✘(0/1)");
  });
});

describe("coverageBadge — SPEC-061 inconclusive badge — REGRESSION", () => {
  it("a zero-evidence fact (empty refs) still renders bare '·', unaffected by the new inconclusive branch", () => {
    const coverage = [fact({ pass: 0, fail: 0, refs: [] })];
    expect(coverageBadge(coverage, "AC-1")).toBe("·");
  });

  it("an attested-pass fact still renders ⚑✔ unaffected by the new inconclusive branch (pre-existing SPEC-039 HAPPY case, re-asserted)", () => {
    const coverage = [fact({ pass: 2, fail: 0, attested_pass: 1 })];
    expect(coverageBadge(coverage, "AC-1")).toBe("⚑✔(2/0, 1 attested)");
  });
});

// ─── spec-workflow-hardening-evidence-red-vocabulary-claim-worktree §M1 — ⚑R
//     expected-fail badge (task-t5-close-ac-wh-1-rendering-clause-oracle-coverage-
//     assess, AC-WH-1 assess major gap close-out) ──────────────────────────────

describe("coverageBadge — AC-WH-1 expected-fail badge — HAPPY", () => {
  it("AC-WH-1.H1: an AC whose only evidence is expected-fail renders ⚑R(n), distinct from · (RED-first: fails pre-change, falls to ·)", () => {
    const coverage = [
      fact({
        pass: 0,
        fail: 0,
        refs: [
          { task_id: "t1", result: "expected-fail" },
          { task_id: "t2", result: "expected-fail" },
        ],
      }),
    ];
    expect(coverageBadge(coverage, "AC-1")).toBe("⚑R(2)");
  });
});

describe("coverageBadge — AC-WH-1 expected-fail badge — BOUNDARY", () => {
  it("AC-WH-1.B1: exactly one expected-fail ref renders ⚑R(1)", () => {
    const coverage = [fact({ pass: 0, fail: 0, refs: [{ task_id: "t1", result: "expected-fail" }] })];
    expect(coverageBadge(coverage, "AC-1")).toBe("⚑R(1)");
  });
});

describe("coverageBadge — AC-WH-1 expected-fail badge — STATE", () => {
  it("AC-WH-1.S1: a real pass alongside an expected-fail ref renders the pass badge, never ⚑R (pass/fail precedence)", () => {
    const coverage = [
      fact({
        pass: 1,
        fail: 0,
        attested_pass: 0,
        refs: [
          { task_id: "t1", result: "pass" },
          { task_id: "t2", result: "expected-fail" },
        ],
      }),
    ];
    expect(coverageBadge(coverage, "AC-1")).toBe("✔(1/0)");
  });

  it("AC-WH-1.S2: a real fail alongside an expected-fail ref renders the fail badge, never ⚑R (fail precedence)", () => {
    const coverage = [
      fact({
        pass: 0,
        fail: 1,
        attested_fail: 0,
        refs: [
          { task_id: "t1", result: "fail" },
          { task_id: "t2", result: "expected-fail" },
        ],
      }),
    ];
    expect(coverageBadge(coverage, "AC-1")).toBe("✘(0/1)");
  });

  it("AC-WH-1.S3: an inconclusive ref alongside an expected-fail ref (no pass/fail) renders ⚑? not ⚑R — inconclusive is checked first (an oracle that ran but couldn't attest a result outranks a self-declared RED pin)", () => {
    const coverage = [
      fact({
        pass: 0,
        fail: 0,
        refs: [
          { task_id: "t1", result: "inconclusive" },
          { task_id: "t2", result: "expected-fail" },
        ],
      }),
    ];
    expect(coverageBadge(coverage, "AC-1")).toBe("⚑?(1)");
  });
});

describe("coverageBadge — AC-WH-1 expected-fail badge — REGRESSION", () => {
  it("AC-WH-1.REG1: a zero-evidence fact (empty refs) still renders bare '·', unaffected by the new expected-fail branch", () => {
    const coverage = [fact({ pass: 0, fail: 0, refs: [] })];
    expect(coverageBadge(coverage, "AC-1")).toBe("·");
  });

  it("AC-WH-1.REG2: an attested-pass fact still renders ⚑✔ unaffected by the new expected-fail branch", () => {
    const coverage = [fact({ pass: 2, fail: 0, attested_pass: 1 })];
    expect(coverageBadge(coverage, "AC-1")).toBe("⚑✔(2/0, 1 attested)");
  });

  it("AC-WH-1.REG3: an inconclusive-only fact still renders ⚑? unaffected by the new expected-fail branch (SPEC-061 behavior preserved)", () => {
    const coverage = [fact({ pass: 0, fail: 0, refs: [{ task_id: "t1", result: "inconclusive" }] })];
    expect(coverageBadge(coverage, "AC-1")).toBe("⚑?(1)");
  });
});

// ─── spec-oracle-tier-falsifiability-a-criterion-never-observed-red M4/M5 —
//     fail_superseded / not_measured badges (AC-FALS-19). ────────────────────

describe("coverageBadge — M4/M5 new-state badges", () => {
  it("badge-new-states: fail_superseded and not_measured each render their own explicit marker, distinct from each other and from every pre-existing/residual badge shape", () => {
    const supersededFact = fact({
      pass: 1,
      fail: 1,
      attested_pass: 1,
      falsified: 1,
      refs: [
        { task_id: "t1", result: "fail", recorded_at: "2026-08-01T00:00:00.000Z" },
        { task_id: "t2", result: "pass", attested: true, recorded_at: "2026-08-02T00:00:00.000Z" },
      ],
    });
    // NaN is a well-typed `number` value that fails deriveAcCoverageState's
    // runtime well-formedness check (M5) — no unsafe cast needed to construct
    // this fixture, unlike the "genuinely absent" fixtures elsewhere.
    const notMeasuredFact = fact({ pass: 1, fail: 0, attested_pass: 0, falsified: NaN, refs: [] });

    const supersededBadge = coverageBadge([supersededFact], "AC-1");
    const notMeasuredBadge = coverageBadge([notMeasuredFact], "AC-1");

    expect(supersededBadge).toBe("✘S(1/1)");
    expect(notMeasuredBadge).toBe("⚠(1/0)");

    // Neither falls through the if-chain to a residual/pre-existing marker, and
    // the two new badges are distinct from EACH OTHER too.
    const otherBadgeShapes = ["·", "⚑?(1)", "⚑R(1)", "✘(1/1)", "✔(1/0)", "⚑✔(1/0, 1 attested)"];
    expect(otherBadgeShapes).not.toContain(supersededBadge);
    expect(otherBadgeShapes).not.toContain(notMeasuredBadge);
    expect(supersededBadge).not.toBe(notMeasuredBadge);
  });
});
