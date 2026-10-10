/**
 * @spec_ref spec-lore-owns-worktree-cleanup-archive-removes-the-task-s AC-WTC-2
 * @task task-red-for-106-ac-wtc-1-ac-wtc-2-ac-wtc-3
 *
 * AC-WTC-2 (issue #106, rules BR-961 / BR-962): `lore worktree sweep [--apply] [--json]`
 *   - lists every claim-recorded worktree of ARCHIVED/DEPRECATED tasks with a decision
 *     (remove | keep | not-measured | gone) and a reason;
 *   - without --apply it changes nothing (`git worktree list --porcelain` byte-identical);
 *   - with --apply it removes exactly the `remove` rows;
 *   - a worktree no claim recorded is never listed or touched;
 *   - a recorded path that is not a git worktree (a plain directory) is `not-measured`,
 *     never `remove` (no silent fallback when the git probe fails).
 *
 * JSON shape: { ok: true, data: { rows: [{ task, worktree, decision, reason }] } }.
 *
 * Throwaway repo + throwaway corpus; never this repo's own `.lore/`. CLI spawned from source.
 *
 * Fixture timing: every task is archived with the DEFAULT 30-minute quiet window (so even a
 * `lore done` that already implements cleanup keeps the freshly-committed worktrees as
 * recent-activity); the sweep then runs with LORE_WORKTREE_QUIET_MINUTES=0 so "quiet" is
 * deterministic and the remove/keep split is decided by the other predicate clauses only.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..", "..", "..");
const LORE_ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const ACTOR = "agent:tester-106";

interface Run {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly out: string;
}

interface SweepRow {
  readonly task: string;
  readonly worktree: string;
  readonly decision: string;
  readonly reason: string;
}

function baseEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, LORE_ACTOR: ACTOR, GIT_TERMINAL_PROMPT: "0" };
  delete env.LORE_WORKTREE_QUIET_MINUTES;
  return { ...env, ...extra };
}

function exec(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Run {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", env, timeout: 90_000 });
  const stdout = r.stdout ?? "";
  const stderr = r.stderr ?? "";
  return { status: r.status, stdout, stderr, out: `${stdout}${stderr}` };
}

describe("worktree sweep (#106)", () => {
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

  function newTask(name: string): string {
    const created = mustOk(lore(["create", "task", "--adhoc", "--title", `Sweep case ${name}`, "--ac-scope", "", "--json"]), `create ${name}`);
    return JSON.parse(created.stdout).data.slug as string;
  }

  function makeWorktreeClaim(name: string): Case {
    const path = join(parent, `wt-${name}`);
    const branch = `wt-${name}`;
    const slug = newTask(name);
    mustOk(git(repo, "worktree", "add", "-q", "-b", branch, path), `worktree add ${name}`);
    mustOk(lore(["claim", slug, "--by", ACTOR, "--worktree", path]), `claim ${name}`);
    return { slug, path, branch };
  }

  function ownCommitMerged(path: string, branch: string): void {
    writeFileSync(join(path, `own-${branch}.txt`), `content of ${branch}\n`);
    mustOk(git(path, "add", "-A"), `add ${branch}`);
    mustOk(git(path, "commit", "-q", "-m", `own commit on ${branch}`), `commit ${branch}`);
    mustOk(git(repo, "merge", "-q", "--no-edit", branch), `merge ${branch}`);
  }

  const evidence = (slug: string): void => {
    mustOk(
      lore(["evidence", slug, "--oracle", "test", "--command", "echo 1 passed", "--result", "pass", "--capture"]),
      `evidence ${slug}`,
    );
  };

  const archive = (slug: string): void => {
    mustOk(lore(["done", slug, "--declare-no-new-tests", "sweep fixture: throwaway task, no tests"]), `done ${slug}`);
  };

  const porcelain = (): string => git(repo, "worktree", "list", "--porcelain").stdout;

  function sweepJson(apply: boolean, env: Record<string, string> = { LORE_WORKTREE_QUIET_MINUTES: "0" }): { run: Run; rows: SweepRow[] } {
    const args = ["worktree", "sweep", "--json", ...(apply ? ["--apply"] : [])];
    const run = lore(args, env);
    let rows: SweepRow[] = [];
    try {
      rows = JSON.parse(run.stdout).data.rows as SweepRow[];
    } catch {
      rows = [];
    }
    return { run, rows };
  }

  const rowFor = (rows: readonly SweepRow[], c: { slug: string }): SweepRow | undefined => rows.find((r) => r.task === c.slug);
  const decisionOf = (rows: readonly SweepRow[], c: { slug: string }): string | undefined => rowFor(rows, c)?.decision;

  let removable!: Case;
  let zeroCommit!: Case;
  let dirty!: Case;
  let plainDir!: { slug: string; path: string };
  let active!: Case;
  let unclaimedPath = "";

  beforeAll(() => {
    parent = realpathSync(mkdtempSync(join(tmpdir(), "lore-wtc-sweep-")));
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

    // removable: clean + own commit merged into main.
    removable = makeWorktreeClaim("removable");
    ownCommitMerged(removable.path, removable.branch);
    evidence(removable.slug);

    // zero own commits -> keep (no-own-commits).
    zeroCommit = makeWorktreeClaim("zero");
    evidence(zeroCommit.slug);

    // merged own commit, then an untracked file -> keep (uncommitted-changes).
    dirty = makeWorktreeClaim("dirty");
    ownCommitMerged(dirty.path, dirty.branch);
    evidence(dirty.slug); // evidence refuses a dirty worktree, so dirty it AFTER
    writeFileSync(join(dirty.path, "scratch.txt"), "uncommitted\n");

    // claim recorded a PLAIN DIRECTORY that is not a git worktree -> not-measured.
    const plainPath = join(parent, "plain-dir");
    mkdirSync(plainPath);
    writeFileSync(join(plainPath, "keep-me.txt"), "not a worktree\n");
    const plainSlug = newTask("plain");
    mustOk(lore(["claim", plainSlug, "--by", ACTOR, "--worktree", plainPath]), "claim plain");
    evidence(plainSlug);
    plainDir = { slug: plainSlug, path: plainPath };

    // fully removable worktree whose task is NOT archived (never done) -> not listed.
    active = makeWorktreeClaim("active");
    ownCommitMerged(active.path, active.branch);
    evidence(active.slug);

    // never claimed by lore, otherwise removable -> never listed or touched.
    unclaimedPath = join(parent, "wt-unclaimed");
    mustOk(git(repo, "worktree", "add", "-q", "-b", "wt-unclaimed", unclaimedPath), "unclaimed add");
    ownCommitMerged(unclaimedPath, "wt-unclaimed");

    // Archive with the DEFAULT quiet window (see header).
    for (const c of [removable, zeroCommit, dirty, plainDir]) archive(c.slug);
  }, 300_000);

  afterAll(() => {
    if (parent) rmSync(parent, { recursive: true, force: true });
  });

  // ─── report-only (default) ────────────────────────────────────────────────

  it("without --apply: exits 0, emits an ok envelope with rows, and a remove row for the clean merged quiet worktree", () => {
    const { run, rows } = sweepJson(false);
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout).ok).toBe(true);
    expect(decisionOf(rows, removable)).toBe("remove");
    expect(rowFor(rows, removable)?.worktree).toBe(removable.path);
  }, 120_000);

  it("without --apply: `git worktree list --porcelain` is byte-identical before and after, and every directory remains", () => {
    const before = porcelain();
    const { run } = sweepJson(false);
    expect(run.status).toBe(0);
    expect(porcelain()).toBe(before);
    expect(existsSync(removable.path)).toBe(true);
    expect(git(repo, "branch", "--list", removable.branch).stdout.trim()).not.toBe("");
  }, 120_000);

  it("without --apply and in text mode: also changes nothing, exits 0, one line per row naming task and decision", () => {
    const before = porcelain();
    const run = lore(["worktree", "sweep"], { LORE_WORKTREE_QUIET_MINUTES: "0" });
    expect(run.status).toBe(0);
    expect(porcelain()).toBe(before);
    const line = run.stdout.split("\n").find((l) => l.includes(removable.slug)) ?? "";
    expect(line).toContain("remove");
    expect(run.stdout.split("\n").filter((l) => l.includes(removable.slug)).length).toBe(1);
  }, 120_000);

  it("keeps a zero-commit worktree with reason no-own-commits", () => {
    const row = rowFor(sweepJson(false).rows, zeroCommit);
    expect(row?.decision).toBe("keep");
    expect(row?.reason).toContain("no-own-commits");
  }, 120_000);

  it("keeps a worktree with uncommitted changes with reason uncommitted-changes", () => {
    const row = rowFor(sweepJson(false).rows, dirty);
    expect(row?.decision).toBe("keep");
    expect(row?.reason).toContain("uncommitted-changes");
  }, 120_000);

  it("with the DEFAULT quiet window the freshly-committed removable worktree is kept as recent-activity, not removed", () => {
    const row = rowFor(sweepJson(false, {}).rows, removable);
    expect(row?.decision).toBe("keep");
    expect(row?.reason).toContain("recent-activity");
  }, 120_000);

  // ─── scope: what is / is not listed ───────────────────────────────────────

  it("a recorded path that is not a git worktree is not-measured with a non-empty reason, never remove", () => {
    const row = rowFor(sweepJson(false).rows, plainDir);
    expect(row?.decision).toBe("not-measured");
    expect((row?.reason ?? "").length).toBeGreaterThan(0);
  }, 120_000);

  it("a worktree no claim recorded is not listed (neither in JSON rows nor in text output)", () => {
    const { rows } = sweepJson(false);
    expect(rows.some((r) => r.worktree === unclaimedPath)).toBe(false);
    const text = lore(["worktree", "sweep"], { LORE_WORKTREE_QUIET_MINUTES: "0" });
    expect(text.stdout).not.toContain("wt-unclaimed");
  }, 120_000);

  it("a claimed worktree whose task is not archived/deprecated is not listed", () => {
    expect(rowFor(sweepJson(false).rows, active)).toBeUndefined();
  }, 120_000);

  it("lists exactly the four archived tasks' recorded worktrees (no more, no fewer)", () => {
    const { rows } = sweepJson(false);
    expect(rows.map((r) => r.task).sort()).toEqual([removable.slug, zeroCommit.slug, dirty.slug, plainDir.slug].sort());
  }, 120_000);

  // ─── --apply ──────────────────────────────────────────────────────────────

  it("--apply removes exactly the remove rows and nothing else", () => {
    const planned = sweepJson(false).rows.filter((r) => r.decision === "remove").map((r) => r.worktree);
    expect(planned).toEqual([removable.path]); // guards against a vacuous "removes exactly {}"
    const before = porcelain();

    const { run } = sweepJson(true);
    expect(run.status).toBe(0);

    // the remove row: directory gone, branch deleted with -d, unregistered from git
    expect(existsSync(removable.path)).toBe(false);
    expect(git(repo, "branch", "--list", removable.branch).stdout.trim()).toBe("");
    const after = porcelain();
    expect(after).not.toContain(removable.path);

    // every other worktree entry is byte-for-byte preserved in git's list
    const entries = (s: string): string[] => s.split("\n\n").map((e) => e.trim()).filter((e) => e !== "");
    const expected = entries(before).filter((e) => !e.includes(removable.path));
    expect(entries(after)).toEqual(expected);

    // keep / not-measured / unlisted worktrees untouched on disk
    expect(existsSync(zeroCommit.path)).toBe(true);
    expect(existsSync(join(dirty.path, "scratch.txt"))).toBe(true);
    expect(readFileSync(join(plainDir.path, "keep-me.txt"), "utf8")).toBe("not a worktree\n");
    expect(existsSync(active.path)).toBe(true);
    expect(existsSync(unclaimedPath)).toBe(true);
  }, 180_000);

  it("--apply never loses the merged commit: it is still reachable from main after the removal", () => {
    expect(git(repo, "log", "--format=%s", "main").stdout).toContain(`own commit on ${removable.branch}`);
  });

  it("a second --apply is idempotent: exits 0, never lists a remove row again, and leaves kept worktrees alone", () => {
    const { run, rows } = sweepJson(true);
    expect(run.status).toBe(0);
    expect(rows.filter((r) => r.decision === "remove")).toEqual([]);
    expect(existsSync(zeroCommit.path)).toBe(true);
    expect(existsSync(dirty.path)).toBe(true);
    expect(existsSync(plainDir.path)).toBe(true);
  }, 180_000);

  // ─── ERROR ────────────────────────────────────────────────────────────────

  it("`lore worktree sweep --json` is a registered command that exits 0 and returns a non-empty rows array", () => {
    const { run, rows } = sweepJson(false);
    expect(run.status).toBe(0);
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  }, 120_000);
});
