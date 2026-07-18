/**
 * Tests for the SPEC-053 v2 review judge prompt in `review-template.ts` — the non-blocking
 * AC-quantifiability advisory dimension, the version/registry bump, and the FROZEN v1
 * byte-identity guarantee. Pure string-assembly module, no IO (except reading the frozen v1
 * fixture in the REGRESSION test).
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      a spec bundle with ≥1 declared AC gets the advisory material section, the
 *               AC list, the lint verdict count, and the advisory-only clause.
 *   NEGATIVE:   a non-spec doc, and a spec with 0 declared ACs, get NO advisory section.
 *   BOUNDARY:   the lint verdict count reflects exactly the flagged/clean split.
 *   STATE:      REVIEW_PROMPT_VERSION === "v2"; REVIEW_TEMPLATES holds exactly v1 + v2.
 *   REGRESSION: REVIEW_TEMPLATES["v1"] output is byte-identical to the frozen fixture
 *               captured before SPEC-053.
 *
 * Source: SPEC-053 §Acceptance Criteria AC-053-1, AC-053-3, AC-053-4, AC-053-5, AC-053-6.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  REVIEW_TEMPLATES,
  REVIEW_PROMPT_VERSION,
  ADVISORY_ONLY_CLAUSE,
} from "../../../src/ai/review-template.js";
import type { DocRecord, ReviewBundle, CheckResult, AcceptanceCriterion } from "@lore/core";

const BUDGETS = { max_doc_chars: 8000, max_context_chars: 4000 };
const NOW = "2026-02-01T00:00:00.000Z";

function makeDoc(overrides: Partial<DocRecord>): DocRecord {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    slug: "spec-example-feature",
    type: "spec",
    role: "requirement",
    title: "SPEC-XXX — Example Feature",
    status: "in-review",
    priority: "medium",
    content: "## Overview/Goal\n\nDo the thing.",
    parent_id: null,
    extra: {},
    tags: [],
    version: 3,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
    created_by: "system",
    deleted_at: null,
    ...overrides,
  } as DocRecord;
}

const AC_FAST: AcceptanceCriterion = {
  id: "AC-1",
  statement: "the dashboard loads fast",
  verify: { mode: "human" },
};
const AC_MEASURED: AcceptanceCriterion = {
  id: "AC-2",
  statement: "the dashboard P95 load < 200ms",
  verify: { mode: "human" },
};

function specBundleWithAcs(criteria: AcceptanceCriterion[]): ReviewBundle {
  return {
    doc: makeDoc({ extra: { spec_kind: "feature", acceptance_criteria: criteria } }),
    links: [],
  };
}

const CHECKS: CheckResult[] = [{ check: "schema", outcome: "pass" }];

// ─── AC-053-1: version + registry ─────────────────────────────────────────────

describe("SPEC-053 AC-053-1 — active version + registry shape", () => {
  it("STATE: REVIEW_PROMPT_VERSION is 'v2'", () => {
    expect(REVIEW_PROMPT_VERSION).toBe("v2");
  });

  it("STATE: REVIEW_TEMPLATES has exactly the keys v1 and v2", () => {
    expect(Object.keys(REVIEW_TEMPLATES).sort()).toEqual(["v1", "v2"]);
    expect(Object.keys(REVIEW_TEMPLATES)).toHaveLength(2);
  });

  it("STATE: the active version resolves to a live template fn", () => {
    expect(typeof REVIEW_TEMPLATES[REVIEW_PROMPT_VERSION]).toBe("function");
  });
});

// ─── AC-053-3: advisory section presence across 3 branches ───────────────────

describe("SPEC-053 AC-053-3 — advisory section presence", () => {
  const v2 = REVIEW_TEMPLATES["v2"]!;

  it("HAPPY: a spec with ≥1 declared AC gets the advisory heading and every AC id", () => {
    const out = v2(specBundleWithAcs([AC_FAST, AC_MEASURED]), CHECKS, BUDGETS, NOW);
    expect(out.prompt).toContain("# AC Quantifiability (advisory)");
    expect(out.prompt).toContain("AC-1");
    expect(out.prompt).toContain("AC-2");
  });

  it("NEGATIVE: a non-spec doc gets NO advisory heading", () => {
    const bundle: ReviewBundle = {
      doc: makeDoc({ type: "prd", extra: {} }),
      links: [],
    };
    const out = v2(bundle, CHECKS, BUDGETS, NOW);
    expect(out.prompt).not.toContain("# AC Quantifiability (advisory)");
  });

  it("NEGATIVE: a spec with 0 declared ACs gets NO advisory heading", () => {
    const bundle: ReviewBundle = { doc: makeDoc({ extra: { spec_kind: "feature" } }), links: [] };
    const out = v2(bundle, CHECKS, BUDGETS, NOW);
    expect(out.prompt).not.toContain("# AC Quantifiability (advisory)");
  });
});

// ─── AC-053-4: advisory-only clause ──────────────────────────────────────────

describe("SPEC-053 AC-053-4 — advisory-only clause", () => {
  it("HAPPY: v2 output for a spec-with-ACs contains the exact advisory-only clause", () => {
    const out = REVIEW_TEMPLATES["v2"]!(specBundleWithAcs([AC_FAST]), CHECKS, BUDGETS, NOW);
    expect(out.prompt).toContain(ADVISORY_ONLY_CLAUSE);
    // the clause names the non-negotiable contract verbatim
    expect(ADVISORY_ONLY_CLAUSE).toContain("MUST NOT");
    expect(ADVISORY_ONLY_CLAUSE).toContain("sole hard gate");
  });
});

// ─── AC-053-5: lint verdict embedded ─────────────────────────────────────────

describe("SPEC-053 AC-053-5 — deterministic lint verdict embedded", () => {
  it("HAPPY: the section reports the lint block count and the per-AC flagged/clean split", () => {
    // AC_FAST ("loads fast", human, no threshold) → 1 block finding.
    // AC_MEASURED ("P95 load < 200ms") → clean.
    const out = REVIEW_TEMPLATES["v2"]!(specBundleWithAcs([AC_FAST, AC_MEASURED]), CHECKS, BUDGETS, NOW);
    expect(out.prompt).toContain("found 1 blocking issue(s)");
    expect(out.prompt).toContain("AC-1: the dashboard loads fast  [lexical lint: flagged]");
    expect(out.prompt).toContain("AC-2: the dashboard P95 load < 200ms  [lexical lint: clean]");
  });

  it("BOUNDARY: all-clean ACs report 0 blocking issues", () => {
    const out = REVIEW_TEMPLATES["v2"]!(specBundleWithAcs([AC_MEASURED]), CHECKS, BUDGETS, NOW);
    expect(out.prompt).toContain("found 0 blocking issue(s)");
    expect(out.prompt).toContain("[lexical lint: clean]");
  });
});

// ─── AC-053-6: v1 frozen byte-identity ───────────────────────────────────────

describe("SPEC-053 AC-053-6 — v1 template byte-identical to frozen fixture", () => {
  it("REGRESSION: REVIEW_TEMPLATES['v1'] output equals the pre-SPEC-053 fixture", () => {
    const fixture = readFileSync(
      new URL("../../fixtures/review-prompt-v1.txt", import.meta.url),
      "utf8",
    );
    // Reconstruct the EXACT bundle used to capture the fixture (see the capture note in the
    // SPEC-053 implementation history) — same doc/parent/checks/budgets/nowIso.
    const doc = makeDoc({
      content:
        "## Overview/Goal\n\nDo the thing.\n\n## Scope\n\nIn: the thing. Out: other things.\n\n## Acceptance Criteria\n\n- AC-1 works fast enough",
      parent_id: "01ARZ3NDEKTSV4RRFFQ69G5FAW",
      extra: {
        spec_kind: "feature",
        acceptance_criteria: [AC_FAST, { id: "AC-2", statement: "P95 load < 200ms", verify: { mode: "human" } }],
      },
    });
    const parent = makeDoc({
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAW",
      slug: "prd-example",
      type: "prd",
      title: "PRD — Example",
      status: "active",
      priority: "high",
      content: "# PRD\n\nThe product.",
      parent_id: null,
      extra: {},
      version: 1,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });
    const bundle: ReviewBundle = { doc, parent, links: [] };
    const checks: CheckResult[] = [
      { check: "schema", outcome: "pass" },
      { check: "parent_contract", outcome: "pass" },
    ];

    const out = REVIEW_TEMPLATES["v1"]!(bundle, checks, BUDGETS, NOW);
    expect(out.prompt).toBe(fixture);
  });
});
