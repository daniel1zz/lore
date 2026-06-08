/** @spec_ref AC-SETUP-002 */
/**
 * Validates bun:sqlite works correctly with in-memory databases.
 * These tests run in interpreted mode; the compiled binary validation
 * is done separately via scripts/sqlite-spike.ts + bun build --compile.
 *
 * AC-SETUP-002: bun:sqlite works in compiled binary (CREATE TABLE, INSERT, SELECT).
 */
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("bun:sqlite in-memory operations", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.run(`
      CREATE TABLE documents (
        id   TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        body TEXT NOT NULL
      )
    `);
  });

  afterEach(() => {
    db.close();
  });

  it("AC-SETUP-002.01: INSERT + SELECT round-trip returns correct data", () => {
    db.run("INSERT INTO documents VALUES (?, ?, ?)", [
      "doc-001",
      "prd",
      "Product requirements",
    ]);

    const row = db
      .query("SELECT id, type, body FROM documents WHERE id = ?")
      .get("doc-001") as { id: string; type: string; body: string } | null;

    expect(row).not.toBeNull();
    expect(row?.id).toBe("doc-001");
    expect(row?.type).toBe("prd");
    expect(row?.body).toBe("Product requirements");
  });

  it("AC-SETUP-002.02: multiple inserts and SELECT all returns correct count", () => {
    const insert = db.prepare(
      "INSERT INTO documents VALUES (?, ?, ?)"
    );
    insert.run("doc-001", "prd", "PRD body");
    insert.run("doc-002", "spec", "Spec body");
    insert.run("doc-003", "adr", "ADR body");

    const rows = db.query("SELECT id FROM documents ORDER BY id").all() as Array<{ id: string }>;
    expect(rows).toHaveLength(3);
    expect(rows[0]?.id).toBe("doc-001");
    expect(rows[2]?.id).toBe("doc-003");
  });

  it("AC-SETUP-002.02: UPDATE modifies only the targeted row", () => {
    db.run("INSERT INTO documents VALUES (?, ?, ?)", ["doc-001", "prd", "original"]);
    db.run("INSERT INTO documents VALUES (?, ?, ?)", ["doc-002", "spec", "unchanged"]);

    db.run("UPDATE documents SET body = ? WHERE id = ?", ["updated", "doc-001"]);

    const updated = db.query("SELECT body FROM documents WHERE id = ?").get("doc-001") as { body: string };
    const unchanged = db.query("SELECT body FROM documents WHERE id = ?").get("doc-002") as { body: string };

    expect(updated.body).toBe("updated");
    expect(unchanged.body).toBe("unchanged");
  });

  it("AC-SETUP-002.02: DELETE removes row and count decrements", () => {
    db.run("INSERT INTO documents VALUES (?, ?, ?)", ["doc-001", "prd", "body"]);
    db.run("INSERT INTO documents VALUES (?, ?, ?)", ["doc-002", "spec", "body"]);
    db.run("DELETE FROM documents WHERE id = ?", ["doc-001"]);

    const count = db.query("SELECT COUNT(*) AS cnt FROM documents").get() as { cnt: number };
    expect(count.cnt).toBe(1);
  });

  it("AC-SETUP-002.N01: SELECT on non-existent row returns null", () => {
    const row = db.query("SELECT * FROM documents WHERE id = ?").get("nope") as null;
    expect(row).toBeNull();
  });
});
