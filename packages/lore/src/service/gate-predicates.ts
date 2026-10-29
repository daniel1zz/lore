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
 * @invariant `parentLegal` admits a spec only WITHOUT a parent (BR-1/BR-2); its refusal
 *   text is `parentlessRefusalMessage` (`@lore/core`, doc-type-rules.ts) — the same SSOT
 *   `CorpusService` create and link use, never a locally written message.
 * @invariant `specKindValid`'s notion of "valid spec kind" is sourced exclusively
 *   from `SPEC_KINDS` (`@lore/core`, spec-kind.ts) — never a locally hardcoded
 *   literal union. `undefined` is explicitly PASS (not a failure): `CorpusService.
 *   _createImpl` defaults an absent `spec_kind` to `"feature"` at creation time, so
 *   a gate that rejected `undefined` would block the normal create path.
 * @invariant `upstreamApproved`'s notion of "approved enough" is sourced exclusively
 *   from `UPSTREAM_APPROVED_STATUSES` (`@lore/core`, task-workflow.ts) — the SAME
 *   constant `evaluateReadiness`'s `upstream_unapproved` advisory consumes. Both
 *   `"approved"` and `"active"` clear the check (a settled spec is a locked record;
 *   spec-an-active-spec-counts-as-approved-for-claiming-its-tasks). Readiness (a
 *   read-side advisory) and this predicate (a write-path gate) are two independent
 *   corpus-fact expressions of the same rule; they used to each hardcode their own
 *   identical approved-status set, kept in sync only by a comment — now both import
 *   the one definition, so they cannot silently diverge. See the constant's own JSDoc
 *   (in `@lore/core`) for why `"active"` counts.
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
 * @invariant `noAnchorOverlap`'s notion of "same writer" is the attested RUN (BR-1056), never the `by` string
 *   and never a captured session id: two runs can derive one display name, and a claim with no run belongs to no
 *   writer. `findAnchorOverlapConflict` is the SOLE scan implementing the skip rules — `checkpoint-registry.ts`'s
 *   feeding-pack renderer consumes it rather than re-deriving the offending sibling, so the verdict and the message
 *   can never disagree about who conflicts or why.
 */

import type { MilestoneReviewCurrency } from "./milestone-review.js";
import {
  parentlessRefusalMessage,
  SPEC_KINDS,
  specAcceptanceCriteriaSchema,
  UPSTREAM_APPROVED_STATUSES,
  anchorsOverlap,
  fileAnchorPath,
  lintAcQuantifiability,
  checkOracleCoverage,
  extractTestFileTokens,
  classifyStampAxis,
  classifyEvidenceRadii,
  classifyEvidenceStamps,
  extractEvidence,
  readStampVerdict,
  stampCurrencyOf,
  type StampClass,
  type StampCurrency,
  type StampVerdict,
  type DocRecord,
  type RadiusMeasurement,
  type StampAxisClass,
  type StampAxisInput,
  type StampBindingContext,
  type UnboundReason,
  type LoreError,
  type Result,
  SCOPE_UNDECLARED_REASON,
  type AcceptanceCriterion,
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
export type PredicateResult = { ok: true } | { ok: false; reason: string; field?: string; rule?: `BR-${number}` };

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
 * `attestationFloor` (this module) returns this union; every
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

/**
 * Checks that a new `spec` carries NO parent (BR-1/BR-2: a spec relates to the product
 * trees only through its criteria's citations, never through a parent document).
 *
 * @param parent - the candidate parent's type, or `null`/`undefined` when none was supplied
 * @returns `{ok: true}` when there is no parent; `{ok: false, reason, field: "parent"}` when
 *   any parent is supplied — the reason names criterion citations (`lore ac cite`)
 * @example
 * parentLegal(null);            // => { ok: true }
 * parentLegal({ type: "prd" }); // => { ok: false, reason: "a spec takes no parent: ...", field: "parent" }
 */
export function parentLegal(parent: { type: string } | null | undefined): PredicateResult {
  if (parent === null || parent === undefined) {
    return { ok: true };
  }
  return { ok: false, reason: parentlessRefusalMessage("spec"), field: "parent" };
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
 *   not deleted, but the status isn't approved-enough (`draft`, `in-review`,
 *   `archived`, `deprecated`; `"active"` passes — see `UPSTREAM_APPROVED_STATUSES`'s
 *   JSDoc, `@lore/core`).
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

/** {@link acScopeRequiredAtCreate}'s single machine-readable failure reason. */
export const AC_SCOPE_REQUIRED_REASON = "AC_SCOPE_REQUIRED";

/** The `PredicateResult.field` value {@link acScopeRequiredAtCreate}'s failure carries. */
export const AC_SCOPE_REQUIRED_FIELD = "ac-scope-required";

/**
 * `task-create`'s ONE predicate (spec-declaring-ac-scope-is-required-at-task-
 * creation-so-the §Design Decisions D1/D2/D3) — a task whose parent plan
 * resolves a spec-tier ancestor declaring >= 1 SCRIPT-MODE acceptance
 * criterion must declare `extra.ac_scope` (any array, INCLUDING an empty one
 * — D2's "a decision, never a non-empty claim") before it may be created.
 * Closes a reachability hole: `VerifyRunnerService.verifyPlan`/
 * `verifyAdhocTask` refuse a task whose `ac_scope` is absent, but nothing at
 * AUTHORING time previously required the declaration — a task could be
 * created, worked, and only discover at `lore verify` time that its evidence
 * can never be runner-attested.
 *
 * Vacuous PASS in two structurally distinct cases, mirroring
 * `verifyReachability`'s identical two-tier vacuity one section down in this
 * file:
 *   1. No spec-tier ancestor at all (`hasSpecParent !== true`) — covers an
 *      unparented/`prd`-parented plan AND, per D3, an `--adhoc` task's
 *      structurally-absent parent plan (its resolved parent is the corpus
 *      root PRD, not a plan, so the caller never resolves a spec ancestor at
 *      all). This is NOT-APPLICABLE, never EXEMPT: an `--adhoc` task that
 *      wants `lore verify`-attested evidence still needs `ac_scope`, because
 *      `verifyAdhocTask` resolves its governing spec THROUGH that field — the
 *      predicate simply never fires for it, it does not waive a requirement
 *      that would otherwise apply.
 *
 *      ⛔ The ad-hoc branch is NOT unconstrained, and reading only the sentence
 *      above is how a reader concluded that it was (task-the-ac-scope-re-keying-
 *      left-the-red-first-floor-unarmed, face 4). TWO sibling mechanisms bind it,
 *      neither of them this predicate: (a) `isAdhocAcScopeDeclarationMissing`
 *      (`adapters/cli/create-task-validation.ts`) refuses an `--adhoc` creation
 *      that passed no `--ac-scope` AT ALL, one layer earlier and keyed on the
 *      AUTHOR'S FLAG — which is the only signal that distinguishes the ad-hoc
 *      branch and which this predicate, fed a resolved PLAN LINEAGE, never sees;
 *      and (b) the task's stored done contract: `lore done` judges every task by
 *      the contract compiled at approve, so a code task still owes a red evidence
 *      row unless `lore approve --red-waiver` waived it. This predicate's D3 vacuous pass is
 *      unchanged by either: it is the CLI layer and the archival floor that hold
 *      that branch, deliberately, and this paragraph exists so the next reader
 *      finds them without having to measure the gap first.
 *   2. A spec ancestor declaring ONLY `ai`/`human`-mode criteria, or none at
 *      all (`parentSpecScriptAcCount < 1`) — nothing runner-attestable exists
 *      to declare a scope against, so demanding one would be friction with no
 *      attestation payoff (D1).
 *
 * @param hasSpecParent - Same `GateContext` field `task-claim`/`plan-promote`
 *   populate — `true` iff the task's parent plan resolves a spec-tier
 *   ancestor. `undefined`/`false` both vacuous-pass here (no ancestor to gate
 *   against).
 * @param parentSpecScriptAcCount - Count of `verify.mode === "script"`
 *   criteria declared on that ancestor spec (`countScriptModeAcceptanceCriteria`,
 *   `checkpoint-registry.ts`) — `undefined` treated identically to `0`.
 * @param acScopeDeclared - Whether the CANDIDATE task's own `extra.ac_scope`
 *   key is present at all (any array, empty or not) — `true` satisfies D2
 *   regardless of the array's length; `false`/`undefined` means the key is
 *   absent (no decision has been made yet).
 * @returns `{ok: true}` when either vacuous condition holds OR the key is
 *   present; `{ok: false, reason: AC_SCOPE_REQUIRED_REASON, field:
 *   AC_SCOPE_REQUIRED_FIELD}` otherwise.
 * @example
 * acScopeRequiredAtCreate(false, undefined, undefined);
 *   // => { ok: true } — D3 vacuous, no spec-tier ancestor (incl. --adhoc)
 * @example
 * acScopeRequiredAtCreate(true, 0, undefined);
 *   // => { ok: true } — D1 vacuous, ai/human-only or zero declared criteria
 * @example
 * acScopeRequiredAtCreate(true, 2, true);
 *   // => { ok: true } — declared (D2 — empty or non-empty both satisfy)
 * @example
 * acScopeRequiredAtCreate(true, 2, false);
 *   // => { ok: false, reason: "AC_SCOPE_REQUIRED", field: "ac-scope-required" }
 */
export function acScopeRequiredAtCreate(
  hasSpecParent: boolean | undefined,
  parentSpecScriptAcCount: number | undefined,
  acScopeDeclared: boolean | undefined,
): PredicateResult {
  if (hasSpecParent !== true) {
    return { ok: true };
  }
  if ((parentSpecScriptAcCount ?? 0) < 1) {
    return { ok: true };
  }
  if (acScopeDeclared === true) {
    return { ok: true };
  }
  return { ok: false, reason: AC_SCOPE_REQUIRED_REASON, field: AC_SCOPE_REQUIRED_FIELD };
}

// ─── ac-cite (citation gate, spec-baseline-slice-2 §C4, AC-BLS2-2) ───────────────────────────

/** The `PredicateResult.reason` the citation gate fails with — also the `LoreError` code it surfaces as. */
export const AC_CITE_REQUIRED_REASON = "AC_CITE_REQUIRED";

/** The `PredicateResult.field` the citation gate fails with. */
export const AC_CITE_FIELD = "ac-cite";

/** One added or revised criterion offered to the citation gate: its id and the rule ids it cites. */
export interface AcCiteCandidate {
  ac_id: string;
  /** The cites the criterion carries AFTER the write. */
  cites: readonly string[];
  /**
   * The cites it carried BEFORE the write (`undefined` / `[]` for a new criterion). A cite in both lists is
   * an existing cite the write did not add, so a retired one there is not the write's fault (BR-87).
   */
  prior_cites?: readonly string[] | undefined;
}

/** Lifecycle of every rule a leaf lists, keyed by rule id; an id absent from the map is dangling. */
export type AcCiteRuleStates = Readonly<Record<string, "live" | "deprecated" | "retired">>;

/**
 * Every way the candidates fail the citation rule. The gate judges what a write DOES, not what the criterion
 * already carried (BR-87, DC2-13): a cite the write adds must be live (`missing` when no leaf lists it, else its
 * lifecycle), and the criterion must hold at least one live cite after the write. A criterion left with no live
 * cite is refused whole: `uncited` when it cites nothing, otherwise every non-live cite it still carries is named.
 * An existing retired cite next to a live one is tolerated, so `lore ac cite` can repair a criterion by adding a
 * live cite and then removing the retired one.
 *
 * @param candidates - the added/revised criteria (never untouched legacy ones), each with its `prior_cites`
 * @param ruleStates - lifecycle per rule id, from the baseline leaves (an own-proposed id is `live` here)
 * @returns violations in candidate order, then cite order; `[]` when every candidate is admitted
 * @example
 * findAcCiteViolations([{ ac_id: "AC-1", cites: [] }], {}); // [{ ac_id: "AC-1", reason: "uncited" }]
 * findAcCiteViolations([{ ac_id: "AC-1", cites: ["BR-1", "BR-2"], prior_cites: ["BR-2"] }], { "BR-1": "live", "BR-2": "retired" }); // []
 */
export function findAcCiteViolations(
  candidates: readonly AcCiteCandidate[],
  ruleStates: AcCiteRuleStates,
): Array<{ ac_id: string; rule_id?: string; reason: "uncited" | "missing" | "deprecated" | "retired" }> {
  const out: Array<{ ac_id: string; rule_id?: string; reason: "uncited" | "missing" | "deprecated" | "retired" }> = [];
  const stateOf = (ruleId: string): "live" | "deprecated" | "retired" | undefined =>
    Object.prototype.hasOwnProperty.call(ruleStates, ruleId) ? ruleStates[ruleId] : undefined;
  for (const candidate of candidates) {
    if (candidate.cites.length === 0) {
      out.push({ ac_id: candidate.ac_id, reason: "uncited" });
      continue;
    }
    const prior = new Set(candidate.prior_cites ?? []);
    const holdsLive = candidate.cites.some((ruleId) => stateOf(ruleId) === "live");
    for (const ruleId of candidate.cites) {
      const state = stateOf(ruleId);
      if (state === "live") continue;
      // reason: a cite the write did not add is judged only when nothing live remains (BR-87).
      if (holdsLive && prior.has(ruleId)) continue;
      out.push({ ac_id: candidate.ac_id, rule_id: ruleId, reason: state ?? "missing" });
    }
  }
  return out;
}

/**
 * `ac-cite` predicate: passes iff every added/revised criterion holds at least one live cite and every cite the
 * write adds is live. Pure; whether the gate APPLIES (mode, armed branch) is decided by the caller before it
 * builds the context — this predicate only measures citations.
 *
 * @returns `{ok: true}` or `{ok: false, reason: AC_CITE_REQUIRED_REASON, field: AC_CITE_FIELD}`
 */
export function acCiteLive(candidates: readonly AcCiteCandidate[], ruleStates: AcCiteRuleStates): PredicateResult {
  return findAcCiteViolations(candidates, ruleStates).length === 0
    ? { ok: true }
    : { ok: false, reason: AC_CITE_REQUIRED_REASON, field: AC_CITE_FIELD };
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
  /** The working copy the sibling's claim declared (`TaskClaim.worktree`); absent when it declared none. Read by the edit scope, never by the overlap predicate. */
  worktree?: string;
  /**
   * The holding RUN (BR-1056): a string = the run that took the lease; `null` or absent = the lease carries no run
   * (written before runs existed and not yet expired by `lore migrate schema`), which belongs to no writer and so
   * conflicts with every claimant.
   */
  harness_run?: string | null;
}

/** `noAnchorOverlap`'s machine-readable failure reason for a conflicting sibling claim. */
export const ANCHOR_OVERLAP_REASON = "ANCHOR_OVERLAP";

/**
 * The `PredicateResult.field` value `noAnchorOverlap`'s failure carries
 * (SPEC-042 D5, review U4) — the `GateEnforcer` error discriminator
 * `gate:task-claim:anchor-overlap` and `feedTaskOrPhaseClaim`'s message dispatch key on it.
 */
export const ANCHOR_OVERLAP_FIELD = "anchor-overlap";

/** The three-valued verdict {@link compareClaimSessions} returns — never a boolean. */
export type SessionComparison = "same-session" | "different-session" | "not-measured";

/**
 * Compares two claims' captured session instances
 * (`TaskClaim.session_id`) — the pure three-valued core of the territory
 * partition's "is this the same session?" question (the anchor mutex no longer uses it: it compares runs).
 *
 * A boolean would be a lie: "not equal" and "not known" are different facts with
 * OPPOSITE safe defaults.
 *
 * @param candidateSessionId - The claiming session's captured id, if any.
 * @param siblingSessionId - The sibling claim's recorded id, if any.
 * @returns `"same-session"` only when BOTH sides are present and equal;
 *   `"different-session"` only when both are present and differ;
 *   `"not-measured"` whenever either side is absent.
 * @example
 * compareClaimSessions("3de02220", "3de02220"); // => "same-session"
 * @example
 * compareClaimSessions("3de02220", "7ab19c04"); // => "different-session"
 * @example
 * compareClaimSessions("3de02220", undefined); // => "not-measured" (never "different")
 */
export function compareClaimSessions(
  candidateSessionId: string | undefined,
  siblingSessionId: string | undefined,
): SessionComparison {
  if (candidateSessionId === undefined || siblingSessionId === undefined) {
    return "not-measured";
  }
  return candidateSessionId === siblingSessionId ? "same-session" : "different-session";
}

/**
 * Why an anchor overlap is a conflict — the discriminated outcome
 * {@link findAnchorOverlapConflict} reports. There is one reason: the sibling's lease is held by a different run
 * (BR-1056), or by no run at all.
 */
export type AnchorOverlapConflictKind = "foreign-run";

/** One offending sibling claim, with the overlapping path pairs and WHY it conflicts. */
export interface AnchorOverlapConflict {
  sibling: SiblingClaimInfo;
  /** `anchorsOverlap`'s overlapping `[candidateAnchor, siblingAnchor]` pairs. */
  pairs: [string, string][];
  kind: AnchorOverlapConflictKind;
}

/**
 * THE single anchor-overlap conflict scan — shared by {@link noAnchorOverlap}
 * (the verdict) and `checkpoint-registry.ts::feedAnchorOverlap` (the message).
 *
 * It exists as one function because the renderer previously re-implemented the
 * skip rules and drifted the instant the predicate's rules changed: a refusal
 * that names nothing is a refusal nobody can repair.
 *
 * Skips (no conflict): a stale sibling, a sibling declaring no anchors, non-overlapping anchors, or a sibling
 * whose lease is held by the candidate's OWN run. Everything else conflicts: another run (even one deriving the
 * same display name), or a lease or claimant with no run.
 *
 * @param candidateAnchors - The target's own declared (normalized) anchors.
 * @param siblingClaims - Every OTHER task in scope holding a claim (fresh or
 *   stale — staleness is filtered HERE, not by the caller).
 * @param candidateRun - The claimant's run (BR-1056); `null`/absent = no run, which equals no holder.
 * @returns The FIRST conflicting sibling in `siblingClaims` order, or
 *   `undefined` when none conflicts.
 * @example
 * findAnchorOverlapConflict(["src/a"], [
 *   { slug: "task-1", title: "T1", by: "agent:session-7ab19c04", at: "T0", stale: false,
 *     anchors: ["src/a"], harness_run: "cc:7ab19c04" },
 * ], "cc:3de02220");
 * // => { sibling: …, pairs: [["src/a","src/a"]], kind: "foreign-run" }
 */
export function findAnchorOverlapConflict(
  candidateAnchors: string[] | undefined,
  siblingClaims: readonly SiblingClaimInfo[] | undefined,
  candidateRun?: string | null,
): AnchorOverlapConflict | undefined {
  const anchors = candidateAnchors ?? [];
  const claimantRun = candidateRun ?? null;
  if (anchors.length === 0) return undefined;
  for (const sibling of siblingClaims ?? []) {
    if (sibling.stale) continue;
    if (sibling.anchors.length === 0) continue;
    const overlap = anchorsOverlap(anchors, sibling.anchors);
    if (!overlap.overlaps) continue;
    // reason: BR-1056 — the holder is a RUN. Two runs deriving one name must not pass for one writer, and a
    // lease or claimant with no run is nobody's: `null === null` is NOT "the same holder".
    const holderRun = sibling.harness_run ?? null;
    if (claimantRun !== null && holderRun === claimantRun) continue;
    return { sibling, pairs: overlap.pairs, kind: "foreign-run" };
  }
  return undefined;
}

/**
 * `task-claim`'s worktree-mutex predicate (SPEC-042 §Design Decisions D5, run-keyed by BR-1056): the candidate
 * claim's declared `file_anchors` must not overlap a FRESH sibling claim held by a DIFFERENT RUN, within the same
 * plan.
 *
 * Vacuous pass (no ERROR path — `anchorsOverlap`'s precondition-only contract extends to this predicate) when: the
 * candidate declares no anchors, a sibling is stale, a sibling declares no anchors itself, no sibling's anchors
 * overlap the candidate's, or the overlapping sibling is held by the candidate's own run.
 *
 * @param candidateAnchors - The target task's own declared (normalized) anchors.
 * @param siblingClaims - Every OTHER task in the same plan holding a claim
 *   (fresh or stale — staleness is filtered HERE, not by the caller).
 * @param candidateRun - The claimant's run; see {@link findAnchorOverlapConflict}.
 * @returns `{ok: true}` when no conflicting sibling exists;
 *   `{ok: false, reason: "ANCHOR_OVERLAP", field: "anchor-overlap"}` otherwise.
 * @example
 * noAnchorOverlap(["src/a"], [
 *   { slug: "task-1", title: "T1", by: "agent:t1", at: "T0", stale: false, anchors: ["src/a/"], harness_run: "cc:a" },
 * ], "cc:b"); // => { ok: false, reason: "ANCHOR_OVERLAP", field: "anchor-overlap" }
 * @example
 * noAnchorOverlap(["src/a"], [
 *   { slug: "task-1", title: "T1", by: "agent:t1", at: "T0", stale: false, anchors: ["src/a"], harness_run: "cc:a" },
 * ], "cc:a"); // => { ok: true } — the same run
 */
export function noAnchorOverlap(
  candidateAnchors: string[] | undefined,
  siblingClaims: readonly SiblingClaimInfo[] | undefined,
  candidateRun?: string | null,
): PredicateResult {
  const conflict = findAnchorOverlapConflict(candidateAnchors, siblingClaims, candidateRun);
  if (conflict === undefined) return { ok: true };
  return { ok: false, reason: ANCHOR_OVERLAP_REASON, field: ANCHOR_OVERLAP_FIELD };
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

/** `specCitesLiveRulePredicate`'s single machine-readable failure reason. */
export const SPEC_CITES_NO_LIVE_RULE_REASON = "SPEC_CITES_NO_LIVE_RULE";

/** The `PredicateResult.field` value `specCitesLiveRulePredicate`'s failure carries. */
export const SPEC_CITATION_FIELD = "acceptance-criteria-cites";

/**
 * `spec-promote`'s BR-1007 predicate — a spec none of whose criteria cites a LIVE business (BR) or
 * architecture (AS) rule is not approvable, so the pre-flight gate must say so too (issue #137: the gate
 * reported pass for a spec `approve` then refused).
 *
 * Pure: the caller measures the fact (`specCitesLiveRuleInCorpus`, spec-approval-citation.ts — the SAME
 * measure `approve` and `set` use) and hands over the boolean; this module does no IO.
 *
 * @param cites - `true`/`false` when the caller measured it; `undefined` when it did NOT (the service
 *   paths `CorpusService.set` / `ReviewService.approve` enforce BR-1007 themselves, unconditionally,
 *   right after this checkpoint — they leave it absent rather than measure twice). `undefined` is
 *   "not evaluated", never "cites", and is the only way this predicate passes without a citation.
 * @returns `{ok: false, reason: "SPEC_CITES_NO_LIVE_RULE", field: "acceptance-criteria-cites"}` iff `cites === false`
 * @example
 * specCitesLiveRulePredicate(true);      // => { ok: true }
 * specCitesLiveRulePredicate(false);     // => { ok: false, reason: "SPEC_CITES_NO_LIVE_RULE", field: "acceptance-criteria-cites" }
 * specCitesLiveRulePredicate(undefined); // => { ok: true } — not evaluated by this caller
 */
export function specCitesLiveRulePredicate(cites: boolean | undefined): PredicateResult {
  if (cites === false) {
    return { ok: false, reason: SPEC_CITES_NO_LIVE_RULE_REASON, field: SPEC_CITATION_FIELD };
  }
  return { ok: true };
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
 * The structural reasons `lore verify` cannot run against a plan
 * (spec-verify-reachability-plan-promote-early-warning §Scope M1; `"unknown"`
 * added by spec-plan-closure-must-be-loud-terminality-divergence-silent
 * §Design Decisions DD-4(b)) — `null` when reachable. A discriminated
 * companion to `ReachabilityResult.reachable` rather than a bare boolean:
 * callers (the `plan-promote` advisory) render DIFFERENT prose per reason, so collapsing this to `boolean`
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
 * enforcement path. It is the ONE derivation behind `plan-promote`'s early-warning advisory
 * (`checkpoint-registry.ts`'s `planPromoteReachabilityAdvisory`; spec-verify-reachability-plan-promote-early-warning
 * §Design Decisions D2).
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

/** `milestoneReviewCurrent`'s failure reasons (BR-1372): no review, a review of an older state, a failing review. */
export const MILESTONE_REVIEW_MISSING_REASON = "MILESTONE_REVIEW_MISSING";
export const MILESTONE_REVIEW_STALE_REASON = "MILESTONE_REVIEW_STALE";
export const MILESTONE_REVIEW_FAILED_REASON = "MILESTONE_REVIEW_FAILED";

/** The business rule a refused close names. */
export const MILESTONE_REVIEW_RULE = "BR-1372";

/** The `PredicateResult.field` value `milestoneReviewCurrent`'s failure carries. */
export const MILESTONE_REVIEW_FIELD = "milestone-review";

/**
 * `plan-close`'s ONLY plan-state predicate (BR-1372): the plan's latest milestone review (`lore assess`) must be of
 * the plan's current state and have no failing dimension.
 *
 * @param currency - what `assessMilestoneCurrency` measured from the stored reviews
 * @returns `{ok: true}` for a current passing review; otherwise `{ok: false, reason, field: "milestone-review"}`
 *   with one of the three MILESTONE_REVIEW_*_REASON values
 * @example
 * milestoneReviewCurrent({ state: "pass", reviewSlug: "r" }); // => { ok: true }
 * @example
 * milestoneReviewCurrent({ state: "absent" }); // => { ok: false, reason: "MILESTONE_REVIEW_MISSING", field: "milestone-review" }
 */
export function milestoneReviewCurrent(currency: Exclude<MilestoneReviewCurrency, { state: "no-tasks" }>): PredicateResult {
  switch (currency.state) {
    case "pass":
    case "accepted":
      return { ok: true };
    case "absent":
      return { ok: false, reason: MILESTONE_REVIEW_MISSING_REASON, field: MILESTONE_REVIEW_FIELD, rule: MILESTONE_REVIEW_RULE };
    case "stale":
      return { ok: false, reason: MILESTONE_REVIEW_STALE_REASON, field: MILESTONE_REVIEW_FIELD, rule: MILESTONE_REVIEW_RULE };
    case "failed":
      return { ok: false, reason: MILESTONE_REVIEW_FAILED_REASON, field: MILESTONE_REVIEW_FIELD, rule: MILESTONE_REVIEW_RULE };
    default: {
      const unreachable: never = currency;
      return unreachable;
    }
  }
}

// ─── SPEC-143 C2 (R9) — the two-axis stamp currency types and `readStampVerdict` live in ───
// ─── `@lore/core` (stamp-binding.ts, ONE derivation); re-exported for existing importers ───
export { readStampVerdict };
export type { StampClass, StampCurrency, StampVerdict };


/**
 * The RADIUS axis (declared in `@lore/core`'s `stamp-binding.ts` so the pure floor derivation shares it;
 * re-exported here, where every consumer of the two-axis types already imports from). Structurally identical
 * to `adapters/real-git-port.ts::BranchMeasurement`: "not measured" and "measured, and nothing changed" are
 * different facts with OPPOSITE safe defaults.
 *
 * ⛔ NEVER `boolean | "unmeasured"` (SPEC-143 C3 retired that shape); AC-CT-9(c) spends a compile-time oracle
 * on it. Contrast {@link SessionComparison}, a BARE three-valued string because it carries no payload.
 */
export type { RadiusMeasurement };

/**
 * The blast radius of one AC verdict: pathspecs extracted from the AC command's test-file targets
 * UNION the governing task's `file_anchors`, de-duplicated, command tokens first.
 *
 * ⛔ A member resolves when it is a syntactically valid repo-relative pathspec, NOT when the file
 * exists (SPEC-143 AC-CT-4): a path deleted or created after the recorded HEAD is exactly the
 * change the diff must see. Invalid members (empty, absolute, `..`-escaping, option-like, NUL or
 * newline-bearing) are dropped, never repaired.
 *
 * @example
 * resolveBlastRadiusPaths("bunx vitest run a.test.ts", ["src/a.ts"]); // => ["a.test.ts", "src/a.ts"]
 * resolveBlastRadiusPaths("bun run typecheck", []); // => []
 */
export function resolveBlastRadiusPaths(command: string, fileAnchors: readonly string[]): string[] {
  const radius = new Set<string>();
  for (const candidate of [...extractTestFileTokens(command), ...fileAnchors.map(fileAnchorPath)]) {
    const path = candidate.trim();
    if (isValidRepoRelativePathspec(path)) radius.add(path);
  }
  return [...radius];
}

function isValidRepoRelativePathspec(path: string): boolean {
  if (path === "" || path.startsWith("/") || path.startsWith("-")) return false;
  if (/[\0\n\r]/.test(path)) return false;
  return !path.split("/").includes("..");
}

/** Input to {@link blastRadiusChanged}. */
export interface BlastRadiusInput {
  /** The AC's verify command (its test-file targets seed the radius). */
  readonly command: string;
  /** The governing task's `file_anchors`. */
  readonly fileAnchors: readonly string[];
  /** HEAD recorded on the verdict row (`head_sha`). */
  readonly recordedHead: string;
}

/**
 * Staleness of a recorded verdict by blast radius, NOT ancestry (SPEC-143 AC-CT-4, D4): the
 * decision IS `git diff --quiet <recordedHead> HEAD -- <radius>` through the injected port
 * (production: `SpawnGitPort`, which delegates to the one shared `gitDiffChangedSince`).
 *
 * - radius empty (command and anchors yield no pathspec) -> `unmeasured`, never `bound`;
 * - git cannot answer (unknown head, shallow clone, not a repo) -> `unmeasured`, never a guess;
 * - else `measured` with `changed` from the diff.
 *
 * Dirty-tree evidence is the stamp axis's business (AC-CT-3/5) and is not read here.
 */
export function blastRadiusChanged(
  input: BlastRadiusInput,
  git: { changedSince(sha: string, paths: string[]): Result<boolean, LoreError> },
): RadiusMeasurement {
  const radius = resolveBlastRadiusPaths(input.command, input.fileAnchors);
  if (radius.length === 0) return { status: "unmeasured" };
  const diff = git.changedSince(input.recordedHead, radius);
  return diff.ok ? { status: "measured", changed: diff.value } : { status: "unmeasured" };
}


/**
 * The two-axis currency of one attested row, stamp axis classified against the corpus's arming
 * row (SPEC-143 AC-CT-3). The radius axis is supplied by the caller already measured
 * ({@link blastRadiusChanged}); until the floor reads it (CT-5) callers pass `unmeasured`.
 *
 * `reason` carries the `unbound` reason (`dirty_tree`, `state_moved`, `audit_id_unresolved`,
 * `no_stamp`).
 *
 * ⛔ `hasStamp: false` can never yield `stamped` — the classifier reads the flag, never a default.
 *
 * @example
 * stampCurrency({ armingRev: 100, hasStamp: false, runnerReason: undefined, recordedAuditId: 150 }, { status: "unmeasured" });
 * // => { stamp: "unbound", radius: { status: "unmeasured" }, reason: "no_stamp" }
 */
export function stampCurrency(input: StampAxisInput, radius: RadiusMeasurement): StampCurrency {
  return stampCurrencyOf(classifyStampAxis(input), radius);
}



// ─── SPEC-143 AC-CT-9(d) — the stamp-verdict distribution, ONE predicate ────
// ─── consumed by `lore assess` and `lore status` ────────────────────────────

/**
 * The stamp-verdict distribution: how many attested evidence rows read each of the five
 * {@link StampVerdict}s. A SECOND axis over the same rows as the `capture_source` distribution
 * (`classifyCaptureSource`), reported alongside it and NEVER merged (folding gives buckets summing to
 * twice the row count, SPEC-143 R12). `radius_unmeasured` keeps its own count.
 *
 * `total` counts ATTESTED rows only (a self-report has no stamp reading, `classifyEvidenceStamps` maps it to
 * `null`), so the five buckets sum to `total` by construction; `unbound_reasons` partitions `unbound`.
 */
export interface StampVerdictDistribution {
  readonly total: number;
  readonly bound: number;
  readonly stale: number;
  readonly radius_unmeasured: number;
  readonly unbound: number;
  readonly legacy_unbound: number;
  /** Sums to `unbound` (every `unbound` row carries exactly one reason). */
  readonly unbound_reasons: Readonly<Record<UnboundReason, number>>;
}

/**
 * The two-axis currency of every ATTESTED row of `docs`' evidence, one entry per row, in doc-then-row order
 * (self-reports have no stamp axis and are skipped). Pure: both axes arrive pre-resolved in `binding`.
 */
export function collectStampCurrencies(
  docs: readonly DocRecord[],
  binding: StampBindingContext,
): StampCurrency[] {
  const currencies: StampCurrency[] = [];
  for (const doc of docs) {
    const evidence = extractEvidence(doc);
    const readings = classifyEvidenceStamps(doc.id, evidence, binding);
    const radii = classifyEvidenceRadii(doc.id, evidence, binding);
    readings.forEach((reading, index) => {
      if (reading === null) return;
      const radius = radii[index] ?? { status: "unmeasured" as const };
      currencies.push(stampCurrencyOf(reading, radius));
    });
  }
  return currencies;
}

/**
 * Buckets rows through {@link readStampVerdict} — the ONLY place the five-way distribution is derived.
 * `lore assess` and `lore status` both render this value; neither re-derives a bucket.
 *
 * @example
 * stampVerdictDistribution([{ stamp: "stamped", radius: { status: "unmeasured" } }]);
 * // => { total: 1, radius_unmeasured: 1, bound: 0, stale: 0, unbound: 0, legacy_unbound: 0, unbound_reasons: {…0} }
 */
export function stampVerdictDistribution(rows: readonly StampCurrency[]): StampVerdictDistribution {
  const counts = { bound: 0, stale: 0, radius_unmeasured: 0, unbound: 0, legacy_unbound: 0 };
  const reasons: Record<UnboundReason, number> = {
    dirty_tree: 0,
    state_moved: 0,
    audit_id_unresolved: 0,
    no_stamp: 0,
  };
  for (const row of rows) {
    const verdict = readStampVerdict(row);
    counts[verdict] += 1;
    if (verdict === "unbound" && row.reason !== undefined && row.reason in reasons) {
      reasons[row.reason as UnboundReason] += 1;
    }
  }
  return { total: rows.length, ...counts, unbound_reasons: reasons };
}

/** The distribution over every attested row of `docs` — `stampVerdictDistribution(collectStampCurrencies(...))`. */
export function computeStampVerdictDistribution(
  docs: readonly DocRecord[],
  binding: StampBindingContext,
): StampVerdictDistribution {
  return stampVerdictDistribution(collectStampCurrencies(docs, binding));
}
