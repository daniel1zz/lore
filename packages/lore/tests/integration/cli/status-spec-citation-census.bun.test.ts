// @spawns packages/lore/src/index.ts
/**
 * `lore status` spec citation census (Baseline slice 3b, AC-BLS3B-3 / BR-1011), over a throwaway corpus
 * (an `mkdtemp` outside the repo; the repo's own `.lore/` is never touched).
 *
 * Fixture (baseline docs exist): live specs U1 and U2 cite nothing; U3 cites only a RETIRED rule; P is parented
 * and cites a live rule; D (deprecated) and A (archived) cite nothing but are not live.
 * Expected: specs_without_citation = {U1, U2, U3} (3), specs_with_parent = {P} (1).
 *
 * CONTRACT (the spec leaves these open):
 *   C1. `status --json` carries `data.specs_without_citation = {count, slugs}` and `data.specs_with_parent = {count, slugs}`
 *       (slugs sorted) ONLY when the corpus has baseline docs (AC-BLS2-11 byte-identity for pre-baseline corpora).
 *   C2. The human output prints one line per census with its count.
 *   C3. "Live" = status not archived / deprecated; soft-deleted specs excluded. A spec counts as cited when at least one
 *       criterion cites a LIVE rule (not deprecated, retired or missing).
 *
 * Dimensions: HAPPY (exact counts + slugs), NEGATIVE (retired-only citation is uncited; archived/deprecated excluded),
 * STATE (citing a live rule moves a spec out of the census), REGRESSION (no baseline docs -> fields absent).
 *
 * @spec_ref AC-BLS3B-3
 */

import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const setDefaultTimeout = (ms: number): void => { vi.setConfig({ testTimeout: ms, hookTimeout: ms }); };
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { patchLoreConfig } from "../../helpers/patch-lore-config.js";
import { tmpdir } from "node:os";
import { join } from "node:path";

setDefaultTimeout(600_000);

const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const RULE = ["--confidence", "established", "--enforced-by", "guaranteed", "--example", "e.g. one"];

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function makeRunner(cwd: string): (args: string[]) => RunResult {
  return (args) => {
    const env = { ...process.env, HOME: cwd, CLAUDECODE: "1", LORE_ACTOR: "agent:census-test" };
    const proc = Bun.spawnSync(["bun", "run", ENTRY, ...args], { cwd, env });
    return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
  };
}

function mustOf(run: (args: string[]) => RunResult): (args: string[]) => RunResult {
  return (args) => {
    const r = run(args);
    if (r.exitCode !== 0) throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
    return r;
  };
}

function slugOf(stdout: string): string {
  const m = stdout.match(/Slug:\s+(\S+)/) ?? stdout.match(/Created baseline [\w-]+ (\S+) \(/);
  if (!m?.[1]) throw new Error(`no slug in: ${stdout}`);
  return m[1];
}

function ruleIdOf(stdout: string): string {
  const m = stdout.match(/(?:BR|AS)-\d+/);
  if (!m) throw new Error(`no rule id in: ${stdout}`);
  return m[0];
}

interface Census {
  count: number;
  slugs: string[];
}

interface StatusJson {
  data: { specs_without_citation?: Census; specs_with_parent?: Census };
}

/** Seeds the LEGACY parented-spec state directly: creating a spec under a parent is refused since BR-2 (BR-1007). */
function setLegacyParent(cwd: string, slug: string, parentSlug: string): void {
  const db = new Database(join(cwd, ".lore", "lore.db"), { readwrite: true });
  try {
    db.run("UPDATE docs SET parent_id = (SELECT id FROM docs WHERE slug = ?) WHERE slug = ?", [parentSlug, slug]);
  } finally {
    db.close();
  }
}

function setStatus(cwd: string, slug: string, status: string): void {
  const db = new Database(join(cwd, ".lore", "lore.db"), { readwrite: true });
  try {
    db.run("UPDATE docs SET status = ? WHERE slug = ?", [status, slug]);
  } finally {
    db.close();
  }
}

function initRepo(cwd: string): void {
  const git = (args: string[]): void => {
    execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
  };
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "cs@example.invalid"]);
  git(["config", "user.name", "cs test"]);
  writeFileSync(join(cwd, "README.md"), "fixture\n");
  git(["add", "."]);
  git(["commit", "-q", "-m", "init"]);
}

describe("AC-BLS3B-3 census over a corpus with baseline docs", () => {
  let dir = "";
  let run: (args: string[]) => RunResult;
  const slugs: Record<string, string> = {};
  const slugOfKey = (key: string): string => {
    const slug = slugs[key];
    if (slug === undefined) throw new Error(`fixture spec ${key} was not created`);
    return slug;
  };

  beforeAll(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "census-")));
    if (dir.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
    initRepo(dir);
    run = runnerFor(dir);
    const must = mustOf(run);
    must(["init"]);
    // reason: the fixture specs are one-line stubs; the skeleton gate is not what this test is about.
    patchLoreConfig(dir, "workflow:\n  gates:\n    spec-create:\n      enabled: false\n");

    const prd = slugOf(must(["create", "prd", "--title", "CS PRD", "--content", "root", "--no-ai"]).stdout);
    const bizRoot = slugOf(must(["baseline", "add", prd, "--node", "root", "--label", "biz", "--title", "Biz Root"]).stdout);
    const branch = slugOf(must(["baseline", "add", bizRoot, "--node", "branch", "--label", "br", "--title", "Biz Branch"]).stdout);
    const leaf = slugOf(must(["baseline", "add", branch, "--node", "leaf", "--label", "l1", "--title", "Leaf One"]).stdout);
    const live = ruleIdOf(must(["rule", "add", leaf, "--statement", "Live rule holds", ...RULE]).stdout);
    const dying = ruleIdOf(must(["rule", "add", leaf, "--statement", "Dying rule holds", ...RULE]).stdout);
    must(["rule", "set", dying, "--lifecycle", "retired", "--note", "superseded in the fixture"]);

    const makeSpec = (key: string, title: string, parent: string | null): string => {
      // reason: a spec is created parentless (BR-1007); the one parented spec P is seeded as legacy state directly.
      const args = ["create", "spec", "--title", title, "--content", "x", "--no-ai"];
      slugs[key] = slugOf(must(args).stdout);
      if (parent !== null) setLegacyParent(dir, slugs[key]!, parent);
      must(["ac", "add", slugs[key]!, `AC-${key}-1`, "--statement", `criterion ${key} holds`, "--mode", "human"]);
      return slugs[key]!;
    };
    makeSpec("U1", "Census Uncited One", null);
    makeSpec("U2", "Census Uncited Two", null);
    const u3 = makeSpec("U3", "Census Retired Only", null);
    must(["ac", "cite", u3, "AC-U3-1", dying]);
    const p = makeSpec("P", "Census Parented", prd);
    must(["ac", "cite", p, "AC-P-1", live]);
    const d = makeSpec("D", "Census Deprecated", null);
    const a = makeSpec("A", "Census Archived", null);
    // reason: a draft cannot lawfully move to deprecated/archived by CLI; the census reads the stored status only.
    setStatus(dir, d, "deprecated");
    setStatus(dir, a, "archived");
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function statusJson(): StatusJson {
    const r = run(["status", "--json"]);
    if (r.exitCode !== 0) throw new Error(`status failed: ${r.stderr}`);
    return JSON.parse(r.stdout) as StatusJson;
  }

  it("reports exactly the 3 uncited live specs and the 1 parented live spec, not the archived or deprecated ones", () => {
    const data = statusJson().data;
    expect(data.specs_without_citation).toEqual({ count: 3, slugs: [slugOfKey("U1"), slugOfKey("U2"), slugOfKey("U3")].sort() });
    expect(data.specs_with_parent).toEqual({ count: 1, slugs: [slugOfKey("P")] });
  });

  it("prints both counts in the human output", () => {
    const r = run(["status"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/Specs without citation:\s+3/);
    expect(r.stdout).toMatch(/Specs with a parent:\s+1/);
  });

  it("moves a spec out of the census once one criterion cites a live rule", () => {
    const rules = run(["rule", "find", "--text", "Live rule"]);
    const live = ruleIdOf(rules.stdout);
    mustOf(run)(["ac", "cite", slugs["U1"]!, "AC-U1-1", live]);
    const data = statusJson().data;
    expect(data.specs_without_citation).toEqual({ count: 2, slugs: [slugOfKey("U2"), slugOfKey("U3")].sort() });
  });
});

describe("AC-BLS3B-3 census is absent when the corpus has no baseline docs (spec-baseline-slice-2-completeness-census-per-branch-citation#AC-BLS2-11 byte-identity)", () => {
  it("emits neither field and prints neither line", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "census-plain-")));
    try {
      initRepo(dir);
      const run = runnerFor(dir);
      const must = mustOf(run);
      must(["init"]);
      slugOf(must(["create", "prd", "--title", "Plain PRD", "--content", "root", "--no-ai"]).stdout);
      must(["create", "spec", "--title", "Plain Spec", "--content", "## Overview\nx", "--no-ai"]);
      const json = JSON.parse(run(["status", "--json"]).stdout) as StatusJson;
      expect(json.data.specs_without_citation).toBeUndefined();
      expect(json.data.specs_with_parent).toBeUndefined();
      const human = run(["status"]).stdout;
      expect(human).not.toContain("Specs without citation");
      expect(human).not.toContain("Specs with a parent");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function runnerFor(cwd: string): (args: string[]) => RunResult {
  return makeRunner(cwd);
}
