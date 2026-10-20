// @spawns packages/lore/src/index.ts
/**
 * AC-FIXTURE-LANDED-1 (#323, task-a-schema-upgrade-promotes-pending-revisions-that-a-landed): migration 029 promotes each pending
 * rule revision that equals the LATEST applied entry of a spec change set for that rule id into the approved version,
 * and leaves every other pending revision pending. Migration 028 had turned reviewed, landed changes into pending
 * revisions (pre-BR-1211 `lore rule apply` demoted the leaf).
 *
 * Fixture: a throwaway `mkdtemp` corpus + `lore init`, whose db is replaced by one built by the real `SQLiteStore`
 * stopped at schema 28, then filled with raw rows: a draft leaf (approved BR-1, BR-3, BR-4, BR-5; pending modify of
 * BR-1, pending add BR-2, pending retire of BR-4, an unrelated pending modify of BR-3, a pending modify of BR-5 that
 * DIFFERS from its landed entry) and a spec whose change set carries the landed entries. Never touches the repo's
 * own `.lore/`.
 *
 * Coverage:
 *   HAPPY      add / modify / retire pending revisions equal to a landed entry become approved; `lore rule show` sees them.
 *   NEGATIVE   an unrelated pending revision, and one that differs from its landed entry, stay pending untouched.
 *   BOUNDARY   an unlanded change-set entry (no applied_at) promotes nothing; an older landed entry loses to a newer one.
 *   STATE      registry lifecycle follows the approved versions; ONE version row and ONE chained audit row per changed
 *              node, none for an untouched node; a second run changes nothing.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { SQLiteStore } from "../../src/store/sqlite-store";
import { LATEST_SCHEMA_VERSION } from "../../src/store/schema-version";
import { createPartyCorpus, type PartyCorpus } from "../helpers/known-party-corpus";

const TEST_TIMEOUT_MS = 90_000;
const PREVIOUS_SCHEMA = 28;
const NOW = "2026-10-01T00:00:00.000Z";
const MIGRATOR = { kind: "run", run: "cc:landed-changes-upgrade" } as const;

const LEAF_ID = "01LANDEDLEAF00000000000AA";
const QUIET_ID = "01QUIETLEAF000000000000BB";
const SPEC_ID = "01LANDEDSPEC00000000000CC";

let corpus: PartyCorpus;
let dbPath = "";

function runLore(args: string[]) {
  const run = corpus.lore(args, MIGRATOR);
  return { out: run.stdout + run.stderr, exitCode: run.exitCode };
}

function rule(id: string, statement: string, extra: Record<string, unknown> = {}) {
  return { id, statement, confidence: "established", enforced_by: "guaranteed", examples: ["e"], lifecycle: "live", ...extra };
}

const APPROVED_RULES = [rule("BR-1", "Old statement."), rule("BR-3", "Unrelated approved."), rule("BR-4", "To be retired."), rule("BR-5", "Approved five.")];
const APPROVED_EXTRA = { node: "leaf", label: "Landed leaf", rules: APPROVED_RULES };
const LEAF_EXTRA = {
  ...APPROVED_EXTRA,
  pending: {
    rules: {
      "BR-1": { revision_id: "m028-leaf-BR-1", rule: rule("BR-1", "Landed statement.") },
      "BR-2": { revision_id: "m028-leaf-BR-2", rule: rule("BR-2", "Landed add.") },
      "BR-3": { revision_id: "m028-leaf-BR-3", rule: rule("BR-3", "Unrelated pending edit.") },
      "BR-4": { revision_id: "m028-leaf-BR-4", rule: rule("BR-4", "To be retired.", { lifecycle: "retired", retired_note: "No longer true." }) },
      "BR-5": { revision_id: "m028-leaf-BR-5", rule: rule("BR-5", "Edited after landing.") },
    },
  },
};
const QUIET_EXTRA = { node: "leaf", label: "Quiet leaf", rules: [rule("BR-6", "Quiet statement.")] };
const SPEC_EXTRA = {
  rule_changes: [
    { op: "modify", id: "BR-1", statement: "Superseded statement.", applied_at: "2026-09-01T00:00:00.000Z" },
    { op: "add", id: "BR-2", leaf: "leaf-landed", statement: "Landed add.", examples: ["e"], enforced_by: "guaranteed", applied_at: "2026-09-02T00:00:00.000Z" },
    { op: "modify", id: "BR-1", statement: "Landed statement.", applied_at: "2026-09-03T00:00:00.000Z" },
    { op: "retire", id: "BR-4", note: "No longer true.", applied_at: "2026-09-04T00:00:00.000Z" },
    { op: "modify", id: "BR-5", statement: "Landed five.", applied_at: "2026-09-05T00:00:00.000Z" },
    // BR-3: proposed but never landed (no applied_at) — its pending revision must stay pending
    { op: "modify", id: "BR-3", statement: "Unrelated pending edit.", examples: ["e"] },
  ],
};

interface DocRow {
  id: string;
  version: number;
  status: string;
  extra: string;
}

function insertDoc(db: Database, row: { id: string; slug: string; type: string; status: string; extra: object; version: number }) {
  db.prepare(
    `INSERT INTO docs (id, slug, type, role, title, status, priority, content, parent_id, extra, tags, version, created_at, updated_at, created_by)
     VALUES (?, ?, ?, 'intent', ?, ?, 'medium', 'Body', NULL, ?, '[]', ?, ?, ?, 'human:tester')`,
  ).run(row.id, row.slug, row.type, row.slug, row.status, JSON.stringify(row.extra), row.version, NOW, NOW);
}

function insertVersion(db: Database, id: string, slug: string, version: number, status: string, extra: object) {
  db.prepare(
    `INSERT INTO versions (doc_id, version, content, extra, status, title, action, created_at, created_by, slug)
     VALUES (?, ?, 'Body', ?, ?, ?, ?, ?, 'human:tester', ?)`,
  ).run(id, version, JSON.stringify(extra), status, slug, status === "approved" ? "approve" : "update", NOW, slug);
}

function registerRule(db: Database, id: string, n: number, leafId: string, lifecycle: string) {
  db.prepare(`INSERT INTO rule_registry (id, n, leaf_doc_id, allocated_at, allocated_by, lifecycle, version) VALUES (?, ?, ?, ?, 'human:tester', ?, 1)`).run(id, n, leafId, NOW, lifecycle);
}

function withDb<T>(fn: (db: Database) => T): T {
  const db = new Database(dbPath, { readonly: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function dumpState(): string {
  return withDb((db) =>
    JSON.stringify({
      docs: db.query("SELECT id, status, extra, version FROM docs ORDER BY id").all(),
      versions: db.query("SELECT doc_id, version, status, extra, action FROM versions ORDER BY doc_id, version").all(),
      registry: db.query("SELECT id, leaf_doc_id, lifecycle, version FROM rule_registry ORDER BY id").all(),
      audit: db.query("SELECT id, actor, action, doc_id, details, prev_hash, entry_hash FROM audit ORDER BY id").all(),
    }),
  );
}

function leaf(): { rules: { id: string; statement: string; lifecycle: string; retired_note?: string }[]; pending?: { rules?: Record<string, { rule: { statement: string } }> } } {
  const row = withDb((db) => db.query("SELECT id, version, status, extra FROM docs WHERE id = ?").get(LEAF_ID)) as DocRow;
  return JSON.parse(row.extra);
}

function buildPreviousSchemaCorpus() {
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
  new SQLiteStore(dbPath, { schemaCeiling: PREVIOUS_SCHEMA }).close();
  const db = new Database(dbPath);
  try {
    insertDoc(db, { id: LEAF_ID, slug: "leaf-landed", type: "baseline", status: "draft", extra: LEAF_EXTRA, version: 2 });
    insertVersion(db, LEAF_ID, "leaf-landed", 1, "approved", APPROVED_EXTRA);
    insertVersion(db, LEAF_ID, "leaf-landed", 2, "draft", LEAF_EXTRA);
    insertDoc(db, { id: QUIET_ID, slug: "leaf-quiet", type: "baseline", status: "approved", extra: QUIET_EXTRA, version: 1 });
    insertVersion(db, QUIET_ID, "leaf-quiet", 1, "approved", QUIET_EXTRA);
    insertDoc(db, { id: SPEC_ID, slug: "spec-landed", type: "spec", status: "approved", extra: SPEC_EXTRA, version: 1 });
    insertVersion(db, SPEC_ID, "spec-landed", 1, "approved", SPEC_EXTRA);
    registerRule(db, "BR-1", 1, LEAF_ID, "live");
    registerRule(db, "BR-2", 2, LEAF_ID, "proposed");
    registerRule(db, "BR-3", 3, LEAF_ID, "live");
    registerRule(db, "BR-4", 4, LEAF_ID, "live");
    registerRule(db, "BR-5", 5, LEAF_ID, "live");
    registerRule(db, "BR-6", 6, QUIET_ID, "live");
  } finally {
    db.close();
  }
  expect(withDb((d) => (d.query("PRAGMA user_version").get() as { user_version: number }).user_version)).toBe(PREVIOUS_SCHEMA);
}

beforeAll(() => {
  corpus = createPartyCorpus("landed-changes-upgrade");
  dbPath = join(corpus.dir, ".lore", "lore.db");
}, TEST_TIMEOUT_MS);

afterAll(() => {
  corpus.cleanup();
});

describe("AC-FIXTURE-LANDED-1: the schema upgrade promotes pending revisions that a landed change set accounts for", () => {
  let afterFirst = "";

  beforeAll(() => {
    buildPreviousSchemaCorpus();
    const res = runLore(["migrate", "schema"]);
    expect(res.exitCode, res.out).toBe(0);
    afterFirst = dumpState();
  }, TEST_TIMEOUT_MS);

  it("HAPPY: the corpus reaches the latest schema", () => {
    expect(withDb((d) => (d.query("PRAGMA user_version").get() as { user_version: number }).user_version)).toBe(LATEST_SCHEMA_VERSION);
  });

  it("HAPPY: modify, add and retire revisions equal to the latest landed entry are approved", () => {
    const rules = Object.fromEntries(leaf().rules.map((r) => [r.id, r]));
    expect(rules["BR-1"]?.statement).toBe("Landed statement.");
    expect(rules["BR-2"]?.statement).toBe("Landed add.");
    expect(rules["BR-2"]?.lifecycle).toBe("live");
    expect(rules["BR-4"]?.lifecycle).toBe("retired");
    expect(rules["BR-4"]?.retired_note).toBe("No longer true.");
  });

  it("HAPPY: `lore rule show` shows the promoted rule", () => {
    const shown = runLore(["rule", "show", "BR-2"]);
    expect(shown.exitCode, shown.out).toBe(0);
    expect(shown.out).toContain("Landed add.");
  }, TEST_TIMEOUT_MS);

  it("NEGATIVE/BOUNDARY: an unlanded entry's revision and one differing from its landed entry stay pending, untouched", () => {
    const pending = leaf().pending?.rules ?? {};
    expect(Object.keys(pending).sort()).toEqual(["BR-3", "BR-5"]);
    expect(pending["BR-3"]?.rule.statement).toBe("Unrelated pending edit.");
    expect(pending["BR-5"]?.rule.statement).toBe("Edited after landing.");
    const approved = Object.fromEntries(leaf().rules.map((r) => [r.id, r.statement]));
    expect(approved["BR-3"]).toBe("Unrelated approved.");
    expect(approved["BR-5"]).toBe("Approved five.");
  });

  it("STATE: the registry follows the approved versions", () => {
    const registry = withDb((db) => db.query("SELECT id, lifecycle FROM rule_registry ORDER BY id").all()) as { id: string; lifecycle: string }[];
    expect(Object.fromEntries(registry.map((r) => [r.id, r.lifecycle]))).toEqual({
      "BR-1": "live",
      "BR-2": "live",
      "BR-3": "live",
      "BR-4": "retired",
      "BR-5": "live",
      "BR-6": "live",
    });
  });

  it("STATE: ONE version row and ONE chained audit row for the changed node, none for the untouched node", () => {
    withDb((db) => {
      const count = (id: string) => (db.query("SELECT COUNT(*) AS n FROM versions WHERE doc_id = ?").get(id) as { n: number }).n;
      expect(count(LEAF_ID)).toBe(3);
      expect(count(QUIET_ID)).toBe(1);
      const written = db.query("SELECT action, status, created_by FROM versions WHERE doc_id = ? AND version = 3").get(LEAF_ID) as { action: string; status: string; created_by: string };
      expect(written.action).toBe("update");
      expect(written.status).toBe("draft");
      const rows = db.query("SELECT actor, action, doc_id, prev_hash, entry_hash FROM audit ORDER BY id").all() as {
        actor: string;
        action: string;
        doc_id: string | null;
        prev_hash: string | null;
        entry_hash: string | null;
      }[];
      const promoted = rows.filter((r) => r.action === "migrate-schema-029");
      expect(promoted.map((r) => r.doc_id)).toEqual([LEAF_ID]);
      expect(promoted[0]?.actor).toBe(rows.find((r) => r.action === "migrate_schema")?.actor);
      expect(written.created_by).toBe(promoted[0]?.actor);
      rows.forEach((row, index) => {
        expect(row.entry_hash).toMatch(/^[0-9a-f]{64}$/);
        expect(row.prev_hash).toBe(index === 0 ? "" : rows[index - 1]?.entry_hash);
      });
    });
  });

  it("STATE: a second run changes nothing", () => {
    const res = runLore(["migrate", "schema"]);
    expect(res.exitCode, res.out).toBe(0);
    expect(dumpState()).toBe(afterFirst);
  }, TEST_TIMEOUT_MS);
});
