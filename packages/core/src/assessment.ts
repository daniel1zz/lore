/**
 * Shared plan-bundle shape and judge-output text helpers used by the milestone review, the review judge and the
 * staleness probe. Pure, browser-safe module: no IO, no wall-clock reads, no randomness.
 *
 * Public surface:
 *   - planBundleSchema / PlanBundle — {plan, spec?, tasks[], knowledge_links?} assembled by
 *     `CorpusService.getPlanBundle`
 *   - extractAssessmentJson(raw) — tolerant JSON extraction from raw AI text (fences, prose-wrapped)
 *   - truncateSection(text, maxChars) / TruncationResult — single-section truncation primitive
 *   - clipTextToBudget(text, maxChars) — single-string, surrogate-pair-safe character clip
 *
 * Invariants:
 *   - The legacy plan-outcome assessment (its result schema, facts, scope-mismatch warning, rendering) was removed:
 *     existing `knowledge/assessment` docs are archived, read as plain documents, and nothing here parses their
 *     `extra.assessment` payload (BR-1372, spec-lean-governance-batch-verbs-judgment-only-at-milestones Part D).
 *   - planBundleSchema performs a light structural check (not a full DocRecord re-validation): it catches PlanBundle
 *     *assembly* bugs (e.g. wrong doc.type landing in the wrong slot) at the CorpusService seam.
 *   - extractAssessmentJson never throws — parse failures return a VALIDATION_ERROR Result.
 *
 * Side-effect class: pure
 */

import { z } from "zod";
import type { DocRecord } from "./types.js";
import type { LoreError } from "./errors.js";
import { err, ok, type Result } from "./errors.js";
import { headChars } from "./truncate.js";


// ─── Plan Bundle ────────────────────────────────────────────────────────────

/**
 * Minimal structural predicate for a DocRecord-shaped value, scoped to `expectedType`.
 * Not a full DocRecord validator (see module invariants) — just enough to catch
 * PlanBundle assembly bugs (wrong doc landing in the wrong slot).
 */
function isDocRecordOfType(value: unknown, expectedType: DocRecord["type"]): value is DocRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "type" in value &&
    "title" in value &&
    "content" in value &&
    (value as { type: unknown }).type === expectedType
  );
}

/**
 * PlanBundle — {plan, spec?, tasks[], knowledge_links?} assembled by
 * `CorpusService.getPlanBundle`. `spec` is undefined when the plan hangs directly off a
 * PRD (no spec parent). `knowledge_links` is OPTIONAL — populated by SPEC-040 T2's
 * extension of `getPlanBundle`; a bundle assembled by older callers omits it.
 *
 * @example
 * planBundleSchema.parse({ plan: planDoc, tasks: [taskDoc1, taskDoc2] }); // no spec
 *
 * @example
 * planBundleSchema.parse({
 *   plan: planDoc, tasks: [],
 *   knowledge_links: [{ slug: "knowledge-retro-1", sub_type: "retro", title: "Retro: plan X" }],
 * });
 */
export const planBundleSchema = z.object({
  plan: z.custom<DocRecord>((v) => isDocRecordOfType(v, "plan"), {
    message: "plan must be a DocRecord with type 'plan'",
  }),
  spec: z
    .custom<DocRecord>((v) => isDocRecordOfType(v, "spec"), {
      message: "spec must be a DocRecord with type 'spec'",
    })
    .optional(),
  tasks: z.array(
    z.custom<DocRecord>((v) => isDocRecordOfType(v, "task"), {
      message: "each task must be a DocRecord with type 'task'",
    }),
  ),
  knowledge_links: z
    .array(
      z.object({
        slug: z.string().min(1),
        sub_type: z.string().min(1),
        title: z.string().min(1),
      }),
    )
    .optional(),
});

/** Derived TypeScript type for a plan bundle. */
export type PlanBundle = z.infer<typeof planBundleSchema>;

// ─── JSON Extraction ────────────────────────────────────────────────────────

/** Attempt JSON.parse; returns undefined (not throw) on failure. */
function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Extract a JSON value from raw AI judge output, tolerating common LLM formatting jitter.
 * Tries, in order:
 *   1. Bare JSON — the whole trimmed string parses directly.
 *   2. ```json ... ``` fenced block.
 *   3. Generic ``` ... ``` fenced block (no language tag).
 *   4. Prose-wrapped — first `{` to the last `}` in the string.
 *
 * Does NOT validate the parsed value's shape (that is llmAssessmentOutputSchema's job) —
 * a bare JSON array, for instance, parses successfully here and fails downstream schema
 * validation, keeping "can we find JSON" separate from "is the JSON the right shape".
 *
 * @param raw - Raw text content from the AI provider
 * @returns Result<unknown, LoreError> — VALIDATION_ERROR when no JSON can be found
 *
 * @example
 * extractAssessmentJson('{"verdict":"met"}'); // → ok({verdict: "met"})
 * extractAssessmentJson('```json\n{"verdict":"met"}\n```'); // → ok({verdict: "met"})
 * extractAssessmentJson('Here is my assessment:\n{"verdict":"met"}\nHope this helps!');
 * // → ok({verdict: "met"})
 * extractAssessmentJson('no json here'); // → err({ code: "VALIDATION_ERROR", ... })
 */
export function extractAssessmentJson(raw: string): Result<unknown, LoreError> {
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return err({
      code: "VALIDATION_ERROR",
      field: "assessment_json",
      message: "AI judge response was empty; no JSON found.",
    });
  }

  // 1. Bare JSON
  const bare = tryParseJson(trimmed);
  if (bare !== undefined) return ok(bare);

  // 2. ```json ... ``` fence
  const jsonFenceMatch = trimmed.match(/```json\s*([\s\S]*?)```/i);
  if (jsonFenceMatch?.[1] !== undefined) {
    const fenced = tryParseJson(jsonFenceMatch[1].trim());
    if (fenced !== undefined) return ok(fenced);
  }

  // 3. Generic ``` ... ``` fence
  const genericFenceMatch = trimmed.match(/```\s*([\s\S]*?)```/);
  if (genericFenceMatch?.[1] !== undefined) {
    const fenced = tryParseJson(genericFenceMatch[1].trim());
    if (fenced !== undefined) return ok(fenced);
  }

  // 4. Prose-wrapped — first '{' through the matching last '}'
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = trimmed.slice(firstBrace, lastBrace + 1);
    const parsed = tryParseJson(candidate);
    if (parsed !== undefined) return ok(parsed);
  }

  return err({
    code: "VALIDATION_ERROR",
    field: "assessment_json",
    message: `No valid JSON object found in AI judge response (${raw.length} chars).`,
    value: raw.slice(0, 500),
  });
}

// ─── Truncation ─────────────────────────────────────────────────────────────

/** Result of {@link truncateSection} — the (possibly shortened) text plus whether it was cut. */
export interface TruncationResult {
  text: string;
  truncated: boolean;
}

/**
 * Truncate a single prompt section to a character budget.
 * Boundary semantics: text.length === maxChars is NOT truncated (strict `>` comparison).
 *
 * Uses `headChars` (BUG-001 fix, `./truncate.js`) rather than a bare `text.slice(0,
 * maxChars)` — the naive slice can land mid-surrogate-pair on astral-plane input (e.g.
 * emoji in a plan/task body or diff), producing a lone unpaired surrogate that
 * `bun:sqlite` silently accepts on write but does not round-trip on read.
 *
 * @param text - Section text (e.g. a plan's content, a task's content, a diff)
 * @param maxChars - Budget from `ai.assess.*` config (SPEC-026 §3 D7)
 * @returns { text, truncated } — text is clipped to at most maxChars when over budget
 *
 * @example
 * truncateSection("hello world", 5); // → { text: "hello", truncated: true }
 * truncateSection("hi", 5); // → { text: "hi", truncated: false }
 */
export function truncateSection(text: string, maxChars: number): TruncationResult {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: headChars(text, maxChars), truncated: true };
}

// ─── Reasoning-Length Resilience (SPEC-029) ────────────────────────────────

/** Marker appended to a clipped `reasoning` string — signals partial content, not a typo. */
const REASONING_CLIP_MARKER = "…";


/**
 * Clip a single string to at most `maxChars` UTF-16 code units, appending a trailing
 * ellipsis marker when clipped. Boundary semantics mirror {@link truncateSection}:
 * `text.length <= maxChars` is a no-op (strict `>` comparison) — a string exactly at the
 * budget is never touched.
 *
 * @invariant Never splits a UTF-16 surrogate pair. If the naive cut point falls right
 *   after a high surrogate (i.e. would emit a lone unpaired high surrogate as the last
 *   code unit before the marker), the cut backs off by one unit so the returned string
 *   only ever contains complete code points.
 *
 * @param text - Candidate string (e.g. one ac_scores[].reasoning entry)
 * @param maxChars - Character budget (default 300, matches acScoreSchema's cap)
 * @returns The original string unchanged, or a clipped string ending in "…" whose
 *   `.length` is `<= maxChars`
 *
 * @example
 * clipTextToBudget("a".repeat(305), 300).length; // → 300
 * clipTextToBudget("short reasoning", 300); // → "short reasoning" (unchanged, under budget)
 */
export function clipTextToBudget(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;

  let cut = maxChars - REASONING_CLIP_MARKER.length;
  if (cut < 0) cut = 0;

  // reason: avoid emitting a lone high surrogate as the char immediately before the
  // ellipsis marker — if the naive cut point lands right after one, back off by one code
  // unit so `text.slice(0, cut)` never ends mid-surrogate-pair (SPEC-029 AC-AR-6).
  const precedingCodeUnit = cut > 0 ? text.charCodeAt(cut - 1) : 0;
  const cutsMidSurrogatePair = precedingCodeUnit >= 0xd800 && precedingCodeUnit <= 0xdbff;
  if (cutsMidSurrogatePair) cut -= 1;

  return text.slice(0, cut) + REASONING_CLIP_MARKER;
}
