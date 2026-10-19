// @spawns packages/lore/src/index.ts
// @reads assets/project/reference-transaction
/**
 * @spec_ref spec-lore-owns-worktree-cleanup-archive-removes-the-task-s AC-WTC-1
 * @task task-red-for-106-ac-wtc-1-ac-wtc-2-ac-wtc-3
 *
 * AC-WTC-1 (issue #106, rules BR-961 / BR-962): `lore done <task>` removes the
 * worktree the task's claim recorded, with plain `git worktree remove` and
 * `git branch -d` (never force), but ONLY when the predicate holds:
 *   - the recorded path is a linked worktree, clean (no tracked/untracked changes),
 *   - its branch has >= 1 own commit (not in the base at claim time) ALL reachable from main,
 *   - (RE-BASELINE task-single-worktree-removal-test-used-by-the-hook-lore-done, AC-WS-5: the 30-minute quiet window
 *     is DELETED — occupancy decides, see done-worktree-cleanup-compiled.bun.test.ts; a commit seconds old is removable)
 *   - not git-locked.
 * Otherwise the worktree is KEPT, `lore done` still exits 0, and the output line
 * `worktree: kept <path>: <reason>` names the reason token:
 *   no-own-commits | uncommitted-changes | unmerged-commits | locked.
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

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { installShippedGuard } from "../support/main-guard-repo.js";

const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..");
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
  delete env.LORE_WORKTREE_QUIET_MINUTES; // retired knob: even an inherited value must change nothing
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

  /**
   * Lands the branch through `lore integrate` (the only way main advances), which records the landing `lore done`
   * requires on the claiming task (BR-1291, BR-1336). A branch with no commit past main is "already integrated" and
   * records the landing the same way.
   */
  /** `lore integrate` refuses to run without the main-ref guard, and the shared checkout is a detached view of main (BR-1273). */
  function armGuard(): void {
    mustOk(git(repo, "checkout", "-q", "--detach", "main"), "detach shared checkout");
    installShippedGuard(repo, join(repo, ".git", "guard-hooks"));
  }

  function mergeToMain(c: Case): void {
    armGuard();
    mustOk(lore(["integrate", c.branch, "--session", "wtc-fixture-session"]), `integrate ${c.branch}`);
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
    // `lore integrate` keeps its own worktree under `.claude/` and needs the floor key; neither may dirty the tree
    appendFileSync(join(repo, ".git", "info", "exclude"), ".claude/\n.lore/integrate-attempts/\n.lore/integrate-losses/\n");
    appendFileSync(join(repo, ".lore", "config.yaml"), 'workflow:\n  integrate:\n    floor_command: "true"\n', "utf8");
    // reason: `lore init` arms state binding (AC-CT-3); a captured pass on a dirty tree is unbound and
    // refused by `lore done`, so the corpus scaffold is committed before any evidence is captured.
    mustOk(git(repo, "add", "-A"), "git add corpus");
    mustOk(git(repo, "commit", "-q", "-m", "lore corpus"), "git commit corpus");
    mustOk(lore(["create", "prd", "--title", "Root", "--json"]), "create root prd");

    // removable: clean + own commit merged into main + 
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
    mergeToMain(zeroCommit); // nothing past main: integrate finds it already integrated and records the landing
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

    // seconds-old commit: fully removable — elapsed time is never consulted.
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
    armGuard();
    // no task belongs to this branch, which `lore integrate` refuses (BR-1348); main reaches it the way integrate's CAS
    // moves it (the reference-transaction guard lets a ref update carrying the integrate marker through)
    const tip = git(repo, "rev-parse", unclaimedBranch).stdout.trim();
    mustOk(exec("git", ["update-ref", "refs/heads/main", tip], repo, baseEnv({ LORE_INTEGRATE: "1" })), "unclaimed branch to main");
  }, 300_000);

  afterAll(() => {
    if (parent) {
      if (locked) git(repo, "worktree", "unlock", locked.path);
      rmSync(parent, { recursive: true, force: true });
    }
  });

  // ─── HAPPY ────────────────────────────────────────────────────────────────

  it("removes a clean, merged, quiet worktree: directory gone, branch deleted, output says removed, exit 0", () => {
    const r = done(removable);
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
    const r = done(zeroCommit);
    expect(r.status).toBe(0);
    expect(worktreeLine(r)).toMatch(/^worktree: kept /);
    expect(worktreeLine(r)).toContain("no-own-commits");
    expect(existsSync(zeroCommit.path)).toBe(true);
    expect(branchExists(zeroCommit.branch)).toBe(true);
  }, 120_000);

  it("keeps a worktree with an untracked file: exit 0, reason uncommitted-changes", () => {
    const r = done(dirtyUntracked);
    expect(r.status).toBe(0);
    expect(worktreeLine(r)).toMatch(/^worktree: kept /);
    expect(worktreeLine(r)).toContain("uncommitted-changes");
    expect(existsSync(join(dirtyUntracked.path, "scratch.txt"))).toBe(true);
    expect(branchExists(dirtyUntracked.branch)).toBe(true);
  }, 120_000);

  it("keeps a worktree with a modified tracked file: exit 0, reason uncommitted-changes", () => {
    const r = done(dirtyTracked);
    expect(r.status).toBe(0);
    expect(worktreeLine(r)).toMatch(/^worktree: kept /);
    expect(worktreeLine(r)).toContain("uncommitted-changes");
    expect(existsSync(dirtyTracked.path)).toBe(true);
  }, 120_000);

  // reason: DCL-1 (a) / #171 supersedes the old "exit 0, kept: unmerged-commits" result — `lore done` no longer
  // archives a task whose work lore integrate has not landed, so the cleanup is never reached for it (BR-1291).
  it("refuses a task whose own commit is not landed: exit 4 [floor: not-landed], worktree and branch untouched", () => {
    const r = done(unmerged);
    expect(r.status).toBe(4);
    expect(r.out).toContain("[floor: not-landed]");
    expect(existsSync(unmerged.path)).toBe(true);
    expect(branchExists(unmerged.branch)).toBe(true);
  }, 120_000);

  it("removes a worktree whose last commit is seconds old: no elapsed-time clause exists (RE-BASELINE, spec-one-worktree-removal-test-for-the-guard-lore-done-and-a#AC-WS-5)", () => {
    const r = done(recent);
    expect(r.status).toBe(0);
    expect(worktreeLine(r)).toBe(`worktree: removed ${recent.path}`);
    expect(r.out).not.toContain("recent-activity");
    expect(existsSync(recent.path)).toBe(false);
    expect(branchExists(recent.branch)).toBe(false);
  }, 120_000);

  it("keeps a git-locked worktree: exit 0, reason locked, lock still in place", () => {
    const r = done(locked);
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
    for (const c of [zeroCommit, dirtyUntracked, dirtyTracked, unmerged, locked]) {
      expect(list).toContain(c.path);
    }
  });

  it("done still archives the task even when its worktree is kept (cleanup never fails archival)", () => {
    const r = lore(["get", dirtyTracked.slug, "--json"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('"status": "archived"');
  }, 120_000);
});
