/**
 * StoreInterface — storage abstraction for the Lore corpus.
 * All methods return Promise<Result<T, LoreError>> for Turso/libSQL async compatibility.
 * SQLiteStore wraps sync bun:sqlite calls in async methods.
 * Source: SPEC-001 §4, adapted to use Result<T, LoreError> per task spec.
 */

import type {
  AuditEntry,
  CalibrationRecord,
  DocId,
  DocRecord,
  DocStatus,
  DocType,
  LinkRecord,
  LinkType,
  ReviewJudgment,
  Slug,
  VersionRecord,
} from "@lore/core";
import type { LoreError, Result } from "@lore/core";

// ─── Update Options ────────────────────────────────────────────────────────

/**
 * Options for {@link StoreInterface.update}.
 *
 * When `expected_version` is provided the storage layer MUST perform a
 * conditional UPDATE (`WHERE id = ? AND version = ?`).  If zero rows are
 * affected (because the stored version no longer matches) the call MUST
 * return a {@link LoreError} with code `STALE_VERSION` carrying
 * `{ id, expected: expected_version, actual: <current stored version> }`.
 *
 * When omitted the existing unconditional UPDATE semantics are preserved,
 * keeping all current callers backward-compatible.
 *
 * @see PLAN-01KTRJGT31D8WJ4ZRHNARV9YBC phase 1a — CAS/conditional-UPDATE
 *      implementation lands there.
 */
export interface UpdateOpts {
  /** Guard version. When set, update is conditional on this matching the stored value. */
  expected_version?: number;
}

// ─── Filter Types ──────────────────────────────────────────────────────────

export interface StoreFilters {
  type?: DocType;
  status?: DocStatus;
  parent_id?: DocId;
  created_by?: string;
  /** ISO 8601 — only docs updated at or after this timestamp */
  since?: string;
  tags?: string[];
  /** Default: true. When false, soft-deleted docs are included. */
  exclude_deleted?: boolean;
}

export interface SearchHit {
  id: DocId;
  slug: Slug;
  title: string;
  snippet: string;
  score: number;
}

export interface AuditFilters {
  doc_id?: DocId;
  actor?: string;
  action?: string;
  /** ISO 8601 */
  since?: string;
  limit?: number;
}

/**
 * Filter for {@link StoreInterface.queryCalibrationWindow}.
 * `limit` is required — the window is always bounded (never an unbounded scan).
 */
export interface CalibrationWindowFilter {
  doc_type?: DocType;
  /**
   * Filters by the prompt_version of the judgment each calibration record
   * points at. Requires a join to `review_judgments` (kept as one indexed
   * SQL statement — see SQLiteStore.queryCalibrationWindow).
   */
  prompt_version?: string;
  limit: number;
}

/**
 * A {@link CalibrationRecord} augmented with `judge_prompt_version` — the
 * `prompt_version` of the judgment it's FK'd to, projected onto the row by
 * {@link StoreInterface.queryCalibrationWindow}'s join to `review_judgments`.
 * `CalibrationRecord` itself (the `calibrationRecordSchema`-validated persisted
 * shape) intentionally does NOT carry `prompt_version` — only the judgment
 * does — so this is a store-layer read projection, not a schema change.
 */
export type CalibrationRecordWithPromptVersion = CalibrationRecord & {
  judge_prompt_version: string;
};

// ─── Interface ─────────────────────────────────────────────────────────────

/**
 * Async storage interface.
 * SQLiteStore implements this via bun:sqlite (sync internally, wrapped in async).
 * TursoStore will implement this via @libsql/client (natively async).
 * InMemoryStore implements this for unit tests.
 */
export interface StoreInterface {
  // ── Document CRUD ──────────────────────────────────────────────────────

  /** Insert a new doc. Fails with DUPLICATE_SLUG if slug already exists. */
  insert(doc: DocRecord): Promise<Result<DocRecord, LoreError>>;

  /** Find doc by ULID. Returns null (not error) if not found. */
  find(id: DocId): Promise<Result<DocRecord | null, LoreError>>;

  /** Find doc by slug. Returns null (not error) if not found. */
  findBySlug(slug: Slug): Promise<Result<DocRecord | null, LoreError>>;

  /**
   * Find multiple docs matching filters.
   * By default excludes soft-deleted docs (exclude_deleted defaults to true).
   */
  findMany(filters: StoreFilters): Promise<Result<DocRecord[], LoreError>>;

  /**
   * Apply a partial patch to an existing doc.
   * Returns `DOC_NOT_FOUND` if `id` is missing.
   *
   * **Optimistic locking** — when `opts.expected_version` is provided the
   * storage layer MUST perform a conditional UPDATE (`WHERE id = ? AND version = ?`).
   * If the stored version no longer matches, the call MUST return
   * `{ code: "STALE_VERSION", id, expected: opts.expected_version, actual: <stored> }`.
   * When `opts` is omitted the unconditional UPDATE behaviour is preserved
   * (backward-compatible — all existing callers are unaffected).
   *
   * @see PLAN-01KTRJGT31D8WJ4ZRHNARV9YBC phase 1a — CAS implementation
   */
  update(
    id: DocId,
    patch: Partial<DocRecord>,
    opts?: UpdateOpts,
  ): Promise<Result<DocRecord, LoreError>>;

  /**
   * Set deleted_at to current ISO timestamp.
   * Doc remains in DB but excluded from findMany by default.
   */
  softDelete(id: DocId): Promise<Result<void, LoreError>>;

  // ── Links ──────────────────────────────────────────────────────────────

  /**
   * Add a directed link.
   * Fails with DUPLICATE_LINK if (from_id, to_id, link_type) already exists.
   * For link_type='parent': validates no cycle in the parent tree.
   */
  addLink(link: LinkRecord): Promise<Result<LinkRecord, LoreError>>;

  /** Remove a specific directed link by composite key. */
  removeLink(
    fromId: DocId,
    toId: DocId,
    linkType: LinkType,
  ): Promise<Result<void, LoreError>>;

  /** Find all links for a doc, filtered by direction. */
  findLinks(
    docId: DocId,
    direction: "in" | "out" | "both",
  ): Promise<Result<LinkRecord[], LoreError>>;

  /**
   * Batch-find links of a given type whose `to_id` is in `toIds`, in one round trip.
   * `WHERE to_id IN (...) AND link_type = ?` — avoids the N+1 pattern of calling
   * {@link findLinks} once per task when computing readiness over a whole plan.
   * Returns `ok([])` immediately when `toIds` is empty (no query issued).
   *
   * @param toIds - Target doc ids to match on the `to_id` side of the link
   * @param linkType - Link type to filter on (readiness uses "blocks")
   * @see PLAN-01KTRJGT31D8WJ4ZRHNARV9YBC / SPEC-025 §3 D7
   */
  findLinksByToIds(
    toIds: DocId[],
    linkType: LinkType,
  ): Promise<Result<LinkRecord[], LoreError>>;

  // ── Search ─────────────────────────────────────────────────────────────

  /**
   * Full-text search via FTS5.
   * Returns ranked results with BM25 score and content snippets.
   * Filters applied as post-FTS WHERE clauses on joined docs table.
   */
  search(query: string, filters?: StoreFilters): Promise<Result<SearchHit[], LoreError>>;

  // ── Versions ───────────────────────────────────────────────────────────

  /** Insert a new version snapshot. */
  insertVersion(version: VersionRecord): Promise<Result<VersionRecord, LoreError>>;

  /** Return version history for a doc, newest first. */
  findVersions(
    docId: DocId,
    opts?: { limit?: number; offset?: number },
  ): Promise<Result<VersionRecord[], LoreError>>;

  /**
   * Return version rows across ALL docs, optionally bounded by a `since` watermark
   * (`created_at >= since`), unordered otherwise. This is the read path for
   * {@link AuditService.verify}'s versions⋈audit reconcile walk (SPEC-035 §2 D5) —
   * `findVersions` is per-doc only, and the completeness oracle needs every version
   * row corpus-wide since the watermark, not one doc at a time.
   *
   * @param since - ISO 8601; omit for no lower bound (all versions ever, used only
   *   by tests — production callers always pass the resolved `audit.verify_since`)
   * @see PLAN task D (SPEC-035) — audit surface
   */
  listAllVersions(since?: string): Promise<Result<VersionRecord[], LoreError>>;

  // ── Audit ──────────────────────────────────────────────────────────────

  /** Append an immutable audit entry. */
  appendAuditEntry(entry: AuditEntry): Promise<Result<void, LoreError>>;

  /** Query audit log with filters. */
  queryAudit(filters: AuditFilters): Promise<Result<AuditEntry[], LoreError>>;

  // ── Review Judgments ───────────────────────────────────────────────────
  // SPEC-034 §2, §3. Dual use: production write path for JudgmentService
  // (not yet implemented — this task lands the data layer only) AND the test
  // seeding path for calibration/triage scenarios, mirroring insertVersion's
  // precedent of one write method serving both roles.

  /**
   * Insert a new review judgment row. The caller (JudgmentService) is
   * responsible for Zod-validating the shape via `reviewJudgmentSchema`
   * before calling — this method does not re-validate, matching `insert`'s
   * contract for DocRecord.
   */
  insertJudgment(judgment: ReviewJudgment): Promise<Result<void, LoreError>>;

  /** All judgments for a doc, newest first (`created_at DESC`). */
  findJudgments(docId: DocId): Promise<Result<ReviewJudgment[], LoreError>>;

  /** Most recent judgment for a doc, or `null` if none exists yet. */
  latestJudgment(docId: DocId): Promise<Result<ReviewJudgment | null, LoreError>>;

  // ── Calibration Records ────────────────────────────────────────────────

  /** Insert a new calibration record (human confirm/override of a judgment). */
  insertCalibrationRecord(record: CalibrationRecord): Promise<Result<void, LoreError>>;

  /**
   * Bounded, indexed window of calibration records, newest first
   * (`created_at DESC`), optionally filtered by `doc_type` and/or the
   * `prompt_version` of the judgment each record points at. The join to
   * `review_judgments` is UNCONDITIONAL (not just when `filter.prompt_version`
   * is pinned) — every returned record carries the judgment's real
   * `judge_prompt_version`, so callers (`JudgmentService.computeCalibrationStats`)
   * can group by the actual (doc_type, prompt_version) pair instead of an
   * unpinned `"*"` sentinel.
   */
  queryCalibrationWindow(
    filter: CalibrationWindowFilter,
  ): Promise<Result<CalibrationRecordWithPromptVersion[], LoreError>>;

  // ── Lifecycle ──────────────────────────────────────────────────────────

  /** Close the underlying database connection. Flushes WAL. */
  close(): void;

  /**
   * Report the on-disk size of the underlying database, in bytes.
   *
   * `SQLiteStore` / `TursoStore` compute `PRAGMA page_count * PRAGMA page_size`
   * against the local file (for `TursoStore`, the embedded replica file).
   * `InMemoryStore` has no disk footprint and always returns `ok(0)`.
   */
  dbSizeBytes(): Promise<Result<number, LoreError>>;
}
