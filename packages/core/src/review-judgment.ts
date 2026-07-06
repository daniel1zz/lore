/**
 * Review-judgment schema — AI-reviewer verdict for a single document version,
 * plus the mechanical check results and blocking-question invariant that
 * decide whether a review can be trusted to auto-approve/reject or must be
 * escalated to a human. Pure, browser-safe module: no IO, no Date.now()/
 * Math.random() calls.
 *
 * Public surface:
 *   - REVIEW_DECISIONS / ReviewDecision — the three verdicts a review judgment can reach
 *   - judgeIdentitySchema / JudgeIdentity — which model+prompt produced a judgment
 *   - checkResultSchema / CheckResult — one mechanical (non-LLM) validation outcome
 *   - reviewReasonSchema / ReviewReason — one human-readable justification entry
 *   - llmReviewOutputSchema / LlmReviewOutput — the shape the AI judge must emit
 *     (decision/confidence/reasons/checks?/blocking_questions — no id/doc_id/doc_version/
 *     judge/created_*: those are filled in by the reviewing service after a successful
 *     parse, not by the model — mirrors assessment.ts's llmAssessmentOutputSchema split)
 *   - reviewJudgmentSchema / ReviewJudgment — full persisted shape (llm output + identity
 *     + judge metadata), stored one row per judgment in `review_judgments`
 *
 * Invariants:
 *   - decision === "escalate" requires at least one blocking_questions entry; every other
 *     decision requires blocking_questions to be empty. Enforced identically on both
 *     llmReviewOutputSchema (what the model itself must satisfy) and reviewJudgmentSchema
 *     (the persisted record) via the same superRefine predicate, so a judgment can never
 *     be persisted with a decision/blocking_questions combination the model was never
 *     allowed to produce.
 *   - llmReviewOutputSchema.checks is optional — mechanical checks (schema/parent_contract/
 *     tree_position/link_integrity/evidence_completeness) are frequently computed by the
 *     reviewing service rather than the model; reviewJudgmentSchema requires checks once
 *     persisted (the service always layers them on before writing the row).
 *
 * Side-effect class: pure
 *
 * Source: SPEC-034 §2, §3
 */

import { z } from "zod";

// ─── Decision ───────────────────────────────────────────────────────────────

/** The three verdicts a review judgment can reach. */
export const REVIEW_DECISIONS = ["approve", "reject", "escalate"] as const;

/** Derived TypeScript type for a review decision. */
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

// ─── Judge Identity ─────────────────────────────────────────────────────────

/**
 * Identifies which model + prompt produced a judgment. Stored denormalized as
 * `judge_provider` / `judge_model` / `judge_prompt_version` columns on
 * `review_judgments` (see migration-003.ts) so calibration queries can filter
 * on prompt_version without a join.
 *
 * @example
 * judgeIdentitySchema.parse({ provider: "claude-cli", model: "claude-sonnet-5", prompt_version: "v1" });
 */
export const judgeIdentitySchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  prompt_version: z.string().min(1),
});

/** Derived TypeScript type for a judge identity. */
export type JudgeIdentity = z.infer<typeof judgeIdentitySchema>;

// ─── Check Result ───────────────────────────────────────────────────────────

/**
 * One mechanical (non-LLM) validation outcome — the deterministic checks a
 * reviewing service runs alongside the AI judge (schema shape, parent-type
 * contract, tree position, link integrity, evidence completeness).
 *
 * @example
 * checkResultSchema.parse({ check: "schema", outcome: "pass" });
 * checkResultSchema.parse({ check: "link_integrity", outcome: "fail", detail: "dangling parent_id" });
 */
export const checkResultSchema = z.object({
  check: z.enum([
    "schema",
    "parent_contract",
    "tree_position",
    "link_integrity",
    "evidence_completeness",
  ]),
  outcome: z.enum(["pass", "fail", "skipped"]),
  detail: z.string().optional(),
});

/** Derived TypeScript type for one mechanical check result. */
export type CheckResult = z.infer<typeof checkResultSchema>;

// ─── Reason Entry ───────────────────────────────────────────────────────────

/**
 * One human-readable justification entry backing a review decision —
 * which dimension was assessed, what was found, and (optionally) a pointer
 * to the evidence that grounds the finding.
 *
 * @example
 * reviewReasonSchema.parse({ dimension: "completeness", finding: "AC-3 has no test coverage" });
 */
export const reviewReasonSchema = z.object({
  dimension: z.string(),
  finding: z.string(),
  evidence_ref: z.string().optional(),
});

/** Derived TypeScript type for one review reason entry. */
export type ReviewReason = z.infer<typeof reviewReasonSchema>;

// ─── Shared Shape + Escalate Invariant ──────────────────────────────────────

/**
 * Fields common to both the raw LLM output and the persisted judgment.
 * `checks` is optional here (the model may omit it); reviewJudgmentSchema
 * overrides it to required via `.extend()` once the service has layered
 * mechanical checks on.
 */
const reviewJudgmentBaseShape = z.object({
  decision: z.enum(REVIEW_DECISIONS),
  confidence: z.number().min(0).max(1),
  reasons: z.array(reviewReasonSchema).min(1),
  checks: z.array(checkResultSchema).optional(),
  blocking_questions: z.array(z.string()),
});

/**
 * Cross-field invariant shared by llmReviewOutputSchema and reviewJudgmentSchema:
 * decision "escalate" requires at least one blocking question; every other
 * decision requires blocking_questions to be empty (a non-escalating judgment
 * has nothing left to block on).
 */
function validateEscalateInvariant(
  data: { decision: ReviewDecision; blocking_questions: string[] },
  ctx: z.RefinementCtx,
): void {
  if (data.decision === "escalate" && data.blocking_questions.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "decision 'escalate' requires at least one blocking_questions entry",
      path: ["blocking_questions"],
    });
  }
  if (data.decision !== "escalate" && data.blocking_questions.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "blocking_questions must be empty unless decision is 'escalate'",
      path: ["blocking_questions"],
    });
  }
}

// ─── LLM Output Schema (what the judge must produce) ───────────────────────

/**
 * Shape the AI judge's raw JSON response must match. Deliberately excludes
 * `id`, `doc_id`, `doc_version`, `judge`, `created_at`, `created_by` — those
 * are computed/layered on by the reviewing service after a successful parse
 * (the model has no way to know the doc's ULID, its own provider/prompt
 * identity, or wall-clock time). Source: SPEC-034 §2.
 *
 * @example
 * llmReviewOutputSchema.parse({
 *   decision: "approve", confidence: 0.92,
 *   reasons: [{ dimension: "completeness", finding: "All ACs covered." }],
 *   blocking_questions: [],
 * });
 */
export const llmReviewOutputSchema = reviewJudgmentBaseShape.superRefine(validateEscalateInvariant);

/** Derived TypeScript type for the raw judge output. */
export type LlmReviewOutput = z.infer<typeof llmReviewOutputSchema>;

// ─── Full Review Judgment (persisted shape) ────────────────────────────────

/**
 * Full persisted review judgment: the judge's decision plus doc identity,
 * judge identity, and audit metadata. One row per judgment in
 * `review_judgments` (migration-003.ts).
 *
 * @example
 * reviewJudgmentSchema.parse({
 *   id: "01ARZ3...", doc_id: "01ARZ3...", doc_version: 2,
 *   decision: "approve", confidence: 0.9,
 *   reasons: [{ dimension: "completeness", finding: "All ACs covered." }],
 *   checks: [{ check: "schema", outcome: "pass" }],
 *   blocking_questions: [],
 *   judge: { provider: "claude-cli", model: "claude-sonnet-5", prompt_version: "v1" },
 *   created_at: "2026-07-06T00:00:00.000Z", created_by: "ai:claude-cli:claude-sonnet-5:v1",
 * });
 */
export const reviewJudgmentSchema = reviewJudgmentBaseShape
  .extend({
    id: z.string(),
    doc_id: z.string(),
    doc_version: z.number().int(),
    /** Required once persisted — the service always layers mechanical checks on before writing. */
    checks: z.array(checkResultSchema),
    judge: judgeIdentitySchema,
    created_at: z.string(),
    created_by: z.string(),
  })
  .superRefine(validateEscalateInvariant);

/** Derived TypeScript type for a full persisted review judgment. */
export type ReviewJudgment = z.infer<typeof reviewJudgmentSchema>;
