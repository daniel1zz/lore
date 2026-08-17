#!/usr/bin/env bun
/**
 * Corpus-mirror export + drift check for ALL SIX mirrored doc types (`bun run mirror:export` /
 * `bun run check:spec-mirror`) — `spec-falsifiability-reachability-a-feedable-checkpoint-an` D6,
 * AC-FR-6/AC-FR-7/AC-FR-10 (G5).
 *
 * Root CLAUDE.md tells readers "exported mirrors live under `docs/requirements/spec/`", but
 * until the first D6 task NOTHING regenerated that directory and NOTHING detected its
 * divergence from the corpus (measured 2026-08-10: 100 files on disk vs 142 live corpus specs —
 * 42 absent, before ALSO discovering 89 orphaned legacy-named files once the exporter actually
 * ran — see `export-spec-mirror-core.ts`'s "Orphan pruning" for that measurement). This file
 * delivers both halves D6 requires, as two DELIBERATELY SEPARATE commands sharing one pure
 * comparison function (`computeMirrorParity`, imported from the sibling core module) — run ONCE
 * PER {@link MirrorDocType} (task-unify-mirror-identifiers-on-zero-padded-form-export-all,
 * 2026-08-11 — widened from `spec`-only to `MIRROR_TYPES`' full six types: `prd`/`spec`/`adr`/
 * `knowledge`/`plan`/`task`, per AC-FR-10):
 *
 *   - `bun run mirror:export` (this file's default mode) — WRITES. Delegates to the existing,
 *     already-idempotent, already-collision-safe `ExportDocsService.exportDocs` (SPEC-021) —
 *     never reimplements corpus->markdown projection. Missing files are (re)created; existing
 *     clean files are left untouched. ALSO prunes orphaned mirror files afterward — without that,
 *     exact file-count parity (AC-FR-6) is unreachable no matter how many times the exporter runs.
 *     Deliberately NOT wired into any script chain — it is the explicit repair action a human (or
 *     a release step) takes after `check:spec-mirror` reports drift, never something a routine
 *     verification command (`bun run build`, `bun run test`) triggers as a side effect. An earlier
 *     revision of this file wired `mirror:export` into `build`; that was reverted (2026-08-10, same
 *     task) because `bun run build` is a routine post-merge verification step and rewriting
 *     `docs/requirements/spec/**` + `.lore/export-index.json` every time it runs leaves a dirty
 *     tree, which breaks this repo's own "a full-suite verdict requires a CLEAN tree" standing rule
 *     — the same failure shape `lore assess` already flagged elsewhere as "a check command with a
 *     write side effect surprises callers and CI."
 *
 *     task-the-two-mirror-exporters-disagree-because-drift-detection (2026-08-13) — this mode's
 *     write loop now ALSO converges a status-only (or other scalar-frontmatter-only) drift
 *     unconditionally, with NO code change needed in THIS file: `ExportDocsService.exportDocs`'s
 *     write loop gained a frontmatter-scalar staleness check (`frontmatter_repaired`/
 *     `frontmatter_declined` on `ExportReport` — see that module's own doc comments) that fires
 *     independent of `opts.force`, the same way the pre-existing identity check (`id`/`parent`/
 *     `plan`/`links`) already does — because a `status`/`priority`/`title`/`tags`/`phase` value
 *     is a corpus-authoritative fact with exactly one correct answer, never a hand-edit judgement
 *     call the way body content is. Since THIS file's `runExport`/`main` call that service
 *     directly with no intervening logic of their own, `bun run mirror:export` (no flags) now
 *     repairs a status-only drift for the SAME reason `lore export-docs` (the other caller of the
 *     same service) does — one shared mechanism, not a duplicated one. ⛔ This is deliberately
 *     NOT the same thing as wiring a `--force` flag through to `ExportDocsOptions.force` here:
 *     BODY content drift still requires the existing, unchanged, explicit `--force` opt-in (SPEC-
 *     021 Amendment A2) — that axis is untouched by this task, which is scoped to the frontmatter-
 *     only case where the body is provably byte-identical (`scripts/tests/mirror-frontmatter-
 *     drift.test.ts` proves both halves against a throwaway corpus, driving this exact `main()`
 *     entry point).
 *   - `bun run check:spec-mirror` (`--check` flag, this file's other mode) — READ-ONLY. Never
 *     calls `exportDocs`, never writes a byte. A run that finds drift reports the SAME drift on
 *     every subsequent run until something else (a real export) fixes it — see D6's own text: "a
 *     check that regenerates what it is checking can never fail." THIS is the mode wired into the
 *     `test` script chain (`package.json`) — see AC-FR-6's own oracle
 *     (`scripts/tests/spec-mirror-export.test.ts`), which asserts the chain reaches THIS FILE
 *     (`export-spec-mirror.ts`, the script AC-FR-6 names), never a specific mode-flag string —
 *     `check:spec-mirror` invokes this exact file, so the criterion holds while the wired command
 *     stays read-only.
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
 * ## Mirror identity: corpus doc (id, slug) <-> `.lore/export-index.json` mapping <-> on-disk file
 *
 * A corpus doc's exported filename is `{PREFIX}-<padded-ordinal-or-counter>-<kebab-title>.md`
 * (human_id, never the slug) — `.lore/export-index.json` (git-tracked, SPEC-021 §9.3) is the SSOT
 * translating a doc's ULID to its `file_path`. "Every corpus doc slug present as a file"
 * (AC-FR-6/AC-FR-10) therefore means: for every doc of a mirrored type, its export-index mapping
 * resolves to a file that exists on disk — reported by SLUG (the human-readable identity a
 * reader can act on), never by ULID or human_id alone.
 *
 * Public surface:
 *   - `runExport` — IO, WRITES. Calls `ExportDocsService.exportDocs` once per {@link
 *     MirrorDocType}, prunes orphans across every mirrored directory, then re-derives parity via
 *     `runCheck` so the export's own report reflects ground truth, never an assumed success.
 *   - `runCheck` — IO, READ-ONLY. Never calls `exportDocs` — see the module-level warning above.
 *   - `main` — IO. CLI dispatch (`--check` selects check mode); never calls `process.exit` itself.
 *   - Everything under "Pure/fs-only surface" below is re-exported from `export-spec-mirror-core.js`
 *     for callers that only need one import site.
 *
 * Side-effect class: `runCheck` reads the corpus (via the injected `App`) and the filesystem
 * (index + `.md` listing per type), never writes. `runExport` writes generated `.md` files and
 * `.lore/export-index.json` (both git-tracked deliverables — expected to be committed, per this
 * task's own scope note). `main` also writes to stdout/stderr.
 *
 * Exit codes (⛔ "parity"/"OK" below means COUNT + SLUG PRESENCE ONLY — file CONTENT is never
 * compared; see `computeMirrorParity`'s own doc comment in `export-spec-mirror-core.ts` for why
 * that scope is deliberate, and for the caller-facing wording every "OK" message below must match):
 *   0 — clean. Export mode: 0 per-doc export errors across EVERY type AND every corpus doc of
 *       every mirrored type has a mirror file (on-disk count === corpus count per type, every
 *       mapped file exists). Check mode: same parity condition across all six types, read-only.
 *   {@link MIRROR_DRIFT_EXIT_CODE} (2) — check mode found >=1 corpus doc (any mirrored type) not
 *       mirrored on disk (either never exported, or its mapped file is absent); OR export mode
 *       completed with 0 per-doc errors but still failed to reach parity for some type
 *       (defensive — should not occur, since `exportDocs` either creates or reports an error for
 *       every doc it processes).
 *   {@link MIRROR_HARD_FAILURE_EXIT_CODE} (4) — a per-doc export error, an unreadable or
 *       schema-invalid `.lore/export-index.json`, or a corpus read failure, for ANY type.
 *
 * Usage:
 *   bun scripts/export-spec-mirror.ts            # export ALL SIX types (writes)
 *   bun scripts/export-spec-mirror.ts --check    # drift check, ALL SIX types (read-only, never regenerates)
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp, type App } from "../packages/lore/src/app.js";
import { findLoreDbPath } from "../packages/lore/src/adapters/cli/utils.js";
import {
  MIRROR_TYPES,
  mirrorDirRelative,
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
  type MirrorDocType,
  type MirrorParityResult,
  type MirrorParityMissing,
  type MirrorExportReportLike,
} from "./export-spec-mirror-core.js";

// Pure/fs-only surface — re-exported so a caller needing both halves has one import site.
export {
  MIRROR_TYPES,
  mirrorDirRelative,
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
export type { MirrorDocType, MirrorParityResult, MirrorParityMissing, MirrorExportReportLike };

const __filename = fileURLToPath(import.meta.url);
/** This file's own repo root — see module header "Why `projectDir` is derived from THIS FILE's own path". */
const REPO_ROOT = join(__filename, "..", "..");

/** Parity verdict across every {@link MirrorDocType} — the aggregate `runCheck`/`runExport` return, one `MirrorParityResult` per type plus a corpus-wide `ok` (AND across all six). */
export interface MirrorParityAllTypesResult {
  readonly perType: Readonly<Record<MirrorDocType, MirrorParityResult>>;
  /** `true` iff every type's own `perType[type].ok` is `true`. */
  readonly ok: boolean;
}

/** Full result of one `runExport` run — the underlying service's own report PER TYPE, the corpus-wide orphan-pruning log (empty when nothing was orphaned), and the measured post-write parity verdict across all six types. */
export interface MirrorExportResult {
  readonly perType: Readonly<Record<MirrorDocType, MirrorExportReportLike>>;
  /** Repo-relative paths of `.md` files removed this run (any mirrored type) because no CURRENT export-index mapping pointed to them — see `export-spec-mirror-core.ts`'s "Orphan pruning". Never silent: always populated, even when empty. */
  readonly pruned: readonly string[];
  readonly parity: MirrorParityAllTypesResult;
}

/**
 * Read-only drift check (D6/AC-FR-7, widened to all six types by AC-FR-10). Reads the live
 * corpus doc list and the on-disk mirror state for EVERY {@link MirrorDocType}; NEVER calls
 * `exportDocs` and never writes a byte — running this twice in a row against the same on-disk
 * state MUST report the identical verdict both times, which is exactly what makes this a drift
 * CHECK rather than a self-healing export.
 *
 * `.lore/export-index.json` is loaded ONCE (not once per type) — it is a single shared mapping
 * table keyed by doc ULID across ALL types, so `computeMirrorParity` looking up only the ids
 * belonging to the current type's doc list is sufficient; no per-type filtering needed.
 *
 * @throws {SpecMirrorError} `corpus_unreadable` (store read failure, names the failing type) or
 *   any `loadMirrorMappings` error.
 */
export async function runCheck(app: App, repoRoot: string = REPO_ROOT): Promise<MirrorParityAllTypesResult> {
  const mappings = loadMirrorMappings(repoRoot);
  const fileExists = (relFilePath: string): boolean => existsSync(join(repoRoot, relFilePath));

  const perType = {} as Record<MirrorDocType, MirrorParityResult>;
  for (const type of MIRROR_TYPES) {
    const docsResult = await app.corpusService.listFull({ type });
    if (!docsResult.ok) {
      throw new SpecMirrorError("corpus_unreadable", `failed to list corpus ${type} docs: ${JSON.stringify(docsResult.error)}`, {
        error: docsResult.error,
        type,
      });
    }
    const docs = docsResult.value.docs.map((doc) => ({ id: doc.id, slug: doc.slug }));
    const fileCountOnDisk = countMdFilesFlat(join(repoRoot, mirrorDirRelative(type)));
    perType[type] = computeMirrorParity(docs, mappings, fileExists, fileCountOnDisk);
  }

  const ok = MIRROR_TYPES.every((type) => perType[type].ok);
  return { perType, ok };
}

/**
 * Idempotent, convergent export (D6/AC-FR-6, widened to all six types by AC-FR-10). Delegates
 * the actual corpus->markdown projection to the existing `ExportDocsService.exportDocs`
 * (SPEC-021) — this function adds nothing to that algorithm's WRITE logic beyond scoping each
 * call to one {@link MirrorDocType} at a time and this file's own `projectDir` (never `dbPath`'s
 * directory — see module header). It DOES add orphan pruning across EVERY mirrored directory
 * (see `export-spec-mirror-core.ts`'s "Orphan pruning") — without it, this would be idempotent
 * (stable additions) but never convergent (exact parity), which is what AC-FR-6/AC-FR-10
 * actually require. Re-derives parity via `runCheck` afterward so the returned verdict is
 * measured, never assumed from `report.errors.length === 0` alone.
 *
 * ⛔ Soft-deleted-doc orphans (measured 2026-08-11, task-unify-mirror-identifiers-on-zero-padded-
 * form-export-all; MAPPING side closed 2026-08-17, task-the-mirror-prune-does-not-retire-a-
 * mapping-whose-doc-was): a doc soft-deleted AFTER being mirrored used to keep BOTH a stale
 * `.lore/export-index.json` mapping AND its on-disk file forever — `ExportDocsService.exportDocs`'s
 * own reconcile logic only ever revisited docs in its `findMany({type})` result (`exclude_deleted:
 * true` by default), so a soft-deleted doc's mapping was invisible to it. That MAPPING half is now
 * fixed AT THE SOURCE: `exportDocs` (export-docs-service.ts) fetches a second, type-scoped
 * population INCLUDING soft-deleted docs and retires (deletes) any mapping whose doc resolves to
 * one of them, via `retireDeletedDocMappings` — the fresh `.lore/export-index.json` this function
 * reads below (`loadMirrorMappings`, after every type's `exportDocs()` call has returned) already
 * excludes that mapping, not merely this function's OWN `liveDocIds` intersection. The intersection
 * below is retained as a second, harmless line of defense (it also protects against a caller that
 * bypasses `exportDocs`'s own retirement, or a version skew between this script and the service),
 * but it is no longer the ONLY mechanism preventing the stale mapping from persisting — the FILE
 * side (a `.md` no longer referenced by any mapping) still relies on `pruneOrphanMirrorFiles`
 * below exactly as before. (Empirically: doc `01KWVPCJBKHPTBZQBPMXZK0B99`, a soft-deleted
 * `knowledge` assessment, kept BOTH its mapping and (until a prior prune run) its file — the
 * mapping alone survived in `.lore/export-index.json` for weeks after the file was gone, which is
 * the exact defect task-the-mirror-prune-does-not-retire-a-mapping-whose-doc-was fixes.)
 *
 * @throws {SpecMirrorError} `corpus_unreadable` if the underlying `exportDocs`/`listFull` call
 *   for ANY type fails outright (a store-level error, not a per-doc one — those land in that
 *   type's `report.errors` instead); propagates `loadMirrorMappings`'s / `runCheck`'s errors for
 *   the post-write reconcile + verification pass.
 */
export async function runExport(app: App, repoRoot: string = REPO_ROOT): Promise<MirrorExportResult> {
  const perType = {} as Record<MirrorDocType, MirrorExportReportLike>;
  for (const type of MIRROR_TYPES) {
    const exportResult = await app.exportDocsService.exportDocs({ projectDir: repoRoot, dryRun: false, type });
    if (!exportResult.ok) {
      throw new SpecMirrorError("corpus_unreadable", `export failed for type ${type}: ${JSON.stringify(exportResult.error)}`, {
        error: exportResult.error,
        type,
      });
    }
    perType[type] = exportResult.value;
  }

  // Live (non-deleted) doc-id set across every mirrored type — see the "soft-deleted-doc
  // orphans" note above (mapping side now retired at the SOURCE by `exportDocs` itself; this
  // is a second, defensive derivation for the FILE-pruning purpose below, not the only thing
  // standing between a soft-deleted doc and a stale mapping). Same default `exclude_deleted:
  // true` ExportDocsService itself uses, so this set is exactly "what SHOULD still be
  // mirrored", never a broader or narrower one.
  const liveDocIds = new Set<string>();
  for (const type of MIRROR_TYPES) {
    const docsResult = await app.corpusService.listFull({ type });
    if (!docsResult.ok) {
      throw new SpecMirrorError("corpus_unreadable", `failed to list corpus ${type} docs for orphan pruning: ${JSON.stringify(docsResult.error)}`, {
        error: docsResult.error,
        type,
      });
    }
    for (const doc of docsResult.value.docs) liveDocIds.add(doc.id);
  }

  // reason: exportDocs saves the index (Phase 1) BEFORE it writes any files (Phase 2) — see
  // ExportDocsService's own module header — so by the time every type's exportDocs() call has
  // returned, the index on disk already reflects every mapping change this run made. Re-reading
  // it here (rather than reusing a stale in-memory copy) is what makes pruning see the CURRENT
  // truth, across every type's directory in one pass.
  const freshMappings = loadMirrorMappings(repoRoot);
  const liveMappings = Object.fromEntries(
    Object.entries(freshMappings).filter(([docId]) => liveDocIds.has(docId)),
  );
  const pruned = pruneOrphanMirrorFiles(repoRoot, liveMappings, MIRROR_TYPES.map(mirrorDirRelative));

  const parity = await runCheck(app, repoRoot);
  return { perType, pruned, parity };
}

/**
 * CLI entrypoint: dispatches export vs. check mode from `argv`, runs it against a real `App`,
 * prints a report per type, and returns the process exit code. Never calls `process.exit` itself
 * (the `import.meta.main` block below is the only place that does), so this stays directly
 * callable from tests.
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
      let allOk = true;
      for (const type of MIRROR_TYPES) {
        if (!printParity("check", type, parity.perType[type])) allOk = false;
      }
      return allOk ? 0 : MIRROR_DRIFT_EXIT_CODE;
    }

    const { perType, pruned, parity } = await runExport(app, repoRoot);
    for (const type of MIRROR_TYPES) printExportReport(type, perType[type]);
    if (pruned.length > 0) {
      console.log(`export-spec-mirror: pruned ${pruned.length} orphaned file(s) (no longer mapped to any corpus doc, any mirrored type):`);
      for (const relPath of pruned) console.log(`  ${relPath}`);
    }
    let anyErrors = false;
    let allOk = true;
    for (const type of MIRROR_TYPES) {
      if (perType[type].errors.length > 0) anyErrors = true;
      if (!printParity("export", type, parity.perType[type])) allOk = false;
    }
    if (anyErrors) return MIRROR_HARD_FAILURE_EXIT_CODE;
    return allOk ? 0 : MIRROR_DRIFT_EXIT_CODE;
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
