// @spawns packages/lore/src/index.ts
/**
 * BR-380: `lore seat list` judges "merged" against the SAME base branch `seat remove`
 * uses — the branch the main checkout has checked out — never a literal `main`.
 *
 * Fixtures are throwaway git repos whose trunk is `trunk`, each with its own
 * `lore init` corpus (HOME / XDG_CONFIG_HOME in temp dirs; never the repo's `.lore/`).
 *
 * Coverage:
 *   HAPPY:    a seat merged into `trunk` lists `merged: true`, and `seat remove` removes it without --force
 *   BOUNDARY: a seat with an unmerged commit lists `merged: false` on a trunk repo
 *   STATE:    with the main checkout detached, list exits 0 and reports `merged: null` (not measured), never a guess
 */

import { afterAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

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
  readonly plan: string;
  readonly branch: string;
  readonly seatPath: string;
}

/** Builds a clean `trunk` repo with a corpus and one entered seat. */
function buildWithSeat(label: string): Fixture {
  const base = realpathSync(mkdtempSync(join(tmpdir(), `seat-base-${label}-`)));
  scratch.push(base);
  const repo = join(base, "repo");
  const home = join(base, "home");
  execFileSync("mkdir", ["-p", repo, home]);
  git(repo, ["init", "-q", "-b", "trunk"]);
  git(repo, ["config", "user.email", "seat@example.invalid"]);
  git(repo, ["config", "user.name", "seat test"]);
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
  must(["seat", plan]);
  return { repo, home, plan, branch: `plan/${short}`, seatPath: join(base, `repo-seat-${short}`) };
}

function listJson(fx: Fixture): { result: RunResult; seats: Array<{ branch: string; merged: boolean | null }> } {
  const result = runLore(["seat", "list", "--json"], fx.repo, fx.home);
  const seats = result.exitCode === 0 ? (JSON.parse(result.stdout) as { data: { seats: Array<{ branch: string; merged: boolean | null }> } }).data.seats : [];
  return { result, seats };
}

afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

describe("BR-380 seat list base branch", () => {
  it("(1)(2) a seat merged into trunk lists merged and remove deletes it without --force", () => {
    const fx = buildWithSeat("merged");
    // A fresh seat has no commits beyond trunk: it is merged into trunk.
    const { result, seats } = listJson(fx);
    expect(result.exitCode, result.stderr + result.stdout).toBe(0);
    expect(seats.map((s) => s.branch)).toEqual([fx.branch]);
    expect(seats[0]?.merged).toBe(true);

    const rm = runLore(["seat", "remove", fx.plan], fx.repo, fx.home);
    expect(rm.exitCode, rm.stderr + rm.stdout).toBe(0);
    expect(existsSync(fx.seatPath)).toBe(false);
  }, 180_000);

  it("(1b) a seat with an unmerged commit lists merged false on a trunk repo", () => {
    const fx = buildWithSeat("unmerged");
    git(fx.seatPath, ["config", "user.email", "seat@example.invalid"]);
    git(fx.seatPath, ["config", "user.name", "seat test"]);
    writeFileSync(join(fx.seatPath, "seat-work.txt"), "unmerged work\n");
    git(fx.seatPath, ["add", "seat-work.txt"]);
    git(fx.seatPath, ["commit", "-q", "-m", "seat work"]);

    const { result, seats } = listJson(fx);
    expect(result.exitCode, result.stderr + result.stdout).toBe(0);
    expect(seats[0]?.merged).toBe(false);
  }, 180_000);

  it("(3) with the main checkout detached, list exits 0 and reports merged as not measured", () => {
    const fx = buildWithSeat("detached");
    git(fx.repo, ["checkout", "-q", "--detach"]);

    const { result, seats } = listJson(fx);
    expect(result.exitCode, result.stderr + result.stdout).toBe(0);
    expect(seats.map((s) => s.branch)).toEqual([fx.branch]);
    expect(seats[0]?.merged).toBeNull();

    const text = runLore(["seat", "list"], fx.repo, fx.home);
    expect(text.exitCode, text.stderr).toBe(0);
    expect(text.stdout).toContain("not measured");
  }, 180_000);
});
