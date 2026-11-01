/**
 * The ONE implementation of "read the git state an oracle ran against, before and after it, and
 * decide what may be certified" (SPEC-143 AC-CT-5, AC-CT-3b).
 *
 * Public surface: {@link GitStateProbe}, {@link probeGitState}, {@link StampOutcome},
 * {@link decideStampOutcome}.
 *
 * Invariants: shared VERBATIM by `lore verify` (VerifyRunnerService) and `lore evidence --capture`
 * / `lore_evidence_add` (adapters/evidence-capture.ts); a second copy would let the two write
 * paths disagree about what a stamped row means.
 *
 * Side-effect class: `probeGitState` is IO (spawns git); `decideStampOutcome` is pure.
 */
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import type { StateStamp } from "@lore/core";

const GIT_PROBE_TIMEOUT_MS = 10_000;

/**
 * Whether `root` lies inside a git work tree (a repository with zero commits still counts).
 * Distinct from {@link probeGitState}, which also needs a first commit: this answers "is there
 * a repository at all", the question `lore init` asks before arming state binding.
 *
 * @param root - directory to test
 * @sideeffect IO — spawns `git rev-parse` once
 *
 * reason: `false` on any git failure (git missing, not a work tree) is the answer, not a swallowed
 * error: the caller reports it explicitly as `not_a_git_repo` — see SPEC-143 AC-CT-3b.
 */
export function isInsideGitRepository(root: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: GIT_PROBE_TIMEOUT_MS,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * The worktree root (realpath of `git rev-parse --show-toplevel`) containing `root`, for comparing it with an
 * oracle-lock holder's recorded worktree (BR-1512).
 *
 * @param root - the resolved execution root
 * @returns the realpath, or `undefined` when git cannot answer (the caller then treats a held lock as held: unknown is never read as elsewhere)
 * @sideeffect IO — spawns `git rev-parse --show-toplevel` once
 */
export function worktreeRootOf(root: string): string | undefined {
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: GIT_PROBE_TIMEOUT_MS,
    }).trim();
    return top === "" ? undefined : realpathSync(top);
  } catch {
    return undefined;
  }
}

/** Git facts stamped onto a runner attestation; both fields present together or not at all. */
export interface GitStateProbe {
  readonly head_sha: string;
  readonly worktree_dirty: boolean;
}


/**
 * Measures the git state of `root` for the attestation: full 40-hex `HEAD` and
 * whether `git status --porcelain` is non-empty (untracked files count).
 *
 * @param root - the resolved execution root (NOT the corpus root) — a linked worktree reports its own HEAD
 * @returns the probe, or `undefined` when git is unavailable / `root` is not a work tree / the output is not a 40-hex sha
 * @sideeffect IO — spawns `git` twice, resolved through `PATH` at call time
 *
 * reason: the `undefined` return IS the specified omission contract (spec §C5: on any
 * git failure the fields are omitted — never null/empty — and the verify run must not
 * fail). It is not a swallowed error: consumers (rule-state derivation) read the
 * absence as `unknown` with an explicit reason.
 */
export function probeGitState(root: string): GitStateProbe | undefined {
  const run = (args: readonly string[]): string =>
    execFileSync("git", [...args], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: GIT_PROBE_TIMEOUT_MS,
    });
  try {
    const head = run(["rev-parse", "HEAD"]).trim();
    if (!/^[0-9a-f]{40}$/.test(head)) return undefined;
    return { head_sha: head, worktree_dirty: run(["status", "--porcelain"]).trim() !== "" };
  } catch {
    return undefined;
  }
}

/**
 * The attestation fields {@link decideStampOutcome} contributes: the git facts plus either a
 * `state_stamp` (certified) or a `stamp_unbound_reason` (demoted), or neither (not measured).
 */
export type StampOutcome =
  | { readonly state_stamp: StateStamp; readonly head_sha: string; readonly worktree_dirty: false }
  | {
      readonly stamp_unbound_reason: "dirty_tree";
      readonly head_sha: string;
      readonly worktree_dirty: true;
    }
  | { readonly stamp_unbound_reason: "state_moved" }
  | Record<string, never>;

/**
 * Decides what the runner may certify about the state an oracle ran against (SPEC-143 AC-CT-5).
 * Pure: compares the PRE-run and POST-run {@link probeGitState} readings.
 *
 * - either read unmeasured (git could not answer) -> `{}`: nothing measured, NO reason invented
 *   (the absent stamp is classified `unbound` / `legacy_unbound` by the consumer);
 * - `head_sha` differs -> `state_moved`, and NEITHER head is recorded: the post-run value is never
 *   silently written as the measured state (and the pre value did not survive the run);
 * - tree dirty at either read -> `dirty_tree`; the facts keep the existing contract (head_sha +
 *   worktree_dirty: true) that rule-state derivation reads as "dirty";
 * - otherwise -> `state_stamp` + the facts.
 *
 * `state_moved` outranks `dirty_tree`: a state that moved cannot be described by either read.
 *
 * @param pre - reading taken immediately before the command
 * @param post - reading taken immediately after it
 */
export function decideStampOutcome(pre: GitStateProbe | undefined, post: GitStateProbe | undefined): StampOutcome {
  if (pre === undefined || post === undefined) return {};
  if (pre.head_sha !== post.head_sha) return { stamp_unbound_reason: "state_moved" };
  if (pre.worktree_dirty || post.worktree_dirty) {
    return { stamp_unbound_reason: "dirty_tree", head_sha: post.head_sha, worktree_dirty: true };
  }
  return {
    state_stamp: { head_sha: post.head_sha, worktree_dirty: false },
    head_sha: post.head_sha,
    worktree_dirty: false,
  };
}
