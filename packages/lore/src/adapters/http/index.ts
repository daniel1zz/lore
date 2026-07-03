/**
 * HTTP server — Bun.serve() wrapper that mounts the API router and auth middleware.
 * Source: SPEC-011 §4, §6; SPEC-016 §3.3 (cookie-first auth + bootstrap route)
 */

import type { App } from "../../app.js";
import { authenticateRequest } from "./auth.js";
import { handleApiRoute, handleLocalBootstrap } from "./routes.js";
import { jsonError, corsPreflightResponse, applyCorsOrigin } from "./middleware.js";

export interface HttpConfig {
  port?: number;
  host?: string;
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
          return applyCorsOrigin(await handleLocalBootstrap(req, app), origin);
        }

        const authResult = await authenticateRequest(req, app.apiKeyStore, app.sessionStore);
        if (!authResult.ok) {
          return applyCorsOrigin(jsonError({ code: "UNAUTHORIZED", message: "Invalid or missing API key" }, 401), origin);
        }

        const actor = authResult.value;
        const response = await handleApiRoute(req, url, app, actor);

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
