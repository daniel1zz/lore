#!/usr/bin/env bun
/**
 * Tech spike: validates bun:sqlite works in both interpreted and compiled mode.
 * Creates an in-memory DB, performs DDL + DML, asserts query results.
 */

import { Database } from "bun:sqlite";

function runSpikeTests(): void {
  const db = new Database(":memory:");

  // DDL
  db.run(`
    CREATE TABLE IF NOT EXISTS documents (
      id   TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      body TEXT NOT NULL
    )
  `);

  // DML - insert
  const insert = db.prepare(
    "INSERT INTO documents (id, type, body) VALUES (?, ?, ?)"
  );
  insert.run("doc-001", "prd", "Product requirements document body");
  insert.run("doc-002", "spec", "Feature specification body");
  insert.run("doc-003", "adr", "Architecture decision record body");

  // SELECT all
  const rows = db.query("SELECT id, type, body FROM documents ORDER BY id").all() as Array<{
    id: string;
    type: string;
    body: string;
  }>;

  if (rows.length !== 3) {
    throw new Error(`Expected 3 rows, got ${rows.length}`);
  }

  const first = rows[0];
  if (!first || first.id !== "doc-001" || first.type !== "prd") {
    throw new Error(`Unexpected first row: ${JSON.stringify(first)}`);
  }

  // SELECT by type
  const specRows = db
    .query("SELECT id FROM documents WHERE type = ?")
    .all("spec") as Array<{ id: string }>;

  if (specRows.length !== 1 || specRows[0]?.id !== "doc-002") {
    throw new Error(`Unexpected spec rows: ${JSON.stringify(specRows)}`);
  }

  // UPDATE + re-query
  db.run("UPDATE documents SET body = ? WHERE id = ?", [
    "Updated body",
    "doc-001",
  ]);
  const updated = db
    .query("SELECT body FROM documents WHERE id = ?")
    .get("doc-001") as { body: string } | null;

  if (!updated || updated.body !== "Updated body") {
    throw new Error(`Update failed: ${JSON.stringify(updated)}`);
  }

  // DELETE + count
  db.run("DELETE FROM documents WHERE type = ?", ["adr"]);
  const countRow = db.query("SELECT COUNT(*) AS cnt FROM documents").get() as {
    cnt: number;
  };

  if (countRow.cnt !== 2) {
    throw new Error(`Expected 2 rows after delete, got ${countRow.cnt}`);
  }

  db.close();

  console.log("bun:sqlite spike: ALL CHECKS PASSED");
  console.log(`  - CREATE TABLE: OK`);
  console.log(`  - INSERT 3 rows: OK`);
  console.log(`  - SELECT all (3 rows): OK`);
  console.log(`  - SELECT by type (1 row): OK`);
  console.log(`  - UPDATE + re-query: OK`);
  console.log(`  - DELETE + count (2 rows): OK`);
}

runSpikeTests();
