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
 * Landing (the preferred source): a task's commit range is a fact of its LANDING, not of its last claim.
 * `lore integrate` records `extra.landing` ({@link TaskLanding}) on every task whose claim recorded the landed
 * branch; `lore done` and assess derive the range from it (`head` = the branch head, `base` = main before the
 * landing, so `base..head` is exactly the branch's own commits). A re-claim from a worktree of main (evidence
 * repair) therefore cannot replace the range. Nothing reconstructs a landing from main's history: a task
 * without a recorded landing has none (BR-1291, BR-1336).
 *
 * Pure: no IO. The service measures; the assess adapter reads.
 */

import { z } from "zod";

export const recordedCommitRangeSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("recorded"),
    head: z.string().min(1),
    /** How `head` was resolved: HEAD inside a worktree directory, or the tip of a branch NAME. */
    head_source: z.enum(["worktree", "branch", "landing"]),
    /** Absent for a claim recorded before base_sha existed — head-only range. */
    base: z.string().min(1).optional(),
    /** The worktree/branch the claim recorded; for a landing-derived range, the landed branch. */
    worktree: z.string().min(1),
    /** Landing-derived ranges only: the commit that moved main (the merge commit, or the tip on a fast-forward). */
    landing_commit: z.string().min(1).optional(),
    recorded_at: z.string().min(1),
  }),
  z.object({
    state: z.literal("not-measured"),
    reason: z.string().min(1),
    recorded_at: z.string().min(1),
  }),
]);

export type TaskCommitRange = z.infer<typeof recordedCommitRangeSchema>;

/**
 * The landing of a task's branch on main (`extra.landing`), written by `lore integrate` only. `main_before..branch_head` is the branch's own work; `landing_commit` is the commit
 * that moved main (`main_after`).
 */
export const taskLandingSchema = z.object({
  branch: z.string().min(1),
  branch_head: z.string().min(1),
  main_before: z.string().min(1),
  main_after: z.string().min(1),
  landing_commit: z.string().min(1),
  /**
   * The landed footprint: the branch's own-change paths that none of its tasks' anchors covered (and no other live claim
   * held), measured by `lore integrate`'s own-diff judgment (BR-1346). Absent on a landing recorded before it existed or
   * where the own change was not measured (an already-integrated re-run); `[]` means everything was anchored.
   */
  outside_anchors: z.array(z.string().min(1)).optional(),
  recorded_at: z.string().min(1),
});

export type TaskLanding = z.infer<typeof taskLandingSchema>;

/** A landing without its timestamp: what integrate measures. */
export type LandingFact = Omit<TaskLanding, "recorded_at">;

/** Reads `extra.landing`; `undefined` when absent or malformed (a malformed record is never trusted). */
export function readTaskLanding(extra: Record<string, unknown> | undefined): TaskLanding | undefined {
  const raw = extra?.["landing"];
  if (raw === undefined) return undefined;
  const parsed = taskLandingSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/**
 * The one line `lore done` prints on stderr (and assess shows) when a task's range is not landing-derived:
 * `commit range not measured: <reason>` for a not-measured range.
 * `undefined` for a landing-derived or plainly measured range.
 */
export function commitRangeNote(extra: Record<string, unknown> | undefined): string | undefined {
  const raw = extra?.["commit_range"];
  const parsed = recordedCommitRangeSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  if (parsed.data.state === "not-measured") return `commit range not measured: ${parsed.data.reason}`;
  return undefined;
}

/** The recorded range a landing implies: the branch head over main-before, naming the landing commit. */
export function commitRangeFromLanding(landing: TaskLanding, recordedAt: string): MeasuredCommitRange {
  return {
    state: "recorded",
    head: landing.branch_head,
    head_source: "landing",
    base: landing.main_before,
    worktree: landing.branch,
    landing_commit: landing.landing_commit,
    recorded_at: recordedAt,
  };
}

/** A usable range: only the `recorded` shape carries commits. */
export type MeasuredCommitRange = Extract<TaskCommitRange, { state: "recorded" }>;

/** What assess gets per task: a usable range (+ branch hint), or the reason the range is not measured. */
export type CollectedRange = { base?: string; head: string; worktree?: string };

/**
 * slug -> usable range for every task that has one (tasks done before this feature, or recorded
 * `not-measured`, are simply absent — the assess derivation then falls back to the slug search).
 */
export function collectRecordedRanges(
  tasks: ReadonlyArray<{ slug: string; extra?: Record<string, unknown> | undefined }>,
): Map<string, CollectedRange> {
  const ranges = new Map<string, CollectedRange>();
  for (const task of tasks) {
    // reason: the landing record outranks `commit_range` — a later re-claim can rewrite the latter, never the former.
    const landing = readTaskLanding(task.extra);
    if (landing !== undefined) {
      ranges.set(task.slug, { head: landing.branch_head, base: landing.main_before, worktree: landing.branch });
      continue;
    }
    const range = readMeasuredCommitRange(task.extra);
    if (range === undefined) continue;
    ranges.set(task.slug, { head: range.head, worktree: range.worktree, ...(range.base !== undefined ? { base: range.base } : {}) });
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
