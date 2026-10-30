/**
 * Module: execution-log — the shape of the execution log lore appends to a task (or a plan) at `extra.execution_log`.
 *
 * Purpose: a task record is a locked intent body plus an execution log that lore itself appends to (ledger D28): what landed,
 *   what evidence was recorded, what was flaky, which oracle left the contract and why, which criterion was superseded, and
 *   where evidence moved. One source for the entry kinds, their zod schema, the pure append that the writers share, and the
 *   predicate that says a task is past done.
 * Public surface: {@link EXECUTION_LOG_KINDS}, {@link ExecutionLogKind}, {@link executionLogEntrySchema},
 *   {@link ExecutionLogEntry}, {@link readExecutionLog}, {@link withExecutionLogEntries}, {@link isTaskPastDone},
 *   {@link EXECUTION_LOG_WRITER_TEXT}.
 * Invariants: an entry always carries `kind` and `at`; the log only ever grows (a write appends, never edits or drops an entry);
 *   `lore set` never writes the key (it is in DEDICATED_EXTRA_KEYS); an unreadable stored log is an error, never an empty one.
 * Side-effect class: pure.
 *
 * Source: spec-integrate-proves-and-lands-evidence-at-landing-the-merge AC-DCS2-14, ledger D28.
 */

import { z } from "zod";

/** Every kind an execution-log entry can have. */
export const EXECUTION_LOG_KINDS = ["folded", "landed", "evidence-recorded", "flaky", "removed-oracle", "superseded", "drift", "evidence-moved"] as const;

/** One of {@link EXECUTION_LOG_KINDS}. */
export type ExecutionLogKind = (typeof EXECUTION_LOG_KINDS)[number];

/** The verbs that write the log, as the refusal of a hand edit names them. */
export const EXECUTION_LOG_WRITER_TEXT = "lore done, lore integrate, lore land and lore ac set --correction|supersede";

const at = z.string().min(1);

/**
 * One entry of the log. Each kind names the facts of its own event; a kind this module does not list is refused, so a typo never
 * becomes a silent new kind.
 */
export const executionLogEntrySchema = z.discriminatedUnion("kind", [
  /** `lore land` folded the task tip into the plan integration branch. */
  z.object({ kind: z.literal("folded"), at, tip: z.string().min(1), fold_commit: z.string().min(1) }).strict(),
  /** The task's work landed: the branch, its tip, the range of commits and the commit that carries it. */
  z
    .object({
      kind: z.literal("landed"),
      at,
      branch: z.string().min(1),
      tip: z.string().min(1),
      landing_commit: z.string().min(1),
      commit_range: z.string().min(1),
    })
    .strict(),
  /** `lore integrate` recorded the pass rows of these oracle ids on the landing commit. */
  z.object({ kind: z.literal("evidence-recorded"), at, oracles: z.array(z.string().min(1)).min(1), landing_commit: z.string().min(1) }).strict(),
  /** An oracle failed once and passed on its re-run at the landing. */
  z.object({ kind: z.literal("flaky"), at, oracle: z.string().min(1), landing_commit: z.string().min(1), ledger_error: z.string().optional() }).strict(),
  /** An anchored test file the landing deleted left the oracle set (written with `done_contract.removed_oracles`). */
  z.object({ kind: z.literal("removed-oracle"), at, oracle: z.string().min(1), path: z.string().min(1), reason: z.string().min(1), landed_commit: z.string().min(1) }).strict(),
  /** A criterion in the task's scope was corrected or superseded. */
  z.object({ kind: z.literal("superseded"), at, ac: z.string().min(1), reason: z.string().min(1), via: z.enum(["correction", "supersede"]) }).strict(),
  /** The drift check changed something about the contract of the task. */
  z.object({ kind: z.literal("drift"), at, detail: z.string().min(1) }).strict(),
  /** Evidence moved between files or tasks (a plan's log). */
  z.object({ kind: z.literal("evidence-moved"), at, from: z.string().min(1), to: z.string().min(1), task: z.string().min(1).optional() }).strict(),
]);

/** One validated entry. */
export type ExecutionLogEntry = z.infer<typeof executionLogEntrySchema>;

/**
 * Reads the log of a document's `extra`.
 *
 * @param extra - the stored `extra`
 * @returns the entries, empty when the key is absent
 * @throws Error when the stored value is not a valid log (a corrupt log is never read as an empty one)
 */
export function readExecutionLog(extra: Record<string, unknown>): ExecutionLogEntry[] {
  const stored = extra["execution_log"];
  if (stored === undefined) return [];
  return z.array(executionLogEntrySchema).parse(stored);
}

/**
 * The `extra` that holds the stored log plus `entries` appended at its end, every other key carried through unchanged. Pure: the
 * writers put the result into the ONE corpus write of the event they record.
 *
 * @param extra - the stored `extra`
 * @param entries - the entries to append (each validated; an invalid one throws before anything is built)
 * @throws Error (a zod error) when an entry or the stored log is invalid
 */
export function withExecutionLogEntries(extra: Record<string, unknown>, entries: readonly ExecutionLogEntry[]): Record<string, unknown> {
  const validated = entries.map((entry) => executionLogEntrySchema.parse(entry));
  return { ...extra, execution_log: [...readExecutionLog(extra), ...validated] };
}

/**
 * Whether a task is past done: its work is finished and archived, so only the contract check applies to it. A task before that
 * keeps the intent review.
 *
 * @param doc - any document; only a `task` can be past done
 */
export function isTaskPastDone(doc: { readonly type: string; readonly status: string }): boolean {
  return doc.type === "task" && doc.status === "archived";
}
