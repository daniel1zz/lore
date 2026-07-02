/**
 * Tests for @lore/core assessment.ts — extractAssessmentJson, truncateSection,
 * renderAssessmentContent. Pure functions, no IO. Spec-first: assertions come from
 * SPEC-026 §3 D2/D7, §4 AC-ASSESS-4/7, §7 test guidance — not from reading the
 * implementation body first.
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      extractAssessmentJson bare JSON / fenced variants; renderAssessmentContent
 *               produces the documented sections
 *   NEGATIVE:   empty string, no-JSON prose, JSON array (not object) is not rejected by
 *               extraction (shape validation is llmAssessmentOutputSchema's job, not this fn's)
 *   BOUNDARY:   truncateSection exact-boundary (===maxChars not truncated); truncated JSON
 *               (syntactically broken) fails extraction
 *   ERROR:      n/a at this layer (pure functions return Result, never throw — asserted below)
 *   STATE:      n/a (pure, no persisted state)
 *   REGRESSION: renderAssessmentContent is deterministic — two calls on the same input
 *               produce byte-identical output (no Date.now()/Math.random() leakage)
 *
 * @spec_ref AC-ASSESS-4, AC-ASSESS-7
 */

import { describe, it, expect } from "vitest";
import {
  extractAssessmentJson,
  truncateSection,
  renderAssessmentContent,
  type AssessmentResult,
} from "./assessment.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeResult(overrides: Partial<AssessmentResult> = {}): AssessmentResult {
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
    ...overrides,
  };
}

// ─── extractAssessmentJson — HAPPY ────────────────────────────────────────────

describe("extractAssessmentJson — HAPPY (fence variants, AC-ASSESS-4 groundwork)", () => {
  it("bare JSON object parses directly", () => {
    const result = extractAssessmentJson('{"verdict":"met","overall_score":90}');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ verdict: "met", overall_score: 90 });
  });

  it("```json fenced block is extracted and parsed", () => {
    const raw = '```json\n{"verdict":"met","overall_score":90}\n```';
    const result = extractAssessmentJson(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ verdict: "met", overall_score: 90 });
  });

  it("generic ``` fenced block (no language tag) is extracted and parsed", () => {
    const raw = '```\n{"verdict":"not_met","overall_score":10}\n```';
    const result = extractAssessmentJson(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ verdict: "not_met", overall_score: 10 });
  });

  it("prose-wrapped JSON (text before and after) is extracted via first-{ to last-}", () => {
    const raw = 'Here is my assessment:\n{"verdict":"met","overall_score":95}\nHope this helps!';
    const result = extractAssessmentJson(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ verdict: "met", overall_score: 95 });
  });

  it("bare JSON takes precedence over accidental fence-like substrings inside the value", () => {
    // Whole string IS valid JSON (a string value containing backticks) — bare parse
    // must win at step 1 rather than falling through to fence-matching logic.
    const raw = '"contains \`\`\`json inside a string"';
    const result = extractAssessmentJson(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe("contains ```json inside a string");
  });
});

// ─── extractAssessmentJson — NEGATIVE ─────────────────────────────────────────

describe("extractAssessmentJson — NEGATIVE", () => {
  it("empty string → VALIDATION_ERROR (short-circuits before any parse attempt)", () => {
    const result = extractAssessmentJson("");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("whitespace-only string → VALIDATION_ERROR", () => {
    const result = extractAssessmentJson("   \n\t  ");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("prose with no JSON braces at all → VALIDATION_ERROR", () => {
    const result = extractAssessmentJson("I cannot produce a structured assessment right now.");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("error message reports the raw length and includes a raw-output slice (debuggability)", () => {
    const raw = "no json here whatsoever, just prose that goes on and on";
    const result = extractAssessmentJson(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect("message" in result.error ? result.error.message : "").toContain(String(raw.length));
  });

  it("a bare JSON array parses successfully here — shape validation is NOT this function's job", () => {
    // Module doc + core/CLAUDE.md are explicit: extractAssessmentJson only finds JSON,
    // it does not validate shape. An array is syntactically valid JSON.
    const result = extractAssessmentJson('["not", "an", "object"]');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Array.isArray(result.value)).toBe(true);
  });
});

// ─── extractAssessmentJson — BOUNDARY ─────────────────────────────────────────

describe("extractAssessmentJson — BOUNDARY (truncated / malformed JSON, AC-ASSESS-4)", () => {
  it("truncated JSON (mid-object cutoff, unbalanced braces) fails every extraction strategy", () => {
    // Simulates a response cut off mid-stream — no balanced closing brace exists.
    const raw = '{"verdict":"met","overall_score":90,"ac_scores":[{"ac_id":"AC-1"';
    const result = extractAssessmentJson(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("truncated fenced JSON (fence opened but never closed) falls through to prose-wrap, which also fails on unbalanced JSON", () => {
    const raw = '```json\n{"verdict":"met"';
    const result = extractAssessmentJson(raw);
    expect(result.ok).toBe(false);
  });

  it("a fence containing invalid JSON does not falsely succeed by matching a later valid-looking substring", () => {
    const raw = '```json\nnot actually json\n```';
    const result = extractAssessmentJson(raw);
    expect(result.ok).toBe(false);
  });
});

// ─── truncateSection — BOUNDARY (AC-ASSESS-7) ─────────────────────────────────

describe("truncateSection — exact-boundary semantics (AC-ASSESS-7)", () => {
  it("text.length === maxChars is NOT truncated (strict > comparison, not >=)", () => {
    const text = "12345";
    const result = truncateSection(text, 5);
    expect(result.truncated).toBe(false);
    expect(result.text).toBe("12345");
  });

  it("text.length === maxChars - 1 is NOT truncated", () => {
    const result = truncateSection("1234", 5);
    expect(result.truncated).toBe(false);
    expect(result.text).toBe("1234");
  });

  it("text.length === maxChars + 1 IS truncated, sliced to exactly maxChars", () => {
    const result = truncateSection("123456", 5);
    expect(result.truncated).toBe(true);
    expect(result.text).toBe("12345");
    expect(result.text.length).toBe(5);
  });

  it("well over budget: truncated text length still equals maxChars exactly, not hardcoded to input length", () => {
    const longText = "x".repeat(10_000);
    const result = truncateSection(longText, 100);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBe(100);
  });

  it("empty text under any positive budget is never truncated", () => {
    const result = truncateSection("", 10);
    expect(result.truncated).toBe(false);
    expect(result.text).toBe("");
  });
});

// ─── renderAssessmentContent — HAPPY ──────────────────────────────────────────

describe("renderAssessmentContent — HAPPY (content shape)", () => {
  it("includes the verdict and overall_score in the heading", () => {
    const content = renderAssessmentContent(makeResult({ verdict: "met", overall_score: 88 }));
    expect(content).toContain("met (88/100)");
  });

  it("includes every ac_id from ac_scores", () => {
    const result = makeResult({
      ac_scores: [
        { ac_id: "AC-ASSESS-1", score: 90, reasoning: "ok", evidence_refs: [] },
        { ac_id: "AC-ASSESS-2", score: 40, reasoning: "gap", evidence_refs: [] },
      ],
    });
    const content = renderAssessmentContent(result);
    expect(content).toContain("AC-ASSESS-1");
    expect(content).toContain("AC-ASSESS-2");
  });

  it("renders '(no AC scores)' when ac_scores is empty, not an empty table", () => {
    const content = renderAssessmentContent(makeResult({ ac_scores: [] }));
    expect(content).toContain("(no AC scores)");
  });

  it("renders '(none)' for empty gaps and empty recommendations", () => {
    const content = renderAssessmentContent(makeResult({ gaps: [], recommendations: [] }));
    // Gaps, Recommendations, AND judgment.truncated (also [] by default in makeResult)
    // all render "(none)" — three sections, not two.
    const noneCount = (content.match(/\(none\)/g) ?? []).length;
    expect(noneCount).toBe(3);
  });

  it("renders '(none)' for judgment.truncated when empty", () => {
    const content = renderAssessmentContent(
      makeResult({ judgment: { provider: "p", prompt_version: 1, duration_ms: 1, retried: false, truncated: [] } }),
    );
    expect(content).toContain("Truncated sections: (none)");
  });

  it("lists truncated section names when present, joined by comma", () => {
    const content = renderAssessmentContent(
      makeResult({
        judgment: { provider: "p", prompt_version: 1, duration_ms: 1, retried: true, truncated: ["plan", "diff"] },
      }),
    );
    expect(content).toContain("Truncated sections: plan, diff");
    expect(content).toContain("Retried: true");
  });
});

// ─── renderAssessmentContent — REGRESSION (determinism) ──────────────────────

describe("renderAssessmentContent — REGRESSION (determinism, no Date/random leakage)", () => {
  it("two calls on an identical input produce byte-identical output", () => {
    const result = makeResult();
    const first = renderAssessmentContent(result);
    const second = renderAssessmentContent(result);
    expect(first).toBe(second);
  });

  it("two calls separated by real wall-clock time still produce identical output (no Date.now() leakage)", async () => {
    const result = makeResult();
    const first = renderAssessmentContent(result);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = renderAssessmentContent(result);
    expect(first).toBe(second);
  });

  it("output contains no ISO-8601 timestamp substring (would indicate a hidden Date.now() call)", () => {
    const content = renderAssessmentContent(makeResult());
    // ISO-8601 date pattern: YYYY-MM-DDTHH:MM
    expect(content).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });

  it("output differs when the underlying data differs (defeats a hardcoded-string implementation)", () => {
    const a = renderAssessmentContent(makeResult({ verdict: "met", overall_score: 95 }));
    const b = renderAssessmentContent(makeResult({ verdict: "not_met", overall_score: 5 }));
    expect(a).not.toBe(b);
  });
});
