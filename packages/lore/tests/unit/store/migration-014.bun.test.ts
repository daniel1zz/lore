/**
 * @spec_ref spec-baseline-slice-2-completeness-census-per-branch-citation (C5 Rule indexes, AC-BLS2-4)
 * @task task-skill-test-red-migration-014-indexes-backfill-and-mismatch (RED; paired impl = migration-014 task)
 *
 * Tests for migration-014: rule_registry gains `lifecycle` + `version`; new tables
 * `ac_cites(doc_id, ac_id, rule_id)`, `rule_depends(leaf_id, rule_id)` and an empty
 * `ac_exemptions`; all backfilled FROM THE DOCUMENTS inside the migration. Status reports any
 * index-vs-document disagreement as a count. Runner: `bun test` (bun:sqlite) — never vitest.
 *
 * ── PINNED CONTRACT (the implementation builds to exactly this) ─────────────────────────
 *   - `packages/lore/src/store/migrations/migration-014.ts` exports `MIGRATION_014_SQL: string`
 *     (re-runnable on a migrated file without error or row change, like MIGRATION_013_SQL).
 *   - `LATEST_SCHEMA_VERSION === 14`; `PRAGMA user_version = 14` after opening a schema-13 file.
 *   - `rule_registry.lifecycle` mirrors the rule's lifecycle in its leaf (`live|deprecated|retired`);
 *     `rule_registry.version` equals the OWNING LEAF DOC's `version` (the leaf write that last
 *     touched the rule). Every leaf write through the store keeps both in the same transaction.
 *   - `ac_cites`: one row per (spec doc id, AC id, cited rule id) from
 *     `extra.acceptance_criteria[].cites` of live specs. `rule_depends`: one row per
 *     (leaf doc id, rule id) from a leaf's `extra.depends_on`. `ac_exemptions` exists, empty.
 *   - `computeBaselineStatus(...)` result carries `index_mismatch: number` = number of
 *     index-vs-document disagreements (missing, stray or stale registry/ac_cites/rule_depends
 *     rows); 0 on a clean corpus. It is a count only — never silently repaired.
 *
 * ── How the schema-13 fixture is built (no dependency on the migration under test) ──────
 * A head-schema SQLiteStore seeds docs through its own insert path; the file is then regressed:
 * the 014 tables are dropped, `rule_registry` is rebuilt with its exact migration-013 DDL, rows
 * for the 5 rules are inserted, and `user_version = 13`. The next `new SQLiteStore(path, { migrate: true })` runs the
 * REAL migration-014 against a populated schema-13 file.
 *
 * Corpus: leaf A (version 3) holds BR-1 live, BR-2 deprecated, BR-3 retired, depends_on [BR-4];
 * leaf B (version 2) holds BR-4 live, BR-5 live, depends_on [BR-1, BR-2]. Spec S1 has AC-1 -> BR-1,
 * AC-2 -> BR-2, AC-3 (no cites); spec S2 has AC-1 -> BR-4. => 3 citations, 3 depends rows.
 */

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DocRecord } from "@lore/core";
import { RuleService } from "../../../src/service/rule-service.js";
import { RuleStateService } from "../../../src/service/rule-state-service.js";
import { computeBaselineStatus } from "../../../src/service/baseline-status.js";
import { LATEST_SCHEMA_VERSION } from "../../../src/store/schema-version.js";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { makeRuleService } from "../../helpers/make-rule-service.js";
import { approveAllPending } from "../../helpers/approve-baseline.js";
import { actedStore } from "../../live-invocation.js";

// Variable specifier: migration-014.ts does not exist yet; the file must still load and typecheck.
const MIGRATION_014_MODULE = "../../../src/store/migrations/migration-014.js";

async function loadMigration014Sql(): Promise<string> {
  let mod: Record<string, unknown>;
  try {
    mod = (await import(MIGRATION_014_MODULE)) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`MISSING BEHAVIOUR: module ${MIGRATION_014_MODULE} not found (${String(e)})`);
  }
  const sql = mod.MIGRATION_014_SQL;
  if (typeof sql !== "string") {
    throw new Error(`MISSING BEHAVIOUR: ${MIGRATION_014_MODULE} does not export MIGRATION_014_SQL: string`);
  }
  return sql;
}

const STAMP = "2026-10-08T00:00:00.000Z";
const LEAF_A = "01HM014LEAFA000000000001";
const LEAF_B = "01HM014LEAFB000000000001";
const SPEC_1 = "01HM014SPEC1000000000001";
const SPEC_2 = "01HM014SPEC2000000000001";
const LEAF_A_VERSION = 3;
const LEAF_B_VERSION = 2;

function rule(id: string, lifecycle: "live" | "deprecated" | "retired", n: number) {
  return {
    id,
    statement: `Rule ${n} states an observable behaviour`,
    confidence: "established",
    enforced_by: "guaranteed",
    examples: [`example ${n}`],
    lifecycle,
    ...(lifecycle === "retired" ? { retired_note: "superseded" } : {}),
  };
}

function makeDoc(id: string, slug: string, over: Partial<DocRecord>): DocRecord {
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

const ac = (id: string, cites?: string[]) => ({
  id,
  statement: `criterion ${id}`,
  verify: { mode: "script", oracle: "test", command: "bun test x" },
  ...(cites ? { cites } : {}),
});

function userVersion(db: Database): number {
  return (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
}

function columnNames(db: Database, table: string): string[] {
  return (db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

function tableExists(db: Database, table: string): boolean {
  return db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== null;
}

/** Regress a head-schema file to the exact schema-13 shape (see module doc). */
function regressToSchema13(path: string): void {
  const db = new Database(path);
  db.exec("BEGIN IMMEDIATE");
  db.exec("DROP TABLE IF EXISTS ac_cites");
  db.exec("DROP TABLE IF EXISTS rule_depends");
  db.exec("DROP TABLE IF EXISTS ac_exemptions");
  db.exec("DROP TABLE IF EXISTS rule_registry");
  db.exec(`CREATE TABLE rule_registry (
    id TEXT PRIMARY KEY,
    n INTEGER NOT NULL UNIQUE,
    leaf_doc_id TEXT NOT NULL,
    allocated_at TEXT NOT NULL,
    allocated_by TEXT NOT NULL
  )`);
  const ins = db.prepare("INSERT INTO rule_registry (id, n, leaf_doc_id, allocated_at, allocated_by) VALUES (?, ?, ?, ?, ?)");
  const owners: Array<[string, number, string]> = [
    ["BR-1", 1, LEAF_A],
    ["BR-2", 2, LEAF_A],
    ["BR-3", 3, LEAF_A],
    ["BR-4", 4, LEAF_B],
    ["BR-5", 5, LEAF_B],
  ];
  for (const [id, n, leaf] of owners) ins.run(id, n, leaf, STAMP, "agent:test");
  db.exec("PRAGMA user_version = 13");
  db.exec("COMMIT");
  db.close();
}

describe("migration-014 (registry lifecycle/version, ac_cites, rule_depends, ac_exemptions)", () => {
  let dir: string;
  let path: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lore-migration-014-"));
    path = join(dir, "lore.db");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  async function seedSchema13(): Promise<void> {
    const seed = actedStore(new SQLiteStore(path, { migrate: true }));
    const docs: DocRecord[] = [
      makeDoc(LEAF_A, "m14-leaf-a", {
        type: "baseline",
        role: "intent",
        // reason: approved, so migration 027 (a never-approved node's rules become pending adds) leaves the rules live.
        status: "approved",
        version: LEAF_A_VERSION,
        extra: {
          node: "leaf",
          depends_on: ["BR-4"],
          rules: [rule("BR-1", "live", 1), rule("BR-2", "deprecated", 2), rule("BR-3", "retired", 3)],
        },
      }),
      makeDoc(LEAF_B, "m14-leaf-b", {
        type: "baseline",
        role: "intent",
        status: "approved",
        version: LEAF_B_VERSION,
        extra: { node: "leaf", depends_on: ["BR-1", "BR-2"], rules: [rule("BR-4", "live", 4), rule("BR-5", "live", 5)] },
      }),
      makeDoc(SPEC_1, "m14-spec-1", {
        type: "spec",
        role: "spec",
        extra: { acceptance_criteria: [ac("AC-1", ["BR-1"]), ac("AC-2", ["BR-2"]), ac("AC-3")] },
      }),
      makeDoc(SPEC_2, "m14-spec-2", {
        type: "spec",
        role: "spec",
        extra: { acceptance_criteria: [ac("AC-1", ["BR-4"])] },
      }),
    ];
    for (const d of docs) expect((await seed.insert(d)).ok).toBe(true);
    seed.close();
    regressToSchema13(path);
  }

  function snapshot(db: Database): Record<string, unknown[]> {
    return {
      registry: db.query("SELECT * FROM rule_registry ORDER BY n").all(),
      cites: db.query("SELECT * FROM ac_cites ORDER BY doc_id, ac_id, rule_id").all(),
      depends: db.query("SELECT * FROM rule_depends ORDER BY leaf_id, rule_id").all(),
      exemptions: db.query("SELECT * FROM ac_exemptions").all(),
    };
  }

  async function statusOf(store: SQLiteStore) {
    // MOCK RISK: git port is a trap — `counts()` is documented git-free, so any call is a regression.
    const git = new Proxy({}, { get: () => () => { throw new Error("git must not be touched by status"); } });
    const ruleState = new RuleStateService(store, git as never);
    const res = await computeBaselineStatus(store, ruleState, () => true);
    if (!res.ok || res.value === null) throw new Error("baseline status unavailable");
    return res.value as unknown as Record<string, unknown>;
  }

  it("NEGATIVE: the schema-13 fixture really lacks the 014 objects (red without the migration)", async () => {
    await seedSchema13();
    const raw = new Database(path);
    expect(userVersion(raw)).toBe(13);
    expect(columnNames(raw, "rule_registry")).toEqual(["id", "n", "leaf_doc_id", "allocated_at", "allocated_by"]);
    expect(tableExists(raw, "ac_cites")).toBe(false);
    expect(tableExists(raw, "rule_depends")).toBe(false);
    expect(tableExists(raw, "ac_exemptions")).toBe(false);
    raw.close();
  });

  it("STATE: opening a schema-13 file lands on user_version 22 == LATEST_SCHEMA_VERSION (014, 015, 016, 017: runs.ended_at, then 018: proposed registry state)", async () => {
    await seedSchema13();
    const store = actedStore(new SQLiteStore(path, { migrate: true }));
    expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(22);
    expect(userVersion(store.getDatabase())).toBe(LATEST_SCHEMA_VERSION);
    store.close();
  });

  it("HAPPY: rule_registry carries lifecycle + version per rule, matching the owning leaves", async () => {
    await seedSchema13();
    const store = actedStore(new SQLiteStore(path, { migrate: true }));
    const rows = store
      .getDatabase()
      .query("SELECT id, leaf_doc_id, lifecycle, version FROM rule_registry ORDER BY n")
      .all();
    expect(rows).toEqual([
      { id: "BR-1", leaf_doc_id: LEAF_A, lifecycle: "live", version: LEAF_A_VERSION },
      { id: "BR-2", leaf_doc_id: LEAF_A, lifecycle: "deprecated", version: LEAF_A_VERSION },
      { id: "BR-3", leaf_doc_id: LEAF_A, lifecycle: "retired", version: LEAF_A_VERSION },
      { id: "BR-4", leaf_doc_id: LEAF_B, lifecycle: "live", version: LEAF_B_VERSION },
      { id: "BR-5", leaf_doc_id: LEAF_B, lifecycle: "live", version: LEAF_B_VERSION },
    ]);
    store.close();
  });

  it("HAPPY: ac_cites has exactly the 3 citing criteria as (doc_id, ac_id, rule_id) rows; the uncited AC adds none", async () => {
    await seedSchema13();
    const store = actedStore(new SQLiteStore(path, { migrate: true }));
    const rows = store.getDatabase().query("SELECT doc_id, ac_id, rule_id FROM ac_cites ORDER BY doc_id, ac_id").all();
    expect(rows).toEqual([
      { doc_id: SPEC_1, ac_id: "AC-1", rule_id: "BR-1" },
      { doc_id: SPEC_1, ac_id: "AC-2", rule_id: "BR-2" },
      { doc_id: SPEC_2, ac_id: "AC-1", rule_id: "BR-4" },
    ]);
    store.close();
  });

  it("HAPPY: rule_depends mirrors each leaf's depends_on", async () => {
    await seedSchema13();
    const store = actedStore(new SQLiteStore(path, { migrate: true }));
    const rows = store.getDatabase().query("SELECT leaf_id, rule_id FROM rule_depends ORDER BY leaf_id, rule_id").all();
    expect(rows).toEqual([
      { leaf_id: LEAF_A, rule_id: "BR-4" },
      { leaf_id: LEAF_B, rule_id: "BR-1" },
      { leaf_id: LEAF_B, rule_id: "BR-2" },
    ]);
    store.close();
  });

  it("BOUNDARY: ac_exemptions exists and is empty after migration (no exemption is invented by the backfill)", async () => {
    await seedSchema13();
    const store = actedStore(new SQLiteStore(path, { migrate: true }));
    const db = store.getDatabase();
    expect(tableExists(db, "ac_exemptions")).toBe(true);
    expect(db.query("SELECT COUNT(*) AS c FROM ac_exemptions").get()).toEqual({ c: 0 });
    store.close();
  });

  it("REGRESSION: re-opening and re-running MIGRATION_014_SQL yields identical rows (idempotent)", async () => {
    await seedSchema13();
    const first = actedStore(new SQLiteStore(path, { migrate: true }));
    const before = snapshot(first.getDatabase());
    expect((before.cites as unknown[]).length).toBe(3);
    first.close();

    const second = actedStore(new SQLiteStore(path, { migrate: true }));
    expect(snapshot(second.getDatabase())).toEqual(before);
    second.close();

    const MIGRATION_014_SQL = await loadMigration014Sql();
    const raw = new Database(path);
    raw.exec("PRAGMA foreign_keys = ON");
    expect(() => raw.exec(MIGRATION_014_SQL)).not.toThrow();
    expect(userVersion(raw)).toBe(14);
    // reason: 014 rebuilds rule_registry from its five original columns (dropping migration-015's
    // `prefix`), so a re-run of 014 on a migrated file is only complete once the chain tail (015) re-runs.
    const { MIGRATION_015_SQL } = await import("../../../src/store/migrations/migration-015.js");
    expect(() => raw.exec(MIGRATION_015_SQL)).not.toThrow();
    expect(userVersion(raw)).toBe(15);
    expect(snapshot(raw)).toEqual(before);
    raw.close();
  });

  it("STATE: a clean migrated corpus reports index_mismatch 0", async () => {
    await seedSchema13();
    const store = actedStore(new SQLiteStore(path, { migrate: true }));
    expect((await statusOf(store))["index_mismatch"]).toBe(0);
    store.close();
  });

  it("NEGATIVE: removing one ac_cites row makes the status mismatch count exactly 1", async () => {
    await seedSchema13();
    const store = actedStore(new SQLiteStore(path, { migrate: true }));
    const db = store.getDatabase();
    expect(db.prepare("DELETE FROM ac_cites WHERE doc_id = ? AND ac_id = 'AC-2'").run(SPEC_1).changes).toBe(1);
    expect((await statusOf(store))["index_mismatch"]).toBe(1);
    store.close();
  });

  it("NEGATIVE: a stray ac_cites row and a missing rule_depends row are each counted (mismatch is a count, not a flag)", async () => {
    await seedSchema13();
    const store = actedStore(new SQLiteStore(path, { migrate: true }));
    const db = store.getDatabase();
    db.prepare("INSERT INTO ac_cites (doc_id, ac_id, rule_id) VALUES (?, 'AC-3', 'BR-5')").run(SPEC_1);
    db.prepare("DELETE FROM rule_depends WHERE leaf_id = ? AND rule_id = 'BR-2'").run(LEAF_B);
    expect((await statusOf(store))["index_mismatch"]).toBe(2);
    store.close();
  });

  it("NEGATIVE: a stale registry lifecycle is counted and NOT silently repaired by the status check", async () => {
    await seedSchema13();
    const store = actedStore(new SQLiteStore(path, { migrate: true }));
    const db = store.getDatabase();
    db.prepare("UPDATE rule_registry SET lifecycle = 'live' WHERE id = 'BR-3'").run();
    expect((await statusOf(store))["index_mismatch"]).toBe(1);
    expect(db.query("SELECT lifecycle FROM rule_registry WHERE id = 'BR-3'").get()).toEqual({ lifecycle: "live" });
    store.close();
  });

  it("STATE: `rule set` lifecycle change updates registry lifecycle + version to match the leaf (two different rules)", async () => {
    await seedSchema13();
    const store = actedStore(new SQLiteStore(path, { migrate: true }));
    const rules = makeRuleService(store);
    const db = store.getDatabase();

    // reason: `rule set --lifecycle deprecated` is refused since D4 (spec-a-spec-carries-its-rule-changes-the-
    // baseline-takes-them); `retired` exercises the same leaf-write -> registry trigger path.
    const dep = await rules.setRule("BR-1", { lifecycle: "retired", note: "gone" }, { by: "agent:test" });
    expect(dep.ok).toBe(true);
    await approveAllPending(store); // a retirement is a pending revision: the registry follows it when approved
    const leafA = (await store.find(LEAF_A)) as { ok: true; value: DocRecord };
    expect(db.query("SELECT lifecycle, version FROM rule_registry WHERE id = 'BR-1'").get()).toEqual({
      lifecycle: "retired",
      version: leafA.value.version,
    });
    expect(leafA.value.version).toBeGreaterThan(LEAF_A_VERSION);

    const ret = await rules.setRule("BR-5", { lifecycle: "retired", note: "gone" }, { by: "agent:test" });
    expect(ret.ok).toBe(true);
    await approveAllPending(store);
    const leafB = (await store.find(LEAF_B)) as { ok: true; value: DocRecord };
    expect(db.query("SELECT lifecycle, version FROM rule_registry WHERE id = 'BR-5'").get()).toEqual({
      lifecycle: "retired",
      version: leafB.value.version,
    });
    // the untouched sibling rule on leaf A keeps a registry row consistent with the (bumped) leaf
    expect(db.query("SELECT lifecycle FROM rule_registry WHERE id = 'BR-2'").get()).toEqual({ lifecycle: "deprecated" });
    expect((await statusOf(store))["index_mismatch"]).toBe(0);
    store.close();
  });

  it("ERROR: if the registry update fails, the leaf lifecycle change rolls back (same transaction)", async () => {
    await seedSchema13();
    const store = actedStore(new SQLiteStore(path, { migrate: true }));
    const db = store.getDatabase();
    db.exec(
      `CREATE TRIGGER t_block_registry_update BEFORE UPDATE ON rule_registry
       BEGIN SELECT RAISE(ABORT, 'registry update blocked'); END`,
    );
    const res = await makeRuleService(store).setRule("BR-1", { lifecycle: "retired", note: "gone" }, { by: "agent:test" });
    expect(res.ok).toBe(false);
    const leafA = (await store.find(LEAF_A)) as { ok: true; value: DocRecord };
    const rules = leafA.value.extra["rules"] as Array<{ id: string; lifecycle: string }>;
    expect(rules.find((r) => r.id === "BR-1")?.lifecycle).toBe("live");
    expect(leafA.value.version).toBe(LEAF_A_VERSION);
    store.close();
  });
});
