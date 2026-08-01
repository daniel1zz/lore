/**
 * Cross-site regression coverage for `lore assess`'s THREE render sites (SPEC-040 §T3
 * D3, AC-ADF-13):
 *   1. core `renderAssessmentContent` (`@lore/core`, done in T1 — light parity check only)
 *   2. CLI `formatAssessmentSummary` (`packages/lore/src/adapters/cli/assess-render.ts`)
 *   3. MCP `buildAssessSummaryText` (`packages/lore/src/adapters/mcp/assess-render.ts`)
 *
 * Both (2) and (3) are extracted pure render helpers, tested directly here — neither
 * `commands/assess.ts` (imports the bun-only `loader.ts`) nor a running MCP server is
 * spawned. Every SPEC-040 typed block (dimension scores, typed gaps, typed
 * recommendations, rubric warnings) is additive and presence-guarded at each site: a
 * legacy-only AssessmentResult must render IDENTICALLY to the pre-SPEC-040 shape at
 * every site (no typed-block markers leak in), and a result WITH typed fields must
 * render all three additions at every site.
 *
 * Coverage:
 *   HAPPY:      typed fields present → each site renders dimension scores / typed gaps
 *               / typed recommendations tables with the expected content
 *   NEGATIVE:   empty gaps/recommendations/ac_scores arrays render no section at all
 *               (not even a placeholder) at CLI/MCP — matches their pre-existing
 *               "skip the block" contract (distinct from core's "(none)" placeholder)
 *   BOUNDARY:   dimension_scores present but `{}` (no keys) → no Dimension Scores block
 *               at any site; a typed_gaps entry with no ac_ref renders "—"
 *   ERROR:      pipe characters (`|`) inside judge-authored text never break the
 *               rendered Markdown table structure (CLI/MCP table-escaping)
 *   STATE:      each render fn is deterministic — repeated calls on the same input
 *               produce byte-identical output
 *   REGRESSION: a legacy-only AssessmentResult (no dimension_scores/typed_gaps/
 *               typed_recommendations/rubric_warning) renders WITHOUT any of those
 *               section headers at all three sites (parity)
 *
 * @spec_ref AC-ADF-13
 *
 * Additional coverage (task-lore-assess-derives-a-plan-s-commits-by-grepping-task AC #3):
 * the CLI/MCP terminal render sites previously had NO "Unverifiable" section at all —
 * `result.unverifiable[]` was persisted (core's `renderAssessmentContent` already rendered
 * it) but silently absent from the terminal/MCP summary a human/agent actually reads
 * first. Added as a presence-guarded block (mirrors every other SPEC-040 block's
 * contract), so the AC #3 "not scored" wording forced by
 * `ai-provider-service.ts::forceScopeFidelityUnverifiable` is now visible at every site,
 * not just the persisted Markdown.
 */

import { describe, it, expect } from "vitest";
import type { AssessmentResult } from "@lore/core";
import { renderAssessmentContent } from "@lore/core";
import { formatAssessmentSummary } from "../../src/adapters/cli/assess-render.js";
import { buildAssessSummaryText } from "../../src/adapters/mcp/assess-render.js";

// ─── Fixtures ───────────────────────────────────────────────────────────────────

function baseJudgment() {
  return {
    provider: "in-memory",
    prompt_version: 6,
    duration_ms: 1234,
    retried: false,
    truncated: [] as string[],
  };
}

/** Legacy-only shape — no SPEC-040 fields at all (pre-SPEC-040 persisted assessment). */
function legacyResult(): AssessmentResult {
  return {
    scope: { type: "plan", id: "plan-1" },
    verdict: "met",
    overall_score: 90,
    ac_scores: [
      { ac_id: "AC-1", score: 90, reasoning: "Solid evidence trail.", evidence_refs: [] },
    ],
    gaps: ["Minor: no negative-path test."],
    recommendations: ["Add a negative-path test."],
    judgment: baseJudgment(),
  };
}

/** Result with every SPEC-040 typed field populated. */
function typedResult(): AssessmentResult {
  return {
    ...legacyResult(),
    dimension_scores: {
      outcome: { score: 85, confidence: 0.7, based_on: "evidence", reasoning: "Strong AC coverage." },
      evidence_integrity: { score: 60, confidence: 0.4, based_on: "absence", reasoning: "No attested runs." },
    },
    typed_gaps: [
      { dimension: "outcome", severity: "minor", ac_ref: "AC-1", statement: "No negative-path test." },
      { dimension: "evidence_integrity", severity: "major", statement: "Evidence is self-reported only." },
    ],
    typed_recommendations: [
      { target: "plan", action: "Add a negative-path test task.", rationale: "Closes the coverage gap." },
    ],
    rubric_warning: ["evidence_integrity scored on absence without a named unverifiable material."],
    unverifiable: [{ material: "AC-9 evidence doc", reason: "doc_id not found in bundle." }],
  };
}

/** Result with an empty (but present) dimension_scores object — boundary case. */
function emptyDimensionScoresResult(): AssessmentResult {
  return { ...legacyResult(), dimension_scores: {} };
}

/** Result with an empty (but present) unverifiable array — boundary case (mirrors dimension_scores). */
function emptyUnverifiableResult(): AssessmentResult {
  return { ...legacyResult(), unverifiable: [] };
}

/** Result whose ONLY unverifiable entry carries the AC #3 forced "not scored" wording. */
function forcedUnverifiableScopeResult(): AssessmentResult {
  return {
    ...legacyResult(),
    unverifiable: [
      {
        material: "scope_fidelity dimension score",
        reason:
          "This plan's commit set could not be verified (deriveCommitSetForPlan reported " +
          "unverifiable_convention_mismatch). scope_fidelity was NOT SCORED at all for this run.",
      },
    ],
  };
}

/** Result with no ac_scores/gaps/recommendations at all — negative-space case. */
function emptyArraysResult(): AssessmentResult {
  return { ...legacyResult(), ac_scores: [], gaps: [], recommendations: [] };
}

/** Result whose judge-authored text contains raw pipe characters. */
function pipeHostileResult(): AssessmentResult {
  return {
    ...legacyResult(),
    ac_scores: [{ ac_id: "AC-1", score: 50, reasoning: "a | b | c", evidence_refs: [] }],
    typed_gaps: [{ dimension: "outcome", severity: "minor", statement: "x | y" }],
    typed_recommendations: [{ target: "plan", action: "do | this", rationale: "why | not" }],
  };
}

const SITES: Array<{ name: string; render: (r: AssessmentResult) => string }> = [
  { name: "core", render: renderAssessmentContent },
  { name: "cli", render: formatAssessmentSummary },
  { name: "mcp", render: buildAssessSummaryText },
];

// ─── HAPPY ──────────────────────────────────────────────────────────────────────

describe("assess render sites — HAPPY (typed fields render at every site)", () => {
  for (const site of SITES) {
    it(`${site.name}: renders dimension scores labeled 'self-reported, uncalibrated'`, () => {
      const text = site.render(typedResult());
      expect(text).toMatch(/self-reported, uncalibrated/);
      expect(text).toContain("outcome");
      expect(text).toContain("85");
    });

    it(`${site.name}: renders typed gaps (dimension/severity/ac_ref/statement)`, () => {
      const text = site.render(typedResult());
      expect(text).toContain("No negative-path test.");
      expect(text).toContain("minor");
      expect(text).toContain("AC-1");
    });

    it(`${site.name}: renders typed recommendations (target/action/rationale)`, () => {
      const text = site.render(typedResult());
      expect(text).toContain("Add a negative-path test task.");
      expect(text).toContain("Closes the coverage gap.");
    });

    // task-lore-assess-derives-a-plan-s-commits-by-grepping-task AC #3 — the
    // "Unverifiable" section (material + reason) must render at EVERY site, not just
    // core's persisted Markdown; typedResult() already carries one unverifiable[] entry.
    it(`${site.name}: renders unverifiable materials (material + reason)`, () => {
      const text = site.render(typedResult());
      expect(text).toContain("AC-9 evidence doc");
      expect(text).toContain("doc_id not found in bundle.");
    });

    it(`${site.name}: renders the AC #3 forced 'not scored' wording verbatim when present`, () => {
      const text = site.render(forcedUnverifiableScopeResult());
      expect(text).toContain("scope_fidelity dimension score");
      expect(text.toLowerCase()).toContain("not scored");
    });
  }
});

// ─── NEGATIVE ───────────────────────────────────────────────────────────────────

describe("assess render sites — NEGATIVE (CLI/MCP skip empty sections entirely)", () => {
  it("cli: empty gaps/recommendations/ac_scores render no 'Gaps:'/'Recommendations:'/AC table", () => {
    const text = formatAssessmentSummary(emptyArraysResult());
    expect(text).not.toContain("Gaps:");
    expect(text).not.toContain("Recommendations:");
    expect(text).not.toContain("| AC |");
  });

  it("mcp: empty gaps/recommendations/ac_scores render no 'Gaps:'/'Recommendations:'/AC table", () => {
    const text = buildAssessSummaryText(emptyArraysResult());
    expect(text).not.toContain("Gaps:");
    expect(text).not.toContain("Recommendations:");
    expect(text).not.toContain("| AC |");
  });
});

// ─── BOUNDARY ───────────────────────────────────────────────────────────────────

describe("assess render sites — BOUNDARY", () => {
  for (const site of SITES) {
    it(`${site.name}: dimension_scores present but empty {} renders no Dimension Scores block`, () => {
      const text = site.render(emptyDimensionScoresResult());
      expect(text.toLowerCase()).not.toContain("dimension score");
    });

    it(`${site.name}: unverifiable present but empty [] renders no Unverifiable block`, () => {
      const text = site.render(emptyUnverifiableResult());
      expect(text.toLowerCase()).not.toContain("unverifiable");
    });
  }

  it("cli: a typed_gaps entry with no ac_ref renders '—'", () => {
    const result: AssessmentResult = {
      ...legacyResult(),
      typed_gaps: [{ dimension: "outcome", severity: "minor", statement: "No ac_ref here." }],
    };
    expect(formatAssessmentSummary(result)).toContain("—");
  });

  it("mcp: a typed_gaps entry with no ac_ref renders '—'", () => {
    const result: AssessmentResult = {
      ...legacyResult(),
      typed_gaps: [{ dimension: "outcome", severity: "minor", statement: "No ac_ref here." }],
    };
    expect(buildAssessSummaryText(result)).toContain("—");
  });
});

// ─── ERROR (defensive table-escaping) ────────────────────────────────────────────

describe("assess render sites — ERROR (pipe characters never break table structure)", () => {
  it("cli: reasoning/statement/action containing '|' render verbatim without corrupting the Unicode box table", () => {
    // reason: the CLI's formatTable (utils.ts) uses two-space column separation, not
    // pipe delimiters — a literal "|" in judge-authored text is inert here (nothing to
    // escape), unlike the MCP site's Markdown pipe tables below. This asserts the CLI
    // table still renders the AC row (and its pipe-bearing reasoning) intact.
    const text = formatAssessmentSummary(pipeHostileResult());
    const acRow = text.split("\n").find((line) => line.startsWith("AC-1"));
    expect(acRow).toBeDefined();
    expect(acRow).toContain("a | b | c");
  });

  it("mcp: pipe characters in judge text are escaped so the Markdown table stays parseable", () => {
    const text = buildAssessSummaryText(pipeHostileResult());
    // reason: escapeCell replaces "|" with "\|" — a raw unescaped "a | b | c" would
    // desync the "| AC | Score | Reasoning |" table's column count.
    expect(text).toContain("a \\| b \\| c");
    expect(text).toContain("x \\| y");
    expect(text).toContain("do \\| this");
  });
});

// ─── STATE (determinism) ─────────────────────────────────────────────────────────

describe("assess render sites — STATE (deterministic, repeated calls match)", () => {
  for (const site of SITES) {
    it(`${site.name}: repeated calls on the same input produce byte-identical output`, () => {
      const result = typedResult();
      expect(site.render(result)).toBe(site.render(result));
    });
  }
});

// ─── REGRESSION (legacy-only parity across all three sites) ─────────────────────

describe("assess render sites — REGRESSION (legacy-only result has no typed-block markers anywhere)", () => {
  const FORBIDDEN_MARKERS = ["Dimension Score", "Typed Gap", "Typed Recommendation", "Rubric Warning", "Unverifiable"];

  for (const site of SITES) {
    it(`${site.name}: a legacy-only AssessmentResult contains none of the SPEC-040 section markers`, () => {
      const text = site.render(legacyResult());
      for (const marker of FORBIDDEN_MARKERS) {
        expect(text).not.toContain(marker);
      }
      // Legacy content is still present and correct.
      expect(text).toContain("met");
      expect(text).toContain("90");
      expect(text).toContain("Minor: no negative-path test.");
      expect(text).toContain("Add a negative-path test.");
    });
  }
});
