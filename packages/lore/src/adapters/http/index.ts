/**
 * HTTP server — Bun.serve() wrapper that mounts the API router and auth middleware.
 * Source: SPEC-011 §4, §6; SPEC-016 §3.3 (cookie-first auth + bootstrap route);
 *   SPEC-078 D4/D7/D8 (multi-project path shim + GET /api/projects)
 */

import { randomUUID } from "node:crypto";

import type { App } from "../../app.js";
import { authenticateRequest, extractSessionCookie } from "./auth.js";
import { handleApiRoute, handleLocalBootstrap } from "./routes.js";
import { jsonError, corsPreflightResponse, applyCorsOrigin } from "./middleware.js";
import { createMachineAuthStores, type MachineAuthStores } from "./machine-auth.js";
import { handleGetProjects } from "./projects-route.js";
// reason: TYPE-ONLY import — the bun-only MountRegistry RUNTIME (`../../mount/mount-registry.js`,
// T5) transitively imports `bun:sqlite`; this file only ever consumes the pure interface
// contract (`../../mount/types.js`, T3), never constructs a registry itself. The production
// registry is built once (`lore dashboard`, T8 deliverable 3) and injected via `HttpConfig`.
import type { MountEntry, MountRegistry } from "../../mount/types.js";

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
  /**
   * Multi-project mount registry (SPEC-078 D2/D4/D7) — when supplied, this server ALSO
   * accepts project-addressed traffic under `/api/p/:name/*` (path-rewrite shim, D4) and
   * `GET /api/projects` (D7 registry+identity projection). Omitted (registry-less mode,
   * the default): the whole multi-mode branch below is completely inert — every request
   * takes EXACTLY the same path it did before SPEC-078 (R-15), byte-identical.
   */
  mountRegistry?: MountRegistry<App>;
}

/**
 * Matches the `/api/p/:name/*` project-address prefix (SPEC-078 D4) and returns the
 * captured registry `name` plus the REST of the path — always itself starting with
 * `/api/...` again, so stripping the prefix reproduces exactly the path shape every
 * existing route table (`routes.ts`, `dashboard-routes.ts`) already matches on. Returns
 * `null` for any path that isn't a project-addressed request (including a bare
 * `/api/p/:name` with no trailing segment — this shim only ever activates ON a request
 * table match, so an under-specified prefix simply falls through as an unmatched route).
 */
function matchProjectPrefix(pathname: string): { name: string; rest: string } | null {
  const match = /^\/api\/p\/([^/]+)(\/.*)$/.exec(pathname);
  if (match === null) return null;
  const [, name, rest] = match;
  if (name === undefined || rest === undefined) return null;
  return { name: decodeURIComponent(name), rest };
}

/** Human-readable diagnostic error code for a registered-but-not-mounted entry's response. */
function projectStateErrorCode(state: MountEntry["state"]): string {
  return `PROJECT_${state.toUpperCase().replace(/-/g, "_")}`;
}

/**
 * Resolve + authenticate + delegate ONE project-addressed request (SPEC-078 D4).
 *
 * Auth (SPEC-078 D1): a `lore_sid` cookie is ALWAYS checked against the machine-scope
 * session store, regardless of which project is addressed or its mount state (a
 * dashboard login is "logged into this instance", not scoped to one project). A bearer
 * token is checked against the RESOLVED project's own `apiKeyStore` when it is mounted
 * (bearer keys stay strictly per-corpus, D1) — falling back to the top-level `app`'s
 * `apiKeyStore` only when the addressed entry has no `app` of its own (missing /
 * schema-skew / already-`error`), so a bearer-authenticated caller of THIS server
 * instance can still see why an unmounted project is unavailable, without inventing a
 * second machine-scope key store D1 deliberately did not create.
 *
 * R-17 isolation: the delegate call is wrapped in try/catch — a per-request dispatch
 * failure against a `"mounted"` entry (its corpus disappearing mid-session, a real
 * `bun:sqlite` throw — see the D8 deleted-corpus-liveness spike) demotes JUST this one
 * entry to `"error"` (`mountRegistry.markError`) and returns a NAMED 5xx; every other
 * mounted project is completely unaffected by this catch.
 */
async function dispatchProjectRequest(
  req: Request,
  url: URL,
  match: { name: string; rest: string },
  mountRegistry: MountRegistry<App>,
  primaryApp: App,
  getMachineAuth: () => MachineAuthStores,
): Promise<Response> {
  const { name, rest } = match;
  const entry = mountRegistry.resolve(name);

  if (entry === undefined) {
    // R-12 — an unregistered project name is a 404, not a 401: there is no
    // per-project apiKeyStore to even attempt bearer auth against, and leaking
    // "unregistered" vs "registered but unauthorized" here is not a meaningful
    // secret for a local single-user tool.
    return jsonError({ code: "NOT_FOUND", message: `Unregistered project: "${name}"` }, 404);
  }

  // reason: SPEC-078 D8/R-17 — EVERYTHING from here on (auth included) runs inside
  // ONE try/catch. A "mounted" entry backed by a corpus that has gone bad can throw
  // from ANY property touch, not just inside the delegated route handler — the D8
  // deleted-corpus-liveness spike's throw happens on the FIRST store call after the
  // underlying file disappears, which could just as easily be triggered by the
  // bearer-auth lookup below (`entry.app.apiKeyStore`) as by the route body itself.
  // Narrowing the try/catch to only the final delegate call would let that class of
  // failure escape as an unattributed 500 without ever demoting the entry to "error".
  try {
    const cookieSessionStore = extractSessionCookie(req) !== null ? getMachineAuth().sessionStore : undefined;
    const bearerStore = entry.app?.apiKeyStore ?? primaryApp.apiKeyStore;
    const authResult = await authenticateRequest(req, bearerStore, cookieSessionStore);
    if (!authResult.ok) {
      return jsonError({ code: "UNAUTHORIZED", message: "Invalid or missing API key" }, 401);
    }
    const actor = authResult.value;

    if (entry.state !== "mounted" || entry.app === undefined) {
      // D7 — a registered project that never reached (or fell out of) the
      // "mounted" state gets a NAMED 5xx-class diagnostic (never a generic 500)
      // naming the project and its classification-time reason.
      return jsonError(
        {
          code: projectStateErrorCode(entry.state),
          message: entry.diagnosis ?? `project "${name}" is not mounted (state: ${entry.state})`,
        },
        503,
      );
    }

    const strippedUrl = new URL(url.toString());
    strippedUrl.pathname = rest;

    const response = await handleApiRoute(req, strippedUrl, entry.app, actor, getMachineAuth);
    if (response === null) {
      return jsonError(
        { code: "NOT_FOUND", message: `Route not found: ${req.method} ${strippedUrl.pathname}` },
        404,
      );
    }
    return response;
  } catch (error) {
    // SPEC-078 D8/R-17 — never let a per-project dispatch throw escape to
    // Bun.serve's global error() handler (a generic, un-attributed 500) or
    // cross-contaminate any other mounted entry.
    const err = error instanceof Error ? error : new Error(String(error));
    mountRegistry.markError(name, err);
    return jsonError({ code: "PROJECT_ERROR", message: `project "${name}" failed: ${err.message}` }, 503);
  }
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
  const mountRegistry = config.mountRegistry;
  // reason: SPEC-078 D7 — a stable per-PROCESS identity label (not per-request), generated
  // once here regardless of whether a registry was supplied (cheap, and keeps this value's
  // provenance simple — "one per startHttpServer() call" — rather than conditionally
  // allocating it only in multi-mode). Nothing in `DashboardConfig` names a registry
  // identity today (SPEC-078 D3's schema is just `projects[]`), so this is the ONE place
  // that invents one; `GET /api/projects` is its only consumer.
  const instanceRegistryName = randomUUID();

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

  // reason: explicitly typed (rather than `const server = Bun.serve({...})`) because
  // the `fetch` handler below reads `server.port` (SPEC-078 D7 — the REAL bound port,
  // not the requested `config.port`, matters for `port: 0` ephemeral test binding) —
  // an inline `const` referencing itself inside its own initializer's nested closure
  // is a genuine TS circular-inference error (TS7022/TS7023), not just a style choice.
  let server: ReturnType<typeof Bun.serve>;
  server = Bun.serve({
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

        // SPEC-078 D4 — multi-project path shim. Runs BEFORE the single-app auth gate
        // below because a `/api/p/:name/*` request's bearer auth must check THAT
        // project's own apiKeyStore (D1), which the generic gate (bound to the single
        // top-level `app`) cannot express. Registry-less mode (`mountRegistry`
        // undefined): this whole branch is unreachable — every request falls through to
        // the EXACT same code path as before SPEC-078 (R-15).
        if (mountRegistry !== undefined) {
          const projectMatch = matchProjectPrefix(url.pathname);
          if (projectMatch !== null) {
            const response = await dispatchProjectRequest(req, url, projectMatch, mountRegistry, app, getMachineAuth);
            return applyCorsOrigin(response, origin);
          }
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

        // SPEC-078 D7 — GET /api/projects (registry-level health/switcher
        // projection). Only reachable when a registry was supplied; inherits the
        // EXACT SAME cookie-or-bearer auth duality as every other v1 GET route via
        // the gate just above — no bespoke auth logic in this branch.
        if (mountRegistry !== undefined && req.method === "GET" && url.pathname === "/api/projects") {
          return applyCorsOrigin(
            handleGetProjects(mountRegistry, { port: server.port ?? port, registryName: instanceRegistryName }),
            origin,
          );
        }

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
