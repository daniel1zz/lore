// @spawns packages/lore/src/index.ts
// @reads packages/lore/src/adapters/cli/commands/ac.ts
// @reads packages/lore/src/service/ac-service.ts
// @reads packages/lore/src/adapters/cli/commands/evidence.ts
/**
 * spec-defect-clusters-round-2-part-c-criterion-data-demotion#AC-DC2-18 (D18, BR-627, BR-38, BR-722): every write
 * that demotes an approved document to draft announces it on stdout, and in `--json`; the help
 * around the cite and capture behaviour states what the gates do.
 *
 * Root cause under test: `RuleService.demoteIfApproved` wrote the demotion as its own version while the CLI
 * printed only the final version, and `ac set` demoted with a stderr-only notice; cite help said "report-only"
 * though the gate refuses under `enforce`; evidence.ts restated a capture default that had drifted.
 *
 * Throwaway repo + corpus (mkdtemp, HOME in the temp dir, record-edit gate off); never the repo's own `.lore/`.
 * Simplest green-but-broken cases asserted against: a DRAFT leaf (no line is already right) and a help check
 * for one literal number (passes after `600_000`). So every fixture approves first and the capture check
 * refuses ANY digit run.
 * Dimensions: HAPPY (rule add/set/ac set announce), NEGATIVE (ac add, draft leaf), STATE (status after),
 * REGRESSION (help text, source comments).
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dropLoreConfigKey, patchLoreConfig } from "../helpers/patch-lore-config.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DECIDED_FLAGS, DECIDED_STATEMENT_FLAGS } from "../helpers/decision-flags.js";

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

const SPEC_QUALIFIED = "spec-defect-clusters-round-2-part-c-criterion-data-demotion#AC-DC2-18";
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const SRC = join(REPO_ROOT, "packages", "lore", "src");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

let dir = "";
let leafParent = "";
let counter = 0;
/** A live rule every fixture spec cites: approval refuses a spec that cites none. */
let citedRule = "";

function runLore(args: string[]): RunResult {
  const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: join(dir, "xdg"), CLAUDECODE: "1", LORE_ACTOR: "agent:dc2-18" };
  const proc = Bun.spawnSync(["bun", "run", ENTRY, ...args], { cwd: dir, env });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function mustRun(args: string[]): RunResult {
  const r = runLore(args);
  if (r.exitCode !== 0) throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r;
}

function slugOf(stdout: string): string {
  const m = stdout.match(/Slug:\s+(\S+)/) ?? stdout.match(/Created baseline \w+ (\S+) \(/);
  if (!m?.[1]) throw new Error(`no slug in: ${stdout}`);
  return m[1];
}

const RULE_FLAGS = ["--confidence", "established", "--enforced-by", "guaranteed", "--example", "example one"];

function statusOf(doc: string): string {
  const parsed = JSON.parse(mustRun(["get", doc, "--json"]).stdout) as { data?: { doc?: { status: string } }; doc?: { status: string } };
  const found = parsed.data?.doc ?? parsed.doc;
  if (found === undefined) throw new Error("no doc in get --json");
  return found.status;
}

function versionOf(doc: string): number {
  const parsed = JSON.parse(mustRun(["get", doc, "--json"]).stdout) as { data?: { doc?: { version: number } }; doc?: { version: number } };
  const found = parsed.data?.doc ?? parsed.doc;
  if (found === undefined) throw new Error("no doc in get --json");
  return found.version;
}

/** A fresh leaf holding one rule, approved. Returns its slug and the rule id. */
function approvedLeaf(): { leaf: string; rule: string } {
  counter += 1;
  const leaf = draftLeaf();
  const rule = mustRun(["rule", "add", leaf, "--statement", `seed rule ${counter}`, ...RULE_FLAGS]).stdout.match(/\bBR-\d+\b/)?.[0];
  if (rule === undefined) throw new Error("no rule id from seed rule add");
  // a direct add is a pending add: the leaf is approved by promoting it (the override class is loosened in beforeAll)
  mustRun(["approve", leaf, "--override-no-judgment"]);
  expect(statusOf(leaf)).toBe("approved"); // the fixture must really be approved: a draft leaf proves nothing
  return { leaf, rule };
}

function draftLeaf(): string {
  counter += 1;
  return slugOf(mustRun(["baseline", "add", leafParent, "--node", "leaf", "--label", `Leaf ${counter}`, "--title", `DC2-18 Leaf ${counter}`]).stdout);
}

/** A fresh approved spec holding AC-1. */
function approvedSpec(): string {
  counter += 1;
  const slug = slugOf(mustRun(["create", "spec", "--title", `DC2-18 Spec ${counter}`, "--content", "## Spec\n\nbody", "--no-ai"]).stdout);
  mustRun(["ac", "add", slug, "AC-1", "--statement", "the behaviour holds", "--mode", "human", "--note", "n", "--cite", citedRule]);
  mustRun(["approve", slug, "--override-no-judgment"]);
  expect(statusOf(slug)).toBe("approved");
  return slug;
}

function demotionLine(slug: string, version: number): string {
  return `${slug} was approved and is now draft (v${version}): re-review and approve it`;
}

interface DemotedPayload {
  readonly slug: string;
  readonly from: string;
  readonly to: string;
  readonly version: number;
}

beforeAll(async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "dc2-18-")));
  if (dir.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  writeFileSync(join(dir, "README.md"), "fixture\n");
  mustRun(["init"]);
  // The record-edit gate would refuse an edit of an approved record before it could demote; switch it off.
  patchLoreConfig(dir, `workflow:\n  gates:\n    record-edit:\n      enabled: false\n`);
  // reason: `lore init` seeds the verification profiles (a feature spec needs a `test` oracle to be approved); this
  // suite's subject is demotion, so the profiles are removed (an absent profile is a vacuous pass).
  dropLoreConfigKey(dir, ["workflow", "verification_profiles"]);
  const prd = slugOf(mustRun(["create", "prd", "--title", "DC2-18 PRD", "--content", "root", "--no-ai"]).stdout);
  const root = slugOf(mustRun(["baseline", "add", prd, "--node", "root", "--label", "Root", "--title", "DC2-18 Root"]).stdout);
  leafParent = slugOf(mustRun(["baseline", "add", root, "--node", "branch", "--label", "Branch", "--title", "DC2-18 Branch"]).stdout);
  const citedLeaf = draftLeaf();
  const cited = mustRun(["rule", "add", citedLeaf, "--statement", "the rule fixture specs cite", ...RULE_FLAGS]).stdout.match(/\bBR-\d+\b/)?.[0];
  if (cited === undefined) throw new Error("no rule id for the cited rule");
  mustRun(["approve", citedLeaf, "--override-no-judgment"]); // citable (live) only once its leaf is approved
  citedRule = cited;
});

afterAll(() => {
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

describe(`${SPEC_QUALIFIED} (a) rule add and rule set no longer demote a baseline leaf (BR-722, BR-627)`, () => {
  it("rule add on an approved leaf records a pending add: one version, no demotion line, derived status draft", () => {
    const { leaf } = approvedLeaf();
    const before = versionOf(leaf);
    const r = runLore(["rule", "add", leaf, "--statement", "added to an approved leaf", ...RULE_FLAGS, ...DECIDED_FLAGS]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).not.toContain("is now draft");
    expect(r.stdout).toContain("pending add");
    // no demotion write precedes the rule write: exactly ONE new version
    expect(versionOf(leaf)).toBe(before + 1);
    expect(statusOf(leaf)).toBe("draft");
  });

  it("rule add --json carries no data.demoted and says it is pending", () => {
    const { leaf } = approvedLeaf();
    const r = runLore(["rule", "add", leaf, "--statement", "json add", ...RULE_FLAGS, ...DECIDED_FLAGS, "--json"]);
    expect(r.exitCode).toBe(0);
    const data = (JSON.parse(r.stdout) as { data: { demoted?: DemotedPayload; pending?: boolean } }).data;
    expect(data.demoted).toBeUndefined();
    expect(data.pending).toBe(true);
  });

  it("rule set on an approved leaf records a pending revision: no demotion line, no data.demoted, one version", () => {
    const text = approvedLeaf();
    const textBefore = versionOf(text.leaf);
    const r = runLore(["rule", "set", text.rule, "--statement", "edited on an approved leaf", ...DECIDED_STATEMENT_FLAGS]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).not.toContain("is now draft");
    expect(r.stdout).toContain("pending revision");
    expect(versionOf(text.leaf)).toBe(textBefore + 1);

    const json = approvedLeaf();
    const j = runLore(["rule", "set", json.rule, "--statement", "json edit", ...DECIDED_STATEMENT_FLAGS, "--json"]);
    expect(j.exitCode).toBe(0);
    const data = (JSON.parse(j.stdout) as { data: { demoted?: DemotedPayload; pending?: boolean } }).data;
    expect(data.demoted).toBeUndefined();
    expect(data.pending).toBe(true);
  });
});

describe(`${SPEC_QUALIFIED} (b)(c) ac set announces, ac add does not demote`, () => {
  it("(b) ac set on an approved spec prints the same line on stdout, and --json carries demoted", () => {
    const spec = approvedSpec();
    const before = versionOf(spec);
    const r = runLore(["ac", "set", spec, "AC-1", "--statement", "x", ...DECIDED_FLAGS]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(demotionLine(spec, before + 1));
    expect(statusOf(spec)).toBe("draft");

    const jsonSpec = approvedSpec();
    const jsonBefore = versionOf(jsonSpec);
    const j = runLore(["ac", "set", jsonSpec, "AC-1", "--statement", "y", ...DECIDED_FLAGS, "--json"]);
    expect(j.exitCode).toBe(0);
    const demoted = (JSON.parse(j.stdout) as { data: { demoted?: DemotedPayload } }).data.demoted;
    expect(demoted).toEqual({ slug: jsonSpec, from: "approved", to: "draft", version: jsonBefore + 1 });
  });

  it("(c) ac add on an approved spec prints no demotion line and the spec stays approved", () => {
    const spec = approvedSpec();
    const r = runLore(["ac", "add", spec, "AC-2", "--statement", "another", "--mode", "human", "--note", "n", ...DECIDED_FLAGS]);
    expect(r.exitCode).toBe(0);
    expect(`${r.stdout}${r.stderr}`).not.toContain("is now draft");
    expect(statusOf(spec)).toBe("approved");
  });
});

describe(`${SPEC_QUALIFIED} (d) no demotion from draft`, () => {
  it("rule add and rule set on a draft leaf print no demotion line and carry no demoted", () => {
    const leaf = draftLeaf();
    expect(statusOf(leaf)).toBe("draft");
    const add = runLore(["rule", "add", leaf, "--statement", "on a draft leaf", ...RULE_FLAGS, "--json"]);
    expect(add.exitCode).toBe(0);
    const added = (JSON.parse(add.stdout) as { data: { ruleId: string; demoted?: DemotedPayload } }).data;
    expect(added.demoted).toBeUndefined();
    const text = runLore(["rule", "add", leaf, "--statement", "second on a draft leaf", ...RULE_FLAGS]);
    expect(text.exitCode).toBe(0);
    expect(text.stdout).not.toContain("is now draft");
    const set = runLore(["rule", "set", added.ruleId, "--statement", "edited on a draft leaf"]);
    expect(set.exitCode).toBe(0);
    expect(set.stdout).not.toContain("is now draft");
  }, 120_000);
});

describe(`${SPEC_QUALIFIED} (e) cite help states what the gate does`, () => {
  for (const verb of ["add", "set", "cite"]) {
    it(`lore ac ${verb} --help: refused under enforce on an armed branch, stored with a warning under report/off`, () => {
      const help = runLore(["ac", verb, "--help"]);
      const text = `${help.stdout}${help.stderr}`.replace(/\s+/g, " ");
      expect(text).toMatch(/refused under gate mode `enforce` on an armed branch/);
      expect(text).toMatch(/stored with a warning under `report`\/`off`/);
      expect(text.toLowerCase()).not.toContain("report-only");
    });
  }

  it("ac.ts and ac-service.ts contain neither `report-only` nor `never rejects`", () => {
    for (const file of [join(SRC, "adapters", "cli", "commands", "ac.ts"), join(SRC, "service", "ac-service.ts")]) {
      const source = readFileSync(file, "utf8").toLowerCase();
      expect(source, file).not.toContain("report-only");
      expect(source, file).not.toContain("never rejects");
    }
  });
});

describe(`${SPEC_QUALIFIED} (f) the capture-window sentence names the knob and no number`, () => {
  it("the evidence.ts sentence naming workflow.evidence.capture_timeout_ms has no digit run", () => {
    const raw = readFileSync(join(SRC, "adapters", "cli", "commands", "evidence.ts"), "utf8");
    const flat = raw.split("\n").map((l) => l.replace(/^\s*\*\s?/, "")).join(" ").replace(/\s+/g, " ");
    const sentences = flat.split(/\.\s+/).filter((s) => s.includes("workflow.evidence.capture_timeout_ms"));
    expect(sentences.length).toBeGreaterThan(0);
    // the FIRST sentence naming the knob is the capture-window one; any digit refuses it, so `600000`,
    // `600_000` and `1_200_000` are all refused alike
    expect(sentences[0]).toContain("Capture window");
    expect(sentences[0]).toContain("bounded by");
    expect(sentences[0]).not.toMatch(/\d/);
  });
});
