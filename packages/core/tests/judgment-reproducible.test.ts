/**
 * Tests for `judgmentSchema.reproducible` (task-assess-templates-5-binds-the-projected-
 * renderer-while-two, per `adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the`
 * Q2). `prompt_version` is persisted into every assessment's provenance, but slot 5 of
 * `ASSESS_TEMPLATES` (`packages/lore/src/ai/assess-template.ts`) is slot-stable, NOT
 * output-frozen — a reader who sees `prompt_version: 5` cannot assume the rendering is
 * reproducible. `reproducible` makes that gap a first-class, machine-readable field instead
 * of a fact buried in a comment three files away from where `prompt_version` is persisted.
 *
 * This is a GENUINE three-state field: `true` / `false` / absent-means-"not recorded".
 * Absence must NEVER be treated as `true` anywhere in code (that is exactly the ADR's
 * Question-2 failure — a silent proxy gap that reads as "fine" when it is actually
 * "unknown").
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      judgmentSchema accepts an explicit reproducible: true and reproducible: false
 *   NEGATIVE:   a non-boolean reproducible value is rejected by Zod (fails loud, not coerced)
 *   BOUNDARY:   reproducible ABSENT parses successfully — additive-only, back-compat with
 *               every assessment persisted before this field existed
 *   ERROR:      n/a at this layer — safeParse never throws (pure schema module)
 *   STATE:      the three states (true/false/absent) are mutually exclusive and never
 *               collapse into each other — absent is NOT treated as true, and safeParse
 *               never fabricates a default
 *   REGRESSION: a pre-existing (v1-shaped) persisted AssessmentResult with no `reproducible`
 *               field round-trips through safeParse.parse unchanged, and its rendering via
 *               `renderAssessmentContent` stays byte-identical to the pre-this-field shape
 *               (mirrors assessment-schema-compat.test.ts's own REGRESSION contract)
 */

import { describe, it, expect } from "vitest";
import { assessmentResultSchema, judgmentSchema, renderAssessmentContent, type AssessmentResult } from "../src/assessment.js";

/** A v1-shaped (pre-this-field) persisted assessment — no `reproducible` in its judgment. */
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
        evidence_refs: [],
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

// ─── HAPPY ──────────────────────────────────────────────────────────────────────

describe("judgmentSchema.reproducible — HAPPY", () => {
  it("accepts an explicit reproducible: true", () => {
    const result = judgmentSchema.safeParse({
      provider: "claude-cli",
      prompt_version: 7,
      duration_ms: 100,
      retried: false,
      truncated: [],
      reproducible: true,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.reproducible).toBe(true);
  });

  it("accepts an explicit reproducible: false (mirrors slot 5's registry declaration)", () => {
    const result = judgmentSchema.safeParse({
      provider: "claude-cli",
      prompt_version: 5,
      duration_ms: 100,
      retried: false,
      truncated: [],
      reproducible: false,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.reproducible).toBe(false);
  });
});

// ─── NEGATIVE ───────────────────────────────────────────────────────────────────

describe("judgmentSchema.reproducible — NEGATIVE", () => {
  it("rejects a non-boolean value (string) rather than silently coercing it", () => {
    const result = judgmentSchema.safeParse({
      provider: "claude-cli",
      prompt_version: 5,
      duration_ms: 100,
      retried: false,
      truncated: [],
      reproducible: "false" as unknown,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-boolean value (number) rather than silently coercing it", () => {
    const result = judgmentSchema.safeParse({
      provider: "claude-cli",
      prompt_version: 5,
      duration_ms: 100,
      retried: false,
      truncated: [],
      reproducible: 0 as unknown,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an explicit null (distinct from omitting the key entirely)", () => {
    const result = judgmentSchema.safeParse({
      provider: "claude-cli",
      prompt_version: 5,
      duration_ms: 100,
      retried: false,
      truncated: [],
      reproducible: null as unknown,
    });
    expect(result.success).toBe(false);
  });
});

// ─── BOUNDARY ───────────────────────────────────────────────────────────────────

describe("judgmentSchema.reproducible — BOUNDARY (additive-only, back-compat)", () => {
  it("parses successfully when reproducible is entirely absent (pre-existing assessment shape)", () => {
    const result = judgmentSchema.safeParse({
      provider: "claude-cli",
      prompt_version: 5,
      duration_ms: 100,
      retried: false,
      truncated: [],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.reproducible).toBeUndefined();
  });
});

// ─── STATE ──────────────────────────────────────────────────────────────────────

describe("judgmentSchema.reproducible — STATE (three genuinely distinct states, never collapsed)", () => {
  it("absent does NOT parse to true — safeParse never fabricates a default value for an omitted optional field", () => {
    const result = judgmentSchema.safeParse({
      provider: "claude-cli",
      prompt_version: 5,
      duration_ms: 100,
      retried: false,
      truncated: [],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    // reason: the ADR's Question-2 failure mode is EXACTLY "absence coerced/read as true" —
    // this assertion is the direct negative-space pin for it. `"reproducible" in data` would
    // also be false here, but the strict !== true / !== false / === undefined triad below is
    // the one that matters to every downstream consumer (render sites, future stampers).
    expect(result.data.reproducible).not.toBe(true);
    expect(result.data.reproducible).not.toBe(false);
    expect(result.data.reproducible).toBeUndefined();
  });

  it("true, false, and absent are three DIFFERENT parsed values, not two", () => {
    const parseWith = (reproducible?: boolean) =>
      judgmentSchema.parse({
        provider: "claude-cli",
        prompt_version: 5,
        duration_ms: 100,
        retried: false,
        truncated: [],
        ...(reproducible === undefined ? {} : { reproducible }),
      });

    const asTrue = parseWith(true);
    const asFalse = parseWith(false);
    const asAbsent = parseWith();

    expect(asTrue.reproducible).toBe(true);
    expect(asFalse.reproducible).toBe(false);
    expect(asAbsent.reproducible).toBeUndefined();
    // Pairwise distinctness — none of the three collapse into each other.
    expect(asTrue.reproducible).not.toBe(asFalse.reproducible);
    expect(asTrue.reproducible).not.toBe(asAbsent.reproducible);
    expect(asFalse.reproducible).not.toBe(asAbsent.reproducible);
  });
});

// ─── REGRESSION ─────────────────────────────────────────────────────────────────

describe("judgmentSchema.reproducible — REGRESSION (pre-existing assessments unaffected)", () => {
  it("a v1-shaped persisted AssessmentResult (no reproducible field) still validates via assessmentResultSchema", () => {
    const legacy = makeLegacyResult();
    const result = assessmentResultSchema.safeParse(legacy);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.judgment.reproducible).toBeUndefined();
  });

  it("renderAssessmentContent on a legacy result renders NO 'Reproducible' line and its Judgment section still ends with 'Truncated sections: (none)' — byte-identity preserved", () => {
    const legacy = makeLegacyResult();
    const content = renderAssessmentContent(legacy);
    expect(content).not.toContain("Reproducible:");
    expect(content.trimEnd().endsWith("Truncated sections: (none)")).toBe(true);
  });

  it("renderAssessmentContent output is byte-identical across two calls on the same legacy result (determinism preserved after the field addition)", () => {
    const legacy = makeLegacyResult();
    expect(renderAssessmentContent(legacy)).toBe(renderAssessmentContent(legacy));
  });
});
