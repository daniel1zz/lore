/**
 * lore trace stats [--since <iso>] [--json] [--raw-queries]
 *
 * Read-only aggregation surface over SPEC-102's `trace_events` table —
 * turns the "is Lore's core mechanisms (gates/feed/search) actually working"
 * debate into data instead of recollection. Delegates ALL computation to
 * `TraceStatsService` (`../../../service/trace-stats-service.js`) — this
 * command is a thin arg-parse + render layer, same shape as `commands/audit.ts`.
 *
 * `--since` defaults to the Unix epoch (effectively "all time") when omitted
 * — SPEC-102 names no pinned default watermark the way `audit.verify_since`
 * has one, so an unbounded-by-default window is the least-surprising choice
 * for a first-run `lore trace stats` with no flags.
 *
 * `--raw-queries` includes literal `details.query` search text — LOCAL-ONLY,
 * OFF by default (SPEC-102 §Security & Privacy: aggregates only unless
 * explicitly requested).
 *
 * Running this command emits ZERO trace rows itself (AC-TRACE-6) —
 * `TraceStatsService` only issues `SELECT`/aggregate queries, never routes
 * through `CorpusService.get`/`search` or any other instrumented method.
 *
 * Exit codes: 0 = success, non-zero via `exitCode()` on a store error.
 *
 * Source: SPEC-102 §Acceptance Criteria AC-TRACE-4/5/6.
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, formatTable } from "../utils.js";

/** Default `--since` when omitted — effectively "all time" (SPEC-102 names no pinned watermark). */
const EPOCH_ISO = "1970-01-01T00:00:00.000Z";

export default defineCommand({
  meta: {
    name: "trace",
    description: "Read/deny observability over the trace_events table (SPEC-102)",
  },
  subCommands: {
    stats: defineCommand({
      meta: {
        name: "stats",
        description:
          "Aggregate counts-by-kind, deny-by-checkpoint, zero-hit searches, and never-read docs",
      },
      args: {
        since: {
          type: "string",
          description: "ISO 8601 — only rows at/after this timestamp (default: all time)",
        },
        json: {
          type: "boolean",
          description: "Output as JSON",
        },
        "raw-queries": {
          type: "boolean",
          description: "Include raw search query text (local-only, off by default)",
        },
      },
      async run({ args }) {
        const { app } = loadLoreApp();
        try {
          if (app.traceStatsService === undefined) {
            // reason: createApp ALWAYS wires this in production — an absent
            // service here means a hand-built App test/eval stub reached this
            // command, not a real corpus. Fail loud rather than crash on
            // `undefined.stats(...)`.
            process.stderr.write("Error: trace stats unavailable (traceStatsService not wired)\n");
            process.exitCode = 1;
            return;
          }

          // reason: citty's inferred `args.since` type is broader than plain
          // `string | undefined` for this arg shape — narrow explicitly
          // rather than relying on `??` alone (mirrors the defensive
          // narrowing several sibling commands already apply to citty args).
          const since = typeof args.since === "string" ? args.since : EPOCH_ISO;
          const result = await app.traceStatsService.stats({
            since,
            includeRawQueries: args["raw-queries"] === true,
          });

          if (!result.ok) {
            process.stderr.write(formatError(result.error) + "\n");
            process.exitCode = exitCode(result.error);
            return;
          }

          const report = result.value;

          if (args.json) {
            console.log(JSON.stringify({ ok: true, data: report }, null, 2));
            process.exitCode = 0;
            return;
          }

          console.log(`Trace stats since ${report.since}:`);

          console.log("\nCounts by kind:");
          const kindRows = Object.entries(report.counts_by_kind).map(([kind, count]) => [kind, String(count)]);
          console.log(kindRows.length > 0 ? formatTable(["Kind", "Count"], kindRows) : "  (none)");

          console.log("\nDeny by checkpoint:");
          const denyRows = report.deny_by_checkpoint.map((d) => [d.checkpoint, d.layer, String(d.count)]);
          console.log(denyRows.length > 0 ? formatTable(["Checkpoint", "Layer", "Count"], denyRows) : "  (none)");

          console.log(`\nZero-hit searches: ${report.zero_hit_search_count}`);
          console.log(`Never-read docs: ${report.never_read_docs_count}`);

          if (report.deny_retry_gap.length > 0) {
            console.log("\nDeny -> retry-success gap (best-effort, computed read-side vs audit):");
            const gapRows = report.deny_retry_gap.map((g) => [
              g.checkpoint,
              String(g.denies),
              String(g.retried_success),
            ]);
            console.log(formatTable(["Checkpoint", "Denies", "Retried OK"], gapRows));
          }

          if (report.raw_search_queries !== undefined) {
            console.log("\nRaw search queries (--raw-queries):");
            const rawRows = report.raw_search_queries.map((q) => [q.ts, q.actor, q.query]);
            console.log(rawRows.length > 0 ? formatTable(["Timestamp", "Actor", "Query"], rawRows) : "  (none)");
          }

          process.exitCode = 0;
        } finally {
          app.close();
        }
      },
    }),
  },
});
