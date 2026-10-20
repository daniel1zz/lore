// @spawns packages/lore/src/index.ts
/**
 * AC-BIA-7 (spec-baseline-approval-is-per-item-an-edit-adds-a-pending, BR-1341): `lore migrate schema` converts
 * every baseline node to items once. Approved node -> unchanged (its content is the approved version of every item);
 * draft node with an approved past -> approved versions from its last approved version, each difference pending;
 * never-approved node -> every item pending. The registry marks a pending add `proposed`; a second run changes nothing.
 *
 * Fixture: a throwaway `mkdtemp` directory + `lore init`, whose db is replaced by one built by the real `SQLiteStore`
 * stopped one schema behind (`schemaCeiling`), then filled with raw rows. The CLI is spawned from source. Never
 * touches the repo's own `.lore/`.
 *
 * Coverage:
 *   HAPPY      the three node kinds convert as BR-1341 says; user_version reaches the latest.
 *   NEGATIVE   a corrupt baseline `extra` fails the migration loudly (exit non-zero) and leaves the corpus behind.
 *   BOUNDARY   the approved node is byte-identical after the upgrade (no new version row).
 *   STATE      the registry: a pending add is `proposed`, an approved rule stays `live`; a second run changes nothing.
 *   REGRESSION the approved leaf's rule still governs after the conversion (it stays in `extra.rules`).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { SQLiteStore } from "../../src/store/sqlite-store";
import { LATEST_SCHEMA_VERSION } from "../../src/store/schema-version";
import { createPartyCorpus, type PartyCorpus } from "../helpers/known-party-corpus";

const TEST_TIMEOUT_MS = 90_000;
const BEHIND = LATEST_SCHEMA_VERSION - 1;
const NOW = "2026-10-01T00:00:00.000Z";
/** The agent run that drives `lore migrate schema` (a known party; the conversion is attributed to it). */
const MIGRATOR = { kind: "run", run: "cc:baseline-items-upgrade" } as const;

let corpus: PartyCorpus;
let dbPath = "";

/** `lore <args>` in the throwaway corpus as the migrating run; `out` is stdout + stderr. */
function runLore(args: string[]) {
  const run = corpus.lore(args, MIGRATOR);
  return { out: run.stdout + run.stderr, exitCode: run.exitCode };
}

function rule(id: string, statement: string) {
  return { id, statement, confidence: "established", enforced_by: "guaranteed", examples: ["e"], lifecycle: "live" };
}

interface DocRow {
  id: string;
  slug: string;
  title: string;
  status: string;
  content: string;
  extra: string;
  version: number;
}

function insertDoc(db: Database, row: { id: string; slug: string; title: string; status: string; content: string; extra: object; version: number }) {
  db.prepare(
    `INSERT INTO docs (id, slug, type, role, title, status, priority, content, parent_id, extra, tags, version, created_at, updated_at, created_by)
     VALUES (?, ?, 'baseline', 'intent', ?, ?, 'medium', ?, NULL, ?, '[]', ?, ?, ?, 'human:tester')`,
  ).run(row.id, row.slug, row.title, row.status, row.content, JSON.stringify(row.extra), row.version, NOW, NOW);
}

function insertVersion(db: Database, docId: string, slug: string, version: number, status: string, title: string, content: string, extra: object) {
  db.prepare(
    `INSERT INTO versions (doc_id, version, content, extra, status, title, action, created_at, created_by, slug)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'human:tester', ?)`,
  ).run(docId, version, content, JSON.stringify(extra), status, title, status === "approved" ? "approve" : "update", NOW, slug);
}

function registerRule(db: Database, id: string, n: number, leafId: string) {
  db.prepare(`INSERT INTO rule_registry (id, n, leaf_doc_id, allocated_at, allocated_by, lifecycle, version) VALUES (?, ?, ?, ?, 'human:tester', 'live', 1)`).run(
    id,
    n,
    leafId,
    NOW,
  );
}

const APPROVED_EXTRA = { node: "leaf", label: "Approved leaf", commands: ["ac add"], rules: [rule("BR-1", "Approved statement.")] };
const PAST_EXTRA = { node: "leaf", label: "Past leaf", rules: [rule("BR-2", "Old statement."), rule("BR-3", "Unchanged statement.")] };
const DRAFT_EXTRA = {
  node: "leaf",
  label: "Past leaf",
  rules: [rule("BR-2", "Revised statement."), rule("BR-3", "Unchanged statement."), rule("BR-4", "Added since.")],
};
const NEVER_EXTRA = { node: "leaf", label: "Never approved", depends_on: ["BR-1"], rules: [rule("BR-5", "Never approved statement.")] };

function readDocs(path: string): Record<string, DocRow> {
  const db = new Database(path, { readonly: true });
  try {
    const rows = db.query("SELECT id, slug, title, status, content, extra, version FROM docs WHERE type = 'baseline'").all() as DocRow[];
    return Object.fromEntries(rows.map((r) => [r.id, r]));
  } finally {
    db.close();
  }
}

function dumpState(path: string): string {
  const db = new Database(path, { readonly: true });
  try {
    return JSON.stringify({
      docs: db.query("SELECT id, title, status, content, extra, version FROM docs ORDER BY id").all(),
      versions: db.query("SELECT doc_id, version, status, extra, action FROM versions ORDER BY doc_id, version").all(),
      registry: db.query("SELECT id, leaf_doc_id, lifecycle, version FROM rule_registry ORDER BY id").all(),
      audit: db.query("SELECT id, actor, action, doc_id, details, prev_hash, entry_hash FROM audit ORDER BY id").all(),
    });
  } finally {
    db.close();
  }
}

function userVersion(path: string): number {
  const db = new Database(path, { readonly: true });
  try {
    return (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
  } finally {
    db.close();
  }
}

function registryLifecycles(path: string): Record<string, string> {
  const db = new Database(path, { readonly: true });
  try {
    const rows = db.query("SELECT id, lifecycle FROM rule_registry").all() as { id: string; lifecycle: string }[];
    return Object.fromEntries(rows.map((r) => [r.id, r.lifecycle]));
  } finally {
    db.close();
  }
}

function buildBehindCorpus(withCorruptNode: boolean) {
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
  new SQLiteStore(dbPath, { schemaCeiling: BEHIND }).close();
  const db = new Database(dbPath);
  try {
    insertDoc(db, { id: "01APPROVEDLEAF0000000000AA", slug: "leaf-approved", title: "Approved leaf", status: "approved", content: "Body A", extra: APPROVED_EXTRA, version: 1 });
    insertVersion(db, "01APPROVEDLEAF0000000000AA", "leaf-approved", 1, "approved", "Approved leaf", "Body A", APPROVED_EXTRA);
    insertDoc(db, { id: "01DRAFTPASTLEAF000000000BB", slug: "leaf-draft-past", title: "Past leaf edited", status: "draft", content: "Body edited", extra: DRAFT_EXTRA, version: 2 });
    insertVersion(db, "01DRAFTPASTLEAF000000000BB", "leaf-draft-past", 1, "approved", "Past leaf", "Body past", PAST_EXTRA);
    insertVersion(db, "01DRAFTPASTLEAF000000000BB", "leaf-draft-past", 2, "draft", "Past leaf edited", "Body edited", DRAFT_EXTRA);
    insertDoc(db, { id: "01NEVERAPPROVEDLEAF00000CC", slug: "leaf-never", title: "Never approved", status: "draft", content: "Body N", extra: NEVER_EXTRA, version: 1 });
    insertVersion(db, "01NEVERAPPROVEDLEAF00000CC", "leaf-never", 1, "draft", "Never approved", "Body N", NEVER_EXTRA);
    if (withCorruptNode) {
      db.prepare(
        `INSERT INTO docs (id, slug, type, role, title, status, priority, content, parent_id, extra, tags, version, created_at, updated_at, created_by)
         VALUES ('01CORRUPTLEAF0000000000DD', 'leaf-corrupt', 'baseline', 'intent', 'Corrupt', 'draft', 'medium', '', NULL, '[1]', '[]', 1, ?, ?, 'human:tester')`,
      ).run(NOW, NOW);
    }
    registerRule(db, "BR-1", 1, "01APPROVEDLEAF0000000000AA");
    registerRule(db, "BR-2", 2, "01DRAFTPASTLEAF000000000BB");
    registerRule(db, "BR-3", 3, "01DRAFTPASTLEAF000000000BB");
    registerRule(db, "BR-4", 4, "01DRAFTPASTLEAF000000000BB");
    registerRule(db, "BR-5", 5, "01NEVERAPPROVEDLEAF00000CC");
  } finally {
    db.close();
  }
  expect(userVersion(dbPath)).toBe(BEHIND);
}

beforeAll(() => {
  corpus = createPartyCorpus("baseline-items-upgrade");
  dbPath = join(corpus.dir, ".lore", "lore.db");
}, TEST_TIMEOUT_MS);

afterAll(() => {
  corpus.cleanup();
});

describe("AC-BIA-7: the schema upgrade converts baseline nodes to items once", () => {
  it("NEGATIVE: a corrupt baseline extra fails the upgrade loudly and leaves the corpus behind", () => {
    buildBehindCorpus(true);
    const res = runLore(["migrate", "schema"]);
    expect(res.exitCode).not.toBe(0);
    expect(res.out).toContain("leaf-corrupt");
    expect(userVersion(dbPath)).toBe(BEHIND);
  }, TEST_TIMEOUT_MS);

  describe("on a clean previous-schema corpus", () => {
    let before = "";
    let afterFirst = "";

    beforeAll(() => {
      buildBehindCorpus(false);
      before = dumpState(dbPath);
      const res = runLore(["migrate", "schema"]);
      expect(res.exitCode, res.out).toBe(0);
      afterFirst = dumpState(dbPath);
    }, TEST_TIMEOUT_MS);

    it("HAPPY: user_version reaches the latest schema", () => {
      expect(userVersion(dbPath)).toBe(LATEST_SCHEMA_VERSION);
      expect(before).not.toBe(afterFirst);
    });

    it("BOUNDARY: the approved node is untouched (same version, same extra)", () => {
      const doc = readDocs(dbPath)["01APPROVEDLEAF0000000000AA"] as DocRow;
      expect(doc.version).toBe(1);
      expect(JSON.parse(doc.extra)).toEqual(APPROVED_EXTRA);
      expect(doc.status).toBe("approved");
    });

    it("HAPPY: the draft node keeps its last approved version and the differences are pending", () => {
      const doc = readDocs(dbPath)["01DRAFTPASTLEAF000000000BB"] as DocRow;
      const extra = JSON.parse(doc.extra) as { rules: { id: string; statement: string }[]; pending: { rules: Record<string, { revision_id: string; rule: { statement: string } }>; node?: { title?: string; content?: string } } };
      expect(extra.rules.map((r) => [r.id, r.statement])).toEqual([
        ["BR-2", "Old statement."],
        ["BR-3", "Unchanged statement."],
      ]);
      expect(Object.keys(extra.pending.rules).sort()).toEqual(["BR-2", "BR-4"]);
      expect(extra.pending.rules["BR-2"]?.rule.statement).toBe("Revised statement.");
      expect(extra.pending.rules["BR-4"]?.rule.statement).toBe("Added since.");
      expect(extra.pending.rules["BR-2"]?.revision_id).toBeTruthy();
      // the node's own part: the approved title/body are restored, the edit is pending
      expect(doc.title).toBe("Past leaf");
      expect(doc.content).toBe("Body past");
      expect(extra.pending.node?.title).toBe("Past leaf edited");
      expect(extra.pending.node?.content).toBe("Body edited");
      // the conversion is a real write: version 3, with its own versions row
      expect(doc.version).toBe(3);
    });

    it("STATE: a converted node gets ONE new version row and ONE hash-chained audit row; an untouched approved node gets none", () => {
      const db = new Database(dbPath, { readonly: true });
      try {
        const versionCount = (docId: string) => (db.query("SELECT COUNT(*) AS n FROM versions WHERE doc_id = ?").get(docId) as { n: number }).n;
        expect(versionCount("01APPROVEDLEAF0000000000AA")).toBe(1);
        expect(versionCount("01DRAFTPASTLEAF000000000BB")).toBe(3);
        expect(versionCount("01NEVERAPPROVEDLEAF00000CC")).toBe(2);
        const written = db
          .query("SELECT doc_id, version, action, status, created_by FROM versions WHERE doc_id = '01DRAFTPASTLEAF000000000BB' AND version = 3")
          .get() as { action: string; status: string; created_by: string };
        expect(written.action).toBe("update");
        expect(written.status).toBe("draft");
        expect(written.created_by).not.toBe("");

        const rows = db.query("SELECT id, actor, action, doc_id, details, prev_hash, entry_hash FROM audit ORDER BY id").all() as {
          id: number;
          actor: string;
          action: string;
          doc_id: string | null;
          details: string;
          prev_hash: string | null;
          entry_hash: string | null;
        }[];
        const migrated = rows.filter((r) => r.action === "migrate-schema-028");
        expect(migrated.map((r) => r.doc_id).sort()).toEqual(["01DRAFTPASTLEAF000000000BB", "01NEVERAPPROVEDLEAF00000CC"]);
        expect(rows.some((r) => r.doc_id === "01APPROVEDLEAF0000000000AA")).toBe(false);
        for (const row of migrated) expect(row.actor).toBe(rows.find((r) => r.action === "migrate_schema")?.actor);
        expect(JSON.parse(migrated[0]?.details ?? "{}").summary).toContain("split into approved + pending items");
        // chained like any write: each row's prev_hash is the previous row's entry_hash
        rows.forEach((row, index) => {
          expect(row.entry_hash).toMatch(/^[0-9a-f]{64}$/);
          expect(row.prev_hash).toBe(index === 0 ? "" : rows[index - 1]?.entry_hash);
        });
      } finally {
        db.close();
      }
    });

    it("HAPPY: the never-approved node has every item pending and no approved rule", () => {
      const doc = readDocs(dbPath)["01NEVERAPPROVEDLEAF00000CC"] as DocRow;
      const extra = JSON.parse(doc.extra) as { rules?: unknown[]; depends_on?: string[]; label?: string; pending: { rules: Record<string, unknown>; node: { label?: string; depends_on?: string[] } } };
      expect(extra.rules ?? []).toEqual([]);
      expect(extra.label).toBeUndefined();
      expect(extra.depends_on).toBeUndefined();
      expect(Object.keys(extra.pending.rules)).toEqual(["BR-5"]);
      expect(extra.pending.node.label).toBe("Never approved");
      expect(extra.pending.node.depends_on).toEqual(["BR-1"]);
    });

    it("STATE: the registry marks a pending add proposed and keeps approved rules live", () => {
      expect(registryLifecycles(dbPath)).toEqual({
        "BR-1": "live",
        "BR-2": "live",
        "BR-3": "live",
        "BR-4": "proposed",
        "BR-5": "proposed",
      });
    });

    it("STATE: a second run changes nothing", () => {
      const res = runLore(["migrate", "schema"]);
      expect(res.exitCode, res.out).toBe(0);
      expect(dumpState(dbPath)).toBe(afterFirst);
    }, TEST_TIMEOUT_MS);
  });
});
