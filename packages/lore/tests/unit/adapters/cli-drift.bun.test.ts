/**
 * `lore status --check-tree` / `--check-drift` composition, `lore anchor` spec-target
 * dispatch (exercised indirectly via `lore create spec --code-anchor`), and the
 * doc-code drift oracle's five drift-kind classifications — CLI-adapter spawned-binary
 * tests (SPEC-045 §Design Decisions D5, D6; §Acceptance Criteria AC-DR-4).
 *
 * Spawns the COMPILED `dist/lore` binary (Bun.spawnSync) against a THROWAWAY corpus
 * (mkdtemp + `lore init`) — NEVER the repo's own `.lore/` corpus (project CLAUDE.md
 * hard rule). `assertFreshBinary` (mirrors `cli-invalidate.bun.test.ts`/`cli-staleness
 * .bun.test.ts`) fails loud before any test runs if `dist/lore` is missing or older
 * than the newest `.ts` source under `packages/{lore,core}/src` — requires `bun run
 * build` to have run first.
 *
 * ONE mkdtemp corpus is seeded ONCE (spec-create gate disabled via a SINGLE appended
 * `workflow:` block — a freshly-`init`ed corpus's `config.yaml` already declares a
 * required top-level `project:` key, so this file APPENDS rather than overwrites it,
 * mirroring `check-tree.test.ts`'s `disableAllGates` pattern) and mutated SEQUENTIALLY
 * between spawns for the five drift-kind scenarios — no per-case re-init (spawn-budget
 * discipline, mirrors `cli-invalidate.bun.test.ts`'s documented discipline). `--check-
 * drift` is read-only (D9) so calling it more than once against the same on-disk state
 * is always safe and deterministic.
 *
 * Six-dimension coverage:
 *   HAPPY:      initial fully-consistent corpus (3 armed specs, all anchors real) →
 *               exit 0, "consistent" text; `--json`'s `code_drift` shape
 *   NEGATIVE:   n/a — every "bad state" case here is a genuine drift finding (ERROR
 *               dimension below), not a CLI-usage error; SPEC-045 has no CLI-usage
 *               mutex to probe (unlike SPEC-043/044's `--no-ai`/`--pending` mutexes)
 *   BOUNDARY:   unarmed corpus (zero specs declare code_anchors) → exit 0,
 *               `armed=false`; `workflow.drift.enabled=false` → exit 0, `disabled`
 *   ERROR:      the five drift kinds (file_missing, symbol_missing, dir_empty,
 *               permanently-missing file_missing, node_type_mismatch) each correctly
 *               classified, repair hint + SYMBOL_MISSING_FOOTNOTE text rendered
 *   STATE:      a fixed spec stops appearing in `drifts[]` once its file is restored,
 *               while a permanently-broken spec's row survives across multiple runs;
 *               `--check-drift --check-tree` composition — drift wins the exit-code
 *               precedence over a missing `lore.tree.yaml` blueprint (D5)
 *   REGRESSION: plain `lore status` (no `--check-drift`) never fs-probes — it still
 *               exits 0 and prints the declared-count line even when every anchor on
 *               disk is currently broken; every spec-owned drift row is LABELLED
 *               `[spec]` and `knowledge_checked` is reported as an explicit 0 on this
 *               spec-only corpus (M2 of
 *               spec-a-write-side-fact-with-no-read-side-address-counts-with-no — the
 *               knowledge-owned half lives in
 *               `tests/integration/cli/knowledge-code-anchor-drift.bun.test.ts`)
 *
 * @spec_ref SPEC-045 §Acceptance Criteria AC-DR-4
 */

import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, unlinkSync, appendFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { assertFreshBinary } from "../../integration/helpers/assert-fresh-binary";

// tests/unit/adapters/ → tests/unit/ → tests/ → packages/lore/ → packages/ → repo root (5 levels up).
const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function runLore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync([LORE_BIN, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true" },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

interface JsonEnvelope {
  ok: boolean;
  data: Record<string, unknown>;
}

interface DriftRowJson {
  doc_id: string;
  doc_slug: string;
  doc_type: string;
  doc_status: string;
  anchor: string;
  kind: string;
  detail?: string;
}

interface CodeDriftJson {
  armed: boolean;
  enabled: boolean;
  consistent: boolean;
  specs_checked: number;
  knowledge_checked: number;
  status_breakdown: Record<string, number>;
  drifts: DriftRowJson[];
}

function parseJsonSlug(stdout: string): string {
  const parsed = JSON.parse(stdout) as { data: { slug: string } };
  return parsed.data.slug;
}

function initCorpus(tmpDir: string): void {
  const result = runLore(["init"], tmpDir);
  if (result.exitCode !== 0) {
    throw new Error(`lore init failed: ${result.stderr}`);
  }
}

/**
 * Disables all four `lore gate` service-layer checkpoints — mirrors `check-tree
 * .test.ts`'s `disableAllGates` helper exactly (GateEnforcer is wired ON by default in
 * every production `createApp`, and this file's spec fixtures use placeholder content
 * that would otherwise fail `hasSkeleton`/other spec-create predicates). A freshly
 * `lore init`-ed corpus's `config.yaml` already carries a REQUIRED top-level `project:`
 * key — appendFileSync (never a wholesale rewrite) avoids a second top-level `workflow:`
 * key silently breaking YAML parsing.
 */
function disableAllGates(dir: string): void {
  appendFileSync(
    join(dir, ".lore", "config.yaml"),
    [
      "workflow:",
      "  gates:",
      "    spec-create:",
      "      enabled: false",
      "    spec-promote:",
      "      enabled: false",
      "    plan-promote:",
      "      enabled: false",
      "    task-claim:",
      "      enabled: false",
      "",
    ].join("\n"),
  );
}

/** Disables ONLY the doc-code drift oracle (workflow.drift.enabled: false, D8). */
function disableDrift(dir: string): void {
  appendFileSync(
    join(dir, ".lore", "config.yaml"),
    ["workflow:", "  drift:", "    enabled: false", ""].join("\n"),
  );
}

function createPrd(tmpDir: string): string {
  const result = runLore(
    ["create", "prd", "--title", "Drift Fixture Root PRD", "--no-ai", "--content", "## Overview\n\nBody.", "--json"],
    tmpDir,
  );
  if (result.exitCode !== 0) throw new Error(`create prd failed: ${result.stderr}`);
  return parseJsonSlug(result.stdout);
}

function createSpec(tmpDir: string, prdSlug: string, title: string, codeAnchors: string[]): string {
  const args = [
    "create",
    "spec",
    "--title",
    title,
    "--kind",
    "feature",
    "--no-ai",
    "--content",
    "## Overview\n\nBody.",
    "--json",
  ];
  for (const anchor of codeAnchors) {
    args.push("--code-anchor", anchor);
  }
  const result = runLore(args, tmpDir);
  if (result.exitCode !== 0) throw new Error(`create spec "${title}" failed: ${result.stderr}`);
  return parseJsonSlug(result.stdout);
}

function checkDriftJson(tmpDir: string): { result: RunResult; data: CodeDriftJson } {
  const result = runLore(["status", "--check-drift", "--json"], tmpDir);
  const envelope = JSON.parse(result.stdout) as JsonEnvelope;
  return { result, data: envelope.data["code_drift"] as CodeDriftJson };
}

function findDrift(data: CodeDriftJson, specSlug: string, anchor: string): DriftRowJson | undefined {
  return data.drifts.find((d) => d.doc_slug === specSlug && d.doc_type === "spec" && d.anchor === anchor);
}

// ─── Suite: binary freshness guard ───────────────────────────────────────────

beforeAll(() => {
  assertFreshBinary(LORE_BIN, [
    join(REPO_ROOT, "packages", "lore", "src"),
    join(REPO_ROOT, "packages", "core", "src"),
  ]);
});

// ─── Main fixture: one corpus, seeded once, mutated sequentially ────────────

const tmpDir = mkdtempSync(join(tmpdir(), "lore-cli-drift-"));
initCorpus(tmpDir);
disableAllGates(tmpDir);
const prdSlug = createPrd(tmpDir);

// File layout under tmpDir (the drift probe's repo root == process.cwd() of the
// spawned binary, which Bun.spawnSync's `cwd` option sets to tmpDir):
//   src/a.ts   — anchored by specA as "src/a.ts#Exported" (file_missing scenario)
//   src/b.ts   — anchored by specB as "src/b.ts#Exported" (symbol_missing scenario)
//   adir/keep.txt — anchored by specC as "adir/" (dir_empty scenario)
//   src/c.ts   — anchored LATER by specE as "src/c.ts/" (node_type_mismatch scenario)
mkdirSync(join(tmpDir, "src"), { recursive: true });
mkdirSync(join(tmpDir, "adir"), { recursive: true });
writeFileSync(join(tmpDir, "src", "a.ts"), "export const Exported = 1;\n");
writeFileSync(join(tmpDir, "src", "b.ts"), "export const Exported = 1;\n");
writeFileSync(join(tmpDir, "adir", "keep.txt"), "placeholder\n");
writeFileSync(join(tmpDir, "src", "c.ts"), "export const Whatever = 1;\n");

const specASlug = createSpec(tmpDir, prdSlug, "ZzzDriftSpecFileMissing", ["src/a.ts#Exported"]);
const specBSlug = createSpec(tmpDir, prdSlug, "ZzzDriftSpecSymbolMissing", ["src/b.ts#Exported"]);
const specCSlug = createSpec(tmpDir, prdSlug, "ZzzDriftSpecDirEmpty", ["adir/"]);

afterAll(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

// ─── HAPPY: fully-consistent initial state ───────────────────────────────────

describe("lore status --check-drift — HAPPY (fully-consistent initial state)", () => {
  it("3 armed specs, every anchor real on disk → exit 0, 'consistent' text", () => {
    const result = runLore(["status", "--check-drift"], tmpDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("consistent");
    expect(result.stdout).not.toContain("drift(s)");
  });

  it("--json carries the full CodeDriftPayload shape (armed:true, enabled:true, consistent:true, 3 specs_checked)", () => {
    const { result, data } = checkDriftJson(tmpDir);
    expect(result.exitCode).toBe(0);
    expect(data.armed).toBe(true);
    expect(data.enabled).toBe(true);
    expect(data.consistent).toBe(true);
    expect(data.specs_checked).toBe(3);
    // The knowledge population is reported EXPLICITLY as zero on a spec-only corpus —
    // an omitted count would read as "knowledge was never scanned".
    expect(data.knowledge_checked).toBe(0);
    expect(data.drifts).toEqual([]);
  });
});

// ─── ERROR: five drift-kind classifications, sequential mutations ───────────

describe("lore status --check-drift — ERROR (drift-kind classification, sequential mutations)", () => {
  it("1) deleting the anchored file → file_missing, with the literal repair hint", () => {
    unlinkSync(join(tmpDir, "src", "a.ts"));

    const result = runLore(["status", "--check-drift"], tmpDir);
    expect(result.exitCode).toBe(3);
    expect(result.stdout).toContain(`[spec] ${specASlug} → src/a.ts#Exported (file_missing)`);
    expect(result.stdout).toContain(
      `fix: lore anchor rm ${specASlug} 'src/a.ts#Exported' (or update the path/export)`,
    );
  });

  it("2) renaming the exported symbol → symbol_missing, with the SYMBOL_MISSING_FOOTNOTE note", () => {
    writeFileSync(join(tmpDir, "src", "b.ts"), "export const Renamed = 1;\n");

    const result = runLore(["status", "--check-drift"], tmpDir);
    expect(result.exitCode).toBe(3);
    expect(result.stdout).toContain(`[spec] ${specBSlug} → src/b.ts#Exported (symbol_missing)`);
    expect(result.stdout).toContain("does not recognize `export * from`");
  });

  it("3) emptying the anchored directory → dir_empty", () => {
    unlinkSync(join(tmpDir, "adir", "keep.txt"));

    const result = runLore(["status", "--check-drift"], tmpDir);
    expect(result.exitCode).toBe(3);
    expect(result.stdout).toContain(`[spec] ${specCSlug} → adir/ (dir_empty)`);
  });

  it("STATE bridge: restoring specA's file clears ITS drift row while specB/specC's persist", () => {
    writeFileSync(join(tmpDir, "src", "a.ts"), "export const Exported = 1;\n");

    const { result, data } = checkDriftJson(tmpDir);
    expect(result.exitCode).toBe(3); // specB (symbol_missing) + specC (dir_empty) still broken
    expect(findDrift(data, specASlug, "src/a.ts#Exported")).toBeUndefined();
    expect(findDrift(data, specBSlug, "src/b.ts#Exported")?.kind).toBe("symbol_missing");
    expect(findDrift(data, specCSlug, "adir/")?.kind).toBe("dir_empty");
  });

  it("4) a spec anchoring a path that NEVER existed → file_missing, NEVER reported consistent even while specA IS consistent in the same run", () => {
    const specDSlug = createSpec(tmpDir, prdSlug, "ZzzDriftSpecNeverExists", ["never/exists.ts"]);

    const { data } = checkDriftJson(tmpDir);
    expect(findDrift(data, specDSlug, "never/exists.ts")?.kind).toBe("file_missing");
    // specA was restored in the previous step and remains consistent in the SAME run.
    expect(findDrift(data, specASlug, "src/a.ts#Exported")).toBeUndefined();

    // Persistence proof: a second, independent read-only run still reports the SAME
    // permanently-broken row (nothing "heals" it without an actual fix or `lore anchor rm`).
    const { data: dataAgain } = checkDriftJson(tmpDir);
    expect(findDrift(dataAgain, specDSlug, "never/exists.ts")?.kind).toBe("file_missing");
  });

  it("5) dir-anchoring a plain file → node_type_mismatch", () => {
    createSpec(tmpDir, prdSlug, "ZzzDriftSpecNodeTypeMismatch", ["src/c.ts/"]);

    const { result, data } = checkDriftJson(tmpDir);
    expect(result.exitCode).toBe(3);
    const row = data.drifts.find((d) => d.anchor === "src/c.ts/");
    expect(row?.kind).toBe("node_type_mismatch");
  });
});

// ─── STATE: --check-drift --check-tree composition (D5 precedence) ──────────

describe("lore status --check-drift --check-tree — STATE (composition, D5 exit precedence)", () => {
  it("drift wins the exit-code precedence over a missing lore.tree.yaml blueprint (no blueprint armed in this fixture)", () => {
    const result = runLore(["status", "--check-drift", "--check-tree"], tmpDir);
    // Both a real drift (from the mutations above) AND a missing blueprint are true
    // here — D5 says drift wins (exit 3), never masked by the missing-blueprint exit 4.
    expect(result.exitCode).toBe(3);
    expect(result.stdout).toContain("drift(s)");
  });
});

// ─── REGRESSION: plain `lore status` never fs-probes ─────────────────────────

describe("lore status (no flags) — REGRESSION (zero fs probing)", () => {
  it("prints the declared-count line and exits 0 even though every anchored file is currently broken on disk", () => {
    const result = runLore(["status"], tmpDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Code anchors declared: 5 specs (run `lore status --check-drift` to verify)");
    expect(result.stdout).not.toContain("Code drift:");
  });

  it("--json carries code_anchor_specs: 5, computed with zero fs probing", () => {
    const result = runLore(["status", "--json"], tmpDir);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as JsonEnvelope;
    expect(parsed.data["code_anchor_specs"]).toBe(5);
    expect(parsed.data["code_drift"]).toBeUndefined();
  });
});

// ─── BOUNDARY: unarmed corpus ────────────────────────────────────────────────

describe("lore status --check-drift — BOUNDARY (unarmed corpus, zero specs declare code_anchors)", () => {
  it("a freshly-inited corpus with no specs at all → exit 0, armed=false", () => {
    const unarmedDir = mkdtempSync(join(tmpdir(), "lore-cli-drift-unarmed-"));
    try {
      initCorpus(unarmedDir);
      const result = runLore(["status", "--check-drift"], unarmedDir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(
        "Code drift: armed=false (no spec or knowledge doc declares code_anchors)",
      );

      const jsonResult = runLore(["status", "--check-drift", "--json"], unarmedDir);
      const envelope = JSON.parse(jsonResult.stdout) as JsonEnvelope;
      const data = envelope.data["code_drift"] as CodeDriftJson;
      expect(data.armed).toBe(false);
      expect(data.consistent).toBe(true);
    } finally {
      rmSync(unarmedDir, { recursive: true, force: true });
    }
  });
});

// ─── BOUNDARY: workflow.drift.enabled: false ─────────────────────────────────

describe("lore status --check-drift — BOUNDARY (workflow.drift.enabled: false)", () => {
  it("the config brake short-circuits to a LOUD 'disabled' payload — exit 0, no fs probing attempted", () => {
    const disabledDir = mkdtempSync(join(tmpdir(), "lore-cli-drift-disabled-"));
    try {
      initCorpus(disabledDir);
      disableDrift(disabledDir);

      const result = runLore(["status", "--check-drift"], disabledDir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Code drift: disabled (workflow.drift.enabled=false)");

      const jsonResult = runLore(["status", "--check-drift", "--json"], disabledDir);
      const envelope = JSON.parse(jsonResult.stdout) as JsonEnvelope;
      const data = envelope.data["code_drift"] as CodeDriftJson;
      expect(data.enabled).toBe(false);
      expect(data.armed).toBe(false);
      expect(data.consistent).toBe(true);
    } finally {
      rmSync(disabledDir, { recursive: true, force: true });
    }
  });
});
