/**
 * The exit codes of `lore assess`: one table, rendered into `lore assess --help` (BR-1511).
 *
 * Purpose: give agents one place that says what each assess exit code means and what to do, so the help text cannot
 *   drift from what the command returns.
 * Public surface: {@link ASSESS_EXIT_CODES}, {@link ASSESS_EXIT_LEASE_HELD}, {@link renderAssessExitCodes}.
 * Invariants:
 *   - Every code `assess` returns is a key of the table (a test drives the command and checks each observed code).
 *   - 75 is returned only when another holder leases the plan (a direct assess) or every selected plan of a batch was
 *     skipped as held: nothing ran, re-run later. It is never returned for work already done.
 * Side-effect class: pure.
 */

/** Exit 75: another holder leases the plan and nothing ran (the project's "lost the race, re-run" code, as in `lore integrate`). */
export const ASSESS_EXIT_LEASE_HELD = 75;

/** Each exit code of `lore assess` with its meaning and the action it asks of the caller. */
export const ASSESS_EXIT_CODES: Readonly<Record<number, string>> = {
  0: "every plan passed (or a batch accepted/skipped as done work): nothing more to do",
  1: "a plan failed its review or could not be reviewed: read the rows, fix, re-run",
  2: "usage error (no selector, ids with --where, --no-ai, a bad --where): fix the command line",
  3: "a plan was not found: check the id or slug",
  4: "refused (validation, lifecycle, missing decision or tracker config): the message names the fix",
  5: "write contention (stale version or claim conflict): re-read and re-run",
  6: "AI provider error: retry once, then report the review as skipped",
  [ASSESS_EXIT_LEASE_HELD]: "another holder leases the plan; nothing ran; re-run later",
};

/** The table as the help text prints it, one `  <code>  <meaning>` line per code in ascending order. */
export function renderAssessExitCodes(): string {
  return Object.entries(ASSESS_EXIT_CODES)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([code, meaning]) => `  ${code.padStart(2)}  ${meaning}`)
    .join("\n");
}
