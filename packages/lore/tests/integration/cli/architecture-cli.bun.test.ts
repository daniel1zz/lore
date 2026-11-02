// @spawns packages/lore/src/index.ts
// @spawns packages/lore/tests/helpers/approve-nodes-cli.ts
/**
 * Architecture tree on the CLI surface (Baseline slice 3a, AC-BLS3-1 / BR-979), over a throwaway corpus.
 *
 * Spec: spec-baseline-slice-3a-architecture-tree-baseline-root (Design -> Architecture tree):
 *   - `lore baseline add <parent> --tree architecture --node root|section|module-card|standard|debt-registry`;
 *     no `--tree` = business, unchanged;
 *   - `lore rule add` on a standard allocates AS-n, on a debt-registry AD-n; the four-part standard flags
 *     (`--current-reality --target-rule --current-exception AD-n... --migration`) are stored all-or-nothing;
 *     `lore rule set` edits the four parts;
 *   - `lore baseline tree` shows which tree each node belongs to.
 *
 * CONTRACT (the spec leaves these open):
 *   C1. `--json` of `baseline add` echoes `data.tree` ("business" | "architecture").
 *   C2. `baseline tree` text prefixes the node kind with `architecture ` for architecture nodes and leaves
 *       business lines byte-identical; `--json` entries carry `tree`.
 *   C3. A partial four-part standard or a non-live `--current-exception` exits 4 (VALIDATION_ERROR).
 *
 * The repo's own `.lore/` is never touched; the corpus is an `mkdtemp` outside the repo.
 *
 * Dimensions: HAPPY (5 node kinds, AS-1/AD-1), NEGATIVE (partial parts, AD-99, wrong parent / kind / tree),
 * STATE (set edits parts), REGRESSION (business add/tree unchanged), BOUNDARY (all-or-nothing).
 *
 * @spec_ref spec-baseline-slice-3a-architecture-tree-baseline-root#AC-BLS3-1
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const setDefaultTimeout = (ms: number): void => { vi.setConfig({ testTimeout: ms, hookTimeout: ms }); };
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approveFixtureNodes } from "../../helpers/cli-live-rule.js";
import { DECIDED_FLAGS } from "../../helpers/decision-flags.js";
import { templatedFieldsArgs } from "../../helpers/templated-create.js";

setDefaultTimeout(300_000);

const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const ACTOR = "agent:arch-cli-test";

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

const scratch: string[] = [];
let dir = "";
let prd = "";
let archRoot = "";
let archSection = "";
let standard = "";
let debtRegistry = "";
let businessRoot = "";

function archAdd(parent: string, node: string, label: string, title: string, extra: string[] = []): RunResult {
  return runLore(["baseline", "add", parent, "--tree", "architecture", "--node", node, "--label", label, "--title", title, ...templatedFieldsArgs("baseline", { kind: node }), ...extra], dir);
}

function git(args: string[]): void {
  execFileSync("git", args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
}

beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "archcli-")));
  scratch.push(dir);
  if (dir.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "arch@example.invalid"]);
  git(["config", "user.name", "arch test"]);
  writeFileSync(join(dir, "README.md"), "fixture\n");
  git(["add", "."]);
  git(["commit", "-q", "-m", "init"]);
  mustRun(["init"], dir);
  prd = slugOf(mustRun(["create", "prd", "--title", "Arch PRD", ...templatedFieldsArgs("prd", { refTarget: "problem" }), "--no-ai"], dir).stdout);
  businessRoot = slugOf(mustRun(["baseline", "add", prd, "--node", "root", "--label", "biz", "--title", "Biz Root", ...templatedFieldsArgs("baseline", { kind: "root" })], dir).stdout);
  archRoot = slugOf(mustRun(["baseline", "add", prd, "--tree", "architecture", "--node", "root", "--label", "arch", "--title", "Arch Root", ...templatedFieldsArgs("baseline", { kind: "root" })], dir).stdout);
  archSection = slugOf(mustRun(["baseline", "add", archRoot, "--tree", "architecture", "--node", "section", "--label", "svc", "--title", "Service Layer", ...templatedFieldsArgs("baseline", { kind: "section" })], dir).stdout);
  standard = slugOf(mustRun(["baseline", "add", archSection, "--tree", "architecture", "--node", "standard", "--label", "std", "--title", "Result Standard", ...templatedFieldsArgs("baseline", { kind: "standard" })], dir).stdout);
  debtRegistry = slugOf(mustRun(["baseline", "add", archSection, "--tree", "architecture", "--node", "debt-registry", "--label", "debt", "--title", "Debt Registry", ...templatedFieldsArgs("baseline", { kind: "debt-registry" })], dir).stdout);
});

afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

const RULE = ["--confidence", "established", "--enforced-by", "guaranteed", "--example", "e.g. one"];

describe("lore baseline add --tree architecture (spec-baseline-slice-3a-architecture-tree-baseline-root#AC-BLS3-1)", () => {
  it("creates root, section, standard and debt-registry (fixture) and a module-card", () => {
    expect(archRoot).not.toBe("");
    expect(archSection).not.toBe("");
    expect(standard).not.toBe("");
    expect(debtRegistry).not.toBe("");
    const card = archAdd(archSection, "module-card", "mod", "Module Card");
    expect(card.exitCode).toBe(0);
    expect(card.stdout).toContain("Created baseline module-card");
  });

  it("--json echoes the tree", () => {
    const r = archAdd(archSection, "module-card", "mod2", "Module Card 2", ["--json"]);
    expect(r.exitCode).toBe(0);
    expect((JSON.parse(r.stdout) as { data: { tree: string } }).data.tree).toBe("architecture");
  });

  it("refuses an architecture section under a section with exit 4", () => {
    expect(archAdd(archSection, "section", "bad", "Bad Section").exitCode).toBe(4);
  });

  it("refuses a business node kind under --tree architecture with exit 4", () => {
    expect(archAdd(archSection, "leaf", "bad", "Bad Leaf").exitCode).toBe(4);
  });

  it("refuses an unknown --tree value with a non-zero exit", () => {
    const r = runLore(["baseline", "add", prd, "--tree", "bogus", "--node", "root", "--label", "x", "--title", "X", ...templatedFieldsArgs("baseline", { kind: "root" })], dir);
    expect(r.exitCode).not.toBe(0);
  });

  it("business add without --tree is unchanged", () => {
    const r = runLore(["baseline", "add", businessRoot, "--node", "branch", "--label", "b", "--title", "Biz Branch", ...templatedFieldsArgs("baseline", { kind: "branch" }), "--json"], dir);
    expect(r.exitCode).toBe(0);
    expect((JSON.parse(r.stdout) as { data: { tree: string } }).data.tree).toBe("business");
  });
});

describe("lore rule add on architecture nodes", () => {
  it("allocates AD-1 on the debt registry", () => {
    const r = runLore(["rule", "add", debtRegistry, "--statement", "Legacy throw in X", ...RULE], dir);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Added AD-1");
    // a direct add is a pending add; a standard's exception must name an APPROVED live debt entry, so approve the registry
    approveFixtureNodes(dir, "all");
  });

  it("allocates AS-1 on a standard with the four parts stored", () => {
    const r = runLore(
      ["rule", "add", standard, "--statement", "Services return Result", ...RULE,
        "--current-reality", "some services throw", "--target-rule", "all return Result",
        "--current-exception", "AD-1", "--migration", "convert per module", "--json", ...DECIDED_FLAGS],
      dir,
    );
    expect(r.exitCode).toBe(0);
    expect((JSON.parse(r.stdout) as { data: { ruleId: string } }).data.ruleId).toBe("AS-1");
    const shown = mustRun(["get", standard, "--json"], dir).stdout;
    expect(shown).toContain("some services throw");
    expect(shown).toContain("all return Result");
    expect(shown).toContain("convert per module");
    expect(shown).toContain("AD-1");
  });

  it("refuses a partial four-part standard (only --target-rule) with exit 4", () => {
    expect(runLore(["rule", "add", standard, "--statement", "Partial", ...RULE, "--target-rule", "t"], dir).exitCode).toBe(4);
  });

  it("refuses --current-exception AD-99 (not a live debt entry) with exit 4", () => {
    const r = runLore(
      ["rule", "add", standard, "--statement", "Ghost", ...RULE,
        "--current-reality", "r", "--target-rule", "t", "--current-exception", "AD-99", "--migration", "m"],
      dir,
    );
    expect(r.exitCode).toBe(4);
  });

  it("--current-exceptions-none stores an empty exception list; combined with --current-exception exits 2", () => {
    const four = ["--current-reality", "r", "--target-rule", "t", "--migration", "m"];
    const none = runLore(["rule", "add", standard, "--statement", "Clean standard", ...RULE, ...four, "--current-exceptions-none", ...DECIDED_FLAGS], dir);
    expect(none.exitCode).toBe(0);
    expect(none.stdout).toContain("Added AS-");
    const both = runLore(["rule", "add", standard, "--statement", "Both", ...RULE, ...four, "--current-exceptions-none", "--current-exception", "AD-1"], dir);
    expect(both.exitCode).toBe(2);
  });

  it("business rule add is unchanged (no four-part flags)", () => {
    const leaf = slugOf(mustRun(["baseline", "add", businessRoot, "--node", "leaf", "--label", "l", "--title", "Biz Leaf", ...templatedFieldsArgs("baseline", { kind: "leaf" })], dir).stdout);
    const r = runLore(["rule", "add", leaf, "--statement", "Business rule", ...RULE], dir);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Added BR-");
  });
});

describe("lore rule set edits the four parts", () => {
  it("updates current_reality and migration on AS-1, leaving target_rule", () => {
    const r = runLore(["rule", "set", "AS-1", "--current-reality", "reality v2", "--migration", "migration v2", "--json", ...DECIDED_FLAGS], dir);
    expect(r.exitCode).toBe(0);
    const rule = (JSON.parse(r.stdout) as { data: { rule: { current_reality: string; migration: string; target_rule: string } } }).data.rule;
    expect(rule.current_reality).toBe("reality v2");
    expect(rule.migration).toBe("migration v2");
    expect(rule.target_rule).toBe("all return Result");
  });

  it("replaces current_exceptions; a non-live id exits 4", () => {
    expect(runLore(["rule", "set", "AS-1", "--current-exception", "AD-99"], dir).exitCode).toBe(4);
    expect(runLore(["rule", "set", "AS-1", "--current-exception", "AD-1", ...DECIDED_FLAGS], dir).exitCode).toBe(0);
  });
});

describe("lore baseline tree shows each node's tree", () => {
  it("marks architecture nodes in text and --json; business lines unchanged", () => {
    const text = mustRun(["baseline", "tree"], dir).stdout;
    expect(text).toMatch(/^architecture root arch \(/m);
    expect(text).toMatch(/^root biz \(/m);
    const json = (JSON.parse(mustRun(["baseline", "tree", "--json"], dir).stdout) as { data: { slug: string; tree: string }[] }).data;
    expect(json.find((e) => e.slug === archRoot)?.tree).toBe("architecture");
    expect(json.find((e) => e.slug === businessRoot)?.tree).toBe("business");
  });
});
