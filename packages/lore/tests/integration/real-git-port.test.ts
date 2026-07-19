/**
 * real-git-port.test.ts — SPEC-057 AC-S-6.
 *
 * Integration anchor for `RealGitPort` (`packages/lore/src/adapters/real-git-port.ts`)
 * against a REAL `mkdtemp` git repository — never the repo's own working tree or
 * its live `.lore/` corpus (CLAUDE.md's "never write to the repo's own .lore/
 * from tests" rule; this suite never touches lore's corpus at all, only plain
 * throwaway git repos). Every scratch directory is registered for cleanup and
 * removed in `afterEach`.
 *
 * Coverage:
 *   HAPPY:       worktreeAdd -> isDirty -> isMerged -> worktreeRemove round-trip
 *                on an unmerged feature branch; rebaseFromMain no-op when no
 *                upstream is configured
 *   STATE:       squash-merge detection — a branch merged via `git merge --squash`
 *                (never a real ancestor of `main`) is reported as merged
 *   BOUNDARY:    worktreeList's `--porcelain` parsing of a DETACHED-HEAD entry
 *                (branch: null) alongside an attached-branch entry in the same listing
 *   NEGATIVE:    isMerged on a genuinely unmerged branch reports false; isDirty
 *                on a freshly-created clean worktree reports false
 *   ERROR:       worktreeRemove on a dirty worktree without force fails loud;
 *                worktreeAdd for an already-existing path fails loud
 *   REGRESSION:  worktreeList reflects a removal (removed entries do not linger)
 *
 * @spec_ref AC-S-6
 */

import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, appendFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { RealGitPort } from "../../src/adapters/real-git-port.js";

const cleanupDirs: string[] = [];

afterEach(() => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Creates a fresh mkdtemp scratch dir and resolves it via `realpathSync` —
 * macOS's `TMPDIR` (`/var/folders/...`) is itself a symlink into
 * `/private/var/...`, and `git worktree list --porcelain` reports the
 * REAL (resolved) path. Comparing an unresolved `mkdtemp` path against a
 * porcelain-parsed path would spuriously mismatch on macOS — every path this
 * suite constructs must be pre-resolved so string equality holds.
 */
function mkScratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanupDirs.push(dir);
  return realpathSync(dir);
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
}

/** Initializes a git repo at `dir` with one commit on `main`. */
function initGitRepo(dir: string): void {
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "real-git-port-test@example.invalid"]);
  git(dir, ["config", "user.name", "RealGitPort Test"]);
  writeFileSync(join(dir, "README.md"), "real-git-port fixture\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-q", "-m", "init"]);
}

describe("RealGitPort — worktreeAdd -> isDirty -> isMerged -> worktreeRemove round-trip (HAPPY)", () => {
  it("creates an unmerged feature worktree, detects dirt, detects non-merge, then removes it", async () => {
    const repoRoot = mkScratchDir("rgp-repo-");
    initGitRepo(repoRoot);
    const port = new RealGitPort(repoRoot);
    const base = mkScratchDir("rgp-base-");
    const worktreePath = join(base, "feature-worktree");

    const addResult = await port.worktreeAdd(worktreePath, "plan/round-trip");
    expect(addResult.ok).toBe(true);

    // Freshly-created worktree is clean.
    const cleanResult = await port.isDirty(worktreePath);
    expect(cleanResult).toEqual({ ok: true, value: false });

    // Add a commit on the branch (still not merged into main).
    writeFileSync(join(worktreePath, "feature.txt"), "unmerged work\n");
    git(worktreePath, ["add", "."]);
    git(worktreePath, ["commit", "-q", "-m", "feature work"]);
    const cleanAfterCommit = await port.isDirty(worktreePath);
    expect(cleanAfterCommit).toEqual({ ok: true, value: false });

    // Dirty the worktree (uncommitted change).
    appendFileSync(join(worktreePath, "feature.txt"), "more, uncommitted\n");
    const dirtyResult = await port.isDirty(worktreePath);
    expect(dirtyResult).toEqual({ ok: true, value: true });

    // NEGATIVE: genuinely unmerged branch is not reported as merged.
    const mergedResult = await port.isMerged("plan/round-trip", "main");
    expect(mergedResult).toEqual({ ok: true, value: false });

    // ERROR: dirty worktree refuses removal without force.
    const refusedRemoval = await port.worktreeRemove(worktreePath, false);
    expect(refusedRemoval.ok).toBe(false);

    // HAPPY: force removal succeeds.
    const forcedRemoval = await port.worktreeRemove(worktreePath, true);
    expect(forcedRemoval.ok).toBe(true);

    // REGRESSION: the removed worktree no longer appears in the listing.
    const listAfterRemove = await port.worktreeList();
    expect(listAfterRemove.ok).toBe(true);
    if (listAfterRemove.ok) {
      expect(listAfterRemove.value.some((w) => w.path === worktreePath)).toBe(false);
    }
  });

  it("rebaseFromMain is a no-op success when the checkout has no upstream configured", async () => {
    const repoRoot = mkScratchDir("rgp-repo-noup-");
    initGitRepo(repoRoot);
    const port = new RealGitPort(repoRoot);

    const result = await port.rebaseFromMain(repoRoot);
    expect(result).toEqual({ ok: true, value: undefined });
  });
});

describe("RealGitPort — squash-merge detection (STATE)", () => {
  it("reports a branch merged via `git merge --squash` as merged, despite never being a real ancestor", async () => {
    const repoRoot = mkScratchDir("rgp-repo-squash-");
    initGitRepo(repoRoot);
    const port = new RealGitPort(repoRoot);
    const base = mkScratchDir("rgp-base-squash-");
    const worktreePath = join(base, "squash-worktree");

    const addResult = await port.worktreeAdd(worktreePath, "plan/squash-me");
    expect(addResult.ok).toBe(true);

    writeFileSync(join(worktreePath, "squash.txt"), "part one\n");
    git(worktreePath, ["add", "."]);
    git(worktreePath, ["commit", "-q", "-m", "squash part 1"]);
    appendFileSync(join(worktreePath, "squash.txt"), "part two\n");
    git(worktreePath, ["add", "."]);
    git(worktreePath, ["commit", "-q", "-m", "squash part 2"]);

    // Before squashing: not merged (fast-ancestor path is negative).
    const beforeSquash = await port.isMerged("plan/squash-me", "main");
    expect(beforeSquash).toEqual({ ok: true, value: false });

    // Squash-merge the branch into main from the primary checkout (repoRoot).
    git(repoRoot, ["merge", "-q", "--squash", "plan/squash-me"]);
    git(repoRoot, ["commit", "-q", "-m", "squash merge plan/squash-me"]);

    // STATE: squash-detection path reports merged even though the branch tip
    // is never an ancestor of main (git merge-base --is-ancestor alone would
    // report false here).
    const afterSquash = await port.isMerged("plan/squash-me", "main");
    expect(afterSquash).toEqual({ ok: true, value: true });

    await port.worktreeRemove(worktreePath, true);
  });
});

describe("RealGitPort — worktreeList --porcelain parsing (BOUNDARY)", () => {
  it("parses a detached-HEAD entry (branch: null) alongside an attached-branch entry", async () => {
    const repoRoot = mkScratchDir("rgp-repo-detached-");
    initGitRepo(repoRoot);
    const port = new RealGitPort(repoRoot);
    const base = mkScratchDir("rgp-base-detached-");

    const attachedPath = join(base, "attached-worktree");
    const attachedResult = await port.worktreeAdd(attachedPath, "plan/attached");
    expect(attachedResult.ok).toBe(true);

    const detachedPath = join(base, "detached-worktree");
    const headSha = git(repoRoot, ["rev-parse", "HEAD"]).trim();
    git(repoRoot, ["worktree", "add", "--detach", detachedPath, headSha]);

    const listResult = await port.worktreeList();
    expect(listResult.ok).toBe(true);
    if (!listResult.ok) return;

    const attachedEntry = listResult.value.find((w) => w.path === attachedPath);
    expect(attachedEntry?.branch).toBe("plan/attached");

    const detachedEntry = listResult.value.find((w) => w.path === detachedPath);
    expect(detachedEntry?.branch).toBeNull();

    await port.worktreeRemove(attachedPath, true);
    await port.worktreeRemove(detachedPath, true);
  });
});

describe("RealGitPort — worktreeAdd on an already-existing path (ERROR)", () => {
  it("fails loud rather than silently succeeding when the target path already exists", async () => {
    const repoRoot = mkScratchDir("rgp-repo-existing-");
    initGitRepo(repoRoot);
    const port = new RealGitPort(repoRoot);
    const base = mkScratchDir("rgp-base-existing-");
    const worktreePath = join(base, "already-there");
    mkdirSync(worktreePath, { recursive: true });
    writeFileSync(join(worktreePath, "occupied.txt"), "already occupied\n");

    const result = await port.worktreeAdd(worktreePath, "plan/collides");
    expect(result.ok).toBe(false);
  });
});
