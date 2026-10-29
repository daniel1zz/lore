/**
 * ReviewService — human-in-the-loop review workflow for documents.
 * Manages pending review queue, approval, and rejection of draft documents.
 * Source: SPEC-005 §3, SPEC-001 §3.2
 */

import { requireOverrideAuto, type OverrideDecisionPort } from "./override-decision.js";
import type {
  AuditEntry,
  DocId,
  DocRecord,
  DocType,
  DocTypeMeta,
  JudgeIdentity,
  ReviewDecision,
  ReviewJudgment,
  Slug,
  SpecKind,
  Validity,
  VersionRecord,
} from "@lore/core";
import { err, extractEvidence, ok, type LoreError, type Result } from "@lore/core";
import {
  getAllowedTransitions,
  isReopenTransition,
  isValidTransition,
  deriveTypeMeta,
  extractValidity,
  isInvalidated,
  isLedgerKnowledgeSubType,
  judgeIdentitySchema,
  specAcceptanceCriteriaSchema,
  SPEC_KINDS,
} from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { resolveWriteActorFor, WriteActorUnresolvedError } from "../store/write-context-store.js";
import { bareDocWriter, type DocWritePort } from "./corpus-service.js";
import { resolveDoc } from "./resolve.js";
import { PENDING_REVIEW_STATUSES, isPendingReviewDoc } from "./pending-queue.js";
import { absentDeclarationRefusal, leavesUnder, type AbsentDeclaration, type DeclaringLeaf } from "./leaf-coverage.js";
import { requireSpecCitesLiveRule } from "./spec-approval-citation.js";
import { ownProposedRules } from "./rule-changes.js";
import {
  buildUpstreamSpecContext,
  countScriptModeAcceptanceCriteria,
  type GateContext,
} from "./checkpoint-registry.js";
import type { GateDependencies } from "./gate-enforcer.js";
import type { JudgmentService } from "./judgment-service.js";
import { REOPEN_AUDIT_ACTION, REOPEN_OPERATION, type RecordLockService } from "./record-lock-service.js";
import { findSpecEvidenceTasks } from "./spec-evidence-tasks.js";
import { redWaiverNotCode } from "./done-contract-compile.js";
import type { ApproveContractPort } from "./done-contract-service.js";
import { ANY_RULE_ID_PATTERN } from "@lore/core";
import {
  appendApprovedRule,
  discardNodeRevision,
  discardRuleRevision,
  listPendingItems,
  NODE_ITEM,
  pendingCountOf,
  promoteItems,
  promoteRuleRevision,
  statusFor,
  type PendingItem,
} from "./baseline-pending.js";
import { pendingRevisionsOf } from "./baseline-items.js";

// ─── Public Types ──────────────────────────────────────────────────────────

/**
 * A document waiting for human review.
 * Subset of DocRecord with review-relevant fields.
 *
 * @invariant `meta` mirrors `DocSummary.meta` (SPEC-036 §2 D3) — derived by the
 *   same single-derivation-point `deriveTypeMeta` fn used by
 *   `CorpusService.toSummary`. Absent (never a fabricated default) for `prd`
 *   docs or when the doc's type-specific `extra` fields are missing/malformed;
 *   `task.claim_stale` is additionally absent whenever this service wasn't
 *   constructed with `claimTtlMinutes`.
 * @invariant `slug` (SPEC-065 D3) is ALWAYS present, never optional — unlike
 *   `meta`, a doc's slug is never absent/malformed by construction. Added so
 *   `lore pending`'s table can print a resolvable identifier alongside the
 *   truncated 10-char id column (SPEC-065's whole premise: an id a surface
 *   PRINTS must be a valid INPUT to `resolveDoc`'s prefix resolution — the
 *   slug always was, but wasn't SHOWN here before this field existed).
 * @invariant `validity` (SPEC-043 D3 pending-queue extension, task
 *   `task-lore-pending-does-not-filter-invalidated-docs-an`) is the doc's
 *   extracted `extra.validity`, hoisted to a top-level field the SAME way
 *   `SearchHit.validity` is (never a full `extra` blob) — present iff the doc
 *   carries validity metadata at all (regardless of whether it's currently
 *   invalidated), absent for every doc type `ValidityService` never writes to.
 *   It exists so the CLI can render the `[invalid]` badge (`formatValidityBadge`,
 *   the SAME renderer `lore list --include-invalid` uses) without a second
 *   per-doc fetch — `pending()` already holds the full `DocRecord` this is
 *   extracted from.
 */
export interface PendingDoc {
  id: DocId;
  slug: Slug;
  type: DocType;
  title: string;
  status: "draft" | "in-review";
  created_by: string;
  updated_at: string;
  version: number;
  change_summary?: string;
  meta?: DocTypeMeta;
  validity?: Validity;
}

export interface PendingFilters {
  /** Filter by document creator (created_by) */
  author?: string;
  /** Filter by document type */
  type?: DocType;
  /** ISO 8601 — only docs updated at or after this time */
  since?: string;
  /**
   * SPEC-043 D3 — include invalidated docs in the result (excluded by default).
   * Mirrors `ListFilters.include_invalid` (`corpus-service.ts`) — `lore pending`
   * is a review-QUEUE list-surface, the same read-surface class `list`/`search`
   * already apply this filter to. Default `false`/absent: an invalidated draft
   * (e.g. a duplicate superseded by its canonical version) is excluded from the
   * queue rather than sitting there forever — `VALID_TRANSITIONS` (`@lore/core`
   * lifecycle.ts) gives draft no exit to archived for most types, so filtering is
   * the way this queue self-cleans.
   */
  include_invalid?: boolean;
  /**
   * SPEC-103 §Mechanisms M3 — restore the FULL draft list, including `task`-type docs
   * and ledger knowledge sub_types (assessment/retro/handoff/uat), both of which are
   * EXCLUDED by default (see {@link ReviewService.pending}'s own JSDoc). Mirrors
   * `include_invalid`'s "default hides, opt-in restores" shape — a DIFFERENT axis
   * (queue-relevance vs. validity), so the two flags compose independently.
   */
  all?: boolean;
}

export interface ApproveOpts {
  /** Reviewer identity — defaults to "system" if omitted */
  reviewer?: string;
  /**
   * AC-DCS1-5 — the reason the red run of a code task is waived (`lore approve --red-waiver "<reason>"`), stored verbatim as the
   * contract's `red_waiver_reason`. A blank reason is refused; a document that is not a code task refuses `red-waiver-not-code`.
   */
  redWaiverReason?: string;
  /**
   * SPEC-103 §Mechanisms M2, §Design Decisions D3 — the audited escape hatch for
   * the anti-lottery worst-decision-wins gate: the id of an EXISTING `review_judgments`
   * row for this doc (any version) whose blocking verdict (reject/escalate, or simply
   * "no independent judgment") the caller is deliberately overriding. When present,
   * `approve` skips the `review-judgment` checkpoint entirely for this call (every
   * OTHER gate — spec-promote/plan-promote — still runs unchanged) and records
   * `details.override_judgment_id` on the SAME approve audit entry. A value that
   * doesn't resolve to a judgment ON THIS DOC is rejected loud (`VALIDATION_ERROR`) —
   * never silently ignored.
   */
  overrideJudgmentId?: string;
  /**
   * task-t3-hardening-reachable-override-escape-real-ai-provenance — sibling escape to
   * `overrideJudgmentId` for the ONE denial it structurally cannot reach: `NO_JUDGMENT_REASON`
   * when `review_judgments` has ZERO rows for this doc (ANY version) — there is no id anywhere
   * to name (the most common judgment-required denial: a doc that has never been reviewed at
   * all). Legal ONLY in that exact zero-judgment-ever state, checked against the SAME
   * `judgmentService.listFor` read `overrideJudgmentId` uses (not merely "current version has
   * none" — a doc with an OLDER-version judgment still has a real id to name, so THAT case is
   * rejected loud here, pointing the caller at `overrideJudgmentId` instead — the two flags
   * never overlap in what they legalize). Mutually exclusive with `overrideJudgmentId` (passing
   * both is rejected loud, never silently resolved by one winning). When accepted, skips the
   * `review-judgment` checkpoint for this call exactly like `overrideJudgmentId` does, and
   * records `details.override_no_judgment: true` on the SAME approve audit entry — audited,
   * named, never a silent bypass.
   */
  overrideNoJudgment?: boolean;
  /**
   * The doc version the caller last saw (HTTP `If-Match`, set()'s `expectedVersion`). When it differs
   * from the version `approve` reads, the call returns `STALE_VERSION` BEFORE any write, so a
   * `set(status: "approved")` delegated here (BR-1071) keeps the optimistic-concurrency contract the
   * direct write had. Absent = no caller-side version claim (the CAS still guards the write itself).
   */
  expectedVersion?: number;
  /**
   * Baseline node only (BR-1338): approve this ONE item (`BR-n` / `AS-n` / `AD-n`, or `node` for the node's own part)
   * instead of every pending revision a review saw. Items not named are untouched. Refused (VALIDATION_ERROR) when the
   * item holds no pending revision, or no review saw its current revision.
   */
  item?: string;
}

/** Measures declared leaf commands against the tree the corpus lives in (the adapter owns the source analysis). */
export interface BaselineDeclarationPort {
  absentDeclarations(leaves: readonly DeclaringLeaf[]): Promise<Result<readonly AbsentDeclaration[], LoreError>>;
}

/**
 * `approve()`'s return shape — the approved `DocRecord` PLUS an additive,
 * observability-only field (spec-verify-reachability-plan-promote-early-warning
 * §Scope M1, task T2 "wire the advisory into the LIVE enforcement path"). Every
 * pre-existing field/behavior of `DocRecord` is unchanged; MCP/HTTP callers that
 * only ever read `DocRecord`'s own fields (id/slug/version/etc.) keep working
 * without modification (structural subtyping — `ApproveResult` IS-A `DocRecord`).
 *
 * @invariant `reachability_advisories` NEVER influences whether `approve()`
 *   succeeds or what status/version the doc ends up at (D1 — advisory never
 *   changes the outcome). It is populated ONLY for a just-approved `plan` doc
 *   whose `plan-promote` checkpoint found `lore verify` structurally
 *   unreachable for it — every other case (non-plan doc, reachable plan, no
 *   `gate` dependency wired, `plan-promote` disabled by config) OMITS the field
 *   entirely rather than writing an empty array, so `"reachability_advisories"
 *   in result` doubles as the "was there anything to warn about" check.
 */
export interface ApproveResult extends DocRecord {
  reachability_advisories?: string[];
  /**
   * Baseline node only: the items this approval promoted to their approved version, and the items still pending after it
   * (so a caller never reads a partial approval as a whole one). Absent for every other doc type.
   */
  promoted_items?: string[];
  still_pending?: string[];
}

/** What {@link ReviewService.approve} decided to promote for a baseline node (see `planBaselinePromotion`). */
interface BaselinePromotionPlan {
  /** The pending revisions promoted: all pending revisions (or the one `--item` named). */
  readonly selected: readonly PendingItem[];
  /** The node as it reads once the selection is promoted: what the approval gates measure. */
  readonly gateDoc: DocRecord;
}

/** Result of {@link ReviewService.rejectItem}. */
export interface RejectItemOutcome {
  readonly doc: DocRecord;
  /** The pending revision that was discarded. */
  readonly discarded: PendingItem;
}

export interface RejectOpts {
  /** Reviewer identity — defaults to "system" if omitted */
  reviewer?: string;
  /** Reason for rejection — stored in audit entry */
  reason?: string;
}

export interface ReopenOpts {
  /** Reviewer identity — defaults to "system" if omitted (same default as approve/reject). */
  reviewer?: string;
  /**
   * Test seam (BR-1054): runs after the status write has landed and before the post-write evidence
   * recount. Production callers never pass it.
   */
  afterStatusWrite?: () => Promise<void>;
}

// ─── ReviewService ─────────────────────────────────────────────────────────

/**
 * ReviewService — stateless service, all state in StoreInterface.
 * All methods return Result<T, LoreError> — never throw.
 */
export class ReviewService {
  /**
   * @param store - Storage abstraction (SQLiteStore, TursoStore, or InMemoryStore)
   * @param recordLock - REQUIRED lock-fact source (spec D17): `reopen` asks it for the spec's lock verdict
   *   so only a locked record is reopened. No default - a service built without one does not compile.
   * @param claimTtlMinutes - Task claim lease TTL in minutes, forwarded to
   *   `deriveTypeMeta` for `PendingDoc.meta`'s `task.claim_stale` computation
   *   (SPEC-036 §2 D3, pending-queue extension). Same DI shape as
   *   `CorpusService`/`TaskWorkflowService`/`AuditService`'s constructor-resolved
   *   config values. Omitted (not defaulted to 120 here) when the caller doesn't
   *   wire it — `deriveTypeMeta` then omits `claim_stale` entirely rather than
   *   computing it against a value this service invented.
   * @param gate - OPTIONAL gate-enforcement dependency bundle (retro follow-up item 8,
   *   defense-in-depth) — `{enforcer, getPlanBundle}`, see `GateDependencies` JSDoc
   *   (`./gate-enforcer.js`) for why both are bundled as one. When present, `approve`
   *   runs the `spec-promote` checkpoint for a `spec` doc (declared acceptance
   *   criteria count) or the `plan-promote` checkpoint for a `plan` doc (ancestor
   *   spec's approval + AC status, via `getPlanBundle`) before writing the transition.
   *   Absent (the default) → ungated, byte-identical to pre-GateEnforcer behavior —
   *   keeps every bare `new ReviewService(store)` unit test construction green.
   * @param judgmentService - OPTIONAL SPEC-103 §Mechanisms M2 dependency — reads
   *   `review_judgments` rows for the `review-judgment` checkpoint's worst-decision-
   *   wins computation. Absent (every bare unit-test construction) → M2 never runs
   *   (see `enforceJudgmentRequiredGate`'s own guard), byte-identical to pre-SPEC-103
   *   behavior. Only `app.ts`'s composition root wires the real instance.
   * @param judgmentRequiredTypes - OPTIONAL SPEC-103 M2 resolved config value
   *   (`resolveJudgmentRequiredTypes`, `@lore/core`, default `["spec","adr"]`) — the
   *   ONLY `DocType`s whose approval consults `review_judgments` (BR-1369); every other
   *   type approves without reading them. Absent/`undefined` (every bare unit-test
   *   construction) → treated as `[]`, the total kill switch — same "absent in bare
   *   tests, present in production" DI shape as every other optional constructor
   *   dependency on this class.
   */
  constructor(
    private readonly store: StoreInterface,
    private readonly recordLock: RecordLockService,
    private readonly claimTtlMinutes?: number,
    private readonly gate?: GateDependencies,
    private readonly judgmentService?: JudgmentService,
    private readonly judgmentRequiredTypes?: readonly string[],
    // reason: AC-DCL-5 — the ONE write route (`CorpusService`); `app.ts` passes the composed one, a bare test gets a
    // bare writer sharing this service's record lock. This service never calls a store write primitive itself.
    writer?: DocWritePort,
  ) {
    this.writer = writer ?? bareDocWriter(store, recordLock);
  }

  private readonly writer: DocWritePort;

  /**
   * The reviewer of a write: the explicit `by`, else the store write context's claimed name. ⛔ Never `"system"`
   * (the literal this service used to fall back to): an unresolvable caller is a refusal, not a guess.
   */
  private resolveReviewer(by?: string): Result<string, LoreError> {
    try {
      return ok(resolveWriteActorFor(this.store, by));
    } catch (e) {
      if (e instanceof WriteActorUnresolvedError) return err(e.error);
      if (e instanceof Error && "loreError" in e) return err((e as Error & { loreError: LoreError }).loreError);
      throw e;
    }
  }

  /**
   * Wires the decide() seam of the two self-grantable approval overrides (AC-AU-7). Set by the composition root
   * (a service never imports another service); absent = a requested override is refused loudly (never granted).
   */
  setOverrideDecisionPort(port: OverrideDecisionPort): void {
    this.overrideDecisions = port;
  }

  private overrideDecisions: OverrideDecisionPort | undefined;

  /**
   * Wires the measure of a leaf's declared commands against main's tree (task-approving-a-baseline-leaf-refuses-while-it-declares-a).
   * Set by the composition root of an entry that holds a source checkout (a service never imports an adapter); absent = the
   * approval of a baseline node skips the check (no tree to compare with), never refuses for lack of one.
   */
  setBaselineDeclarationPort(port: BaselineDeclarationPort): void {
    this.baselineDeclarations = port;
  }

  private baselineDeclarations: BaselineDeclarationPort | undefined;

  /**
   * Wires the done-contract compile (AC-DCS1-1): approving a task asks it for the contract stored in the approving write. Set by
   * `app.ts` at every composition site; absent = approving a task is refused (`done-contract-port-missing`), nothing written.
   * A unit test that approves a task passes `tests/helpers/done-contract-stub-port.ts`.
   */
  setDoneContractPort(port: ApproveContractPort): void {
    this.doneContracts = port;
  }

  private doneContracts: ApproveContractPort | undefined;

  private async resolveDoc(idOrSlug: string): Promise<Result<DocRecord, LoreError>> {
    return resolveDoc(this.store, idOrSlug);
  }

  /**
   * Gates `doc`'s draft→approved TRANSITION (retro follow-up item 8, defense-in-depth) —
   * `spec-promote` for a `spec` doc, `plan-promote` for a `plan` doc. Any other doc
   * type has no registered promote-time checkpoint and passes through untouched. A
   * no-op (`ok({ reachabilityAdvisories: [] })`) when this service wasn't constructed
   * with a `gate` dependency (see constructor JSDoc).
   *
   * @param doc - The doc `approve()` is about to transition to "approved".
   * @returns On success, `reachabilityAdvisories` (spec-verify-reachability-plan-
   *   promote-early-warning §Scope M1) — `[]` for every case except a `plan` doc
   *   whose `plan-promote` checkpoint is enabled and found `lore verify`
   *   structurally unreachable for it. Computed via `GateEnforcer.
   *   planPromoteReachabilityAdvisories`, a SEPARATE call from `enforce()` right
   *   below it — the advisory can never influence whether this method returns
   *   `ok`/`err` (D1).
   */
  private async enforceApprovalGate(
    doc: DocRecord,
    opts?: { skipJudgmentGate?: boolean },
  ): Promise<Result<ApprovalGateOutcome, LoreError>> {
    const gated = await this.enforceTypeGates(doc, opts);
    if (!gated.ok) return gated;
    // reason: BR-1007 — unconditional (no `gate` dependency, no config switch): a spec's
    // only relation to the product trees is its citations, so an uncited spec is not
    // approvable. Runs AFTER the type gates so a spec that fails a gate on its own merits
    // (judgment, AC count, oracle coverage) is refused for that reason first; a spec that
    // would otherwise pass is still refused here.
    if (doc.type === "spec") {
      const citationResult = await requireSpecCitesLiveRule(this.store, doc.slug, doc.extra["acceptance_criteria"], ownProposedRules(doc.extra));
      if (!citationResult.ok) return citationResult;
    }
    // reason: a declared command absent from main's tree never fails coverage (a branch may pre-declare a command), so a stale
    // declaration is refused HERE, where a baseline node is vouched for. Measured on the approved node's own leaves only.
    if (doc.type === "baseline" && this.baselineDeclarations !== undefined) {
      const all = await this.store.findMany({ type: "baseline" });
      if (!all.ok) return all;
      const leaves = leavesUnder(doc, all.value);
      if (leaves.length > 0) {
        const absent = await this.baselineDeclarations.absentDeclarations(leaves);
        if (!absent.ok) return absent;
        if (absent.value.length > 0) {
          return err({
            code: "VALIDATION_ERROR",
            field: "baseline-commands",
            message: absentDeclarationRefusal(doc.slug, absent.value),
            value: absent.value,
            rule: "BR-1308",
          });
        }
      }
    }
    return gated;
  }

  /**
   * The checkpoint half of {@link enforceApprovalGate}: judgment gate, then `spec-promote` /
   * `plan-promote`. Split out so the unconditional BR-1007 citation check can follow every
   * early `ok` return below without being repeated at each one.
   */
  private async enforceTypeGates(
    doc: DocRecord,
    opts?: { skipJudgmentGate?: boolean },
  ): Promise<Result<ApprovalGateOutcome, LoreError>> {
    if (this.gate === undefined) {
      return ok({ reachabilityAdvisories: [] });
    }

    // SPEC-103 §Mechanisms M2 — runs BEFORE the type-specific branches below (and
    // for ANY doc type, not just spec/plan) since it is orthogonal to spec-promote/
    // plan-promote's own predicates. `opts.skipJudgmentGate` is set by `approve()`'s
    // `--override-judgment` OR `--override-no-judgment` path (D3's audited escapes,
    // task-t3-hardening-reachable-override-escape-real-ai-provenance) — every other
    // gate on this method still runs unchanged even when this one is skipped.
    if (opts?.skipJudgmentGate !== true) {
      const judgmentGateResult = await this.enforceJudgmentRequiredGate(doc);
      if (!judgmentGateResult.ok) return judgmentGateResult;
    }

    if (doc.type === "spec") {
      const parsed = specAcceptanceCriteriaSchema.safeParse(doc.extra["acceptance_criteria"]);
      const acceptanceCriteriaCount = parsed.success ? parsed.data.length : 0;
      // reason: SPEC-058 D2 — oracleCoverage judges the spec against ITS OWN
      // spec_kind's configured profile; an absent/invalid value falls back to
      // "feature", the same create-time default `_createImpl` applies.
      const specKind = resolveSpecKindOrDefault(doc.extra["spec_kind"]);
      const enforceResult = this.gate.enforcer.enforce("spec-promote", {
        acceptanceCriteriaCount,
        specIdOrSlug: doc.slug,
        // reason: task-spec-promote-base-1-ac-rule-is-spec-kind-agnostic-spec-080
        // AC4 — feedSpecPromote's denial message names the RESOLVED kind, never a
        // hardcoded default; this is the SAME specKind already computed above for
        // verificationProfile, never a second lookup.
        specKind,
        ...(parsed.success ? { acceptanceCriteria: parsed.data } : {}),
        acQuantifiableEnabled: this.gate.enforcer.isAcQuantifiableEnabled("spec-promote"),
        verificationProfile: this.gate.enforcer.resolveVerificationProfile(specKind),
        oracleCoverageEnabled: this.gate.enforcer.isOracleCoverageEnabled(),
        // reason: AC-FR-8/D7 (task-derive-lore-feed-s-checkpoint-set-from-the-
        // registry-make) — `doc.id` is the RESOLVED doc's real id, threaded ONLY
        // for `GateEnforcer.enforce`'s own `gate_passed` audit `doc_id` (never read
        // by `checkSpecPromote`/`feedSpecPromote`; see `GateContext.targetDocId`).
        targetDocId: doc.id,
      });
      if (!enforceResult.ok) return enforceResult;
      // reason: M1's early-warning advisory is a `plan-promote`-only signal
      // (spec-verify-reachability-plan-promote-early-warning §Scope) — a spec
      // approval has no plan-close attestation floor of its own to warn about.
      return ok({ reachabilityAdvisories: [] });
    }

    if (doc.type === "plan") {
      // reason: check disable BEFORE the getPlanBundle IO below — mirrors gate.ts's
      // isGateDisabledByConfig-before-runPlanPromoteGate order. Without this early-out,
      // a disabled plan-promote gate could still be blocked by a broken ancestor-spec
      // lookup, violating "disabled === byte-identical to pre-GateEnforcer behavior"
      // (adversarial review, retro item 8 follow-up). A disabled checkpoint also
      // never surfaces the reachability advisory — mirrors `enforce()`'s own
      // config-disabled early return never running `checkpointDef.check`.
      if (!this.gate.enforcer.isEnabled("plan-promote")) {
        return ok({ reachabilityAdvisories: [] });
      }

      const bundleResult = await this.gate.getPlanBundle(doc.id);
      if (!bundleResult.ok) return bundleResult;
      const parentSpec = bundleResult.value.spec;
      const ctx = buildUpstreamSpecContext(parentSpec);
      // reason: SPEC-058 D4 — requiresUatDeclared judges the plan against its
      // ANCESTOR spec's spec_kind profile, not the plan's own (plans carry no
      // spec_kind). `hasSpecParent === false` already short-circuits
      // checkPlanPromote before this field is ever consulted, so resolving
      // `null` when there's no parent spec is a safe, unread default.
      const verificationProfile =
        parentSpec !== undefined
          ? this.gate.enforcer.resolveVerificationProfile(resolveSpecKindOrDefault(parentSpec.extra["spec_kind"]))
          : null;
      const planRequiresUat = doc.extra["requires_uat"] === true;
      // reason: spec-verify-reachability-plan-promote-early-warning §Scope M1 —
      // `parentSpecScriptAcCount` is computed HERE (not folded into
      // `buildUpstreamSpecContext`, whose exact-shape output is byte-pinned by
      // `checkpoint-registry.test.ts`'s regression assertion for EVERY caller,
      // including `task-claim`, which never reads this field at all) from the
      // SAME resolved `parentSpec` `ctx` already carries.
      const planPromoteCtx: GateContext = {
        ...ctx,
        ...(parentSpec !== undefined
          ? { parentSpecScriptAcCount: countScriptModeAcceptanceCriteria(parentSpec) }
          : {}),
        targetIdOrSlug: doc.slug,
        verificationProfile,
        planRequiresUat,
        requiresUatEnabled: this.gate.enforcer.isRequiresUatEnabled(),
        // reason: AC-FR-8/D7 — see this file's spec-promote gate block's identical
        // note; `doc.id` is the RESOLVED plan's real id, never its slug.
        targetDocId: doc.id,
      };
      const enforceResult = this.gate.enforcer.enforce("plan-promote", planPromoteCtx);
      if (!enforceResult.ok) return enforceResult;
      return ok({
        reachabilityAdvisories: [...this.gate.enforcer.planPromoteReachabilityAdvisories(planPromoteCtx)],
      });
    }

    return ok({ reachabilityAdvisories: [] });
  }

  /**
   * SPEC-103 §Mechanisms M2 — the `review-judgment` checkpoint's IO-performing half:
   * reads `review_judgments` for `doc`, partitions them into "collided with `doc.extra
   * .ai_provenance`" (I1) vs. "independent", and dispatches to `GateEnforcer.enforce
   * ("review-judgment", ctx)` — the PURE decision (worst-decision-wins, D3) lives
   * entirely in `checkReviewJudgment` (`checkpoint-registry.ts`).
   *
   * A no-op (`ok(undefined)`) when: this service has no `gate`/`judgmentService`
   * wired (bare test construction), OR `doc.type` is not in `judgmentRequiredTypes`
   * (default `["spec","adr"]`, BR-1369). An empty list is the total kill switch.
   *
   * @invariant BR-1369 — a type OUTSIDE `judgmentRequiredTypes` (plan, task, knowledge,
   *   baseline node) never consults `review_judgments`: no `reject`, no `escalate`, no
   *   missing judgment blocks it. Milestone review (`lore assess`) is where those
   *   documents are judged. For a listed type the worst independent current-version
   *   decision wins (D3) and `checkReviewJudgment` stays the single decision authority.
   *
   * @param doc - The doc `approve()` is about to transition to "approved" — read at
   *   its CURRENT (pre-write) version, the version judgments are matched against.
   */
  private async enforceJudgmentRequiredGate(doc: DocRecord): Promise<Result<void, LoreError>> {
    if (this.gate === undefined || this.judgmentService === undefined) {
      return ok(undefined);
    }
    // reason: BR-1369 — a type outside `judgment_required_types` NEVER consults `review_judgments`: it returns here,
    // before the judgments are read, so no reject, no escalate and no missing judgment can block it. An empty list is
    // the same rule for every type (the documented kill switch). Do NOT move this below the `listFor` read.
    if (!(this.judgmentRequiredTypes ?? []).includes(doc.type)) {
      return ok(undefined);
    }

    const judgmentsResult = await this.judgmentService.listFor(doc.id, "review");
    if (!judgmentsResult.ok) return judgmentsResult;
    const currentVersionJudgments = judgmentsResult.value.filter((j) => j.doc_version === doc.version);

    // reason: I1 (SPEC-103) — `extra.ai_provenance` is user/AI-authored data, not a
    // trusted shape; a malformed/absent value means the collision check is simply
    // N/A (every current-version judgment counts as independent), never a second
    // error path.
    const provenanceParsed = judgeIdentitySchema.safeParse(doc.extra["ai_provenance"]);
    const aiProvenance: JudgeIdentity | undefined = provenanceParsed.success ? provenanceParsed.data : undefined;

    let provenanceCollision = false;
    let truncatedApproval = false;
    const independentDecisions: ReviewDecision[] = [];
    // reason: D4 — the escalate denial renders these verbatim, so they are collected
    // from the SAME independent-judgment walk the decisions come from (never a second
    // read): a question that belongs to a provenance-colliding judgment is not part of
    // the verdict and must not be presented as if it were.
    const blockingQuestions: string[] = [];
    for (const judgment of currentVersionJudgments) {
      if (aiProvenance !== undefined && judgeIdentitiesEqual(judgment.judge, aiProvenance)) {
        provenanceCollision = true;
        continue;
      }
      // reason: BR-269 — an approve made on cut input never counts. A truncated reject/escalate still does: a
      // refusal on partial input is the safe direction, and dropping it would let noise out-roll a block.
      if (judgment.decision === "approve" && judgment.truncated === true) {
        truncatedApproval = true;
        continue;
      }
      independentDecisions.push(judgment.decision);
      if (judgment.decision === "escalate") {
        blockingQuestions.push(...judgment.blocking_questions);
      }
    }

    const ctx: GateContext = {
      targetIdOrSlug: doc.slug,
      reviewJudgmentDecisions: independentDecisions,
      reviewJudgmentProvenanceCollision: provenanceCollision,
      reviewJudgmentTruncatedApproval: truncatedApproval,
      reviewJudgmentBlockingQuestions: blockingQuestions,
      // reason: AC-FR-8/D7 — see this file's spec-promote gate block's identical
      // note; `doc.id` is the RESOLVED doc's real id, never its slug.
      targetDocId: doc.id,
    };
    return this.gate.enforcer.enforce("review-judgment", ctx);
  }

  /**
   * Return all documents awaiting review (draft or in-review, `isPendingReviewDoc`) matching optional filters.
   * Source: SPEC-005 §3, AC row 1.
   *
   * @param filters - author/type/since filters plus SPEC-043 D3's `include_invalid`
   *   escape (default false — see {@link PendingFilters.include_invalid}).
   * @param now - Time seam (D3) — drives the default invalidated-doc exclusion;
   *   defaults to `() => new Date().toISOString()`. Mirrors `CorpusService.list`'s
   *   identical `now` seam so both surfaces flip visibility at the SAME injected
   *   instant in tests, rather than each reading the wall clock independently.
   * @invariant SPEC-103 §Mechanisms M3 — the default queue EXCLUDES `task`-type
   *   docs and ledger knowledge sub_types (assessment/retro/handoff/uat,
   *   `isLedgerKnowledgeSubType`): "pending = promises", not every draft row.
   *   `filters.all === true` restores the FULL pre-SPEC-103 draft list (composes
   *   independently with `include_invalid` — a different axis, queue-relevance vs.
   *   validity). An explicit `filters.type` still narrows the underlying store
   *   query either way; the M3 filter is a POST-filter on top of whatever the store
   *   query already returned, so `--type task` without `--all` still yields `[]`
   *   (the default hides task entirely, `--all` is the only way to see it).
   */
  async pending(
    filters?: PendingFilters,
    now: () => string = defaultNow,
  ): Promise<Result<PendingDoc[], LoreError>> {
    const baseFilters: import("../store/store-interface.js").StoreFilters = {
      ...(filters?.author !== undefined ? { created_by: filters.author } : {}),
      ...(filters?.type !== undefined ? { type: filters.type } : {}),
      ...(filters?.since !== undefined ? { since: filters.since } : {}),
    };

    const queued: DocRecord[] = [];
    for (const status of PENDING_REVIEW_STATUSES) {
      const found = await this.store.findMany({ ...baseFilters, status });
      if (!found.ok) return found;
      queued.push(...found.value.filter(isPendingReviewDoc));
    }

    // SPEC-043 D3 — `pending` is a review-QUEUE list-surface, the same read-surface
    // class `CorpusService.list`/`search` already filter: an invalidated draft (e.g.
    // a duplicate superseded by its canonical version) has no lifecycle exit (for most
    // types `VALID_TRANSITIONS` has no draft exit to archived) and would otherwise sit in this queue
    // forever. Excluded by default; `include_invalid` restores it, badged by the
    // CLI (`formatValidityBadge`, `lore list --include-invalid`'s own renderer).
    // `isInvalidated` is a structural no-op for any doc type ValidityService never
    // writes `extra.validity` on — this filter naturally scopes itself.
    const nowIso = now();
    const invalidFiltered =
      filters?.include_invalid === true
        ? queued
        : queued.filter((doc) => !isInvalidated(doc, nowIso));

    // SPEC-103 §Mechanisms M3 — "pending = promises": task docs and ledger
    // knowledge sub_types are RECORDS/execution-workflow rows, not review-worthy
    // promises, so they're hidden from the default queue. `filters.all === true`
    // restores them.
    const visibleDocs =
      filters?.all === true ? invalidFiltered : invalidFiltered.filter((doc) => !isLedgerOrTaskDoc(doc));

    const pendingDocs: PendingDoc[] = visibleDocs.map((doc) =>
      toPendingDoc(
        doc,
        this.claimTtlMinutes !== undefined ? { claimTtlMinutes: this.claimTtlMinutes } : undefined,
      ),
    );

    return ok(pendingDocs);
  }

  /**
   * SPEC-103 §Mechanisms M2, §Design Decisions D3 — one-shot idempotent backfill:
   * fast-tracks every EXISTING draft ledger knowledge doc (assessment/retro/handoff/
   * uat) to `approved`, audited identically to `CorpusService._createImpl`'s
   * create-time fast-track (`details.auto = "ledger-fast-track"`, plus
   * `details.backfill = true` distinguishing this one-shot sweep from a fresh
   * create). Idempotent by construction: a doc already `approved` never matches the
   * `status: "draft"` query below, so a second run finds zero candidates and reports
   * zero changes (AC-TIER-8) — no separate "already backfilled" marker needed.
   *
   * Per-doc write failures are COLLECTED, not fatal (mirrors `lore review --pending`'s
   * batch idiom) — one doc's CAS conflict must not abort the whole sweep.
   *
   * @param opts.actor - Attributed as the audit entry's `actor` — defaults to the store write context's claimed
   *   name; a caller with neither is refused (VALIDATION_ERROR `actor`), never recorded as `"system"`.
   * @returns `{fast_tracked: string[], failed: Array<{slug, reason}>}` — slugs of
   *   every doc successfully fast-tracked, and any that failed to write.
   */
  async backfillLedger(
    opts?: { actor?: string },
  ): Promise<Result<{ fast_tracked: string[]; failed: Array<{ slug: string; reason: string }> }, LoreError>> {
    const draftsResult = await this.store.findMany({ status: "draft" });
    if (!draftsResult.ok) return draftsResult;

    const candidates = draftsResult.value.filter(
      (doc) => doc.type === "knowledge" && isLedgerKnowledgeSubType(doc.extra["sub_type"]),
    );

    const fastTracked: string[] = [];
    const failed: Array<{ slug: string; reason: string }> = [];

    for (const doc of candidates) {
      const writeResult = await this.writer.writeDoc({
        doc,
        patch: { status: "approved" },
        action: "update",
        auditAction: "update",
        auditDetails: { auto: "ledger-fast-track", backfill: true },
        auditSessionId: `review-${doc.id}`,
        lock: "none",
        ...(opts?.actor !== undefined ? { by: opts.actor } : {}),
      });
      if (writeResult.ok) {
        fastTracked.push(doc.slug);
      } else {
        failed.push({ slug: doc.slug, reason: writeResult.error.code });
      }
    }

    return ok({ fast_tracked: fastTracked, failed });
  }

  /**
   * Approve a document — transition status to 'approved'.
   * Creates a version snapshot and audit entry.
   *
   * @invariant For a `plan` doc, this is write-then-verify, not just gate-then-write
   *   (ASYNC2-002 TOCTOU hardening, BUG-011 precedent — see
   *   `task-workflow-service.ts`'s `claim()`/`rollbackClaim` for the sibling
   *   implementation this mirrors). `enforceApprovalGate`'s `plan-promote` branch
   *   reads the plan's ANCESTOR spec — a DIFFERENT row than the one this method's own
   *   CAS write protects — so a concurrent edit to that spec (e.g. an AC removal, or
   *   the spec being un-approved) landing in the gap between the pre-write gate check
   *   and the CAS commit is invisible to `expected_version: doc.version` (that guard
   *   only serializes writes to the PLAN row). After the CAS write commits, `approve`
   *   re-runs the IDENTICAL gate check against a FRESH ancestor-spec read; a failure
   *   now self-rolls-back the just-committed approval (`rollbackApproval`, itself
   *   CAS-guarded) and returns the SAME gate error a pre-write rejection would have —
   *   never leaves the plan "approved" against an invalidated prerequisite. A `spec`
   *   doc's own `spec-promote` gate does NOT need this: every field
   *   `enforceApprovalGate`'s spec branch reads (`extra.acceptance_criteria`,
   *   `extra.spec_kind`) lives on the SAME row this method's CAS write already
   *   protects — a genuine concurrent edit there already fails the CAS itself as
   *   `STALE_VERSION` (the `expected_version` won't match), so re-checking would be
   *   redundant, not a real gap. The residual window AFTER this post-write re-check
   *   returns clean (a third concurrent edit landing in the instant between this read
   *   and the caller observing success) is an ACCEPTED residual — closing it fully
   *   would need a corpus-level lock/daemon, out of scope (same accepted-residual
   *   shape `task-workflow-service.ts`'s `claim()` documents).
   * Source: SPEC-005 §3, §4, AC rows 2, 6.
   */
  async approve(
    id: string,
    opts?: ApproveOpts,
  ): Promise<Result<ApproveResult, LoreError>> {
    const findResult = await this.resolveDoc(id);
    if (!findResult.ok) return findResult;

    const doc = findResult.value;

    if (opts?.expectedVersion !== undefined && opts.expectedVersion !== doc.version) {
      return err({
        code: "STALE_VERSION",
        id: doc.id,
        expected: opts.expectedVersion,
        actual: doc.version,
        rule: "BR-1015",
      });
    }

    // reason: BR-1338 — a baseline node holding pending revisions is approved item by item, not by a status move: its
    // status is derived (approved iff nothing is pending), so there is no draft->approved transition to validate.
    const baselinePending = doc.type === "baseline" && pendingCountOf(doc.extra) > 0;
    if (!baselinePending && !isValidTransition(doc.status, "approved")) {
      return err({
        code: "INVALID_TRANSITION",
        from: doc.status,
        to: "approved",
        allowed: getAllowedTransitions(doc.status),
        rule: "BR-275",
      });
    }
    if (opts?.item !== undefined && !baselinePending) {
      return err({
        code: "VALIDATION_ERROR",
        field: "item",
        message:
          doc.type === "baseline"
            ? `${doc.slug} has nothing pending: --item ${opts.item} names no revision to approve`
            : `--item applies to a baseline node (BR-1338); ${doc.slug} is a ${doc.type}`,
        value: opts.item,
        rule: "BR-1338",
      });
    }

    // task-t3-hardening-reachable-override-escape-real-ai-provenance — the two override
    // flags are mutually exclusive input (never "one silently wins"): a caller naming both
    // is ambiguous about WHICH escape it means, so this is rejected loud before either
    // branch below runs.
    if (opts?.overrideJudgmentId !== undefined && opts?.overrideNoJudgment === true) {
      return err({
        code: "VALIDATION_ERROR",
        field: "override-judgment",
        message: "specify at most one of --override-judgment / --override-no-judgment, not both",
        value: { overrideJudgmentId: opts.overrideJudgmentId, overrideNoJudgment: opts.overrideNoJudgment },
        rule: "BR-284",
      });
    }

    // SPEC-103 §Mechanisms M2, §Design Decisions D3 — `--override-judgment`'s
    // audited escape: validates the given id resolves to an EXISTING
    // `review_judgments` row for THIS doc (any version — the blocking judgment may
    // be from an OLDER version than the doc's current one) before skipping the
    // `review-judgment` checkpoint. A non-resolving id is rejected loud, never
    // silently ignored (this repo's "no silent fallback" discipline).
    let overriddenJudgmentId: string | undefined;
    if (opts?.overrideJudgmentId !== undefined) {
      if (this.judgmentService === undefined) {
        return err({
          code: "VALIDATION_ERROR",
          field: "override-judgment",
          message: "--override-judgment requires judgment-service wiring, which this ReviewService instance lacks",
          value: opts.overrideJudgmentId,
        });
      }
      const allJudgmentsResult = await this.judgmentService.listFor(doc.id, "review");
      if (!allJudgmentsResult.ok) return allJudgmentsResult;
      const targetJudgment = allJudgmentsResult.value.find((j) => j.id === opts.overrideJudgmentId);
      if (targetJudgment === undefined) {
        return err({
          code: "VALIDATION_ERROR",
          field: "override-judgment",
          message: `judgment "${opts.overrideJudgmentId}" was not found for doc "${doc.slug}"`,
          value: opts.overrideJudgmentId,
          rule: "BR-284",
        });
      }
      overriddenJudgmentId = targetJudgment.id;
    }

    // task-t3-hardening-reachable-override-escape-real-ai-provenance — `--override-no-judgment`'s
    // audited escape: covers the denial `overrideJudgmentId` structurally cannot reach (see
    // `ApproveOpts.overrideNoJudgment`'s own JSDoc) — legal ONLY when `review_judgments` has
    // ZERO rows for this doc at ALL (any version). A doc with even one older-version judgment
    // has a real id to name and MUST use `overrideJudgmentId` instead — rejected loud here
    // rather than silently accepted, so the audit trail always names the MOST SPECIFIC escape
    // actually used.
    let overrodeNoJudgment = false;
    if (opts?.overrideNoJudgment === true) {
      if (this.judgmentService === undefined) {
        return err({
          code: "VALIDATION_ERROR",
          field: "override-no-judgment",
          message: "--override-no-judgment requires judgment-service wiring, which this ReviewService instance lacks",
          value: opts.overrideNoJudgment,
        });
      }
      const allJudgmentsResult = await this.judgmentService.listFor(doc.id, "review");
      if (!allJudgmentsResult.ok) return allJudgmentsResult;
      if (allJudgmentsResult.value.length > 0) {
        return err({
          code: "VALIDATION_ERROR",
          field: "override-no-judgment",
          message:
            `doc "${doc.slug}" already has ${allJudgmentsResult.value.length} judgment(s) recorded — ` +
            `name one of them via --override-judgment instead of --override-no-judgment`,
          value: allJudgmentsResult.value.length,
          rule: "BR-285",
        });
      }
      overrodeNoJudgment = true;
    }

    // reason: AC-AU-7 — an override the actor can set is DECIDED, not granted: class override-judgment through decide()
    // BEFORE the gate is skipped or anything is written. The subject version names the doc version AND which escape,
    // so a re-run of the same command finds the same pending decision (nothing was written by the refusal).
    if (overriddenJudgmentId !== undefined || overrodeNoJudgment) {
      const decided = await requireOverrideAuto(this.overrideDecisions, {
        classId: "override-judgment",
        subject: {
          id: doc.slug,
          version: `v${doc.version}:${overriddenJudgmentId !== undefined ? `judgment:${overriddenJudgmentId}` : "no-judgment"}`,
        },
        summary: `approve ${doc.slug} ${overriddenJudgmentId !== undefined ? `--override-judgment ${overriddenJudgmentId}` : "--override-no-judgment"}`,
        change: { document: doc.slug, ...(overriddenJudgmentId !== undefined ? { refused_judgment_id: overriddenJudgmentId } : { override: "no-judgment" }) },
      });
      if (!decided.ok) return decided;
    }

    // reason: BR-1338 — which pending revisions this approval promotes is decided BEFORE the gates, so they measure the
    // node as it will read (its declared commands, its judgment) and a refusal writes nothing.
    let baselinePlan: BaselinePromotionPlan | undefined;
    if (baselinePending) {
      const planned = await this.planBaselinePromotion(doc, opts?.item);
      if (!planned.ok) return planned;
      baselinePlan = planned.value;
    }

    const gateResult = await this.enforceApprovalGate(baselinePlan?.gateDoc ?? doc, {
      skipJudgmentGate: overriddenJudgmentId !== undefined || overrodeNoJudgment,
    });
    if (!gateResult.ok) return gateResult;
    // reason: spec-verify-reachability-plan-promote-early-warning §Scope M1 —
    // this is the PRE-write reading; the ASYNC2-002 post-write re-check below
    // (plan doc + gate wired) overwrites it with a FRESHER read against the
    // just-committed doc, since that IS the authoritative final state a caller
    // observes. Neither read ever influences whether this method returns ok/err.
    let reachabilityAdvisories = gateResult.value.reachabilityAdvisories;

    const resolvedReviewer = this.resolveReviewer(opts?.reviewer);
    if (!resolvedReviewer.ok) return resolvedReviewer;
    const reviewer = resolvedReviewer.value;

    if (baselinePlan !== undefined) {
      return this.writeBaselinePromotion(doc, baselinePlan, {
        reviewer,
        ...(overriddenJudgmentId !== undefined ? { overrideJudgmentId: overriddenJudgmentId } : {}),
        ...(overrodeNoJudgment ? { overrideNoJudgment: true } : {}),
      });
    }

    // reason: AC-DCS1-1, AC-DCS1-2, AC-DCS1-5 — the done contract of a task is compiled HERE: after the transition and override
    // checks, before the write, so a refusal (uncompilable contract, a waiver on a non-code task) writes nothing, and the contract
    // rides in the SAME write as the status change (one version, one audit row).
    const contractPatch = await this.compileContractFor(doc, opts?.redWaiverReason);
    if (!contractPatch.ok) return contractPatch;

    // reason: SPEC-103 D3 — `override_judgment_id` (present iff `--override-judgment` was used) rides on this SAME
    // audit row rather than a second entry — one audited event, "approved, and here's the escape hatch that let it
    // through." `override_no_judgment` (iff `--override-no-judgment`) rides on the SAME row for the SAME reason; the
    // two are mutually exclusive (validated above). The route adds the `version` join key (SPEC-035 §2).
    const approved = await this.writer.writeDoc({
      doc,
      patch: { status: "approved", ...contractPatch.value },
      action: "approve",
      auditAction: "approve",
      auditDetails: {
        reviewer,
        from_status: doc.status,
        to_status: "approved",
        ...(overriddenJudgmentId !== undefined ? { override_judgment_id: overriddenJudgmentId } : {}),
        ...(overrodeNoJudgment ? { override_no_judgment: true } : {}),
      },
      auditSessionId: `review-${doc.id}`,
      lock: "none",
      by: reviewer,
    });
    if (!approved.ok) return approved;
    const updatedDoc = approved.value.doc;

    // reason: ASYNC2-002 — plan-only post-write re-check, see the JSDoc @invariant
    // above. Only runs when a gate dependency is wired AND the just-approved doc is a
    // plan (enforceApprovalGate is a no-op for every other combination, but the
    // explicit `doc.type === "plan"` guard here keeps a spec approval's cost/behavior
    // byte-identical — zero extra store round trip, not merely a zero-op call).
    // `skipJudgmentGate` mirrors the pre-write call's own override state — an
    // override decision doesn't change between the pre- and post-write checks.
    if (this.gate !== undefined && doc.type === "plan") {
      // reason: the judgment was already enforced against the version being approved, above. This
      // re-check exists for the ancestor spec's prerequisites; running the judgment gate on
      // `updatedDoc` would measure the just-written version N+1, which no judgment can yet cover,
      // and so refuse EVERY judged plan (plans became judged by default, BR-281 / BR-1237).
      const postGateResult = await this.enforceApprovalGate(updatedDoc, { skipJudgmentGate: true });
      if (!postGateResult.ok) {
        const rollbackResult = await this.rollbackApproval(updatedDoc, doc.status, reviewer);
        if (!rollbackResult.ok) {
          return err({
            code: "VALIDATION_ERROR",
            field: "gate:plan-promote",
            message:
              `Plan "${updatedDoc.slug}" was approved but its ancestor spec's approval ` +
              `prerequisites failed a post-write re-check, AND automatic self-rollback ` +
              `failed (${rollbackResult.error.code}) — it was left APPROVED despite the ` +
              `invalidated prerequisite. Manually inspect/re-set its status.`,
            value: { conflict: postGateResult.error, rollback_error: rollbackResult.error },
            rule: "BR-287",
          });
        }
        return postGateResult;
      }
      reachabilityAdvisories = postGateResult.value.reachabilityAdvisories;
    }

    // reason: spec-verify-reachability-plan-promote-early-warning §Scope M1 —
    // `reachability_advisories` is OMITTED (never an empty array) when there is
    // nothing to warn about, so `"reachability_advisories" in result` doubles as
    // the "was there anything to warn about" check for a caller (see
    // `ApproveResult`'s own JSDoc).
    return ok({
      ...updatedDoc,
      ...(reachabilityAdvisories.length > 0 ? { reachability_advisories: reachabilityAdvisories } : {}),
    });
  }

  /**
   * The `extra` patch that stores a task's compiled done contract, or `{}` for a document that is not a task. A red waiver is
   * validated here for every document type: blank is refused, anything but a code task refuses `red-waiver-not-code`.
   */
  private async compileContractFor(doc: DocRecord, redWaiverReason: string | undefined): Promise<Result<{ extra?: Record<string, unknown> }, LoreError>> {
    if (redWaiverReason !== undefined && redWaiverReason.trim() === "") {
      return err({ code: "VALIDATION_ERROR", field: "red-waiver", message: "--red-waiver needs a non-blank reason: say why this code task has no red run to record.", value: redWaiverReason });
    }
    if (doc.type !== "task") {
      return redWaiverReason === undefined ? ok({}) : err(redWaiverNotCode(doc.slug, `a ${doc.type}, not a task`));
    }
    // reason: D43 — approve of a task always compiles or refuses; a missing port is a wiring fault, never an approval without a contract.
    if (this.doneContracts === undefined) {
      return err({
        code: "VALIDATION_ERROR",
        field: "done_contract",
        message: `done-contract-port-missing: this ReviewService has no done-contract port, so ${doc.slug} cannot be approved (a task is approved with its contract or not at all). The composition root must call setDoneContractPort.`,
        value: { refusal: "done-contract-port-missing" },
      });
    }
    const compiled = await this.doneContracts.compileForApprove(doc, redWaiverReason === undefined ? {} : { redWaiverReason });
    if (!compiled.ok) return compiled;
    return ok({ extra: { ...doc.extra, done_contract: compiled.value } });
  }

  // ─── Per-item approval of a baseline node (BR-1338) ─────────────────────────

  /**
   * The id `--item` names, as the pending list keys it: `node` (or the node's own slug / id) for the node's own part,
   * else a rule id.
   *
   * @returns the item key, or a VALIDATION_ERROR naming the accepted forms.
   */
  private normaliseItem(doc: DocRecord, item: string): Result<string, LoreError> {
    if (item === NODE_ITEM || item === doc.slug || item === doc.id) return ok(NODE_ITEM);
    if (ANY_RULE_ID_PATTERN.test(item)) return ok(item);
    return err({
      code: "VALIDATION_ERROR",
      field: "item",
      message: `--item must be a rule id (BR-<n>, AS-<n>, AD-<n>) or \`node\` for ${doc.slug}'s own part (got '${item}')`,
      value: item,
      rule: "BR-1338",
    });
  }

  /**
   * Decide which pending revisions of `doc` an approval promotes (BR-1338, BR-1369): every pending revision, or the one
   * `--item` names. A baseline node is never bound to a review judgment (BR-1369), so nothing is held back for "not seen".
   */
  private async planBaselinePromotion(
    doc: DocRecord,
    item: string | undefined,
  ): Promise<Result<BaselinePromotionPlan, LoreError>> {
    const pending = listPendingItems(doc.extra);
    let candidates: readonly PendingItem[] = pending;
    if (item !== undefined) {
      const wanted = this.normaliseItem(doc, item);
      if (!wanted.ok) return wanted;
      candidates = pending.filter((p) => p.item === wanted.value);
      if (candidates.length === 0) {
        return err({
          code: "VALIDATION_ERROR",
          field: "item",
          message: `${wanted.value} holds no pending revision on ${doc.slug} (pending: ${pending.map((p) => p.item).join(", ")})`,
          value: item,
          rule: "BR-1338",
        });
      }
    }

    const selected: PendingItem[] = candidates.slice();
    if (selected.length === 0) {
      return err({
        code: "VALIDATION_ERROR",
        field: "item",
        message: `${doc.slug} holds no pending revision to approve`,
        value: pending.map((p) => p.item),
        rule: "BR-1338",
      });
    }
    const promotion = promoteItems(doc, selected.map((s) => s.item));
    const gateDoc: DocRecord = {
      ...doc,
      extra: promotion.extra,
      ...(promotion.title !== undefined ? { title: promotion.title } : {}),
      ...(promotion.content !== undefined ? { content: promotion.content } : {}),
    };
    return ok({ selected, gateDoc });
  }

  /**
   * Write the promotion of `plan.selected`: the non-moving revisions in ONE approve write of the node, then each moved
   * rule through the store's move transaction (source leaf + destination leaf + registry together).
   */
  private async writeBaselinePromotion(
    doc: DocRecord,
    plan: BaselinePromotionPlan,
    ctx: { reviewer: string; overrideJudgmentId?: string; overrideNoJudgment?: true },
  ): Promise<Result<ApproveResult, LoreError>> {
    const moving = new Set(
      plan.selected.filter((s) => pendingRevisionsOf(doc).rules[s.item]?.move_to !== undefined).map((s) => s.item),
    );
    const staying = plan.selected.filter((s) => !moving.has(s.item));
    let current: DocRecord = doc;
    if (staying.length > 0) {
      const promotion = promoteItems(doc, staying.map((s) => s.item));
      const toStatus = statusFor(doc.status, promotion.extra);
      const written = await this.writer.writeDoc({
        doc,
        patch: {
          extra: promotion.extra,
          status: toStatus,
          ...(promotion.title !== undefined ? { title: promotion.title } : {}),
          ...(promotion.content !== undefined ? { content: promotion.content } : {}),
        },
        action: "approve",
        auditAction: "approve",
        changeSummary: `Approved ${staying.map((s) => s.item).join(", ")}`,
        auditDetails: {
          reviewer: ctx.reviewer,
          from_status: doc.status,
          to_status: toStatus,
          items: staying.map((s) => s.item),
          revisions: Object.fromEntries(staying.map((s) => [s.item, s.revisionId])),
          ...(ctx.overrideJudgmentId !== undefined ? { override_judgment_id: ctx.overrideJudgmentId } : {}),
          ...(ctx.overrideNoJudgment === true ? { override_no_judgment: true } : {}),
        },
        auditSessionId: `review-${doc.id}`,
        lock: "none",
        by: ctx.reviewer,
      });
      if (!written.ok) return written;
      current = written.value.doc;
    }
    for (const ruleId of moving) {
      const source = await this.store.find(doc.id);
      if (!source.ok) return source;
      if (source.value === null) return err({ code: "DOC_NOT_FOUND", id: doc.id });
      const revision = pendingRevisionsOf(source.value).rules[ruleId];
      if (revision?.move_to === undefined) continue;
      const dest = await this.store.find(revision.move_to as DocId);
      if (!dest.ok) return dest;
      if (dest.value === null) return err({ code: "DOC_NOT_FOUND", id: revision.move_to });
      const fromExtra = promoteRuleRevision(source.value.extra, ruleId);
      if (fromExtra === undefined) continue;
      const moved = await this.writer.moveRule({
        ruleId,
        from: { id: source.value.id, expectedVersion: source.value.version, extra: fromExtra, status: statusFor(source.value.status, fromExtra), change_summary: `Approved move of ${ruleId} to ${dest.value.slug}` },
        to: { id: dest.value.id, expectedVersion: dest.value.version, extra: appendApprovedRule(dest.value.extra, revision.rule), change_summary: `Approved move of ${ruleId} from ${source.value.slug}` },
        auditDetails: { rule_id: ruleId, from: source.value.id, to: dest.value.id, approved_by: ctx.reviewer, revision_id: revision.revision_id },
        by: ctx.reviewer,
      });
      if (!moved.ok) return moved;
      current = moved.value.from;
    }
    return ok({
      ...current,
      promoted_items: plan.selected.map((s) => s.item),
      still_pending: listPendingItems(current.extra).map((p) => p.item),
    });
  }

  /**
   * Discard one pending revision of a baseline node (`lore reject <node> --item <id>`): the item reads as its approved
   * version again (a pending add disappears). Items not named are untouched; the node's status is re-derived.
   *
   * @param item - `BR-n` / `AS-n` / `AD-n`, or `node` for the node's own part
   * @returns the node as written and the discarded revision; VALIDATION_ERROR when the item holds no pending revision
   *   or is a never-approved node's own part (there is nothing to fall back to).
   */
  async rejectItem(
    id: string,
    item: string,
    opts?: RejectOpts,
  ): Promise<Result<RejectItemOutcome, LoreError>> {
    const found = await this.resolveDoc(id);
    if (!found.ok) return found;
    const doc = found.value;
    if (doc.type !== "baseline") {
      return err({ code: "VALIDATION_ERROR", field: "item", message: `--item applies to a baseline node (BR-1338); ${doc.slug} is a ${doc.type}`, value: item, rule: "BR-1338" });
    }
    const wanted = this.normaliseItem(doc, item);
    if (!wanted.ok) return wanted;
    const target = listPendingItems(doc.extra).find((p) => p.item === wanted.value);
    if (target === undefined) {
      return err({ code: "VALIDATION_ERROR", field: "item", message: `${wanted.value} holds no pending revision on ${doc.slug}`, value: item, rule: "BR-1338" });
    }
    if (target.item === NODE_ITEM && pendingRevisionsOf(doc).node?.initial === true) {
      return err({
        code: "VALIDATION_ERROR",
        field: "item",
        message: `${doc.slug} was never approved: its own part has no approved version to return to. Approve it, or delete the node`,
        value: item,
        rule: "BR-1338",
      });
    }
    const resolvedReviewer = this.resolveReviewer(opts?.reviewer);
    if (!resolvedReviewer.ok) return resolvedReviewer;
    const extra = target.item === NODE_ITEM ? discardNodeRevision(doc.extra) : discardRuleRevision(doc.extra, target.item);
    const status = statusFor(doc.status, extra);
    const written = await this.writer.writeDoc({
      doc,
      patch: { extra, status },
      action: "reject",
      auditAction: "reject",
      changeSummary: `Discarded the pending revision of ${target.item}`,
      auditDetails: {
        reviewer: resolvedReviewer.value,
        item: target.item,
        revision_id: target.revisionId,
        from_status: doc.status,
        to_status: status,
        ...(opts?.reason !== undefined ? { reason: opts.reason } : {}),
      },
      auditSessionId: `review-${doc.id}`,
      lock: "none",
      by: resolvedReviewer.value,
    });
    if (!written.ok) return written;
    return ok({ doc: written.value.doc, discarded: target });
  }

  /**
   * ASYNC2-002 self-rollback — reverts a just-committed plan approval back to
   * `fromStatus` (the plan's status immediately before this `approve()` call), CAS-
   * guarded against the approval write's OWN version (`approved.version`): a THIRD
   * concurrent write landing in this narrow window fails loud (`STALE_VERSION`,
   * surfaced to the caller by `approve` above) rather than silently clobbering it.
   * Mirrors `TaskWorkflowService.rollbackClaim` (BUG-011). Writes a `"reject"`-family
   * version + audit entry — there is no dedicated "un-approve" `VersionAction`, and
   * `reject` is the closest existing semantic (status reverts to its pre-approval
   * value) that keeps `AuditService.verify`'s versions⋈audit walk satisfied.
   *
   * @param approved - The DocRecord as returned by this `approve()` call's own CAS
   *   write (i.e. already status "approved" at `approved.version`).
   * @param fromStatus - The plan's status before this `approve()` call ran.
   * @param reviewer - Same actor identity `approve()` resolved (`opts?.reviewer ??
   *   "system"`) — the rollback is an automatic consequence of that reviewer's own
   *   approve call, not a distinct actor.
   */
  private async rollbackApproval(
    approved: DocRecord,
    fromStatus: DocRecord["status"],
    reviewer: string,
  ): Promise<Result<DocRecord, LoreError>> {
    const rolledBack = await this.writer.writeDoc({
      doc: approved,
      patch: { status: fromStatus },
      action: "reject",
      changeSummary:
        "Self-rollback: ancestor spec's approval prerequisites failed a post-write " +
        "re-check (ASYNC2-002 TOCTOU guard)",
      auditAction: "reject",
      auditDetails: { reviewer, from_status: "approved", to_status: fromStatus, rollback: true },
      auditSessionId: `review-${approved.id}`,
      lock: "none",
      by: reviewer,
    });
    if (!rolledBack.ok) return rolledBack;
    return ok(rolledBack.value.doc);
  }

  /**
   * Reject a document — status stays 'draft', reason recorded in audit.
   * Source: SPEC-005 §3, §4, AC rows 4, table row "draft|reject|draft".
   * Only docs in 'draft' or 'in-review' can be rejected.
   */
  async reject(
    id: string,
    opts?: RejectOpts,
  ): Promise<Result<DocRecord, LoreError>> {
    const outcome = await this.rejectWithOutcome(id, opts);
    if (!outcome.ok) return outcome;
    return ok(outcome.value.doc);
  }

  /**
   * {@link reject} plus the status the doc held BEFORE the call, so a caller can state the transition that
   * happened (`in-review -> draft`) or that none did (`draft` stays `draft`) instead of guessing from the result.
   *
   * @returns The rejected doc and `from_status`, or the same errors as {@link reject}.
   */
  async rejectWithOutcome(
    id: string,
    opts?: RejectOpts,
  ): Promise<Result<{ doc: DocRecord; from_status: DocRecord["status"] }, LoreError>> {
    const findResult = await this.resolveDoc(id);
    if (!findResult.ok) return findResult;

    const doc = findResult.value;

    // Only 'draft' and 'in-review' can be rejected (they can transition back to draft)
    const canReject =
      doc.status === "draft" || doc.status === "in-review";

    if (!canReject) {
      return err({
        code: "INVALID_TRANSITION",
        from: doc.status,
        to: "draft",
        allowed: getAllowedTransitions(doc.status),
        rule: "BR-292",
      });
    }

    const resolvedReviewer = this.resolveReviewer(opts?.reviewer);
    if (!resolvedReviewer.ok) return resolvedReviewer;
    const reviewer = resolvedReviewer.value;
    const reason = opts?.reason;

    const auditDetails: Record<string, unknown> = {
      reviewer,
      from_status: doc.status,
      to_status: "draft",
    };
    if (reason !== undefined) {
      auditDetails["reason"] = reason;
    }

    // reason: a reject of a doc that is ALREADY draft changes no field, so the write route would (rightly) write
    // nothing — yet the rejection and its reason are the event, so that case records the audit row alone (the
    // `version` key is the doc's unchanged version, parity with the other writers, not an oracle join).
    if (doc.status === "draft") {
      const recorded = await this.writer.appendAudit({
        by: reviewer,
        sessionId: `review-${doc.id}`,
        action: "reject",
        docId: doc.id,
        details: { ...auditDetails, version: doc.version },
      });
      if (!recorded.ok) return recorded;
      return ok({ doc, from_status: doc.status });
    }

    // reason: a reject is NOT a new version — the doc keeps its version so a judgment recorded against it stays fresh
    // (the dashboard's calibration capture matches the judgment's doc_version to the doc's); `versioning: "keep"`.
    const rejected = await this.writer.writeDoc({
      doc,
      patch: { status: "draft" },
      versioning: "keep",
      action: "reject",
      auditAction: "reject",
      auditDetails,
      auditSessionId: `review-${doc.id}`,
      lock: "none",
      by: reviewer,
    });
    if (!rejected.ok) return rejected;
    return ok({ doc: rejected.value.doc, from_status: doc.status });
  }

  /**
   * Reopen an approved spec that has no evidence: `approved -> draft`, the ONE sanctioned exit from the
   * record-edit lock (spec D5, BR-1050). The edge is {@link isReopenTransition}, never `VALID_TRANSITIONS`,
   * so `lore set --status draft` on an approved spec stays refused.
   *
   * Evidence is counted through the same plan-member + ad-hoc-governed task query `AcService` uses for
   * coverage (`findSpecEvidenceTasks`), BEFORE the write and AGAIN after it (BR-1054): evidence that appears
   * in between leaves the spec in draft (never written back to approved) and errs naming it.
   *
   * @param id - Spec id, prefix or slug.
   * @param reason - Required, non-blank; recorded in the audit row's `details.reason` and the version's change_summary.
   * @param opts - Reviewer identity and the test seam.
   * @returns The draft spec, or `VALIDATION_ERROR` (non-spec / blank reason / evidence exists),
   *   `INVALID_TRANSITION` (spec not approved), or a store error.
   * @example
   * await reviewService.reopen("spec-x", "scope changed before any work started");
   */
  async reopen(
    id: string,
    reason: string,
    opts?: ReopenOpts,
  ): Promise<Result<DocRecord, LoreError>> {
    const findResult = await this.resolveDoc(id);
    if (!findResult.ok) return findResult;
    const doc = findResult.value;

    if (doc.type !== "spec") {
      return err({
        code: "VALIDATION_ERROR",
        field: "type",
        message: `Only a spec can be reopened; ${doc.slug} is a ${doc.type}`,
        value: doc.type,
        rule: "BR-1184",
      });
    }
    const trimmedReason = reason.trim();
    if (trimmedReason === "") {
      return err({
        code: "VALIDATION_ERROR",
        field: "reason",
        message: `Reopening ${doc.slug} requires a non-empty --reason`,
        value: reason,
        rule: "BR-1185",
      });
    }
    if (!isReopenTransition(doc.type, doc.status, "draft")) {
      return err({
        code: "INVALID_TRANSITION",
        from: doc.status,
        to: "draft",
        allowed: getAllowedTransitions(doc.status),
        rule: "BR-1186",
      });
    }

    const lock = await this.recordLock.resolve(doc);
    if (!lock.ok) return lock;
    if (lock.value.standing !== "record" || !lock.value.locked) {
      return err({
        code: "VALIDATION_ERROR",
        field: "status",
        message: `${doc.slug} is not a locked record, so there is nothing to reopen - edit it directly`,
        value: doc.status,
        rule: "BR-1187",
      });
    }

    const before = await this.countSpecEvidence(doc);
    if (!before.ok) return before;
    /** @lore-site BR-1050 */
    if (before.value > 0) return err(this.reopenRefusal(doc, before.value, false));

    const resolvedReviewer = this.resolveReviewer(opts?.reviewer);
    if (!resolvedReviewer.ok) return resolvedReviewer;
    const reviewer = resolvedReviewer.value;
    // reason: `details.operation` is the structural reopen marker RecordLockService reads (a BR-722 demotion has
    // none); the version row's action stays "update" so the row sits inside the versions-row audit family.
    const reopenedResult = await this.writer.writeDoc({
      doc,
      patch: { status: "draft" },
      action: "update",
      changeSummary: `Reopened to draft: ${trimmedReason}`,
      auditAction: REOPEN_AUDIT_ACTION,
      auditDetails: {
        operation: REOPEN_OPERATION,
        reviewer,
        reason: trimmedReason,
        from_status: "approved",
        to_status: "draft",
      },
      auditSessionId: `review-${doc.id}`,
      lock: "none",
      by: reviewer,
    });
    if (!reopenedResult.ok) return reopenedResult;
    const reopened = reopenedResult.value.doc;

    if (opts?.afterStatusWrite !== undefined) await opts.afterStatusWrite();

    const after = await this.countSpecEvidence(doc);
    if (!after.ok) return after;
    // BR-1054: the spec stays draft - approved is never written back.
    /** @lore-site BR-1054 */
    if (after.value > 0) return err(this.reopenRefusal(doc, after.value, true));

    return ok(reopened);
  }

  /**
   * Evidence rows recorded against `spec`'s CRITERIA (BR-1050), through the shared AC-coverage task query.
   * A row with no `ac_ref` (e.g. a captured research doc) names no criterion and is not counted (#461).
   */
  private async countSpecEvidence(spec: DocRecord): Promise<Result<number, LoreError>> {
    const tasks = await findSpecEvidenceTasks(this.store, spec);
    if (!tasks.ok) return tasks;
    const criteriaEvidence = tasks.value.tasks.reduce(
      (sum, task) => sum + extractEvidence(task).filter((row) => (row.ac_ref ?? "").trim() !== "").length,
      0,
    );
    return ok(criteriaEvidence);
  }

  private reopenRefusal(spec: DocRecord, count: number, raced: boolean): LoreError {
    const noun = count === 1 ? "row" : "rows";
    const tail = raced
      ? `${count} criteria evidence ${noun} appeared while it was being reopened, so it stays in draft (it is not written back to approved). Review the evidence, then approve it again or supersede it with a new spec.`
      : `${count} criteria evidence ${noun} already ${count === 1 ? "exists" : "exist"} against it. A spec with criteria evidence cannot be reopened - supersede it with a new spec instead.`;
    return {
      code: "VALIDATION_ERROR",
      field: "gate:reopen",
      message: `Cannot reopen ${spec.slug}: ${tail}`,
      value: count,
    };
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Default time seam for `pending()`'s SPEC-043 D3 invalidated-doc filter —
 * mirrors `corpus-service.ts`'s identical `defaultNow` (independent copies,
 * both trivial one-liners; not worth a cross-service import for this).
 */
const defaultNow = (): string => new Date().toISOString();

/**
 * Coerces a raw `extra.spec_kind` value to a valid {@link SpecKind}, falling
 * back to `"feature"` (SPEC-058 D2) — the SAME default `CorpusService.
 * _createImpl` applies at spec-creation time when the field is absent, never a
 * second, independently-invented default. A malformed value (wrong type, or a
 * string outside {@link SPEC_KINDS}) is treated identically to absent — this
 * helper never throws or returns an error; it's a read-side coercion for gate
 * ctx-building only, not a validator (write-time validation already happened
 * in `CorpusService._createImpl`/`set`).
 */
function resolveSpecKindOrDefault(raw: unknown): SpecKind {
  return typeof raw === "string" && (SPEC_KINDS as readonly string[]).includes(raw)
    ? (raw as SpecKind)
    : "feature";
}

/**
 * SPEC-103 §Mechanisms M2 I1 — whether two judge identities are the SAME
 * provider/model/prompt_version tuple (a "self-review" collision: the judgment was
 * authored by the identical AI configuration that generated the doc's own content).
 * Plain field-by-field equality — `JudgeIdentity` (`@lore/core`) has no nested
 * structure requiring a deep-equal library.
 */
function judgeIdentitiesEqual(a: JudgeIdentity, b: JudgeIdentity): boolean {
  return a.provider === b.provider && a.model === b.model && a.prompt_version === b.prompt_version;
}

/**
 * SPEC-103 §Mechanisms M3 — "pending = promises": `true` for a `task`-type doc, or a
 * `knowledge` doc whose `extra.sub_type` is a ledger sub_type (assessment/retro/
 * handoff/uat, `isLedgerKnowledgeSubType`) — the two categories `pending()`'s default
 * queue hides (both are records of workflow execution, not review-worthy promises).
 */
function isLedgerOrTaskDoc(doc: DocRecord): boolean {
  return doc.type === "task" || (doc.type === "knowledge" && isLedgerKnowledgeSubType(doc.extra["sub_type"]));
}

/**
 * `enforceApprovalGate`'s private return shape — the `plan-promote` reachability
 * advisory lines (spec-verify-reachability-plan-promote-early-warning §Scope M1)
 * computed ALONGSIDE
 * the gate verdict, never folded into it. Not exported — an implementation
 * detail of how `approve()` threads advisories from `enforceApprovalGate`'s
 * pre-write AND post-write (ASYNC2-002) calls out to its own `ApproveResult`
 * return value.
 */
interface ApprovalGateOutcome {
  readonly reachabilityAdvisories: string[];
}

// reason: `countScriptModeAcceptanceCriteria` RELOCATED to `checkpoint-
// registry.ts` (spec-plan-closure-must-be-loud-terminality-divergence-silent
// §Design Decisions DD-4(a)) — `CorpusService.set`'s plan-close branch needs
// the SAME derivation for `GateContext.parentSpecScriptAcCount` and
// `CorpusService` may never import from `ReviewService` (this module's own
// "no cross-service imports" invariant, see `service/CLAUDE.md`). Moved
// beside its sibling `buildUpstreamSpecContext` — a non-service gate-
// infrastructure module both `CorpusService` and `ReviewService` already
// import from — rather than duplicated (SSOT: one script-mode-AC counter for
// the whole codebase). Imported below, not redefined.

/**
 * Projects a full DocRecord to the {@link PendingDoc} row shape, wrapping
 * `deriveTypeMeta` (`@lore/core`) for the `meta` field — mirrors
 * `CorpusService.toSummary`'s DocSummary projection (SPEC-036 §2 D3).
 *
 * @param opts - `{ claimTtlMinutes? }` forwarded verbatim to `deriveTypeMeta`;
 *   `undefined` when this service wasn't constructed with a TTL, in which case
 *   `deriveTypeMeta` omits `task.claim_stale` rather than fabricating a value.
 */
function toPendingDoc(doc: DocRecord, opts?: { claimTtlMinutes?: number }): PendingDoc {
  const meta = deriveTypeMeta(doc, opts);
  const validity = extractValidity(doc);
  return {
    id: doc.id,
    slug: doc.slug,
    type: doc.type,
    title: doc.title,
    status: doc.status === "in-review" ? "in-review" : "draft",
    created_by: doc.created_by,
    updated_at: doc.updated_at,
    version: doc.version,
    ...(meta !== undefined ? { meta } : {}),
    ...(validity !== undefined ? { validity } : {}),
  };
}
