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
 *   - **Truncation notice (SPEC-040 D8)** — when the document BODY itself (not the parent
 *     context) is truncated for budget, the prompt gains a "# Truncation Notice" section
 *     instructing the judge to treat the full document as present-but-unseen beyond what's
 *     shown, and to cite the notice explicitly if it escalates on "unseen" grounds rather
 *     than silently inferring absence. `BuildReviewPromptResult.docTruncated` carries this
 *     boolean out to `AIProviderService.judgeDoc`, which stamps it onto the persisted
 *     judgment's `truncated` field — a STRUCTURAL signal (this field), not a string-match
 *     against `truncated.includes("doc")`, so callers never have to know the "doc" section
 *     name is the doc-body marker.
 *
 * Side-effect class: pure
 *
 * Source: SPEC-034 §2, §4; SPEC-040 §T2 D8
 */

import { truncateSection, isInvalidated } from "@lore/core";
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
  /**
   * True iff the document body itself (not parent context) was truncated to fit
   * `budgets.max_doc_chars` (SPEC-040 D8) — the trigger for both the prompt's
   * "Truncation Notice" section and the persisted judgment's `truncated` flag.
   * Deliberately a separate structural field rather than `truncated.includes("doc")`
   * at the call site — see module header.
   */
  docTruncated: boolean;
}

/** Shape every entry in {@link REVIEW_TEMPLATES} must satisfy. */
export type ReviewTemplateFn = (
  bundle: ReviewBundle,
  checks: CheckResult[],
  budgets: ReviewBudgets,
  /**
   * Caller-supplied current time (SPEC-043 §Design Decisions D9) — drives the
   * "# Staleness Notice" section below. OPTIONAL and purity-preserving: when omitted,
   * no staleness check is performed at all (matching pre-SPEC-043 behavior byte-for-
   * byte) — this module stays pure (no internal `Date.now()`/`new Date()` call);
   * `AIProviderService.judgeDoc` is the sole production caller and always supplies it.
   */
  nowIso?: string,
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
  nowIso?: string,
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

  // reason: SPEC-040 D8 — the doc-body-only truncation notice. Parent-context truncation
  // is a different, lower-stakes concern (supplementary context, not the artifact under
  // review) and deliberately does NOT trigger this section — see module header.
  const truncationNotice = docSection.truncated
    ? `# Truncation Notice\n` +
      `The document body above was truncated to fit this prompt's character budget. Treat ` +
      `the FULL document as present but unseen beyond what is shown — do NOT conclude a ` +
      `section is missing, incomplete, or absent merely because it isn't visible here. Any ` +
      `escalation or finding about "unseen" or "missing" content MUST cite this notice ` +
      `explicitly, not silence alone.\n\n`
    : "";

  // reason: SPEC-043 §Design Decisions D9 — when the bundle's own doc or its parent is
  // currently invalidated (bi-temporal validity metadata), tell the judge to discount
  // currency claims rather than silently letting stale content read as authoritative.
  // Filtering the parent outright would remove structural context the judge still
  // needs (parent_contract/tree_position checks reference it), so this is a NOTICE,
  // never an omission. Computed ONLY when `nowIso` is supplied (purity, see
  // ReviewTemplateFn's JSDoc) — the module never reads a wall clock itself.
  const stalenessLines: string[] = [];
  if (nowIso !== undefined) {
    if (isInvalidated(bundle.doc, nowIso)) {
      stalenessLines.push(
        "- The document UNDER REVIEW is marked INVALIDATED (bi-temporal validity " +
          "metadata) — treat any currency/still-true claims in its body with skepticism; " +
          "the corpus considers it superseded or obsolete.",
      );
    }
    if (bundle.parent !== undefined && isInvalidated(bundle.parent, nowIso)) {
      stalenessLines.push(
        "- The PARENT document providing context is marked INVALIDATED — treat any " +
          "currency claims it makes with skepticism too.",
      );
    }
  }
  const stalenessNotice =
    stalenessLines.length > 0 ? `# Staleness Notice\n${stalenessLines.join("\n")}\n\n` : "";

  const prompt =
    `# Role\n` +
    `You are an independent document reviewer. Judge ONLY from the materials provided below ` +
    `— do not assume anything about the corpus you cannot see here. A set of mechanical ` +
    `pre-checks has ALREADY been run and their results are given to you verbatim; treat them ` +
    `as ground truth, do not attempt to re-derive them yourself.\n\n` +
    `# Document Under Review\n` +
    `## ${bundle.doc.title} (${bundle.doc.slug}, type=${bundle.doc.type}, status=${bundle.doc.status})\n` +
    `${docSection.text}\n\n` +
    truncationNotice +
    stalenessNotice +
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

  return { prompt, truncated, docTruncated: docSection.truncated };
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
