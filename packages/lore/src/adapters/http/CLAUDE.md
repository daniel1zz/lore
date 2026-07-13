# Module: adapters/http

## Purpose

`Bun.serve` HTTP adapter. Mounts `/health` (unauthenticated) and `/api/*` (bearer-token authenticated) routes. Also hosts `sync-push.ts`, the manual logical-replication helper used by `lore sync push` to replicate the 5 core tables into a remote libsql.

## Key Invariants

- **All `/api/*` requests require a valid identity.** `authenticateRequest` checks the `lore_sid` HttpOnly cookie first (resolved via `SessionStore`); if absent or expired, it falls back to the bearer-token path (`ApiKeyStore`). Unauthenticated requests return `401 UNAUTHORIZED`. `/health` is the only unauthenticated route. `POST /api/auth/local-bootstrap` self-authenticates via `X-Lore-Token` header + Origin allowlist (SPEC-016).
- **API keys are SHA-256 hashed at rest.** Raw key format is `lore_ak_` + 32 hex chars (`generateApiKey`). Only the SHA-256 hash is written to `api_keys`; the raw key is shown to the user once on creation and never stored.
- **Revoking an API key invalidates its cookie sessions immediately.** `SessionStore.resolve`/`touch` join `api_keys` with `WHERE ... revoked_at IS NULL` — a session backed by a revoked (or purged) key resolves as UNAUTHENTICATED and cannot be sliding-renewed. `ApiKeyStore.revoke` additionally cascade-deletes that key's `sessions` rows (same shared `db`, guarded by a `sqlite_master` existence check). A stolen cookie can no longer outlive `lore agent revoke` (previously it kept working — and self-renewed 30 days — via a null-owner `"admin"` fallback).
- **Session cookie `Secure` flag is context-conditional.** `lore_sid` gets `Secure` when the request is HTTPS (`X-Forwarded-Proto`/scheme) OR the bind host is non-loopback; loopback plain-http (`lore dashboard` local dev) is unaffected. `SameSite=Strict; HttpOnly; Path=/api; Max-Age=2592000` unchanged.
- **Dashboard write routes enforce the Origin allowlist.** `/api/dashboard/*` state-changing routes run `assertAllowedOrigin` (reusing `middleware.ts::isOriginAllowed`/`ALLOWED_ORIGINS`) before `assertCookieActor` — a present-but-disallowed `Origin` → `403`; a missing `Origin` passes through (unchanged, matches `local-bootstrap` convention) — CSRF defense-in-depth beyond `SameSite=Strict`.
- **`ApiKeyStore` takes a `bun:sqlite Database` directly**, not a `StoreInterface`. With `TursoStore` enabled, the composition root opens a separate `Database` against the same local replica file so `api_keys` shares the replicated dataset. Verified by `tests/unit/store/libsql-compat.bun.test.ts`.
- **JSON envelope** — success → `{ ok: true, value: T }` via `jsonOk`; failure → `{ ok: false, error: { code, message } }` via `jsonError` or `loreErrorResponse`. Status codes mirror the CLI exit-code semantics (4xx for validation/lifecycle, 404 for not-found, 409 for stale version, 5xx for store errors). Never leak raw `Error.stack`.
- **CORS preflight** — `OPTIONS` requests are short-circuited by `corsPreflightResponse` before auth runs. The actual API routes also guard against `OPTIONS` reaching service code.
- **`sync-push` is idempotent.** Uses `INSERT OR IGNORE` in chunks of 500 rows across the 5 replicated tables: `docs`, `links`, `versions`, `audit`, `api_keys` (D-006 / R3). Re-running on the same state yields zero new rows. Per-table `local_rows` / `remote_rows` reconciliation is in the returned `PushReport`.

## Patterns

- **Route dispatch is a flat conditional table** in `routes.ts::handleApiRoute` — `if (method === "X" && path === "Y") return handleX(...)`. Returns `null` for unmatched routes; the server then returns 404.
- **Body parsing via `parseJsonBody`** — returns `Result<unknown, LoreError>`. Routes never `await req.json()` directly.
- **`ActorContext` flows from auth to routes** — `{ name, session_id }`. Routes pass it through to services as the audit-log actor where applicable.
- **Server lifecycle** — `startHttpServer(app, { port, host })` returns the `Bun.Server` instance. Caller (typically `lore serve`) is responsible for `app.close()` on shutdown.

## Files

- `index.ts` — `startHttpServer`; `Bun.serve` wrapper, `/health` route, auth gate, top-level error handler.
- `auth.ts` — `generateApiKey`, `hashApiKey`, `ApiKeyStore`, `authenticateRequest` (cookie-first → bearer-fallback), `extractSessionCookie`, `ALLOWED_ORIGINS`, `ActorContext`.
- `sessions.ts` — `SessionStore` (CREATE TABLE IF NOT EXISTS on construct + pruneExpired): `create / resolve / touch / delete`. Sliding 30-day TTL (SPEC-016).
- `routes.ts` — `handleApiRoute`; per-endpoint handlers calling services. Auth routes: `POST /api/auth/local-bootstrap`, `GET /api/auth/me`, `POST /api/auth/logout`.
- `middleware.ts` — `jsonOk`, `jsonError`, `loreErrorResponse`, `parseJsonBody`, `corsPreflightResponse`.
- `sync-push.ts` — `pushToRemote(localPath, remoteUrl, authToken)`; libsql batch INSERT OR IGNORE.

## Links

- Depends on: [`@lore/core`](../../../../../core/src/CLAUDE.md), [`../../service`](../../service/CLAUDE.md), [`../../store`](../../store/CLAUDE.md) (transitively + `bun:sqlite Database` for ApiKeyStore).
- Entry point: [`../cli`](../cli/CLAUDE.md) `lore serve`.
