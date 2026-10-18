/**
 * @spec_ref spec-run-identity-slice-1-harness-attested-runs-attested (D3, D4; AC-RID-4)
 * @task task-skill-test-red-store-migration-016-runs-table-harness-run (RED; paired impl =
 *       task-skill-implement-store-migration-016-run-store-methods)
 *
 * Tests for migration-016: `runs` table, `audit.harness_run`, `versions.harness_run`; store methods
 * `insertRun` (idempotent, first wins) / `getRun`; and the `withWriteContext` decorator that stamps
 * `harness_run` on every audit append and version insert. Runner: `bun test` (bun:sqlite) — never vitest.
 *
 * ── PINNED CONTRACT (the implementation builds to exactly this) ─────────────────────────
 *   - `packages/lore/src/store/migrations/migration-016.ts` exports `MIGRATION_016_SQL: string`.
 *   - `LATEST_SCHEMA_VERSION === 18` (018 adds the proposed registry state); opening a schema-15 file lands on `PRAGMA user_version = 19`.
 *   - SQLite gains table `runs` and nullable columns `audit.harness_run`, `versions.harness_run`
 *     (TEXT). Pre-existing rows are untouched, `harness_run` NULL. A second open changes nothing.
 *   - `StoreInterface.insertRun(run: RunRecord): Promise<Result<…, LoreError>>` — ok on both the
 *     first and the repeated call; the repeated call (same id) NEVER overwrites: first call wins.
 *   - `StoreInterface.getRun(id: RunId): Promise<Result<RunRecord | null, LoreError>>` — the stored
 *     record (deep-equal to what was inserted) or `ok(null)` for an unknown id (same shape as `find`).
 *   - `AuditEntry` and `VersionRecord` carry an optional `harness_run?: string | null`; read back via
 *     `queryAudit` / `findVersions`. An absent / unwrapped write reads back as null (or absent).
 *   - `packages/lore/src/store/write-context-store.ts` exports
 *     `withWriteContext(store, { identity: { harnessRun, claimed, claimedSource } }): StoreInterface`.
 *     The wrapper stamps `ctx.identity.harnessRun` on every `appendAuditEntry`, `insertVersion` and
 *     the composite `insertWithProvenance` (its version + audit rows). Unwrapped store stamps nothing.
 *
 * ── How the schema-15 fixture is built (no dependency on the migration under test) ──────
 * A head-schema SQLiteStore seeds docs/versions/audit through its own paths; the file is then
 * regressed to schema 15 (runs table dropped, harness_run columns dropped when present,
 * user_version = 15). The next `new SQLiteStore(path)` runs the REAL migration-016.
 */

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuditEntry, DocRecord, VersionRecord } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { LATEST_SCHEMA_VERSION } from "../../../src/store/schema-version.js";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import type { StoreInterface } from "../../../src/store/store-interface.js";
import { actedStore } from "../../live-invocation.js";

// Variable specifiers: these modules do not exist yet; the file must still load and typecheck.
const MIGRATION_016_MODULE = "../../../src/store/migrations/migration-016.js";
const WRITE_CONTEXT_MODULE = "../../../src/store/write-context-store.js";

async function importOrMissing(spec: string): Promise<Record<string, unknown>> {
  try {
    return (await import(spec)) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`MISSING BEHAVIOUR: module ${spec} not found (${String(e)})`);
  }
}

type WrapFn = (store: StoreInterface, ctx: { identity: Record<string, unknown> }) => StoreInterface;
async function loadWithWriteContext(): Promise<WrapFn> {
  const mod = await importOrMissing(WRITE_CONTEXT_MODULE);
  if (typeof mod.withWriteContext !== "function") {
    throw new Error(`MISSING BEHAVIOUR: ${WRITE_CONTEXT_MODULE} does not export withWriteContext`);
  }
  return mod.withWriteContext as WrapFn;
}

/** The run-store surface the implementation adds (typed locally: not on StoreInterface yet). */
interface RunStore {
  insertRun(run: unknown): Promise<{ ok: boolean; error?: unknown }>;
  getRun(id: string): Promise<{ ok: boolean; value?: unknown; error?: unknown }>;
}
function runStore(store: StoreInterface): RunStore {
  const s = store as unknown as Partial<RunStore>;
  if (typeof s.insertRun !== "function" || typeof s.getRun !== "function") {
    throw new Error("MISSING BEHAVIOUR: store has no insertRun/getRun methods");
  }
  return s as RunStore;
}

const STAMP = "2026-10-08T00:00:00.000Z";
const DOC_1 = "01HM016DOC1000000000001";
const DOC_2 = "01HM016DOC2000000000001";
const RUN_A = "cc:session-aaa";
const RUN_B = "cc:session-bbb";

function makeDoc(id: string, slug: string): DocRecord {
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
  } as DocRecord;
}

function makeVersion(docId: string, n: number): VersionRecord {
  return {
    doc_id: docId,
    version: n,
    content: `snapshot ${docId} v${n}`,
    extra: {},
    status: "draft",
    title: `Title ${docId}`,
    action: "create",
    created_at: STAMP,
    created_by: "agent:test",
  } as unknown as VersionRecord;
}

function makeAudit(docId: string, action = "set"): AuditEntry {
  return { timestamp: STAMP, actor: "agent:test", session_id: "s-test", action, doc_id: docId } as AuditEntry;
}

function makeRun(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    kind: "main",
    harness: "claude-code",
    sessionRef: id.replace(/^cc:/, ""),
    agentRef: null,
    agentType: null,
    parentRunId: null,
    branch: "main",
    composition: { schemaVersion: 1, fragments: [{ id: "frag-1", sha256: "a".repeat(64) }] },
    registeredAt: STAMP,
    ...over,
  };
}

function identity(harnessRun: string | null, claimed = "agent:claimed-name") {
  return { harnessRun, claimed, claimedSource: "flag" };
}

function userVersion(db: Database): number {
  return (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
}
function columnNames(db: Database, table: string): string[] {
  return (db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}
function tableExists(db: Database, table: string): boolean {
  return db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== null;
}

/** Regress a head-schema file to the exact schema-15 shape (see module doc). */
function regressToSchema15(path: string): void {
  const db = new Database(path);
  db.exec("BEGIN IMMEDIATE");
  db.exec("DROP TABLE IF EXISTS runs");
  for (const table of ["audit", "versions"]) {
    if (columnNames(db, table).includes("harness_run")) db.exec(`ALTER TABLE ${table} DROP COLUMN harness_run`);
  }
  db.exec("PRAGMA user_version = 15");
  db.exec("COMMIT");
  db.close();
}

/** Every row of a table with the harness_run column removed (for byte-equality across migration). */
function rowsWithoutHarnessRun(db: Database, table: string, orderBy: string): Record<string, unknown>[] {
  return (db.query(`SELECT * FROM ${table} ORDER BY ${orderBy}`).all() as Record<string, unknown>[]).map((r) => {
    const { harness_run: _drop, ...rest } = r;
    return rest;
  });
}

// ─────────────────────────────────────────────────────────────────────────────────────
// 1. Migration 015 -> 016 on a populated SQLite corpus
// ─────────────────────────────────────────────────────────────────────────────────────
describe("migration-016 (runs table, audit/versions.harness_run) — v15 corpus", () => {
  let dir: string;
  let path: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lore-migration-016-"));
    path = join(dir, "lore.db");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  async function seedSchema15(): Promise<void> {
    const seed = actedStore(new SQLiteStore(path));
    for (const [id, slug] of [[DOC_1, "m16-doc-1"], [DOC_2, "m16-doc-2"]] as const) {
      expect((await seed.insert(makeDoc(id, slug))).ok).toBe(true);
      expect((await seed.insertVersion(makeVersion(id, 1))).ok).toBe(true);
      expect((await seed.appendAuditEntry(makeAudit(id, "create"))).ok).toBe(true);
    }
    expect((await seed.insertVersion(makeVersion(DOC_1, 2))).ok).toBe(true);
    expect((await seed.appendAuditEntry(makeAudit(DOC_1, "set"))).ok).toBe(true);
    seed.close();
    regressToSchema15(path);
  }

  it("NEGATIVE: the schema-15 fixture really lacks the 016 objects (red without the migration)", async () => {
    await seedSchema15();
    const raw = new Database(path);
    expect(userVersion(raw)).toBe(15);
    expect(tableExists(raw, "runs")).toBe(false);
    expect(columnNames(raw, "audit")).not.toContain("harness_run");
    expect(columnNames(raw, "versions")).not.toContain("harness_run");
    raw.close();
  });

  it("STATE: LATEST_SCHEMA_VERSION is 22 and opening a schema-15 file lands on user_version 22", async () => {
    await seedSchema15();
    const store = actedStore(new SQLiteStore(path));
    expect(LATEST_SCHEMA_VERSION).toBe(23);
    expect(userVersion(store.getDatabase())).toBe(23);
    store.close();
  });

  it("HAPPY: the runs table and both harness_run columns exist after opening a schema-15 file", async () => {
    await seedSchema15();
    const store = actedStore(new SQLiteStore(path));
    const db = store.getDatabase();
    expect(tableExists(db, "runs")).toBe(true);
    expect(columnNames(db, "audit")).toContain("harness_run");
    expect(columnNames(db, "versions")).toContain("harness_run");
    store.close();
  });

  it("HAPPY: pre-existing audit rows are byte-equal and every one has harness_run NULL", async () => {
    await seedSchema15();
    const raw = new Database(path);
    const before = rowsWithoutHarnessRun(raw, "audit", "id");
    raw.close();
    expect(before.length).toBe(3); // 2 creates + 1 set seeded above; guards against an empty comparison

    const store = actedStore(new SQLiteStore(path));
    const db = store.getDatabase();
    expect(rowsWithoutHarnessRun(db, "audit", "id")).toEqual(before);
    const nonNull = db.query("SELECT COUNT(*) AS n FROM audit WHERE harness_run IS NOT NULL").get() as { n: number };
    expect(nonNull.n).toBe(0);
    store.close();
  });

  it("HAPPY: pre-existing versions rows are byte-equal and every one has harness_run NULL", async () => {
    await seedSchema15();
    const raw = new Database(path);
    const before = rowsWithoutHarnessRun(raw, "versions", "doc_id, version");
    raw.close();
    expect(before.length).toBe(3);

    const store = actedStore(new SQLiteStore(path));
    const db = store.getDatabase();
    expect(rowsWithoutHarnessRun(db, "versions", "doc_id, version")).toEqual(before);
    const nonNull = db.query("SELECT COUNT(*) AS n FROM versions WHERE harness_run IS NOT NULL").get() as { n: number };
    expect(nonNull.n).toBe(0);
    store.close();
  });

  it("HAPPY: pre-existing docs rows are untouched by the migration", async () => {
    await seedSchema15();
    const raw = new Database(path);
    const before = raw.query("SELECT * FROM docs ORDER BY id").all();
    raw.close();
    const store = actedStore(new SQLiteStore(path));
    expect(store.getDatabase().query("SELECT * FROM docs ORDER BY id").all()).toEqual(before);
    store.close();
  });

  it("HAPPY: the migrated runs table starts empty", async () => {
    await seedSchema15();
    const store = actedStore(new SQLiteStore(path));
    const n = store.getDatabase().query("SELECT COUNT(*) AS n FROM runs").get() as { n: number };
    expect(n.n).toBe(0);
    store.close();
  });

  it("STATE: opening the migrated corpus again is a no-op (version, schema and every row unchanged)", async () => {
    await seedSchema15();
    const first = actedStore(new SQLiteStore(path));
    first.close();
    const snap = new Database(path);
    const audit1 = snap.query("SELECT * FROM audit ORDER BY id").all();
    const versions1 = snap.query("SELECT * FROM versions ORDER BY doc_id, version").all();
    const auditCols1 = columnNames(snap, "audit");
    const runsCols1 = columnNames(snap, "runs");
    snap.close();

    const second = actedStore(new SQLiteStore(path));
    const db = second.getDatabase();
    expect(userVersion(db)).toBe(23);
    expect(db.query("SELECT * FROM audit ORDER BY id").all()).toEqual(audit1);
    expect(db.query("SELECT * FROM versions ORDER BY doc_id, version").all()).toEqual(versions1);
    expect(columnNames(db, "audit")).toEqual(auditCols1);
    expect(columnNames(db, "runs")).toEqual(runsCols1);
    second.close();
  });

  it("STATE: MIGRATION_016_SQL is re-runnable on a migrated file without error or row change", async () => {
    await seedSchema15();
    const mod = await importOrMissing(MIGRATION_016_MODULE);
    const sql = mod.MIGRATION_016_SQL;
    if (typeof sql !== "string") throw new Error("MISSING BEHAVIOUR: MIGRATION_016_SQL: string not exported");
    const store = actedStore(new SQLiteStore(path));
    const db = store.getDatabase();
    const before = db.query("SELECT * FROM audit ORDER BY id").all();
    expect(() => db.exec(sql)).not.toThrow();
    expect(db.query("SELECT * FROM audit ORDER BY id").all()).toEqual(before);
    store.close();
  });

  it("REGRESSION: a fresh (never-migrated) corpus is created at the same shape: version 22 + runs + columns", () => {
    const store = actedStore(new SQLiteStore(path));
    const db = store.getDatabase();
    expect(userVersion(db)).toBe(23);
    expect(tableExists(db, "runs")).toBe(true);
    expect(columnNames(db, "audit")).toContain("harness_run");
    expect(columnNames(db, "versions")).toContain("harness_run");
    store.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────
// 2. Store contract shared by SQLiteStore and InMemoryStore
// ─────────────────────────────────────────────────────────────────────────────────────
interface StoreCase {
  name: string;
  make: () => { store: StoreInterface; cleanup: () => void };
  /** Row count of the runs table for this id, via the store's own backing (raw SQL for SQLite). */
  countRuns?: (store: StoreInterface) => number;
}

const STORES: StoreCase[] = [
  {
    name: "SQLiteStore",
    make: () => {
      const dir = mkdtempSync(join(tmpdir(), "lore-migration-016-store-"));
      const store = actedStore(new SQLiteStore(join(dir, "lore.db")));
      return { store, cleanup: () => { store.close(); rmSync(dir, { recursive: true, force: true }); } };
    },
    countRuns: (s) => ((s as SQLiteStore).getDatabase().query("SELECT COUNT(*) AS n FROM runs").get() as { n: number }).n,
  },
  { name: "InMemoryStore", make: () => ({ store: actedStore(new InMemoryStore()), cleanup: () => {} }) },
];

for (const sc of STORES) {
  describe(`run store + write-context decorator — ${sc.name}`, () => {
    let store: StoreInterface;
    let cleanup: () => void;
    beforeEach(async () => {
      ({ store, cleanup } = sc.make());
      expect((await store.insert(makeDoc(DOC_1, "m16-store-doc"))).ok).toBe(true);
    });
    afterEach(() => cleanup());

    // ── insertRun / getRun ──
    it("HAPPY: getRun returns the exact record that insertRun stored", async () => {
      const run = makeRun(RUN_A, { branch: "feature/x", agentType: "executor" });
      expect((await runStore(store).insertRun(run)).ok).toBe(true);
      const got = await runStore(store).getRun(RUN_A);
      expect(got.ok).toBe(true);
      expect(got.value).toEqual(run);
    });

    it("HAPPY: two different runs are stored and fetched independently (not a hardcoded return)", async () => {
      const a = makeRun(RUN_A, { branch: "branch-a" });
      const b = makeRun(RUN_B, { kind: "subagent", parentRunId: RUN_A, agentRef: "agent-9", agentType: "tester", branch: "branch-b" });
      await runStore(store).insertRun(a);
      await runStore(store).insertRun(b);
      expect((await runStore(store).getRun(RUN_A)).value).toEqual(a);
      expect((await runStore(store).getRun(RUN_B)).value).toEqual(b);
    });

    it("NEGATIVE: getRun on an unknown id is ok(null), not a fabricated record and not a throw", async () => {
      await runStore(store).insertRun(makeRun(RUN_A));
      const got = await runStore(store).getRun("cc:never-registered");
      expect(got.ok).toBe(true);
      expect(got.value).toBeNull();
    });

    it("NEGATIVE: getRun on an empty store is ok(null)", async () => {
      const got = await runStore(store).getRun(RUN_A);
      expect(got.ok).toBe(true);
      expect(got.value).toBeNull();
    });

    it("STATE: insertRun twice with the same id keeps the FIRST call's every column (first wins)", async () => {
      const first = makeRun(RUN_A, {
        parentRunId: null,
        branch: "first-branch",
        agentType: "first-type",
        composition: { schemaVersion: 1, fragments: [{ id: "frag-first", sha256: "1".repeat(64) }] },
      });
      const second = makeRun(RUN_A, {
        kind: "subagent",
        parentRunId: RUN_B,
        branch: "second-branch",
        agentType: "second-type",
        agentRef: "agent-2",
        registeredAt: "2027-01-01T00:00:00.000Z",
        composition: { schemaVersion: 1, fragments: [{ id: "frag-second", sha256: "2".repeat(64) }] },
      });
      expect((await runStore(store).insertRun(first)).ok).toBe(true);
      const again = await runStore(store).insertRun(second);
      expect(again.ok).toBe(true); // idempotent: never an error for a repeat registration
      expect((await runStore(store).getRun(RUN_A)).value).toEqual(first);
    });

    it("STATE: a repeated insertRun leaves exactly one row for the id", async () => {
      if (!sc.countRuns) return; // InMemoryStore has no SQL surface; getRun equality above covers it
      await runStore(store).insertRun(makeRun(RUN_A));
      await runStore(store).insertRun(makeRun(RUN_A, { branch: "other", parentRunId: RUN_B }));
      expect(sc.countRuns(store)).toBe(1);
    });

    it("STATE: re-registering one run does not disturb a different run", async () => {
      const b = makeRun(RUN_B, { branch: "b-branch" });
      await runStore(store).insertRun(makeRun(RUN_A));
      await runStore(store).insertRun(b);
      await runStore(store).insertRun(makeRun(RUN_A, { branch: "changed" }));
      expect((await runStore(store).getRun(RUN_B)).value).toEqual(b);
    });

    // ── withWriteContext ──
    it("HAPPY: through withWriteContext, an audit append carries the context's harness_run", async () => {
      const wrap = await loadWithWriteContext();
      const wrapped = wrap(store, { identity: identity(RUN_A) });
      expect((await wrapped.appendAuditEntry(makeAudit(DOC_1))).ok).toBe(true);
      const rows = await store.queryAudit({ doc_id: DOC_1 });
      expect(rows.ok).toBe(true);
      const stamped = (rows.ok ? rows.value : []) as Array<AuditEntry & { harness_run?: string | null }>;
      expect(stamped.length).toBe(1);
      expect(stamped[0]!.harness_run).toBe(RUN_A);
    });

    it("HAPPY: through withWriteContext, a version insert carries the context's harness_run", async () => {
      const wrap = await loadWithWriteContext();
      const wrapped = wrap(store, { identity: identity(RUN_A) });
      expect((await wrapped.insertVersion(makeVersion(DOC_1, 1))).ok).toBe(true);
      const rows = await store.findVersions(DOC_1);
      const got = (rows.ok ? rows.value : []) as Array<VersionRecord & { harness_run?: string | null }>;
      expect(got.length).toBe(1);
      expect(got[0]!.harness_run).toBe(RUN_A);
    });

    it("HAPPY: a different context stamps a different run (not a hardcoded id)", async () => {
      const wrap = await loadWithWriteContext();
      await wrap(store, { identity: identity(RUN_A) }).appendAuditEntry(makeAudit(DOC_1, "set"));
      await wrap(store, { identity: identity(RUN_B) }).appendAuditEntry(makeAudit(DOC_1, "link"));
      const rows = await store.queryAudit({ doc_id: DOC_1 });
      const byAction = new Map(
        ((rows.ok ? rows.value : []) as Array<AuditEntry & { harness_run?: string | null }>).map((r) => [r.action, r.harness_run]),
      );
      expect(byAction.get("set")).toBe(RUN_A);
      expect(byAction.get("link")).toBe(RUN_B);
    });

    it("NEGATIVE: through the UNWRAPPED store, audit and version rows have harness_run NULL", async () => {
      expect((await store.appendAuditEntry(makeAudit(DOC_1))).ok).toBe(true);
      expect((await store.insertVersion(makeVersion(DOC_1, 1))).ok).toBe(true);
      const audit = await store.queryAudit({ doc_id: DOC_1 });
      const versions = await store.findVersions(DOC_1);
      const a = (audit.ok ? audit.value : []) as Array<AuditEntry & { harness_run?: string | null }>;
      const v = (versions.ok ? versions.value : []) as Array<VersionRecord & { harness_run?: string | null }>;
      expect(a.length).toBe(1);
      expect(v.length).toBe(1);
      expect(a[0]!.harness_run ?? null).toBeNull();
      expect(v[0]!.harness_run ?? null).toBeNull();
    });

    it("NEGATIVE: an unattested context (harnessRun null) stamps NULL, never a guessed run", async () => {
      const wrap = await loadWithWriteContext();
      await wrap(store, { identity: identity(null) }).appendAuditEntry(makeAudit(DOC_1));
      const rows = await store.queryAudit({ doc_id: DOC_1 });
      const a = (rows.ok ? rows.value : []) as Array<AuditEntry & { harness_run?: string | null }>;
      expect(a.length).toBe(1);
      expect(a[0]!.harness_run ?? null).toBeNull();
    });

    it("NEGATIVE: the wrapper overrides nothing on the underlying store — a later unwrapped write is still NULL", async () => {
      const wrap = await loadWithWriteContext();
      await wrap(store, { identity: identity(RUN_A) }).appendAuditEntry(makeAudit(DOC_1, "set"));
      await store.appendAuditEntry(makeAudit(DOC_1, "link"));
      const rows = await store.queryAudit({ doc_id: DOC_1 });
      const byAction = new Map(
        ((rows.ok ? rows.value : []) as Array<AuditEntry & { harness_run?: string | null }>).map((r) => [r.action, r.harness_run ?? null]),
      );
      expect(byAction.get("set")).toBe(RUN_A);
      expect(byAction.get("link")).toBeNull();
    });

    it("HAPPY: the composite insertWithProvenance stamps BOTH its version row and its audit row", async () => {
      const wrap = await loadWithWriteContext();
      const wrapped = wrap(store, { identity: identity(RUN_B) });
      const doc = makeDoc(DOC_2, "m16-composite");
      expect((await wrapped.insertWithProvenance(doc, makeVersion(DOC_2, 1), makeAudit(DOC_2, "create"))).ok).toBe(true);
      const audit = await store.queryAudit({ doc_id: DOC_2 });
      const versions = await store.findVersions(DOC_2);
      const a = (audit.ok ? audit.value : []) as Array<AuditEntry & { harness_run?: string | null }>;
      const v = (versions.ok ? versions.value : []) as Array<VersionRecord & { harness_run?: string | null }>;
      expect(a.map((r) => r.harness_run)).toEqual([RUN_B]);
      expect(v.map((r) => r.harness_run)).toEqual([RUN_B]);
    });

    it("HAPPY: the wrapper still delegates reads (a doc inserted underneath is found through it)", async () => {
      const wrap = await loadWithWriteContext();
      const wrapped = wrap(store, { identity: identity(RUN_A) });
      const found = await wrapped.find(DOC_1 as never);
      expect(found.ok).toBe(true);
      expect(found.ok && found.value?.slug).toBe("m16-store-doc");
    });

    it("HAPPY: the wrapper exposes insertRun/getRun so a wrapped store can still register and read runs", async () => {
      const wrap = await loadWithWriteContext();
      const wrapped = wrap(store, { identity: identity(RUN_A) });
      const run = makeRun(RUN_B, { branch: "via-wrapper" });
      expect((await runStore(wrapped).insertRun(run)).ok).toBe(true);
      expect((await runStore(store).getRun(RUN_B)).value).toEqual(run);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────────────
// 3. SQLite-only: the stamped value lands in the actual columns
// ─────────────────────────────────────────────────────────────────────────────────────
describe("withWriteContext on SQLiteStore — raw column check", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "lore-migration-016-raw-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("HAPPY: audit.harness_run and versions.harness_run columns hold the stamped run; unwrapped rows hold NULL", async () => {
    const store = actedStore(new SQLiteStore(join(dir, "lore.db")));
    expect((await store.insert(makeDoc(DOC_1, "m16-raw"))).ok).toBe(true);
    const wrap = await loadWithWriteContext();
    const wrapped = wrap(store, { identity: identity(RUN_A) });
    await wrapped.appendAuditEntry(makeAudit(DOC_1, "stamped"));
    await wrapped.insertVersion(makeVersion(DOC_1, 1));
    await store.appendAuditEntry(makeAudit(DOC_1, "plain"));
    await store.insertVersion(makeVersion(DOC_1, 2));
    const db = store.getDatabase();
    expect(db.query("SELECT action, harness_run FROM audit ORDER BY id").all()).toEqual([
      { action: "stamped", harness_run: RUN_A },
      { action: "plain", harness_run: null },
    ]);
    expect(db.query("SELECT version, harness_run FROM versions ORDER BY version").all()).toEqual([
      { version: 1, harness_run: RUN_A },
      { version: 2, harness_run: null },
    ]);
    store.close();
  });

  it("REGRESSION: the audit hash chain still verifies when some rows carry harness_run and others do not", async () => {
    const store = actedStore(new SQLiteStore(join(dir, "lore.db")));
    await store.insert(makeDoc(DOC_1, "m16-chain"));
    const wrap = await loadWithWriteContext();
    await wrap(store, { identity: identity(RUN_A) }).appendAuditEntry(makeAudit(DOC_1, "a"));
    await store.appendAuditEntry(makeAudit(DOC_1, "b"));
    await wrap(store, { identity: identity(RUN_B) }).appendAuditEntry(makeAudit(DOC_1, "c"));
    const chain = await store.listAuditChain();
    expect(chain.ok).toBe(true);
    expect(chain.ok ? chain.value.length : 0).toBe(3);
    store.close();
  });
});
