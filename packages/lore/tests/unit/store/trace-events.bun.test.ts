/** @spec_ref SPEC-102 §Schema, §Design Decisions D3/D4, §Acceptance Criteria AC-TRACE-1/AC-TRACE-7 */
/**
 * Tests for migration-011 (`trace_events` table + its four indexes) and the
 * StoreInterface trace read/write/prune methods (T1: store layer).
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      a fresh SQLiteStore lands on user_version 11 with trace_events
 *               and all four named indexes present (AC-TRACE-1); insert/count/
 *               list round-trip correctly.
 *   NEGATIVE:   n/a at the store layer — kind/surface have no CHECK constraint
 *               by design (D2), so an unrecognized string is accepted here;
 *               Zod validation lives at the TraceRecorder seam (a later task).
 *   BOUNDARY:   doc_id/checkpoint/hit_count all absent (a bare 'feed' event) —
 *               round-trips with those fields omitted, never present as null.
 *   STATE:      pruneTraceEvents deletes only rows older than the cutoff, in a
 *               bounded batch, and is idempotent (a second call after the
 *               table is clean returns 0).
 *   ERROR:      n/a — insertTraceEvent has no caller-reachable failure path
 *               against a healthy table (fire-and-forget contract is exercised
 *               by TraceRecorder's own tests, a later task).
 *   REGRESSION: AC-TRACE-7 — trace_events is absent from sync-push's
 *               REPLICATED_TABLES set (D3, never synced to Turso).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";

function userVersion(db: Database): number {
  return (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
}

function indexNames(db: Database): string[] {
  return (
    db.query("SELECT name FROM sqlite_master WHERE type = 'index'").all() as { name: string }[]
  ).map((row) => row.name);
}

describe("migration-011 (trace_events) — schema (AC-TRACE-1)", () => {
  it("HAPPY: a fresh SQLiteStore lands on the current head user_version with trace_events and all four indexes present", () => {
    const store = new SQLiteStore(":memory:");
    const db = store.getDatabase();

    // reason: migration-012 (spec-issue-closure-loop-computed-resolution-
    // agent-reachable, links.link_type CHECK widened for "resolves") is now
    // the head — a fresh store runs every migration up to it, not just
    // through migration-011. This test's own concern (trace_events + its
    // four indexes) is unaffected — asserted directly below.
    expect(userVersion(db)).toBe(15);

    const tables = (
      db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    ).map((t) => t.name);
    expect(tables).toContain("trace_events");

    const indexes = indexNames(db);
    expect(indexes).toContain("idx_trace_kind_ts");
    expect(indexes).toContain("idx_trace_kind_actor");
    expect(indexes).toContain("idx_trace_doc");
    expect(indexes).toContain("idx_trace_ts");

    store.close();
  });

  it("HAPPY: trace_events columns match SPEC-102 §Schema verbatim (TEXT ts, no CHECK on kind/surface, promoted checkpoint/hit_count)", () => {
    const store = new SQLiteStore(":memory:");
    const db = store.getDatabase();

    const columns = (
      db.query("PRAGMA table_info(trace_events)").all() as {
        name: string;
        type: string;
        notnull: number;
      }[]
    );
    const byName = new Map(columns.map((c) => [c.name, c]));

    expect(byName.get("ts")?.type).toBe("TEXT");
    expect(byName.get("ts")?.notnull).toBe(1);
    expect(byName.get("kind")?.notnull).toBe(1);
    expect(byName.get("surface")?.notnull).toBe(1);
    expect(byName.get("doc_id")?.notnull).toBe(0);
    expect(byName.get("checkpoint")?.notnull).toBe(0);
    expect(byName.get("hit_count")?.notnull).toBe(0);
    expect(byName.get("details")?.notnull).toBe(1);

    // reason: D2 — no CHECK constraint on kind/surface. Inserting an
    // unrecognized kind must NOT throw at the SQL layer (forward-compat).
    expect(() => {
      db.run(
        `INSERT INTO trace_events (ts, actor, surface, session_id, kind, details)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ["2026-07-28T00:00:00.000Z", "agent:test", "unrecognized_surface", "s1", "unrecognized_kind", "{}"],
      );
    }).not.toThrow();

    store.close();
  });
});

describe("StoreInterface trace methods (SQLiteStore)", () => {
  let store: SQLiteStore;

  beforeEach(() => {
    store = new SQLiteStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  it("HAPPY: insertTraceEvent + countTraceEventsByKind round-trips a get event", async () => {
    const insertResult = await store.insertTraceEvent({
      ts: "2026-07-28T00:00:00.000Z",
      actor: "agent:test",
      surface: "agent",
      session_id: "s1",
      kind: "get",
      doc_id: "01DOC00000000000000000001",
      details: {},
    });
    expect(insertResult.ok).toBe(true);

    const countsResult = await store.countTraceEventsByKind({ since: "2026-01-01T00:00:00.000Z" });
    expect(countsResult.ok).toBe(true);
    if (!countsResult.ok) return;
    expect(countsResult.value["get"]).toBe(1);
  });

  it("BOUNDARY: a bare feed event (no doc_id/checkpoint/hit_count) round-trips with those fields omitted, never null", async () => {
    await store.insertTraceEvent({
      ts: "2026-07-28T00:00:00.000Z",
      actor: "agent:test",
      surface: "cli",
      session_id: "s1",
      kind: "feed",
      details: { docs_served: ["01DOC1", "01DOC2"] },
    });

    const denies = await store.listTraceGateDenies({ since: "2026-01-01T00:00:00.000Z" });
    expect(denies.ok).toBe(true);
    if (!denies.ok) return;
    expect(denies.value).toEqual([]); // feed is not gate_deny — sanity check the kind filter

    const counts = await store.countTraceEventsByKind({ since: "2026-01-01T00:00:00.000Z" });
    expect(counts.ok).toBe(true);
    if (!counts.ok) return;
    expect(counts.value["feed"]).toBe(1);
  });

  it("HAPPY: countTraceDenyByCheckpoint groups by (checkpoint, layer) — SPEC-102 D7 layer disambiguation", async () => {
    await store.insertTraceEvent({
      ts: "2026-07-28T00:00:00.000Z",
      actor: "agent:a",
      surface: "agent",
      session_id: "s1",
      kind: "gate_deny",
      checkpoint: "task-claim",
      details: { predicates_failed: ["ANCHOR_OVERLAP"], layer: "service" },
    });
    await store.insertTraceEvent({
      ts: "2026-07-28T00:00:01.000Z",
      actor: "agent:b",
      surface: "cli",
      session_id: "s2",
      kind: "gate_deny",
      checkpoint: "task-claim",
      details: { predicates_failed: ["ANCHOR_OVERLAP"], layer: "hook" },
    });

    const result = await store.countTraceDenyByCheckpoint({ since: "2026-01-01T00:00:00.000Z" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sorted = [...result.value].sort((a, b) => a.layer.localeCompare(b.layer));
    expect(sorted).toEqual([
      { checkpoint: "task-claim", layer: "hook", count: 1 },
      { checkpoint: "task-claim", layer: "service", count: 1 },
    ]);
  });

  it("HAPPY: countTraceZeroHitSearches counts only hit_count=0 search rows", async () => {
    await store.insertTraceEvent({
      ts: "2026-07-28T00:00:00.000Z",
      actor: "agent:a",
      surface: "agent",
      session_id: "s1",
      kind: "search",
      hit_count: 0,
      details: { query: "nonexistent" },
    });
    await store.insertTraceEvent({
      ts: "2026-07-28T00:00:01.000Z",
      actor: "agent:a",
      surface: "agent",
      session_id: "s1",
      kind: "search",
      hit_count: 3,
      details: { query: "found" },
    });

    const result = await store.countTraceZeroHitSearches({ since: "2026-01-01T00:00:00.000Z" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(1);
  });

  it("STATE: pruneTraceEvents deletes only rows older than the cutoff, bounded, and is idempotent once clean", async () => {
    await store.insertTraceEvent({
      ts: "2026-01-01T00:00:00.000Z", // old — eligible for prune
      actor: "agent:a",
      surface: "agent",
      session_id: "s1",
      kind: "get",
      doc_id: "01OLD",
      details: {},
    });
    await store.insertTraceEvent({
      ts: "2026-07-28T00:00:00.000Z", // recent — must survive
      actor: "agent:a",
      surface: "agent",
      session_id: "s1",
      kind: "get",
      doc_id: "01NEW",
      details: {},
    });

    const pruneResult = await store.pruneTraceEvents("2026-07-01T00:00:00.000Z");
    expect(pruneResult.ok).toBe(true);
    if (!pruneResult.ok) return;
    expect(pruneResult.value).toBe(1);

    const counts = await store.countTraceEventsByKind({ since: "2020-01-01T00:00:00.000Z" });
    expect(counts.ok).toBe(true);
    if (!counts.ok) return;
    expect(counts.value["get"]).toBe(1); // only the recent row survives

    // Idempotent: a second prune call with nothing left to delete returns 0.
    const secondPrune = await store.pruneTraceEvents("2026-07-01T00:00:00.000Z");
    expect(secondPrune.ok).toBe(true);
    if (!secondPrune.ok) return;
    expect(secondPrune.value).toBe(0);
  });

  it("HAPPY: countNeverReadDocs excludes docs with a kind='get' trace row since the window, and excludes soft-deleted docs", async () => {
    const now = "2026-07-28T00:00:00.000Z";
    const insertDoc = (id: string, deletedAt: string | null) =>
      store.getDatabase().run(
        `INSERT INTO docs
           (id, slug, type, role, title, status, priority, content,
            parent_id, extra, tags, version, created_at, updated_at,
            created_by, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, `spec-${id}`, "spec", "spec", "T", "draft", "medium", "c", null, "{}", "[]", 1, now, now, "agent:test", deletedAt],
      );

    insertDoc("01READ0000000000000000001", null);
    insertDoc("01UNREAD00000000000000002", null);
    insertDoc("01DELETED000000000000003", "2026-07-27T00:00:00.000Z");

    await store.insertTraceEvent({
      ts: now,
      actor: "agent:test",
      surface: "agent",
      session_id: "s1",
      kind: "get",
      doc_id: "01READ0000000000000000001",
      details: {},
    });

    const result = await store.countNeverReadDocs({ since: "2026-01-01T00:00:00.000Z" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Only 01UNREAD... counts — 01READ... was read, 01DELETED... is soft-deleted.
    expect(result.value).toBe(1);
  });
});

describe("AC-TRACE-7: Turso isolation — local-only trace writes", () => {
  it("REGRESSION: trace_events is ABSENT from sync-push's REPLICATED_TABLES set (SPEC-102 D3)", async () => {
    // reason: REPLICATED_TABLES is a module-private const, not exported —
    // asserted against the source file TEXT for the literal tuple (the same
    // thing a reviewer would grep for). This is a stable regression guard: a
    // future edit that adds "trace_events" to this array (accidentally
    // replicating local-only trace data to the remote Turso database) fails
    // this test loud.
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const syncPushPath = fileURLToPath(
      new URL("../../../src/adapters/http/sync-push.ts", import.meta.url),
    );
    const source = readFileSync(syncPushPath, "utf8");
    const match = source.match(/REPLICATED_TABLES\s*=\s*\[([^\]]*)\]/);
    expect(match).not.toBeNull();
    expect(match?.[1]).not.toContain("trace_events");
  });

  it("HAPPY: a SEPARATE local bun:sqlite handle on a Turso-replica-shaped file supports the identical trace_events schema/methods (mirrors app.ts's ApiKeyStore-precedent wiring, T3)", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "lore-trace-turso-replica-"));
    try {
      const replicaPath = join(tempDir, "replica.db");
      // reason: the SAME SQLiteStore class app.ts's composition root will use
      // to open a SEPARATE local handle on the Turso embedded-replica FILE
      // (never `this.client`) — proves migration-011 lands identically on a
      // replica-shaped local file, independent of any remote Turso state.
      const localTraceStore = new SQLiteStore(replicaPath);
      expect(userVersion(localTraceStore.getDatabase())).toBe(15);

      const insertResult = await localTraceStore.insertTraceEvent({
        ts: "2026-07-28T00:00:00.000Z",
        actor: "agent:test",
        surface: "agent",
        session_id: "s1",
        kind: "get",
        doc_id: "01DOC00000000000000000001",
        details: {},
      });
      expect(insertResult.ok).toBe(true);

      localTraceStore.close();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
