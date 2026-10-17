/**
 * Module: git-diff-since — the ONE definition of the blast-radius git diff.
 *
 * Purpose: answer "did any of these pathspecs change between a recorded sha and HEAD".
 * Public surface: {@link gitDiffChangedSince}.
 * Invariants: exit 0 = unchanged, exit 1 = changed, anything else is an `err` — never a guessed
 *   boolean. Lives in `service/` (not `adapters/`) so `SpawnGitPort` can use it without a
 *   service -> adapter import; `adapters/real-git-port.ts` re-exports it for adapter callers.
 * Side-effect class: IO (spawns read-only `git diff --quiet`).
 * Source: spec-corpus-truthfulness-a-verdict-must-carry-the-state-it AC-CT-4.
 */

import { spawnSync } from "node:child_process";
import { err, ok } from "@lore/core";
import type { LoreError, Result } from "@lore/core";

/**
 * Did any of `paths` change between `sha` and HEAD? (`git diff --quiet <sha> HEAD -- <paths>`.)
 * Shared by `SpawnGitPort.changedSince` (rule state) and the AC-CT-4 radius measurement — never
 * copy this git call.
 *
 * A path CREATED or DELETED after `sha` counts as changed; one that never existed does not
 * (measured 2026-10-17). Any other exit (unknown `sha`, not a repo, git missing) is an `err`.
 *
 * @param repoRoot - directory `git` runs in (repository root; pathspecs are root-relative).
 * @param sha - the recorded revision to compare HEAD against.
 * @param paths - repo-relative pathspecs.
 * @returns `ok(true)` changed, `ok(false)` unchanged, `err` when git cannot answer.
 * @example
 * gitDiffChangedSince("/repo", "abc123…", ["src/a.ts"]); // => { ok: true, value: false }
 */
export function gitDiffChangedSince(repoRoot: string, sha: string, paths: readonly string[]): Result<boolean, LoreError> {
  const run = spawnSync("git", ["diff", "--quiet", sha, "HEAD", "--", ...paths], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (run.status === 0) return ok(false);
  if (run.status === 1) return ok(true);
  const detail = run.error !== undefined ? run.error.message : `exit ${String(run.status)}: ${(run.stderr ?? "").trim()}`;
  return err({ code: "STORE_ERROR", message: `git unavailable for diff since ${sha}: ${detail}` });
}
