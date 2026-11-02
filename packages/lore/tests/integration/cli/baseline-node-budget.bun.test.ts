// @spawns packages/lore/src/index.ts
/**
 * Per-kind baseline node size budgets in `lore status --check-prd-budget`
 * (Baseline slice 3b, AC-BLS3B-8 / BR-1010, BR-422, BR-423, BR-425), over a throwaway corpus
 * (an `mkdtemp` outside the repo; the repo's own `.lore/` is never touched).
 *
 * CONTRACT (the spec leaves these open):
 *   C1. The size check rides the existing `--check-prd-budget` flag; a breach exits 3, all-within exits 0.
 *   C2. `--json` carries `data.baseline_budget = {checked, consistent, nodes:[{slug, kind, measured, cap, metric}]}`
 *       where `metric` is "chars" | "rules"; the human render prints one line per finding naming slug, kind, measured, cap.
 *   C3. Caps come from config `budget.baseline.{leaf_chars,leaf_rules,branch_chars,standard_chars}`
 *       (defaults 16000 / 30 / 16000 / 8000). "Chars" = the stored body length (`doc.content`).
 *
 * Dimensions: BOUNDARY (cap passes, cap+1 fails, for all four metrics), NEGATIVE (finding names node/kind/size/cap),
 * REGRESSION (PRD 24000 + free-text checks kept; outline tier and detail-link findings gone), STATE (config override).
 *
 * @spec_ref AC-BLS3B-8
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const setDefaultTimeout = (ms: number): void => { vi.setConfig({ testTimeout: ms, hookTimeout: ms }); };
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { patchLoreConfig } from "../../helpers/patch-lore-config.js";
import { Database } from "bun:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { templatedFieldsArgs } from "../../helpers/templated-create.js";

setDefaultTimeout(600_000);

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
  const env = { ...process.env, HOME: dir, CLAUDECODE: "1", LORE_ACTOR: "agent:node-budget-test" };
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

/** Overwrite a doc's stored body with exactly `chars` characters (direct write: no CLI path stores an arbitrary body on a baseline node). */
function setBodyLength(slug: string, chars: number): void {
  const db = new Database(join(dir, ".lore", "lore.db"), { readwrite: true });
  try {
    db.run("UPDATE docs SET content = ? WHERE slug = ?", ["x".repeat(chars), slug]);
    // reason: `changes` also counts the FTS shadow-table trigger writes, so verify by reading the body back.
    const row = db.query("SELECT length(content) AS n FROM docs WHERE slug = ?").get(slug) as { n: number } | null;
    if (row?.n !== chars) throw new Error(`setBodyLength: ${slug} holds ${row?.n} chars, wanted ${chars}`);
  } finally {
    db.close();
  }
}

interface BudgetNode {
  slug: string;
  kind: string;
  measured: number;
  cap: number;
  metric: string;
}

function budgetJson(): { exitCode: number; nodes: BudgetNode[]; consistent: boolean } {
  const r = runLore(["status", "--check-prd-budget", "--json"]);
  const parsed = JSON.parse(r.stdout) as { data: { baseline_budget?: { consistent: boolean; nodes: BudgetNode[] } } };
  const section = parsed.data.baseline_budget;
  if (section === undefined) throw new Error(`no data.baseline_budget in: ${r.stdout}`);
  return { exitCode: r.exitCode, nodes: section.nodes, consistent: section.consistent };
}

let prd = "";
let leaf = "";
let branch = "";
let standard = "";
let ruleCount = 0;

function addRulesUpTo(target: number): void {
  while (ruleCount < target) {
    ruleCount += 1;
    mustRun(["rule", "add", leaf, "--statement", `Rule number ${ruleCount} holds`, ...RULE]);
  }
}

beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "nodebudget-")));
  if (dir.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
  const git = (args: string[]): void => {
    execFileSync("git", args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  };
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "nb@example.invalid"]);
  git(["config", "user.name", "nb test"]);
  writeFileSync(join(dir, "README.md"), "fixture\n");
  git(["add", "."]);
  git(["commit", "-q", "-m", "init"]);
  mustRun(["init"]);

  prd = slugOf(mustRun(["create", "prd", "--title", "NB PRD", ...templatedFieldsArgs("prd"), "--no-ai"]).stdout);
  const bizRoot = slugOf(mustRun(["baseline", "add", prd, "--node", "root", "--label", "biz", "--title", "Biz Root", ...templatedFieldsArgs("baseline", { kind: "root" })]).stdout);
  branch = slugOf(mustRun(["baseline", "add", bizRoot, "--node", "branch", "--label", "br", "--title", "Biz Branch", ...templatedFieldsArgs("baseline", { kind: "branch" })]).stdout);
  leaf = slugOf(mustRun(["baseline", "add", branch, "--node", "leaf", "--label", "l1", "--title", "Leaf One", ...templatedFieldsArgs("baseline", { kind: "leaf" })]).stdout);
  const archRoot = slugOf(
    mustRun(["baseline", "add", prd, "--tree", "architecture", "--node", "root", "--label", "arch", "--title", "Arch Root", ...templatedFieldsArgs("baseline", { kind: "root" })]).stdout,
  );
  const section = slugOf(
    mustRun(["baseline", "add", archRoot, "--tree", "architecture", "--node", "section", "--label", "svc", "--title", "Svc", ...templatedFieldsArgs("baseline", { kind: "section" })]).stdout,
  );
  standard = slugOf(
    mustRun(["baseline", "add", section, "--tree", "architecture", "--node", "standard", "--label", "std", "--title", "Std", ...templatedFieldsArgs("baseline", { kind: "standard" })]).stdout,
  );
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("AC-BLS3B-8 per-kind node budgets: size", () => {
  it("passes a leaf, a branch and a standard exactly at their caps (16000 / 16000 / 8000)", () => {
    setBodyLength(leaf, 16000);
    setBodyLength(branch, 16000);
    setBodyLength(standard, 8000);
    const r = budgetJson();
    expect(r.exitCode).toBe(0);
    expect(r.consistent).toBe(true);
    expect(r.nodes).toEqual([]);
  });

  it("reports a leaf of 16001 chars naming node, kind, measured and cap, and exits 3", () => {
    setBodyLength(leaf, 16001);
    setBodyLength(branch, 16000);
    setBodyLength(standard, 8000);
    const r = budgetJson();
    expect(r.exitCode).toBe(3);
    expect(r.nodes).toEqual([{ slug: leaf, kind: "leaf", metric: "chars", measured: 16001, cap: 16000 }]);
    const human = runLore(["status", "--check-prd-budget"]);
    expect(human.exitCode).toBe(3);
    expect(human.stdout).toContain(leaf);
    expect(human.stdout).toContain("16001");
    expect(human.stdout).toContain("16000");
  });

  it("reports a branch of 16001 chars", () => {
    setBodyLength(leaf, 16000);
    setBodyLength(branch, 16001);
    const r = budgetJson();
    expect(r.exitCode).toBe(3);
    expect(r.nodes).toEqual([{ slug: branch, kind: "branch", metric: "chars", measured: 16001, cap: 16000 }]);
  });

  it("reports a standard of 8001 chars (its cap is 8000, not 16000)", () => {
    setBodyLength(branch, 16000);
    setBodyLength(standard, 8001);
    const r = budgetJson();
    expect(r.exitCode).toBe(3);
    expect(r.nodes).toEqual([{ slug: standard, kind: "standard", metric: "chars", measured: 8001, cap: 8000 }]);
  });
});

describe("AC-BLS3B-8 per-kind node budgets: rules", () => {
  it("passes a leaf with exactly 30 rules, reports 31 as a finding naming node, kind, count and cap (exit 3)", () => {
    setBodyLength(standard, 8000);
    addRulesUpTo(30);
    const atCap = budgetJson();
    expect(atCap.exitCode).toBe(0);
    expect(atCap.nodes).toEqual([]);

    addRulesUpTo(31);
    const over = budgetJson();
    expect(over.exitCode).toBe(3);
    expect(over.nodes).toEqual([{ slug: leaf, kind: "leaf", metric: "rules", measured: 31, cap: 30 }]);
  });
});

describe("AC-BLS3B-8 caps are read from budget.baseline.*", () => {
  it("a configured leaf_rules cap of 31 passes the 31-rule leaf; a configured standard_chars of 100 flags a 101-char standard", () => {
    patchLoreConfig(dir, "budget:\n  baseline:\n    leaf_rules: 31\n    standard_chars: 100\n");
    setBodyLength(standard, 101);
    const r = budgetJson();
    expect(r.exitCode).toBe(3);
    expect(r.nodes).toEqual([{ slug: standard, kind: "standard", metric: "chars", measured: 101, cap: 100 }]);
    setBodyLength(standard, 100);
    expect(budgetJson().exitCode).toBe(0);
  });
});

describe("AC-BLS3B-8 PRD checks kept, outline checks retired", () => {
  it("still exits 3 on a PRD body of 24001 chars, 0 at 24000", () => {
    setBodyLength(prd, 24001);
    expect(runLore(["status", "--check-prd-budget"]).exitCode).toBe(3);
    setBodyLength(prd, 24000);
    expect(runLore(["status", "--check-prd-budget"]).exitCode).toBe(0);
  });

  it("still flags a free-text extra string over 1000 chars", () => {
    const db = new Database(join(dir, ".lore", "lore.db"), { readwrite: true });
    try {
      const row = db.query("SELECT extra FROM docs WHERE slug = ?").get(prd) as { extra: string };
      const extra = { ...(JSON.parse(row.extra || "{}") as Record<string, unknown>), note: "y".repeat(1001) };
      db.run("UPDATE docs SET extra = ? WHERE slug = ?", [JSON.stringify(extra), prd]);
    } finally {
      db.close();
    }
    const r = runLore(["status", "--check-prd-budget"]);
    expect(r.exitCode).toBe(3);
    expect(r.stdout).toContain("extra.note");
  });

  it("reports neither a tier nor a detail-link finding for a stored outline entry (4001-char direction, zero detail links)", () => {
    const db = new Database(join(dir, ".lore", "lore.db"), { readwrite: true });
    try {
      const outline = [
        {
          section: "legacy",
          title: "Legacy",
          tier: "core",
          direction: "z".repeat(4001),
          decision_pointers: [],
          constraints: [],
          links: [],
        },
      ];
      db.run("UPDATE docs SET extra = ? WHERE slug = ?", [JSON.stringify({ outline }), prd]);
    } finally {
      db.close();
    }
    const r = runLore(["status", "--check-prd-budget", "--json"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).not.toContain('"tier"');
    expect(r.stdout).not.toContain("detail_link");
  });
});
