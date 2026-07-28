/**
 * TraceStatsService — read-only aggregation surface for `lore trace stats`
 * (SPEC-102). Stateless, store-only, reads ONLY (mirrors `AuditService`'s
 * "no telemetry, no writes" shape) — composes several `StoreInterface`
 * trace-count queries plus a read-side join against the `audit` table into
 * ONE stats report. NEVER calls `CorpusService.get`/`search` or any other
 * instrumented method — this is what makes AC-TRACE-6 ("running `lore trace
 * stats` twice yields identical row counts") true BY CONSTRUCTION: a stats
 * read only ever issues `SELECT`/aggregate queries against `trace_events`/
 * `docs`/`audit`, never an `INSERT`.
 *
 * @invariant `deny_retry_gap` (SPEC-102 §Access Patterns "deny→retry-success
 *   gap") is COMPUTED here, at read time, from `listTraceGateDenies` +
 *   `queryAudit` — never persisted as its own column/table (the "readiness is
 *   computed" ethos this codebase already applies to `lore ready`'s
 *   sessions/anchor_conflicts). The checkpoint→"success action" mapping is
 *   BEST-EFFORT (not every checkpoint's producing service stamps one single
 *   well-known audit action) — see `CHECKPOINT_SUCCESS_ACTIONS`'s own comment.
 *
 * @see SPEC-102 §Access Patterns & Indexes, §Acceptance Criteria AC-TRACE-4/6
 */

import { ok, type AuditEntry, type LoreError, type Result } from "@lore/core";
import type {
  StoreInterface,
  TraceDenyByCheckpoint,
  TraceGateDenyEvent,
  TraceRawSearchQuery,
} from "../store/store-interface.js";

/**
 * Best-effort checkpoint → "success" audit action(s) mapping (SPEC-102
 * §Access Patterns "deny→retry-success gap"). Not authoritative — a
 * checkpoint whose gate blocked a write is considered "retried successfully"
 * if the SAME actor later appears in the audit trail (within the same
 * `--since` window) performing one of these actions. Unmapped checkpoints
 * (a future addition to `GateCheckpoint` not yet listed here) always report
 * `retried_success: 0` rather than throwing — this is an ADVISORY metric,
 * not a gate.
 */
const CHECKPOINT_SUCCESS_ACTIONS: Readonly<Record<string, readonly string[]>> = {
  "spec-create": ["create"],
  "spec-promote": ["approve"],
  "plan-promote": ["approve"],
  "task-claim": ["claim"],
  "phase-claim": ["claim"],
  "plan-close": ["approve", "archive"],
};

/** One checkpoint's deny→retry-success gap (SPEC-102 §Access Patterns). */
export interface TraceDenyRetryGap {
  checkpoint: string;
  /** Total `gate_deny` events for this checkpoint in the window. */
  denies: number;
  /** How many of those denies were followed by a same-actor audit success (best-effort). */
  retried_success: number;
}

/** The full `lore trace stats` report (SPEC-102 §Acceptance Criteria AC-TRACE-4). */
export interface TraceStatsReport {
  since: string;
  counts_by_kind: Record<string, number>;
  deny_by_checkpoint: TraceDenyByCheckpoint[];
  zero_hit_search_count: number;
  never_read_docs_count: number;
  deny_retry_gap: TraceDenyRetryGap[];
  /** Present ONLY when `opts.includeRawQueries` was true (SPEC-102 §Security & Privacy). */
  raw_search_queries?: TraceRawSearchQuery[];
}

/** Input to {@link TraceStatsService.stats}. */
export interface TraceStatsOpts {
  /** ISO 8601 — every aggregate is scoped to rows at/after this timestamp. */
  since: string;
  /** `true` includes raw `details.query` text — ONLY behind `lore trace stats --raw-queries`. */
  includeRawQueries?: boolean;
}

export class TraceStatsService {
  constructor(private readonly store: StoreInterface) {}

  async stats(opts: TraceStatsOpts): Promise<Result<TraceStatsReport, LoreError>> {
    const window = { since: opts.since };

    const [countsResult, denyResult, zeroHitResult, neverReadResult, gateDeniesResult, auditResult] =
      await Promise.all([
        this.store.countTraceEventsByKind(window),
        this.store.countTraceDenyByCheckpoint(window),
        this.store.countTraceZeroHitSearches(window),
        this.store.countNeverReadDocs(window),
        this.store.listTraceGateDenies(window),
        this.store.queryAudit({ since: opts.since }),
      ]);

    if (!countsResult.ok) return countsResult;
    if (!denyResult.ok) return denyResult;
    if (!zeroHitResult.ok) return zeroHitResult;
    if (!neverReadResult.ok) return neverReadResult;
    if (!gateDeniesResult.ok) return gateDeniesResult;
    if (!auditResult.ok) return auditResult;

    const report: TraceStatsReport = {
      since: opts.since,
      counts_by_kind: countsResult.value,
      deny_by_checkpoint: denyResult.value,
      zero_hit_search_count: zeroHitResult.value,
      never_read_docs_count: neverReadResult.value,
      deny_retry_gap: computeDenyRetryGap(gateDeniesResult.value, auditResult.value),
    };

    if (opts.includeRawQueries === true) {
      const rawResult = await this.store.listTraceRawSearchQueries(window);
      if (!rawResult.ok) return rawResult;
      report.raw_search_queries = rawResult.value;
    }

    return ok(report);
  }
}

/**
 * Pure computation over already-fetched denies/audit rows — see this
 * module's class-level `@invariant` for the "computed, never stored"
 * rationale.
 */
function computeDenyRetryGap(
  denies: readonly TraceGateDenyEvent[],
  auditEntries: readonly AuditEntry[],
): TraceDenyRetryGap[] {
  const byCheckpoint = new Map<string, { denies: number; retried: number }>();

  for (const deny of denies) {
    const bucket = byCheckpoint.get(deny.checkpoint) ?? { denies: 0, retried: 0 };
    bucket.denies += 1;

    const successActions = CHECKPOINT_SUCCESS_ACTIONS[deny.checkpoint] ?? [];
    const hasRetry = auditEntries.some(
      (entry) =>
        entry.actor === deny.actor &&
        entry.timestamp > deny.ts &&
        successActions.includes(entry.action),
    );
    if (hasRetry) bucket.retried += 1;

    byCheckpoint.set(deny.checkpoint, bucket);
  }

  return [...byCheckpoint.entries()].map(([checkpoint, bucket]) => ({
    checkpoint,
    denies: bucket.denies,
    retried_success: bucket.retried,
  }));
}
