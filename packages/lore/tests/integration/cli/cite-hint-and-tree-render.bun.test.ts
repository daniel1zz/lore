/**
 * AC-FIP-5 (BR-86, BR-982, BR-753): the enforce-mode citation refusal's hint, `lore tree --help`, and the
 * connector prefixes of `lore tree <prd>`.
 *
 * Findings (fresh-install consumer probe, F8/F9/F10):
 *   F8. A refused `lore ac add` (criterion NOT written) must suggest `lore ac add ... --cite <rule>`, never
 *       `lore ac cite` (which fails "not declared"). A refused `lore ac set` of an EXISTING criterion keeps
 *       `lore ac cite`.
 *   F9. `lore tree --help` names the business baseline root as the default root.
 *   F10. Depth-3 rows drew a stray `│` and 4 extra spaces; every depth must follow the same prefix rules
 *       (golden render for a 4-level tree under a PRD and under the baseline root).
 *
 * Every corpus is an mkdtemp outside the repo (never the repo's own `.lore/`).
 *
 * Dimensions: HAPPY (add hint, golden trees), NEGATIVE (add hint never says `lore ac cite`), BOUNDARY (last vs
 * non-last siblings at depth 3), STATE (set of an existing criterion keeps `ac cite`), REGRESSION (help text).
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const setDefaultTimeout = (ms: number): void => { vi.setConfig({ testTimeout: ms, hookTimeout: ms }); };
import { appendFileSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

setDefaultTimeout(300_000);

const LORE_ENTRY = new URL("../../../src/index.ts", import.meta.url).pathname;
const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function runLore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync(["bun", "run", LORE_ENTRY, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, CLAUDECODE: "1", LORE_ACTOR: "agent:cite-hint-tree-render" },
  });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function mustRun(args: string[], cwd: string): RunResult {
  const r = runLore(args, cwd);
  if (r.exitCode !== 0) throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r;
}

function slugOf(stdout: string): string {
  const m = stdout.match(/Slug:\s+(\S+)/) ?? stdout.match(/Created baseline \w+ (\S+) \(/) ?? stdout.match(/Run `lore get (\S+)`/);
  if (!m?.[1]) throw new Error(`no slug in: ${stdout}`);
  return m[1];
}

const ELIDED_ULID = /\b[0-9A-HJKMNP-TV-Z]{8}…[0-9A-HJKMNP-TV-Z]{5}\b/g;
const SHORT_ID = /\b[0-9A-HJKMNP-TV-Z]{8}\b/g;

/** Tree text with every document id replaced by `<id>`, so the golden compares structure only. */
function normaliseTree(text: string): string {
  return text.replace(ELIDED_ULID, "<id>").replace(SHORT_ID, "<id>").trimEnd();
}

const scratch: string[] = [];
let dir = "";
let prd = "";
let baselineRoot = "";
let specSlug = "";
let ruleId = "";

beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "cite-hint-tree-")));
  scratch.push(dir);
  if (dir.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
  mustRun(["init"], dir);
  prd = slugOf(mustRun(["create", "prd", "--title", "Hint PRD", "--content", "root", "--no-ai"], dir).stdout);
  baselineRoot = slugOf(mustRun(["baseline", "add", prd, "--node", "root", "--label", "Root", "--title", "Hint Root"], dir).stdout);
  const branchA = slugOf(mustRun(["baseline", "add", baselineRoot, "--node", "branch", "--label", "A", "--title", "Branch A"], dir).stdout);
  const branchB = slugOf(mustRun(["baseline", "add", baselineRoot, "--node", "branch", "--label", "B", "--title", "Branch B"], dir).stdout);
  slugOf(mustRun(["baseline", "add", branchB, "--node", "leaf", "--label", "L3", "--title", "Leaf Three"], dir).stdout);
  const leafA1 = slugOf(mustRun(["baseline", "add", branchA, "--node", "leaf", "--label", "L1", "--title", "Leaf One"], dir).stdout);
  slugOf(mustRun(["baseline", "add", branchA, "--node", "leaf", "--label", "L2", "--title", "Leaf Two"], dir).stdout);
  const ruleOut = mustRun(
    ["rule", "add", leafA1, "--statement", "Users see the first thing", "--confidence", "established", "--enforced-by", "guaranteed", "--example", "example one"],
    dir,
  );
  const id = ruleOut.stdout.match(/\bBR-\d+\b/)?.[0];
  if (id === undefined) throw new Error(`no rule id in: ${ruleOut.stdout}`);
  ruleId = id;
  specSlug = slugOf(mustRun(["create", "spec", "--title", "Hint Spec", "--content", "## Spec\n\nbody", "--no-ai"], dir).stdout);
  // AC-H-1 cites a rule under branch A, which places the spec there (the gate arms per branch); AC-H-0 is an
  // uncited criterion that predates the gate, so a later `ac set` of it is a refused write of an EXISTING criterion.
  mustRun(["ac", "add", specSlug, "AC-H-1", "--statement", "placing human criterion", "--mode", "human", "--cite", ruleId], dir);
  mustRun(["ac", "add", specSlug, "AC-H-0", "--statement", "existing uncited criterion", "--mode", "human"], dir);
  appendFileSync(
    join(dir, ".lore", "config.yaml"),
    `workflow:\n  gates:\n    ac-cite:\n      mode: enforce\n      armed_branches:\n        - ${branchA}\n`,
  );
});

afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

describe("AC-FIP-5 / F8: the refusal hint names a command that works for the refused write", () => {
  it("a refused `ac add` suggests `ac add ... --cite`, never `ac cite` for the unwritten criterion", () => {
    const r = runLore(["ac", "add", specSlug, "AC-H-2", "--statement", "added uncited", "--mode", "human"], dir);
    const out = `${r.stdout}${r.stderr}`;
    expect(r.exitCode).not.toBe(0);
    expect(out).toContain("AC_CITE_REQUIRED");
    expect(out).toContain(`lore ac add ${specSlug} AC-H-2`);
    expect(out).toContain("--cite");
    expect(out).not.toContain(`lore ac cite ${specSlug} AC-H-2`);
  });

  it("the suggested add line, pasted with a real rule id, is accepted (the hint is runnable)", () => {
    const r = runLore(["ac", "add", specSlug, "AC-H-3", "--statement", "added cited", "--mode", "human", "--cite", ruleId], dir);
    expect(r.exitCode).toBe(0);
  });

  it("a refused `ac set` of an EXISTING criterion keeps `lore ac cite`", () => {
    const r = runLore(["ac", "set", specSlug, "AC-H-0", "--statement", "existing uncited criterion, revised"], dir);
    const out = `${r.stdout}${r.stderr}`;
    expect(r.exitCode).not.toBe(0);
    expect(out).toContain("AC_CITE_REQUIRED");
    expect(out).toContain(`lore ac cite ${specSlug} AC-H-0`);
    expect(out).not.toContain(`lore ac add ${specSlug} AC-H-0`);
  });
});

describe("AC-FIP-5 / F9: `lore tree --help` default root", () => {
  it("names the business baseline root, not the first PRD", () => {
    const r = runLore(["tree", "--help"], dir);
    const out = `${r.stdout}${r.stderr}`;
    expect(out).toContain("baseline root");
    expect(out).not.toContain("default: first PRD");
  });
});

describe("AC-FIP-5 / F10: tree connector prefixes are identical at every depth (golden)", () => {
  // Sibling order is the service's (newest first), not this test's concern: the fixture fixes it.
  const BASELINE_GOLDEN = [
    "<id> Hint Root (draft)",
    "├── <id> Branch B (draft)",
    "│   └── <id> Leaf Three (draft)",
    "└── <id> Branch A (draft)",
    "    ├── <id> Leaf One (draft)",
    "    └── <id> Leaf Two (draft)",
  ].join("\n");

  it("under the baseline root (default root)", () => {
    expect(normaliseTree(mustRun(["tree"], dir).stdout)).toBe(BASELINE_GOLDEN);
  });

  it("under the PRD: the same rows, one level deeper, with no stray `│` or extra spaces", () => {
    const golden = [
      "<id> Hint PRD (draft)",
      "└── <id> Hint Root (draft)",
      "    ├── <id> Branch B (draft)",
      "    │   └── <id> Leaf Three (draft)",
      "    └── <id> Branch A (draft)",
      "        ├── <id> Leaf One (draft)",
      "        └── <id> Leaf Two (draft)",
    ].join("\n");
    expect(normaliseTree(mustRun(["tree", prd, "--depth", "4"], dir).stdout)).toBe(golden);
  });

  it("depth 1 rows keep the plain connectors", () => {
    const only = normaliseTree(mustRun(["tree", baselineRoot, "--depth", "1"], dir).stdout);
    expect(only).toBe(["<id> Hint Root (draft)", "├── <id> Branch B (draft)", "└── <id> Branch A (draft)"].join("\n"));
  });
});
