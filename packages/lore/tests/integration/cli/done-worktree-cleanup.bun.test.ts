/**
 * @spec_ref spec-lore-owns-worktree-cleanup-archive-removes-the-task-s AC-WTC-1
 * @task task-red-for-106-ac-wtc-1-ac-wtc-2-ac-wtc-3
 *
 * AC-WTC-1 (issue #106, rules BR-961 / BR-962): `lore done <task>` removes the
 * worktree the task's claim recorded, with plain `git worktree remove` and
 * `git branch -d` (never force), but ONLY when the predicate holds:
 *   - the recorded path is a linked worktree, clean (no tracked/untracked changes),
 *   - its branch has >= 1 own commit (not in the base at claim time) ALL reachable from main,
 *   - no reflog activity for LORE_WORKTREE_QUIET_MINUTES (default 30),
 *   - not git-locked.
 * Otherwise the worktree is KEPT, `lore done` still exits 0, and the output line
 * `worktree: kept <path>: <reason>` names the reason token:
 *   no-own-commits | uncommitted-changes | unmerged-commits | recent-activity | locked.
 * A worktree no claim recorded is never touched.
 *
 * Throwaway repo + throwaway corpus (`lore init` inside a mkdtemp git repo); never this
 * repo's own `.lore/`. The CLI is spawned from source (`bun run src/index.ts`).
 * Exit codes are measured directly (spawnSync status), never through a pipe.
 *
 * Fixture shape: every case has its OWN task + worktree + branch in ONE repo, so a done
 * on one task also proves it does not touch the others (incl. a removable-but-not-yet-done
 * sibling and a never-claimed worktree).
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..", "..", "..");
const LORE_ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
// BR-1055: LORE_ACTOR is ignored; the writer identity is injected through the session tier.
const SESSION_ID = "7e5d1060-aaaa-bbbb-cccc-111111111111";
const ACTOR = "agent:session-7e5d1060";

interface Run {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly out: string;
}

function baseEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_CODE_SESSION_ID: SESSION_ID, GIT_TERMINAL_PROMPT: "0" };
  // The default (30 min) window must be what an unset env means; never inherit a stray override.
  delete env.LORE_WORKTREE_QUIET_MINUTES;
  return { ...env, ...extra };
}

function exec(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Run {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", env, timeout: 90_000 });
  const stdout = r.stdout ?? "";
  const stderr = r.stderr ?? "";
  return { status: r.status, stdout, stderr, out: `${stdout}${stderr}` };
}

describe("done removes the recorded worktree (#106)", () => {
  let parent = "";
  let repo = "";

  const git = (cwd: string, ...args: string[]): Run => exec("git", args, cwd, baseEnv());
  const lore = (args: string[], env: Record<string, string> = {}): Run =>
    exec("bun", ["run", LORE_ENTRY, ...args], repo, baseEnv(env));

  const mustOk = (r: Run, what: string): Run => {
    if (r.status !== 0) throw new Error(`fixture step failed (${what}): exit ${r.status}\n${r.out}`);
    return r;
  };

  interface Case {
    readonly slug: string;
    readonly path: string;
    readonly branch: string;
  }

  /** New task, linked worktree on a fresh branch, claim recording that worktree, evidence floor. */
  function makeClaimed(name: string): Case {
    const path = join(parent, `wt-${name}`);
    const branch = `wt-${name}`;
    const created = mustOk(lore(["create", "task", "--adhoc", "--title", `Cleanup case ${name}`, "--ac-scope", "", "--json"]), `create ${name}`);
    const slug = JSON.parse(created.stdout).data.slug as string;
    mustOk(git(repo, "worktree", "add", "-q", "-b", branch, path), `worktree add ${name}`);
    mustOk(lore(["claim", slug, "--worktree", path]), `claim ${name}`);
    return { slug, path, branch };
  }

  /** Commit a distinct file inside the worktree (own commit on its branch). */
  function ownCommit(c: Case): void {
    writeFileSync(join(c.path, `own-${c.branch}.txt`), `content of ${c.branch}\n`);
    mustOk(git(c.path, "add", "-A"), `add ${c.branch}`);
    mustOk(git(c.path, "commit", "-q", "-m", `own commit on ${c.branch}`), `commit ${c.branch}`);
  }

  function mergeToMain(c: Case): void {
    mustOk(git(repo, "merge", "-q", "--no-edit", c.branch), `merge ${c.branch}`);
  }

  /** Evidence floor `lore done` needs: an attested (runner-captured) pass. */
  function recordEvidence(c: Case): void {
    mustOk(
      lore(["evidence", c.slug, "--oracle", "test", "--command", "echo 1 passed", "--result", "pass", "--capture"]),
      `evidence ${c.slug}`,
    );
  }

  const done = (c: Case, env: Record<string, string> = {}): Run =>
    lore(["done", c.slug, "--declare-no-new-tests", "worktree cleanup fixture: no tests for this throwaway task"], env);

  const worktreeLine = (r: Run): string => {
    const m = /^worktree:.*$/m.exec(r.stdout) ?? /^worktree:.*$/m.exec(r.out);
    return m ? m[0] : "";
  };

  const branchExists = (branch: string): boolean => git(repo, "branch", "--list", branch).stdout.trim() !== "";

  let removable!: Case;
  let sibling!: Case;
  let zeroCommit!: Case;
  let dirtyUntracked!: Case;
  let dirtyTracked!: Case;
  let unmerged!: Case;
  let recent!: Case;
  let locked!: Case;
  let unclaimedPath = "";
  let unclaimedBranch = "";

  beforeAll(() => {
    parent = realpathSync(mkdtempSync(join(tmpdir(), "lore-wtc-done-")));
    repo = join(parent, "repo");
    mkdirSync(repo);
    mustOk(git(repo, "init", "-q", "-b", "main"), "git init");
    mustOk(git(repo, "config", "user.email", "t@example.com"), "git config email");
    mustOk(git(repo, "config", "user.name", "tester"), "git config name");
    writeFileSync(join(repo, "README.md"), "base\n");
    mustOk(git(repo, "add", "-A"), "git add base");
    mustOk(git(repo, "commit", "-q", "-m", "base"), "git commit base");
    mustOk(lore(["init"]), "lore init");
    mustOk(lore(["create", "prd", "--title", "Root", "--json"]), "create root prd");

    // removable: clean + own commit merged into main + (quiet window disabled by the test's env)
    removable = makeClaimed("removable");
    ownCommit(removable);
    mergeToMain(removable);
    recordEvidence(removable);

    // sibling: ALSO fully removable, claimed, but its task is never archived in this suite.
    sibling = makeClaimed("sibling");
    ownCommit(sibling);
    mergeToMain(sibling);
    recordEvidence(sibling);

    // zero own commits: branch == base, nothing to land.
    zeroCommit = makeClaimed("zero");
    recordEvidence(zeroCommit);

    // uncommitted: merged own commit, then an UNTRACKED file.
    dirtyUntracked = makeClaimed("untracked");
    ownCommit(dirtyUntracked);
    mergeToMain(dirtyUntracked);
    recordEvidence(dirtyUntracked); // evidence refuses a dirty worktree, so dirty it AFTER
    writeFileSync(join(dirtyUntracked.path, "scratch.txt"), "uncommitted\n");

    // uncommitted: merged own commit, then a TRACKED file modified.
    dirtyTracked = makeClaimed("tracked");
    ownCommit(dirtyTracked);
    mergeToMain(dirtyTracked);
    recordEvidence(dirtyTracked);
    writeFileSync(join(dirtyTracked.path, "README.md"), "base\nlocal edit\n");

    // unmerged: own commit exists but main does not contain it.
    unmerged = makeClaimed("unmerged");
    ownCommit(unmerged);
    recordEvidence(unmerged);

    // recent activity: fully removable, but the test runs `done` with the DEFAULT quiet window.
    recent = makeClaimed("recent");
    ownCommit(recent);
    mergeToMain(recent);
    recordEvidence(recent);

    // locked: fully removable apart from `git worktree lock`.
    locked = makeClaimed("locked");
    ownCommit(locked);
    mergeToMain(locked);
    mustOk(git(repo, "worktree", "lock", "--reason", "fixture lock", locked.path), "worktree lock");
    recordEvidence(locked);

    // never claimed: would pass every predicate clause, but no lore claim recorded it.
    unclaimedPath = join(parent, "wt-unclaimed");
    unclaimedBranch = "wt-unclaimed";
    mustOk(git(repo, "worktree", "add", "-q", "-b", unclaimedBranch, unclaimedPath), "unclaimed worktree add");
    writeFileSync(join(unclaimedPath, "own-unclaimed.txt"), "x\n");
    mustOk(git(unclaimedPath, "add", "-A"), "unclaimed add");
    mustOk(git(unclaimedPath, "commit", "-q", "-m", "unclaimed own commit"), "unclaimed commit");
    mustOk(git(repo, "merge", "-q", "--no-edit", unclaimedBranch), "unclaimed merge");
  }, 300_000);

  afterAll(() => {
    if (parent) {
      if (locked) git(repo, "worktree", "unlock", locked.path);
      rmSync(parent, { recursive: true, force: true });
    }
  });

  // ─── HAPPY ────────────────────────────────────────────────────────────────

  it("removes a clean, merged, quiet worktree: directory gone, branch deleted, output says removed, exit 0", () => {
    const r = done(removable, { LORE_WORKTREE_QUIET_MINUTES: "0" });
    expect(r.status).toBe(0);
    expect(worktreeLine(r)).toMatch(/^worktree: removed /);
    expect(worktreeLine(r)).toContain(removable.path);
    expect(existsSync(removable.path)).toBe(false);
    expect(branchExists(removable.branch)).toBe(false);
  }, 120_000);

  it("a removed worktree is gone from `git worktree list` and its merged commit stays reachable from main", () => {
    expect(git(repo, "worktree", "list", "--porcelain").stdout).not.toContain(removable.path);
    const log = git(repo, "log", "--format=%s", "main").stdout;
    expect(log).toContain(`own commit on ${removable.branch}`);
  });

  it("removing one task's worktree leaves another claimed, removable worktree (task not archived) untouched", () => {
    expect(existsSync(sibling.path)).toBe(true);
    expect(branchExists(sibling.branch)).toBe(true);
  });

  // ─── NEGATIVE: each keep reason ──────────────────────────────────────────

  it("keeps a zero-commit branch (never started, not landed): exit 0, reason no-own-commits", () => {
    const r = done(zeroCommit, { LORE_WORKTREE_QUIET_MINUTES: "0" });
    expect(r.status).toBe(0);
    expect(worktreeLine(r)).toMatch(/^worktree: kept /);
    expect(worktreeLine(r)).toContain("no-own-commits");
    expect(existsSync(zeroCommit.path)).toBe(true);
    expect(branchExists(zeroCommit.branch)).toBe(true);
  }, 120_000);

  it("keeps a worktree with an untracked file: exit 0, reason uncommitted-changes", () => {
    const r = done(dirtyUntracked, { LORE_WORKTREE_QUIET_MINUTES: "0" });
    expect(r.status).toBe(0);
    expect(worktreeLine(r)).toMatch(/^worktree: kept /);
    expect(worktreeLine(r)).toContain("uncommitted-changes");
    expect(existsSync(join(dirtyUntracked.path, "scratch.txt"))).toBe(true);
    expect(branchExists(dirtyUntracked.branch)).toBe(true);
  }, 120_000);

  it("keeps a worktree with a modified tracked file: exit 0, reason uncommitted-changes", () => {
    const r = done(dirtyTracked, { LORE_WORKTREE_QUIET_MINUTES: "0" });
    expect(r.status).toBe(0);
    expect(worktreeLine(r)).toMatch(/^worktree: kept /);
    expect(worktreeLine(r)).toContain("uncommitted-changes");
    expect(existsSync(dirtyTracked.path)).toBe(true);
  }, 120_000);

  it("keeps a worktree whose own commit is not reachable from main: exit 0, reason unmerged-commits", () => {
    const r = done(unmerged, { LORE_WORKTREE_QUIET_MINUTES: "0" });
    expect(r.status).toBe(0);
    expect(worktreeLine(r)).toMatch(/^worktree: kept /);
    expect(worktreeLine(r)).toContain("unmerged-commits");
    expect(worktreeLine(r)).toContain(unmerged.path);
    expect(existsSync(unmerged.path)).toBe(true);
    expect(branchExists(unmerged.branch)).toBe(true);
  }, 120_000);

  it("keeps a worktree with reflog activity inside the DEFAULT 30-minute window: exit 0, reason recent-activity", () => {
    // LORE_WORKTREE_QUIET_MINUTES deliberately unset -> default 30; the commit was seconds ago.
    const r = done(recent);
    expect(r.status).toBe(0);
    expect(worktreeLine(r)).toMatch(/^worktree: kept /);
    expect(worktreeLine(r)).toContain("recent-activity");
    expect(existsSync(recent.path)).toBe(true);
    expect(branchExists(recent.branch)).toBe(true);
  }, 120_000);

  it("keeps a git-locked worktree: exit 0, reason locked, lock still in place", () => {
    const r = done(locked, { LORE_WORKTREE_QUIET_MINUTES: "0" });
    expect(r.status).toBe(0);
    expect(worktreeLine(r)).toMatch(/^worktree: kept /);
    expect(worktreeLine(r)).toContain("locked");
    expect(existsSync(locked.path)).toBe(true);
    expect(git(repo, "worktree", "list", "--porcelain").stdout).toContain("locked");
  }, 120_000);

  // ─── STATE / REGRESSION: scope of the cleanup ─────────────────────────────

  it("a worktree no claim recorded is untouched by every done in this suite", () => {
    expect(existsSync(unclaimedPath)).toBe(true);
    expect(branchExists(unclaimedBranch)).toBe(true);
    expect(git(repo, "worktree", "list", "--porcelain").stdout).toContain(unclaimedPath);
  });

  it("the main checkout is never removed and every kept worktree is still registered with git", () => {
    const list = git(repo, "worktree", "list", "--porcelain").stdout;
    expect(existsSync(repo)).toBe(true);
    for (const c of [zeroCommit, dirtyUntracked, dirtyTracked, unmerged, recent, locked]) {
      expect(list).toContain(c.path);
    }
  });

  it("done still archives the task even when its worktree is kept (cleanup never fails archival)", () => {
    const r = lore(["get", unmerged.slug, "--json"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('"status": "archived"');
  }, 120_000);
});
