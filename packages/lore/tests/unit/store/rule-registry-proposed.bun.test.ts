/**
 * @spec_ref spec-a-spec-carries-its-rule-changes-the-baseline-takes-them (Model: registry state `proposed`)
 *
 * `reserveProposedRuleAndUpdateSpec` (migration-018): reserve the next permanent id as `proposed` AND write the
 * spec's change set in ONE transaction, touching NO leaf. The SAME suite runs against SQLiteStore (temp file),
 * TursoStore (local libsql file mode) and InMemoryStore. Migration 018 itself is checked on SQLite.
 * Runner: `bun test` (bun:sqlite) — never vitest.
 *
 * Dimensions: HAPPY (reserve, next id continues), NEGATIVE (stale / unknown spec / unknown owner leaf burn nothing),
 * STATE (the leaf's version and rules are untouched; a status demotion + change_summary land on the spec's version
 * row), REGRESSION (a live allocation after a proposed one gets the next n; migration 018 keeps rows and accepts
 * 'proposed' while the CHECK still refuses an unknown state).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DOC_TYPE_ROLE_MAP, type DocRecord } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import type { StoreInterface } from "../../../src/store/store-interface.js";
import { TursoStore } from "../../../src/store/turso-store.js";
import { MIGRATION_015_SQL } from "../../../src/store/migrations/migration-015.js";
import { MIGRATION_018_SQL } from "../../../src/store/migrations/migration-018.js";
import { actedStore } from "../../live-invocation.js";
import { LATEST_SCHEMA_VERSION } from "../../../src/store/schema-version.js";

let counter = 0;
function doc(type: "spec" | "baseline", label: string, extra: Record<string, unknown>, status: DocRecord["status"] = "draft"): DocRecord {
  counter += 1;
  const stamp = "2026-10-12T00:00:00.000Z";
  return {
    id: `01HPROPOSED${String(counter).padStart(15, "0")}`,
    slug: `${type}-proposed-${label}-${counter}`,
    type,
    role: DOC_TYPE_ROLE_MAP[type],
    title: `${type} ${label}`,
    status,
    priority: "medium",
    content: label,
    parent_id: null,
    extra,
    tags: [],
    version: 1,
    created_at: stamp,
    updated_at: stamp,
    created_by: "agent:test",
    deleted_at: null,
    ordinal: null,
  } as DocRecord;
}

async function seed(store: StoreInterface, record: DocRecord): Promise<DocRecord> {
  const inserted = await store.insert(record);
  if (!inserted.ok) throw new Error(`seed failed: ${JSON.stringify(inserted.error)}`);
  return record;
}

const withChange = (spec: DocRecord) => (ruleId: string) => ({
  ...spec.extra,
  rule_changes: [{ op: "add", id: ruleId, leaf: "leaf", statement: "s", examples: ["e"], enforced_by: "both" }],
});

interface SuiteOpts {
  label: string;
  create: () => { store: StoreInterface; cleanup: () => void };
}

function runSuite(o: SuiteOpts): void {
  describe(`proposed rule reservation — ${o.label}`, () => {
    let store: StoreInterface;
    let cleanup: () => void;
    beforeEach(() => {
      ({ store, cleanup } = o.create());
    });
    afterEach(() => cleanup());

    it("HAPPY: reserves BR-1 as proposed on the leaf, writes the spec, leaves the leaf untouched", async () => {
      const leaf = await seed(store, doc("baseline", "leaf", { node: "leaf", rules: [] }));
      const spec = await seed(store, doc("spec", "a", {}));
      const reserved = await store.reserveProposedRuleAndUpdateSpec(
        { specId: spec.id, expectedVersion: 1, buildExtra: withChange(spec), ownerLeafId: leaf.id },
        "agent:test",
      );
      expect(reserved.ok).toBe(true);
      if (!reserved.ok) return;
      expect(reserved.value.ruleId).toBe("BR-1");
      expect(reserved.value.doc.version).toBe(2);
      const rows = await store.listRuleRegistry();
      expect(rows.ok && rows.value.map((r) => [r.id, r.leaf_doc_id, r.lifecycle])).toEqual([["BR-1", leaf.id, "proposed"]]);
      const leafAfter = await store.find(leaf.id);
      expect(leafAfter.ok && leafAfter.value?.version).toBe(1);
      expect(leafAfter.ok && leafAfter.value?.extra).toEqual({ node: "leaf", rules: [] });
    });

    it("REGRESSION: the next allocation (proposed or live) continues the numbering, ids are never reused", async () => {
      const leaf = await seed(store, doc("baseline", "leaf", { node: "leaf", rules: [] }));
      const spec = await seed(store, doc("spec", "a", {}));
      await store.reserveProposedRuleAndUpdateSpec(
        { specId: spec.id, expectedVersion: 1, buildExtra: withChange(spec), ownerLeafId: leaf.id },
        "agent:test",
      );
      const live = await store.allocateRuleAndUpdateLeaf(
        leaf.id,
        1,
        (id) => ({ node: "leaf", rules: [{ id, statement: "s", confidence: "established", enforced_by: "both", examples: ["e"], lifecycle: "live" }] }),
        "agent:test",
      );
      expect(live.ok && live.value.ruleId).toBe("BR-2");
      const second = await store.reserveProposedRuleAndUpdateSpec(
        { specId: spec.id, expectedVersion: 2, buildExtra: withChange(spec), ownerLeafId: leaf.id },
        "agent:test",
      );
      expect(second.ok && second.value.ruleId).toBe("BR-3");
      const rows = await store.listRuleRegistry();
      expect(rows.ok && rows.value.map((r) => [r.id, r.lifecycle])).toEqual([
        ["BR-1", "proposed"],
        ["BR-2", "live"],
        ["BR-3", "proposed"],
      ]);
    });

    it("NEGATIVE: a stale spec version is STALE_VERSION and burns no id", async () => {
      const leaf = await seed(store, doc("baseline", "leaf", { node: "leaf" }));
      const spec = await seed(store, doc("spec", "a", {}));
      const stale = await store.reserveProposedRuleAndUpdateSpec(
        { specId: spec.id, expectedVersion: 7, buildExtra: withChange(spec), ownerLeafId: leaf.id },
        "agent:test",
      );
      expect(!stale.ok && stale.error.code).toBe("STALE_VERSION");
      const rows = await store.listRuleRegistry();
      expect(rows.ok && rows.value).toEqual([]);
      const ok = await store.reserveProposedRuleAndUpdateSpec(
        { specId: spec.id, expectedVersion: 1, buildExtra: withChange(spec), ownerLeafId: leaf.id },
        "agent:test",
      );
      expect(ok.ok && ok.value.ruleId).toBe("BR-1");
    });

    it("NEGATIVE: an unknown owner leaf rolls the spec write back and burns no id", async () => {
      const spec = await seed(store, doc("spec", "a", {}));
      const refused = await store.reserveProposedRuleAndUpdateSpec(
        { specId: spec.id, expectedVersion: 1, buildExtra: withChange(spec), ownerLeafId: "01HNOSUCHLEAF000000000000" as never },
        "agent:test",
      );
      expect(refused.ok).toBe(false);
      const specAfter = await store.find(spec.id);
      expect(specAfter.ok && specAfter.value?.version).toBe(1);
      expect(specAfter.ok && specAfter.value?.extra).toEqual({});
      const rows = await store.listRuleRegistry();
      expect(rows.ok && rows.value).toEqual([]);
    });

    it("NEGATIVE: an unknown spec is DOC_NOT_FOUND", async () => {
      const leaf = await seed(store, doc("baseline", "leaf", { node: "leaf" }));
      const refused = await store.reserveProposedRuleAndUpdateSpec(
        { specId: "01HNOSUCHSPEC000000000000" as never, expectedVersion: 1, buildExtra: () => ({}), ownerLeafId: leaf.id },
        "agent:test",
      );
      expect(!refused.ok && refused.error.code).toBe("DOC_NOT_FOUND");
    });

    it("STATE: a status demotion and change_summary land on the spec's one new version row", async () => {
      const leaf = await seed(store, doc("baseline", "leaf", { node: "leaf" }));
      const spec = await seed(store, doc("spec", "a", {}, "approved"));
      const reserved = await store.reserveProposedRuleAndUpdateSpec(
        { specId: spec.id, expectedVersion: 1, buildExtra: withChange(spec), ownerLeafId: leaf.id, status: "draft", changeSummary: "Rule change proposed: add" },
        "agent:test",
      );
      expect(reserved.ok && reserved.value.doc.status).toBe("draft");
      const versions = await store.findVersions(spec.id, { limit: 10 });
      const row = versions.ok ? versions.value.find((v) => v.version === 2) : undefined;
      expect([row?.status, row?.change_summary]).toEqual(["draft", "Rule change proposed: add"]);
    });
  });
}

function tmpDb(prefix: string): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, path: join(dir, "lore.db") };
}

runSuite({ label: "InMemoryStore", create: () => ({ store: actedStore(new InMemoryStore()), cleanup: () => undefined }) });

runSuite({
  label: "SQLiteStore",
  create: () => {
    const { dir, path } = tmpDb("lore-proposed-sqlite-");
    const store = actedStore(new SQLiteStore(path, { migrate: true }));
    return {
      store,
      cleanup: () => {
        store.close();
        rmSync(dir, { recursive: true, force: true });
      },
    };
  },
});

runSuite({
  label: "TursoStore (local file mode)",
  create: () => {
    const { dir, path } = tmpDb("lore-proposed-turso-");
    const store = actedStore(new TursoStore({ localPath: path }));
    return {
      store,
      cleanup: () => {
        store.close();
        rmSync(dir, { recursive: true, force: true });
      },
    };
  },
});

describe("migration-018 (SQLite)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lore-migration-018-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const insertRow = (db: Database, id: string, n: number, lifecycle: string) =>
    db
      .prepare("INSERT INTO rule_registry (id, prefix, n, leaf_doc_id, allocated_at, allocated_by, lifecycle, version) VALUES (?, 'BR', ?, 'leaf', 't', 'a', ?, 1)")
      .run(id, n, lifecycle);

  it("STATE: a fresh store accepts 'proposed' and the CHECK still refuses an unknown state", () => {
    const store = actedStore(new SQLiteStore(join(dir, "fresh.db")));
    const db = store.getDatabase();
    expect(() => insertRow(db, "BR-1", 1, "proposed")).not.toThrow();
    expect(() => insertRow(db, "BR-2", 2, "planned")).toThrow();
    store.close();
  });

  it("REGRESSION: upgrading a v17 file keeps every registry row and lands on user_version 22 (019 follows 018)", () => {
    const path = join(dir, "v17.db");
    actedStore(new SQLiteStore(path, { migrate: true })).close();
    const raw = new Database(path);
    // Rebuild the pre-018 shape: migration-015's table (CHECK without 'proposed'), then a live row, then v17.
    raw.exec(MIGRATION_015_SQL);
    insertRow(raw, "BR-1", 1, "live");
    insertRow(raw, "BR-2", 2, "retired");
    expect(() => insertRow(raw, "BR-3", 3, "proposed")).toThrow();
    raw.exec("PRAGMA user_version = 17");
    raw.close();

    const upgraded = actedStore(new SQLiteStore(path, { migrate: true }));
    const rows = upgraded.getDatabase().query("SELECT id, lifecycle FROM rule_registry ORDER BY n").all();
    expect(rows).toEqual([
      { id: "BR-1", lifecycle: "live" },
      { id: "BR-2", lifecycle: "retired" },
    ]);
    expect(() => insertRow(upgraded.getDatabase(), "BR-3", 3, "proposed")).not.toThrow();
    expect((upgraded.getDatabase().query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(LATEST_SCHEMA_VERSION);
    upgraded.close();
  });

  it("REGRESSION: re-running the migration SQL is a no-op that keeps a proposed row", () => {
    const store = actedStore(new SQLiteStore(join(dir, "rerun.db")));
    const db = store.getDatabase();
    insertRow(db, "BR-1", 1, "proposed");
    db.exec(MIGRATION_018_SQL);
    expect(db.query("SELECT id, lifecycle FROM rule_registry").all()).toEqual([{ id: "BR-1", lifecycle: "proposed" }]);
    store.close();
  });
});
