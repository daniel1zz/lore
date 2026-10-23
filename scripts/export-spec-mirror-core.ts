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
 *   - `computeMirrorContentDrift` — PURE. Given a READ-ONLY (`dryRun: true`) `ExportDocsService`
 *     report plus the (id, slug) pairs and index mappings, translates that report's FILE PATHS
 *     into corpus SLUGS and classifies each as body-divergent or body-undecidable
 *     (AC-BFI-8). See "Body content IS compared, since 2026-08-17" below.
 *   - `printContentDrift` — IO (stdout/stderr). Presentation only, for the above.
 *   - `scriptChainReachesTarget` — PURE. Walks a `package.json` `scripts` map from a root script
 *     name through `bun|npm|npx|yarn run <name>` references (cycle-safe) to decide whether some
 *     script's value ultimately contains `targetSubstring` — the AC-FR-6 "wired, not merely
 *     present" oracle.
 *   - `loadMirrorMappings` — IO (fs read, no `bun:sqlite`). Loads + Zod-validates
 *     `.lore/export-index.json`.
 *   - `countMdFilesFlat` — IO (fs read). Non-recursive `.md` count under a directory.
 *   - `pruneOrphanMirrorFiles` — IO (fs write: `unlinkSync`), across an explicit, caller-supplied
 *     list of mirror directories (task-unify-mirror-identifiers-on-zero-padded-form-export-all,
 *     2026-08-11 — generalized from a single hardcoded spec-only sweep so a full six-type export
 *     prunes every type's orphans). See "Orphan pruning" below.
 *   - `MIRROR_TYPES` / `mirrorDirRelative` — the six doc types this mirror covers
 *     (`prd`/`spec`/`adr`/`knowledge`/`plan`/`task`, deliberately excluding `phase` — see
 *     `MIRROR_TYPES`'s own doc comment) and their repo-relative directories.
 *   - `printParity` / `printExportReport` — IO (stdout/stderr). Presentation only.
 *
 * ## Body content IS compared, since 2026-08-17 — but by a DIFFERENT function than parity
 *
 * `computeMirrorParity` below still answers COUNT + SLUG PRESENCE only, and its own doc comment
 * says so; that scope is unchanged. What changed (task-compare-mirror-bodies-against-corpus-
 * content-in-the-spec, AC-BFI-8) is that `export-spec-mirror.ts --check` now runs a SECOND,
 * independent probe alongside it — `runContentCheck` there, `computeMirrorContentDrift` here —
 * so the COMMAND compares bodies even though the parity FUNCTION does not. Both verdicts print;
 * either one failing exits {@link MIRROR_DRIFT_EXIT_CODE}.
 *
 * ⛔ The body comparison is NOT reimplemented here. `ExportDocsService.exportDocs`'s write loop
 * has always computed it (`extractBodyFromMd` + `canonicaliseBody` against the SAME resolved body
 * it would write — MDX placeholders spliced, SPEC-043 invalidation banner prepended, NUL bytes
 * sanitized), and a `dryRun: true` call reports that verdict in `report.drift` while writing
 * nothing. Reproducing any part of that pipeline here would give the check a second, silently
 * divergent notion of "matches the corpus" — the exact defect `ExportDocsService`'s own header
 * calls out ("the SAME resolveDocBody(doc) output is used for BOTH the drift comparison and the
 * on-write content"). This module therefore only TRANSLATES that report (file paths -> slugs) and
 * prints it.
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

/**
 * All six doc types this mirror covers (task-unify-mirror-identifiers-on-zero-padded-form-
 * export-all, 2026-08-11) — deliberately NOT every `DocType`: `phase` is excluded because
 * `ExportDocsService` itself documents export-docs support for phase docs as "a later task's
 * scope" (`TYPE_DIR`/`TYPE_PREFIX` in `export-docs-service.ts` carry a phase entry only as a
 * compile-forced registry completeness marker). Order here is the order every all-type loop
 * in this file and `export-spec-mirror.ts` iterates in — parents (prd) before their
 * descendants is a nice-to-have for log readability, never a correctness dependency (each
 * type's export/check is independent).
 */
export const MIRROR_TYPES = ["prd", "spec", "adr", "knowledge", "plan", "task"] as const;

/** The doc types {@link MIRROR_TYPES} covers. */
export type MirrorDocType = (typeof MIRROR_TYPES)[number];

/**
 * Repo-relative mirror directory for one doc type — identical to `ExportDocsService`'s own
 * `TYPE_DIR` mapping (`docs/requirements/<type>`, SPEC-021 §2.1); for all six {@link
 * MIRROR_TYPES} the directory segment is literally the type name (verified against
 * `export-docs-service.ts::TYPE_DIR`), so no lookup table is needed.
 */
export function mirrorDirRelative(type: MirrorDocType): string {
  return `docs/requirements/${type}`;
}

/** Documented non-zero exit code for "drift found" — see the IO shell's module header exit-code table. Exported so tests assert against this constant, never a bare literal. */
export const MIRROR_DRIFT_EXIT_CODE = 2;
/** Documented non-zero exit code for a hard failure (unreadable/corrupt index, corpus read failure, per-doc export error). */
export const MIRROR_HARD_FAILURE_EXIT_CODE = 4;
/**
 * Exit code for "the check compared fewer mirror files than the mapped-and-present population" —
 * in particular ZERO while that population is non-zero (AC-OX-6 positive trace). Distinct from 0
 * (clean), 2 (drift), 3 (usage, declared in `export-spec-mirror.ts`) and 4 (hard failure): the tool
 * was blind, which is neither "the mirror is stale" nor "the tool tried and failed to decide".
 */
export const MIRROR_ZERO_COMPARED_EXIT_CODE = 5;

/** Rule clause the zero-compared refusal ends with (consumer: exit {@link MIRROR_ZERO_COMPARED_EXIT_CODE} readers and tests). */
export const MIRROR_ZERO_COMPARED_RULE = "a check that parsed nothing proves nothing";

/** Per-slug detail `--check` prints when a mirror BODY diverges from the corpus document. */
export const MIRROR_BODY_DIVERGENT_DETAIL = "body differs from the corpus document";

/** Per-slug detail `--check` prints when an export-index mapping points at a file absent on disk. */
export const MIRROR_MAPPED_FILE_MISSING_DETAIL = "mapped file missing on disk";

/** The OK line (after the `export-spec-mirror (<label>): ` prefix) printed when count-and-slug parity holds for `type`. */
export function mirrorParityOkMessage(type: MirrorDocType): string {
  return `OK — every corpus ${type} has a mirror file (count and slug parity; file CONTENT is not compared).`;
}

/** The OK clause printed when every mirrored `type` body matches its corpus document. */
export function mirrorContentOkMessage(type: MirrorDocType): string {
  return `OK — every mirrored ${type} body matches its corpus document.`;
}

/**
 * Thrown when this script cannot even attempt a parity judgement — a hard failure distinct from
 * "corpus spec X is not mirrored" (that is data `computeMirrorParity` returns, never thrown).
 * Carries a machine-checkable `code` plus optional `context` (never a stringified-only message)
 * so a caller can distinguish failure classes without parsing prose.
 */
export class SpecMirrorError extends Error {
  constructor(
    public readonly code:
      | "corpus_unreadable"
      | "index_unreadable"
      | "index_invalid_json"
      | "index_invalid_schema"
      /** A drifted mirror file no corpus doc of its type owns — see {@link MirrorContentDriftResult.unresolvedFilePaths}. */
      | "content_unattributable",
    message: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "SpecMirrorError";
  }
}

/** One corpus doc whose mirror is not present on disk, named by its human-readable identity — never a bare ULID. Field/type names below stay spec-flavored (`MirrorParityMissing`/`corpusSpecCount`) for backward compatibility with this module's original spec-only scope and its existing pinned unit tests — `computeMirrorParity` itself is, and always was, type-agnostic: task-unify-mirror-identifiers-on-zero-padded-form-export-all's all-six-types orchestration calls it ONCE PER {@link MirrorDocType} (never widened to a multi-type shape), so a `spec`-labeled field holds a `plan`'s or `task`'s counts/misses exactly as well when the caller passes that type's docs. */
export interface MirrorParityMissing {
  readonly slug: string;
  /** `no_mapping` — the doc has never been exported (no `.lore/export-index.json` entry yet). `file_absent` — a mapping exists but the file it names does not. */
  readonly reason: "no_mapping" | "file_absent";
}

/** Full parity verdict for one `computeMirrorParity` call, for ONE doc type — the shared result shape both the IO shell's post-export verification and its read-only check return. */
export interface MirrorParityResult {
  readonly corpusSpecCount: number;
  readonly fileCountOnDisk: number;
  readonly missing: readonly MirrorParityMissing[];
  /** `true` iff `missing` is empty AND `fileCountOnDisk === corpusSpecCount` — an exact-count check independent of `missing`, so an ORPHAN file with no corresponding spec (inflating the on-disk count without leaving any spec unmirrored) is still detected as non-parity. */
  readonly ok: boolean;
}

/**
 * Decides mirror parity — PURE, no IO. `fileExists` is injected (mirrors
 * the ledger checkers' `pathExists` seam) so this is unit-testable
 * without touching disk.
 *
 * ⛔ NOT CHECKED BY THIS FUNCTION: file CONTENT. It verifies only (1) COUNT — `fileCountOnDisk ===
 * specs.length` — and (2) SLUG PRESENCE — every spec's mapped `file_path` exists on disk. It never
 * reads a mirror file's body, so a spec whose corpus content changed since its LAST export still
 * reports `ok: true` HERE. Every caller-facing string describing this function's "parity"/"OK"
 * (see `printParity`, and `export-spec-mirror.ts`'s own exit-code table) MUST name this same
 * count-and-slug-only scope — never say "matches the corpus" or "in sync" unqualified, which would
 * overclaim fidelity this function does not provide (measured incident 2026-08-10: the two
 * success/failure strings originally said "mirror matches the corpus exactly", which is untrue of
 * file content).
 *
 * ⛔ The COMMAND, however, DOES compare bodies as of 2026-08-17 — do not read the paragraph above
 * as "nothing checks content", which is what it meant until that date. `export-spec-mirror.ts`'s
 * `runContentCheck` + {@link computeMirrorContentDrift} are the second probe; see this module's
 * header section "Body content IS compared, since 2026-08-17". The prior justification for having
 * no content check ("content-diffing on every `bun run test` would be slow, and AC evidence
 * markers change often enough that a content check would be red almost permanently") was retired
 * by measurement, not by preference: a full six-type `dryRun: true` pass over the live corpus took
 * 4086 ms for 1511 docs and reported 0 drift / 0 identity_repaired / 0 frontmatter drift
 * (measured 2026-08-17, task-compare-mirror-bodies-against-corpus-content-in-the-spec), i.e. the
 * comparison is neither slow nor permanently red. What IS true is that the mirror must be
 * converged after a corpus write — `lore export-docs --force` for bodies — which is already
 * standing discipline (root CLAUDE.md).
 *
 * @param specs every corpus spec's (id, slug) pair — the FULL live set, never pre-filtered.
 * @param mappings the loaded `.lore/export-index.json` mappings, keyed by doc ULID.
 * @param fileExists injected existence probe, given a mapping's `file_path` (repo-relative).
 * @param fileCountOnDisk the REAL count of `.md` files under {@link SPEC_MIRROR_DIR_RELATIVE} —
 *   passed in (not recomputed here) so this function stays pure and the caller controls the walk.
 * @returns the full parity verdict (count + slug presence ONLY, never content) — never throws.
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
 * One corpus doc whose mirror file EXISTS (so {@link computeMirrorParity} is satisfied) but whose
 * body is not the corpus's current projection — named by slug, the identity a reader can act on.
 */
export interface MirrorContentDivergence {
  readonly slug: string;
  /** Repo-relative mirror path, from the doc's export-index mapping — a locator, never the identity. */
  readonly filePath: string;
  /**
   * `body_divergent` — the exporter's own body comparison said the on-disk body differs from the
   * corpus projection (`report.drift`). `body_undecidable` — the exporter never REACHED the body
   * comparison for this file because its identity frontmatter is stale and forces an unconditional
   * rewrite first (`report.identity_repaired`; see `ExportDocsService`'s write loop, which
   * `continue`s before comparing bodies). Reported as divergence rather than dropped: the body
   * question is genuinely unanswered for that file, and a check that printed OK over an unanswered
   * question would be exactly the vacuous pass AC-BFI-8 exists to forbid. `frontmatter_divergent` —
   * the body matches but a scalar frontmatter field (`status`/`priority`/`title`/`tags`/`phase`) is
   * stale (`report.frontmatter_repaired`, dry-run) or unreadable (`report.frontmatter_declined`);
   * AC-CRIT-5: a status-only drift is drift, so `--check` must exit 2 on it.
   */
  readonly reason: "body_divergent" | "body_undecidable" | "frontmatter_divergent";
}

/** Full body-comparison verdict for ONE {@link MirrorDocType}. */
export interface MirrorContentDriftResult {
  /** Sorted by slug — deterministic output, so two consecutive runs are byte-comparable (AC-BFI-8 (i)). */
  readonly divergences: readonly MirrorContentDivergence[];
  /**
   * Drifted paths the probe could NOT attribute to any corpus doc of this type — the export index
   * and the corpus disagree about which doc owns a file. ⛔ Deliberately NOT folded into {@link ok}:
   * this is a HARD failure (the caller raises {@link SpecMirrorError} `content_unattributable` ->
   * {@link MIRROR_HARD_FAILURE_EXIT_CODE}), never the drift exit code, so "the mirror is stale" and
   * "the tool cannot tell whose file this is" stay distinguishable.
   */
  readonly unresolvedFilePaths: readonly string[];
  /** `true` iff `divergences` is empty. Says nothing about {@link unresolvedFilePaths} — see there. */
  readonly ok: boolean;
  /**
   * AC-OX-6 positive trace: how many EXISTING mirror files the probe classified (clean, body drift,
   * stale identity, stale/undecidable frontmatter) — the count of files actually compared.
   */
  readonly comparedCount: number;
  /** Docs of this type whose export-index mapping exists and whose file is present (not reported `created` by the dry-run). The population {@link comparedCount} must equal. */
  readonly mappedPresentCount: number;
}

/**
 * Translates a READ-ONLY (`dryRun: true`) `ExportDocsService.exportDocs` report into slug-named
 * body divergences — PURE, no IO (AC-BFI-8).
 *
 * ⛔ This function does not COMPARE anything: `report` already carries the exporter's own verdict,
 * computed by the one pipeline that also writes the files. See this module's header section "Body
 * content IS compared, since 2026-08-17" for why re-deriving the comparison here would be a defect
 * rather than a convenience.
 *
 * A doc with NO index mapping is skipped rather than reported: it has no mirror file at all, which
 * is {@link computeMirrorParity}'s `no_mapping` finding, not a content question. Nothing is
 * silently dropped — every drifted path not claimed by some doc lands in `unresolvedFilePaths`.
 *
 * @param docs every corpus doc of ONE type as (id, slug) pairs — the same list `computeMirrorParity`
 *   receives, never pre-filtered.
 * @param mappings the loaded `.lore/export-index.json` mappings, keyed by doc ULID.
 * @param report the `dryRun: true` export report for that SAME type.
 * @returns the verdict; never throws.
 */
export function computeMirrorContentDrift(
  docs: readonly { readonly id: string; readonly slug: string }[],
  mappings: Readonly<Record<string, ExportIndexMapping>>,
  report: MirrorExportReportLike,
): MirrorContentDriftResult {
  const driftPaths = new Set(report.drift);
  const undecidablePaths = new Set(report.identity_repaired);
  const frontmatterPaths = new Set([...report.frontmatter_repaired, ...report.frontmatter_declined]);

  const divergences: MirrorContentDivergence[] = [];
  const attributed = new Set<string>();
  for (const doc of docs) {
    const filePath = mappings[doc.id]?.file_path;
    if (filePath === undefined) continue;
    const reason = driftPaths.has(filePath)
      ? "body_divergent"
      : undecidablePaths.has(filePath)
        ? "body_undecidable"
        : frontmatterPaths.has(filePath)
          ? "frontmatter_divergent"
          : undefined;
    if (reason === undefined) continue;
    divergences.push({ slug: doc.slug, filePath, reason });
    attributed.add(filePath);
  }
  divergences.sort((a, b) => a.slug.localeCompare(b.slug));

  const createdPaths = new Set(report.created);
  let mappedPresentCount = 0;
  for (const doc of docs) {
    const filePath = mappings[doc.id]?.file_path;
    if (filePath !== undefined && !createdPaths.has(filePath)) mappedPresentCount += 1;
  }
  const comparedCount =
    report.skipped_clean.length + report.drift.length + report.overwritten.length + driftlessCount(report);

  const unresolvedFilePaths = [...driftPaths, ...undecidablePaths, ...frontmatterPaths].filter((path) => !attributed.has(path)).sort();
  return { divergences, unresolvedFilePaths, ok: divergences.length === 0, comparedCount, mappedPresentCount };
}

/** Existing files the probe classified other than clean/drift/overwritten (those three are summed inline). */
function driftlessCount(report: MirrorExportReportLike): number {
  return report.identity_repaired.length + report.frontmatter_repaired.length + report.frontmatter_declined.length;
}

/**
 * AC-OX-6 positive-trace verdict for ONE type — PURE. A check that compared ZERO files while the
 * mapped-and-present population is non-zero is indistinguishable from a clean one (measured: 0
 * mismatches while parsing 0 of 1490 files), so it FAILS with {@link MIRROR_ZERO_COMPARED_EXIT_CODE}.
 * Any other shortfall (`comparedCount !== mappedPresentCount`) is the same blindness, partially.
 * Rule text is asserted by tests: "compared 0 of N mapped".
 */
export function evaluateComparedCount(
  type: MirrorDocType,
  result: Pick<MirrorContentDriftResult, "comparedCount" | "mappedPresentCount">,
): { readonly ok: true } | { readonly ok: false; readonly message: string } {
  const { comparedCount, mappedPresentCount } = result;
  if (comparedCount === mappedPresentCount) return { ok: true };
  const rule =
    comparedCount === 0
      ? `compared 0 of ${mappedPresentCount} mapped ${type} mirror file(s) — ${MIRROR_ZERO_COMPARED_RULE}`
      : `compared ${comparedCount} of ${mappedPresentCount} mapped ${type} mirror file(s) — the compared count must equal the mapped-and-present population`;
  return { ok: false, message: `export-spec-mirror (content): ${rule}` };
}

/**
 * Prints one type's body-comparison verdict, NAMING every divergent slug (AC-BFI-8) — IO
 * (stdout/stderr), presentation only.
 *
 * The remediation named on failure is `bun run mirror:export`: since F3 (AC-CRIT-4) the mirror
 * script treats its directories as a projection and passes `force: true` to the exporter, so it
 * rewrites a changed body. `lore export-docs` without `--force` still leaves a changed body alone
 * (SPEC-021 Amendment A2), which is why it is not the command named here.
 *
 * @returns `true` iff this type's bodies all match (mirrors `result.ok`, so a caller aggregating
 *   across {@link MIRROR_TYPES} does not re-derive it). ⛔ Says nothing about
 *   `result.unresolvedFilePaths` — the caller must raise that separately as a hard failure.
 */
export function printContentDrift(type: MirrorDocType, result: MirrorContentDriftResult): boolean {
  if (result.ok) {
    console.log(
      `export-spec-mirror (content): ${mirrorContentOkMessage(type)} (compared ${result.comparedCount} ${type} file(s); ${result.mappedPresentCount} mapped-and-present)`,
    );
    return true;
  }
  console.error(
    `\nexport-spec-mirror (content): ${result.divergences.length} corpus ${type}(s) whose mirror body no longer matches the corpus:\n`,
  );
  for (const entry of result.divergences) {
    const detail =
      entry.reason === "body_divergent"
        ? MIRROR_BODY_DIVERGENT_DETAIL
        : entry.reason === "body_undecidable"
          ? "body not comparable — stale identity frontmatter pre-empts the body check"
          : "frontmatter (status/priority/title/tags/phase) differs from the corpus document";
    console.error(`  ${entry.slug} — ${detail} (${entry.filePath})`);
  }
  console.error(`\nRun \`bun run mirror:export\` to reconcile ${mirrorDirRelative(type)} with the corpus.`);
  return false;
}

/** One live corpus doc claiming a `human_id` another live doc also claims. */
export interface MirrorHumanIdClaimant {
  readonly id: string;
  readonly slug: string;
  /** Repo-relative mirror path from the doc's export-index mapping. */
  readonly filePath: string;
}

/** A `human_id` mapped to two or more LIVE docs (task-skill-implement-r0-6, AC-R0-5). */
export interface MirrorHumanIdDuplicate {
  readonly humanId: string;
  /** Sorted by doc id — deterministic output. */
  readonly claimants: readonly MirrorHumanIdClaimant[];
}

/**
 * PURE. Finds every `human_id` that the export index maps to two or more LIVE docs. A mapping whose
 * doc is not in `liveDocs` (soft-deleted / inert reservation) never counts — only a live collision
 * can mis-identify a mirror file. `computeMirrorParity` cannot see this: both docs have a mapping and
 * a file, so count + slug parity is satisfied while one human_id names two documents.
 */
export function findDuplicateHumanIds(
  liveDocs: readonly { id: string; slug: string }[],
  mappings: Readonly<Record<string, ExportIndexMapping>>,
): MirrorHumanIdDuplicate[] {
  const byHumanId = new Map<string, MirrorHumanIdClaimant[]>();
  for (const doc of liveDocs) {
    const mapping = mappings[doc.id];
    if (mapping === undefined) continue;
    const list = byHumanId.get(mapping.human_id) ?? [];
    list.push({ id: doc.id, slug: doc.slug, filePath: mapping.file_path });
    byHumanId.set(mapping.human_id, list);
  }
  return [...byHumanId.entries()]
    .filter(([, claimants]) => claimants.length > 1)
    .map(([humanId, claimants]) => ({ humanId, claimants: [...claimants].sort((a, b) => a.id.localeCompare(b.id)) }))
    .sort((a, b) => a.humanId.localeCompare(b.humanId));
}

/** Prints the duplicate-human_id verdict (one line when clean; one block per duplicate). Returns `true` iff none. */
export function printDuplicateHumanIds(duplicates: readonly MirrorHumanIdDuplicate[]): boolean {
  if (duplicates.length === 0) {
    console.log("export-spec-mirror (check): OK — no human_id is mapped to more than one live corpus doc.");
    return true;
  }
  console.log(`export-spec-mirror (check): ${duplicates.length} human_id(s) mapped to more than one live corpus doc:`);
  for (const dup of duplicates) {
    console.log(`  ${dup.humanId}:`);
    for (const c of dup.claimants) console.log(`    ${c.id} (${c.slug}) -> ${c.filePath}`);
  }
  console.log("Run `bun run mirror:export` — the exporter renumbers the later doc(s) and prunes the stale file.");
  return false;
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
 * Removes any `.md` file under one of `dirRelativePaths` that `mappings` (the FRESH,
 * post-export index) no longer points to — see module header "Orphan pruning". Never touches a
 * file still referenced by a current mapping, and never touches anything outside the given
 * directories (task-unify-mirror-identifiers-on-zero-padded-form-export-all, 2026-08-11 —
 * generalized from a single hardcoded {@link SPEC_MIRROR_DIR_RELATIVE} sweep to an explicit,
 * caller-supplied list so a full six-type export prunes every type's orphans, not just spec's;
 * the caller passes `MIRROR_TYPES.map(mirrorDirRelative)` for "every mirrored type" — no silent
 * default here, so a caller can never accidentally skip a type by omitting the argument).
 *
 * @param repoRoot repo root the relative paths are resolved against.
 * @param mappings the fresh `.lore/export-index.json` mappings (ALL types) — filtered internally
 *   to those under one of `dirRelativePaths`.
 * @param dirRelativePaths every mirror directory to sweep (repo-relative, e.g.
 *   `["docs/requirements/spec", "docs/requirements/plan"]`).
 * @returns repo-relative paths actually deleted this run (empty array, never omitted, when there
 *   was nothing to prune).
 */
export function pruneOrphanMirrorFiles(
  repoRoot: string,
  mappings: Readonly<Record<string, ExportIndexMapping>>,
  dirRelativePaths: readonly string[],
): string[] {
  const expected = new Set<string>();
  for (const mapping of Object.values(mappings)) {
    expected.add(mapping.file_path);
  }

  const removed: string[] = [];
  for (const dirRelativePath of dirRelativePaths) {
    const dirAbs = join(repoRoot, dirRelativePath);
    if (!existsSync(dirAbs)) continue;

    for (const entry of readdirSync(dirAbs, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const relPath = `${dirRelativePath}/${entry.name}`;
      if (expected.has(relPath)) continue;
      unlinkSync(join(repoRoot, relPath));
      removed.push(relPath);
    }
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
 * @param rootScriptName the entry point to start the walk from (e.g. `"test"` — the chain
 *   `check:spec-mirror` is wired into, per this task's own D6 revision; NOT `"build"`, which was
 *   reverted because it made a routine post-merge verification step rewrite the mirror on disk).
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

/** Shape `printExportReport` needs from `ExportDocsService.exportDocs`'s report — a local structural subset (never re-declared as a duplicate DTO) so THIS file avoids importing `export-docs-service.ts` at all. `identity_repaired` added task-unify-mirror-identifiers-on-zero-padded-form-export-all (2026-08-11) — see `ExportReport.identity_repaired`'s own doc comment in `export-docs-service.ts` for the full mechanism (a stale mirror frontmatter `id:` refreshed unconditionally, independent of the body-only drift check). */
export interface MirrorExportReportLike {
  readonly created: readonly string[];
  readonly skipped_clean: readonly string[];
  readonly drift: readonly string[];
  readonly overwritten: readonly string[];
  readonly errors: readonly string[];
  readonly identity_repaired: readonly string[];
  /** Dry-run: files whose scalar frontmatter is stale though the body matches (AC-CRIT-5). */
  readonly frontmatter_repaired: readonly string[];
  /** Files whose scalar frontmatter staleness could not be repaired or decided (AC-CRIT-5). */
  readonly frontmatter_declined: readonly string[];
}

/**
 * Prints a human-readable parity report for ONE {@link MirrorDocType} — the count summary line
 * always, plus one line per missing doc (naming its slug) when `missing` is non-empty, plus a
 * remediation hint whenever `!parity.ok` (covers BOTH the named-missing case and the "orphan
 * inflated the count with nothing named" case).
 *
 * Message text is parametrized by `type` (task-unify-mirror-identifiers-on-zero-padded-form-
 * export-all, 2026-08-11 — generalized from a spec-only hardcoded label): for `type: "spec"`
 * this produces the BYTE-IDENTICAL strings this file always printed ("corpus spec(s)", "every
 * corpus spec has a mirror file") — the existing AC-FR-6/AC-FR-7 e2e tests assert those exact
 * substrings and are deliberately left unchanged.
 *
 * ⛔ The OK line's "file CONTENT is not compared" parenthetical is scoped to THIS verdict and is
 * still literally true of {@link computeMirrorParity}. It is NOT a statement about the command:
 * since 2026-08-17 `--check` also prints {@link printContentDrift}'s own verdict line, immediately
 * after this one, and body divergence there fails the run. The parenthetical is pinned byte-for-byte
 * by three `toContain` assertions in `scripts/tests/spec-mirror-export.test.ts` (~lines 570/632/636)
 * plus a header note in `packages/lore/tests/integration/mirror-check-read-only.bun.test.ts`, none
 * of which were in scope for the task that armed the content check — rewording it to name the
 * command-level scope means updating those call sites in the SAME change, never this string alone.
 *
 * @returns `true` when this type's parity is OK (mirrors `parity.ok`, so a caller aggregating
 *   across {@link MIRROR_TYPES} doesn't need to re-derive it) and prints the type's own
 *   "OK — every corpus {type} has a mirror file..." line; `false` prints the drift lines above
 *   instead and returns without an OK line.
 */
export function printParity(label: "export" | "check", type: MirrorDocType, parity: MirrorParityResult): boolean {
  const dirRelative = mirrorDirRelative(type);
  console.log(
    `export-spec-mirror (${label}): ${parity.fileCountOnDisk} file(s) on disk under ${dirRelative}, ${parity.corpusSpecCount} live corpus ${type}(s).`,
  );
  if (parity.missing.length > 0) {
    console.error(
      `\nexport-spec-mirror (${label}): ${parity.missing.length} corpus ${type}(s) not mirrored on disk:\n`,
    );
    for (const entry of parity.missing) {
      const detail = entry.reason === "no_mapping" ? "never exported (no export-index mapping)" : MIRROR_MAPPED_FILE_MISSING_DETAIL;
      console.error(`  ${entry.slug} — ${detail}`);
    }
  }
  if (!parity.ok) {
    console.error(`\nRun \`bun run mirror:export\` to reconcile ${dirRelative} with the corpus.`);
    return false;
  }
  console.log(
    `export-spec-mirror (${label}): ${mirrorParityOkMessage(type)}`,
  );
  return true;
}

/**
 * Prints the underlying `ExportDocsService.exportDocs` report's per-bucket counts plus every
 * per-doc error message, labeled by `type` (task-unify-mirror-identifiers-on-zero-padded-form-
 * export-all, 2026-08-11 — one call per {@link MirrorDocType}, since a six-type export runs
 * `exportDocs` once per type rather than once for the whole corpus).
 */
export function printExportReport(type: MirrorDocType, report: MirrorExportReportLike): void {
  console.log(
    `export-spec-mirror (${type}): created ${report.created.length}, skipped_clean ${report.skipped_clean.length}, ` +
      `drift ${report.drift.length}, overwritten ${report.overwritten.length}, ` +
      `identity_repaired ${report.identity_repaired.length}, errors ${report.errors.length}.`,
  );
  if (report.identity_repaired.length > 0) {
    console.log(`  identity_repaired (stale frontmatter id: refreshed — see ExportDocsService's own doc comment):`);
    for (const path of report.identity_repaired) console.log(`    ${path}`);
  }
  for (const errMsg of report.errors) console.error(`  error: ${errMsg}`);
}
