/**
 * Migration 048 — judging per template dimension. Runner: vitest on the Bun runtime (bun:sqlite).
 *
 * Builds a schema-46 corpus (`schemaCeiling: 46`) holding a legacy judgment, then opens it with `migrate: true`.
 *   HAPPY:      user_version becomes 48 and the two review_judgments columns plus the four tables exist
 *   REGRESSION: the legacy judgment survives with NULL template_ref / missing_dimensions
 *   STATE:      re-running the migration (a second migrate open) changes nothing
 *   NEGATIVE:   the partial unique index refuses a second pending revision for a template but allows one after the first is approved;
 *               the proposal CHECK refuses an accepted decision with no dimension id
 */

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DocRecord } from "@lore/core";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { actedStore } from "../../live-invocation.js";

let dir: string;
let path: string;
const STAMP = "2026-11-01T00:00:00.000Z";

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "lore-migration-048-"));
  path = join(dir, "lore.db");
  const old = actedStore(new SQLiteStore(path, { schemaCeiling: 46 }));
  const doc = {
    id: "01HM048MIG0000000000001",
    slug: "knowledge-before-048",
    type: "knowledge",
    role: "knowledge",
    title: "Before",
    status: "draft",
    priority: "medium",
    content: "x",
    parent_id: null,
    extra: { sub_type: "reference" },
    tags: [],
    version: 1,
    created_at: STAMP,
    updated_at: STAMP,
    created_by: "test",
    deleted_at: null,
  } as unknown as DocRecord;
  const inserted = await old.insert(doc);
  if (!inserted.ok) throw new Error(JSON.stringify(inserted.error));
  old.close();
  // reason: a schema-46 file has no template_ref column, so the legacy judgment is a raw insert of the pre-048 column set.
  const raw = new Database(path);
  raw.run(
    `INSERT INTO review_judgments (id, doc_id, doc_version, decision, confidence, reasons, checks, blocking_questions,
       judge_provider, judge_model, judge_prompt_version, created_at, created_by)
     VALUES ('j-legacy', ?, 1, 'approve', 0.9, '[]', '[]', '[]', 'p', 'm', 'v8', ?, 'ai:p:m:v8')`,
    [doc.id, STAMP],
  );
  raw.close();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function tables(db: Database): string[] {
  return (db.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
}

describe("migration 048", () => {
  it("HAPPY: creates the columns and tables at user_version 48", () => {
    const before = new Database(path);
    expect(before.query("PRAGMA user_version").get()).toEqual({ user_version: 46 });
    expect(tables(before)).not.toContain("template_revisions");
    before.close();

    new SQLiteStore(path, { migrate: true }).close();

    const after = new Database(path);
    expect(after.query("PRAGMA user_version").get()).toEqual({ user_version: 48 });
    for (const table of ["review_judgment_dimensions", "template_revisions", "template_proposals", "template_proposal_findings"]) {
      expect(tables(after)).toContain(table);
    }
    const cols = (after.query("PRAGMA table_info(review_judgments)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain("template_ref");
    expect(cols).toContain("missing_dimensions");
    after.close();
  });

  it("REGRESSION + STATE: the legacy judgment survives with NULL columns, and a second migrate open changes nothing", () => {
    new SQLiteStore(path, { migrate: true }).close();
    new SQLiteStore(path, { migrate: true }).close();
    const db = new Database(path);
    expect(db.query("SELECT id, template_ref, missing_dimensions FROM review_judgments").all()).toEqual([
      { id: "j-legacy", template_ref: null, missing_dimensions: null },
    ]);
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 48 });
    db.close();
  });

  it("NEGATIVE: one pending revision per template (a new one after approval is fine); an accepted proposal needs a dimension id", () => {
    new SQLiteStore(path, { migrate: true }).close();
    const db = new Database(path);
    const rev = (id: string, status: string) =>
      db.run("INSERT INTO template_revisions (id, template_slug, status, base_version, created_at, resolved_at) VALUES (?, 'tpl', ?, 1, ?, ?)", [
        id,
        status,
        STAMP,
        status === "approved" ? STAMP : null,
      ]);
    rev("r1", "pending");
    expect(() => rev("r2", "pending")).toThrow(/UNIQUE constraint failed/);
    rev("r3", "approved");
    db.run("UPDATE template_revisions SET status = 'approved', resolved_at = ? WHERE id = 'r1'", [STAMP]);
    expect(() => rev("r4", "pending")).not.toThrow();
    expect(() =>
      db.run("INSERT INTO template_proposals (id, revision_id, question, created_at, decision) VALUES ('p', 'r4', 'q', ?, 'accepted')", [STAMP]),
    ).toThrow(/CHECK constraint failed/);
    db.close();
  });
});
