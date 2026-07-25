/**
 * HTTP server — Bun.serve() wrapper that mounts the API router and auth middleware.
 * Source: SPEC-011 §4, §6; SPEC-016 §3.3 (cookie-first auth + bootstrap route)
 */

import type { App } from "../../app.js";
import { authenticateRequest, extractSessionCookie } from "./auth.js";
import { handleApiRoute, handleLocalBootstrap } from "./routes.js";
import { jsonError, corsPreflightResponse, applyCorsOrigin } from "./middleware.js";
import { createMachineAuthStores, type MachineAuthStores } from "./machine-auth.js";

export interface HttpConfig {
  port?: number;
  host?: string;
  /**
   * Machine-scope auth stores (SPEC-078 D1) — tests inject one built over an `mkdtemp`
   * base dir; production callers (`lore dashboard`, `lore serve`) may pass one explicitly
   * to share a single instance across `ensureLocalApiKey` and this server (`lore
   * dashboard` does this so the key it mints and the key the server validates are the
   * SAME store), or omit it and let the server resolve the real XDG state path lazily
   * on first actual need.
   */
  machineAuth?: MachineAuthStores;
}

/**
 * Start the Lore HTTP server.
 * Mounts:
 *   GET  /health                       — unauthenticated health check
 *   POST /api/auth/local-bootstrap     — open route; own auth (X-Lore-Token + Origin)
 *   *    /api/*                        — API routes (cookie OR bearer token required)
 * Returns the server instance (Bun.Server).
 */
export function startHttpServer(app: App, config: HttpConfig = {}): ReturnType<typeof Bun.serve> {
  const port = config.port ?? 3456;
  const hostname = config.host ?? "localhost";

  // reason: SPEC-078 D1 — the machine-scope auth store is resolved LAZILY (memoized on
  // first actual need: a lore_sid cookie present on a request, OR the dedicated
  // bootstrap/logout routes) rather than eagerly on every startHttpServer() call.
  // Eager construction would touch the REAL XDG state path
  // (~/.local/state/lore/dashboard-auth.db) the moment ANY caller — including this
  // adapter's many bearer-only test suites — invokes startHttpServer(), even when that
  // caller never sends a cookie or hits the bootstrap/logout routes: a real-filesystem
  // side effect matching the class of bug the 2026-07-07 corpus-pollution incident
  // (root CLAUDE.md) warns about. `config.machineAuth` (tests, or a production caller
  // that wants one shared instance) skips lazy resolution entirely.
  let machineAuth: MachineAuthStores | undefined = config.machineAuth;
  function getMachineAuth(): MachineAuthStores {
    if (machineAuth === undefined) machineAuth = createMachineAuthStores();
    return machineAuth;
  }

  const server = Bun.serve({
    port,
    hostname,
    async fetch(req) {
      const url = new URL(req.url);
      // reason: Origin header is read once here and threaded through applyCorsOrigin at every
      // return path below — the single CORS-origin application point for the whole adapter
      // (SPEC-027 AC-DH-5). Route handlers never see or need this value.
      const origin = req.headers.get("Origin");

      // CORS preflight
      if (req.method === "OPTIONS") {
        return corsPreflightResponse(origin);
      }

      // Health check — no auth required
      if (url.pathname === "/health") {
        return applyCorsOrigin(
          new Response(JSON.stringify({ ok: true, status: "healthy" }), {
            headers: { "Content-Type": "application/json" },
          }),
          origin,
        );
      }

      // All /api/* routes require authentication, EXCEPT /api/auth/local-bootstrap which has own auth.
      if (url.pathname.startsWith("/api/")) {
        // reason: POST /api/auth/local-bootstrap bypasses authenticateRequest — it uses X-Lore-Token
        // + Origin allowlist for its own auth. It must run BEFORE the bearer/cookie gate to avoid
        // a chicken-and-egg deadlock (no session yet → no auth → can't bootstrap). SPEC-016 §3.2.
        if (req.method === "POST" && url.pathname === "/api/auth/local-bootstrap") {
          return applyCorsOrigin(await handleLocalBootstrap(req, getMachineAuth()), origin);
        }

        // reason: SPEC-078 D1 — cookie auth resolves against the machine-scope
        // sessionStore (constructed/reused via getMachineAuth()), bearer auth stays
        // against the per-corpus app.apiKeyStore (unchanged). extractSessionCookie is
        // checked here (not just inside authenticateRequest) so a bearer-only request
        // (no lore_sid cookie) never triggers machine-auth-store construction.
        const cookieSessionStore = extractSessionCookie(req) !== null ? getMachineAuth().sessionStore : undefined;
        const authResult = await authenticateRequest(req, app.apiKeyStore, cookieSessionStore);
        if (!authResult.ok) {
          return applyCorsOrigin(jsonError({ code: "UNAUTHORIZED", message: "Invalid or missing API key" }, 401), origin);
        }

        const actor = authResult.value;
        const response = await handleApiRoute(req, url, app, actor, getMachineAuth);

        if (response === null) {
          return applyCorsOrigin(
            jsonError({ code: "NOT_FOUND", message: `Route not found: ${req.method} ${url.pathname}` }, 404),
            origin,
          );
        }

        return applyCorsOrigin(response, origin);
      }

      return applyCorsOrigin(jsonError({ code: "NOT_FOUND", message: "Not Found" }, 404), origin);
    },

    error(err) {
      process.stderr.write(`[http] Unhandled error: ${err instanceof Error ? err.message : String(err)}\n`);
      return new Response(JSON.stringify({ ok: false, error: { code: "INTERNAL_ERROR", message: "Internal server error" } }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  process.stdout.write(`Lore server running at http://${hostname}:${port}\n`);
  process.stdout.write(`  API:  http://${hostname}:${port}/api/\n`);

  return server;
}
