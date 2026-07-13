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
  ReviewJudgmentKind,
  SearchHit,
  Slug,
  VersionRecord,
} from "@lore/core";
import type { LoreError, Result } from "@lore/core";

/**
 * Re-exported for backward compatibility — every store + the service layer
 * imports `SearchHit` from this module. `@lore/core` is the SSOT (SPEC-037
 * §2): the dashboard also needs the type/status-carrying shape and can only
 * import the browser-safe `@lore/core` barrel, never this Node-adjacent
 * module.
 */
export type { SearchHit };

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
  /**
   * `kind` of the judgment this calibration record is FK'd to (SPEC-044 D12/AC-SP-11) —
   * projected by the SAME unconditional join that already projects `judge_prompt_version`.
   * `JudgmentService.computeCalibrationStats` groups by `(doc_type, judge_prompt_version,
   * judge_kind)` so review and staleness calibrations never pool into one Wilson bound
   * even when both prompt versions are the literal `"v1"` (review S5).
   */
  judge_kind: ReviewJudgmentKind;
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
   * Batch-find docs by id, in ONE round trip. `WHERE id IN (...)` — avoids the N+1
   * pattern of calling {@link find} once per "other side of a link" id, e.g.
   * `CorpusService`'s `related` resolution over a doc's non-parent links.
   *
   * Applies the SAME soft-delete default as {@link find} — i.e. NONE: a
   * soft-deleted doc is still returned if its id is requested (find/findByIds
   * are direct-address lookups, not list-shaped reads; `exclude_deleted`
   * filtering is `findMany`'s concern only).
   *
   * @param ids - Doc ids to fetch
   * @returns Map keyed by doc id; an id with no matching doc is ABSENT from the
   *   map (never present with `null` or `undefined`) — mirrors
   *   {@link findLinksByToIds}'s "absent means none" convention. `ok(new Map())`
   *   immediately when `ids` is empty (no query issued, never a malformed
   *   `WHERE id IN ()`).
   */
  findByIds(ids: DocId[]): Promise<Result<Map<DocId, DocRecord>, LoreError>>;

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

  /**
   * Batch-count ALL incoming link rows (every link type — unlike {@link findLinksByToIds},
   * which is single-`linkType`-scoped and cannot express this) whose `to_id` is in `toIds`,
   * in ONE round trip. The staleness-probe pure layer's `in_degree` input (SPEC-044 D1;
   * `findLinksByToIds` cannot express an all-link-types count — review S1).
   *
   * @param toIds - Target doc ids to count incoming links for
   * @returns Map keyed by doc id; a doc id with ZERO incoming links of any type is
   *   ABSENT from the map (never present with value 0) — callers default via `?? 0`.
   *   `ok(new Map())` immediately when `toIds` is empty (no query issued).
   * @see SPEC-044 §Design Decisions D1
   */
  countLinksByToIds(toIds: DocId[]): Promise<Result<Map<DocId, number>, LoreError>>;

  /**
   * Batch-find OUTGOING links grouped by `from_id`, in ONE round trip — the
   * outgoing-link analog of {@link findLinksByToIds}, keyed the opposite
   * direction. `WHERE from_id IN (...)`, grouped in the returned Map so
   * callers never need a manual per-doc slice pass.
   *
   * Mirrors {@link findLinks}'s `"out"` direction EXACTLY — no `link_type`
   * filter is applied (unlike {@link findLinksByToIds}, which IS
   * `linkType`-scoped): every outgoing link row is returned, of any type.
   * This makes `findLinksByFromIds(ids)` behavior-identical to calling
   * `findLinks(id, "out")` once per id and grouping the results yourself —
   * the N+1 pattern this method exists to replace
   * (`TreeCheckService.reconcile`, SPEC review M7).
   *
   * @param fromIds - Source doc ids to match on the `from_id` side of the link
   * @param direction - Reserved for signature symmetry with {@link findLinks};
   *   currently the ONLY supported value is `"out"` (the default) — grouping by
   *   `from_id` is inherently an outgoing-link concept, so no other direction
   *   has a well-defined meaning here. Typed as the single literal rather than
   *   the `"in" | "out" | "both"` union to make that a compile-time fact, not
   *   a runtime one.
   * @returns Map keyed by `from_id`; a doc id with zero outgoing links is
   *   ABSENT from the map (never present with `[]`) — same "absent means
   *   none" convention as {@link countLinksByToIds}. `ok(new Map())`
   *   immediately when `fromIds` is empty (no query issued).
   */
  findLinksByFromIds(
    fromIds: DocId[],
    direction?: "out",
  ): Promise<Result<Map<DocId, LinkRecord[]>, LoreError>>;

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

  /**
   * All judgments for a doc, newest first (`created_at DESC`).
   *
   * @param kind - When provided, only rows whose `kind` matches (SPEC-044 D3) —
   *   omitted rows read as `'review'` via `??`, never strict equality (S10). When
   *   OMITTED entirely, returns judgments of ANY kind (the pre-SPEC-044 behavior) —
   *   `JudgmentService.listFor` is what defaults this to `'review'` for every existing
   *   caller (D3); the store layer itself applies no default.
   */
  findJudgments(docId: DocId, kind?: ReviewJudgmentKind): Promise<Result<ReviewJudgment[], LoreError>>;

  /**
   * Most recent judgment for a doc, or `null` if none exists yet.
   *
   * @param kind - Same optional kind filter as {@link findJudgments} — omitted means
   *   "any kind" at the store layer; `JudgmentService.latestFor` defaults it to
   *   `'review'`. Without this filter, a staleness "holds" row (persisted
   *   `decision: 'approve'`) could become a doc's latest judgment and masquerade as a
   *   real review approval in `lore pending` (review S2).
   */
  latestJudgment(docId: DocId, kind?: ReviewJudgmentKind): Promise<Result<ReviewJudgment | null, LoreError>>;

  /**
   * Batch-fetch each doc's LATEST judgment of a given kind, in ONE round trip — the
   * staleness-probe pure layer's `latest_holds_probe_at` input needs this per candidate
   * (SPEC-044 D2); an N+1 per-candidate `latestJudgment` call is explicitly rejected
   * (review T6).
   *
   * @param docIds - Doc ids to fetch the latest matching-kind judgment for
   * @param kind - REQUIRED (unlike the single-doc methods above) — every real caller
   *   (StalenessProbeService) always wants ONE specific kind for this batch shape;
   *   there is no legitimate "any kind" batch use case today
   * @returns Map keyed by doc id; a doc with NO judgment of that kind is ABSENT from
   *   the map (never present with `null`). `ok(new Map())` immediately when `docIds`
   *   is empty (no query issued).
   * @see SPEC-044 §Design Decisions D2
   */
  latestJudgmentsByDocIds(
    docIds: DocId[],
    kind: ReviewJudgmentKind,
  ): Promise<Result<Map<DocId, ReviewJudgment>, LoreError>>;

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
