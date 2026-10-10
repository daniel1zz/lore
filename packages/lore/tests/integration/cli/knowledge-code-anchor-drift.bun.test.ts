/**
 * A `knowledge` document may declare `code_anchors`, `lore status --check-drift`
 * scans them, and every drift row states WHICH DOC TYPE its anchor came from —
 * end-to-end through the real CLI (M2 of
 * `spec-a-write-side-fact-with-no-read-side-address-counts-with-no`, AC-RR-4).
 *
 * Why this test exists: a consumer corpus filed a domain FACT as `knowledge`
 * (a MANDATORY pre-read asserting three market-data adapters hardcode `null`
 * for a suspension signal), a census falsified it, and the false assertion rode
 * for ≥5 days because `knowledge` was precisely the doc type with no anchors and
 * no drift oracle. The fixture below is shaped after that incident: a knowledge
 * doc anchored at a suspension-signal symbol.
 *
 * Spawns the real CLI in SOURCE mode (`bun run src/index.ts`, the
 * `trace-stats.bun.test.ts` precedent) rather than the compiled `dist/lore`
 * binary. reason: a compiled-binary test is guarded by `assertFreshBinary`, which
 * exits FATAL when `dist/lore` is stale — that failure mode is indistinguishable
 * from "the assertion under test went red", so a red-first run against it proves
 * nothing. Source mode always reflects the working tree.
 *
 * ⛔ Every spawn runs against a THROWAWAY corpus (`mkdtemp` + `lore init`, cwd
 * inside it) — NEVER the repo's own `.lore/` (project CLAUDE.md hard rule). The
 * anchored fixture files are written INSIDE that tmp dir too, because
 * `--check-drift`'s `FsProbe` is rooted at the CLI process's `process.cwd()`.
 *
 * ONE corpus is seeded once and mutated SEQUENTIALLY between spawns (spawn-budget
 * discipline, `cli-drift.bun.test.ts`'s documented pattern) — `--check-drift` is
 * read-only, so re-running it against the same on-disk state is deterministic.
 * The `describe` blocks below therefore RUN IN FILE ORDER and each one's
 * preconditions are stated in its own comment.
 *
 * Six-dimension coverage:
 *   HAPPY:      the CONTROL — a knowledge anchor whose file AND `#Symbol` are both
 *               present → exit exactly 0, zero knowledge-attributed drift rows,
 *               `knowledge_checked` already 1 (the check DISCRIMINATES; it does not
 *               breach on every knowledge anchor)
 *   NEGATIVE:   `lore anchor add` against a `prd` target is still refused, exit
 *               exactly 4, naming all three accepted target types
 *   BOUNDARY:   before any knowledge doc declares an anchor, `knowledge_checked`
 *               is exactly 0 while `specs_checked` keeps its own value of 1
 *   ERROR:      a knowledge anchor pointing at a MISSING path → exit exactly 3, row
 *               carries `doc_type: "knowledge"` + the knowledge `doc_slug` + the
 *               missing path; a present-file/absent-symbol anchor → `symbol_missing`
 *   STATE:      `lore anchor rm` on the knowledge target clears the breach — exit
 *               back to exactly 0 with `knowledge_checked` still 1
 *   REGRESSION: plain `lore status --json` (no `--check-drift`) still exits 0 and
 *               its `code_anchor_specs` still counts SPECS only; a mixed report
 *               labels the spec row `spec` and the knowledge rows `knowledge`
 *
 * @spec_ref spec-a-write-side-fact-with-no-read-side-address-counts-with-no §M2, AC-RR-4
 */

import { afterAll, describe, expect, it } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// tests/integration/cli/ → tests/integration/ → tests/ → packages/lore/ (3 up)
const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Spawns the real CLI (source mode) with `cwd` as both working directory and `$HOME`. */
function runLore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true", CLAUDECODE: "1" },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

interface DriftRowJson {
  doc_slug: string;
  doc_type: string;
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

function checkDriftJson(dir: string): { result: RunResult; drift: CodeDriftJson } {
  const result = runLore(["status", "--check-drift", "--json"], dir);
  const envelope = JSON.parse(result.stdout) as { ok: boolean; data: Record<string, unknown> };
  return { result, drift: envelope.data["code_drift"] as CodeDriftJson };
}

/** Every drift row attributed to `doc_type: "knowledge"` — the population AC-RR-4 keys on. */
function knowledgeRows(drift: CodeDriftJson): DriftRowJson[] {
  return drift.drifts.filter((row) => row.doc_type === "knowledge");
}

function parseJsonSlug(stdout: string): string {
  return (JSON.parse(stdout) as { data: { slug: string } }).data.slug;
}

function runOrThrow(args: string[], dir: string, label: string): RunResult {
  const result = runLore(args, dir);
  if (result.exitCode !== 0) {
    throw new Error(`${label} failed (exit ${result.exitCode}): ${result.stderr}${result.stdout}`);
  }
  return result;
}

/**
 * Disables the four service-layer `lore gate` checkpoints — mirrors
 * `cli-drift.bun.test.ts`'s helper. APPENDS (never rewrites) because a freshly
 * `lore init`-ed `config.yaml` already carries a REQUIRED top-level `project:` key.
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

// ─── Fixture: one throwaway corpus, seeded once, mutated sequentially ────────

const tmpDir = mkdtempSync(join(tmpdir(), "lore-knowledge-anchor-drift-"));

runOrThrow(["init"], tmpDir, "lore init");
disableAllGates(tmpDir);

// The anchored fixture source file — `--check-drift` probes relative to the CLI's
// own cwd, which is `tmpDir` for every spawn in this file.
mkdirSync(join(tmpDir, "src"), { recursive: true });
writeFileSync(
  join(tmpDir, "src", "suspension.ts"),
  "export function isSuspended(): boolean {\n  return false;\n}\n",
  "utf8",
);

const prdSlug = parseJsonSlug(
  runOrThrow(
    ["create", "prd", "--title", "Market Data Fixture Root", "--no-ai", "--content", "## Overview\n\nBody.", "--json"],
    tmpDir,
    "create prd",
  ).stdout,
);

// The SPEC population — one spec with an anchor that resolves. Present in every
// assertion below so a knowledge-attributed verdict can never be a restatement of
// global corpus cleanliness.
const specSlug = parseJsonSlug(
  runOrThrow(
    [
      "create",
      "spec",
      "--title",
      "Suspension Signal Contract",
      "--kind",
      "tech",
      "--no-ai",
      "--content",
      "## Overview\n\nBody.",
      "--code-anchor",
      "src/suspension.ts",
      "--json",
    ],
    tmpDir,
    "create spec",
  ).stdout,
);

// The KNOWLEDGE population — the domain-fact document. No anchors yet.
const knowledgeSlug = parseJsonSlug(
  runOrThrow(
    [
      "create",
      "knowledge",
      "--title",
      "Suspension Signal Availability Across Market Data Adapters",
      "--sub-type",
      "reference",
      "--parent",
      prdSlug,
      "--no-ai",
      "--content",
      "## Fact\n\nMANDATORY pre-read for any tradability logic.",
      "--json",
    ],
    tmpDir,
    "create knowledge",
  ).stdout,
);

const CONTROL_ANCHOR = "src/suspension.ts#isSuspended";
const MISSING_ANCHOR = "src/adapters/never-written.ts#suspensionFlag";
const ABSENT_SYMBOL_ANCHOR = "src/suspension.ts#suspensionFlagThatWasNeverExported";

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ─── BOUNDARY — knowledge_checked is 0 before any knowledge declares an anchor ─

describe("BOUNDARY — the knowledge population is reported separately and starts empty", () => {
  it("with one armed spec and zero armed knowledge docs: knowledge_checked is exactly 0, specs_checked exactly 1", () => {
    const { result, drift } = checkDriftJson(tmpDir);
    expect(result.exitCode).toBe(0);
    expect(drift.armed).toBe(true);
    expect(drift.specs_checked).toBe(1);
    expect(drift.knowledge_checked).toBe(0);
    expect(drift.drifts).toEqual([]);
  });
});

// ─── HAPPY (the CONTROL) — a resolving knowledge anchor stays clean ───────────

describe("HAPPY — a knowledge doc declares a code anchor whose file AND symbol exist", () => {
  it("lore anchor add accepts a knowledge target with the spec grammar (path#Symbol) and stores it", () => {
    const added = runLore(["anchor", "add", knowledgeSlug, CONTROL_ANCHOR], tmpDir);
    expect(added.exitCode).toBe(0);

    const listed = runLore(["anchor", "list", knowledgeSlug, "--json"], tmpDir);
    expect(listed.exitCode).toBe(0);
    const anchors = (JSON.parse(listed.stdout) as { data: { anchors: string[] } }).data.anchors;
    expect(anchors).toEqual([CONTROL_ANCHOR]);
  });

  it("CONTROL: --check-drift exits exactly 0 with ZERO knowledge-attributed rows while knowledge_checked is 1", () => {
    // The load-bearing half of AC-RR-4: proves the scan REACHED knowledge
    // (knowledge_checked === 1) and still returned clean — i.e. it discriminates
    // present from missing rather than breaching on every knowledge anchor.
    const { result, drift } = checkDriftJson(tmpDir);
    expect(result.exitCode).toBe(0);
    expect(drift.knowledge_checked).toBe(1);
    expect(drift.specs_checked).toBe(1);
    expect(knowledgeRows(drift)).toEqual([]);
    expect(drift.consistent).toBe(true);
  });
});

// ─── ERROR — a missing path under a knowledge anchor is a breach, attributed ──

describe("ERROR — a knowledge code anchor pointing at a MISSING path", () => {
  it("stores the anchor (exit 0 — a non-resolving code anchor is never refused at write time)", () => {
    const added = runLore(["anchor", "add", knowledgeSlug, MISSING_ANCHOR], tmpDir);
    expect(added.exitCode).toBe(0);
  });

  it("--check-drift exits exactly 3 and the row carries doc_type 'knowledge' + the knowledge doc_slug + the missing path", () => {
    const { result, drift } = checkDriftJson(tmpDir);
    expect(result.exitCode).toBe(3);
    expect(drift.knowledge_checked).toBe(1);

    const rows = knowledgeRows(drift);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      doc_type: "knowledge",
      doc_slug: knowledgeSlug,
      anchor: MISSING_ANCHOR,
      kind: "file_missing",
    });

    // Attribution, not global cleanliness: the spec population is still clean, and
    // the control anchor on the SAME knowledge doc produced no row of its own.
    expect(drift.drifts.filter((row) => row.doc_type === "spec")).toEqual([]);
    expect(drift.drifts.some((row) => row.anchor === CONTROL_ANCHOR)).toBe(false);
  });

  it("the human render names the doc type on the row and the repair hint targets the knowledge doc", () => {
    const result = runLore(["status", "--check-drift"], tmpDir);
    expect(result.exitCode).toBe(3);
    expect(result.stdout).toContain(`[knowledge] ${knowledgeSlug} → ${MISSING_ANCHOR} (file_missing)`);
    expect(result.stdout).toContain(`fix: lore anchor rm ${knowledgeSlug} '${MISSING_ANCHOR}'`);
    expect(result.stdout).toContain("1 knowledge doc(s) checked");
  });
});

// ─── ERROR — the `#Symbol` half of the grammar works for knowledge too ───────

describe("ERROR — a knowledge anchor whose file exists but whose symbol does not", () => {
  it("classifies symbol_missing and attributes it to doc_type 'knowledge'", () => {
    // This is the incident's exact shape: the fact asserted a named symbol's
    // behaviour, and the symbol is what moved.
    expect(runLore(["anchor", "add", knowledgeSlug, ABSENT_SYMBOL_ANCHOR], tmpDir).exitCode).toBe(0);

    const { result, drift } = checkDriftJson(tmpDir);
    expect(result.exitCode).toBe(3);
    const row = knowledgeRows(drift).find((candidate) => candidate.anchor === ABSENT_SYMBOL_ANCHOR);
    expect(row).toMatchObject({ doc_type: "knowledge", doc_slug: knowledgeSlug, kind: "symbol_missing" });

    expect(runLore(["anchor", "rm", knowledgeSlug, ABSENT_SYMBOL_ANCHOR], tmpDir).exitCode).toBe(0);
  });
});

// ─── REGRESSION — a MIXED report never lets a knowledge breach read as a spec's ─

describe("REGRESSION — a mixed spec+knowledge drift report labels every row with its own doc type", () => {
  it("the spec's broken anchor is labelled 'spec' and the knowledge doc's is labelled 'knowledge', in one report", () => {
    const specBrokenAnchor = "src/adapters/spec-side-never-written.ts";
    expect(runLore(["anchor", "add", specSlug, specBrokenAnchor], tmpDir).exitCode).toBe(0);

    const { result, drift } = checkDriftJson(tmpDir);
    expect(result.exitCode).toBe(3);
    expect(drift.specs_checked).toBe(1);
    expect(drift.knowledge_checked).toBe(1);

    const byAnchor = new Map(drift.drifts.map((row) => [row.anchor, row]));
    expect(byAnchor.get(specBrokenAnchor)).toMatchObject({ doc_type: "spec", doc_slug: specSlug });
    expect(byAnchor.get(MISSING_ANCHOR)).toMatchObject({ doc_type: "knowledge", doc_slug: knowledgeSlug });

    expect(runLore(["anchor", "rm", specSlug, specBrokenAnchor], tmpDir).exitCode).toBe(0);
  });
});

// ─── STATE — removing the knowledge anchor clears the breach ─────────────────

describe("STATE — lore anchor rm on a knowledge target clears the breach", () => {
  it("after removing the missing-path anchor, --check-drift exits exactly 0 with knowledge_checked still 1", () => {
    expect(runLore(["anchor", "rm", knowledgeSlug, MISSING_ANCHOR], tmpDir).exitCode).toBe(0);

    const { result, drift } = checkDriftJson(tmpDir);
    expect(result.exitCode).toBe(0);
    expect(drift.knowledge_checked).toBe(1);
    expect(knowledgeRows(drift)).toEqual([]);
    expect(drift.consistent).toBe(true);
  });
});

// ─── NEGATIVE — a target type outside the accepted set is still refused ──────

describe("NEGATIVE — an unsupported anchor target type", () => {
  it("lore anchor add against a prd exits exactly 4 and names all three accepted types", () => {
    const result = runLore(["anchor", "add", prdSlug, "src/suspension.ts"], tmpDir);
    expect(result.exitCode).toBe(4);
    const message = result.stderr + result.stdout;
    expect(message).toContain("task");
    expect(message).toContain("spec");
    expect(message).toContain("knowledge");
  });
});

// ─── REGRESSION — plain `lore status` still never fs-probes, and its store-only
//     declared-anchor count is still SPEC-scoped by decision ─────────────────

describe("REGRESSION — plain lore status is unchanged", () => {
  it("exits 0 and its code_anchor_specs counts SPECS only (deliberately not extended by M2)", () => {
    // reason: `code_anchor_specs` is a store-only, zero-fs-probe DECLARATION count
    // whose name states its population. M2 extends the DRIFT SCAN to knowledge, not
    // this line — pinned here so a future reader sees the scope is a decision, not
    // an oversight. The knowledge doc declares one anchor at this point.
    const result = runLore(["status", "--json"], tmpDir);
    expect(result.exitCode).toBe(0);
    const data = (JSON.parse(result.stdout) as { data: Record<string, unknown> }).data;
    expect(data["code_anchor_specs"]).toBe(1);
  });
});
