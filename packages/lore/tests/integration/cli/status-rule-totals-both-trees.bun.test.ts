// @spawns packages/lore/src/index.ts
// @spawns packages/lore/tests/helpers/approve-nodes-cli.ts
/**
 * `lore status --json` baseline rule totals count BOTH trees (BR-670, AC-FIP-4, issue #136), over a
 * throwaway corpus (mkdtemp + `lore init`; the repo's own `.lore/` is never touched).
 *
 * Contract:
 *   - `rules_total`, `rules_by_lifecycle`, `rules_by_verification` cover every CITABLE rule: business leaf
 *     rules (BR-n) and architecture standard rules (AS-n).
 *   - `rules_by_family` says which family each counted rule belongs to ({BR, AS}); nothing is silently merged.
 *   - AD-n debt entries are NOT citable, so they are never in those totals; `debt_entries` reports them apart.
 *   - An AS rule cited by a passing attested script criterion is `passing_staleness_unchecked`, exactly like a BR rule.
 *
 * Dimensions: HAPPY (2 BR + 1 AS = 3), NEGATIVE (AD stays out of the totals), STATE (verification via a
 * passing script AC citing the AS rule), REGRESSION (a corpus with no architecture tree reports BR-only
 * totals and `AS: 0`).
 *
 * @spec_ref AC-FIP-4
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const setDefaultTimeout = (ms: number): void => { vi.setConfig({ testTimeout: ms, hookTimeout: ms }); };
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { patchLoreConfig } from "../../helpers/patch-lore-config.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approveFixtureNodes } from "../../helpers/cli-live-rule.js";

setDefaultTimeout(300_000);

const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const ACTOR = "agent:status-totals-test";

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
  const m = stdout.match(/Slug:\s+(\S+)/) ?? stdout.match(/Created baseline [\w-]+ (\S+) \(/);
  if (!m?.[1]) throw new Error(`no slug in: ${stdout}`);
  return m[1];
}

const RULE = ["--confidence", "established", "--enforced-by", "guaranteed", "--example", "e.g. one"];

interface BaselineBlock {
  rules_total: number;
  rules_by_lifecycle: { live: number; deprecated: number; retired: number };
  rules_by_verification: { contradicted: number; passing_staleness_unchecked: number; unverified: number; stale: string };
  rules_by_family: { BR: number; AS: number };
  debt_entries: number;
}

function baselineOf(cwd: string): BaselineBlock {
  const r = mustRun(["status", "--json"], cwd);
  return (JSON.parse(r.stdout) as { data: { baseline: BaselineBlock } }).data.baseline;
}

function vcs(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
}

function fixtureDir(prefix: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  if (d.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
  vcs(d, ["init", "-q", "-b", "main"]);
  vcs(d, ["config", "user.email", "totals@example.invalid"]);
  vcs(d, ["config", "user.name", "totals test"]);
  writeFileSync(join(d, "README.md"), "fixture\n");
  vcs(d, ["add", "."]);
  vcs(d, ["commit", "-q", "-m", "init"]);
  mustRun(["init"], d);
  return d;
}

const scratch: string[] = [];
let both = "";
let businessOnly = "";

beforeAll(() => {
  // Corpus A: 2 BR + 1 AS live (+ 1 AD). A passing attested script AC cites AS-1.
  both = fixtureDir("totals-both-");
  scratch.push(both);
  const prd = slugOf(mustRun(["create", "prd", "--title", "Totals PRD", "--content", "root", "--no-ai"], both).stdout);
  const bizRoot = slugOf(mustRun(["baseline", "add", prd, "--node", "root", "--label", "biz", "--title", "Biz Root"], both).stdout);
  const leaf = slugOf(mustRun(["baseline", "add", bizRoot, "--node", "leaf", "--label", "leaf", "--title", "Biz Leaf"], both).stdout);
  mustRun(["rule", "add", leaf, "--statement", "First business rule", ...RULE], both);
  mustRun(["rule", "add", leaf, "--statement", "Second business rule", ...RULE], both);
  const archRoot = slugOf(mustRun(["baseline", "add", prd, "--tree", "architecture", "--node", "root", "--label", "arch", "--title", "Arch Root"], both).stdout);
  const section = slugOf(mustRun(["baseline", "add", archRoot, "--tree", "architecture", "--node", "section", "--label", "svc", "--title", "Service Layer"], both).stdout);
  const standard = slugOf(mustRun(["baseline", "add", section, "--tree", "architecture", "--node", "standard", "--label", "std", "--title", "Result Standard"], both).stdout);
  const debt = slugOf(mustRun(["baseline", "add", section, "--tree", "architecture", "--node", "debt-registry", "--label", "debt", "--title", "Debt Registry"], both).stdout);
  mustRun(["rule", "add", debt, "--statement", "Legacy throw in X", ...RULE], both);
  mustRun(["rule", "add", standard, "--statement", "Services return Result", ...RULE], both);
  approveFixtureNodes(both, "all"); // direct adds are pending adds and new nodes are born draft: approve the fixture tree

  // A spec whose script AC cites AS-1, verified through lore verify (attested evidence).
  patchLoreConfig(both, ["workflow:", "  gates:", '    "task-create":', "      enabled: false", ""].join("\n"));
  mustRun(["create", "spec", "--title", "Cites Standard", "--no-ai", "--content", "## Overview\nbody"], both);
  mustRun(
    ["ac", "add", "spec-cites-standard", "AC-TOT-1", "--statement", "The standard holds.", "--mode", "script", "--oracle", "other", "--command", "true", "--cite", "AS-1"],
    both,
  );
  mustRun(["create", "plan", "--title", "Totals Plan", "--parent", "spec-cites-standard", "--no-ai", "--content", "body"], both);
  const task = slugOf(
    mustRun(["create", "task", "--kind", "code", "--title", "Totals Task", "--parent", "plan-totals-plan", "--plan-id", "plan-totals-plan", "--no-ai", "--content", "body"], both).stdout,
  );
  mustRun(["verify", "plan-totals-plan", "--task", task, "--ac", "AC-TOT-1", "--allow-new-commands"], both);

  // Corpus B: no architecture tree at all.
  businessOnly = fixtureDir("totals-biz-");
  scratch.push(businessOnly);
  const prdB = slugOf(mustRun(["create", "prd", "--title", "Biz PRD", "--content", "root", "--no-ai"], businessOnly).stdout);
  const rootB = slugOf(mustRun(["baseline", "add", prdB, "--node", "root", "--label", "biz", "--title", "Biz Root"], businessOnly).stdout);
  const leafB = slugOf(mustRun(["baseline", "add", rootB, "--node", "leaf", "--label", "leaf", "--title", "Biz Leaf"], businessOnly).stdout);
  mustRun(["rule", "add", leafB, "--statement", "Only business rule", ...RULE], businessOnly);
  approveFixtureNodes(businessOnly, "all");
});

afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

describe("status baseline rule totals count both trees (AC-FIP-4, BR-670)", () => {
  it("2 BR + 1 AS live rules report rules_total 3 with the family breakdown", () => {
    const b = baselineOf(both);
    expect(b.rules_total).toBe(3);
    expect(b.rules_by_lifecycle).toEqual({ live: 3, deprecated: 0, retired: 0 });
    expect(b.rules_by_family).toEqual({ BR: 2, AS: 1 });
  });

  it("an AD debt entry is not in the totals; it is reported apart", () => {
    const b = baselineOf(both);
    expect(b.debt_entries).toBe(1);
    expect(b.rules_by_family.BR + b.rules_by_family.AS).toBe(b.rules_total);
  });

  it("an AS rule cited by a passing attested script AC is passing_staleness_unchecked", () => {
    const b = baselineOf(both);
    expect(b.rules_by_verification).toEqual({
      contradicted: 0,
      passing_staleness_unchecked: 1,
      unverified: 2,
      stale: "not_computed",
    });
    const states = mustRun(["baseline", "tree", "--states", "--json"], both).stdout;
    const nodes = (JSON.parse(states) as { data: { tree: Array<{ rule_states: Array<{ rule_id: string; state: string }> }> } }).data.tree;
    const as1 = nodes.flatMap((n) => n.rule_states).find((r) => r.rule_id === "AS-1");
    // a pass recorded on a clean committed worktree with the spec declaring no code_anchors is unknown, never verified
    expect(as1).toBeDefined();
    expect(as1?.state).not.toBe("unverified");
  });

  it("a corpus without an architecture tree reports BR-only totals (REGRESSION)", () => {
    const b = baselineOf(businessOnly);
    expect(b.rules_total).toBe(1);
    expect(b.rules_by_family).toEqual({ BR: 1, AS: 0 });
    expect(b.debt_entries).toBe(0);
  });

  it("the default status output names both families in its rule line", () => {
    const r = mustRun(["status"], both);
    expect(r.stdout).toMatch(/Baseline rules: 3 \(BR 2, AS 1; live 3, deprecated 0, retired 0\); 1 AD debt entries not counted/);
  });
});
