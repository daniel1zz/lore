/**
 * End-to-end test of the spec approval citation requirement (Baseline slice 3b, AC-BLS3B-2),
 * driven through the real CLI against a throwaway corpus.
 *
 * Rule: BR-1007 — a spec is approved only when at least one criterion cites a live business or
 * architecture standard rule; otherwise approval is refused with exit 4 naming `lore ac cite`,
 * and nothing is written. Other document types are unaffected.
 *
 * Dimensions: NEGATIVE (uncited spec -> exit 4 naming `lore ac cite`; spec citing only a retired
 * rule -> exit 4), STATE (status and version unchanged after the refusal), HAPPY (after
 * `lore ac cite` the same approve succeeds), REGRESSION (a plan's approval is unaffected).
 *
 * @spec_ref AC-BLS3B-2
 */

import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

setDefaultTimeout(300_000);

// tests/integration/cli/ -> repo root is 5 levels up.
const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const ACTOR = "agent:sac-test";

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

function slugOf(stdout: string): string {
  const m = stdout.match(/Slug:\s+(\S+)/) ?? stdout.match(/Created baseline \w+ (\S+) \(/);
  if (!m?.[1]) throw new Error(`no slug in: ${stdout}`);
  return m[1];
}

interface DocJson {
  readonly status: string;
  readonly version: number;
}

function docOf(slug: string, cwd: string): DocJson {
  const parsed = JSON.parse(mustRun(["get", slug, "--json"], cwd).stdout) as { data?: { doc?: DocJson }; doc?: DocJson };
  const doc = parsed.data?.doc ?? parsed.doc;
  if (doc === undefined) throw new Error("no doc in get --json output");
  return doc;
}

const AC_ID = "AC-SAC-1";
let dir = "";
let prd = "";
let leaf = "";
let liveRule = "";
let retiredRule = "";

/** A draft spec with one human criterion, no citation yet. */
function newSpec(title: string): string {
  const slug = slugOf(mustRun(["create", "spec", "--title", title, "--content", "## Spec\n\nbody", "--no-ai"], dir).stdout);
  mustRun(["ac", "add", slug, AC_ID, "--statement", "the behaviour holds", "--mode", "human"], dir);
  return slug;
}

function approve(slug: string): RunResult {
  return runLore(["approve", slug, "--override-no-judgment"], dir);
}

function addRule(statement: string): string {
  const out = mustRun(
    ["rule", "add", leaf, "--statement", statement, "--confidence", "established", "--enforced-by", "guaranteed", "--example", "example one"],
    dir,
  );
  const id = out.stdout.match(/\bBR-\d+\b/)?.[0];
  if (id === undefined) throw new Error(`no rule id in: ${out.stdout}`);
  return id;
}

beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "sac-")));
  if (dir.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  writeFileSync(join(dir, "README.md"), "fixture\n");
  mustRun(["init"], dir);
  prd = slugOf(mustRun(["create", "prd", "--title", "SAC PRD", "--content", "root", "--no-ai"], dir).stdout);
  const root = slugOf(mustRun(["baseline", "add", prd, "--node", "root", "--label", "Root", "--title", "SAC Root"], dir).stdout);
  const branch = slugOf(mustRun(["baseline", "add", root, "--node", "branch", "--label", "Branch", "--title", "SAC Branch"], dir).stdout);
  leaf = slugOf(mustRun(["baseline", "add", branch, "--node", "leaf", "--label", "Leaf", "--title", "SAC Leaf"], dir).stdout);
  liveRule = addRule("a live rule the spec can cite");
  retiredRule = addRule("a rule that will be retired");
});

afterAll(() => {
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

describe("AC-BLS3B-2: a spec needs a citing criterion to be approved", () => {
  it("NEGATIVE + STATE: an uncited spec is refused, exit 4, naming `lore ac cite`; status and version unchanged", () => {
    const spec = newSpec("SAC Uncited Spec");
    const before = docOf(spec, dir);
    const r = approve(spec);
    expect(r.exitCode).toBe(4);
    expect(`${r.stderr}${r.stdout}`).toContain("lore ac cite");
    expect(docOf(spec, dir)).toMatchObject({ status: before.status, version: before.version });
  });

  it("HAPPY: after `lore ac cite` of one criterion the same approve succeeds", () => {
    const spec = newSpec("SAC Cited Spec");
    expect(approve(spec).exitCode).toBe(4);
    mustRun(["ac", "cite", spec, AC_ID, liveRule], dir);
    const r = approve(spec);
    expect(r.exitCode).toBe(0);
    expect(docOf(spec, dir).status).toBe("approved");
  });

  it("NEGATIVE: a spec citing only a retired rule is still refused", () => {
    const spec = newSpec("SAC Retired Cite Spec");
    mustRun(["ac", "cite", spec, AC_ID, retiredRule], dir);
    mustRun(["rule", "set", retiredRule, "--lifecycle", "retired", "--note", "superseded for the test"], dir);
    const before = docOf(spec, dir);
    const r = approve(spec);
    expect(r.exitCode).toBe(4);
    expect(`${r.stderr}${r.stdout}`).toContain("lore ac cite");
    expect(docOf(spec, dir)).toMatchObject({ status: before.status, version: before.version });
  });

  it("REGRESSION: a plan's approval is unaffected by the citation requirement", () => {
    const plan = slugOf(mustRun(["create", "plan", "--title", "SAC Plan", "--parent", prd, "--content", "## Plan", "--no-ai"], dir).stdout);
    const r = runLore(["approve", plan], dir);
    expect(r.exitCode).toBe(0);
    expect(docOf(plan, dir).status).toBe("approved");
  });
});
