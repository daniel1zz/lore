/**
 * Migration 046 — `docs.type` accepts 'template' (structured documents T2). Runner: vitest on the Bun runtime (bun:sqlite).
 *
 * The widening is a `docs` table recreate, so the risk is what the recreate silently loses. This test builds a schema-45
 * corpus (`schemaCeiling: 45`), seeds a doc, snapshots every index and trigger on `docs` plus its column list, then opens
 * the file with `migrate: true` and asserts:
 *   HAPPY:      user_version becomes 46; before the migration a 'template' insert is refused by the CHECK, after it succeeds
 *   REGRESSION: every index and trigger on `docs` exists with identical SQL, and the column list is identical
 *   STATE:      the seeded row keeps its rowid and fields, and FTS search still finds it (docs_fts stays in sync)
 *   NEGATIVE:   a type outside the list is still refused after the migration
 */

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DocRecord } from "@lore/core";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { LATEST_SCHEMA_VERSION } from "../../../src/store/schema-version.js";
import { actedStore } from "../../live-invocation.js";

let dir: string;
let path: string;

const STAMP = "2026-11-01T00:00:00.000Z";

function seedDoc(): DocRecord {
  return {
    id: "01HM046DOC00000000000001",
    slug: "knowledge-before-046",
    type: "knowledge",
    role: "knowledge",
    title: "Zebra crossing notes",
    status: "draft",
    priority: "medium",
    content: "narwhal tusks",
    parent_id: null,
    extra: { sub_type: "reference" },
    tags: [],
    version: 1,
    created_at: STAMP,
    updated_at: STAMP,
    created_by: "test",
    deleted_at: null,
  } as unknown as DocRecord;
}

function insertTemplateRow(db: Database): void {
  db.run(
    "INSERT INTO docs (id, slug, type, role, title, status, priority, content, extra, tags, version, created_at, updated_at, created_by) VALUES ('01HM046TPL00000000000001','template-x','template','knowledge','T','draft','medium','','{}','[]',1,?,?,'test')",
    [STAMP, STAMP],
  );
}

function schemaObjects(db: Database): { name: string; sql: string }[] {
  return db
    .query("SELECT name, sql FROM sqlite_master WHERE tbl_name = 'docs' AND type IN ('index','trigger') AND sql IS NOT NULL ORDER BY name")
    .all() as { name: string; sql: string }[];
}

function columns(db: Database): unknown[] {
  return db.query("PRAGMA table_info(docs)").all();
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "lore-migration-046-"));
  path = join(dir, "lore.db");
  const old = actedStore(new SQLiteStore(path, { schemaCeiling: 45 }));
  const inserted = await old.insert(seedDoc());
  if (!inserted.ok) throw new Error(JSON.stringify(inserted.error));
  old.close();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("migration 046", () => {
  it("refuses a template before and accepts it after, at user_version 46 (HAPPY)", () => {
    const before = new Database(path);
    expect(before.query("PRAGMA user_version").get()).toEqual({ user_version: 45 });
    expect(() => insertTemplateRow(before)).toThrow(/CHECK constraint failed/);
    before.close();

    new SQLiteStore(path, { migrate: true }).close();

    const after = new Database(path);
    expect(after.query("PRAGMA user_version").get()).toEqual({ user_version: LATEST_SCHEMA_VERSION });
    expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(46);
    expect(() => insertTemplateRow(after)).not.toThrow();
    after.close();
  });

  it("keeps every index, trigger and column of docs identical (REGRESSION)", () => {
    const before = new Database(path);
    const objectsBefore = schemaObjects(before);
    const columnsBefore = columns(before);
    before.close();

    new SQLiteStore(path, { migrate: true }).close();

    const after = new Database(path);
    expect(schemaObjects(after)).toEqual(objectsBefore);
    expect(columns(after)).toEqual(columnsBefore);
    after.close();
  });

  it("keeps the seeded row, its rowid and full-text search (STATE)", async () => {
    const before = new Database(path);
    const rowid = (before.query("SELECT rowid AS r FROM docs WHERE id = '01HM046DOC00000000000001'").get() as { r: number }).r;
    before.close();

    const store = actedStore(new SQLiteStore(path, { migrate: true }));
    const found = await store.findBySlug("knowledge-before-046");
    expect(found.ok && found.value?.title).toBe("Zebra crossing notes");
    const hits = await store.search("narwhal");
    expect(hits.ok && hits.value.length).toBe(1);
    store.close();

    const after = new Database(path);
    expect((after.query("SELECT rowid AS r FROM docs WHERE id = '01HM046DOC00000000000001'").get() as { r: number }).r).toBe(rowid);
    after.close();
  });

  it("still refuses a type outside the list (NEGATIVE)", () => {
    new SQLiteStore(path, { migrate: true }).close();
    const after = new Database(path);
    expect(() =>
      after.run(
        "INSERT INTO docs (id, slug, type, role, title, status, priority, content, extra, tags, version, created_at, updated_at, created_by) VALUES ('01HM046BAD00000000000001','bad-x','nonsense','knowledge','T','draft','medium','','{}','[]',1,?,?,'test')",
        [STAMP, STAMP],
      ),
    ).toThrow(/CHECK constraint failed/);
    after.close();
  });
});
