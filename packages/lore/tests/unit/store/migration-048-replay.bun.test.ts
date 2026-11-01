/**
 * @spec_ref spec-every-document-is-stored-as-structured-fields-validated-by
 *
 * Migration 048 adds `review_judgments.template_ref` / `missing_dimensions` only where `PRAGMA table_info` lacks them and creates its tables
 * with IF NOT EXISTS, so a store whose `user_version` was rewound and reopened with migrate replays it without `duplicate column name`
 * and without losing a stored verdict row, revision or proposal.
 *
 * Coverage: HAPPY (rewind to 47 and to 34, reopen: succeeds, version back at head) / REGRESSION (a judgment's template_ref, its verdict
 * rows, a pending revision and its proposal survive the replay) / BOUNDARY (a v47 file that lacks the two columns still gets them) /
 * both SQLite and Turso.
 */

import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DocId } from "@lore/core";
import { LATEST_SCHEMA_VERSION } from "../../../src/store/schema-version.js";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { TursoStore } from "../../../src/store/turso-store.js";
import { actedStore } from "../../live-invocation.js";

/** Opens with migrate, forces schema init to finish (TursoStore inits lazily on first use), then closes. Rejects if the migration throws. */
async function migrateAndClose(store: SQLiteStore | TursoStore): Promise<void> {
  const acted = actedStore(store);
  try {
    const probe = await acted.find("00000000-0000-0000-0000-000000000000" as DocId);
    if (!probe.ok) throw new Error(`store open failed: ${JSON.stringify(probe.error)}`);
  } finally {
    store.close();
  }
}

const CASES = [
  { label: "SQLiteStore", open: (path: string) => migrateAndClose(new SQLiteStore(path, { migrate: true })) },
  { label: "TursoStore", open: (path: string) => migrateAndClose(new TursoStore({ localPath: path, migrate: true })) },
] as const;

const STAMP = "2026-11-01T00:00:00.000Z";

function seed(path: string): void {
  const db = new Database(path);
  db.run(
    `INSERT INTO docs (id, slug, type, role, title, status, priority, content, extra, tags, version, created_at, updated_at, created_by)
     VALUES ('d1', 'knowledge-replay', 'knowledge', 'knowledge', 'T', 'draft', 'medium', '', '{}', '[]', 1, ?, ?, 'test')`,
    [STAMP, STAMP],
  );
  db.run(
    `INSERT INTO review_judgments (id, doc_id, doc_version, decision, confidence, reasons, checks, blocking_questions,
       judge_provider, judge_model, judge_prompt_version, template_ref, missing_dimensions, created_at, created_by)
     VALUES ('j1', 'd1', 1, 'approve', 0.9, '[]', '[]', '[]', 'p', 'm', 'v9', 'tpl@1', '[{"question":"Q?"}]', ?, 'ai:p:m:v9')`,
    [STAMP],
  );
  db.run("INSERT INTO review_judgment_dimensions (judgment_id, dimension_id, verdict, reason, evidence) VALUES ('j1', 'a', 'pass', 'r', 'e')");
  db.run("INSERT INTO template_revisions (id, template_slug, status, base_version, created_at) VALUES ('r1', 'tpl', 'pending', 1, ?)", [STAMP]);
  db.run("INSERT INTO template_proposals (id, revision_id, question, created_at) VALUES ('p1', 'r1', 'Q?', ?)", [STAMP]);
  db.run("INSERT INTO template_proposal_findings (proposal_id, judgment_id, created_at) VALUES ('p1', 'j1', ?)", [STAMP]);
  db.close();
}

function rewind(path: string, version: number): void {
  const db = new Database(path);
  db.exec(`PRAGMA user_version = ${version}`);
  db.close();
}

describe.each(CASES)("migration 048 replay ($label)", ({ open }) => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lore-m048-"));
    path = join(dir, "lore.db");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function expectSeedSurvived(): void {
    const db = new Database(path, { readonly: true });
    try {
      expect(db.query("SELECT template_ref, missing_dimensions FROM review_judgments WHERE id = 'j1'").get()).toEqual({
        template_ref: "tpl@1",
        missing_dimensions: '[{"question":"Q?"}]',
      });
      expect(db.query("SELECT verdict FROM review_judgment_dimensions WHERE judgment_id = 'j1'").all()).toEqual([{ verdict: "pass" }]);
      expect(db.query("SELECT status FROM template_revisions WHERE id = 'r1'").get()).toEqual({ status: "pending" });
      expect(db.query("SELECT count(*) AS n FROM template_proposal_findings WHERE proposal_id = 'p1'").get()).toEqual({ n: 1 });
      expect((db.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(LATEST_SCHEMA_VERSION);
    } finally {
      db.close();
    }
  }

  it.each([47, 34])("reopening a store rewound to user_version %i succeeds and keeps every stored row", async (version) => {
    await open(path);
    seed(path);
    rewind(path, version);

    await open(path);

    expectSeedSurvived();
  });

  it("a v47 file without the two columns gets them", async () => {
    await open(path);
    const db = new Database(path);
    db.exec("ALTER TABLE review_judgments DROP COLUMN template_ref");
    db.exec("ALTER TABLE review_judgments DROP COLUMN missing_dimensions");
    db.exec("PRAGMA user_version = 47");
    db.close();

    await open(path);

    const after = new Database(path, { readonly: true });
    const cols = (after.query("PRAGMA table_info(review_judgments)").all() as { name: string }[]).map((c) => c.name);
    after.close();
    expect(cols).toContain("template_ref");
    expect(cols).toContain("missing_dimensions");
  });
});
