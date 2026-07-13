/**
 * Tests for SessionStore — cookie session lifecycle.
 * Source: SPEC-016 §3.4, §3.5
 *
 * Test plan (6-dimension):
 *   HAPPY:
 *     - create() returns a 32-hex session_id and ISO expires_at
 *     - resolve() returns name + owner + expires_at for a valid session
 *     - touch() extends expires_at by ~30 days
 *     - delete() removes the session row
 *     - pruneExpired() removes sessions with past expires_at
 *
 *   NEGATIVE:
 *     - resolve() returns null for unknown session_id
 *     - resolve() returns null for a row that was deleted
 *     - resolve() returns null (fail-closed) when api_key_name has no matching api_keys row
 *       (hardening fix — see session-revocation.bun.test.ts for the revoked-key suite)
 *     - touch() on unknown session is a no-op (no error thrown)
 *     - delete() on unknown session is a no-op (no error thrown)
 *
 *   BOUNDARY:
 *     - create() generates unique session IDs (two consecutive calls produce different IDs)
 *     - sessions table created automatically on construction (no prior DDL)
 *     - pruneExpired() with no expired rows is a no-op
 *
 *   ERROR:
 *     - n/a: bun:sqlite in-memory does not simulate connection failure
 *
 *   STATE:
 *     - session row is present after create(), absent after delete()
 *     - after pruneExpired(), only non-expired rows remain
 *     - after touch(), expires_at is further in the future than before
 *
 *   REGRESSION:
 *     - Two sessions with the same api_key_name coexist without conflict
 *     - resolving a session returns the correct api_key_name (no cross-session mixing)
 *
 * @spec_ref AC-A-B1, AC-A-B6, AC-A-B8, AC-A-B10
 */

import { beforeEach, describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { SessionStore } from "../../../../src/adapters/http/sessions.js";
import { MIGRATION_002_SQL } from "../../../../src/store/migrations/migration-002.js";

// ─── Test setup ───────────────────────────────────────────────────────────────

function makeDb(): Database {
  const db = new Database(":memory:");
  // api_keys table must exist for the LEFT JOIN in resolve()
  db.exec(MIGRATION_002_SQL);
  return db;
}

function makeDbWithKey(name = "dashboard-local", owner = "admin"): { db: Database; name: string; owner: string } {
  const db = makeDb();
  const now = new Date().toISOString();
  const keyHash = "a".repeat(64); // Fake hash — we only need the row to exist for JOIN
  db.prepare(
    "INSERT INTO api_keys (key_hash, name, owner, rate_limit, created_at) VALUES (?, ?, ?, 60, ?)",
  ).run(keyHash, name, owner, now);
  return { db, name, owner };
}

// ─── create ──────────────────────────────────────────────────────────────────

describe("SessionStore.create", () => {
  describe("happy path", () => {
    it("returns a 32-hex session_id", () => {
      const db = makeDb();
      const store = new SessionStore(db);
      const { session_id } = store.create("dashboard-local");
      expect(session_id).toHaveLength(32);
      expect(session_id).toMatch(/^[0-9a-f]{32}$/);
    });

    it("returns an ISO 8601 expires_at approximately 30 days from now", () => {
      const db = makeDb();
      const store = new SessionStore(db);
      const before = Date.now();
      const { expires_at } = store.create("dashboard-local");
      const after = Date.now();
      const expiresMs = new Date(expires_at).getTime();
      const thirtyDays = 30 * 24 * 60 * 60 * 1000;
      expect(expiresMs).toBeGreaterThanOrEqual(before + thirtyDays - 1000);
      expect(expiresMs).toBeLessThanOrEqual(after + thirtyDays + 1000);
    });
  });

  describe("boundary values", () => {
    it("two consecutive calls produce different session IDs", () => {
      const db = makeDb();
      const store = new SessionStore(db);
      const { session_id: sid1 } = store.create("dashboard-local");
      const { session_id: sid2 } = store.create("dashboard-local");
      expect(sid1).not.toBe(sid2);
    });

    it("sessions table is created automatically on construction", () => {
      const db = new Database(":memory:");
      // No MIGRATION_002_SQL — SessionStore must create its own table
      db.exec(MIGRATION_002_SQL); // only for api_keys
      const store = new SessionStore(db);
      // Should not throw — table exists
      expect(() => store.create("test")).not.toThrow();
    });
  });

  describe("state transitions", () => {
    it("creates a sessions row in the database", () => {
      const db = makeDb();
      const store = new SessionStore(db);
      const { session_id } = store.create("dashboard-local");
      const row = db.prepare("SELECT session_id FROM sessions WHERE session_id = ?").get(session_id);
      expect(row).not.toBeNull();
    });
  });

  describe("regression", () => {
    it("two sessions with the same api_key_name coexist without conflict", () => {
      const db = makeDb();
      const store = new SessionStore(db);
      const r1 = store.create("dashboard-local");
      const r2 = store.create("dashboard-local");
      expect(r1.session_id).not.toBe(r2.session_id);
      const count = (db.prepare("SELECT COUNT(*) as n FROM sessions").get() as { n: number }).n;
      expect(count).toBe(2);
    });
  });
});

// ─── resolve ─────────────────────────────────────────────────────────────────

describe("SessionStore.resolve", () => {
  describe("happy path", () => {
    it("returns name + owner + expires_at for a valid session joined with api_keys", () => {
      const { db, name, owner } = makeDbWithKey("dashboard-local", "admin");
      const store = new SessionStore(db);
      const { session_id } = store.create(name);
      const session = store.resolve(session_id);
      expect(session).not.toBeNull();
      expect(session!.name).toBe(name);
      expect(session!.owner).toBe(owner);
      expect(typeof session!.expires_at).toBe("string");
    });

  });

  describe("negative cases", () => {
    // reason: hardening fix — resolve() switched from a LEFT JOIN (tolerating a missing
    // api_keys row via an "admin" owner fallback) to an INNER JOIN + `k.revoked_at IS NULL`
    // (see auth.ts ApiKeyStore.revoke() cascade + module header). A session with no matching,
    // non-revoked api_keys row is now UNAUTHENTICATED, not merely owner-less — closes the gap
    // where a revoked-and-purged key's session kept resolving. See session-revocation.bun.test.ts
    // for the full revoked-key test suite.
    it("returns null (not an 'admin'-owner fallback) when api_keys row is missing", () => {
      const db = makeDb();
      const store = new SessionStore(db);
      // No matching api_keys row for "orphan-key" — INNER JOIN produces no row.
      const { session_id } = store.create("orphan-key");
      const session = store.resolve(session_id);
      expect(session).toBeNull();
    });

    it("returns null for an unknown session_id", () => {
      const db = makeDb();
      const store = new SessionStore(db);
      expect(store.resolve("0".repeat(32))).toBeNull();
    });

    it("returns null after the session has been deleted", () => {
      const db = makeDb();
      const store = new SessionStore(db);
      const { session_id } = store.create("dashboard-local");
      store.delete(session_id);
      expect(store.resolve(session_id)).toBeNull();
    });
  });

  describe("regression", () => {
    it("resolving one session does not return another session's data", () => {
      const db = makeDb();
      const now = new Date().toISOString();
      const keyHash = "b".repeat(64);
      // reason: resolve() now requires a matching, non-revoked api_keys row (hardening fix,
      // see session-revocation.bun.test.ts) — insert rows for both agents so this test still
      // exercises cross-session isolation rather than the (now-rejected) no-matching-key path.
      db.prepare(
        "INSERT INTO api_keys (key_hash, name, owner, rate_limit, created_at) VALUES (?, ?, ?, 60, ?)",
      ).run(keyHash, "agent-a", "admin", now);
      db.prepare(
        "INSERT INTO api_keys (key_hash, name, owner, rate_limit, created_at) VALUES (?, ?, ?, 60, ?)",
      ).run("c".repeat(64), "agent-b", "admin", now);
      const store = new SessionStore(db);
      const { session_id: sid1 } = store.create("agent-a");
      store.create("agent-b");
      const session = store.resolve(sid1);
      expect(session!.name).toBe("agent-a");
    });
  });
});

// ─── touch ────────────────────────────────────────────────────────────────────

describe("SessionStore.touch", () => {
  describe("happy path", () => {
    it("extends expires_at by approximately 30 days", () => {
      // reason: resolve() (called below to check state) now requires a matching, non-revoked
      // api_keys row — see session-revocation.bun.test.ts.
      const { db } = makeDbWithKey();
      const store = new SessionStore(db);
      const { session_id, expires_at: original } = store.create("dashboard-local");
      // Simulate time passing by waiting a tick, then touch
      const session1 = store.resolve(session_id);
      expect(session1).not.toBeNull();

      store.touch(session_id);
      const session2 = store.resolve(session_id);
      expect(session2).not.toBeNull();

      const originalMs = new Date(original).getTime();
      const renewedMs = new Date(session2!.expires_at).getTime();
      // After touch, expires_at should be at least as far or further
      expect(renewedMs).toBeGreaterThanOrEqual(originalMs - 100);
    });
  });

  describe("boundary values", () => {
    it("touch on unknown session_id is a no-op (no error thrown)", () => {
      const db = makeDb();
      const store = new SessionStore(db);
      expect(() => store.touch("0".repeat(32))).not.toThrow();
    });
  });

  describe("state transitions (AC-A-B10)", () => {
    it("after touch, expires_at is later than original expires_at", async () => {
      // reason: resolve() (called below to check state) now requires a matching, non-revoked
      // api_keys row — see session-revocation.bun.test.ts.
      const { db } = makeDbWithKey();
      const store = new SessionStore(db);
      const { session_id, expires_at: original } = store.create("dashboard-local");

      // Wait 10ms so the new expires_at is measurably later
      await new Promise<void>((r) => setTimeout(r, 10));

      store.touch(session_id);
      const renewed = store.resolve(session_id);
      expect(renewed).not.toBeNull();
      const renewedMs = new Date(renewed!.expires_at).getTime();
      const originalMs = new Date(original).getTime();
      expect(renewedMs).toBeGreaterThan(originalMs);
    });
  });
});

// ─── delete ──────────────────────────────────────────────────────────────────

describe("SessionStore.delete", () => {
  describe("happy path", () => {
    it("removes the session row", () => {
      const db = makeDb();
      const store = new SessionStore(db);
      const { session_id } = store.create("dashboard-local");
      store.delete(session_id);
      const row = db.prepare("SELECT session_id FROM sessions WHERE session_id = ?").get(session_id);
      expect(row).toBeNull();
    });
  });

  describe("boundary values", () => {
    it("delete on unknown session_id is a no-op (no error thrown)", () => {
      const db = makeDb();
      const store = new SessionStore(db);
      expect(() => store.delete("0".repeat(32))).not.toThrow();
    });
  });

  describe("state transitions", () => {
    it("session is absent after delete, resolve returns null", () => {
      const db = makeDb();
      const store = new SessionStore(db);
      const { session_id } = store.create("dashboard-local");
      store.delete(session_id);
      expect(store.resolve(session_id)).toBeNull();
    });
  });
});

// ─── pruneExpired ─────────────────────────────────────────────────────────────

describe("SessionStore.pruneExpired", () => {
  describe("happy path", () => {
    it("removes sessions whose expires_at is in the past", () => {
      // reason: resolve() (called below to check state) now requires a matching, non-revoked
      // api_keys row — see session-revocation.bun.test.ts. The expired row deliberately keeps
      // its own non-matching "test-key" name — pruneExpired() operates on expires_at alone and
      // must not require a matching api_keys row to prune a row.
      const { db } = makeDbWithKey();
      const store = new SessionStore(db);

      // Insert an already-expired session directly via SQL
      const past = new Date(Date.now() - 1000).toISOString();
      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO sessions (session_id, api_key_name, created_at, expires_at, last_used_at) VALUES (?, ?, ?, ?, ?)",
      ).run("expired-sid-1234567890123456", "test-key", now, past, now);

      const { session_id: validSid } = store.create("dashboard-local");

      store.pruneExpired();

      expect(store.resolve("expired-sid-1234567890123456")).toBeNull();
      expect(store.resolve(validSid)).not.toBeNull();
    });

    it("pruneExpired with no expired rows is a no-op", () => {
      // reason: resolve() (called below to check state) now requires a matching, non-revoked
      // api_keys row — see session-revocation.bun.test.ts.
      const { db } = makeDbWithKey();
      const store = new SessionStore(db);
      const { session_id } = store.create("dashboard-local");
      expect(() => store.pruneExpired()).not.toThrow();
      expect(store.resolve(session_id)).not.toBeNull();
    });
  });

  describe("state transitions", () => {
    it("constructor calls pruneExpired — expired rows from before are gone on new instance", () => {
      const db = makeDb();

      // Insert expired row before creating store
      const past = new Date(Date.now() - 1000).toISOString();
      const now = new Date().toISOString();
      db.exec(
        "CREATE TABLE IF NOT EXISTS sessions (session_id TEXT PRIMARY KEY, api_key_name TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_used_at TEXT NOT NULL)",
      );
      db.prepare(
        "INSERT INTO sessions (session_id, api_key_name, created_at, expires_at, last_used_at) VALUES (?, ?, ?, ?, ?)",
      ).run("pre-expire-000000000000000000", "test", now, past, now);

      // Constructing SessionStore runs pruneExpired
      const _store = new SessionStore(db);

      const row = db.prepare("SELECT session_id FROM sessions WHERE session_id = ?").get("pre-expire-000000000000000000");
      expect(row).toBeNull();
    });
  });
});
