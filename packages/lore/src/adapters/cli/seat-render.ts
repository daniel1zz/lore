/**
 * Terminal + `--json` rendering for `lore seat list` (SPEC-057 §Public Interface,
 * AC-S-7). Extracted from `commands/seat.ts` into its own module so it can be
 * unit-tested directly under vitest — `commands/seat.ts` transitively imports
 * `loader.ts` (`bun:sqlite`), which vitest cannot resolve, but this module imports
 * only `../../service/seat-service.js`'s type (vitest-safe: `seat-service.ts` itself
 * has zero bun:sqlite dependency, proven by `seat-service.test.ts` running under
 * `bunx vitest`), mirroring `assess-render.ts`/`review-render.ts`'s identical split.
 *
 * Public surface:
 *   - buildSeatListJsonPayload(entries) — the exact envelope `lore seat list --json`
 *     prints: `{ok: true, data: {seats: entries}}`, verbatim (no re-shaping) so the
 *     `branch`/`created_at`/`merged` fields `SeatService.list()` computes (the G13
 *     cost counter-metric data surface) reach the caller untouched.
 *   - formatSeatList(entries) — compact human-readable rendering for the non-`--json`
 *     terminal path.
 *
 * Side-effect class: pure
 *
 * Source: SPEC-057 §Public Interface, §Acceptance Criteria AC-S-7.
 */

import type { SeatListEntry } from "../../service/seat-service.js";

/** The exact `--json` envelope `lore seat list --json` prints. */
export interface SeatListJsonPayload {
  readonly ok: true;
  readonly data: { readonly seats: SeatListEntry[] };
}

/**
 * Wraps `SeatService.list()`'s result in the `--json` envelope every other `lore`
 * `--json` command uses (`{ok: true, data: {...}}`) — a thin, presence-preserving
 * wrap, never a re-derivation of `branch`/`created_at`/`merged`.
 *
 * @param entries - The seat list, as `SeatService.list()` resolved it.
 * @returns The envelope object; caller `JSON.stringify`s it.
 * @example
 * buildSeatListJsonPayload([{branch: "plan/plan-a", created_at: "2026-07-01T00:00:00.000Z", merged: false}]);
 * // => {ok: true, data: {seats: [{branch: "plan/plan-a", created_at: "...", merged: false}]}}
 */
export function buildSeatListJsonPayload(entries: SeatListEntry[]): SeatListJsonPayload {
  return { ok: true, data: { seats: entries } };
}

/**
 * Compact human-readable rendering of a seat list for the non-`--json` terminal
 * path. Pure — no IO, no wall-clock reads.
 *
 * @param entries - The seat list, as `SeatService.list()` resolved it.
 * @returns A multi-line text block ready for `console.log`; `"No active seats."`
 *   for an empty list (never a bare blank line).
 * @example
 * formatSeatList([]); // => "No active seats."
 */
export function formatSeatList(entries: SeatListEntry[]): string {
  if (entries.length === 0) return "No active seats.";

  const lines: string[] = [`Active seats (${entries.length}):`];
  for (const entry of entries) {
    lines.push(
      `  - ${entry.branch} — created ${entry.created_at}${entry.merged ? " [merged]" : " [unmerged]"}`,
    );
  }
  return lines.join("\n");
}
