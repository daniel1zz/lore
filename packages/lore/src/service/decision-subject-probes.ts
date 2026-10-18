/**
 * Decision subject probes — "does the object this escalation asks about still exist?", one probe per decision class.
 *
 * Purpose: DecisionService closes a pending decision whose subject is gone (AU-T16); this module builds the
 * class-specific existence probes from narrow injected ports, so the rule is testable without git or a process table.
 * Public surface: createSubjectExistenceProbes, SubjectProbePorts.
 * Invariants:
 *   - `absent` is returned ONLY on positive evidence (a successful listing that lacks the subject, a process that is
 *     gone / reused, a run that ended). A port that cannot measure (null) yields `unknown`, which never closes.
 *   - Per class: worktree-remove (subject id = worktree path): absent from `git worktree list`; stash-drop (subject id
 *     = stash sha): not in `git stash list`; process-reap (id `pid:<n>`, version = start time): pid gone, a zombie or a
 *     different start time; run-end-stale (id = run id): the run has an end. The legacy-runs subject covers a SET of
 *     runs, so it has no single existence and is closed by a newer version only.
 *   - A class with no entry here is closed by a newer version only.
 * Side-effect class: pure (every effect is behind the injected ports).
 *
 * Source: task-skill-fix-au-t16-lore-pending-lists-escalations-whose; spec-autonomy-phase-1-decision-function-human-channel-lore AC-AU-3.
 */
import type { SubjectExistence, SubjectExistenceProbes } from "./pending-decisions.js";

/** What every probe needs; each port returns null when it could not measure. */
export interface SubjectProbePorts {
  /** Paths of `git worktree list`, or null when the listing failed. */
  listWorktreePaths(): readonly string[] | null;
  /** Canonical path (symlinks resolved); the input when unresolvable. */
  realPath(path: string): string;
  /** Shas of `git stash list`, or null when the listing failed. */
  listStashShas(): readonly string[] | null;
  /** One pid right now; `null` = no such process. */
  inspectProcess(pid: number): Promise<{ readonly zombie: boolean; readonly startTime: string | null } | null>;
  /** true = the run has ended, false = still open, null = unknown run or unreadable. */
  runEnded(runId: string): Promise<boolean | null>;
}

const PID_SUBJECT = /^pid:(\d+)$/;
const START_TIME_UNMEASURED = "start-time-unmeasured";

/** Class id -> existence probe over `ports`. */
export function createSubjectExistenceProbes(ports: SubjectProbePorts): SubjectExistenceProbes {
  return {
    "worktree-remove": async (subject): Promise<SubjectExistence> => {
      const listed = ports.listWorktreePaths();
      if (listed === null) return "unknown";
      const wanted = ports.realPath(subject.id);
      return listed.some((path) => ports.realPath(path) === wanted) ? "present" : "absent";
    },
    "stash-drop": async (subject): Promise<SubjectExistence> => {
      const listed = ports.listStashShas();
      if (listed === null) return "unknown";
      return listed.includes(subject.id) ? "present" : "absent";
    },
    "process-reap": async (subject): Promise<SubjectExistence> => {
      const match = PID_SUBJECT.exec(subject.id);
      if (match === null) return "unknown";
      const inspected = await ports.inspectProcess(Number(match[1]));
      if (inspected === null || inspected.zombie) return "absent";
      if (subject.version !== START_TIME_UNMEASURED && inspected.startTime !== null && inspected.startTime !== subject.version) return "absent";
      return "present";
    },
    "run-end-stale": async (subject): Promise<SubjectExistence> => {
      const ended = await ports.runEnded(subject.id);
      if (ended === null) return "unknown";
      return ended ? "absent" : "present";
    },
  };
}
