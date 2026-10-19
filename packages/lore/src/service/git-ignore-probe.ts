/**
 * git-ignore-probe — asks git whether paths are ignored, for the edit-scope gate.
 *
 * Public surface: {@link IgnoreProbeRun}, {@link IgnoreProbeFn} (the injected port) and
 * {@link spawnGitCheckIgnore} (its real implementation).
 *
 * @invariant Side-effect class: IO — one synchronous `git check-ignore` spawn per call; nothing is cached.
 */
import { spawnSync } from "node:child_process";

/** Result of one `git check-ignore` spawn (`status` null = the process did not run to an exit). */
export interface IgnoreProbeRun {
  readonly status: number | null;
  readonly stdout: string;
  /** The spawn error's message (e.g. `spawnSync git ENOENT` for a working copy that no longer exists), when the process did not start. */
  readonly error?: string;
}

/** Runs `git check-ignore --stdin -z -v --non-matching` in `workingCopy` with the NUL-joined `paths` on stdin. */
export type IgnoreProbeFn = (workingCopy: string, paths: readonly string[]) => IgnoreProbeRun;

/** The real {@link IgnoreProbeFn}: a synchronous git spawn in the helper's own working copy. */
export const spawnGitCheckIgnore: IgnoreProbeFn = (workingCopy, paths) => {
  const run = spawnSync("git", ["check-ignore", "--stdin", "-z", "-v", "--non-matching"], {
    cwd: workingCopy,
    input: paths.join("\0") + "\0",
    encoding: "utf8",
  });
  return { status: run.status, stdout: run.stdout ?? "", ...(run.error !== undefined ? { error: run.error.message } : {}) };
};
