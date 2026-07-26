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
 */

import {
  PARENT_TYPE_CONTRACT,
  SPEC_KINDS,
  specAcceptanceCriteriaSchema,
  UPSTREAM_APPROVED_STATUSES,
  anchorsOverlap,
  lintAcQuantifiability,
  checkOracleCoverage,
  deriveAttestationSummary,
  type AcceptanceCriterion,
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
 */
export interface SiblingClaimInfo {
  slug: string;
  title: string;
  by: string;
  at: string;
  stale: boolean;
  anchors: string[];
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
 * Decisions D1) — opt-OUT, not opt-in (unlike `uatP0Accepted`, this predicate
 * runs for every closing plan unless exempted; see `checkPlanClose` in
 * `checkpoint-registry.ts`). Two independent conditions, EITHER of which
 * blocks:
 *
 *   1. every task that carries ANY `verification_evidence` must carry at
 *      least one runner-issued (attested) entry — a task with N self-reported
 *      entries and ZERO attested ones is undetectable fabrication risk, even
 *      if some OTHER task in the plan is fully attested and keeps the
 *      plan-wide ratio above the floor;
 *   2. the plan-wide attested-evidence ratio (total attested entries / total
 *      evidence entries, across every task) must be ≥ `minRatio`.
 *
 * A plan with NO evidence at all on any task (`totalEvidence === 0`) is a
 * vacuous PASS — this is the "pure-planning plan" carve-out (SPEC-069 §Scope):
 * the floor only constrains a plan that claims to have been verified, never
 * one that never ran any oracle at all.
 *
 * SPEC-075 §Design Decisions D6/AC-075-11: this predicate is now a THIN
 * delegate over `@lore/core`'s `deriveAttestationSummary` — the SAME two
 * conditions, now computed once in the SSOT the dashboard adjudication
 * workbench's Evidence tab also renders from, rather than re-implemented here.
 * `attestationFloor`'s own signature, reasons, and pass/fail outcomes are
 * byte-identical to before this delegation (every pre-existing caller,
 * including `attestation-floor.test.ts`'s end-to-end service-layer suite,
 * observes no behavior change).
 *
 * @param tasks - Every task (or phase) in the closing plan, with its own
 *   evidence/attested counts — `undefined` is treated identically to `[]`
 *   (no tasks resolved, vacuous pass, mirrors `noAnchorOverlap`'s `?? []`
 *   shape).
 * @param minRatio - The configured floor (`workflow.attestation.min_ratio`,
 *   resolved by the CALLER via `GateEnforcer.resolveAttestationMinRatio` —
 *   this predicate never reads config itself).
 * @returns `{ok: true}` when there is no evidence at all, OR every
 *   evidence-bearing task has ≥1 attested entry AND the plan-wide ratio meets
 *   `minRatio`; `{ok: false, reason: "ATTESTATION_FLOOR_NOT_MET", field:
 *   "attestation-floor"}` otherwise.
 * @example
 * attestationFloor([
 *   { slug: "task-1", title: "T1", evidenceCount: 3, attestedCount: 0 },
 * ], 0.5); // => { ok: false, reason: "ATTESTATION_FLOOR_NOT_MET", field: "attestation-floor" }
 * @example
 * attestationFloor([
 *   { slug: "task-1", title: "T1", evidenceCount: 2, attestedCount: 2 },
 * ], 0.5); // => { ok: true }
 * @example
 * attestationFloor(undefined, 0.5); // => { ok: true } — no tasks, vacuous pass
 */
export function attestationFloor(
  tasks: readonly TaskAttestationInfo[] | undefined,
  minRatio: number,
): PredicateResult {
  const summary = deriveAttestationSummary(tasks ?? [], minRatio);
  if (!summary.meets_floor) {
    return { ok: false, reason: ATTESTATION_FLOOR_REASON, field: ATTESTATION_FLOOR_FIELD };
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
 *   window, OR a valid `extra.prd_sync_exempt` is present; `false` otherwise.
 * @returns `{ok: true}` when `synced`; `{ok: false, reason:
 *   "PRD_OUTLINE_NOT_SYNCED", field: "prd-outline-synced"}` otherwise.
 * @example
 * prdOutlineSynced(true);  // => { ok: true }
 * prdOutlineSynced(false); // => { ok: false, reason: "PRD_OUTLINE_NOT_SYNCED", field: "prd-outline-synced" }
 */
export function prdOutlineSynced(synced: boolean): PredicateResult {
  if (synced) {
    return { ok: true };
  }
  return { ok: false, reason: PRD_SYNC_NOT_SYNCED_REASON, field: PRD_SYNC_FIELD };
}
