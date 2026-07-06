/**
 * Judge prompt builder for `lore review` — LLM-as-judge structured document review.
 * Owns the prompt text and REVIEW_PROMPT_VERSION, version-keyed from day one so a future
 * A/B prompt spec adds a registry entry instead of restructuring this module (SPEC-034 §2).
 * Mirrors `assess-template.ts`'s role split: the prompt lives in `packages/lore/src/ai/`,
 * NOT `@lore/core` (core stays limited to schemas + pure data helpers).
 *
 * Public surface:
 *   - REVIEW_PROMPT_VERSION — the currently active key into REVIEW_TEMPLATES; bump (add a
 *     new key, don't mutate this one) whenever the prompt text or output contract changes
 *     materially
 *   - ReviewTemplateFn — the shape every registry entry must satisfy
 *   - REVIEW_TEMPLATES — version-keyed registry; exactly one entry today
 *   - buildReviewRetryPrompt(originalPrompt, parseErrorMessage) — one corrective retry prompt
 *
 * Invariants:
 *   - No IO — pure string assembly over an already-fetched ReviewBundle.
 *   - Truncation is applied per-section via @lore/core's truncateSection; every truncated
 *     section's name is collected into the returned `truncated[]` list.
 *   - The Output Instruction explicitly states the decision/blocking_questions invariant
 *     (escalate REQUIRES blocking_questions; every other decision REQUIRES it empty) —
 *     the same invariant llmReviewOutputSchema enforces at parse time, so a judge that
 *     follows the prompt can never produce a response Zod would reject on that axis alone.
 *
 * Side-effect class: pure
 *
 * Source: SPEC-034 §2, §4
 */

import { truncateSection } from "@lore/core";
import type { CheckResult, ReviewBundle } from "@lore/core";

/**
 * Judge prompt schema version — the active key into {@link REVIEW_TEMPLATES}. Persisted
 * verbatim into `judge.prompt_version` on every review judgment (SPEC-034 §2) so calibration
 * queries can filter/aggregate per prompt version without a join.
 */
export const REVIEW_PROMPT_VERSION = "v1";

/** Character budgets for each prompt section, sourced from `config.ai.review.*`. */
export interface ReviewBudgets {
  max_doc_chars: number;
  max_context_chars: number;
}

/** Result of a {@link ReviewTemplateFn} call — the assembled prompt plus truncated section names. */
export interface BuildReviewPromptResult {
  prompt: string;
  truncated: string[];
}

/** Shape every entry in {@link REVIEW_TEMPLATES} must satisfy. */
export type ReviewTemplateFn = (
  bundle: ReviewBundle,
  checks: CheckResult[],
  budgets: ReviewBudgets,
) => BuildReviewPromptResult;

/** Render the deterministic pre-check results as a compact text block for the prompt. */
function renderChecksBlock(checks: CheckResult[]): string {
  if (checks.length === 0) return "(no pre-checks were run)";
  return checks
    .map((c) => `- ${c.check}: ${c.outcome}${c.detail ? ` — ${c.detail}` : ""}`)
    .join("\n");
}

/**
 * Assemble the v1 judge prompt for `lore review`: role → document → parent context →
 * deterministic pre-check results → output instruction. Each material section is
 * truncated to its configured budget; any section that gets cut has its name appended to
 * the returned `truncated[]` list.
 */
function buildReviewPromptV1(
  bundle: ReviewBundle,
  checks: CheckResult[],
  budgets: ReviewBudgets,
): BuildReviewPromptResult {
  const truncated: string[] = [];

  const docSection = truncateSection(bundle.doc.content, budgets.max_doc_chars);
  if (docSection.truncated) truncated.push("doc");

  let contextBlock = "(no parent document — this doc is a root or its parent could not be resolved)";
  if (bundle.parent !== undefined) {
    const contextSection = truncateSection(bundle.parent.content, budgets.max_context_chars);
    if (contextSection.truncated) truncated.push("parent");
    contextBlock =
      `## Parent: ${bundle.parent.title} (${bundle.parent.slug}, type=${bundle.parent.type})\n` +
      contextSection.text;
  }

  const prompt =
    `# Role\n` +
    `You are an independent document reviewer. Judge ONLY from the materials provided below ` +
    `— do not assume anything about the corpus you cannot see here. A set of mechanical ` +
    `pre-checks has ALREADY been run and their results are given to you verbatim; treat them ` +
    `as ground truth, do not attempt to re-derive them yourself.\n\n` +
    `# Document Under Review\n` +
    `## ${bundle.doc.title} (${bundle.doc.slug}, type=${bundle.doc.type}, status=${bundle.doc.status})\n` +
    `${docSection.text}\n\n` +
    `# Parent Context\n` +
    `${contextBlock}\n\n` +
    `# Deterministic Pre-Checks (already run — use as input, do not re-derive)\n` +
    `${renderChecksBlock(checks)}\n\n` +
    `# Output Instruction\n` +
    `Respond with a SINGLE JSON object and nothing else — no prose before or after it, no ` +
    `markdown fence required (but allowed). The object MUST match this shape exactly:\n` +
    `{\n` +
    `  "decision": "approve" | "reject" | "escalate",\n` +
    `  "confidence": <number 0-1>,\n` +
    `  "reasons": [\n` +
    `    { "dimension": "<e.g. completeness, consistency, contract>", "finding": "<what you found>",\n` +
    `      "evidence_ref": "<optional pointer>" }\n` +
    `  ],\n` +
    `  "blocking_questions": ["<string>", ...]\n` +
    `}\n` +
    `RULES:\n` +
    `- decision "escalate" REQUIRES at least one entry in blocking_questions.\n` +
    `- Every OTHER decision REQUIRES blocking_questions to be an EMPTY array.\n` +
    `- Prefer "escalate" over guessing when evidence is genuinely ambiguous or missing —\n` +
    `  a wrong confident answer is worse than an honest escalation.\n` +
    `- If ANY pre-check above has outcome "fail", you should almost always decision="reject"\n` +
    `  or "escalate", not "approve".\n` +
    `- reasons MUST have at least one entry.\n`;

  return { prompt, truncated };
}

/**
 * Version-keyed registry of review judge prompt builders. Exactly one entry today
 * (`REVIEW_PROMPT_VERSION`); a future prompt A/B spec adds a new key here rather than
 * mutating this one, so historical judgments' `judge.prompt_version` stays meaningful.
 */
export const REVIEW_TEMPLATES: Record<string, ReviewTemplateFn> = {
  [REVIEW_PROMPT_VERSION]: buildReviewPromptV1,
};

/**
 * Build the single corrective-retry prompt (SPEC-034 §4, mirrors SPEC-026 §3 D2) — embeds
 * the parse/validation error from the first attempt plus a terse reminder, on top of the
 * original prompt. Used exactly once: if the model's first response fails JSON extraction
 * or schema validation.
 *
 * @param originalPrompt - The prompt sent on the first attempt (from a {@link ReviewTemplateFn})
 * @param parseErrorMessage - Human-readable reason the first response failed to parse/validate
 * @returns The retry prompt to send as the second (and final) attempt
 */
export function buildReviewRetryPrompt(originalPrompt: string, parseErrorMessage: string): string {
  return (
    `${originalPrompt}\n\n` +
    `# Correction Required\n` +
    `Your previous response could not be parsed as the required JSON object: ${parseErrorMessage}\n` +
    `Respond again with ONLY the single JSON object described above — no prose, no explanation, ` +
    `no markdown fence unless it wraps valid JSON.\n`
  );
}
