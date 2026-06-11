/**
 * TursoStore — @libsql/client implementation of StoreInterface.
 * Uses async @libsql/client.execute() for all operations.
 * Supports file-only mode (localPath) and embedded replica mode
 * (localPath + remoteUrl + authToken).
 *
 * FTS5 index: MIGRATION_001_SQL creates triggers (docs_ai/ad/au) that fire
 * automatically via libsql for INSERT, UPDATE, and DELETE operations on docs.
 * Verified by R1 spike (tests/unit/store/libsql-compat.bun.test.ts): triggers
 * are the sole FTS maintenance mechanism — no manual fts* calls needed.
 *
 * Source: SPEC-009 §3.1; AC-STORE-TURSO-001
 */

import { createClient, type Client, type InValue, type Row } from "@libsql/client";
import { MIGRATION_001_SQL } from "./migrations/migration-001.js";
import { MIGRATION_002_SQL } from "./migrations/migration-002.js";
import type {
  AuditEntry,
  DocId,
  DocRecord,
  LinkRecord,
  LinkType,
  Slug,
  VersionRecord,
} from "../core/types.js";
import { err, ok, type LoreError, type Result } from "../core/errors.js";
import type {
  AuditFilters,
  SearchHit,
  StoreFilters,
  StoreInterface,
  UpdateOpts,
} from "./store-interface.js";
import {
  rowToAuditEntry,
  rowToDocRecord,
  rowToLinkRecord,
  rowToVersionRecord,
  wrapStoreError,
  type AuditRow,
  type DocRow,
  type FtsRow,
  type LinkRow,
  type VersionRow,
} from "./store-shared.js";

// ─── Config ────────────────────────────────────────────────────────────────

export interface TursoConfig {
  /** Local SQLite file path (used as `file:<localPath>` URL). */
  localPath: string;
  /** Remote Turso sync URL. When set, enables embedded replica mode. */
  remoteUrl?: string;
  /** Auth token for the remote Turso database. */
  authToken?: string;
  /** Sync interval in seconds for embedded replica. Defaults to 60. */
  syncInterval?: number;
}

// ─── Row extraction helpers ────────────────────────────────────────────────
// libsql Row fields are accessed as row["field"] returning Value.
// Value = null | string | number | bigint | ArrayBuffer.
// These helpers safely extract typed values from libsql Row objects.
// This is the documented row-boundary guard — the only place `as` is used.

function rowStr(row: Row, col: string): string {
  const v = row[col];
  if (v === null || v === undefined) return "";
  return String(v);
}

function rowStrOrNull(row: Row, col: string): string | null {
  const v = row[col];
  if (v === null || v === undefined) return null;
  return String(v);
}

function rowNum(row: Row, col: string): number {
  const v = row[col];
  if (v === null || v === undefined) return 0;
  return Number(v);
}

/**
 * Convert a libsql Row (column-named access) to a DocRow-shaped plain object.
 * Row-boundary guard — this is the only `as`-cast site for libsql rows.
 */
function libsqlRowToDocRow(row: Row): DocRow {
  return {
    id: rowStr(row, "id"),
    slug: rowStr(row, "slug"),
    type: rowStr(row, "type"),
    role: rowStr(row, "role"),
    title: rowStr(row, "title"),
    status: rowStr(row, "status"),
    priority: rowStr(row, "priority"),
    content: rowStr(row, "content"),
    parent_id: rowStrOrNull(row, "parent_id"),
    extra: rowStr(row, "extra") || "{}",
    tags: rowStr(row, "tags") || "[]",
    version: rowNum(row, "version"),
    created_at: rowStr(row, "created_at"),
    updated_at: rowStr(row, "updated_at"),
    created_by: rowStr(row, "created_by"),
    deleted_at: rowStrOrNull(row, "deleted_at"),
  };
}

function libsqlRowToLinkRow(row: Row): LinkRow {
  return {
    from_id: rowStr(row, "from_id"),
    to_id: rowStr(row, "to_id"),
    link_type: rowStr(row, "link_type"),
    created_at: rowStr(row, "created_at"),
    created_by: rowStr(row, "created_by"),
  };
}

function libsqlRowToVersionRow(row: Row): VersionRow {
  return {
    doc_id: rowStr(row, "doc_id"),
    version: rowNum(row, "version"),
    content: rowStr(row, "content"),
    extra: rowStr(row, "extra") || "{}",
    status: rowStr(row, "status"),
    title: rowStr(row, "title"),
    action: rowStr(row, "action"),
    created_at: rowStr(row, "created_at"),
    created_by: rowStr(row, "created_by"),
    change_summary: rowStrOrNull(row, "change_summary"),
  };
}

function libsqlRowToAuditRow(row: Row): AuditRow {
  return {
    timestamp: rowStr(row, "timestamp"),
    actor: rowStr(row, "actor"),
    session_id: rowStr(row, "session_id"),
    action: rowStr(row, "action"),
    doc_id: rowStrOrNull(row, "doc_id"),
    details: rowStr(row, "details") || "{}",
  };
}

function libsqlRowToFtsRow(row: Row): FtsRow {
  return {
    id: rowStr(row, "id"),
    slug: rowStr(row, "slug"),
    title: rowStr(row, "title"),
    snippet: rowStr(row, "snippet"),
    rank: rowNum(row, "rank"),
  };
}

// ─── TursoStore ────────────────────────────────────────────────────────────

export class TursoStore implements StoreInterface {
  private readonly client: Client;
  private readonly hasRemote: boolean;

  constructor(config: TursoConfig) {
    const url = `file:${config.localPath}`;
    this.hasRemote = Boolean(config.remoteUrl);

    this.client = createClient(
      this.hasRemote
        ? {
            url,
            syncUrl: config.remoteUrl,
            authToken: config.authToken,
            syncInterval: config.syncInterval ?? 60,
            readYourWrites: true,
          }
        : { url },
    );

    // Schema init is async; run eagerly in constructor.
    // The promise is stored in _schemaInitPromise so ensureReady() can await it
    // and propagate the rejection as a STORE_ERROR Result on the first operation.
    // We attach a no-op .catch() here to mark the promise as handled at the
    // Node/Bun level, preventing an unhandledRejection event if initSchema rejects
    // before any caller awaits ensureReady(). The rejection is NOT swallowed —
    // ensureReady() re-awaits the stored promise and still throws, which public
    // methods catch and convert to { ok: false, error: STORE_ERROR }.
    this.initSchema().catch(() => { /* rejection surfaced via ensureReady() on first operation */ });
  }

  // ── Initialization ─────────────────────────────────────────────────────

  private _schemaInitPromise: Promise<void> | null = null;

  private initSchema(): Promise<void> {
    if (this._schemaInitPromise) return this._schemaInitPromise;

    this._schemaInitPromise = (async () => {
      // Check current schema version
      const versionRs = await this.client.execute("PRAGMA user_version");
      const currentVersion = versionRs.rows[0]
        ? rowNum(versionRs.rows[0], "user_version")
        : 0;

      if (currentVersion < 1) {
        await this.client.executeMultiple(MIGRATION_001_SQL);
      }

      if (currentVersion < 2) {
        await this.client.executeMultiple(MIGRATION_002_SQL);
      }
    })();

    return this._schemaInitPromise;
  }

  /** Ensure schema is initialized before any operation. */
  private async ensureReady(): Promise<void> {
    await this.initSchema();
  }

  // ── Document CRUD ─────────────────────────────────────────────────────

  async insert(doc: DocRecord): Promise<Result<DocRecord, LoreError>> {
    try {
      await this.ensureReady();

      await this.client.execute({
        sql: `INSERT INTO docs
               (id, slug, type, role, title, status, priority, content,
                parent_id, extra, tags, version, created_at, updated_at,
                created_by, deleted_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          doc.id,
          doc.slug,
          doc.type,
          doc.role,
          doc.title,
          doc.status,
          doc.priority,
          doc.content,
          doc.parent_id ?? null,
          JSON.stringify(doc.extra),
          JSON.stringify(doc.tags),
          doc.version,
          doc.created_at,
          doc.updated_at,
          doc.created_by,
          doc.deleted_at ?? null,
        ] as InValue[],
      });

      return ok(doc);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("UNIQUE constraint failed: docs.slug")) {
        return err({ code: "DUPLICATE_SLUG", slug: doc.slug, existing_id: doc.id });
      }
      // Duplicate PK also returns err (not throw)
      if (msg.includes("UNIQUE constraint failed: docs.id")) {
        return wrapStoreError(e);
      }
      return wrapStoreError(e);
    }
  }

  async find(id: DocId): Promise<Result<DocRecord | null, LoreError>> {
    try {
      await this.ensureReady();
      const rs = await this.client.execute({
        sql: "SELECT * FROM docs WHERE id = ?",
        args: [id],
      });
      const row = rs.rows[0];
      return ok(row ? rowToDocRecord(libsqlRowToDocRow(row)) : null);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async findBySlug(slug: Slug): Promise<Result<DocRecord | null, LoreError>> {
    try {
      await this.ensureReady();
      const rs = await this.client.execute({
        sql: "SELECT * FROM docs WHERE slug = ?",
        args: [slug],
      });
      const row = rs.rows[0];
      return ok(row ? rowToDocRecord(libsqlRowToDocRow(row)) : null);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async findMany(filters: StoreFilters): Promise<Result<DocRecord[], LoreError>> {
    try {
      await this.ensureReady();

      const clauses: string[] = [];
      const params: InValue[] = [];
      const excludeDeleted = filters.exclude_deleted !== false;

      if (excludeDeleted) {
        clauses.push("deleted_at IS NULL");
      }
      if (filters.type !== undefined) {
        clauses.push("type = ?");
        params.push(filters.type);
      }
      if (filters.status !== undefined) {
        clauses.push("status = ?");
        params.push(filters.status);
      }
      if (filters.parent_id !== undefined) {
        clauses.push("parent_id = ?");
        params.push(filters.parent_id);
      }
      if (filters.created_by !== undefined) {
        clauses.push("created_by = ?");
        params.push(filters.created_by);
      }
      if (filters.since !== undefined) {
        clauses.push("updated_at >= ?");
        params.push(filters.since);
      }

      const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
      const sql = `SELECT * FROM docs ${whereClause} ORDER BY updated_at DESC`;

      const rs = await this.client.execute({ sql, args: params });
      let records = rs.rows.map((row) => rowToDocRecord(libsqlRowToDocRow(row)));

      // tags filter applied in-memory (JSON stored as string)
      if (filters.tags && filters.tags.length > 0) {
        const requiredTags = filters.tags;
        records = records.filter((doc) =>
          requiredTags.every((tag) => doc.tags.includes(tag)),
        );
      }

      return ok(records);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  /**
   * Apply a partial patch to an existing doc.
   * When opts.expected_version is provided, performs a conditional UPDATE
   * (AND version = ?). Zero changes → DOC_NOT_FOUND or STALE_VERSION.
   * Manually updates FTS5 index on content changes.
   */
  async update(
    id: DocId,
    patch: Partial<DocRecord>,
    opts?: UpdateOpts,
  ): Promise<Result<DocRecord, LoreError>> {
    try {
      await this.ensureReady();

      // Fetch existing row first (needed for merge + NOT FOUND check)
      const existingRs = await this.client.execute({
        sql: "SELECT * FROM docs WHERE id = ?",
        args: [id],
      });
      const existingRow = existingRs.rows[0];

      if (!existingRow) {
        return err({ code: "DOC_NOT_FOUND", id });
      }

      const current = rowToDocRecord(libsqlRowToDocRow(existingRow));
      const updated: DocRecord = {
        ...current,
        ...patch,
        id: current.id, // id is immutable
      };

      if (opts?.expected_version !== undefined) {
        // Conditional UPDATE: WHERE id = ? AND version = ?
        const updateRs = await this.client.execute({
          sql: `UPDATE docs SET
                 slug = ?, type = ?, role = ?, title = ?, status = ?,
                 priority = ?, content = ?, parent_id = ?, extra = ?,
                 tags = ?, version = ?, created_at = ?, updated_at = ?,
                 created_by = ?, deleted_at = ?
               WHERE id = ? AND version = ?`,
          args: [
            updated.slug,
            updated.type,
            updated.role,
            updated.title,
            updated.status,
            updated.priority,
            updated.content,
            updated.parent_id ?? null,
            JSON.stringify(updated.extra),
            JSON.stringify(updated.tags),
            updated.version,
            updated.created_at,
            updated.updated_at,
            updated.created_by,
            updated.deleted_at ?? null,
            id,
            opts.expected_version,
          ] as InValue[],
        });

        if (updateRs.rowsAffected === 0) {
          // Row exists (checked above) but version didn't match — re-read actual
          const actualRs = await this.client.execute({
            sql: "SELECT version FROM docs WHERE id = ?",
            args: [id],
          });
          const actualRow = actualRs.rows[0];

          if (!actualRow) {
            // Deleted between our SELECT and UPDATE (race)
            return err({ code: "DOC_NOT_FOUND", id });
          }

          return err({
            code: "STALE_VERSION",
            id,
            expected: opts.expected_version,
            actual: rowNum(actualRow, "version"),
          });
        }

        return ok(updated);
      }

      // Unconditional UPDATE — backward-compatible path
      await this.client.execute({
        sql: `UPDATE docs SET
               slug = ?, type = ?, role = ?, title = ?, status = ?,
               priority = ?, content = ?, parent_id = ?, extra = ?,
               tags = ?, version = ?, created_at = ?, updated_at = ?,
               created_by = ?, deleted_at = ?
             WHERE id = ?`,
        args: [
          updated.slug,
          updated.type,
          updated.role,
          updated.title,
          updated.status,
          updated.priority,
          updated.content,
          updated.parent_id ?? null,
          JSON.stringify(updated.extra),
          JSON.stringify(updated.tags),
          updated.version,
          updated.created_at,
          updated.updated_at,
          updated.created_by,
          updated.deleted_at ?? null,
          id,
        ] as InValue[],
      });

      return ok(updated);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async softDelete(id: DocId): Promise<Result<void, LoreError>> {
    try {
      await this.ensureReady();

      const existingRs = await this.client.execute({
        sql: "SELECT id FROM docs WHERE id = ?",
        args: [id],
      });

      if (!existingRs.rows[0]) {
        return err({ code: "DOC_NOT_FOUND", id });
      }

      const now = new Date().toISOString();
      await this.client.execute({
        sql: "UPDATE docs SET deleted_at = ? WHERE id = ?",
        args: [now, id],
      });

      return ok(undefined);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  // ── Links ─────────────────────────────────────────────────────────────

  async addLink(link: LinkRecord): Promise<Result<LinkRecord, LoreError>> {
    try {
      await this.ensureReady();

      if (link.link_type === "parent") {
        const cycleResult = await this.detectParentCycle(link.from_id, link.to_id);
        if (!cycleResult.ok) return cycleResult;
      }

      await this.client.execute({
        sql: `INSERT INTO links (from_id, to_id, link_type, created_at, created_by)
               VALUES (?, ?, ?, ?, ?)`,
        args: [link.from_id, link.to_id, link.link_type, link.created_at, link.created_by],
      });

      return ok(link);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("UNIQUE constraint failed: links.")) {
        return err({
          code: "DUPLICATE_LINK",
          from: link.from_id,
          to: link.to_id,
          type: link.link_type,
        });
      }
      return wrapStoreError(e);
    }
  }

  /**
   * Detect whether adding from_id → to_id parent link would create a cycle.
   * Walks the parent chain from to_id upward; if from_id appears, it's a cycle.
   */
  private async detectParentCycle(
    fromId: DocId,
    toId: DocId,
  ): Promise<Result<void, LoreError>> {
    const path: string[] = [fromId, toId];
    let current = toId;

    while (true) {
      const rs = await this.client.execute({
        sql: "SELECT to_id FROM links WHERE from_id = ? AND link_type = 'parent' LIMIT 1",
        args: [current],
      });

      const row = rs.rows[0];
      if (!row) break;

      const parentId = rowStr(row, "to_id");
      if (parentId === fromId) {
        return err({ code: "LINK_CYCLE", path: [...path, parentId] });
      }
      path.push(parentId);
      current = parentId;
    }

    return ok(undefined);
  }

  async removeLink(
    fromId: DocId,
    toId: DocId,
    linkType: LinkType,
  ): Promise<Result<void, LoreError>> {
    try {
      await this.ensureReady();
      await this.client.execute({
        sql: "DELETE FROM links WHERE from_id = ? AND to_id = ? AND link_type = ?",
        args: [fromId, toId, linkType],
      });
      return ok(undefined);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async findLinks(
    docId: DocId,
    direction: "in" | "out" | "both",
  ): Promise<Result<LinkRecord[], LoreError>> {
    try {
      await this.ensureReady();

      let rs;
      if (direction === "out") {
        rs = await this.client.execute({
          sql: "SELECT * FROM links WHERE from_id = ?",
          args: [docId],
        });
      } else if (direction === "in") {
        rs = await this.client.execute({
          sql: "SELECT * FROM links WHERE to_id = ?",
          args: [docId],
        });
      } else {
        rs = await this.client.execute({
          sql: "SELECT * FROM links WHERE from_id = ? OR to_id = ?",
          args: [docId, docId],
        });
      }

      return ok(rs.rows.map((row) => rowToLinkRecord(libsqlRowToLinkRow(row))));
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  // ── Search ────────────────────────────────────────────────────────────

  async search(
    query: string,
    filters?: StoreFilters,
  ): Promise<Result<SearchHit[], LoreError>> {
    try {
      await this.ensureReady();

      const excludeDeleted = filters?.exclude_deleted !== false;
      const docClauses: string[] = [];
      const docParams: InValue[] = [query];

      if (excludeDeleted) {
        docClauses.push("d.deleted_at IS NULL");
      }
      if (filters?.type !== undefined) {
        docClauses.push("d.type = ?");
        docParams.push(filters.type);
      }
      if (filters?.status !== undefined) {
        docClauses.push("d.status = ?");
        docParams.push(filters.status);
      }

      const docWhere = docClauses.length > 0 ? `AND ${docClauses.join(" AND ")}` : "";

      const sql = `
        SELECT
          d.id,
          d.slug,
          d.title,
          snippet(docs_fts, 1, '[', ']', '...', 32) AS snippet,
          f.rank
        FROM docs_fts f
        JOIN docs d ON d.rowid = f.rowid
        WHERE docs_fts MATCH ?
          ${docWhere}
        ORDER BY f.rank
      `;

      const rs = await this.client.execute({ sql, args: docParams });
      const hits: SearchHit[] = rs.rows.map((row) => {
        const ftsRow = libsqlRowToFtsRow(row);
        return {
          id: ftsRow.id,
          slug: ftsRow.slug,
          title: ftsRow.title,
          snippet: ftsRow.snippet ?? "",
          score: Number(ftsRow.rank),
        };
      });

      // Tags filter applied in-memory if needed
      if (filters?.tags && filters.tags.length > 0) {
        const requiredTags = filters.tags;
        const filtered: SearchHit[] = [];
        for (const hit of hits) {
          const docResult = await this.find(hit.id);
          if (!docResult.ok) continue;
          const doc = docResult.value;
          if (!doc) continue;
          if (requiredTags.every((tag) => doc.tags.includes(tag))) {
            filtered.push(hit);
          }
        }
        return ok(filtered);
      }

      return ok(hits);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  // ── Versions ──────────────────────────────────────────────────────────

  async insertVersion(version: VersionRecord): Promise<Result<VersionRecord, LoreError>> {
    try {
      await this.ensureReady();
      await this.client.execute({
        sql: `INSERT INTO versions
               (doc_id, version, content, extra, status, title,
                action, created_at, created_by, change_summary)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          version.doc_id,
          version.version,
          version.content,
          JSON.stringify(version.extra),
          version.status,
          version.title,
          version.action,
          version.created_at,
          version.created_by,
          version.change_summary ?? null,
        ] as InValue[],
      });
      return ok(version);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async findVersions(
    docId: DocId,
    opts?: { limit?: number; offset?: number },
  ): Promise<Result<VersionRecord[], LoreError>> {
    try {
      await this.ensureReady();
      const limit = opts?.limit ?? 100;
      const offset = opts?.offset ?? 0;
      const rs = await this.client.execute({
        sql: `SELECT * FROM versions
               WHERE doc_id = ?
               ORDER BY version DESC
               LIMIT ? OFFSET ?`,
        args: [docId, limit, offset],
      });
      return ok(rs.rows.map((row) => rowToVersionRecord(libsqlRowToVersionRow(row))));
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  // ── Audit ─────────────────────────────────────────────────────────────

  async appendAuditEntry(entry: AuditEntry): Promise<Result<void, LoreError>> {
    try {
      await this.ensureReady();
      await this.client.execute({
        sql: `INSERT INTO audit
               (timestamp, actor, session_id, action, doc_id, details)
             VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          entry.timestamp,
          entry.actor,
          entry.session_id,
          entry.action,
          entry.doc_id ?? null,
          JSON.stringify(entry.details ?? {}),
        ] as InValue[],
      });
      return ok(undefined);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async queryAudit(filters: AuditFilters): Promise<Result<AuditEntry[], LoreError>> {
    try {
      await this.ensureReady();

      const clauses: string[] = [];
      const params: InValue[] = [];

      if (filters.doc_id !== undefined) {
        clauses.push("doc_id = ?");
        params.push(filters.doc_id);
      }
      if (filters.actor !== undefined) {
        clauses.push("actor = ?");
        params.push(filters.actor);
      }
      if (filters.action !== undefined) {
        clauses.push("action = ?");
        params.push(filters.action);
      }
      if (filters.since !== undefined) {
        clauses.push("timestamp >= ?");
        params.push(filters.since);
      }

      const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
      const limitClause = filters.limit !== undefined ? `LIMIT ${filters.limit}` : "";
      const sql = `SELECT * FROM audit ${whereClause} ORDER BY timestamp DESC ${limitClause}`;

      const rs = await this.client.execute({ sql, args: params });
      return ok(rs.rows.map((row) => rowToAuditEntry(libsqlRowToAuditRow(row))));
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  // ── Sync ──────────────────────────────────────────────────────────────

  /**
   * Sync embedded replica with remote Turso.
   * File-only mode (no remoteUrl): always returns STORE_ERROR — sync not supported.
   * With remoteUrl: calls client.sync() and returns frame metadata.
   */
  async sync(): Promise<Result<{ frameNo: number; framesSynced: number } | void, LoreError>> {
    if (!this.hasRemote) {
      return err({
        code: "STORE_ERROR",
        message: "sync is not supported in file-only mode (no remoteUrl configured)",
      });
    }

    try {
      await this.ensureReady();
      const replicated = await this.client.sync();
      if (replicated) {
        return ok({ frameNo: replicated.frame_no, framesSynced: replicated.frames_synced });
      }
      return ok(undefined);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  close(): void {
    this.client.close();
  }

}
