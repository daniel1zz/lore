/** @spec_ref AC-079-3 */
/**
 * Tests for SPEC-079 G3's tamper-evident audit hash chain — the STORAGE
 * half: every audit insert path (`appendAuditEntry` standalone AND the
 * three `*WithProvenance` composites) extends the SAME chain identically
 * across `SQLiteStore` and `TursoStore`; migration-009 backfills a legacy
 * (pre-chain) fixture DB into a fully verifiable chain; a fresh corpus's
 * chain is internally consistent from its very first row.
 *
 * `InMemoryStore` parity lives in the sibling vitest suite
 * (`in-memory-audit-chain.test.ts`, AC-079-6) — this file is bun-only
 * (`SQLiteStore` needs `bun:sqlite`; `TursoStore` needs real file IO for its
 * embedded-replica local path).
 *
 * Six-dimension coverage:
 *   HAPPY:      `appendAuditEntry` extends the chain across repeated calls;
 *               `insertWithProvenance`/`updateWithProvenance`/
 *               `softDeleteWithProvenance` all extend the SAME chain as a
 *               standalone `appendAuditEntry` call (no separate mini-chains
 *               per insert path); `computeAuditEntryHash`'s output matches
 *               an independently hand-rolled sha256 canonical-JSON digest.
 *   NEGATIVE:   two entries with the SAME logical `details` but DIFFERENT
 *               key insertion order produce the IDENTICAL `entry_hash`
 *               (sorted-key canonicalization) — guards against a naive
 *               `JSON.stringify(details)` regression that would make the
 *               chain fragile to non-semantic detail-object reordering.
 *   BOUNDARY:   the very first audit row ever written has `prev_hash`
 *               exactly `""` (not `null`, not `undefined`) — the documented
 *               genesis value.
 *   ERROR:      `queryAudit`'s public `AuditEntry` contract never leaks
 *               `prev_hash`/`entry_hash` — a caller cannot read (and
 *               therefore cannot forge-and-resupply) a chain hash through
 *               the pre-existing read path; only `listAuditChain` exposes it.
 *   STATE:      appending a new entry never mutates an EARLIER entry's
 *               `prev_hash`/`entry_hash` (immutability of already-written
 *               rows).
 *   REGRESSION: migration-009 backfills a REAL pre-existing (unchained)
 *               audit history into a verifiable chain, idempotently (a
 *               second open of an already-migrated DB is a no-op and does
 *               not throw), and a live-appended row after the backfill
 *               correctly continues that migrated chain (its `prev_hash`
 *               equals the migrated chain's head hash).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuditEntry, DocRecord, VersionRecord } from "@lore/core";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { TursoStore } from "../../../src/store/turso-store.js";
import { clearProcessAuditSurface } from "../../../src/store/audit-surface.js";
import { MIGRATION_001_SQL } from "../../../src/store/migrations/migration-001.js";
import { MIGRATION_002_SQL } from "../../../src/store/migrations/migration-002.js";
import { MIGRATION_003_SQL } from "../../../src/store/migrations/migration-003.js";
import { MIGRATION_004_SQL } from "../../../src/store/migrations/migration-004.js";
import { MIGRATION_005_SQL } from "../../../src/store/migrations/migration-005.js";
import { MIGRATION_006_SQL } from "../../../src/store/migrations/migration-006.js";
import { MIGRATION_007_SQL } from "../../../src/store/migrations/migration-007.js";
import {
  MIGRATION_008_ADD_COLUMNS_SQL,
  MIGRATION_008_FTS_REBUILD_SQL,
} from "../../../src/store/migrations/migration-008.js";
import type { StoreInterface } from "../../../src/store/store-interface.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function userVersion(db: Database): number {
  return (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
}

function tableColumnNames(db: Database, table: string): string[] {
  const cols = db.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.map((c) => c.name);
}

let _counter = 0;

function nextId(): string {
  _counter += 1;
  return `01HACHAIN${String(_counter).padStart(15, "0")}`;
}

function makeDoc(overrides: Partial<DocRecord> = {}): DocRecord {
  _counter += 1;
  const id = nextId();
  return {
    id,
    slug: `knowledge-audit-chain-fixture-${_counter}`,
    type: "knowledge",
    role: "knowledge",
    title: `Audit Chain Fixture ${_counter}`,
    status: "draft",
    priority: "medium",
    content: "content",
    parent_id: null,
    extra: {},
    tags: [],
    version: 1,
    created_at: "2026-07-25T00:00:00.000Z",
    updated_at: "2026-07-25T00:00:00.000Z",
    created_by: "agent:test",
    deleted_at: null,
    ...overrides,
  };
}

function makeVersion(doc: DocRecord, overrides: Partial<VersionRecord> = {}): VersionRecord {
  return {
    doc_id: doc.id,
    version: doc.version,
    content: doc.content,
    extra: doc.extra,
    status: doc.status,
    title: doc.title,
    action: "create",
    created_at: doc.created_at,
    created_by: doc.created_by,
    ...overrides,
  };
}

function makeAudit(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    timestamp: "2026-07-25T00:00:00.000Z",
    actor: "agent:test",
    session_id: "s1",
    action: "create",
    details: {},
    ...overrides,
  };
}

/**
 * Independently recomputes the SPEC-079 G3 documented canonical-JSON sha256
 * digest (`sha256(canonicalJson({timestamp, actor, session_id, action,
 * doc_id, details, prev_hash}))`, sorted-key `details`) WITHOUT calling
 * `computeAuditEntryHash` — a hand-rolled cross-check against the
 * implementation, not a tautological "call it and compare to itself" test.
 */
function expectedEntryHash(entry: AuditEntry, prevHash: string): string {
  const sortedDetails = Object.fromEntries(
    Object.entries(entry.details ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  const payload = {
    timestamp: entry.timestamp,
    actor: entry.actor,
    session_id: entry.session_id,
    action: entry.action,
    doc_id: entry.doc_id ?? null,
    details: sortedDetails,
    prev_hash: prevHash,
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/**
 * Asserts a chain array (already in `id` ASC order) is internally
 * consistent: genesis `prev_hash === ""`, every subsequent row's
 * `prev_hash` equals the immediately preceding row's `entry_hash`, and
 * every `entry_hash` is a well-formed 64-char lowercase hex digest.
 */
function assertChainConsistent(
  chain: { prev_hash: string | null; entry_hash: string | null }[],
): void {
  expect(chain.length).toBeGreaterThan(0);
  expect(chain[0]!.prev_hash).toBe("");
  for (let i = 0; i < chain.length; i++) {
    const row = chain[i]!;
    expect(row.entry_hash).toMatch(/^[0-9a-f]{64}$/);
    if (i > 0) {
      expect(row.prev_hash).toBe(chain[i - 1]!.entry_hash);
    }
  }
}

interface StoreHandle {
  store: StoreInterface;
  destroy: () => void | Promise<void>;
}

function createSqliteHandle(): StoreHandle {
  const store = new SQLiteStore(":memory:");
  return { store, destroy: () => store.close() };
}

function createTursoHandle(): StoreHandle {
  const tmpDir = mkdtempSync(join(tmpdir(), "lore-audit-chain-turso-"));
  const store = new TursoStore({ localPath: join(tmpDir, "lore.db") });
  return {
    store,
    destroy: () => {
      store.close();
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    },
  };
}

// ─── Cross-store chain-construction suite ──────────────────────────────────

function runChainConstructionSuite(label: string, createHandle: () => StoreHandle): void {
  describe(`${label} — audit hash chain construction`, () => {
    let store: StoreInterface;
    let destroy: () => void | Promise<void>;

    beforeEach(() => {
      // reason: the audit surface is process-wide module state; a file that booted the CLI/MCP adapter earlier in the
      // same `bun test` process leaves it set, and the stores stamp it into `details` (inside the hash payload) —
      // this suite hand-rolls the digest of the entry it appended, so it asserts the no-adapter state it needs.
      clearProcessAuditSurface();
      const handle = createHandle();
      store = handle.store;
      destroy = handle.destroy;
    });

    afterEach(async () => {
      await destroy();
    });

    it("HAPPY: appendAuditEntry extends the chain across repeated standalone calls", async () => {
      const first = await store.appendAuditEntry(makeAudit({ action: "link" }));
      expect(first.ok).toBe(true);
      const second = await store.appendAuditEntry(makeAudit({ action: "unlink" }));
      expect(second.ok).toBe(true);

      const chainResult = await store.listAuditChain();
      expect(chainResult.ok).toBe(true);
      if (!chainResult.ok) return;
      expect(chainResult.value).toHaveLength(2);
      expect(chainResult.value.map((e) => e.action)).toEqual(["link", "unlink"]);
      assertChainConsistent(chainResult.value);
    });

    it("HAPPY: insertWithProvenance / updateWithProvenance / softDeleteWithProvenance all extend the SAME chain as a standalone appendAuditEntry call", async () => {
      const doc = makeDoc();

      const insertRes = await store.insertWithProvenance(
        doc,
        makeVersion(doc),
        makeAudit({ action: "create", doc_id: doc.id, details: { version: 1 } }),
      );
      expect(insertRes.ok).toBe(true);

      const updatedDoc = { ...doc, title: "Updated Title", version: 2 };
      const updateRes = await store.updateWithProvenance(
        doc.id,
        { title: "Updated Title", version: 2 },
        undefined,
        makeVersion(updatedDoc, { version: 2, action: "update" }),
        makeAudit({ action: "update", doc_id: doc.id, details: { version: 2 } }),
      );
      expect(updateRes.ok).toBe(true);

      const deleteRes = await store.softDeleteWithProvenance(
        doc.id,
        makeVersion(updatedDoc, { version: 3, action: "delete" }),
        makeAudit({ action: "delete", doc_id: doc.id, details: {} }),
      );
      expect(deleteRes.ok).toBe(true);

      // Interleave a standalone appendAuditEntry too — proves ALL FOUR
      // insert paths share one uninterrupted chain, not four independent
      // mini-chains.
      const standalone = await store.appendAuditEntry(makeAudit({ action: "tree-fix" }));
      expect(standalone.ok).toBe(true);

      const chainResult = await store.listAuditChain();
      expect(chainResult.ok).toBe(true);
      if (!chainResult.ok) return;
      expect(chainResult.value).toHaveLength(4);
      expect(chainResult.value.map((e) => e.action)).toEqual([
        "create",
        "update",
        "delete",
        "tree-fix",
      ]);
      assertChainConsistent(chainResult.value);
    });

    it("HAPPY: entry_hash matches an independently hand-rolled sha256 canonical-JSON digest", async () => {
      const entry = makeAudit({
        action: "link",
        doc_id: "01HDOC0000000000000000001",
        details: { link_type: "parent", to_id: "01HDOC0000000000000000002" },
      });
      const res = await store.appendAuditEntry(entry);
      expect(res.ok).toBe(true);

      const chainResult = await store.listAuditChain();
      expect(chainResult.ok).toBe(true);
      if (!chainResult.ok) return;
      expect(chainResult.value[0]!.entry_hash).toBe(expectedEntryHash(entry, ""));
    });

    it("NEGATIVE: two entries with the SAME details but DIFFERENT key insertion order produce the IDENTICAL entry_hash", async () => {
      const entryReversedOrder = makeAudit({ details: { b: 2, a: 1 } });
      const resA = await store.appendAuditEntry(entryReversedOrder);
      expect(resA.ok).toBe(true);
      const chainA = await store.listAuditChain();
      expect(chainA.ok).toBe(true);
      if (!chainA.ok) return;
      const hashWithReversedOrder = chainA.value[0]!.entry_hash;

      // Fresh store (genesis prev_hash "" again), same logical details,
      // NORMAL key order — must produce the byte-identical hash.
      const handleB = createHandle();
      try {
        const entryNormalOrder = makeAudit({ details: { a: 1, b: 2 } });
        const resB = await handleB.store.appendAuditEntry(entryNormalOrder);
        expect(resB.ok).toBe(true);
        const chainB = await handleB.store.listAuditChain();
        expect(chainB.ok).toBe(true);
        if (!chainB.ok) return;
        expect(chainB.value[0]!.entry_hash).toBe(hashWithReversedOrder);
      } finally {
        await handleB.destroy();
      }
    });

    it("BOUNDARY: the very first audit row ever written has prev_hash exactly \"\" (genesis)", async () => {
      const res = await store.appendAuditEntry(makeAudit());
      expect(res.ok).toBe(true);
      const chainResult = await store.listAuditChain();
      expect(chainResult.ok).toBe(true);
      if (!chainResult.ok) return;
      expect(chainResult.value[0]!.prev_hash).toBe("");
      expect(chainResult.value[0]!.prev_hash).not.toBeNull();
    });

    it("ERROR: queryAudit's public AuditEntry contract never leaks prev_hash/entry_hash", async () => {
      await store.appendAuditEntry(makeAudit({ action: "create" }));
      await store.appendAuditEntry(makeAudit({ action: "update" }));

      const queryResult = await store.queryAudit({});
      expect(queryResult.ok).toBe(true);
      if (!queryResult.ok) return;
      expect(queryResult.value.length).toBeGreaterThan(0);
      for (const entry of queryResult.value) {
        expect("prev_hash" in entry).toBe(false);
        expect("entry_hash" in entry).toBe(false);
      }
    });

    it("STATE: appending a new entry never mutates an EARLIER entry's prev_hash/entry_hash", async () => {
      await store.appendAuditEntry(makeAudit({ action: "create" }));
      const afterFirst = await store.listAuditChain();
      expect(afterFirst.ok).toBe(true);
      if (!afterFirst.ok) return;
      const firstSnapshot = { ...afterFirst.value[0]! };

      await store.appendAuditEntry(makeAudit({ action: "update" }));
      const afterSecond = await store.listAuditChain();
      expect(afterSecond.ok).toBe(true);
      if (!afterSecond.ok) return;

      expect(afterSecond.value[0]!.prev_hash).toBe(firstSnapshot.prev_hash);
      expect(afterSecond.value[0]!.entry_hash).toBe(firstSnapshot.entry_hash);
      expect(afterSecond.value).toHaveLength(2);
    });

    it("REGRESSION: a fresh corpus's chain is internally consistent — zero rows verifies trivially clean, then every subsequent write stays consistent", async () => {
      const emptyChain = await store.listAuditChain();
      expect(emptyChain.ok).toBe(true);
      if (!emptyChain.ok) return;
      expect(emptyChain.value).toEqual([]);

      for (let i = 0; i < 5; i++) {
        const res = await store.appendAuditEntry(makeAudit({ action: `action-${i}` }));
        expect(res.ok).toBe(true);
      }

      const finalChain = await store.listAuditChain();
      expect(finalChain.ok).toBe(true);
      if (!finalChain.ok) return;
      expect(finalChain.value).toHaveLength(5);
      assertChainConsistent(finalChain.value);
    });
  });
}

runChainConstructionSuite("SQLiteStore", createSqliteHandle);
runChainConstructionSuite("TursoStore", createTursoHandle);

// ─── migration-009 backfill (SQLiteStore-specific — legacy fixture DB) ─────

describe("migration-009 (audit hash chain backfill)", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lore-migration-009-"));
    dbPath = join(tempDir, "test.db");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("HAPPY: a fresh :memory: DB migrates straight to the current head user_version with the chain columns present", () => {
    const store = new SQLiteStore(":memory:");
    const db = store.getDatabase();

    // reason: migration-012 (spec-issue-closure-loop-computed-resolution-
    // agent-reachable, links.link_type CHECK widened for "resolves") is now
    // the head — a fresh store runs every migration up to it, not just
    // through migration-009. This test's own concern (audit hash-chain
    // columns present) is unaffected — asserted directly below.
    expect(userVersion(db)).toBe(15);
    const cols = tableColumnNames(db, "audit");
    expect(cols).toContain("prev_hash");
    expect(cols).toContain("entry_hash");

    store.close();
  });

  it("BOUNDARY/STATE: upgrading an existing user_version=8 DB (pre-migration-009) with REAL pre-existing unchained audit rows backfills a fully verifiable chain, untouched content", () => {
    // Manually construct a v8-only DB, bypassing migration-009 entirely —
    // simulates a real database created before this migration existed, with
    // REAL pre-existing audit rows (written before hash chaining existed).
    const rawDb = new Database(dbPath);
    rawDb.exec(MIGRATION_001_SQL);
    rawDb.exec(MIGRATION_002_SQL);
    rawDb.exec(MIGRATION_003_SQL);
    rawDb.exec(MIGRATION_004_SQL);
    rawDb.exec(MIGRATION_005_SQL);
    rawDb.exec(MIGRATION_006_SQL);
    rawDb.exec(MIGRATION_007_SQL);
    rawDb.run("BEGIN IMMEDIATE");
    rawDb.exec(MIGRATION_008_ADD_COLUMNS_SQL);
    rawDb.exec(MIGRATION_008_FTS_REBUILD_SQL);
    rawDb.run("COMMIT");

    const preUpgradeVersion = userVersion(rawDb);
    expect(preUpgradeVersion).toBe(8);
    expect(tableColumnNames(rawDb, "audit")).not.toContain("prev_hash");
    expect(tableColumnNames(rawDb, "audit")).not.toContain("entry_hash");

    const legacyEntries = [
      {
        timestamp: "2026-01-01T00:00:00.000Z",
        actor: "agent:legacy",
        session_id: "s1",
        action: "create",
        doc_id: "01HLEGACY0000000000000001",
        details: '{"version":1}',
      },
      {
        timestamp: "2026-01-02T00:00:00.000Z",
        actor: "agent:legacy",
        session_id: "s1",
        action: "update",
        doc_id: "01HLEGACY0000000000000001",
        details: '{"version":2}',
      },
      {
        timestamp: "2026-01-03T00:00:00.000Z",
        actor: "agent:legacy",
        session_id: "s2",
        action: "link",
        doc_id: "01HLEGACY0000000000000002",
        details: '{"to_id":"01HLEGACY0000000000000003"}',
      },
    ];
    const insertStmt = rawDb.prepare(
      `INSERT INTO audit (timestamp, actor, session_id, action, doc_id, details)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const e of legacyEntries) {
      insertStmt.run(e.timestamp, e.actor, e.session_id, e.action, e.doc_id, e.details);
    }
    rawDb.close();

    // Reopening via SQLiteStore should detect currentVersion (8) < 9 and
    // apply migration-009 — never throw, never touch the pre-existing
    // rows' logical content, and produce a fully self-consistent chain over
    // exactly those 3 legacy rows.
    const store = new SQLiteStore(dbPath);
    const db = store.getDatabase();

    expect(userVersion(db)).toBe(15);
    expect(tableColumnNames(db, "audit")).toContain("prev_hash");
    expect(tableColumnNames(db, "audit")).toContain("entry_hash");

    const rows = db.query("SELECT * FROM audit ORDER BY id ASC").all() as {
      id: number;
      timestamp: string;
      actor: string;
      session_id: string;
      action: string;
      doc_id: string | null;
      details: string;
      prev_hash: string | null;
      entry_hash: string | null;
    }[];
    expect(rows).toHaveLength(3);
    // Pre-existing content untouched by the backfill.
    expect(rows[0]!.action).toBe("create");
    expect(rows[1]!.action).toBe("update");
    expect(rows[2]!.action).toBe("link");
    expect(rows[0]!.doc_id).toBe("01HLEGACY0000000000000001");

    assertChainConsistent(rows);

    // Independently recompute each expected hash from the RAW row values
    // (not by calling the implementation) — proves the backfill really
    // produced the documented chain, not just SOME non-null values.
    let prevHash = "";
    for (const row of rows) {
      const entry: AuditEntry = {
        timestamp: row.timestamp,
        actor: row.actor,
        session_id: row.session_id,
        action: row.action,
        ...(row.doc_id !== null ? { doc_id: row.doc_id } : {}),
        details: JSON.parse(row.details) as Record<string, unknown>,
      };
      const expected = expectedEntryHash(entry, prevHash);
      expect(row.entry_hash).toBe(expected);
      prevHash = expected;
    }

    store.close();
  });

  it("REGRESSION: reopening an already-migrated DB a second time is idempotent, and a live-appended row correctly continues the migrated chain", async () => {
    const firstOpen = new SQLiteStore(dbPath);
    const firstAppend = await firstOpen.appendAuditEntry(
      makeAudit({ action: "create", details: {} }),
    );
    expect(firstAppend.ok).toBe(true);
    const firstChain = await firstOpen.listAuditChain();
    expect(firstChain.ok).toBe(true);
    if (!firstChain.ok) return;
    const headHash = firstChain.value[0]!.entry_hash;
    firstOpen.close();

    expect(() => {
      const secondOpen = new SQLiteStore(dbPath);
      const db = secondOpen.getDatabase();
      expect(userVersion(db)).toBe(15);
      expect(tableColumnNames(db, "audit")).toContain("prev_hash");
      secondOpen.close();
    }).not.toThrow();

    const thirdOpen = new SQLiteStore(dbPath);
    const secondAppend = await thirdOpen.appendAuditEntry(
      makeAudit({ action: "update", details: {} }),
    );
    expect(secondAppend.ok).toBe(true);

    const finalChain = await thirdOpen.listAuditChain();
    expect(finalChain.ok).toBe(true);
    if (!finalChain.ok) return;
    expect(finalChain.value).toHaveLength(2);
    expect(finalChain.value[1]!.prev_hash).toBe(headHash);
    assertChainConsistent(finalChain.value);

    thirdOpen.close();
  });
});
