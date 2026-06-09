/**
 * HTTP middleware utilities — JSON helpers, CORS, error formatting.
 * All functions are pure helpers with no side effects.
 */

import type { LoreError } from "../../core/errors.js";

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
      return 409;
    case "DELETE_REQUIRES_CONFIRM":
      return 400;
    case "STORE_ERROR":
      return 500;
    case "LINK_CYCLE":
    case "DUPLICATE_SLUG":
    case "DUPLICATE_LINK":
    case "INVALID_TRANSITION":
    case "PARENT_REQUIRED":
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

/** Permissive CORS headers for internal use. */
export function corsHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    ...extra,
  };
}

/** Handle CORS preflight OPTIONS request. */
export function corsPreflightResponse(): Response {
  return new Response(null, { status: 204, headers: corsHeaders() });
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
