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
  type AcceptanceCriterion,
  type DocType,
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
