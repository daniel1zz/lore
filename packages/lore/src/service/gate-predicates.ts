/**
 * Deterministic gate predicates for `lore gate spec-create` — the "deterministic zone"
 * of the corpus-governed spec-production loop (IoC vertical slice tech-spec §4.1/§11).
 *
 * Pure, side-effect-free functions. No store, no IO, no bun:sqlite. Each predicate
 * checks exactly one precondition a candidate `spec` document must satisfy before it
 * may be created, and returns a machine-readable failure `reason` rather than a
 * human-prose message — the caller (the not-yet-implemented `lore gate spec-create`
 * command) maps `reason` to CLI exit codes / messages.
 *
 * @invariant `parentLegal`'s notion of "legal parent type for spec" is sourced
 *   exclusively from `PARENT_TYPE_CONTRACT.spec` (`@lore/core`, doc-type-rules.ts) —
 *   never a locally hardcoded type list. That table is the corpus-wide SSOT also
 *   consumed by `CorpusService._createImpl` and `TreeCheckService`.
 * @invariant `specKindValid`'s notion of "valid spec kind" is sourced exclusively
 *   from `SPEC_KINDS` (`@lore/core`, spec-kind.ts) — never a locally hardcoded
 *   literal union. `undefined` is explicitly PASS (not a failure): `CorpusService.
 *   _createImpl` defaults an absent `spec_kind` to `"feature"` at creation time, so
 *   a gate that rejected `undefined` would block the normal create path.
 * @invariant `upstreamApproved`'s notion of "approved enough" is sourced exclusively
 *   from `UPSTREAM_APPROVED_STATUSES` (`@lore/core`, task-workflow.ts) — the SAME
 *   constant `evaluateReadiness`'s `upstream_unapproved` advisory consumes. Only
 *   `"approved"` clears the check, `"active"` does NOT. Readiness (a read-side
 *   advisory) and this predicate (a write-path gate) are two independent corpus-fact
 *   expressions of the same rule; they used to each hardcode their own identical
 *   single-entry approved-status set, kept in sync only by a comment — now both
 *   import the one definition, so they cannot silently diverge. See the constant's own JSDoc (in
 *   `@lore/core`) for the full justification of why `"active"` was excluded.
 * @invariant `upstreamHasAcceptanceCriteria`'s notion of "declared acceptance
 *   criteria" is sourced exclusively from `specAcceptanceCriteriaSchema`
 *   (`@lore/core`, acceptance.ts) via a schema-based `safeParse` — the exact same
 *   extraction `AcService`'s private `extractCriteria` helper uses to count a
 *   spec's own acceptance criteria for `lore gate spec-promote`'s
 *   `checkSpecPromote` predicate (`ac-service.ts` / `checkpoint-registry.ts`).
 *   Never a hand-rolled `Array.isArray(extra.acceptance_criteria)` duck-type check.
 * @invariant `acQuantifiable`'s notion of "unquantified abstract quality claim" is
 *   sourced exclusively from `lintAcQuantifiability` (`@lore/core`, ac-quality.ts) —
 *   the SAME deterministic, zero-LLM lint `AcService.addCriterion` runs against a
 *   single incoming criterion at `lore ac add` time. This predicate re-lints the
 *   WHOLE declared set as the gate-layer backstop; the two enforcement points never
 *   maintain independent wordlists or measurable-token heuristics.
 * @invariant `attestationExemptKindValid`'s notion of "valid exemption kind" is
 *   sourced exclusively from `attestationExemptKindSchema` (`@lore/core`,
 *   schemas.ts) — never a locally hardcoded literal union, same precedent as
 *   `specKindValid`/`SPEC_KINDS` above.
 */

import {
  PARENT_TYPE_CONTRACT,
  SPEC_KINDS,
  specAcceptanceCriteriaSchema,
  UPSTREAM_APPROVED_STATUSES,
  anchorsOverlap,
  lintAcQuantifiability,
  checkOracleCoverage,
  declaredScopeCoverageVerdict,
  deriveAttestationSummary,
  attestationExemptKindSchema,
  SCOPE_UNDECLARED_REASON,
  type AcCoverageFact,
  type AcceptanceCriterion,
  type DeclaredScopeCoverage,
  type DocType,
  type TaskAttestationInfo,
  type VerificationProfile,
} from "@lore/core";

/**
 * Result of a single gate predicate: either a pass, or a fail carrying a
 * machine-readable reason and an OPTIONAL `field` sub-discriminator (SPEC-042
 * §Design Decisions D5, review U4) — when present, `GateEnforcer.enforce`
 * renders the caller-facing `LoreError.field` as `gate:<checkpoint>:<field>`
 * instead of the base `gate:<checkpoint>`, so a scripted caller can tell TWO
 * different failure classes on the SAME checkpoint apart (e.g. task-claim's
 * anchor-overlap failure vs. its upstream-approval failure) without parsing
 * prose. Absent on every pre-SPEC-042 predicate — additive, not a breaking
 * change to this type's existing consumers.
 */
export type PredicateResult = { ok: true } | { ok: false; reason: string; field?: string };

/**
 * Why a predicate declared itself not-applicable (spec-plan-close-predicates-
 * measure-invariants-an-applicability §Design Decisions D1) — `"referent-absent"`
 * when the corpus fact the predicate would check (a domain doc, an ancestor spec)
 * does not exist at all; `"no-evidence"` when the predicate has zero data points
 * to evaluate (a plan with no verification evidence anywhere);
 * `"scope-undeclared"` (spec-declared-scope-attestation-contract-task-owned-
 * ac-scope §Facts) when an evidence-bearing task declared no `extra.ac_scope`, so
 * the coverage conjunct has no CLAIM to audit — the alternative, a silent
 * `{ok: true}`, would make an undeclared legacy plan indistinguishable from a
 * compliant one. All three are FACTS about the corpus, never encoded as a
 * violation two modules away.
 *
 * The third member's literal comes from `@lore/core`'s
 * {@link SCOPE_UNDECLARED_REASON} (its single definition site, next to the
 * `DeclaredScopeCoverage` fact that produces it) rather than being re-spelled
 * here — a duplicated literal is how these two modules would silently drift.
 */
export type NotApplicableReason =
  | "referent-absent"
  | "no-evidence"
  | typeof SCOPE_UNDECLARED_REASON;

/**
 * A predicate's third verdict, distinct from pass/fail — "my referent is absent,
 * so I do not apply" (spec-plan-close-predicates-measure-invariants-an-
 * applicability §Design Decisions D1). Deliberately carries NO `ok` property:
 * reading `.ok` off an {@link ApplicablePredicateResult} union is a TypeScript
 * compile error until the caller narrows first (via {@link isNotApplicable}) —
 * that omission IS the mechanism forcing every consumer of a possibly-
 * inapplicable predicate to handle this third case explicitly, rather than
 * silently routing it into whichever branch a `!result.ok` check happens to
 * reach. Two alternatives were considered and REJECTED by the governing spec —
 * a third `ok: "not-applicable"` value (truthy, so `if (!result.ok)` would
 * silently treat it as PASS — the exact vacuous-pass defect class this fixes)
 * and renaming `ok` to a three-valued `status` (forces re-examining ~128 sites
 * across 7 modules for 26 predicates that can never be inapplicable) — do not
 * "simplify" this shape back toward either.
 */
export interface PredicateNotApplicable {
  readonly notApplicable: true;
  readonly reason: NotApplicableReason;
  /** The absent corpus fact this predicate would have checked (e.g. an ancestor
   *  spec's slug, a plan's slug) — always non-empty, named for the advisory/audit
   *  channels that surface it (`GateEnforcer.enforce`). */
  readonly referent: string;
}

/**
 * The full verdict space for a predicate that CAN be structurally inapplicable —
 * `PredicateResult`'s existing pass/fail PLUS {@link PredicateNotApplicable}. Only
 * `prdOutlineSynced` and `attestationFloor` (this module) return this union; every
 * other predicate keeps returning bare `PredicateResult`, unchanged, since a
 * `PredicateResult[]` is structurally assignable wherever `ApplicablePredicateResult[]`
 * is expected (function return-type covariance) — the blast radius of this type is
 * proportional to which predicates can actually be inapplicable, not to every
 * consumer of the shared checkpoint machinery.
 */
export type ApplicablePredicateResult = PredicateResult | PredicateNotApplicable;

/**
 * Type guard narrowing an {@link ApplicablePredicateResult} to its not-applicable
 * member — the ONE place `"notApplicable" in result` is spelled out. Every
 * consumer that must tell {@link PredicateNotApplicable} apart from
 * `PredicateResult` (`GateEnforcer.enforce`'s partition, `isCheckpointBlocked`/
 * `selectFailures`'s narrowing in `checkpoint-registry.ts`) imports this rather
 * than re-deriving the check, so the discriminator can never drift between call
 * sites.
 *
 * @example
 * isNotApplicable({ notApplicable: true, reason: "referent-absent", referent: "spec-x" }); // => true
 * @example
 * isNotApplicable({ ok: true }); // => false
 */
export function isNotApplicable(
  result: ApplicablePredicateResult,
): result is PredicateNotApplicable {
  return "notApplicable" in result && result.notApplicable === true;
}

const SPEC_LEGAL_PARENT_TYPES: readonly DocType[] = PARENT_TYPE_CONTRACT.spec;

/**
 * Checks whether `parent` is a legal parent document for a new `spec`.
 *
 * @param parent - The candidate parent's type, or `null`/`undefined` when no parent
 *   was supplied (a `spec` always requires a `parent_id` — see `createDocInputSchema`
 *   `superRefine` in `@lore/core/schemas.ts`).
 * @returns `{ok: true}` when `parent.type` is a member of `PARENT_TYPE_CONTRACT.spec`;
 *   `{ok: false, reason: "PARENT_REQUIRED"}` when `parent` is missing;
 *   `{ok: false, reason: "INVALID_PARENT_TYPE"}` when `parent.type` is not legal.
 * @example
 * parentLegal({ type: "prd" });  // => { ok: true }
 * parentLegal(null);             // => { ok: false, reason: "PARENT_REQUIRED" }
 * parentLegal({ type: "task" }); // => { ok: false, reason: "INVALID_PARENT_TYPE" }
 */
export function parentLegal(parent: { type: string } | null | undefined): PredicateResult {
  if (parent === null || parent === undefined) {
    return { ok: false, reason: "PARENT_REQUIRED" };
  }
  if (!SPEC_LEGAL_PARENT_TYPES.includes(parent.type as DocType)) {
    return { ok: false, reason: "INVALID_PARENT_TYPE" };
  }
  return { ok: true };
}

/**
 * Checks whether `kind` is a valid `extra.spec_kind` value for a new `spec`.
 *
 * @param kind - The candidate `spec_kind`, or `undefined` when the caller omitted it
 *   (the create path defaults an absent kind to `"feature"` — see module invariant).
 * @returns `{ok: true}` when `kind` is `undefined` or a member of `SPEC_KINDS`;
 *   `{ok: false, reason: "INVALID_SPEC_KIND"}` otherwise.
 * @example
 * specKindValid("tech");     // => { ok: true }
 * specKindValid(undefined);  // => { ok: true } — defaults to "feature", must not block
 * specKindValid("bogus");    // => { ok: false, reason: "INVALID_SPEC_KIND" }
 */
export function specKindValid(kind: string | undefined): PredicateResult {
  if (kind === undefined) {
    return { ok: true };
  }
  if (!(SPEC_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, reason: "INVALID_SPEC_KIND" };
  }
  return { ok: true };
}

/** Matches a markdown level-2 heading line (`## ...`) anywhere in the content. */
const SKELETON_HEADING_PATTERN = /^##\s/m;

/**
 * Checks whether `content` contains the minimal document skeleton the gate requires:
 * at least one level-2 markdown heading line (`## `).
 *
 * @param content - The candidate spec body (markdown).
 * @returns `{ok: true}` when a `## ` heading line is present anywhere in `content`;
 *   `{ok: false, reason: "MISSING_SKELETON"}` otherwise (including empty content).
 * @example
 * hasSkeleton("## Overview\nx");  // => { ok: true }
 * hasSkeleton("no heading here"); // => { ok: false, reason: "MISSING_SKELETON" }
 * hasSkeleton("");                // => { ok: false, reason: "MISSING_SKELETON" }
 */
export function hasSkeleton(content: string): PredicateResult {
  if (SKELETON_HEADING_PATTERN.test(content)) {
    return { ok: true };
  }
  return { ok: false, reason: "MISSING_SKELETON" };
}

/**
 * Checks whether `upstream` is a legal, sufficiently-approved upstream document for
 * a gated write (e.g. a plan/task being promoted against its parent spec).
 *
 * @param upstream - The candidate upstream doc's `{type, status, deleted_at}`, or
 *   `null`/`undefined` when no upstream was resolved (e.g. the caller's
 *   parent-lookup found nothing). `deleted_at` is the doc's soft-delete
 *   timestamp (non-`null` iff `CorpusService.delete`/`softDelete` was ever
 *   called on it) — callers that don't track soft-delete state may omit the
 *   field entirely, which this predicate treats as "not deleted" (`undefined`
 *   and `null` are equivalent here, matching `DocRecord.deleted_at`'s own
 *   `string | null` shape).
 * @param expectedType - The `DocType` (as a string) the caller requires `upstream`
 *   to be — e.g. `"spec"` when gating a plan against its parent spec.
 * @returns `{ok: true}` when `upstream.type === expectedType` AND `upstream` is
 *   not soft-deleted AND `upstream.status` is in
 *   {@link UPSTREAM_APPROVED_STATUSES}; `{ok: false, reason: "UPSTREAM_MISSING"}`
 *   when `upstream` is absent; `{ok: false, reason: "UPSTREAM_WRONG_TYPE"}` when
 *   `upstream.type` mismatches; `{ok: false, reason: "UPSTREAM_DELETED"}` when
 *   the type matches but `upstream.deleted_at` is non-`null` — a soft-deleted
 *   upstream spec is a WITHDRAWN upstream, not a vacuous "no spec tier" case
 *   (`softDelete` never touches `status`, so without this check a soft-deleted
 *   `approved` spec would silently keep passing this gate forever); `{ok:
 *   false, reason: "UPSTREAM_NOT_APPROVED"}` when the type matches, the doc is
 *   not deleted, but the status isn't approved-enough (see
 *   `UPSTREAM_APPROVED_STATUSES`'s JSDoc, `@lore/core`, for why `"active"` still
 *   fails this check).
 * @example
 * upstreamApproved({ type: "spec", status: "approved", deleted_at: null }, "spec");
 *   // => { ok: true }
 * upstreamApproved({ type: "spec", status: "draft", deleted_at: null }, "spec");
 *   // => { ok: false, reason: "UPSTREAM_NOT_APPROVED" }
 * upstreamApproved(null, "spec"); // => { ok: false, reason: "UPSTREAM_MISSING" }
 * upstreamApproved({ type: "prd", status: "approved", deleted_at: null }, "spec");
 *   // => { ok: false, reason: "UPSTREAM_WRONG_TYPE" }
 * upstreamApproved(
 *   { type: "spec", status: "approved", deleted_at: "2026-07-09T00:00:00.000Z" },
 *   "spec",
 * ); // => { ok: false, reason: "UPSTREAM_DELETED" } — status still says "approved"!
 */
export function upstreamApproved(
  upstream: { type: string; status: string; deleted_at?: string | null } | null | undefined,
  expectedType: string,
): PredicateResult {
  if (upstream === null || upstream === undefined) {
    return { ok: false, reason: "UPSTREAM_MISSING" };
  }
  if (upstream.type !== expectedType) {
    return { ok: false, reason: "UPSTREAM_WRONG_TYPE" };
  }
  if (upstream.deleted_at !== undefined && upstream.deleted_at !== null) {
    return { ok: false, reason: "UPSTREAM_DELETED" };
  }
  if (!UPSTREAM_APPROVED_STATUSES.has(upstream.status)) {
    return { ok: false, reason: "UPSTREAM_NOT_APPROVED" };
  }
  return { ok: true };
}

/**
 * Checks whether an upstream `spec` doc has at least one structured acceptance
 * criterion declared in `extra.acceptance_criteria` — the same "does this spec
 * have declared AC" fact `lore gate spec-promote` checks about a spec ON ITSELF
 * (`checkSpecPromote` in `checkpoint-registry.ts`), here re-expressed for the
 * "gate a downstream doc against its upstream spec's AC" relationship.
 *
 * @param upstreamSpec - The candidate upstream spec (a full `DocRecord`, or any
 *   object exposing just `{extra: Record<string, unknown>}`), or `null`/`undefined`
 *   when no upstream spec was resolved.
 * @returns `{ok: true}` when `upstreamSpec.extra.acceptance_criteria` parses via
 *   `specAcceptanceCriteriaSchema` to a non-empty array; `{ok: false, reason:
 *   "UPSTREAM_NO_AC"}` when `upstreamSpec` is missing, `extra.acceptance_criteria`
 *   is absent, or it fails schema validation, or it parses to an empty array —
 *   all four are the same "no usable declared AC" fact, matching `AcService`'s
 *   private `extractCriteria` (which returns `[]` for the same absent/invalid
 *   cases, never throws).
 * @example
 * upstreamHasAcceptanceCriteria({
 *   extra: { acceptance_criteria: [{ id: "AC-1", statement: "x", verify: { mode: "human" } }] },
 * }); // => { ok: true }
 * upstreamHasAcceptanceCriteria({ extra: {} }); // => { ok: false, reason: "UPSTREAM_NO_AC" }
 * upstreamHasAcceptanceCriteria(null);          // => { ok: false, reason: "UPSTREAM_NO_AC" }
 */
export function upstreamHasAcceptanceCriteria(
  upstreamSpec: { extra: Record<string, unknown> } | null | undefined,
): PredicateResult {
  if (upstreamSpec === null || upstreamSpec === undefined) {
    return { ok: false, reason: "UPSTREAM_NO_AC" };
  }
  const parsed = specAcceptanceCriteriaSchema.safeParse(upstreamSpec.extra["acceptance_criteria"]);
  const count = parsed.success ? parsed.data.length : 0;
  if (count > 0) {
    return { ok: true };
  }
  return { ok: false, reason: "UPSTREAM_NO_AC" };
}

/**
 * One sibling task's claim snapshot, precomputed by the CALLER (SPEC-042 §Design
 * Decisions D5 seam pinning) — `stale` is derived from the SAME `nowIso` +
 * `claimTtlMinutes` `_claimImpl` uses for the target claim's own conflict check,
 * so this predicate itself never reads a wall clock (module invariant: no store,
 * no IO, no wall-clock reads).
 *
 * `worktree`/`machine` (claim-time-actor-identity-guard-zero-evidence-release-advis,
 * AC-IDENTITY-REJECT) mirror the SAME optional `TaskClaim.worktree`/`.machine`
 * fields (`@lore/core`, SPEC-042 D2) — `undefined` when the sibling's own claim
 * never declared one (legacy claim, or an MCP caller that omitted it). Consumed
 * ONLY by `actorIdentityGuard` below; `noAnchorOverlap` never reads them.
 */
export interface SiblingClaimInfo {
  slug: string;
  title: string;
  by: string;
  at: string;
  stale: boolean;
  anchors: string[];
  worktree?: string;
  machine?: string;
}

/** `noAnchorOverlap`'s single machine-readable failure reason. */
export const ANCHOR_OVERLAP_REASON = "ANCHOR_OVERLAP";

/** The `PredicateResult.field` value `noAnchorOverlap`'s failure carries (SPEC-042 D5, review U4). */
export const ANCHOR_OVERLAP_FIELD = "anchor-overlap";

/**
 * `task-claim`'s worktree-mutex predicate (SPEC-042 §Design Decisions D5): the
 * candidate claim's declared `file_anchors` must not overlap a FRESH sibling
 * claim held by a DIFFERENT actor, within the same plan.
 *
 * Vacuous pass (no ERROR path — `anchorsOverlap`'s precondition-only contract
 * extends to this predicate) when: the candidate declares no anchors, a sibling
 * is stale, a sibling is held by the SAME actor as the candidate, a sibling
 * declares no anchors itself, or no sibling's anchors overlap the candidate's.
 *
 * @param candidateBy - The actor attempting the claim.
 * @param candidateAnchors - The target task's own declared (normalized) anchors.
 * @param siblingClaims - Every OTHER task in the same plan holding a claim
 *   (fresh or stale — staleness is filtered HERE, not by the caller).
 * @returns `{ok: true}` when no fresh, foreign, overlapping sibling exists;
 *   `{ok: false, reason: "ANCHOR_OVERLAP", field: "anchor-overlap"}` otherwise.
 * @example
 * noAnchorOverlap("agent:t2", ["src/a"], [
 *   { slug: "task-1", title: "T1", by: "agent:t1", at: "T0", stale: false, anchors: ["src/a/"] },
 * ]); // => { ok: false, reason: "ANCHOR_OVERLAP", field: "anchor-overlap" }
 * @example
 * noAnchorOverlap("agent:t1", ["src/a"], [
 *   { slug: "task-1", title: "T1", by: "agent:t1", at: "T0", stale: false, anchors: ["src/a"] },
 * ]); // => { ok: true } — same actor, not a conflict
 */
export function noAnchorOverlap(
  candidateBy: string | undefined,
  candidateAnchors: string[] | undefined,
  siblingClaims: readonly SiblingClaimInfo[] | undefined,
): PredicateResult {
  const anchors = candidateAnchors ?? [];
  if (anchors.length === 0) {
    return { ok: true };
  }
  for (const sibling of siblingClaims ?? []) {
    if (sibling.stale) continue;
    if (sibling.by === candidateBy) continue;
    if (sibling.anchors.length === 0) continue;
    if (anchorsOverlap(anchors, sibling.anchors).overlaps) {
      return { ok: false, reason: ANCHOR_OVERLAP_REASON, field: ANCHOR_OVERLAP_FIELD };
    }
  }
  return { ok: true };
}

/** `actorIdentityGuard`'s single machine-readable failure reason. */
export const ACTOR_IDENTITY_COLLISION_REASON = "ACTOR_IDENTITY_COLLISION";

/** The `PredicateResult.field` value `actorIdentityGuard`'s failure carries
 *  (spec claim-time-actor-identity-guard-zero-evidence-release-advis, AC-IDENTITY-REJECT). */
export const ACTOR_IDENTITY_FIELD = "actor-identity";

/**
 * The identity-resolution tier `actorIdentityGuard` treats as an "untraceable
 * default" — the governing spec's own `os_default` vocabulary, spelled here as
 * the literal `ActorSource` value (`@lore/core/node`, `actor-resolution-node.ts`)
 * `resolveActorWithSource` returns when resolution falls through explicit `--by`
 * / `$LORE_ACTOR` / the SPEC-071 session tier all the way to `os.userInfo()
 * .username`. Declared as a plain string literal (not an imported type) so this
 * module keeps its module-header invariant of zero `@lore/core/node` dependency
 * — the Node-only resolution chain lives one layer up, in the CALLER that
 * resolves `candidateIdentitySource` before building a `GateContext`.
 */
export const OS_DEFAULT_IDENTITY_SOURCE = "os-fallback";

/**
 * `task-claim`'s claim-time actor-identity collision guard (spec claim-time-
 * actor-identity-guard-zero-evidence-release-advis, AC-IDENTITY-REJECT) —
 * SPEC-042's `noAnchorOverlap` and its session registry both key on the
 * resolved `by` string alone; when every concurrent agent silently falls
 * through to the SAME OS-username default, distinct sessions collapse onto one
 * identity and `noAnchorOverlap` can never tell them apart (SPEC-042 D10, the
 * documented failure mode this predicate closes). This predicate detects that
 * SPECIFIC collision signature at claim time, conservatively (spec §Scope:
 * "REJECT only on a collision signature"):
 *
 *   1. The CANDIDATE's own actor must have resolved via the untraceable
 *      OS-username fallback tier ({@link OS_DEFAULT_IDENTITY_SOURCE}) — an
 *      explicit `--by`, `$LORE_ACTOR`, or the SPEC-071 session tier NEVER
 *      trips this predicate, regardless of what any sibling holds (AC-
 *      IDENTITY-REJECT's "distinct explicit identities never trip it").
 *   2. AND a FRESH sibling claim in the same plan must hold the byte-IDENTICAL
 *      `by` string. Since the candidate's own `by` in that case IS
 *      `os.userInfo().username`, an identical sibling `by` means the sibling
 *      landed on that same OS username too — the shared literal string IS the
 *      collision signature, so the sibling's own resolution tier never needs
 *      to be independently stored (the governing spec's "OUT: storing
 *      identity source on the doc" scope note — identity source stays
 *      gate-context-only, for the CANDIDATE claim of THIS call only).
 *   3. AND that sibling's `worktree` or `machine` — whichever dimension has
 *      data on BOTH sides — must provably DIFFER from the candidate's own:
 *      two DIFFERENT execution contexts holding the identical untraceable
 *      identity. When neither dimension is comparable (missing on either
 *      side), this predicate does NOT trip — conservative by construction,
 *      mirroring `noAnchorOverlap`'s own "no ERROR path" vacuous-pass shape.
 *
 * A solo human/agent holding multiple tasks from ONE worktree (same `by`, same
 * `worktree`) never trips it — `worktreeDiffers`/`machineDiffers` are both
 * `false` in that case (spec §Scope: "A solo human holding multiple tasks in
 * one worktree never trips it").
 *
 * @param candidateBy - The actor attempting the claim.
 * @param candidateIdentitySource - How `candidateBy` was resolved, compared
 *   against {@link OS_DEFAULT_IDENTITY_SOURCE}; any other value (including
 *   `undefined` — the caller never resolved/threaded one) is an automatic pass.
 * @param candidateWorktree - The candidate claim's own `worktree` (SPEC-042 D2), if declared.
 * @param candidateMachine - The candidate claim's own `machine` (SPEC-042 D2), if declared.
 * @param siblingClaims - Every OTHER task in the same plan holding a claim
 *   (fresh or stale — staleness filtered HERE, mirrors `noAnchorOverlap`).
 * @returns `{ok: true}` when no fresh, `by`-identical, provably-different-context
 *   sibling exists (or the candidate wasn't OS-default-resolved at all);
 *   `{ok: false, reason: "ACTOR_IDENTITY_COLLISION", field: "actor-identity"}` otherwise.
 * @example
 * actorIdentityGuard("daniel", "os-fallback", "/repo/.worktrees/t2", undefined, [
 *   { slug: "task-1", title: "T1", by: "daniel", at: "T0", stale: false, anchors: [],
 *     worktree: "/repo/.worktrees/t1" },
 * ]); // => { ok: false, reason: "ACTOR_IDENTITY_COLLISION", field: "actor-identity" }
 * @example
 * actorIdentityGuard("agent:t2", "explicit", "/repo/.worktrees/t2", undefined, [
 *   { slug: "task-1", title: "T1", by: "daniel", at: "T0", stale: false, anchors: [],
 *     worktree: "/repo/.worktrees/t1" },
 * ]); // => { ok: true } — candidate used an explicit identity, never trips
 */
export function actorIdentityGuard(
  candidateBy: string | undefined,
  candidateIdentitySource: string | undefined,
  candidateWorktree: string | undefined,
  candidateMachine: string | undefined,
  siblingClaims: readonly SiblingClaimInfo[] | undefined,
): PredicateResult {
  if (candidateIdentitySource !== OS_DEFAULT_IDENTITY_SOURCE) {
    return { ok: true };
  }
  for (const sibling of siblingClaims ?? []) {
    if (sibling.stale) continue;
    if (sibling.by !== candidateBy) continue;
    const worktreeDiffers =
      sibling.worktree !== undefined &&
      candidateWorktree !== undefined &&
      sibling.worktree !== candidateWorktree;
    const machineDiffers =
      sibling.machine !== undefined &&
      candidateMachine !== undefined &&
      sibling.machine !== candidateMachine;
    if (worktreeDiffers || machineDiffers) {
      return { ok: false, reason: ACTOR_IDENTITY_COLLISION_REASON, field: ACTOR_IDENTITY_FIELD };
    }
  }
  return { ok: true };
}

/** `acQuantifiable`'s single machine-readable failure reason. */
export const AC_NOT_QUANTIFIABLE_REASON = "AC_NOT_QUANTIFIABLE";

/** The `PredicateResult.field` value `acQuantifiable`'s failure carries. */
export const AC_QUANTIFIABLE_FIELD = "ac-quantifiable";

/**
 * `spec-create`/`spec-promote`'s deterministic AC-quantifiability predicate
 * (AC-Quantifiability Gate spec §Design): a candidate spec's declared acceptance
 * criteria must not contain an unquantified abstract-quality claim, per the
 * zero-LLM `lintAcQuantifiability` lint (`@lore/core`, `ac-quality.ts`).
 *
 * This predicate is the gate half of a two-layer enforcement design — the OTHER
 * layer is `AcService.addCriterion`, which runs the identical lint against a
 * single incoming criterion at `lore ac add` time (immediate feedback, before
 * the spec ever reaches spec-promote). This predicate is the BACKSTOP: it
 * re-lints the WHOLE declared set so an AC added through any other path (a
 * pre-gate legacy doc, a direct store write, an inline `extra.acceptance_criteria`
 * on `lore create spec`) can't slip past spec-create/spec-promote unexamined.
 *
 * Deliberately takes the already-resolved criteria array (never a store lookup,
 * never an AI provider call — module invariant: no store, no IO, no bun:sqlite)
 * so the caller (`checkSpecCreate`/`checkSpecPromote` in `checkpoint-registry.ts`)
 * stays the sole IO-performing layer, consistent with every other predicate in
 * this module.
 *
 * @param criteria - The candidate/target spec's declared acceptance criteria, or
 *   `undefined` when the caller resolved none (a spec with no structured ACs yet
 *   — the common `lore create spec` case, since ACs are usually added afterward
 *   via `lore ac add`). Vacuous pass: `lintAcQuantifiability([])` always yields
 *   zero findings.
 * @returns `{ok: true}` when `lintAcQuantifiability(criteria ?? [])` yields zero
 *   `block` findings; `{ok: false, reason: "AC_NOT_QUANTIFIABLE", field:
 *   "ac-quantifiable"}` when it yields at least one.
 * @example
 * acQuantifiable([
 *   { id: "AC-1", statement: "the dashboard loads fast", verify: { mode: "human" } },
 * ]); // => { ok: false, reason: "AC_NOT_QUANTIFIABLE", field: "ac-quantifiable" }
 * @example
 * acQuantifiable([
 *   { id: "AC-1", statement: "the dashboard P95 load < 200ms", verify: { mode: "human" } },
 * ]); // => { ok: true }
 * @example
 * acQuantifiable(undefined); // => { ok: true } — no declared ACs, vacuous pass
 */
export function acQuantifiable(criteria: AcceptanceCriterion[] | undefined): PredicateResult {
  const findings = lintAcQuantifiability(criteria ?? []);
  const blocked = findings.some((f) => f.severity === "block");
  if (!blocked) {
    return { ok: true };
  }
  return { ok: false, reason: AC_NOT_QUANTIFIABLE_REASON, field: AC_QUANTIFIABLE_FIELD };
}

/** `uatP0Accepted`'s failure reason when no UAT verdict is linked to the plan at all. */
export const UAT_MISSING_REASON = "UAT_MISSING";

/** `uatP0Accepted`'s failure reason when a verdict exists but is not P0-accepted. */
export const UAT_P0_NOT_ACCEPTED_REASON = "UAT_P0_NOT_ACCEPTED";

/** The `PredicateResult.field` value the `plan-close` gate's failures carry (SPEC-054). */
export const PLAN_CLOSE_FIELD = "uat";

/**
 * `plan-close`'s single predicate (SPEC-054): a plan that requires UAT may close only when
 * its latest linked UAT verdict is P0-accepted. Both inputs are pre-computed by the CALLER
 * (`CorpusService.getLatestUatVerdict` + `isP0Accepted`, `@lore/core`) — this predicate
 * never resolves links or reads `extra.uat` itself (module invariant: no store, no IO).
 * The `requires_uat`-opt-in short-circuit lives in `checkPlanClose` (the checkpoint runs
 * ZERO predicates for an opt-out plan), so by the time this runs the plan HAS opted in.
 *
 * @param present - Whether any UAT verdict is linked to the plan (`informs`).
 * @param p0Accepted - `isP0Accepted` of the LATEST linked verdict (ignored when `!present`).
 * @returns `{ok: true}` when a verdict exists and is P0-accepted; `{ok: false, reason:
 *   "UAT_MISSING", field: "uat"}` when none is linked; `{ok: false, reason:
 *   "UAT_P0_NOT_ACCEPTED", field: "uat"}` when the latest verdict is not P0-accepted.
 * @example
 * uatP0Accepted(true, true);   // => { ok: true }
 * uatP0Accepted(false, false); // => { ok: false, reason: "UAT_MISSING", field: "uat" }
 * uatP0Accepted(true, false);  // => { ok: false, reason: "UAT_P0_NOT_ACCEPTED", field: "uat" }
 */
export function uatP0Accepted(present: boolean, p0Accepted: boolean): PredicateResult {
  if (!present) {
    return { ok: false, reason: UAT_MISSING_REASON, field: PLAN_CLOSE_FIELD };
  }
  if (!p0Accepted) {
    return { ok: false, reason: UAT_P0_NOT_ACCEPTED_REASON, field: PLAN_CLOSE_FIELD };
  }
  return { ok: true };
}

/** `oracleCoverage`'s single machine-readable failure reason. */
export const ORACLE_COVERAGE_REASON = "ORACLE_COVERAGE_INSUFFICIENT";

/** The `PredicateResult.field` value `oracleCoverage`'s failure carries (SPEC-058). */
export const ORACLE_COVERAGE_FIELD = "oracle-coverage";

/**
 * `spec-promote`'s per-spec_kind oracle-coverage floor predicate (SPEC-058
 * §Design Decisions D2/D3): a candidate spec's declared acceptance criteria must
 * satisfy every oracle kind its `spec_kind`'s CONFIGURED verification profile
 * requires — per the SAME `checkOracleCoverage` pure fn (`@lore/core`,
 * `verification-profile.ts`) both `lore gate spec-promote` and this predicate
 * consult, never a locally re-derived coverage rule.
 *
 * Deliberately takes the already-resolved profile (never a config read itself —
 * module invariant: no store, no IO, no config access) so the caller
 * (`checkSpecPromote` here, fed by `CorpusService.set` / `ReviewService.
 * enforceApprovalGate` via `GateEnforcer.resolveVerificationProfile`) stays the
 * sole IO-performing layer, consistent with every other predicate in this module.
 *
 * @param criteria - The candidate/target spec's declared acceptance criteria, or
 *   `undefined` when none resolved.
 * @param profile - The target spec's OWN `spec_kind`'s resolved verification
 *   profile, or `null`/`undefined` when unconfigured for that spec_kind
 *   (SPEC-058 §Design Decisions D1) — vacuous pass, distinct from a configured
 *   profile whose floor the declared criteria fail to satisfy.
 * @returns `{ok: true}` when `profile` is absent OR `checkOracleCoverage`
 *   (`@lore/core`) yields zero findings; `{ok: false, reason:
 *   "ORACLE_COVERAGE_INSUFFICIENT", field: "oracle-coverage"}` when at least one
 *   required oracle kind is uncovered.
 * @example
 * oracleCoverage(undefined, null); // => { ok: true } — no profile configured
 * @example
 * oracleCoverage(
 *   [{ id: "AC-1", statement: "x", verify: { mode: "human" } }],
 *   { required_oracles: ["e2e"] },
 * ); // => { ok: false, reason: "ORACLE_COVERAGE_INSUFFICIENT", field: "oracle-coverage" }
 */
export function oracleCoverage(
  criteria: AcceptanceCriterion[] | undefined,
  profile: VerificationProfile | null | undefined,
): PredicateResult {
  if (profile === null || profile === undefined) {
    return { ok: true };
  }
  const findings = checkOracleCoverage(criteria ?? [], profile);
  if (findings.length === 0) {
    return { ok: true };
  }
  return { ok: false, reason: ORACLE_COVERAGE_REASON, field: ORACLE_COVERAGE_FIELD };
}

/**
 * `acCountMeetsFloor`'s single machine-readable failure reason — the SAME literal
 * `checkSpecPromote` used before this predicate existed (`NO_ACCEPTANCE_CRITERIA`),
 * kept unchanged so every pre-existing feed()/message consumer keeps matching on it.
 */
export const NO_ACCEPTANCE_CRITERIA_REASON = "NO_ACCEPTANCE_CRITERIA";

/** The `PredicateResult.field` value `acCountMeetsFloor`'s failure carries. */
export const AC_COUNT_FIELD = "acceptance-criteria-count";

/**
 * Default acceptance-criteria-count floor `spec-promote` enforces when a
 * spec_kind's verification profile is absent entirely, OR present but doesn't
 * declare `min_acs` (task-spec-promote-base-1-ac-rule-is-spec-kind-agnostic-
 * spec-080) — the pre-existing, unconditional "≥1" rule this predicate replaces.
 */
export const DEFAULT_MIN_ACS = 1;

/**
 * `spec-promote`'s base acceptance-criteria-COUNT floor predicate
 * (task-spec-promote-base-1-ac-rule-is-spec-kind-agnostic-spec-080, option (a)) —
 * a candidate/target spec must declare at least `profile.min_acs` structured
 * acceptance criteria, where the floor is resolved PER spec_kind rather than a
 * single hardcoded `1`. Before this predicate existed, `checkSpecPromote` inlined
 * an unconditional `count > 0` check that fired identically for every spec_kind —
 * SPEC-080 C2 promises a `domain-overview` spec (narrative, not an implementation
 * contract) needs no declared ACs at all, which the old unconditional rule could
 * never express.
 *
 * Deliberately takes the already-resolved profile (never a config read itself —
 * module invariant: no store, no IO, no config access), mirroring `oracleCoverage`'s
 * shape — the two predicates share the SAME `ctx.verificationProfile` field
 * (`checkSpecPromote`), resolved once by the caller via `GateEnforcer.
 * resolveVerificationProfile`.
 *
 * @param count - The candidate/target spec's declared acceptance-criteria count
 *   (`ctx.acceptanceCriteriaCount ?? 0` at the call site — an omitted count is
 *   BOUNDARY-equivalent to an explicit `0`, never treated as "unknown, pass").
 * @param profile - The target spec's OWN `spec_kind`'s resolved verification
 *   profile, or `null`/`undefined` when unconfigured — both cases (no profile at
 *   all, OR a profile with no `min_acs` entry) resolve to {@link DEFAULT_MIN_ACS}.
 *   A profile whose `min_acs` is explicitly `0` legally waives the floor entirely
 *   (SPEC-080 C2's domain-overview case) — `0` and "absent" are NOT the same value.
 * @returns `{ok: true}` when `count >= floor`; `{ok: false, reason:
 *   "NO_ACCEPTANCE_CRITERIA", field: "acceptance-criteria-count"}` otherwise.
 * @example
 * acCountMeetsFloor(0, { required_oracles: ["e2e"], min_acs: 0 }); // => { ok: true } — waived floor
 * @example
 * acCountMeetsFloor(0, null); // => { ok: false, reason: "NO_ACCEPTANCE_CRITERIA", field: "acceptance-criteria-count" } — default floor 1
 * @example
 * acCountMeetsFloor(1, { required_oracles: ["e2e"] }); // => { ok: true } — profile present, no min_acs, default floor 1 met
 * @example
 * acCountMeetsFloor(1, { required_oracles: ["e2e"], min_acs: 2 }); // => { ok: false, ... } — one short of the configured floor
 */
export function acCountMeetsFloor(
  count: number,
  profile: VerificationProfile | null | undefined,
): PredicateResult {
  const floor = profile?.min_acs ?? DEFAULT_MIN_ACS;
  if (count >= floor) {
    return { ok: true };
  }
  return { ok: false, reason: NO_ACCEPTANCE_CRITERIA_REASON, field: AC_COUNT_FIELD };
}

/** `requiresUatDeclared`'s single machine-readable failure reason. */
export const REQUIRES_UAT_NOT_DECLARED_REASON = "REQUIRES_UAT_NOT_DECLARED";

/** The `PredicateResult.field` value `requiresUatDeclared`'s failure carries (SPEC-058). */
export const REQUIRES_UAT_FIELD = "requires-uat";

/**
 * `plan-promote`'s `requires_uat`-must-be-declared predicate (SPEC-058 §Design
 * Decisions D4): a plan whose ancestor spec resolves to a `spec_kind` whose
 * CONFIGURED verification profile declares `required_uat: true` must itself
 * declare `extra.requires_uat === true` before it may be promoted. Composes
 * with — but is distinct from — SPEC-054's PRE-EXISTING `plan-close`
 * `uatP0Accepted` predicate: this one gates that the flag is SET at promote
 * time; `uatP0Accepted` gates that an ACTUAL P0-accepted verdict exists at
 * close time, reading the SAME flag `CorpusService.set` resolves independently
 * for each checkpoint.
 *
 * @param profile - The plan's ancestor spec's resolved verification profile, or
 *   `null`/`undefined` when unconfigured for that spec_kind — vacuous pass
 *   (no UAT requirement declared at all, regardless of `planRequiresUat`).
 * @param planRequiresUat - Whether the candidate plan itself declares
 *   `extra.requires_uat === true`. An explicit `false` is treated identically
 *   to absent (BOUNDARY) — only a literal `true` satisfies this predicate.
 * @returns `{ok: true}` when `profile.required_uat` isn't `true`, OR
 *   `planRequiresUat` is `true`; `{ok: false, reason:
 *   "REQUIRES_UAT_NOT_DECLARED", field: "requires-uat"}` when the profile
 *   demands UAT but the plan hasn't declared it.
 * @example
 * requiresUatDeclared({ required_oracles: ["e2e"], required_uat: true }, false);
 *   // => { ok: false, reason: "REQUIRES_UAT_NOT_DECLARED", field: "requires-uat" }
 * @example
 * requiresUatDeclared({ required_oracles: ["e2e"], required_uat: true }, true);
 *   // => { ok: true }
 * @example
 * requiresUatDeclared(null, false); // => { ok: true } — no profile, no requirement
 */
export function requiresUatDeclared(
  profile: VerificationProfile | null | undefined,
  planRequiresUat: boolean,
): PredicateResult {
  if (profile === null || profile === undefined || profile.required_uat !== true) {
    return { ok: true };
  }
  if (planRequiresUat) {
    return { ok: true };
  }
  return { ok: false, reason: REQUIRES_UAT_NOT_DECLARED_REASON, field: REQUIRES_UAT_FIELD };
}

/**
 * One task's (or, since `getPlanBundle` also returns SPEC-056 phase docs, one
 * phase's) evidence-attestation facts, precomputed by the CALLER (SPEC-069
 * §Design Decisions D1, mirrors `SiblingClaimInfo`'s "caller does the IO,
 * predicate stays pure" seam) — `evidenceCount`/`attestedCount` are derived
 * from `extractEvidence(task)` (`@lore/core`, task-workflow.ts), never
 * re-parsed here (module invariant: no store, no IO).
 *
 * MOVED to `@lore/core` (`evidence-panel.ts`, SPEC-075 §Design Decisions D6) —
 * this module now imports the type rather than declaring it, since the
 * dashboard adjudication workbench's `EvidencePanelProjection.plan` branch
 * needs the SAME shape and `@lore/dashboard` cannot import from
 * `packages/lore/src/**` (browser-safety boundary, SPEC-014 AC-MR-B1). Every
 * importer of this type now reads it directly from `@lore/core` (see
 * `checkpoint-registry.ts`) rather than through this file — this comment
 * documents WHERE the type went for anyone still grepping this module for it.
 */

/** `attestationFloor`'s single machine-readable failure reason. */
export const ATTESTATION_FLOOR_REASON = "ATTESTATION_FLOOR_NOT_MET";

/** The `PredicateResult.field` value `attestationFloor`'s failure carries (SPEC-069). */
export const ATTESTATION_FLOOR_FIELD = "attestation-floor";

/**
 * `plan-close`'s execution-time attestation-floor predicate (SPEC-069 §Design
 * Decisions D1, extended by spec-plan-close-predicates-measure-invariants-an-
 * applicability §D3, re-scoped by spec-declared-scope-attestation-contract-task-
 * owned-ac-scope §Facts D4/D5) — opt-OUT, not opt-in (unlike `uatP0Accepted`,
 * this predicate runs for every closing plan unless exempted; see
 * `checkPlanClose` in `checkpoint-registry.ts`). Two blocking conditions plus one
 * REPORTED fact:
 *
 *   1. (REPORTED, no longer blocking — §Facts D5) every task carrying
 *      `verification_evidence` with ZERO attested entries is named in
 *      `deriveAttestationSummary`'s `zero_attested_tasks` and in this
 *      predicate's feeding pack, but does NOT deny the close on its own: a task
 *      may legitimately hold self-reported-only evidence (the canonical case is
 *      a RED/TDD run) while every criterion the plan DECLARED is attested. The
 *      computation is kept — only its blocking power was demoted;
 *   2. every DECLARED-scope acceptance criterion — the union over
 *      evidence-bearing tasks of (`task.extra.ac_scope` ∩ the spec's declared
 *      script-mode criteria), i.e. `declaredScope`, NOT `acCoverage`'s
 *      evidence-derived exercised set — must carry >= 1 runner-attested entry.
 *      This is the DEFAULT conjunct. When NO evidence-bearing task declares a
 *      scope there is no claim to audit, and this predicate reports
 *      `notApplicable` with reason `"scope-undeclared"` (§Facts D4) rather than
 *      passing vacuously — an undeclared legacy plan stays visible AS
 *      undeclared;
 *   3. the plan-wide attested-evidence ratio (total attested entries / total
 *      evidence entries, across every task) must be ≥ `minRatio` — OPT-IN:
 *      only evaluated when `minRatio` is non-`null` (§D4's default-off
 *      migration). AND-ed with condition 2 when configured, never a substitute.
 *
 * Precedence: a measured FAILURE (2 or 3) outranks the `"scope-undeclared"`
 * applicability verdict, which outranks a pass — so an undeclared scope can never
 * suppress a real ratio or declared-coverage violation.
 *
 * A plan with NO evidence at all on any task (`totalEvidence === 0`) is
 * NOT-APPLICABLE (spec-plan-close-predicates-measure-invariants-an-
 * applicability §Design Decisions D1/D3) rather than the silent vacuous PASS
 * this predicate used to return for that case — this is still the "pure-
 * planning plan" carve-out (SPEC-069 §Scope: the floor only constrains a plan
 * that claims to have been verified, never one that never ran any oracle at
 * all), but the FACT "this plan has zero evidence to attest" is now a value
 * `GateEnforcer.enforce` can surface as an advisory + audit row instead of
 * disappearing into an indistinguishable-from-"everything attested" pass.
 *
 * SPEC-075 §Design Decisions D6/AC-075-11: this predicate computes NO condition
 * itself — every fact comes from `@lore/core` (`deriveAttestationSummary` for the
 * ratio + reported facts, `declaredScopeCoverageVerdict` for the coverage
 * conjunct), the same SSOT the dashboard adjudication workbench's Evidence tab
 * renders from. This function's only own logic is the PRECEDENCE above and the
 * mapping onto gate vocabulary (`ATTESTATION_FLOOR_REASON`/`_FIELD`).
 *
 * §Facts D5 changed OUTCOMES, not just shapes: a plan whose only fault is a
 * zero-attested task now CLOSES (condition 1 demoted), and a plan whose
 * evidence-bearing tasks declare no `ac_scope` is NOT-APPLICABLE instead of
 * blocked-or-passed. Every suite that pinned the old outcomes
 * (`attestation-floor.test.ts`, `gate-predicates.test.ts`,
 * `predicate-applicability.test.ts`, the two `feed-attestation-*` suites) is
 * updated in the SAME slice — a stale assertion there would silently re-legalize
 * the evidence-defines-its-own-scope defect.
 *
 * @param tasks - Every task (or phase) in the closing plan, with its own
 *   evidence/attested counts — `undefined` is treated identically to `[]`
 *   (no tasks resolved, vacuous pass, mirrors `noAnchorOverlap`'s `?? []`
 *   shape).
 * @param minRatio - The configured floor (`workflow.attestation.min_ratio`,
 *   resolved by the CALLER via `GateEnforcer.resolveAttestationMinRatio` —
 *   this predicate never reads config itself), or `null` when unconfigured
 *   (condition 3 does not run at all — §D4).
 * @param referent - The closing plan's slug (or id) — carried on the
 *   `PredicateNotApplicable` result when there is zero evidence to attest,
 *   ignored otherwise.
 * @param acCoverage - `computeAcCoverage`'s own output (the plan's governing
 *   spec's declared criteria aggregated over the plan's tasks). Feeds the
 *   REPORTED exercised-coverage facts and the feeding pack's diagnostics — it is
 *   NO LONGER the coverage conjunct's input (§Facts D4 moved that to
 *   `declaredScope`). REQUIRED — no default (Amendment A, spec-plan-close-
 *   predicates-measure-invariants-an-applicability §D3): a `= []` default would
 *   let a caller silently drop the diagnostics that name which criteria this
 *   plan's evidence actually touched. Every caller, production or test, passes
 *   its OWN true fact: `[]` for a fixture that genuinely declares no acceptance
 *   criteria (name that intent with a constant, e.g. `NO_DECLARED_ACS`, never a
 *   bare `[]` sprinkled ad-hoc), or the real `AcCoverageFact[]` otherwise.
 * @param declaredScope - The DECLARED-scope coverage fact
 *   (`deriveDeclaredScopeCoverage`, `@lore/core`), resolved by the CALLER from
 *   the plan's task documents — this module sees no documents (its purity
 *   invariant), and `TaskAttestationInfo` deliberately carries no
 *   `extra.ac_scope`. REQUIRED, and a caller that never resolved it MUST pass
 *   `UNRESOLVED_DECLARED_SCOPE` (which reports UNDECLARED) rather than an
 *   inline `{scope_undeclared: false, …}`: that literal would be a fabricated
 *   compliant declaration, i.e. the vacuous pass §Facts D4 exists to remove.
 * @returns `{notApplicable: true, reason: "no-evidence", referent}` when
 *   `deriveAttestationSummary`'s `total_evidence === 0`; `{ok: false, reason:
 *   "ATTESTATION_FLOOR_NOT_MET", field: "attestation-floor"}` when a declared
 *   AC has zero attested evidence OR the configured ratio is not met;
 *   `{notApplicable: true, reason: "scope-undeclared", referent}` when nothing
 *   blocks but an evidence-bearing task declared no scope; `{ok: true}`
 *   otherwise.
 * @example
 * const declaredAndAttested = { declared_acs: ["AC-1"], unattested_acs: [], scope_undeclared: false, meets_coverage: true };
 * attestationFloor([
 *   { slug: "task-1", title: "T1", evidenceCount: 3, attestedCount: 0 },
 * ], 0.5, "plan-x", [], declaredAndAttested);
 *   // => { ok: false, ... } — via the RATIO (0 < 0.5), no longer via task-1's zero attestations
 * @example
 * attestationFloor([
 *   { slug: "task-1", title: "T1", evidenceCount: 2, attestedCount: 2 },
 * ], 0.5, "plan-x", [], declaredAndAttested); // => { ok: true }
 * @example
 * attestationFloor(undefined, 0.5, "plan-x", [], declaredAndAttested);
 *   // => { notApplicable: true, reason: "no-evidence", referent: "plan-x" } — no evidence anywhere
 * @example
 * attestationFloor(
 *   [{ slug: "task-1", title: "T1", evidenceCount: 1, attestedCount: 1 }],
 *   null,
 *   "plan-x",
 *   [],
 *   UNRESOLVED_DECLARED_SCOPE,
 * ); // => { notApplicable: true, reason: "scope-undeclared", referent: "plan-x" }
 * @example
 * attestationFloor(
 *   [{ slug: "task-1", title: "T1", evidenceCount: 1, attestedCount: 1 }],
 *   null,
 *   "plan-x",
 *   [],
 *   { declared_acs: ["AC-1"], unattested_acs: ["AC-1"], scope_undeclared: false, meets_coverage: false },
 * ); // => { ok: false, ... } — AC-1 was DECLARED but never runner-attested
 */
export function attestationFloor(
  tasks: readonly TaskAttestationInfo[] | undefined,
  minRatio: number | null,
  referent: string,
  acCoverage: readonly AcCoverageFact[],
  declaredScope: DeclaredScopeCoverage,
): ApplicablePredicateResult {
  const summary = deriveAttestationSummary(tasks ?? [], minRatio, acCoverage);
  if (summary.total_evidence === 0) {
    return { notApplicable: true, reason: "no-evidence", referent };
  }
  const coverage = declaredScopeCoverageVerdict(declaredScope, referent);
  // reason: precedence is FAIL > NOT-APPLICABLE > PASS, so BOTH blocking
  // conjuncts are evaluated before the applicability verdict can be returned.
  // Returning `notApplicable` first would let an undeclared scope suppress a
  // genuinely measured ratio violation — a NEW vacuous pass, in a function whose
  // whole purpose is removing one.
  if ("ok" in coverage && !coverage.ok) {
    return { ok: false, reason: ATTESTATION_FLOOR_REASON, field: ATTESTATION_FLOOR_FIELD };
  }
  if (!summary.meets_floor) {
    return { ok: false, reason: ATTESTATION_FLOOR_REASON, field: ATTESTATION_FLOOR_FIELD };
  }
  if (!("ok" in coverage)) return coverage;
  return { ok: true };
}

/**
 * The structural reasons `lore verify` cannot run against a plan
 * (spec-verify-reachability-plan-promote-early-warning §Scope M1; `"unknown"`
 * added by spec-plan-closure-must-be-loud-terminality-divergence-silent
 * §Design Decisions DD-4(b)) — `null` when reachable. A discriminated
 * companion to `ReachabilityResult.reachable` rather than a bare boolean:
 * callers (the `plan-promote` advisory, `plan-close`'s `feedAttestationFloor`
 * branch) render DIFFERENT prose per reason, so collapsing this to `boolean`
 * would force them to re-derive it themselves — the exact "two parallel
 * reachability computations" shape §Design Decisions D2 forbids.
 *
 * `"unknown"` is distinct from `"parent-not-spec"` on purpose (DD-4(b)): the
 * former means "the caller never told me whether this plan has a spec-tier
 * ancestor" (an absent optional field), the latter means "the caller RESOLVED
 * an ancestor and it is genuinely not a spec" (a determined fact). Collapsing
 * both onto `"parent-not-spec"` is exactly the "absence of evidence rendered
 * as evidence of absence" bug DD-4(b) closes — a gate must never assert a
 * corpus fact it was never given.
 */
export type ReachabilityWhy = "parent-not-spec" | "no-script-acs" | "unknown" | null;

/** Return shape of {@link verifyReachability}. */
export interface ReachabilityResult {
  /** `true` iff `lore verify <plan>` can structurally run against this plan. */
  readonly reachable: boolean;
  /** Which precondition is unmet; `null` iff `reachable`. */
  readonly why: ReachabilityWhy;
}

/**
 * Whether `lore verify` (`VerifyRunnerService.verifyPlan`) can structurally run
 * against a plan, given its resolved ancestor-spec facts — the SAME two
 * preconditions `verifyPlan` itself enforces (`verify-runner-service.ts`:
 * `spec === undefined` ⇒ `"plan has no parent spec — nothing to verify"`; zero
 * script-mode criteria ⇒ nothing for the runner to execute), reflected here as
 * a pure, store-free PREDICTION of that outcome rather than a duplicate
 * enforcement path. Two independent callers consume this ONE derivation
 * (spec-verify-reachability-plan-promote-early-warning §Design Decisions D2):
 * `plan-promote`'s early-warning advisory (`checkpoint-registry.ts`'s
 * `planPromoteReachabilityAdvisory`) and `plan-close`'s `feedAttestationFloor`
 * branch — they can never disagree about whether a given plan is reachable.
 *
 * @param planParentType - The plan's resolved ancestor-spec doc type. THREE
 *   distinct inputs, not two (DD-4(b)): `"spec"` when `hasSpecParent` is
 *   `true`; `null` when the caller RESOLVED that there is no spec-tier
 *   ancestor (a determined fact — mirrors `GateContext.hasSpecParent ===
 *   false`); `undefined` when the caller never populated the field at all
 *   (mirrors `GateContext.hasSpecParent` being absent/undefined — "I don't
 *   know", not "I checked and there isn't one"). Any other string (a
 *   caller-RESOLVED, genuinely non-spec type, e.g. `"prd"`) is treated the
 *   same as `null` — there is no partial credit for "close but not a spec".
 * @param parentSpecScriptAcCount - Count of `verify.mode === "script"`
 *   acceptance criteria declared on the resolved ancestor spec (NOT the total
 *   AC count `upstreamHasAcceptanceCriteria` already checks — a spec can
 *   satisfy THAT predicate with only `ai`/`human`-mode criteria and still be
 *   zero-script-AC, i.e. `lore verify`-unreachable). `undefined` (the caller
 *   never resolved a spec, or resolved one with no declared criteria at all)
 *   is treated identically to `0`.
 * @returns `{reachable: true, why: null}` when `planParentType === "spec"` AND
 *   `parentSpecScriptAcCount` is `>= 1`; `{reachable: false, why: "unknown"}`
 *   when `planParentType === undefined` (caller never told us); `{reachable:
 *   false, why: "parent-not-spec"}` when `planParentType` is `null` or any
 *   non-`"spec"` string (caller resolved a genuinely non-spec/absent
 *   ancestor); `{reachable: false, why: "no-script-acs"}` when the parent IS
 *   a spec but declares zero script-mode criteria.
 * @example
 * verifyReachability(undefined, undefined); // => { reachable: false, why: "unknown" } — caller never asked
 * @example
 * verifyReachability(null, undefined);      // => { reachable: false, why: "parent-not-spec" }
 * @example
 * verifyReachability("prd", 3);             // => { reachable: false, why: "parent-not-spec" }
 * @example
 * verifyReachability("spec", 0);            // => { reachable: false, why: "no-script-acs" }
 * @example
 * verifyReachability("spec", undefined);    // => { reachable: false, why: "no-script-acs" } — boundary
 * @example
 * verifyReachability("spec", 2);            // => { reachable: true, why: null }
 */
export function verifyReachability(
  planParentType: string | null | undefined,
  parentSpecScriptAcCount: number | undefined,
): ReachabilityResult {
  // reason: DD-4(b) — `undefined` means "the caller never populated this
  // field", a DISTINCT outcome from `null`/a resolved non-spec string ("the
  // caller resolved a genuinely non-spec ancestor"). Collapsing the two would
  // reintroduce the exact class bug this fix removes: rendering absence of
  // information as a definite negative corpus fact.
  if (planParentType === undefined) {
    return { reachable: false, why: "unknown" };
  }
  if (planParentType !== "spec") {
    return { reachable: false, why: "parent-not-spec" };
  }
  if ((parentSpecScriptAcCount ?? 0) < 1) {
    return { reachable: false, why: "no-script-acs" };
  }
  return { reachable: true, why: null };
}

/** `attestationExemptKindValid`'s single machine-readable failure reason. */
export const ATTESTATION_EXEMPT_KIND_INVALID_REASON = "ATTESTATION_EXEMPT_KIND_INVALID";

/** The `PredicateResult.field` value `attestationExemptKindValid`'s failure carries. */
export const ATTESTATION_EXEMPT_KIND_FIELD = "attestation-exempt-kind";

/**
 * `plan-close`'s exemption-kind-taxonomy predicate (spec-verify-reachability-
 * plan-promote-early-warning §Scope M3 / §Design Decisions D3) — a bare
 * `extra.attestation_exempt: true` with no typed `extra.attestation_exempt_kind`
 * is exactly the silent-fallback shape this repo bans (see the project-level
 * "no silent fallback" discipline); this predicate refuses it rather than
 * letting the exemption quietly satisfy the floor. Vacuous PASS when `exempt`
 * is not `true` at all — this predicate has nothing to say about a plan that
 * never claimed an exemption (mirrors `attestationFloor`'s own opt-out shape
 * one level up, `checkPlanClose` in `checkpoint-registry.ts`).
 *
 * @invariant Validity is sourced exclusively from `attestationExemptKindSchema`
 *   (`@lore/core`, schemas.ts) via `.safeParse` — never a locally hardcoded
 *   literal union, mirroring `specKindValid`'s `SPEC_KINDS` precedent (this
 *   module's own JSDoc header, first invariant).
 * @param exempt - `ctx.attestationExempt === true` from the caller (the SAME
 *   pre-resolved boolean `checkPlanClose` already reads to decide whether to
 *   run `attestationFloor` at all).
 * @param kind - The plan's raw, UNVALIDATED `extra.attestation_exempt_kind`
 *   value, or `undefined` when absent.
 * @returns `{ok: true}` when `exempt` is not `true`, OR `kind` is a valid
 *   `attestationExemptKindSchema` member; `{ok: false, reason:
 *   "ATTESTATION_EXEMPT_KIND_INVALID", field: "attestation-exempt-kind"}`
 *   when `exempt === true` and `kind` is missing or not a valid member.
 * @example
 * attestationExemptKindValid(true, "red-tdd");  // => { ok: true }
 * @example
 * attestationExemptKindValid(true, undefined);  // => { ok: false, reason: "ATTESTATION_EXEMPT_KIND_INVALID", field: "attestation-exempt-kind" }
 * @example
 * attestationExemptKindValid(true, "bogus");    // => { ok: false, reason: "ATTESTATION_EXEMPT_KIND_INVALID", field: "attestation-exempt-kind" }
 * @example
 * attestationExemptKindValid(false, undefined); // => { ok: true } — not exempt, not applicable
 */
export function attestationExemptKindValid(
  exempt: boolean,
  kind: string | undefined,
): PredicateResult {
  if (exempt !== true) {
    return { ok: true };
  }
  if (!attestationExemptKindSchema.safeParse(kind).success) {
    return { ok: false, reason: ATTESTATION_EXEMPT_KIND_INVALID_REASON, field: ATTESTATION_EXEMPT_KIND_FIELD };
  }
  return { ok: true };
}

/** `prdOutlineSynced`'s single machine-readable failure reason. */
export const PRD_SYNC_NOT_SYNCED_REASON = "PRD_OUTLINE_NOT_SYNCED";

/**
 * The `PredicateResult.field` value `prdOutlineSynced`'s failure carries (SPEC-080
 * C4) — deliberately the SHORT suffix (mirrors `ATTESTATION_FLOOR_FIELD`/
 * `PLAN_CLOSE_FIELD`'s shape, not the fully-qualified `gate:plan-close:...` form):
 * `GateEnforcer.enforce` composes the caller-facing `LoreError.field` as
 * `gate:<checkpoint>:<field>`, so this constant's value becomes
 * `"gate:plan-close:prd-outline-synced"` — the EXACT string SPEC-080 T5r's RED
 * suite (`plan-close-prd-sync.test.ts`) pins on `result.error.field` — only once
 * composed by the enforcer, never written out in full here.
 */
export const PRD_SYNC_FIELD = "prd-outline-synced";

/**
 * `plan-close`'s domain-doc sync predicate (SPEC-080 §C4) — default-OFF
 * (`workflow.gates."plan-close".prd_sync.enabled`, resolved by the CALLER via
 * `GateEnforcer.isPrdSyncEnabled`; this predicate itself takes no config, module
 * invariant: no store, no IO, no config access). The CALLER
 * (`CorpusService.set`) does ALL the IO this predicate would otherwise need:
 * resolving the plan's ancestor spec, walking its `parent`/`implements` edge to
 * a domain doc, deriving the plan's execution window (`[earliest task-claim
 * `at` (fallback plan `created_at`), close-write `now`)`, start-inclusive
 * end-exclusive — SPEC-080 C4), reading the domain doc's version history, and
 * checking a valid `extra.prd_sync_exempt` — collapsing all of that into ONE
 * boolean this predicate switches on. `checkPlanClose` (`checkpoint-registry.ts`)
 * only pushes this predicate's result when BOTH `ctx.prdSyncEnabled === true`
 * AND `ctx.prdSyncSynced !== undefined` — the latter is the caller's own
 * "applicable at all" signal (absent for a plan with no spec-tier ancestor,
 * mirroring `plan-promote`'s `hasSpecParent` vacuous-pass shape); a plan WITH a
 * valid exemption is passed in here already pre-resolved to `synced: true` by
 * the caller (an exemption bypasses the content-diff check entirely, it does
 * not become a THIRD outcome this predicate has to know about).
 *
 * @param synced - Pre-computed by the caller: `true` when >= 1 domain-doc
 *   version's content differs from its predecessor within the plan's execution
 *   window, OR a valid `extra.prd_sync_exempt` is present; `false` when neither
 *   holds; `null` (spec-plan-close-predicates-measure-invariants-an-
 *   applicability §Design Decisions D1/D6) when the ancestor spec resolves NO
 *   domain doc at ALL (`resolvePrdSyncDomainDoc` returned `ok(null)`, a FACT
 *   about the corpus graph) — distinct from `false`, which means a domain doc
 *   DOES exist but wasn't edited in-window.
 * @param referent - The ancestor spec's slug (or id) this predicate's domain-doc
 *   resolution is anchored to — carried on the `PredicateNotApplicable` result
 *   when `synced` is `null`, ignored otherwise.
 * @returns `{notApplicable: true, reason: "referent-absent", referent}` when
 *   `synced` is `null`; `{ok: true}` when `synced` is `true`; `{ok: false,
 *   reason: "PRD_OUTLINE_NOT_SYNCED", field: "prd-outline-synced"}` when
 *   `synced` is `false`.
 * @example
 * prdOutlineSynced(true, "spec-x");  // => { ok: true }
 * @example
 * prdOutlineSynced(false, "spec-x"); // => { ok: false, reason: "PRD_OUTLINE_NOT_SYNCED", field: "prd-outline-synced" }
 * @example
 * prdOutlineSynced(null, "spec-x");
 *   // => { notApplicable: true, reason: "referent-absent", referent: "spec-x" }
 */
export function prdOutlineSynced(synced: boolean | null, referent: string): ApplicablePredicateResult {
  if (synced === null) {
    return { notApplicable: true, reason: "referent-absent", referent };
  }
  if (synced) {
    return { ok: true };
  }
  return { ok: false, reason: PRD_SYNC_NOT_SYNCED_REASON, field: PRD_SYNC_FIELD };
}

/** `assessmentFreshness`'s single machine-readable failure reason. */
export const ASSESSMENT_STALE_REASON = "ASSESSMENT_STALE";

/** The `PredicateResult.field` value `assessmentFreshness`'s failure carries (SPEC-106). */
export const ASSESSMENT_FRESHNESS_FIELD = "assessment-freshness";

/**
 * `plan-close`'s assessment-freshness predicate (SPEC-106 §Design Decisions D1/D2/D5) —
 * a plan's stored `lore assess` judgment must not predate task activity that landed
 * AFTER it: an assessment that surfaced defects and triggered hardening work, where
 * that hardening then merges, leaves the corpus's permanent quality record describing
 * an intermediate state (the motivating incident, `knowledge-session-process-review-
 * 2026-07-28-grill-to-shipped` §V1). Opt-OUT, not opt-in (mirrors `attestationFloor`'s
 * shape one level up, `checkPlanClose` in `checkpoint-registry.ts`) — runs for every
 * closing plan unless `ctx.assessmentFreshnessExempt === true` (D4, flag + non-empty
 * reason — a bare flag alone is NOT exempt, same shape `attestation_exempt` uses).
 *
 * D2: staleness is measured against AUDIT rows (`evidence`/`done` actions on the
 * plan's tasks), never a doc's `updated_at` — the latter moves on cosmetic edits
 * (anchor adds, link writes, a bare status change) that carry no new outcome
 * information the assessment would need to re-judge (AC-FRESH-3). Both timestamps
 * are pre-resolved by the CALLER (`CorpusService.getAssessmentFreshness` — module
 * invariant: no store, no IO here) as ISO-8601 strings, compared lexicographically —
 * the SAME convention `getLatestUatVerdict`/`resolvePrdSyncWindowOpen` already use
 * for ISO-8601 ordering in this codebase.
 *
 * @param newestAssessmentAt - The plan's newest linked assessment doc's `created_at`,
 *   or `undefined` when NO assessment is linked at all.
 * @param newestTaskActivityAt - The newest `evidence`/`done` audit-row timestamp
 *   among the plan's tasks, or `undefined` when none of them carry any such row.
 * @returns `{ok: true}` when either input is `undefined` (D5 — a vacuous pass from
 *   missing data is never invented into a denial, AC-FRESH-2) OR
 *   `newestTaskActivityAt <= newestAssessmentAt`; `{ok: false, reason:
 *   "ASSESSMENT_STALE", field: "assessment-freshness"}` when task activity landed
 *   strictly AFTER the newest assessment.
 * @example
 * assessmentFreshness(undefined, "2026-07-28T12:00:00.000Z"); // => { ok: true } — no assessment yet
 * @example
 * assessmentFreshness("2026-07-28T11:52:00.000Z", undefined); // => { ok: true } — no task activity
 * @example
 * assessmentFreshness("2026-07-28T11:52:00.000Z", "2026-07-28T12:23:00.000Z");
 *   // => { ok: false, reason: "ASSESSMENT_STALE", field: "assessment-freshness" }
 * @example
 * assessmentFreshness("2026-07-28T12:23:00.000Z", "2026-07-28T11:52:00.000Z"); // => { ok: true }
 */
export function assessmentFreshness(
  newestAssessmentAt: string | undefined,
  newestTaskActivityAt: string | undefined,
): PredicateResult {
  if (newestAssessmentAt === undefined || newestTaskActivityAt === undefined) {
    return { ok: true };
  }
  if (newestTaskActivityAt > newestAssessmentAt) {
    return { ok: false, reason: ASSESSMENT_STALE_REASON, field: ASSESSMENT_FRESHNESS_FIELD };
  }
  return { ok: true };
}
