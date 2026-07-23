/**
 * Pure row-building for `lore pending`'s table output (SPEC-065 D3).
 * Extracted from `commands/pending.ts` for testability — `commands/pending.ts`
 * transitively imports `loader.ts` (`bun:sqlite`), which vitest cannot resolve,
 * but this module imports only `@lore/core` + `./utils.js` (both vitest-safe).
 * Mirrors `assess-render.ts`/`review-render.ts`'s identical split, same reason.
 *
 * Public surface:
 *   - PENDING_TABLE_HEADERS — the column header row (SSOT — `commands/pending.ts`
 *     never hand-writes headers separately from this module).
 *   - buildPendingTableRows(docs, judgments) — one row per pending doc.
 *
 * Invariant (SPEC-065 D1/D3): every id lore PRINTS must be a valid INPUT to
 * every lore command (git-short-hash semantics). The table already printed a
 * 10-char truncated id column that `resolveDoc` couldn't accept as input
 * (SPEC-065's originating bug, P0-2) — D1 fixed the INPUT side (unique
 * ID-prefix resolution in `resolveDoc`); this module is the OUTPUT-side half —
 * it ADDS a Slug column so a caller always has a second, never-truncated,
 * always-resolvable identifier to copy even when a 10-char prefix turns out
 * ambiguous. The ID column itself is left at 10 chars (now genuinely usable
 * via D1, not shortened further or lengthened — this task's Scope explicitly
 * keeps it as-is).
 *
 * Side-effect class: pure (no IO, no wall-clock reads beyond `relativeTime`'s
 * `Date.now()`, matching `commands/pending.ts`'s pre-extraction behavior).
 *
 * Source: SPEC-065 D3, AC-065-4
 */

import type { ReviewJudgment } from "@lore/core";
import type { PendingDoc } from "../../service/review-service.js";
import { formatJudgmentBadge, relativeTime } from "./utils.js";

/** Column headers for `lore pending`'s human-readable table — SSOT, keep in sync with {@link buildPendingTableRows}'s column order. */
export const PENDING_TABLE_HEADERS = [
  "ID",
  "Slug",
  "Type",
  "Title",
  "Author",
  "Updated",
  "Ver",
  "AI Judgment",
];

/**
 * Builds one table row per pending doc, in {@link PENDING_TABLE_HEADERS} column order.
 *
 * @param docs - pending docs to render (already filtered/escalation-narrowed by the caller)
 * @param judgments - doc id → latest AI judgment (or `null` when unreviewed), one entry per `docs[i].id`
 * @returns row cells, same length/order as `docs`
 */
export function buildPendingTableRows(
  docs: PendingDoc[],
  judgments: Map<string, ReviewJudgment | null>,
): string[][] {
  return docs.map((d) => [
    d.id.slice(0, 10),
    d.slug,
    d.type,
    d.title.slice(0, 32),
    d.created_by,
    relativeTime(d.updated_at),
    String(d.version),
    formatJudgmentBadge(judgments.get(d.id) ?? null, d.version),
  ]);
}
