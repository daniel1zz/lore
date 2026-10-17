// @spawns packages/lore/src/index.ts
/**
 * AC-MIS-2 oracle (spec-mirror-identifier-ssot D1) — round-trip idempotency
 * across the corpus<->file mirror's export<->migrate seam.
 *
 * Runs the REAL source-mode CLI (`bun run src/index.ts ...`, never the
 * compiled `dist/lore` — this task's dispatch forbids `bun run build`)
 * against a THROWAWAY `mkdtemp` corpus (⛔ never this repo's own `.lore/`,
 * project CLAUDE.md hard rule) through the exact sequence D1/AC-MIS-2
 * names: `lore export-docs` -> `lore migrate ordinals --apply` ->
 * `lore export-docs` again, then asserts `.lore/export-index.json` is
 * BYTE-IDENTICAL (sha256 hash equality, never "no errors reported") across
 * every checkpoint in that sequence.
 *
 * ⛔ Deliberately does NOT shell out to `bun run mirror:export` /
 * `scripts/export-spec-mirror.ts` — that script derives its write target
 * from ITS OWN file's `import.meta.url` (see that file's own module header,
 * "`projectDir` is derived from THIS FILE's own path, never from the corpus
 * DB's path"), so it always targets THIS repo's real working tree no matter
 * what `cwd` a subprocess call passes it. `lore export-docs` (this file's
 * `runLore(["export-docs", ...])`) derives its write target from `dbPath`
 * instead (`dirname(dirname(dbPath))`, `export-docs.ts`), which resolves
 * inside the throwaway corpus precisely because `HOME`/`cwd` are pointed at
 * it — the only CLI surface that is genuinely throwaway-corpus-safe for
 * this seam.
 *
 * ## Why a single doc, hashed at the MIDDLE checkpoint too, is a genuine falsifier
 *
 * A naive "hash only after the FINAL export" check is a false-negative trap
 * on a single-doc fixture: `ExportDocsService`'s own reconcile (`:1031`) is
 * ALREADY correct (padded) and self-heals ANY disagreement on every export
 * call, including one the buggy `formatDocDisplayId` composition at
 * `ordinal-migration-service.ts:743` would have introduced — so a single doc
 * round-trips back to the IDENTICAL padded value and (with only one key in
 * `index.mappings`) the identical byte sequence, REGARDLESS of whether the
 * migrate step's composition was ever correct in the middle. This suite
 * therefore hashes THREE checkpoints (after export #1, after migrate
 * --apply, after export #2) and asserts ALL THREE are byte-identical — the
 * defect this AC catches is a MOMENTARY unpadded write inside the migrate
 * step (`indexDirty = true` -> `saveExportIndexAtomic`), which the
 * export-1-vs-migrate hash pair catches directly even on one doc, before
 * the final export ever gets a chance to paper back over it.
 *
 * Manually confirmed (2026-08-11, this task) that reverting
 * `ordinal-migration-service.ts:743` from `formatMirrorHumanId` back to
 * `formatDocDisplayId` turns the HAPPY case below RED — the migrate step's
 * hash diverges from the post-export-1 hash (see this task's evidence log).
 *
 * Six-dimension coverage:
 *   HAPPY:      one freshly-created spec doc — export -> migrate --apply ->
 *               export leaves the file byte-identical at every checkpoint,
 *               and the migrate step performs ZERO export-index reconciles
 *               / ZERO writes (nothing to converge — it was already correct).
 *   NEGATIVE:   three docs, all already correctly padded after export #1 —
 *               migrate --apply reports zero reconciles for ALL of them
 *               (the mechanism does not false-positive at scale).
 *   BOUNDARY:   exactly TWO docs (the minimal multi-key case) — guards
 *               against a delete+reinsert reordering artifact in
 *               `index.mappings`' JSON key order that a single-key fixture
 *               can never expose.
 *   ERROR:      a doc whose export-index mapping is ALREADY drifted
 *               (unpadded) on disk BEFORE the first export ever runs — the
 *               real incident's actual starting condition. The first export
 *               self-heals it, and the round trip from there stays stable.
 *   STATE:      after one full round trip, a SECOND full cycle (export ->
 *               migrate --apply -> export) starting from the now-converged
 *               state produces the identical hash again — no residual drift
 *               accumulates across repeated cycles.
 *   REGRESSION: the HAPPY case IS the declared falsifier's oracle — see the
 *               module-header note above; re-run manually against a
 *               reverted `:743` to reconfirm red before any future edit to
 *               that line.
 *
 * Source: spec-mirror-identifier-ssot-one-writer-for-export-index-human,
 * Acceptance Criteria AC-MIS-2.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ─── Path / spawn setup (source-mode, mirrors cli-check-tree.bun.test.ts) ──

const PROJECT_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PROJECT_ROOT, "src", "index.ts");
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Run `bun run src/index.ts ...args` (SOURCE mode, never compiled) in `cwd`. */
function runLore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, CLAUDECODE: "1" },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

/**
 * Parses a CLI `--json` invocation's stdout. Every command this suite calls
 * (`create`, `export-docs`, `migrate ordinals`) prints exactly ONE
 * pretty-printed (`JSON.stringify(v, null, 2)`) envelope and nothing else on
 * stdout in `--json` mode — so parsing the whole trimmed stream directly is
 * correct; a "last non-empty LINE" scanner (the compact single-line-JSON
 * pattern used elsewhere in this repo) would instead see a lone `}` on the
 * final line of a multi-line pretty-printed object and fail to parse it.
 */
function parseJsonOutput(stdout: string): unknown {
  const trimmed = stdout.trim();
  const firstBrace = trimmed.indexOf("{");
  if (firstBrace === -1) {
    throw new Error(`No JSON object found in CLI output:\n${stdout}`);
  }
  return JSON.parse(trimmed.slice(firstBrace));
}

interface JsonEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: unknown;
}

/** Disables the four `lore gate` service-layer checkpoints (mirrors the
 *  compiled AC-084-5 e2e suite's precedent) — this suite's concern is the
 *  export<->migrate seam, not spec-create skeleton-content gating. */
function disableAllGates(dir: string): void {
  writeFileSync(
    join(dir, ".lore", "config.yaml"),
    readFileSync(join(dir, ".lore", "config.yaml"), "utf8") +
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
    "utf8",
  );
}

function initThrowawayCorpus(): string {
  const dir = mkdtempSync(join(tmpdir(), "lore-mirror-roundtrip-"));
  // Never the repo's own .lore/ corpus (project CLAUDE.md hard rule) — a
  // genuine os.tmpdir() path is never a prefix of REPO_ROOT.
  expect(dir.startsWith(REPO_ROOT)).toBe(false);
  const initResult = runLore(["init", "--author", "mirror-roundtrip-test"], dir);
  expect(initResult.exitCode).toBe(0);
  disableAllGates(dir);
  return dir;
}

function createRootPrd(dir: string): string {
  const result = runLore(
    ["create", "prd", "--title", "Mirror Roundtrip Root PRD", "--content", "## Overview\nroot", "--no-ai", "--json"],
    dir,
  );
  expect(result.exitCode).toBe(0);
  const envelope = parseJsonOutput(result.stdout) as JsonEnvelope<{ slug: string }>;
  expect(envelope.ok).toBe(true);
  return envelope.data!.slug;
}

function createSpec(dir: string, prdSlug: string, title: string): { id: string; slug: string; ordinal: number | null } {
  const result = runLore(
    ["create", "spec", "--title", title,"--content", "## Overview\nfixture body", "--no-ai", "--json"],
    dir,
  );
  expect(result.exitCode).toBe(0);
  const envelope = parseJsonOutput(result.stdout) as JsonEnvelope<{ id: string; slug: string; ordinal: number | null }>;
  expect(envelope.ok).toBe(true);
  return envelope.data!;
}

function exportDocs(dir: string): RunResult {
  const result = runLore(["export-docs", "--json"], dir);
  expect(result.exitCode).toBe(0);
  return result;
}

function migrateOrdinalsApply(dir: string): { writes_performed: number; export_index_reconciles: unknown[]; errors: string[] } {
  const result = runLore(["migrate", "ordinals", "--apply", "--json"], dir);
  expect(result.exitCode).toBe(0);
  const envelope = parseJsonOutput(result.stdout) as JsonEnvelope<{
    writes_performed: number;
    export_index_reconciles: unknown[];
    errors: string[];
  }>;
  expect(envelope.ok).toBe(true);
  return envelope.data!;
}

function hashExportIndex(dir: string): string {
  const raw = readFileSync(join(dir, ".lore", "export-index.json"), "utf8");
  return createHash("sha256").update(raw).digest("hex");
}

// ─── Suite ──────────────────────────────────────────────────────────────────

describe("mirror export <-> migrate ordinals seam is byte-identical round-trip idempotent (AC-MIS-2)", () => {
  let dir: string;

  beforeEach(() => {
    dir = initThrowawayCorpus();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // ── HAPPY: single doc, three-checkpoint hash equality, zero mid-migrate writes ──
  it("HAPPY: export -> migrate ordinals --apply -> export is byte-identical at every checkpoint, zero reconciles", () => {
    const prdSlug = createRootPrd(dir);
    createSpec(dir, prdSlug, "Alpha decision");

    exportDocs(dir);
    const hashAfterExport1 = hashExportIndex(dir);

    const migrateReport = migrateOrdinalsApply(dir);
    expect(migrateReport.errors).toEqual([]);
    // The defect this AC exists to catch: a buggy composition would have
    // written an unpadded value HERE, at the migrate step, before the
    // second export ever ran — caught directly even on a single doc.
    expect(migrateReport.export_index_reconciles).toEqual([]);
    expect(migrateReport.writes_performed).toBe(0);
    const hashAfterMigrate = hashExportIndex(dir);
    expect(hashAfterMigrate).toBe(hashAfterExport1);

    exportDocs(dir);
    const hashAfterExport2 = hashExportIndex(dir);
    expect(hashAfterExport2).toBe(hashAfterExport1);
  });

  // ── NEGATIVE: multiple already-correct docs — zero false-positive reconciles ──
  it("NEGATIVE: three already-correctly-padded docs produce zero reconciles for ALL of them", () => {
    const prdSlug = createRootPrd(dir);
    createSpec(dir, prdSlug, "Doc one");
    createSpec(dir, prdSlug, "Doc two");
    createSpec(dir, prdSlug, "Doc three");

    exportDocs(dir);
    const hashAfterExport1 = hashExportIndex(dir);

    const migrateReport = migrateOrdinalsApply(dir);
    expect(migrateReport.export_index_reconciles).toEqual([]);
    expect(migrateReport.writes_performed).toBe(0);
    expect(hashExportIndex(dir)).toBe(hashAfterExport1);
  });

  // ── BOUNDARY: exactly two docs — the minimal multi-key case ──────────────
  it("BOUNDARY: exactly two docs stay byte-identical across the round trip (guards a delete+reinsert key-order artifact)", () => {
    const prdSlug = createRootPrd(dir);
    createSpec(dir, prdSlug, "First doc");
    createSpec(dir, prdSlug, "Second doc");

    exportDocs(dir);
    const hashAfterExport1 = hashExportIndex(dir);

    migrateOrdinalsApply(dir);
    expect(hashExportIndex(dir)).toBe(hashAfterExport1);

    exportDocs(dir);
    expect(hashExportIndex(dir)).toBe(hashAfterExport1);
  });

  // ── ERROR: pre-existing on-disk drift (the real incident's starting state) ──
  it("ERROR: a legacy unpadded mapping already on disk before the first export is self-healed, then stays stable", () => {
    const prdSlug = createRootPrd(dir);
    const doc = createSpec(dir, prdSlug, "Legacy drifted doc");
    expect(doc.ordinal).not.toBeNull();

    // Simulate the real incident's starting condition: an export-index.json
    // already exists carrying the UNPADDED legacy form for this doc, as if
    // written by a pre-fix `lore migrate ordinals --apply` run, before this
    // suite's very first `export-docs` call.
    const loreDir = join(dir, ".lore");
    mkdirSync(loreDir, { recursive: true });
    writeFileSync(
      join(loreDir, "export-index.json"),
      JSON.stringify(
        {
          version: 1,
          mappings: {
            [doc.id]: {
              human_id: `SPEC-${doc.ordinal}`,
              file_path: `docs/requirements/spec/SPEC-${doc.ordinal}-legacy-drifted-doc.md`,
            },
          },
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    // First export self-heals the legacy drift (ExportDocsService's OWN
    // reconcile at :1031, always correct/padded — not this task's change).
    exportDocs(dir);
    const hashAfterExport1 = hashExportIndex(dir);
    const indexAfterExport1 = JSON.parse(readFileSync(join(loreDir, "export-index.json"), "utf8")) as {
      mappings: Record<string, { human_id: string }>;
    };
    expect(indexAfterExport1.mappings[doc.id]?.human_id).toBe(`SPEC-${String(doc.ordinal).padStart(3, "0")}`);

    // From this now-converged state, the round trip stays stable.
    const migrateReport = migrateOrdinalsApply(dir);
    expect(migrateReport.export_index_reconciles).toEqual([]);
    expect(hashExportIndex(dir)).toBe(hashAfterExport1);

    exportDocs(dir);
    expect(hashExportIndex(dir)).toBe(hashAfterExport1);
  });

  // ── STATE: a second full round-trip cycle stays byte-identical too ──────
  it("STATE: a second full export/migrate/export cycle from the converged state produces the identical hash again", () => {
    const prdSlug = createRootPrd(dir);
    createSpec(dir, prdSlug, "Repeat cycle doc");

    exportDocs(dir);
    migrateOrdinalsApply(dir);
    exportDocs(dir);
    const hashAfterFirstCycle = hashExportIndex(dir);

    // Second full cycle, starting from the already-converged state.
    exportDocs(dir);
    const hashMidSecondCycle = hashExportIndex(dir);
    expect(hashMidSecondCycle).toBe(hashAfterFirstCycle);

    const secondMigrateReport = migrateOrdinalsApply(dir);
    expect(secondMigrateReport.export_index_reconciles).toEqual([]);
    expect(secondMigrateReport.writes_performed).toBe(0);
    expect(hashExportIndex(dir)).toBe(hashAfterFirstCycle);

    exportDocs(dir);
    expect(hashExportIndex(dir)).toBe(hashAfterFirstCycle);
  });
});
