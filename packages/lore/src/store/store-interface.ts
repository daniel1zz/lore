/**
 * StoreInterface — storage abstraction for the Lore corpus.
 * All methods return Promise<Result<T, LoreError>> for Turso/libSQL async compatibility.
 * SQLiteStore wraps sync bun:sqlite calls in async methods.
 * Source: SPEC-001 §4, adapted to use Result<T, LoreError> per task spec.
 */

import type {
  AuditEntry,
  DocId,
  DocRecord,
  DocStatus,
  DocType,
  LinkRecord,
  LinkType,
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

  // ── Audit ──────────────────────────────────────────────────────────────

  /** Append an immutable audit entry. */
  appendAuditEntry(entry: AuditEntry): Promise<Result<void, LoreError>>;

  /** Query audit log with filters. */
  queryAudit(filters: AuditFilters): Promise<Result<AuditEntry[], LoreError>>;

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
