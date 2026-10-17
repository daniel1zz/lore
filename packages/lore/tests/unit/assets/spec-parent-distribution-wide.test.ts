// @reads assets/**
/**
 * Every shipped asset carries the no-parent spec contract (AC-FIP-2; BR-1, BR-2, BR-1007).
 *
 * The earlier oracle (spec-parent-distribution.test.ts, AC-BLS3B-9) only matched a spec-create
 * command and the parent flag on one line, so a table cell ("spec | parent flag") and
 * contradicting prose ("Every spec needs a parent") slipped into the fresh-install probe. This
 * scan covers every file under assets/ and every phrasing of "a spec needs / takes a parent",
 * and also pins the two positive facts consumers need: kickoff builds a baseline leaf + rule
 * before its spec step, and lore-baseline marks `baseline sites|coverage` as lore-source-only.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../../../../..");
const ASSETS = join(REPO_ROOT, "assets");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (!/\.(png|jpe?g|gif|ico|woff2?|zip|gz)$/i.test(name)) out.push(p);
  }
  return out;
}

/** A line that explicitly states the opposite contract is never an offender. */
const STATES_OPPOSITE =
  /takes? no parent|takes? \*\*no\*\* parent|\bno parent\b|never filed under|parentless|without a parent|must not (carry|take|have) a parent|refus\w* (a |the )?`?--parent|PARENT_REQUIRED/i;

const MENTIONS_SPEC = /\bspecs?\b/i;

/** Ways a line can pair "spec" with a parent. Each is tested on a spec-mentioning line. */
const PAIRS_SPEC_WITH_PARENT: RegExp[] = [
  /--parent\b/, // table cell, command, prose
  /\bparent_id\b/,
  /\bspec(s|'s)?\b[^.\n|]{0,60}\b(needs?|requires?|required|must have|has to have|with|under|to) (a |an |the |its )?(parent|PRD)\b/i,
  /\b(needs?|requires?|required|must have) (a |an )?parent\b/i,
  /\bparent (is|=|:) (the )?(root )?PRD\b/i,
  /\bspec(s)? parents?\b/i,
  /\bparents? (to|under) the (root )?PRD\b/i,
];

/** A `--parent` aimed at a plan/task/knowledge/adr create is about that doc type, not a spec. */
const NON_SPEC_PARENT_COMMAND = /create (plan|task|knowledge|adr)\b[^`\n]*--parent\b[^`\n]*/g;
/** Table rows whose first cell is another doc type. */
const NON_SPEC_ROW = /^\|\s*(task|plan|adr|knowledge|prd)\b.*$/i;

function offends(raw: string): boolean {
  if (!MENTIONS_SPEC.test(raw)) return false;
  if (STATES_OPPOSITE.test(raw)) return false;
  const line = raw.replace(NON_SPEC_PARENT_COMMAND, "").replace(NON_SPEC_ROW, "");
  return PAIRS_SPEC_WITH_PARENT.some((re) => re.test(line));
}

function scan(): string[] {
  const hits: string[] = [];
  for (const file of walk(ASSETS)) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((raw, i) => {
        if (offends(raw)) hits.push(`${relative(REPO_ROOT, file)}:${i + 1}: ${raw.trim().slice(0, 160)}`);
      });
  }
  return hits;
}

const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");

describe("shipped assets carry the no-parent spec contract everywhere (AC-FIP-2)", () => {
  it("no assets/** line states or implies a spec needs a parent", () => {
    expect(scan(), "offenders (file:line)").toEqual([]);
  });

  it("the scan itself catches the probe's regressions and spares the opposite statement", () => {
    expect(offends("| spec | `--parent <id-or-slug>` (+ optional `--kind feature`) |")).toBe(true);
    expect(offends("Every spec needs a parent and should declare acceptance criteria up front")).toBe(true);
    expect(offends("a spec's parent is the PRD")).toBe(true);
    expect(offends("a spec takes no parent: it relates to the trees by citing rules")).toBe(false);
    expect(offends("| task | `--parent <plan>` + `--plan-id <plan>` |")).toBe(false);
    expect(offends("lore create plan --title x --parent <spec>")).toBe(false);
  });

  it("lore-kickoff builds a baseline leaf and a rule before its spec step, and the spec step cites it", () => {
    const body = read("assets/skills/lore-kickoff/SKILL.md");
    const baseline = body.search(/lore baseline add/);
    const rule = body.search(/lore rule add/);
    const specStep = body.search(/lore create spec/);
    expect(baseline, "kickoff has a baseline-add step").toBeGreaterThan(-1);
    expect(rule, "kickoff has a rule-add step").toBeGreaterThan(-1);
    expect(specStep, "kickoff has a spec-create step").toBeGreaterThan(-1);
    expect(baseline).toBeLessThan(specStep);
    expect(rule).toBeLessThan(specStep);
    expect(body).toMatch(/--node leaf/);
    expect(body).toMatch(/--cite BR-/);
  });

  it("lore-baseline marks `baseline sites` and `baseline coverage` as lore-source-only", () => {
    const body = read("assets/skills/lore-baseline/SKILL.md");
    const rows = body.split("\n").filter((l) => /lore baseline (sites|coverage)/.test(l));
    expect(rows.length, "lines naming sites/coverage").toBeGreaterThan(0);
    for (const row of rows) expect(row, row).toMatch(/lore[- ]source[- ]only/i);
    expect(body).toMatch(/lore status/);
    expect(body).toMatch(/lore rule impact/);
  });
});
