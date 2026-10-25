/**
 * Migration 037 (R1, #404) — `links.link_type` admits 'known-defect', and every plan -> issue `resolves` link whose
 * issue carrier records `extra.milestone_findings` becomes a `known-defect` link in the same migration.
 *
 * Dimensions: HAPPY (batch link converted), NEGATIVE (hand link, task link and non-array record untouched; a
 * schema-36 corpus refuses 'known-defect'), BOUNDARY (upgrade from exactly 36), STATE (other columns and
 * indexes kept, user_version = LATEST), REGRESSION (reopening a migrated corpus changes nothing).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { LATEST_SCHEMA_VERSION } from "../../../src/store/schema-version.js";

let dir = "";
let dbPath = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lore-m037-"));
  dbPath = join(dir, "c.db");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function insertDoc(store: SQLiteStore, id: string, type: string, extra: string): void {
  store
    .getDatabase()
    .prepare(
      `INSERT INTO docs (id, slug, type, role, title, status, priority, content, parent_id, extra, tags, version,
         created_at, updated_at, created_by, deleted_at, fts_title, fts_content, fts_tags)
       VALUES (?, ?, ?, ?, ?, 'draft', 'medium', 'c', NULL, ?, '[]', 1,
         '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'agent:t', NULL, '', '', '')`,
    )
    .run(id, `${type}-${id.toLowerCase()}`, type, type === "plan" ? "plan" : "knowledge", id, extra);
}

function insertLink(store: SQLiteStore, from: string, to: string, type: string): void {
  store
    .getDatabase()
    .prepare(`INSERT INTO links (from_id, to_id, link_type, created_at, created_by) VALUES (?, ?, ?, '2026-01-02T00:00:00.000Z', 'agent:t')`)
    .run(from, to, type);
}

function linkTypes(store: SQLiteStore): [string, string, string][] {
  const rows = store.getDatabase().query("SELECT from_id, to_id, link_type FROM links ORDER BY from_id, to_id").all() as {
    from_id: string; to_id: string; link_type: string;
  }[];
  return rows.map((r) => [r.from_id, r.to_id, r.link_type]);
}

const FINDINGS = '{"milestone_findings":[{"dimension":"regression","fingerprint":"f1"}],"issue_report":{}}';

function seedAt36(): void {
  const old = new SQLiteStore(dbPath, { schemaCeiling: 36 });
  insertDoc(old, "PLAN1", "plan", "{}");
  insertDoc(old, "TASK1", "task", "{}");
  insertDoc(old, "ISSUE_BATCH", "task", FINDINGS);
  insertDoc(old, "ISSUE_HAND", "task", '{"issue_report":{}}');
  insertDoc(old, "ISSUE_BADREC", "task", '{"milestone_findings":"oops","issue_report":{}}');
  insertLink(old, "PLAN1", "ISSUE_BATCH", "resolves");
  insertLink(old, "PLAN1", "ISSUE_HAND", "resolves");
  insertLink(old, "PLAN1", "ISSUE_BADREC", "resolves");
  insertLink(old, "TASK1", "ISSUE_BATCH", "resolves");
  insertLink(old, "TASK1", "PLAN1", "relates-to");
  old.close();
}

describe("migration 037 known-defect link type", () => {
  it("a schema-36 corpus refuses 'known-defect' (negative control)", () => {
    const old = new SQLiteStore(dbPath, { schemaCeiling: 36 });
    insertDoc(old, "PLAN1", "plan", "{}");
    insertDoc(old, "ISSUE1", "task", "{}");
    expect(() => insertLink(old, "PLAN1", "ISSUE1", "known-defect")).toThrow(/CHECK/i);
    old.close();
  });

  it("converts only batch links: plan -> issue resolves with milestone_findings", () => {
    seedAt36();
    const store = new SQLiteStore(dbPath, { migrate: true });
    expect(linkTypes(store)).toEqual([
      ["PLAN1", "ISSUE_BADREC", "resolves"],
      ["PLAN1", "ISSUE_BATCH", "known-defect"],
      ["PLAN1", "ISSUE_HAND", "resolves"],
      ["TASK1", "ISSUE_BATCH", "resolves"],
      ["TASK1", "PLAN1", "relates-to"],
    ]);
    store.close();
  });

  it("lands on LATEST_SCHEMA_VERSION, accepts the new type and keeps the indexes", () => {
    seedAt36();
    const store = new SQLiteStore(dbPath, { migrate: true });
    const db = store.getDatabase();
    expect((db.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(LATEST_SCHEMA_VERSION);
    expect(() => insertLink(store, "PLAN1", "TASK1", "known-defect")).not.toThrow();
    const indexes = (db.query("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='links'").all() as { name: string }[]).map((i) => i.name);
    expect(indexes).toEqual(expect.arrayContaining(["idx_links_from", "idx_links_to", "idx_links_type"]));
    const row = db.query("SELECT created_at, created_by FROM links WHERE to_id = 'ISSUE_BATCH' AND from_id = 'PLAN1'").get() as { created_at: string; created_by: string };
    expect(row).toEqual({ created_at: "2026-01-02T00:00:00.000Z", created_by: "agent:t" });
    store.close();
  });

  it("REGRESSION: reopening a migrated corpus changes nothing", () => {
    seedAt36();
    const first = new SQLiteStore(dbPath, { migrate: true });
    const before = linkTypes(first);
    first.close();
    const again = new SQLiteStore(dbPath);
    expect(linkTypes(again)).toEqual(before);
    again.close();
  });
});
