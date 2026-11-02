// @spawns packages/lore/src/index.ts
/**
 * End-to-end test of the census CLI verbs `lore baseline sites | map --command | coverage`
 * (Baseline slice 2a, AC-BLS2-5), driven through the real CLI against a throwaway corpus.
 *
 * Spec: spec-baseline-slice-2-completeness-census-per-branch-citation (C1/C2), as amended by BR-1344 (a site's rule lives in code):
 *   - a leaf that declares no commands is reported UNMEASURED (coverage is report-only for sites: exit 0);
 *   - a leaf with a declared command is measured by that command's census over the real tree; the throwaway corpus holds no
 *     mapping, so what maps to the leaf is only what the tree declares for the leaf's own rules.
 *
 * The census reads CLI sources found upward from cwd, so the throwaway corpus symlinks the
 * repo's `packages/` directory next to its own `.lore/`. The repo's own `.lore/` is never touched.
 *
 * Dimensions: HAPPY (a declared command is censused), NEGATIVE (no commands -> UNMEASURED line),
 * BOUNDARY (sites exist at all; each carries a line and a rules array).
 *
 * @spec_ref spec-baseline-slice-2-completeness-census-per-branch-citation#AC-BLS2-5
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const setDefaultTimeout = (ms: number): void => { vi.setConfig({ testTimeout: ms, hookTimeout: ms }); };
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { templatedFieldsArgs } from "../../helpers/templated-create.js";

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
  // #94: the census now REPORTS unresolved imports (and coverage refuses to call such a census complete), so the
  // fixture must resolve like a real checkout: the workspace manifest names the packages, node_modules supplies third parties.
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "blc-fixture", private: true, workspaces: ["packages/*"] }));
  symlinkSync(join(REPO_ROOT, "node_modules"), join(repo, "node_modules"));
  mustRun(["init"], repo);

  const prd = slugOf(mustRun(["create", "prd", "--title", "BLC PRD", ...templatedFieldsArgs("prd"), "--no-ai"], repo).stdout);
  const root = slugOf(mustRun(["baseline", "add", prd, "--node", "root", "--label", "root", "--title", "BLC Root", ...templatedFieldsArgs("baseline", { kind: "root" })], repo).stdout);
  const branch = slugOf(mustRun(["baseline", "add", root, "--node", "branch", "--label", "br", "--title", "BLC Branch", ...templatedFieldsArgs("baseline", { kind: "branch" })], repo).stdout);
  leaf = slugOf(mustRun(["baseline", "add", branch, "--node", "leaf", "--label", "lf", "--title", "BLC Leaf", ...templatedFieldsArgs("baseline", { kind: "leaf" })], repo).stdout);
  emptyLeaf = slugOf(mustRun(["baseline", "add", branch, "--node", "leaf", "--label", "lf2", "--title", "BLC Empty Leaf", ...templatedFieldsArgs("baseline", { kind: "leaf" })], repo).stdout);
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
  it("a leaf with no declared commands is reported UNMEASURED and exits 0 (report only, never a refusal)", () => {
    const r = runLore(["baseline", "coverage", emptyLeaf], repo);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("UNMEASURED");
  });

  it("a leaf with a command is measured by that command's census: every reached site is counted, exit 0 (report only)", () => {
    mustRun(["baseline", "map", leaf, "--command", "ac add"], repo);
    const r = runLore(["baseline", "coverage", leaf, "--json"], repo);
    expect(r.exitCode, r.stdout + r.stderr).toBe(0);
    const report = (JSON.parse(r.stdout) as { data: { leaves: { slug: string; sites: number; measured_by: string; mapped_sites: unknown[] }[] } }).data.leaves[0]!;
    expect(report).toMatchObject({ slug: leaf, sites: sites.length, measured_by: "commands" });
    // the rule BR-1 of this throwaway corpus is declared nowhere in the real tree, so nothing maps to the leaf: declarations come from the code
    expect(report.mapped_sites).toEqual([]);
  });

  it("the census lists each site with the rules the tree declares at it (a rules array and a line, possibly empty)", () => {
    const listed = JSON.parse(mustRun(["baseline", "sites", "ac add", "--json"], repo).stdout) as { data: { sites: { line: number; rules: string[] }[] } };
    expect(listed.data.sites.every((s) => Number.isInteger(s.line) && s.line > 0 && Array.isArray(s.rules))).toBe(true);
  });
});
