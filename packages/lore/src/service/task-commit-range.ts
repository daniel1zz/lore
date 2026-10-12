/**
 * The commit range `lore done` records on an archived task (`extra.commit_range`), so
 * `lore assess` can attribute the task's commits WITHOUT depending on the task slug appearing
 * in a commit message (issue #180: a merge message without the slug made 14 of 14 tasks
 * invisible to assess).
 *
 * Design (verified against the code, see task-gh-1343388703-180):
 *   - `base` is the claim audit row's `details.base_sha` (the worktree HEAD at claim time, the
 *     same boundary BR-961 worktree cleanup uses for "own commits"). It lives on the audit row,
 *     not on `extra.claim`, because the audit row survives `lore release`.
 *   - `head` is `git rev-parse HEAD` of the recorded worktree, measured at done time. One git
 *     call. It MUST be measured before worktree cleanup runs.
 *   - Two recorded shapes, never collapsed (not-measured is not none):
 *       `{state: "recorded", head, base?, worktree}` — `base` absent means a pre-#106 claim with
 *          no base_sha: the range is head-only and `lore assess` attributes just the head commit.
 *       `{state: "not-measured", reason}` — no worktree on any claim, or HEAD unreadable.
 *   - A range is evidence of where the work was, so it is a hint that is verified at read time
 *     (commit objects must exist); a missing object degrades to the slug search with a warning.
 *
 * Pure: no IO. The service measures; the assess adapter reads.
 */

import { z } from "zod";

export const recordedCommitRangeSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("recorded"),
    head: z.string().min(1),
    /** Absent for a claim recorded before base_sha existed — head-only range. */
    base: z.string().min(1).optional(),
    worktree: z.string().min(1),
    recorded_at: z.string().min(1),
  }),
  z.object({
    state: z.literal("not-measured"),
    reason: z.string().min(1),
    recorded_at: z.string().min(1),
  }),
]);

export type TaskCommitRange = z.infer<typeof recordedCommitRangeSchema>;

/** A usable range: only the `recorded` shape carries commits. */
export type MeasuredCommitRange = Extract<TaskCommitRange, { state: "recorded" }>;

/**
 * slug -> usable range for every task that has one (tasks done before this feature, or recorded
 * `not-measured`, are simply absent — the assess derivation then falls back to the slug search).
 */
export function collectRecordedRanges(
  tasks: ReadonlyArray<{ slug: string; extra?: Record<string, unknown> | undefined }>,
): Map<string, { base?: string; head: string }> {
  const ranges = new Map<string, { base?: string; head: string }>();
  for (const task of tasks) {
    const range = readMeasuredCommitRange(task.extra);
    if (range === undefined) continue;
    ranges.set(task.slug, { head: range.head, ...(range.base !== undefined ? { base: range.base } : {}) });
  }
  return ranges;
}

/**
 * Reads `extra.commit_range` off a task's `extra`. Returns `undefined` when absent (a task done
 * before this feature) and when malformed — a malformed value is never trusted as a range, so
 * assess falls back to the slug search.
 *
 * @example
 * readMeasuredCommitRange({ commit_range: { state: "recorded", head: "abc", base: "def", worktree: "/w", recorded_at: "t" } })
 * // → { state: "recorded", head: "abc", base: "def", ... }
 */
export function readMeasuredCommitRange(extra: Record<string, unknown> | undefined): MeasuredCommitRange | undefined {
  const raw = extra?.["commit_range"];
  if (raw === undefined) return undefined;
  const parsed = recordedCommitRangeSchema.safeParse(raw);
  if (!parsed.success || parsed.data.state !== "recorded") return undefined;
  return parsed.data;
}
