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
  extractClaim,
  extractFileAnchors,
  isClaimStale,
  lintAcQuantifiability,
  checkOracleCoverage,
  deriveClaimedAcCoverage,
  UNRESOLVED_DECLARED_SCOPE,
  type AcceptanceCriterion,
  type AcCiteFeedingPack,
  type AcCoverageFact,
  type DeclaredScopeCoverage,
  type DocRecord,
  type LoreError,
  // reason: SPEC-075 D6 — TaskAttestationInfo's home MOVED to @lore/core
  // (evidence-panel.ts), read from there directly rather than re-exported
  // through gate-predicates.ts (see that file's own JSDoc for the type).
  type TaskAttestationInfo,
  type VerificationProfile,
  type ReviewDecision,
  specAcceptanceCriteriaSchema,
} from "@lore/core";
import {
  parentLegal,
  specKindValid,
  hasSkeleton,
  upstreamApproved,
  upstreamHasAcceptanceCriteria,
  noAnchorOverlap,
  actorIdentityGuard,
  acQuantifiable,
  acCountMeetsFloor,
  uatP0Accepted,
  oracleCoverage,
  requiresUatDeclared,
  attestationFloor,
  prdOutlineSynced,
  verifyReachability,
  attestationExemptKindValid,
  assessmentFreshness,
  acScopeRequiredAtCreate,
  acCiteLive,
  findAcCiteViolations,
  type AcCiteCandidate,
  type AcCiteRuleStates,
  findAnchorOverlapConflict,
  ANCHOR_OVERLAP_FIELD,
  ACTOR_IDENTITY_FIELD,
  AC_QUANTIFIABLE_FIELD,
  NO_ACCEPTANCE_CRITERIA_REASON,
  DEFAULT_MIN_ACS,
  ORACLE_COVERAGE_FIELD,
  REQUIRES_UAT_FIELD,
  PLAN_CLOSE_FIELD,
  ATTESTATION_FLOOR_FIELD,
  ATTESTATION_SCOPE_UNDECLARED_FIELD,
  ATTESTATION_EXEMPT_KIND_FIELD,
  PRD_SYNC_FIELD,
  ASSESSMENT_FRESHNESS_FIELD,
  isNotApplicable,
  type AnchorOverlapConflictKind,
  type PredicateResult,
  type ApplicablePredicateResult,
  type SiblingClaimInfo,
  type ReachabilityResult,
} from "./gate-predicates.js";
import { buildFeedingPack, renderFeedingPack } from "./gate-feeding.js";
import { PREDICATE_CONTRACTS } from "./predicate-contracts.js";

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
  | "ac-cite";

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
   * below) and `plan-close`'s `feedAttestationFloor` branch (§Design Decisions
   * D2: one shared derivation, never two). `undefined` when `hasSpecParent` is
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
   * How `candidateBy` was resolved (spec claim-time-actor-identity-guard-zero-
   * evidence-release-advis, AC-IDENTITY-REJECT) — populated UNCONDITIONALLY by
   * a caller that resolved it (`TaskWorkflowService.enforceClaimGate` from
   * `ClaimOpts.identitySource`); `undefined` for every caller that doesn't
   * (`PhaseWorkflowService`, `lore gate task-claim`'s CLI pre-flight dry-run) —
   * `actorIdentityGuard` treats `undefined` as an automatic pass, same as any
   * non-`"os-fallback"` value. A plain `string`, not the `ActorSource` type
   * (`@lore/core/node`) — this module stays free of that Node-only import
   * (mirrors `gate-predicates.ts`'s own `OS_DEFAULT_IDENTITY_SOURCE` JSDoc).
   */
  readonly candidateIdentitySource?: string;
  /** The candidate claim's own `worktree` (SPEC-042 D2), consumed by `actorIdentityGuard`. */
  readonly candidateWorktree?: string;
  /** The candidate claim's own `machine` (SPEC-042 D2), consumed by `actorIdentityGuard`. */
  readonly candidateMachine?: string;
  /**
   * The claiming SESSION INSTANCE — the `TaskClaim.session_id` the caller
   * captured for the claim it is about to write
   * (task-two-concurrent-orchestrators-both-resolve-to-agent-main §Required fix
   * 1/3), consumed by `noAnchorOverlap`/`findAnchorOverlapConflict`.
   *
   * ABSENT means "this side's session was never measured", which makes every
   * same-`by` overlap a NOT-MEASURED refusal rather than a permit — so a caller
   * that CAN measure it and forgets to thread it does not silently weaken the
   * gate, it makes it stricter (the fail-safe direction). Populated by
   * `TaskWorkflowService.enforceClaimGate` and by `lore gate task-claim`'s CLI
   * pre-flight (parity with the real claim); NOT yet by the phase-claim surfaces
   * — `PhaseWorkflowService.claim` does not capture a session id at all, so
   * threading one there would make the pre-flight and the real claim disagree.
   */
  readonly candidateSessionId?: string;
  /**
   * `workflow.gates."task-claim".actor_identity.enabled` resolved by the
   * CALLER (AC-IDENTITY-ESCAPE) — `false` skips `actorIdentityGuard` entirely,
   * leaving `noAnchorOverlap`/`upstreamApproved` untouched. Absent means
   * enabled (same default philosophy as `anchorOverlapEnabled`).
   */
  readonly actorIdentityEnabled?: boolean;

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

  // -- plan-close: check() + feed() (SPEC-069 §Design Decisions D1, attestation floor) --
  /**
   * Whether the closing plan is EXEMPTED from the attestation-floor predicate
   * (`extra.attestation_exempt === true` AND a non-empty
   * `extra.attestation_exempt_reason` — a bare `attestation_exempt: true` with
   * no reason string is treated as NOT exempt, resolved by the caller,
   * `CorpusService.set`). `true` short-circuits `attestationFloor` out of
   * `checkPlanClose` — PROVIDED `attestationExemptKind` also validates (see
   * that field's own JSDoc; spec-verify-reachability-plan-promote-early-
   * warning §Scope M3 / §Design Decisions D3) — the same "opt-out ⇒ vacuous
   * pass" shape `hasSpecParent`/`requiresUat` use elsewhere in this module.
   * An exempt claim with a missing/invalid kind does NOT satisfy the floor:
   * `attestationFloor` still runs (as if not exempt) AND
   * `attestationExemptKindValid`'s own failure is pushed alongside it — either
   * one alone is enough to keep the checkpoint blocked.
   */
  readonly attestationExempt?: boolean;
  /**
   * The closing plan's raw, UNVALIDATED `extra.attestation_exempt_kind`
   * (spec-verify-reachability-plan-promote-early-warning §Scope M3) —
   * meaningless when `attestationExempt` is not `true`. Validated by
   * `attestationExemptKindValid` (gate-predicates.ts) against
   * `attestationExemptKindSchema`'s four members (`@lore/core`, schemas.ts).
   */
  readonly attestationExemptKind?: string;
  /**
   * Every task (or SPEC-056 phase doc) in the closing plan, with its own
   * evidence/attested counts (`CorpusService.set`, built from `getPlanBundle`
   * + `extractEvidence`, `@lore/core`) — populated whenever
   * `attestationExempt` is not `true`; `undefined` (the exempt case, or a
   * checkpoint context built by a caller that never resolves this field) is
   * treated identically to `[]` by `attestationFloor` itself.
   */
  readonly planTasksAttestation?: TaskAttestationInfo[];
  /**
   * The resolved `workflow.attestation.min_ratio` floor, or `null` when
   * UNCONFIGURED (spec-plan-close-predicates-measure-invariants-an-
   * applicability §D4, superseding SPEC-069's always-on `0.5` default) —
   * resolved by the CALLER via `GateEnforcer.resolveAttestationMinRatio`
   * (module invariant: no config access here, mirrors `verificationProfile`'s
   * caller-resolved shape). `undefined` (a ctx built without this field, e.g.
   * a hand-built test fixture) falls back to `DEFAULT_ATTESTATION_MIN_RATIO`
   * in `checkPlanClose`/`feedAttestationFloor` below, which is now itself
   * `null` — a `?? 0.5` fallback anywhere on this path would resurrect the
   * exact flipped default §D4 retires.
   */
  readonly attestationMinRatio?: number | null;
  /**
   * Per-claimed-AC attested-coverage facts (spec-plan-close-predicates-
   * measure-invariants-an-applicability §D3, condition 2 — the DEFAULT
   * conjunct) — `computeAcCoverage`'s own output (`@lore/core`, acceptance.ts)
   * over the closing plan's governing spec's declared criteria aggregated
   * across the plan's tasks. Resolved by the CALLER (`CorpusService.set`):
   * `computeAcCoverage(<declared criteria>, <plan's tasks>)` when the plan has
   * a spec-tier ancestor, `[]` when it does not (mirrors
   * `parentSpecScriptAcCount`'s "populate only when relevant" shape — a plan
   * with no spec-tier ancestor has nothing to claim against).
   *
   * `undefined` is DELIBERATELY NOT treated identically to `[]` (Amendment A,
   * spec-plan-close-predicates-measure-invariants-an-applicability, added
   * after T2 landed) — `checkPlanClose` still evaluates `attestationFloor`'s
   * conditions 1/3 with this fallback to `[]` (unaffected: they never read
   * this field), but ALSO pushes a companion `PredicateNotApplicable`
   * (reason `"referent-absent"`, referent `"planClaimedAcCoverage"`) when this
   * field is genuinely absent — the caller-contract violation of never having
   * resolved claimed-AC coverage at all, distinct from an explicitly-supplied
   * `[]` (a resolved fact: "this plan claims no declared script-mode ACs").
   * Only `CorpusService.set`'s hand-built test fixtures ever omit this field
   * on a path that reaches this branch — the real caller always resolves it.
   */
  readonly planClaimedAcCoverage?: readonly AcCoverageFact[];
  /**
   * DECLARED-scope coverage facts (spec-declared-scope-attestation-contract-task-
   * owned-ac-scope §Facts D4) — `deriveDeclaredScopeCoverage(<plan's tasks>,
   * <planClaimedAcCoverage>)` (`@lore/core`), resolved by the CALLER
   * (`CorpusService.set`) because only it holds the task DOCUMENTS that carry
   * `extra.ac_scope`. This is the coverage conjunct's ONLY input; the
   * evidence-derived `planClaimedAcCoverage` above is diagnostics-only.
   *
   * `undefined` (a caller that never resolved the fact — only hand-built test
   * fixtures, never production) resolves to {@link UNRESOLVED_DECLARED_SCOPE},
   * which reports the scope as UNDECLARED: the floor then returns
   * `notApplicable(scope-undeclared)`, an audited advisory. It must NEVER default
   * to a `scope_undeclared: false` literal — that would fabricate a compliant
   * declaration and vacuously satisfy the conjunct, the exact defect §Facts D4
   * removes.
   */
  readonly planDeclaredScopeCoverage?: DeclaredScopeCoverage;

  // -- plan-close: check() + feed() (SPEC-080 §C4, prdOutlineSynced) --
  /**
   * Whether the `prdOutlineSynced` sub-predicate is enabled at all
   * (`workflow.gates."plan-close".prd_sync.enabled`, resolved by the CALLER via
   * `GateEnforcer.isPrdSyncEnabled` — module invariant: no config access here).
   * DEFAULT-OFF, the opposite polarity of every other per-predicate knob on this
   * checkpoint (SPEC-080 Migration Plan Phase 0: "plan-close predicate behind
   * default-OFF knob") — `undefined`/`false` means the predicate never runs,
   * regardless of `prdSyncSynced`.
   */
  readonly prdSyncEnabled?: boolean;
  /**
   * Pre-computed by the CALLER (`CorpusService.set`): `true` when the closing
   * plan's linked domain doc carries >= 1 version whose content differs from
   * its predecessor within the plan's execution window, OR the plan carries a
   * valid `extra.prd_sync_exempt`; `false` when a domain doc resolved but
   * neither of those hold; `null` (spec-plan-close-predicates-measure-
   * invariants-an-applicability §Design Decisions D1/D6) when the plan's
   * ancestor spec resolves NO domain doc AT ALL (`resolvePrdSyncDomainDoc`
   * returned `ok(null)`, a FACT about the corpus graph, never a violation) —
   * `checkPlanClose` pushes `prdOutlineSynced`'s NOT-APPLICABLE verdict for
   * this case, instead of the pre-fix `false` that rendered domain-doc absence
   * as an unclearable denial. `undefined` means a DIFFERENT thing — "not
   * applicable at the checkpoint level" — the plan has no spec-tier ancestor
   * to resolve a domain doc from in the first place (mirrors `hasSpecParent`'s
   * vacuous-pass shape); `checkPlanClose` only pushes `prdOutlineSynced`'s
   * result at all when this field IS defined (`null` or a boolean, as well as
   * `prdSyncEnabled === true`).
   */
  readonly prdSyncSynced?: boolean | null;
  /**
   * The resolved domain doc's slug, for the feeding-pack message only — present
   * iff the caller successfully resolved a domain doc from the plan's ancestor
   * spec (`parent` or `implements` edge), regardless of whether its content
   * turned out synced. `undefined` when no domain doc resolved (e.g. the
   * ancestor spec declares no `implements` link and its own parent isn't a
   * spec) — the feeding pack degrades to a link-first recovery message instead
   * of naming a doc that doesn't exist.
   */
  readonly prdSyncDomainDocSlug?: string;
  /**
   * `plan-promote`'s EARLY-WARNING domain-doc signal (spec-plan-close-
   * predicates-measure-invariants-an-applicability, task T1 item 9) — whether
   * the plan's ancestor spec resolves a prd-sync domain doc AT ALL
   * (`resolvePrdSyncDomainDoc(store, spec) !== null`), regardless of whether
   * its content is in-window-synced (that is `plan-close`'s concern, via
   * `prdSyncSynced`, not `plan-promote`'s). Populated by the CALLER
   * (`ReviewService.enforceApprovalGate`) ONLY when `prdSyncEnabled` is `true`
   * AND `hasSpecParent` is `true` — the two preconditions
   * `planPromotePrdSyncAdvisory` itself gates on before ever reading this
   * field, mirroring `parentSpecScriptAcCount`'s "populate only when relevant"
   * shape. Consumed ONLY by `planPromotePrdSyncAdvisory`; `checkPlanPromote`'s
   * own blocking predicates never read it (advisory never changes the
   * outcome).
   */
  readonly prdSyncDomainDocResolved?: boolean;

  // -- plan-close: check() + feed() (SPEC-106, assessment freshness) --
  /**
   * Whether the closing plan is EXEMPTED from the assessment-freshness predicate
   * (`extra.assessment_freshness_exempt === true` AND a non-empty
   * `extra.assessment_freshness_exempt_reason` — a bare
   * `assessment_freshness_exempt: true` with no reason is treated as NOT exempt,
   * resolved by the CALLER, `CorpusService.set` — mirrors `attestationExempt`'s
   * flag-plus-reason shape EXACTLY, SPEC-106 §Design Decisions D4). `true`
   * short-circuits `assessmentFreshness` out of `checkPlanClose` entirely — unlike
   * `attestationExempt`, there is no separate "exempt kind" taxonomy for this
   * predicate (D4 names only flag + reason).
   */
  readonly assessmentFreshnessExempt?: boolean;
  /**
   * The plan's newest linked (`informs`) assessment doc's `created_at`
   * (`CorpusService.getAssessmentFreshness`) — `undefined` when NO assessment is
   * linked to the plan at all. Assessment docs are write-once (`lore assess` never
   * edits one after creation), so `created_at` is the correct freshness timestamp —
   * unlike a task's `updated_at`, which this predicate deliberately never reads
   * (D2). Populated only when `assessmentFreshnessExempt` is not `true` (mirrors
   * `planTasksAttestation`'s "skip the IO when exempt" shape).
   */
  readonly newestAssessmentAt?: string;
  /**
   * The newest `evidence`/`done` AUDIT-row timestamp among the closing plan's
   * tasks (`CorpusService.getAssessmentFreshness`) — `undefined` when none of them
   * carry any such row. Deliberately AUDIT rows, never doc `updated_at` (D2): the
   * latter moves on cosmetic edits (anchor adds, link writes, a bare status
   * change) that carry no new outcome information an assessment would need to
   * re-judge (AC-FRESH-3).
   */
  readonly newestTaskActivityAt?: string;

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
   * actually produces a `PredicateNotApplicable` member (via `prdOutlineSynced`/
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
): Array<{ ok: false; reason: string; field?: string }> {
  return results.filter(
    (r): r is { ok: false; reason: string; field?: string } => !isNotApplicable(r) && !r.ok,
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
 * The `extra` key a closing PLAN doc carries {@link describeCheckpointVacuity}'s
 * `"plan-close"` notice under (task-assert-the-plan-close-vacuity-discriminator-
 * on-the-render, spec-governance-visibility-an-armed-gate-that-vacuously-passes
 * §AC-GV-6) — the RENDER-SURFACE half of the discriminator B1.1/AC-GV-1 covered
 * only on `checkPlanClose`'s returned verdict objects, never on a surface a
 * human or a `--json` consumer actually reads. `warnVacuousCheckpoint`
 * (`gate-enforcer.ts`) already prints this SAME notice to stderr on every
 * `enforce("plan-close", …)` call — that pre-existing mechanism IS the human-
 * render half; this field is the one new thing, closing the `--json` payload
 * half, which had NO discriminator at all (a vacuous and a satisfied close
 * both serialized to `"extra": {}"` before this field existed — measured via a
 * live probe against a throwaway corpus, not assumed).
 *
 * The SOLE writer is `CorpusService.set`'s plan-close gate block, which
 * recomputes the SAME `checkpointRegistry["plan-close"].check(planCloseCtx)` +
 * `describeCheckpointVacuity` call `enforce()` already ran internally — a
 * read of the SAME predicate results via the SAME exported pure functions,
 * never a second, divergent implementation of the discriminator. The SOLE
 * reader is `commands/set.ts`'s human-render branch (the `--json` branch needs
 * no reader — `doc.extra` is serialized verbatim). Written ONLY when the
 * checkpoint was fully vacuous (mirrors `formatAttestationExemptionNotice`'s
 * "silence when it doesn't apply" shape) — a genuinely satisfied close, or a
 * fully-exempted one (already announced via the separate attestation-
 * exemption notice), never gains this key at all, so every PRE-EXISTING
 * satisfied-close test fixture's `extra` shape stays byte-identical.
 */
export const PLAN_CLOSE_VACUITY_NOTICE_FIELD = "plan_close_vacuity_notice";

/**
 * spec-create's three predicates (`parentLegal` / `specKindValid` / `hasSkeleton`,
 * `gate-predicates.ts`), lifted unchanged (same order, same inputs) from `gate.ts`'s
 * former inline `runSpecCreateGate` checks array.
 */
function checkSpecCreate(ctx: GateContext): PredicateResult[] {
  const parent =
    ctx.parentType !== undefined && ctx.parentType !== null ? { type: ctx.parentType } : null;
  const results = [parentLegal(parent), specKindValid(ctx.specKind), hasSkeleton(ctx.content ?? "")];
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

/**
 * Human-readable explanation for one {@link ReachabilityResult.why} value —
 * the ONE place this prose is written (spec-verify-reachability-plan-promote-
 * early-warning §Design Decisions D2; `"unknown"` branch added by spec-plan-
 * closure-must-be-loud-terminality-divergence-silent §Design Decisions
 * DD-4(b)), consumed by BOTH `planPromoteReachabilityAdvisory` and
 * `feedAttestationFloor`'s unreachable branch so the two surfaces never drift
 * apart on wording.
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
      "this plan has no spec-tier ancestor at all — `lore verify` requires one to " +
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
 * incompatibility used to surface only hours later, at plan-close
 * (`ATTESTATION_FLOOR_NOT_MET`), with no earlier signal at all.
 *
 * Consumes the SAME `verifyReachability` derivation `feedAttestationFloor`
 * uses at plan-close (§Design Decisions D2 — one shared computation, never
 * two) — `ctx.hasSpecParent`/`ctx.parentSpecScriptAcCount`, the identical
 * fields a plan-close caller populates for its own branch.
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
    `ADVISORY (does not block this promote): \`lore verify\` will be structurally ` +
    `unreachable for ${plan} — ${describeReachabilityWhy(reachability.why as Exclude<ReachabilityResult["why"], null>)}. ` +
    `At plan-close, the attestation floor (SPEC-069) will have no \`lore verify\` path ` +
    `to satisfy it. Two real options before that happens: (1) parent this plan under a ` +
    `spec that declares >= 1 script-mode acceptance criterion (\`lore ac add <spec> <id> ` +
    `--mode script ...\`), or (2) plan on declaring a typed exemption at close time ` +
    `(\`extra.attestation_exempt: true\` + \`extra.attestation_exempt_reason\` + ` +
    `\`extra.attestation_exempt_kind: "pipeline-unreachable"\`).`
  );
}

/**
 * `plan-promote`'s domain-doc EARLY-WARNING advisory (spec-plan-close-
 * predicates-measure-invariants-an-applicability, task T1 item 9) — mirrors
 * {@link planPromoteReachabilityAdvisory}'s exact shape: a SEPARATE output from
 * `checkPlanPromote`'s verdict, never folded into its `PredicateResult[]`
 * (advisory never changes the outcome). Fires when `prd_sync` is enabled AND
 * the plan's ancestor spec resolves NO domain doc at all — the same corpus
 * fact `plan-close`'s `prdOutlineSynced` would later find itself NOT-APPLICABLE
 * against (§Design Decisions D1/D6), surfaced here EARLY (at promote time)
 * rather than only discovered as a close-time advisory, per the governing
 * ADR's own reasoning that a plan with nothing to verify/sync must be flagged
 * when it is promoted, not discovered later.
 *
 * @param ctx - Reads only `prdSyncEnabled`, `hasSpecParent`,
 *   `prdSyncDomainDocResolved`, and `parentSpecPointer`/`targetIdOrSlug` (for
 *   the message) — ignores every other field.
 * @returns `null` when `prdSyncEnabled` is not `true`, OR `hasSpecParent` is
 *   not `true` (nothing to resolve a domain doc FROM — `plan-close`'s own
 *   `prdSyncSynced` field would never even be populated in that case either),
 *   OR `prdSyncDomainDocResolved` is `true`; an advisory string naming the
 *   ancestor spec and the `lore link ... --type implements` wiring command
 *   otherwise (including when the caller never populated
 *   `prdSyncDomainDocResolved` at all — an unresolved fact is conservatively
 *   treated the same as "no domain doc resolved", mirroring this module's
 *   existing bias toward surfacing rather than silently suppressing an
 *   advisory).
 * @example
 * planPromotePrdSyncAdvisory({ prdSyncEnabled: false, hasSpecParent: true }); // => null
 * @example
 * planPromotePrdSyncAdvisory({
 *   prdSyncEnabled: true, hasSpecParent: true, prdSyncDomainDocResolved: true,
 * }); // => null
 * @example
 * planPromotePrdSyncAdvisory({
 *   prdSyncEnabled: true, hasSpecParent: true, prdSyncDomainDocResolved: false,
 *   parentSpecPointer: { slug: "spec-x", title: "X", status: "approved" },
 * }); // => advisory string naming "spec-x"
 */
export function planPromotePrdSyncAdvisory(ctx: GateContext): string | null {
  if (ctx.prdSyncEnabled !== true || ctx.hasSpecParent !== true) {
    return null;
  }
  if (ctx.prdSyncDomainDocResolved === true) {
    return null;
  }
  const spec = ctx.parentSpecPointer?.slug ?? "<spec>";
  return (
    `ADVISORY (does not block this promote): this plan's ancestor spec "${spec}" resolves ` +
    `no domain doc for the prd-sync predicate (no \`parent\`/\`implements\` edge to another ` +
    `spec) — at plan-close, \`prdOutlineSynced\` will be NOT-APPLICABLE rather than enforced ` +
    `against it. Wire one via \`lore link ${spec} <domain-spec> --type implements\`, or ignore ` +
    `this if the ancestor spec genuinely has no domain-level narrative to sync.`
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
 *
 * `actorIdentityGuard` (spec claim-time-actor-identity-guard-zero-evidence-
 * release-advis, AC-IDENTITY-REJECT) runs alongside `noAnchorOverlap`,
 * subject only to its own `ctx.actorIdentityEnabled` knob (AC-IDENTITY-
 * ESCAPE) — NOT gated by `hasSpecParent` either, same rationale: a top-level/
 * prd-parented plan is exactly where orchestrator discipline was previously
 * the ONLY protection against the identity-collapse failure mode.
 */
function checkTaskClaim(ctx: GateContext): PredicateResult[] {
  const results: PredicateResult[] = [];
  if (ctx.anchorOverlapEnabled !== false) {
    results.push(
      noAnchorOverlap(ctx.candidateBy, ctx.candidateAnchors, ctx.siblingClaims, ctx.candidateSessionId),
    );
  }
  if (ctx.actorIdentityEnabled !== false) {
    results.push(
      actorIdentityGuard(
        ctx.candidateBy,
        ctx.candidateIdentitySource,
        ctx.candidateWorktree,
        ctx.candidateMachine,
        ctx.siblingClaims,
      ),
    );
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
 * verification profile demands UAT) and the honest recovery path: `lore set`
 * (CLI) has no dedicated flag for an arbitrary `extra` key yet, so the pack
 * points at the MCP `lore_set` tool's generic `extra` passthrough instead of
 * fabricating a non-existent CLI flag (this codebase's "never a broken
 * recovery command" discipline — SPEC-050's lesson).
 *
 * @remarks NON-DESTRUCTIVE recovery only (task-gate-feeding-pack-recovery-via-
 *   lore-set-extra-wholesale, 2026-07-25 incident fix) — the ORIGINAL recovery
 *   text here (`extra: {"requires_uat": true}`) was followed literally over MCP
 *   `lore_set` and REPLACED a plan's whole `extra` object, wiping its 4
 *   `extra.phases` entries (extra has no merge semantics on this write path).
 *   The rewritten instruction below fetches-merges-then-sets the FULL object,
 *   and `CorpusService.set` (`findDroppedStructuredExtraField`,
 *   `corpus-service.ts`) now REJECTS a patch that would drop `extra.phases`
 *   on a plan as a second, independent line of defense — this feeding pack is
 *   the FIRST line (don't tell the caller to do the destructive thing in the
 *   first place).
 */
function feedRequiresUat(ctx: GateContext, failures: PredicateResult[]): string {
  const target = ctx.targetIdOrSlug ?? "<plan>";
  const pack = buildFeedingPack({
    ruleSource: "corpus (verification profile)",
    ruleMarkdown:
      "Required for plan-promote: the ancestor spec's configured verification profile " +
      'requires UAT — this plan must declare `extra.requires_uat: true` before it may be ' +
      "promoted. Recovery: `extra` REPLACES the whole field wholesale on `lore_set` (it does " +
      `NOT merge) — first fetch the current extra via \`lore get ${target} --json\` (read ` +
      '`.extra`), merge `{"requires_uat": true}` into it while KEEPING every existing key ' +
      "(e.g. `phases`), then call the MCP `lore_set` tool with the FULL merged object as " +
      `\`extra\` on ${target}. \`lore set\` (CLI) has no dedicated flag for this field yet.`,
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
    'Required for plan-promote: the ancestor spec must be "approved" and declare ' +
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
  const conflict = findAnchorOverlapConflict(
    ctx.candidateBy,
    ctx.candidateAnchors,
    ctx.siblingClaims,
    ctx.candidateSessionId,
  );
  let conflictLine = "(no specific conflicting sibling could be identified)";
  if (conflict !== undefined) {
    const { sibling, pairs, kind } = conflict;
    const pathsStr = pairs.map(([a, b]) => `${a} × ${b}`).join(", ");
    conflictLine =
      `Conflicting task: ${sibling.slug} — "${sibling.title}" — held by ${sibling.by}. ` +
      `Overlapping paths: ${pathsStr}. ` +
      `${renderSessionVerdictLine(kind, ctx.candidateSessionId, sibling.session_id)} ` +
      `Recovery: \`lore release ${sibling.slug} --by ${sibling.by} --force\``;
  }
  const pack = buildFeedingPack({
    ruleSource: "corpus (sibling task claims)",
    ruleMarkdown:
      `Required for ${checkpointLabel}: declared file_anchors must not overlap a FRESH claim held ` +
      `by a different SESSION on another task in the same plan (a shared actor string is not ` +
      `evidence of a shared session). ${conflictLine}`,
    missing: selectFailures(failures).map((f) => f.reason),
  });
  return renderFeedingPack(pack);
}

/**
 * The one sentence explaining WHICH of the three conflict kinds
 * `findAnchorOverlapConflict` found — so the refusal distinguishes "provably a
 * different session" from "could not tell", the distinction
 * task-two-concurrent-orchestrators-both-resolve-to-agent-main §Silence requires
 * the gate to SAY rather than resolve silently in the permissive direction.
 *
 * @param kind - The conflict classification.
 * @param candidateSessionId - The claiming side's captured session id, if any.
 * @param siblingSessionId - The sibling claim's recorded session id, if any.
 * @returns A sentence naming the measured/unmeasured session facts.
 */
function renderSessionVerdictLine(
  kind: AnchorOverlapConflictKind,
  candidateSessionId: string | undefined,
  siblingSessionId: string | undefined,
): string {
  switch (kind) {
    case "foreign-actor":
      return "Held by a DIFFERENT actor.";
    case "foreign-session":
      return (
        `Same actor, DIFFERENT session instance (this session: ${candidateSessionId ?? "(none)"}, ` +
        `holder's session: ${siblingSessionId ?? "(none)"}) — two concurrent sessions can share one ` +
        `LORE_ACTOR, so the anchor mutex applies.`
      );
    case "session-not-measured":
      return (
        `Same actor, and the session instance is NOT MEASURED on at least one side (this session: ` +
        `${candidateSessionId ?? "(not measured)"}, holder's session: ` +
        `${siblingSessionId ?? "(not measured)"}) — that is not evidence of one session, so this ` +
        `claim is refused rather than waved through. A claim recorded before session capture ` +
        `existed heals by re-claiming it (\`lore claim <task> --by <actor>\`) from its own session, ` +
        `or by releasing it.`
      );
  }
}

/**
 * Renders the actor-identity-collision-specific feeding pack (spec claim-time-
 * actor-identity-guard-zero-evidence-release-advis, AC-IDENTITY-REJECT) —
 * names the conflicting sibling's slug/holder/worktree and the concrete
 * recovery (export a distinct `LORE_ACTOR`, or pass `--by` explicitly).
 * Mirrors `feedAnchorOverlap`'s "recompute the offending sibling from ctx"
 * shape — pointers only, never sibling body content.
 *
 * @param checkpointLabel - `"task-claim"` or `"phase-claim"` (SPEC-056 D2/D7),
 *   threaded through so one function renders both checkpoints' label.
 */
function feedActorIdentity(
  ctx: GateContext,
  failures: PredicateResult[],
  checkpointLabel: string,
): string {
  let conflictLine = "(no specific conflicting sibling could be identified)";
  for (const sibling of ctx.siblingClaims ?? []) {
    if (sibling.stale) continue;
    if (sibling.by !== ctx.candidateBy) continue;
    conflictLine =
      `Conflicting task: ${sibling.slug} — "${sibling.title}" — held by the SAME untraceable ` +
      `identity "${sibling.by}" from a different worktree/machine (worktree: ` +
      `${sibling.worktree ?? "(unknown)"}). Recovery: export a distinct ` +
      `LORE_ACTOR=agent:<branch-or-slug> for THIS session (or pass --by explicitly) and retry ` +
      `the claim.`;
    break;
  }
  const pack = buildFeedingPack({
    ruleSource: "corpus (sibling task claims)",
    ruleMarkdown:
      `Required for ${checkpointLabel}: an actor resolved via the untraceable OS-username ` +
      `fallback must not collide with a FRESH claim held under the IDENTICAL "by" from a ` +
      `different worktree/machine in the same plan — that pattern means two DIFFERENT sessions ` +
      `silently collapsed onto one identity (SPEC-042 D10). ${conflictLine}`,
    missing: selectFailures(failures).map((f) => f.reason),
  });
  return renderFeedingPack(pack);
}

/**
 * `task-claim`'s (and, since SPEC-056 D2/D7, `phase-claim`'s) feeding message —
 * dispatches to {@link feedAnchorOverlap} when the anchor-overlap predicate
 * failed (SPEC-042 D5 — its own dedicated, conflict-detail-bearing message),
 * to {@link feedActorIdentity} when the actor-identity predicate failed (AC-
 * IDENTITY-REJECT — checked SECOND, after anchor-overlap, so a claim failing
 * BOTH keeps anchor-overlap's pre-existing message, REGRESSION-safe), else
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
  const identityFailed = failures.some((f) => !f.ok && f.field === ACTOR_IDENTITY_FIELD);
  if (identityFailed) {
    return feedActorIdentity(ctx, failures, checkpointLabel);
  }
  return feedUpstreamSpecCheckpoint(
    ctx,
    failures,
    `Required for ${checkpointLabel}: the ancestor spec must be "approved".`,
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
 * `plan-close`'s attestation-ratio-conjunct fallback (spec-plan-close-predicates-
 * measure-invariants-an-applicability §D4) — MUST match `resolveAttestationMinRatio`'s
 * (`@lore/core`, config.ts) own "unconfigured" resolution exactly: `null`, meaning
 * the ratio conjunct does NOT run at all when unconfigured. This is a DELIBERATE
 * departure from the pre-§D4 `0.5` literal — a `?? 0.5` anywhere on this path would
 * silently resurrect the always-on ratio floor §D4's migration retires. Production
 * callers always resolve `ctx.attestationMinRatio` via
 * `GateEnforcer.resolveAttestationMinRatio` (which reads that same `null`-when-
 * unconfigured resolution), so this constant is only ever exercised by a hand-built
 * `GateContext` (a direct `attestationFloor`/`checkPlanClose` unit test) that omits
 * the field.
 */
const DEFAULT_ATTESTATION_MIN_RATIO: number | null = null;

/**
 * `plan-close`'s predicates (SPEC-054 + SPEC-069 §Design Decisions D1 +
 * SPEC-080 §C4 + spec-verify-reachability-plan-promote-early-warning §Scope
 * M3):
 *
 *   - `uatP0Accepted` — OPT-IN (SPEC-054): only runs when the plan declared
 *     `ctx.requiresUat === true`; `ctx.requiresUat !== true` skips it entirely
 *     (same "opt-out ⇒ no gate" shape `checkPlanPromote` uses for
 *     `hasSpecParent`, third module invariant).
 *   - `attestationFloor` — OPT-OUT (SPEC-069 D1): runs for EVERY closing plan
 *     UNLESS `ctx.attestationExempt === true` AND `attestationExemptKindValid`
 *     ALSO passes (spec-verify-reachability-plan-promote-early-warning §Design
 *     Decisions D3 — a bare `attestation_exempt: true` with no valid typed
 *     `attestation_exempt_kind` does NOT satisfy the floor: `attestationFloor`
 *     still runs as if not exempt). Deliberately not gated by `ctx.requiresUat`
 *     — a plan that never opted into UAT still owes an honest attestation
 *     floor over whatever evidence it DOES carry.
 *   - `attestationExemptKindValid` — pushed ONLY when it fails (its own PASS
 *     carries no extra signal beyond `attestationFloor` already running or
 *     not) — a plan claiming exemption with a missing/invalid kind is denied
 *     by THIS predicate's own failure, independent of whatever
 *     `attestationFloor` itself concludes from the evidence.
 *   - `prdOutlineSynced` — OPT-IN, default-OFF (SPEC-080 §C4): only runs when
 *     `ctx.prdSyncEnabled === true` AND `ctx.prdSyncSynced !== undefined` (the
 *     latter is the caller's own "a spec-tier ancestor resolved, so this
 *     predicate is even applicable" signal — a plan hanging off a `prd`
 *     directly, or unparented, never has this field set, mirroring
 *     `plan-promote`'s `hasSpecParent` vacuous-pass shape).
 *   - `assessmentFreshness` — OPT-OUT (SPEC-106 D1): runs for EVERY closing plan
 *     UNLESS `ctx.assessmentFreshnessExempt === true` (D4 — flag + non-empty
 *     reason, resolved by the caller; mirrors `attestationExempt`'s shape, but
 *     with NO separate "exempt kind" taxonomy). When the plan has no linked
 *     assessment OR no evidence/done task activity at all (D5, AC-FRESH-2) —
 *     nothing to compare, so no denial is ever invented from missing data —
 *     this checkPlanClose pushes a `PredicateNotApplicable` (`reason:
 *     "no-evidence"`) INSTEAD of calling the predicate (task-report-why-each-
 *     plan-close-predicate-passed-so-a-vacuous): the predicate itself is only
 *     ever invoked with two REAL timestamps to compare, so its own return
 *     value is always a genuinely measured `{ok: true}`/`{ok: false}`, never
 *     a vacuous pass disguised as one.
 *
 * Every predicate that runs is pushed into the SAME results array (this
 * module's "run every predicate, don't short-circuit on the first failure"
 * contract) — a plan can fail ANY subset of them independently. A
 * `PredicateNotApplicable` member (from `attestationFloor`'s zero-evidence
 * case, `prdOutlineSynced`'s absent-domain-doc case, or — Amendment A,
 * spec-plan-close-predicates-measure-invariants-an-applicability — a companion
 * entry naming `"planClaimedAcCoverage"` when the caller never resolved
 * claimed-AC coverage at all) is pushed into this SAME array too (§Design
 * Decisions D1) — `GateEnforcer.enforce` is the ONE consumer that
 * partitions it back out; `isCheckpointBlocked`/`selectFailures` already treat
 * it as non-blocking, so this function's own "run every predicate" contract
 * needs no special-casing for it.
 */
function checkPlanClose(ctx: GateContext): ApplicablePredicateResult[] {
  const results: ApplicablePredicateResult[] = [];
  if (ctx.requiresUat === true) {
    results.push(uatP0Accepted(ctx.uatVerdictPresent === true, ctx.uatP0Accepted === true));
  }
  const exemptKind = attestationExemptKindValid(ctx.attestationExempt === true, ctx.attestationExemptKind);
  // reason: exemptKind is pushed BEFORE attestationFloor (when both fail) so
  // `GateEnforcer.enforce`'s "first failure with a defined field wins" rule
  // (gate-enforcer.ts) surfaces the more ACTIONABLE cause — "your exemption
  // kind is missing/invalid" pinpoints the fix directly, vs. "attestation
  // ratio too low" which would misdirect an operator who already believes
  // they declared a valid exemption.
  if (!exemptKind.ok) {
    results.push(exemptKind);
  }
  if (ctx.attestationExempt !== true || !exemptKind.ok) {
    const floorResult = attestationFloor(
      ctx.planTasksAttestation,
      ctx.attestationMinRatio ?? DEFAULT_ATTESTATION_MIN_RATIO,
      ctx.targetIdOrSlug ?? "<plan>",
      // reason: Amendment A (spec-plan-close-predicates-measure-invariants-an-
      // applicability, added after T2 landed) — this `?? []` still runs so
      // `attestationFloor`'s conditions 1/3 (per-task attestation, plan-wide
      // ratio) evaluate NORMALLY and stay byte-identical to before; it is
      // conditions 2 (per-claimed-AC coverage) alone whose vacuous pass this
      // fallback would otherwise fabricate silently. See the companion push
      // below, which makes THAT specific omission visible instead of erasing
      // it — the narrower fix than replacing this whole call, chosen because a
      // caller building a `GateContext` with real task/evidence data but no
      // `planClaimedAcCoverage` at all (several pre-existing test fixtures do)
      // must keep getting a REAL per-task/ratio verdict, not a blanket
      // not-applicable that would also swallow conditions 1/3's own outcome.
      ctx.planClaimedAcCoverage ?? [],
      // reason: spec-declared-scope-attestation-contract-task-owned-ac-scope
      // §Facts D4 — an unresolved declared-scope fact resolves to the NAMED
      // sentinel that reports UNDECLARED, so the coverage conjunct degrades to
      // its audited `notApplicable(scope-undeclared)` verdict. An inline
      // `{scope_undeclared: false, …}` here would instead fabricate a compliant
      // declaration and pass the conjunct vacuously.
      ctx.planDeclaredScopeCoverage ?? UNRESOLVED_DECLARED_SCOPE,
    );
    results.push(floorResult);
    // reason: Amendment A — `ctx.planClaimedAcCoverage === undefined` here is a
    // CALLER-CONTRACT VIOLATION (nobody resolved claimed-AC coverage at all),
    // distinct from an explicitly-supplied `[]` (a resolved fact: "this plan
    // claims no declared script-mode ACs", which still passes condition 2
    // vacuously and correctly). Production's ONE caller (`CorpusService.set`,
    // corpus-service.ts) ALWAYS resolves this field (to `[]` or real facts)
    // whenever this branch runs — only a hand-built test `GateContext` can hit
    // this. Pushing a SEPARATE `PredicateNotApplicable` (T1's type) makes the
    // coverage conjunct's vacuous-pass-by-omission visible on
    // `GateEnforcer.enforce`'s advisory/audit channel, without perturbing
    // `floorResult` itself — the unknown-vs-determined conflation this
    // codebase already fixed once at spec-plan-closure-must-be-loud-
    // terminality-divergence-silent DD-4(b) (`ReachabilityWhy: "unknown"` vs
    // `"parent-not-spec"`). Suppressed when `floorResult` is ALREADY
    // not-applicable for an unrelated reason (zero evidence anywhere) — piling
    // a second not-applicable verdict onto the same predicate concern would be
    // redundant noise, not a new gap: there is nothing to evaluate at all in
    // that case, coverage data or not.
    //
    // reason: the suppression keys on the no-evidence reason SPECIFICALLY, not on
    // "is not applicable at all" (spec-declared-scope-attestation-contract-task-
    // owned-ac-scope §Facts D4 added a SECOND not-applicable reason,
    // `"scope-undeclared"`). A plan with real evidence whose tasks declared no
    // scope has plenty to evaluate — the caller's failure to resolve
    // `planClaimedAcCoverage` at all is still its own distinct, reportable gap,
    // so collapsing both reasons into one suppression would silently drop it.
    const suppressCompanion =
      isNotApplicable(floorResult) && floorResult.reason === "no-evidence";
    if (ctx.planClaimedAcCoverage === undefined && !suppressCompanion) {
      results.push({ notApplicable: true, reason: "referent-absent", referent: "planClaimedAcCoverage" });
    }
  }
  if (ctx.prdSyncEnabled === true && ctx.prdSyncSynced !== undefined) {
    results.push(prdOutlineSynced(ctx.prdSyncSynced, ctx.parentSpecPointer?.slug ?? "<spec>"));
  }
  if (ctx.assessmentFreshnessExempt !== true) {
    // reason: task-report-why-each-plan-close-predicate-passed-so-a-vacuous —
    // `assessmentFreshness` (gate-predicates.ts) itself returns a bare
    // `{ok: true}` for BOTH a genuinely-measured pass AND its own internal
    // "nothing to compare" carve-out (either input `undefined`) — this was
    // `describeCheckpointVacuity`'s OWN "Known limit" JSDoc's named example of
    // a conjunct whose vacuous pass renders identically to a measured one,
    // silently counting as APPLICABLE and suppressing the checkpoint-wide
    // vacuity notice. Mirrors `attestationFloor`'s own `total_evidence === 0`
    // guard one branch up: the APPLICABILITY decision (is there even a second
    // fact to compare against?) is made HERE, before the predicate runs, so
    // `assessmentFreshness` itself is called ONLY when it has two real
    // timestamps to compare — its own return value can then only ever be a
    // genuinely measured `{ok: true}` or `{ok: false}`, never a disguised
    // vacuous pass. `assessmentFreshness`'s direct callers outside this
    // checkpoint (`commands/assess.ts`'s non-blocking staleness advisory) are
    // UNCHANGED — that surface only ever reads `.ok`, and a vacuous "nothing
    // to compare" has always meant "don't warn" there too.
    //
    // reason: task-assert-the-plan-close-vacuity-discriminator-on-the-render
    // finding 4 — CONFIRMED ACCEPTABLE, not scoped out. This notApplicable push
    // reaches `GateEnforcer.recordNotApplicable`, adding ONE best-effort,
    // fire-and-forget `gate_not_applicable` audit row for every assessment-less
    // (or activity-less) closing plan — a NEW row for a case that previously
    // recorded nothing at all. That is not an incidental side effect; it IS
    // §B1.1's entire purpose (the spec this task closes: "an armed gate that
    // vacuously passes lends its authority to everything it waves through" —
    // the fix is making a vacuous pass auditable, not silencing it). The
    // mechanism is the SAME one `attestationFloor`'s/`prdOutlineSynced`'s own
    // not-applicable pushes already exercise (D1/D2's "observability never
    // changes the outcome" — a throwing/rejecting audit port can never alter
    // `enforce()`'s returned `Result`, `gate-enforcer.ts::fireAndForgetAudit`),
    // so this adds no new failure mode, no new blocking behavior, and no new
    // audit-table growth CLASS — only more instances of a class that already
    // exists in production for the sibling predicates.
    if (ctx.newestAssessmentAt === undefined || ctx.newestTaskActivityAt === undefined) {
      results.push({
        notApplicable: true,
        reason: "no-evidence",
        referent: ctx.targetIdOrSlug ?? "<plan>",
      });
    } else {
      results.push(assessmentFreshness(ctx.newestAssessmentAt, ctx.newestTaskActivityAt));
    }
  }
  return results;
}

/**
 * Renders the attestation-floor-specific feeding pack (SPEC-069 §Design Decisions
 * D1; recovery text rewritten by task-attestation-floor-feeding-pack-names-tasks-
 * but-the, 2026-07-26; AC diagnostics added by spec-plan-close-predicates-measure-
 * invariants-an-applicability §D5) — names every offending task (carries
 * `verification_evidence` but ZERO runner-attested entries), every claimed-but-
 * unattested acceptance criterion id, the plan-wide attested ratio against the
 * configured floor (ONLY when the ratio conjunct is actually configured — §D5:
 * naming a floor that is not enforcing would misdirect an operator), and the
 * literal recovery command (`lore verify <plan>` — the exact substring AC-069-1
 * pins). Pointers only (task slug/title, AC ids, never body content), mirroring
 * `feedAnchorOverlap`'s "recompute offending items from ctx" shape.
 *
 * @remarks PLAN-LEVEL EXEMPTION ONLY (2026-07-26 incident fix) — `checkPlanClose`
 *   reads `ctx.attestationExempt` / the exemption reason from the CLOSING PLAN's
 *   OWN `extra.attestation_exempt(_reason)` (see `checkPlanClose`'s own JSDoc); it
 *   never looks at anything on a task doc. The PRE-FIX pack listed offending tasks
 *   with no such caveat, and an operator (observed 2026-07-26, SPEC-080 close-out)
 *   followed the pattern set by "the pack names the offending item" and wrote
 *   `extra.attestation_exempt` onto a TASK — a silently dead write this gate never
 *   reads, so the plan stayed blocked with no error explaining why. The offending-
 *   task list below is kept (still real diagnostic value — it tells the operator
 *   WHICH tasks are dragging the ratio down / missing attestation), but the
 *   recovery text now says explicitly where the exempt fields belong, and — like
 *   `feedRequiresUat`'s fixed shape (SPEC-076 wholesale-replace guard, same
 *   incident class one checkpoint over) — instructs a fetch-merge-set flow rather
 *   than a bare `lore set --extra` literal that would clobber the plan's other
 *   structured `extra` keys (`phases`, `claim`, `verification_evidence`; also now
 *   independently rejected by `CorpusService.set`'s dropped-field guard, but this
 *   pack is the FIRST line of defense — don't tell the caller to do the
 *   destructive thing in the first place).
 *
 *   The canonical "genuinely no oracle to attest against" rationale class named
 *   here is a RED/TDD task whose Expected-state is a currently-failing,
 *   time-bound test (red before green) — evidence exists (the failing run WAS
 *   recorded) but attesting it would misrepresent an intentionally-red state as
 *   verified; that is a PLAN-LEVEL judgment call about the whole plan's execution
 *   window, not a per-task field.
 *
 * @remarks REACHABILITY-AWARE (spec-verify-reachability-plan-promote-early-
 *   warning §Scope M2 / §Design Decisions D2) — the pack branches on the SAME
 *   `verifyReachability` derivation `planPromoteReachabilityAdvisory` consumes
 *   at plan-promote time. REACHABLE branch: the `Recovery: run \`lore verify
 *   ...\`` sentence through the end is BYTE-IDENTICAL to the pre-existing text
 *   (AC-VRW-2 regression pin — do not edit without updating
 *   `feed-attestation-reachability.test.ts`'s fixture). UNREACHABLE branch:
 *   that sentence is REPLACED by a precondition explanation (why `lore verify`
 *   cannot run for THIS plan) plus the two real options; the exemption-
 *   mechanics paragraph below it is kept verbatim (duplicated in source
 *   rather than extracted into a shared constant, deliberately — a shared
 *   constant refactor is exactly the kind of "helpful cleanup" that could
 *   silently perturb the byte-pinned reachable branch).
 */
function feedAttestationFloor(ctx: GateContext, failures: PredicateResult[]): string {
  const tasks = ctx.planTasksAttestation ?? [];
  const offending = tasks.filter((t) => t.evidenceCount > 0 && t.attestedCount === 0);
  const totalEvidence = tasks.reduce((sum, t) => sum + t.evidenceCount, 0);
  const totalAttested = tasks.reduce((sum, t) => sum + t.attestedCount, 0);
  const ratio = totalEvidence > 0 ? totalAttested / totalEvidence : 0;
  const minRatio = ctx.attestationMinRatio ?? DEFAULT_ATTESTATION_MIN_RATIO;
  // reason: spec-plan-close-predicates-measure-invariants-an-applicability §D5 —
  // names every claimed-but-unattested AC id, computed from the SAME
  // `deriveClaimedAcCoverage` (@lore/core) the predicate itself delegates to via
  // `deriveAttestationSummary` — never a second hand-rolled derivation.
  const claimedCoverage = deriveClaimedAcCoverage(ctx.planClaimedAcCoverage ?? []);
  const plan = ctx.targetIdOrSlug ?? "<plan>";
  const offendingLine =
    offending.length > 0
      ? `Task(s) with self-reported-only evidence (zero runner-attested entries): ` +
        `${offending.map((t) => `${t.slug} — "${t.title}"`).join(", ")}. Listed for ` +
        `DIAGNOSTIC purposes only — the exemption below is PLAN-level; do NOT write ` +
        `\`extra.attestation_exempt\` onto any of these tasks, this gate never reads it there. `
      : "";
  // reason: §D5 — names every unattested claimed AC id; empty when the caller
  // never resolved claimed-AC coverage (or every claimed AC IS attested), so a
  // ctx fixture that predates this field (e.g. feed-attestation-reachability
  // .test.ts's byte-pinned fixture) renders no extra text here at all.
  const unattestedAcsLine =
    claimedCoverage.unattested_acs.length > 0
      ? `Claimed acceptance criteria with zero runner-attested evidence: ` +
        `${claimedCoverage.unattested_acs.join(", ")}. `
      : "";
  // reason: spec-declared-scope-attestation-contract-task-owned-ac-scope §Facts
  // D4 — the DECLARED-scope ids are the pack's only line naming the actual
  // BLOCKING cause (the exercised line above is diagnostics: after D4 it can no
  // longer deny a close). Worded distinctly from that line ("Declared-scope …"
  // vs "Claimed …") so each remains independently assertable — a shared prefix
  // would make the two indistinguishable to a substring oracle.
  const declaredScope = ctx.planDeclaredScopeCoverage;
  const unattestedDeclaredLine =
    declaredScope !== undefined && declaredScope.unattested_acs.length > 0
      ? `Declared-scope acceptance criteria with zero runner-attested evidence: ` +
        `${declaredScope.unattested_acs.join(", ")} — these are the BLOCKING ids ` +
        `(declared via \`extra.ac_scope\` on the plan's tasks). `
      : "";
  // reason: task-plan-close-must-block-when-the-coverage-conjunct-is-scope —
  // when the BLOCKING cause is an undeclared scope, the pack must name the
  // missing DECLARATION and its writer, not just "attest more". Keyed on the
  // FAILURE (not on `ctx.planDeclaredScopeCoverage`) so every pre-existing
  // fixture — including `feed-attestation-reachability.test.ts`'s byte-pinned
  // one — renders exactly as before. Inserted BEFORE the byte-pinned `Recovery:`
  // sentence, per §D5's "new diagnostics go above the pinned tail".
  const scopeUndeclaredFailed = failures.some(
    (f) => !f.ok && f.field === ATTESTATION_SCOPE_UNDECLARED_FIELD,
  );
  const evidenceBearing = tasks.filter((t) => t.evidenceCount > 0);
  const scopeUndeclaredLine = scopeUndeclaredFailed
    ? `BLOCKING: this plan carries verification evidence but at least one evidence-bearing ` +
      `task declares no \`extra.ac_scope\`, so the audited work was never matched against a ` +
      `declared claim. Evidence-bearing task(s) to check: ` +
      `${evidenceBearing.length > 0 ? evidenceBearing.map((t) => t.slug).join(", ") : "(none resolved)"}. ` +
      `Declare what each one owns with \`lore scope add <task> <AC-ID>...\` (an explicitly ` +
      `EMPTY declaration is legitimate — \`lore scope rm\` down to none records "claims ` +
      `nothing" and satisfies this conjunct; SILENCE does not). `
    : "";
  // reason: §D5 — printed ONLY when the ratio conjunct is actually configured
  // (minRatio !== null); naming a floor that is not being enforced would
  // misdirect an operator into thinking the ratio is the live blocking cause.
  // MUST contain the literal substring "attested ratio" (AC-PCI-9) when printed.
  const ratioLine =
    minRatio !== null
      ? `The plan-wide attested ratio must be >= ${minRatio} (currently ${ratio.toFixed(2)}). `
      : "";
  // reason: DD-4(b) — thread `ctx.hasSpecParent`'s THREE-way shape through
  // verbatim rather than collapsing it to a boolean-derived "spec"/null pair.
  // `undefined` (the caller never populated this optional field — exactly
  // what the pre-DD-4(a) plan-close call site did) must reach
  // `verifyReachability` as `undefined` so it can report the `"unknown"`
  // outcome; only an EXPLICIT `hasSpecParent === false` (the caller resolved
  // that there is no spec-tier ancestor) may collapse to `null`
  // ("parent-not-spec"). Do not simplify this back to a two-way ternary.
  const reachability = verifyReachability(
    ctx.hasSpecParent === true ? "spec" : ctx.hasSpecParent === false ? null : undefined,
    ctx.parentSpecScriptAcCount,
  );
  const recoveryText = reachability.reachable
    ? // reason: BYTE-PINNED (AC-VRW-2 regression) — see this function's own
      // @remarks above. Do not touch this branch's text WITHOUT re-capturing
      // `feed-attestation-reachability.test.ts`'s fixture from the real
      // function (never hand-typing it). Last deliberate re-capture: SPEC-069
      // AC-069-8 — the exemption paragraph used to instruct a manual
      // fetch-merge-set through `lore_set` and stated that "`lore set` (CLI)
      // has no dedicated flag for this field yet". That became FALSE the
      // moment `lore plan exempt-attestation` shipped, and a pack that still
      // tells the operator to hand-merge a field WITH a dedicated writer is
      // the very defect this spec closes, restated as guidance.
      `Recovery: run \`lore verify ${plan}\` to record attested evidence against each ` +
      `task's declared script-mode acceptance criteria (declare one first via ` +
      `\`lore ac add <spec> <id> --mode script ...\` if none exists yet). If this plan ` +
      `genuinely has no oracle to attest against for some of its tasks — the canonical ` +
      `case is a RED/TDD task whose Expected state is a currently-failing, time-bound ` +
      `test (red before green: the evidence is real, attesting it would misrepresent an ` +
      `intentionally-red state as verified) — declare a TYPED exemption with its ` +
      `DEDICATED WRITER: \`lore plan exempt-attestation ${plan} --reason "<why>" --kind ` +
      `<red-tdd|no-oracle|pipeline-unreachable|other>\`. It authors ` +
      `\`extra.attestation_exempt\` + \`extra.attestation_exempt_reason\` + ` +
      `\`extra.attestation_exempt_kind\` on the PLAN ITSELF, never on a task, and it ` +
      `READ-MERGE-WRITES \`extra\`, so \`phases\` and every other existing key survives ` +
      `— do NOT hand-merge via \`lore set\`/\`lore_set\`, which REPLACE \`extra\` wholesale. ` +
      `A blank reason is refused, so the audit trail always answers who exempted this ` +
      `plan and why.`
    : `Precondition unmet: \`lore verify\` cannot run for ${plan} — ` +
      `${describeReachabilityWhy(reachability.why as Exclude<ReachabilityResult["why"], null>)} — ` +
      `so no attested evidence can ever be recorded against it via that path. Two real ` +
      `options: (1) reparent this plan under a spec that declares >= 1 script-mode ` +
      `acceptance criterion (\`lore ac add <spec> <id> --mode script ...\`), or (2) declare ` +
      `a typed exemption on this plan (the canonical kind for this case is ` +
      `\`attestation_exempt_kind: "pipeline-unreachable"\` — see below). If this plan ` +
      `genuinely has no oracle to attest against for some of its tasks — the canonical ` +
      `case is a RED/TDD task whose Expected state is a currently-failing, time-bound ` +
      `test (red before green: the evidence is real, attesting it would misrepresent an ` +
      `intentionally-red state as verified) — declare a TYPED exemption with its ` +
      `DEDICATED WRITER: \`lore plan exempt-attestation ${plan} --reason "<why>" --kind ` +
      `<red-tdd|no-oracle|pipeline-unreachable|other>\`. It authors ` +
      `\`extra.attestation_exempt\` + \`extra.attestation_exempt_reason\` + ` +
      `\`extra.attestation_exempt_kind\` on the PLAN ITSELF, never on a task, and it ` +
      `READ-MERGE-WRITES \`extra\`, so \`phases\` and every other existing key survives ` +
      `— do NOT hand-merge via \`lore set\`/\`lore_set\`, which REPLACE \`extra\` wholesale. ` +
      `A blank reason is refused, so the audit trail always answers who exempted this ` +
      `plan and why.`;
  const pack = buildFeedingPack({
    ruleSource: "corpus (task verification_evidence)",
    ruleMarkdown:
      `Required for plan-close: every acceptance criterion a task DECLARES it owns ` +
      `(\`extra.ac_scope\` ∩ the governing spec's script-mode criteria) must carry at ` +
      `least one runner-attested entry; a task carrying only self-reported evidence is ` +
      `REPORTED below but no longer blocks on its own. ` +
      `${scopeUndeclaredLine}${unattestedDeclaredLine}${unattestedAcsLine}${ratioLine}${offendingLine}` +
      recoveryText,
    missing: selectFailures(failures).map((f) => f.reason),
    // reason: the plan-level-only fetch-merge-set instruction plus the offending-
    // task diagnostic list routinely exceeds `DEFAULT_FEEDING_MAX_CHARS` (800) —
    // this is synthesized guidance text, not a slice of an arbitrary-length doc
    // (the thing the default budget protects against), so a wider explicit budget
    // is safe here. 2900 covers the fixed instructional text (~1050 chars), the
    // undeclared-scope BLOCKING line and its task list (~520 chars, added by
    // task-plan-close-must-block-when-the-coverage-conjunct-is-scope — raised
    // from 2200 in the same edit, because a budget left at 2200 would silently
    // truncate the byte-pinned `Recovery:` tail AC-VRW-2 asserts), plus several
    // offending tasks' `slug — "title"` pairs before truncating.
    maxChars: 2900,
  });
  return renderFeedingPack(pack);
}

/**
 * Renders the `assessmentFreshness`-specific feeding pack (SPEC-106) — names the
 * plan's stale assessment timestamp against the newer task activity that outdated
 * it, and the EXACT re-run command (`lore assess <plan>`, AC-FRESH-1's own
 * requirement) rather than a paraphrase. Pointers only (timestamps, never the
 * assessment doc's content), mirroring `feedAttestationFloor`'s "recompute the
 * recovery text from ctx" shape.
 */
function feedAssessmentFreshness(ctx: GateContext, failures: PredicateResult[]): string {
  const plan = ctx.targetIdOrSlug ?? "<plan>";
  const newestAssessment = ctx.newestAssessmentAt ?? "unknown";
  const newestActivity = ctx.newestTaskActivityAt ?? "unknown";
  const pack = buildFeedingPack({
    ruleSource: "corpus (assessment vs. task audit activity)",
    ruleMarkdown:
      `Required for plan-close: the plan's stored assessment (recorded ${newestAssessment}) predates ` +
      `evidence/done activity recorded at ${newestActivity} on this plan's tasks — the assessment ` +
      `describes an intermediate state, not the plan's current outcome (SPEC-106). Recovery: run ` +
      `\`lore assess ${plan}\` to produce a fresh assessment reflecting the latest task activity, then ` +
      `retry the close. If this plan's activity since the last assessment is genuinely immaterial to its ` +
      `judged outcome, declare \`extra.assessment_freshness_exempt: true\` plus a non-empty ` +
      `\`extra.assessment_freshness_exempt_reason\` on ${plan} instead (fetch-merge-set via the MCP ` +
      `\`lore_set\` tool — \`extra\` REPLACES the whole field wholesale, it does NOT merge).`,
    missing: selectFailures(failures).map((f) => f.reason),
  });
  return renderFeedingPack(pack);
}

/**
 * The additional sentence {@link feedPlanClose} appends to whichever OTHER
 * predicate's feeding pack it renders, when `assessmentFreshness` ALSO failed
 * alongside it (SPEC-106) — mirrors the pre-existing `attestationNote`/
 * `prdSyncNote` "additionally unmet" pattern one level up in that function.
 */
function assessmentFreshnessNote(ctx: GateContext): string {
  return (
    ` Additionally, this plan's stored assessment is now stale — see \`lore assess ` +
    `${ctx.targetIdOrSlug ?? "<plan>"}\` to produce a fresh one before closing.`
  );
}

/**
 * Renders the `prdOutlineSynced`-specific feeding pack (SPEC-080 §C4, contract
 * pointer added by spec-plan-close-predicates-measure-invariants-an-
 * applicability §D7/Deliver-4) — names all three repair verbs the spec's own
 * text calls for (`lore outline set`, `lore set <domain-doc>`,
 * `lore outline exempt`), degrading to a link-first message when the caller
 * never resolved a domain doc at all (`ctx.prdSyncDomainDocSlug` absent — no
 * ancestor-spec `parent`/`implements` edge to a domain doc exists yet).
 * Pointers only (domain doc slug, never its content), mirroring
 * `feedAttestationFloor`'s "recompute the recovery text from ctx" shape.
 *
 * Quotes a POINTER-SIZED slice of `PREDICATE_CONTRACTS[PRD_SYNC_FIELD]` (field
 * + invariant + measured — never the full `known_false_*` lists, §D7's own
 * "keep it pointer-sized" instruction) so the operator blocked on this
 * predicate reads its invariant/measurement directly, without a second
 * `lore gate --explain plan-close` round trip.
 */
function feedPrdOutlineSynced(ctx: GateContext, failures: PredicateResult[]): string {
  const plan = ctx.targetIdOrSlug ?? "<plan>";
  const domainDoc = ctx.prdSyncDomainDocSlug;
  const contract = PREDICATE_CONTRACTS[PRD_SYNC_FIELD];
  const contractLine = `Contract (field: ${PRD_SYNC_FIELD}) — invariant: ${contract.invariant} Measured: ${contract.measured} `;
  const recovery =
    domainDoc !== undefined
      ? `Recovery: update the outline entry (\`lore outline set <prd> --section <key> ...\`) ` +
        `and/or the linked domain doc's narrative (\`lore set ${domainDoc} --content ...\`) — ` +
        `or, if this plan genuinely made no domain-narrative-affecting change, record an ` +
        `exemption via \`lore outline exempt ${plan} --reason "..."\`.`
      : `No domain doc is linked from this plan's ancestor spec (via \`parent\` or ` +
        `\`implements\`). Recovery: link one via \`lore outline set <prd> --section <key> ` +
        `--links <domain-doc-slug>:detail\`, or, if this plan genuinely has no domain ` +
        `narrative to sync, record an exemption via \`lore outline exempt ${plan} --reason ` +
        `"..."\`.`;
  const pack = buildFeedingPack({
    ruleSource: "corpus (domain doc content diff)",
    ruleMarkdown:
      `Required for plan-close: the plan's linked domain doc must carry at least one ` +
      `version whose content differs from its predecessor within the plan's execution ` +
      `window (SPEC-080 C4). ${contractLine}${recovery}`,
    missing: selectFailures(failures).map((f) => f.reason),
    // reason: this is synthesized guidance text (contract pointer + repair-verb
    // recovery instructions), not a slice of an arbitrary-length doc — the
    // thing `DEFAULT_FEEDING_MAX_CHARS` (800) protects against — so a wider
    // explicit budget is safe here, mirroring `feedAttestationFloor`'s
    // identical rationale. Without this, the §D7 contract pointer (~600 chars)
    // pushes the mandatory `lore outline set`/`lore set`/`lore outline exempt`
    // repair verbs past the default truncation point.
    maxChars: 1800,
  });
  return renderFeedingPack(pack);
}

/**
 * `plan-close`'s feeding message — dispatches between FOUR independent failure
 * families (SPEC-054's `uatP0Accepted`, SPEC-069's `attestationFloor`, SPEC-080's
 * `prdOutlineSynced`, SPEC-106's `assessmentFreshness`, all on `checkPlanClose`,
 * see that function's own JSDoc):
 *
 *   - ONLY `assessmentFreshness` failed → {@link feedAssessmentFreshness} alone.
 *   - ONLY `prdOutlineSynced` failed → {@link feedPrdOutlineSynced} alone.
 *   - ONLY `attestationFloor` failed (with or without `prdOutlineSynced`/
 *     `assessmentFreshness` also failing) → {@link feedAttestationFloor}, with
 *     one extra sentence appended per OTHER also-failing predicate — REGRESSION:
 *     byte-identical to pre-SPEC-106 when `assessmentFreshness` didn't fail
 *     (every pre-existing `attestation-floor.test.ts` scenario never sets
 *     `newestAssessmentAt`/`newestTaskActivityAt`, so `assessmentStaleFailed` is
 *     always `false` there).
 *   - `uatP0Accepted` failed (with or without the other three also failing) →
 *     the pre-existing `lore uat record`-naming message, UNCHANGED wording
 *     when every other predicate passed (REGRESSION: byte-identical to
 *     pre-SPEC-069/-080/-106 — `uat-service.test.ts`'s `.toContain("lore uat
 *     record")` assertions and `requires-uat-gate.test.ts`'s STATE scenario
 *     both pin this), with one extra sentence per OTHER failing predicate.
 */
function feedPlanClose(ctx: GateContext, failures: PredicateResult[]): string {
  const uatFailed = failures.some((f) => !f.ok && f.field === PLAN_CLOSE_FIELD);
  // reason: an invalid/missing exemption kind (spec-verify-reachability-plan-
  // promote-early-warning §Scope M3) is routed to the SAME feeding pack as a
  // plain attestation-floor failure — "the exemption does not satisfy the
  // floor" IS an attestation-floor failure, just with a different immediate
  // cause; two separate feeding-pack branches for the same underlying concern
  // would duplicate the recovery instructions and risk them drifting apart.
  const attestationFailed = failures.some(
    (f) =>
      !f.ok &&
      (f.field === ATTESTATION_FLOOR_FIELD ||
        f.field === ATTESTATION_EXEMPT_KIND_FIELD ||
        // reason: task-plan-close-must-block-when-the-coverage-conjunct-is-scope
        // — an undeclared scope IS an attestation-floor concern (same predicate,
        // same recovery surface: declare, verify, or take the plan-level
        // exemption), so it routes to the SAME pack rather than a fourth branch
        // that would duplicate — and eventually contradict — those instructions.
        // `feedAttestationFloor` renders the scope-specific line for it.
        f.field === ATTESTATION_SCOPE_UNDECLARED_FIELD),
  );
  const prdSyncFailed = failures.some((f) => !f.ok && f.field === PRD_SYNC_FIELD);
  const assessmentStaleFailed = failures.some((f) => !f.ok && f.field === ASSESSMENT_FRESHNESS_FIELD);
  const assessmentNote = assessmentStaleFailed ? assessmentFreshnessNote(ctx) : "";

  if (assessmentStaleFailed && !uatFailed && !attestationFailed && !prdSyncFailed) {
    return feedAssessmentFreshness(ctx, failures);
  }

  if (prdSyncFailed && !uatFailed && !attestationFailed) {
    return feedPrdOutlineSynced(ctx, failures) + assessmentNote;
  }

  if (attestationFailed && !uatFailed) {
    const attestationText = feedAttestationFloor(ctx, failures);
    if (!prdSyncFailed) {
      return attestationText + assessmentNote;
    }
    return (
      `${attestationText}\n\nAdditionally, the domain-doc sync predicate is unmet — see ` +
      `\`lore outline exempt ${ctx.targetIdOrSlug ?? "<plan>"} --reason "..."\` or update the ` +
      `linked domain doc.${assessmentNote}`
    );
  }

  const uncovered = ctx.uatUncoveredP0 ?? [];
  const detail =
    uncovered.length > 0
      ? ` Uncovered P0 requirements: ${uncovered.join(", ")}.`
      : "";
  const attestationNote = attestationFailed
    ? ` Additionally, the execution-time attestation floor is unmet — see ` +
      `\`lore verify ${ctx.targetIdOrSlug ?? "<plan>"}\`.`
    : "";
  const prdSyncNote = prdSyncFailed
    ? ` Additionally, the domain-doc sync predicate is unmet — see \`lore outline exempt ` +
      `${ctx.targetIdOrSlug ?? "<plan>"} --reason "..."\` or update the linked domain doc.`
    : "";
  const pack = buildFeedingPack({
    ruleSource: "corpus (UAT verdict)",
    ruleMarkdown:
      `Required for plan-close: a plan declaring \`extra.requires_uat: true\` may only be ` +
      `archived after a linked UAT verdict shows P0 acceptance (verdict not "reject", no ` +
      `rejected P0 journey, no uncovered P0 requirement, no UIUX blocker).${detail} ` +
      `Recovery: run acceptance (\`/lore-uat\`) then \`lore uat record ` +
      `${ctx.targetIdOrSlug ?? "<plan>"} --json-file <verdict.json>\`.${attestationNote}${prdSyncNote}${assessmentNote}`,
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
 * `checkReviewJudgment`'s failure when the WORST independent current-version
 * judgment is `"reject"` (SPEC-103 D3 anti-lottery — a reject can never be outrolled
 * by a later approve on the SAME version).
 */
export const JUDGMENT_REJECTED_REASON = "JUDGMENT_REJECTED";

/** `checkReviewJudgment`'s failure when the WORST independent current-version judgment is `"escalate"`. */
export const JUDGMENT_ESCALATED_REASON = "JUDGMENT_ESCALATED";

/**
 * `true` exactly when `error` is a `review-judgment` gate denial whose propagating
 * reason is {@link JUDGMENT_ESCALATED_REASON} — the ONE verdict that gates EVERY doc
 * type, not only the ones in `workflow.review.judgment_required_types`
 * (spec-an-escalate-blocks-approval-for-every-doc-type-and-the D1).
 *
 * Lives here, beside the reason constant it looks for, so
 * `ReviewService.enforceJudgmentRequiredGate` never string-matches a gate reason
 * itself — the same "a LoreError-shape predicate belongs with the wiring that owns
 * the shape" placement {@link isNonPlanParentError} already uses in this module.
 * Keyed on `GateEnforcer.enforce`'s STRUCTURED `value: reasons` field (its own
 * documented denial shape), never on the human-readable `message` prose. That coupling
 * is pinned by an external oracle rather than by convention: an `enforce` that stopped
 * populating `value` would make this answer `false` for a real escalate — turning the
 * universal gate silently off for ungated types — and
 * `tests/unit/service/review-judgment-escalate-scope.test.ts`'s AC-ESC-1 cases go RED
 * the moment that happens.
 *
 * @param error - The `LoreError` a failed `enforce("review-judgment", ctx)` returned.
 * @returns `false` for every non-`VALIDATION_ERROR` code, for a denial carrying no
 *   reasons array, and for a `reject`/`NO_JUDGMENT`/provenance-collision denial —
 *   those three stay scoped to the configured types (D1).
 */
export function isJudgmentEscalatedDenial(error: LoreError): boolean {
  if (error.code !== "VALIDATION_ERROR") return false;
  const reasons = error.value;
  return Array.isArray(reasons) && reasons.includes(JUDGMENT_ESCALATED_REASON);
}

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
  const ruleMarkdown = collision
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
 * Builds the `candidateBy` / `candidateAnchors` / `siblingClaims` /
 * `candidateSessionId` set `task-claim`'s `noAnchorOverlap` predicate consumes
 * (SPEC-042 §Design Decisions D5, extended by
 * task-two-concurrent-orchestrators-both-resolve-to-agent-main) — co-located
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
 * @param candidateSessionId - The claiming session's captured
 *   `TaskClaim.session_id` (see {@link GateContext.candidateSessionId}).
 *   Deliberately a PARAMETER, never read from `process.env` inside this builder:
 *   an ambient read here would make every gate unit test's verdict depend on
 *   whether the test process happens to run under a Claude Code session — a
 *   machine-dependent oracle, which is worse than no oracle. The SERVICE captures
 *   it (`TaskWorkflowService.claim`) and hands it down.
 */
export function buildAnchorGateContext(
  candidateBy: string,
  candidateTask: DocRecord,
  siblingTasks: DocRecord[],
  nowIso: string,
  ttlMinutes: number,
  candidateSessionId?: string,
): Pick<GateContext, "candidateBy" | "candidateAnchors" | "siblingClaims" | "candidateSessionId"> {
  const candidateAnchors = extractFileAnchors(candidateTask);
  const siblingClaims: SiblingClaimInfo[] = [];
  for (const sibling of siblingTasks) {
    if (sibling.id === candidateTask.id) continue;
    const claim = extractClaim(sibling);
    if (claim === undefined) continue;
    siblingClaims.push({
      slug: sibling.slug,
      title: sibling.title,
      by: claim.by,
      at: claim.at,
      stale: isClaimStale(claim, nowIso, ttlMinutes),
      anchors: extractFileAnchors(sibling),
      // reason: claim-time-actor-identity-guard-zero-evidence-release-advis
      // AC-IDENTITY-REJECT — `actorIdentityGuard` needs each sibling's own
      // worktree/machine to establish "different execution context"; omitted
      // (not `undefined`-valued) when the sibling's own claim never declared
      // one, matching `TaskClaim`'s own optional-field shape (`@lore/core`).
      ...(claim.worktree !== undefined ? { worktree: claim.worktree } : {}),
      ...(claim.machine !== undefined ? { machine: claim.machine } : {}),
      // reason: task-two-concurrent-orchestrators-both-resolve-to-agent-main —
      // `noAnchorOverlap` compares SESSION instances, not actor strings. Omitted
      // (never `undefined`-valued, `exactOptionalPropertyTypes`) when the
      // sibling's claim predates session capture; `compareClaimSessions` then
      // reaches "not-measured", which REFUSES rather than permits.
      ...(claim.session_id !== undefined ? { session_id: claim.session_id } : {}),
    });
  }
  return {
    candidateBy,
    candidateAnchors,
    siblingClaims,
    ...(candidateSessionId !== undefined ? { candidateSessionId } : {}),
  };
}

/**
 * The `ac-cite` checkpoint (spec-baseline-slice-2 §C4), exported by name so its one evaluator
 * (`ac-cite-gate.ts::decideCiteGate`) reaches it without a `Partial` registry lookup that could be undefined.
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
  // reason: spec-baseline-slice-2 §C4 — the citation gate. Evaluated by `admitAcWrite`
  // (ac-write-chokepoint.ts), not `GateEnforcer`: its on/off is the three-state
  // `workflow.gates."ac-cite".mode`. Not in ALL_GATE_CHECKPOINTS (same precedent as task-create).
  "ac-cite": AC_CITE_CHECKPOINT,
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
