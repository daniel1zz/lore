/**
 * Pure/fs-only half of the spec-mirror export + drift check —
 * `spec-falsifiability-reachability-a-feedable-checkpoint-an` D6, AC-FR-6/AC-FR-7 (G5).
 *
 * Split out of `export-spec-mirror.ts` for the SAME reason `check-ac-ref-integrity-core.ts` is
 * split out of `check-ac-ref-integrity.ts` (see that module's own header): the sibling IO-shell
 * file imports `createApp` (`packages/lore/src/app.ts`), which top-level-imports `bun:sqlite` —
 * unresolvable inside a vitest worker even behind a lazy `await import(...)`. THIS module imports
 * only `node:fs`/`node:path` and `@lore/core` (browser-safe, no `bun:sqlite` anywhere in ITS
 * import graph), so `scripts/tests/spec-mirror-export.test.ts` (a vitest-run `.test.ts` file) can
 * unit-test `computeMirrorParity` / `scriptChainReachesTarget` / the ledger-style index loader
 * directly, without ever touching a real corpus DB.
 *
 * Public surface:
 *   - `computeMirrorParity` — PURE. Given the corpus's (id, slug) pairs, the loaded export-index
 *     mappings, an injected `fileExists` probe, and the real on-disk file count, decides parity.
 *   - `scriptChainReachesTarget` — PURE. Walks a `package.json` `scripts` map from a root script
 *     name through `bun|npm|npx|yarn run <name>` references (cycle-safe) to decide whether some
 *     script's value ultimately contains `targetSubstring` — the AC-FR-6 "wired, not merely
 *     present" oracle.
 *   - `loadMirrorMappings` — IO (fs read, no `bun:sqlite`). Loads + Zod-validates
 *     `.lore/export-index.json`.
 *   - `countMdFilesFlat` — IO (fs read). Non-recursive `.md` count under a directory.
 *   - `pruneOrphanMirrorFiles` — IO (fs write: `unlinkSync`). See "Orphan pruning" below.
 *   - `printParity` / `printExportReport` — IO (stdout/stderr). Presentation only.
 *
 * ## Orphan pruning — why this exists at all
 *
 * `ExportDocsService` never deletes a file it once wrote (documented on its own
 * `reconcileOrdinalMappings` / `repairCollisions`: a stale mapping is dropped from the INDEX so a
 * fresh file gets written at the corrected path, but the old file is "left on disk" — deliberate,
 * since that service spans every doc type and a destructive default would be too broad a
 * hammer). Measured empirically running this task's own exporter against the live corpus
 * (2026-08-10): the FIRST real run created 131 files (spec docs never yet mapped) but ALSO left
 * 89 pre-existing files orphaned — almost entirely legacy unpadded `SPEC-<n>-*.md` names
 * (`SPEC-1-*`, `SPEC-10-*`, ...) superseded by SPEC-084's zero-padded, ordinal-derived
 * `SPEC-0<nnn>-*.md` names once `lore migrate ordinals` backfilled those docs' `ordinal` column.
 * Net effect without pruning: 231 files for 142 corpus specs — AC-FR-6's exact-count assertion
 * would NEVER pass, regardless of how idempotent the underlying export algorithm is, because
 * "idempotent" (same input -> same additions) is a different property from "convergent"
 * (eventually exactly matches the corpus). `pruneOrphanMirrorFiles` (called only from the IO
 * shell's `runExport`, never from `runCheck`) removes any `.md` file under
 * {@link SPEC_MIRROR_DIR_RELATIVE} that the FRESH (post-export) `.lore/export-index.json` no
 * longer maps to — safe because this directory is a wholly regenerable projection of the corpus
 * (the SSOT), never hand-authored content.
 *
 * Side-effect class: `computeMirrorParity` and `scriptChainReachesTarget` are pure (no IO).
 * `loadMirrorMappings` and `countMdFilesFlat` read the filesystem only. `pruneOrphanMirrorFiles`
 * deletes files (never creates or modifies one). `printParity`/`printExportReport` write to
 * stdout/stderr only.
 */

import { existsSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { exportIndexSchema, type ExportIndexMapping } from "@lore/core";

/** Repo-relative path this script exports to / checks against — matches `ExportDocsService`'s `spec` type directory (SPEC-021 §2.1). */
export const SPEC_MIRROR_DIR_RELATIVE = "docs/requirements/spec";
/** Repo-relative path to the git-tracked export index (SPEC-021 §9.3) — read by both modes, written only by `ExportDocsService.exportDocs` (never by this file directly). */
export const EXPORT_INDEX_RELATIVE = ".lore/export-index.json";

/** Documented non-zero exit code for "drift found" — see the IO shell's module header exit-code table. Exported so tests assert against this constant, never a bare literal. */
export const MIRROR_DRIFT_EXIT_CODE = 2;
/** Documented non-zero exit code for a hard failure (unreadable/corrupt index, corpus read failure, per-doc export error). */
export const MIRROR_HARD_FAILURE_EXIT_CODE = 4;

/**
 * Thrown when this script cannot even attempt a parity judgement — a hard failure distinct from
 * "corpus spec X is not mirrored" (that is data `computeMirrorParity` returns, never thrown).
 * Carries a machine-checkable `code` plus optional `context` (never a stringified-only message)
 * so a caller can distinguish failure classes without parsing prose.
 */
export class SpecMirrorError extends Error {
  constructor(
    public readonly code: "corpus_unreadable" | "index_unreadable" | "index_invalid_json" | "index_invalid_schema",
    message: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "SpecMirrorError";
  }
}

/** One corpus spec whose mirror is not present on disk, named by its human-readable identity — never a bare ULID. */
export interface MirrorParityMissing {
  readonly slug: string;
  /** `no_mapping` — the spec has never been exported (no `.lore/export-index.json` entry yet). `file_absent` — a mapping exists but the file it names does not. */
  readonly reason: "no_mapping" | "file_absent";
}

/** Full parity verdict for one `computeMirrorParity` call — the shared result shape both the IO shell's post-export verification and its read-only check return. */
export interface MirrorParityResult {
  readonly corpusSpecCount: number;
  readonly fileCountOnDisk: number;
  readonly missing: readonly MirrorParityMissing[];
  /** `true` iff `missing` is empty AND `fileCountOnDisk === corpusSpecCount` — an exact-count check independent of `missing`, so an ORPHAN file with no corresponding spec (inflating the on-disk count without leaving any spec unmirrored) is still detected as non-parity. */
  readonly ok: boolean;
}

/**
 * Decides mirror parity — PURE, no IO. `fileExists` is injected (mirrors
 * `scripts/check-test-budgets.ts`'s `checkLedger(..., pathExists)` seam) so this is unit-testable
 * without touching disk.
 *
 * @param specs every corpus spec's (id, slug) pair — the FULL live set, never pre-filtered.
 * @param mappings the loaded `.lore/export-index.json` mappings, keyed by doc ULID.
 * @param fileExists injected existence probe, given a mapping's `file_path` (repo-relative).
 * @param fileCountOnDisk the REAL count of `.md` files under {@link SPEC_MIRROR_DIR_RELATIVE} —
 *   passed in (not recomputed here) so this function stays pure and the caller controls the walk.
 * @returns the full parity verdict — never throws.
 */
export function computeMirrorParity(
  specs: readonly { readonly id: string; readonly slug: string }[],
  mappings: Readonly<Record<string, ExportIndexMapping>>,
  fileExists: (relFilePath: string) => boolean,
  fileCountOnDisk: number,
): MirrorParityResult {
  const missing: MirrorParityMissing[] = [];
  for (const spec of specs) {
    const mapping = mappings[spec.id];
    if (mapping === undefined) {
      missing.push({ slug: spec.slug, reason: "no_mapping" });
      continue;
    }
    if (!fileExists(mapping.file_path)) {
      missing.push({ slug: spec.slug, reason: "file_absent" });
    }
  }
  const ok = missing.length === 0 && fileCountOnDisk === specs.length;
  return { corpusSpecCount: specs.length, fileCountOnDisk, missing, ok };
}

/**
 * Loads and Zod-validates `.lore/export-index.json` from `repoRoot`. A MISSING file is treated as
 * "nothing exported yet" (`{}` — legitimate for a virgin checkout, never an error); a PRESENT but
 * unreadable/malformed/schema-invalid file is a hard failure (fail-loud on corruption, never a
 * silent empty-map fallback that would misreport every spec as `no_mapping`).
 *
 * @throws {SpecMirrorError} `index_unreadable` / `index_invalid_json` / `index_invalid_schema`.
 */
export function loadMirrorMappings(repoRoot: string): Record<string, ExportIndexMapping> {
  const indexPath = join(repoRoot, EXPORT_INDEX_RELATIVE);
  if (!existsSync(indexPath)) return {};

  let raw: string;
  try {
    raw = readFileSync(indexPath, "utf8");
  } catch (e) {
    throw new SpecMirrorError(
      "index_unreadable",
      `cannot read ${EXPORT_INDEX_RELATIVE}: ${e instanceof Error ? e.message : String(e)}`,
      { path: indexPath },
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new SpecMirrorError(
      "index_invalid_json",
      `${EXPORT_INDEX_RELATIVE} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const parsed = exportIndexSchema.safeParse(json);
  if (!parsed.success) {
    throw new SpecMirrorError(
      "index_invalid_schema",
      `${EXPORT_INDEX_RELATIVE} failed schema validation: ${parsed.error.message}`,
      { issues: parsed.error.issues },
    );
  }
  return parsed.data.mappings;
}

/** Non-recursive `.md` file count under `dirPath` — {@link SPEC_MIRROR_DIR_RELATIVE} is flat (verified 2026-08-10: 0 subdirectories, 0 non-`.md` entries). A missing directory counts as 0, never an error (a virgin checkout has none yet). */
export function countMdFilesFlat(dirPath: string): number {
  if (!existsSync(dirPath)) return 0;
  return readdirSync(dirPath, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".md")).length;
}

/**
 * Removes any `.md` file under {@link SPEC_MIRROR_DIR_RELATIVE} that `mappings` (the FRESH,
 * post-export index) no longer points to — see module header "Orphan pruning". Never touches a
 * file still referenced by a current mapping, and never touches anything outside the spec mirror
 * directory (other doc types' orphans, if any, are out of this file's scope).
 *
 * @param repoRoot repo root the relative paths are resolved against.
 * @param mappings the fresh `.lore/export-index.json` mappings (ALL types) — filtered internally
 *   to those under {@link SPEC_MIRROR_DIR_RELATIVE}.
 * @returns repo-relative paths actually deleted this run (empty array, never omitted, when there
 *   was nothing to prune).
 */
export function pruneOrphanMirrorFiles(repoRoot: string, mappings: Readonly<Record<string, ExportIndexMapping>>): string[] {
  const specDir = join(repoRoot, SPEC_MIRROR_DIR_RELATIVE);
  if (!existsSync(specDir)) return [];

  const expected = new Set<string>();
  for (const mapping of Object.values(mappings)) {
    if (mapping.file_path.startsWith(`${SPEC_MIRROR_DIR_RELATIVE}/`)) expected.add(mapping.file_path);
  }

  const removed: string[] = [];
  for (const entry of readdirSync(specDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const relPath = `${SPEC_MIRROR_DIR_RELATIVE}/${entry.name}`;
    if (expected.has(relPath)) continue;
    unlinkSync(join(repoRoot, relPath));
    removed.push(relPath);
  }
  return removed;
}

/** Matches `bun run <name>`, `npm run <name>`, `npx run <name>`, `yarn run <name>` inside a package.json script VALUE — the only indirection `scriptChainReachesTarget` follows. */
const SCRIPT_REF_RE = /\b(?:bun|npm|npx|yarn)\s+run\s+([A-Za-z0-9:_-]+)/g;

/**
 * PURE `package.json` script-chain reachability walk (AC-FR-6 "wired, not merely present").
 * Starting from `scripts[rootScriptName]`'s value, returns `true` iff that value itself contains
 * `targetSubstring`, OR any `bun|npm|npx|yarn run <name>` reference inside it recursively reaches
 * a script whose value contains `targetSubstring`. Cycle-safe via `visited` (a script chain that
 * refers back to an ancestor returns `false` for that branch rather than looping forever).
 *
 * A standalone script entry that nothing else's chain ever references (this repo's own prior
 * pattern for every `check:*` entry in `package.json` — see `scripts/tests/check-ac-ref-integrity.test.ts`'s
 * "no CI exists ... had no caller at all") is correctly reported `false` here even though
 * `scripts[targetSubstring-named-entry]` exists, because existing is not the same question as
 * being REACHED from `rootScriptName`.
 *
 * @param scripts the raw `package.json` `"scripts"` map (script name -> shell command string).
 * @param rootScriptName the entry point to start the walk from (e.g. `"build"`).
 * @param targetSubstring the literal substring identifying the target script's own invocation
 *   (e.g. a file path like `"export-spec-mirror.ts"`, or an npm script name it's invoked by).
 * @param visited internal cycle guard — callers never need to pass this.
 */
export function scriptChainReachesTarget(
  scripts: Readonly<Record<string, string>>,
  rootScriptName: string,
  targetSubstring: string,
  visited: Set<string> = new Set(),
): boolean {
  if (visited.has(rootScriptName)) return false;
  visited.add(rootScriptName);

  const value = scripts[rootScriptName];
  if (value === undefined) return false;
  if (value.includes(targetSubstring)) return true;

  SCRIPT_REF_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SCRIPT_REF_RE.exec(value)) !== null) {
    const refName = match[1]!;
    if (scriptChainReachesTarget(scripts, refName, targetSubstring, visited)) return true;
  }
  return false;
}

/** Shape `printExportReport` needs from `ExportDocsService.exportDocs`'s report — a local structural subset (never re-declared as a duplicate DTO) so THIS file avoids importing `export-docs-service.ts` at all. */
export interface MirrorExportReportLike {
  readonly created: readonly string[];
  readonly skipped_clean: readonly string[];
  readonly drift: readonly string[];
  readonly overwritten: readonly string[];
  readonly errors: readonly string[];
}

/** Prints a human-readable parity report — the count summary line always, plus one line per missing spec (naming its slug) when `missing` is non-empty, plus a remediation hint whenever `!parity.ok` (covers BOTH the named-missing case and the "orphan inflated the count with nothing named" case). */
export function printParity(label: "export" | "check", parity: MirrorParityResult): void {
  console.log(
    `export-spec-mirror (${label}): ${parity.fileCountOnDisk} file(s) on disk under ${SPEC_MIRROR_DIR_RELATIVE}, ${parity.corpusSpecCount} live corpus spec(s).`,
  );
  if (parity.missing.length > 0) {
    console.error(
      `\nexport-spec-mirror (${label}): ${parity.missing.length} corpus spec(s) not mirrored on disk:\n`,
    );
    for (const entry of parity.missing) {
      const detail = entry.reason === "no_mapping" ? "never exported (no export-index mapping)" : "mapped file missing on disk";
      console.error(`  ${entry.slug} — ${detail}`);
    }
  }
  if (!parity.ok) {
    console.error(`\nRun \`bun run mirror:export\` to reconcile ${SPEC_MIRROR_DIR_RELATIVE} with the corpus.`);
  }
}

/** Prints the underlying `ExportDocsService.exportDocs` report's per-bucket counts plus every per-doc error message. */
export function printExportReport(report: MirrorExportReportLike): void {
  console.log(
    `export-spec-mirror: created ${report.created.length}, skipped_clean ${report.skipped_clean.length}, ` +
      `drift ${report.drift.length}, overwritten ${report.overwritten.length}, errors ${report.errors.length}.`,
  );
  for (const errMsg of report.errors) console.error(`  error: ${errMsg}`);
}
