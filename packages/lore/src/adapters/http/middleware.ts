/**
 * HTTP middleware utilities — JSON helpers, CORS, error formatting.
 * Public surface: jsonOk, jsonError, loreErrorToStatus, loreErrorResponse, corsHeaders,
 *   isOriginAllowed, corsPreflightResponse, applyCorsOrigin, parseJsonBody,
 *   emitDashboardTelemetry.
 * Invariants:
 *   - corsHeaders() never returns an Access-Control-Allow-Origin value — origin echoing is
 *     request-scoped and applied exactly once, at the outermost Bun.serve fetch boundary
 *     (index.ts), via corsPreflightResponse / applyCorsOrigin. This keeps every downstream
 *     route handler (routes.ts, dashboard-routes.ts) free of CORS/origin plumbing — SSOT.
 *   - Access-Control-Allow-Origin is a case-sensitive echo of the request's Origin header,
 *     only when that Origin is a member of the active allowlist. No wildcard is ever
 *     emitted. Requests with no Origin header (non-browser bearer-token API clients) get no
 *     Allow-Origin header at all — correct, since CORS is a browser-enforced mechanism and
 *     non-browser callers never evaluate it. Source: SPEC-027 AC-DH-5.
 *   - isOriginAllowed / corsPreflightResponse / applyCorsOrigin all take an OPTIONAL
 *     `allowedOrigins` parameter, defaulting to `ALLOWED_ORIGINS` (auth.ts's default-port
 *     8787/5173 list) — production `index.ts` threads the server's ACTUAL configured
 *     allowlist (`HttpConfig.allowedOrigins`, built via `auth.ts::buildAllowedOrigins`) so
 *     a non-default `--dashboard-port`/`--api-port` pair is honored; every pre-existing
 *     direct call site (tests, this module's own default) keeps working unchanged.
 *     Source: task-dashboard-bootstrap-origin-allowlist-hardcodes-port-5173.
 * Side-effect class: pure (all functions).
 */

import type { LoreError } from "@lore/core";
import { ALLOWED_ORIGINS } from "./auth.js";
import type { App } from "../../app.js";

// ─── JSON response helpers ──────────────────────────────────────────────────

/** Build a JSON Response with standard Lore envelope. */
export function jsonOk<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status,
    headers: corsHeaders({ "Content-Type": "application/json" }),
  });
}

/** Build an error JSON Response with standard Lore envelope. */
export function jsonError(error: unknown, status: number): Response {
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: corsHeaders({ "Content-Type": "application/json" }),
  });
}

// ─── Error → HTTP status mapping ────────────────────────────────────────────

/** Map a LoreError code to an HTTP status code per SPEC-011 §5. */
export function loreErrorToStatus(error: LoreError): number {
  switch (error.code) {
    case "DOC_NOT_FOUND":
    case "SLUG_NOT_FOUND":
      return 404;
    case "VALIDATION_ERROR":
    case "SCHEMA_VIOLATION":
      return 422;
    case "STALE_VERSION":
    // reason: CLAIM_CONFLICT is a write-contention error like STALE_VERSION — same
    // HTTP semantics (409 Conflict). Source: SPEC-025 §4 AC-WF-3.
    case "CLAIM_CONFLICT":
      return 409;
    case "DELETE_REQUIRES_CONFIRM":
      return 400;
    case "STORE_ERROR":
      return 500;
    case "AI_PROVIDER_ERROR":
      // reason: AI generation is CLI-only in SPEC-017 — HTTP adapter doesn't trigger AI.
      // Mapping to 500 keeps the HTTP layer safe for future AI-over-HTTP scenarios.
      return 500;
    case "LINK_CYCLE":
    case "DUPLICATE_SLUG":
    case "DUPLICATE_LINK":
    case "INVALID_TRANSITION":
    case "PARENT_REQUIRED":
    case "INVALID_PARENT_TYPE":
      return 422;
    // reason: NEEDS_APPROVAL (SPEC-039 M2) has no HTTP route today (`lore verify` is
    // CLI/MCP-only) — mapped alongside the other request-rejected-as-invalid codes for
    // when/if a verify route is added. Source: SPEC-039 §M2.
    case "NEEDS_APPROVAL":
      return 422;
    default: {
      const _exhaustive: never = error;
      void _exhaustive;
      return 500;
    }
  }
}

/** Build a Response from a LoreError, using correct HTTP status. */
export function loreErrorResponse(error: LoreError): Response {
  return jsonError(error, loreErrorToStatus(error));
}

// ─── CORS ───────────────────────────────────────────────────────────────────

/**
 * Base CORS headers shared by every response (methods + allowed request headers).
 * Deliberately excludes Access-Control-Allow-Origin — that header is request-scoped
 * (depends on the caller's Origin) and is applied once at the fetch boundary via
 * {@link corsPreflightResponse} / {@link applyCorsOrigin}, never hardcoded here.
 */
export function corsHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    // reason: X-Lore-Token is used by POST /api/auth/local-bootstrap (SPEC-016 §3.2).
    // If-Match / X-Force-Overwrite are used by PATCH /api/dashboard/docs/:id (SPEC-022 §9.4).
    // Including them here ensures CORS preflight allows them when accessed directly (not via Vite proxy).
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Lore-Token, If-Match, X-Force-Overwrite",
    ...extra,
  };
}

/**
 * Check whether a request Origin header value is in the active allowlist.
 * Reused as the single source of truth for CORS origin echoing (SPEC-027 AC-DH-5) —
 * do not introduce a second allowlist.
 *
 * @param origin - The request's `Origin` header value, or null if absent (non-browser caller).
 * @param allowedOrigins - The allowlist to check against; defaults to the default-port
 *   `ALLOWED_ORIGINS` (auth.ts). Production callers pass the server's actual configured
 *   allowlist (`HttpConfig.allowedOrigins`, index.ts) so a non-default port is honored.
 * @returns true iff origin is present and exactly matches an entry in allowedOrigins.
 */
export function isOriginAllowed(origin: string | null, allowedOrigins: readonly string[] = ALLOWED_ORIGINS): origin is string {
  return origin !== null && allowedOrigins.includes(origin);
}

/**
 * Build the CORS preflight (OPTIONS) response.
 * Echoes the caller's Origin + Vary: Origin only when it is allowlisted; otherwise omits
 * Access-Control-Allow-Origin entirely (never a wildcard, never a disallowed echo).
 *
 * @param origin - The preflight request's `Origin` header value, or null if absent.
 * @param allowedOrigins - The allowlist to check against; defaults to `ALLOWED_ORIGINS`.
 */
export function corsPreflightResponse(origin: string | null, allowedOrigins: readonly string[] = ALLOWED_ORIGINS): Response {
  const extra = isOriginAllowed(origin, allowedOrigins)
    ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" }
    : {};
  return new Response(null, { status: 204, headers: corsHeaders(extra) });
}

/**
 * Apply request-scoped CORS origin headers to an already-built Response.
 * This is the single application point for Access-Control-Allow-Origin across the whole
 * HTTP adapter (SPEC-027 AC-DH-5) — called once, at the Bun.serve fetch boundary
 * (index.ts), after every route handler has produced its Response. Route handlers
 * (routes.ts, dashboard-routes.ts) never need to know the request Origin themselves.
 *
 * @param response - The Response produced by a route handler (jsonOk / jsonError / custom).
 * @param origin - The request's `Origin` header value, or null if absent.
 * @param allowedOrigins - The allowlist to check against; defaults to `ALLOWED_ORIGINS`.
 * @returns The same response when origin is absent or not allowlisted (no header added —
 *   correct for non-browser bearer-token callers, which never send Origin). A new Response
 *   with Access-Control-Allow-Origin + Vary: Origin set when origin is allowlisted.
 */
export function applyCorsOrigin(response: Response, origin: string | null, allowedOrigins: readonly string[] = ALLOWED_ORIGINS): Response {
  if (!isOriginAllowed(origin, allowedOrigins)) return response;

  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.append("Vary", "Origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// ─── Body parsing ───────────────────────────────────────────────────────────

/** Parse request body as JSON. Returns null on empty body or parse error. */
export async function parseJsonBody(req: Request): Promise<unknown> {
  const contentType = req.headers.get("Content-Type") ?? "";
  if (!contentType.includes("application/json")) return null;

  try {
    return await req.json() as unknown;
  } catch {
    return null;
  }
}

// ─── Dashboard telemetry ────────────────────────────────────────────────────

/**
 * Emit a dashboard-sourced telemetry event after a successful write. Separate
 * from the service-internal event so `source:"dashboard"` is recorded
 * (SPEC-022 §9.6). Swallows all errors (telemetry must never fail the caller).
 *
 * Lives here (not in `dashboard-routes.ts`) so both `dashboard-routes.ts` and
 * `config-routes.ts` (SPEC-062 D4) can call it without one importing the other
 * — importing it FROM `dashboard-routes.ts` would create a circular dependency,
 * since `dashboard-routes.ts` also imports `handleDashboardConfigPatch` from
 * `config-routes.ts` to dispatch `PATCH /api/dashboard/config`.
 *
 * @param app - Wired application instance (needs `telemetry`).
 * @param method - The dashboard action name (e.g. "create", "update", "config_update").
 * @param meta - Arbitrary event metadata.
 */
export function emitDashboardTelemetry(
  app: App,
  method: string,
  meta: Record<string, unknown>,
): void {
  try {
    app.telemetry.record({
      ts: new Date().toISOString(),
      service: "dashboard",
      method,
      ok: true,
      duration_ms: 0,
      source: "dashboard",
      meta,
    });
  } catch {
    // reason: telemetry failures MUST NOT break write operations (mirrors service invariant)
  }
}
