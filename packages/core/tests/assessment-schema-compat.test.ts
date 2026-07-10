/**
 * Tests for @lore/core assessment.ts schema/render backward compatibility (SPEC-040 D2, D3).
 * Verifies that a v1-shaped (pre-SPEC-040) persisted AssessmentResult round-trips
 * byte-unchanged through schema validation and rendering, and that a v6-typed output
 * (dimension_scores/typed_gaps/typed_recommendations/unverifiable/rubric_warning/facts/
 * source_versions) both validates and persists derived legacy gaps/recommendations
 * alongside the new fields. Pure functions + schemas, no IO.
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      v6-shaped output with every new field parses; deriveLegacyFindings
 *               projects typed_gaps/typed_recommendations onto gaps/recommendations
 *   NEGATIVE:   dimension_scores rejects a non-object entry's malformed score
 *               (out-of-range int) — Zod still enforces the per-entry shape
 *   BOUNDARY:   empty typed_gaps/typed_recommendations arrays; unknown dimension_scores
 *               keys are tolerated (not rejected) — permissive record per D2
 *   ERROR:      n/a at this layer (pure functions/schemas; safeParse never throws)
 *   STATE:      assessmentResultSchema accepts a legacy result AND a fully-typed result
 *               from the SAME schema instance (no schema variant switching)
 *   REGRESSION: v1-shaped result round-trips through safeParse.parse and
 *               renderAssessmentContent byte-identically to its pre-SPEC-040 output
 *
 * @spec_ref AC-ADF-2
 */

import { describe, it, expect } from "vitest";
import {
  assessmentResultSchema,
  renderAssessmentContent,
  deriveLegacyFindings,
  dimensionScoresSchema,
  typedGapSchema,
  typedRecommendationSchema,
  ASSESSMENT_DIMENSIONS,
  TYPED_FINDING_SEVERITIES,
  RECOMMENDATION_TARGETS,
  type AssessmentResult,
  type TypedGap,
  type TypedRecommendation,
} from "../src/assessment.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** A v1-shaped (pre-SPEC-040) persisted assessment — no dimension_scores, no typed_gaps, no facts. */
function makeLegacyResult(): AssessmentResult {
  return {
    scope: { type: "plan", id: "01ARZ3NDEKTSV4RRFFQ69G5FAV" },
    verdict: "partially_met",
    overall_score: 62,
    ac_scores: [
      {
        ac_id: "AC-ASSESS-1",
        score: 85,
        reasoning: "Doc created with correct sub_type and informs link.",
        evidence_refs: [{ doc_id: "01TASKAAAAAAAAAAAAAAAAAAA0", note: "tsc pass" }],
      },
    ],
    gaps: ["No evidence for AC-ASSESS-7 truncation path"],
    recommendations: ["Add a budget-boundary test"],
    judgment: {
      provider: "claude-cli",
      prompt_version: 1,
      duration_ms: 4230,
      retried: false,
      truncated: [],
    },
  };
}

function makeTypedGap(overrides: Partial<TypedGap> = {}): TypedGap {
  return {
    dimension: "outcome",
    severity: "major",
    statement: "AC-9 has no attested evidence.",
    ...overrides,
  };
}

function makeTypedRecommendation(overrides: Partial<TypedRecommendation> = {}): TypedRecommendation {
  return {
    target: "plan",
    action: "Add a task covering AC-9.",
    rationale: "No existing task references AC-9's ac_ref.",
    ...overrides,
  };
}

/** A v6-shaped result — every SPEC-040 field populated. */
function makeV6Result(): AssessmentResult {
  return {
    ...makeLegacyResult(),
    dimension_scores: {
      outcome: { score: 70, confidence: 0.6, based_on: "evidence", reasoning: "Partial AC coverage observed." },
      evidence_integrity: { score: 90, confidence: 0.8, based_on: "evidence", reasoning: "Mostly attested evidence." },
    },
    unverifiable: [{ material: "AC-9 evidence doc", reason: "doc_id not found in bundle." }],
    rubric_warning: ["Judge flagged ambiguous AC-3 wording."],
    typed_gaps: [makeTypedGap()],
    typed_recommendations: [makeTypedRecommendation()],
    source_versions: [{ doc_id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", version: 3 }],
  };
}

// ─── HAPPY ─────────────────────────────────────────────────────────────────

describe("assessmentResultSchema — HAPPY (v6 typed-finding shape)", () => {
  it("a fully-populated v6 result validates", () => {
    const result = assessmentResultSchema.safeParse(makeV6Result());
    expect(result.success).toBe(true);
  });

  it("deriveLegacyFindings projects typed_gaps[].statement onto gaps and typed_recommendations[].action onto recommendations", () => {
    const derived = deriveLegacyFindings(
      [makeTypedGap({ statement: "Gap A" }), makeTypedGap({ statement: "Gap B" })],
      [makeTypedRecommendation({ action: "Rec A" }), makeTypedRecommendation({ action: "Rec B" })],
    );
    expect(derived.gaps).toEqual(["Gap A", "Gap B"]);
    expect(derived.recommendations).toEqual(["Rec A", "Rec B"]);
  });

  it("a v6 result's persisted legacy gaps/recommendations can carry the derived projection alongside typed fields", () => {
    const typedGaps = [makeTypedGap({ statement: "AC-9 unattested." })];
    const typedRecommendations = [makeTypedRecommendation({ action: "Add AC-9 task." })];
    const derived = deriveLegacyFindings(typedGaps, typedRecommendations);
    const persisted: AssessmentResult = {
      ...makeLegacyResult(),
      gaps: derived.gaps,
      recommendations: derived.recommendations,
      typed_gaps: typedGaps,
      typed_recommendations: typedRecommendations,
    };
    const result = assessmentResultSchema.safeParse(persisted);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.gaps).toEqual(["AC-9 unattested."]);
    expect(result.data.typed_gaps?.[0]?.statement).toBe("AC-9 unattested.");
  });

  it("TYPED_FINDING_SEVERITIES and RECOMMENDATION_TARGETS are the documented closed enums", () => {
    expect(TYPED_FINDING_SEVERITIES).toEqual(["blocker", "major", "minor"]);
    expect(RECOMMENDATION_TARGETS).toEqual(["spec", "plan", "prompt", "skill", "process"]);
  });
});

// ─── NEGATIVE ──────────────────────────────────────────────────────────────

describe("assessmentResultSchema — NEGATIVE (malformed new-field shapes still rejected)", () => {
  it("dimension_scores entry with score out of 0-100 range fails validation", () => {
    const result = dimensionScoresSchema.safeParse({
      outcome: { score: 150, confidence: 0.5, based_on: "evidence", reasoning: "x" },
    });
    expect(result.success).toBe(false);
  });

  it("typed_gaps entry with an unknown severity fails validation", () => {
    const result = typedGapSchema.safeParse({
      dimension: "outcome",
      severity: "catastrophic",
      statement: "x",
    });
    expect(result.success).toBe(false);
  });

  it("typed_recommendations entry with an unknown target fails validation", () => {
    const result = typedRecommendationSchema.safeParse({
      target: "database",
      action: "x",
      rationale: "y",
    });
    expect(result.success).toBe(false);
  });

  it("dimension_scores entry missing required based_on fails validation", () => {
    const result = dimensionScoresSchema.safeParse({
      outcome: { score: 80, confidence: 0.5, reasoning: "x" },
    });
    expect(result.success).toBe(false);
  });
});

// ─── BOUNDARY ──────────────────────────────────────────────────────────────

describe("assessmentResultSchema — BOUNDARY (empty arrays, unknown dimension keys tolerated)", () => {
  it("empty typed_gaps and typed_recommendations arrays validate", () => {
    const result = assessmentResultSchema.safeParse({
      ...makeLegacyResult(),
      typed_gaps: [],
      typed_recommendations: [],
    });
    expect(result.success).toBe(true);
  });

  it("a dimension_scores key OUTSIDE the documented ASSESSMENT_DIMENSIONS closed set still validates (permissive record, D2 tolerant read)", () => {
    expect(ASSESSMENT_DIMENSIONS).not.toContain("future_dimension_added_later");
    const result = dimensionScoresSchema.safeParse({
      future_dimension_added_later: { score: 50, confidence: 0.5, based_on: "absence", reasoning: "n/a" },
    });
    expect(result.success).toBe(true);
  });

  it("a typed_gaps[].dimension value OUTSIDE ASSESSMENT_DIMENSIONS still validates (free string, forward-compat)", () => {
    const result = typedGapSchema.safeParse(makeTypedGap({ dimension: "a_future_dimension" }));
    expect(result.success).toBe(true);
  });

  it("typed_gaps[].ac_ref is optional — omitted entirely still validates", () => {
    const { ac_ref: _acRef, ...gapWithoutAcRef } = { ...makeTypedGap(), ac_ref: "AC-1" };
    void _acRef;
    const result = typedGapSchema.safeParse(gapWithoutAcRef);
    expect(result.success).toBe(true);
  });
});

// ─── STATE ─────────────────────────────────────────────────────────────────

describe("assessmentResultSchema — STATE (one schema instance accepts both legacy and v6 shapes)", () => {
  it("the SAME schema validates a legacy result and a v6 result without any variant switching", () => {
    const legacy = assessmentResultSchema.safeParse(makeLegacyResult());
    const v6 = assessmentResultSchema.safeParse(makeV6Result());
    expect(legacy.success).toBe(true);
    expect(v6.success).toBe(true);
  });

  it("parsing a legacy result yields undefined for every SPEC-040 optional field (no fabricated defaults)", () => {
    const result = assessmentResultSchema.safeParse(makeLegacyResult());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.dimension_scores).toBeUndefined();
    expect(result.data.typed_gaps).toBeUndefined();
    expect(result.data.typed_recommendations).toBeUndefined();
    expect(result.data.unverifiable).toBeUndefined();
    expect(result.data.rubric_warning).toBeUndefined();
    expect(result.data.facts).toBeUndefined();
    expect(result.data.source_versions).toBeUndefined();
  });
});

// ─── REGRESSION ────────────────────────────────────────────────────────────

describe("REGRESSION — v1-shaped assessment round-trips byte-unchanged (AC-ADF-2)", () => {
  it("a v1-shaped result parses successfully through assessmentResultSchema with no data loss", () => {
    const legacy = makeLegacyResult();
    const result = assessmentResultSchema.safeParse(legacy);
    expect(result.success).toBe(true);
    if (!result.success) return;
    // Every original field round-trips exactly — no coercion, no fabricated additions.
    expect(result.data.verdict).toBe(legacy.verdict);
    expect(result.data.overall_score).toBe(legacy.overall_score);
    expect(result.data.gaps).toEqual(legacy.gaps);
    expect(result.data.recommendations).toEqual(legacy.recommendations);
    expect(result.data.ac_scores).toEqual(legacy.ac_scores);
    expect(result.data.judgment).toEqual(legacy.judgment);
    expect(result.data.scope).toEqual(legacy.scope);
  });

  it("renderAssessmentContent on a v1-shaped result produces the exact pre-SPEC-040 markdown — no new sections leak in", () => {
    const legacy = makeLegacyResult();
    const content = renderAssessmentContent(legacy);

    // None of the new SPEC-040 section headings appear for a legacy-only result.
    expect(content).not.toContain("## Dimension Scores");
    expect(content).not.toContain("## Typed Gaps");
    expect(content).not.toContain("## Typed Recommendations");
    expect(content).not.toContain("## Unverifiable Materials");
    expect(content).not.toContain("## Rubric Warnings");
    expect(content).not.toContain("## Facts Summary");

    // The document still ends with the pre-existing Judgment section's last line
    // (no trailing blank section, no stray "(none)" placeholder from an inert branch).
    expect(content.trimEnd().endsWith("Truncated sections: (none)")).toBe(true);
  });

  it("renderAssessmentContent output is byte-identical across two calls on the same legacy result", () => {
    const legacy = makeLegacyResult();
    expect(renderAssessmentContent(legacy)).toBe(renderAssessmentContent(legacy));
  });

  it("adding a v6 field (e.g. rubric_warning) to an otherwise-legacy result renders ONLY the new section, leaving prior sections untouched", () => {
    const legacy = makeLegacyResult();
    const withWarning: AssessmentResult = { ...legacy, rubric_warning: ["Ambiguous rubric anchor for AC-2."] };
    const legacyContent = renderAssessmentContent(legacy);
    const warningContent = renderAssessmentContent(withWarning);

    // Prior content (everything before the Judgment section's last bullet) is unchanged.
    const legacyPrefix = legacyContent.trimEnd();
    expect(warningContent.startsWith(legacyPrefix)).toBe(true);
    expect(warningContent).toContain("## Rubric Warnings");
    expect(warningContent).toContain("Ambiguous rubric anchor for AC-2.");
  });
});
