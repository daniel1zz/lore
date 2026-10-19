// @spawns packages/lore/src/index.ts
/**
 * `lore bootstrap` never goes silent about memory-file health
 * (spec-claude-md-root-section-structure-check-and-adoption-mode, AC-STR-5; its warn/adoption half was retired by
 * task-memory-file-limits-are-always-enforced-the-warn-adoption, rule BR-1172).
 *
 * `lore bootstrap --json` carries an OPTIONAL `memory_file_health` block, present only when the root memory file has
 * >= 1 deterministic finding of ANY kind (structure or capacity); ABSENT when the root file is clean. `missing` is the
 * EXACT list of missing required H2 names in contract order; `finding_kinds` / `finding_count` count the findings.
 * The block has no mode, no mode_source, no promotable flag: limits are always enforced. The non-JSON text names the
 * missing sections on one line when the block is present.
 *
 * Fixture discipline: every corpus is a `mkdtemp` + `lore init` throwaway; this repo's own `.lore/` is never touched.
 *
 * Dimensions: HAPPY (exact missing names) / NEGATIVE (clean root absent; only-extra stays absent) / BOUNDARY (over
 * ceiling present; one missing vs two missing) / STATE (read-only; out_of_order flag) / REGRESSION (no mode fields).
 *
 * @spec_ref AC-STR-5
 * @spec_ref spec-claude-md-root-section-structure-check-and-adoption-mode
 */

import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sessionActorFor, withSessionIdentity } from "../helpers/session-actor";

// tests/integration/ -> tests/ -> packages/lore/ (2 levels up).
const PROJECT_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PROJECT_ROOT, "src", "index.ts");

const ACTOR_LABEL = "agent:memory-file-health-fixture";
/** The name the fixture's session identity resolves to (what `bootstrap --by` filters on). */
const ACTOR = sessionActorFor(ACTOR_LABEL);
const TEST_TIMEOUT_MS = 120_000;

/** The five required root H2 sections, in contract order (spec Public Interface). */
const ALL_SECTIONS = [
  "What This Is",
  "Commands",
  "Architecture",
  "Module Index",
  "Finding Live Project State",
] as const;

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function runLore(args: readonly string[], cwd: string): RunResult {
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], {
    cwd,
    env: withSessionIdentity({ ...process.env, HOME: cwd, CLAUDECODE: "1" }, ACTOR_LABEL) as Record<string, string>,
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

function runLoreOk(args: readonly string[], cwd: string): RunResult {
  const result = runLore(args, cwd);
  if (result.exitCode !== 0) {
    throw new Error(
      `fixture step failed (exit ${result.exitCode}): lore ${args.join(" ")}\n` +
        `stderr: ${result.stderr}\nstdout: ${result.stdout}`,
    );
  }
  return result;
}

const temporaryDirs: string[] = [];
afterAll(() => {
  for (const dir of temporaryDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
});

/** A root memory file made of the given H2 sections, each with one real content line. */
function rootFile(sections: readonly string[], extraLines: readonly string[] = []): string {
  const parts = ["# CLAUDE.md", ""];
  for (const name of sections) {
    parts.push(`## ${name}`, "", `Standing guidance for ${name}.`, "");
  }
  parts.push(...extraLines);
  return parts.join("\n") + "\n";
}

function makeCorpus(prefix: string, claudeMd: string): string {
  const dir = mkdtempSync(join(tmpdir(), `lore-bootstrap-mfh-${prefix}-`));
  temporaryDirs.push(dir);
  runLoreOk(["init"], dir);
  writeFileSync(join(dir, "CLAUDE.md"), claudeMd);
  return dir;
}

interface MemoryFileHealth {
  missing: string[];
  out_of_order: boolean;
  finding_kinds: string[];
  finding_count: number;
}

interface BootstrapJson {
  ok: boolean;
  data: { memory_file_health?: MemoryFileHealth } & Record<string, unknown>;
}

/** Runs `lore bootstrap --json`; asserts exit 0 + well-formed envelope (positive control). */
function bootstrapJson(cwd: string): BootstrapJson {
  const result = runLore(["bootstrap", "--by", ACTOR, "--json"], cwd);
  expect(result.exitCode, `bootstrap must succeed; stderr: ${result.stderr}`).toBe(0);
  const parsed = JSON.parse(result.stdout) as BootstrapJson;
  expect(parsed.ok).toBe(true);
  return parsed;
}

function health(cwd: string): MemoryFileHealth {
  const h = bootstrapJson(cwd).data.memory_file_health;
  expect(h, "memory_file_health must be present").toBeDefined();
  return h as MemoryFileHealth;
}

describe("bootstrap memory_file_health: a failing root file is never silent", () => {
  it("root missing Commands and Module Index -> missing equals exactly those two, in contract order", () => {
    const sections = ALL_SECTIONS.filter((s) => s !== "Commands" && s !== "Module Index");
    const dir = makeCorpus("two", rootFile(sections));
    expect(health(dir).missing).toEqual(["Commands", "Module Index"]);
  }, TEST_TIMEOUT_MS);

  it("root missing only Architecture -> missing is exactly ['Architecture'] (not a hardcoded list)", () => {
    const dir = makeCorpus("one", rootFile(ALL_SECTIONS.filter((s) => s !== "Architecture")));
    expect(health(dir).missing).toEqual(["Architecture"]);
  }, TEST_TIMEOUT_MS);

  it("two missing sections -> finding_count >= 2 and finding_kinds names section_missing", () => {
    const sections = ALL_SECTIONS.filter((s) => s !== "Commands" && s !== "Module Index");
    const h = health(makeCorpus("count", rootFile(sections)));
    expect(h.finding_count).toBeGreaterThanOrEqual(2);
    expect(h.finding_kinds).toContain("section_missing");
  }, TEST_TIMEOUT_MS);

  it("all five sections present but swapped order -> out_of_order true and missing empty", () => {
    const swapped = ["What This Is", "Architecture", "Commands", "Module Index", "Finding Live Project State"];
    const h = health(makeCorpus("order", rootFile(swapped)));
    expect(h.out_of_order).toBe(true);
    expect(h.missing).toEqual([]);
  }, TEST_TIMEOUT_MS);

  it("root over the line ceiling (structure clean) -> block PRESENT, capacity counts as failing", () => {
    const filler = Array.from({ length: 330 }, (_, i) => `Filler standing line ${i + 1}.`);
    const h = health(makeCorpus("cap", rootFile(ALL_SECTIONS, filler)));
    expect(h.missing).toEqual([]);
    expect(h.finding_kinds).toContain("max_lines");
  }, TEST_TIMEOUT_MS);

  it("REGRESSION: the block carries no mode, mode_source, downgraded or promotable field", () => {
    const h = health(makeCorpus("shape", rootFile(ALL_SECTIONS.filter((s) => s !== "Commands"))));
    expect(Object.keys(h).sort()).toEqual(["finding_count", "finding_kinds", "missing", "out_of_order"]);
  }, TEST_TIMEOUT_MS);
});

describe("bootstrap memory_file_health: a clean root file reports nothing", () => {
  it("clean root -> memory_file_health ABSENT (positive control: bootstrap succeeded)", () => {
    const parsed = bootstrapJson(makeCorpus("clean", rootFile(ALL_SECTIONS)));
    expect(parsed.data.memory_file_health).toBeUndefined();
  }, TEST_TIMEOUT_MS);

  it("only an extra H2 (advisory section_extra) -> memory_file_health stays ABSENT", () => {
    const dir = makeCorpus("extra", rootFile(ALL_SECTIONS, ["## Totally Unlisted Section", "", "Some extra prose.", ""]));
    expect(bootstrapJson(dir).data.memory_file_health).toBeUndefined();
  }, TEST_TIMEOUT_MS);
});

describe("bootstrap memory_file_health: statefulness and text output", () => {
  it("bootstrap is read-only: CLAUDE.md is byte-unchanged and two runs report identical health", () => {
    const sections = ALL_SECTIONS.filter((s) => s !== "Commands" && s !== "Module Index");
    const body = rootFile(sections);
    const dir = makeCorpus("readonly", body);
    const first = health(dir);
    const second = health(dir);
    expect(second).toEqual(first);
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toBe(body);
  }, TEST_TIMEOUT_MS);

  it("missing Commands and Module Index -> exactly one text line names both missing sections", () => {
    const sections = ALL_SECTIONS.filter((s) => s !== "Commands" && s !== "Module Index");
    const dir = makeCorpus("text", rootFile(sections));
    const result = runLore(["bootstrap", "--by", ACTOR], dir);
    expect(result.exitCode, `stderr: ${result.stderr}`).toBe(0);
    const naming = result.stdout.split("\n").filter((l) => l.includes("Commands") && l.includes("Module Index"));
    expect(naming.length).toBe(1);
    expect(naming[0]).toContain("Memory file health: FAILING");
  }, TEST_TIMEOUT_MS);

  it("clean root -> text output has no memory-file health line", () => {
    const dir = makeCorpus("text-clean", rootFile(ALL_SECTIONS));
    const result = runLore(["bootstrap", "--by", ACTOR], dir);
    expect(result.exitCode, `stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout.split("\n").filter((l) => /Memory file health|adoption|memory_file_health/i.test(l))).toEqual([]);
  }, TEST_TIMEOUT_MS);
});
