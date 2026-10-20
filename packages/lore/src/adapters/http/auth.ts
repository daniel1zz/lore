/**
 * HTTP auth for Lore — API key management + request authentication.
 * Purpose: bearer-token API key auth (existing) + cookie-based session auth (SPEC-016).
 * Public surface: ApiKeyStore, authenticateRequest, extractBearerToken, extractSessionCookie,
 *   generateApiKey, hashApiKey, ActorContext, ApiKeyRecord, ALLOWED_ORIGINS, buildAllowedOrigins,
 *   buildSessionCookieHeader, resolveDocWriteOpts.
 * Invariants:
 *   - authenticateRequest is cookie-first: if lore_sid cookie present → resolve session;
 *     else if Bearer token present → existing API key validation path; else UNAUTHORIZED.
 *   - Expired sessions are deleted inline and return an auth failure.
 *   - Valid sessions are sliding-renewed (touch) on every authenticated request.
 *   - ALLOWED_ORIGINS is the DEFAULT-port allowlist (api 8787 / dashboard 5173) for
 *     POST /api/auth/local-bootstrap Origin checks (also reused by dashboard-routes.ts's
 *     CSRF Origin check via middleware.ts::isOriginAllowed). It is DERIVED from
 *     `buildAllowedOrigins` — never hand-maintained as a second literal — so the default
 *     and any port-configured allowlist are computed by the SAME pure function. A caller
 *     that runs the HTTP API and the Vite dev server on non-default ports (`lore dashboard
 *     --dashboard-port P`, or Vite auto-incrementing off a held 5173) MUST compute its own
 *     allowlist via `buildAllowedOrigins(apiPort, dashPort)` and thread it through
 *     `HttpConfig.allowedOrigins` (index.ts) — a request from the ACTUAL port is rejected
 *     by this constant alone (task-dashboard-bootstrap-origin-allowlist-hardcodes-port-5173).
 *   - API keys are SHA-256 hashed at rest. Raw key = "lore_ak_" + 64 hex chars.
 *   - ApiKeyStore.revoke() cascade-deletes the revoked key's cookie sessions (same `db`
 *     handle as SessionStore) — a revoked key invalidates every session it ever minted.
 *   - ApiKeyStore.create()'s `api_keys.name` UNIQUE-constraint race (ASYNC2-001) maps to
 *     the SAME VALIDATION_ERROR the pre-insert existence check already returns — see the
 *     method's own JSDoc.
 *   - `resolveDocWriteOpts` (`adr-dashboard-cookie-session-writes-attribute-author-via`) is
 *     the SOLE translation from an authenticated `ActorContext` to a `CorpusService`
 *     `WriteActorOpts` — every route handler that calls `create`/`set`/`delete` MUST go
 *     through it rather than hand-building `{ by: actor.name }`, so the cookie-vs-bearer
 *     attribution policy lives in exactly one place. Cookie sessions (`http_cookie`) omit
 *     `by` entirely and set `attributeCreatedBy: true` — the static "dashboard-local"
 *     bootstrap-key identity (`actor.name`) / its hardcoded "admin" owner field
 *     (`actor.owner`) are NEVER used as the write actor; the human and `lore serve` share
 *     a machine (SPEC-016), so `CorpusService.resolveWriteActor(undefined)` falls through
 *     to the session tier → OS username (of the `lore serve` process) — the
 *     SAME chain the CLI's `resolveActor` applies. Bearer sessions (`http_token`) are
 *     UNCHANGED: explicit `by: actor.name` (the API key name), `attributeCreatedBy` omitted
 *     (doc/version `created_by` stays the historical literal `"system"`).
 * Side-effect class: IO (bun:sqlite reads/writes, crypto)
 * Source: SPEC-010 §3.2, §3.3; SPEC-016 §3.3
 */

import { Database } from "bun:sqlite";
import { err, ok, type Result } from "@lore/core";
import type { LoreError } from "@lore/core";
import type { SessionStore } from "./sessions.js";
import type { WriteActorOpts } from "../../service/corpus-service.js";

// ─── Types ─────────────────────────────────────────────────────────────────

/** Actor context resolved from a valid auth credential (bearer or cookie). */
export interface ActorContext {
  /** API key name or session's api_key_name (e.g. "dashboard-local"). */
  name: string;
  /**
   * For cookie auth: the actual 32-hex session_id from the sessions table.
   * For bearer auth: first 16 hex chars of the key hash (opaque correlation ID).
   */
  session_id: string;
  /** Owner field (e.g. "admin"). Present for cookie-based sessions. */
  owner?: string;
  /** Session expiry ISO string. Present for cookie-based sessions. */
  expires_at?: string;
  /**
   * Caller surface resolved by authenticateRequest.
   * "http_cookie" — request authenticated via lore_sid cookie (dashboard / human session).
   * "http_token"  — request authenticated via Bearer API token (agent-issued, SPEC-010).
   * Optional for backward compat with test fixtures that pre-date SPEC-024.
   * Routes that care about AI defaults treat absent as "http_token" (safest: AI off).
   * Source: SPEC-024 §8 Q5, §9.1
   */
  callerSurface?: "http_cookie" | "http_token";
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

/** Raw key format: lore_ak_ + 64 hex chars (32 bytes). */
const KEY_PREFIX = "lore_ak_";

// ─── Origin allowlist ────────────────────────────────────────────────────────

/**
 * Build the Origin allowlist for a given (apiPort, dashPort) pair — the four
 * `http(s)://{localhost,127.0.0.1}:{apiPort,dashPort}` origins a browser tab serving the
 * dashboard SPA (Vite, dashPort) can legitimately call the lore HTTP API (apiPort) from.
 * Pure function — no IO, no defaults baked in — so a caller with non-default ports
 * (`lore dashboard --dashboard-port P`, or an auto-incremented Vite port) computes the
 * SAME allowlist shape `ALLOWED_ORIGINS` below is itself derived from.
 *
 * @param apiPort - Port the lore HTTP API server is bound to.
 * @param dashPort - Port the Vite dev server is bound to.
 * @returns Exactly 4 origins, order-stable: localhost/apiPort, localhost/dashPort,
 *   127.0.0.1/apiPort, 127.0.0.1/dashPort. Typed as a fixed 4-tuple (not `string[]`) so
 *   `ALLOWED_ORIGINS[0]` (existing test call sites) stays `string`, never `string |
 *   undefined` — preserves the pre-existing indexed-access ergonomics.
 * @example
 *   buildAllowedOrigins(9000, 6000);
 *   // ["http://localhost:9000", "http://localhost:6000", "http://127.0.0.1:9000", "http://127.0.0.1:6000"]
 */
export function buildAllowedOrigins(apiPort: number, dashPort: number): readonly [string, string, string, string] {
  return [
    `http://localhost:${apiPort}`,
    `http://localhost:${dashPort}`,
    `http://127.0.0.1:${apiPort}`,
    `http://127.0.0.1:${dashPort}`,
  ] as const;
}

/**
 * Default-port Origin allowlist for POST /api/auth/local-bootstrap (api 8787 / dashboard
 * 5173 — SPEC-016's original single-instance default). Guards against cross-site requests
 * to the bootstrap endpoint. SameSite=Strict on the resulting cookie provides CSRF
 * protection for subsequent requests. Derived from {@link buildAllowedOrigins} — see this
 * module's header for why a non-default port setup must NOT rely on this constant alone.
 * Source: SPEC-016 §3.2
 */
export const ALLOWED_ORIGINS = buildAllowedOrigins(8787, 5173);

// ─── Session cookie ──────────────────────────────────────────────────────────

/**
 * Hostnames treated as guaranteed local dev — never crosses an untrusted network hop.
 * `URL#hostname` serializes an IPv6 host WITH brackets (e.g. `[::1]`, not `::1`) per the
 * WHATWG URL spec — both forms are listed defensively in case a future caller normalizes
 * the value before this check runs.
 *
 * DUPLICATED (deliberately) from `routes.ts`'s private, identically-named constant:
 * `routes.ts` is outside this task's (task-skill-implement-f5a-static-serving-nonce-
 * endpoint-and) write-scope anchors, so `static-serving.ts`'s `GET /auth/bootstrap`
 * handler cannot import `routes.ts`'s private helper without editing that file. Both
 * copies encode the SAME local-dev-loopback rule; if it ever changes, both call sites
 * (`routes.ts::isSecureRequestContext`, this module's `isSecureRequestContext`) need it.
 */
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Decide whether the current request is in a "secure" context — i.e. whether it is safe
 * to mark the response cookie `Secure` without breaking plain-http local dev. Mirrors
 * `routes.ts::isSecureRequestContext` byte-for-byte (see {@link LOOPBACK_HOSTNAMES}'s
 * doc comment for why this is a deliberate duplicate rather than a shared import).
 *
 * `Secure` is added when EITHER holds: HTTPS (`X-Forwarded-Proto: https` or the request
 * URL's own `https:` scheme) OR the request's hostname is not loopback. Omitted only for
 * plain-http loopback (local `lore dashboard`/`lore serve` usage), since browsers
 * silently drop `Secure` cookies sent over plain http.
 */
function isSecureRequestContext(req: Request): boolean {
  const forwardedProto = req.headers.get("X-Forwarded-Proto");
  const url = new URL(req.url);
  const isHttps = forwardedProto !== null ? forwardedProto.toLowerCase() === "https" : url.protocol === "https:";
  if (isHttps) return true;

  return !LOOPBACK_HOSTNAMES.has(url.hostname);
}

/**
 * Build the `Set-Cookie` header value for a `lore_sid` session cookie — the SAME
 * attributes `routes.ts::handleLocalBootstrap` sets for `POST /api/auth/local-bootstrap`,
 * so a packaged-mode nonce-redeemed session (`static-serving.ts`) is indistinguishable
 * from a dev-mode bootstrap-token-redeemed one to every downstream `/api/*` consumer.
 *
 * @param req - The request being answered (used only to decide the `Secure` flag).
 * @param sessionId - The `sessions.session_id` just created via `SessionStore.create`.
 * @returns A single `Set-Cookie` header value: `HttpOnly; SameSite=Strict; Path=/api;
 *   Max-Age=2592000` (30 days) plus `Secure` when {@link isSecureRequestContext} holds.
 */
export function buildSessionCookieHeader(req: Request, sessionId: string): string {
  const secureFlag = isSecureRequestContext(req) ? "; Secure" : "";
  return `lore_sid=${sessionId}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=2592000${secureFlag}`;
}

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
 * Source: SPEC-010 §3.2
 */
export class ApiKeyStore {
  constructor(private readonly db: Database) {}

  /**
   * Create a new API key. Returns the raw key (only time it is available).
   *
   * @invariant This is check-then-act, not compare-and-swap — the `SELECT ... WHERE
   *   name = ?` precheck below and the `INSERT` are separated by an `await
   *   hashApiKey(rawKey)` (async — cedes the event loop). A second `create(name, ...)`
   *   call for the SAME `name` landing in that gap (ASYNC2-001) passes the precheck
   *   too, then loses the race at `INSERT` against `api_keys.name`'s `UNIQUE`
   *   constraint (`migration-002.ts`). The catch block below pattern-matches that
   *   specific constraint violation (mirrors `sqlite-store.ts`'s `insert()` matching
   *   `"UNIQUE constraint failed: docs.slug"` for the identical race on doc slugs) and
   *   maps it to the SAME `VALIDATION_ERROR` shape/message the precheck already
   *   returns — the caller never learns whether it lost the precheck or the DB-level
   *   race, only that the name is taken. Any other constraint/IO failure still falls
   *   through to the generic `STORE_ERROR` catch-all, unchanged.
   */
  async create(name: string, owner: string): Promise<Result<{ rawKey: string; record: ApiKeyRecord }, LoreError>> {
    const existing = this.db.prepare("SELECT key_hash FROM api_keys WHERE name = ?").get(name) as { key_hash: string } | null;
    if (existing !== null) {
      return err({ code: "VALIDATION_ERROR", field: "name", message: `Agent name '${name}' already exists`, rule: "BR-952" });
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
      if (message.includes("UNIQUE constraint failed: api_keys.name")) {
        return err({ code: "VALIDATION_ERROR", field: "name", message: `Agent name '${name}' already exists`, rule: "BR-952" });
      }
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

  /**
   * Revoke an API key by name. Cascade-deletes any cookie sessions minted from this key
   * (SessionStore shares this same `db` handle — see sessions.ts module header) so an
   * already-issued `lore_sid` cookie dies with the key instead of continuing to
   * authenticate (and self-renew) for up to another 30 days. This is defense in depth
   * alongside sessions.ts `resolve()`/`touch()`'s own revoked-key rejection, which closes
   * the gap independently at read time even if this cascade is ever skipped.
   */
  revoke(name: string): Result<void, LoreError> {
    const row = this.db.prepare("SELECT key_hash FROM api_keys WHERE name = ?").get(name) as { key_hash: string } | null;
    if (row === null) {
      return err({ code: "DOC_NOT_FOUND", id: name, rule: "BR-956" });
    }

    try {
      const now = new Date().toISOString();
      this.db.prepare("UPDATE api_keys SET revoked_at = ? WHERE name = ?").run(now, name);

      // reason: ApiKeyStore may be constructed standalone (unit tests, or any future caller
      // that never mints cookie sessions) — SessionStore's `CREATE TABLE IF NOT EXISTS
      // sessions` may not have run yet on this Database handle. Guard with an existence
      // check rather than a try/catch-and-swallow so a genuine DELETE failure (not "table
      // missing") still surfaces via the outer catch below.
      const sessionsTableExists = this.db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sessions'",
      ).get() !== null;
      if (sessionsTableExists) {
        this.db.prepare("DELETE FROM sessions WHERE api_key_name = ?").run(name);
      }

      return ok(undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      return err({ code: "STORE_ERROR", message, ...(e instanceof Error ? { cause: e } : {}) });
    }
  }

  /** Validate a raw key. Returns ActorContext if valid, UNAUTHORIZED error otherwise. */
  async validate(rawKey: string): Promise<Result<ActorContext, LoreError>> {
    if (!rawKey.startsWith(KEY_PREFIX)) {
      return err({ code: "VALIDATION_ERROR", field: "token", message: "Invalid token format", rule: "BR-945" });
    }

    const keyHash = await hashApiKey(rawKey);

    const row = this.db.prepare(
      "SELECT name, revoked_at FROM api_keys WHERE key_hash = ?"
    ).get(keyHash) as { name: string; revoked_at: string | null } | null;

    if (row === null) {
      return err({ code: "VALIDATION_ERROR", field: "token", message: "Invalid API key", rule: "BR-945" });
    }

    if (row.revoked_at !== null) {
      return err({ code: "VALIDATION_ERROR", field: "token", message: "API key has been revoked", rule: "BR-945" });
    }

    return ok({ name: row.name, session_id: keyHash.slice(0, 16) });
  }
}

// ─── Cookie extraction ────────────────────────────────────────────────────────

/**
 * Extract the lore_sid session ID from the Cookie header.
 * Returns the session ID string or null if the cookie is absent.
 *
 * @param req - Incoming HTTP Request.
 * @returns Session ID string or null.
 * @example
 *   const sid = extractSessionCookie(req);  // "a1b2c3..." or null
 */
export function extractSessionCookie(req: Request): string | null {
  const cookieHeader = req.headers.get("Cookie");
  if (cookieHeader === null) return null;

  for (const part of cookieHeader.split(";")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) continue;
    const name = part.slice(0, eqIdx).trim();
    if (name === "lore_sid") {
      return part.slice(eqIdx + 1).trim();
    }
  }
  return null;
}

// ─── Request authentication ────────────────────────────────────────────────────

/**
 * Extract bearer token from Authorization header.
 * Returns the raw token string or null if missing/malformed.
 *
 * @param req - Incoming HTTP Request.
 * @returns Raw bearer token or null.
 */
export function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  return token.length > 0 ? token : null;
}

/**
 * Authenticate an HTTP request: cookie-first → bearer fallback.
 *
 * Priority:
 *   1. lore_sid cookie present + sessionStore provided → resolve session (sliding renewal)
 *      - expired → delete row + return VALIDATION_ERROR
 *      - valid   → touch + return ActorContext with owner + expires_at
 *   2. Bearer token present → existing API key validation (unchanged)
 *   3. Neither → VALIDATION_ERROR field=Authorization
 *
 * @param req - Incoming HTTP Request.
 * @param keyStore - ApiKeyStore for bearer validation.
 * @param sessionStore - SessionStore for cookie validation (optional; skipped if absent).
 * @returns ActorContext on success, LoreError on auth failure.
 */
export async function authenticateRequest(
  req: Request,
  keyStore: ApiKeyStore,
  sessionStore?: SessionStore,
): Promise<Result<ActorContext, LoreError>> {
  // ── Cookie-first path (SPEC-016 §3.3) ────────────────────────────────────
  if (sessionStore !== undefined) {
    const sid = extractSessionCookie(req);
    if (sid !== null) {
      const session = sessionStore.resolve(sid);
      if (session === null) {
        return err({ code: "VALIDATION_ERROR", field: "Cookie", message: "Session not found or expired", rule: "BR-944" });
      }

      // Inline expiry check — resolve() does not delete; we handle it here.
      if (new Date(session.expires_at) <= new Date()) {
        sessionStore.delete(sid);
        return err({ code: "VALIDATION_ERROR", field: "Cookie", message: "Session expired", rule: "BR-944" });
      }

      // Slide expiry on use (sliding 30-day window). SPEC-016 §3.3.
      sessionStore.touch(sid);

      return ok({
        name: session.name,
        session_id: sid,
        owner: session.owner,
        expires_at: session.expires_at,
        // SPEC-024 AC-NOAI-7: cookie = human session = dashboard = AI on by default
        callerSurface: "http_cookie" as const,
      });
    }
  }

  // ── Bearer fallback (existing path, unchanged) ────────────────────────────
  const token = extractBearerToken(req);
  if (token === null) {
    return err({ code: "VALIDATION_ERROR", field: "Authorization", message: "Missing bearer token", rule: "BR-943" });
  }
  const tokenResult = await keyStore.validate(token);
  if (!tokenResult.ok) return tokenResult;
  // SPEC-024 AC-NOAI-6: bearer token = agent-issued = AI off by default
  return ok({ ...tokenResult.value, callerSurface: "http_token" as const });
}

// ─── Write-actor attribution (adr-dashboard-cookie-session-writes-attribute-author-via) ────

/**
 * Translate an authenticated {@link ActorContext} into the `CorpusService`
 * `WriteActorOpts` a `create`/`set`/`delete` call should receive — the single
 * policy seam for "who gets attributed as this write's author," so every HTTP
 * route handler (v1 dual-auth routes AND the cookie-only dashboard routes)
 * applies the SAME rule instead of each hand-rolling `{ by: actor.name }`.
 *
 * - `http_cookie` (dashboard UI, human on the SAME machine as `lore serve` —
 *   SPEC-016's local-bootstrap model): omits `by` entirely and sets
 *   `attributeCreatedBy: true`. `CorpusService.resolveWriteActor(undefined)`
 *   then falls through its full chain (session tier → OS username of the
 *   `lore serve` process) — the exact `resolveActor`
 *   precedence the CLI applies. The static `"dashboard-local"` bootstrap-key
 *   name (`actor.name`) and its hardcoded `"admin"` owner field (`actor.owner`)
 *   are deliberately NEVER used here: neither identifies WHICH human is at the
 *   keyboard, so passing either as an "explicit" actor would just replace one
 *   wrong static string ("system") with another ("admin").
 * - `http_token` (bearer, agent-issued) and any other/absent surface: explicit
 *   `by: actor.name` (the API key name) — UNCHANGED from the pre-existing
 *   behavior, `attributeCreatedBy` omitted so `doc.created_by`/
 *   `versionRecord.created_by` keep their historical literal `"system"`.
 *
 * @param actor - The caller's resolved identity from {@link authenticateRequest}.
 * @returns Opts ready to spread/pass straight into `create`/`set`/`delete`.
 * @example
 *   const result = await app.corpusService.create(input, resolveDocWriteOpts(actor));
 */
export function resolveDocWriteOpts(actor: ActorContext): WriteActorOpts {
  if (actor.callerSurface === "http_cookie") {
    return { attributeCreatedBy: true };
  }
  return { by: actor.name };
}
