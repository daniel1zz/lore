/**
 * Module: rule-state-git-port — the production {@link GitPort} for `RuleStateService`.
 *
 * Purpose: answer HEAD / ancestry / "did these paths change since sha" by spawning `git`
 *   synchronously at the repository root.
 * Public surface: {@link SpawnGitPort}.
 * Invariants: every method returns a Result; ANY git failure (not a repo, git missing,
 *   unexpected exit code, shallow clone that cannot answer) is an `err` which the service
 *   reports as `unknown(git-unavailable)` — never a guessed boolean. A sha git does not know
 *   in a COMPLETE clone is a definite `false` (not an ancestor), not an error.
 * Side-effect class: IO (spawns `git`, read-only commands only).
 * Source: spec-baseline-slice-1-rules-with-permanent-ids-ac-citations §C6.
 */

import { spawnSync } from "node:child_process";
import { err, ok } from "@lore/core";
import type { LoreError, Result } from "@lore/core";
import { gitDiffChangedSince } from "./git-diff-since.js";
import type { GitPort } from "./rule-state-service.js";

interface GitRun {
  status: number | null;
  stdout: string;
  stderr: string;
  spawnError?: string;
}

function gitUnavailable(what: string, detail: string): LoreError {
  return { code: "STORE_ERROR", message: `git unavailable for ${what}: ${detail}` };
}

/**
 * The repository root containing `cwd` (`git rev-parse --show-toplevel`), or `cwd` itself when
 * git cannot say. Anchor paths are repo-root-relative, so every git call and every path probe
 * must run from this directory; when git is genuinely unavailable the next {@link SpawnGitPort}
 * call fails loudly (`unknown(git-unavailable)`), so returning `cwd` hides nothing.
 */
export function resolveGitRoot(cwd: string): string {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" });
  const root = result.status === 0 ? (result.stdout ?? "").trim() : "";
  return root === "" ? cwd : root;
}

export class SpawnGitPort implements GitPort {
  /** @param repoRoot - directory `git` runs in (the repository root). */
  constructor(private readonly repoRoot: string) {}

  headSha(): Result<string, LoreError> {
    const run = this.run(["rev-parse", "HEAD"]);
    if (run.status !== 0) return err(gitUnavailable("HEAD", this.describe(run)));
    const sha = run.stdout.trim();
    if (!/^[0-9a-f]{40}$/.test(sha)) return err(gitUnavailable("HEAD", `unexpected output '${sha}'`));
    return ok(sha);
  }

  isAncestor(sha: string): Result<boolean, LoreError> {
    const run = this.run(["merge-base", "--is-ancestor", sha, "HEAD"]);
    if (run.status === 0) return ok(true);
    if (run.status === 1) return ok(false);
    // Any other exit (typically 128: unknown object). In a shallow clone the object may merely be
    // absent from the truncated history, so "not an ancestor" cannot be asserted there.
    if (run.spawnError === undefined) {
      const shallow = this.run(["rev-parse", "--is-shallow-repository"]);
      if (shallow.status === 0 && shallow.stdout.trim() === "false") {
        const known = this.run(["cat-file", "-e", `${sha}^{commit}`]);
        if (known.status !== 0 && known.spawnError === undefined) return ok(false);
      }
    }
    return err(gitUnavailable(`ancestry of ${sha}`, this.describe(run)));
  }

  changedSince(sha: string, paths: string[]): Result<boolean, LoreError> {
    return gitDiffChangedSince(this.repoRoot, sha, paths);
  }

  private run(args: string[]): GitRun {
    const result = spawnSync("git", args, { cwd: this.repoRoot, encoding: "utf8" });
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      ...(result.error !== undefined ? { spawnError: result.error.message } : {}),
    };
  }

  private describe(run: GitRun): string {
    return run.spawnError ?? `exit ${String(run.status)}: ${run.stderr.trim()}`;
  }
}
