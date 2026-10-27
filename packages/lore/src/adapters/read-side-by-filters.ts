/**
 * The ONLY `by` inputs left on any lore surface: read-side FILTERS that choose whose data to show.
 *
 * Purpose: pin, in one place, which CLI commands may still declare a `by` argument.
 * A write verb never takes `by` — a write is attested by the invoking run alone (spec
 * run-only-write-identity-and-run-end-claim-release AC-ROI-1; ADR
 * write-identity-is-the-attested-run-alone, decision 2). A read verb may take `by` because it names
 * the person whose handoff / claims to look at; it never stamps a row.
 *
 * Public surface: {@link READ_SIDE_BY_FILTERS}.
 *
 * Invariants:
 *   - `tests/unit/cli/write-commands-take-no-by.test.ts` asserts the set of commands/tools that
 *     declare `by` is EXACTLY this list (equality, not containment), so adding a `by` anywhere —
 *     or dropping one here without removing it from the command — turns that test red.
 *   - Adding an entry means the verb is read-only: it must write no row and call no write service.
 *
 * Side-effect class: pure (constant data).
 */

/** One read-side `by` filter: the surface it lives on and the verb's name on that surface. */
export interface ReadSideByFilter {
  readonly surface: "cli";
  /** The command path as typed after `lore` (e.g. `feed`). */
  readonly verb: string;
  /** Why this `by` is a filter and not a writer identity. */
  readonly reason: string;
}

export const READ_SIDE_BY_FILTERS: readonly ReadSideByFilter[] = [
  {
    surface: "cli",
    verb: "feed",
    reason: "`feed session-resume --by` filters whose handoff to resume; feed is advisory and writes nothing",
  },
  {
    surface: "cli",
    verb: "bootstrap",
    reason: "`bootstrap --by` names whose claims the session pointer-set reports; bootstrap is read-only",
  },
];
