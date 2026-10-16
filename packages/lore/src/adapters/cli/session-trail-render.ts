/**
 * session-trail-render.ts — pure narrowing and rendering of a session trail for `lore session trail`.
 *
 * Purpose: turn a `SessionTrail` (from `@lore/core/node` `readSessionTrail`) into the filtered JSON view and
 * the human text view, with removed and unmeasured parts always named as such, never shown as empty (I7).
 *
 * Public surface: `narrowTrail(trail, filter)`, `formatTrail(view)`, types `TrailFilter`, `TrailView`.
 *
 * Invariants:
 *   - `--turn` keeps exactly that turn; `--run` keeps only files whose source is that run and only that
 *     run's helper record. A turn whose changes are unmeasured is kept under `--run` (it cannot be narrowed,
 *     and dropping it would read as "that run changed nothing").
 *   - `files` is the flat, chronological list of the measured turns' changes, each tagged with its turn.
 *
 * Side-effect class: pure (no IO). Lives beside `commands/` so vitest can import it without `loader.ts`.
 */

import type { Measured, SessionTrail, TrailChange, TrailHelper, TrailTurn } from "@lore/core/node";

/** Narrowing options; both optional, both applied when both given. */
export interface TrailFilter {
  readonly turn?: string;
  readonly run?: string;
}

/** A trail change tagged with the turn that recorded it. */
export type TrailViewFile = TrailChange & { readonly turn: string };

/** The narrowed trail as printed by `--json`. */
export interface TrailView {
  readonly session: string;
  readonly started_at: string | null;
  readonly removed: SessionTrail["removed"];
  readonly filter: TrailFilter;
  readonly turns: TrailTurn[];
  readonly files: TrailViewFile[];
  readonly helpers: TrailHelper[];
}

function keepChange(change: TrailChange, run: string | undefined): boolean {
  return run === undefined || (change.source.kind === "run" && change.source.run === run);
}

function narrowTurn(turn: TrailTurn, run: string | undefined): TrailTurn {
  if (!turn.changes.measured) return turn;
  return { ...turn, changes: { measured: true, value: turn.changes.value.filter((c) => keepChange(c, run)) } };
}

/**
 * Narrow a trail by turn and/or run.
 * @param trail - the whole session trail.
 * @param filter - optional turn id and run id.
 * @returns the view; `turns` is empty when `filter.turn` names no turn (caller decides how to report it).
 */
export function narrowTrail(trail: SessionTrail, filter: TrailFilter): TrailView {
  const turns = trail.turns
    .filter((t) => filter.turn === undefined || t.turn === filter.turn)
    .map((t) => narrowTurn(t, filter.run));
  const files: TrailViewFile[] = turns.flatMap((t) =>
    t.changes.measured ? t.changes.value.map((c) => ({ ...c, turn: t.turn })) : [],
  );
  const helpers = trail.helpers.filter((h) => filter.run === undefined || h.run === filter.run);
  return { session: trail.session, started_at: trail.started_at, removed: trail.removed, filter, turns, files, helpers };
}

function describeSource(change: TrailChange): string {
  return change.source.kind === "run" ? `run ${change.source.run}` : change.source.kind;
}

function describeMeasured<T>(measured: Measured<T>, whenMeasured: (value: T) => string[]): string[] {
  return measured.measured ? whenMeasured(measured.value) : [`    unmeasured (${measured.reason})`];
}

function formatFiles(files: readonly TrailChange[]): string[] {
  if (files.length === 0) return ["    (no changes)"];
  return files.map((c) => `    ${c.status} ${c.path} (${c.lines} lines) [${describeSource(c)}]`);
}

function formatTurn(turn: TrailTurn): string[] {
  const shared = turn.shared_working_copy === true ? " (shared working copy)" : "";
  return [`  turn ${turn.turn}${shared}`, ...describeMeasured(turn.changes, formatFiles)];
}

function formatHelper(helper: TrailHelper): string[] {
  const head = `  helper ${helper.run} (ended ${helper.end_count}x, judged ${helper.judged_end_count}x)`;
  if (helper.changes === undefined) return [head, "    unmeasured (no measurement recorded)"];
  return [head, ...describeMeasured(helper.changes, (v) => formatFiles(v.files))];
}

/**
 * Render the narrowed trail as text.
 * @param view - result of `narrowTrail`.
 * @returns the lines joined with newlines; a removed trail leads with its removal date.
 */
export function formatTrail(view: TrailView): string {
  const lines = [`── lore session trail (session ${view.session}) ──`];
  if (view.removed !== null) {
    lines.push(`  removed on ${view.removed.removed_at} (idle trail cleaned up; earlier turns are not available)`);
  }
  for (const turn of view.turns) lines.push(...formatTurn(turn));
  if (view.helpers.length > 0) {
    lines.push("  helpers:");
    for (const helper of view.helpers) lines.push(...formatHelper(helper));
  }
  if (view.removed === null && view.turns.length === 0 && view.helpers.length === 0) lines.push("  (no turns recorded yet)");
  return lines.join("\n");
}
