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
  clipTextToBudget,
  clipOverlongReasoning,
  DEFAULT_REASONING_CLIP_CHARS,
  judgmentSchema,
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

// ─── clipTextToBudget (SPEC-029 AC-AR-2, AC-AR-6) ─────────────────────────────
//
// Spec-first expectations (SPEC-029 AC-AR-2, AC-AR-6), written BEFORE re-reading the
// clipTextToBudget implementation body in detail:
//   - a string over budget is cut down to fit, with a trailing ellipsis marker
//   - a string at-or-under budget is untouched (boundary mirrors truncateSection's `>`)
//   - the result must NEVER split a UTF-16 surrogate pair, regardless of where the naive
//     cut point would otherwise land

describe("clipTextToBudget — HAPPY (normal overlong clip)", () => {
  it("a string well over budget is clipped to <= maxChars with a trailing ellipsis", () => {
    const text = "a".repeat(305);
    const result = clipTextToBudget(text, 300);
    expect(result.length).toBeLessThanOrEqual(300);
    expect(result.endsWith("…")).toBe(true);
  });

  it("a short string under budget is returned unchanged (same content, not just same length)", () => {
    const text = "short reasoning, well under budget";
    const result = clipTextToBudget(text, 300);
    expect(result).toBe(text);
  });
});

describe("clipTextToBudget — BOUNDARY (exact-boundary semantics, AC-AR-6)", () => {
  it("text.length === maxChars is NOT clipped (strict > comparison, matches truncateSection)", () => {
    const text = "x".repeat(300);
    const result = clipTextToBudget(text, 300);
    expect(result).toBe(text);
    expect(result.endsWith("…")).toBe(false);
  });

  it("text.length === maxChars + 1 IS clipped", () => {
    const text = "x".repeat(301);
    const result = clipTextToBudget(text, 300);
    expect(result).not.toBe(text);
    expect(result.length).toBeLessThanOrEqual(300);
  });

  it("referential transparency: an under-budget string returns the SAME reference, not a copy", () => {
    const text = "under budget";
    const result = clipTextToBudget(text, 300);
    expect(result === text).toBe(true);
  });
});

describe("clipTextToBudget — REGRESSION (surrogate-pair safety, AC-AR-6)", () => {
  it("never splits a UTF-16 surrogate pair even when the naive cut point lands mid-pair", () => {
    // Each "😀" is a 2-code-unit surrogate pair starting at an even index (0, 2, 4, ...).
    // maxChars=300 → cut = maxChars - 1 = 299 (odd) → charCodeAt(298) is the START (high
    // surrogate) of the pair at index 149 — the naive cut WOULD split that pair in half
    // without the backoff guard. This is not a vacuous case: it specifically targets the
    // documented guard condition.
    const emoji = "😀"; // 2 UTF-16 code units
    const text = emoji.repeat(200); // 400 code units, well over the 300 budget
    const result = clipTextToBudget(text, 300);

    expect(result.length).toBeLessThanOrEqual(300);

    const loneHighSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/;
    const loneLowSurrogate = /(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/;
    expect(loneHighSurrogate.test(result)).toBe(false);
    expect(loneLowSurrogate.test(result)).toBe(false);

    // Array.from iterates by code point — a lone surrogate would still produce a
    // single-element string of length 1 with code unit in the surrogate range; every
    // element here must be a full, valid emoji or the trailing "…" marker.
    for (const ch of Array.from(result)) {
      expect(ch === "😀" || ch === "…").toBe(true);
    }
  });

  it("DEFAULT_REASONING_CLIP_CHARS is 300 (mirrors acScoreSchema's .max(300))", () => {
    expect(DEFAULT_REASONING_CLIP_CHARS).toBe(300);
  });
});

// ─── clipOverlongReasoning (SPEC-029 AC-AR-2, AC-AR-3, AC-AR-6) ───────────────

describe("clipOverlongReasoning — HAPPY", () => {
  it("clips a single overlong ac_scores[].reasoning and records its ac_id", () => {
    const input = {
      ac_scores: [{ ac_id: "AC-1", reasoning: "x".repeat(400), score: 90, evidence_refs: [] }],
    };
    const { value, clippedAcIds } = clipOverlongReasoning(input);
    expect(clippedAcIds).toEqual(["AC-1"]);
    const output = value as typeof input;
    expect(output.ac_scores[0]!.reasoning.length).toBeLessThanOrEqual(300);
    expect(output.ac_scores[0]!.reasoning.endsWith("…")).toBe(true);
  });
});

describe("clipOverlongReasoning — NEGATIVE (malformed/unexpected shapes never throw)", () => {
  it("value that isn't an object passes through unchanged, clippedAcIds empty", () => {
    const input = "just a string";
    const { value, clippedAcIds } = clipOverlongReasoning(input);
    expect(value).toBe(input);
    expect(clippedAcIds).toEqual([]);
  });

  it("value is null → passes through unchanged, never throws", () => {
    expect(() => clipOverlongReasoning(null)).not.toThrow();
    const { value, clippedAcIds } = clipOverlongReasoning(null);
    expect(value).toBe(null);
    expect(clippedAcIds).toEqual([]);
  });

  it("value is an array (not a plain object) → passes through unchanged", () => {
    const input = ["not", "an", "object"];
    const { value, clippedAcIds } = clipOverlongReasoning(input);
    expect(value).toBe(input);
    expect(clippedAcIds).toEqual([]);
  });

  it("object with no ac_scores field at all → passes through unchanged", () => {
    const input = { verdict: "met", overall_score: 90 };
    const { value, clippedAcIds } = clipOverlongReasoning(input);
    expect(value).toBe(input);
    expect(clippedAcIds).toEqual([]);
  });

  it("ac_scores present but not an array (a string) → passes through unchanged, never throws", () => {
    const input = { ac_scores: "not an array" };
    expect(() => clipOverlongReasoning(input)).not.toThrow();
    const { value, clippedAcIds } = clipOverlongReasoning(input);
    expect(value).toBe(input);
    expect(clippedAcIds).toEqual([]);
  });

  it("ac_scores is an array of primitives (null, undefined, number) → never throws, none clipped", () => {
    const input = { ac_scores: [null, undefined, 42] };
    expect(() => clipOverlongReasoning(input)).not.toThrow();
    const { clippedAcIds } = clipOverlongReasoning(input);
    expect(clippedAcIds).toEqual([]);
  });

  it("an ac_scores entry that isn't an object (a string) is left untouched, no crash", () => {
    const input = { ac_scores: ["not an object", { ac_id: "AC-1", reasoning: "short" }] };
    expect(() => clipOverlongReasoning(input)).not.toThrow();
    const { clippedAcIds } = clipOverlongReasoning(input);
    expect(clippedAcIds).toEqual([]);
  });

  it("an ac_scores entry whose reasoning is not a string (e.g. a number) is left untouched", () => {
    const input = { ac_scores: [{ ac_id: "AC-1", reasoning: 12345 }] };
    const { value, clippedAcIds } = clipOverlongReasoning(input);
    expect(clippedAcIds).toEqual([]);
    expect(value).toBe(input);
  });

  it("an ac_scores entry missing ac_id but with overlong reasoning records '(unknown)' as the id", () => {
    const input = { ac_scores: [{ reasoning: "x".repeat(400) }] };
    const { clippedAcIds } = clipOverlongReasoning(input);
    expect(clippedAcIds).toEqual(["(unknown)"]);
  });
});

describe("clipOverlongReasoning — BOUNDARY (exact 300/301 chars, AC-AR-6)", () => {
  it("a reasoning of EXACTLY 300 chars is NOT clipped, clippedAcIds empty, string identical", () => {
    const reasoning = "y".repeat(300);
    const input = { ac_scores: [{ ac_id: "AC-1", reasoning }] };
    const { value, clippedAcIds } = clipOverlongReasoning(input);
    expect(clippedAcIds).toEqual([]);
    expect(value).toBe(input); // referential transparency: nothing clipped → same reference
    const output = value as typeof input;
    expect(output.ac_scores[0]!.reasoning).toBe(reasoning);
  });

  it("a reasoning of 301 chars IS clipped", () => {
    const reasoning = "y".repeat(301);
    const input = { ac_scores: [{ ac_id: "AC-1", reasoning }] };
    const { value, clippedAcIds } = clipOverlongReasoning(input);
    expect(clippedAcIds).toEqual(["AC-1"]);
    const output = value as typeof input;
    expect(output.ac_scores[0]!.reasoning.length).toBeLessThanOrEqual(300);
    expect(output.ac_scores[0]!.reasoning).not.toBe(reasoning);
  });

  it("referential transparency: when nothing is clipped, result.value === input (same reference)", () => {
    const input = {
      ac_scores: [
        { ac_id: "AC-1", reasoning: "short" },
        { ac_id: "AC-2", reasoning: "also short" },
      ],
    };
    const { value } = clipOverlongReasoning(input);
    expect(value === input).toBe(true);
  });
});

describe("clipOverlongReasoning — STATE (multi-AC partial clipping)", () => {
  it("only overlong entries are clipped; untouched entries are byte-identical to the input, in encounter order", () => {
    const shortReasoning = "entry 1 is fine, short reasoning here.";
    const input = {
      ac_scores: [
        { ac_id: "AC-1", reasoning: "z".repeat(350) },
        { ac_id: "AC-2", reasoning: shortReasoning },
        { ac_id: "AC-3", reasoning: "w".repeat(400) },
      ],
    };
    const { value, clippedAcIds } = clipOverlongReasoning(input);
    expect(clippedAcIds).toEqual(["AC-1", "AC-3"]);

    const output = value as typeof input;
    expect(output.ac_scores[0]!.reasoning.length).toBeLessThanOrEqual(300);
    expect(output.ac_scores[2]!.reasoning.length).toBeLessThanOrEqual(300);
    // Entry 1 (index 1, AC-2) must be untouched — same string, same reference even.
    expect(output.ac_scores[1]!.reasoning).toBe(shortReasoning);
    expect(output.ac_scores[1]).toBe(input.ac_scores[1]);
  });

  it("does not mutate the original input object or its ac_scores array in place", () => {
    const original300 = "z".repeat(350);
    const input = { ac_scores: [{ ac_id: "AC-1", reasoning: original300 }] };
    const inputAcScoresRef = input.ac_scores;

    const { value } = clipOverlongReasoning(input);

    // Input itself must be untouched — original reasoning string still overlong.
    expect(input.ac_scores[0]!.reasoning).toBe(original300);
    expect(input.ac_scores).toBe(inputAcScoresRef);
    // The returned value must be a DIFFERENT object (shallow clone), not the same reference.
    expect(value).not.toBe(input);
  });
});

// ─── judgmentSchema — REGRESSION (additive-only reasoning_clipped, AC-AR-3) ───

describe("judgmentSchema — REGRESSION (pre-SPEC-029 backward compatibility)", () => {
  it("a judgment object with NO reasoning_clipped key still validates (pre-existing persisted docs)", () => {
    const legacyJudgment = {
      provider: "claude-cli",
      prompt_version: 1,
      duration_ms: 4230,
      retried: false,
      truncated: [],
    };
    const result = judgmentSchema.safeParse(legacyJudgment);
    expect(result.success).toBe(true);
  });

  it("a judgment object WITH reasoning_clipped also validates (new shape)", () => {
    const newJudgment = {
      provider: "claude-cli",
      prompt_version: 2,
      duration_ms: 4230,
      retried: false,
      truncated: [],
      reasoning_clipped: ["AC-1", "AC-2"],
    };
    const result = judgmentSchema.safeParse(newJudgment);
    expect(result.success).toBe(true);
  });
});

// ─── renderAssessmentContent — reasoning_clipped line (SPEC-029 AC-AR-3) ──────

describe("renderAssessmentContent — reasoning_clipped rendering (SPEC-029 AC-AR-3)", () => {
  it("renders a 'Reasoning clipped for:' line when judgment.reasoning_clipped is present and non-empty", () => {
    const content = renderAssessmentContent(
      makeResult({
        judgment: {
          provider: "p",
          prompt_version: 2,
          duration_ms: 1,
          retried: false,
          truncated: [],
          reasoning_clipped: ["AC-1", "AC-2"],
        },
      }),
    );
    expect(content).toContain("Reasoning clipped for: AC-1, AC-2");
  });

  it("omits the reasoning_clipped line entirely when the field is absent (pre-SPEC-029 assessment)", () => {
    const resultWithoutField = makeResult({
      judgment: { provider: "p", prompt_version: 1, duration_ms: 1, retried: false, truncated: [] },
    });
    const content = renderAssessmentContent(resultWithoutField);
    expect(content).not.toContain("Reasoning clipped");
  });

  it("the Judgment section has exactly 5 bullet lines for legacy data — no 6th 'Reasoning clipped' line sneaking in", () => {
    // Proves the new rendering code path is fully inert for legacy data — no stray
    // "(none)" placeholder, no blank extra line, nothing. Isolate the "## Judgment"
    // section specifically (gaps/recommendations in the default fixture also render
    // "- " bullet lines, so a whole-document count would be misleading).
    const judgmentNoField = { provider: "p", prompt_version: 1, duration_ms: 1, retried: false, truncated: [] };
    const content = renderAssessmentContent(makeResult({ judgment: judgmentNoField }));
    const judgmentSection = content.slice(content.indexOf("## Judgment"));
    const bulletLines = judgmentSection.split("\n").filter((l) => l.startsWith("- "));
    expect(bulletLines).toHaveLength(5);
  });
});
