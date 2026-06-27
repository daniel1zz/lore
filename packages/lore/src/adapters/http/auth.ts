/**
 * Simple API key auth for Phase 2 MVP.
 * Keys are SHA-256 hashed and stored in the api_keys table.
 * No Better-Auth dependency — deferred to Phase 3 when web UI exists.
 * Source: SPEC-010 §3.2, §3.3
 */

import { Database } from "bun:sqlite";
import { err, ok, type Result } from "@lore/core";
import type { LoreError } from "@lore/core";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ActorContext {
  name: string;
  session_id: string;
}

export interface ApiKeyRecord {
  key_hash: string;
  name: string;
  owner: string;
  rate_limit: number;
  created_at: string;
  revoked_at: string | null;
}

interface ApiKeyRow {
  key_hash: string;
  name: string;
  owner: string;
  rate_limit: number;
  created_at: string;
  revoked_at: string | null;
}

/** Raw key format: lore_ak_ + 32 hex chars */
const KEY_PREFIX = "lore_ak_";

// ─── Key generation ────────────────────────────────────────────────────────

/** Generate a new random API key (raw, unhashed). */
export function generateApiKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${KEY_PREFIX}${hex}`;
}

/** Hash a raw API key with SHA-256, returns hex string. */
export async function hashApiKey(rawKey: string): Promise<string> {
  const encoded = new TextEncoder().encode(rawKey);
  const buf = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

// ─── ApiKeyStore ───────────────────────────────────────────────────────────

/**
 * ApiKeyStore — manages API keys in the api_keys table.
 * Separate from StoreInterface to avoid mixing auth concerns into corpus store.
 */
export class ApiKeyStore {
  constructor(private readonly db: Database) {}

  /** Create a new API key. Returns the raw key (only time it is available). */
  async create(name: string, owner: string): Promise<Result<{ rawKey: string; record: ApiKeyRecord }, LoreError>> {
    const existing = this.db.prepare("SELECT key_hash FROM api_keys WHERE name = ?").get(name) as { key_hash: string } | null;
    if (existing !== null) {
      return err({ code: "VALIDATION_ERROR", field: "name", message: `Agent name '${name}' already exists` });
    }

    const rawKey = generateApiKey();
    const keyHash = await hashApiKey(rawKey);
    const now = new Date().toISOString();

    try {
      this.db.prepare(
        "INSERT INTO api_keys (key_hash, name, owner, rate_limit, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, NULL)"
      ).run(keyHash, name, owner, 60, now);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      return err({ code: "STORE_ERROR", message, ...(e instanceof Error ? { cause: e } : {}) });
    }

    const record: ApiKeyRecord = { key_hash: keyHash, name, owner, rate_limit: 60, created_at: now, revoked_at: null };
    return ok({ rawKey, record });
  }

  /** List all API keys (hashes never returned). */
  list(): Result<Omit<ApiKeyRecord, "key_hash">[], LoreError> {
    try {
      const rows = this.db.prepare(
        "SELECT name, owner, rate_limit, created_at, revoked_at FROM api_keys ORDER BY created_at DESC"
      ).all() as Omit<ApiKeyRow, "key_hash">[];
      return ok(rows);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      return err({ code: "STORE_ERROR", message, ...(e instanceof Error ? { cause: e } : {}) });
    }
  }

  /** Revoke an API key by name. */
  revoke(name: string): Result<void, LoreError> {
    const row = this.db.prepare("SELECT key_hash FROM api_keys WHERE name = ?").get(name) as { key_hash: string } | null;
    if (row === null) {
      return err({ code: "DOC_NOT_FOUND", id: name });
    }

    try {
      const now = new Date().toISOString();
      this.db.prepare("UPDATE api_keys SET revoked_at = ? WHERE name = ?").run(now, name);
      return ok(undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      return err({ code: "STORE_ERROR", message, ...(e instanceof Error ? { cause: e } : {}) });
    }
  }

  /** Validate a raw key. Returns ActorContext if valid, UNAUTHORIZED error otherwise. */
  async validate(rawKey: string): Promise<Result<ActorContext, LoreError>> {
    if (!rawKey.startsWith(KEY_PREFIX)) {
      return err({ code: "VALIDATION_ERROR", field: "token", message: "Invalid token format" });
    }

    const keyHash = await hashApiKey(rawKey);

    const row = this.db.prepare(
      "SELECT name, revoked_at FROM api_keys WHERE key_hash = ?"
    ).get(keyHash) as { name: string; revoked_at: string | null } | null;

    if (row === null) {
      return err({ code: "VALIDATION_ERROR", field: "token", message: "Invalid API key" });
    }

    if (row.revoked_at !== null) {
      return err({ code: "VALIDATION_ERROR", field: "token", message: "API key has been revoked" });
    }

    return ok({ name: row.name, session_id: keyHash.slice(0, 16) });
  }
}

// ─── Request authentication ────────────────────────────────────────────────

/**
 * Extract bearer token from Authorization header.
 * Returns the raw token string or null if missing/malformed.
 */
export function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  return token.length > 0 ? token : null;
}

/**
 * Authenticate an HTTP request against the api_keys table.
 * Returns ActorContext on success, LoreError on failure.
 */
export async function authenticateRequest(
  req: Request,
  keyStore: ApiKeyStore,
): Promise<Result<ActorContext, LoreError>> {
  const token = extractBearerToken(req);
  if (token === null) {
    return err({ code: "VALIDATION_ERROR", field: "Authorization", message: "Missing bearer token" });
  }
  return keyStore.validate(token);
}
