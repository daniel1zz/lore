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
 *   partiality can never return.
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
  anchorsOverlap,
  extractClaim,
  extractFileAnchors,
  isClaimStale,
  lintAcQuantifiability,
  checkOracleCoverage,
  type AcceptanceCriterion,
  type DocRecord,
  type LoreError,
  // reason: SPEC-075 D6 — TaskAttestationInfo's home MOVED to @lore/core
  // (evidence-panel.ts), read from there directly rather than re-exported
  // through gate-predicates.ts (see that file's own JSDoc for the type).
  type TaskAttestationInfo,
  type VerificationProfile,
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
  ANCHOR_OVERLAP_FIELD,
  ACTOR_IDENTITY_FIELD,
  AC_QUANTIFIABLE_FIELD,
  NO_ACCEPTANCE_CRITERIA_REASON,
  DEFAULT_MIN_ACS,
  ORACLE_COVERAGE_FIELD,
  REQUIRES_UAT_FIELD,
  PLAN_CLOSE_FIELD,
  ATTESTATION_FLOOR_FIELD,
  PRD_SYNC_FIELD,
  type PredicateResult,
  type SiblingClaimInfo,
} from "./gate-predicates.js";
import { buildFeedingPack, renderFeedingPack } from "./gate-feeding.js";

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
  | "phase-claim";

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
   * `workflow.gates."task-claim".actor_identity.enabled` resolved by the
   * CALLER (AC-IDENTITY-ESCAPE) — `false` skips `actorIdentityGuard` entirely,
   * leaving `noAnchorOverlap`/`upstreamApproved` untouched. Absent means
   * enabled (same default philosophy as `anchorOverlapEnabled`).
   */
  readonly actorIdentityEnabled?: boolean;

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
   * `checkPlanClose` entirely (the same "opt-out ⇒ vacuous pass" shape
   * `hasSpecParent`/`requiresUat` use elsewhere in this module) — the exempt
   * plan closes regardless of its tasks' evidence/attestation state.
   */
  readonly attestationExempt?: boolean;
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
   * The resolved `workflow.attestation.min_ratio` floor (SPEC-069, default
   * 0.5) — resolved by the CALLER via `GateEnforcer.resolveAttestationMinRatio`
   * (module invariant: no config access here, mirrors `verificationProfile`'s
   * caller-resolved shape). `undefined` falls back to `attestationFloor`'s own
   * default-matching literal in `checkPlanClose` below — only exercised by a
   * ctx built without this field (e.g. a hand-built test fixture).
   */
  readonly attestationMinRatio?: number;

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
   * valid `extra.prd_sync_exempt`; `false` when neither holds. `undefined`
   * means "not applicable" — the plan has no spec-tier ancestor to resolve a
   * domain doc from at all (mirrors `hasSpecParent`'s vacuous-pass shape) —
   * `checkPlanClose` only pushes `prdOutlineSynced`'s result when this field IS
   * defined (as well as `prdSyncEnabled === true`).
   */
  readonly prdSyncSynced?: boolean;
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
   * ALL results (passes and failures) in a fixed order. PURE — see module invariant.
   */
  readonly check: (ctx: GateContext) => PredicateResult[];
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
 * @param results - The full output of some `CheckpointDef.check(ctx)` call.
 * @returns `true` when at least one result is `{ok: false}`; `false` otherwise
 *   (including the empty-array case — vacuously not blocked).
 * @example
 * isCheckpointBlocked([{ok: true}, {ok: false, reason: "X"}]); // => true
 * isCheckpointBlocked([{ok: true}]);                            // => false
 */
export function isCheckpointBlocked(results: PredicateResult[]): boolean {
  return results.some((r) => !r.ok);
}

/**
 * Narrows `results` to only its failing entries, preserving order — the `failures`
 * shape a `CheckpointDef.feed` expects.
 *
 * @example
 * selectFailures([{ok: true}, {ok: false, reason: "X"}]); // => [{ok: false, reason: "X"}]
 */
export function selectFailures(
  results: PredicateResult[],
): Array<{ ok: false; reason: string; field?: string }> {
  return results.filter((r): r is { ok: false; reason: string; field?: string } => !r.ok);
}

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
    results.push(noAnchorOverlap(ctx.candidateBy, ctx.candidateAnchors, ctx.siblingClaims));
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
 * `noAnchorOverlap`), the overlapping path pairs, AND a literal copy-pasteable
 * recovery command. Pointers only — never the sibling task's body content.
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
  const candidateAnchors = ctx.candidateAnchors ?? [];
  let conflictLine = "(no specific conflicting sibling could be identified)";
  for (const sibling of ctx.siblingClaims ?? []) {
    if (sibling.stale) continue;
    if (sibling.by === ctx.candidateBy) continue;
    if (sibling.anchors.length === 0) continue;
    const overlap = anchorsOverlap(candidateAnchors, sibling.anchors);
    if (overlap.overlaps) {
      const pathsStr = overlap.pairs.map(([a, b]) => `${a} × ${b}`).join(", ");
      conflictLine =
        `Conflicting task: ${sibling.slug} — "${sibling.title}" — held by ${sibling.by}. ` +
        `Overlapping paths: ${pathsStr}. ` +
        `Recovery: \`lore release ${sibling.slug} --by ${sibling.by} --force\``;
      break;
    }
  }
  const pack = buildFeedingPack({
    ruleSource: "corpus (sibling task claims)",
    ruleMarkdown:
      `Required for ${checkpointLabel}: declared file_anchors must not overlap a FRESH claim held ` +
      `by a different actor on another task in the same plan. ${conflictLine}`,
    missing: selectFailures(failures).map((f) => f.reason),
  });
  return renderFeedingPack(pack);
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
 * `plan-close`'s default attestation-floor ratio (SPEC-069) — MUST match
 * `WorkflowConfigSchema`'s `workflow.attestation.min_ratio` Zod default (`@lore/core`,
 * config.ts) exactly. Production callers always resolve `ctx.attestationMinRatio` via
 * `GateEnforcer.resolveAttestationMinRatio` (which reads that same schema default when
 * unconfigured), so this constant is only ever exercised by a hand-built `GateContext`
 * (a direct `attestationFloor`/`checkPlanClose` unit test) that omits the field.
 */
const DEFAULT_ATTESTATION_MIN_RATIO = 0.5;

/**
 * `plan-close`'s three predicates (SPEC-054 + SPEC-069 §Design Decisions D1 + SPEC-080 §C4):
 *
 *   - `uatP0Accepted` — OPT-IN (SPEC-054): only runs when the plan declared
 *     `ctx.requiresUat === true`; `ctx.requiresUat !== true` skips it entirely
 *     (same "opt-out ⇒ no gate" shape `checkPlanPromote` uses for
 *     `hasSpecParent`, third module invariant).
 *   - `attestationFloor` — OPT-OUT (SPEC-069 D1): runs for EVERY closing plan
 *     UNLESS `ctx.attestationExempt === true` (a plan explicitly declaring
 *     `extra.attestation_exempt: true` + a non-empty reason). Deliberately NOT
 *     gated by `ctx.requiresUat` — a plan that never opted into UAT still owes
 *     an honest attestation floor over whatever evidence it DOES carry.
 *   - `prdOutlineSynced` — OPT-IN, default-OFF (SPEC-080 §C4): only runs when
 *     `ctx.prdSyncEnabled === true` AND `ctx.prdSyncSynced !== undefined` (the
 *     latter is the caller's own "a spec-tier ancestor resolved, so this
 *     predicate is even applicable" signal — a plan hanging off a `prd`
 *     directly, or unparented, never has this field set, mirroring
 *     `plan-promote`'s `hasSpecParent` vacuous-pass shape).
 *
 * All three predicates, when they run, are pushed into the SAME results array
 * (this module's "run every predicate, don't short-circuit on the first
 * failure" contract) — a plan can fail ANY subset of them independently.
 */
function checkPlanClose(ctx: GateContext): PredicateResult[] {
  const results: PredicateResult[] = [];
  if (ctx.requiresUat === true) {
    results.push(uatP0Accepted(ctx.uatVerdictPresent === true, ctx.uatP0Accepted === true));
  }
  if (ctx.attestationExempt !== true) {
    results.push(
      attestationFloor(ctx.planTasksAttestation, ctx.attestationMinRatio ?? DEFAULT_ATTESTATION_MIN_RATIO),
    );
  }
  if (ctx.prdSyncEnabled === true && ctx.prdSyncSynced !== undefined) {
    results.push(prdOutlineSynced(ctx.prdSyncSynced));
  }
  return results;
}

/**
 * Renders the attestation-floor-specific feeding pack (SPEC-069 §Design Decisions
 * D1; recovery text rewritten by task-attestation-floor-feeding-pack-names-tasks-
 * but-the, 2026-07-26) — names every offending task (carries `verification_evidence`
 * but ZERO runner-attested entries), the plan-wide attested ratio against the
 * configured floor, and the literal recovery command (`lore verify <plan>` — the
 * exact substring AC-069-1 pins). Pointers only (task slug/title, never body
 * content), mirroring `feedAnchorOverlap`'s "recompute offending items from ctx"
 * shape.
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
 */
function feedAttestationFloor(ctx: GateContext, failures: PredicateResult[]): string {
  const tasks = ctx.planTasksAttestation ?? [];
  const offending = tasks.filter((t) => t.evidenceCount > 0 && t.attestedCount === 0);
  const totalEvidence = tasks.reduce((sum, t) => sum + t.evidenceCount, 0);
  const totalAttested = tasks.reduce((sum, t) => sum + t.attestedCount, 0);
  const ratio = totalEvidence > 0 ? totalAttested / totalEvidence : 0;
  const minRatio = ctx.attestationMinRatio ?? DEFAULT_ATTESTATION_MIN_RATIO;
  const plan = ctx.targetIdOrSlug ?? "<plan>";
  const offendingLine =
    offending.length > 0
      ? `Task(s) with self-reported-only evidence (zero runner-attested entries): ` +
        `${offending.map((t) => `${t.slug} — "${t.title}"`).join(", ")}. Listed for ` +
        `DIAGNOSTIC purposes only — the exemption below is PLAN-level; do NOT write ` +
        `\`extra.attestation_exempt\` onto any of these tasks, this gate never reads it there. `
      : "";
  const pack = buildFeedingPack({
    ruleSource: "corpus (task verification_evidence)",
    ruleMarkdown:
      `Required for plan-close: every task carrying verification_evidence must carry ` +
      `at least one runner-issued (attested) entry, and the plan-wide attested-evidence ` +
      `ratio must be >= ${minRatio} (currently ${ratio.toFixed(2)}). ${offendingLine}` +
      `Recovery: run \`lore verify ${plan}\` to record attested evidence against each ` +
      `task's declared script-mode acceptance criteria (declare one first via ` +
      `\`lore ac add <spec> <id> --mode script ...\` if none exists yet). If this plan ` +
      `genuinely has no oracle to attest against for some of its tasks — the canonical ` +
      `case is a RED/TDD task whose Expected state is a currently-failing, time-bound ` +
      `test (red before green: the evidence is real, attesting it would misrepresent an ` +
      `intentionally-red state as verified) — the exemption is declared on the PLAN ` +
      `ITSELF, never on a task: set \`extra.attestation_exempt: true\` plus a non-empty ` +
      `\`extra.attestation_exempt_reason\` on ${plan}. \`extra\` REPLACES the whole field ` +
      `wholesale on \`lore_set\` (it does NOT merge) — first fetch the current extra via ` +
      `\`lore get ${plan} --json\` (read \`.extra\`), merge ` +
      `\`{"attestation_exempt": true, "attestation_exempt_reason": "<why>"}\` into it ` +
      `while KEEPING every existing key (e.g. \`phases\`), then call the MCP \`lore_set\` ` +
      `tool with the FULL merged object as \`extra\` on ${plan}. \`lore set\` (CLI) has no ` +
      `dedicated flag for this field yet.`,
    missing: selectFailures(failures).map((f) => f.reason),
    // reason: the plan-level-only fetch-merge-set instruction plus the offending-
    // task diagnostic list routinely exceeds `DEFAULT_FEEDING_MAX_CHARS` (800) —
    // this is synthesized guidance text, not a slice of an arbitrary-length doc
    // (the thing the default budget protects against), so a wider explicit budget
    // is safe here. 2200 covers the fixed instructional text (~1050 chars) plus
    // several offending tasks' `slug — "title"` pairs before truncating.
    maxChars: 2200,
  });
  return renderFeedingPack(pack);
}

/**
 * Renders the `prdOutlineSynced`-specific feeding pack (SPEC-080 §C4) — names
 * all three repair verbs the spec's own text calls for (`lore outline set`,
 * `lore set <domain-doc>`, `lore outline exempt`), degrading to a link-first
 * message when the caller never resolved a domain doc at all
 * (`ctx.prdSyncDomainDocSlug` absent — no ancestor-spec `parent`/`implements`
 * edge to a domain doc exists yet). Pointers only (domain doc slug, never its
 * content), mirroring `feedAttestationFloor`'s "recompute the recovery text
 * from ctx" shape.
 */
function feedPrdOutlineSynced(ctx: GateContext, failures: PredicateResult[]): string {
  const plan = ctx.targetIdOrSlug ?? "<plan>";
  const domainDoc = ctx.prdSyncDomainDocSlug;
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
      `window (SPEC-080 C4). ${recovery}`,
    missing: selectFailures(failures).map((f) => f.reason),
  });
  return renderFeedingPack(pack);
}

/**
 * `plan-close`'s feeding message — dispatches between THREE independent failure
 * families (SPEC-054's `uatP0Accepted`, SPEC-069's `attestationFloor`, SPEC-080's
 * `prdOutlineSynced`, all on `checkPlanClose`, see that function's own JSDoc):
 *
 *   - ONLY `prdOutlineSynced` failed → {@link feedPrdOutlineSynced} alone.
 *   - ONLY `attestationFloor` failed (with or without `prdOutlineSynced` also
 *     failing) → {@link feedAttestationFloor}, with one extra sentence
 *     appended when `prdOutlineSynced` ALSO failed — REGRESSION: byte-identical
 *     to pre-SPEC-080 when `prdOutlineSynced` didn't fail (every pre-existing
 *     `attestation-floor.test.ts` scenario never sets `prdSyncEnabled`, so
 *     `prdSyncFailed` is always `false` there).
 *   - `uatP0Accepted` failed (with or without the other two also failing) →
 *     the pre-existing `lore uat record`-naming message, UNCHANGED wording
 *     when both the other predicates passed (REGRESSION: byte-identical to
 *     pre-SPEC-069/-080 — `uat-service.test.ts`'s `.toContain("lore uat
 *     record")` assertions and `requires-uat-gate.test.ts`'s STATE scenario
 *     both pin this), with one extra sentence per OTHER failing predicate.
 */
function feedPlanClose(ctx: GateContext, failures: PredicateResult[]): string {
  const uatFailed = failures.some((f) => !f.ok && f.field === PLAN_CLOSE_FIELD);
  const attestationFailed = failures.some((f) => !f.ok && f.field === ATTESTATION_FLOOR_FIELD);
  const prdSyncFailed = failures.some((f) => !f.ok && f.field === PRD_SYNC_FIELD);

  if (prdSyncFailed && !uatFailed && !attestationFailed) {
    return feedPrdOutlineSynced(ctx, failures);
  }

  if (attestationFailed && !uatFailed) {
    const attestationText = feedAttestationFloor(ctx, failures);
    if (!prdSyncFailed) {
      return attestationText;
    }
    return (
      `${attestationText}\n\nAdditionally, the domain-doc sync predicate is unmet — see ` +
      `\`lore outline exempt ${ctx.targetIdOrSlug ?? "<plan>"} --reason "..."\` or update the ` +
      `linked domain doc.`
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
      `${ctx.targetIdOrSlug ?? "<plan>"} --json-file <verdict.json>\`.${attestationNote}${prdSyncNote}`,
    missing: selectFailures(failures).map((f) => f.reason),
  });
  return renderFeedingPack(pack);
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
 * Builds the `candidateBy` / `candidateAnchors` / `siblingClaims` trio
 * `task-claim`'s `noAnchorOverlap` predicate consumes (SPEC-042 §Design
 * Decisions D5) — co-located with {@link buildUpstreamSpecContext} per the
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
    });
  }
  return { candidateBy, candidateAnchors, siblingClaims };
}

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
};

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
