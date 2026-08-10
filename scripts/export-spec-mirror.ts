#!/usr/bin/env bun
/**
 * Spec-mirror export + drift check (`bun run mirror:export` / `bun run mirror:check`) —
 * `spec-falsifiability-reachability-a-feedable-checkpoint-an` D6, AC-FR-6/AC-FR-7 (G5).
 *
 * Root CLAUDE.md tells readers "exported mirrors live under `docs/requirements/spec/`", but
 * until this task NOTHING regenerated that directory and NOTHING detected its divergence from
 * the corpus (measured 2026-08-10: 100 files on disk vs 142 live corpus specs — 42 absent, before
 * ALSO discovering 89 orphaned legacy-named files once the exporter actually ran — see
 * `export-spec-mirror-core.ts`'s "Orphan pruning" for that measurement). This file delivers both
 * halves D6 requires, as two DELIBERATELY SEPARATE commands sharing one pure comparison function
 * (`computeMirrorParity`, imported from the sibling core module):
 *
 *   - `bun run mirror:export` (this file's default mode) — WRITES. Delegates to the existing,
 *     already-idempotent, already-collision-safe `ExportDocsService.exportDocs` (SPEC-021) —
 *     never reimplements corpus->markdown projection. Missing files are (re)created; existing
 *     clean files are left untouched. ALSO prunes orphaned mirror files afterward — without that,
 *     exact file-count parity (AC-FR-6) is unreachable no matter how many times the exporter runs.
 *   - `bun run mirror:check` (`--check` flag, this file's other mode) — READ-ONLY. Never calls
 *     `exportDocs`, never writes a byte. A run that finds drift reports the SAME drift on every
 *     subsequent run until something else (a real export) fixes it — see D6's own text: "a check
 *     that regenerates what it is checking can never fail."
 *
 * ## Why the pure/fs-only logic lives in a sibling `-core.ts` module
 *
 * This file imports `createApp` (`packages/lore/src/app.ts`), which top-level-imports
 * `bun:sqlite` — unresolvable inside a vitest worker (measured, mirrors `check-ac-ref-integrity.ts`'s
 * own documented reason for the identical split). `export-spec-mirror-core.ts` has NO such
 * dependency, so `scripts/tests/spec-mirror-export.test.ts` can import its pure functions
 * directly for algorithmic coverage, and drive THIS file only as a subprocess for end-to-end
 * assertions against the real corpus.
 *
 * ## Why `projectDir` is derived from THIS FILE's own path, never from the corpus DB's path
 *
 * `findLoreDbPath()` (this repo's shared DB-discovery helper) falls back to the MAIN checkout's
 * `.lore/lore.db` whenever the caller's cwd sits inside a LINKED git worktree with no local DB of
 * its own (worktree dispatch never copies the gitignored `.lore/lore.db` — SPEC M4). The existing
 * `lore export-docs` CLI command derives its write target (`projectDir`) from `dirname(dirname(dbPath))`
 * — so run from inside a linked worktree, it would silently write generated files into the MAIN
 * checkout's working tree, not the worktree that invoked it. This script instead computes its own
 * `REPO_ROOT` from `import.meta.url` — wherever THIS FILE is checked out is where its output goes —
 * decoupling "which corpus DB answers reads" (shared, cross-worktree, via `findLoreDbPath()`) from
 * "which working tree receives writes" (always the one running this script). Mirrors the identical
 * `REPO_ROOT` derivation `scripts/check-ac-ref-integrity.ts` already uses for its ledger path.
 *
 * ## Mirror identity: corpus spec (id, slug) <-> `.lore/export-index.json` mapping <-> on-disk file
 *
 * A corpus spec's exported filename is `SPEC-<ordinal>-<kebab-title>.md` (human_id, never the
 * slug) — `.lore/export-index.json` (git-tracked, SPEC-021 §9.3) is the SSOT translating a spec's
 * ULID to its `file_path`. "Every corpus spec slug present as a file" (AC-FR-6) therefore means:
 * for every spec doc, its export-index mapping resolves to a file that exists on disk — reported
 * by SLUG (the human-readable identity a reader can act on), never by ULID or human_id alone.
 *
 * Public surface:
 *   - `runExport` — IO, WRITES. Calls `ExportDocsService.exportDocs`, prunes orphans, then
 *     re-derives parity via `runCheck` so the export's own report reflects ground truth, never an
 *     assumed success.
 *   - `runCheck` — IO, READ-ONLY. Never calls `exportDocs` — see the module-level warning above.
 *   - `main` — IO. CLI dispatch (`--check` selects check mode); never calls `process.exit` itself.
 *   - Everything under "Pure/fs-only surface" below is re-exported from `export-spec-mirror-core.js`
 *     for callers that only need one import site.
 *
 * Side-effect class: `runCheck` reads the corpus (via the injected `App`) and the filesystem
 * (index + `.md` listing), never writes. `runExport` writes generated `.md` files and
 * `.lore/export-index.json` (both git-tracked deliverables — expected to be committed, per this
 * task's own scope note). `main` also writes to stdout/stderr.
 *
 * Exit codes:
 *   0 — clean. Export mode: 0 per-doc export errors AND full parity reached. Check mode: full
 *       parity (no missing mapping, no absent file, on-disk count === corpus spec count).
 *   {@link MIRROR_DRIFT_EXIT_CODE} (2) — check mode found >=1 corpus spec not mirrored on disk
 *       (either never exported, or its mapped file is absent); OR export mode completed with 0
 *       per-doc errors but still failed to reach parity (defensive — should not occur for `spec`
 *       docs, since `exportDocs` either creates or reports an error for every doc it processes).
 *   {@link MIRROR_HARD_FAILURE_EXIT_CODE} (4) — a per-doc export error, an unreadable or
 *       schema-invalid `.lore/export-index.json`, or a corpus read failure.
 *
 * Usage:
 *   bun scripts/export-spec-mirror.ts            # export (writes)
 *   bun scripts/export-spec-mirror.ts --check    # drift check (read-only, never regenerates)
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp, type App } from "../packages/lore/src/app.js";
import { findLoreDbPath } from "../packages/lore/src/adapters/cli/utils.js";
import {
  SPEC_MIRROR_DIR_RELATIVE,
  MIRROR_DRIFT_EXIT_CODE,
  MIRROR_HARD_FAILURE_EXIT_CODE,
  SpecMirrorError,
  computeMirrorParity,
  loadMirrorMappings,
  countMdFilesFlat,
  pruneOrphanMirrorFiles,
  scriptChainReachesTarget,
  printParity,
  printExportReport,
  type MirrorParityResult,
  type MirrorParityMissing,
  type MirrorExportReportLike,
} from "./export-spec-mirror-core.js";

// Pure/fs-only surface — re-exported so a caller needing both halves has one import site.
export {
  SPEC_MIRROR_DIR_RELATIVE,
  MIRROR_DRIFT_EXIT_CODE,
  MIRROR_HARD_FAILURE_EXIT_CODE,
  SpecMirrorError,
  computeMirrorParity,
  loadMirrorMappings,
  countMdFilesFlat,
  pruneOrphanMirrorFiles,
  scriptChainReachesTarget,
};
export type { MirrorParityResult, MirrorParityMissing, MirrorExportReportLike };

const __filename = fileURLToPath(import.meta.url);
/** This file's own repo root — see module header "Why `projectDir` is derived from THIS FILE's own path". */
const REPO_ROOT = join(__filename, "..", "..");

/** Full result of one `runExport` run — the underlying service's own report, the orphan-pruning log (empty when nothing was orphaned), and the measured post-write parity verdict. */
export interface MirrorExportResult {
  readonly report: MirrorExportReportLike;
  /** Repo-relative paths of `.md` files removed this run because no CURRENT export-index mapping pointed to them — see `export-spec-mirror-core.ts`'s "Orphan pruning". Never silent: always populated, even when empty. */
  readonly pruned: readonly string[];
  readonly parity: MirrorParityResult;
}

/**
 * Read-only drift check (D6/AC-FR-7). Reads the live corpus spec list and the on-disk mirror
 * state; NEVER calls `exportDocs` and never writes a byte — running this twice in a row against
 * the same on-disk state MUST report the identical verdict both times, which is exactly what
 * makes this a drift CHECK rather than a self-healing export.
 *
 * @throws {SpecMirrorError} `corpus_unreadable` (store read failure) or any `loadMirrorMappings` error.
 */
export async function runCheck(app: App, repoRoot: string = REPO_ROOT): Promise<MirrorParityResult> {
  const specsResult = await app.corpusService.listFull({ type: "spec" });
  if (!specsResult.ok) {
    throw new SpecMirrorError("corpus_unreadable", `failed to list corpus spec docs: ${JSON.stringify(specsResult.error)}`, {
      error: specsResult.error,
    });
  }
  const specs = specsResult.value.docs.map((doc) => ({ id: doc.id, slug: doc.slug }));

  const mappings = loadMirrorMappings(repoRoot);
  const fileCountOnDisk = countMdFilesFlat(join(repoRoot, SPEC_MIRROR_DIR_RELATIVE));
  const fileExists = (relFilePath: string): boolean => existsSync(join(repoRoot, relFilePath));

  return computeMirrorParity(specs, mappings, fileExists, fileCountOnDisk);
}

/**
 * Idempotent, convergent export (D6/AC-FR-6). Delegates the actual corpus->markdown projection
 * to the existing `ExportDocsService.exportDocs` (SPEC-021) — this function adds nothing to that
 * algorithm's WRITE logic beyond scoping it to `type: "spec"` and this file's own `projectDir`
 * (never `dbPath`'s directory — see module header). It DOES add orphan pruning (see
 * `export-spec-mirror-core.ts`'s "Orphan pruning") — without it, this would be idempotent (stable
 * additions) but never convergent (exact parity), which is what AC-FR-6 actually requires.
 * Re-derives parity via `runCheck` afterward so the returned verdict is measured, never assumed
 * from `report.errors.length === 0` alone.
 *
 * @throws {SpecMirrorError} `corpus_unreadable` if the underlying `exportDocs` call itself fails
 *   (a store-level error, not a per-doc one — those land in `report.errors` instead); propagates
 *   `loadMirrorMappings`'s / `runCheck`'s errors for the post-write reconcile + verification pass.
 */
export async function runExport(app: App, repoRoot: string = REPO_ROOT): Promise<MirrorExportResult> {
  const exportResult = await app.exportDocsService.exportDocs({ projectDir: repoRoot, dryRun: false, type: "spec" });
  if (!exportResult.ok) {
    throw new SpecMirrorError("corpus_unreadable", `export failed: ${JSON.stringify(exportResult.error)}`, {
      error: exportResult.error,
    });
  }

  // reason: exportDocs saves the index (Phase 1) BEFORE it writes any files (Phase 2) — see
  // ExportDocsService's own module header — so by the time exportDocs() has returned, the index
  // on disk already reflects every mapping change this run made. Re-reading it here (rather than
  // reusing a stale in-memory copy) is what makes pruning see the CURRENT truth.
  const freshMappings = loadMirrorMappings(repoRoot);
  const pruned = pruneOrphanMirrorFiles(repoRoot, freshMappings);

  const parity = await runCheck(app, repoRoot);
  return { report: exportResult.value, pruned, parity };
}

/**
 * CLI entrypoint: dispatches export vs. check mode from `argv`, runs it against a real `App`,
 * prints a report, and returns the process exit code. Never calls `process.exit` itself (the
 * `import.meta.main` block below is the only place that does), so this stays directly callable
 * from tests.
 *
 * @param argv defaults to `process.argv.slice(2)`; `--check` selects the read-only drift check.
 * @param repoRootOverride defaults to {@link REPO_ROOT} (this file's own location) — tests pass a
 *   throwaway fixture root here.
 * @param dbPathOverride defaults to `findLoreDbPath()` — tests pass a throwaway `mkdtemp` +
 *   `lore init` corpus path here, NEVER the repo's own `.lore/lore.db` for anything that writes.
 */
export async function main(
  argv: readonly string[] = process.argv.slice(2),
  repoRootOverride?: string,
  dbPathOverride?: string,
): Promise<number> {
  const repoRoot = repoRootOverride ?? REPO_ROOT;
  const checkMode = argv.includes("--check");
  const dbPath = dbPathOverride ?? findLoreDbPath();
  const app = createApp(dbPath);
  try {
    if (checkMode) {
      const parity = await runCheck(app, repoRoot);
      printParity("check", parity);
      if (!parity.ok) return MIRROR_DRIFT_EXIT_CODE;
      console.log(`export-spec-mirror --check: OK — mirror matches the corpus exactly.`);
      return 0;
    }

    const { report, pruned, parity } = await runExport(app, repoRoot);
    printExportReport(report);
    if (pruned.length > 0) {
      console.log(`export-spec-mirror: pruned ${pruned.length} orphaned file(s) (no longer mapped to any corpus spec):`);
      for (const relPath of pruned) console.log(`  ${relPath}`);
    }
    printParity("export", parity);
    if (report.errors.length > 0) return MIRROR_HARD_FAILURE_EXIT_CODE;
    if (!parity.ok) return MIRROR_DRIFT_EXIT_CODE;
    console.log(`export-spec-mirror: OK — mirror matches the corpus exactly.`);
    return 0;
  } finally {
    app.close();
  }
}

if (import.meta.main) {
  try {
    process.exit(await main());
  } catch (e) {
    if (e instanceof SpecMirrorError) {
      console.error(`export-spec-mirror: ${e.message}`);
      if (e.context) console.error(JSON.stringify(e.context));
      process.exit(MIRROR_HARD_FAILURE_EXIT_CODE);
    }
    console.error(`export-spec-mirror: failed — ${e instanceof Error ? e.message : String(e)}`);
    process.exit(MIRROR_HARD_FAILURE_EXIT_CODE);
  }
}
