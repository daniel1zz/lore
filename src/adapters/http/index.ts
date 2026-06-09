/**
 * HTTP server — Bun.serve() wrapper that mounts the API router and auth middleware.
 * Source: SPEC-011 §4, §6
 */

import type { App } from "../../app.js";
import { authenticateRequest } from "./auth.js";
import { handleApiRoute } from "./routes.js";
import { jsonError, corsPreflightResponse } from "./middleware.js";

export interface HttpConfig {
  port?: number;
  host?: string;
}

/**
 * Start the Lore HTTP server.
 * Mounts:
 *   GET  /health          — unauthenticated health check
 *   *    /api/*           — API routes (bearer token required)
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

      // CORS preflight
      if (req.method === "OPTIONS") {
        return corsPreflightResponse();
      }

      // Health check — no auth required
      if (url.pathname === "/health") {
        return new Response(JSON.stringify({ ok: true, status: "healthy" }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // All /api/* routes require authentication
      if (url.pathname.startsWith("/api/")) {
        const authResult = await authenticateRequest(req, app.apiKeyStore);
        if (!authResult.ok) {
          return jsonError({ code: "UNAUTHORIZED", message: "Invalid or missing API key" }, 401);
        }

        const actor = authResult.value;
        const response = await handleApiRoute(req, url, app, actor);

        if (response === null) {
          return jsonError({ code: "NOT_FOUND", message: `Route not found: ${req.method} ${url.pathname}` }, 404);
        }

        return response;
      }

      return jsonError({ code: "NOT_FOUND", message: "Not Found" }, 404);
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
