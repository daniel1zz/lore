/**
 * Seeds a throwaway corpus to the SHAPE of a large real one so audit-verify cost tests have something
 * to measure: many versions rows carrying large `content`, and an audit table with a valid hash chain
 * that explains every version (so `verify` reports clean). Bun-only (`bun:sqlite`).
 *
 * The schema comes from the store under test (`SQLiteStore` or `TursoStore` in `file:` mode create the
 * same file schema); rows are then bulk-inserted through a raw connection in ONE transaction, because
 * 100k+ store-API writes (one chain-head read each) would dwarf the thing being measured.
 *
 * Never points at the repo's own `.lore/`: the caller passes a `mkdtemp` directory.
 */

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { computeAuditEntryHash } from "../../../src/store/store-shared.js";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { TursoStore } from "../../../src/store/turso-store.js";

export interface AuditVerifyFixtureShape {
  /** Number of documents the versions are spread over. */
  readonly docs: number;
  /** Versions per document; total versions = docs * versionsPerDoc. */
  readonly versionsPerDoc: number;
  /** Characters of `content` on every versions row. */
  readonly contentChars: number;
  /** Audit rows beyond the one that explains each version (unrelated actions). */
  readonly extraAuditRows: number;
}

export interface AuditVerifyFixture {
  readonly dbPath: string;
  readonly versions: number;
  readonly auditRows: number;
}

const BASE_MS = Date.parse("2026-10-01T00:00:00.000Z");

/** Creates `<dir>/.lore/lore.db` with the schema of `storeKind`, then bulk-seeds it. Returns the db path. */
export async function seedAuditVerifyCorpus(
  dir: string,
  storeKind: "sqlite" | "turso",
  shape: AuditVerifyFixtureShape,
): Promise<AuditVerifyFixture> {
  mkdirSync(join(dir, ".lore"), { recursive: true });
  const dbPath = join(dir, ".lore", "lore.db");

  if (storeKind === "sqlite") {
    new SQLiteStore(dbPath).close();
  } else {
    const turso = new TursoStore({ localPath: dbPath });
    // reason: the schema is created asynchronously by the constructor; any read awaits it.
    await turso.listAllVersions();
    turso.close();
  }

  const db = new Database(dbPath);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = OFF;");
  const content = "x".repeat(shape.contentChars);
  const insertDoc = db.prepare(
    `INSERT INTO docs (id, slug, type, role, title, status, priority, content, extra, tags, version, created_at, updated_at, created_by, fts_title, fts_content, fts_tags)
     VALUES (?, ?, 'knowledge', 'knowledge', ?, 'draft', 'medium', '', '{}', '[]', ?, ?, ?, 'agent:fixture', '', '', '')`,
  );
  const insertVersion = db.prepare(
    `INSERT INTO versions (doc_id, version, content, extra, status, title, action, created_at, created_by, change_summary, slug, harness_run)
     VALUES (?, ?, ?, '{"k":"v"}', 'draft', ?, ?, ?, 'agent:fixture', NULL, ?, NULL)`,
  );
  const insertAudit = db.prepare(
    `INSERT INTO audit (timestamp, actor, session_id, action, doc_id, details, prev_hash, entry_hash, harness_run)
     VALUES (?, 'agent:fixture', 's-fixture', ?, ?, ?, ?, ?, NULL)`,
  );

  let prev = "";
  let auditRows = 0;
  let tick = 0;
  const appendAudit = (action: string, docId: string | null, details: Record<string, unknown>): void => {
    const timestamp = new Date(BASE_MS + tick++ * 1000).toISOString();
    const entry = { timestamp, actor: "agent:fixture", session_id: "s-fixture", action, ...(docId !== null ? { doc_id: docId as never } : {}), details };
    const hash = computeAuditEntryHash(entry as never, prev);
    insertAudit.run(timestamp, action, docId, JSON.stringify(details), prev, hash);
    prev = hash;
    auditRows += 1;
  };

  db.exec("BEGIN");
  for (let d = 0; d < shape.docs; d++) {
    const id = `01FIXTURE${String(d).padStart(17, "0")}`;
    const slug = `fixture-doc-${d}`;
    insertDoc.run(id, slug, `Fixture ${d}`, shape.versionsPerDoc, new Date(BASE_MS).toISOString(), new Date(BASE_MS).toISOString());
    for (let v = 1; v <= shape.versionsPerDoc; v++) {
      const createdAt = new Date(BASE_MS + (d * shape.versionsPerDoc + v) * 1000).toISOString();
      const action = v === 1 ? "create" : "update";
      insertVersion.run(id, v, content, `Fixture ${d}`, action, createdAt, slug);
      appendAudit(action, id, { version: v });
    }
  }
  for (let i = 0; i < shape.extraAuditRows; i++) appendAudit("judge", null, { n: i });
  db.exec("COMMIT");
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();

  return { dbPath, versions: shape.docs * shape.versionsPerDoc, auditRows };
}

/** The shape of this repo's own corpus (measured 2026-10-19), at a size a test can build in seconds. */
export const REPO_SHAPE: AuditVerifyFixtureShape = {
  docs: 2000,
  versionsPerDoc: 25,
  contentChars: 4096,
  extraAuditRows: 9000,
};
