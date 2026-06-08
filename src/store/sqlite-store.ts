/**
 * SQLiteStore — bun:sqlite implementation of StoreInterface.
 * Methods are async to satisfy the async StoreInterface contract,
 * but internally use synchronous bun:sqlite operations.
 * Source: SPEC-002 §7.1, §7.2, §7.3; SPEC-001 §4.
 */

import { Database, type SQLQueryBindings } from "bun:sqlite";
import { MIGRATION_001_SQL } from "./migrations/migration-001.js";
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
} from "./store-interface.js";

// ─── Raw DB row types ──────────────────────────────────────────────────────

interface DocRow {
  id: string;
  slug: string;
  type: string;
  role: string;
  title: string;
  status: string;
  priority: string;
  content: string;
  parent_id: string | null;
  extra: string;
  tags: string;
  version: number;
  created_at: string;
  updated_at: string;
  created_by: string;
  deleted_at: string | null;
}

interface LinkRow {
  from_id: string;
  to_id: string;
  link_type: string;
  created_at: string;
  created_by: string;
}

interface VersionRow {
  doc_id: string;
  version: number;
  content: string;
  extra: string;
  status: string;
  title: string;
  action: string;
  created_at: string;
  created_by: string;
  change_summary: string | null;
}

interface AuditRow {
  timestamp: string;
  actor: string;
  session_id: string;
  action: string;
  doc_id: string | null;
  details: string;
}

interface FtsRow {
  id: string;
  slug: string;
  title: string;
  snippet: string;
  rank: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function rowToDocRecord(row: DocRow): DocRecord {
  return {
    id: row.id,
    slug: row.slug,
    type: row.type as DocRecord["type"],
    role: row.role as DocRecord["role"],
    title: row.title,
    status: row.status as DocRecord["status"],
    priority: row.priority as DocRecord["priority"],
    content: row.content,
    parent_id: row.parent_id,
    extra: parseJson(row.extra, {}),
    tags: parseJson(row.tags, []),
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by: row.created_by,
    deleted_at: row.deleted_at,
  };
}

function rowToLinkRecord(row: LinkRow): LinkRecord {
  return {
    from_id: row.from_id,
    to_id: row.to_id,
    link_type: row.link_type as LinkType,
    created_at: row.created_at,
    created_by: row.created_by,
  };
}

function rowToVersionRecord(row: VersionRow): VersionRecord {
  return {
    doc_id: row.doc_id,
    version: row.version,
    content: row.content,
    extra: parseJson(row.extra, {}),
    status: row.status as VersionRecord["status"],
    title: row.title,
    action: row.action as VersionRecord["action"],
    created_at: row.created_at,
    created_by: row.created_by,
    ...(row.change_summary !== null
      ? { change_summary: row.change_summary }
      : {}),
  };
}

function rowToAuditEntry(row: AuditRow): AuditEntry {
  return {
    timestamp: row.timestamp,
    actor: row.actor,
    session_id: row.session_id,
    action: row.action,
    ...(row.doc_id !== null ? { doc_id: row.doc_id } : {}),
    details: parseJson(row.details, {}),
  };
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function wrapStoreError(e: unknown): Result<never, LoreError> {
  const message =
    e instanceof Error ? e.message : "Unknown SQLite error";
  if (e instanceof Error) {
    return err({ code: "STORE_ERROR", message, cause: e });
  }
  return err({ code: "STORE_ERROR", message });
}

// ─── SQLiteStore ─────────────────────────────────────────────────────────────

export class SQLiteStore implements StoreInterface {
  private readonly db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.init();
  }

  // ── Initialization ────────────────────────────────────────────────────────

  private init(): void {
    // Enable WAL for better concurrent read performance
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run("PRAGMA foreign_keys = ON");
    this.runMigrations();
  }

  private runMigrations(): void {
    const currentVersion = (
      this.db.query("PRAGMA user_version").get() as { user_version: number }
    ).user_version;

    if (currentVersion < 1) {
      // SQL is inlined as a constant — safe for bun build --compile (no fs access at runtime)
      this.db.exec(MIGRATION_001_SQL);
    }
  }

  // ── Document CRUD ─────────────────────────────────────────────────────────

  async insert(doc: DocRecord): Promise<Result<DocRecord, LoreError>> {
    try {
      this.db
        .prepare(
          `INSERT INTO docs
             (id, slug, type, role, title, status, priority, content,
              parent_id, extra, tags, version, created_at, updated_at,
              created_by, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
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
        );
      return ok(doc);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("UNIQUE constraint failed: docs.slug")) {
        return err({
          code: "DUPLICATE_SLUG",
          slug: doc.slug,
          existing_id: doc.id,
        });
      }
      return wrapStoreError(e);
    }
  }

  async find(id: DocId): Promise<Result<DocRecord | null, LoreError>> {
    try {
      const row = this.db
        .prepare("SELECT * FROM docs WHERE id = ?")
        .get(id) as DocRow | null;
      return ok(row ? rowToDocRecord(row) : null);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async findBySlug(slug: Slug): Promise<Result<DocRecord | null, LoreError>> {
    try {
      const row = this.db
        .prepare("SELECT * FROM docs WHERE slug = ?")
        .get(slug) as DocRow | null;
      return ok(row ? rowToDocRecord(row) : null);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async findMany(filters: StoreFilters): Promise<Result<DocRecord[], LoreError>> {
    try {
      const clauses: string[] = [];
      const params: SQLQueryBindings[] = [];
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

      const whereClause =
        clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
      const sql = `SELECT * FROM docs ${whereClause} ORDER BY updated_at DESC`;
      const rows = this.db.prepare(sql).all(...params) as DocRow[];
      let records = rows.map(rowToDocRecord);

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

  async update(id: DocId, patch: Partial<DocRecord>): Promise<Result<DocRecord, LoreError>> {
    try {
      const existing = this.db
        .prepare("SELECT * FROM docs WHERE id = ?")
        .get(id) as DocRow | null;

      if (!existing) {
        return err({ code: "DOC_NOT_FOUND", id });
      }

      const current = rowToDocRecord(existing);
      const updated: DocRecord = {
        ...current,
        ...patch,
        id: current.id, // id is immutable
      };

      this.db
        .prepare(
          `UPDATE docs SET
             slug = ?, type = ?, role = ?, title = ?, status = ?,
             priority = ?, content = ?, parent_id = ?, extra = ?,
             tags = ?, version = ?, created_at = ?, updated_at = ?,
             created_by = ?, deleted_at = ?
           WHERE id = ?`,
        )
        .run(
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
        );

      return ok(updated);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async softDelete(id: DocId): Promise<Result<void, LoreError>> {
    try {
      const existing = this.db
        .prepare("SELECT id FROM docs WHERE id = ?")
        .get(id) as { id: string } | null;

      if (!existing) {
        return err({ code: "DOC_NOT_FOUND", id });
      }

      const now = new Date().toISOString();
      this.db
        .prepare("UPDATE docs SET deleted_at = ? WHERE id = ?")
        .run(now, id);

      return ok(undefined);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  // ── Links ─────────────────────────────────────────────────────────────────

  async addLink(link: LinkRecord): Promise<Result<LinkRecord, LoreError>> {
    try {
      if (link.link_type === "parent") {
        const cycleResult = this.detectParentCycle(link.from_id, link.to_id);
        if (!cycleResult.ok) return cycleResult;
      }

      this.db
        .prepare(
          `INSERT INTO links (from_id, to_id, link_type, created_at, created_by)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          link.from_id,
          link.to_id,
          link.link_type,
          link.created_at,
          link.created_by,
        );

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
   * Detect whether adding a parent link from_id → to_id would create a cycle.
   * Walks the parent chain from to_id upward; if from_id appears, it's a cycle.
   */
  private detectParentCycle(
    fromId: DocId,
    toId: DocId,
  ): Result<void, LoreError> {
    const path: string[] = [fromId, toId];
    let current = toId;

    while (true) {
      const row = this.db
        .prepare(
          `SELECT to_id FROM links WHERE from_id = ? AND link_type = 'parent' LIMIT 1`,
        )
        .get(current) as { to_id: string } | null;

      if (!row) break;

      const parentId = row.to_id;
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
      this.db
        .prepare(
          "DELETE FROM links WHERE from_id = ? AND to_id = ? AND link_type = ?",
        )
        .run(fromId, toId, linkType);
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
      let rows: LinkRow[];

      if (direction === "out") {
        rows = this.db
          .prepare("SELECT * FROM links WHERE from_id = ?")
          .all(docId) as LinkRow[];
      } else if (direction === "in") {
        rows = this.db
          .prepare("SELECT * FROM links WHERE to_id = ?")
          .all(docId) as LinkRow[];
      } else {
        rows = this.db
          .prepare("SELECT * FROM links WHERE from_id = ? OR to_id = ?")
          .all(docId, docId) as LinkRow[];
      }

      return ok(rows.map(rowToLinkRecord));
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  // ── Search ────────────────────────────────────────────────────────────────

  async search(
    query: string,
    filters?: StoreFilters,
  ): Promise<Result<SearchHit[], LoreError>> {
    try {
      const excludeDeleted = filters?.exclude_deleted !== false;

      // Build WHERE clause for docs table join
      const docClauses: string[] = [];
      const docParams: SQLQueryBindings[] = [];

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

      const docWhere =
        docClauses.length > 0 ? `AND ${docClauses.join(" AND ")}` : "";

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

      const rows = this.db
        .prepare(sql)
        .all(query, ...docParams) as FtsRow[];

      const hits: SearchHit[] = rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        title: row.title,
        snippet: row.snippet ?? "",
        score: row.rank,
      }));

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

  // ── Versions ──────────────────────────────────────────────────────────────

  async insertVersion(version: VersionRecord): Promise<Result<VersionRecord, LoreError>> {
    try {
      this.db
        .prepare(
          `INSERT INTO versions
             (doc_id, version, content, extra, status, title,
              action, created_at, created_by, change_summary)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
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
        );
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
      const limit = opts?.limit ?? 100;
      const offset = opts?.offset ?? 0;
      const rows = this.db
        .prepare(
          `SELECT * FROM versions
           WHERE doc_id = ?
           ORDER BY version DESC
           LIMIT ? OFFSET ?`,
        )
        .all(docId, limit, offset) as VersionRow[];
      return ok(rows.map(rowToVersionRecord));
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  // ── Audit ─────────────────────────────────────────────────────────────────

  async appendAuditEntry(entry: AuditEntry): Promise<Result<void, LoreError>> {
    try {
      this.db
        .prepare(
          `INSERT INTO audit
             (timestamp, actor, session_id, action, doc_id, details)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          entry.timestamp,
          entry.actor,
          entry.session_id,
          entry.action,
          entry.doc_id ?? null,
          JSON.stringify(entry.details ?? {}),
        );
      return ok(undefined);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async queryAudit(filters: AuditFilters): Promise<Result<AuditEntry[], LoreError>> {
    try {
      const clauses: string[] = [];
      const params: SQLQueryBindings[] = [];

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

      const whereClause =
        clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
      const limitClause = filters.limit !== undefined ? `LIMIT ${filters.limit}` : "";
      const sql = `SELECT * FROM audit ${whereClause} ORDER BY timestamp DESC ${limitClause}`;

      const rows = this.db.prepare(sql).all(...params) as AuditRow[];
      return ok(rows.map(rowToAuditEntry));
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  close(): void {
    this.db.close();
  }
}
