// @spawns packages/lore/src/index.ts
// @reads assets/templates/**
/**
 * @spec_ref IoC vertical-slice tech-spec §4.1/§11 — `lore gate spec-create` (deterministic
 * zone + active feeding)
 *
 * bun test (not vitest): every scenario spawns the real `lore` CLI (`bun run src/index.ts`)
 * against a throwaway corpus (mkdtemp'd temp dir + `lore init`), mirroring
 * `tests/integration/cli-check-tree.bun.test.ts`'s harness. ⛔ Never touches the repo's own
 * `.lore/` corpus (project CLAUDE.md hard rule).
 *
 * Acceptance criteria under test (spec AC1 / AC2 / AC5):
 *   AC1 — no-parent candidate → exit 4, stdout carries `[source:` + a rule slice.
 *   AC2 — compliant candidate (legal prd parent + spec_kind=tech + `## `-headed content)
 *         → exit 0.
 *   AC5 — LORE_GATE_BYPASS=1 short-circuits ANY input (even non-compliant) to exit 0.
 *   Plus: bad spec_kind → exit 4 with INVALID_SPEC_KIND in the missing list.
 *
 * Also covers the AC-Quantifiability Gate spec's CLI-preflight parity fix (task
 * `task-hook-parity-g1-g2-ai-advisory-on-review`): `lore gate spec-create --input-json`
 * threads a candidate's `extra.acceptance_criteria` into the SAME `GateContext` the
 * service-layer `GateEnforcer` already lints via `CorpusService._createImpl` — see
 * "AC-Quantifiability Gate CLI parity" below.
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { patchLoreConfig } from "../helpers/patch-lore-config.js";
import { join } from "path";
import { tmpdir } from "os";

// ─── Types ──────────────────────────────────────────────────────────────────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

// ─── Paths ──────────────────────────────────────────────────────────────────

const PROJECT_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PROJECT_ROOT, "src", "index.ts");

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Run `bun run src/index.ts ...args` in `cwd`. HOME is overridden to isolate global config. */
function runLore(args: string[], cwd: string, extraEnv: Record<string, string> = {}): RunResult {
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, ...extraEnv },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

/** Create a unique temp directory for an isolated test suite. */
function makeTempDir(label: string): string {
  const dir = join(tmpdir(), `lore-gate-spec-create-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Remove a temp directory, ignoring errors (best-effort cleanup). */
function cleanupDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

/** Bootstrap a fresh lore corpus. */
function initCorpus(tmpDir: string): void {
  const result = runLore(["init"], tmpDir);
  if (result.exitCode !== 0) {
    throw new Error(`lore init failed: ${result.stderr}`);
  }
}

/** Seed the shipped templates as approved corpus templates (`lore migrate templates --apply`): the one rule source. */
function seedRuleDoc(tmpDir: string): void {
  const result = runLore(["migrate", "templates", "--apply"], tmpDir);
  if (result.exitCode !== 0) {
    throw new Error(`lore migrate templates failed: ${result.stderr}${result.stdout}`);
  }
}

/** Seed a PRD document, return its slug (parsed from `create`'s stdout). */
function createPrd(tmpDir: string, title: string): string {
  // reason: --no-ai bypasses AI generation (SPEC-017 default) so setup is not blocked
  // by absence of the claude binary in CI.
  const result = runLore(["create", "prd", "--title", title, "--no-ai"], tmpDir);
  const match = result.stdout.match(/Slug:\s+(\S+)/);
  const slug = match?.[1];
  if (slug === undefined) {
    throw new Error(`could not parse PRD slug from create output: ${result.stdout}`);
  }
  return slug;
}

// reason: BR-1 - a compliant spec payload carries NO parent; the argument is kept so callers read the same.
function compliantPayload(_parentSlug: string): Record<string, unknown> {
  return {
    type: "spec",
    title: "A well-formed spec",
    extra: { spec_kind: "tech" },
  };
}

function runGate(tmpDir: string, payload: Record<string, unknown>, extraEnv: Record<string, string> = {}): RunResult {
  return runLore(["gate", "spec-create", "--input-json", JSON.stringify(payload)], tmpDir, extraEnv);
}

// ─── Suite: fully seeded corpus (rule doc + valid PRD parent) ──────────────

describe("lore gate spec-create", () => {
  let tmpDir: string;
  let prdSlug: string;

  beforeEach(() => {
    tmpDir = makeTempDir("main");
    initCorpus(tmpDir);
    // reason: BR-709 - the seed files the rule doc under the corpus requirements document, so the PRD comes first.
    prdSlug = createPrd(tmpDir, "main-prd");
    seedRuleDoc(tmpDir);
  });

  afterEach(() => cleanupDir(tmpDir));

  // HAPPY — AC2: compliant candidate passes all three predicates.
  it("AC2: exits 0 for a compliant candidate (no parent, spec_kind=tech, skeleton content)", () => {
    const result = runGate(tmpDir, compliantPayload(prdSlug));
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("gate: pass");
  });

  // NEGATIVE — AC1: supplying a parent_id fails parentLegal (BR-2: a spec takes no parent) and the
  // reason names criterion citations.
  it("AC1: exits 4 and feeds back [source:...] + a rule slice when a parent_id is supplied", () => {
    const payload = compliantPayload(prdSlug);
    payload["parent_id"] = prdSlug;
    const result = runGate(tmpDir, payload);
    expect(result.exitCode).toBe(4);
    expect(result.stdout).toContain("[source:");
    expect(result.stdout).toContain("trust: team-authored");
    expect(result.stdout).toContain("a spec takes no parent");
    expect(result.stdout).toContain("lore ac cite");
    expect(result.stdout).toContain("## Rule");
    // the rule slice is the approved spec/tech template (the one rule source), not a rules document
    expect(result.stdout).toContain("[source: template spec-tech-template@2, trust: team-authored]");
    expect(result.stdout).toContain("lore template show spec --kind tech");
  });

  // NEGATIVE — bad spec_kind fails specKindValid → INVALID_SPEC_KIND.
  it("exits 4 with INVALID_SPEC_KIND in the missing list for spec_kind='x'", () => {
    const payload = compliantPayload(prdSlug);
    payload["extra"] = { spec_kind: "x" };
    const result = runGate(tmpDir, payload);
    expect(result.exitCode).toBe(4);
    expect(result.stdout).toContain("INVALID_SPEC_KIND");
  });

  // BOUNDARY — parent_id set but does not resolve to any doc → still refused: the contract is that a
  // spec names NO parent, not that the named parent be legal.
  it("BOUNDARY: exits 4 refusing the parent when parent_id does not resolve to any doc", () => {
    const payload = compliantPayload(prdSlug);
    payload["parent_id"] = "does-not-exist-slug";
    const result = runGate(tmpDir, payload);
    expect(result.exitCode).toBe(4);
    expect(result.stdout).toContain("a spec takes no parent");
  });

  // NEGATIVE — BR-1528/1529: a document is stored as fields, so a `content` key is refused loudly, never dropped.
  it("NEGATIVE: a content key is refused (exit 4) naming the structured route and the convert route", () => {
    const payload = compliantPayload(prdSlug);
    payload["content"] = "just some prose, no headings at all";
    const result = runGate(tmpDir, payload);
    expect(result.exitCode).toBe(4);
    expect(result.stdout).not.toContain("gate: pass");
    expect(result.stdout).toContain("content");
    expect(result.stdout).toContain("--kind tech --blank");
    expect(result.stdout).toContain("--fields-file");
    expect(result.stdout).toContain("lore convert");
  });

  // BOUNDARY — an empty content string is still a content key: refused, not treated as absent.
  it("BOUNDARY: an empty content string is refused too", () => {
    const payload = compliantPayload(prdSlug);
    payload["content"] = "";
    expect(runGate(tmpDir, payload).exitCode).toBe(4);
  });

  // BOUNDARY — every remaining structural predicate fails simultaneously → both reasons present.
  it("BOUNDARY: reports both violations together when every predicate fails", () => {
    const result = runGate(tmpDir, {
      type: "spec",
      title: "Broken spec",
      parent_id: prdSlug,
      extra: { spec_kind: "bogus" },
    });
    expect(result.exitCode).toBe(4);
    expect(result.stdout).toContain("a spec takes no parent");
    expect(result.stdout).toContain("INVALID_SPEC_KIND");
    expect(result.stdout).not.toContain("MISSING_SKELETON");
  });

  // ERROR — malformed JSON syntax.
  it("ERROR: exits 2 when --input-json is not valid JSON", () => {
    const result = runLore(["gate", "spec-create", "--input-json", "{not valid json"], tmpDir);
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toLowerCase()).toContain("json");
  });

  // ERROR — valid JSON but missing required fields (type/title).
  it("ERROR: exits 2 when --input-json is valid JSON but missing required fields", () => {
    const result = runLore(["gate", "spec-create", "--input-json", "{}"], tmpDir);
    expect(result.exitCode).toBe(2);
  });

  // STATE — AC5: bypass short-circuits even a maximally non-compliant candidate.
  it("AC5: LORE_GATE_BYPASS=1 exits 0 for a non-compliant candidate", () => {
    const result = runGate(
      tmpDir,
      { type: "spec", title: "Broken spec", extra: { spec_kind: "bogus" } },
      { LORE_GATE_BYPASS: "1" },
    );
    expect(result.exitCode).toBe(0);
  });

  // STATE — bypass takes priority even over malformed JSON (no parsing occurs at all).
  it("STATE: LORE_GATE_BYPASS=1 exits 0 even when --input-json is malformed", () => {
    const result = runLore(
      ["gate", "spec-create", "--input-json", "{not valid json"],
      tmpDir,
      { LORE_GATE_BYPASS: "1" },
    );
    expect(result.exitCode).toBe(0);
  });

  // REGRESSION — the gate is read-only: it must never create/mutate corpus documents.
  it("REGRESSION: does not create any corpus documents, pass or fail", () => {
    const before = runLore(["status", "--json"], tmpDir);
    const beforeTotal = (JSON.parse(before.stdout) as { data: { total_docs: number } }).data.total_docs;

    runGate(tmpDir, compliantPayload(prdSlug)); // exit 0 path
    const payload = compliantPayload(prdSlug);
    payload["parent_id"] = prdSlug;
    runGate(tmpDir, payload); // exit 4 path

    const after = runLore(["status", "--json"], tmpDir);
    const afterTotal = (JSON.parse(after.stdout) as { data: { total_docs: number } }).data.total_docs;

    expect(afterTotal).toBe(beforeTotal);
  });
});

// ─── Suite: AC-Quantifiability Gate CLI parity (task-hook-parity-g1-g2) ────

/** An AC whose statement carries an abstract-quality word with no measurable anchor. */
const UNQUANTIFIED_AC = {
  id: "AC-1",
  statement: "the dashboard loads fast",
  verify: { mode: "human" },
};

/** The same claim, restated with a numeric threshold — passes the lint. */
const QUANTIFIED_AC = {
  id: "AC-1",
  statement: "the dashboard P95 load time is < 200ms",
  verify: { mode: "human" },
};

/** Overwrites `.lore/config.yaml` with a project block plus the given `workflow.gates` map. */
function writeGatesConfig(tmpDir: string, gatesYaml: string): void {
  const config = [
    "project:",
    "  name: gate-spec-create-acq-test",
    "  author: tester",
    "workflow:",
    "  gates:",
    gatesYaml,
  ].join("\n");
  patchLoreConfig(tmpDir, config, { replace: true });
}

describe("lore gate spec-create — AC-Quantifiability Gate CLI parity", () => {
  let tmpDir: string;
  let prdSlug: string;

  beforeEach(() => {
    tmpDir = makeTempDir("acq");
    initCorpus(tmpDir);
    // reason: BR-709 - the seed files the rule doc under the corpus requirements document, so the PRD comes first.
    prdSlug = createPrd(tmpDir, "acq-prd");
    seedRuleDoc(tmpDir);
  });

  afterEach(() => cleanupDir(tmpDir));

  // HAPPY — a candidate whose declared AC is fully quantified passes.
  it("HAPPY: exits 0 for a candidate whose declared acceptance_criteria are all quantified", () => {
    const payload = compliantPayload(prdSlug);
    payload["extra"] = { spec_kind: "tech", acceptance_criteria: [QUANTIFIED_AC] };
    const result = runGate(tmpDir, payload);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("gate: pass");
  });

  // NEGATIVE — an unquantified abstract-word AC blocks, naming the AC id and the word.
  it("NEGATIVE: exits 4 and names the offending AC id + word for an unquantified acceptance_criteria entry", () => {
    const payload = compliantPayload(prdSlug);
    payload["extra"] = { spec_kind: "tech", acceptance_criteria: [UNQUANTIFIED_AC] };
    const result = runGate(tmpDir, payload);
    expect(result.exitCode).toBe(4);
    expect(result.stdout).toContain("AC_NOT_QUANTIFIABLE");
    expect(result.stdout).toContain("AC-1");
    expect(result.stdout).toContain("fast");
  });

  // BOUNDARY — no acceptance_criteria field at all → vacuous pass (identical to pre-fix behavior).
  it("BOUNDARY: a candidate declaring no acceptance_criteria at all still passes (vacuous)", () => {
    const result = runGate(tmpDir, compliantPayload(prdSlug));
    expect(result.exitCode).toBe(0);
  });

  // STATE — config escape: workflow.gates.spec-create.ac_quantifiable.enabled=false lets an
  // unquantified candidate through.
  it("STATE: workflow.gates.spec-create.ac_quantifiable.enabled=false lets an unquantified candidate pass", () => {
    writeGatesConfig(tmpDir, ["    spec-create:", "      ac_quantifiable:", "        enabled: false"].join("\n"));
    const payload = compliantPayload(prdSlug);
    payload["extra"] = { spec_kind: "tech", acceptance_criteria: [UNQUANTIFIED_AC] };
    const result = runGate(tmpDir, payload);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("gate: pass");
  });

  // REGRESSION — LORE_GATE_BYPASS=1 still short-circuits an unquantified-AC candidate.
  it("REGRESSION: LORE_GATE_BYPASS=1 exits 0 even for an unquantified-AC candidate", () => {
    const payload = compliantPayload(prdSlug);
    payload["extra"] = { spec_kind: "tech", acceptance_criteria: [UNQUANTIFIED_AC] };
    const result = runGate(tmpDir, payload, { LORE_GATE_BYPASS: "1" });
    expect(result.exitCode).toBe(0);
  });
});

// ─── Suite: no approved template — the pack NAMES the missing template, it never quotes an invented rule ────

describe("lore gate spec-create: no approved template", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("no-rule-doc");
    initCorpus(tmpDir);
    // reason: `lore init` seeds one approved template per shipped seed (BR-807 as modified), so the corpus whose spec has
    // no approved template is made by removing the four spec templates (a soft delete: the slot then resolves nothing).
    for (const kind of ["design", "domain-overview", "feature", "tech"]) {
      const removed = runLore(["delete", `spec-${kind}-template`, "--confirm"], tmpDir);
      if (removed.exitCode !== 0) throw new Error(`removing spec-${kind}-template failed: ${removed.stderr}${removed.stdout}`);
    }
  });

  afterEach(() => cleanupDir(tmpDir));

  it("BOUNDARY: still exits 4 with the missing reason, and the pack says no template could be read", () => {
    const result = runGate(tmpDir, { type: "spec", title: "x", parent_id: "some-parent" });
    expect(result.exitCode).toBe(4);
    expect(result.stdout).toContain("a spec takes no parent");
    expect(result.stdout).not.toContain("MISSING_SKELETON");
    expect(result.stdout).toContain("[source: template lookup, trust: team-authored]");
    expect(result.stdout).toContain("No rule could be read from an approved template");
    expect(result.stdout).not.toContain("shipped asset");
    expect(result.stdout).not.toContain("bun scripts/");
  });
});
