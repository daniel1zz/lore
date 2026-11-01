/**
 * Gate checkpoint registry (IoC vertical-slice tech-spec §5.1) — the pure decision
 * layer `lore gate` dispatches through. Each `CheckpointDef` bundles one checkpoint's
 * deterministic predicate checks (`check`) and its failure feeding-pack renderer
 * (`feed`) behind a single lookup key (`GateCheckpoint`), so the CLI adapter
 * (`../adapters/cli/commands/gate.ts`) no longer inlines the decision logic per
 * subcommand — it builds a `GateContext` from whatever store/IO reads it needs, then
 * dispatches through `checkpointRegistry`.
 *
 * This module lifts `spec-create` and `spec-promote`'s decision logic UNCHANGED out of
 * `gate.ts`'s former inline `runSpecCreateGate` / `runSpecPromoteGate` bodies — same
 * predicates (`gate-predicates.ts`), same feeding-pack assembly (`gate-feeding.ts`),
 * same aggregate "any failure blocks" rule, same predicate ORDER (so `missing` reason
 * lists render identically). `plan-promote` and `task-claim` are the two "commit-time
 * cross-tier gates" this module adds on top of that: both gate a downstream doc
 * (a plan being promoted / a task being claimed) against its ancestor spec's
 * approval + AC status, reusing `upstreamApproved` / `upstreamHasAcceptanceCriteria`
 * from `gate-predicates.ts` unchanged.
 *
 * @invariant Every `check` and `feed` function reachable through `checkpointRegistry`
 *   is a PURE function of its `GateContext` argument — no store, no IO, no
 *   `bun:sqlite`, no randomness, no wall-clock reads. Same `GateContext` in ⇒ same
 *   result out, always. All store/IO (resolving a parent doc, reading a rule doc's
 *   markdown, counting a spec's declared acceptance criteria, walking a plan/task's
 *   ancestor-spec chain via `CorpusService.getPlanBundle`) stays in `gate.ts` — this
 *   module only consumes data the adapter already fetched.
 * @invariant `checkpointRegistry` now covers all five `GateCheckpoint` members. It
 *   remains typed `Partial<Record<...>>` (not `Record<...>`) so a FUTURE checkpoint
 *   addition doesn't have to touch this type — callers still SHOULD branch on
 *   `checkpointRegistry[cp] !== undefined` (or use `requireCheckpoint`-style lookups
 *   only where compile-time-known to already be populated) rather than assuming the
 *   partiality can never return. `isRegisteredCheckpoint` (below, next to
 *   `checkpointRegistry`'s own definition) is that exact branch, exported as a named
 *   predicate so `lore feed`'s CLI dispatch and its coverage test consult the SAME
 *   membership check the registry itself defines (task-derive-lore-feed-s-checkpoint-
 *   set-from-the-registry-make, D1) — never a second hand-maintained checkpoint list.
 * @invariant `GateContext.targetDocId` (see that field's own JSDoc) is the ONLY
 *   `GateContext` field this module's `check`/`feed` functions deliberately never
 *   read — it exists solely for `GateEnforcer`'s own audit-trace write on a passing
 *   evaluation (AC-FR-8/D7), and must never be conflated with the display-only
 *   `specIdOrSlug`/`targetIdOrSlug` fields those functions DO read.
 * @invariant `plan-promote` encodes "no spec-tier ancestor ⇒ PASS" via
 *   `ctx.hasSpecParent === false` short-circuiting `check()` to an empty
 *   `PredicateResult[]` BEFORE its predicate runs — `isCheckpointBlocked([])` is
 *   vacuously `false` (see that function's own doc). This covers a plan parented
 *   directly under a `prd` (no spec in the chain at all) and a top-level, unparented
 *   plan identically: there is no upstream spec edge to gate against, so the write is
 *   never blocked by this checkpoint. Do NOT call `upstreamApproved(undefined, "spec")`
 *   for this case — that predicate treats a missing upstream as a FAILURE
 *   (`UPSTREAM_MISSING`), which is the correct behavior when a spec parent WAS
 *   expected but didn't resolve, not when no spec tier exists in the chain at all.
 * @invariant `task-claim` (SPEC-042 §Design Decisions D5, reviews S1+T2) does
 *   NOT apply that same short-circuit to its `noAnchorOverlap` predicate — ONLY
 *   `upstreamApproved` is gated by `ctx.hasSpecParent === true`. `noAnchorOverlap`
 *   runs for EVERY task whose plan bundle resolved, spec ancestor or not (a
 *   top-level/prd-parented plan is the common case where orchestrator discipline
 *   was previously the ONLY protection). The original draft short-circuited BOTH
 *   predicates identically to `plan-promote`'s shape — that was a hole two
 *   independent adversarial-review lenses (schema-seams and testability) each
 *   flagged separately; see AC-S3-3's "plan with NO spec ancestor + fresh foreign
 *   overlap → still blocked" regression scenario.
 *
 * @invariant SPEC-058's two new predicates share ONE resolved-profile field
 *   (`ctx.verificationProfile`) across TWO checkpoints, populated by the caller
 *   from TWO DIFFERENT spec_kinds: `spec-promote`'s `oracleCoverage` resolves
 *   the CANDIDATE spec's OWN spec_kind (checking its declared ACs against its
 *   own floor); `plan-promote`'s `requiresUatDeclared` resolves the plan's
 *   ANCESTOR spec's spec_kind (checking whether the plan itself opted in).
 *   Both predicates treat a `null`/`undefined` profile identically — vacuous
 *   pass (§Design Decisions D1) — never a second "unconfigured" error path.
 *   Config-reading (which the module's first invariant forbids here) is
 *   delegated to `GateEnforcer.resolveVerificationProfile`/`isOracleCoverage
 *   Enabled`/`isRequiresUatEnabled`, called by the caller BEFORE building ctx.
 *   `spec-promote`'s BASE predicate, `acCountMeetsFloor` (task-spec-promote-base-
 *   1-ac-rule-is-spec-kind-agnostic-spec-080), ALSO reads the SAME
 *   `ctx.verificationProfile` the candidate spec's `oracleCoverage` already
 *   consumes — `profile.min_acs` (absent → the pre-existing default floor of 1,
 *   `DEFAULT_MIN_ACS`), never a second, independently-resolved profile field.
 *
 * Source: IoC vertical-slice tech-spec §4.1/§5.1/§11; SPEC-042 §Design Decisions D5;
 *   SPEC-058 §Module Boundary, §Design Decisions D2-D5.
 */

import {
  extractHeldClaim,
  extractFileAnchors,
  isClaimStale,
  lintAcQuantifiability,
  checkOracleCoverage,
  type AcceptanceCriterion,
  type AcCiteFeedingPack,
  type DocRecord,
  type LoreError,
  type VerificationProfile,
  type ReviewDecision,
  specAcceptanceCriteriaSchema,
  type LockState,
} from "@lore/core";
import {
  parentLegal,
  specKindValid,
  upstreamApproved,
  upstreamHasAcceptanceCriteria,
  noAnchorOverlap,
  acQuantifiable,
  acCountMeetsFloor,
  uatP0Accepted,
  oracleCoverage,
  requiresUatDeclared,
  verifyReachability,
  acScopeRequiredAtCreate,
  acCiteLive,
  findAcCiteViolations,
  type AcCiteCandidate,
  type AcCiteRuleStates,
  findAnchorOverlapConflict,
  ANCHOR_OVERLAP_FIELD,
  AC_QUANTIFIABLE_FIELD,
  NO_ACCEPTANCE_CRITERIA_REASON,
  DEFAULT_MIN_ACS,
  ORACLE_COVERAGE_FIELD,
  SPEC_CITATION_FIELD,
  specCitesLiveRulePredicate,
  REQUIRES_UAT_FIELD,
  PLAN_CLOSE_FIELD,
  milestoneReviewCurrent,
  MILESTONE_REVIEW_FIELD,
  isNotApplicable,
  type PredicateResult,
  type ApplicablePredicateResult,
  type SiblingClaimInfo,
  type ReachabilityResult,
} from "./gate-predicates.js";
import { buildFeedingPack, renderFeedingPack } from "./gate-feeding.js";
import type { MilestoneReviewCurrency } from "./milestone-review.js";
import { uncitedSpecMessage } from "./spec-approval-citation.js";

/**
 * The five gate checkpoints (four IoC vertical-slice tech-spec §5.1 + plan-close, SPEC-054). Not every member has
 * a `checkpointRegistry` entry yet — see this module's second invariant.
 */
export type GateCheckpoint =
  | "spec-create"
  | "spec-promote"
  | "plan-promote"
  | "task-claim"
  | "plan-close"
  /**
   * SPEC-056 §Design Decisions D2/D7 — the `phase` doc-type generalization of
   * `task-claim`, registered ADDITIVELY (not a rename/removal): `task-claim`
   * stays live and unchanged for legacy task docs (AC-P-6 read tolerance) while
   * `phase-claim` gates `PhaseWorkflowService.claim` on phase docs. Both keys
   * point at the SAME checkpoint-agnostic predicate functions (`checkTaskClaim`/
   * `feedTaskOrPhaseClaim` below) — see this module's fourth invariant and
   * `checkpointRegistry`'s registration for why no logic is duplicated.
   */
  | "phase-claim"
  /**
   * SPEC-103 §Mechanisms M2 — judgment-required promote: an approve of a doc whose
   * `type` is in `workflow.review.judgment_required_types` (default `["spec","adr"]`)
   * requires an independent `review_judgments` row for the CURRENT doc version
   * (worst-decision-wins per version, D3; I1 provenance-collision check). A generic,
   * type-agnostic checkpoint (unlike `spec-promote`, which is `spec`-only) — the SAME
   * `check`/`feed` pair runs regardless of which configured type is being approved.
   */
  | "review-judgment"
  /**
   * spec-declaring-ac-scope-is-required-at-task-creation-so-the — a COMMIT-TIME
   * admission rule on `CorpusService.create`/`_createImpl` (never `set`/`approve`):
   * when a candidate task's parent plan resolves a spec-tier ancestor declaring
   * >= 1 script-mode acceptance criterion, the task must declare `extra.ac_scope`
   * (D1/D2 — any array, including an empty one) or creation is refused, naming
   * the `--ac-scope` flag and the governing spec's script-mode criterion ids
   * (D5). `--adhoc` tasks are NOT-APPLICABLE, never EXEMPT (D3) — see
   * `acScopeRequiredAtCreate`'s own JSDoc (`gate-predicates.ts`) for the full
   * vacuous-pass rationale. Deliberately NOT added to `ALL_GATE_CHECKPOINTS`
   * below — that list mirrors the ORIGINAL IoC vertical-slice tech-spec's five
   * checkpoints for SPEC-041/-043's bootstrap "armed gates" rendering, widening
   * it is a separate concern (same precedent `"review-judgment"` set above).
   */
  | "task-create"
  /**
   * spec-baseline-slice-2 §C4 (AC-BLS2-2) — the citation gate: an AC added or revised on an armed
   * branch must cite at least one rule and every cited rule must be live. A COMMIT-TIME admission rule
   * evaluated by the AC write chokepoint (`ac-write-chokepoint.ts::admitAcWrite`) on every sanctioned
   * path (`lore ac add|set|cite`, create's inline criteria) — never by `GateEnforcer`, because its
   * on/off is the three-state `workflow.gates."ac-cite".mode` (default off/report), NOT the shared
   * two-state `enabled` key whose absence means "enabled". Deliberately NOT in `ALL_GATE_CHECKPOINTS`
   * (same precedent as `"task-create"` / `"review-judgment"`).
   */
  | "ac-cite"
  /**
   * spec-documents-are-living-or-records-a-locked-record-is-never (D4/D6/D11) — the record-edit
   * gate: a rewrite of a LOCKED record (an approved spec/adr/knowledge record, a claimed task, a
   * closed plan's plan/phase) is refused. Enforced through `GateEnforcer.enforce` by
   * `RecordLockService.assertEditable`, which every rewrite path calls BEFORE it writes.
   * `workflow.gates."record-edit".enabled` (default on) is the one knob (BR-1053). Deliberately NOT
   * in `ALL_GATE_CHECKPOINTS` below — same precedent as `"task-create"` / `"review-judgment"`.
   */
  | "record-edit";

/**
 * What `record-edit` needs to know about the write it is judging. `lock` is the verdict of
 * `resolveLock` for the target — `check` fails exactly when it is a locked record.
 */
export interface RecordEditFacts {
  readonly slug: string;
  readonly type: string;
  /** The rewrite path being attempted — which `RecordEditOp` the caller is on. */
  readonly op: "content" | "kind" | "restore" | "criteria" | "phase-structure" | "ai-rewrite";
  readonly lock: LockState;
  /** Knowledge sub-type of the target, when it is a knowledge doc (selects the change path). */
  readonly subType?: string;
}

/**
 * Pre-fetched, checkpoint-agnostic input to a `CheckpointDef`'s `check` / `feed`
 * callbacks. A single `GateContext` shape is shared across all five `GateCheckpoint`s
 * (tech-spec §5.1 design contract) — every field is optional because a given
 * checkpoint's `check`/`feed` only ever reads the subset it declares in its own JSDoc.
 * Fields are grouped by the checkpoint (and callback) that consumes them.
 */
export interface GateContext {
  // -- spec-create: check() --
  /** Candidate parent doc's `type`, or `null` when no parent resolved (missing/unresolvable). */
  readonly parentType?: string | null;
  /** Candidate `extra.spec_kind`, or `undefined` when the caller omitted it. */
  readonly specKind?: string;
  /** Candidate spec body markdown. */
  readonly content?: string;

  // -- spec-create: feed() --
  /** Slug (or descriptive placeholder) of the rule doc `ruleMarkdown` was sourced from. */
  readonly ruleSource?: string;
  /** Rule doc's markdown body, already resolved (MDX-spliced) by the caller. */
  readonly ruleMarkdown?: string;
  /** Resolved parent doc's markdown body, when a parent doc was found. */
  readonly parentMarkdown?: string;

  // -- spec-promote: check() + feed() --
  /** Count of `spec.extra.acceptance_criteria` entries already declared on the target spec. */
  readonly acceptanceCriteriaCount?: number;
  /** Target spec's id/slug, as the caller supplied it — used only in `feed()`'s message. */
  readonly specIdOrSlug?: string;

  /**
   * Whether the target spec has at least one criterion citing a LIVE BR/AS rule (BR-1007), measured by
   * the CALLER with `specCitesLiveRuleInCorpus`. `false` fails `spec-promote` (the gate then agrees with
   * the approval that would refuse the same spec); `undefined` means the caller did not measure it —
   * the service paths enforce BR-1007 themselves, so the predicate is not evaluated (never read as "cites").
   */
  readonly specCitesLiveRule?: boolean;

  // -- spec-create / spec-promote: check() + feed() (AC-Quantifiability Gate spec) --
  /**
   * The candidate/target spec's own declared acceptance criteria — `resolvedExtra
   * .acceptance_criteria` (spec-create) or the target doc's existing/patched
   * `extra.acceptance_criteria` (spec-promote), already schema-validated by the
   * caller (`specAcceptanceCriteriaSchema.safeParse`). `undefined` means "none
   * declared / failed validation", which `acQuantifiable`'s vacuous-pass semantics
   * treat identically to an empty array — never a second error path here.
   */
  readonly acceptanceCriteria?: AcceptanceCriterion[];
  /**
   * `workflow.gates.<checkpoint>.ac_quantifiable.enabled` resolved by the CALLER
   * (mirrors `anchorOverlapEnabled`'s per-predicate config-knob shape) — `false`
   * skips `acQuantifiable` entirely, leaving every other predicate on the same
   * checkpoint untouched. Absent means enabled (same default philosophy as every
   * other gate config knob).
   */
  readonly acQuantifiableEnabled?: boolean;

  // -- spec-promote / plan-promote: check() + feed() (SPEC-058 verification profiles) --
  /**
   * The relevant `spec_kind`'s resolved verification profile (SPEC-058) — for
   * `spec-promote`, the CANDIDATE/TARGET spec's own `spec_kind` profile
   * (consumed by `oracleCoverage`); for `plan-promote`, the plan's ANCESTOR
   * spec's `spec_kind` profile (consumed by `requiresUatDeclared`). `null`/
   * `undefined` means unconfigured for that spec_kind — both predicates
   * vacuous-pass (§Design Decisions D1). Resolved by the CALLER via
   * `GateEnforcer.resolveVerificationProfile` (module invariant: no config
   * access here) — never re-derived from a raw `LoreConfig` in this module.
   */
  readonly verificationProfile?: VerificationProfile | null;
  /**
   * `workflow.gates."spec-promote".oracle_coverage.enabled` resolved by the
   * CALLER (SPEC-058 §Design Decisions D5, mirrors `acQuantifiableEnabled`'s
   * per-predicate config-knob shape) — `false` skips `oracleCoverage` entirely,
   * leaving spec-promote's other predicates untouched. Absent means enabled.
   */
  readonly oracleCoverageEnabled?: boolean;
  /**
   * Whether the checkpoint's plan itself declares `extra.requires_uat === true`
   * (SPEC-058 §Design Decisions D4) — consumed by `plan-promote`'s
   * `requiresUatDeclared` predicate. An explicit `false` and an absent field
   * are equivalent (BOUNDARY — only literal `true` satisfies the predicate).
   */
  readonly planRequiresUat?: boolean;
  /**
   * `workflow.gates."plan-promote".requires_uat.enabled` resolved by the
   * CALLER (SPEC-058 §Design Decisions D5) — `false` skips
   * `requiresUatDeclared` entirely, leaving upstream-approval/AC-declared
   * gating untouched. Absent means enabled.
   */
  readonly requiresUatEnabled?: boolean;

  // -- plan-promote / task-claim: check() --
  /**
   * Whether the checkpoint's plan (the plan itself, for `plan-promote`; the task's
   * parent plan, for `task-claim`) has a spec-typed ancestor at all — i.e. whether
   * `CorpusService.getPlanBundle`'s `spec` field is populated. `false` means the plan
   * is parented directly under a `prd`, or has no parent at all: there is no upstream
   * spec edge to gate, so `check()` returns `[]` (PASS) without inspecting
   * `parentSpec` (see this module's third invariant above).
   */
  readonly hasSpecParent?: boolean;
  /**
   * The resolved ancestor spec's `{type, status, extra, deleted_at}`, present iff
   * `hasSpecParent` is `true`. Shaped to satisfy BOTH `upstreamApproved`
   * (`{type, status, deleted_at}`) and `upstreamHasAcceptanceCriteria` (`{extra}`)
   * without the caller building two separate projections of the same doc.
   * `deleted_at` (SPEC-... soft-deleted-upstream fix) is threaded straight from
   * `CorpusService.getPlanBundle`'s `DocRecord` — `softDelete` never touches
   * `status`, so a soft-deleted `approved` spec would otherwise silently keep
   * passing `upstreamApproved` forever; `deleted_at` is what lets that predicate
   * tell the two apart.
   */
  readonly parentSpec?: {
    type: string;
    status: string;
    extra: Record<string, unknown>;
    deleted_at: string | null;
  };
  /**
   * Count of `verify.mode === "script"` acceptance criteria declared on
   * `parentSpec` (spec-verify-reachability-plan-promote-early-warning §Scope
   * M1/M2) — the SAME field `verifyReachability` consumes for BOTH
   * `plan-promote`'s early-warning advisory (`planPromoteReachabilityAdvisory`
   * below; §Design Decisions D2: one shared derivation). `undefined` when `hasSpecParent` is
   * not `true`, or the caller never resolved it — `verifyReachability` treats
   * that identically to `0` (module invariant on that function, gate-
   * predicates.ts).
   */
  readonly parentSpecScriptAcCount?: number;

  // -- plan-promote / task-claim: feed() --
  /**
   * Pointer to the resolved ancestor spec for the feeding-pack message — slug/title/
   * status only, never the spec's full content (pointers-not-dump, mirroring
   * `gate-feeding.ts`'s module invariant). Present whenever `parentSpec` is.
   */
  readonly parentSpecPointer?: { slug: string; title: string; status: string };
  /** Target plan/task's id/slug, as the caller supplied it — used only in `feed()`'s message. */
  readonly targetIdOrSlug?: string;

  // -- task-claim: check() + feed() (SPEC-042 §Design Decisions D5) --
  /** The actor attempting the claim — populated UNCONDITIONALLY (see this module's fourth invariant). */
  readonly candidateBy?: string;
  /** The target task's own declared (normalized) `file_anchors` — populated UNCONDITIONALLY. */
  readonly candidateAnchors?: string[];
  /**
   * Every OTHER task in the same plan holding a claim (fresh or stale — staleness
   * is precomputed HERE by the caller from the SAME `nowIso` the target claim's
   * own conflict check uses, D5 seam pinning) — populated UNCONDITIONALLY
   * whenever a plan bundle resolved, regardless of `hasSpecParent` (fourth
   * module invariant).
   */
  readonly siblingClaims?: SiblingClaimInfo[];
  /**
   * `workflow.gates."task-claim".anchor_overlap.enabled` resolved by the CALLER
   * (SPEC-042 D6) — `false` skips `noAnchorOverlap` entirely, leaving
   * `upstreamApproved` untouched. Absent means enabled (same default philosophy
   * as every other gate config knob).
   */
  readonly anchorOverlapEnabled?: boolean;
  /**
   * The claimant's run (BR-1056), `null`/absent = no run. `noAnchorOverlap` compares holders by run only; a missing
   * run is never equal to another missing run. Populated by the claim services and `lore gate task-claim`.
   */
  readonly candidateRun?: string | null;

  // -- task-create: check() (spec-declaring-ac-scope-is-required-at-task-creation-so-the) --
  /**
   * Whether the CANDIDATE task's own (not-yet-persisted) `extra.ac_scope` key is
   * present at all — any array, INCLUDING an empty one (D2: a decision, never a
   * non-empty claim). Populated by the CALLER (`CorpusService._createImpl`) from
   * the schema-validated `CreateDocInput.extra` it already has in hand — no
   * extra IO. Reuses `hasSpecParent`/`parentSpecScriptAcCount`/`parentSpec`/
   * `parentSpecPointer` from the `task-claim`/`plan-promote` sections above
   * (SAME fields, same "the task's parent plan's spec ancestor" semantics) —
   * this checkpoint adds no new upstream-resolution fields, only this one
   * candidate-side signal.
   */
  readonly candidateAcScopeDeclared?: boolean;

  // -- plan-close: check() + feed() (SPEC-054) --
  /**
   * Whether the plan being closed opted IN to the UAT gate (`plan.extra.requires_uat
   * === true`). `false`/absent short-circuits `checkPlanClose` to `[]` (vacuous pass)
   * BEFORE its predicate runs — the same "no upstream ⇒ vacuous pass" shape
   * `plan-promote` uses for `hasSpecParent`. Only a plan that explicitly demands
   * acceptance is gated; every existing plan archives unchanged (SPEC-054 D2).
   */
  readonly requiresUat?: boolean;
  /** Whether ANY UAT verdict is linked (`informs`) to the plan — resolved by the caller
   *  (`CorpusService.getLatestUatVerdict`). */
  readonly uatVerdictPresent?: boolean;
  /** `isP0Accepted` of the LATEST linked UAT verdict (SPEC-054 D4) — resolved by the caller;
   *  meaningless when `uatVerdictPresent` is false. */
  readonly uatP0Accepted?: boolean;
  /** The latest verdict's uncovered P0 requirement ids, for the feeding-pack message only. */
  readonly uatUncoveredP0?: string[];

  // -- plan-close: check() + feed() (BR-1372, milestone review) --
  /**
   * What the plan's stored milestone reviews say about its CURRENT state (`assessMilestoneCurrency`,
   * resolved by `CorpusService.set`). `undefined` = the caller never resolved it: `checkPlanClose` then refuses
   * as `absent` — a close with no resolved review state is never read as a pass.
   */
  readonly milestoneReview?: MilestoneReviewCurrency;

  // -- review-judgment: check() + feed() (SPEC-103 §Mechanisms M2) --
  /**
   * The doc's CURRENT-version `review_judgments` decisions, ALREADY narrowed by the
   * caller (`ReviewService.enforceApprovalGate`) to exclude any judgment whose judge
   * tuple collides with `doc.extra.ai_provenance` (I1) — `checkReviewJudgment` (this
   * module) never itself reads a judge tuple or an ai_provenance value; it only sees
   * the SURVIVING, independent decisions. `undefined`/`[]` means "no independent
   * judgment exists for the current version" — see `reviewJudgmentProvenanceCollision`
   * for how the feeding message distinguishes "none at all" from "only collided ones".
   */
  readonly reviewJudgmentDecisions?: ReviewDecision[];
  /**
   * `true` iff the caller found >=1 CURRENT-version judgment that collided with
   * `doc.extra.ai_provenance` (I1) — populated REGARDLESS of whether any independent
   * judgment also exists, but only changes `checkReviewJudgment`'s OUTCOME when
   * `reviewJudgmentDecisions` is empty (a collision alongside a passing independent
   * judgment is not itself a failure — I1 only excludes the colliding judgment from
   * counting, it never demotes an otherwise-sufficient independent one). Consumed by
   * `feedReviewJudgment` to name the collision explicitly (AC-TIER-6) rather than
   * rendering the generic "no judgment at all" message.
   */
  readonly reviewJudgmentProvenanceCollision?: boolean;
  /**
   * `true` iff the caller found >=1 independent CURRENT-version `approve` judgment marked
   * `truncated` (made on cut input) and EXCLUDED it from `reviewJudgmentDecisions` (BR-269): such a judgment
   * can never be the approving one. Changes the outcome only when `reviewJudgmentDecisions` is empty, where it
   * selects {@link JUDGMENT_INPUT_TRUNCATED_REASON} over the generic "no judgment" failure.
   */
  readonly reviewJudgmentTruncatedApproval?: boolean;
  /**
   * Every `blocking_questions` entry carried by the caller's CURRENT-version,
   * provenance-independent `escalate` judgments, in judgment order, concatenated
   * verbatim (spec-an-escalate-blocks-approval-for-every-doc-type-and-the D4). Read
   * ONLY by `feedReviewJudgment`, and only on a `JUDGMENT_ESCALATED` denial — a
   * `reject`-worst denial renders the reject message and must never leak an
   * escalate's questions into it.
   *
   * `[]` and `undefined` render IDENTICALLY (the explicit "no blocking questions were
   * recorded" line, D4's defect case): the only production caller
   * (`ReviewService.enforceJudgmentRequiredGate`) ALWAYS populates this field when it
   * builds a `review-judgment` context, so an absent value cannot mean "the caller
   * had questions but omitted them" — it can only mean the escalating judgment named
   * none, which is the same state `[]` describes.
   */
  readonly reviewJudgmentBlockingQuestions?: readonly string[];

  // -- ac-cite (spec-baseline-slice-2 §C4; read by checkAcCite / feedAcCite) --
  /** The added/revised criteria offered to the citation gate (never untouched legacy ones). */
  readonly citeCandidates?: readonly AcCiteCandidate[];
  /** Lifecycle of every rule the baseline leaves list; an id absent from it is dangling. */
  readonly citeRuleStates?: AcCiteRuleStates;
  /** How to satisfy the gate — rendered by `feedAcCite`; computed by the caller (it needs store reads). */
  readonly citeFeedingPack?: AcCiteFeedingPack;

  // -- record-edit: check() + feed() (spec-documents-are-living-or-records D4/D6/D18) --
  /**
   * Facts about the record a rewrite targets, gathered by the CALLER
   * (`RecordLockService.assertEditable`) — never derived here. `undefined` means the caller did not
   * measure the lock, which `checkRecordEdit` treats as a failure (an unmeasured lock must not read
   * as "editable").
   */
  readonly recordEdit?: RecordEditFacts;

  // -- ENFORCER-ONLY (every checkpoint) — never read by check()/feed() --
  /**
   * The candidate/target doc's REAL resolved id (`DocRecord.id`, a ULID) —
   * populated by the CALLER for every checkpoint that has one
   * (task-derive-lore-feed-s-checkpoint-set-from-the-registry-make, AC-FR-8/D7).
   * Consumed ONLY by `GateEnforcer`'s own audit-trace write on a PASSING
   * evaluation (`gate_passed`'s `doc_id`) — no `check`/`feed` function in this
   * module reads it, and it MUST NEVER be conflated with `specIdOrSlug`/
   * `targetIdOrSlug` above: those are "as the caller supplied it" DISPLAY
   * strings (in production, always the doc's SLUG, e.g. `existing.slug`/
   * `doc.slug`), never guaranteed to be the doc's real id. `lore audit <doc>
   * --json` resolves `<doc>` to its real id (`CorpusService.resolve`, ALWAYS
   * `.id`, never the slug — verified empirically) before filtering by exact
   * `doc_id` match; a `doc_id` column holding a slug would never match that
   * filter, silently making the audited trace unreachable from the exact
   * surface AC-FR-8 requires it be queryable from. For `spec-create`/
   * `task-create` (a not-yet-persisted candidate), this is the id the caller
   * already generated for the row it is about to insert — a real id from the
   * moment `enforce()` returns `ok`, since the caller only proceeds to
   * actually create the doc after a passing verdict.
   */
  readonly targetDocId?: string;
}

/**
 * One gate checkpoint's pure decision logic: the deterministic predicate checks to
 * run, and how to render the feeding-pack text when at least one of them fails.
 */
export interface CheckpointDef {
  /** This checkpoint's key — always matches the `checkpointRegistry` map key it's registered under. */
  readonly id: GateCheckpoint;
  /**
   * Runs every deterministic predicate for this checkpoint against `ctx`, returning
   * ALL results (passes, failures, AND not-applicable verdicts) in a fixed order.
   * PURE — see module invariant. The return type is the WIDEST possible shape
   * (`ApplicablePredicateResult[]`) because this ONE field type is shared across
   * every registered checkpoint — only `plan-close` (`checkPlanClose`) ever
   * actually produces a `PredicateNotApplicable` member (via
   * `attestationFloor`); every other checkpoint's `check` function keeps
   * returning bare `PredicateResult[]`, which is structurally assignable here
   * unchanged (function return-type covariance) — spec-plan-close-predicates-
   * measure-invariants-an-applicability §Design Decisions D1.
   */
  readonly check: (ctx: GateContext) => ApplicablePredicateResult[];
  /**
   * Renders the feeding-pack text to print when this checkpoint is blocked.
   * `failures` is expected to be the failing subset of some `check(ctx)` call
   * (see `selectFailures`) — implementations tolerate an unfiltered array too
   * (they re-filter internally), so passing the full `check(ctx)` result is safe.
   */
  readonly feed: (ctx: GateContext, failures: PredicateResult[]) => string;
}

/**
 * The "block iff any predicate failed" aggregate rule (IoC vertical-slice tech-spec
 * §4.1 INV1) — the one place both `lore gate`'s adapter code and this module's tests
 * apply it, so it can never drift between a checkpoint's `check` output and the
 * exit-code decision built on top of it.
 *
 * @param results - The full output of some `CheckpointDef.check(ctx)` call —
 *   accepts the widened `ApplicablePredicateResult[]` shape so every checkpoint's
 *   `.check()` output (whether or not it can ever contain a not-applicable
 *   member) can be passed here directly, without the caller narrowing first.
 * @returns `true` when at least one result is `{ok: false}`; `false` otherwise
 *   (including the empty-array case, and a `PredicateNotApplicable` member —
 *   spec-plan-close-predicates-measure-invariants-an-applicability §Design
 *   Decisions D1/D2: a not-applicable verdict NEVER blocks).
 * @example
 * isCheckpointBlocked([{ok: true}, {ok: false, reason: "X"}]); // => true
 * isCheckpointBlocked([{ok: true}]);                            // => false
 * @example
 * isCheckpointBlocked([{notApplicable: true, reason: "referent-absent", referent: "spec-x"}]); // => false
 */
export function isCheckpointBlocked(results: ApplicablePredicateResult[]): boolean {
  return results.some((r) => !isNotApplicable(r) && !r.ok);
}

/**
 * Narrows `results` to only its failing entries, preserving order — the `failures`
 * shape a `CheckpointDef.feed` expects. A `PredicateNotApplicable` member is NEVER
 * a failure (spec-plan-close-predicates-measure-invariants-an-applicability
 * §Design Decisions D1) — it is excluded here the same way a `{ok: true}` pass
 * already was, so every pre-existing caller of this function (every checkpoint
 * that can never produce a not-applicable member) sees byte-identical behavior.
 *
 * @example
 * selectFailures([{ok: true}, {ok: false, reason: "X"}]); // => [{ok: false, reason: "X"}]
 * @example
 * selectFailures([{notApplicable: true, reason: "no-evidence", referent: "plan-x"}]); // => []
 */
export function selectFailures(
  results: ApplicablePredicateResult[],
): Array<{ ok: false; reason: string; field?: string; rule?: `BR-${number}` }> {
  return results.filter(
    (r): r is { ok: false; reason: string; field?: string; rule?: `BR-${number}` } => !isNotApplicable(r) && !r.ok,
  );
}

/**
 * The literal token every vacuity notice opens with (task-plan-close-must-block-
 * when-the-coverage-conjunct-is-scope, M2) — a LONE, greppable token so an
 * operator, a log scan, or a test can key on it without matching a remembered
 * phrase (repo CLAUDE.md's contiguous-substring lesson: a phrase-keyed matcher
 * degrades silently to no-match, and no-match is indistinguishable from clean).
 */
export const VACUOUS_CHECKPOINT_NOTICE_PREFIX = "VACUOUS-GATE";

/**
 * Describes a checkpoint run in which EVERY conjunct returned `notApplicable` —
 * the run measured NOTHING, yet is about to return the same `ok` a genuinely
 * measured pass returns (task-plan-close-must-block-when-the-coverage-conjunct-
 * is-scope, M2).
 *
 * This exists because "no failures" is a two-valued reading of a three-valued
 * outcome: `selectFailures(results).length === 0` is true both for "every
 * predicate ran and passed" and for "no predicate applied at all". Thirteen
 * `gate_not_applicable` audit rows and zero denials in one session (2026-07-31)
 * is a signature no surface reported, because every surface was reading the
 * failure list. Callers must therefore assert this STRING, never re-derive the
 * condition from an empty failure list — re-deriving it is the defect.
 *
 * ⛔ Known limit, stated rather than papered over: a conjunct that passes
 * VACUOUSLY on its own internal carve-out and returns a bare `{ok: true}`
 * counts as APPLICABLE here, suppressing the notice. This detector is a
 * floor — it catches a fully dark gate, not every partially dark one.
 * Widening it requires each predicate (or, as `assessmentFreshness` was
 * migrated, its `checkPlanClose` call site) to distinguish "passed" from
 * "passed because there was nothing to check" — the `PredicateNotApplicable`
 * migration §Scope defers this for predicates not yet touched.
 * `assessmentFreshness` was this JSDoc's OWN named example of the gap (no
 * linked assessment, or no task activity, rendering identically to a
 * measured pass) until task-report-why-each-plan-close-predicate-passed-so-
 * a-vacuous closed it: `checkPlanClose` now pushes a `PredicateNotApplicable`
 * (`reason: "no-evidence"`) for that conjunct BEFORE calling the predicate at
 * all, rather than letting it silently return `{ok: true}` for missing data.
 * A FUTURE predicate added to this checkpoint with its own unmigrated
 * internal vacuous-pass carve-out still has this limit until it, too, is
 * given an explicit applicability check.
 *
 * @param checkpoint - The checkpoint whose predicates produced `results` —
 *   named in the notice so a log line is self-describing.
 * @param results - The FULL output of that checkpoint's `check(ctx)` call
 *   (never a pre-filtered subset — filtering is what hides the condition).
 * @returns The notice string when `results` is non-empty and every member is a
 *   {@link PredicateNotApplicable}; `null` otherwise (including the empty-array
 *   case: a checkpoint that ran no predicates at all is a DIFFERENT fact, and
 *   reporting it as vacuity would cry wolf on every opt-out checkpoint).
 * @example
 * describeCheckpointVacuity("plan-close", [{ ok: true }]); // => null
 * @example
 * describeCheckpointVacuity("plan-close", [
 *   { notApplicable: true, reason: "no-evidence", referent: "plan-x" },
 * ]);
 * // => 'VACUOUS-GATE: checkpoint "plan-close" returned no verdict — all 1 predicate(s) …'
 */
export function describeCheckpointVacuity(
  checkpoint: GateCheckpoint,
  results: readonly ApplicablePredicateResult[],
): string | null {
  if (results.length === 0) return null;
  // reason: an explicit count comparison rather than `results.every(isNotApplicable)`
  // — `every`'s `this is S[]` narrowing overload is easy to defeat with an
  // incidental type change, and a silently un-narrowed callback here would
  // degrade to "always vacuous". The count is unambiguous at runtime and at
  // review time.
  const inapplicable = results.filter(isNotApplicable);
  if (inapplicable.length !== results.length) return null;

  const verdicts = inapplicable.map((r) => `${r.reason}:${r.referent}`).join(", ");
  return (
    `${VACUOUS_CHECKPOINT_NOTICE_PREFIX}: checkpoint "${checkpoint}" returned no verdict — ` +
    `all ${inapplicable.length} predicate(s) reported notApplicable (${verdicts}). ` +
    `Nothing was measured, so this pass is not evidence of the checkpoint's invariant.`
  );
}

/**
 * spec-create's two structural predicates (`parentLegal` / `specKindValid`,
 * `gate-predicates.ts`), then `acQuantifiable` when enabled.
 *
 * reason: BR-4's `hasSkeleton` (at least one `## ` heading) is retired — a heading count is no longer the structure
 * check. A templated spec is validated against its approved template at write (fields and dimension answers) and its
 * cross-field checks run at promote (spec-every-document-is-stored-as-structured-fields-validated-by, AC-ST-1/3).
 */
function checkSpecCreate(ctx: GateContext): PredicateResult[] {
  const parent =
    ctx.parentType !== undefined && ctx.parentType !== null ? { type: ctx.parentType } : null;
  const results = [parentLegal(parent), specKindValid(ctx.specKind)];
  if (ctx.acQuantifiableEnabled !== false) {
    results.push(acQuantifiable(ctx.acceptanceCriteria));
  }
  return results;
}

/**
 * Renders the per-AC detail lines for an `acQuantifiable` predicate failure — one
 * `AcQualityFinding.message` per offending `block` finding (already names the AC id,
 * the offending word, and the fix — see `lintAcQuantifiability`'s own JSDoc). Returns
 * `[]` when the predicate didn't fail (so callers can unconditionally spread the
 * result into a `missing` list with no extra branching). Shared by `feedSpecCreate`
 * and `feedSpecPromote` — both checkpoints render the SAME per-AC detail shape.
 */
function acQuantifiableDetailLines(ctx: GateContext, failures: PredicateResult[]): string[] {
  const failed = failures.some((f) => !f.ok && f.field === AC_QUANTIFIABLE_FIELD);
  if (!failed) {
    return [];
  }
  return lintAcQuantifiability(ctx.acceptanceCriteria ?? [])
    .filter((finding) => finding.severity === "block")
    .map((finding) => finding.message);
}

/**
 * Renders the per-missing-oracle detail lines for an `oracleCoverage` predicate
 * failure (SPEC-058) — one line per `checkOracleCoverage` finding, naming the
 * missing oracle kind and its repair hint. Returns `[]` when the predicate
 * didn't fail, OR no profile was resolved (both make `checkOracleCoverage`
 * moot) — mirrors `acQuantifiableDetailLines`'s "safe to unconditionally
 * spread" contract. Shared by `feedSpecPromote` only (oracleCoverage is
 * spec-promote-exclusive, §Design Decisions D2).
 */
function oracleCoverageDetailLines(ctx: GateContext, failures: PredicateResult[]): string[] {
  const failed = failures.some((f) => !f.ok && f.field === ORACLE_COVERAGE_FIELD);
  if (!failed || ctx.verificationProfile === null || ctx.verificationProfile === undefined) {
    return [];
  }
  return checkOracleCoverage(ctx.acceptanceCriteria ?? [], ctx.verificationProfile).map(
    (finding) => `missing oracle "${finding.missing_oracle}" — ${finding.hint}`,
  );
}

/**
 * spec-create's feeding-pack renderer — a thin `buildFeedingPack` + `renderFeedingPack`
 * pipe (both already pure); this function adds no IO, it only supplies the pre-fetched
 * `ctx` fields those functions expect, mirroring `gate.ts`'s former inline assembly.
 */
function feedSpecCreate(ctx: GateContext, failures: PredicateResult[]): string {
  const pack = buildFeedingPack({
    ruleSource: ctx.ruleSource ?? "unknown",
    ruleMarkdown: ctx.ruleMarkdown ?? "",
    ...(ctx.parentMarkdown !== undefined ? { parentMarkdown: ctx.parentMarkdown } : {}),
    missing: [...selectFailures(failures).map((f) => f.reason), ...acQuantifiableDetailLines(ctx, failures)],
  });
  return renderFeedingPack(pack);
}

/**
 * spec-promote's base predicate: a candidate/target spec must declare at least its
 * `spec_kind`'s resolved floor (`ctx.verificationProfile?.min_acs`, default
 * {@link DEFAULT_MIN_ACS} — task-spec-promote-base-1-ac-rule-is-spec-kind-agnostic-
 * spec-080) of structured acceptance criteria (`ctx.acceptanceCriteriaCount`,
 * counted by `gate.ts` via `AcService.listCriteria` before this is called).
 * Delegates the actual floor comparison to `acCountMeetsFloor` (`gate-predicates.ts`)
 * — this function only supplies the pre-fetched `ctx` fields.
 */
function checkSpecPromote(ctx: GateContext): PredicateResult[] {
  const count = ctx.acceptanceCriteriaCount ?? 0;
  const results: PredicateResult[] = [acCountMeetsFloor(count, ctx.verificationProfile)];
  if (ctx.acQuantifiableEnabled !== false) {
    results.push(acQuantifiable(ctx.acceptanceCriteria));
  }
  if (ctx.oracleCoverageEnabled !== false) {
    results.push(oracleCoverage(ctx.acceptanceCriteria, ctx.verificationProfile));
  }
  // BR-1007 — pre-flight parity with `approve` (issue #137). Pushed only when the caller measured it.
  if (ctx.specCitesLiveRule !== undefined) {
    results.push(specCitesLiveRulePredicate(ctx.specCitesLiveRule));
  }
  return results;
}

/**
 * spec-promote's feeding message. The base "no structured acceptance criteria"
 * text is identical to `gate.ts`'s former inline stderr message (trailing newline
 * included) whenever that's the only failure — byte-for-byte behavior-preserving on
 * that path, MODULO the appended `(needs >= N for spec_kind "K")` clause
 * (task-spec-promote-base-1-ac-rule-is-spec-kind-agnostic-spec-080 AC4 — the
 * denial must name the RESOLVED floor and kind, never a hardcoded "1"). `N`
 * mirrors `acCountMeetsFloor`'s own default-resolution rule exactly; `K` falls
 * back to `"unknown"` (never a fabricated kind) when the caller didn't populate
 * `ctx.specKind` — mirrors this function's pre-existing `ctx.specIdOrSlug ??
 * "unknown"` convention. When `acQuantifiable` also (or instead) failed, appends
 * the per-AC detail lines (`acQuantifiableDetailLines`) naming every offending AC
 * id, its abstract word, and the fix.
 */
function feedSpecPromote(ctx: GateContext, failures: PredicateResult[]): string {
  // BR-1007 — an uncited spec: render every OTHER failure exactly as before, then name the citation
  // refusal (same wording `approve` prints, `uncitedSpecMessage`).
  if (failures.some((f) => !f.ok && f.field === SPEC_CITATION_FIELD)) {
    const others = failures.filter((f) => f.ok || f.field !== SPEC_CITATION_FIELD);
    const citation = `Error: ${uncitedSpecMessage(ctx.specIdOrSlug ?? "unknown")}\n`;
    return others.length === 0 ? citation : feedSpecPromote(ctx, others) + citation;
  }
  const floor = ctx.verificationProfile?.min_acs ?? DEFAULT_MIN_ACS;
  const kind = ctx.specKind ?? "unknown";
  const base = `Error: spec "${ctx.specIdOrSlug ?? "unknown"}" has no structured acceptance criteria (needs >= ${floor} for spec_kind "${kind}") — add via \`lore ac add\`.\n`;
  const acLines = acQuantifiableDetailLines(ctx, failures);
  const oracleLines = oracleCoverageDetailLines(ctx, failures);
  const detailLines = [...acLines, ...oracleLines];
  const noAcceptanceCriteriaFailed = failures.some((f) => !f.ok && f.reason === NO_ACCEPTANCE_CRITERIA_REASON);

  if (detailLines.length === 0) {
    return noAcceptanceCriteriaFailed
      ? base
      : "Error: spec has an unquantified acceptance criterion.\n";
  }

  // reason: SPEC-058 REGRESSION guard — an ac_quantifiable-ONLY failure (no
  // oracle-coverage findings) keeps the EXACT pre-SPEC-058 wording byte-for-byte
  // (pinned by the pre-existing gate-spec-promote.bun.test.ts NEGATIVE case,
  // which asserts the literal substring "unquantified acceptance criterion").
  // A mixed or oracle-only failure gets the new, more general wording below —
  // there is no pre-existing test pinning THAT branch's exact text.
  if (oracleLines.length === 0) {
    const acBlock = acLines.map((line) => `- ${line}`).join("\n");
    return noAcceptanceCriteriaFailed
      ? `${base}\nAlso:\n${acBlock}\n`
      : `Error: spec "${ctx.specIdOrSlug ?? "unknown"}" has an unquantified acceptance criterion:\n${acBlock}\n`;
  }

  const detailBlock = detailLines.map((line) => `- ${line}`).join("\n");
  return noAcceptanceCriteriaFailed
    ? `${base}\nAlso:\n${detailBlock}\n`
    : `Error: spec "${ctx.specIdOrSlug ?? "unknown"}" failed spec-promote quality checks:\n${detailBlock}\n`;
}

/**
 * `plan-promote`'s two predicates: `upstreamApproved` (the ancestor spec must be
 * `approved`) then `upstreamHasAcceptanceCriteria` (it must declare ≥1 structured AC).
 * Both run — this returns ALL results (module contract), not just the first failure —
 * matching `checkSpecCreate`'s "run every predicate, don't short-circuit on the first
 * failure" shape. `ctx.hasSpecParent === false` (or absent) short-circuits to `[]`
 * BEFORE either predicate runs (third module invariant — no spec tier ⇒ vacuous pass).
 */
function checkPlanPromote(ctx: GateContext): PredicateResult[] {
  if (ctx.hasSpecParent !== true) {
    return [];
  }
  const results: PredicateResult[] = [
    upstreamApproved(ctx.parentSpec, "spec"),
    upstreamHasAcceptanceCriteria(ctx.parentSpec),
  ];
  if (ctx.requiresUatEnabled !== false) {
    results.push(requiresUatDeclared(ctx.verificationProfile, ctx.planRequiresUat === true));
  }
  return results;
}

/** Advisory marker clause of the plan-promote reachability warning: it never blocks the promote. */
export const PLAN_PROMOTE_ADVISORY_NON_BLOCKING = "does not block this promote";

/** Reachability explanation for `why === "parent-not-spec"`: the plan has no spec-tier ancestor. */
export const REACHABILITY_NO_SPEC_ANCESTOR = "this plan has no spec-tier ancestor at all";

/**
 * Human-readable explanation for one {@link ReachabilityResult.why} value —
 * the ONE place this prose is written (spec-verify-reachability-plan-promote-
 * early-warning §Design Decisions D2; `"unknown"` branch added by spec-plan-
 * closure-must-be-loud-terminality-divergence-silent §Design Decisions
 * DD-4(b)), consumed by `planPromoteReachabilityAdvisory`.
 *
 * ⛔ The `"unknown"` branch MUST NOT assert a definite corpus fact — DD-4(b)'s
 * whole point is that "the caller never told me" and "I checked and there is
 * none" are different claims, and only the latter may be rendered as a
 * negative statement about the corpus. Do not "simplify" this back to a
 * two-way ternary; that is precisely the class bug this branch removes.
 */
function describeReachabilityWhy(why: Exclude<ReachabilityResult["why"], null>): string {
  if (why === "parent-not-spec") {
    return (
      `${REACHABILITY_NO_SPEC_ANCESTOR} — \`lore verify\` requires one to ` +
      "resolve script-mode acceptance criteria from"
    );
  }
  if (why === "no-script-acs") {
    return (
      "this plan's ancestor spec declares zero script-mode acceptance criteria — " +
      "`lore verify` has nothing to run"
    );
  }
  return (
    "whether this plan has a spec-tier ancestor could not be determined — the caller " +
    "never resolved that fact, so `lore verify` reachability is unknown, not disproven"
  );
}

/**
 * `plan-promote`'s EARLY-WARNING advisory (spec-verify-reachability-plan-
 * promote-early-warning §Scope M1 / §Design Decisions D1) — a SEPARATE output
 * from `checkPlanPromote`'s verdict, never folded into its `PredicateResult[]`
 * (mirrors `GateEnforcer`'s `gate_skipped` audit entry: best-effort,
 * NEVER-blocking observability — "advisory never changes the outcome"). A
 * plan can be perfectly promotable (approved ancestor spec, >=1 declared AC)
 * and STILL be `lore verify`-unreachable (its ancestor spec has zero
 * script-mode ACs) — exactly the late-failure gap this spec closes: the
 * incompatibility used to surface only hours later, when the milestone review
 * of the plan had no `lore verify` evidence to cite, with no earlier signal.
 *
 * Consumes the `verifyReachability` derivation (§Design Decisions D2) over
 * `ctx.hasSpecParent`/`ctx.parentSpecScriptAcCount`.
 *
 * @returns `null` when `verifyReachability` reports `reachable: true`
 *   (nothing to warn about — the common case, every pre-existing
 *   `plan-promote` caller that never populated the new fields gets `null`
 *   here too, since `hasSpecParent` absent/false reads as `"parent-not-spec"`
 *   ... — see the REMARK below for why that's still correct); an advisory
 *   string naming the plan-close consequence and the two real options
 *   otherwise.
 * @remarks A plan with NO spec ancestor at all (`hasSpecParent !== true`) is
 *   ALSO `lore verify`-unreachable by definition (`verifyPlan` itself refuses
 *   it: "plan has no parent spec — nothing to verify") — this advisory fires
 *   for that case too, same as the zero-script-AC case. This is orthogonal to
 *   `checkPlanPromote`'s own "no spec tier ⇒ vacuous PASS" short-circuit
 *   (third module invariant): that short-circuit is about whether
 *   plan-promote's HARD gate applies at all; this advisory is about a
 *   DIFFERENT, later concern (plan-close attestation) that applies
 *   regardless of whether plan-promote itself blocked.
 * @example
 * planPromoteReachabilityAdvisory({ hasSpecParent: false }); // => advisory string, why: "parent-not-spec"
 * @example
 * planPromoteReachabilityAdvisory({ hasSpecParent: true, parentSpecScriptAcCount: 0 }); // => advisory string, why: "no-script-acs"
 * @example
 * planPromoteReachabilityAdvisory({ hasSpecParent: true, parentSpecScriptAcCount: 2 }); // => null
 */
export function planPromoteReachabilityAdvisory(ctx: GateContext): string | null {
  const reachability = verifyReachability(
    ctx.hasSpecParent === true ? "spec" : null,
    ctx.parentSpecScriptAcCount,
  );
  if (reachability.reachable) {
    return null;
  }
  const plan = ctx.targetIdOrSlug ?? "<plan>";
  return (
    `ADVISORY (${PLAN_PROMOTE_ADVISORY_NON_BLOCKING}): \`lore verify\` will be structurally ` +
    `unreachable for ${plan} — ${describeReachabilityWhy(reachability.why as Exclude<ReachabilityResult["why"], null>)}. ` +
    `The milestone review (\`lore assess\`, BR-1372) that gates closing this plan will then have no ` +
    `\`lore verify\` evidence to cite for correctness against the acceptance criteria. To give it some, ` +
    `parent this plan under a spec that declares >= 1 script-mode acceptance criterion ` +
    `(\`lore ac add <spec> <id> --mode script ...\`).`
  );
}

/**
 * `task-claim`'s predicates (SPEC-042 §Design Decisions D5): `noAnchorOverlap`
 * runs UNCONDITIONALLY (subject only to `ctx.anchorOverlapEnabled`, D6's
 * per-predicate config knob) — NOT gated by `hasSpecParent`, unlike
 * `upstreamApproved`, which keeps the "no spec tier ⇒ vacuous pass"
 * short-circuit `checkPlanPromote` also uses. See this module's fourth
 * invariant for why these two predicates deliberately do NOT share one
 * short-circuit.
 */
function checkTaskClaim(ctx: GateContext): PredicateResult[] {
  const results: PredicateResult[] = [];
  if (ctx.anchorOverlapEnabled !== false) {
    results.push(noAnchorOverlap(ctx.candidateAnchors, ctx.siblingClaims, ctx.candidateRun));
  }
  if (ctx.hasSpecParent === true) {
    results.push(upstreamApproved(ctx.parentSpec, "spec"));
  }
  return results;
}

/**
 * Renders a pointers-not-dump feeding pack for a `plan-promote` / `task-claim`
 * failure: a `[source: corpus <slug>, trust: team-authored]` header (via
 * `buildFeedingPack`/`renderFeedingPack`, same provenance convention every other
 * checkpoint's feed uses), the machine-readable `missing` reasons, and one line
 * naming the ancestor spec's slug/title/status — never the spec's full markdown body.
 * Shared by both checkpoints (identical shape, only the `Required:` sentence differs)
 * to avoid duplicating the `buildFeedingPack` plumbing twice.
 */
function feedUpstreamSpecCheckpoint(
  ctx: GateContext,
  failures: PredicateResult[],
  requirementSentence: string,
): string {
  const pointer = ctx.parentSpecPointer;
  const ruleMarkdown =
    pointer !== undefined
      ? `Parent spec: ${pointer.slug} — "${pointer.title}" (status: ${pointer.status}). ${requirementSentence}`
      : `(no ancestor spec resolved). ${requirementSentence}`;
  const pack = buildFeedingPack({
    ruleSource: pointer !== undefined ? `corpus ${pointer.slug}` : "corpus (unresolved)",
    ruleMarkdown,
    missing: selectFailures(failures).map((f) => f.reason),
  });
  return renderFeedingPack(pack);
}

/**
 * Renders the `requires_uat`-specific feeding pack (SPEC-058 §Design Decisions
 * D4) — names the concrete requirement (the ancestor spec's configured
 * verification profile demands UAT) and the recovery: `lore set <plan>
 * --requires-uat`, which merges `extra.requires_uat: true` into the plan's
 * existing extra (spec-remove-the-lore-mcp-server D3, AC-RMCP-4).
 *
 * @remarks History: the pack once pointed at the MCP `lore_set` tool's wholesale
 *   `extra` replacement, which wiped a plan's `extra.phases` (2026-07-25
 *   incident). The CLI flag merges, so the destructive path no longer exists;
 *   `CorpusService.set` (`findDroppedStructuredExtraField`) still rejects a
 *   patch that drops `extra.phases` as a second line of defense.
 */
function feedRequiresUat(ctx: GateContext, failures: PredicateResult[]): string {
  const target = ctx.targetIdOrSlug ?? "<plan>";
  const pack = buildFeedingPack({
    ruleSource: "corpus (verification profile)",
    ruleMarkdown:
      "Required for plan-promote: the ancestor spec's configured verification profile " +
      'requires UAT — this plan must declare `extra.requires_uat: true` before it may be ' +
      "promoted. Recovery: run `lore set " + target + " --requires-uat` — it merges " +
      "`requires_uat: true` into the plan's existing `extra`, keeping every other key (e.g. `phases`).",
    missing: selectFailures(failures).map((f) => f.reason),
  });
  return renderFeedingPack(pack);
}

/**
 * `plan-promote`'s feeding message — dispatches to {@link feedRequiresUat} when
 * the requires-uat predicate failed (SPEC-058, its own dedicated, recovery-
 * bearing message), else falls back to the pre-existing upstream-spec-approval
 * message (unchanged from before SPEC-058) — mirrors `feedTaskClaim`'s
 * per-field dispatch shape.
 */
function feedPlanPromote(ctx: GateContext, failures: PredicateResult[]): string {
  const requiresUatFailed = failures.some((f) => !f.ok && f.field === REQUIRES_UAT_FIELD);
  if (requiresUatFailed) {
    return feedRequiresUat(ctx, failures);
  }
  return feedUpstreamSpecCheckpoint(
    ctx,
    failures,
    'Required for plan-promote: the ancestor spec must be "approved" or "active" and declare ' +
      "at least one structured acceptance criterion (`lore ac add`).",
  );
}

/**
 * Renders the anchor-overlap-specific feeding pack (SPEC-042 §Design Decisions
 * D5, review U6) — names the conflicting sibling task's slug, holder, staleness
 * age is implicit (only FRESH siblings can conflict, by construction of
 * `noAnchorOverlap`), the overlapping path pairs, WHY it conflicts, AND a literal
 * copy-pasteable recovery command. Pointers only — never the sibling task's body
 * content.
 *
 * The offending sibling comes from `findAnchorOverlapConflict`
 * (`gate-predicates.ts`) — the SAME scan `noAnchorOverlap` reaches its verdict
 * with. This function previously re-implemented those skip rules, including the
 * retired `sibling.by === candidateBy → skip` line; that copy would have printed
 * "no specific conflicting sibling could be identified" for every same-actor
 * cross-session refusal task-two-concurrent-orchestrators-both-resolve-to-agent-main
 * adds, i.e. a refusal naming nothing to repair.
 *
 * @param checkpointLabel - The checkpoint id driving this render (`"task-claim"`
 *   or `"phase-claim"`, SPEC-056 D2/D7) — threaded through so the SAME function
 *   renders the correct checkpoint name for either caller (no duplicated logic).
 */
function feedAnchorOverlap(
  ctx: GateContext,
  failures: PredicateResult[],
  checkpointLabel: string,
): string {
  const conflict = findAnchorOverlapConflict(ctx.candidateAnchors, ctx.siblingClaims, ctx.candidateRun);
  let conflictLine = "(no specific conflicting sibling could be identified)";
  if (conflict !== undefined) {
    const { sibling, pairs } = conflict;
    const pathsStr = pairs.map(([a, b]) => `${a} × ${b}`).join(", ");
    conflictLine =
      `Conflicting task: ${sibling.slug} — "${sibling.title}" — held by ${sibling.by}. ` +
      `Overlapping paths: ${pathsStr}. ` +
      `Held by a DIFFERENT run (this run: ${ctx.candidateRun ?? "(none)"}, holder's run: ` +
      `${sibling.harness_run ?? "(none)"}) — a shared name does not make two runs one holder. ` +
      `Recovery: \`lore release ${sibling.slug} --force\`; sessions register their own run via the ` +
      `agent integration (\`lore setup\`).`;
  }
  const pack = buildFeedingPack({
    ruleSource: "corpus (sibling task claims)",
    ruleMarkdown:
      `Required for ${checkpointLabel}: declared file_anchors must not overlap a FRESH claim held ` +
      `by a different RUN on another task in the same plan (a shared actor string is not ` +
      `evidence of a shared run). ${conflictLine}`,
    missing: selectFailures(failures).map((f) => f.reason),
  });
  return renderFeedingPack(pack);
}

/**
 * `task-claim`'s (and, since SPEC-056 D2/D7, `phase-claim`'s) feeding message —
 * dispatches to {@link feedAnchorOverlap} when the anchor-overlap predicate
 * failed (SPEC-042 D5 — its own dedicated, conflict-detail-bearing message), else
 * falls back to the upstream-spec-approval message. Checkpoint-agnostic
 * (`checkpointLabel` threaded through) so `feedTaskClaim`/`feedPhaseClaim`
 * below are both thin one-line wrappers over this shared implementation —
 * SPEC-056's CONTRACT NOTE §2 ("ONE-LINE registry addition, not a
 * reimplementation") extended to the `feed()` half, not just `check()`.
 */
function feedTaskOrPhaseClaim(
  ctx: GateContext,
  failures: PredicateResult[],
  checkpointLabel: string,
): string {
  const anchorFailed = failures.some((f) => !f.ok && f.field === ANCHOR_OVERLAP_FIELD);
  if (anchorFailed) {
    return feedAnchorOverlap(ctx, failures, checkpointLabel);
  }
  return feedUpstreamSpecCheckpoint(
    ctx,
    failures,
    `Required for ${checkpointLabel}: the ancestor spec must be "approved" or "active".`,
  );
}

/** `task-claim`'s feeding message — see {@link feedTaskOrPhaseClaim}. */
function feedTaskClaim(ctx: GateContext, failures: PredicateResult[]): string {
  return feedTaskOrPhaseClaim(ctx, failures, "task-claim");
}

/**
 * `phase-claim`'s feeding message (SPEC-056 D2/D7) — see
 * {@link feedTaskOrPhaseClaim}.
 */
function feedPhaseClaim(ctx: GateContext, failures: PredicateResult[]): string {
  return feedTaskOrPhaseClaim(ctx, failures, "phase-claim");
}

/**
 * `plan-close`'s predicates (BR-1372): the UAT verdict for a plan that opted in (`requires_uat`), and the plan's
 * milestone review — the latest stored review must be of the plan's current state with no failing dimension.
 * Nothing else is measured at close: per-task attestation is enforced at `lore done`, and the review's correctness
 * and snapshot-accuracy dimensions read the attested evidence and the cited-rule state.
 *
 *   - `uatP0Accepted` — OPT-IN (SPEC-054): only runs when `ctx.requiresUat === true`.
 *   - `milestoneReviewCurrent` — ALWAYS runs; `ctx.milestoneReview` absent counts as `absent` (refuse).
 */
function checkPlanClose(ctx: GateContext): ApplicablePredicateResult[] {
  const results: ApplicablePredicateResult[] = [];
  if (ctx.requiresUat === true) {
    results.push(uatP0Accepted(ctx.uatVerdictPresent === true, ctx.uatP0Accepted === true));
  }
  const review = ctx.milestoneReview ?? { state: "absent" as const };
  if (review.state === "no-tasks") {
    // reason: a plan with no member task landed nothing to review; reported as not-applicable (audited and printed as
    // a vacuity notice), never as a pass.
    results.push({ notApplicable: true, reason: "no-evidence", referent: ctx.targetIdOrSlug ?? "<plan>" });
  } else {
    results.push(milestoneReviewCurrent(review));
  }
  return results;
}

/** The milestone-review refusal text: what is wrong with the stored review and the command that fixes it. */
function describeMilestoneReviewFailure(ctx: GateContext): string {
  const slug = ctx.targetIdOrSlug ?? "<plan>";
  const review = ctx.milestoneReview ?? { state: "absent" as const };
  switch (review.state) {
    case "pass":
    case "no-tasks":
    case "accepted":
      return "";
    case "absent":
      return `No milestone review exists for this plan. Run \`lore assess ${slug}\`, then close again.`;
    case "stale":
      return (
        `The latest milestone review (${review.reviewSlug}) judged an older state of this plan ` +
        `(${review.reviewed}); the plan is now ${review.current}. Run \`lore assess ${slug}\` again, then close.`
      );
    case "failed":
      return (
        `The latest milestone review (${review.reviewSlug}) failed on: ${review.failed.join(", ")}. ` +
        `Fix what it names, then run \`lore assess ${slug}\` again. Or close it as accepted with known defects: ` +
        `every failed dimension needs an OPEN GitHub issue linked to the plan that records that dimension ` +
        `(\`lore assess ${slug} --file-issues\` files the grouped issues and links them with that record).`
      );
  }
}

/**
 * `plan-close`'s feeding message: the UAT recovery when `uatP0Accepted` failed (SPEC-054), and the milestone-review
 * recovery when `milestoneReviewCurrent` failed (BR-1372); both are named when both failed.
 */
function feedPlanClose(ctx: GateContext, failures: PredicateResult[]): string {
  const uatFailed = failures.some((f) => !f.ok && f.field === PLAN_CLOSE_FIELD);
  const reviewFailed = failures.some((f) => !f.ok && f.field === MILESTONE_REVIEW_FIELD);
  const parts: string[] = [];
  if (reviewFailed) {
    parts.push(`Required for plan-close (BR-1372): a current, passing milestone review. ${describeMilestoneReviewFailure(ctx)}`);
  }
  if (uatFailed) {
    const uncovered = ctx.uatUncoveredP0 ?? [];
    const detail = uncovered.length > 0 ? ` Uncovered P0 requirements: ${uncovered.join(", ")}.` : "";
    parts.push(
      `Required for plan-close: a plan declaring \`extra.requires_uat: true\` may only be ` +
        `archived after a linked UAT verdict shows P0 acceptance (verdict not "reject", no ` +
        `rejected P0 journey, no uncovered P0 requirement, no UIUX blocker).${detail} ` +
        `Recovery: run acceptance (\`/lore-uat\`) then \`lore uat record ` +
        `${ctx.targetIdOrSlug ?? "<plan>"} --json-file <verdict.json>\`.`,
    );
  }
  const pack = buildFeedingPack({
    ruleSource: reviewFailed ? "corpus (milestone review, BR-1372)" : "corpus (UAT verdict)",
    ruleMarkdown: parts.join(" "),
    missing: selectFailures(failures).map((f) => f.reason),
  });
  return renderFeedingPack(pack);
}

// ─── review-judgment (SPEC-103 §Mechanisms M2) ─────────────────────────────

/** `checkReviewJudgment`'s failure when NO current-version judgment exists at all. */
export const NO_JUDGMENT_REASON = "NO_JUDGMENT";

/**
 * `checkReviewJudgment`'s failure when every current-version judgment collided with
 * `doc.extra.ai_provenance` (I1) — distinct from {@link NO_JUDGMENT_REASON} so
 * `feedReviewJudgment` can name the collision explicitly rather than the generic
 * "no judgment at all" message (AC-TIER-6).
 */
export const JUDGMENT_PROVENANCE_COLLISION_REASON = "JUDGMENT_PROVENANCE_COLLISION";

/**
 * `checkReviewJudgment`'s failure when the only approving judgment(s) of the current version were made on cut
 * input (`truncated: true`) and so cannot approve (BR-269). Applies to rows recorded before the judge stopped
 * cutting the document under review.
 */
export const JUDGMENT_INPUT_TRUNCATED_REASON = "JUDGMENT_INPUT_TRUNCATED";

/**
 * `checkReviewJudgment`'s failure when the WORST independent current-version
 * judgment is `"reject"` (SPEC-103 D3 anti-lottery — a reject can never be outrolled
 * by a later approve on the SAME version).
 */
export const JUDGMENT_REJECTED_REASON = "JUDGMENT_REJECTED";

/** `checkReviewJudgment`'s failure when the WORST independent current-version judgment is `"escalate"`. */
export const JUDGMENT_ESCALATED_REASON = "JUDGMENT_ESCALATED";

/** The `PredicateResult.field` value every `review-judgment` failure carries. */
export const REVIEW_JUDGMENT_FIELD = "judgment-required";

/**
 * Decision precedence for SPEC-103 D3's worst-decision-wins anti-lottery rule:
 * `reject` (2) > `escalate` (1) > `approve` (0). Exhaustive over {@link ReviewDecision}
 * — a `never`-typed default branch would fail to compile if a fourth decision were
 * ever added to `REVIEW_DECISIONS` (`@lore/core`, review-judgment.ts) without this
 * table being updated too.
 */
const REVIEW_DECISION_RANK: Record<ReviewDecision, number> = { approve: 0, escalate: 1, reject: 2 };

/**
 * Picks the WORST (highest-rank) decision among `decisions` (SPEC-103 D3) — a reject
 * or escalate on the current version can never be outrolled by a later approve on
 * that SAME version, only by a version bump (a fresh `ctx.reviewJudgmentDecisions`
 * array, since the caller re-derives it from the doc's NEW current version).
 *
 * @param decisions - Non-empty array of current-version, provenance-independent
 *   review-judgment decisions (caller's precondition — `checkReviewJudgment` only
 *   calls this when `decisions.length > 0`).
 * @returns The single worst decision present.
 * @example
 * worstReviewDecision(["approve", "reject", "approve"]); // => "reject"
 * worstReviewDecision(["approve", "escalate"]);           // => "escalate"
 * worstReviewDecision(["approve"]);                       // => "approve"
 */
function worstReviewDecision(decisions: readonly ReviewDecision[]): ReviewDecision {
  return decisions.reduce<ReviewDecision>(
    (worst, d) => (REVIEW_DECISION_RANK[d] > REVIEW_DECISION_RANK[worst] ? d : worst),
    "approve",
  );
}

/**
 * `review-judgment`'s single predicate (SPEC-103 §Mechanisms M2): the doc's CURRENT
 * version must carry at least one independent (non-provenance-colliding) review
 * judgment, and the WORST such judgment must be `"approve"` (D3 anti-lottery — see
 * {@link worstReviewDecision}). Both `ctx.reviewJudgmentDecisions` (already filtered)
 * and `ctx.reviewJudgmentProvenanceCollision` are pre-computed by the CALLER
 * (`ReviewService.enforceApprovalGate`, which reads `review_judgments` + `doc.extra
 * .ai_provenance` — module invariant: no store, no IO here).
 *
 * @returns `[{ok: true}]` when an independent judgment exists and its worst decision
 *   is `"approve"`; a single-element failure array otherwise — `NO_JUDGMENT_REASON`
 *   (nothing at all), `JUDGMENT_PROVENANCE_COLLISION_REASON` (only colliding
 *   judgments existed), `JUDGMENT_REJECTED_REASON`, or `JUDGMENT_ESCALATED_REASON`.
 * @example
 * checkReviewJudgment({ reviewJudgmentDecisions: [] });
 *   // => [{ ok: false, reason: "NO_JUDGMENT", field: "judgment-required" }]
 * @example
 * checkReviewJudgment({ reviewJudgmentDecisions: [], reviewJudgmentProvenanceCollision: true });
 *   // => [{ ok: false, reason: "JUDGMENT_PROVENANCE_COLLISION", field: "judgment-required" }]
 * @example
 * checkReviewJudgment({ reviewJudgmentDecisions: ["reject", "approve"] });
 *   // => [{ ok: false, reason: "JUDGMENT_REJECTED", field: "judgment-required" }]
 * @example
 * checkReviewJudgment({ reviewJudgmentDecisions: ["approve"] }); // => [{ ok: true }]
 */
function checkReviewJudgment(ctx: GateContext): PredicateResult[] {
  const decisions = ctx.reviewJudgmentDecisions ?? [];
  if (decisions.length === 0) {
    if (ctx.reviewJudgmentTruncatedApproval === true) {
      return [{ ok: false, reason: JUDGMENT_INPUT_TRUNCATED_REASON, field: REVIEW_JUDGMENT_FIELD }];
    }
    return [
      ctx.reviewJudgmentProvenanceCollision === true
        ? { ok: false, reason: JUDGMENT_PROVENANCE_COLLISION_REASON, field: REVIEW_JUDGMENT_FIELD }
        : { ok: false, reason: NO_JUDGMENT_REASON, field: REVIEW_JUDGMENT_FIELD },
    ];
  }
  const worst = worstReviewDecision(decisions);
  if (worst === "reject") {
    return [{ ok: false, reason: JUDGMENT_REJECTED_REASON, field: REVIEW_JUDGMENT_FIELD }];
  }
  if (worst === "escalate") {
    return [{ ok: false, reason: JUDGMENT_ESCALATED_REASON, field: REVIEW_JUDGMENT_FIELD }];
  }
  return [{ ok: true }];
}

/**
 * Header of the escalate denial's blocking-questions section (D4) — a stable, greppable
 * lead-in so a reader (and a test) can locate the questions in the rendered pack.
 */
const BLOCKING_QUESTIONS_HEADER = "Blocking questions from the escalating judgment (answer these, then re-review):";

/**
 * What the escalate denial says when the escalating judgment carried NO
 * `blocking_questions` (spec-an-escalate-blocks-approval-for-every-doc-type-and-the
 * D4) — an escalate asserts an outstanding human decision, so naming no question is
 * itself a defect and is surfaced as one rather than as an empty section.
 *
 * `reviewJudgmentSchema` (`@lore/core`) forbids this combination, so it is only
 * reachable for a row written straight to the store (a v1-migrated or hand-authored
 * judgment) rather than through `JudgmentService.record`.
 */
const NO_BLOCKING_QUESTIONS_LINE =
  "The escalating judgment recorded no blocking questions — an escalate that names no " +
  "question is itself a defect (it asserts an outstanding human decision without saying " +
  "which). Treat the judgment as unusable and obtain a fresh one.";

/**
 * Renders the `blocking_questions` block D4 requires: every entry VERBATIM on its own
 * `- `-prefixed line (the same bullet shape `renderFeedingPack` uses for its `missing`
 * list), bounded by ENTRY COUNT and never character-truncated.
 *
 * Deliberately rendered OUTSIDE `buildFeedingPack`'s `ruleMarkdown` (whose slice is cut
 * to `gate-feeding.ts`'s `DEFAULT_FEEDING_MAX_CHARS`): folding the questions into it would
 * character-truncate them mid-question, which is exactly what D4 forbids — a writer
 * cannot answer half a question.
 *
 * @param questions - `ctx.reviewJudgmentBlockingQuestions`; `undefined` and `[]` both
 *   render {@link NO_BLOCKING_QUESTIONS_LINE} (see that field's own JSDoc for why the
 *   two states are indistinguishable by construction).
 */
function renderBlockingQuestions(questions: readonly string[] | undefined): string {
  if (questions === undefined || questions.length === 0) {
    return NO_BLOCKING_QUESTIONS_LINE;
  }
  return [BLOCKING_QUESTIONS_HEADER, ...questions.map((q) => `- ${q}`)].join("\n");
}

/**
 * `review-judgment`'s feeding message — names the exact recovery command
 * (`lore review <doc>`, per SPEC-103 M2's own text) and, on a provenance-collision
 * denial, explicitly calls out WHY the doc's existing judgment(s) didn't count
 * (AC-TIER-6) rather than rendering the generic "no judgment at all" wording.
 *
 * On a {@link JUDGMENT_ESCALATED_REASON} denial it ADDITIONALLY appends the escalating
 * judgment's `blocking_questions` (spec-an-escalate-blocks-approval-for-every-doc-type-
 * and-the D4, {@link renderBlockingQuestions}): a gate that blocks on "a human must
 * decide" while withholding WHAT must be decided leaves the writer no path forward —
 * measured on that spec's own governing ADR, where the denial named only
 * `lore review <doc>` and the three questions had to be read out of SQLite by hand.
 */
function feedReviewJudgment(ctx: GateContext, failures: PredicateResult[]): string {
  const target = ctx.targetIdOrSlug ?? "<doc>";
  const collision = failures.some((f) => !f.ok && f.reason === JUDGMENT_PROVENANCE_COLLISION_REASON);
  const escalated = failures.some((f) => !f.ok && f.reason === JUDGMENT_ESCALATED_REASON);
  const inputTruncated = failures.some((f) => !f.ok && f.reason === JUDGMENT_INPUT_TRUNCATED_REASON);
  const ruleMarkdown = inputTruncated
    ? `Required for review-judgment: the only approving judgment(s) of ${target} for its CURRENT version were ` +
      `made on input that was cut (marked truncated) and can never approve. ` +
      `Recovery: run \`lore review ${target}\` for a fresh judgment, which sees the whole document.`
    : collision
    ? `Required for review-judgment: an independent review judgment for the CURRENT ` +
      `version of ${target} is required before approval. The only judgment(s) found for ` +
      `this version were authored by the SAME provider/model/prompt_version as the doc's ` +
      `own \`extra.ai_provenance\` (a self-review collision, SPEC-103 I1) and do not count. ` +
      `Recovery: run \`lore review ${target}\` with an independent judge, or edit the doc ` +
      `(version bump) and get a fresh judgment.`
    : // reason: the escalate branch is worded separately because it is the ONE verdict
      // that gates EVERY doc type (D1) — including types `judgment_required_types` does
      // not list, for which "needs a judgment" (the generic wording below) would be
      // FALSE: their approval is blocked by the escalate that exists, not by a missing
      // one. It also names the clearing path, which is answering the questions rather
      // than re-rolling the judge (answering edits the doc, which bumps its version,
      // which per-version judgment matching already requires a fresh judgment for).
      escalated
      ? `Required for review-judgment: a review judgment escalated ${target} — it asserts ` +
        `an OUTSTANDING HUMAN DECISION, which blocks approval for EVERY doc type ` +
        `regardless of \`workflow.review.judgment_required_types\`. Recovery: work the ` +
        `blocking-questions section below (answering them edits the doc, bumping its ` +
        `version, so a fresh judgment is required anyway), then run \`lore review ${target}\`.`
      : `Required for review-judgment: ${target} needs an independent, non-rejecting, ` +
        `non-escalating review judgment for its CURRENT version before it may be approved. ` +
        `Recovery: run \`lore review ${target}\`.`;
  const pack = buildFeedingPack({
    ruleSource: "corpus (review judgments)",
    ruleMarkdown,
    missing: selectFailures(failures).map((f) => f.reason),
  });
  const rendered = renderFeedingPack(pack);
  return escalated ? `${rendered}\n\n${renderBlockingQuestions(ctx.reviewJudgmentBlockingQuestions)}` : rendered;
}

/**
 * Structural signal for the SPEC-069 ad-hoc-task claim gap (task-fix-spec-069-gap-
 * adhoc-task-claim-structurally-impossible): `true` exactly when a `getPlanBundle`
 * lookup failed BECAUSE the resolved parent doc exists but is not `type: "plan"` —
 * the precise `{code: "VALIDATION_ERROR", field: "type"}` shape
 * `CorpusService.getPlanBundle` returns for a task auto-parented to the root PRD
 * (SPEC-069's `--adhoc` channel) or any other non-plan parent. `task-claim`'s two
 * call sites (`enforceClaimGate`, `runTaskClaimGate`) use this to route such a task
 * through the SAME "no governing plan" vacuous-pass-on-`upstreamApproved` treatment
 * `parent_id === null` already gets — see this module's third invariant.
 *
 * Deliberately keyed on the STRUCTURAL fact returned by the resolution itself, not
 * on `task.extra.adhoc === true` — the latter is caller-set data that can drift (a
 * hand-edited task, a future planless-task channel that never sets it); a parent
 * that resolved but isn't a plan cannot lie about its own `type`. Every OTHER
 * `getPlanBundle` failure (`DOC_NOT_FOUND` — an unresolvable or soft-deleted
 * parent; a `STORE_ERROR`) is a real anomaly and must still propagate as a hard
 * failure, never silently treated as "no governing plan".
 *
 * @param error - The `LoreError` a failed `getPlanBundle(task.parent_id)` call returned.
 */
export function isNonPlanParentError(error: LoreError): boolean {
  return error.code === "VALIDATION_ERROR" && error.field === "type";
}

/**
 * Builds the `hasSpecParent` / `parentSpec` / `parentSpecPointer` trio `plan-promote`
 * and `task-claim` both consume, from an optional resolved ancestor spec `DocRecord`
 * (`CorpusService.getPlanBundle`'s `.spec` field — `undefined` when the plan has no
 * spec-tier ancestor). SSOT relocated here (retro follow-up item 8, defense-in-depth)
 * from the CLI adapter's former local `gate.ts::buildUpstreamSpecContext` so BOTH the
 * CLI (`lore gate plan-promote`/`task-claim`) and the service-layer `GateEnforcer`
 * (real `corpusService.create`/`reviewService.approve`/`taskWorkflowService.claim`
 * callers — MCP, HTTP, direct-service) build the identical ctx shape from the
 * identical resolved-spec input, rather than two independently-maintained copies.
 * `gate.ts` now imports this function instead of defining its own.
 *
 * `spec.deleted_at` is threaded straight into `parentSpec.deleted_at`, even when
 * non-`null` — `getPlanBundle` populates `.spec` regardless of soft-delete state
 * (a soft-deleted upstream still IS a spec-tier ancestor; only `upstreamApproved`'s
 * pure predicate decides whether that's disqualifying, via the `UPSTREAM_DELETED`
 * reason). This function must never itself treat a deleted spec as "no spec
 * parent" — that would wrongly fall through to `hasSpecParent: false`'s vacuous
 * pass instead of blocking the gate.
 *
 * @param spec - The resolved ancestor spec, or `undefined` when `getPlanBundle` found
 *   none (prd-parented or unparented plan).
 */
export function buildUpstreamSpecContext(spec: DocRecord | undefined): GateContext {
  if (spec === undefined) {
    return { hasSpecParent: false };
  }
  return {
    hasSpecParent: true,
    parentSpec: {
      type: spec.type,
      status: spec.status,
      extra: spec.extra,
      deleted_at: spec.deleted_at,
    },
    parentSpecPointer: { slug: spec.slug, title: spec.title, status: spec.status },
  };
}

/**
 * Counts `verify.mode === "script"` acceptance criteria declared on `spec.extra
 * .acceptance_criteria` — the `GateContext.parentSpecScriptAcCount` field
 * `verifyReachability` consumes (spec-verify-reachability-plan-promote-early-
 * warning §Scope M1/M2, this module's own field JSDoc). RELOCATED here from
 * `review-service.ts` (spec-plan-closure-must-be-loud-terminality-divergence-
 * silent §Design Decisions DD-4(a)) — `CorpusService.set`'s plan-close branch
 * needs this SAME derivation and `CorpusService` may never import from
 * `ReviewService` (`service/CLAUDE.md`'s "no cross-service imports"
 * invariant); this module is gate infrastructure, not a tracked service, so
 * both already import from it (mirrors `buildUpstreamSpecContext`'s own
 * relocation history one section up). Computed as a SEPARATE function rather
 * than folded into `buildUpstreamSpecContext`'s return shape — that
 * function's exact-shape output is byte-pinned by `checkpoint-registry.test
 * .ts`'s `toEqual` regression assertion for EVERY caller of it, including
 * `task-claim`, which never reads this field at all; adding an always-defined
 * field there would break that pin.
 *
 * @param spec - The resolved ancestor spec `DocRecord` (`PlanBundle.spec`).
 * @returns The count of script-mode ACs; `0` for a spec with no/invalid
 *   `extra.acceptance_criteria` — a concrete `0`, not `undefined`, since
 *   `verifyReachability` treats the two identically anyway (gate-predicates.ts's
 *   own module invariant on this parameter).
 * @example
 * countScriptModeAcceptanceCriteria({ extra: { acceptance_criteria: [
 *   { id: "AC-1", statement: "x", verify: { mode: "script", oracle: "test", command: "bun test" } },
 *   { id: "AC-2", statement: "y", verify: { mode: "human" } },
 * ] } } as DocRecord); // => 1
 */
export function countScriptModeAcceptanceCriteria(spec: DocRecord): number {
  const parsed = specAcceptanceCriteriaSchema.safeParse(spec.extra["acceptance_criteria"]);
  if (!parsed.success) return 0;
  return parsed.data.filter((criterion) => criterion.verify.mode === "script").length;
}

/**
 * Lists the `id`s of `verify.mode === "script"` acceptance criteria declared
 * on a resolved ancestor spec's `extra` bag — the D5 "enumerate the ids so
 * the author can copy one rather than query for legal values" detail
 * `feedTaskCreate` needs (spec-declaring-ac-scope-is-required-at-task-
 * creation-so-the, AC-ACS-7). Takes `extra` directly rather than a full
 * `DocRecord` (unlike {@link countScriptModeAcceptanceCriteria}) because
 * `GateContext.parentSpec` only carries `{type, status, extra, deleted_at}` —
 * the SAME projection `buildUpstreamSpecContext` builds for
 * `upstreamApproved`/`upstreamHasAcceptanceCriteria` — never a full
 * `DocRecord`.
 *
 * @param extra - `ctx.parentSpec?.extra`, or `undefined` when no ancestor
 *   spec resolved.
 * @returns The script-mode criteria's ids, in declaration order; `[]` for a
 *   missing/invalid/absent `acceptance_criteria` array.
 * @example
 * listScriptModeCriterionIds({ acceptance_criteria: [
 *   { id: "AC-1", statement: "x", verify: { mode: "script", oracle: "test", command: "bun test" } },
 *   { id: "AC-2", statement: "y", verify: { mode: "human" } },
 * ] }); // => ["AC-1"]
 * @example
 * listScriptModeCriterionIds(undefined); // => []
 */
function listScriptModeCriterionIds(extra: Record<string, unknown> | undefined): string[] {
  const parsed = specAcceptanceCriteriaSchema.safeParse(extra?.["acceptance_criteria"]);
  if (!parsed.success) return [];
  return parsed.data.filter((criterion) => criterion.verify.mode === "script").map((c) => c.id);
}

/**
 * `task-create`'s ONE check (spec-declaring-ac-scope-is-required-at-task-
 * creation-so-the) — a thin dispatch to {@link acScopeRequiredAtCreate}
 * supplying the pre-fetched `ctx` fields. Reuses `hasSpecParent`/
 * `parentSpecScriptAcCount` (the SAME fields `task-claim`/`plan-promote`
 * already populate for "the task's parent plan's spec ancestor") — this
 * checkpoint introduces no new upstream-resolution logic, only the admission
 * predicate itself.
 */
function checkTaskCreate(ctx: GateContext): PredicateResult[] {
  return [
    acScopeRequiredAtCreate(ctx.hasSpecParent, ctx.parentSpecScriptAcCount, ctx.candidateAcScopeDeclared),
  ];
}

/**
 * `task-create`'s feeding message (D5) — names the literal `--ac-scope` flag
 * (AC-ACS-1's "the message contains the literal `--ac-scope`", AC-ACS-7's
 * "enumerates the governing spec's script-mode criterion ids so the author
 * can copy one rather than query for legal values"). Mirrors
 * `feedUpstreamSpecCheckpoint`'s pointers-not-dump shape (spec slug/title/
 * status only, never the full markdown body).
 */
function feedTaskCreate(ctx: GateContext, failures: PredicateResult[]): string {
  const pointer = ctx.parentSpecPointer;
  const ids = listScriptModeCriterionIds(ctx.parentSpec?.extra);
  const idsLine =
    ids.length > 0
      ? `Script-mode criteria you may declare via --ac-scope: ${ids.join(", ")}.`
      : "(no script-mode criteria found on the governing spec — declare --ac-scope with an explicit empty value to record that this task claims none)";
  const ruleMarkdown =
    (pointer !== undefined
      ? `Parent spec: ${pointer.slug} — "${pointer.title}" (status: ${pointer.status}). `
      : "(no ancestor spec resolved). ") +
    "Required for task-create: this task's plan resolves a spec-tier ancestor declaring " +
    "at least one script-mode acceptance criterion, so this task must declare --ac-scope " +
    '(repeatable; pass an explicit empty value to declare "claims nothing" — an empty ' +
    "array is a valid decision, not a missing one, per D2). " +
    idsLine;
  const pack = buildFeedingPack({
    ruleSource: pointer !== undefined ? `corpus ${pointer.slug}` : "corpus (unresolved)",
    ruleMarkdown,
    missing: selectFailures(failures).map((f) => f.reason),
  });
  return renderFeedingPack(pack);
}

/** `record-edit`'s failure reason when the target is a locked record. */
export const RECORD_EDIT_LOCKED_REASON = "RECORD_LOCKED";
/** `record-edit`'s failure reason when the caller supplied no lock facts at all. */
export const RECORD_EDIT_UNMEASURED_REASON = "RECORD_LOCK_UNMEASURED";

/**
 * `record-edit`'s ONE check (spec-documents-are-living-or-records D4/D6): blocks iff the target is a
 * locked record. A ctx without `recordEdit` BLOCKS (an unmeasured lock must never read as editable —
 * same fail-closed direction as `noAnchorOverlap`'s absent session id).
 */
function checkRecordEdit(ctx: GateContext): PredicateResult[] {
  const facts = ctx.recordEdit;
  if (facts === undefined) return [{ ok: false, reason: RECORD_EDIT_UNMEASURED_REASON }];
  const locked = facts.lock.standing === "record" && facts.lock.locked;
  return [locked ? { ok: false, reason: RECORD_EDIT_LOCKED_REASON } : { ok: true }];
}

/**
 * `record-edit`'s refusal text (D18): `<slug> is a locked record (<reason>).` followed by the change
 * paths that apply to the target's kind and the rewrite path it attempted. Pure over `ctx`.
 *
 * A locked SPEC also names the reopen exit (`lore reopen`, D5/D18) - it applies only before any evidence exists.
 */
function feedRecordEdit(ctx: GateContext, _failures: PredicateResult[]): string {
  const facts = ctx.recordEdit;
  if (facts === undefined) {
    return "record-edit: the caller supplied no lock facts, so the edit cannot be judged; this is a bug in the calling service.";
  }
  const reason = facts.lock.standing === "record" && facts.lock.locked ? facts.lock.reason : "unlocked";
  const slug = facts.slug;
  const lines: string[] = [`${slug} is a locked record (${reason}).`];

  const correction =
    `Typo-level fix of the stored text: lore set ${slug} --content <fixed text> --correction "<reason>" ` +
    "(audited, one version, status kept).";
  const replace = (what: string, link: string): string =>
    `Substantive change: ${what}, and link it to ${slug} with ${link} so the old record points at its replacement.`;

  switch (facts.type) {
    case "spec":
      lines.push(correction);
      lines.push(replace("open a new spec (lore create spec)", "`relates-to`"));
      lines.push(
        `Or reopen it (lore reopen ${slug} --reason "<reason>") when it has no evidence: it goes back to draft and can be edited, then approved again.`,
      );
      lines.push("Behaviour change of a living rule: edit the baseline rule in place (lore baseline).");
      break;
    case "adr":
      lines.push(correction);
      lines.push(replace("write a new ADR (lore create adr --parent <spec-or-prd>)", "`supersedes`"));
      break;
    case "knowledge":
      lines.push(correction);
      lines.push(replace("write a new knowledge doc (lore create knowledge --parent <doc>)", "`relates-to`"));
      lines.push("A claim that stopped being true: lore invalidate (keeps the record, marks it invalid).");
      break;
    case "task":
      lines.push(correction);
      lines.push(replace("create a new task (lore create task)", "`relates-to`"));
      break;
    case "plan":
    case "phase":
      lines.push(
        `The plan is closed (archived or deprecated), so it and its phases are records. ` +
          replace("open a new plan (lore create plan --parent <spec-or-prd>)", "`relates-to`"),
      );
      break;
    default:
      lines.push(correction);
      break;
  }

  switch (facts.op) {
    case "restore":
      lines.push("This attempt was a restore: restoring rewrites the record's text, so it is refused the same way.");
      break;
    case "criteria":
      lines.push(
        "This attempt changed acceptance criteria (lore ac add|set|rm): a changed criterion changes what was accepted, so it belongs to a new spec. " +
          `A defect in ONE existing criterion is the exception: lore ac set ${slug} <AC-id> <field flags> --correction "<reason>" (audited, one version, status kept; ac add|rm have no correction exit). \`lore ac cite\` is not affected.`,
      );
      break;
    case "phase-structure":
      lines.push("This attempt changed the plan's phase list (lore phase add|rm|rename).");
      break;
    case "ai-rewrite":
      lines.push(
        "This attempt asked an AI to rewrite the body (lore set --regenerate|--refine): no AI call was made. An AI rewrite is not a correction.",
      );
      break;
    case "kind":
      lines.push("This attempt changed extra.sub_type: flipping a record's kind would unlock it, so it is refused.");
      break;
    case "content":
      break;
    default: {
      const unreachable: never = facts.op;
      throw new Error(`feedRecordEdit: unhandled op ${String(unreachable)}`);
    }
  }
  return lines.join("\n");
}

/**
 * `ac-cite`'s predicate run (spec-baseline-slice-2 §C4): every added/revised criterion in
 * `ctx.citeCandidates` must cite at least one rule and every cited rule must be live in
 * `ctx.citeRuleStates`. An absent candidate list is "nothing was added or revised" — a vacuous pass,
 * the same shape `plan-promote` uses for "no spec ancestor".
 */
function checkAcCite(ctx: GateContext): PredicateResult[] {
  return [acCiteLive(ctx.citeCandidates ?? [], ctx.citeRuleStates ?? {})];
}

/**
 * `ac-cite`'s refusal text: one line per violation, then (when the caller attached one) the feeding
 * pack — up to 5 live candidate rules, the paste-ready `lore ac cite` line and the exemption headroom.
 * Pure over `ctx`; the violations are re-derived with the SAME `findAcCiteViolations` the predicate
 * used, so the message can never name a different offender than the verdict did.
 */
function feedAcCite(ctx: GateContext, _failures: PredicateResult[]): string {
  const violations = findAcCiteViolations(ctx.citeCandidates ?? [], ctx.citeRuleStates ?? {});
  const lines = violations.map((v) =>
    v.reason === "uncited"
      ? `${v.ac_id} cites no rule`
      : `${v.ac_id} cites ${v.rule_id ?? "?"}, which is ${v.reason === "missing" ? "not a rule any leaf lists" : v.reason}`,
  );
  const pack = ctx.citeFeedingPack;
  const tail =
    pack === undefined
      ? []
      : [
          ...(pack.candidates.length > 0
            ? ["Candidate rules:", ...pack.candidates.map((c) => `  ${c.id}  ${c.statement}`)]
            : ["No live candidate rule found for this spec's anchors or branch."]),
          `Cite one: ${pack.cite_line}`,
          `Exemption headroom: ${String(pack.exemption_headroom)}`,
        ];
  return [`Citation gate: ${lines.join("; ")}.`, ...tail].join("\n");
}

/**
 * Builds the `candidateBy` / `candidateAnchors` / `siblingClaims`
 * set `task-claim`'s `noAnchorOverlap` predicate consumes
 * (SPEC-042 §Design Decisions D5, run-keyed by BR-1056) — co-located
 * with {@link buildUpstreamSpecContext} per the
 * same "SSOT ctx-builder both `lore gate task-claim` and the service-layer
 * `GateEnforcer` caller build from" rationale. Populated from a plan bundle's
 * `tasks[]` (`CorpusService.getPlanBundle`, already includes every sibling —
 * zero extra IO), UNCONDITIONALLY (never gated by whether a spec ancestor
 * resolved — see this module's fourth invariant).
 *
 * `siblingClaims[].stale` is precomputed HERE from the caller-supplied
 * `nowIso` + `ttlMinutes` — the SAME values `_claimImpl`'s own target-claim
 * conflict check uses within one `claim()` call, so this builder (and the
 * `GateEnforcer.enforce` it feeds) never reads a wall clock itself.
 *
 * @param candidateBy - The actor attempting the claim.
 * @param candidateTask - The task being claimed.
 * @param siblingTasks - The candidate task's plan siblings (bundle.tasks,
 *   including `candidateTask` itself — filtered out below).
 * @param nowIso - Caller-supplied current time (D10 — never Date.now() here).
 * @param ttlMinutes - Claim TTL in minutes, forwarded to `isClaimStale`.
 */
export function buildAnchorGateContext(
  candidateBy: string,
  candidateTask: DocRecord,
  siblingTasks: DocRecord[],
  nowIso: string,
  ttlMinutes: number,
): Pick<GateContext, "candidateBy" | "candidateAnchors" | "siblingClaims"> {
  const candidateAnchors = extractFileAnchors(candidateTask);
  const siblingClaims: SiblingClaimInfo[] = [];
  for (const sibling of siblingTasks) {
    if (sibling.id === candidateTask.id) continue;
    const claim = extractHeldClaim(sibling);
    if (claim === undefined) continue;
    siblingClaims.push({
      slug: sibling.slug,
      title: sibling.title,
      by: claim.by,
      at: claim.at,
      stale: isClaimStale(claim, nowIso, ttlMinutes),
      anchors: extractFileAnchors(sibling),
      ...(claim.worktree !== undefined ? { worktree: claim.worktree } : {}),
      // reason: BR-1056 — `noAnchorOverlap` compares holders by RUN; a lease with no run stays without one and
      // conflicts with everyone.
      ...(claim.harness_run !== undefined ? { harness_run: claim.harness_run } : {}),
    });
  }
  return { candidateBy, candidateAnchors, siblingClaims };
}

/**
 * The `ac-cite` checkpoint (spec-baseline-slice-2 §C4): the pure `check`/`feed` pair the citation gate's
 * one evaluator (`ac-cite-gate.ts::decideCiteGate`) runs. Defined in this module beside every other
 * checkpoint's decision logic, exported by name, and deliberately NOT in {@link checkpointRegistry}: that
 * map is `GateEnforcer`'s dispatch table (and what `lore feed`/`lore gate` enumerate), whereas this gate
 * is evaluated by the AC write chokepoint under the three-state `workflow.gates."ac-cite".mode` — an
 * `enabled`-style on/off whose absence means "enabled" is exactly what it must not inherit.
 */
export const AC_CITE_CHECKPOINT: CheckpointDef = { id: "ac-cite", check: checkAcCite, feed: feedAcCite };

/**
 * The gate checkpoint registry — see module invariants for why this stays
 * `Partial<Record<...>>` even though all five `GateCheckpoint` members are now
 * populated.
 */
export const checkpointRegistry: Partial<Record<GateCheckpoint, CheckpointDef>> = {
  "spec-create": { id: "spec-create", check: checkSpecCreate, feed: feedSpecCreate },
  "spec-promote": { id: "spec-promote", check: checkSpecPromote, feed: feedSpecPromote },
  "plan-promote": { id: "plan-promote", check: checkPlanPromote, feed: feedPlanPromote },
  "task-claim": { id: "task-claim", check: checkTaskClaim, feed: feedTaskClaim },
  "plan-close": { id: "plan-close", check: checkPlanClose, feed: feedPlanClose },
  // reason: SPEC-056 D2/D7 — "phase-claim" reuses `checkTaskClaim` VERBATIM
  // (checkpoint-agnostic by construction, this module's fourth invariant) and
  // `feedPhaseClaim` (a thin label wrapper over the SAME `feedTaskOrPhaseClaim`
  // impl `feedTaskClaim` uses) — the "ONE-LINE registry addition" the RED
  // suite's CONTRACT NOTE §2 calls for.
  "phase-claim": { id: "phase-claim", check: checkTaskClaim, feed: feedPhaseClaim },
  // reason: spec-declaring-ac-scope-is-required-at-task-creation-so-the —
  // Option B (§Options Considered): a checkpointRegistry predicate, composing
  // with the existing GateEnforcer enforcement all three adapters share.
  "task-create": { id: "task-create", check: checkTaskCreate, feed: feedTaskCreate },
  // reason: SPEC-103 §Mechanisms M2 — generic, type-agnostic judgment-required
  // checkpoint; NOT added to ALL_GATE_CHECKPOINTS below (that list mirrors the
  // ORIGINAL IoC vertical-slice tech-spec's five checkpoints for SPEC-041/-043's
  // bootstrap "armed gates" rendering — widening it is a separate concern this
  // task's anchors don't cover).
  "review-judgment": { id: "review-judgment", check: checkReviewJudgment, feed: feedReviewJudgment },
  // reason: spec-documents-are-living-or-records D6/D11 — `RecordLockService.assertEditable` enforces
  // this through `GateEnforcer.enforce` from every rewrite path; NOT in ALL_GATE_CHECKPOINTS (see the
  // union member's JSDoc, same precedent as "task-create"/"review-judgment" above).
  "record-edit": { id: "record-edit", check: checkRecordEdit, feed: feedRecordEdit },
  // reason: "ac-cite" (the citation gate, spec-baseline-slice-2 §C4) is DELIBERATELY NOT a member of this
  // map — see `AC_CITE_CHECKPOINT`'s JSDoc above. Registering it here would put it in the dispatch
  // table `GateEnforcer` and `lore gate`/`lore feed` enumerate, and
  // `tests/unit/service/gate-evaluation-trace.test.ts` (AC-FR-8) then demands a `gate_passed` audit
  // row for every PASSING evaluation — one extra audit row per `lore ac add` that nothing asked for.
  // Its observability is the would-refuse audit row (report mode) and the refusal itself (enforce).
};

/**
 * Whether `name` is a checkpoint CURRENTLY populated in {@link checkpointRegistry}
 * — the ONE membership predicate `lore feed`'s CLI dispatch
 * (`adapters/cli/commands/feed.ts`) and this task's coverage test both consult,
 * so "is this checkpoint feedable" is DERIVED from the same object a checkpoint
 * is registered into, never a second hand-maintained list of names (D1 —
 * task-derive-lore-feed-s-checkpoint-set-from-the-registry-make). A checkpoint
 * added to `checkpointRegistry` in the future becomes feedable the moment this
 * predicate sees it — no second edit required anywhere else.
 *
 * @param name - Any string a caller supplied as a `lore feed <checkpoint>`
 *   argument (or the MCP `lore_feed` tool's `checkpoint` field) — never assumed
 *   to already be a `GateCheckpoint`.
 * @returns `true` (narrowing `name` to `GateCheckpoint`) iff
 *   `checkpointRegistry[name]` is populated.
 * @example
 * isRegisteredCheckpoint("spec-promote"); // => true
 * isRegisteredCheckpoint("totally-unknown-checkpoint"); // => false
 */
export function isRegisteredCheckpoint(name: string): name is GateCheckpoint {
  return checkpointRegistry[name as GateCheckpoint] !== undefined;
}

// ─── Armed Gates (SPEC-041 §3 bootstrap; SPEC-043 §Design Decisions D8) ────

/** All five checkpoints, in the fixed order both `SessionService.bootstrap` and
 *  `CorpusService.status`'s SPEC-043 warning render/scan them. */
export const ALL_GATE_CHECKPOINTS: readonly GateCheckpoint[] = [
  "spec-create",
  "spec-promote",
  "plan-promote",
  "task-claim",
  "plan-close",
];

/**
 * checkpoint → discoverable feeding-skill scope (`knowledgeExtraSchema.skill.applies_to`).
 * A LOCAL mirror of `flows/feed-flow.ts::CHECKPOINT_PRODUCED_TYPE` — services must not
 * import from `flows/`/`adapters/` (composition lives in app.ts), so this module cannot
 * import that map directly. Only `"spec-create"` has a discoverable feeding SKILL wired
 * in production today; the other three checkpoints source their feeding message from
 * the TARGET doc's resolved ancestor spec, not a skill-doc lookup, so they have no
 * single corpus-wide "the feeding source" this computation could point at.
 */
export const CHECKPOINT_APPLIES_TO: Partial<Record<GateCheckpoint, string>> = {
  "spec-create": "spec",
};

/** One enabled gate checkpoint + its discoverable feeding-skill source slug, when one exists. */
export interface ArmedGate {
  checkpoint: GateCheckpoint;
  feeding_source_slug: string | null;
}

/**
 * Computes the enabled gate checkpoints + each's discoverable feeding-skill source
 * slug — the SSOT derivation shared by `SessionService.bootstrap` (`armed_gates[]`,
 * SPEC-041 §3) and `CorpusService.status`'s invalidated-feeding-source warning
 * (SPEC-043 D8) — so "which gates are armed / what feeds them" is never independently
 * re-derived a second time (the 2026-07-11 gate-ctx SSOT-drift incident class). Pure
 * over already-fetched `approvedSkillDocs` — no store IO of its own.
 *
 * @param approvedSkillDocs - Every APPROVED `knowledge/skill` doc's `{slug, updated_at,
 *   appliesTo}` (appliesTo undefined when `extra.skill.applies_to` is absent/malformed).
 * @param isCheckpointEnabled - Per-checkpoint enablement predicate — `GateEnforcer
 *   .isEnabled.bind(gateEnforcer)` in production; defaults callers may pass `() => true`.
 * @returns One {@link ArmedGate} per ENABLED checkpoint, in {@link ALL_GATE_CHECKPOINTS} order.
 */
export function computeArmedGates(
  approvedSkillDocs: ReadonlyArray<{ slug: string; updated_at: string; appliesTo: string | undefined }>,
  isCheckpointEnabled: (checkpoint: GateCheckpoint) => boolean,
): ArmedGate[] {
  const armedGates: ArmedGate[] = [];
  for (const checkpoint of ALL_GATE_CHECKPOINTS) {
    if (!isCheckpointEnabled(checkpoint)) continue;
    const appliesTo = CHECKPOINT_APPLIES_TO[checkpoint];
    let feedingSourceSlug: string | null = null;
    if (appliesTo !== undefined) {
      const matches = approvedSkillDocs.filter((d) => d.appliesTo === appliesTo);
      const latest =
        matches.length > 0 ? matches.reduce((n, d) => (d.updated_at > n.updated_at ? d : n)) : undefined;
      feedingSourceSlug = latest?.slug ?? null;
    }
    armedGates.push({ checkpoint, feeding_source_slug: feedingSourceSlug });
  }
  return armedGates;
}
