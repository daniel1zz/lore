/**
 * End-to-end test of the census CLI verbs `lore baseline sites | map | coverage`
 * (Baseline slice 2a, AC-BLS2-5), driven through the real CLI against a throwaway corpus.
 *
 * Spec: spec-baseline-slice-2-completeness-census-per-branch-citation (C1/C2):
 *   - a leaf that declares no commands is UNMEASURED (coverage exits 1, never 0);
 *   - once every census site of the leaf's command is mapped (rule or non-business),
 *     `coverage` exits 0; removing any one mapping makes it exit 1 and name that site.
 *
 * The census reads CLI sources found upward from cwd, so the throwaway corpus symlinks the
 * repo's `packages/` directory next to its own `.lore/`. The repo's own `.lore/` is never touched.
 *
 * Dimensions: HAPPY (full mapping -> 0), NEGATIVE (no commands -> 1; unmapped site -> 1 names it),
 * STATE (different mapping removed -> different named site), BOUNDARY (sites exist at all).
 *
 * @spec_ref AC-BLS2-5
 */

import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

setDefaultTimeout(300_000);

// tests/integration/cli/ -> repo root is 5 levels up.
const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const ACTOR = "agent:bc-test";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function runLore(args: string[], cwd: string): RunResult {
  const env = { ...process.env, HOME: cwd, CLAUDECODE: "1", LORE_ACTOR: ACTOR };
  const proc = Bun.spawnSync(["bun", "run", ENTRY, ...args], { cwd, env });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function mustRun(args: string[], cwd: string): RunResult {
  const r = runLore(args, cwd);
  if (r.exitCode !== 0) throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r;
}

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
}

function slugOf(stdout: string): string {
  const m = stdout.match(/Slug:\s+(\S+)/) ?? stdout.match(/Created baseline \w+ (\S+) \(/);
  if (!m?.[1]) throw new Error(`no slug in: ${stdout}`);
  return m[1];
}

interface CensusSite {
  readonly key: string;
  readonly dynamic: boolean;
}

function censusSites(repo: string, command: string): CensusSite[] {
  const r = mustRun(["baseline", "sites", command, "--json"], repo);
  const parsed = JSON.parse(r.stdout) as { ok: boolean; data: { sites: CensusSite[] } };
  return parsed.data.sites;
}

let scratch: string[] = [];
let repo = "";
let leaf = "";
let emptyLeaf = "";
let sites: CensusSite[] = [];

beforeAll(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), "blc-repo-")));
  scratch.push(repo);
  if (repo.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "blc@example.invalid"]);
  git(repo, ["config", "user.name", "blc test"]);
  writeFileSync(join(repo, "README.md"), "fixture\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "-m", "init"]);
  symlinkSync(join(REPO_ROOT, "packages"), join(repo, "packages"));
  mustRun(["init"], repo);

  const prd = slugOf(mustRun(["create", "prd", "--title", "BLC PRD", "--content", "root", "--no-ai"], repo).stdout);
  const root = slugOf(mustRun(["baseline", "add", prd, "--node", "root", "--label", "root", "--title", "BLC Root"], repo).stdout);
  const branch = slugOf(mustRun(["baseline", "add", root, "--node", "branch", "--label", "br", "--title", "BLC Branch"], repo).stdout);
  leaf = slugOf(mustRun(["baseline", "add", branch, "--node", "leaf", "--label", "lf", "--title", "BLC Leaf"], repo).stdout);
  emptyLeaf = slugOf(mustRun(["baseline", "add", branch, "--node", "leaf", "--label", "lf2", "--title", "BLC Empty Leaf"], repo).stdout);
  mustRun(
    ["rule", "add", leaf, "--statement", "an AC id is unique within its spec", "--confidence", "established", "--enforced-by", "guaranteed", "--example", "duplicate id refused"],
    repo,
  );
  sites = censusSites(repo, "ac add");
});

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
  scratch = [];
});

describe("lore baseline sites (census over the real `ac add` command)", () => {
  it("lists at least one site, each with a key and a dynamic flag", () => {
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.every((s) => typeof s.key === "string" && s.key.length > 0 && typeof s.dynamic === "boolean")).toBe(true);
  });

  it("site keys are unique", () => {
    expect(new Set(sites.map((s) => s.key)).size).toBe(sites.length);
  });
});

describe("lore baseline coverage (e2e)", () => {
  it("a leaf with no declared commands is UNMEASURED: exit 1, never 0", () => {
    const r = runLore(["baseline", "coverage", emptyLeaf], repo);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain("UNMEASURED");
  });

  it("a leaf with a command but no mapped sites is INCOMPLETE and names a site", () => {
    mustRun(["baseline", "map", leaf, "--command", "ac add"], repo);
    const r = runLore(["baseline", "coverage", leaf], repo);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain(sites[0]!.key);
  });

  it("mapping every census site (first to the leaf's rule, rest non-business) -> coverage exits 0", () => {
    mustRun(["baseline", "map", leaf, "--site", sites[0]!.key, "--rule", "BR-1"], repo);
    for (const s of sites.slice(1)) {
      mustRun(["baseline", "map", leaf, "--site", s.key, "--non-business", "plumbing, not business behaviour"], repo);
    }
    const r = runLore(["baseline", "coverage", leaf], repo);
    expect(r.stderr + r.stdout).not.toContain("INCOMPLETE");
    expect(r.exitCode).toBe(0);
  });

  it("removing one mapping -> coverage exits 1 and names exactly that site", () => {
    const victim = sites[sites.length - 1]!.key;
    mustRun(["baseline", "map", leaf, "--remove-site", victim], repo);
    const r = runLore(["baseline", "coverage", leaf], repo);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain(victim);
  });

  it("removing a different mapping names that other site (different input, different output)", () => {
    const victim = sites[0]!.key;
    mustRun(["baseline", "map", leaf, "--remove-site", victim], repo);
    const r = runLore(["baseline", "coverage", leaf], repo);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain(victim);
  });

  it("re-mapping the removed sites restores exit 0", () => {
    mustRun(["baseline", "map", leaf, "--site", sites[0]!.key, "--rule", "BR-1"], repo);
    mustRun(["baseline", "map", leaf, "--site", sites[sites.length - 1]!.key, "--non-business", "plumbing again"], repo);
    expect(runLore(["baseline", "coverage", leaf], repo).exitCode).toBe(0);
  });
});

describe("lore baseline map (refusals)", () => {
  it("--site with neither --rule nor --non-business is refused", () => {
    const r = runLore(["baseline", "map", leaf, "--site", sites[0]!.key], repo);
    expect(r.exitCode).not.toBe(0);
  });

  it("--site mapped to a rule id the leaf does not carry is refused", () => {
    const r = runLore(["baseline", "map", leaf, "--site", sites[0]!.key, "--rule", "BR-9999"], repo);
    expect(r.exitCode).not.toBe(0);
  });

  it("--remove-site of a site that was never mapped is refused", () => {
    const r = runLore(["baseline", "map", leaf, "--remove-site", "nope.ts#nothing#NOPE"], repo);
    expect(r.exitCode).not.toBe(0);
  });
});
