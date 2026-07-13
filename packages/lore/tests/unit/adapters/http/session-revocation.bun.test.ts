/**
 * Tests for the revoked-API-key → invalidated-cookie-session hardening fix.
 * Source: SPEC-016 §3.3, §3.4 hardening — a revoked API key MUST invalidate every
 * cookie session it ever minted, both at read time (SessionStore.resolve/touch) and via
 * cascade delete (ApiKeyStore.revoke). Prior to this fix, `resolve()` LEFT JOINed against
 * api_keys without checking `revoked_at`, so a stolen/minted `lore_sid` cookie kept
 * authenticating (and self-renewing for another 30 days on every use) even after
 * `lore agent revoke`.
 *
 * Test plan (6-dimension):
 *   HAPPY:
 *     - resolve() still returns a valid session for a NON-revoked key (regression)
 *     - authenticateRequest still authenticates a NON-revoked cookie session (regression)
 *
 *   NEGATIVE:
 *     - resolve() returns null for a session whose backing api_key is revoked
 *     - authenticateRequest (cookie path) rejects a revoked-key session
 *     - ApiKeyStore.revoke() cascade-deletes the revoked key's session rows
 *     - touch() does not revive/extend a session whose backing key is revoked, even when
 *       the session row itself was NOT cascade-deleted (simulates a stale row bypassing
 *       the cascade — tests touch()'s own independent guard, not just the cascade)
 *
 *   BOUNDARY:
 *     - resolve() returns null when the api_keys row is entirely missing (not just
 *       revoked) — the pre-fix "owner may be missing, fallback to 'admin'" tolerance is
 *       gone; a session with no matching api_keys row is now UNAUTHENTICATED, not
 *       owner-less
 *
 *   ERROR:
 *     - n/a: bun:sqlite in-memory does not simulate connection failure
 *
 *   STATE:
 *     - session row count: revoke() removes every session row for that key name, leaves
 *       other keys' sessions untouched
 *
 *   REGRESSION:
 *     - ApiKeyStore constructed standalone (no sessions table ever created on this db)
 *       — revoke() must still succeed (STORE_ERROR must NOT be returned merely because
 *       the sessions table doesn't exist on this handle)
 *     - revoking one key does not affect another key's still-active session
 */

import { beforeEach, describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { ApiKeyStore, authenticateRequest } from "../../../../src/adapters/http/auth.js";
import { SessionStore } from "../../../../src/adapters/http/sessions.js";
import { MIGRATION_002_SQL } from "../../../../src/store/migrations/migration-002.js";

// ─── Test setup ───────────────────────────────────────────────────────────────

function makeStores(): { db: Database; keyStore: ApiKeyStore; sessionStore: SessionStore } {
  const db = new Database(":memory:");
  db.exec(MIGRATION_002_SQL);
  const keyStore = new ApiKeyStore(db);
  const sessionStore = new SessionStore(db);
  return { db, keyStore, sessionStore };
}

function makeReqWithCookie(sid: string): Request {
  return new Request("http://localhost/api/docs", {
    headers: { Cookie: `lore_sid=${sid}` },
  });
}

// ─── resolve() rejects revoked-key sessions ────────────────────────────────────

describe("SessionStore.resolve — revoked api_key", () => {
  let db: Database;
  let keyStore: ApiKeyStore;
  let sessionStore: SessionStore;

  beforeEach(() => {
    const stores = makeStores();
    db = stores.db;
    keyStore = stores.keyStore;
    sessionStore = stores.sessionStore;
  });

  describe("negative cases", () => {
    it("returns null for a session whose backing api_key has been revoked", async () => {
      const createResult = await keyStore.create("revoke-target", "owner");
      if (!createResult.ok) throw new Error("expected ok");
      const { session_id } = sessionStore.create("revoke-target");

      // Sanity: resolves fine before revoke.
      expect(sessionStore.resolve(session_id)).not.toBeNull();

      const revokeResult = keyStore.revoke("revoke-target");
      expect(revokeResult.ok).toBe(true);

      expect(sessionStore.resolve(session_id)).toBeNull();
    });
  });

  describe("boundary values", () => {
    it("returns null when the api_keys row is entirely missing (not merely revoked)", () => {
      // No matching api_keys row for "orphan-key" at all.
      const { session_id } = sessionStore.create("orphan-key");
      expect(sessionStore.resolve(session_id)).toBeNull();
    });
  });

  describe("happy path (regression)", () => {
    it("still resolves a valid session for a NON-revoked key", async () => {
      const createResult = await keyStore.create("still-active", "owner");
      if (!createResult.ok) throw new Error("expected ok");
      const { session_id } = sessionStore.create("still-active");

      const session = sessionStore.resolve(session_id);
      expect(session).not.toBeNull();
      expect(session!.name).toBe("still-active");
      expect(session!.owner).toBe("owner");
    });
  });

  describe("state transitions", () => {
    it("ApiKeyStore.revoke() cascade-deletes the revoked key's session row", async () => {
      const createResult = await keyStore.create("cascade-target", "owner");
      if (!createResult.ok) throw new Error("expected ok");
      const { session_id } = sessionStore.create("cascade-target");

      const rowBefore = db.prepare("SELECT session_id FROM sessions WHERE session_id = ?").get(session_id);
      expect(rowBefore).not.toBeNull();

      keyStore.revoke("cascade-target");

      const rowAfter = db.prepare("SELECT session_id FROM sessions WHERE session_id = ?").get(session_id);
      expect(rowAfter).toBeNull();
    });

    it("revoking one key does not delete another key's active session", async () => {
      const r1 = await keyStore.create("revoke-me", "owner");
      const r2 = await keyStore.create("keep-me", "owner");
      if (!r1.ok || !r2.ok) throw new Error("expected ok");
      const s1 = sessionStore.create("revoke-me");
      const s2 = sessionStore.create("keep-me");

      keyStore.revoke("revoke-me");

      expect(sessionStore.resolve(s1.session_id)).toBeNull();
      expect(sessionStore.resolve(s2.session_id)).not.toBeNull();
    });
  });

  describe("regression", () => {
    it("revoke() succeeds even when ApiKeyStore was constructed standalone (no sessions table on this db)", async () => {
      const standaloneDb = new Database(":memory:");
      standaloneDb.exec(MIGRATION_002_SQL);
      // No SessionStore ever constructed on this db — "sessions" table does not exist.
      const standaloneKeyStore = new ApiKeyStore(standaloneDb);

      const createResult = await standaloneKeyStore.create("standalone-agent", "owner");
      if (!createResult.ok) throw new Error("expected ok");

      const revokeResult = standaloneKeyStore.revoke("standalone-agent");
      expect(revokeResult.ok).toBe(true);
    });
  });
});

// ─── touch() cannot revive a revoked-key session ───────────────────────────────

describe("SessionStore.touch — revoked api_key", () => {
  let db: Database;
  let keyStore: ApiKeyStore;
  let sessionStore: SessionStore;

  beforeEach(() => {
    const stores = makeStores();
    db = stores.db;
    keyStore = stores.keyStore;
    sessionStore = stores.sessionStore;
  });

  describe("negative cases", () => {
    it("does not extend expires_at for a session row whose key is revoked but the row itself was NOT cascade-deleted", async () => {
      const createResult = await keyStore.create("stale-row-agent", "owner");
      if (!createResult.ok) throw new Error("expected ok");
      const { session_id, expires_at: originalExpiry } = sessionStore.create("stale-row-agent");

      // Mark the key revoked directly (bypass ApiKeyStore.revoke's cascade) to simulate a
      // stale session row that somehow survived revocation — exercises touch()'s OWN guard,
      // independent of the cascade delete.
      db.prepare("UPDATE api_keys SET revoked_at = ? WHERE name = ?").run(new Date().toISOString(), "stale-row-agent");

      sessionStore.touch(session_id);

      const row = db.prepare("SELECT expires_at FROM sessions WHERE session_id = ?").get(session_id) as { expires_at: string } | null;
      expect(row).not.toBeNull();
      expect(row!.expires_at).toBe(originalExpiry);

      // And resolve() still rejects it regardless.
      expect(sessionStore.resolve(session_id)).toBeNull();
    });
  });

  describe("happy path (regression)", () => {
    it("still extends expires_at for a session backed by a NON-revoked key", async () => {
      const createResult = await keyStore.create("touch-happy-agent", "owner");
      if (!createResult.ok) throw new Error("expected ok");
      const { session_id, expires_at: original } = sessionStore.create("touch-happy-agent");

      await new Promise<void>((r) => setTimeout(r, 10));
      sessionStore.touch(session_id);

      const row = db.prepare("SELECT expires_at FROM sessions WHERE session_id = ?").get(session_id) as { expires_at: string };
      expect(new Date(row.expires_at).getTime()).toBeGreaterThan(new Date(original).getTime());
    });
  });
});

// ─── authenticateRequest (cookie path) rejects revoked-key sessions ────────────

describe("authenticateRequest — revoked api_key session", () => {
  let keyStore: ApiKeyStore;
  let sessionStore: SessionStore;

  beforeEach(() => {
    const stores = makeStores();
    keyStore = stores.keyStore;
    sessionStore = stores.sessionStore;
  });

  describe("negative cases", () => {
    it("rejects a cookie session backed by a revoked key", async () => {
      const createResult = await keyStore.create("auth-revoke-agent", "owner");
      if (!createResult.ok) throw new Error("expected ok");
      const { session_id } = sessionStore.create("auth-revoke-agent");

      keyStore.revoke("auth-revoke-agent");

      const req = makeReqWithCookie(session_id);
      const result = await authenticateRequest(req, keyStore, sessionStore);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected error");
      expect(result.error.code).toBe("VALIDATION_ERROR");
      if (result.error.code !== "VALIDATION_ERROR") throw new Error("wrong code");
      expect(result.error.field).toBe("Cookie");
    });
  });

  describe("happy path (regression)", () => {
    it("still authenticates a cookie session backed by a NON-revoked key", async () => {
      const createResult = await keyStore.create("auth-active-agent", "owner");
      if (!createResult.ok) throw new Error("expected ok");
      const { session_id } = sessionStore.create("auth-active-agent");

      const req = makeReqWithCookie(session_id);
      const result = await authenticateRequest(req, keyStore, sessionStore);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok");
      expect(result.value.name).toBe("auth-active-agent");
    });
  });
});
