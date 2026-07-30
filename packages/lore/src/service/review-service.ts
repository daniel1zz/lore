/**
 * ReviewService — human-in-the-loop review workflow for documents.
 * Manages pending review queue, approval, and rejection of draft documents.
 * Source: SPEC-005 §3, SPEC-001 §3.2
 */

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
import { err, ok, type LoreError, type Result } from "@lore/core";
import {
  getAllowedTransitions,
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
import { resolveDoc } from "./resolve.js";
import {
  buildUpstreamSpecContext,
  countScriptModeAcceptanceCriteria,
  type GateContext,
} from "./checkpoint-registry.js";
import { resolvePrdSyncDomainDoc } from "./prd-sync-domain-doc.js";
import type { GateDependencies } from "./gate-enforcer.js";
import type { JudgmentService } from "./judgment-service.js";

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
  status: "draft";
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
   * queue rather than sitting there forever — `draft` has no `->archived`
   * lifecycle exit, so filtering is the only way this queue self-cleans.
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
 * @invariant `prd_sync_advisories` (spec-plan-close-predicates-measure-
 *   invariants-an-applicability, task T1 item 9) mirrors
 *   `reachability_advisories`'s EXACT invariant shape on a SEPARATE key — never
 *   changes the outcome, populated ONLY for a just-approved `plan` doc whose
 *   `prd_sync` gate is enabled AND whose ancestor spec resolves no domain doc
 *   at all, omitted (never `[]`) otherwise. `reachability_advisories` keeps
 *   carrying ONLY the verify-reachability class — this field never widens it.
 */
export interface ApproveResult extends DocRecord {
  reachability_advisories?: string[];
  prd_sync_advisories?: string[];
}

export interface RejectOpts {
  /** Reviewer identity — defaults to "system" if omitted */
  reviewer?: string;
  /** Reason for rejection — stored in audit entry */
  reason?: string;
}

// ─── ReviewService ─────────────────────────────────────────────────────────

/**
 * ReviewService — stateless service, all state in StoreInterface.
 * All methods return Result<T, LoreError> — never throw.
 */
export class ReviewService {
  /**
   * @param store - Storage abstraction (SQLiteStore, TursoStore, or InMemoryStore)
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
   *   (`resolveJudgmentRequiredTypes`, `@lore/core`, default `["spec","adr"]`) — which
   *   `DocType`s the `review-judgment` checkpoint applies to. Absent/`undefined`
   *   (every bare unit-test construction) → treated as `[]` (no type gated), same
   *   "absent in bare tests, present in production" DI shape as every other optional
   *   constructor dependency on this class.
   */
  constructor(
    private readonly store: StoreInterface,
    private readonly claimTtlMinutes?: number,
    private readonly gate?: GateDependencies,
    private readonly judgmentService?: JudgmentService,
    private readonly judgmentRequiredTypes?: readonly string[],
  ) {}

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
   *   `ok`/`err` (D1). ALSO returns `prdSyncAdvisories` (spec-plan-close-
   *   predicates-measure-invariants-an-applicability, task T1 item 9), the SAME
   *   shape on a separate field — `[]` except for a `plan` doc whose `prd_sync`
   *   gate is enabled and whose ancestor spec resolves no domain doc.
   */
  private async enforceApprovalGate(
    doc: DocRecord,
    opts?: { skipJudgmentGate?: boolean },
  ): Promise<Result<ApprovalGateOutcome, LoreError>> {
    if (this.gate === undefined) {
      return ok({ reachabilityAdvisories: [], prdSyncAdvisories: [] });
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
      });
      if (!enforceResult.ok) return enforceResult;
      // reason: M1's early-warning advisory is a `plan-promote`-only signal
      // (spec-verify-reachability-plan-promote-early-warning §Scope) — a spec
      // approval has no plan-close attestation floor of its own to warn about.
      // The prd-sync domain-doc advisory is likewise `plan-promote`-only
      // (task T1 item 9) — a spec has no ancestor of its own to resolve one from.
      return ok({ reachabilityAdvisories: [], prdSyncAdvisories: [] });
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
        return ok({ reachabilityAdvisories: [], prdSyncAdvisories: [] });
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
      // reason: spec-plan-close-predicates-measure-invariants-an-applicability,
      // task T1 item 9 — `prdSyncDomainDocResolved` is the EARLY-WARNING
      // counterpart of `plan-close`'s own domain-doc resolution (`CorpusService
      // .set`'s `resolvePrdSyncDomainDoc` call). Resolved HERE, paying the extra
      // store IO ONLY when `prd_sync` is enabled AND an ancestor spec exists —
      // mirrors `CorpusService.set`'s own "opt-out ⇒ no extra IO" cost
      // philosophy for this same default-OFF knob.
      const prdSyncEnabled = this.gate.enforcer.isPrdSyncEnabled();
      let prdSyncDomainDocResolved: boolean | undefined;
      if (prdSyncEnabled && parentSpec !== undefined) {
        const domainDocResult = await resolvePrdSyncDomainDoc(this.store, parentSpec);
        if (!domainDocResult.ok) return domainDocResult;
        prdSyncDomainDocResolved = domainDocResult.value !== null;
      }
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
        prdSyncEnabled,
        ...(prdSyncDomainDocResolved !== undefined ? { prdSyncDomainDocResolved } : {}),
      };
      const enforceResult = this.gate.enforcer.enforce("plan-promote", planPromoteCtx);
      if (!enforceResult.ok) return enforceResult;
      return ok({
        reachabilityAdvisories: [...this.gate.enforcer.planPromoteReachabilityAdvisories(planPromoteCtx)],
        prdSyncAdvisories: [...this.gate.enforcer.planPromotePrdSyncAdvisories(planPromoteCtx)],
      });
    }

    return ok({ reachabilityAdvisories: [], prdSyncAdvisories: [] });
  }

  /**
   * SPEC-103 §Mechanisms M2 — the `review-judgment` checkpoint's IO-performing half:
   * reads `review_judgments` for `doc`, partitions them into "collided with `doc.extra
   * .ai_provenance`" (I1) vs. "independent", and dispatches to `GateEnforcer.enforce
   * ("review-judgment", ctx)` — the PURE decision (worst-decision-wins, D3) lives
   * entirely in `checkReviewJudgment` (`checkpoint-registry.ts`).
   *
   * A no-op (`ok(undefined)`) when: this service has no `gate`/`judgmentService`
   * wired (bare test construction, byte-identical to pre-SPEC-103 behavior), OR
   * `doc.type` is not in `judgmentRequiredTypes` (M2's own per-type kill switch —
   * an empty `judgmentRequiredTypes` disables this for EVERY type, AC-TIER-7).
   *
   * @param doc - The doc `approve()` is about to transition to "approved" — read at
   *   its CURRENT (pre-write) version, the version judgments are matched against.
   */
  private async enforceJudgmentRequiredGate(doc: DocRecord): Promise<Result<void, LoreError>> {
    if (this.gate === undefined || this.judgmentService === undefined) {
      return ok(undefined);
    }
    const requiredTypes = this.judgmentRequiredTypes ?? [];
    if (!requiredTypes.includes(doc.type)) {
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
    const independentDecisions: ReviewDecision[] = [];
    for (const judgment of currentVersionJudgments) {
      if (aiProvenance !== undefined && judgeIdentitiesEqual(judgment.judge, aiProvenance)) {
        provenanceCollision = true;
        continue;
      }
      independentDecisions.push(judgment.decision);
    }

    const ctx: GateContext = {
      targetIdOrSlug: doc.slug,
      reviewJudgmentDecisions: independentDecisions,
      reviewJudgmentProvenanceCollision: provenanceCollision,
    };
    return this.gate.enforcer.enforce("review-judgment", ctx);
  }

  /**
   * Return all documents with status='draft' matching optional filters.
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
    const storeFilters: import("../store/store-interface.js").StoreFilters = {
      status: "draft",
      ...(filters?.author !== undefined ? { created_by: filters.author } : {}),
      ...(filters?.type !== undefined ? { type: filters.type } : {}),
      ...(filters?.since !== undefined ? { since: filters.since } : {}),
    };

    const result = await this.store.findMany(storeFilters);
    if (!result.ok) return result;

    // SPEC-043 D3 — `pending` is a review-QUEUE list-surface, the same read-surface
    // class `CorpusService.list`/`search` already filter: an invalidated draft (e.g.
    // a duplicate superseded by its canonical version) has no lifecycle exit (no
    // draft->archived transition exists) and would otherwise sit in this queue
    // forever. Excluded by default; `include_invalid` restores it, badged by the
    // CLI (`formatValidityBadge`, `lore list --include-invalid`'s own renderer).
    // `isInvalidated` is a structural no-op for any doc type ValidityService never
    // writes `extra.validity` on — this filter naturally scopes itself.
    const nowIso = now();
    const invalidFiltered =
      filters?.include_invalid === true
        ? result.value
        : result.value.filter((doc) => !isInvalidated(doc, nowIso));

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
   * @param opts.actor - Attributed as the audit entry's `actor` — defaults to
   *   `"system"` (same default `approve()`'s `reviewer` uses when the caller omits it).
   * @returns `{fast_tracked: string[], failed: Array<{slug, reason}>}` — slugs of
   *   every doc successfully fast-tracked, and any that failed to write.
   */
  async backfillLedger(
    opts?: { actor?: string },
  ): Promise<Result<{ fast_tracked: string[]; failed: Array<{ slug: string; reason: string }> }, LoreError>> {
    const actor = opts?.actor ?? "system";
    const draftsResult = await this.store.findMany({ status: "draft" });
    if (!draftsResult.ok) return draftsResult;

    const candidates = draftsResult.value.filter(
      (doc) => doc.type === "knowledge" && isLedgerKnowledgeSubType(doc.extra["sub_type"]),
    );

    const fastTracked: string[] = [];
    const failed: Array<{ slug: string; reason: string }> = [];

    for (const doc of candidates) {
      const now = new Date().toISOString();
      const newVersion = doc.version + 1;
      const versionRecord: VersionRecord = {
        doc_id: doc.id,
        version: newVersion,
        content: doc.content,
        extra: doc.extra,
        status: "approved",
        title: doc.title,
        action: "update",
        created_at: now,
        created_by: actor,
        slug: doc.slug,
      };
      const auditEntry: AuditEntry = {
        timestamp: now,
        actor,
        session_id: `review-${doc.id}`,
        action: "update",
        doc_id: doc.id,
        details: { auto: "ledger-fast-track", version: newVersion, backfill: true },
      };
      const writeResult = await this.store.updateWithProvenance(
        doc.id,
        { status: "approved", version: newVersion, updated_at: now },
        { expected_version: doc.version },
        versionRecord,
        auditEntry,
      );
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

    if (!isValidTransition(doc.status, "approved")) {
      return err({
        code: "INVALID_TRANSITION",
        from: doc.status,
        to: "approved",
        allowed: getAllowedTransitions(doc.status),
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
        });
      }
      overrodeNoJudgment = true;
    }

    const gateResult = await this.enforceApprovalGate(doc, {
      skipJudgmentGate: overriddenJudgmentId !== undefined || overrodeNoJudgment,
    });
    if (!gateResult.ok) return gateResult;
    // reason: spec-verify-reachability-plan-promote-early-warning §Scope M1 —
    // this is the PRE-write reading; the ASYNC2-002 post-write re-check below
    // (plan doc + gate wired) overwrites it with a FRESHER read against the
    // just-committed doc, since that IS the authoritative final state a caller
    // observes. Neither read ever influences whether this method returns ok/err.
    let reachabilityAdvisories = gateResult.value.reachabilityAdvisories;
    // reason: spec-plan-close-predicates-measure-invariants-an-applicability,
    // task T1 item 9 — mirrors `reachabilityAdvisories`'s identical pre/post-write
    // threading shape one line up, on its own field.
    let prdSyncAdvisories = gateResult.value.prdSyncAdvisories;

    const reviewer = opts?.reviewer ?? "system";
    const now = new Date().toISOString();
    const nextVersion = doc.version + 1;

    const updateResult = await this.store.update(doc.id, {
      status: "approved",
      version: nextVersion,
      updated_at: now,
    }, { expected_version: doc.version });
    if (!updateResult.ok) return updateResult;

    const updatedDoc = updateResult.value;

    const versionResult = await this.store.insertVersion({
      doc_id: doc.id,
      version: nextVersion,
      content: updatedDoc.content,
      extra: updatedDoc.extra,
      status: "approved",
      title: updatedDoc.title,
      action: "approve",
      created_at: now,
      created_by: reviewer,
      // SPEC-072 D2/D1 — same "state as of this version" convention as
      // content/extra/status/title above; `approve` never changes slug, so
      // this is simply the doc's current (unchanged) slug.
      slug: updatedDoc.slug,
    });
    if (!versionResult.ok) return versionResult;

    const auditResult = await this.store.appendAuditEntry({
      timestamp: now,
      actor: reviewer,
      session_id: `review-${doc.id}`,
      action: "approve",
      doc_id: doc.id,
      // reason: SPEC-035 §2 — join key for AuditService.verify's versions⋈audit walk.
      // SPEC-103 D3 — `override_judgment_id` (present iff `--override-judgment` was
      // used) rides on this SAME audit row rather than a second entry — one audited
      // event, "approved, and here's the escape hatch that let it through."
      // task-t3-hardening-reachable-override-escape-real-ai-provenance — `override_no_judgment`
      // (present iff `--override-no-judgment` was used) rides on the SAME row for the SAME
      // reason; the two are mutually exclusive (validated above), so at most one is ever present.
      details: {
        reviewer,
        from_status: doc.status,
        to_status: "approved",
        version: nextVersion,
        ...(overriddenJudgmentId !== undefined ? { override_judgment_id: overriddenJudgmentId } : {}),
        ...(overrodeNoJudgment ? { override_no_judgment: true } : {}),
      },
    });
    if (!auditResult.ok) return auditResult;

    // reason: ASYNC2-002 — plan-only post-write re-check, see the JSDoc @invariant
    // above. Only runs when a gate dependency is wired AND the just-approved doc is a
    // plan (enforceApprovalGate is a no-op for every other combination, but the
    // explicit `doc.type === "plan"` guard here keeps a spec approval's cost/behavior
    // byte-identical — zero extra store round trip, not merely a zero-op call).
    // `skipJudgmentGate` mirrors the pre-write call's own override state — an
    // override decision doesn't change between the pre- and post-write checks.
    if (this.gate !== undefined && doc.type === "plan") {
      const postGateResult = await this.enforceApprovalGate(updatedDoc, {
        skipJudgmentGate: overriddenJudgmentId !== undefined || overrodeNoJudgment,
      });
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
          });
        }
        return postGateResult;
      }
      reachabilityAdvisories = postGateResult.value.reachabilityAdvisories;
      prdSyncAdvisories = postGateResult.value.prdSyncAdvisories;
    }

    // reason: spec-verify-reachability-plan-promote-early-warning §Scope M1 —
    // `reachability_advisories` is OMITTED (never an empty array) when there is
    // nothing to warn about, so `"reachability_advisories" in result` doubles as
    // the "was there anything to warn about" check for a caller (see
    // `ApproveResult`'s own JSDoc). `prd_sync_advisories` (task T1 item 9)
    // mirrors that OMIT-when-empty shape on its own, separate key.
    return ok({
      ...updatedDoc,
      ...(reachabilityAdvisories.length > 0 ? { reachability_advisories: reachabilityAdvisories } : {}),
      ...(prdSyncAdvisories.length > 0 ? { prd_sync_advisories: prdSyncAdvisories } : {}),
    });
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
    const now = new Date().toISOString();
    const rollbackVersion = approved.version + 1;

    const updateResult = await this.store.update(approved.id, {
      status: fromStatus,
      version: rollbackVersion,
      updated_at: now,
    }, { expected_version: approved.version });
    if (!updateResult.ok) return updateResult;

    const updatedDoc = updateResult.value;

    const versionResult = await this.store.insertVersion({
      doc_id: approved.id,
      version: rollbackVersion,
      content: updatedDoc.content,
      extra: updatedDoc.extra,
      status: fromStatus,
      title: updatedDoc.title,
      action: "reject",
      created_at: now,
      created_by: reviewer,
      // SPEC-072 D1/D2 — rollback never changes slug; carry the current value.
      slug: updatedDoc.slug,
      change_summary:
        "Self-rollback: ancestor spec's approval prerequisites failed a post-write " +
        "re-check (ASYNC2-002 TOCTOU guard)",
    });
    if (!versionResult.ok) return versionResult;

    const auditResult = await this.store.appendAuditEntry({
      timestamp: now,
      actor: reviewer,
      session_id: `review-${approved.id}`,
      action: "reject",
      doc_id: approved.id,
      details: {
        reviewer,
        from_status: "approved",
        to_status: fromStatus,
        version: rollbackVersion,
        rollback: true,
      },
    });
    if (!auditResult.ok) return auditResult;

    return ok(updatedDoc);
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
      });
    }

    const reviewer = opts?.reviewer ?? "system";
    const reason = opts?.reason;
    const now = new Date().toISOString();

    // Status stays 'draft' — just update updated_at
    const updateResult = await this.store.update(doc.id, {
      status: "draft",
      updated_at: now,
    }, { expected_version: doc.version });
    if (!updateResult.ok) return updateResult;

    const updatedDoc = updateResult.value;

    const auditDetails: Record<string, unknown> = {
      reviewer,
      from_status: doc.status,
      to_status: "draft",
    };
    if (reason !== undefined) {
      auditDetails["reason"] = reason;
    }
    // reason: SPEC-035 §2 — additive for writer-coverage consistency. reject() never
    // calls insertVersion (status stays 'draft', no version bump) so no versions row
    // with action "reject" exists for AuditService.verify to require this against —
    // this is purely for parity/future-proofing, not oracle-load-bearing.
    auditDetails["version"] = doc.version;

    const auditResult = await this.store.appendAuditEntry({
      timestamp: now,
      actor: reviewer,
      session_id: `review-${doc.id}`,
      action: "reject",
      doc_id: doc.id,
      details: auditDetails,
    });
    if (!auditResult.ok) return auditResult;

    return ok(updatedDoc);
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
 * PLUS the prd-sync domain-doc advisory lines (spec-plan-close-predicates-
 * measure-invariants-an-applicability, task T1 item 9), both computed ALONGSIDE
 * the gate verdict, never folded into it. Not exported — an implementation
 * detail of how `approve()` threads advisories from `enforceApprovalGate`'s
 * pre-write AND post-write (ASYNC2-002) calls out to its own `ApproveResult`
 * return value.
 */
interface ApprovalGateOutcome {
  readonly reachabilityAdvisories: string[];
  readonly prdSyncAdvisories: string[];
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
    status: "draft",
    created_by: doc.created_by,
    updated_at: doc.updated_at,
    version: doc.version,
    ...(meta !== undefined ? { meta } : {}),
    ...(validity !== undefined ? { validity } : {}),
  };
}
