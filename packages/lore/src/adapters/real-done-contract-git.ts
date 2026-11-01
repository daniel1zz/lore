/**
 * Module: real-done-contract-git — the real `DoneContractGitPort`: two read-only `git` questions asked in the repository root.
 *
 * Purpose: let `DoneContractService` learn the tip of the base branch and the content of a falsifier file at that commit.
 * Public surface: {@link createRealDoneContractGit}.
 * Invariants: never writes; a branch or file that does not exist is `undefined` (a measured fact), any other git failure
 *   (not a repository, git missing) propagates so a broken checkout never reads as "branch absent".
 * Side-effect class: IO (spawns `git`).
 */

import { execFileSync } from "node:child_process";
import type { DoneContractGitPort } from "../service/done-contract-service.js";

/** Largest file the falsifier check reads at a commit (bytes). */
const MAX_FILE_BYTES = 16 * 1024 * 1024;

function git(repoRoot: string, args: readonly string[]): { readonly status: number; readonly stdout: string } {
  try {
    const stdout = execFileSync("git", [...args], { cwd: repoRoot, encoding: "utf8", maxBuffer: MAX_FILE_BYTES, stdio: ["ignore", "pipe", "pipe"] });
    return { status: 0, stdout };
  } catch (cause) {
    const failure = cause as { status?: number | null };
    // reason: git exits 1 (rev-parse --verify --quiet) or 128 (`show` of a missing path) for "does not exist"; anything else
    // (ENOENT for git itself has no numeric status) is a broken environment and must surface.
    if (failure.status === 1 || failure.status === 128) return { status: failure.status, stdout: "" };
    throw cause;
  }
}

/**
 * Builds the real port over one repository.
 *
 * @param repoRoot - the directory `git` runs in (the project root holding `.lore/`)
 */
export function createRealDoneContractGit(repoRoot: string): DoneContractGitPort {
  return {
    branchTip(branch) {
      const result = git(repoRoot, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`]);
      return result.status === 0 ? result.stdout.trim() : undefined;
    },
    fileAt(commit, path) {
      const result = git(repoRoot, ["show", `${commit}:${path}`]);
      return result.status === 0 ? result.stdout : undefined;
    },
  };
}
