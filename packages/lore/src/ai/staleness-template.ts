/**
 * Judge prompt builder for `lore review --staleness` — LLM-as-judge staleness probing
 * (SPEC-044 §Design Decisions D5). Owns the prompt text and STALENESS_PROMPT_VERSION,
 * version-keyed from day one (mirrors `review-template.ts`'s REVIEW_PROMPT_VERSION
 * precedent). Lives in `packages/lore/src/ai/`, NOT `@lore/core` (core stays limited to
 * schemas + pure data helpers — `StalenessBundle` itself DOES live in `@lore/core`
 * since it's a cross-module data contract, but the prompt TEXT does not).
 *
 * Public surface:
 *   - STALENESS_PROMPT_VERSION — the currently active key into STALENESS_TEMPLATES
 *   - StalenessBudgets — character/count budgets sourced from `ai.staleness.*`
 *   - BuildStalenessPromptResult — {prompt, docTruncated}
 *   - StalenessTemplateFn — the shape every registry entry must satisfy
 *   - STALENESS_TEMPLATES — version-keyed registry; exactly one entry today
 *   - buildStalenessRetryPrompt(originalPrompt, parseErrorMessage) — one corrective retry
 *
 * Invariants:
 *   - No IO — pure string assembly over an already-fetched StalenessBundle.
 *   - Truncation is applied to the doc content via `@lore/core`'s truncateSection;
 *     `BuildStalenessPromptResult.docTruncated` mirrors `BuildReviewPromptResult
 *     .docTruncated`'s role — a structural signal, not a string-match.
 *   - Neighbor list is capped at `budgets.neighbor_limit`, with a LOUD "+n more" tail
 *     line when the full neighbor set exceeds the cap (D5 — never a silent truncation).
 *   - Validity state is rendered from `bundle.doc`'s OWN `extra.validity` — a probe
 *     candidate that is ALREADY invalidated should never reach this template in
 *     practice (the pure selection layer excludes it), but the prompt still states the
 *     doc's validity state explicitly for defense-in-depth and single-doc-probe callers
 *     that bypass selection filters.
 *
 * Side-effect class: pure
 *
 * Source: SPEC-044 §Design Decisions D5
 */

import { extractValidity, truncateSection } from "@lore/core";
import type { StalenessBundle, StalenessNeighbor } from "@lore/core";

/**
 * Judge prompt schema version — the active key into {@link STALENESS_TEMPLATES}.
 * Persisted verbatim into `judge.prompt_version` on every staleness judgment.
 */
export const STALENESS_PROMPT_VERSION = "v1";

/** Character/count budgets for each prompt section, sourced from `config.ai.staleness.*`. */
export interface StalenessBudgets {
  max_doc_chars: number;
  neighbor_limit: number;
}

/** Result of a {@link StalenessTemplateFn} call. */
export interface BuildStalenessPromptResult {
  prompt: string;
  /** True iff the doc body itself was truncated to fit `budgets.max_doc_chars`. */
  docTruncated: boolean;
}

/** Shape every entry in {@link STALENESS_TEMPLATES} must satisfy. */
export type StalenessTemplateFn = (
  bundle: StalenessBundle,
  budgets: StalenessBudgets,
  /** Caller-supplied current time — drives the validity-state line. This module stays
   *  pure (no internal `Date.now()`/`new Date()` call); `AIProviderService.probeStaleness`
   *  is the sole production caller and always supplies it. */
  nowIso: string,
) => BuildStalenessPromptResult;

/**
 * Renders the in-neighbor block: `- <slug> (<link_type>): <title>` per neighbor, capped
 * at `limit`, with a LOUD "+n more" tail line when the full list is longer (D5 — never a
 * silent cap, mirrors D9's `excluded_by_limit` philosophy applied to prompt rendering).
 */
function renderNeighborsBlock(neighbors: StalenessNeighbor[], limit: number): string {
  if (neighbors.length === 0) {
    return "(no incoming links — nothing in the corpus currently depends on this document)";
  }
  const shown = neighbors.slice(0, limit);
  const lines = shown.map((n) => `- ${n.slug} (${n.link_type}): ${n.title}`);
  const remainder = neighbors.length - shown.length;
  if (remainder > 0) {
    lines.push(`- … and ${remainder} more (truncated — showing only the first ${limit})`);
  }
  return lines.join("\n");
}

/** Renders the validity-state line the judge sees (D5 "validity state" material). */
function renderValidityStateLine(bundle: StalenessBundle, nowIso: string): string {
  const validity = extractValidity(bundle.doc);
  if (validity?.invalid_at === undefined) return "currently valid (not invalidated)";
  const invalidAtMs = new Date(validity.invalid_at).getTime();
  const nowMs = new Date(nowIso).getTime();
  return invalidAtMs <= nowMs
    ? `ALREADY INVALIDATED at ${validity.invalid_at}${validity.reason !== undefined ? ` (reason: ${validity.reason})` : ""}`
    : `scheduled to become invalid at ${validity.invalid_at} (not yet reached)`;
}

/**
 * Assemble the v1 judge prompt for `lore review --staleness`: role → document →
 * age/validity/blast-radius material → output instruction. The doc content is truncated
 * to `budgets.max_doc_chars`; the neighbor list is capped at `budgets.neighbor_limit`.
 */
function buildStalenessPromptV1(
  bundle: StalenessBundle,
  budgets: StalenessBudgets,
  nowIso: string,
): BuildStalenessPromptResult {
  const docSection = truncateSection(bundle.doc.content, budgets.max_doc_chars);
  const validityLine = renderValidityStateLine(bundle, nowIso);
  const neighborsBlock = renderNeighborsBlock(bundle.neighbors, budgets.neighbor_limit);

  const truncationNotice = docSection.truncated
    ? `# Truncation Notice\n` +
      `The document body above was truncated to fit this prompt's character budget. Treat ` +
      `the FULL document as present but unseen beyond what is shown — do NOT conclude it is ` +
      `stale merely because a later section isn't visible here.\n\n`
    : "";

  const prompt =
    `# Role\n` +
    `You are an independent staleness auditor. Your job is to judge whether the document ` +
    `below still holds true — NOT to review its writing quality or completeness (that is a ` +
    `separate review pipeline). Judge ONLY from the materials provided.\n\n` +
    `# Document Under Probe\n` +
    `## ${bundle.doc.title} (${bundle.doc.slug}, type=${bundle.doc.type})\n` +
    `Age since last confirmation: ${bundle.age_days} days. Incoming links (blast radius): ${bundle.in_degree}.\n` +
    `Validity state: ${validityLine}.\n\n` +
    `${docSection.text}\n\n` +
    truncationNotice +
    `# Who Depends On This (incoming links)\n` +
    `${neighborsBlock}\n\n` +
    `# Output Instruction\n` +
    `Respond with a SINGLE JSON object and nothing else — no prose before or after it, no ` +
    `markdown fence required (but allowed). The object MUST match this shape exactly:\n` +
    `{\n` +
    `  "decision": "holds" | "stale_candidate",\n` +
    `  "confidence": <number 0-1>,\n` +
    `  "reasons": ["<string>", ...],\n` +
    `  "blocking_questions": ["<string>", ...],\n` +
    `  "superseded_candidate": { "ref": "<id-or-slug of a doc you believe supersedes this one>", "reason": "<<=200 chars>" }\n` +
    `}\n` +
    `RULES:\n` +
    `- decision "stale_candidate" REQUIRES at least one entry in blocking_questions.\n` +
    `- decision "holds" REQUIRES blocking_questions to be an EMPTY array.\n` +
    `- Omit "superseded_candidate" entirely unless you have a SPECIFIC doc in mind.\n` +
    `- Prefer "holds" when evidence is genuinely ambiguous — a probe is a report, not an\n` +
    `  automatic invalidation; false "stale_candidate" flags cost a human's review time.\n` +
    `- reasons MUST have at least one entry.\n`;

  return { prompt, docTruncated: docSection.truncated };
}

/**
 * Version-keyed registry of staleness judge prompt builders. Exactly one entry today
 * (`STALENESS_PROMPT_VERSION`); a future prompt revision adds a new key here rather than
 * mutating this one, so historical judgments' `judge.prompt_version` stays meaningful.
 */
export const STALENESS_TEMPLATES: Record<string, StalenessTemplateFn> = {
  [STALENESS_PROMPT_VERSION]: buildStalenessPromptV1,
};

/**
 * Build the single corrective-retry prompt (SPEC-026 §3 D2 pattern, mirrors
 * `review-template.ts::buildReviewRetryPrompt`) — embeds the parse/validation error from
 * the first attempt plus a terse reminder, on top of the original prompt.
 *
 * @param originalPrompt - The prompt sent on the first attempt
 * @param parseErrorMessage - Human-readable reason the first response failed to parse/validate
 * @returns The retry prompt to send as the second (and final) attempt
 */
export function buildStalenessRetryPrompt(originalPrompt: string, parseErrorMessage: string): string {
  return (
    `${originalPrompt}\n\n` +
    `# Correction Required\n` +
    `Your previous response could not be parsed as the required JSON object: ${parseErrorMessage}\n` +
    `Respond again with ONLY the single JSON object described above — no prose, no explanation, ` +
    `no markdown fence unless it wraps valid JSON.\n`
  );
}
