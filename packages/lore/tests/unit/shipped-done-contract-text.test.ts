// @reads assets/**
// @reads CLAUDE.md
// @reads packages/lore/src/generated/assets-manifest.ts
// @reads packages/lore/package.json
// @reads scripts/agent-hygiene-allowlist.json
// @reads packages/lore/src/adapters/cli/CLAUDE.md
// @reads packages/lore/src/service/CLAUDE.md
// @spawns dist/lore -- the command-existence cases run the compiled binary's --help for every command the shipped text names
/**
 * Shipped done-contract text (spec-done-contract-compiled-at-approve-task-kinds-write-sets, AC-DCS1-24).
 *
 * The shipped agent, skill and context text and the module docs name the one flow (`lore start`,
 * `lore finish`, `lore land`, `lore dispatch`) and none of the removed ones. Reads this repository's
 * own checked-in text (never a corpus) and the compiled `dist/lore` for command existence.
 *
 * Coverage:
 *   HAPPY:      every listed file names the four verbs; implementer + corpus-workflow name --red-waiver and the kinds;
 *               the implementer holds the falsifier sentence once
 *   NEGATIVE:   no removed surface appears in any listed file or in the manifest text
 *   BOUNDARY:   the sentence check is exact: a changed sentence is counted zero times although `lore finish` remains
 *   ERROR:      the removed-surface matcher flags a synthetic stale line (non-tautological)
 *   STATE:      the checked-in assets manifest equals a fresh generation (a stale embedded copy is red)
 *   REGRESSION: the shipped text stays free of the agent-hygiene patterns; every command named exists in the binary
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildManifest, renderGeneratedFile } from "../../../../scripts/embed-assets-manifest.mjs";
import { HYGIENE_RULES, loadAllowlist, scanAgentHygiene } from "../../../../scripts/check-agent-hygiene";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");
const MANIFEST_PATH = "packages/lore/src/generated/assets-manifest.ts";

const IMPLEMENTER = "assets/agents/lore-implementer.md";
const WORKFLOW_EXECUTE = "assets/context/corpus-workflow-3-execute.md";

const SHIPPED_FILES: readonly string[] = [
  IMPLEMENTER,
  WORKFLOW_EXECUTE,
  "assets/context/evidence-attestation.md",
  "assets/context/worktree-dispatch.md",
  "assets/skills/lore/SKILL.md",
  "assets/skills/lore-plan/SKILL.md",
  "assets/skills/lore-plan/references/mode-create.md",
  "assets/skills/lore-autopilot/SKILL.md",
  "assets/skills/shared/lore-cli-map.md",
  "CLAUDE.md",
  "packages/lore/src/adapters/cli/CLAUDE.md",
  "packages/lore/src/service/CLAUDE.md",
];

const VERBS = ["lore start", "lore finish", "lore land", "lore dispatch"] as const;

/** One removed surface: what it is and the pattern that finds it. */
interface RemovedSurface {
  readonly name: string;
  readonly pattern: RegExp;
}

const REMOVED_SURFACES: readonly RemovedSurface[] = [
  { name: "--declare-no-new-tests", pattern: /--declare-no-new-tests/ },
  { name: "lore red-first", pattern: /lore red-first/ },
  { name: "hand merge into the integration branch", pattern: /hand[- ]merg|git merge[^\n]*integration|merge[^\n]*(?:branch )?into the integration branch/i },
  { name: "close task", pattern: /close[- ]tasks?\b/i },
  { name: "legacy no-branch claim", pattern: /no-branch claim|claim (?:naming|with|without) no branch|claim naming no worktree/i },
  { name: "attestation override (D45)", pattern: /--override-attestation/ },
  { name: "separate [Skill:test] red task", pattern: /\[Skill:test\]/ },
  { name: "test-task blocks impl-task link", pattern: /lore link <test-task> <impl-task> --type=blocks/ },
  { name: "MCP server", pattern: /MCP server/ },
];

const SENTENCE = "Run `lore finish` once every oracle is ready; it runs them for you.";

function read(path: string): string {
  return readFileSync(join(REPO_ROOT, path), "utf8");
}

function surfacesIn(text: string): string[] {
  return REMOVED_SURFACES.filter((surface) => surface.pattern.test(text)).map((surface) => surface.name);
}

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function runLore(args: readonly string[]): { status: number | null; out: string } {
  const result = spawnSync(LORE_BIN, [...args], { cwd: REPO_ROOT, encoding: "utf8", timeout: 30_000 });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

describe("shipped done-contract text", () => {
  it("AC-DCS1-24: every listed file names lore start, lore finish, lore land and lore dispatch", () => {
    const missing = SHIPPED_FILES.flatMap((path) => {
      const text = read(path);
      return VERBS.filter((verb) => !text.includes(verb)).map((verb) => `${path}: ${verb}`);
    });
    expect(missing).toEqual([]);
  });

  it("AC-DCS1-24: the implementer and corpus-workflow files name --red-waiver and the three kinds", () => {
    for (const path of [IMPLEMENTER, WORKFLOW_EXECUTE]) {
      const text = read(path);
      expect(text, path).toContain("--red-waiver");
      for (const kind of ["`code`", "`check`", "`corpus`"]) expect(text, `${path}: ${kind}`).toContain(kind);
    }
  });

  it("AC-DCS1-24: the implementer and corpus-workflow files state the integrate-at-landing facts", () => {
    for (const path of [IMPLEMENTER, WORKFLOW_EXECUTE]) {
      const text = read(path);
      expect(text, `${path}: lore integrate`).toContain("lore integrate");
      expect(text, `${path}: flaky`).toMatch(/flaky/);
      expect(text, `${path}: FIFO`).toMatch(/FIFO/);
      // Key tokens, all on one line, so dropping the migrate-waiver instruction goes red without pinning its prose.
      const tokens = ["lore migrate done-contract", "--apply", "--red-waiver", "<slug>=<reason>"];
      const migrateLine = text.split("\n").find((line) => tokens.every((token) => line.includes(token)));
      expect(migrateLine, `${path}: migrate waiver line naming ${tokens.join(", ")}`).toBeDefined();
    }
  });

  it("AC-DCS1-24: no listed file contains a removed surface", () => {
    const hits = SHIPPED_FILES.flatMap((path) => surfacesIn(read(path)).map((name) => `${path}: ${name}`));
    expect(hits).toEqual([]);
  });

  it("AC-DCS1-24: lore-plan describes the red run as the default of a code task's contract", () => {
    for (const path of ["assets/skills/lore-plan/SKILL.md", "assets/skills/lore-plan/references/mode-create.md"]) {
      const text = read(path);
      expect(text, `${path}: red_required`).toContain("red_required");
      expect(text, `${path}: red waiver`).toContain("--red-waiver");
    }
  });

  it("AC-DCS1-24: the removed-surface matcher flags a synthetic stale line (non-tautological)", () => {
    expect(surfacesIn("run lore done --declare-no-new-tests why")).toEqual(["--declare-no-new-tests"]);
    expect(surfacesIn("lore red-first <task>")).toEqual(["lore red-first"]);
    expect(surfacesIn("create a close task per plan")).toEqual(["close task"]);
    expect(surfacesIn("a no-branch claim keeps main's head")).toEqual(["legacy no-branch claim"]);
    expect(surfacesIn("git merge task/x into the integration branch by hand")).toContain("hand merge into the integration branch");
    expect(surfacesIn("lore done --override-attestation")).toEqual(["attestation override (D45)"]);
    expect(surfacesIn("`lore finish` and `lore land` only")).toEqual([]);
  });

  it("AC-DCS1-24: the implementer holds the falsifier sentence exactly once", () => {
    expect(occurrences(read(IMPLEMENTER), SENTENCE)).toBe(1);
  });

  it("AC-DCS1-24: a changed sentence is counted zero times although lore finish still appears in the file", () => {
    const changed = read(IMPLEMENTER).replace(SENTENCE, "Run `lore finish` when you are done; it runs them for you.");
    expect(changed).toContain("lore finish");
    expect(occurrences(changed, SENTENCE)).toBe(0);
    const doubled = `${read(IMPLEMENTER)}\n${SENTENCE}\n`;
    expect(occurrences(doubled, SENTENCE)).toBe(2);
  });

  it("AC-DCS1-24: the checked-in assets manifest equals a fresh generation (a stale embedded copy is red)", () => {
    const fresh = renderGeneratedFile(buildManifest(join(REPO_ROOT, "assets"), REPO_ROOT));
    expect(read(MANIFEST_PATH)).toBe(fresh);
  });

  it("AC-DCS1-24: the manifest text names no removed surface", () => {
    expect(surfacesIn(read(MANIFEST_PATH))).toEqual([]);
  });

  it("AC-DCS1-24: the shipped asset text carries no agent-hygiene rule hit", () => {
    const files = SHIPPED_FILES.filter((path) => path.startsWith("assets/")).map((path) => ({ path, content: read(path) }));
    expect(files.length).toBeGreaterThan(0);
    expect(HYGIENE_RULES.length).toBeGreaterThan(0);
    const unexempt = scanAgentHygiene(files, loadAllowlist(REPO_ROOT)).filter((finding) => finding.kind === "rule-hit");
    expect(unexempt).toEqual([]);
    const planted = scanAgentHygiene([{ path: "assets/x.md", content: "run git stash push now" }], { entries: [] });
    expect(planted.map((finding) => finding.ruleId)).toEqual(["stash-steer"]);
  });

  it("AC-DCS1-24: every command the shipped text names exists in the compiled binary", () => {
    for (const command of ["start", "finish", "land", "dispatch"]) {
      const { status, out } = runLore([command, "--help"]);
      expect(status, `lore ${command} --help: ${out.slice(0, 200)}`).toBe(0);
      expect(out, `lore ${command} --help`).toContain(`lore ${command}`);
    }
    expect(runLore(["approve", "--help"]).out).toContain("--red-waiver");
    expect(runLore(["claim", "--help"]).out).toContain("--write-set");
    expect(runLore(["migrate", "--help"]).out).toContain("done-contract");
    const retired = runLore(["red-first", "x"]);
    expect(retired.status).not.toBe(0);
  });
});
