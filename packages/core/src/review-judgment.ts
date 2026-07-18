/**
 * Review-judgment schema — AI-reviewer verdict for a single document version,
 * plus the mechanical check results and blocking-question invariant that
 * decide whether a review can be trusted to auto-approve/reject or must be
 * escalated to a human. Pure, browser-safe module: no IO, no Date.now()/
 * Math.random() calls.
 *
 * Public surface:
 *   - REVIEW_DECISIONS / ReviewDecision — the three verdicts a review judgment can reach
 *   - REVIEW_JUDGMENT_KINDS / ReviewJudgmentKind — "review" | "staleness" (SPEC-044 D3)
 *   - judgeIdentitySchema / JudgeIdentity — which model+prompt produced a judgment
 *   - checkResultSchema / CheckResult — one mechanical (non-LLM) validation outcome
 *   - reviewReasonSchema / ReviewReason — one human-readable justification entry
 *   - supersededCandidateSchema / SupersededCandidate — {ref, reason<=200} (SPEC-044 D5/D11)
 *   - llmReviewOutputSchema / LlmReviewOutput — the shape the AI judge must emit
 *     (decision/confidence/reasons/checks?/blocking_questions — no id/doc_id/doc_version/
 *     judge/created_*: those are filled in by the reviewing service after a successful
 *     parse, not by the model — mirrors assessment.ts's llmAssessmentOutputSchema split)
 *   - reviewJudgmentSchema / ReviewJudgment — full persisted shape (llm output + identity
 *     + judge metadata + kind), stored one row per judgment in `review_judgments`
 *   - NewReviewJudgment — ReviewJudgment minus {id, created_at, created_by}, with `kind`
 *     made OPTIONAL again (see @invariant below); the AIProviderService.judgeDoc/
 *     probeStaleness → JudgmentService.record hand-off shape (SPEC-034 §4, SPEC-044 D3/D4)
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
 *   - `truncated` (SPEC-040 D8) is optional on BOTH schemas (unlike `checks`, it stays
 *     optional even once persisted) — additive-only, absent means "not truncated" /
 *     "predates SPEC-040", never an unknown state.
 *   - `superseded_candidate` (SPEC-044 D5/D11) is optional on BOTH schemas too — the SAME
 *     field name/shape a regular review judge MAY emit (D11 byproduct) and a staleness
 *     probe's persisted judgment carries (D5) — one concept, one name (review S7).
 *   - `kind` (SPEC-044 D3) is `.optional()` (deliberately NOT `.default()`) on
 *     `reviewJudgmentSchema` — a candidate object missing `kind` entirely still
 *     validates, and `ReviewJudgment.kind` stays optional in `z.infer`'s OUTPUT type too
 *     (a `.default()` would make it REQUIRED in the output type, breaking every
 *     PRE-SPEC-044 fixture that hand-constructs a `ReviewJudgment`-typed object for a
 *     direct `store.insertJudgment` bypass call). Every reader treats an absent `kind`
 *     as `"review"` via `?? "review"` (S10); `JudgmentService._recordImpl` is the ONE
 *     place that resolves this default explicitly before persisting (AC-SP-2 REGRESSION).
 *   - The kind-conditioned "staleness rows cannot decision='reject'" refinement
 *     (`validateKindDecisionInvariant`) runs BEFORE `validateEscalateInvariant` on
 *     `reviewJudgmentSchema`'s chain — a candidate that violates BOTH (kind='staleness',
 *     decision='reject', non-empty blocking_questions) surfaces the kind-decision message
 *     as `issues[0]` (SPEC-044 review S6, AC-SP-2 dual-fire case).
 *
 * Side-effect class: pure
 *
 * Source: SPEC-034 §2, §3; SPEC-040 §T2 D8; SPEC-044 §Design Decisions D3, D5, D11
 */

import { z } from "zod";

// ─── Decision ───────────────────────────────────────────────────────────────

/** The three verdicts a review judgment can reach. */
export const REVIEW_DECISIONS = ["approve", "reject", "escalate"] as const;

/** Derived TypeScript type for a review decision. */
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

/**
 * The two kinds of judgment persisted in `review_judgments` (SPEC-044 §Design Decisions
 * D3) — "review" is the pre-existing SPEC-034 document-review judgment; "staleness" is a
 * new SPEC-044 probe verdict. The store-level `kind` filter on `latestJudgment`/
 * `findJudgments` is what stops a staleness "holds" row (persisted `decision: "approve"`)
 * from masquerading as a real review approval in `lore pending` (review S2).
 */
export const REVIEW_JUDGMENT_KINDS = ["review", "staleness"] as const;

/** Derived TypeScript type for a review-judgment kind. */
export type ReviewJudgmentKind = (typeof REVIEW_JUDGMENT_KINDS)[number];

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

// ─── Superseded Candidate (SPEC-044 D5/D11) ─────────────────────────────────

/**
 * A judge's nomination that some OTHER document is superseded by the one under
 * judgment/probe — the economic nudge that keeps SPEC-043's `lore invalidate` verb
 * alive without automation. ONE canonical shape shared by a SPEC-044 staleness probe's
 * `stale_candidate` verdict (D5) and a SPEC-034 review judge's byproduct nomination
 * (D11) — never two names for the same concept (review S7).
 *
 * @example
 * supersededCandidateSchema.parse({ ref: "knowledge-old-retro", reason: "superseded by this doc's findings" });
 */
export const supersededCandidateSchema = z.object({
  /** id-or-slug of the document the judge believes is superseded. Resolved against the
   *  corpus by the RENDERING layer (CLI/MCP), never here — this schema stays a bare
   *  string, matching `invalidated_by`'s precedent in validity.ts. */
  ref: z.string().min(1),
  /** Free-text justification, capped at 200 chars — mirrors validity.ts's `reason` cap
   *  being SHORTER here (200 vs 500) since this is a terse judge-emitted nomination,
   *  not a human-authored narrative. */
  reason: z.string().max(200),
});

/** Derived TypeScript type for a superseded-candidate nomination. */
export type SupersededCandidate = z.infer<typeof supersededCandidateSchema>;

// ─── Advisory Findings (SPEC-053) ────────────────────────────────────────────

/**
 * Enumerated kinds of non-blocking, spec-quality advisory a review judge MAY emit
 * (SPEC-053). The single source of truth for the `advisory[].kind` field below — a
 * typed extension point deliberately chosen over a free-text `reasons[].dimension`
 * string so a new spec-quality advisory (e.g. the deferred requirement→AC completeness
 * oracle) slots in as ONE enum member, Zod-checked, never a magic string convention.
 *
 * `"ac_quantifiability"` — the SPEC-053 dimension: an acceptance criterion that passes
 * the deterministic lexical lint (`lintAcQuantifiability`, `ac-quality.ts`) yet remains
 * SEMANTICALLY un-measurable (e.g. "returns quickly enough" — no abstract wordlist hit,
 * but no threshold either). Advisory only — see `reviewAdvisorySchema`'s contract.
 */
export const REVIEW_ADVISORY_KINDS = ["ac_quantifiability"] as const;

/** Derived TypeScript type for a review-advisory kind. */
export type ReviewAdvisoryKind = (typeof REVIEW_ADVISORY_KINDS)[number];

/**
 * One non-blocking advisory finding a review judge MAY emit alongside its verdict
 * (SPEC-053). STRUCTURALLY SEPARATE from `reviewReasonSchema` (decision-driving
 * justifications): an `advisory[]` entry, by contract, NEVER by itself forces
 * `decision: "reject"` — the v2 review prompt instructs the judge accordingly, and the
 * deterministic AC-quantifiability lint (SPEC-052) remains the sole hard gate. `ac_id`
 * is optional (a finding may reference a specific AC or the AC set as a whole).
 *
 * @example
 * reviewAdvisorySchema.parse({
 *   kind: "ac_quantifiability", ac_id: "AC-3",
 *   finding: "'returns quickly enough' declares no measurable threshold",
 * });
 */
export const reviewAdvisorySchema = z.object({
  kind: z.enum(REVIEW_ADVISORY_KINDS),
  ac_id: z.string().optional(),
  finding: z.string(),
});

/** Derived TypeScript type for one advisory finding. */
export type ReviewAdvisory = z.infer<typeof reviewAdvisorySchema>;

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
  /**
   * True iff the document body had to be truncated to fit the judge prompt's
   * character budget (SPEC-040 D8). Optional here (the model may omit or echo it
   * back; NEVER trusted) — `AIProviderService.judgeDoc` ALWAYS overwrites this with
   * the deterministic truncation state it computed BEFORE invoking the judge,
   * mirroring `checks`' "service is authoritative, model is never trusted to
   * self-report" precedent (SPEC-034 §4). Additive-only and stays OPTIONAL on the
   * persisted schema too (unlike `checks`, which was required from SPEC-034's
   * inception) — every judgment persisted before SPEC-040 has no `truncated` key at
   * all and must keep validating; its absence means "not truncated" for those rows,
   * not an unknown state.
   */
  truncated: z.boolean().optional(),
  /**
   * A judge's optional nomination that some OTHER document is superseded by this one
   * (SPEC-044 D5/D11). Present on the shared base shape (not just the persisted schema)
   * because BOTH the raw LLM output (a review judge emitting this as a byproduct, D11)
   * and a staleness probe's verdict (D5) may carry it — `AIProviderService.judgeDoc`/
   * `probeStaleness` pass it through verbatim, never re-deriving it.
   */
  superseded_candidate: supersededCandidateSchema.optional(),
  /**
   * Non-blocking, spec-quality advisory findings (SPEC-053). Optional on BOTH the raw
   * LLM output schema and the persisted schema — additive-only, absent means "no advisory
   * findings" / "predates SPEC-053", never an unknown state (mirrors `truncated`/
   * `superseded_candidate`'s optional-on-both precedent). Present on the shared base shape
   * because the v2 review judge emits it directly; `AIProviderService.judgeDoc` passes it
   * through verbatim, never re-deriving it. By contract these NEVER by themselves force a
   * `reject` — the v2 prompt states this and the SPEC-052 deterministic lint is the sole
   * hard gate.
   */
  advisory: z.array(reviewAdvisorySchema).optional(),
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

// ─── Kind-Conditioned Decision Invariant (SPEC-044 D3) ─────────────────────

/**
 * Cross-field invariant applying ONLY to the persisted `reviewJudgmentSchema` (never
 * `llmReviewOutputSchema`, which has no `kind` field at all — the model never emits it,
 * the reviewing/probing SERVICE decides which prompt/pipeline produced the row): a
 * `kind: "staleness"` judgment's `decision` MUST be `"approve"` (holds) or `"escalate"`
 * (stale_candidate) — `"reject"` is structurally impossible for a probe (SPEC-044 D3).
 *
 * @invariant Registered BEFORE `validateEscalateInvariant` in `reviewJudgmentSchema`'s
 *   refinement chain — a doubly-malformed candidate (kind="staleness", decision="reject",
 *   non-empty blocking_questions) surfaces THIS message as `issues[0]` (review S6).
 */
function validateKindDecisionInvariant(
  data: { kind?: ReviewJudgmentKind | undefined; decision: ReviewDecision },
  ctx: z.RefinementCtx,
): void {
  if ((data.kind ?? "review") === "staleness" && data.decision === "reject") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "kind 'staleness' judgments cannot have decision 'reject' — only 'approve' (holds) or 'escalate' (stale_candidate) are valid",
      path: ["decision"],
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
    /**
     * Discriminates a SPEC-034 review judgment from a SPEC-044 staleness-probe verdict.
     * OPTIONAL (not `.default()`) — a candidate/row missing this key entirely still
     * validates; every reader treats an absent value as `"review"` via `?? "review"`
     * (never strict equality, S10). Kept optional (rather than defaulted, which would
     * make `z.infer`'s OUTPUT type require it) so the pre-existing pattern of
     * hand-constructing a `ReviewJudgment`-typed fixture object for a direct
     * `store.insertJudgment` bypass call (skipping this schema entirely) keeps
     * compiling with zero changes — see module @invariant re: REGRESSION safety.
     * `JudgmentService._recordImpl` is the ONE place that resolves the default
     * explicitly (`newJudgment.kind ?? "review"`) before this schema ever sees it.
     */
    kind: z.enum(REVIEW_JUDGMENT_KINDS).optional(),
    created_at: z.string(),
    created_by: z.string(),
  })
  // reason: kind-conditioned check FIRST — see validateKindDecisionInvariant's own
  // @invariant for why ordering (not just presence) matters (review S6 dual-fire case).
  .superRefine(validateKindDecisionInvariant)
  .superRefine(validateEscalateInvariant);

/** Derived TypeScript type for a full persisted review judgment. */
export type ReviewJudgment = z.infer<typeof reviewJudgmentSchema>;

// ─── Judge → Service Hand-off Shape ─────────────────────────────────────────

/**
 * The `AIProviderService.judgeDoc` → `JudgmentService.record` hand-off shape — everything
 * needed to persist a judgment EXCEPT the three fields only `record()` is allowed to set:
 * `id` (ULID, generated at persist time), `created_at` (wall clock, read at persist time),
 * and `created_by` (derived from `judge` via `formatJudgeActor`, audit-actor.ts). Mirrors
 * SPEC-026's `AssessmentResult` hand-off from `assessPlan` to its caller, one layer earlier:
 * here the split lives in the type system (`Omit`) rather than in a second Zod schema,
 * because unlike `AssessmentResult` this shape is never independently persisted or
 * re-parsed from raw JSON — it exists only as an in-process argument.
 *
 * @example
 * const newJudgment: NewReviewJudgment = {
 *   doc_id: "01ARZ3...", doc_version: 2, decision: "approve", confidence: 0.9,
 *   reasons: [{ dimension: "completeness", finding: "All ACs covered." }],
 *   checks: [{ check: "schema", outcome: "pass" }], blocking_questions: [],
 *   judge: { provider: "claude-cli", model: "claude-cli", prompt_version: "v1" },
 * };
 */
export type NewReviewJudgment = Omit<ReviewJudgment, "id" | "created_at" | "created_by">;
