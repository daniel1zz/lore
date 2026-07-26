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
 *      is still `null` gets one. A LIVE run assigns it via the store's OWN
 *      sanctioned repair-migration path ({@link StoreInterface.assignOrdinalForRepair},
 *      SPEC-084 D7 — "repair migration uses an internal store path"): a
 *      DIRECT UPDATE-scoped write of THIS module's own computed target
 *      (below), never a `MAX(ordinal)+1` allocation — the partial
 *      `(type, ordinal)` UNIQUE index remains the sole uniqueness authority,
 *      and a genuine collision propagates loud and immediate (this
 *      migration's own `taken` bookkeeping already guarantees the target is
 *      collision-free against the current corpus state; a violation would
 *      mean the migration's OWN plan is wrong, not a transient race).
 *      `insertWithAllocatedOrdinal`/`allocateOrdinalForExisting` remain the
 *      only two ALLOCATION (MAX+1) call sites (Plan Invariant 2) —
 *      `assignOrdinalForRepair` is a distinct, sanctioned TARGETED-ASSIGNMENT
 *      path used exclusively here.
 *
 *      **Declared-number CLAIM semantics (2026-07-27 fix)** — a title- or
 *      export-index-declared number is a CLAIM to be honored, not a hint a
 *      dense renumber may discard. Per type, every eligible doc is
 *      classified into one of three buckets:
 *        - **Tier 1** — the title self-declares a number
 *          (`extractTitleDeclaredOrdinal`).
 *        - **Tier 2** — no title-declared number, but the doc's EXISTING
 *          `.lore/export-index.json` mapping's `human_id` parses as this
 *          doc's type prefix + a number (`extractExportIndexDeclaredOrdinal`)
 *          — this is what keeps legacy pre-title-convention docs (the
 *          original v1 numbering, e.g. early SPEC-0xx/ADR-0xx entries whose
 *          titles never carried the number) in place; without this tier
 *          they would all present as "undeclared" and be shoved to the back
 *          of the queue, incorrectly bumping every genuinely-numbered doc
 *          created since (the exact defect a live dry run against this
 *          corpus proved — see the git history / retro knowledge doc for
 *          the empirical trace).
 *        - **Unclaimed** — neither.
 *
 *      Each tier is internally ordered by `created_at` ascending (`id`
 *      ascending final tiebreak) and a per-type `taken: Set<number>` cascade
 *      is walked **tier 1 entirely, then tier 2 entirely, then unclaimed**:
 *      a claimant's TARGET is its declared number if free, else the next
 *      free integer ≥ its declared number (`nextFreeOrdinalAtOrAbove`) —
 *      tier 1 always wins a same-number collision against a tier-2 claim
 *      processed after it, and multiple same-tier claimants of the same
 *      number cascade forward in `created_at` order (the pre-existing
 *      triple-collision behavior, generalized to recognize tier 2). An
 *      unclaimed doc's target is the next integer STRICTLY ABOVE the
 *      highest ordinal claimed/assigned so far — it never fills a lower gap
 *      a claimed number skipped over (D9's "don't mint a false reference"
 *      spirit).
 *
 *      This per-type TARGET is computed ONCE and is what BOTH a dry run
 *      reports (`reassignments[].new_ordinal`) AND what a live `--apply`
 *      run persists via `assignOrdinalForRepair` — the two are equal BY
 *      CONSTRUCTION, on any claimed-number topology (dense or genuinely
 *      gapped), never merely by luck of a dense corpus (2026-07-27
 *      adjudication follow-up: an earlier revision fed the target through
 *      `allocateOrdinalForExisting`'s MAX+1-only mechanism instead, which
 *      only reproduced the target when the type-space happened to be
 *      dense — REJECTED, since the live corpus has real historical gaps in
 *      its claimed-number set).
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
 * ordinal-backfill step's reported value IS the computed claim TARGET
 * step 1 describes, the SAME value a live `--apply` run persists via
 * `assignOrdinalForRepair` (equal by construction, not by coincidence of a
 * dense corpus).
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
  ExportIndexMapping,
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
  /**
   * The number this doc's WINNING claim declared, or `null` if it declared
   * none (an "unclaimed" doc). Tier-agnostic: a title-declared (tier 1)
   * number if present, else an export-index-declared (tier 2) number, else
   * `null` — see `claim_source` for which one it was.
   */
  declared_ordinal: number | null;
  /** Which source this doc's claim (if any) came from — `null` for an unclaimed doc. */
  claim_source: "title" | "export_index" | null;
  /** `formatDocDisplayId` of `declared_ordinal`, or `null`. What this doc's claim declared. */
  old_display: string | null;
  /**
   * The ordinal actually assigned — the computed claim TARGET (module
   * header step 1) in BOTH modes: dry-run reports it directly, and a live
   * `--apply` run persists this EXACT value via `assignOrdinalForRepair`
   * (never a store-derived MAX+1 value that could diverge from the report).
   */
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
  /**
   * `reassignments.filter(r => !r.changed).length` — every doc whose
   * declared claim already equalled its assigned number (an `[UNCHANGED]`
   * row per the report's explicit UNCHANGED/CHANGED split).
   */
  unchanged_count: number;
  /** `reassignments.filter(r => r.changed).length` — the complement of {@link unchanged_count}. */
  changed_count: number;
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
 * Extracts the number a doc's EXISTING `.lore/export-index.json` mapping
 * declares for its own type's prefix (e.g. `human_id: "SPEC-025"` → `25`),
 * tolerating zero-padding the same way {@link extractTitleDeclaredOrdinal}
 * does. This is the tier-2 claim source (2026-07-27 backfill-semantics
 * fix) — a doc whose TITLE declares no number but whose export mapping
 * already declares one (legacy pre-title-convention docs) still gets to
 * CLAIM that number, at lower precedence than a tier-1 title claim. Returns
 * `undefined` when there is no mapping for this doc, the doc's type isn't
 * in {@link ORDINAL_REGISTRY}, or the mapping's `human_id` doesn't parse as
 * this type's prefix + a number.
 */
function extractExportIndexDeclaredOrdinal(
  type: DocType,
  mapping: ExportIndexMapping | undefined,
): number | undefined {
  if (mapping === undefined) return undefined;
  const entry = ORDINAL_REGISTRY[type];
  if (entry === undefined) return undefined;
  const pattern = new RegExp(`^${entry.prefix}-0*(\\d+)$`);
  const match = pattern.exec(mapping.human_id.trim());
  if (match === null) return undefined;
  const raw = match[1];
  return raw === undefined ? undefined : Number.parseInt(raw, 10);
}

/**
 * The smallest integer ≥ `candidate` not already in `taken` — the cascade
 * primitive behind "declared number if free, else next free ≥ declared"
 * (SPEC-084 backfill-semantics fix). Also used, with `candidate =
 * maxOrdinal + 1`, for an unclaimed doc's "next free strictly above the
 * highest claim so far" assignment (in that case `taken` never actually
 * blocks the candidate — the caller has already ensured `candidate` exceeds
 * every member of `taken`).
 */
function nextFreeOrdinalAtOrAbove(candidate: number, taken: ReadonlySet<number>): number {
  let n = candidate;
  while (taken.has(n)) n += 1;
  return n;
}

/**
 * Deterministic tiebreak ordering used WITHIN one claim tier (or within the
 * unclaimed bucket) of one type: `created_at` ascending, `id` ascending as
 * a final tiebreak for full determinism when two docs share a timestamp
 * (SPEC-084 §One-shot repair migration step 1 "created_at priority"). Does
 * NOT consider declared number — cross-tier/cross-value ordering is
 * `migrateOrdinals`'s tier-1-then-tier-2-then-unclaimed structure, not this
 * function's concern.
 */
function compareByCreatedAtThenId(a: DocRecord, b: DocRecord): number {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/** One eligible doc's resolved claim — `source: null` means "unclaimed"
 *  (neither a title nor an export-index number), in which case `number` is
 *  always `null` too (kept in lockstep, never independently nullable). */
interface DocClaim {
  source: "title" | "export_index" | null;
  number: number | null;
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

      // `taken` seeds the cascade with every ordinal this type already has
      // (pre-existing, non-null) — a fresh claim can never collide with a
      // doc numbered before this migration ran. `maxOrdinal` tracks the
      // running high-water mark across BOTH pre-existing rows and every
      // claim resolved below, feeding the unclaimed bucket's "strictly
      // above" rule.
      const taken = new Set<number>();
      let maxOrdinal = 0;
      for (const d of docsOfType) {
        if (typeof d.ordinal === "number") {
          taken.add(d.ordinal);
          if (d.ordinal > maxOrdinal) maxOrdinal = d.ordinal;
          finalOrdinalByDocId.set(d.id, { type: d.type, ordinal: d.ordinal });
        }
      }

      const eligible = docsOfType.filter(
        (d) => !isExemptFromOrdinal(d) && (d.ordinal === null || d.ordinal === undefined),
      );

      // Classify every eligible doc into a claim tier (2026-07-27 backfill-
      // semantics fix — see module header). A tier-2 doc's mapping is read
      // from the export index LOADED ABOVE, before any reconcile-step
      // mutation, so backfill priority is never affected by step 3's writes.
      const tier1: DocRecord[] = [];
      const tier2: DocRecord[] = [];
      const unclaimed: DocRecord[] = [];
      const claimByDocId = new Map<string, DocClaim>();

      for (const doc of eligible) {
        const titleDeclared = extractTitleDeclaredOrdinal(doc.type, doc.title);
        if (titleDeclared !== undefined) {
          tier1.push(doc);
          claimByDocId.set(doc.id, { source: "title", number: titleDeclared });
          continue;
        }
        const indexDeclared = extractExportIndexDeclaredOrdinal(doc.type, index.mappings[doc.id]);
        if (indexDeclared !== undefined) {
          tier2.push(doc);
          claimByDocId.set(doc.id, { source: "export_index", number: indexDeclared });
          continue;
        }
        unclaimed.push(doc);
        claimByDocId.set(doc.id, { source: null, number: null });
      }

      tier1.sort(compareByCreatedAtThenId);
      tier2.sort(compareByCreatedAtThenId);
      unclaimed.sort(compareByCreatedAtThenId);

      // Resolve each doc's TARGET ordinal — pure arithmetic, no store
      // dependency. Tier 1 is resolved entirely before tier 2 (a title
      // claim always wins a same-number collision against an export-index
      // claim), then unclaimed docs each take the next integer strictly
      // above everything claimed so far.
      const targetOrdinalByDocId = new Map<string, number>();
      for (const doc of [...tier1, ...tier2]) {
        const claim = claimByDocId.get(doc.id) as DocClaim;
        const target = nextFreeOrdinalAtOrAbove(claim.number as number, taken);
        taken.add(target);
        if (target > maxOrdinal) maxOrdinal = target;
        targetOrdinalByDocId.set(doc.id, target);
      }
      for (const doc of unclaimed) {
        maxOrdinal += 1;
        taken.add(maxOrdinal);
        targetOrdinalByDocId.set(doc.id, maxOrdinal);
      }

      const feedOrder = [...tier1, ...tier2, ...unclaimed];

      if (dryRun) {
        // Pure simulation — the computed target IS the report, and (per the
        // module header) the EXACT value a live run persists via
        // `assignOrdinalForRepair` — equal by construction, no store call
        // needed to know what a live run will do.
        for (const doc of feedOrder) {
          const claim = claimByDocId.get(doc.id) as DocClaim;
          const target = targetOrdinalByDocId.get(doc.id) as number;
          const oldDisplay =
            claim.number !== null ? formatDocDisplayId({ type: doc.type, ordinal: claim.number }) : null;
          finalOrdinalByDocId.set(doc.id, { type: doc.type, ordinal: target });
          reassignments.push({
            doc_id: doc.id,
            type: doc.type,
            title: doc.title,
            declared_ordinal: claim.number,
            claim_source: claim.source,
            old_display: oldDisplay,
            new_ordinal: target,
            new_display: formatDocDisplayId({ type: doc.type, ordinal: target }) as string,
            changed: claim.number !== target,
          });
        }
        continue;
      }

      // Live apply: `assignOrdinalForRepair` (SPEC-084 D7's internal repair
      // path) writes THIS doc's own already-computed `target` directly —
      // never a store-derived MAX+1 value. Feed order no longer affects the
      // outcome (each write is an independent targeted assignment, not a
      // running counter), so `feedOrder` (tier1/tier2/unclaimed, unchanged
      // from the dry-run computation above) is reused as-is.
      for (const doc of feedOrder) {
        const claim = claimByDocId.get(doc.id) as DocClaim;
        const target = targetOrdinalByDocId.get(doc.id) as number;
        const oldDisplay =
          claim.number !== null ? formatDocDisplayId({ type: doc.type, ordinal: claim.number }) : null;

        const allocResult = await this.store.assignOrdinalForRepair(doc.id, target);
        if (!allocResult.ok) {
          errors.push(
            `ordinal repair-assignment failed for ${doc.id} (${doc.slug}) target ${target}: ${describeLoreError(allocResult.error)}`,
          );
          continue;
        }
        const updated = allocResult.value;
        const actualOrdinal = updated.ordinal as number;
        finalOrdinalByDocId.set(doc.id, { type: doc.type, ordinal: actualOrdinal });
        versionByDocId.set(doc.id, updated.version);
        // `assignOrdinalForRepair` is a no-op success (unchanged version) on
        // a same-value repeat call — only count a REAL write.
        if (updated.version !== doc.version) writesPerformed += 1;

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
          declared_ordinal: claim.number,
          claim_source: claim.source,
          old_display: oldDisplay,
          new_ordinal: actualOrdinal,
          new_display: formatDocDisplayId({ type: doc.type, ordinal: actualOrdinal }) as string,
          changed: claim.number !== actualOrdinal,
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

    // Explicit UNCHANGED/CHANGED split (module header step 4) — derived
    // once from the same `reassignments[].changed` flag every per-doc
    // report row already carries, never a second independently-computed
    // count.
    let changedCount = 0;
    for (const r of reassignments) {
      if (r.changed) changedCount += 1;
    }
    const unchangedCount = reassignments.length - changedCount;

    return ok({
      dry_run: dryRun,
      reassignments,
      title_strips: titleStrips,
      export_index_reconciles: exportIndexReconciles,
      bijective,
      numbered_doc_count: finalOrdinalByDocId.size,
      writes_performed: writesPerformed,
      unchanged_count: unchangedCount,
      changed_count: changedCount,
      errors,
    });
  }
}
