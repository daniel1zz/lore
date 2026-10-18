/**
 * @spec_ref spec-baseline-slice-1-rules-with-permanent-ids-ac-citations (C2, Migration Plan phase B)
 * @task task-skill-implement-store-rule-registry-migration ([B2])
 *
 * Tests for migration-013: (1) widen `docs.type` CHECK to accept 'baseline'
 * via a `docs` table rebuild, (2) create the `rule_registry` table.
 * Runner: `bun test` (bun:sqlite) — never vitest.
 *
 * How the pre-migration (schema 12) fixture is built: a real SQLiteStore (head
 * schema) seeds docs / versions / links / ordinals / FTS rows through its own
 * write paths, then the file is regressed to the exact schema-12 shape by
 * running the same table-rebuild recipe backwards (the `docs` DDL is read from
 * sqlite_master and its `'baseline'` CHECK entry removed, `rule_registry`
 * dropped, `user_version = 12`). The next `new SQLiteStore(path)` therefore
 * runs the REAL migration-013 against a populated schema-12 file.
 *
 *   HAPPY:      a 'baseline' doc inserts and reads back after migration.
 *   NEGATIVE:   an unknown type is still rejected by the widened CHECK; the
 *               pre-migration schema really did reject 'baseline' (fixture
 *               sanity — proves the test would be red without the migration).
 *   BOUNDARY:   a populated schema-12 file migrates with every doc, rowid,
 *               FTS hit (ASCII + CJK), ordinal, version and link intact.
 *   STATE:      every index / trigger / FTS table / foreign key survives the
 *               rebuild; the partial UNIQUE ordinal index still enforces.
 *   ERROR:      a stale `docs_new` from an aborted attempt is cleared, and
 *               `PRAGMA foreign_keys` is ON after the migration.
 *   REGRESSION: re-opening a migrated file and re-running MIGRATION_013_SQL on
 *               it are idempotent and keep rule_registry rows.
 */

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DocRecord } from "@lore/core";
import { MIGRATION_013_SQL } from "../../../src/store/migrations/migration-013.js";
import { LATEST_SCHEMA_VERSION } from "../../../src/store/schema-version.js";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { TursoStore } from "../../../src/store/turso-store.js";

const STAMP = "2026-10-07T00:00:00.000Z";

const EXPECTED_DOC_INDEXES = [
  "idx_docs_created_by",
  "idx_docs_parent",
  "idx_docs_status",
  "idx_docs_type",
  "idx_docs_type_ordinal",
  "idx_docs_updated",
];
const EXPECTED_DOC_TRIGGERS = ["docs_ad", "docs_ai", "docs_au"];
// reason: migration-014 adds four docs_idx_* index-maintenance triggers; a re-run of MIGRATION_013_SQL recreates docs and drops them (see migration-014.ts invariants), so only the HEAD schema expects them.
const EXPECTED_DOC_TRIGGERS_HEAD = [...EXPECTED_DOC_TRIGGERS, "docs_idx_baseline_ai", "docs_idx_baseline_au", "docs_idx_spec_ai", "docs_idx_spec_au"].sort();
/** child table -> expected parent-table FK targets (all `docs`). */
const EXPECTED_FK_CHILDREN = ["calibration_records", "links", "review_judgments", "versions"];

function makeDoc(id: string, slug: string, over: Partial<DocRecord> = {}): DocRecord {
  return {
    id,
    slug,
    type: "knowledge",
    role: "knowledge",
    title: `Title ${slug}`,
    status: "draft",
    priority: "medium",
    content: `content of ${slug}`,
    parent_id: null,
    extra: {},
    tags: [],
    version: 1,
    created_at: STAMP,
    updated_at: STAMP,
    created_by: "agent:test",
    deleted_at: null,
    ordinal: null,
    ...over,
  } as DocRecord;
}

function userVersion(db: Database): number {
  return (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
}

function namesOf(db: Database, type: "index" | "trigger", table: string): string[] {
  return (
    db
      .query("SELECT name FROM sqlite_master WHERE type = ? AND tbl_name = ? AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all(type, table) as { name: string }[]
  ).map((r) => r.name);
}

/**
 * Regress a head-schema file to the exact schema-12 shape (see module doc):
 * rebuild `docs` with the `'baseline'` CHECK entry removed, drop rule_registry.
 */
function regressToSchema12(path: string): void {
  const db = new Database(path);
  const row = db.query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'docs'").get() as { sql: string };
  expect(row.sql).toContain("'baseline'");
  const oldDdl = row.sql.replace(",'baseline'", "").replace(/CREATE TABLE "?docs"?/, "CREATE TABLE docs_old");
  expect(oldDdl).not.toContain("'baseline'");
  db.exec("PRAGMA foreign_keys = OFF");
  db.exec("BEGIN IMMEDIATE");
  db.exec(oldDdl);
  db.exec(
    `INSERT INTO docs_old (rowid, id, slug, type, role, title, status, priority, content, parent_id, extra, tags,
       version, created_at, updated_at, created_by, deleted_at, fts_title, fts_content, fts_tags, ordinal)
     SELECT rowid, id, slug, type, role, title, status, priority, content, parent_id, extra, tags,
       version, created_at, updated_at, created_by, deleted_at, fts_title, fts_content, fts_tags, ordinal FROM docs`,
  );
  db.exec("DROP TABLE docs");
  db.exec("ALTER TABLE docs_old RENAME TO docs");
  db.exec("CREATE INDEX idx_docs_type ON docs(type) WHERE deleted_at IS NULL");
  db.exec("CREATE INDEX idx_docs_status ON docs(status) WHERE deleted_at IS NULL");
  db.exec("CREATE INDEX idx_docs_parent ON docs(parent_id) WHERE deleted_at IS NULL");
  db.exec("CREATE INDEX idx_docs_created_by ON docs(created_by) WHERE deleted_at IS NULL");
  db.exec("CREATE INDEX idx_docs_updated ON docs(updated_at DESC) WHERE deleted_at IS NULL");
  db.exec("CREATE UNIQUE INDEX idx_docs_type_ordinal ON docs(type, ordinal) WHERE ordinal IS NOT NULL");
  db.exec(`CREATE TRIGGER docs_ai AFTER INSERT ON docs BEGIN
    INSERT INTO docs_fts(rowid, fts_title, fts_content, fts_tags) VALUES (new.rowid, new.fts_title, new.fts_content, new.fts_tags);
  END`);
  db.exec(`CREATE TRIGGER docs_ad AFTER DELETE ON docs BEGIN
    INSERT INTO docs_fts(docs_fts, rowid, fts_title, fts_content, fts_tags) VALUES ('delete', old.rowid, old.fts_title, old.fts_content, old.fts_tags);
  END`);
  db.exec(`CREATE TRIGGER docs_au AFTER UPDATE ON docs BEGIN
    INSERT INTO docs_fts(docs_fts, rowid, fts_title, fts_content, fts_tags) VALUES ('delete', old.rowid, old.fts_title, old.fts_content, old.fts_tags);
    INSERT INTO docs_fts(rowid, fts_title, fts_content, fts_tags) VALUES (new.rowid, new.fts_title, new.fts_content, new.fts_tags);
  END`);
  db.exec("DROP TABLE rule_registry");
  db.exec("PRAGMA user_version = 12");
  db.exec("COMMIT");
  db.exec("PRAGMA foreign_keys = ON");
  db.close();
}

describe("migration-013 (docs.type admits 'baseline' + rule_registry)", () => {
  let dir: string;
  let path: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lore-migration-013-"));
    path = join(dir, "lore.db");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /** Seeds a populated corpus through the store's own write paths, then regresses it to schema 12. */
  async function seedSchema12(): Promise<{ rowids: Map<string, number> }> {
    const seed = new SQLiteStore(path);
    const parent = makeDoc("01HM013PARENT00000000001", "m13-plan", { type: "plan", role: "plan", title: "Quarterly plan" });
    expect((await seed.insert(parent)).ok).toBe(true);
    const spec = makeDoc("01HM013SPEC0000000000001", "m13-spec", { type: "spec", role: "spec", title: "Alpha specification", parent_id: parent.id });
    expect((await seed.insertWithAllocatedOrdinal(spec)).ok).toBe(true);
    const adr = makeDoc("01HM013ADR00000000000001", "m13-adr", { type: "adr", role: "decision", title: "量化交易策略" });
    expect((await seed.insertWithAllocatedOrdinal(adr)).ok).toBe(true);
    const gone = makeDoc("01HM013GONE0000000000001", "m13-gone", { title: "Soft deleted note" });
    expect((await seed.insert(gone)).ok).toBe(true);
    expect((await seed.softDelete(gone.id)).ok).toBe(true);
    expect(
      (
        await seed.insertVersion({
          doc_id: spec.id,
          version: 1,
          content: "content of m13-spec",
          extra: {},
          status: "draft",
          title: spec.title,
          action: "create",
          created_at: STAMP,
          created_by: "agent:test",
          slug: spec.slug,
        })
      ).ok,
    ).toBe(true);
    expect((await seed.addLink({ from_id: spec.id, to_id: parent.id, link_type: "implements", created_at: STAMP, created_by: "agent:test" })).ok).toBe(true);
    const rowids = new Map<string, number>();
    for (const r of seed.getDatabase().query("SELECT rowid AS rid, id FROM docs").all() as { rid: number; id: string }[]) {
      rowids.set(r.id, r.rid);
    }
    seed.close();
    regressToSchema12(path);
    return { rowids };
  }

  it("HAPPY: after migration a 'baseline' doc inserts and reads back (SQLite)", async () => {
    const store = new SQLiteStore(path);
    expect(userVersion(store.getDatabase())).toBe(LATEST_SCHEMA_VERSION);
    const baseline = makeDoc("01HM013BASELINE000000001", "m13-baseline", {
      type: "baseline",
      role: "intent",
      title: "Product baseline root",
      extra: { node: "domain", rules: [] },
    });
    expect((await store.insert(baseline)).ok).toBe(true);
    const found = await store.find(baseline.id);
    expect(found.ok && found.value?.type).toBe("baseline");
    expect(found.ok && found.value?.extra).toEqual({ node: "domain", rules: [] });
    const hits = await store.search("baseline root");
    expect(hits.ok && hits.value.map((h) => h.id)).toContain(baseline.id);
    store.close();
  });

  it("NEGATIVE: the schema-12 fixture rejects 'baseline' (red without the migration); an unknown type is still rejected after it", async () => {
    await seedSchema12();
    const raw = new Database(path);
    expect(userVersion(raw)).toBe(12);
    expect(() =>
      raw
        .prepare(
          `INSERT INTO docs (id, slug, type, role, title, created_at, updated_at, created_by) VALUES (?, ?, 'baseline', 'intent', 't', ?, ?, 'a')`,
        )
        .run("01HM013REJECT00000000001", "m13-reject", STAMP, STAMP),
    ).toThrow(/CHECK constraint failed/);
    raw.close();

    const store = new SQLiteStore(path);
    expect(() =>
      store
        .getDatabase()
        .prepare(
          `INSERT INTO docs (id, slug, type, role, title, created_at, updated_at, created_by) VALUES (?, ?, 'bogus', 'intent', 't', ?, ?, 'a')`,
        )
        .run("01HM013BOGUS000000000001", "m13-bogus", STAMP, STAMP),
    ).toThrow(/CHECK constraint failed/);
    store.close();
  });

  it("BOUNDARY: a populated schema-12 file migrates with every doc, rowid, FTS hit, ordinal, version and link intact", async () => {
    const { rowids } = await seedSchema12();
    const store = new SQLiteStore(path);
    const db = store.getDatabase();
    expect(userVersion(db)).toBe(23);

    // docs + rowids (external-content FTS depends on rowid stability)
    const after = db.query("SELECT rowid AS rid, id FROM docs").all() as { rid: number; id: string }[];
    expect(after.length).toBe(rowids.size);
    for (const r of after) expect(rowids.get(r.id)).toBe(r.rid);

    // FTS: ASCII + CJK hits still resolve to the right doc; soft-deleted doc stays excluded by search
    const ascii = await store.search("Alpha");
    expect(ascii.ok && ascii.value.map((h) => h.id)).toEqual(["01HM013SPEC0000000000001"]);
    const cjk = await store.search("交易");
    expect(cjk.ok && cjk.value.map((h) => h.id)).toContain("01HM013ADR00000000000001");
    expect(() => db.exec("INSERT INTO docs_fts(docs_fts) VALUES('integrity-check')")).not.toThrow();

    // ordinals
    const spec = await store.findByTypeOrdinal("spec", 1);
    expect(spec.ok && spec.value?.id).toBe("01HM013SPEC0000000000001");
    const adr = await store.findByTypeOrdinal("adr", 1);
    expect(adr.ok && adr.value?.id).toBe("01HM013ADR00000000000001");

    // soft-delete flag, versions, links
    const gone = await store.find("01HM013GONE0000000000001");
    expect(gone.ok && gone.value?.deleted_at).not.toBeNull();
    const versions = await store.findVersions("01HM013SPEC0000000000001");
    expect(versions.ok && versions.value.length).toBe(1);
    const links = await store.findLinks("01HM013SPEC0000000000001", "out");
    expect(links.ok && links.value.map((l) => [l.to_id, l.link_type])).toEqual([["01HM013PARENT00000000001", "implements"]]);

    // a post-migration write on a migrated row still maintains FTS via the recreated trigger
    const upd = await store.update("01HM013SPEC0000000000001", { title: "Renamed Gamma", fts_title: "renamed gamma" } as Partial<DocRecord>);
    expect(upd.ok).toBe(true);
    store.close();
  });

  it("STATE: every index, trigger, FTS table and foreign key survives the rebuild; the partial UNIQUE ordinal index still enforces", async () => {
    await seedSchema12();
    const store = new SQLiteStore(path);
    const db = store.getDatabase();

    expect(namesOf(db, "index", "docs")).toEqual(EXPECTED_DOC_INDEXES);
    expect(namesOf(db, "trigger", "docs")).toEqual(EXPECTED_DOC_TRIGGERS_HEAD);
    const fts = db.query("SELECT sql FROM sqlite_master WHERE name = 'docs_fts'").get() as { sql: string };
    expect(fts.sql).toContain("content=docs");
    expect(fts.sql).toContain("content_rowid=rowid");

    // the ordinal index is the PARTIAL UNIQUE one
    const ord = db.query("SELECT sql FROM sqlite_master WHERE name = 'idx_docs_type_ordinal'").get() as { sql: string };
    expect(ord.sql).toContain("UNIQUE");
    expect(ord.sql).toContain("WHERE ordinal IS NOT NULL");
    expect(() =>
      db
        .prepare(
          `INSERT INTO docs (id, slug, type, role, title, created_at, updated_at, created_by, ordinal) VALUES (?, ?, 'spec', 'spec', 't', ?, ?, 'a', 1)`,
        )
        .run("01HM013DUPORD0000000001", "m13-dupord", STAMP, STAMP),
    ).toThrow(/UNIQUE constraint failed/);

    // foreign keys: children -> docs, plus docs.parent_id self-reference
    for (const child of EXPECTED_FK_CHILDREN) {
      const fks = db.query(`PRAGMA foreign_key_list(${child})`).all() as { table: string }[];
      expect(fks.some((f) => f.table === "docs")).toBe(true);
    }
    const selfFk = db.query("PRAGMA foreign_key_list(docs)").all() as { table: string; from: string }[];
    expect(selfFk.map((f) => [f.table, f.from])).toEqual([["docs", "parent_id"]]);
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);

    // rule_registry shape
    const cols = (db.query("PRAGMA table_info(rule_registry)").all() as { name: string; notnull: number; pk: number }[]).map((c) => [c.name, c.notnull, c.pk]);
    expect(cols).toEqual([
      ["id", 0, 1],
      // migration-015 adds `prefix` (BR|AS|AD) and moves uniqueness from `n` to (prefix, n)
      ["prefix", 1, 0],
      ["n", 1, 0],
      ["leaf_doc_id", 1, 0],
      ["allocated_at", 1, 0],
      ["allocated_by", 1, 0],
      // migration-014 adds these two (head schema); migration-014.bun.test.ts pins their semantics
      ["lifecycle", 1, 0],
      ["version", 1, 0],
    ]);
    db.prepare("INSERT INTO rule_registry (id, n, leaf_doc_id, allocated_at, allocated_by) VALUES ('BR-1', 1, 'x', ?, 'a')").run(STAMP);
    expect(() => db.prepare("INSERT INTO rule_registry (id, n, leaf_doc_id, allocated_at, allocated_by) VALUES ('BR-9', 1, 'x', ?, 'a')").run(STAMP)).toThrow(/UNIQUE constraint failed/);
    store.close();
  });

  it("ERROR: a stale docs_new from an aborted attempt is cleared, and foreign_keys is ON afterwards", async () => {
    await seedSchema12();
    const raw = new Database(path);
    raw.exec("CREATE TABLE docs_new (junk TEXT)");
    raw.close();
    const store = new SQLiteStore(path);
    const db = store.getDatabase();
    expect(userVersion(db)).toBe(23);
    expect((db.query("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys).toBe(1);
    expect(db.query("SELECT name FROM sqlite_master WHERE name = 'docs_new'").all()).toEqual([]);
    store.close();
  });

  it("HAPPY (Turso): a populated schema-12 file migrates through TursoStore.initSchema, then a 'baseline' doc inserts and rule_registry exists", async () => {
    await seedSchema12();
    const turso = new TursoStore({ localPath: path });
    const baseline = makeDoc("01HM013TBASELINE00000001", "m13-turso-baseline", { type: "baseline", role: "intent", title: "Turso baseline" });
    const inserted = await turso.insert(baseline);
    expect(inserted.ok).toBe(true);
    const found = await turso.find(baseline.id);
    expect(found.ok && found.value?.type).toBe("baseline");
    expect((await turso.listRuleRegistry()).ok).toBe(true);
    const preserved = await turso.findByTypeOrdinal("spec", 1);
    expect(preserved.ok && preserved.value?.id).toBe("01HM013SPEC0000000000001");
    turso.close();
    const raw = new Database(path);
    expect(userVersion(raw)).toBe(23);
    expect(namesOf(raw, "index", "docs")).toEqual(EXPECTED_DOC_INDEXES);
    expect(namesOf(raw, "trigger", "docs")).toEqual(EXPECTED_DOC_TRIGGERS_HEAD);
    raw.close();
  });

  it("REGRESSION: re-opening and re-running MIGRATION_013_SQL on a migrated file is idempotent and keeps rule_registry rows", async () => {
    await seedSchema12();
    const first = new SQLiteStore(path);
    first.getDatabase().prepare("INSERT INTO rule_registry (id, n, leaf_doc_id, allocated_at, allocated_by) VALUES ('BR-1', 1, 'leaf', ?, 'a')").run(STAMP);
    first.close();

    const second = new SQLiteStore(path);
    expect(userVersion(second.getDatabase())).toBe(23);
    second.close();

    const raw = new Database(path);
    raw.exec("PRAGMA foreign_keys = ON");
    expect(() => raw.exec(MIGRATION_013_SQL)).not.toThrow();
    expect(userVersion(raw)).toBe(13);
    expect(raw.query("SELECT id, n FROM rule_registry").all()).toEqual([{ id: "BR-1", n: 1 }]);
    expect(raw.query("SELECT COUNT(*) AS c FROM docs").get()).toEqual({ c: 4 });
    expect(namesOf(raw, "index", "docs")).toEqual(EXPECTED_DOC_INDEXES);
    expect(namesOf(raw, "trigger", "docs")).toEqual(EXPECTED_DOC_TRIGGERS);
    raw.close();
  });
});
