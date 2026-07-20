/**
 * git-safety-gate.test.ts — the state-aware (Design B) destructive-git guard.
 *
 * `assets/hooks/pre-bash-git-safety-gate.mjs` is a PreToolUse (matcher "Bash")
 * hook that BLOCKS commands which could destroy uncommitted/unmerged work
 * (git reset --hard, clean -f, branch -D, worktree remove --force, …). It is a
 * vendored lore asset (shipped by `lore setup` to `~/.claude/hooks/`), so its
 * behaviour is pinned here.
 *
 * Design B property under test — the gate ALWAYS blocks a matched op (exit 2,
 * fail-safe), and for the state-determinable rules it runs READ-ONLY git probes
 * and puts the ACTUAL risk in the block message ("WOULD DESTROY 2 uncommitted
 * change(s): …" vs "working tree is CLEAN — nothing would be lost"). It never
 * auto-allows on a "looks safe" probe: a probe bug must degrade to a false
 * BLOCK (friction), never a false ALLOW (data loss).
 *
 * Every scenario spawns the REAL vendored hook as a `node` subprocess, feeding
 * it a PreToolUse-shaped `{cwd, tool_input:{command}}` payload on stdin and
 * reading the exit code directly (2 = block, 0 = allow) plus stderr (the
 * evidence-bearing block message). The W4-incident cases (worktree remove
 * --force / branch -D) run against a real throwaway git repo with purpose-built
 * dirty / clean / merged / unmerged state so the probe's evidence is observed,
 * not inferred.
 *
 * Coverage dimensions: BLOCK-classification / ALLOW-classification (no
 * regression) / PROBE-evidence (state-accurate) / bypass (bash -c) /
 * print-like false-positive.
 *
 * @spec_ref audit V1+V2 mechanization (W4 near-data-loss, 2026-07-20) + Design B
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

// packages/lore/tests/unit/hooks/git-safety-gate.test.ts -> repo root is 5 levels up.
const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..");
const HOOK = join(REPO_ROOT, "assets", "hooks", "pre-bash-git-safety-gate.mjs");

/** Run the hook with a PreToolUse payload; exit code read directly (never piped). */
function run(command: string, cwd?: string): { code: number; stderr: string } {
  const r = spawnSync("node", [HOOK], {
    input: JSON.stringify({ cwd, tool_input: { command } }),
    encoding: "utf8",
  });
  return { code: r.status ?? -1, stderr: r.stderr ?? "" };
}

function git(args: string[], cwd: string): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
}

describe("git-safety-gate — BLOCK classification (exit 2, fail-safe)", () => {
  const cases: Array<[string, string]> = [
    ["reset --hard", "git reset --hard HEAD"],
    ["branch -D", "git branch -D some-branch"],
    ["clean -fd", "git clean -fd"],
    ["stash drop", "git stash drop"],
    ["restore path", "git restore src/a.ts"],
    ["checkout -- path", "git checkout -- src/a.ts"],
    ["worktree remove --force (flag after path)", "git worktree remove /wt/x --force"],
    ["worktree remove -f (flag before path)", "git worktree remove -f /wt/x"],
    ["chained W4 sequence", "git merge b --no-ff; git worktree remove --force /wt/x"],
    ["bash -c bypass", 'bash -c "git worktree remove --force /wt/x"'],
    ["push --force (unconditional)", "git push --force origin main"],
    ["rm -rf .git (unconditional)", "rm -rf .git"],
    ["reflog expire (unconditional)", "git reflog expire --expire=now --all"],
  ];
  for (const [name, cmd] of cases) {
    it(`blocks: ${name}`, () => {
      expect(run(cmd).code).toBe(2);
    });
  }
});

describe("git-safety-gate — ALLOW classification (exit 0, no regression)", () => {
  const cases: Array<[string, string]> = [
    ["worktree remove without --force (happy path)", "git worktree remove /wt/x"],
    ["worktree list", "git worktree list"],
    ["branch -d (merged-only)", "git branch -d some-branch"],
    ["reset --soft", "git reset --soft HEAD~1"],
    ["restore --staged", "git restore --staged src/a.ts"],
    ["clean -n (dry-run)", "git clean -n"],
    ["stash push", "git stash push -m wip"],
    ["echo mentioning a blocked phrase", 'echo "git reset --hard is dangerous"'],
    ["grep for the phrase", 'grep -r "worktree remove --force" hooks/'],
  ];
  for (const [name, cmd] of cases) {
    it(`allows: ${name}`, () => {
      expect(run(cmd).code).toBe(0);
    });
  }
});

describe("git-safety-gate — PROBE evidence (state-accurate, against a real repo)", () => {
  let repo: string;
  let wtDirty: string;
  let wtClean: string;

  beforeAll(() => {
    const base = mkdtempSync(join(tmpdir(), "gsg-"));
    repo = join(base, "repo");
    mkdirSync(repo);
    git(["init", "-q"], repo);
    git(["config", "user.email", "t@t"], repo);
    git(["config", "user.name", "t"], repo);
    writeFileSync(join(repo, "f.txt"), "v1\n");
    git(["add", "."], repo);
    git(["commit", "-qm", "init"], repo);
    // a merged branch (ancestor of main) + an unmerged branch with a real commit
    git(["branch", "merged-branch"], repo);
    git(["checkout", "-q", "-b", "unmerged-branch"], repo);
    writeFileSync(join(repo, "g.txt"), "x\n");
    git(["add", "."], repo);
    git(["commit", "-qm", "work"], repo);
    git(["checkout", "-q", "main"], repo);
    // a dirty worktree on its own branch, and a clean worktree on the merged branch
    wtDirty = join(base, "wt-dirty");
    wtClean = join(base, "wt-clean");
    git(["worktree", "add", "-q", wtDirty, "-b", "wt-branch"], repo);
    writeFileSync(join(wtDirty, "uncommitted.txt"), "dirty\n");
    git(["worktree", "add", "-q", wtClean, "merged-branch"], repo);
  });

  afterAll(() => {
    if (repo) rmSync(join(repo, ".."), { recursive: true, force: true });
  });

  it("reset --hard on a CLEAN tree reports it as safe (still blocks)", () => {
    const { code, stderr } = run("git reset --hard HEAD", repo);
    expect(code).toBe(2);
    expect(stderr).toMatch(/working tree is CLEAN/);
  });

  it("reset --hard on a DIRTY tree names the at-risk file (still blocks)", () => {
    writeFileSync(join(repo, "scratch.txt"), "wip\n");
    try {
      const { code, stderr } = run("git reset --hard HEAD", repo);
      expect(code).toBe(2);
      expect(stderr).toMatch(/WOULD DESTROY \d+ uncommitted/);
      expect(stderr).toContain("scratch.txt");
    } finally {
      rmSync(join(repo, "scratch.txt"));
    }
  });

  it("branch -D on a MERGED branch reports it already-merged (still blocks)", () => {
    const { code, stderr } = run("git branch -D merged-branch", repo);
    expect(code).toBe(2);
    expect(stderr).toMatch(/already merged/);
  });

  it("branch -D on an UNMERGED branch names the commits that would be lost", () => {
    const { code, stderr } = run("git branch -D unmerged-branch", repo);
    expect(code).toBe(2);
    expect(stderr).toMatch(/WOULD LOSE \d+ unmerged commit/);
  });

  it("worktree remove --force on a DIRTY worktree names the uncommitted file", () => {
    const { code, stderr } = run(`git worktree remove --force ${wtDirty}`, repo);
    expect(code).toBe(2);
    expect(stderr).toMatch(/UNCOMMITTED change/);
    expect(stderr).toContain("uncommitted.txt");
  });

  it("worktree remove --force on a CLEAN+MERGED worktree reports likely-safe (still blocks)", () => {
    const { code, stderr } = run(`git worktree remove --force ${wtClean}`, repo);
    expect(code).toBe(2);
    expect(stderr).toMatch(/Likely SAFE|merged into/);
  });
});
