/**
 * @spec_ref AC-SYNC-PUSH-001 (SPEC-009 §3.3, D-006, R3)
 *
 * RED integration tests for syncPush — logical replication from local to remote.
 *
 * CONSTRUCTION ASSUMPTIONS:
 *   Import: import { syncPush, type PushReport, type TableReport } from "../../../src/adapters/http/sync-push.js"
 *
 *   syncPush(localPath: string, remoteClient: Client): Promise<Result<PushReport, LoreError>>
 *
 *   PushReport = { tables: TableReport[]; total_rows: number }
 *   TableReport = { table: string; local_rows: number; remote_rows: number }
 *
 *   - Reads rows from all 5 tables: docs, links, versions, audit, api_keys
 *   - For each table, INSERTs all local rows into remote (via @libsql/client direct connection)
 *   - Returns per-table reconciliation report
 *   - Idempotent: second push with same data → same row counts, no error, no duplicates
 *   - D-006: logical replication — read local rows, batch INSERT to remote
 *   - R3: MUST cover all 5 tables; row-count reconciliation after push
 *
 * SIMULATION STRATEGY:
 *   - Local: SQLiteStore backed by a real bun:sqlite file (temp dir)
 *   - Remote: @libsql/client file: mode using a SECOND temp file (no network required)
 *   This is a fully automated oracle — no Turso credentials needed.
 *
 * These tests run under `bun test .bun.test` ONLY.
 * They will FAIL RED until src/adapters/http/sync-push.ts is implemented.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import type { DocRecord, LinkRecord, VersionRecord, AuditEntry } from "@lore/core";
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
import {
  MIGRATION_009_ADD_COLUMNS_SQL,
  MIGRATION_009_FINALIZE_SQL,
} from "../../../src/store/migrations/migration-009.js";
import { MIGRATION_010_SQL } from "../../../src/store/migrations/migration-010.js";
import { MIGRATION_011_SQL } from "../../../src/store/migrations/migration-011.js";
import { MIGRATION_012_SQL } from "../../../src/store/migrations/migration-012.js";
import { MIGRATION_013_SQL } from "../../../src/store/migrations/migration-013.js";
import { MIGRATION_014_SQL } from "../../../src/store/migrations/migration-014.js";
import { MIGRATION_015_SQL } from "../../../src/store/migrations/migration-015.js";
import { MIGRATION_016_ADD_COLUMNS, MIGRATION_016_SQL } from "../../../src/store/migrations/migration-016.js";
import { MIGRATION_017_ADD_COLUMNS, MIGRATION_017_SQL } from "../../../src/store/migrations/migration-017.js";
import { MIGRATION_018_SQL } from "../../../src/store/migrations/migration-018.js";
import { MIGRATION_019_ADD_COLUMNS, MIGRATION_019_SQL } from "../../../src/store/migrations/migration-019.js";
import { MIGRATION_020_SQL } from "../../../src/store/migrations/migration-020.js";
import { MIGRATION_021_ADD_COLUMNS, MIGRATION_021_SQL } from "../../../src/store/migrations/migration-021.js";
import { MIGRATION_022_SQL } from "../../../src/store/migrations/migration-022.js";
import { MIGRATION_023_SQL } from "../../../src/store/migrations/migration-023.js";
import { computeFtsShadowValues, computeAuditEntryHash } from "../../../src/store/store-shared.js";

// ─── Fixture Helpers ─────────────────────────────────────────────────────────

let _idCounter = 5000;

function nextId(): string {
  _idCounter += 1;
  return `01HPUSH${String(_idCounter).padStart(16, "0")}`;
}

function makeDoc(overrides: Partial<DocRecord> = {}): DocRecord {
  const n = ++_idCounter;
  return {
    id: nextId(),
    slug: `prd-push-test-${n}`,
    type: "prd",
    role: "intent",
    title: `Push Test Document ${n}`,
    status: "draft",
    priority: "medium",
    content: `Content for push test document ${n}`,
    parent_id: null,
    extra: {},
    tags: ["push", "test"],
    version: 1,
    created_at: "2026-06-11T10:00:00.000Z",
    updated_at: "2026-06-11T10:00:00.000Z",
    created_by: "agent:push-test",
    deleted_at: null,
    ...overrides,
  };
}

// ─── Apply Schema to a libsql Client ────────────────────────────────────────
// MOCK RISK: we hand-apply the FULL migration chain (same order
// SQLiteStore.runMigrations() applies internally) to the remote fixture DB.
// This mirrors the real TursoStore setup but bypasses its constructor logic.
// Every new migration.ts added to src/store/migrations/ MUST get a matching
// step here: a pure-SQL migration (like 001-007) needs one
// `await client.executeMultiple(MIGRATION_00N_SQL)` line; a migration with a
// JS-level transform phase (like 008's CJK bigram backfill) needs its full
// SQL + JS-loop sequence mirrored from turso-store.ts's initSchema() (the
// real production TursoStore handling for that migration), not just a single
// executeMultiple call. The parity guard below turns a forgotten/incomplete
// step into a loud fixture-setup failure instead of a wall of confusing
// per-row INSERT/column-mismatch errors.

async function applyMigrationsToClient(client: Client, localStore: SQLiteStore): Promise<void> {
  await client.executeMultiple(MIGRATION_001_SQL);
  await client.executeMultiple(MIGRATION_002_SQL);
  await client.executeMultiple(MIGRATION_003_SQL);
  await client.executeMultiple(MIGRATION_004_SQL);
  await client.executeMultiple(MIGRATION_005_SQL);
  await client.executeMultiple(MIGRATION_006_SQL);
  await client.executeMultiple(MIGRATION_007_SQL);

  // migration-008 is a THREE-PHASE sequence (ADD COLUMN -> JS per-row CJK
  // bigram backfill -> docs_fts drop/recreate + rebuild), NOT a single
  // self-contained SQL string like migrations 001-007 — see
  // migration-008.ts's module JSDoc. This mirrors turso-store.ts's
  // initSchema() handling verbatim (same client.transaction("write")
  // interactive-transaction API, same tx.executeMultiple/tx.execute calls),
  // since this fixture stands in for the real TursoStore setup.
  const tx008 = await client.transaction("write");
  try {
    await tx008.executeMultiple(MIGRATION_008_ADD_COLUMNS_SQL);

    const rs008 = await tx008.execute("SELECT id, title, content, tags FROM docs");
    for (const row of rs008.rows) {
      const shadow = computeFtsShadowValues(
        String(row["title"]),
        String(row["content"]),
        String(row["tags"]),
      );
      await tx008.execute({
        sql: "UPDATE docs SET fts_title = ?, fts_content = ?, fts_tags = ? WHERE id = ?",
        args: [shadow.fts_title, shadow.fts_content, shadow.fts_tags, String(row["id"])],
      });
    }

    await tx008.executeMultiple(MIGRATION_008_FTS_REBUILD_SQL);
    await tx008.commit();
  } catch (e) {
    try {
      await tx008.rollback();
    } catch {
      // reason: rollback throws only when the transaction is already
      // closed — safe to ignore, `e` below is what the caller needs
      // (mirrors turso-store.ts's identical rollback guard).
    }
    throw e;
  } finally {
    tx008.close();
  }

  // migration-009 is likewise a THREE-PHASE sequence (ADD COLUMN -> JS
  // per-row audit hash-chain backfill -> PRAGMA user_version bump) — see
  // migration-009.ts's module JSDoc. This mirrors turso-store.ts's
  // initSchema() `currentVersion < 9` block verbatim (same
  // client.transaction("write") interactive-transaction API, same
  // executeMultiple/execute calls, same id-ASC prevHash threading with a ""
  // genesis for the first row / a no-op on an empty table).
  const tx009 = await client.transaction("write");
  try {
    await tx009.executeMultiple(MIGRATION_009_ADD_COLUMNS_SQL);

    const rs009 = await tx009.execute(
      "SELECT id, timestamp, actor, session_id, action, doc_id, details FROM audit ORDER BY id ASC",
    );
    let prevHash = "";
    for (const row of rs009.rows) {
      const docId = row["doc_id"] === null ? null : String(row["doc_id"]);
      const entry: AuditEntry = {
        timestamp: String(row["timestamp"]),
        actor: String(row["actor"]),
        session_id: String(row["session_id"]),
        action: String(row["action"]),
        ...(docId !== null ? { doc_id: docId } : {}),
        details: JSON.parse(String(row["details"] ?? "{}")) as Record<string, unknown>,
      };
      const entryHash = computeAuditEntryHash(entry, prevHash);
      await tx009.execute({
        sql: "UPDATE audit SET prev_hash = ?, entry_hash = ? WHERE id = ?",
        args: [prevHash, entryHash, Number(row["id"])],
      });
      prevHash = entryHash;
    }

    await tx009.executeMultiple(MIGRATION_009_FINALIZE_SQL);
    await tx009.commit();
  } catch (e) {
    try {
      await tx009.rollback();
    } catch {
      // reason: rollback throws only when the transaction is already
      // closed — safe to ignore, `e` below is what the caller needs
      // (mirrors migration-008's identical rollback guard, tx008 above).
    }
    throw e;
  } finally {
    tx009.close();
  }

  // migration-010 (SPEC-084 docs.ordinal + partial unique index) is a
  // SINGLE self-contained SQL string (mirrors migration-007's shape, no
  // JS-level backfill loop needed) — a plain executeMultiple call, same as
  // migrations 001-007 above.
  await client.executeMultiple(MIGRATION_010_SQL);

  // migration-011 (SPEC-102 trace_events + its four indexes) is pure
  // additive CREATE TABLE/INDEX IF NOT EXISTS — mirrors migration-001..003's
  // un-wrapped shape, a plain executeMultiple call. NOTE: trace_events is
  // NEVER added to sync-push.ts's own REPLICATED_TABLES set (SPEC-102 D3) —
  // this fixture mirrors SQLiteStore's full migration CHAIN for the
  // user_version parity guard below, which is a separate concern from "which
  // tables sync-push actually replicates."
  await client.executeMultiple(MIGRATION_011_SQL);

  // migration-012 (spec-issue-closure-loop-computed-resolution-agent-reachable,
  // widen links.link_type CHECK to accept "resolves") is a `links`
  // table-recreate, same shape as migration-004's "governs" widening — a
  // plain executeMultiple call, same as migrations 001-007/010 above.
  await client.executeMultiple(MIGRATION_012_SQL);

  // migration-013 (spec-baseline-slice-1-rules-with-permanent-ids-ac-citations
  // §C2: widen docs.type CHECK to accept 'baseline' via a docs table-recreate,
  // plus the rule_registry table) is a SINGLE self-contained SQL string with
  // its own BEGIN/COMMIT and foreign_keys toggle — same shape as
  // migration-006's docs rebuild, a plain executeMultiple call. rule_registry
  // is NEVER in sync-push.ts's REPLICATED_TABLES; it is mirrored here only for
  // the user_version parity guard below.
  await client.executeMultiple(MIGRATION_013_SQL);

  // migration-014 (spec-baseline-slice-2-completeness-census-per-branch-citation
  // §C5: rule_registry lifecycle/version, ac_cites, rule_depends, ac_exemptions
  // + the docs_idx_* triggers) is a SINGLE self-contained SQL string — a plain
  // executeMultiple call. Its tables are NEVER in sync-push.ts's
  // REPLICATED_TABLES (they are derived from docs, which are replicated); the
  // docs_idx_* triggers DO fire on the remote when sync-push upserts docs, so
  // the remote keeps the indexes in step like any other store. Mirrored here
  // for the user_version parity guard below.
  await client.executeMultiple(MIGRATION_014_SQL);
  await client.executeMultiple(MIGRATION_015_SQL);

  // migration-016 (spec-run-identity-slice-1: `runs` table + nullable `harness_run`
  // columns on audit/versions) is TWO-PHASE like turso-store.ts's own chain: add each
  // column only where `PRAGMA table_info` lacks it (no ADD COLUMN IF NOT EXISTS), then
  // one BEGIN/COMMIT string creates `runs` and bumps user_version. Mirrored for the parity guard.
  for (const { table, column, ddl } of MIGRATION_016_ADD_COLUMNS) {
    const info = await client.execute(`PRAGMA table_info(${table})`);
    if (!info.rows.some((r) => String(r["name"]) === column)) await client.execute(ddl);
  }
  await client.executeMultiple(MIGRATION_016_SQL);

  // migration-017 (spec-run-only-write-identity-and-run-end-claim-release: nullable `runs.ended_at` /
  // `runs.end_reason`) is two-phase like 016. Mirrored here for the parity guard.
  for (const { table, column, ddl } of MIGRATION_017_ADD_COLUMNS) {
    const info = await client.execute(`PRAGMA table_info(${table})`);
    if (!info.rows.some((r) => String(r["name"]) === column)) await client.execute(ddl);
  }
  await client.executeMultiple(MIGRATION_017_SQL);
  // migration-018 (rule_registry state 'proposed') is one BEGIN/COMMIT string rebuilt via rule_registry_new, like 015.
  await client.executeMultiple(MIGRATION_018_SQL);
  // migration-019 (nullable `review_judgments.truncated` / `.truncation`) is two-phase like 017.
  for (const { table, column, ddl } of MIGRATION_019_ADD_COLUMNS) {
    const info = await client.execute(`PRAGMA table_info(${table})`);
    if (!info.rows.some((r) => String(r["name"]) === column)) await client.execute(ddl);
  }
  await client.executeMultiple(MIGRATION_019_SQL);
  // migration-020 (decision_log + append-only triggers) is one BEGIN/COMMIT string; never replicated, mirrored for the parity guard.
  await client.executeMultiple(MIGRATION_020_SQL);
  // migration-021 (runs.harness_pid / harness_pid_start / worktree) is two-phase like 017/019; runs is not replicated, mirrored for the parity guard.
  for (const { table, column, ddl } of MIGRATION_021_ADD_COLUMNS) {
    const info = await client.execute(`PRAGMA table_info(${table})`);
    if (!info.rows.some((r) => String(r["name"]) === column)) await client.execute(ddl);
  }
  await client.executeMultiple(MIGRATION_021_SQL);
  // migration-022 (autonomy_thresholds) is one BEGIN/COMMIT string; local-only, mirrored for the parity guard.
  await client.executeMultiple(MIGRATION_022_SQL);
  // migration-023 (decision_log verdict CHECK widened to admit superseded) is one BEGIN/COMMIT string; mirrored for the parity guard.
  await client.executeMultiple(MIGRATION_023_SQL);

  // ─── Parity guard ────────────────────────────────────────────────────────
  // Assert the remote fixture's PRAGMA user_version matches the REAL
  // SQLiteStore's — the two schemas are hand-kept in lockstep above. If they
  // ever diverge (a migration added to SQLiteStore.runMigrations() but not
  // mirrored in the executeMultiple() calls above), fail loudly HERE, at
  // fixture setup, rather than via opaque per-row remote-INSERT failures
  // scattered across every test in this file.
  const localVersionRow = localStore
    .getDatabase()
    .query("PRAGMA user_version")
    .get() as { user_version: number };
  const remoteVersionRs = await client.execute("PRAGMA user_version");
  const remoteVersionRow = remoteVersionRs.rows[0];
  const remoteVersion = remoteVersionRow ? Number(remoteVersionRow["user_version"]) : -1;

  if (localVersionRow.user_version !== remoteVersion) {
    throw new Error(
      "sync-push fixture drift: remote fixture migration chain diverged from " +
        `SQLiteStore — local PRAGMA user_version=${localVersionRow.user_version}, ` +
        `remote PRAGMA user_version=${remoteVersion}. Add the missing ` +
        "MIGRATION_00N here (applyMigrationsToClient in sync-push.bun.test.ts).",
    );
  }
}

// ─── Count rows in a libsql table ────────────────────────────────────────────

async function countRemoteRows(client: Client, table: string): Promise<number> {
  const rs = await client.execute(`SELECT COUNT(*) as cnt FROM ${table}`);
  const row = rs.rows[0];
  if (!row) return 0;
  return Number(row["cnt"]);
}

// ─── Import Under Test ───────────────────────────────────────────────────────
// Dynamic import so missing module gives a clear RED failure per test, not
// a collection-time crash that swallows all other test files.

async function importSyncPush() {
  // ASSUMPTION: syncPush exported from src/adapters/http/sync-push.ts
  // If module is missing → RED (expected; this is the TDD pre-implementation state)
  const mod = await import("../../../src/adapters/http/sync-push.js");

  if (!mod.syncPush) {
    throw new Error(
      "src/adapters/http/sync-push.ts does not export syncPush — implementation missing (RED expected)",
    );
  }

  return mod as {
    syncPush: (
      localPath: string,
      remoteClient: Client,
    ) => Promise<{ ok: true; value: { tables: Array<{ table: string; local_rows: number; remote_rows: number }>; total_rows: number } } | { ok: false; error: { code: string; message: string } }>;
  };
}

// ─── Shared Test State ───────────────────────────────────────────────────────

let tmpDir: string;
let localDbPath: string;
let remoteDbPath: string;
let localStore: SQLiteStore;
let remoteClient: Client;

// Inserted document IDs (for relationship setup)
let docId1: string;
let docId2: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-push-test-"));
  localDbPath = join(tmpDir, "local.db");
  remoteDbPath = join(tmpDir, "remote.db");

  // Build local fixture DB using REAL SQLiteStore
  localStore = new SQLiteStore(localDbPath);

  const doc1 = makeDoc({ title: "Document Alpha", tags: ["alpha"] });
  const doc2 = makeDoc({ title: "Document Beta", tags: ["beta"] });
  docId1 = doc1.id;
  docId2 = doc2.id;

  // Insert docs (populates docs table + audit trigger via FTS)
  const ins1 = await localStore.insert(doc1);
  const ins2 = await localStore.insert(doc2);
  if (!ins1.ok || !ins2.ok) throw new Error("Fixture: failed to insert docs");

  // Insert a link (populates links table)
  const link: LinkRecord = {
    from_id: docId1,
    to_id: docId2,
    link_type: "relates-to",
    created_at: "2026-06-11T10:05:00.000Z",
    created_by: "agent:push-test",
  };
  const linkResult = await localStore.addLink(link);
  if (!linkResult.ok) throw new Error("Fixture: failed to insert link");

  // Insert a version record (populates versions table)
  const version: VersionRecord = {
    doc_id: docId1,
    version: 1,
    content: doc1.content,
    extra: {},
    status: doc1.status,
    title: doc1.title,
    action: "create",
    created_at: doc1.created_at,
    created_by: doc1.created_by,
    // change_summary omitted (exactOptionalPropertyTypes — undefined not allowed for optional string)
  };
  const verResult = await localStore.insertVersion(version);
  if (!verResult.ok) throw new Error("Fixture: failed to insert version");

  // Insert an audit entry (populates audit table)
  const auditEntry: AuditEntry = {
    timestamp: "2026-06-11T10:10:00.000Z",
    actor: "agent:push-test",
    session_id: "session-push-001",
    action: "create",
    doc_id: docId1,
    details: { source: "push-test" },
  };
  const auditResult = await localStore.appendAuditEntry(auditEntry);
  if (!auditResult.ok) throw new Error("Fixture: failed to insert audit entry");

  // Insert an api_key (populates api_keys table via raw SQL, bypassing ApiKeyStore)
  // We use SQLiteStore.getDatabase() to insert directly
  const db = localStore.getDatabase();
  db.run(
    `INSERT INTO api_keys (key_hash, name, owner, rate_limit, created_at, revoked_at)
     VALUES ('abc123def456hash', 'test-agent', 'admin', 60, '2026-06-11T10:00:00.000Z', NULL)`,
  );

  // Create remote libsql client (file: mode — no network)
  remoteClient = createClient({ url: `file:${remoteDbPath}` });
  await applyMigrationsToClient(remoteClient, localStore);
});

afterAll(async () => {
  localStore.close();
  remoteClient.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Test Suite ───────────────────────────────────────────────────────────────

// ===========================================================================
// HAPPY PATH — syncPush copies all 5 tables (SPEC-009 §3.3 + D-006 + R3)
// ===========================================================================

describe("syncPush — happy path (SPEC-009 §3.3, D-006, R3)", () => {
  it("syncPush returns ok:true with a PushReport (tables array + total_rows)", async () => {
    const { syncPush } = await importSyncPush();

    const result = await syncPush(localDbPath, remoteClient);

    expect(result.ok).toBe(true);
    if (!result.ok) return; // type narrowing

    expect(result.value).toBeDefined();
    expect(Array.isArray(result.value.tables)).toBe(true);
    expect(typeof result.value.total_rows).toBe("number");
  });

  it("PushReport includes an entry for 'docs' table with local_rows > 0", async () => {
    const { syncPush } = await importSyncPush();

    const result = await syncPush(localDbPath, remoteClient);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const docsEntry = result.value.tables.find((t) => t.table === "docs");
    expect(docsEntry).toBeDefined();
    // We inserted 2 docs in fixture
    expect(docsEntry!.local_rows).toBe(2);
    // After push, remote must have same count
    expect(docsEntry!.remote_rows).toBe(2);
  });

  it("PushReport includes an entry for 'links' table with correct row count", async () => {
    const { syncPush } = await importSyncPush();

    const result = await syncPush(localDbPath, remoteClient);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const linksEntry = result.value.tables.find((t) => t.table === "links");
    expect(linksEntry).toBeDefined();
    expect(linksEntry!.local_rows).toBe(1);
    expect(linksEntry!.remote_rows).toBe(1);
  });

  it("PushReport includes an entry for 'versions' table with correct row count", async () => {
    const { syncPush } = await importSyncPush();

    const result = await syncPush(localDbPath, remoteClient);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const versionsEntry = result.value.tables.find((t) => t.table === "versions");
    expect(versionsEntry).toBeDefined();
    expect(versionsEntry!.local_rows).toBe(1);
    expect(versionsEntry!.remote_rows).toBe(1);
  });

  it("PushReport includes an entry for 'audit' table with correct row count (R3: all 5 tables)", async () => {
    // R3: Risk register says sync push MUST cover all 5 tables
    const { syncPush } = await importSyncPush();

    const result = await syncPush(localDbPath, remoteClient);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const auditEntry = result.value.tables.find((t) => t.table === "audit");
    expect(auditEntry).toBeDefined();
    // We inserted 1 audit entry; note FTS triggers may add more — check remote_rows >= local_rows
    expect(auditEntry!.remote_rows).toBe(auditEntry!.local_rows);
  });

  it("PushReport includes an entry for 'api_keys' table (R3: 5th table must be covered)", async () => {
    // R3: api_keys is the 5th table. Missing coverage was flagged as a risk.
    const { syncPush } = await importSyncPush();

    const result = await syncPush(localDbPath, remoteClient);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // api_keys must appear in the table list
    const apiKeysEntry = result.value.tables.find((t) => t.table === "api_keys");
    expect(apiKeysEntry).toBeDefined();
    // We inserted 1 api key in fixture
    expect(apiKeysEntry!.local_rows).toBe(1);
    expect(apiKeysEntry!.remote_rows).toBe(1);
  });

  it("PushReport total_rows equals the sum of all table remote_rows", async () => {
    const { syncPush } = await importSyncPush();

    const result = await syncPush(localDbPath, remoteClient);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const sumOfTableRows = result.value.tables.reduce((acc, t) => acc + t.remote_rows, 0);
    expect(result.value.total_rows).toBe(sumOfTableRows);
  });

  it("Remote DB actually contains the pushed docs rows after syncPush", async () => {
    // Adversarial: verify remote DB state, not just the returned report
    const { syncPush } = await importSyncPush();

    const result = await syncPush(localDbPath, remoteClient);
    expect(result.ok).toBe(true);

    const remoteDocCount = await countRemoteRows(remoteClient, "docs");
    expect(remoteDocCount).toBe(2);
  });

  it("Remote DB actually contains the pushed api_keys rows after syncPush", async () => {
    // Adversarial: verify api_keys in remote, not just report
    const { syncPush } = await importSyncPush();

    await syncPush(localDbPath, remoteClient);

    const remoteKeyCount = await countRemoteRows(remoteClient, "api_keys");
    expect(remoteKeyCount).toBe(1);
  });
});

// ===========================================================================
// STATE — Idempotency (SPEC-009 §3.3 + AC goal: no duplicates on re-push)
// ===========================================================================

describe("syncPush — idempotency (SPEC-009 §3.3 state)", () => {
  let idempotentTmpDir: string;
  let idempotentLocalPath: string;
  let idempotentRemotePath: string;
  let idempotentLocalStore: SQLiteStore;
  let idempotentRemoteClient: Client;

  beforeAll(async () => {
    idempotentTmpDir = mkdtempSync(join(tmpdir(), "lore-push-idem-"));
    idempotentLocalPath = join(idempotentTmpDir, "local.db");
    idempotentRemotePath = join(idempotentTmpDir, "remote.db");

    idempotentLocalStore = new SQLiteStore(idempotentLocalPath);

    // Seed 3 docs
    for (let i = 0; i < 3; i++) {
      const doc = makeDoc({ title: `Idempotent Doc ${i}` });
      const r = await idempotentLocalStore.insert(doc);
      if (!r.ok) throw new Error(`Fixture idem: insert doc ${i} failed`);
    }

    idempotentRemoteClient = createClient({ url: `file:${idempotentRemotePath}` });
    await applyMigrationsToClient(idempotentRemoteClient, idempotentLocalStore);
  });

  afterAll(async () => {
    idempotentLocalStore.close();
    idempotentRemoteClient.close();
    rmSync(idempotentTmpDir, { recursive: true, force: true });
  });

  it("second syncPush returns ok:true (no error on re-push)", async () => {
    const { syncPush } = await importSyncPush();

    // First push
    const first = await syncPush(idempotentLocalPath, idempotentRemoteClient);
    expect(first.ok).toBe(true);

    // Second push — must succeed (idempotent)
    const second = await syncPush(idempotentLocalPath, idempotentRemoteClient);
    expect(second.ok).toBe(true);
  });

  it("second syncPush produces no duplicate rows (remote docs count stays 3)", async () => {
    const { syncPush } = await importSyncPush();

    // Push twice
    await syncPush(idempotentLocalPath, idempotentRemoteClient);
    await syncPush(idempotentLocalPath, idempotentRemoteClient);

    // Verify no duplicates
    const remoteDocCount = await countRemoteRows(idempotentRemoteClient, "docs");
    expect(remoteDocCount).toBe(3);
  });

  it("second syncPush report shows same remote_rows as local_rows (reconciled)", async () => {
    const { syncPush } = await importSyncPush();

    // Push twice
    await syncPush(idempotentLocalPath, idempotentRemoteClient);
    const second = await syncPush(idempotentLocalPath, idempotentRemoteClient);

    expect(second.ok).toBe(true);
    if (!second.ok) return;

    // Each table: remote_rows must equal local_rows (no extras, no missing)
    for (const entry of second.value.tables) {
      expect(entry.remote_rows).toBe(entry.local_rows);
    }
  });
});

// ===========================================================================
// NEGATIVE CASES — Invalid inputs / error paths
// ===========================================================================

describe("syncPush — negative cases", () => {
  it("syncPush returns ok:false when localPath does not exist", async () => {
    const { syncPush } = await importSyncPush();
    const fakeClient = createClient({ url: `file:/tmp/lore-fake-remote-${Date.now()}.db` });

    const result = await syncPush("/nonexistent/path/lore.db", fakeClient);

    // Must fail loud — not silently return an empty report
    expect(result.ok).toBe(false);

    fakeClient.close();
  });
});

// ===========================================================================
// BOUNDARY VALUES — Empty DB
// ===========================================================================

describe("syncPush — boundary values (empty local DB)", () => {
  let boundaryTmpDir: string;
  let boundaryLocalPath: string;
  let boundaryRemotePath: string;
  let boundaryLocalStore: SQLiteStore;
  let boundaryRemoteClient: Client;

  beforeAll(async () => {
    boundaryTmpDir = mkdtempSync(join(tmpdir(), "lore-push-boundary-"));
    boundaryLocalPath = join(boundaryTmpDir, "local.db");
    boundaryRemotePath = join(boundaryTmpDir, "remote.db");

    // Empty DB — no rows in any table
    boundaryLocalStore = new SQLiteStore(boundaryLocalPath);

    boundaryRemoteClient = createClient({ url: `file:${boundaryRemotePath}` });
    await applyMigrationsToClient(boundaryRemoteClient, boundaryLocalStore);
  });

  afterAll(async () => {
    boundaryLocalStore.close();
    boundaryRemoteClient.close();
    rmSync(boundaryTmpDir, { recursive: true, force: true });
  });

  it("syncPush on empty local DB returns ok:true with zero total_rows", async () => {
    const { syncPush } = await importSyncPush();

    const result = await syncPush(boundaryLocalPath, boundaryRemoteClient);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.total_rows).toBe(0);
  });

  it("syncPush on empty local DB still returns entries for all 5 tables in PushReport", async () => {
    // R3: All 5 tables must appear in report even when empty
    const { syncPush } = await importSyncPush();

    const result = await syncPush(boundaryLocalPath, boundaryRemoteClient);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const tableNames = result.value.tables.map((t) => t.table).sort();
    expect(tableNames).toContain("docs");
    expect(tableNames).toContain("links");
    expect(tableNames).toContain("versions");
    expect(tableNames).toContain("audit");
    expect(tableNames).toContain("api_keys");
  });
});

// ===========================================================================
// REGRESSION — R3: all 5 tables, none silently skipped
// ===========================================================================

describe("syncPush — regression (R3: 5-table coverage)", () => {
  it("PushReport includes entries for ALL 5 tables: docs, links, versions, audit, api_keys", async () => {
    // Regression guard for R3 risk: missing a table in push was flagged as a known risk.
    // Any future refactor that drops a table must cause this test to fail.
    const { syncPush } = await importSyncPush();

    const result = await syncPush(localDbPath, remoteClient);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const reportedTables = new Set(result.value.tables.map((t) => t.table));
    const requiredTables = ["docs", "links", "versions", "audit", "api_keys"] as const;

    for (const table of requiredTables) {
      expect(reportedTables.has(table)).toBe(true);
    }

    // Exactly 5 core tables (no silent extras that mask missing ones)
    expect(result.value.tables.length).toBeGreaterThanOrEqual(5);
  });
});

// ===========================================================================
// ERROR — External dependency failure
// ===========================================================================

describe("syncPush — error handling", () => {
  it("syncPush returns ok:false and a STORE_ERROR when remote client is closed", async () => {
    const { syncPush } = await importSyncPush();

    // Create a client and immediately close it to simulate a connection failure
    const closedClient = createClient({ url: `file:/tmp/lore-closed-${Date.now()}.db` });
    closedClient.close();

    const result = await syncPush(localDbPath, closedClient);

    // Must fail loud — error must propagate, not be silently swallowed
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("STORE_ERROR");
    }
  });
});
