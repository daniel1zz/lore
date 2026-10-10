/**
 * `lore get` Implements / Implemented by views, computed from citations (Baseline slice 3b, AC-BLS3B-4 / BR-1008),
 * over a throwaway corpus (an `mkdtemp` outside the repo; the repo's own `.lore/` is never touched).
 *
 * Fixture: business leaf L1 carrying BR-a (cited by 3 criteria of 2 specs) and BR-b (uncited); architecture
 * standard S carrying AS-a; spec A cites BR-a (AC-A-1), BR-a + AS-a (AC-A-2); spec B cites BR-a + a missing rule
 * (AC-B-1); a second leaf L2 nothing cites.
 *
 * CONTRACT (the spec leaves these open):
 *   C1. `get <spec> --json` carries `data.implements = {rules:[{rule_id,node_slug,state,criteria}], count}`.
 *   C2. `get <leaf|standard> --json` carries `data.implemented_by = {rules, citations:[{rule_id,spec,doc_status,criterion}], count}`.
 *   C3. `count` = number of (rule, criterion) citation pairs. A missing rule is listed, `node_slug: null`, state "missing".
 *   C4. Human render: an `Implements` header on a spec, an `Implemented by` header + a `Count: N` line on a node.
 *
 * Dimensions: HAPPY (both views, both trees), BOUNDARY (3 criteria / 2 specs = 3; zero citations = 0),
 * NEGATIVE (missing rule listed not dropped; non-spec/non-node docs carry no key), REGRESSION (--json base keys intact).
 *
 * @spec_ref AC-BLS3B-4
 */

import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

setDefaultTimeout(300_000);

const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const RULE = ["--confidence", "established", "--enforced-by", "guaranteed", "--example", "e.g. one"];

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

let dir = "";

function runLore(args: string[]): RunResult {
  const env = { ...process.env, HOME: dir, CLAUDECODE: "1", LORE_ACTOR: "agent:implements-view-test" };
  const proc = Bun.spawnSync(["bun", "run", ENTRY, ...args], { cwd: dir, env });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function mustRun(args: string[]): RunResult {
  const r = runLore(args);
  if (r.exitCode !== 0) throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r;
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

interface GetJson {
  data: {
    doc: { slug: string };
    implements?: {
      rules: Array<{ rule_id: string; node_slug: string | null; state: string; criteria: string[] }>;
      count: number;
    };
    implemented_by?: {
      rules: Array<{ rule_id: string; state: string }>;
      citations: Array<{ rule_id: string; spec: string; doc_status: string; criterion: string }>;
      count: number;
    };
  };
}

function getJson(slug: string): GetJson {
  return JSON.parse(mustRun(["get", slug, "--json"]).stdout) as GetJson;
}

let leaf1 = "";
let leaf2 = "";
let standard = "";
let specA = "";
let specB = "";
let prd = "";
let brA = "";
let brB = "";
let asA = "";

beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "implview-")));
  if (dir.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
  const git = (args: string[]): void => {
    execFileSync("git", args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  };
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "iv@example.invalid"]);
  git(["config", "user.name", "iv test"]);
  writeFileSync(join(dir, "README.md"), "fixture\n");
  git(["add", "."]);
  git(["commit", "-q", "-m", "init"]);
  mustRun(["init"]);
  // reason: the fixture specs are one-line stubs; the skeleton gate is not what this test is about.
  appendFileSync(join(dir, ".lore", "config.yaml"), "workflow:\n  gates:\n    spec-create:\n      enabled: false\n");

  prd = slugOf(mustRun(["create", "prd", "--title", "IV PRD", "--content", "root", "--no-ai"]).stdout);
  const bizRoot = slugOf(mustRun(["baseline", "add", prd, "--node", "root", "--label", "biz", "--title", "Biz Root"]).stdout);
  const branch = slugOf(mustRun(["baseline", "add", bizRoot, "--node", "branch", "--label", "br", "--title", "Biz Branch"]).stdout);
  leaf1 = slugOf(mustRun(["baseline", "add", branch, "--node", "leaf", "--label", "l1", "--title", "Leaf One"]).stdout);
  leaf2 = slugOf(mustRun(["baseline", "add", branch, "--node", "leaf", "--label", "l2", "--title", "Leaf Two"]).stdout);
  mustRun(["rule", "add", leaf2, "--statement", "Nobody cites this", ...RULE]);
  const archRoot = slugOf(
    mustRun(["baseline", "add", prd, "--tree", "architecture", "--node", "root", "--label", "arch", "--title", "Arch Root"]).stdout,
  );
  const section = slugOf(
    mustRun(["baseline", "add", archRoot, "--tree", "architecture", "--node", "section", "--label", "svc", "--title", "Svc"]).stdout,
  );
  standard = slugOf(
    mustRun(["baseline", "add", section, "--tree", "architecture", "--node", "standard", "--label", "std", "--title", "Std"]).stdout,
  );
  brA = ruleIdOf(mustRun(["rule", "add", leaf1, "--statement", "Rule A holds", ...RULE]).stdout);
  brB = ruleIdOf(mustRun(["rule", "add", leaf1, "--statement", "Rule B holds", ...RULE]).stdout);
  asA = ruleIdOf(mustRun(["rule", "add", standard, "--statement", "Standard A holds", ...RULE]).stdout);

  specA = slugOf(mustRun(["create", "spec", "--title", "IV Spec A", "--content", "x", "--no-ai"]).stdout);
  specB = slugOf(mustRun(["create", "spec", "--title", "IV Spec B", "--content", "x", "--no-ai"]).stdout);
  for (const [spec, id] of [[specA, "AC-A-1"], [specA, "AC-A-2"], [specB, "AC-B-1"]] as const) {
    mustRun(["ac", "add", spec, id, "--statement", `criterion ${id} holds`, "--mode", "human"]);
  }
  mustRun(["ac", "cite", specA, "AC-A-1", brA]);
  mustRun(["ac", "cite", specA, "AC-A-2", brA, asA]);
  mustRun(["ac", "cite", specB, "AC-B-1", brA, "BR-9999"]);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("lore get <spec> — Implements (AC-BLS3B-4)", () => {
  it("--json lists each cited rule with node slug, state and citing criteria, across both trees", () => {
    const view = getJson(specA).data.implements;
    expect(view).toBeDefined();
    expect(view!.count).toBe(3);
    expect(view!.rules).toEqual([
      { rule_id: brA, node_slug: leaf1, state: "live", criteria: ["AC-A-1", "AC-A-2"] },
      { rule_id: asA, node_slug: standard, state: "live", criteria: ["AC-A-2"] },
    ]);
  });

  it("lists a citation of a missing rule instead of dropping it", () => {
    const view = getJson(specB).data.implements;
    expect(view!.count).toBe(2);
    expect(view!.rules).toContainEqual({ rule_id: "BR-9999", node_slug: null, state: "missing", criteria: ["AC-B-1"] });
    expect(view!.rules).toContainEqual({ rule_id: brA, node_slug: leaf1, state: "live", criteria: ["AC-B-1"] });
  });

  it("human render prints an Implements section naming rule, node and criteria", () => {
    const out = mustRun(["get", specA]).stdout;
    expect(out).toContain("Implements");
    expect(out).toContain(`${brA} -> ${leaf1}: AC-A-1, AC-A-2`);
    expect(out).toContain(`${asA} -> ${standard}: AC-A-2`);
  });

  it("REGRESSION: --json keeps its base keys", () => {
    const data = getJson(specA).data as unknown as Record<string, unknown>;
    expect(data["doc"]).toBeDefined();
    expect(data["navigation"]).toBeDefined();
    expect(data["validity_status"]).toBeDefined();
  });
});

describe("lore get <baseline node> — Implemented by (AC-BLS3B-4)", () => {
  it("a rule cited by 3 criteria of 2 specs shows count 3 (--json)", () => {
    const view = getJson(leaf1).data.implemented_by;
    expect(view).toBeDefined();
    expect(view!.count).toBe(3);
    const forA = view!.citations.filter((c) => c.rule_id === brA);
    expect(forA.map((c) => `${c.spec}:${c.criterion}`).sort()).toEqual(
      [`${specA}:AC-A-1`, `${specA}:AC-A-2`, `${specB}:AC-B-1`].sort(),
    );
    expect(new Set(forA.map((c) => c.spec)).size).toBe(2);
    expect(forA.every((c) => c.doc_status === "draft")).toBe(true);
    expect(view!.rules.map((r) => r.rule_id).sort()).toEqual([brA, brB].sort());
  });

  it("human render prints Implemented by with each citing spec + criterion and a count line", () => {
    const out = mustRun(["get", leaf1]).stdout;
    expect(out).toContain("Implemented by");
    expect(out).toContain(`${brA}: ${specA} (draft) AC-A-1`);
    expect(out).toContain(`${brA}: ${specB} (draft) AC-B-1`);
    expect(out).toContain("Count: 3 citations");
  });

  it("an architecture standard shows its citing criterion too", () => {
    const view = getJson(standard).data.implemented_by;
    expect(view!.count).toBe(1);
    expect(view!.citations).toEqual([{ rule_id: asA, spec: specA, doc_status: "draft", criterion: "AC-A-2" }]);
  });

  it("BOUNDARY: a node whose rules nobody cites shows count 0", () => {
    const view = getJson(leaf2).data.implemented_by;
    expect(view!.count).toBe(0);
    expect(view!.citations).toEqual([]);
    expect(mustRun(["get", leaf2]).stdout).toContain("Count: 0 citations");
  });

  it("an archived-or-draft citing spec is never filtered: status is reported, not hidden", () => {
    const view = getJson(leaf1).data.implemented_by;
    expect(view!.citations.length).toBe(view!.count);
  });
});

describe("other doc types carry neither view", () => {
  it("a PRD has no implements / implemented_by key and no section", () => {
    const data = getJson(prd).data as unknown as Record<string, unknown>;
    expect(data["implements"]).toBeUndefined();
    expect(data["implemented_by"]).toBeUndefined();
    const out = mustRun(["get", prd]).stdout;
    expect(out).not.toContain("Implemented by");
  });
});
