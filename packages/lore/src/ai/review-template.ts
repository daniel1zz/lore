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
 *   - REVIEW_TEMPLATES — version-keyed registry; v1 (frozen, SPEC-034) + v2 (SPEC-053)
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

import {
  truncateSection,
  isInvalidated,
  lintAcQuantifiability,
  specAcceptanceCriteriaSchema,
} from "@lore/core";
import type { CheckResult, ReviewBundle, AcceptanceCriterion } from "@lore/core";

/**
 * Judge prompt schema version — the active key into {@link REVIEW_TEMPLATES}. Persisted
 * verbatim into `judge.prompt_version` on every review judgment (SPEC-034 §2) so calibration
 * queries can filter/aggregate per prompt version without a join.
 */
export const REVIEW_PROMPT_VERSION = "v2";

/**
 * The exact advisory-only clause the v2 prompt embeds (SPEC-053 AC-053-4). Exported so a
 * test can assert its presence byte-for-byte rather than duplicating the string literal.
 * States the SPEC-053 D1 contract: advisory findings NEVER by themselves force a reject —
 * the deterministic AC-quantifiability lint (SPEC-052) is the sole hard gate.
 */
export const ADVISORY_ONLY_CLAUSE =
  "advisory findings are ADVISORY ONLY. They MUST NOT by themselves cause you to set " +
  'decision="reject" — the deterministic lint is the sole hard gate. Use them to inform ' +
  "a reviewer, not to block.";

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
 * Extract a spec's declared acceptance criteria from a review bundle (SPEC-053). Returns
 * `[]` for any non-spec doc, a spec with no `extra.acceptance_criteria`, or a malformed
 * declaration — the caller renders the advisory section ONLY for a non-empty result, so a
 * non-spec / no-AC doc produces a v2 prompt byte-identical to v1 on the advisory axis.
 */
function extractSpecAcceptanceCriteria(bundle: ReviewBundle): AcceptanceCriterion[] {
  if (bundle.doc.type !== "spec") return [];
  const extra = bundle.doc.extra;
  if (extra === null || typeof extra !== "object") return [];
  const raw = (extra as Record<string, unknown>)["acceptance_criteria"];
  if (raw === undefined) return [];
  const parsed = specAcceptanceCriteriaSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

/**
 * Render the SPEC-053 advisory MATERIAL section — the AC list + the deterministic
 * `lintAcQuantifiability` verdict (a count, so the judge does not re-derive the lexical
 * result) + the advisory-only framing. Returned as a block ready to splice before the
 * "# Parent Context" section. Precondition: `criteria` is non-empty (the caller guards).
 */
function renderAcAdvisorySection(criteria: AcceptanceCriterion[]): string {
  const lintFindings = lintAcQuantifiability(criteria);
  const flaggedIds = new Set(lintFindings.map((f) => f.ac_id));
  const acLines = criteria
    .map((c) => {
      const verdict = flaggedIds.has(c.id) ? "flagged" : "clean";
      return `- ${c.id}: ${c.statement}  [lexical lint: ${verdict}]`;
    })
    .join("\n");

  return (
    `# AC Quantifiability (advisory)\n` +
    `The document under review is a spec with ${criteria.length} declared acceptance ` +
    `criteria. A deterministic lexical lint (SPEC-052) has ALREADY run and found ` +
    `${lintFindings.length} blocking issue(s) — treat that as ground truth, do NOT ` +
    `re-derive it. Your ADVISORY task: flag any acceptance criterion that passes the ` +
    `lexical lint yet is SEMANTICALLY un-measurable — it declares no threshold, metric, ` +
    `or oracle a reader could check (e.g. "returns quickly enough", "handles reasonable ` +
    `load"). Report each in the "advisory" output array with kind "ac_quantifiability".\n` +
    `Declared acceptance criteria:\n` +
    `${acLines}\n` +
    `IMPORTANT: ${ADVISORY_ONLY_CLAUSE}\n\n`
  );
}

/**
 * Shared review-prompt assembler for BOTH v1 and v2 (SPEC-053). v1 passes empty advisory
 * parameters, producing byte-identical output to the pre-SPEC-053 monolithic builder (the
 * frozen `review-prompt-v1.txt` fixture + AC-053-6 lock this). v2 passes a rendered
 * advisory material section (spliced before "# Parent Context") and an advisory JSON field
 * + rule extending the output contract — every insertion collapses to `""` for v1.
 *
 * Assembly: role → document → parent context → deterministic pre-check results → output
 * instruction. Each material section is truncated to its configured budget; any section
 * that gets cut has its name appended to the returned `truncated[]` list.
 */
function assembleReviewPrompt(
  bundle: ReviewBundle,
  checks: CheckResult[],
  budgets: ReviewBudgets,
  nowIso: string | undefined,
  advisory: { section: string; jsonField: string; rule: string },
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
    advisory.section +
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
    `  "blocking_questions": ["<string>", ...]` + advisory.jsonField + `\n` +
    `}\n` +
    `RULES:\n` +
    `- decision "escalate" REQUIRES at least one entry in blocking_questions.\n` +
    `- Every OTHER decision REQUIRES blocking_questions to be an EMPTY array.\n` +
    `- Prefer "escalate" over guessing when evidence is genuinely ambiguous or missing —\n` +
    `  a wrong confident answer is worse than an honest escalation.\n` +
    `- If ANY pre-check above has outcome "fail", you should almost always decision="reject"\n` +
    `  or "escalate", not "approve".\n` +
    `- reasons MUST have at least one entry.\n` +
    advisory.rule;

  return { prompt, truncated, docTruncated: docSection.truncated };
}

// ─── Empty advisory (v1) ─────────────────────────────────────────────────────

/** The no-advisory parameter bundle — every field `""`, so `assembleReviewPrompt`
 *  reproduces the pre-SPEC-053 v1 output byte-for-byte (AC-053-6). */
const NO_ADVISORY = { section: "", jsonField: "", rule: "" } as const;

/**
 * v1 review judge prompt (SPEC-034) — FROZEN. Delegates to `assembleReviewPrompt` with
 * empty advisory parameters; the `review-prompt-v1.txt` fixture + AC-053-6 REGRESSION test
 * prove this stays byte-identical to the pre-SPEC-053 monolithic builder.
 */
function buildReviewPromptV1(
  bundle: ReviewBundle,
  checks: CheckResult[],
  budgets: ReviewBudgets,
  nowIso?: string,
): BuildReviewPromptResult {
  return assembleReviewPrompt(bundle, checks, budgets, nowIso, NO_ADVISORY);
}

/**
 * v2 review judge prompt (SPEC-053) — v1 plus a non-blocking AC-quantifiability advisory
 * dimension, rendered ONLY when the reviewed doc is a spec with ≥1 declared acceptance
 * criterion. For every other doc (non-spec, or a spec with no declared ACs) the advisory
 * parameters collapse to empty and the output is byte-identical to v1.
 */
function buildReviewPromptV2(
  bundle: ReviewBundle,
  checks: CheckResult[],
  budgets: ReviewBudgets,
  nowIso?: string,
): BuildReviewPromptResult {
  const criteria = extractSpecAcceptanceCriteria(bundle);
  if (criteria.length === 0) {
    return assembleReviewPrompt(bundle, checks, budgets, nowIso, NO_ADVISORY);
  }
  const advisory = {
    section: renderAcAdvisorySection(criteria),
    jsonField:
      `,\n` +
      `  "advisory": [\n` +
      `    { "kind": "ac_quantifiability", "ac_id": "<optional AC id>", "finding": "<what is semantically unmeasurable>" }\n` +
      `  ]`,
    rule:
      `- OPTIONAL "advisory": zero or more non-blocking AC-quantifiability findings; ` +
      `omit the key or use [] when none. ${ADVISORY_ONLY_CLAUSE}\n`,
  };
  return assembleReviewPrompt(bundle, checks, budgets, nowIso, advisory);
}

/**
 * Version-keyed registry of review judge prompt builders. `v1` (SPEC-034, frozen —
 * byte-identical to its original output, locked by the `review-prompt-v1.txt` fixture) and
 * `v2` (SPEC-053, adds the non-blocking AC-quantifiability advisory dimension). The active
 * key is `REVIEW_PROMPT_VERSION`. A future prompt spec adds a NEW key here rather than
 * mutating an existing one, so historical judgments' `judge.prompt_version` stays meaningful.
 */
export const REVIEW_TEMPLATES: Record<string, ReviewTemplateFn> = {
  v1: buildReviewPromptV1,
  v2: buildReviewPromptV2,
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
