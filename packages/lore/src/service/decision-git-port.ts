/**
 * Module: decision-git-port — the production {@link DecisionGitPort}: read-only `git` at the repository root.
 *
 * Purpose: answer HEAD, "does this path have uncommitted changes" and "what are these lines at that commit" for the
 *   decision gate's file-premise quoting.
 * Public surface: {@link SpawnDecisionGitPort}.
 * Invariants: every answer is a {@link GitAnswer}; a git failure (not a repo, git missing, unexpected exit) is
 *   `{ ok: false, reason }`, never a guessed value. A file absent at a commit (or an unknown commit) is the definite
 *   answer `null` from `readLinesAt`, which the gate turns into a refusal. Only read-only git commands run.
 * Side-effect class: IO (spawns `git`, read-only).
 *
 * Source: spec-a-decision-carrying-write-records-its-decision-on-its, D9 (file premises quoted and pinned by lore).
 */

import { spawnSync } from "node:child_process";
import type { DecisionGitPort, GitAnswer } from "./decision-gate.js";
import { splitFileLines } from "./decision-quote.js";
import { resolveGitRoot } from "./rule-state-git-port.js";

interface GitRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly spawnError: string | undefined;
}

export class SpawnDecisionGitPort implements DecisionGitPort {
  private repoRoot: string | undefined;

  /**
   * @param cwd - the invoking directory; the questions run at ITS repository root, resolved on the first question (a
   *   command that never asks pays nothing). The checkout the writer works in, not the corpus's: a worktree's premise
   *   files and HEAD are its own.
   */
  constructor(private readonly cwd: string) {}

  headSha(): GitAnswer<string> {
    const run = this.run(["rev-parse", "HEAD"]);
    if (run.status !== 0) return { ok: false, reason: describe(run) };
    const sha = run.stdout.trim();
    if (!/^[0-9a-f]{40}$/.test(sha)) return { ok: false, reason: `unexpected output '${sha}'` };
    return { ok: true, value: sha };
  }

  hasUncommittedChanges(path: string): GitAnswer<boolean> {
    const run = this.run(["status", "--porcelain", "--", path]);
    if (run.status !== 0) return { ok: false, reason: describe(run) };
    return { ok: true, value: run.stdout.trim() !== "" };
  }

  readLinesAt(sha: string, path: string): GitAnswer<readonly string[] | null> {
    // reason: a sha that starts with "-" must never be read as an option.
    if (sha.startsWith("-")) return { ok: false, reason: `'${sha}' is not a commit` };
    const run = this.run(["show", `${sha}:${path}`]);
    if (run.spawnError !== undefined) return { ok: false, reason: run.spawnError };
    // reason: `git show <sha>:<path>` exits 128 for both "unknown commit" and "path not in that commit"; for a quote
    // both mean "these lines are not there", so both answer null.
    if (run.status !== 0) return { ok: true, value: null };
    return { ok: true, value: splitFileLines(run.stdout) };
  }

  private run(args: readonly string[]): GitRun {
    this.repoRoot ??= resolveGitRoot(this.cwd);
    const result = spawnSync("git", [...args], { cwd: this.repoRoot, encoding: "utf8" });
    return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", spawnError: result.error?.message };
  }
}

function describe(run: GitRun): string {
  return run.spawnError ?? `exit ${String(run.status)}: ${run.stderr.trim()}`;
}
