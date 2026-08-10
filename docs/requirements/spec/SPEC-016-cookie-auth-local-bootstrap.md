---
id: SPEC-16
type: spec
role: spec
title: "Cookie Auth — CLI-managed local bootstrap"
status: approved
priority: medium
created: 2026-06-28
updated: 2026-06-30
tags: []
parent: PRD-001
---
# SPEC-016: Cookie Auth — CLI-managed local bootstrap

## 1. Purpose

Solve the "dashboard can't talk to `lore serve`" gap (SPEC-015 left it open): every `/api/*` route already requires bearer-token auth, but `packages/dashboard/src/lib/api.ts` sends no `Authorization`, so any real run gets 401. This SPEC closes that gap **without any login UI** by making the new `lore dashboard` CLI command the trust root:

1. CLI ensures a local API key exists (creates "dashboard-local" if absent), stores the raw key in `.lore/local-key` (mode 0600, git-ignored).
2. CLI spawns `lore serve` (existing) and the Vite dev server, injecting the raw key into Vite dev via `VITE_LORE_BOOTSTRAP_TOKEN` env.
3. Vite's dev middleware inlines the token into `index.html` as `window.__LORE_BOOTSTRAP_TOKEN__` — **dev-only**, never in `vite build` artefacts.
4. SPA boots, posts the token once to a new `/api/auth/local-bootstrap` endpoint, gets back an HttpOnly session cookie, deletes the global, and runs cookie-based forever after.
5. CLI/MCP/scripts keep using bearer tokens unchanged.

End result: **zero user interaction** to use the dashboard locally; **zero raw key** in the browser after bootstrap; **zero break** for existing bearer-token consumers; sessions persist across reloads for 30 days (sliding).

## 2. Goals & Non-Goals

### 2.1 Goals

- New CLI command `lore dashboard` orchestrates the full local stack: ensure key, spawn `lore serve` + Vite, open browser, clean up on Ctrl+C.
- One-time bootstrap exchange (`POST /api/auth/local-bootstrap`) trades the raw key for an HttpOnly cookie tied to a `sessions` row.
- `authenticateRequest` is extended: **cookie first → bearer fallback**. Existing bearer consumers (CLI, MCP, `lore agent` flows, every `*.bun.test.ts` that uses bearer) keep working unchanged.
- New `sessions` table with sliding 30-day expiry. Created on demand via `CREATE TABLE IF NOT EXISTS` at server start; no separate migration command.
- `GET /api/auth/me` returns the cookie-resolved `ActorContext` so the dashboard nav can render "Signed in as dashboard-local".
- `POST /api/auth/logout` deletes the session row + clears the cookie. Optional UI; backend always available.
- Dashboard SPA sends `credentials: "include"` on every `/api/*` request.
- Six-dimension test coverage on the backend bootstrap/session flow and on the SPA bootstrap helper.

### 2.2 Non-Goals (explicit)

- ❌ Username/password login. Forever out of scope.
- ❌ OAuth, SSO, magic-link, passkeys.
- ❌ Multi-user / roles / permissions.
- ❌ Rate limiting on `/api/auth/local-bootstrap` (local trust root is sufficient).
- ❌ Refresh-token / short-lived access-token / JWT.
- ❌ Production-grade CSRF (HttpOnly + SameSite=Strict + Origin allowlist covers the local threat model).
- ❌ Remote deployment hardening.
- ❌ Session UI (list / revoke active sessions). `lore agent revoke` already covers the underlying API key.
- ❌ Auth on `/health` (still unauthenticated).
- ❌ Cookie auth for the MCP server or the CLI (they keep bearer).

## 3. Architecture

### 3.1 Trust chain

```
lore dashboard (CLI)              lore serve (HTTP)              Browser
─────────────                     ───────────                     ───────
1. ensureLocalApiKey()
   ├─ if .lore/local-key exists  → reuse raw_key
   └─ else apiKeyStore.create("dashboard-local", "admin") → raw_key
       persist raw_key → .lore/local-key (0600, gitignored)
2. spawn lore serve (port 8787)
3. spawn vite dev (port 5173) with env VITE_LORE_BOOTSTRAP_TOKEN=<raw_key>
4. wait for both /health and / to return 200
5. open(http://localhost:5173/)

                                                                  6. Vite dev plugin
                                                                     "lore-bootstrap-token"
                                                                     transformIndexHtml() →
                                                                     injects:
                                                                     <script>
                                                                       window.__LORE_BOOTSTRAP_TOKEN__='<raw>'
                                                                     </script>
                                                                     (plugin apply: "serve" only —
                                                                      `vite build` never includes it)

                                                                  7. SPA main.tsx:
                                                                     await bootstrapAuthIfNeeded()
                                                                     ├─ if window.__LORE_BOOTSTRAP_TOKEN__:
                                                                     │    POST /api/auth/local-bootstrap
                                                                     │    X-Lore-Token: <raw>
                                                                     │    credentials: "include"
                                                                     │    ───────►   8. lore serve:
                                                                     │                  - verify Origin ∈ allowlist
                                                                     │                  - verify token (SHA-256 match in api_keys)
                                                                     │                  - INSERT sessions row
                                                                     │                  - Set-Cookie:
                                                                     │                    lore_sid=<sid>;
                                                                     │                    HttpOnly;
                                                                     │                    SameSite=Strict;
                                                                     │                    Path=/api;
                                                                     │                    Max-Age=2592000
                                                                     │               ◄───────
                                                                     │    delete window.__LORE_BOOTSTRAP_TOKEN__
                                                                     └─ render <RouterProvider />

                                                                  9. All subsequent SPA fetches:
                                                                     fetch("/api/...", { credentials: "include" })
                                                                     ───────►   authenticateRequest:
                                                                                  1. cookie present → resolveSession()
                                                                                  2. else bearer present → existing path
                                                                                  3. else 401
```

### 3.2 New endpoints

| Method | Path | Body | Auth | Behaviour |
|---|---|---|---|---|
| `POST` | `/api/auth/local-bootstrap` | empty | `X-Lore-Token: <raw>` header (NOT `Authorization`, so it's a separate code path) | Verify `Origin` is `http://localhost:5173` OR `http://localhost:8787` OR `http://127.0.0.1:5173|8787`. Verify token by SHA-256 match against `api_keys`. INSERT a new row into `sessions`. `Set-Cookie: lore_sid=<sid>; HttpOnly; SameSite=Strict; Path=/api; Max-Age=2592000`. Response `{ ok: true, value: { session_id, expires_at } }`. |
| `GET` | `/api/auth/me` | — | cookie | Return `{ ok: true, value: { name, owner, session_id, expires_at } }` for the current session. 401 if no/expired cookie. |
| `POST` | `/api/auth/logout` | empty | cookie | `DELETE FROM sessions WHERE session_id = ?`. `Set-Cookie: lore_sid=; Max-Age=0`. Always returns `{ ok: true }` (idempotent). |

### 3.3 Modified middleware

`packages/lore/src/adapters/http/auth.ts::authenticateRequest`:

```
Before:
  bearer-only → ActorContext | UNAUTHORIZED

After:
  if cookie "lore_sid" present:
    sessionStore.resolve(sid) → { name, owner, session_id, expires_at }
      - if expires_at < now → DELETE session row → UNAUTHORIZED
      - else UPDATE sessions SET last_used_at = now, expires_at = now + 30d
            (sliding renewal)
      - return ActorContext { name, owner, session_id }
  else if bearer token present:
    existing apiKeyStore.validate(...)  (unchanged)
  else:
    UNAUTHORIZED

Open routes:
  - /health                       (unchanged)
  - POST /api/auth/local-bootstrap (own auth via X-Lore-Token + Origin check)
```

### 3.4 New table

```sql
CREATE TABLE IF NOT EXISTS sessions (
  session_id    TEXT PRIMARY KEY,
  api_key_name  TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  last_used_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
```

`session_id` is 32-hex from `crypto.randomBytes(16).toString("hex")`. `api_key_name` links back to `api_keys.name` (no FK declared — soft link is sufficient for a local tool).

At `lore serve` startup, `SessionStore` runs `DELETE FROM sessions WHERE expires_at < datetime('now')` once. No cron, no background timer.

### 3.5 New `SessionStore` class

Lives at `packages/lore/src/adapters/http/sessions.ts` (next to `auth.ts`). Same pattern as `ApiKeyStore` — takes a `bun:sqlite Database` directly, exposes:

```ts
export class SessionStore {
  constructor(private db: Database) { /* runs CREATE TABLE IF NOT EXISTS + pruneExpired() */ }

  create(apiKeyName: string): { session_id: string; expires_at: string };
  resolve(sessionId: string): { name: string; owner: string; expires_at: string } | null;
  touch(sessionId: string): void;     // updates last_used_at + expires_at (+30d)
  delete(sessionId: string): void;
  pruneExpired(): void;
}
```

App composition root wires it alongside `ApiKeyStore`, sharing the same `Database` connection (per the existing SPEC-009 sync-replica pattern).

### 3.6 CLI command `lore dashboard`

`packages/lore/src/adapters/cli/commands/dashboard.ts`. Citty command. **In-process HTTP server** (reuses `startHttpServer(app, {...})` so we don't fork the same lore binary just to talk to ourselves) + **one** child process (Vite dev server). Pseudocode:

```ts
export default defineCommand({
  meta: { name: "dashboard", description: "Run dashboard dev server (Vite) + lore HTTP server in one command, with auto-bootstrapped local auth" },
  args: {
    "api-port":       { type: "string", default: "8787" },
    "dashboard-port": { type: "string", default: "5173" },
    "no-open":        { type: "boolean" },
  },
  async run({ args }) {
    const { app, dbPath } = loadLoreApp();
    const loreDir = dirname(dbPath);
    const localKey = ensureLocalApiKey(app.apiKeyStore, loreDir);     // §3.7
    const apiPort = parseInt(args["api-port"], 10);
    const dashPort = parseInt(args["dashboard-port"], 10);

    // In-process HTTP — single Bun.Server handle owned by this command.
    const server = await startHttpServer(app, { port: apiPort, host: "127.0.0.1" });

    // Single child: Vite dev. Token injected via env, never via stdin/cli args.
    const vite = spawn(["bun", "run", "--filter", "@lore/dashboard", "dev", "--", "--port", String(dashPort)], {
      stdio: "inherit",
      env: { ...process.env, VITE_LORE_BOOTSTRAP_TOKEN: localKey },
    });
    await waitFor200(`http://localhost:${dashPort}/`);                // server's /health is already up

    if (!args["no-open"]) openBrowser(`http://localhost:${dashPort}/`);

    await onSigint(async () => {
      vite.kill("SIGTERM");
      await server.stop();
      app.close();
    });
    process.exit(0);
  },
});
```

The in-process choice means **the HTTP server and the CLI share the same `App` instance**: one `Database` connection, one `ApiKeyStore`, one `SessionStore`. No cross-process synchronisation, no race on `.lore/lore.db`.

`ensureLocalApiKey` (also exported for testing):

```ts
export function ensureLocalApiKey(store: ApiKeyStore, loreDir: string): string {
  const path = join(loreDir, "local-key");
  if (existsSync(path)) return readFileSync(path, "utf8").trim();
  const raw = store.create("dashboard-local", "admin");
  writeFileSync(path, raw, { mode: 0o600 });
  return raw;
}
```

`.gitignore` (root) appends `.lore/local-key`.

### 3.7 Vite dev plugin

`packages/dashboard/vite.config.ts` adds:

```ts
{
  name: "lore-bootstrap-token",
  apply: "serve",   // <-- CRITICAL: dev-only. vite build never executes this.
  transformIndexHtml(html) {
    const token = process.env.VITE_LORE_BOOTSTRAP_TOKEN;
    if (!token) return html;
    const safe = JSON.stringify(token);
    return html.replace("</head>", `<script>window.__LORE_BOOTSTRAP_TOKEN__=${safe}</script></head>`);
  },
}
```

The plugin uses `apply: "serve"`; Vite skips it entirely during `vite build`. The token is therefore impossible to land in any production bundle artefact.

### 3.8 SPA bootstrap helper

`packages/dashboard/src/lib/bootstrap.ts`:

```ts
export async function bootstrapAuthIfNeeded(): Promise<void> {
  const w = window as unknown as { __LORE_BOOTSTRAP_TOKEN__?: string };
  const token = w.__LORE_BOOTSTRAP_TOKEN__;
  if (!token) return;
  try {
    const res = await fetch("/api/auth/local-bootstrap", {
      method: "POST",
      headers: { "X-Lore-Token": token },
      credentials: "include",
    });
    if (!res.ok) throw new Error(`bootstrap failed: ${res.status}`);
  } finally {
    delete w.__LORE_BOOTSTRAP_TOKEN__;
  }
}
```

`packages/dashboard/src/main.tsx` calls `await bootstrapAuthIfNeeded()` before `createRoot(...).render(...)`. Failure does not block render — it shows a sonner toast so the developer sees the error and can rerun `lore dashboard`.

### 3.9 SPA fetch wrapper

`packages/dashboard/src/lib/api.ts::fetchJson` adds `credentials: "include"` to every call. That single change is enough for the cookie to flow to `/api/*` from `localhost:5173` because Vite's proxy is same-origin from the browser's view (it terminates at Vite then re-issues to `:8787` server-side, but the browser sees one origin).

### 3.10 Auth on the existing routes

`packages/lore/src/adapters/http/index.ts::startHttpServer` already gates `/api/*` via `authenticateRequest`. The change is fully encapsulated inside `authenticateRequest` — every existing route handler downstream stays unchanged.

## 4. Implementation Plan

Eight milestones. M1–M3 backend (main agent — small `routes.ts` edits + new files). M4 CLI command. M5 Vite plugin + SPA bootstrap. M6 tests. M7 docs. M8 oracle gate.

1. **M1 — `SessionStore`** (main agent). New file `packages/lore/src/adapters/http/sessions.ts` with constructor that runs `CREATE TABLE IF NOT EXISTS sessions ...` + `pruneExpired()`; `create / resolve / touch / delete` methods.

2. **M2 — App wiring** (main agent). `packages/lore/src/app.ts` (composition root) instantiates `SessionStore` alongside `ApiKeyStore` using the same `Database`. Pass via `app.sessionStore`.

3. **M3 — Auth middleware + new endpoints** (main agent + implementer if size demands). Modify `auth.ts::authenticateRequest` to do "cookie first → bearer fallback". Add three handlers to `routes.ts`: `POST /api/auth/local-bootstrap`, `GET /api/auth/me`, `POST /api/auth/logout`. Origin allowlist constant lives in `auth.ts`.

4. **M4 — `lore dashboard` CLI command** (main agent for citty boilerplate + `ensureLocalApiKey`; spawn / process orchestration kept simple — Node `child_process.spawn` + `events.once("close")` patterns). Add `dashboard` to `packages/lore/src/adapters/cli/index.ts` subCommands. Update `.gitignore` for `.lore/local-key`.

5. **M5 — Vite plugin + SPA bootstrap** (dispatch implementer). Add the `lore-bootstrap-token` plugin to `packages/dashboard/vite.config.ts`. Create `packages/dashboard/src/lib/bootstrap.ts`. Update `main.tsx` to call `bootstrapAuthIfNeeded()` pre-render. Update `api.ts::fetchJson` to add `credentials: "include"`.

6. **M6 — Tests** (dispatch implementer). Six-dimension coverage on `SessionStore`, `authenticateRequest`, the three new endpoints (bun test, real SQLite). Vitest coverage on `bootstrap.ts` (mocked window + fetch). CLI integration test for `ensureLocalApiKey`. Target ≥30 new test cases.

7. **M7 — Docs sync** (main agent). Update root `CLAUDE.md` (add SPEC-016 to list). Update `packages/lore/src/adapters/http/CLAUDE.md` (auth invariants now include cookie path). Update `packages/dashboard/CLAUDE.md` (remove "no auth state" line — SPEC-016 lands cookie auth via bootstrap, no login UI). Update `packages/lore/src/adapters/cli/CLAUDE.md` (subcommand count goes 22 → 23, `dashboard` added).

8. **M8 — Oracle gate** (main agent). `bun run typecheck` 5 stages; `bun run test:vitest` 1007 + ≥SPA tests; `bun run test:bun` 396 + ≥backend tests; `bun run build` produces `dist/lore`; `./dist/lore dashboard --no-open` for 2s smoke (must reach the "Opening browser…" step or print equivalent, then Ctrl+C clean).

## 5. Acceptance Criteria

### 5.1 Backend

- `AC-A-B1`: `sessions` table exists after first `lore serve` start (verified by `PRAGMA table_info` query in a bun test).
- `AC-A-B2`: `POST /api/auth/local-bootstrap` with valid `X-Lore-Token` + `Origin: http://localhost:5173` returns 200 + `Set-Cookie: lore_sid=...; HttpOnly; SameSite=Strict`.
- `AC-A-B3`: Same call with invalid token returns 401.
- `AC-A-B4`: Same call with disallowed `Origin: http://evil.example` returns 403.
- `AC-A-B5`: `GET /api/docs` with valid cookie returns 200 (no `Authorization`).
- `AC-A-B6`: `GET /api/docs` with expired cookie returns 401 AND deletes the expired row from `sessions`.
- `AC-A-B7`: `GET /api/docs` with valid bearer (no cookie) still returns 200 (regression for CLI/MCP).
- `AC-A-B8`: `POST /api/auth/logout` deletes the session row and clears the cookie. A second call is idempotent.
- `AC-A-B9`: `GET /api/auth/me` returns `{ name: "dashboard-local", owner: "admin", session_id, expires_at }` with a valid cookie.
- `AC-A-B10`: Sliding renewal: a request with a session whose `last_used_at` is older than 1 minute bumps `last_used_at` and `expires_at` by +30 days from now.

### 5.2 CLI

- `AC-A-C1`: First-ever `lore dashboard` creates `.lore/local-key` with mode 0600 and the file content equals the raw key returned by `apiKeyStore.create`.
- `AC-A-C2`: Subsequent `lore dashboard` invocations reuse the same key (no rotation).
- `AC-A-C3`: `lore dashboard` spawns `lore serve` and Vite, waits for both to respond, prints the dashboard URL, and on `SIGINT` (Ctrl+C) kills both children before exiting.
- `AC-A-C4`: `lore dashboard --no-open` skips the browser-open step.

### 5.3 SPA

- `AC-A-S1`: `bootstrapAuthIfNeeded()` no-ops when `window.__LORE_BOOTSTRAP_TOKEN__` is undefined.
- `AC-A-S2`: When token present, it POSTs to `/api/auth/local-bootstrap` with the token in the `X-Lore-Token` header, then deletes the global regardless of success.
- `AC-A-S3`: Every `fetchJson()` call includes `credentials: "include"`.
- `AC-A-S4`: After bootstrap, the SPA can call `/api/docs` without rebooting and the request carries the cookie.

### 5.4 Boundary

- `AC-A-Bnd1`: `grep -r "VITE_LORE_BOOTSTRAP_TOKEN\|__LORE_BOOTSTRAP_TOKEN__" packages/dashboard/dist/` (after `vite build`) returns zero hits.
- `AC-A-Bnd2`: `.gitignore` contains `.lore/local-key`.
- `AC-A-Bnd3`: `grep -r "from \"@lore/lore\"" packages/dashboard/src/` still returns zero hits (no regression to SPEC-015).

### 5.5 Oracle

- `AC-A-O1`: `bun run typecheck` exits 0 (5 stages including dashboard).
- `AC-A-O2`: `bun run test:vitest` passes 1007 baseline + new SPA tests with zero failures.
- `AC-A-O3`: `bun run test:bun` passes 396 baseline + new backend tests with zero failures.
- `AC-A-O4`: `bun run build` produces a working `dist/lore`; `./dist/lore dashboard --no-open --api-port 18787 --dashboard-port 15173` reaches the "ready" state within 8 seconds and clean Ctrl+C-exits.

## 6. Out-of-scope rejections

Even if requested mid-implementation, the following are deferred to a future SPEC and MUST NOT silently land:

- Username/password registration / login.
- OAuth / SSO / passkeys.
- Account / session-list UI in the dashboard.
- Production CSRF tokens (SameSite=Strict + Origin allowlist are sufficient locally).
- Rate-limiting / brute-force protection.
- Cookie auth on non-`/api` paths (Vite's `/` serves the SPA; no need).
- Switching CLI/MCP to cookie auth — they keep bearer forever.

## 7. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `apply: "serve"` plugin accidentally runs during build | Plugin tested explicitly: `vite build` followed by `grep` on `dist/` for the token name — covered by `AC-A-Bnd1` |
| Vite proxy strips the cookie | Vite passes cookies through by default for same-origin proxies; SPA's `credentials: "include"` covers the browser side |
| `child_process.spawn` orphaning child processes on SIGINT | Use `detached: false` (default) and explicit `kill("SIGTERM")` on signal; integration test in `AC-A-C3` |
| User opens dashboard before `lore dashboard` finishes spawning | `lore dashboard` waits for `/health` and `/` to return 200 before opening browser — `AC-A-C3` |
| `.lore/local-key` ends up committed | `.gitignore` entry + `AC-A-Bnd2` grep |
| Session sliding renewal causes write storm on heavy reads | Cheap UPDATE (single indexed row); acceptable for a local single-user tool. Defer batching to a real perf SPEC if it ever surfaces |
| Existing bearer tests break | `authenticateRequest` runs bearer path unchanged when no cookie present; regression covered by AC-A-B7 + the existing 396 bun-test baseline |
| CSRF via cross-origin form POST (HTML form action="http://localhost:8787/api/...") | SameSite=Strict prevents the cookie from being sent. Origin allowlist on `/api/auth/local-bootstrap` covers the bootstrap path |

## 8. Open Questions

None at brainstorm close. Implementation-time additions belong in this section as addenda rather than silent choices.
