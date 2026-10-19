// @spawns packages/lore/src/index.ts
/**
 * An owned-by site mapping that points at a leaf inside the lease's corpus scope is authorized on ANY leaf
 * (task-skill-fix-an-owned-by-site-mapping-that-points-at-a-leaf).
 *
 * A `non-business:owned-by <L> BR-n — reason` row only points coverage at L; it cannot add, change or retire another
 * leaf's rules. So a lease scoped to branch B may write such rows on leaves outside B when every row names a leaf in B
 * that itself maps the site to a live rule. Anything else stays refused (exit 4, names the mapped leaf, writes nothing).
 *
 * Fixture: mkdtemp git repo + own `lore init` corpus + linked worktree; the real CLI is driven from the worktree.
 *
 * Coverage:
 *   HAPPY:      owned-by rows naming an in-scope, site-mapping leaf -> exit 0 on a leaf outside the scope, one new version
 *   NEGATIVE:   one extra rule row / owner outside scope / owner that does not map the site -> exit 4, names the leaf, no write
 *   BOUNDARY:   a removal alongside an owned-by row is not an owned-by-only write -> exit 4
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withSessionIdentity } from "../helpers/session-actor";
import { patchLoreConfig } from "../helpers/patch-lore-config.js";

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const FOREIGN_TOKEN = "gate:corpus-write:foreign-provenance";
const SITE = "shared.ts#refuse#CODE";
const RULE_FLAGS = ["--confidence", "established", "--enforced-by", "guaranteed", "--example", "ex"];

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function runLore(args: string[], cwd: string, actor?: string): RunResult {
  const env = withSessionIdentity({ ...process.env, HOME: cwd, CLAUDECODE: "1" }, actor ?? null) as Record<string, string>;
  const proc = Bun.spawnSync(["bun", "run", ENTRY, ...args], { cwd, env });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function mustRun(args: string[], cwd: string, actor?: string): RunResult {
  const r = runLore(args, cwd, actor);
  if (r.exitCode !== 0) throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }).trim();
}

function slugOf(stdout: string): string {
  const m = stdout.match(/Slug:\s+(\S+)/) ?? stdout.match(/Created baseline \w+ (\S+) \(/);
  if (!m?.[1]) throw new Error(`no slug in: ${stdout}`);
  return m[1];
}

function ruleIdOf(stdout: string): string {
  const m = stdout.match(/\bBR-\d+\b/);
  if (!m) throw new Error(`no rule id in: ${stdout}`);
  return m[0];
}

interface Fixture {
  readonly repo: string;
  readonly worktrees: string;
  readonly wt: string;
  readonly outsideLeaf: string;
  readonly outsideRule: string;
  readonly ownerIn: string;
  readonly ownerInRule: string;
  readonly ownerNoMap: string;
  readonly ownerNoMapRule: string;
  readonly ownerOut: string;
  readonly ownerOutRule: string;
}

const scratch: string[] = [];
let fx: Fixture;

function leafVersion(leaf: string): number {
  return (JSON.parse(mustRun(["get", leaf, "--json"], fx.repo).stdout) as { data: { doc: { version: number } } }).data.doc.version;
}

function ownedBy(leaf: string, rule: string): string {
  return `owned-by ${leaf} ${rule} — the owner leaf refuses this site`;
}

function rowsFile(name: string, rows: unknown[]): string {
  const path = join(fx.worktrees, `${name}.json`);
  writeFileSync(path, JSON.stringify(rows));
  return path;
}

function buildFixture(): Fixture {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "obm-repo-")));
  const worktrees = realpathSync(mkdtempSync(join(tmpdir(), "obm-wt-")));
  scratch.push(repo, worktrees);
  if (repo.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");

  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "obm@example.invalid"]);
  git(repo, ["config", "user.name", "obm test"]);
  writeFileSync(join(repo, "README.md"), "fixture\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "-m", "init"]);

  mustRun(["init"], repo);
  patchLoreConfig(
    repo,
    ["workflow:", "  gates:", "    plan-promote:", "      enabled: false", "    task-claim:", "      enabled: false", ""].join("\n"),
  );

  const prd = slugOf(mustRun(["create", "prd", "--title", "OBM PRD", "--content", "root", "--no-ai"], repo).stdout);
  const root = slugOf(mustRun(["baseline", "add", prd, "--node", "root", "--label", "root", "--title", "OBM Root"], repo).stdout);
  const branchB = slugOf(mustRun(["baseline", "add", root, "--node", "branch", "--label", "bb", "--title", "OBM Branch B"], repo).stdout);
  const branchC = slugOf(mustRun(["baseline", "add", root, "--node", "branch", "--label", "bc", "--title", "OBM Branch C"], repo).stdout);
  const leaf = (parent: string, label: string): string =>
    slugOf(mustRun(["baseline", "add", parent, "--node", "leaf", "--label", label, "--title", `OBM Leaf ${label}`], repo).stdout);
  const rule = (l: string): string => ruleIdOf(mustRun(["rule", "add", l, "--statement", `Rule of ${l} holds`, ...RULE_FLAGS], repo).stdout);

  const ownerIn = leaf(branchB, "oin");
  const ownerNoMap = leaf(branchB, "onm");
  const outsideLeaf = leaf(branchC, "out");
  const ownerOut = leaf(branchC, "oout");
  const ownerInRule = rule(ownerIn);
  const ownerNoMapRule = rule(ownerNoMap);
  const outsideRule = rule(outsideLeaf);
  const ownerOutRule = rule(ownerOut);
  // the owners that DO map the site, each to a live rule of its own
  mustRun(["baseline", "map", ownerIn, "--site", SITE, "--rule", ownerInRule], repo);
  mustRun(["baseline", "map", ownerOut, "--site", SITE, "--rule", ownerOutRule], repo);

  const plan = slugOf(mustRun(["create", "plan", "--title", "OBM Plan", "--parent", prd, "--content", "x", "--no-ai"], repo).stdout);
  const task = slugOf(mustRun(["create", "task", "--title", "OBM Task", "--parent", plan, "--plan-id", plan, "--content", "x", "--no-ai"], repo).stdout);
  const wt = join(worktrees, "scoped");
  git(repo, ["worktree", "add", "-q", "-b", "obm-scoped", wt]);
  const claim = runLore(["claim", task, "--worktree", wt, "--corpus-scope", branchB], wt, "agent:obm");
  if (claim.exitCode !== 0) throw new Error(`claim failed: ${claim.stderr}${claim.stdout}`);
  return { repo, worktrees, wt, outsideLeaf, outsideRule, ownerIn, ownerInRule, ownerNoMap, ownerNoMapRule, ownerOut, ownerOutRule };
}

beforeAll(() => {
  fx = buildFixture();
}, 180_000);

afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

function mapFromWorktree(file: string): RunResult {
  return runLore(["baseline", "map", fx.outsideLeaf, "--sites-file", file], fx.wt, "agent:obm");
}

describe("owned-by site mapping authority", () => {
  it("HAPPY: owned-by rows naming an in-scope leaf that maps the site are written on a leaf outside the scope", () => {
    const before = leafVersion(fx.outsideLeaf);
    const r = mapFromWorktree(rowsFile("happy", [{ site: SITE, nonBusiness: ownedBy(fx.ownerIn, fx.ownerInRule) }]));
    expect(r.exitCode, r.stderr + r.stdout).toBe(0);
    expect(leafVersion(fx.outsideLeaf)).toBe(before + 1);
  }, 180_000);

  it("NEGATIVE: the same owned-by row plus one rule row is refused (exit 4), names the leaf, writes nothing", () => {
    const before = leafVersion(fx.outsideLeaf);
    const r = mapFromWorktree(
      rowsFile("with-rule", [
        { site: SITE, nonBusiness: ownedBy(fx.ownerIn, fx.ownerInRule) },
        { site: "other.ts#fn#CODE", rules: [fx.outsideRule] },
      ]),
    );
    expect(r.exitCode).toBe(4);
    expect(r.stderr + r.stdout).toContain(FOREIGN_TOKEN);
    expect(r.stderr + r.stdout).toContain(fx.outsideLeaf);
    expect(leafVersion(fx.outsideLeaf)).toBe(before);
  }, 180_000);

  it("NEGATIVE: an owned-by row naming a leaf outside the scope is refused (exit 4), names the leaf, writes nothing", () => {
    const before = leafVersion(fx.outsideLeaf);
    const r = mapFromWorktree(rowsFile("owner-out", [{ site: SITE, nonBusiness: ownedBy(fx.ownerOut, fx.ownerOutRule) }]));
    expect(r.exitCode).toBe(4);
    expect(r.stderr + r.stdout).toContain(fx.outsideLeaf);
    expect(leafVersion(fx.outsideLeaf)).toBe(before);
  }, 180_000);

  it("NEGATIVE: an owned-by row naming an in-scope leaf that does not map the site is refused (exit 4), writes nothing", () => {
    const before = leafVersion(fx.outsideLeaf);
    const r = mapFromWorktree(rowsFile("owner-nomap", [{ site: SITE, nonBusiness: ownedBy(fx.ownerNoMap, fx.ownerNoMapRule) }]));
    expect(r.exitCode).toBe(4);
    expect(r.stderr + r.stdout).toContain(fx.outsideLeaf);
    expect(leafVersion(fx.outsideLeaf)).toBe(before);
  }, 180_000);

  it("BOUNDARY: an owned-by row together with --remove-site is not an owned-by-only write (exit 4)", () => {
    const before = leafVersion(fx.outsideLeaf);
    const file = rowsFile("with-remove", [{ site: SITE, nonBusiness: ownedBy(fx.ownerIn, fx.ownerInRule) }]);
    const r = runLore(["baseline", "map", fx.outsideLeaf, "--sites-file", file, "--remove-site", SITE], fx.wt, "agent:obm");
    expect(r.exitCode).toBe(4);
    expect(leafVersion(fx.outsideLeaf)).toBe(before);
  }, 180_000);
});
