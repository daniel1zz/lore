/**
 * Tests for cookie-first auth path in authenticateRequest.
 * Source: SPEC-016 §3.3
 *
 * Test plan (6-dimension):
 *   HAPPY:
 *     - lore_sid cookie present + valid session → ActorContext with name/session_id/owner/expires_at
 *     - bearer token (no cookie) → ActorContext via existing bearer path (REGRESSION)
 *
 *   NEGATIVE:
 *     - lore_sid cookie present but session not found → VALIDATION_ERROR field=Cookie
 *     - lore_sid cookie present but session expired → VALIDATION_ERROR + session row deleted
 *     - disallowed Origin for bootstrap → not tested here (see auth-routes.bun.test.ts)
 *     - missing cookie AND missing bearer → VALIDATION_ERROR field=Authorization
 *     - malformed cookie header (no lore_sid) → falls through to bearer path
 *
 *   BOUNDARY:
 *     - extractSessionCookie returns null for missing Cookie header
 *     - extractSessionCookie returns null when cookie name doesn't match
 *     - extractSessionCookie handles multiple cookies in one header
 *     - sessionStore=undefined → cookie path skipped, bearer path used
 *
 *   ERROR:
 *     - n/a: bun:sqlite in-memory does not simulate connection failure
 *
 *   STATE (AC-A-B10):
 *     - valid cookie → touch() called → expires_at extended
 *
 *   REGRESSION (AC-A-B7):
 *     - bearer token still works when no cookie present (no regression for CLI/MCP consumers)
 *     - existing bearer tests still pass with sessionStore=undefined (backward compat)
 *
 * @spec_ref AC-A-B5, AC-A-B6, AC-A-B7, AC-A-B10
 */

import { beforeEach, describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import {
  ApiKeyStore,
  authenticateRequest,
  extractSessionCookie,
  generateApiKey,
} from "../../../../src/adapters/http/auth.js";
import { SessionStore } from "../../../../src/adapters/http/sessions.js";
import { MIGRATION_002_SQL } from "../../../../src/store/migrations/migration-002.js";

// ─── Setup ────────────────────────────────────────────────────────────────────

function makeStores(): { db: Database; keyStore: ApiKeyStore; sessionStore: SessionStore } {
  const db = new Database(":memory:");
  db.exec(MIGRATION_002_SQL);
  const keyStore = new ApiKeyStore(db);
  const sessionStore = new SessionStore(db);
  return { db, keyStore, sessionStore };
}

function makeReqWithCookie(sid: string, extraHeaders: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/docs", {
    headers: { Cookie: `lore_sid=${sid}`, ...extraHeaders },
  });
}

function makeReqWithBearer(token: string): Request {
  return new Request("http://localhost/api/docs", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

function makeReqNoCreds(): Request {
  return new Request("http://localhost/api/docs", {});
}

// ─── extractSessionCookie ────────────────────────────────────────────────────

describe("extractSessionCookie", () => {
  describe("happy path", () => {
    it("extracts lore_sid from a single-cookie header", () => {
      const req = makeReqWithCookie("abc123");
      expect(extractSessionCookie(req)).toBe("abc123");
    });

    it("extracts lore_sid from a multi-cookie header", () => {
      const req = new Request("http://localhost/", {
        headers: { Cookie: "other=value; lore_sid=mysid; another=x" },
      });
      expect(extractSessionCookie(req)).toBe("mysid");
    });
  });

  describe("negative cases", () => {
    it("returns null when Cookie header is absent", () => {
      const req = new Request("http://localhost/", {});
      expect(extractSessionCookie(req)).toBeNull();
    });

    it("returns null when lore_sid is not in the cookie header", () => {
      const req = new Request("http://localhost/", {
        headers: { Cookie: "other=value; something=else" },
      });
      expect(extractSessionCookie(req)).toBeNull();
    });
  });

  describe("boundary values", () => {
    it("handles cookie value containing '='", () => {
      const req = new Request("http://localhost/", {
        headers: { Cookie: "lore_sid=a=b=c" },
      });
      expect(extractSessionCookie(req)).toBe("a=b=c");
    });

    it("trims whitespace around cookie name and value", () => {
      const req = new Request("http://localhost/", {
        headers: { Cookie: "  lore_sid = trimmed  " },
      });
      expect(extractSessionCookie(req)).toBe("trimmed");
    });
  });
});

// ─── authenticateRequest (cookie path) ────────────────────────────────────────

describe("authenticateRequest — cookie-first path", () => {
  let keyStore: ApiKeyStore;
  let sessionStore: SessionStore;

  beforeEach(() => {
    const stores = makeStores();
    keyStore = stores.keyStore;
    sessionStore = stores.sessionStore;
  });

  describe("happy path (AC-A-B5)", () => {
    it("returns ActorContext with name/session_id/owner/expires_at for valid cookie", async () => {
      // reason: resolve() now requires a matching, non-revoked api_keys row (hardening fix,
      // see session-revocation.bun.test.ts) — mint the backing key before the session.
      const createResult = await keyStore.create("dashboard-local", "owner");
      if (!createResult.ok) throw new Error("expected ok");
      const { session_id } = sessionStore.create("dashboard-local");
      const req = makeReqWithCookie(session_id);
      const result = await authenticateRequest(req, keyStore, sessionStore);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok");
      expect(result.value.name).toBe("dashboard-local");
      expect(result.value.session_id).toBe(session_id);
      expect(typeof result.value.owner).toBe("string");
      expect(typeof result.value.expires_at).toBe("string");
    });
  });

  describe("negative cases", () => {
    it("returns VALIDATION_ERROR field=Cookie for unknown session_id", async () => {
      const req = makeReqWithCookie("0".repeat(32));
      const result = await authenticateRequest(req, keyStore, sessionStore);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected error");
      expect(result.error.code).toBe("VALIDATION_ERROR");
      if (result.error.code !== "VALIDATION_ERROR") throw new Error("wrong code");
      expect(result.error.field).toBe("Cookie");
    });

    it("returns VALIDATION_ERROR and deletes row for expired session (AC-A-B6)", async () => {
      // reason: resolve() must succeed (so authenticateRequest reaches its OWN expiry check
      // and deletes the row) — needs a matching, non-revoked api_keys row, see
      // session-revocation.bun.test.ts. Without it, resolve() would reject for "no matching
      // key" instead, and the explicit expiry-delete branch under test would never run.
      const createResult = await keyStore.create("dashboard-local", "owner");
      if (!createResult.ok) throw new Error("expected ok");

      // Insert session with past expires_at directly
      const db = (sessionStore as unknown as { db: Database }).db;
      const past = new Date(Date.now() - 1000).toISOString();
      const now = new Date().toISOString();
      const sid = "expired0000000000000000000000000";
      db.prepare(
        "INSERT INTO sessions (session_id, api_key_name, created_at, expires_at, last_used_at) VALUES (?, ?, ?, ?, ?)",
      ).run(sid, "dashboard-local", now, past, now);

      const req = makeReqWithCookie(sid);

      return authenticateRequest(req, keyStore, sessionStore).then((result) => {
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error("expected error");
        expect(result.error.code).toBe("VALIDATION_ERROR");

        // Session row must be deleted
        const row = db.prepare("SELECT session_id FROM sessions WHERE session_id = ?").get(sid);
        expect(row).toBeNull();
      });
    });

    it("falls through to bearer path when cookie is absent (no lore_sid)", async () => {
      const createResult = await keyStore.create("bearer-agent", "owner");
      if (!createResult.ok) throw new Error("expected ok");
      const req = makeReqWithBearer(createResult.value.rawKey);
      const result = await authenticateRequest(req, keyStore, sessionStore);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok");
      expect(result.value.name).toBe("bearer-agent");
    });

    it("returns VALIDATION_ERROR field=Authorization when neither cookie nor bearer present", async () => {
      const req = makeReqNoCreds();
      const result = await authenticateRequest(req, keyStore, sessionStore);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected error");
      expect(result.error.code).toBe("VALIDATION_ERROR");
      if (result.error.code !== "VALIDATION_ERROR") throw new Error("wrong code");
      expect(result.error.field).toBe("Authorization");
    });
  });

  describe("boundary values", () => {
    it("skips cookie path when sessionStore is undefined (backward compat)", async () => {
      const createResult = await keyStore.create("compat-agent", "owner");
      if (!createResult.ok) throw new Error("expected ok");
      // No sessionStore — bearer path only
      const req = makeReqWithBearer(createResult.value.rawKey);
      const result = await authenticateRequest(req, keyStore, undefined);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok");
      expect(result.value.name).toBe("compat-agent");
    });

    it("non-lore_sid cookie in header falls through to bearer path", async () => {
      const createResult = await keyStore.create("bearer-only-agent", "owner");
      if (!createResult.ok) throw new Error("expected ok");
      const req = new Request("http://localhost/api/docs", {
        headers: {
          Cookie: "other_cookie=ignored",
          Authorization: `Bearer ${createResult.value.rawKey}`,
        },
      });
      const result = await authenticateRequest(req, keyStore, sessionStore);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok");
      expect(result.value.name).toBe("bearer-only-agent");
    });
  });

  describe("state transitions (AC-A-B10)", () => {
    it("touch is called on valid cookie — expires_at is updated", async () => {
      // reason: resolve()/touch() now require a matching, non-revoked api_keys row
      // (hardening fix, see session-revocation.bun.test.ts).
      const createResult = await keyStore.create("dashboard-local", "owner");
      if (!createResult.ok) throw new Error("expected ok");
      const { session_id, expires_at: original } = sessionStore.create("dashboard-local");
      const req = makeReqWithCookie(session_id);

      // Wait 10ms so the renewed expires_at is measurably later
      await new Promise<void>((r) => setTimeout(r, 10));

      await authenticateRequest(req, keyStore, sessionStore);

      const renewed = sessionStore.resolve(session_id);
      expect(renewed).not.toBeNull();
      const renewedMs = new Date(renewed!.expires_at).getTime();
      const originalMs = new Date(original).getTime();
      expect(renewedMs).toBeGreaterThan(originalMs);
    });
  });

  describe("regression (AC-A-B7)", () => {
    it("bearer token still authenticates when no cookie is present", async () => {
      const createResult = await keyStore.create("regression-bearer", "owner");
      if (!createResult.ok) throw new Error("expected ok");
      const req = makeReqWithBearer(createResult.value.rawKey);
      const result = await authenticateRequest(req, keyStore, sessionStore);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok");
      expect(result.value.name).toBe("regression-bearer");
    });

    it("bearer token works with sessionStore=undefined (existing CLI/MCP pattern)", async () => {
      const createResult = await keyStore.create("cli-agent", "owner");
      if (!createResult.ok) throw new Error("expected ok");
      const req = makeReqWithBearer(createResult.value.rawKey);
      const result = await authenticateRequest(req, keyStore, undefined);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok");
      expect(result.value.name).toBe("cli-agent");
    });
  });
});

// ─── ALLOWED_ORIGINS (exported constant) ──────────────────────────────────────

describe("ALLOWED_ORIGINS", () => {
  it("contains http://localhost:5173", async () => {
    const { ALLOWED_ORIGINS } = await import("../../../../src/adapters/http/auth.js");
    expect(ALLOWED_ORIGINS).toContain("http://localhost:5173");
  });

  it("contains http://localhost:8787", async () => {
    const { ALLOWED_ORIGINS } = await import("../../../../src/adapters/http/auth.js");
    expect(ALLOWED_ORIGINS).toContain("http://localhost:8787");
  });

  it("contains 127.0.0.1 variants", async () => {
    const { ALLOWED_ORIGINS } = await import("../../../../src/adapters/http/auth.js");
    expect(ALLOWED_ORIGINS).toContain("http://127.0.0.1:5173");
    expect(ALLOWED_ORIGINS).toContain("http://127.0.0.1:8787");
  });
});
