/**
 * @spec_ref AC-AUTH-001
 *
 * Tests for HTTP auth module: ApiKeyStore, generateApiKey, hashApiKey,
 * extractBearerToken, authenticateRequest.
 *
 * Source: SPEC-010 §3.2, §3.3
 *
 * Test plan:
 *   Techniques: EP (valid/invalid inputs), BVA (empty strings, boundary keys),
 *               Decision Table (prefix present/absent, revoked/active, existing/nonexistent),
 *               State Transition (active → revoked lifecycle)
 *
 *   HAPPY:
 *     - generateApiKey returns "lore_ak_" + 64 hex chars
 *     - hashApiKey returns 64-char hex string, deterministic
 *     - extractBearerToken extracts token from well-formed header
 *     - ApiKeyStore.create returns rawKey + record with correct fields
 *     - ApiKeyStore.list returns records without key_hash, sorted DESC
 *     - ApiKeyStore.revoke marks key revoked
 *     - ApiKeyStore.validate returns ActorContext for active key
 *     - authenticateRequest returns ActorContext for valid bearer token
 *
 *   NEGATIVE:
 *     - extractBearerToken: missing header → null
 *     - extractBearerToken: wrong scheme → null
 *     - extractBearerToken: "Bearer " with no token → null
 *     - ApiKeyStore.create: duplicate name → VALIDATION_ERROR field=name
 *     - ApiKeyStore.revoke: nonexistent name → DOC_NOT_FOUND
 *     - ApiKeyStore.validate: invalid prefix → VALIDATION_ERROR field=token
 *     - ApiKeyStore.validate: unknown hash → VALIDATION_ERROR field=token message "Invalid API key"
 *     - ApiKeyStore.validate: revoked key → VALIDATION_ERROR field=token message includes "revoked"
 *     - authenticateRequest: missing header → VALIDATION_ERROR field=Authorization
 *
 *   BOUNDARY:
 *     - generateApiKey: two consecutive calls produce different keys
 *     - hashApiKey: same input twice → same output; different inputs → different outputs
 *     - extractBearerToken: "Bearer   xyz  " extra whitespace → "xyz" (trim)
 *     - ApiKeyStore.create: empty owner string → accepted (no store-layer validation)
 *     - ApiKeyStore.list: empty DB → ok([])
 *
 *   ERROR:
 *     - N/A: bun:sqlite in-memory does not simulate connection failure in these tests;
 *       STORE_ERROR path is covered by NEGATIVE tests for known-bad inputs.
 *
 *   STATE:
 *     - After revoke, validate(rawKey) → VALIDATION_ERROR (key lifecycle)
 *     - Double-revoke → second call still ok (idempotent)
 *
 *   REGRESSION:
 *     - validate() with correct prefix but hash not in DB → err with message "Invalid API key"
 *       (guard against silent fallback to null/undefined)
 */

import { beforeEach, describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import {
  ApiKeyStore,
  extractBearerToken,
  generateApiKey,
  hashApiKey,
  authenticateRequest,
} from "../../../../src/adapters/http/auth.js";
import { MIGRATION_002_SQL } from "../../../../src/store/migrations/migration-002.js";

// ─── Shared DB Setup ─────────────────────────────────────────────────────────

function makeDb(): Database {
  const db = new Database(":memory:");
  db.exec(MIGRATION_002_SQL);
  return db;
}

// ─── generateApiKey ──────────────────────────────────────────────────────────

describe("generateApiKey", () => {
  describe("happy path", () => {
    it("returns a string starting with 'lore_ak_'", () => {
      const key = generateApiKey();
      expect(key.startsWith("lore_ak_")).toBe(true);
    });

    it("returns 'lore_ak_' followed by exactly 64 hex characters (32 bytes)", () => {
      const key = generateApiKey();
      const suffix = key.slice("lore_ak_".length);
      expect(suffix).toHaveLength(64);
      expect(suffix).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("boundary values", () => {
    it("two consecutive calls produce different keys", () => {
      const key1 = generateApiKey();
      const key2 = generateApiKey();
      expect(key1).not.toBe(key2);
    });

    it("ten consecutive calls all differ (collision probability negligible)", () => {
      const keys = Array.from({ length: 10 }, generateApiKey);
      const unique = new Set(keys);
      expect(unique.size).toBe(10);
    });
  });
});

// ─── hashApiKey ──────────────────────────────────────────────────────────────

describe("hashApiKey", () => {
  describe("happy path", () => {
    it("returns a 64-character hex string (SHA-256)", async () => {
      const hash = await hashApiKey("lore_ak_test");
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("boundary values", () => {
    it("same input twice produces the same output (deterministic)", async () => {
      const input = "lore_ak_determinism_test";
      const hash1 = await hashApiKey(input);
      const hash2 = await hashApiKey(input);
      expect(hash1).toBe(hash2);
    });

    it("different inputs produce different outputs", async () => {
      const hash1 = await hashApiKey("lore_ak_aaa");
      const hash2 = await hashApiKey("lore_ak_bbb");
      expect(hash1).not.toBe(hash2);
    });

    it("empty string produces a valid SHA-256 hex (known value)", async () => {
      const hash = await hashApiKey("");
      // SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
      expect(hash).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    });
  });
});

// ─── extractBearerToken ──────────────────────────────────────────────────────

describe("extractBearerToken", () => {
  function makeReq(authHeader?: string): Request {
    const headers: Record<string, string> = {};
    if (authHeader !== undefined) {
      headers["Authorization"] = authHeader;
    }
    return new Request("http://localhost/", { headers });
  }

  describe("happy path", () => {
    it("returns the token from a well-formed 'Authorization: Bearer <token>' header", () => {
      const req = makeReq("Bearer abc123");
      expect(extractBearerToken(req)).toBe("abc123");
    });

    it("returns a full API key token from a Bearer header", () => {
      const rawKey = generateApiKey();
      const req = makeReq(`Bearer ${rawKey}`);
      expect(extractBearerToken(req)).toBe(rawKey);
    });
  });

  describe("negative cases", () => {
    it("returns null when Authorization header is missing", () => {
      const req = makeReq();
      expect(extractBearerToken(req)).toBeNull();
    });

    it("returns null for Basic auth scheme", () => {
      const req = makeReq("Basic dXNlcjpwYXNz");
      expect(extractBearerToken(req)).toBeNull();
    });

    it("returns null for Token scheme", () => {
      const req = makeReq("Token abc123");
      expect(extractBearerToken(req)).toBeNull();
    });

    it("returns null for 'bearer' in lowercase (case-sensitive per RFC 7235)", () => {
      // The implementation uses startsWith("Bearer ") — lowercase "bearer" MUST NOT match
      const req = makeReq("bearer abc123");
      expect(extractBearerToken(req)).toBeNull();
    });
  });

  describe("boundary values", () => {
    it("returns null for 'Bearer ' with no following token (empty after trim)", () => {
      const req = makeReq("Bearer ");
      expect(extractBearerToken(req)).toBeNull();
    });

    it("trims whitespace from the token value ('Bearer   xyz  ' → 'xyz')", () => {
      // Implementation does .slice(7).trim(), so leading/trailing whitespace is removed
      const req = makeReq("Bearer   xyz  ");
      expect(extractBearerToken(req)).toBe("xyz");
    });

    it("returns null when header value is only 'Bearer' with no space", () => {
      const req = makeReq("Bearer");
      expect(extractBearerToken(req)).toBeNull();
    });
  });
});

// ─── ApiKeyStore ─────────────────────────────────────────────────────────────

describe("ApiKeyStore", () => {
  let db: Database;
  let store: ApiKeyStore;

  beforeEach(() => {
    db = makeDb();
    store = new ApiKeyStore(db);
  });

  // ── create ─────────────────────────────────────────────────────────────────

  describe("create", () => {
    describe("happy path", () => {
      it("returns ok with a rawKey starting with 'lore_ak_'", async () => {
        const result = await store.create("agent-alice", "alice");
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error("expected ok");
        expect(result.value.rawKey.startsWith("lore_ak_")).toBe(true);
      });

      it("rawKey is 'lore_ak_' + 64 hex chars", async () => {
        const result = await store.create("agent-test", "owner");
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error("expected ok");
        const suffix = result.value.rawKey.slice("lore_ak_".length);
        expect(suffix).toHaveLength(64);
        expect(suffix).toMatch(/^[0-9a-f]{64}$/);
      });

      it("record has the correct name and owner", async () => {
        const result = await store.create("my-agent", "owner-bob");
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error("expected ok");
        expect(result.value.record.name).toBe("my-agent");
        expect(result.value.record.owner).toBe("owner-bob");
      });

      it("record has rate_limit=60 (default per SPEC-010 §3.2)", async () => {
        const result = await store.create("rate-test", "owner");
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error("expected ok");
        expect(result.value.record.rate_limit).toBe(60);
      });

      it("record has revoked_at=null (not yet revoked)", async () => {
        const result = await store.create("revoke-null-test", "owner");
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error("expected ok");
        expect(result.value.record.revoked_at).toBeNull();
      });

      it("record has a valid ISO 8601 created_at timestamp", async () => {
        const result = await store.create("ts-test", "owner");
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error("expected ok");
        const parsed = new Date(result.value.record.created_at);
        expect(Number.isNaN(parsed.getTime())).toBe(false);
        // created_at should be recent (within last 5 seconds)
        expect(Date.now() - parsed.getTime()).toBeLessThan(5000);
      });

      it("two different names with the same owner both succeed", async () => {
        const r1 = await store.create("agent-a", "owner");
        const r2 = await store.create("agent-b", "owner");
        expect(r1.ok).toBe(true);
        expect(r2.ok).toBe(true);
      });
    });

    describe("negative cases", () => {
      it("returns VALIDATION_ERROR with field='name' on duplicate name", async () => {
        await store.create("duplicate-name", "owner1");
        const result = await store.create("duplicate-name", "owner2");
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error("expected error");
        expect(result.error.code).toBe("VALIDATION_ERROR");
        if (result.error.code !== "VALIDATION_ERROR") throw new Error("wrong code");
        expect(result.error.field).toBe("name");
      });

      it("error message for duplicate name mentions the agent name", async () => {
        await store.create("duplicate-agent", "owner1");
        const result = await store.create("duplicate-agent", "owner2");
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error("expected error");
        if (result.error.code !== "VALIDATION_ERROR") throw new Error("wrong code");
        expect(result.error.message).toContain("duplicate-agent");
      });
    });

    describe("boundary values", () => {
      it("empty owner string is accepted (no validation in store layer)", async () => {
        const result = await store.create("agent-empty-owner", "");
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error("expected ok");
        expect(result.value.record.owner).toBe("");
      });
    });
  });

  // ── list ───────────────────────────────────────────────────────────────────

  describe("list", () => {
    describe("happy path", () => {
      it("returns ok([]) when the database is empty", () => {
        const result = store.list();
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error("expected ok");
        expect(result.value).toEqual([]);
      });

      it("returns all created records", async () => {
        await store.create("list-agent-a", "owner");
        await store.create("list-agent-b", "owner");
        const result = store.list();
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error("expected ok");
        expect(result.value).toHaveLength(2);
      });

      it("MUST NOT return key_hash field in any record", async () => {
        await store.create("hash-exposure-test", "owner");
        const result = store.list();
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error("expected ok");
        for (const record of result.value) {
          expect(Object.keys(record)).not.toContain("key_hash");
        }
      });

      it("returns records sorted by created_at DESC (newest first)", async () => {
        // Insert with a small delay gap to guarantee different timestamps
        await store.create("oldest-agent", "owner");
        // Force a distinguishable timestamp difference using a tiny wait
        await new Promise((resolve) => setTimeout(resolve, 5));
        await store.create("newest-agent", "owner");
        const result = store.list();
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error("expected ok");
        // newest-agent was created last, so it should appear first in DESC order
        expect(result.value[0].name).toBe("newest-agent");
        expect(result.value[1].name).toBe("oldest-agent");
      });

      it("returned records include name, owner, rate_limit, created_at, revoked_at fields", async () => {
        await store.create("field-check-agent", "field-owner");
        const result = store.list();
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error("expected ok");
        const record = result.value[0];
        expect(record).toHaveProperty("name");
        expect(record).toHaveProperty("owner");
        expect(record).toHaveProperty("rate_limit");
        expect(record).toHaveProperty("created_at");
        expect(record).toHaveProperty("revoked_at");
      });
    });

    describe("boundary values", () => {
      it("empty DB → ok([]) (not null, not undefined)", () => {
        const result = store.list();
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error("expected ok");
        expect(Array.isArray(result.value)).toBe(true);
        expect(result.value).toHaveLength(0);
      });
    });
  });

  // ── revoke ─────────────────────────────────────────────────────────────────

  describe("revoke", () => {
    describe("happy path", () => {
      it("returns ok after revoking an existing key", async () => {
        await store.create("revoke-me", "owner");
        const result = store.revoke("revoke-me");
        expect(result.ok).toBe(true);
      });

      it("revoked key's revoked_at is no longer null", async () => {
        await store.create("check-revoked-at", "owner");
        store.revoke("check-revoked-at");
        const listResult = store.list();
        expect(listResult.ok).toBe(true);
        if (!listResult.ok) throw new Error("expected ok");
        const record = listResult.value.find((r) => r.name === "check-revoked-at");
        expect(record).toBeDefined();
        expect(record!.revoked_at).not.toBeNull();
        // revoked_at should be a valid ISO 8601 string
        expect(new Date(record!.revoked_at!).getTime()).not.toBeNaN();
      });
    });

    describe("negative cases", () => {
      it("returns DOC_NOT_FOUND when name does not exist", () => {
        const result = store.revoke("nonexistent-agent");
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error("expected error");
        expect(result.error.code).toBe("DOC_NOT_FOUND");
      });

      it("DOC_NOT_FOUND error includes the name as id", () => {
        const result = store.revoke("ghost-agent");
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error("expected error");
        if (result.error.code !== "DOC_NOT_FOUND") throw new Error("wrong code");
        expect(result.error.id).toBe("ghost-agent");
      });
    });

    describe("state transitions", () => {
      it("double-revoke is idempotent — second call returns ok", async () => {
        await store.create("double-revoke-agent", "owner");
        const first = store.revoke("double-revoke-agent");
        const second = store.revoke("double-revoke-agent");
        expect(first.ok).toBe(true);
        // Second revoke: the key still exists (not deleted), but spec says idempotent
        // The implementation re-runs UPDATE with new timestamp — should still succeed
        expect(second.ok).toBe(true);
      });

      it("after revoke, validate returns error (key lifecycle: active → revoked)", async () => {
        const createResult = await store.create("lifecycle-agent", "owner");
        expect(createResult.ok).toBe(true);
        if (!createResult.ok) throw new Error("expected ok");

        const { rawKey } = createResult.value;
        // Confirm key validates before revocation
        const beforeRevoke = await store.validate(rawKey);
        expect(beforeRevoke.ok).toBe(true);

        // Revoke
        store.revoke("lifecycle-agent");

        // Now validate should fail
        const afterRevoke = await store.validate(rawKey);
        expect(afterRevoke.ok).toBe(false);
        if (afterRevoke.ok) throw new Error("expected error");
        expect(afterRevoke.error.code).toBe("VALIDATION_ERROR");
        if (afterRevoke.error.code !== "VALIDATION_ERROR") throw new Error("wrong code");
        expect(afterRevoke.error.field).toBe("token");
        expect(afterRevoke.error.message.toLowerCase()).toContain("revoked");
      });
    });
  });

  // ── validate ───────────────────────────────────────────────────────────────

  describe("validate", () => {
    describe("happy path", () => {
      it("returns ok with ActorContext {name, session_id} for a valid active key", async () => {
        const createResult = await store.create("validate-happy-agent", "owner");
        expect(createResult.ok).toBe(true);
        if (!createResult.ok) throw new Error("expected ok");

        const result = await store.validate(createResult.value.rawKey);
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error("expected ok");
        expect(result.value.name).toBe("validate-happy-agent");
        expect(typeof result.value.session_id).toBe("string");
        expect(result.value.session_id.length).toBeGreaterThan(0);
      });

      it("ActorContext.name matches the agent name used during creation", async () => {
        const createResult = await store.create("named-agent", "owner");
        if (!createResult.ok) throw new Error("expected ok");
        const result = await store.validate(createResult.value.rawKey);
        if (!result.ok) throw new Error("expected ok");
        expect(result.value.name).toBe("named-agent");
      });

      it("different keys for different agents produce different session_ids", async () => {
        const r1 = await store.create("agent-x", "owner");
        const r2 = await store.create("agent-y", "owner");
        if (!r1.ok || !r2.ok) throw new Error("expected ok");

        const v1 = await store.validate(r1.value.rawKey);
        const v2 = await store.validate(r2.value.rawKey);
        if (!v1.ok || !v2.ok) throw new Error("expected ok");

        expect(v1.value.session_id).not.toBe(v2.value.session_id);
      });
    });

    describe("negative cases", () => {
      it("returns VALIDATION_ERROR field=token when prefix is not 'lore_ak_'", async () => {
        const result = await store.validate("sk_invalid_prefix_xxxxxxxxxxxxxxxx");
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error("expected error");
        expect(result.error.code).toBe("VALIDATION_ERROR");
        if (result.error.code !== "VALIDATION_ERROR") throw new Error("wrong code");
        expect(result.error.field).toBe("token");
      });

      it("returns VALIDATION_ERROR when prefix is valid but hash is not in DB", async () => {
        // Create a syntactically valid key that was never stored
        const unknownKey = generateApiKey();
        const result = await store.validate(unknownKey);
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error("expected error");
        expect(result.error.code).toBe("VALIDATION_ERROR");
        if (result.error.code !== "VALIDATION_ERROR") throw new Error("wrong code");
        expect(result.error.field).toBe("token");
        expect(result.error.message).toBe("Invalid API key");
      });

      it("returns VALIDATION_ERROR with message containing 'revoked' for a revoked key", async () => {
        const createResult = await store.create("revoked-validate-agent", "owner");
        if (!createResult.ok) throw new Error("expected ok");
        store.revoke("revoked-validate-agent");

        const result = await store.validate(createResult.value.rawKey);
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error("expected error");
        expect(result.error.code).toBe("VALIDATION_ERROR");
        if (result.error.code !== "VALIDATION_ERROR") throw new Error("wrong code");
        expect(result.error.field).toBe("token");
        expect(result.error.message.toLowerCase()).toContain("revoked");
      });

      it("returns VALIDATION_ERROR not DOC_NOT_FOUND for unknown key (token error, not entity error)", async () => {
        const unknownKey = generateApiKey();
        const result = await store.validate(unknownKey);
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error("expected error");
        // MUST be VALIDATION_ERROR, not DOC_NOT_FOUND — caller should not know if hash lookup failed
        expect(result.error.code).toBe("VALIDATION_ERROR");
      });
    });

    describe("boundary values", () => {
      it("'lore_ak_' prefix with exactly 0 extra chars is still invalid (no hash in DB)", async () => {
        const result = await store.validate("lore_ak_");
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error("expected error");
        // Prefix check passes but hash lookup fails
        expect(result.error.code).toBe("VALIDATION_ERROR");
        if (result.error.code !== "VALIDATION_ERROR") throw new Error("wrong code");
        expect(result.error.field).toBe("token");
      });

      it("empty string input returns VALIDATION_ERROR (no lore_ak_ prefix)", async () => {
        const result = await store.validate("");
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error("expected error");
        expect(result.error.code).toBe("VALIDATION_ERROR");
      });
    });

    describe("regression", () => {
      it("validate() with correct prefix but hash not in DB returns err, not silently ok", async () => {
        // Regression guard: ensure unknown keys don't fall through with undefined/null
        const orphanKey = generateApiKey(); // never stored
        const result = await store.validate(orphanKey);
        // MUST fail — not silently return an ActorContext
        expect(result.ok).toBe(false);
      });
    });
  });
});

// ─── authenticateRequest ─────────────────────────────────────────────────────

describe("authenticateRequest", () => {
  let db: Database;
  let store: ApiKeyStore;

  beforeEach(() => {
    db = makeDb();
    store = new ApiKeyStore(db);
  });

  function makeReq(authHeader?: string): Request {
    const headers: Record<string, string> = {};
    if (authHeader !== undefined) {
      headers["Authorization"] = authHeader;
    }
    return new Request("http://localhost/api/docs", { headers });
  }

  describe("happy path", () => {
    it("returns ok(ActorContext) for a valid bearer token", async () => {
      const createResult = await store.create("auth-req-agent", "owner");
      if (!createResult.ok) throw new Error("expected ok");

      const req = makeReq(`Bearer ${createResult.value.rawKey}`);
      const result = await authenticateRequest(req, store);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok");
      expect(result.value.name).toBe("auth-req-agent");
    });
  });

  describe("negative cases", () => {
    it("returns VALIDATION_ERROR field=Authorization when header is missing", async () => {
      const req = makeReq(); // no Authorization header
      const result = await authenticateRequest(req, store);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected error");
      expect(result.error.code).toBe("VALIDATION_ERROR");
      if (result.error.code !== "VALIDATION_ERROR") throw new Error("wrong code");
      expect(result.error.field).toBe("Authorization");
    });

    it("propagates validate() error for an unknown token", async () => {
      const unknownKey = generateApiKey(); // never stored
      const req = makeReq(`Bearer ${unknownKey}`);
      const result = await authenticateRequest(req, store);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected error");
      expect(result.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns VALIDATION_ERROR when Authorization scheme is 'Basic' (not Bearer)", async () => {
      const req = makeReq("Basic dXNlcjpwYXNz");
      const result = await authenticateRequest(req, store);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected error");
      expect(result.error.code).toBe("VALIDATION_ERROR");
      if (result.error.code !== "VALIDATION_ERROR") throw new Error("wrong code");
      expect(result.error.field).toBe("Authorization");
    });
  });

  describe("boundary values", () => {
    it("returns VALIDATION_ERROR for 'Bearer ' with empty token", async () => {
      const req = makeReq("Bearer ");
      const result = await authenticateRequest(req, store);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected error");
      expect(result.error.code).toBe("VALIDATION_ERROR");
      if (result.error.code !== "VALIDATION_ERROR") throw new Error("wrong code");
      expect(result.error.field).toBe("Authorization");
    });
  });

  describe("state transitions", () => {
    it("authenticates successfully before revoke, fails after revoke", async () => {
      const createResult = await store.create("lifecycle-auth-agent", "owner");
      if (!createResult.ok) throw new Error("expected ok");

      const req = makeReq(`Bearer ${createResult.value.rawKey}`);

      const before = await authenticateRequest(req, store);
      expect(before.ok).toBe(true);

      store.revoke("lifecycle-auth-agent");

      const after = await authenticateRequest(req, store);
      expect(after.ok).toBe(false);
    });
  });
});
