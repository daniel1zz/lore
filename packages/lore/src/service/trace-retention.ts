/**
 * Trace retention pruning (SPEC-102 §Migration Strategy "retention prune") —
 * the opportunistic, bounded-batch DELETE loop run once at CLI startup.
 *
 * Public surface:
 *   pruneTraceEventsOpportunistically(prune, retentionDays, nowIso?) — fires
 *   `prune`'s single-batch `DELETE ... LIMIT 50000` repeatedly until it
 *   returns 0 (nothing left to prune) or a safety iteration cap is hit.
 *
 * @invariant NEVER throws — a failing `prune` call (`Result.err` OR a
 *   rejected promise) stops the loop silently. This function is always
 *   invoked fire-and-forget (never awaited by its caller, `app.ts`'s
 *   `pruneTraceEventsOpportunistically` port) — a startup prune failure must
 *   never delay or fail the CLI command that triggered it.
 * @invariant Bounded by `MAX_ITERATIONS` — a defensive backstop only
 *   (`MAX_ITERATIONS * batchSize` = 50M rows), never expected to bind in
 *   practice: steady-state usage (prune runs on every CLI invocation) keeps
 *   the table's age distribution bounded well below this ceiling.
 *
 * @see SPEC-102 §Migration Strategy, §Design Decisions
 */

import type { LoreError, Result } from "@lore/core";

/** One bounded prune batch — the SAME `StoreInterface.pruneTraceEvents` shape. */
export type PruneTraceEventsBatch = (
  cutoffIso: string,
  batchSize?: number,
) => Promise<Result<number, LoreError>>;

/** Safety backstop on the number of batches this loop will run in one call — see module header. */
const MAX_ITERATIONS = 1000;

/**
 * Runs `prune` repeatedly (each call a single bounded `LIMIT`-ed batch)
 * until it reports 0 rows deleted (nothing left older than the cutoff) or a
 * failure — never throws, never awaited by its own caller.
 *
 * @param prune - A single-batch prune port (`store.pruneTraceEvents.bind(store)`
 *   in production, or the local Turso-mode replica handle's equivalent).
 * @param retentionDays - `trace.retention_days` (resolved config value) —
 *   rows with `ts < now - retentionDays` are eligible.
 * @param nowIso - Time seam for tests; defaults to `new Date().toISOString()`.
 */
export async function pruneTraceEventsOpportunistically(
  prune: PruneTraceEventsBatch,
  retentionDays: number,
  nowIso: string = new Date().toISOString(),
): Promise<void> {
  const cutoffMs = new Date(nowIso).getTime() - retentionDays * 24 * 60 * 60 * 1000;
  const cutoffIso = new Date(cutoffMs).toISOString();

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    let result: Result<number, LoreError>;
    try {
      result = await prune(cutoffIso);
    } catch {
      // reason: a misbehaving injected port must never propagate out of this
      // opportunistic, fire-and-forget loop (mirrors TraceRecorder's own
      // swallow-and-continue contract).
      return;
    }
    if (!result.ok || result.value === 0) return;
  }
}
