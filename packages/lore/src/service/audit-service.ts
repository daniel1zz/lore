/**
 * AuditService — read/verify surface over the already-LIVE `audit` table
 * (SPEC-035 §2, §5). Zero audit-storage schema changes: this service only adds a
 * query pass-through and a completeness oracle on top of `StoreInterface.queryAudit`
 * / `listAllVersions`, both of which predate this spec.
 *
 * Public surface:
 *   query(filters)        → thin delegation to store.queryAudit
 *   verify(opts?)          → versions⋈audit completeness oracle (D5, D9)
 *
 * @invariant Stateless — holds only a StoreInterface. No telemetry (audit reads are
 *   a CLI-invoked oracle, not a hot instrumented path — mirrors VersionService, which
 *   is also un-instrumented).
 * @invariant verify()'s join key is `(doc_id, version)` — NOT a literal string-equality
 *   match on `audit.action === versions.action`. Every EXISTING writer (CorpusService,
 *   ReviewService, VersionService) already writes an audit action equal to its
 *   versions-row action by construction (both inserted in the same method), so this
 *   is a no-op distinction for them. TaskWorkflowService writes versions rows with
 *   action "update" (its shared `writeTaskExtra` helper) but audit entries with the
 *   more specific actions "claim"/"release"/"evidence" (SPEC-035 §2) — matching on
 *   version alone is what makes those entries satisfy the oracle despite the label
 *   mismatch. D9's "exact join" refers to replacing timestamp-tolerance fuzzy
 *   matching with an exact version number — not to requiring the audit action string
 *   to replicate the versions-row action string.
 * @invariant verify() only considers versions rows whose `action` is one of
 *   create/update/approve/reject/restore (VERIFIABLE_VERSION_ACTIONS) — `delete`
 *   is excluded (SPEC-035 §2 lists it out of the anchor set) even though
 *   CorpusService.delete also stamps `details.version` on its audit entry.
 * @invariant The `since` watermark bounds BOTH sides of the join (versions rows via
 *   `listAllVersions(since)`, audit rows via `queryAudit({since})`) — pre-watermark
 *   holes (pre-SPEC-035 TaskWorkflow silence, v1-migration imports) are never
 *   reported as misses (D5).
 *
 * Side-effect class: IO (reads via StoreInterface only — never writes)
 *
 * Source: SPEC-035 §2, §5
 */

import { ok, type LoreError, type Result } from "@lore/core";
import type { DocId, VersionAction } from "@lore/core";
import type { AuditFilters, StoreInterface } from "../store/store-interface.js";
import type { AuditEntry } from "@lore/core";

// ─── Public Types ────────────────────────────────────────────────────────────

/**
 * Versions-row actions the completeness oracle reconciles against audit entries
 * (SPEC-035 §2). `delete` is deliberately excluded from this set — see
 * {@link AuditService.verify}'s JSDoc @invariant.
 */
const VERIFIABLE_VERSION_ACTIONS: ReadonlySet<VersionAction> = new Set([
  "create",
  "update",
  "approve",
  "reject",
  "restore",
]);

/** One versions row with no matching audit entry — itemized in {@link AuditVerifyResult}. */
export interface AuditMiss {
  doc_id: DocId;
  version: number;
  action: VersionAction;
  created_at: string;
}

/** Result of {@link AuditService.verify}. */
export interface AuditVerifyResult {
  clean: boolean;
  misses: AuditMiss[];
  /** The watermark this verify pass was bounded by — surfaced for CLI/MCP display. */
  since: string;
}

/** Options for {@link AuditService.verify}. */
export interface VerifyOpts {
  /**
   * ISO 8601 watermark override — versions rows older than this are excluded from
   * the reconcile walk (D5). Optional: defaults to the constructor-resolved
   * {@link AuditService.verifySince} when omitted, mirroring how `TaskWorkflowService`
   * exposes `claimTtlMinutes` as a public readonly resolved-at-construction value
   * while still allowing per-call overrides (e.g. `--since` on `lore audit --verify`).
   */
  since?: string;
}

// ─── AuditService ────────────────────────────────────────────────────────────

export class AuditService {
  /**
   * Public (not just internal) so CLI/MCP callers can display the effective
   * watermark without re-resolving config — same shape as
   * `TaskWorkflowService.claimTtlMinutes`.
   */
  readonly verifySince: string;

  /**
   * @param store - Storage abstraction (same instance passed to every other service)
   * @param config - `{ verifySince }` — see `resolveAuditVerifySince` in @lore/core
   *   (composition-root resolved, mirroring `TaskWorkflowService`'s `claimTtlMinutes`)
   */
  constructor(
    private readonly store: StoreInterface,
    config: { verifySince: string },
  ) {
    this.verifySince = config.verifySince;
  }

  /**
   * Thin delegation to `store.queryAudit(filters)` — the query half of the audit
   * read surface (`lore audit --actor ... --action ... --since ...`, SPEC-035 §2).
   *
   * @param filters - See {@link AuditFilters} — doc_id/actor/action/since/limit
   * @returns Result<AuditEntry[], LoreError> — newest-first (store contract)
   */
  async query(filters: AuditFilters): Promise<Result<AuditEntry[], LoreError>> {
    return this.store.queryAudit(filters);
  }

  /**
   * Completeness oracle: for every `versions` row whose action is in
   * {@link VERIFIABLE_VERSION_ACTIONS} and whose `created_at >= opts.since`, demand
   * at least one audit entry sharing `(doc_id, details.version)`. Order-independent
   * — the join key is a version number, never a timestamp window (D9).
   *
   * @param opts - `{ since? }` — override watermark; defaults to `this.verifySince`
   * @returns Result<AuditVerifyResult, LoreError> — `clean: true` iff `misses` is empty
   *
   * @example
   * const result = await auditService.verify();
   * if (result.ok && !result.value.clean) {
   *   for (const miss of result.value.misses) console.error(miss);
   * }
   */
  async verify(opts?: VerifyOpts): Promise<Result<AuditVerifyResult, LoreError>> {
    const since = opts?.since ?? this.verifySince;

    const versionsResult = await this.store.listAllVersions(since);
    if (!versionsResult.ok) return versionsResult;

    const candidates = versionsResult.value.filter(
      (v) => VERIFIABLE_VERSION_ACTIONS.has(v.action) && v.created_at >= since,
    );

    if (candidates.length === 0) {
      return ok({ clean: true, misses: [], since });
    }

    const auditResult = await this.store.queryAudit({ since });
    if (!auditResult.ok) return auditResult;

    // reason: build the (doc_id, version) match set once — O(audit) — rather than
    // querying per-versions-row (O(versions * audit)). See @invariant above re: the
    // join key being version-only, not action-equality.
    const matchedPairs = new Set<string>();
    for (const entry of auditResult.value) {
      if (entry.doc_id === undefined) continue;
      const detailVersion = entry.details?.["version"];
      if (typeof detailVersion === "number") {
        matchedPairs.add(`${entry.doc_id}::${detailVersion}`);
      }
    }

    const misses: AuditMiss[] = [];
    for (const v of candidates) {
      if (!matchedPairs.has(`${v.doc_id}::${v.version}`)) {
        misses.push({ doc_id: v.doc_id, version: v.version, action: v.action, created_at: v.created_at });
      }
    }

    return ok({ clean: misses.length === 0, misses, since });
  }
}
