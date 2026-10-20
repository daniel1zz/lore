/**
 * HTTP server — Bun.serve() wrapper that mounts the API router and auth middleware.
 * Source: SPEC-011 §4, §6; SPEC-016 §3.3 (cookie-first auth + bootstrap route);
 *   SPEC-078 D4/D7/D8 (multi-project path shim + GET /api/projects)
 */

import type { Invocation } from "@lore/core";
import { warnSinkOf } from "../../service/warn-sink.js";
import { randomUUID } from "node:crypto";

import type { App } from "../../app.js";
import { authenticateRequest, extractSessionCookie, ALLOWED_ORIGINS, type ActorContext } from "./auth.js";
import { dispatchUnderRequestParty } from "./request-identity.js";
import { handleApiRoute, handleLocalBootstrap } from "./routes.js";
import { jsonError, corsPreflightResponse, applyCorsOrigin, loreErrorToStatus } from "./middleware.js";
import { createMachineAuthStores, type MachineAuthStores } from "./machine-auth.js";
import { handleGetProjects } from "./projects-route.js";
import { createDashboardHandler, type DashboardServingConfig } from "./static-serving.js";
// reason: TYPE-ONLY import — the bun-only MountRegistry RUNTIME (`../../mount/mount-registry.js`,
// T5) transitively imports `bun:sqlite`; this file only ever consumes the pure interface
// contract (`../../mount/types.js`, T3), never constructs a registry itself. The production
// registry is built once (`lore dashboard`, T8 deliverable 3) and injected via `HttpConfig`.
import type { MountEntry, MountRegistry } from "../../mount/types.js";
import { runWithAuditSurface } from "../../store/audit-surface.js";

/**
 * Run an authenticated request's route dispatch with its audit surface declared
 * (AC-BLC-1): `http_cookie` vs `http_token` is per-REQUEST, so it is carried by
 * AsyncLocalStorage, not process state. A missing `callerSurface` on an
 * authenticated actor is a wiring bug - fail loud, never default.
 */
function dispatchWithAuditSurface(
  actor: { readonly callerSurface?: "http_cookie" | "http_token" },
  dispatch: () => Promise<Response | null>,
): Promise<Response | null> {
  if (actor.callerSurface === undefined) {
    throw new Error("authenticated actor has no callerSurface - cannot attribute the audit surface");
  }
  return runWithAuditSurface(actor.callerSurface, dispatch);
}

/**
 * Dispatch an authenticated request's route handling as its party (BR-1055, spec-every-write-is-made-by-a-known-party-
 * an-attested-agent-run): a write is made by the bearer key's name or the dashboard login under a run registered for
 * it, never by the serve process's own identity. A write whose party cannot be registered is answered with that error
 * and nothing is written.
 */
async function dispatchAsRequestParty(
  app: App,
  actor: ActorContext,
  req: Request,
  dispatch: () => Promise<Response | null>,
): Promise<Response | null> {
  const outcome = await dispatchUnderRequestParty(app, actor, req.method, () => dispatchWithAuditSurface(actor, dispatch));
  if (!outcome.ok) return jsonError(outcome.error, loreErrorToStatus(outcome.error));
  return outcome.value;
}

export interface HttpConfig {
  port?: number;
  host?: string;
  /**
   * The writers of the run that started the server: the "running at" banner goes to `io.stdout`, an unhandled request
   * error and the machine-auth advisories go to `io.stderr`. REQUIRED: the server never writes a process stream.
   */
  io: Invocation["io"];
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
   * Directory the lazily-built machine-scope auth stores open in when `machineAuth` is not given
   * (`resolveMachineAuthBaseDir(inv.env, inv.paths.home)` at the entry). A request that needs the stores while
   * neither is configured fails loud — the server never resolves a state path from the process itself.
   */
  machineAuthBaseDir?: string;
  /**
   * Multi-project mount registry (SPEC-078 D2/D4/D7) — when supplied, this server ALSO
   * accepts project-addressed traffic under `/api/p/:name/*` (path-rewrite shim, D4) and
   * `GET /api/projects` (D7 registry+identity projection). Omitted (registry-less mode,
   * the default): the whole multi-mode branch below is completely inert — every request
   * takes EXACTLY the same path it did before SPEC-078 (R-15), byte-identical.
   */
  mountRegistry?: MountRegistry<App>;
  /**
   * Origin allowlist for CSRF/bootstrap Origin checks (`POST /api/auth/local-bootstrap`
   * and `/api/dashboard/*`'s CSRF guard) — defaults to `ALLOWED_ORIGINS` (auth.ts's
   * default-port 8787/5173 list) when omitted, byte-identical to pre-existing behavior.
   * A caller running the API and the Vite dev server on non-default ports MUST compute
   * its own allowlist via `auth.ts::buildAllowedOrigins(apiPort, dashPort)` and pass it
   * here — `lore dashboard` does this with the REAL port it launches Vite on (task-
   * dashboard-bootstrap-origin-allowlist-hardcodes-port-5173): otherwise a request from
   * that actual origin 403s and the SPA never mints a session cookie.
   */
  allowedOrigins?: readonly string[];
  /**
   * Packaged-mode dashboard static serving + nonce auth (spec-dashboard-production-
   * packaging-one-command-lore-dashboard DD-1..DD-4) — omitted (the default): this
   * server behaves EXACTLY as before this field existed, every non-`/api` request still
   * falls through to the pre-existing generic `404`. Supplied: `GET /auth/bootstrap`,
   * exact static asset matches, and the SPA fallback are all dispatched per DD-4's order,
   * strictly AFTER the untouched `/api/*` branch above (unknown `/api/*` never falls
   * through to a static/SPA response). See `static-serving.ts` for the full contract.
   */
  dashboard?: DashboardServingConfig;
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

/** `GET /api/health`'s `dashboard` field shape (Observability section, spec-dashboard-
 * production-packaging-one-command-lore-dashboard: "`dashboard: { embedded, digest,
 * builtAt, skipped? }`"). `exactOptionalPropertyTypes` means `digest`/`builtAt`/`skipped`
 * must be OMITTED, never assigned `undefined`, when `embedded` is `false` — see
 * {@link resolveDashboardHealthStamp}. */
interface DashboardHealthStamp {
  embedded: boolean;
  digest?: string;
  builtAt?: string;
  skipped?: boolean;
}

/**
 * Resolve the DD-1 dashboard build stamp for `GET /api/health` (Observability section,
 * AC-F5A-1/AC-F5A-8). `config.dashboard` is `HttpConfig.dashboard` — `undefined` for a
 * server instance with dashboard serving disabled entirely (plain `lore serve`,
 * `--dev`), which this function treats identically to "configured but the DD-1
 * loader/fixture currently reports assets unavailable" (a fresh clone before `bun run
 * build`): both collapse to `{ embedded: false }`, NEVER a fabricated `digest`/`builtAt`
 * (Failure Modes table: "Source-run packaged mode without built assets" must never
 * silently fake freshness).
 *
 * @param dashboard - `HttpConfig.dashboard`, or `undefined` when this server instance
 *   has dashboard serving disabled.
 * @returns Never rejects — `DashboardServingConfig.assets()` is contractually always
 *   resolved (`static-serving.ts`'s own `DashboardAssetsResult` never a thrown error), so
 *   this function trusts that contract rather than adding a redundant try/catch.
 */
async function resolveDashboardHealthStamp(
  dashboard: DashboardServingConfig | undefined,
): Promise<DashboardHealthStamp> {
  if (dashboard === undefined) return { embedded: false };

  const assetsResult = await dashboard.assets();
  if (!assetsResult.available) return { embedded: false };

  const { digest, builtAt, skipped } = assetsResult.manifest.stamp;
  return {
    embedded: true,
    digest,
    builtAt,
    ...(skipped === true ? { skipped: true } : {}),
  };
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
 * `bun:sqlite` throw — see the D8 deleted-corpus-liveness spike,
 * `tests/unit/mount/deleted-corpus-liveness.bun.test.ts`) demotes JUST this one entry
 * to `"error"` (`mountRegistry.markError`) and returns a NAMED 5xx; every other mounted
 * project is completely unaffected by this catch. No dispatch watchdog/timeout wrapper
 * (task-stabilize-deleted-corpus-liveness-bun-test-ts-2-recorded, 2026-07-25): the spike
 * empirically settled on TWO possible outcomes for a broken corpus's next store call —
 * a fast throw (caught right here) or a fast silent self-heal/resolve (falls through to
 * the normal response path, also fine) — but in every recorded run, loaded or not, it
 * has always settled well under a 5000ms ceiling and never once hung. This try/catch
 * exists to attribute the throw branch when it occurs, not to guard against a hang that
 * has never been observed.
 */
async function dispatchProjectRequest(
  req: Request,
  url: URL,
  match: { name: string; rest: string },
  mountRegistry: MountRegistry<App>,
  primaryApp: App,
  getMachineAuth: () => MachineAuthStores,
  allowedOrigins: readonly string[],
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
  // deleted-corpus-liveness spike's throw branch fires on the FIRST store call after
  // the underlying file disappears, which could just as easily be triggered by the
  // bearer-auth lookup below (`entry.app.apiKeyStore`) as by the route body itself.
  // Narrowing the try/catch to only the final delegate call would let that class of
  // failure escape as an unattributed 500 without ever demoting the entry to "error".
  // No watchdog/timeout wrapper around this whole block either (same task as above):
  // the spike's OTHER observed branch — a fast silent resolve — just falls through
  // this try/catch and returns a normal successful response, which is equally fine;
  // neither branch has ever hung.
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

    const mountedApp = entry.app;
    const response = await dispatchAsRequestParty(mountedApp, actor, req, () =>
      handleApiRoute(req, strippedUrl, mountedApp, actor, getMachineAuth, allowedOrigins),
    );
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
 *   GET  /api/health                   — unauthenticated health check + DD-1 dashboard
 *                                          build stamp (Observability section)
 *   POST /api/auth/local-bootstrap     — open route; own auth (X-Lore-Token + Origin)
 *   *    /api/*                        — API routes (cookie OR bearer token required)
 *   GET  /auth/bootstrap               — packaged-mode nonce redemption (DD-2), only when
 *                                          `config.dashboard` is supplied
 *   GET  <static/SPA>                  — packaged-mode dashboard serving (DD-4), only when
 *                                          `config.dashboard` is supplied; every non-`/api`
 *                                          path is otherwise the pre-existing generic 404
 * Returns the server instance (Bun.Server).
 */
export function startHttpServer(app: App, config: HttpConfig): ReturnType<typeof Bun.serve> {
  const port = config.port ?? 3456;
  const hostname = config.host ?? "localhost";
  const mountRegistry = config.mountRegistry;
  // reason: task-dashboard-bootstrap-origin-allowlist-hardcodes-port-5173 — resolved ONCE
  // per server instance (not per-request) and threaded to every Origin-checking call site
  // below. Omitted config.allowedOrigins → default-port ALLOWED_ORIGINS, byte-identical to
  // pre-existing behavior (R-15-style regression guarantee).
  const allowedOrigins = config.allowedOrigins ?? ALLOWED_ORIGINS;
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
    if (machineAuth === undefined) {
      if (config.machineAuthBaseDir === undefined) {
        throw new Error("startHttpServer: a request needs the machine auth stores but neither `machineAuth` nor `machineAuthBaseDir` was configured");
      }
      machineAuth = createMachineAuthStores({ baseDir: config.machineAuthBaseDir, warn: warnSinkOf(config.io.stderr) });
    }
    return machineAuth;
  }

  // reason: DD-4 — built ONCE per server instance (never per-request) so the dashboard
  // handler's internal nonce store's mints survive across requests. `undefined` when
  // `config.dashboard` is omitted — the ENTIRE dashboard branch below is then unreachable,
  // every non-`/api` request takes the exact pre-existing generic-404 path (byte-identical
  // to this field never having existed, mirroring SPEC-078's registry-less-mode guarantee).
  const dashboardHandler = config.dashboard !== undefined ? createDashboardHandler(config.dashboard) : undefined;

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
        return corsPreflightResponse(origin, allowedOrigins);
      }

      // Health check — no auth required
      if (url.pathname === "/health") {
        return applyCorsOrigin(
          new Response(JSON.stringify({ ok: true, status: "healthy" }), {
            headers: { "Content-Type": "application/json" },
          }),
          origin,
          allowedOrigins,
        );
      }

      // All /api/* routes require authentication, EXCEPT /api/auth/local-bootstrap which has own auth.
      if (url.pathname.startsWith("/api/")) {
        // reason: GET /api/health is a second, /api-namespaced health probe (Observability
        // section) that ALSO carries the DD-1 dashboard build stamp — unlike the top-level
        // /health above (a pre-existing, deliberately minimal liveness probe, untouched by
        // this task), this route reports whether the embedded dashboard bundle is available
        // and, if so, its freshness digest. Runs BEFORE the bearer/cookie auth gate below
        // (like local-bootstrap) — a health probe must never itself require a session.
        if (req.method === "GET" && url.pathname === "/api/health") {
          const dashboard = await resolveDashboardHealthStamp(config.dashboard);
          return applyCorsOrigin(
            new Response(JSON.stringify({ ok: true, status: "healthy", dashboard }), {
              headers: { "Content-Type": "application/json" },
            }),
            origin,
            allowedOrigins,
          );
        }

        // reason: POST /api/auth/local-bootstrap bypasses authenticateRequest — it uses X-Lore-Token
        // + Origin allowlist for its own auth. It must run BEFORE the bearer/cookie gate to avoid
        // a chicken-and-egg deadlock (no session yet → no auth → can't bootstrap). SPEC-016 §3.2.
        if (req.method === "POST" && url.pathname === "/api/auth/local-bootstrap") {
          return applyCorsOrigin(await handleLocalBootstrap(req, getMachineAuth(), allowedOrigins), origin, allowedOrigins);
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
            const response = await dispatchProjectRequest(req, url, projectMatch, mountRegistry, app, getMachineAuth, allowedOrigins);
            return applyCorsOrigin(response, origin, allowedOrigins);
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
          return applyCorsOrigin(jsonError({ code: "UNAUTHORIZED", message: "Invalid or missing API key" }, 401), origin, allowedOrigins);
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
            allowedOrigins,
          );
        }

        const response = await dispatchAsRequestParty(app, actor, req, () =>
          handleApiRoute(req, url, app, actor, getMachineAuth, allowedOrigins),
        );

        if (response === null) {
          return applyCorsOrigin(
            jsonError({ code: "NOT_FOUND", message: `Route not found: ${req.method} ${url.pathname}` }, 404),
            origin,
            allowedOrigins,
          );
        }

        return applyCorsOrigin(response, origin, allowedOrigins);
      }

      // DD-4 — dashboard static serving + `/auth/bootstrap`, strictly AFTER the `/api/*`
      // branch above (an unknown `/api/*` route already returned its JSON 404 and never
      // reaches here). Undefined `dashboardHandler` (dashboard serving disabled) leaves
      // this whole block inert — falls straight to the pre-existing generic 404 below.
      if (dashboardHandler !== undefined) {
        const dashboardResponse = await dashboardHandler.handle(req, url);
        if (dashboardResponse !== null) {
          return applyCorsOrigin(dashboardResponse, origin, allowedOrigins);
        }
      }

      return applyCorsOrigin(jsonError({ code: "NOT_FOUND", message: "Not Found" }, 404), origin, allowedOrigins);
    },

    error(err) {
      config.io.stderr.write(`[http] Unhandled error: ${err instanceof Error ? err.message : String(err)}\n`);
      return new Response(JSON.stringify({ ok: false, error: { code: "INTERNAL_ERROR", message: "Internal server error" } }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  config.io.stdout.write(`Lore server running at http://${hostname}:${port}\n`);
  config.io.stdout.write(`  API:  http://${hostname}:${port}/api/\n`);

  return server;
}
