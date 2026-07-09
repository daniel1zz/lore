/**
 * SQLiteStore — bun:sqlite implementation of StoreInterface.
 * Methods are async to satisfy the async StoreInterface contract,
 * but internally use synchronous bun:sqlite operations.
 * Source: SPEC-002 §7.1, §7.2, §7.3; SPEC-001 §4.
 */

import { Database, type SQLQueryBindings } from "bun:sqlite";
import { MIGRATION_001_SQL } from "./migrations/migration-001.js";
import { MIGRATION_002_SQL } from "./migrations/migration-002.js";
import { MIGRATION_003_SQL } from "./migrations/migration-003.js";
import { MIGRATION_004_SQL } from "./migrations/migration-004.js";
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
import {
  err,
  ok,
  SNIPPET_MARK_CLOSE,
  SNIPPET_MARK_OPEN,
  type LoreError,
  type Result,
} from "@lore/core";
import type {
  AuditFilters,
  CalibrationRecordWithPromptVersion,
  CalibrationWindowFilter,
  SearchHit,
  StoreFilters,
  StoreInterface,
  UpdateOpts,
} from "./store-interface.js";
import {
  type AuditRow,
  type CalibrationRowWithPromptVersion,
  type DocRow,
  type FtsRow,
  type JudgmentRow,
  type LinkRow,
  type VersionRow,
  escapeFtsQuery,
  rowToAuditEntry,
  rowToCalibrationRecordWithPromptVersion,
  rowToDocRecord,
  rowToLinkRecord,
  rowToReviewJudgment,
  rowToVersionRecord,
  wrapStoreError,
} from "./store-shared.js";

// ─── SQLiteStore ─────────────────────────────────────────────────────────────

export class SQLiteStore implements StoreInterface {
  private readonly db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.init();
  }

  /**
   * Expose the underlying Database for adapters that need direct SQL access
   * (e.g. ApiKeyStore for the api_keys table).
   * Prefer StoreInterface methods for corpus operations.
   */
  getDatabase(): Database {
    return this.db;
  }

  // ── Initialization ────────────────────────────────────────────────────────

  private init(): void {
    // Enable WAL for better concurrent read performance
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run("PRAGMA foreign_keys = ON");
    this.runMigrations();
  }

  /**
   * Applies every pending migration in order, gated by `PRAGMA user_version`.
   *
   * @invariant migration-004 is wrapped in its own `BEGIN IMMEDIATE; ... COMMIT;`
   *   (see `migrations/migration-004.ts`'s module JSDoc) — this is the FIRST
   *   migration in the file that needs it (001-003 are pure additive `CREATE
   *   TABLE/INDEX IF NOT EXISTS`, safe to re-run statement-by-statement even
   *   half-applied). bun:sqlite's `db.exec()` (`Database.exec = Database.run`)
   *   does NOT auto-rollback when a statement inside a multi-statement string
   *   throws — reproduced empirically: after a caught `exec()` error mid an
   *   explicit `BEGIN`, `db.inTransaction` stays `true` until something issues
   *   `ROLLBACK`. Left unhandled, that would wedge this connection in an open
   *   transaction for the rest of the process's lifetime (every subsequent
   *   statement — migrations 1-3 included, and all later CRUD — would silently
   *   execute inside that dangling transaction instead of autocommitting). The
   *   catch below issues an explicit `ROLLBACK` before re-throwing so a failed
   *   migration-004 leaves the connection exactly as unmigrated as it found it.
   */
  private runMigrations(): void {
    const currentVersion = (
      this.db.query("PRAGMA user_version").get() as { user_version: number }
    ).user_version;

    if (currentVersion < 1) {
      // SQL is inlined as a constant — safe for bun build --compile (no fs access at runtime)
      this.db.exec(MIGRATION_001_SQL);
    }

    if (currentVersion < 2) {
      this.db.exec(MIGRATION_002_SQL);
    }

    if (currentVersion < 3) {
      this.db.exec(MIGRATION_003_SQL);
    }

    if (currentVersion < 4) {
      try {
        this.db.exec(MIGRATION_004_SQL);
      } catch (error) {
        try {
          this.db.exec("ROLLBACK;");
        } catch {
          // reason: ROLLBACK itself throws only when there is no open
          // transaction to roll back (e.g. the migration's own `BEGIN
          // IMMEDIATE` never ran because the syntax error was in the BEGIN
          // statement itself) — safe to ignore; `error` below is what the
          // caller needs to see.
        }
        throw error;
      }
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

  /**
   * Apply a partial patch to an existing doc.
   * When opts.expected_version is provided, the UPDATE includes AND version = ?
   * (conditional CAS). If zero rows are affected:
   *   - row absent → DOC_NOT_FOUND
   *   - row present with different version → STALE_VERSION{id, expected, actual}
   * When opts is omitted or expected_version is not set, unconditional update.
   * @see UpdateOpts for full contract.
   */
  async update(
    id: DocId,
    patch: Partial<DocRecord>,
    opts?: UpdateOpts,
  ): Promise<Result<DocRecord, LoreError>> {
    try {
      const existingRow = this.db
        .prepare("SELECT * FROM docs WHERE id = ?")
        .get(id) as DocRow | null;

      if (!existingRow) {
        return err({ code: "DOC_NOT_FOUND", id });
      }

      const current = rowToDocRecord(existingRow);
      const updated: DocRecord = {
        ...current,
        ...patch,
        id: current.id, // id is immutable
      };

      if (opts?.expected_version !== undefined) {
        // Conditional UPDATE: only affects the row if version still matches
        const result = this.db
          .prepare(
            `UPDATE docs SET
               slug = ?, type = ?, role = ?, title = ?, status = ?,
               priority = ?, content = ?, parent_id = ?, extra = ?,
               tags = ?, version = ?, created_at = ?, updated_at = ?,
               created_by = ?, deleted_at = ?
             WHERE id = ? AND version = ?`,
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
            opts.expected_version,
          );

        if (result.changes === 0) {
          // Row exists (checked above) but version didn't match — re-read actual version
          const actualRow = this.db
            .prepare("SELECT version FROM docs WHERE id = ?")
            .get(id) as { version: number } | null;

          if (!actualRow) {
            // Deleted between our SELECT and the UPDATE (race) — treat as not found
            return err({ code: "DOC_NOT_FOUND", id });
          }

          return err({
            code: "STALE_VERSION",
            id,
            expected: opts.expected_version,
            actual: actualRow.version,
          });
        }

        return ok(updated);
      }

      // Unconditional UPDATE — backward-compatible path
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

  async findLinksByToIds(
    toIds: DocId[],
    linkType: LinkType,
  ): Promise<Result<LinkRecord[], LoreError>> {
    if (toIds.length === 0) return ok([]);
    try {
      const placeholders = toIds.map(() => "?").join(", ");
      const rows = this.db
        .prepare(
          `SELECT * FROM links WHERE to_id IN (${placeholders}) AND link_type = ?`,
        )
        .all(...(toIds as SQLQueryBindings[]), linkType) as LinkRow[];
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
      const safeQuery = escapeFtsQuery(query);
      // reason: FTS5 MATCH errors on empty expression — short-circuit here so
      // we never pass an empty string to SQLite. Callers expect empty query →
      // zero results, not an error. See SPEC-013 §3.5.
      if (safeQuery === "") return ok([]);

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
          snippet(docs_fts, 1, ?, ?, '...', 32) AS snippet,
          f.rank,
          d.type,
          d.status
        FROM docs_fts f
        JOIN docs d ON d.rowid = f.rowid
        WHERE docs_fts MATCH ?
          ${docWhere}
        ORDER BY f.rank
      `;

      const rows = this.db
        .prepare(sql)
        .all(
          SNIPPET_MARK_OPEN,
          SNIPPET_MARK_CLOSE,
          safeQuery,
          ...docParams,
        ) as FtsRow[];

      const hits: SearchHit[] = rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        title: row.title,
        snippet: row.snippet ?? "",
        // FTS5 rank is a BM25 float; bun:sqlite may return bigint for integer columns
        // but BM25 scores are fractional so Number() is safe here.
        score: typeof row.rank === "bigint" ? Number(row.rank) : row.rank,
        type: row.type as DocType,
        status: row.status as DocStatus,
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

  async listAllVersions(since?: string): Promise<Result<VersionRecord[], LoreError>> {
    try {
      const rows =
        since !== undefined
          ? (this.db
              .prepare(`SELECT * FROM versions WHERE created_at >= ? ORDER BY created_at ASC`)
              .all(since) as VersionRow[])
          : (this.db.prepare(`SELECT * FROM versions ORDER BY created_at ASC`).all() as VersionRow[]);
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

  // ── Review Judgments ───────────────────────────────────────────────────────

  async insertJudgment(judgment: ReviewJudgment): Promise<Result<void, LoreError>> {
    try {
      this.db
        .prepare(
          `INSERT INTO review_judgments
             (id, doc_id, doc_version, decision, confidence, reasons, checks,
              blocking_questions, judge_provider, judge_model, judge_prompt_version,
              created_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          judgment.id,
          judgment.doc_id,
          judgment.doc_version,
          judgment.decision,
          judgment.confidence,
          JSON.stringify(judgment.reasons),
          JSON.stringify(judgment.checks),
          JSON.stringify(judgment.blocking_questions),
          judgment.judge.provider,
          judgment.judge.model,
          judgment.judge.prompt_version,
          judgment.created_at,
          judgment.created_by,
        );
      return ok(undefined);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async findJudgments(docId: DocId): Promise<Result<ReviewJudgment[], LoreError>> {
    try {
      const rows = this.db
        .prepare(
          "SELECT * FROM review_judgments WHERE doc_id = ? ORDER BY created_at DESC",
        )
        .all(docId) as JudgmentRow[];
      return ok(rows.map(rowToReviewJudgment));
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async latestJudgment(docId: DocId): Promise<Result<ReviewJudgment | null, LoreError>> {
    try {
      const row = this.db
        .prepare(
          "SELECT * FROM review_judgments WHERE doc_id = ? ORDER BY created_at DESC LIMIT 1",
        )
        .get(docId) as JudgmentRow | null;
      return ok(row ? rowToReviewJudgment(row) : null);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  // ── Calibration Records ─────────────────────────────────────────────────────

  async insertCalibrationRecord(record: CalibrationRecord): Promise<Result<void, LoreError>> {
    try {
      this.db
        .prepare(
          `INSERT INTO calibration_records
             (id, judgment_id, doc_id, doc_type, human_outcome, delta_reasons, actor, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.id,
          record.judgment_id,
          record.doc_id,
          record.doc_type,
          record.human_outcome,
          JSON.stringify(record.delta_reasons),
          record.actor,
          record.created_at,
        );
      return ok(undefined);
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  async queryCalibrationWindow(
    filter: CalibrationWindowFilter,
  ): Promise<Result<CalibrationRecordWithPromptVersion[], LoreError>> {
    try {
      // reason: the JOIN to review_judgments is now UNCONDITIONAL (not just when
      // filter.prompt_version is pinned) — every returned record must carry the
      // judgment's real judge_prompt_version so JudgmentService.computeCalibrationStats
      // can group by the actual (doc_type, prompt_version) pair instead of falling back
      // to an unpinned "*" sentinel. Still one indexed statement, not an N+1 fan-out.
      // See SPEC-034 §3 / SPEC-035 calibration disaggregation follow-up.
      const clauses: string[] = [];
      const params: SQLQueryBindings[] = [];

      if (filter.doc_type !== undefined) {
        clauses.push("c.doc_type = ?");
        params.push(filter.doc_type);
      }
      if (filter.prompt_version !== undefined) {
        clauses.push("j.judge_prompt_version = ?");
        params.push(filter.prompt_version);
      }

      const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
      const sql = `
        SELECT c.*, j.judge_prompt_version AS judge_prompt_version
        FROM calibration_records c
        JOIN review_judgments j ON j.id = c.judgment_id
        ${whereClause}
        ORDER BY c.created_at DESC
        LIMIT ?
      `;
      params.push(filter.limit);

      const rows = this.db.prepare(sql).all(...params) as CalibrationRowWithPromptVersion[];
      return ok(rows.map(rowToCalibrationRecordWithPromptVersion));
    } catch (e) {
      return wrapStoreError(e);
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  close(): void {
    this.db.close();
  }

  async dbSizeBytes(): Promise<Result<number, LoreError>> {
    try {
      const { page_count: pageCount } = this.db
        .query("PRAGMA page_count")
        .get() as { page_count: number };
      const { page_size: pageSize } = this.db
        .query("PRAGMA page_size")
        .get() as { page_size: number };
      return ok(pageCount * pageSize);
    } catch (e) {
      return wrapStoreError(e);
    }
  }
}
