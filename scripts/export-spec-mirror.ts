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
 *     same service) does — one shared mechanism, not a duplicated one.
 *
 *     F3 (spec-close-the-eight-verified-critical-defects-no-judge-listing, AC-CRIT-4): the mirror
 *     directories are a PROJECTION of the corpus, so `runExport` ALSO passes `force: true` to
 *     `ExportDocsOptions` — a changed spec or knowledge body is rewritten by `bun run mirror:export`
 *     with no flags, and `--check` then exits 0. ⛔ This is scoped to THIS script: `lore export-docs`
 *     keeps SPEC-021 Amendment A2 (a changed body is overwritten only with its own `--force`).
 *   - `bun run check:spec-mirror` (`--check` flag, this file's other mode) — READ-ONLY: never
 *     writes a byte. A run that finds drift reports the SAME drift on every subsequent run until
 *     something else (a real export) fixes it — see D6's own text: "a check that regenerates what
 *     it is checking can never fail." THIS is the mode wired into the
 *     `test` script chain (`package.json`) — see AC-FR-6's own oracle
 *     (`scripts/tests/spec-mirror-export.test.ts`), which asserts the chain reaches THIS FILE
 *     (`export-spec-mirror.ts`, the script AC-FR-6 names), never a specific mode-flag string —
 *     `check:spec-mirror` invokes this exact file, so the criterion holds while the wired command
 *     stays read-only.
 *
 *     ⛔ "Never calls `exportDocs`" was true of this mode until 2026-08-17 and is now HALF true —
 *     a prior version of this bullet stated it flatly. `runCheck` (count + slug parity) still
 *     never calls it. `runContentCheck` (bodies, AC-BFI-8, task-compare-mirror-bodies-against-
 *     corpus-content-in-the-spec) DOES, with `dryRun: true` and never `force` — the read-only
 *     shape in which that method reports its body verdict without writing. The reason is SSOT, not
 *     convenience: the body comparison belongs to the pipeline that writes the files, and a second
 *     copy here would drift from it silently. See `runContentCheck`'s own doc comment for the
 *     enumerated write-guard audit and the two oracles that pin the read-only property.
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
 * `findLoreDbPath({ cwd: process.cwd(), env: process.env })` (this repo's shared DB-discovery helper) falls back to the MAIN checkout's
 * `.lore/lore.db` whenever the caller's cwd sits inside a LINKED git worktree with no local DB of
 * its own (worktree dispatch never copies the gitignored `.lore/lore.db` — SPEC M4). The existing
 * `lore export-docs` CLI command derives its write target (`projectDir`) from `dirname(dirname(dbPath))`
 * — so run from inside a linked worktree, it would silently write generated files into the MAIN
 * checkout's working tree, not the worktree that invoked it. This script instead computes its own
 * `REPO_ROOT` from `import.meta.url` — wherever THIS FILE is checked out is where its output goes —
 * decoupling "which corpus DB answers reads" (shared, cross-worktree, via `findLoreDbPath({ cwd: process.cwd(), env: process.env })`) from
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
 *   - `runCheck` — IO, READ-ONLY. Count + slug parity only; never calls `exportDocs`.
 *   - `runContentCheck` — IO, READ-ONLY. BODY comparison (AC-BFI-8) via a `dryRun: true`
 *     `exportDocs` probe; writes nothing. Called from `main`'s check mode only, never from
 *     `runExport` — so `bun run mirror:export`'s behaviour and exit codes are unchanged by it.
 *   - `parseMirrorArgv` — PURE. The WHOLE argv contract in one function: `--check` and
 *     `--type <t>` are recognised, every other token is REFUSED. ⛔ It replaces an
 *     `argv.includes("--check")` that read nothing else, under which
 *     `--check --type prd --definitely-not-a-flag` scanned all six types and printed no refusal at
 *     all (measured 2026-08-25) — the defect class of
 *     `knowledge-a-dry-run-flag-that-does-not-exist-writes-the-files`, where a flag that does not
 *     exist is accepted and the command proceeds to do the opposite of what the caller asked.
 *   - `main` — IO. Parses argv FIRST — a usage error returns {@link MIRROR_USAGE_EXIT_CODE} before
 *     the corpus is even opened — then dispatches export vs. check over the SELECTED types; never
 *     calls `process.exit` itself.
 *   - ⛔ `runCheck` / `runContentCheck` / `runExport` each take the type selection as an EXPLICIT
 *     third parameter defaulting to every {@link MIRROR_TYPES} entry. A narrowed selection changes
 *     WHICH types are scanned and nothing else: within a scanned type the verdict is bit-for-bit
 *     the one a full run reports, which is what
 *     `scripts/tests/export-spec-mirror-type-scope.test.ts` asserts by comparing the narrow and
 *     full runs on the SAME seeded drift.
 *   - Everything under "Pure/fs-only surface" below is re-exported from `export-spec-mirror-core.js`
 *     for callers that only need one import site.
 *
 * Side-effect class: `runCheck` reads the corpus (via the injected `App`) and the filesystem
 * (index + `.md` listing per type), never writes. `runExport` writes generated `.md` files and
 * `.lore/export-index.json` (both git-tracked deliverables — expected to be committed, per this
 * task's own scope note). `main` also writes to stdout/stderr.
 *
 * Exit codes (⛔ the word "parity" below means COUNT + SLUG PRESENCE ONLY — see
 * `computeMirrorParity`'s own doc comment in `export-spec-mirror-core.ts` for why that FUNCTION's
 * scope is deliberate, and for the caller-facing wording every parity "OK" message must match.
 * Body content is a SEPARATE verdict, `runContentCheck`, in check mode only):
 *   0 — clean. Export mode: 0 per-doc export errors across EVERY type AND parity for every type.
 *       Check mode: parity for all six types AND every mirrored body matches its corpus document.
 *   {@link MIRROR_DRIFT_EXIT_CODE} (2) — check mode found, for any mirrored type, >=1 corpus doc
 *       not mirrored on disk (never exported, or its mapped file is absent) OR >=1 mirror file
 *       whose BODY no longer matches its corpus document (AC-BFI-8, named by slug); OR export mode
 *       completed with 0 per-doc errors but still failed to reach parity for some type
 *       (defensive — should not occur, since `exportDocs` either creates or reports an error for
 *       every doc it processes).
 *   {@link MIRROR_ZERO_COMPARED_EXIT_CODE} (5) — check mode compared FEWER mirror files than the
 *       mapped-and-present population (in particular ZERO of a non-zero population, AC-OX-6): a
 *       check that parsed nothing is indistinguishable from a clean one. Takes precedence over 2.
 *   {@link MIRROR_USAGE_EXIT_CODE} (3) — the ARGUMENTS were wrong, so NOTHING was measured: an
 *       unrecognised token, a `--type` with no value, an unknown type name, or a repeated `--type`.
 *       The offending token is echoed to stderr verbatim. ⛔ Returned BEFORE the corpus is opened,
 *       so this code can never be read as "the mirror is stale" (2) nor as "the tool tried and
 *       could not decide" (4). ⛔ It is declared in THIS file rather than beside 2 and 4 in
 *       `export-spec-mirror-core.ts` because it is a property of this file's CLI surface, which
 *       core — pure/fs-only, never argv-aware — has no part in. That split is not left to
 *       diligence: `scripts/tests/export-spec-mirror-argv.test.ts` asserts 3 differs from BOTH
 *       imported core codes, so a future core code that took 3 turns that suite red instead of
 *       silently aliasing a usage error onto a corpus verdict.
 *   {@link MIRROR_HARD_FAILURE_EXIT_CODE} (4) — a per-doc export error, an unreadable or
 *       schema-invalid `.lore/export-index.json`, a corpus read failure, or a drifted mirror file
 *       attributable to no corpus doc, for ANY type. ⛔ 2 and 4 must stay distinguishable: 4 means
 *       the tool could not decide, 2 means it decided the mirror is stale. A test asserting merely
 *       "non-zero" cannot tell a detection from a crash.
 *
 * Usage (⛔ every token is PARSED, never scanned for — an unrecognised one is REFUSED, see
 * {@link parseMirrorArgv}):
 *   bun scripts/export-spec-mirror.ts                     # export ALL SIX types (writes)
 *   bun scripts/export-spec-mirror.ts --check             # drift check, ALL SIX types (read-only)
 *   bun scripts/export-spec-mirror.ts --check --type spec # the SAME check over ONE type
 *   bun scripts/export-spec-mirror.ts --type spec         # export ONE type (writes; prunes only that type's directory)
 *
 * ⛔ `package.json`'s `check:spec-mirror` — the link `bun run test` invokes — MUST stay the
 * UNNARROWED `bun scripts/export-spec-mirror.ts --check`. A narrowed variant wired into that chain
 * would leave every other type's drift behaviour exercised by nothing;
 * `scripts/tests/mirror-production-command-unnarrowed.test.ts` asserts that script string by
 * fixed-string EQUALITY (⛔ not containment, which stays true if someone appends `--type spec`).
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
  MIRROR_ZERO_COMPARED_EXIT_CODE,
  evaluateComparedCount,
  SpecMirrorError,
  computeMirrorParity,
  computeMirrorContentDrift,
  loadMirrorMappings,
  countMdFilesFlat,
  pruneOrphanMirrorFiles,
  scriptChainReachesTarget,
  printParity,
  printContentDrift,
  printExportReport,
  findDuplicateHumanIds,
  printDuplicateHumanIds,
  type MirrorDocType,
  type MirrorParityResult,
  type MirrorParityMissing,
  type MirrorExportReportLike,
  type MirrorContentDivergence,
  type MirrorContentDriftResult,
} from "./export-spec-mirror-core.js";

// Pure/fs-only surface — re-exported so a caller needing both halves has one import site.
export {
  MIRROR_TYPES,
  mirrorDirRelative,
  SPEC_MIRROR_DIR_RELATIVE,
  MIRROR_DRIFT_EXIT_CODE,
  MIRROR_HARD_FAILURE_EXIT_CODE,
  MIRROR_ZERO_COMPARED_EXIT_CODE,
  evaluateComparedCount,
  SpecMirrorError,
  computeMirrorParity,
  computeMirrorContentDrift,
  loadMirrorMappings,
  countMdFilesFlat,
  pruneOrphanMirrorFiles,
  scriptChainReachesTarget,
};
export type {
  MirrorDocType,
  MirrorParityResult,
  MirrorParityMissing,
  MirrorExportReportLike,
  MirrorContentDivergence,
  MirrorContentDriftResult,
};

const __filename = fileURLToPath(import.meta.url);
/** This file's own repo root — see module header "Why `projectDir` is derived from THIS FILE's own path". */
const REPO_ROOT = join(__filename, "..", "..");

// ─── argv contract (⛔ the ONLY place this script decides what an argument means) ──────────────

/**
 * Exit code for a USAGE error — the arguments were wrong, so NOTHING about the mirror was
 * measured. ⛔ Distinct from `0` (clean), from {@link MIRROR_DRIFT_EXIT_CODE} (2, "the mirror is
 * stale") and from {@link MIRROR_HARD_FAILURE_EXIT_CODE} (4, "the tool could not decide"): a
 * caller who typo'd a flag and a caller whose corpus drifted must never receive the same number.
 *
 * ⛔ Declared HERE and not beside 2 and 4 in `export-spec-mirror-core.ts` because it describes
 * THIS file's CLI surface, and core is the pure/fs-only half that never sees argv. The
 * non-collision is mechanized rather than trusted: `scripts/tests/export-spec-mirror-argv.test.ts`
 * asserts this value differs from BOTH core codes, so a future core code that took `3` turns that
 * suite red instead of silently aliasing a usage error onto a corpus verdict.
 */
export const MIRROR_USAGE_EXIT_CODE = 3;

/** The fully resolved argv of one run — what {@link main} dispatches on, with nothing left implicit. */
export interface MirrorArgv {
  /** `true` iff `--check` was given: the read-only drift check. `false` selects the WRITING export. */
  readonly checkMode: boolean;
  /**
   * The mirrored types this run scans, in {@link MIRROR_TYPES} order — every type unless `--type`
   * narrowed it. ⛔ Narrowing selects WHICH types are visited and nothing else: the verdict for a
   * visited type is the one a full run would report for that same type.
   */
  readonly types: readonly MirrorDocType[];
}

/** {@link parseMirrorArgv}'s verdict — a resolved {@link MirrorArgv}, or the human-readable reason the arguments were refused. ⛔ Never both, and never a partially-applied argv. */
export type MirrorArgvParse =
  | { readonly ok: true; readonly value: MirrorArgv }
  | { readonly ok: false; readonly message: string };

/** The `--type=` inline form's prefix, named once so the parser's two reads of it cannot drift apart. */
const TYPE_FLAG_PREFIX = "--type=";

/** Printed to stderr under every refusal, so a caller sees the whole accepted surface rather than only the token they got wrong. */
export const MIRROR_USAGE_TEXT = [
  `usage: bun scripts/export-spec-mirror.ts [--check] [--type <${MIRROR_TYPES.join("|")}>]`,
  "  --check          read-only drift check; omit it to run the WRITING export",
  `  --type <type>    scan ONE mirrored type instead of all ${MIRROR_TYPES.length} (the inline form --type=<type> is accepted too)`,
].join("\n");

/** Narrowing type guard over the {@link MIRROR_TYPES} tuple — the single place a raw `--type` value becomes a {@link MirrorDocType}. */
function isMirrorDocType(value: string): value is MirrorDocType {
  return (MIRROR_TYPES as readonly string[]).includes(value);
}

/**
 * PURE argv parser — the whole command-line contract of this script, and the reason an
 * unrecognised argument can no longer be silently ignored.
 *
 * ## What this replaces, measured
 *
 * `main` previously read `argv.includes("--check")` and NOTHING else, then looped
 * {@link MIRROR_TYPES} unconditionally. Measured 2026-08-25 on main @ `3331a98e`:
 * `bun scripts/export-spec-mirror.ts --check --type prd --definitely-not-a-flag` exited 2 having
 * scanned all six types, printing no refusal line at all — BOTH the bogus flag and the
 * not-yet-existing `--type` were inert in that single run. That is the defect class of
 * `knowledge-a-dry-run-flag-that-does-not-exist-writes-the-files`: an argument that does not exist
 * is accepted, and the command proceeds to do something other than what the caller asked for.
 *
 * ## Every refusal, and why each one is a refusal rather than a default
 *
 *   - an unrecognised token — the caller asked for something this script does not do, and guessing
 *     which part of their intent to drop is precisely the defect above. Echoed verbatim.
 *   - `--type` with no value (last argument, or an empty `--type=`) — there is no "default type"
 *     to fall back to that would not also be a silent reinterpretation of the request.
 *   - an unknown type name — the valid set is finite and is named in the message.
 *   - `--type` given more than once — two narrowings cannot both be honoured, and last-wins would
 *     silently discard one of them. ⛔ Refused even when the two values are equal: "you typed it
 *     twice" is decidable, whereas "you meant it twice" is not.
 *
 * ⛔ A repeated `--check` is NOT refused: unlike `--type` it carries no value, so a second one
 * cannot express a different intent from the first and there is nothing to discard.
 *
 * @param argv the arguments AFTER the script path (i.e. `process.argv.slice(2)`).
 * @returns `{ ok: true, value }` with the resolved mode + type selection, or `{ ok: false, message }`
 *   naming the offending token verbatim. ⛔ Never throws, never partially applies an argv.
 */
export function parseMirrorArgv(argv: readonly string[]): MirrorArgvParse {
  let checkMode = false;
  let selectedType: MirrorDocType | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;

    if (arg === "--check") {
      checkMode = true;
      continue;
    }

    if (arg === "--type" || arg.startsWith(TYPE_FLAG_PREFIX)) {
      const inlineValue = arg.startsWith(TYPE_FLAG_PREFIX) ? arg.slice(TYPE_FLAG_PREFIX.length) : undefined;
      // reason: the separated form consumes the NEXT token, so the loop must skip it; the inline
      // form consumes nothing beyond itself. Advancing `index` from WHICH FORM was used (rather
      // than from whether a value was found) is what keeps a trailing bare `--type` a REFUSAL
      // below instead of an accidental re-read of whatever followed it.
      const rawValue = inlineValue ?? argv[index + 1];
      if (inlineValue === undefined) index += 1;

      if (rawValue === undefined || rawValue === "") {
        return { ok: false, message: `'${arg}' requires a mirrored type name` };
      }
      if (!isMirrorDocType(rawValue)) {
        return {
          ok: false,
          message: `unknown mirrored type '${rawValue}' in '${arg}' (expected one of: ${MIRROR_TYPES.join(", ")})`,
        };
      }
      if (selectedType !== undefined) {
        return {
          ok: false,
          message: `--type given more than once ('${selectedType}' then '${rawValue}') — one run scans one selection`,
        };
      }
      selectedType = rawValue;
      continue;
    }

    return { ok: false, message: `unrecognised argument '${arg}'` };
  }

  return {
    ok: true,
    value: {
      checkMode,
      types: selectedType === undefined ? MIRROR_TYPES : [selectedType],
    },
  };
}

/** Parity verdict across every {@link MirrorDocType} — the aggregate `runCheck`/`runExport` return, one `MirrorParityResult` per type plus a corpus-wide `ok` (AND across all six). */
export interface MirrorParityAllTypesResult {
  /**
   * One verdict per SCANNED type. ⛔ `Partial`, not a full record: a `--type`-narrowed run visits
   * a subset, and a reader must be able to tell "this type was not scanned" from "this type was
   * scanned and was clean". The key set IS the scanned set.
   */
  readonly perType: Readonly<Partial<Record<MirrorDocType, MirrorParityResult>>>;
  /** `true` iff every SCANNED type recorded a verdict AND every one of those verdicts is `ok`. ⛔ A type that was selected but produced no verdict makes this `false`, never vacuously `true`. */
  readonly ok: boolean;
}

/** Full result of one `runExport` run — the underlying service's own report PER TYPE, the corpus-wide orphan-pruning log (empty when nothing was orphaned), and the measured post-write parity verdict across all six types. */
export interface MirrorExportResult {
  /**
   * One verdict per SCANNED type. ⛔ `Partial`, not a full record: a `--type`-narrowed run visits
   * a subset, and a reader must be able to tell "this type was not scanned" from "this type was
   * scanned and was clean". The key set IS the scanned set.
   */
  readonly perType: Readonly<Partial<Record<MirrorDocType, MirrorExportReportLike>>>;
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
export async function runCheck(
  app: App,
  repoRoot: string = REPO_ROOT,
  types: readonly MirrorDocType[] = MIRROR_TYPES,
): Promise<MirrorParityAllTypesResult> {
  const mappings = loadMirrorMappings(repoRoot);
  const fileExists = (relFilePath: string): boolean => existsSync(join(repoRoot, relFilePath));

  const perType: Partial<Record<MirrorDocType, MirrorParityResult>> = {};
  for (const type of types) {
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

  const ok = types.every((type) => perType[type]?.ok === true);
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
/** Body-comparison verdict across every {@link MirrorDocType} — one `MirrorContentDriftResult` per type plus an AND across all six. */
export interface MirrorContentAllTypesResult {
  /**
   * One verdict per SCANNED type. ⛔ `Partial`, not a full record: a `--type`-narrowed run visits
   * a subset, and a reader must be able to tell "this type was not scanned" from "this type was
   * scanned and was clean". The key set IS the scanned set.
   */
  readonly perType: Readonly<Partial<Record<MirrorDocType, MirrorContentDriftResult>>>;
  /** `true` iff every SCANNED type recorded a verdict AND every one of those verdicts is `ok`. ⛔ A type that was selected but produced no verdict makes this `false`, never vacuously `true`. */
  readonly ok: boolean;
}

/**
 * Read-only BODY comparison across all six types (AC-BFI-8) — the second half of `--check`,
 * deliberately separate from {@link runCheck} so that function's count+slug contract, and
 * {@link runExport}'s use of it, are untouched.
 *
 * ## Why this calls the exporter, and why that is still read-only
 *
 * The body comparison is `ExportDocsService.exportDocs`'s own — the SAME pipeline that writes the
 * files (MDX placeholders spliced, SPEC-043 invalidation banner prepended, NUL bytes sanitized,
 * `extractBodyFromMd` + `canonicaliseBody`). Under `dryRun: true` it reports that verdict in
 * `report.drift` and writes NOTHING: every write site in that method — `saveIndexAtomic` (the
 * Phase-1 index save), `mkdirSync`, the identity-repair / frontmatter-repair / force-overwrite
 * `writeFileSync` calls, and `writeFileExclusive` — is behind a `dryRun` guard or an early
 * `continue`. Verified 2026-08-17 by enumerating those sites AND empirically: a full six-type
 * `dryRun: true` pass over the live corpus left `git status --porcelain` empty.
 *
 * ⛔ `force` is NEVER passed here. With `force: true` the same call would OVERWRITE every drifted
 * file, turning this check into a repairer — the precise failure AC-BFI-8 (i) forbids ("a check
 * that regenerates what it is checking can never fail"). That condition is mechanized, not merely
 * asserted here: `scripts/tests/spec-mirror-content-drift.test.ts` runs `--check` twice
 * consecutively over a mutated body and requires the SAME drift both times, and separately
 * requires the mutated file's hash to be unchanged across the whole assertion window.
 *
 * @throws {SpecMirrorError} `corpus_unreadable` (the probe or the doc list failed for some type, or
 *   the probe reported per-doc errors) / `content_unattributable` (a drifted file no corpus doc of
 *   its type owns) — both map to {@link MIRROR_HARD_FAILURE_EXIT_CODE}, never the drift code.
 */
export async function runContentCheck(
  app: App,
  repoRoot: string = REPO_ROOT,
  types: readonly MirrorDocType[] = MIRROR_TYPES,
): Promise<MirrorContentAllTypesResult> {
  const mappings = loadMirrorMappings(repoRoot);

  const perType: Partial<Record<MirrorDocType, MirrorContentDriftResult>> = {};
  for (const type of types) {
    const probeResult = await app.exportDocsService.exportDocs({ projectDir: repoRoot, dryRun: true, type });
    if (!probeResult.ok) {
      throw new SpecMirrorError("corpus_unreadable", `content probe failed for type ${type}: ${JSON.stringify(probeResult.error)}`, {
        error: probeResult.error,
        type,
      });
    }
    // reason: a per-doc error means this type's report is INCOMPLETE — some doc's body was never
    // compared. Folding that into "no drift found" would print OK over an unanswered question, so
    // it is raised as a hard failure (exit 4) rather than left to the drift code (exit 2).
    if (probeResult.value.errors.length > 0) {
      throw new SpecMirrorError(
        "corpus_unreadable",
        `content probe reported ${probeResult.value.errors.length} per-doc error(s) for type ${type}: ${probeResult.value.errors.join("; ")}`,
        { errors: probeResult.value.errors, type },
      );
    }

    const docsResult = await app.corpusService.listFull({ type });
    if (!docsResult.ok) {
      throw new SpecMirrorError("corpus_unreadable", `failed to list corpus ${type} docs for the content probe: ${JSON.stringify(docsResult.error)}`, {
        error: docsResult.error,
        type,
      });
    }
    const docs = docsResult.value.docs.map((doc) => ({ id: doc.id, slug: doc.slug }));

    const contentResult = computeMirrorContentDrift(docs, mappings, probeResult.value);
    if (contentResult.unresolvedFilePaths.length > 0) {
      throw new SpecMirrorError(
        "content_unattributable",
        `${contentResult.unresolvedFilePaths.length} drifted ${type} mirror file(s) belong to no corpus ${type}: ${contentResult.unresolvedFilePaths.join(", ")}`,
        { unresolvedFilePaths: contentResult.unresolvedFilePaths, type },
      );
    }
    perType[type] = contentResult;
  }

  const ok = types.every((type) => perType[type]?.ok === true);
  return { perType, ok };
}

export async function runExport(
  app: App,
  repoRoot: string = REPO_ROOT,
  types: readonly MirrorDocType[] = MIRROR_TYPES,
): Promise<MirrorExportResult> {
  const perType: Partial<Record<MirrorDocType, MirrorExportReportLike>> = {};
  for (const type of types) {
    // reason: force:true = the mirror is a projection (F3/AC-CRIT-4); see module header. The
    // read-only content probe in runContentCheck deliberately does NOT pass it.
    const exportResult = await app.exportDocsService.exportDocs({ projectDir: repoRoot, dryRun: false, force: true, type });
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
  for (const type of types) {
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
  // reason: BOTH arguments are narrowed by the SAME `types` list, and that pairing is what makes
  // a narrowed export safe. `liveMappings` holds only the scanned types' live docs, so sweeping any
  // OTHER type's directory with it would delete every file in that directory as an "orphan". Since
  // each mirror directory holds exactly one type, restricting the sweep to the scanned types'
  // directories keeps every deletion attributable to a doc list that was actually read this run.
  const pruned = pruneOrphanMirrorFiles(repoRoot, liveMappings, types.map(mirrorDirRelative));

  const parity = await runCheck(app, repoRoot, types);
  return { perType, pruned, parity };
}

/**
 * Reads back the verdict recorded for a type that was SELECTED for scanning, failing loudly when
 * there is none.
 *
 * ⛔ Not defensive noise and ⛔ not a place for a fallback: the aggregate results are `Partial`
 * records precisely so a `--type`-narrowed run cannot pretend to hold a verdict it never computed,
 * and this is the one function that turns that possibility into a crash (mapped to
 * {@link MIRROR_HARD_FAILURE_EXIT_CODE} by the `import.meta.main` block) rather than into a
 * silently skipped type — which would print a clean report over a question nobody answered.
 *
 * @throws {Error} when `perType` holds no verdict for `type`; unreachable while the same `types`
 *   list drives both the scan and the report, which is exactly the invariant it pins.
 */
function requireVerdict<T>(
  perType: Readonly<Partial<Record<MirrorDocType, T>>>,
  type: MirrorDocType,
  what: string,
): T {
  const verdict = perType[type];
  if (verdict === undefined) {
    throw new Error(`internal invariant: '${type}' was selected for scanning but no ${what} verdict was recorded for it`);
  }
  return verdict;
}

/**
 * CLI entrypoint: PARSES `argv` (⛔ never scans it — see {@link parseMirrorArgv}), dispatches
 * export vs. check mode over the selected types, runs it against a real `App`, prints a report per
 * scanned type, and returns the process exit code. Never calls `process.exit` itself (the
 * `import.meta.main` block below is the only place that does), so this stays directly callable
 * from tests.
 *
 * ⛔ Argument parsing happens BEFORE the corpus is opened, so a usage error costs no corpus read
 * and can never be confused with a verdict about the mirror. It also happens before
 * `findLoreDbPath({ cwd: process.cwd(), env: process.env })`, whose own miss path calls `process.exit(1)` — a typo'd flag must not be
 * reported as "no corpus found".
 *
 * @param argv defaults to `process.argv.slice(2)`; `--check` selects the read-only drift check and
 *   `--type <t>` narrows the scan to one mirrored type. Anything else is REFUSED with
 *   {@link MIRROR_USAGE_EXIT_CODE}.
 * @param repoRootOverride defaults to {@link REPO_ROOT} (this file's own location) — tests pass a
 *   throwaway fixture root here.
 * @param dbPathOverride defaults to `findLoreDbPath({ cwd: process.cwd(), env: process.env })` — tests pass a throwaway `mkdtemp` +
 *   `lore init` corpus path here, NEVER the repo's own `.lore/lore.db` for anything that writes.
 */
export async function main(
  argv: readonly string[] = process.argv.slice(2),
  repoRootOverride?: string,
  dbPathOverride?: string,
): Promise<number> {
  const parsed = parseMirrorArgv(argv);
  if (!parsed.ok) {
    console.error(`export-spec-mirror: ${parsed.message}`);
    console.error(MIRROR_USAGE_TEXT);
    return MIRROR_USAGE_EXIT_CODE;
  }
  const { checkMode, types } = parsed.value;

  const repoRoot = repoRootOverride ?? REPO_ROOT;
  const dbPath = dbPathOverride ?? findLoreDbPath({ cwd: process.cwd(), env: process.env });
  const app = createApp(dbPath);
  try {
    if (checkMode) {
      const parity = await runCheck(app, repoRoot, types);
      const content = await runContentCheck(app, repoRoot, types);
      let allOk = true;
      let blind = false;
      // AC-R0-5: one human_id naming two live docs is drift the count/slug/body checks cannot see.
      const liveDocs: { id: string; slug: string }[] = [];
      for (const type of types) {
        const docsResult = await app.corpusService.listFull({ type });
        if (!docsResult.ok) {
          throw new SpecMirrorError("corpus_unreadable", `failed to list corpus ${type} docs: ${JSON.stringify(docsResult.error)}`, {
            error: docsResult.error,
            type,
          });
        }
        liveDocs.push(...docsResult.value.docs.map((doc) => ({ id: doc.id, slug: doc.slug })));
      }
      // reason: a reported collision EXPLAINS a compared-count shortfall (the content probe cannot
      // pair a doc to its file while two docs claim one human_id), so exit 5 ("unexplained
      // blindness") must not outrank the drift code the collision already earned.
      const collisionReported = !printDuplicateHumanIds(findDuplicateHumanIds(liveDocs, loadMirrorMappings(repoRoot)));
      if (collisionReported) allOk = false;
      for (const type of types) {
        if (!printParity("check", type, requireVerdict(parity.perType, type, "parity"))) allOk = false;
        // reason: printed unconditionally, immediately after the parity line whose parenthetical
        // says "file CONTENT is not compared" — that parenthetical is scoped to `computeMirrorParity`
        // and would read as a command-level claim without this line answering content right there.
        const contentVerdict = requireVerdict(content.perType, type, "content");
        if (!printContentDrift(type, contentVerdict)) allOk = false;
        // AC-OX-6: positive trace — compared count must equal the mapped-and-present population.
        const counted = evaluateComparedCount(type, contentVerdict);
        if (!counted.ok) {
          console.error(counted.message);
          blind = true;
        }
      }
      if (blind && !collisionReported) return MIRROR_ZERO_COMPARED_EXIT_CODE;
      return allOk ? 0 : MIRROR_DRIFT_EXIT_CODE;
    }

    const { perType, pruned, parity } = await runExport(app, repoRoot, types);
    for (const type of types) printExportReport(type, requireVerdict(perType, type, "export"));
    if (pruned.length > 0) {
      console.log(`export-spec-mirror: pruned ${pruned.length} orphaned file(s) (no longer mapped to any corpus doc, any scanned type):`);
      for (const relPath of pruned) console.log(`  ${relPath}`);
    }
    let anyErrors = false;
    let allOk = true;
    for (const type of types) {
      if (requireVerdict(perType, type, "export").errors.length > 0) anyErrors = true;
      if (!printParity("export", type, requireVerdict(parity.perType, type, "parity"))) allOk = false;
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
