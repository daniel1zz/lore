/**
 * Real `GitPort` (SPEC-057 §Module Boundary D1 port implementation) — shells
 * `git` via `node:child_process.spawn` for every `SeatService` operation.
 * Mirrors `real-mcp-registrar.ts`'s "port implementation, adapter layer"
 * placement and its `node:child_process`-not-`Bun.spawn` invariant.
 *
 * Public surface:
 *   - RealGitPort implements GitPort — constructor(repoRoot) (the directory
 *     every `worktreeAdd`/`worktreeList`/`worktreeRemove`/`isMerged` call
 *     runs `git` from; `rebaseFromMain`/`isDirty` instead use their own
 *     explicit `cwd` argument, per the `GitPort` interface contract —
 *     those two operate on whichever checkout the CALLER names, typically
 *     the main checkout, not necessarily `repoRoot`).
 *
 * Invariants:
 *   - `node:child_process.spawn`, NOT `Bun.spawn` — the global `Bun` object
 *     is absent inside vitest's worker-thread pool (same empirically-verified
 *     constraint `real-mcp-registrar.ts`'s module doc documents; this port's
 *     own integration suite, `tests/integration/real-git-port.test.ts`, is a
 *     `bunx vitest` oracle).
 *   - Every method returns a `Result` for an EXPECTED git failure (nonzero
 *     exit) — never throws. A spawn-level fault (`git` not on PATH) also
 *     resolves to `err`, never rejects the promise.
 *   - `isMerged` handles BOTH a real merge (fast-ancestor path,
 *     `git merge-base --is-ancestor`) AND a squash merge (the tip commit is
 *     never an ancestor after a squash — a synthetic single-commit
 *     equivalence check via `git commit-tree` + `git cherry` is required,
 *     the same algorithm `git-delete-squashed`-style tooling uses).
 *     Empirically verified against a real git repo before landing this file
 *     (unmerged → `git cherry` reports `+<sha>`; squash-merged → `-<sha>`).
 *   - `worktreeList`'s `createdAt` is derived from the worktree DIRECTORY's
 *     filesystem birthtime (`node:fs.statSync`) — real `git worktree list`
 *     carries no creation timestamp of its own; this is a best-effort
 *     approximation, not a git-native fact (mirrors the fake `GitPort`'s own
 *     "fixture-only convenience" framing in the service-layer test suite).
 *
 * Side-effect class: IO (child_process subprocess; `worktreeList`'s
 *   `createdAt` derivation additionally does one synchronous `fs.statSync`
 *   per listed worktree).
 *
 * Source: SPEC-057 §Module Boundary D1, §Structure.
 */

import { spawn } from "node:child_process";
import { statSync } from "node:fs";

import { err, ok } from "@lore/core";
import type { LoreError, Result } from "@lore/core";
import type { GitPort, WorktreeInfo } from "../service/seat-service.js";

const GIT_COMMAND = "git";
const STDERR_TAIL_MAX_CHARS = 500;

interface GitRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs `git <args>` in `cwd` and resolves with its exit code + captured
 * stdout/stderr — NEVER rejects (an ENOENT/spawn-level fault resolves with
 * `exitCode: -1` and the fault message in `stderr`), so every `RealGitPort`
 * method can uniformly inspect `exitCode` without a separate try/catch.
 */
function runGit(cwd: string, args: string[]): Promise<GitRunResult> {
  return new Promise((resolve) => {
    const child = spawn(GIT_COMMAND, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    let settled = false;

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.once("error", (cause) => {
      if (settled) return;
      settled = true;
      resolve({ exitCode: -1, stdout: "", stderr: cause instanceof Error ? cause.message : String(cause) });
    });

    child.once("close", (exitCode) => {
      if (settled) return;
      settled = true;
      resolve({ exitCode: exitCode ?? -1, stdout, stderr });
    });
  });
}

/** Wraps a failed `GitRunResult` into a `LoreError`, naming the git subcommand + a bounded stderr tail. */
function gitFailure(args: string[], result: GitRunResult): LoreError {
  return {
    code: "STORE_ERROR",
    message: `git ${args.join(" ")} exited ${result.exitCode}: ${result.stderr.slice(0, STDERR_TAIL_MAX_CHARS)}`,
  };
}

/**
 * Parses `git worktree list --porcelain` output into {@link WorktreeInfo}
 * entries. Blocks are separated by a blank line; each block has a
 * `worktree <path>` line, a `HEAD <sha>` line, and either a
 * `branch refs/heads/<name>` line or a bare `detached` line (locked/prunable
 * annotation lines, when present, are ignored — not needed by any
 * `SeatService` consumer).
 */
function parsePorcelainWorktreeList(stdout: string): Array<{ path: string; branch: string | null }> {
  const blocks = stdout.split(/\n\n+/).filter((block) => block.trim().length > 0);
  const entries: Array<{ path: string; branch: string | null }> = [];

  for (const block of blocks) {
    const lines = block.split("\n");
    const pathLine = lines.find((line) => line.startsWith("worktree "));
    if (pathLine === undefined) continue;
    const path = pathLine.slice("worktree ".length).trim();

    const branchLine = lines.find((line) => line.startsWith("branch "));
    const branch =
      branchLine !== undefined ? branchLine.slice("branch refs/heads/".length).trim() : null;

    entries.push({ path, branch });
  }

  return entries;
}

/**
 * `node:child_process`-backed {@link GitPort}. See module doc for the
 * squash-merge detection algorithm and the `createdAt` best-effort caveat.
 */
export class RealGitPort implements GitPort {
  /**
   * @param repoRoot - Directory `worktreeAdd`/`worktreeList`/`worktreeRemove`/
   *   `isMerged` run `git` from (any worktree of a repo can run
   *   `git worktree`/branch-comparison plumbing against the whole repo).
   *   `rebaseFromMain`/`isDirty` ignore this and use their own `cwd` argument.
   */
  constructor(private readonly repoRoot: string) {}

  async worktreeAdd(path: string, branch: string): Promise<Result<void, LoreError>> {
    const branchExists = await runGit(this.repoRoot, ["rev-parse", "--verify", "--quiet", branch]);
    const args =
      branchExists.exitCode === 0
        ? ["worktree", "add", path, branch]
        : ["worktree", "add", "-b", branch, path];

    const result = await runGit(this.repoRoot, args);
    if (result.exitCode !== 0) return err(gitFailure(args, result));
    return ok(undefined);
  }

  async worktreeList(): Promise<Result<WorktreeInfo[], LoreError>> {
    const args = ["worktree", "list", "--porcelain"];
    const result = await runGit(this.repoRoot, args);
    if (result.exitCode !== 0) return err(gitFailure(args, result));

    const entries = parsePorcelainWorktreeList(result.stdout).map((entry) => {
      // reason: git carries no creation-timestamp fact for a worktree — the
      // directory's own filesystem birthtime is the best available proxy
      // (module @invariant). A stat failure (e.g. a worktree removed
      // out-of-band between listing and stat) degrades to the epoch rather
      // than aborting the whole listing.
      let createdAt = new Date(0).toISOString();
      try {
        createdAt = statSync(entry.path).birthtime.toISOString();
      } catch {
        // reason: see comment above — degrade this ONE entry's timestamp, never the whole list.
      }
      return { path: entry.path, branch: entry.branch, createdAt };
    });

    return ok(entries);
  }

  async worktreeRemove(path: string, force: boolean): Promise<Result<void, LoreError>> {
    const args = force ? ["worktree", "remove", "--force", path] : ["worktree", "remove", path];
    const result = await runGit(this.repoRoot, args);
    if (result.exitCode !== 0) return err(gitFailure(args, result));
    return ok(undefined);
  }

  async isMerged(branch: string, into: string): Promise<Result<boolean, LoreError>> {
    const ancestorArgs = ["merge-base", "--is-ancestor", branch, into];
    const ancestorResult = await runGit(this.repoRoot, ancestorArgs);
    if (ancestorResult.exitCode === 0) return ok(true);
    // reason: exit 1 from `merge-base --is-ancestor` means "not an ancestor"
    // (a real, expected outcome, not a failure) — any OTHER nonzero code
    // (e.g. one of the two refs doesn't resolve) is a genuine git error.
    if (ancestorResult.exitCode !== 1) return err(gitFailure(ancestorArgs, ancestorResult));

    // Squash-merge detection (git-delete-squashed algorithm, empirically
    // verified — see module @invariant): synthesize a single commit carrying
    // `branch`'s tree on top of the merge-base, then ask `git cherry`
    // whether that patch is already equivalent to one in `into`'s history.
    const mergeBaseArgs = ["merge-base", into, branch];
    const mergeBaseResult = await runGit(this.repoRoot, mergeBaseArgs);
    if (mergeBaseResult.exitCode !== 0) {
      // reason: no common ancestor at all between `branch` and `into` —
      // definitively not merged, not a git error.
      return ok(false);
    }
    const mergeBase = mergeBaseResult.stdout.trim();

    const treeArgs = ["rev-parse", `${branch}^{tree}`];
    const treeResult = await runGit(this.repoRoot, treeArgs);
    if (treeResult.exitCode !== 0) return err(gitFailure(treeArgs, treeResult));
    const tree = treeResult.stdout.trim();

    const commitTreeArgs = ["commit-tree", tree, "-p", mergeBase, "-m", "lore-seat-squash-check"];
    const commitTreeResult = await runGit(this.repoRoot, commitTreeArgs);
    if (commitTreeResult.exitCode !== 0) return err(gitFailure(commitTreeArgs, commitTreeResult));
    const syntheticCommit = commitTreeResult.stdout.trim();

    const cherryArgs = ["cherry", into, syntheticCommit];
    const cherryResult = await runGit(this.repoRoot, cherryArgs);
    if (cherryResult.exitCode !== 0) return err(gitFailure(cherryArgs, cherryResult));

    // `git cherry` prefixes an unmerged-patch line with "+" and an
    // already-equivalent (squash-merged) one with "-".
    const hasUnmergedLine = cherryResult.stdout
      .split("\n")
      .some((line) => line.trim().startsWith("+"));
    return ok(!hasUnmergedLine);
  }

  async rebaseFromMain(cwd: string): Promise<Result<void, LoreError>> {
    const upstreamArgs = ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"];
    const upstreamResult = await runGit(cwd, upstreamArgs);
    if (upstreamResult.exitCode !== 0) {
      // reason: no upstream tracking branch configured (a fresh local-only
      // checkout, or this port's own integration-test fixture, which has no
      // remote) — nothing to rebase onto, a no-op success rather than a
      // hard failure (SPEC-057 §Design Decisions D7 "simplest honest
      // semantics" — rebasing main is a best-effort freshness step, not a
      // hard precondition).
      return ok(undefined);
    }

    const rebaseArgs = ["rebase", "@{u}"];
    const rebaseResult = await runGit(cwd, rebaseArgs);
    if (rebaseResult.exitCode !== 0) return err(gitFailure(rebaseArgs, rebaseResult));
    return ok(undefined);
  }

  async isDirty(cwd: string): Promise<Result<boolean, LoreError>> {
    const args = ["status", "--porcelain"];
    const result = await runGit(cwd, args);
    if (result.exitCode !== 0) return err(gitFailure(args, result));
    return ok(result.stdout.trim().length > 0);
  }
}
