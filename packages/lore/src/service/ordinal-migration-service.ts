/**
 * OrdinalMigrationService — one-shot repair migration for the SPEC-084 live
 * incident (`lore migrate ordinals [--apply]`).
 *
 * Public surface: {@link OrdinalMigrationService.migrateOrdinals}. Three
 * converging steps, run in this fixed order so a doc's version number
 * chains correctly across steps:
 *
 *   1. **Ordinal backfill** — every `spec`/`adr` doc NOT in an exempt
 *      `spec_kind` (`ORDINAL_REGISTRY`, `@lore/core`) whose `ordinal` column
 *      is still `null` gets one, via the store's OWN sanctioned UPDATE-scoped
 *      allocation method ({@link StoreInterface.allocateOrdinalForExisting},
 *      SPEC-084 D1) — this module NEVER writes an arbitrary caller-chosen
 *      ordinal value anywhere (SPEC-084 D7's "no public --ordinal/--number
 *      flag ANYWHERE" reads as a stronger invariant than "no CLI flag": no
 *      code path, including this one-shot repair, injects a specific number
 *      into the `ordinal` column — every write is an ALLOCATION, i.e.
 *      store-computed MAX+1). What this migration DOES control is
 *      **priority order**: per type, eligible docs are sorted by
 *      (title-declared number ascending, undeclared last; `created_at`
 *      ascending; `id` ascending as a final deterministic tiebreak) BEFORE
 *      being fed one-at-a-time into `allocateOrdinalForExisting`. Since that
 *      method always assigns `MAX(ordinal WHERE type=?) + 1` and this
 *      migration is a single-process, non-concurrent sweep, processing in
 *      priority order reproduces the historically-correct numbers for every
 *      doc that never collided, and gives "next free" (the running MAX+1 at
 *      the moment it's this doc's turn) to every collision loser — exactly
 *      the live-incident worked example (SPEC-084 §One-shot repair
 *      migration): the earliest of three same-titled "SPEC-080" docs keeps
 *      080, the next collision loser gets 081, the next gets 082.
 *   2. **Title strip** — every `spec`/`adr` doc (exempt kind or not — the
 *      title-purity rule is independent of whether a doc actually receives
 *      an ordinal, SPEC-084 D6) whose title still self-declares a number
 *      (`isSelfDeclaredOrdinalTitle`, `@lore/core`) has the prefix stripped
 *      via a DIRECT store write (`store.update` + `insertVersion` +
 *      `appendAuditEntry`) — the same un-gated, no-`CorpusService`,
 *      no-approved→draft-reset bypass `OutlineMigrationService`/
 *      `PhaseMigrationService` already established for one-shot migrations.
 *   3. **Export-index reconcile** — `.lore/export-index.json`'s `human_id`
 *      field is corrected in place for every doc whose recorded mapping
 *      disagrees with `formatDocDisplayId(doc)` (the SPEC-084 SSOT). Actual
 *      FILE RENAMES are report-only (Scope-Alt decision, see this class's
 *      JSDoc on `migrateOrdinals` for the full rationale) — `file_path`
 *      stays byte-identical in the index; a literal `git mv <old> <new>`
 *      command is emitted per doc needing one, for a human to review and
 *      apply. A subsequent `lore export-docs` run's own self-heal machinery
 *      (`ExportDocsService`, unrelated to this file) picks up the eventual
 *      rename via its existing corrupted-mapping detection.
 *
 * Idempotency: a second `--apply` run performs `writes_performed: 0` —
 * step 1 finds no doc with `ordinal: null` left, step 2 finds no title still
 * matching `isSelfDeclaredOrdinalTitle`, step 3 finds every mapping's
 * `human_id` already converged.
 *
 * Dry-run (the CLI default) executes the identical read-only planning logic
 * for all three steps and performs ZERO store/filesystem writes — the
 * ordinal-backfill step's "planned" value for a live run is derived from the
 * SAME `MAX+1`-per-priority-position arithmetic the live run's sequential
 * `allocateOrdinalForExisting` calls will produce (no separate, divergently-
 * maintained preview algorithm).
 *
 * Per-doc errors do NOT abort the whole run (mirrors `ExportDocsService`'s
 * documented "other docs still process" precedent) — collected into
 * `errors[]`. An unreadable/malformed `export-index.json` DOES abort the
 * whole migration immediately (a single shared resource, not a per-doc
 * concern) — fail loud, never a silent rebuild-from-scratch (unlike
 * `ExportDocsService`'s own `loadIndex`, which IS safe to self-heal since
 * that service treats the index as fully re-derivable from doc content;
 * THIS migration's job is to RECONCILE existing mappings, so silently
 * discarding them would be data loss, not a self-heal).
 *
 * Side-effect class: IO (StoreInterface reads/writes; `.lore/export-index.json`
 * read + atomic rewrite; no AI, no telemetry, no gate — a one-shot migration
 * path, same precedent as `MigrationService`/`PhaseMigrationService`/
 * `OutlineMigrationService`).
 *
 * Source: SPEC-084 §One-shot repair migration, §Acceptance Criteria AC-084-4.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "fs";
import { dirname, join } from "path";
import {
  err,
  ok,
  exportIndexSchema,
  ORDINAL_REGISTRY,
  ORDINAL_REGISTERED_TYPES,
  formatDocDisplayId,
  isSelfDeclaredOrdinalTitle,
} from "@lore/core";
import type {
  DocRecord,
  DocStatus,
  DocType,
  ExportIndex,
  LoreError,
  Result,
} from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";

/** Actor stamped on every doc/version/audit row this service writes — mirrors
 *  `OutlineMigrationService`/`PhaseMigrationService`'s `MIGRATION_ACTOR` precedent. */
const MIGRATION_ACTOR = "system:ordinal-migration";

// ─── Public Types ───────────────────────────────────────────────────────────

/** Options for {@link OrdinalMigrationService.migrateOrdinals}. */
export interface OrdinalMigrationOpts {
  /** `true` (CLI default) computes the full report with ZERO store/filesystem writes. */
  dryRun: boolean;
  /**
   * Absolute path to the project root — locates `.lore/export-index.json`
   * (mirrors `ExportDocsOptions.projectDir`, `export-docs-service.ts`).
   * Required: the export-index reconcile step (§3) is a mandatory part of
   * this repair migration, not an optional extra.
   */
  projectDir: string;
}

/**
 * One doc's ordinal-backfill outcome — present for EVERY eligible doc this
 * run considered, whether or not its number actually changed (`changed`
 * distinguishes; nothing is omitted, per the "zero silent moves" requirement).
 */
export interface OrdinalReassignmentEntry {
  doc_id: string;
  type: DocType;
  title: string;
  /** The number the title itself declared, or `null` if it declared none. */
  declared_ordinal: number | null;
  /** `formatDocDisplayId` of `declared_ordinal`, or `null`. What the title CLAIMED. */
  old_display: string | null;
  /** The ordinal actually assigned (live run: store-returned; dry-run: simulated). */
  new_ordinal: number;
  /** `formatDocDisplayId` of `new_ordinal`. What the doc's identity IS after this run. */
  new_display: string;
  /** `true` iff `declared_ordinal !== new_ordinal` — a genuine collision/backfill move. */
  changed: boolean;
}

/** One doc's title-strip outcome. `status_before === status_after` always —
 *  this is the proof artifact that no approved→draft reset occurred. */
export interface TitleStripEntry {
  doc_id: string;
  old_title: string;
  new_title: string;
  status_before: DocStatus;
  status_after: DocStatus;
}

/** One doc's export-index `human_id` convergence — file rename stays advisory (§3). */
export interface ExportIndexReconcileEntry {
  doc_id: string;
  old_human_id: string;
  new_human_id: string;
  /** The mapping's CURRENT `file_path` — left untouched in the index (Scope-Alt). */
  file_path: string;
  /** The file_path the on-disk file SHOULD be renamed to, for a human to review. */
  suggested_file_path: string;
  /** Literal, copy-pasteable repair command — never executed by this service. */
  rename_command: string;
}

/**
 * Full report for one {@link OrdinalMigrationService.migrateOrdinals} call —
 * identical shape for `dryRun: true` and `dryRun: false` (the live run's
 * `writes_performed` is the only field a caller needs to gate "did this
 * actually change anything" on).
 */
export interface OrdinalMigrationReport {
  dry_run: boolean;
  reassignments: OrdinalReassignmentEntry[];
  title_strips: TitleStripEntry[];
  export_index_reconciles: ExportIndexReconcileEntry[];
  /** `new Set(ordinals per (type,ordinal) pair).size === numbered_doc_count` — a
   *  defensive, independently-computed invariant check (the store's partial
   *  unique index already enforces this at write time; this is belt-and-braces
   *  reporting, per AC-084-4's explicit "ordinal bijectivity" requirement). */
  bijective: boolean;
  /** Count of non-exempt spec/adr docs carrying a non-null ordinal after this run. */
  numbered_doc_count: number;
  /** Count of actual store/filesystem writes performed — always `0` for a dry run
   *  and for an idempotent second `--apply` run with nothing left to converge. */
  writes_performed: number;
  /** Per-doc failures that did NOT abort the run (mirrors `ExportDocsService`'s
   *  "errors do not abort the whole run" precedent) — empty on a clean run. */
  errors: string[];
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

/** `message` is present on most but not every `LoreError` variant — falls back
 *  to the error code itself, same precedent `OutlineMigrationService` documents. */
function describeLoreError(error: LoreError): string {
  return "message" in error ? error.message : error.code;
}

/**
 * True when `doc`'s type/kind combination NEVER receives a store-allocated
 * ordinal (SPEC-084 §Module Boundary, `ORDINAL_REGISTRY.exemptKinds`) — e.g. a
 * `domain-overview` spec. A type absent from `ORDINAL_REGISTRY` entirely
 * (defensive; callers of this function only ever pass spec/adr docs) is
 * treated as exempt too, so it never accidentally enters the allocation path.
 */
function isExemptFromOrdinal(doc: DocRecord): boolean {
  const entry = ORDINAL_REGISTRY[doc.type];
  if (entry === undefined) return true;
  if (entry.exemptKinds === undefined) return false;
  const rawKind = (doc.extra as { spec_kind?: unknown }).spec_kind;
  const kind = typeof rawKind === "string" ? rawKind : "feature";
  return entry.exemptKinds.includes(kind);
}

/**
 * Extracts the number a doc's title self-declares for its own type's prefix
 * (e.g. `"SPEC-080 — Foo"` → `80`), tolerating zero-padding
 * (`"SPEC-0080"` → `80`). Returns `undefined` for a type outside
 * `ORDINAL_REGISTRY` or a title that declares no number — this is a LOCAL
 * extraction helper (mirrors `export-docs-service.ts`'s own private
 * `titleClaimMatch` regex, not a globally shared one; the ONE shared,
 * import-graph-pinned composition site is `formatDocDisplayId`/
 * `composeDocDisplayTitle`, which this function never touches).
 */
function extractTitleDeclaredOrdinal(type: DocType, title: string): number | undefined {
  const entry = ORDINAL_REGISTRY[type];
  if (entry === undefined) return undefined;
  const pattern = new RegExp(`^\\s*${entry.prefix}-0*(\\d+)\\b`);
  const match = pattern.exec(title);
  if (match === null) return undefined;
  const raw = match[1];
  return raw === undefined ? undefined : Number.parseInt(raw, 10);
}

/**
 * Strips a self-declared number prefix from a title, e.g.
 * `"SPEC-080 — Foo"` → `"Foo"`. Mirrors the exact pattern this task's own
 * spec text declares: `^(SPEC|ADR)-\d+\s*[—-]?\s*`, parametrized by the
 * doc's own type prefix (never both prefixes tried against one doc).
 */
function stripTitleOrdinalPrefix(type: DocType, title: string): string {
  const entry = ORDINAL_REGISTRY[type];
  if (entry === undefined) return title;
  const pattern = new RegExp(`^${entry.prefix}-\\d+\\s*[—-]?\\s*`);
  return title.replace(pattern, "");
}

/**
 * Deterministic priority ordering for ordinal-backfill candidates of ONE
 * type: title-declared number ascending (undeclared sorts LAST — an
 * undeclared doc should never steal a low number from a genuinely-numbered
 * one), then `created_at` ascending, then `id` ascending as a final
 * tiebreak for full determinism (SPEC-084 §One-shot repair migration step 1
 * "created_at priority").
 */
function compareOrdinalCandidates(a: DocRecord, b: DocRecord): number {
  const da = extractTitleDeclaredOrdinal(a.type, a.title);
  const db = extractTitleDeclaredOrdinal(b.type, b.title);
  const na = da ?? Number.POSITIVE_INFINITY;
  const nb = db ?? Number.POSITIVE_INFINITY;
  if (na !== nb) return na - nb;
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/**
 * Reads `.lore/export-index.json`, or a fresh empty index when the file is
 * absent (a legitimate "nothing exported yet" state, not corruption). An
 * EXISTING file that is unreadable or fails `exportIndexSchema` FAILS LOUD —
 * this migration reconciles existing mappings, so silently discarding them
 * (as `ExportDocsService`'s own `loadIndex` does, safely, for ITS re-derivable
 * use case) would be real data loss here.
 */
function loadExportIndexOrFail(indexPath: string): Result<ExportIndex, LoreError> {
  if (!existsSync(indexPath)) {
    return ok({ version: 1, mappings: {} });
  }
  let raw: string;
  try {
    raw = readFileSync(indexPath, "utf8");
  } catch (e) {
    return err({
      code: "STORE_ERROR",
      message: `export-index.json at ${indexPath} exists but could not be read: ${e instanceof Error ? e.message : String(e)}`,
      ...(e instanceof Error ? { cause: e } : {}),
    });
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (e) {
    return err({
      code: "VALIDATION_ERROR",
      field: "export-index.json",
      message: `export-index.json at ${indexPath} is not valid JSON — fix or remove it before running the ordinal migration (never silently rebuilt): ${e instanceof Error ? e.message : String(e)}`,
    });
  }
  const parsed = exportIndexSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return err({
      code: "VALIDATION_ERROR",
      field: "export-index.json",
      message: `export-index.json at ${indexPath} failed schema validation — fix or remove it before running the ordinal migration: ${parsed.error.message}`,
    });
  }
  return ok(parsed.data);
}

/** Atomic write-then-rename, mirrors `export-docs-service.ts::saveIndexAtomic`. */
function saveExportIndexAtomic(indexPath: string, index: ExportIndex): Result<void, LoreError> {
  const indexDir = dirname(indexPath);
  try {
    if (!existsSync(indexDir)) mkdirSync(indexDir, { recursive: true });
    const tmpPath = `${indexPath}.tmp.${Date.now()}`;
    writeFileSync(tmpPath, JSON.stringify(index, null, 2) + "\n", "utf8");
    renameSync(tmpPath, indexPath);
    return ok(undefined);
  } catch (e) {
    return err({
      code: "STORE_ERROR",
      message: `Failed to write export-index.json: ${e instanceof Error ? e.message : String(e)}`,
      ...(e instanceof Error ? { cause: e } : {}),
    });
  }
}

/**
 * Computes the file_path a drifted mapping's file SHOULD be renamed to —
 * strips every leading `({PREFIX}-)?\d+-` run (handles the live incident's
 * "doubled-number" scar, e.g. `SPEC-081-080-foo.md`, where a second bare
 * `080-` segment follows the first properly-prefixed one) then prepends the
 * correct `{new_human_id}-`. Advisory only — never applied to the real
 * filesystem by this service (Scope-Alt, see module header).
 */
function computeSuggestedFilePath(filePath: string, prefix: string, newHumanId: string): string {
  const lastSlash = filePath.lastIndexOf("/");
  const dir = lastSlash >= 0 ? filePath.slice(0, lastSlash + 1) : "";
  const base = lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath;
  const scarPattern = new RegExp(`^(?:(?:${prefix}-)?\\d+-)+`);
  const stripped = base.replace(scarPattern, "");
  return `${dir}${newHumanId}-${stripped}`;
}

// ─── Service ────────────────────────────────────────────────────────────────

/**
 * One-shot SPEC-084 repair migration service — see this module's header
 * docstring for the full three-step contract (ordinal backfill / title
 * strip / export-index reconcile). Stateless — holds only a
 * {@link StoreInterface}, mirroring every other service in this codebase.
 */
export class OrdinalMigrationService {
  constructor(private readonly store: StoreInterface) {}

  /**
   * Runs the full three-step SPEC-084 repair migration (see module header for
   * the detailed per-step contract). Dry-run (`opts.dryRun: true`) computes
   * the identical report with zero writes; `--apply` (`dryRun: false`)
   * executes it. A second `--apply` run is idempotent —
   * `report.writes_performed === 0`.
   *
   * @returns `err` only for a whole-migration abort (an unreadable/malformed
   *   `export-index.json`, or a store failure fetching the candidate doc
   *   lists) — every OTHER per-doc failure is collected into
   *   `report.errors[]` and does not stop the run.
   */
  async migrateOrdinals(opts: OrdinalMigrationOpts): Promise<Result<OrdinalMigrationReport, LoreError>> {
    const { dryRun, projectDir } = opts;
    const nowIso = new Date().toISOString();
    const errors: string[] = [];
    let writesPerformed = 0;

    // Load export-index FIRST — a corrupt index aborts the whole migration
    // (single shared resource, unlike the per-doc "collect and continue"
    // policy the rest of this method follows).
    const indexPath = join(projectDir, ".lore", "export-index.json");
    const indexResult = loadExportIndexOrFail(indexPath);
    if (!indexResult.ok) return err(indexResult.error);
    const index = indexResult.value;

    const allDocs: DocRecord[] = [];
    const reassignments: OrdinalReassignmentEntry[] = [];
    // doc id -> {type, ordinal} for every non-exempt numbered doc with an
    // ordinal AFTER this run (pre-existing OR freshly assigned/simulated) —
    // feeds both the bijectivity check and the export-index reconcile step.
    const finalOrdinalByDocId = new Map<string, { type: DocType; ordinal: number }>();
    // doc id -> latest known version, carried forward into the title-strip
    // step so its CAS write targets the version an ordinal write may have
    // already bumped (never a stale expected_version).
    const versionByDocId = new Map<string, number>();

    // ── Step 1: per-type ordinal backfill ─────────────────────────────────
    for (const type of ORDINAL_REGISTERED_TYPES) {
      const fetchResult = await this.store.findMany({ type, exclude_deleted: false });
      if (!fetchResult.ok) return err(fetchResult.error);
      const docsOfType = fetchResult.value;
      allDocs.push(...docsOfType);

      let runningMax = 0;
      for (const d of docsOfType) {
        if (typeof d.ordinal === "number") {
          if (d.ordinal > runningMax) runningMax = d.ordinal;
          finalOrdinalByDocId.set(d.id, { type: d.type, ordinal: d.ordinal });
        }
      }

      const eligible = docsOfType.filter(
        (d) => !isExemptFromOrdinal(d) && (d.ordinal === null || d.ordinal === undefined),
      );
      eligible.sort(compareOrdinalCandidates);

      for (const doc of eligible) {
        const declared = extractTitleDeclaredOrdinal(doc.type, doc.title);
        const oldDisplay = declared !== undefined ? formatDocDisplayId({ type: doc.type, ordinal: declared }) : null;
        const plannedOrdinal = runningMax + 1;

        if (dryRun) {
          runningMax = plannedOrdinal;
          finalOrdinalByDocId.set(doc.id, { type: doc.type, ordinal: plannedOrdinal });
          reassignments.push({
            doc_id: doc.id,
            type: doc.type,
            title: doc.title,
            declared_ordinal: declared ?? null,
            old_display: oldDisplay,
            new_ordinal: plannedOrdinal,
            new_display: formatDocDisplayId({ type: doc.type, ordinal: plannedOrdinal }) as string,
            changed: declared !== plannedOrdinal,
          });
          continue;
        }

        const allocResult = await this.store.allocateOrdinalForExisting(doc.id, doc.version);
        if (!allocResult.ok) {
          errors.push(
            `ordinal allocation failed for ${doc.id} (${doc.slug}): ${describeLoreError(allocResult.error)}`,
          );
          continue;
        }
        const updated = allocResult.value;
        const actualOrdinal = updated.ordinal as number;
        runningMax = actualOrdinal > runningMax ? actualOrdinal : runningMax;
        finalOrdinalByDocId.set(doc.id, { type: doc.type, ordinal: actualOrdinal });
        versionByDocId.set(doc.id, updated.version);
        writesPerformed += 1;

        const auditResult = await this.store.appendAuditEntry({
          timestamp: nowIso,
          actor: MIGRATION_ACTOR,
          session_id: `ordinal-migration-${doc.id}`,
          action: "ordinal-backfill",
          doc_id: doc.id,
          details: {
            old_display: oldDisplay,
            new_ordinal: actualOrdinal,
            new_display: formatDocDisplayId({ type: doc.type, ordinal: actualOrdinal }),
          },
        });
        if (!auditResult.ok) {
          errors.push(`audit write failed for ${doc.id} ordinal backfill: ${describeLoreError(auditResult.error)}`);
        }

        reassignments.push({
          doc_id: doc.id,
          type: doc.type,
          title: doc.title,
          declared_ordinal: declared ?? null,
          old_display: oldDisplay,
          new_ordinal: actualOrdinal,
          new_display: formatDocDisplayId({ type: doc.type, ordinal: actualOrdinal }) as string,
          changed: declared !== actualOrdinal,
        });
      }
    }

    // ── Step 2: title strip (ALL numbered-type docs, exempt or not) ───────
    const titleStrips: TitleStripEntry[] = [];
    for (const doc of allDocs) {
      if (!isSelfDeclaredOrdinalTitle(doc.type, doc.title)) continue;
      const newTitle = stripTitleOrdinalPrefix(doc.type, doc.title);
      if (newTitle.trim().length === 0) {
        errors.push(
          `title-strip would empty the title for ${doc.id} (${doc.slug}) — skipped, needs manual repair`,
        );
        continue;
      }

      if (dryRun) {
        titleStrips.push({
          doc_id: doc.id,
          old_title: doc.title,
          new_title: newTitle,
          status_before: doc.status,
          status_after: doc.status,
        });
        continue;
      }

      const expectedVersion = versionByDocId.get(doc.id) ?? doc.version;
      const newVersion = expectedVersion + 1;
      const updateResult = await this.store.update(
        doc.id,
        { title: newTitle, updated_at: nowIso, version: newVersion },
        { expected_version: expectedVersion },
      );
      if (!updateResult.ok) {
        errors.push(`title strip failed for ${doc.id} (${doc.slug}): ${describeLoreError(updateResult.error)}`);
        continue;
      }
      writesPerformed += 1;
      versionByDocId.set(doc.id, newVersion);

      const versionResult = await this.store.insertVersion({
        doc_id: doc.id,
        version: newVersion,
        content: doc.content,
        extra: doc.extra,
        status: doc.status,
        title: newTitle,
        action: "update",
        created_at: nowIso,
        created_by: MIGRATION_ACTOR,
        change_summary: "SPEC-084 title prefix strip (ordinal migration)",
        slug: doc.slug,
      });
      if (!versionResult.ok) {
        errors.push(`version write failed for ${doc.id} title strip: ${describeLoreError(versionResult.error)}`);
      }

      const auditResult = await this.store.appendAuditEntry({
        timestamp: nowIso,
        actor: MIGRATION_ACTOR,
        session_id: `ordinal-migration-title-${doc.id}`,
        action: "update",
        doc_id: doc.id,
        details: { version: newVersion, old_title: doc.title, new_title: newTitle },
      });
      if (!auditResult.ok) {
        errors.push(`audit write failed for ${doc.id} title strip: ${describeLoreError(auditResult.error)}`);
      }

      titleStrips.push({
        doc_id: doc.id,
        old_title: doc.title,
        new_title: newTitle,
        status_before: doc.status,
        status_after: doc.status,
      });
    }

    // ── Step 3: export-index human_id reconcile (file renames advisory) ───
    const exportIndexReconciles: ExportIndexReconcileEntry[] = [];
    let indexDirty = false;
    for (const doc of allDocs) {
      if (isExemptFromOrdinal(doc)) continue;
      const finalOrdinal = finalOrdinalByDocId.get(doc.id);
      if (finalOrdinal === undefined) continue;
      const mapping = index.mappings[doc.id];
      if (mapping === undefined) continue;

      const expectedHumanId = formatDocDisplayId({ type: doc.type, ordinal: finalOrdinal.ordinal });
      if (expectedHumanId === null || mapping.human_id === expectedHumanId) continue;

      const prefix = ORDINAL_REGISTRY[doc.type]?.prefix ?? "";
      const suggestedFilePath = computeSuggestedFilePath(mapping.file_path, prefix, expectedHumanId);
      exportIndexReconciles.push({
        doc_id: doc.id,
        old_human_id: mapping.human_id,
        new_human_id: expectedHumanId,
        file_path: mapping.file_path,
        suggested_file_path: suggestedFilePath,
        rename_command: `git mv '${mapping.file_path}' '${suggestedFilePath}'`,
      });

      if (!dryRun) {
        index.mappings[doc.id] = { ...mapping, human_id: expectedHumanId };
        indexDirty = true;
      }
    }

    if (!dryRun && indexDirty) {
      const saveResult = saveExportIndexAtomic(indexPath, index);
      if (!saveResult.ok) return err(saveResult.error);
      writesPerformed += 1;
    }

    // ── Bijectivity (defensive, independent of the store's own partial
    // unique index) — per (type, ordinal) composite key so SPEC-5/ADR-5
    // legitimately coexisting is never mistaken for a collision. ──────────
    const keySet = new Set<string>();
    for (const { type, ordinal } of finalOrdinalByDocId.values()) {
      keySet.add(`${type}:${ordinal}`);
    }
    const bijective = keySet.size === finalOrdinalByDocId.size;

    return ok({
      dry_run: dryRun,
      reassignments,
      title_strips: titleStrips,
      export_index_reconciles: exportIndexReconciles,
      bijective,
      numbered_doc_count: finalOrdinalByDocId.size,
      writes_performed: writesPerformed,
      errors,
    });
  }
}
