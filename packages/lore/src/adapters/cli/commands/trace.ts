/**
 * lore trace stats [--since <iso>] [--json] [--raw-queries] [--enumerate <field>]
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
 * `--enumerate <field>` prints the MEMBER LIST behind any `*_count` field the
 * plain run reports, mirroring `lore status --enumerate`'s contract exactly
 * (AC-FR-5): one registry ({@link TRACE_COUNT_FIELD_ENUMERATORS}), the count
 * printed alongside its members so a reader can see they agree, and an
 * unregistered field name refused BY NAME (VALIDATION_ERROR → exit 4) instead
 * of silently returning nothing. Composes with `--since` and `--raw-queries`.
 * ⛔ `counts_by_kind`/`deny_by_checkpoint` are deliberately NOT registered —
 * they already ship their member breakdown as the field's own value.
 *
 * Why this exists: an all-time run on a consumer corpus reported
 * `Never-read docs: 168` against 276 live docs with no way to obtain the 168
 * ids. Archiving, rewriting, and "this one was SUPPOSED to be read" are all
 * undecidable from the number alone, so the number supported no action at all.
 * Source: spec-a-write-side-fact-with-no-read-side-address-counts-with-no
 * §Measured-not-inferred G1, §Scope M1 (AC-RR-1/2/3).
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
import type { LoreError, Result } from "@lore/core";
import type {
  TraceStatsCountField,
  TraceStatsEnumeration,
  TraceStatsOpts,
  TraceStatsService,
} from "../../../service/trace-stats-service.js";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, formatTable } from "../utils.js";

/** Default `--since` when omitted — effectively "all time" (SPEC-102 names no pinned watermark). */
const EPOCH_ISO = "1970-01-01T00:00:00.000Z";

/**
 * SSOT registry mapping every `*_count` field `lore trace stats --json` reports
 * to the SERVICE call that ENUMERATES its members. Mirrors
 * `commands/status.ts`'s `COUNT_FIELD_ENUMERATORS` deliberately — one
 * `--enumerate` contract for the whole CLI, never a second shape.
 *
 * ⛔ Typed `Record<TraceStatsCountField, …>`, so adding a `*_count` field to
 * `TraceStatsReport` without an entry here FAILS TO COMPILE — the "a new count
 * with no registered enumerator" gap is closed statically here and, for an
 * unknown name a user types, dynamically by {@link findCountFieldEnumerator}'s
 * caller below.
 *
 * ⛔ Every entry delegates to `TraceStatsService`; no enumeration logic lives in
 * this adapter (module invariant: commands resolve args → call a service →
 * render → map error to exit code).
 */
const TRACE_COUNT_FIELD_ENUMERATORS: Record<
  TraceStatsCountField,
  (service: TraceStatsService, opts: TraceStatsOpts) => Promise<Result<TraceStatsEnumeration, LoreError>>
> = {
  never_read_docs_count: (service, opts) => service.enumerateNeverReadDocs(opts),
  zero_hit_search_count: (service, opts) => service.enumerateZeroHitSearches(opts),
};

/**
 * Looks up one registered enumerator by the raw (untrusted) field name a caller
 * typed.
 *
 * @param field - Arbitrary user input, NOT yet known to be a registered field.
 * @returns The enumerator, or `undefined` when nothing is registered under that
 *   name — the caller turns that into a named VALIDATION_ERROR refusal.
 */
function findCountFieldEnumerator(
  field: string,
): ((service: TraceStatsService, opts: TraceStatsOpts) => Promise<Result<TraceStatsEnumeration, LoreError>>) | undefined {
  // reason: `Object.hasOwn` guard first — indexing a Record keyed by a union
  // with an arbitrary string is only sound after membership is established
  // (noUncheckedIndexedAccess does not apply to a closed-key Record).
  return Object.hasOwn(TRACE_COUNT_FIELD_ENUMERATORS, field)
    ? TRACE_COUNT_FIELD_ENUMERATORS[field as TraceStatsCountField]
    : undefined;
}

/**
 * One member's human-render line for `--enumerate` (the `--json` surface emits
 * the member objects verbatim instead).
 *
 * Exhaustive over {@link TraceStatsEnumeration}'s variants with a `never` check,
 * so a newly registered count field cannot ship without its own render.
 *
 * @param enumeration - The service-produced member list for ONE count field.
 * @returns One display line per member, in the store's declared order.
 */
function formatEnumerationMembers(enumeration: TraceStatsEnumeration): string[] {
  switch (enumeration.field) {
    case "never_read_docs_count":
      return enumeration.members.map((doc) => `${doc.slug} (${doc.id})`);
    case "zero_hit_search_count":
      // reason: `query` is ABSENT (not empty) unless --raw-queries was passed —
      // rendering it conditionally is what keeps the privacy boundary intact on
      // the human surface too (AC-RR-3 asserts both surfaces).
      return enumeration.members.map((row) =>
        row.query === undefined ? `${row.ts}  ${row.actor}` : `${row.ts}  ${row.actor}  ${row.query}`,
      );
    default: {
      // reason: repo convention (`utils.ts::exitCode`) — the `never` binding
      // makes a newly registered count field a COMPILE error right here, and the
      // runtime fallback NAMES the gap rather than returning `[]`, which would
      // render as "this count legitimately has no members".
      const _exhaustive: never = enumeration;
      void _exhaustive;
      return ["(no member renderer registered for this count field — members withheld)"];
    }
  }
}

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
        enumerate: {
          type: "string",
          description:
            "Enumerate the MEMBERS behind a *_count field the plain run reports (never_read_docs_count, zero_hit_search_count). Composes with --since/--raw-queries. Unknown field → exit 4, naming it and the known set.",
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
          const statsOpts: TraceStatsOpts = {
            since,
            includeRawQueries: args["raw-queries"] === true,
          };

          // reason: M1 — dispatched BEFORE the aggregate report is built:
          // enumeration is a standalone member-list query over the SAME window,
          // never composed with the report render (mirrors
          // `commands/status.ts`'s `--enumerate` branch placement).
          if (typeof args.enumerate === "string") {
            const enumerator = findCountFieldEnumerator(args.enumerate);
            if (enumerator === undefined) {
              const knownFields = Object.keys(TRACE_COUNT_FIELD_ENUMERATORS).sort().join(", ");
              const error: LoreError = {
                code: "VALIDATION_ERROR",
                field: "enumerate",
                message: `no enumerator registered for count field "${args.enumerate}" — known fields: ${knownFields}`,
                value: args.enumerate,
              };
              process.stderr.write(formatError(error) + "\n");
              process.exitCode = exitCode(error);
              return;
            }

            const enumerationResult = await enumerator(app.traceStatsService, statsOpts);
            if (!enumerationResult.ok) {
              process.stderr.write(formatError(enumerationResult.error) + "\n");
              process.exitCode = exitCode(enumerationResult.error);
              return;
            }

            const enumeration = enumerationResult.value;
            if (args.json) {
              console.log(
                JSON.stringify(
                  {
                    ok: true,
                    data: {
                      field: enumeration.field,
                      count: enumeration.count,
                      members: enumeration.members,
                    },
                  },
                  null,
                  2,
                ),
              );
            } else {
              // The count prints alongside its members so a reader can see the
              // two agree — they are the same list, read once.
              console.log(`${enumeration.field}: ${enumeration.count} member(s)`);
              for (const line of formatEnumerationMembers(enumeration)) console.log(`  - ${line}`);
            }
            process.exitCode = 0;
            return;
          }

          const result = await app.traceStatsService.stats(statsOpts);

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
