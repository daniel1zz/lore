/**
 * Tests for @lore/core assessment.ts — extractAssessmentJson, truncateSection, clipTextToBudget. Pure functions, no
 * IO. The legacy plan-outcome assessment schema, facts and renderer were removed (BR-1372): nothing here exercises them.
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      extractAssessmentJson bare JSON / fenced variants; clipTextToBudget clips an overlong string
 *   NEGATIVE:   empty string, no-JSON prose, JSON array (not object) is not rejected by extraction
 *   BOUNDARY:   truncateSection / clipTextToBudget exact-boundary (===maxChars untouched); truncated JSON fails extraction
 *   ERROR:      n/a at this layer (pure functions return Result, never throw — asserted below)
 *   STATE:      n/a (pure, no persisted state)
 *   REGRESSION: clipTextToBudget never splits a UTF-16 surrogate pair
 *
 * @spec_ref AC-ASSESS-4, AC-ASSESS-7
 */

import { describe, it, expect } from "vitest";
import { extractAssessmentJson, truncateSection, clipTextToBudget } from "./assessment.js";


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
});
