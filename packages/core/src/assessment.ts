/**
 * AI plan-outcome assessment — LLM-as-judge result schema, plan bundle shape, JSON
 * extraction from raw AI output, truncation helpers, and deterministic content rendering.
 * Pure, browser-safe module: no IO, no Date.now()/Math.random() calls.
 *
 * Public surface:
 *   - evidenceRefSchema / EvidenceRef — one evidence citation inside an ac_scores entry
 *   - acScoreSchema / AcScore — per-AC judge score + reasoning + evidence
 *   - judgmentSchema / Judgment — judge run metadata (provider, prompt version, retry, truncation)
 *   - scopeSchema — discriminator for what was assessed (v1 always {type: "plan", id})
 *   - llmAssessmentOutputSchema / LlmAssessmentOutput — the shape the AI judge must emit
 *     (verdict/overall_score/ac_scores/gaps/recommendations — no scope, no judgment: those
 *     are filled in by AIProviderService after a successful parse, not by the model)
 *   - assessmentResultSchema / AssessmentResult — full persisted shape (llm output + scope + judgment)
 *   - planBundleSchema / PlanBundle — {plan, spec?, tasks[]} assembled by CorpusService.getPlanBundle
 *   - extractAssessmentJson(raw) — tolerant JSON extraction from raw AI text (fences, prose-wrapped)
 *   - truncateSection(text, maxChars) — single-section truncation primitive
 *   - renderAssessmentContent(result) — deterministic Markdown rendering of a persisted result
 *
 * Invariants:
 *   - No IO, no wall-clock reads, no Math.random() — renderAssessmentContent is deterministic:
 *     the same AssessmentResult always renders to the same string.
 *   - llmAssessmentOutputSchema validates ONLY what the AI judge is asked to produce; scope
 *     and judgment are service-computed and layered on top to build AssessmentResult.
 *   - extractAssessmentJson never throws — parse failures return a VALIDATION_ERROR Result.
 *   - planBundleSchema performs a light structural check (not a full DocRecord re-validation —
 *     DocRecord has no Zod schema elsewhere in this codebase; it is produced by the trusted
 *     store layer). The check exists to catch PlanBundle *assembly* bugs (e.g. wrong doc.type
 *     landing in the wrong slot) at the CorpusService/AIProviderService seam.
 *
 * Side-effect class: pure
 *
 * Source: SPEC-026 §3 D2, D6, D7; §4 AC-ASSESS-1..13; §5; §8.1, §8.2
 */

import { z } from "zod";
import type { DocRecord } from "./types.js";
import type { LoreError } from "./errors.js";
import { err, ok, type Result } from "./errors.js";

// ─── Evidence Ref / AC Score / Judgment / Scope ────────────────────────────

/**
 * One evidence citation attached to an ac_scores entry — points at a task/doc the
 * judge used as grounds for the score.
 *
 * @example
 * evidenceRefSchema.parse({ doc_id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", note: "tsc pass evidence" });
 */
export const evidenceRefSchema = z.object({
  doc_id: z.string().min(1),
  note: z.string().optional(),
});

/** Derived TypeScript type for one evidence citation. */
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;

/**
 * Judge's score for a single acceptance criterion.
 *
 * @invariant reasoning is capped at 300 chars (keeps the persisted doc scannable).
 * @invariant score is an integer 0-100 (rubric anchors — see SPEC-026 §5).
 *
 * @example
 * acScoreSchema.parse({
 *   ac_id: "AC-ASSESS-1", score: 85,
 *   reasoning: "Doc created with correct sub_type and informs link.",
 *   evidence_refs: [{ doc_id: "01ARZ3..." }],
 * });
 */
export const acScoreSchema = z.object({
  ac_id: z.string().min(1),
  score: z.number().int().min(0).max(100),
  reasoning: z.string().max(300),
  evidence_refs: z.array(evidenceRefSchema),
});

/** Derived TypeScript type for one AC score entry. */
export type AcScore = z.infer<typeof acScoreSchema>;

/**
 * Judge run metadata — filled in by AIProviderService.assessPlan, never by the model.
 *
 * @invariant truncated lists section names the judge did NOT see in full (e.g. "plan",
 *   "spec", "task:<slug>", "diff") — see {@link truncateSection}.
 *
 * @example
 * judgmentSchema.parse({
 *   provider: "claude-cli", prompt_version: 1, duration_ms: 4230,
 *   retried: false, truncated: [],
 * });
 */
export const judgmentSchema = z.object({
  provider: z.string().min(1),
  prompt_version: z.number().int().positive(),
  duration_ms: z.number().int().nonnegative(),
  retried: z.boolean(),
  truncated: z.array(z.string()),
});

/** Derived TypeScript type for judge run metadata. */
export type Judgment = z.infer<typeof judgmentSchema>;

/**
 * Discriminates what was assessed. v1 always produces `{type: "plan", id: <plan.id>}` —
 * the discriminator exists so task-level assessments (SPEC-026 §2.2 non-goal) are additive
 * later without a breaking schema reshape.
 */
export const scopeSchema = z.object({
  type: z.enum(["plan", "task"]),
  id: z.string().min(1),
});

// ─── LLM Output Schema (what the judge must produce) ───────────────────────

/**
 * Shape the AI judge's raw JSON response must match. Deliberately excludes `scope` and
 * `judgment` — those fields are computed by AIProviderService.assessPlan after a
 * successful parse (the model has no way to know its own provider name, prompt version,
 * or wall-clock duration). Source: SPEC-026 §5 "Output instruction".
 *
 * @example
 * llmAssessmentOutputSchema.parse({
 *   verdict: "partially_met", overall_score: 62,
 *   ac_scores: [{ ac_id: "AC-ASSESS-1", score: 85, reasoning: "...", evidence_refs: [] }],
 *   gaps: ["No evidence for AC-ASSESS-7 truncation path"],
 *   recommendations: ["Add a budget-boundary test"],
 * });
 */
export const llmAssessmentOutputSchema = z.object({
  verdict: z.enum(["met", "partially_met", "not_met"]),
  overall_score: z.number().int().min(0).max(100),
  ac_scores: z.array(acScoreSchema),
  gaps: z.array(z.string()),
  recommendations: z.array(z.string()),
});

/** Derived TypeScript type for the raw judge output. */
export type LlmAssessmentOutput = z.infer<typeof llmAssessmentOutputSchema>;

// ─── Full Assessment Result (persisted shape) ──────────────────────────────

/**
 * Full persisted assessment shape: the judge's output plus the service-computed
 * `scope` and `judgment` fields. This is what lands in `extra.assessment` on the
 * `knowledge` doc (sub_type="assessment") and what `knowledgeExtraSchema` validates
 * against (schemas.ts superRefine).
 *
 * @example
 * assessmentResultSchema.parse({
 *   scope: { type: "plan", id: "01ARZ3..." },
 *   verdict: "met", overall_score: 88,
 *   ac_scores: [], gaps: [], recommendations: [],
 *   judgment: { provider: "claude-cli", prompt_version: 1, duration_ms: 3000, retried: false, truncated: [] },
 * });
 */
export const assessmentResultSchema = llmAssessmentOutputSchema.extend({
  scope: scopeSchema,
  judgment: judgmentSchema,
});

/** Derived TypeScript type for a full persisted assessment result. */
export type AssessmentResult = z.infer<typeof assessmentResultSchema>;

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
 * PlanBundle — {plan, spec?, tasks[]} assembled by `CorpusService.getPlanBundle`.
 * `spec` is undefined when the plan hangs directly off a PRD (no spec parent).
 *
 * @example
 * planBundleSchema.parse({ plan: planDoc, tasks: [taskDoc1, taskDoc2] }); // no spec
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
 * @param text - Section text (e.g. a plan's content, a task's content, a diff)
 * @param maxChars - Budget from `ai.assess.*` config (SPEC-026 §3 D7)
 * @returns { text, truncated } — text is sliced to maxChars when over budget
 *
 * @example
 * truncateSection("hello world", 5); // → { text: "hello", truncated: true }
 * truncateSection("hi", 5); // → { text: "hi", truncated: false }
 */
export function truncateSection(text: string, maxChars: number): TruncationResult {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}

// ─── Content Rendering ──────────────────────────────────────────────────────

/**
 * Deterministically render a persisted AssessmentResult as human-readable Markdown.
 * No Date.now() / Math.random() — the same result always renders identically, so the
 * `content` field never drifts from `extra.assessment` for reasons outside the data itself.
 *
 * @param result - Full persisted assessment result
 * @returns Markdown string suitable for the knowledge doc's `content` field
 *
 * @example
 * renderAssessmentContent({
 *   scope: { type: "plan", id: "01ARZ3..." }, verdict: "met", overall_score: 90,
 *   ac_scores: [{ ac_id: "AC-1", score: 90, reasoning: "ok", evidence_refs: [] }],
 *   gaps: [], recommendations: [],
 *   judgment: { provider: "claude-cli", prompt_version: 1, duration_ms: 100, retried: false, truncated: [] },
 * });
 * // → "# Assessment: met (90/100)\n\n## AC Scores\n..."
 */
export function renderAssessmentContent(result: AssessmentResult): string {
  const lines: string[] = [];

  lines.push(`# Assessment: ${result.verdict} (${result.overall_score}/100)`);
  lines.push("");
  lines.push(`Scope: ${result.scope.type} \`${result.scope.id}\``);
  lines.push("");

  lines.push("## AC Scores");
  lines.push("");
  if (result.ac_scores.length > 0) {
    lines.push("| AC | Score | Reasoning | Evidence |");
    lines.push("|---|---|---|---|");
    for (const ac of result.ac_scores) {
      const evidence = ac.evidence_refs.map((e) => (e.note ? `${e.doc_id} (${e.note})` : e.doc_id)).join(", ") || "—";
      lines.push(`| ${ac.ac_id} | ${ac.score} | ${ac.reasoning.replace(/\|/g, "\\|")} | ${evidence} |`);
    }
  } else {
    lines.push("(no AC scores)");
  }
  lines.push("");

  lines.push("## Gaps");
  lines.push("");
  lines.push(result.gaps.length > 0 ? result.gaps.map((g) => `- ${g}`).join("\n") : "(none)");
  lines.push("");

  lines.push("## Recommendations");
  lines.push("");
  lines.push(
    result.recommendations.length > 0
      ? result.recommendations.map((r) => `- ${r}`).join("\n")
      : "(none)",
  );
  lines.push("");

  lines.push("## Judgment");
  lines.push("");
  lines.push(`- Provider: ${result.judgment.provider}`);
  lines.push(`- Prompt version: ${result.judgment.prompt_version}`);
  lines.push(`- Duration: ${result.judgment.duration_ms}ms`);
  lines.push(`- Retried: ${result.judgment.retried}`);
  lines.push(
    `- Truncated sections: ${result.judgment.truncated.length > 0 ? result.judgment.truncated.join(", ") : "(none)"}`,
  );

  return lines.join("\n") + "\n";
}
