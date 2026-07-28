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

/**
 * Read-only aggregation surface for `lore trace stats` (SPEC-102) — see this
 * module's own header for the full "store-only, no writes" invariant.
 */
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
 * Reverse index of {@link CHECKPOINT_SUCCESS_ACTIONS}: audit `action` ->
 * the checkpoint(s) it counts as a "retry success" for. Built ONCE at
 * module load (the source table is a small fixed constant, never
 * per-`stats()`-call) — see {@link buildMaxRetrySuccessTimestamps}'s header
 * for why this is what makes the O(n+m) shape possible (SPEC-102 hardening
 * T4 item 3).
 */
const ACTION_TO_CHECKPOINTS: ReadonlyMap<string, readonly string[]> = (() => {
  const index = new Map<string, string[]>();
  for (const [checkpoint, actions] of Object.entries(CHECKPOINT_SUCCESS_ACTIONS)) {
    for (const action of actions) {
      const bucket = index.get(action) ?? [];
      bucket.push(checkpoint);
      index.set(action, bucket);
    }
  }
  return index;
})();

/**
 * Join key for the `(checkpoint, actor)` -> max-success-timestamp map.
 * Double-colon separated (matches this codebase's other composite-key
 * conventions) — checkpoint names are a small fixed set of kebab-case
 * identifiers (`GateCheckpoint`) and never contain `::`, so no
 * checkpoint/actor pair can collide across the boundary.
 */
function retryKey(checkpoint: string, actor: string): string {
  return `${checkpoint}::${actor}`;
}

/**
 * One pass over `auditEntries` (O(m), m = audit rows in the `--since`
 * window): for every entry whose `action` is a "success" action for one or
 * more checkpoints (via {@link ACTION_TO_CHECKPOINTS}), tracks the MAX
 * `timestamp` seen per `(checkpoint, actor)` pair.
 *
 * This is what lets {@link computeDenyRetryGap} answer "was this deny
 * retried successfully" — "does ANY qualifying audit entry have
 * `timestamp > deny.ts`" — with a single map lookup + comparison instead of
 * an `auditEntries.some(...)` scan per deny: the pre-fix shape was
 * `denies.length * auditEntries.length` (the CLI's `--since` defaults to the
 * Unix epoch, so `auditEntries.length` grows with the corpus's ENTIRE audit
 * history on every `lore trace stats` invocation). Since ISO-8601 timestamps
 * sort lexicographically (D1), "max > deny.ts" is exactly equivalent to "at
 * least one entry exceeds deny.ts" — if the max exceeds it, that entry
 * itself witnesses the predicate; if the max doesn't, no entry can.
 */
function buildMaxRetrySuccessTimestamps(auditEntries: readonly AuditEntry[]): Map<string, string> {
  const maxByKey = new Map<string, string>();
  for (const entry of auditEntries) {
    const checkpoints = ACTION_TO_CHECKPOINTS.get(entry.action);
    if (checkpoints === undefined) continue;
    for (const checkpoint of checkpoints) {
      const key = retryKey(checkpoint, entry.actor);
      const current = maxByKey.get(key);
      if (current === undefined || entry.timestamp > current) {
        maxByKey.set(key, entry.timestamp);
      }
    }
  }
  return maxByKey;
}

/**
 * Pure computation over already-fetched denies/audit rows — see this
 * module's class-level `@invariant` for the "computed, never stored"
 * rationale. Exported (only) so
 * `tests/unit/service/trace-stats-service.test.ts` can assert this O(n+m)
 * shape's output is IDENTICAL, deny-for-deny, to the pre-refactor
 * `auditEntries.some(...)`-per-deny scan (SPEC-102 hardening T4 item 3 —
 * proven by equality, not by inspection).
 */
export function computeDenyRetryGap(
  denies: readonly TraceGateDenyEvent[],
  auditEntries: readonly AuditEntry[],
): TraceDenyRetryGap[] {
  const maxRetrySuccessTimestamps = buildMaxRetrySuccessTimestamps(auditEntries);
  const byCheckpoint = new Map<string, { denies: number; retried: number }>();

  for (const deny of denies) {
    const bucket = byCheckpoint.get(deny.checkpoint) ?? { denies: 0, retried: 0 };
    bucket.denies += 1;

    const maxTimestamp = maxRetrySuccessTimestamps.get(retryKey(deny.checkpoint, deny.actor));
    const hasRetry = maxTimestamp !== undefined && maxTimestamp > deny.ts;
    if (hasRetry) bucket.retried += 1;

    byCheckpoint.set(deny.checkpoint, bucket);
  }

  return [...byCheckpoint.entries()].map(([checkpoint, bucket]) => ({
    checkpoint,
    denies: bucket.denies,
    retried_success: bucket.retried,
  }));
}
