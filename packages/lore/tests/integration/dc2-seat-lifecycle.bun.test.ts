// @spawns packages/lore/src/index.ts
/**
 * @spec_ref spec-defect-clusters-round-2-part-a-sessions-seats-setup-init
 *           D2, spec-defect-clusters-round-2-part-a-sessions-seats-setup-init#AC-DC2-2
 *
 * A seat is a plan's seat, and removing it removes worktree AND branch.
 *
 * Fixtures are throwaway git repos with their own `lore init` corpus (HOME and
 * XDG_CONFIG_HOME in temp dirs; never the repo's `.lore/`), driven through the
 * real CLI. Main is kept CLEAN (everything committed) so a refusal can only come
 * from the rule under test, never from a dirty main.
 *
 * Coverage:
 *   NEGATIVE:   a PRD target is refused exit 4 `gate:seat-entry:not-a-plan`, git state unchanged
 *   HAPPY:      enter + merged remove deletes the worktree path AND the plan/<short> branch
 *   ERROR:      a second remove is `gate:seat-remove:not-found` and never says "seat entry step"
 *   BOUNDARY:   a repo whose checked-out branch is `trunk` (no `main`): --force removes an unmerged
 *               seat, no --force refuses with `gate:seat-remove:unmerged`
 */

import { afterAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const SPEC = "spec-defect-clusters-round-2-part-a-sessions-seats-setup-init";
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

const scratch: string[] = [];

function runLore(args: string[], cwd: string, home: string): RunResult {
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, ".config"), CLAUDECODE: "1" } as Record<string, string>;
  const proc = Bun.spawnSync(["bun", "run", ENTRY, ...args], { cwd, env });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }).trim();
}

function slugOf(stdout: string): string {
  const m = stdout.match(/Slug:\s+(\S+)/);
  if (!m?.[1]) throw new Error(`no slug in: ${stdout}`);
  return m[1];
}

interface Fixture {
  readonly repo: string;
  readonly home: string;
  readonly prd: string;
  readonly plan: string;
  readonly short: string;
  readonly seatPath: string;
}

function build(mainBranch: string, label: string): Fixture {
  const base = realpathSync(mkdtempSync(join(tmpdir(), `dc2-seat-${label}-`)));
  scratch.push(base);
  const repo = join(base, "repo");
  const home = join(base, "home");
  execFileSync("mkdir", ["-p", repo, home]);
  git(repo, ["init", "-q", "-b", mainBranch]);
  git(repo, ["config", "user.email", "dc2@example.invalid"]);
  git(repo, ["config", "user.name", "dc2 test"]);
  writeFileSync(join(repo, "README.md"), "fixture\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "-m", "init"]);

  const must = (args: string[]): RunResult => {
    const r = runLore(args, repo, home);
    if (r.exitCode !== 0) throw new Error(`fixture lore ${args.join(" ")} failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
    return r;
  };
  must(["init"]);
  const prd = slugOf(must(["create", "prd", "--title", "Seat PRD", "--content", "root", "--no-ai"]).stdout);
  const plan = slugOf(must(["create", "plan", "--title", "Seat Plan", "--parent", prd, "--content", "x", "--no-ai"]).stdout);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "corpus"]);
  const short = plan.replace(/^plan-/, "");
  return { repo, home, prd, plan, short, seatPath: join(base, `repo-seat-${short}`) };
}

function branches(repo: string): string {
  return git(repo, ["branch", "--list", "plan/*"]);
}

afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

describe(`${SPEC}#AC-DC2-2 seat lifecycle`, () => {
  it(`${SPEC}#AC-DC2-2 (a) a non-plan target is refused exit 4 and git state is unchanged`, () => {
    const fx = build("main", "a");
    const branchesBefore = branches(fx.repo);
    const worktreesBefore = git(fx.repo, ["worktree", "list", "--porcelain"]);
    expect(git(fx.repo, ["status", "--porcelain"])).toBe("");

    const r = runLore(["seat", fx.prd], fx.repo, fx.home);
    expect(r.exitCode, r.stderr).toBe(4);
    expect(r.stderr).toContain("gate:seat-entry:not-a-plan");
    expect(r.stderr).toContain("prd");
    expect(branches(fx.repo)).toBe(branchesBefore);
    expect(git(fx.repo, ["worktree", "list", "--porcelain"])).toBe(worktreesBefore);
  }, 180_000);

  it(`${SPEC}#AC-DC2-2 (b)(c) remove deletes worktree and branch; a second remove is not-found and not an entry-step error`, () => {
    const fx = build("main", "bc");
    const enter = runLore(["seat", fx.plan], fx.repo, fx.home);
    expect(enter.exitCode, enter.stderr + enter.stdout).toBe(0);
    expect(existsSync(fx.seatPath)).toBe(true);
    expect(branches(fx.repo)).toContain(`plan/${fx.short}`);

    const rm = runLore(["seat", "remove", fx.plan], fx.repo, fx.home);
    expect(rm.exitCode, rm.stderr + rm.stdout).toBe(0);
    expect(existsSync(fx.seatPath)).toBe(false);
    expect(branches(fx.repo)).not.toContain(`plan/${fx.short}`);
    expect(branches(fx.repo)).toBe("");

    const again = runLore(["seat", "remove", fx.plan], fx.repo, fx.home);
    expect(again.exitCode, again.stderr).toBe(4);
    expect(again.stderr).toContain("gate:seat-remove:not-found");
    expect(again.stderr).not.toContain("seat entry step");
  }, 180_000);

  it(`${SPEC}#AC-DC2-2 (d) on a trunk-only repo --force removes an unmerged seat; without --force it is refused unmerged`, () => {
    const fx = build("trunk", "d");
    const enter = runLore(["seat", fx.plan], fx.repo, fx.home);
    expect(enter.exitCode, enter.stderr + enter.stdout).toBe(0);
    // An unmerged commit on the seat branch (made inside the seat worktree).
    git(fx.seatPath, ["config", "user.email", "dc2@example.invalid"]);
    git(fx.seatPath, ["config", "user.name", "dc2 test"]);
    writeFileSync(join(fx.seatPath, "seat-work.txt"), "unmerged work\n");
    git(fx.seatPath, ["add", "seat-work.txt"]);
    git(fx.seatPath, ["commit", "-q", "-m", "seat work"]);
    expect(git(fx.repo, ["branch", "--list", "main"])).toBe("");

    const refused = runLore(["seat", "remove", fx.plan], fx.repo, fx.home);
    expect(refused.exitCode, refused.stderr).toBe(4);
    expect(refused.stderr).toContain("gate:seat-remove:unmerged");
    expect(existsSync(fx.seatPath)).toBe(true);
    expect(branches(fx.repo)).toContain(`plan/${fx.short}`);

    const forced = runLore(["seat", "remove", fx.plan, "--force"], fx.repo, fx.home);
    expect(forced.exitCode, forced.stderr + forced.stdout).toBe(0);
    expect(existsSync(fx.seatPath)).toBe(false);
    expect(branches(fx.repo)).toBe("");
  }, 180_000);
});
