/**
 * `lore bootstrap` never goes silent about memory-file health — RED-first suite for
 * `task-skill-test-bootstrap-memory-file-health-red` (paired implementation: I3,
 * `[Skill:implement] bootstrap memory_file_health via shared adapter helper`).
 *
 * Spec behaviour under test (spec-claude-md-root-section-structure-check-and-adoption-mode,
 * AC-STR-5 + Public Interface + D7):
 *   `lore bootstrap --json` carries an OPTIONAL `memory_file_health` block, present only
 *   when adoption mode is `warn` OR the root memory file has >= 1 would-be deterministic
 *   finding of ANY kind (structure or capacity). It is ABSENT when mode is `enforce` and
 *   the root file is clean. `missing` is the EXACT list of missing required H2 names in
 *   contract order. `promotable` is true iff mode is `warn` AND `downgraded_count` is 0 —
 *   advisory kinds (`section_extra`, ...) never affect it. The non-JSON text names the
 *   missing sections on one line when the block is present.
 *
 * Every enforce-side fixture writes `adoption: enforce` EXPLICITLY (an absent key
 * resolves to `warn`, D3) so no enforce assertion can pass vacuously.
 *
 * RED baseline: on the current base the `adoption` config key is unknown to the
 * `.strict()` `context.memory_files` schema and `memory_file_health` is not emitted at
 * all, so every "present" assertion fails on the missing field / config rejection, and
 * the sole "absent" case is guarded by a positive-control (bootstrap exit 0 + a
 * well-formed envelope) so it cannot go green merely because bootstrap crashed.
 *
 * Fixture discipline: every corpus is a `mkdtemp` + `lore init` throwaway; this repo's
 * own `.lore/` is never touched. Arrange steps assert exit 0.
 *
 * Dimensions: HAPPY (warn+missing exact names; warn+clean promotable) / NEGATIVE
 * (enforce+clean absent) / BOUNDARY (enforce+over-ceiling present; only-extra stays
 * promotable; one missing vs two missing) / STATE (read-only: two runs byte-identical;
 * out_of_order flag) / REGRESSION (absent key -> warn/default).
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

type Adoption = "enforce" | "warn" | "absent";

/** A root memory file made of the given H2 sections, each with one real content line. */
function rootFile(sections: readonly string[], extraLines: readonly string[] = []): string {
  const parts = ["# CLAUDE.md", ""];
  for (const name of sections) {
    parts.push(`## ${name}`, "", `Standing guidance for ${name}.`, "");
  }
  parts.push(...extraLines);
  return parts.join("\n") + "\n";
}

function makeCorpus(prefix: string, adoption: Adoption, claudeMd: string): string {
  const dir = mkdtempSync(join(tmpdir(), `lore-bootstrap-mfh-${prefix}-`));
  temporaryDirs.push(dir);
  runLoreOk(["init"], dir);
  if (adoption !== "absent") {
    // `lore init` writes `project:` only; appending a top-level `context:` block is safe.
    const cfgPath = join(dir, ".lore", "config.yaml");
    writeFileSync(
      cfgPath,
      readFileSync(cfgPath, "utf8") +
        `\ncontext:\n  memory_files:\n    adoption: ${adoption}\n`,
    );
  }
  writeFileSync(join(dir, "CLAUDE.md"), claudeMd);
  return dir;
}

interface MemoryFileHealth {
  mode: string;
  mode_source: string;
  missing: string[];
  out_of_order: boolean;
  downgraded_kinds: string[];
  downgraded_count: number;
  promotable: boolean;
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

describe("bootstrap memory_file_health: warn mode is never silent", () => {
  it(
    "warn + root missing Commands and Module Index -> missing equals exactly those two, in contract order",
    () => {
      const sections = ALL_SECTIONS.filter((s) => s !== "Commands" && s !== "Module Index");
      const dir = makeCorpus("warn-two", "warn", rootFile(sections));
      const h = health(dir);
      expect(h.mode).toBe("warn");
      expect(h.missing).toEqual(["Commands", "Module Index"]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "warn + root missing only Architecture -> missing is exactly ['Architecture'] (not a hardcoded list)",
    () => {
      const sections = ALL_SECTIONS.filter((s) => s !== "Architecture");
      const dir = makeCorpus("warn-one", "warn", rootFile(sections));
      expect(health(dir).missing).toEqual(["Architecture"]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "warn + two missing sections -> downgraded_count >= 2, downgraded_kinds names section_missing, promotable false",
    () => {
      const sections = ALL_SECTIONS.filter((s) => s !== "Commands" && s !== "Module Index");
      const dir = makeCorpus("warn-count", "warn", rootFile(sections));
      const h = health(dir);
      expect(h.downgraded_count).toBeGreaterThanOrEqual(2);
      expect(h.downgraded_kinds).toContain("section_missing");
      expect(h.promotable).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "warn + all five sections present but swapped order -> out_of_order true and missing empty",
    () => {
      const swapped = [
        "What This Is",
        "Architecture",
        "Commands",
        "Module Index",
        "Finding Live Project State",
      ];
      const dir = makeCorpus("warn-order", "warn", rootFile(swapped));
      const h = health(dir);
      expect(h.out_of_order).toBe(true);
      expect(h.missing).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "warn + clean root -> present with promotable true and downgraded_count 0",
    () => {
      const dir = makeCorpus("warn-clean", "warn", rootFile(ALL_SECTIONS));
      const h = health(dir);
      expect(h.mode).toBe("warn");
      expect(h.downgraded_count).toBe(0);
      expect(h.promotable).toBe(true);
      expect(h.missing).toEqual([]);
      expect(h.out_of_order).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "warn + only an extra H2 (advisory section_extra) -> promotable stays true",
    () => {
      const dir = makeCorpus(
        "warn-extra",
        "warn",
        rootFile(ALL_SECTIONS, ["## Totally Unlisted Section", "", "Some extra prose.", ""]),
      );
      const h = health(dir);
      expect(h.downgraded_count).toBe(0);
      expect(h.promotable).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "warn + over-ceiling clean-structure root -> capacity downgraded (max_lines) so promotable false",
    () => {
      const filler = Array.from({ length: 330 }, (_, i) => `Filler standing line ${i + 1}.`);
      const dir = makeCorpus("warn-cap", "warn", rootFile(ALL_SECTIONS, filler));
      const h = health(dir);
      expect(h.downgraded_kinds).toContain("max_lines");
      expect(h.promotable).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );
});

describe("bootstrap memory_file_health: enforce mode", () => {
  it(
    "enforce + clean root -> memory_file_health ABSENT (positive control: bootstrap succeeded)",
    () => {
      const dir = makeCorpus("enf-clean", "enforce", rootFile(ALL_SECTIONS));
      const parsed = bootstrapJson(dir);
      expect(parsed.data.memory_file_health).toBeUndefined();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "enforce + root missing Commands -> field PRESENT with mode enforce, exact missing, downgraded_count 0, promotable false",
    () => {
      const sections = ALL_SECTIONS.filter((s) => s !== "Commands");
      const dir = makeCorpus("enf-missing", "enforce", rootFile(sections));
      const h = health(dir);
      expect(h.mode).toBe("enforce");
      expect(h.missing).toEqual(["Commands"]);
      expect(h.downgraded_count).toBe(0);
      expect(h.promotable).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "enforce + root over the line ceiling (structure clean) -> field PRESENT: capacity counts as failing",
    () => {
      const filler = Array.from({ length: 330 }, (_, i) => `Filler standing line ${i + 1}.`);
      const dir = makeCorpus("enf-cap", "enforce", rootFile(ALL_SECTIONS, filler));
      const h = health(dir);
      expect(h.mode).toBe("enforce");
      expect(h.missing).toEqual([]);
      expect(h.downgraded_count).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );
});

describe("bootstrap memory_file_health: default mode and statefulness", () => {
  it(
    "no adoption key + missing section -> mode warn with mode_source default",
    () => {
      const sections = ALL_SECTIONS.filter((s) => s !== "Commands");
      const dir = makeCorpus("absent-key", "absent", rootFile(sections));
      const h = health(dir);
      expect(h.mode).toBe("warn");
      expect(h.mode_source).toBe("default");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "explicit adoption key -> mode_source config",
    () => {
      const sections = ALL_SECTIONS.filter((s) => s !== "Commands");
      const dir = makeCorpus("cfg-source", "warn", rootFile(sections));
      expect(health(dir).mode_source).toBe("config");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "bootstrap is read-only: CLAUDE.md is byte-unchanged and two runs report identical health",
    () => {
      const sections = ALL_SECTIONS.filter((s) => s !== "Commands" && s !== "Module Index");
      const body = rootFile(sections);
      const dir = makeCorpus("readonly", "warn", body);
      const first = health(dir);
      const second = health(dir);
      expect(second).toEqual(first);
      expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toBe(body);
    },
    TEST_TIMEOUT_MS,
  );
});

describe("bootstrap memory_file_health: human text output", () => {
  it(
    "warn + missing Commands and Module Index -> exactly one line names both missing sections",
    () => {
      const sections = ALL_SECTIONS.filter((s) => s !== "Commands" && s !== "Module Index");
      const dir = makeCorpus("text-warn", "warn", rootFile(sections));
      const result = runLore(["bootstrap", "--by", ACTOR], dir);
      expect(result.exitCode, `stderr: ${result.stderr}`).toBe(0);
      const naming = result.stdout
        .split("\n")
        .filter((l) => l.includes("Commands") && l.includes("Module Index"));
      expect(naming.length).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "enforce + clean root -> text output has no memory-file health line naming sections or adoption",
    () => {
      const dir = makeCorpus("text-clean", "enforce", rootFile(ALL_SECTIONS));
      const result = runLore(["bootstrap", "--by", ACTOR], dir);
      expect(result.exitCode, `stderr: ${result.stderr}`).toBe(0);
      const healthLines = result.stdout
        .split("\n")
        .filter((l) => /adoption|memory_file_health/i.test(l) || ALL_SECTIONS.some((n) => l.includes(`missing`) && l.includes(n)));
      expect(healthLines).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );
});
