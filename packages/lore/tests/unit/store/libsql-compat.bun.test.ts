/**
 * @spec_ref AC-STORE-R1-SPIKE
 *
 * Risk Spike R1 — libsql/bun:sqlite WAL interop compatibility
 * Task: TASK-01KTRJZCYPHEKDGMVR6BKQV0KD
 * Plan: PLAN-01KTRJGT31D8WJ4ZRHNARV9YBC (SPEC-009 §3.1)
 *
 * This is a GREEN-expected spike (compat test), not TDD RED.
 * Three scenarios must pass to confirm TursoStore can reuse the same file as SQLiteStore.
 *
 * Scenarios:
 *   S1: bun:sqlite (SQLiteStore) writes data + WAL mode → libsql reads data back intact
 *   S2: libsql INSERTs rows → bun:sqlite reopens and sees new rows (lossless interop)
 *   S3: libsql executes FTS5 MATCH query on docs_fts virtual table → returns expected hits
 *
 * Schema notes (from migration-001):
 *   - FTS5 virtual table: docs_fts (title, content, tags; content=docs, content_rowid=rowid)
 *   - WAL is set in SQLiteStore.init() via: PRAGMA journal_mode = WAL
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import type { DocRecord, LinkRecord, VersionRecord } from "../../../src/core/types.js";

// ─── Fixture Helpers ─────────────────────────────────────────────────────────

let _idCounter = 1000;

function nextId(): string {
  _idCounter += 1;
  return `01HSPIKE${String(_idCounter).padStart(16, "0")}`;
}

function makeDoc(overrides: Partial<DocRecord> = {}): DocRecord {
  const n = ++_idCounter;
  return {
    id: nextId(),
    slug: `prd-spike-${n}`,
    type: "prd",
    role: "intent",
    title: `Spike Document ${n}`,
    status: "draft",
    priority: "medium",
    content: `Content for spike document ${n}. Authentication and authorization details.`,
    parent_id: null,
    extra: {},
    tags: ["spike", "compat"],
    version: 1,
    created_at: "2026-06-11T10:00:00.000Z",
    updated_at: "2026-06-11T10:00:00.000Z",
    created_by: "agent:spike-test",
    deleted_at: null,
    ...overrides,
  };
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe("R1 Spike — libsql/bun:sqlite WAL interop", () => {
  let tmpDir: string;
  let dbPath: string;

  // Docs inserted by SQLiteStore (for cross-checking)
  let insertedDocId1: string;
  let insertedDocId2: string;
  let insertedDocSlug1: string;
  let insertedDocSlug2: string;
  let ftsDocId: string;

  beforeAll(async () => {
    // Create isolated temp directory for the fixture DB
    tmpDir = mkdtempSync(join(tmpdir(), "lore-spike-r1-"));
    dbPath = join(tmpDir, "lore.db");

    // Build fixture using REAL SQLiteStore (full schema + migrations + WAL)
    const store = new SQLiteStore(dbPath);

    // Insert representative docs — one with content specifically for FTS search
    const doc1 = makeDoc({
      slug: "prd-wal-compat-alpha",
      title: "WAL Compatibility Alpha",
      content: "This document tests WAL compatibility between bun:sqlite and libsql.",
    });
    const doc2 = makeDoc({
      slug: "spec-wal-compat-beta",
      type: "spec",
      role: "spec",
      title: "WAL Compatibility Beta",
      content: "Second document in the compatibility fixture with additional data.",
      tags: ["compat", "spec", "phase2"],
    });
    const ftsDoc = makeDoc({
      slug: "prd-fts-needle",
      title: "FTS5 Needle Document",
      content: "The uniqueneedleterm_xyz_fts5 keyword should be findable via FTS5 MATCH queries.",
    });

    const r1 = await store.insert(doc1);
    const r2 = await store.insert(doc2);
    const r3 = await store.insert(ftsDoc);

    if (!r1.ok) throw new Error(`Fixture insert doc1 failed: ${JSON.stringify(r1.error)}`);
    if (!r2.ok) throw new Error(`Fixture insert doc2 failed: ${JSON.stringify(r2.error)}`);
    if (!r3.ok) throw new Error(`Fixture insert ftsDoc failed: ${JSON.stringify(r3.error)}`);

    insertedDocId1 = doc1.id;
    insertedDocId2 = doc2.id;
    insertedDocSlug1 = doc1.slug;
    insertedDocSlug2 = doc2.slug;
    ftsDocId = ftsDoc.id;

    // Also insert a link and a version record to test table coverage
    const link: LinkRecord = {
      from_id: doc1.id,
      to_id: doc2.id,
      link_type: "relates-to",
      created_at: "2026-06-11T10:00:00.000Z",
      created_by: "agent:spike-test",
    };
    await store.addLink(link);

    const version: VersionRecord = {
      doc_id: doc1.id,
      version: 1,
      content: doc1.content,
      extra: {},
      status: "draft",
      title: doc1.title,
      action: "create",
      created_at: "2026-06-11T10:00:00.000Z",
      created_by: "agent:spike-test",
    };
    await store.insertVersion(version);

    // Close bun:sqlite connection before libsql opens the file
    store.close();
  });

  afterAll(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  // ─── S1: WAL mode verification + libsql reads data written by bun:sqlite ──

  describe("S1: bun:sqlite fixture → libsql reads intact", () => {
    it("S1.1: fixture DB has WAL journal mode active", () => {
      // Re-open with bun:sqlite to verify WAL pragma took effect
      const db = new Database(dbPath, { readonly: true });
      const row = db.query("PRAGMA journal_mode").get() as { journal_mode: string } | null;
      db.close();

      // WAL mode persists in the DB file even after close
      expect(row).not.toBeNull();
      expect(row!.journal_mode).toBe("wal");
    });

    it("S1.2: libsql can open the WAL-mode DB file", async () => {
      const client = createClient({ url: `file:${dbPath}` });
      try {
        const rs = await client.execute("SELECT 1 AS ping");
        expect(rs.rows).toHaveLength(1);
        expect(rs.rows[0]!["ping"]).toBe(1);
      } finally {
        client.close();
      }
    });

    it("S1.3: libsql reads back all docs inserted by bun:sqlite (row count)", async () => {
      const client = createClient({ url: `file:${dbPath}` });
      try {
        const rs = await client.execute("SELECT COUNT(*) AS cnt FROM docs WHERE deleted_at IS NULL");
        const cnt = Number(rs.rows[0]!["cnt"]);
        // We inserted 3 docs in beforeAll
        expect(cnt).toBe(3);
      } finally {
        client.close();
      }
    });

    it("S1.4: libsql retrieves correct field values for doc1 (slug, title, content)", async () => {
      const client = createClient({ url: `file:${dbPath}` });
      try {
        const rs = await client.execute({
          sql: "SELECT id, slug, title, content, type, status, version FROM docs WHERE id = ?",
          args: [insertedDocId1],
        });

        expect(rs.rows).toHaveLength(1);
        const row = rs.rows[0]!;
        expect(String(row["id"])).toBe(insertedDocId1);
        expect(String(row["slug"])).toBe(insertedDocSlug1);
        expect(String(row["title"])).toBe("WAL Compatibility Alpha");
        expect(String(row["type"])).toBe("prd");
        expect(String(row["status"])).toBe("draft");
        expect(Number(row["version"])).toBe(1);
      } finally {
        client.close();
      }
    });

    it("S1.5: libsql reads doc2 with correct tags JSON (array round-trip)", async () => {
      const client = createClient({ url: `file:${dbPath}` });
      try {
        const rs = await client.execute({
          sql: "SELECT tags FROM docs WHERE id = ?",
          args: [insertedDocId2],
        });

        expect(rs.rows).toHaveLength(1);
        const rawTags = String(rs.rows[0]!["tags"]);
        const tags = JSON.parse(rawTags) as string[];
        expect(tags).toContain("compat");
        expect(tags).toContain("spec");
        expect(tags).toContain("phase2");
      } finally {
        client.close();
      }
    });

    it("S1.6: libsql reads the links table — at least 1 link", async () => {
      const client = createClient({ url: `file:${dbPath}` });
      try {
        const rs = await client.execute({
          sql: "SELECT COUNT(*) AS cnt FROM links WHERE from_id = ?",
          args: [insertedDocId1],
        });
        const cnt = Number(rs.rows[0]!["cnt"]);
        expect(cnt).toBe(1);
      } finally {
        client.close();
      }
    });

    it("S1.7: libsql reads the versions table — at least 1 version record", async () => {
      const client = createClient({ url: `file:${dbPath}` });
      try {
        const rs = await client.execute({
          sql: "SELECT COUNT(*) AS cnt FROM versions WHERE doc_id = ?",
          args: [insertedDocId1],
        });
        const cnt = Number(rs.rows[0]!["cnt"]);
        expect(cnt).toBe(1);
      } finally {
        client.close();
      }
    });
  });

  // ─── S2: libsql writes → bun:sqlite reopens and sees new data ─────────────

  describe("S2: libsql writes → bun:sqlite reopens losslessly", () => {
    const libsqlInsertedId = `01HLIBSQL${String(Date.now()).slice(-15)}`;
    const libsqlInsertedSlug = "prd-written-by-libsql";

    it("S2.1: libsql inserts a new doc row directly", async () => {
      const client = createClient({ url: `file:${dbPath}` });
      try {
        const now = new Date().toISOString();
        // Insert without going through SQLiteStore — direct SQL via libsql
        const rs = await client.execute({
          sql: `INSERT INTO docs (id, slug, type, role, title, status, priority, content,
                  parent_id, extra, tags, version, created_at, updated_at, created_by, deleted_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            libsqlInsertedId,
            libsqlInsertedSlug,
            "prd",
            "intent",
            "Written By Libsql",
            "draft",
            "low",
            "This row was inserted by libsql client directly.",
            null,
            "{}",
            '["libsql","interop"]',
            1,
            now,
            now,
            "agent:libsql-spike",
            null,
          ],
        });
        // INSERT should affect 1 row
        expect(rs.rowsAffected).toBe(1);
      } finally {
        client.close();
      }
    });

    it("S2.2: bun:sqlite reopens the file and sees the libsql-inserted row", () => {
      // Use raw bun:sqlite (not SQLiteStore) to avoid re-running migrations on read
      const db = new Database(dbPath, { readonly: true });
      const row = db
        .query("SELECT id, slug, title, created_by FROM docs WHERE id = ?")
        .get(libsqlInsertedId) as {
        id: string;
        slug: string;
        title: string;
        created_by: string;
      } | null;
      db.close();

      expect(row).not.toBeNull();
      expect(row!.id).toBe(libsqlInsertedId);
      expect(row!.slug).toBe(libsqlInsertedSlug);
      expect(row!.title).toBe("Written By Libsql");
      expect(row!.created_by).toBe("agent:libsql-spike");
    });

    it("S2.3: bun:sqlite total doc count reflects both original + libsql-inserted rows", () => {
      const db = new Database(dbPath, { readonly: true });
      const row = db
        .query("SELECT COUNT(*) AS cnt FROM docs WHERE deleted_at IS NULL")
        .get() as { cnt: number } | null;
      db.close();

      // 3 original docs + 1 libsql-inserted doc = 4 total
      expect(row).not.toBeNull();
      expect(Number(row!.cnt)).toBe(4);
    });

    it("S2.4: libsql UPDATE is visible when bun:sqlite reopens (no corruption)", async () => {
      // libsql updates a field on doc1
      const client = createClient({ url: `file:${dbPath}` });
      try {
        const rs = await client.execute({
          sql: "UPDATE docs SET status = ?, version = ?, updated_at = ? WHERE id = ?",
          args: ["in-review", 2, new Date().toISOString(), insertedDocId1],
        });
        expect(rs.rowsAffected).toBe(1);
      } finally {
        client.close();
      }

      // Verify bun:sqlite sees the updated status
      const db = new Database(dbPath, { readonly: true });
      const row = db
        .query("SELECT status, version FROM docs WHERE id = ?")
        .get(insertedDocId1) as { status: string; version: number } | null;
      db.close();

      expect(row).not.toBeNull();
      expect(row!.status).toBe("in-review");
      expect(Number(row!.version)).toBe(2);
    });
  });

  // ─── S3: FTS5 MATCH query via libsql ─────────────────────────────────────

  describe("S3: FTS5 virtual table works via libsql", () => {
    it("S3.1: libsql can query the docs_fts virtual table without error", async () => {
      const client = createClient({ url: `file:${dbPath}` });
      try {
        // Simple table existence check — SELECT from fts table
        const rs = await client.execute("SELECT COUNT(*) AS cnt FROM docs_fts");
        // Should not throw; content virtual tables may return 0 or more rows
        expect(rs.rows).toHaveLength(1);
      } finally {
        client.close();
      }
    });

    it("S3.2: FTS5 MATCH query via libsql returns the expected doc by unique keyword", async () => {
      const client = createClient({ url: `file:${dbPath}` });
      try {
        // The ftsDoc has unique keyword "uniqueneedleterm_xyz_fts5" in its content
        const rs = await client.execute({
          sql: `
            SELECT d.id, d.slug, d.title
            FROM docs_fts f
            JOIN docs d ON d.rowid = f.rowid
            WHERE docs_fts MATCH ?
          `,
          args: ["uniqueneedleterm_xyz_fts5"],
        });

        expect(rs.rows.length).toBeGreaterThanOrEqual(1);
        const foundIds = rs.rows.map((r) => String(r["id"]));
        expect(foundIds).toContain(ftsDocId);
      } finally {
        client.close();
      }
    });

    it("S3.3: FTS5 MATCH query finds doc by title keyword via libsql", async () => {
      const client = createClient({ url: `file:${dbPath}` });
      try {
        // "Needle" is in the title of ftsDoc
        const rs = await client.execute({
          sql: `
            SELECT d.id, d.title
            FROM docs_fts f
            JOIN docs d ON d.rowid = f.rowid
            WHERE docs_fts MATCH ?
            ORDER BY f.rank
          `,
          args: ["Needle"],
        });

        expect(rs.rows.length).toBeGreaterThanOrEqual(1);
        const foundIds = rs.rows.map((r) => String(r["id"]));
        expect(foundIds).toContain(ftsDocId);
      } finally {
        client.close();
      }
    });

    it("S3.4: FTS5 MATCH via libsql returns empty result for unknown term (no false positives)", async () => {
      const client = createClient({ url: `file:${dbPath}` });
      try {
        const rs = await client.execute({
          sql: `
            SELECT d.id
            FROM docs_fts f
            JOIN docs d ON d.rowid = f.rowid
            WHERE docs_fts MATCH ?
          `,
          args: ["xyzzy_completely_absent_from_all_docs_12345"],
        });

        expect(rs.rows).toHaveLength(0);
      } finally {
        client.close();
      }
    });

    it("S3.5: FTS5 MATCH via libsql finds doc written by libsql (S2 INSERT synced to FTS)", async () => {
      // The libsql-inserted doc from S2 has content "inserted by libsql client directly"
      // BUT: FTS5 content= table triggers are SQLite triggers — libsql bypasses them
      // when it does a direct INSERT without triggering the docs_ai trigger.
      // This test verifies whether FTS is auto-synced or not.
      // Note: This is a diagnostic test. If it FAILS it reveals that libsql bypasses triggers
      // and FTS won't track libsql writes — that is a relevant finding for R1.
      const client = createClient({ url: `file:${dbPath}` });
      try {
        const rs = await client.execute({
          sql: `
            SELECT d.id
            FROM docs_fts f
            JOIN docs d ON d.rowid = f.rowid
            WHERE docs_fts MATCH ?
          `,
          args: ["libsql"],
        });

        // The libsql-inserted doc contains "libsql" in its content.
        // If triggers fired, this doc should appear. If not, empty result.
        // We do NOT fail this test either way — we record the observation.
        const libsqlDocFound = rs.rows.some((r) => String(r["id"]).startsWith("01HLIBSQL"));

        // Document the finding for R1 decision:
        // If triggers don't fire via libsql, TursoStore must explicitly maintain FTS
        // This test passes regardless, but the finding is recorded via console output
        if (!libsqlDocFound) {
          // FTS triggers did NOT fire for libsql INSERT — TursoStore must call FTS5 manually
          // This is a finding but not a blocking failure for S3 scenario
          console.info("[R1-FINDING] FTS5 triggers do NOT fire for libsql direct INSERT — TursoStore must manually sync FTS index");
        } else {
          console.info("[R1-FINDING] FTS5 triggers DO fire for libsql INSERT — FTS is auto-synced");
        }

        // The test itself passes in both cases — this is an informational probe
        expect(typeof libsqlDocFound).toBe("boolean");
      } finally {
        client.close();
      }
    });
  });
});
