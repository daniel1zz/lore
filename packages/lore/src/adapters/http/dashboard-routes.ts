/**
 * Dashboard write route handlers — /api/dashboard/* namespace.
 * Purpose: eight write endpoints for the browser dashboard (SPEC-022 §9.3, SPEC-027 AC-DH-6/7).
 *   All routes require cookie-based authentication (AC-DASH-WRITE-9: bearer → 403).
 *   All writes flow through existing CorpusService / ReviewService / VersionService (SPEC-022 §9.5).
 *   Telemetry: emits source:"dashboard" events per AC-DASH-WRITE-TEL-1.
 * Public surface: handleDashboardRoute
 * Invariants:
 *   - Bearer-token actor (callerSurface="http_token") → 403 on any write endpoint.
 *   - PATCH /api/dashboard/docs/:id checks If-Match header for optimistic concurrency.
 *   - X-Force-Overwrite: 1 bypasses the version check (force write).
 *   - Stale version → 409 with { current, mine, diff } payload.
 *   - Approve uses session actor.owner as the reviewer identity.
 *   - LINK_CYCLE error → 422 (handled by loreErrorResponse SSOT in middleware.ts).
 *   - DELETE /api/dashboard/docs/:id is a soft delete (30-day recoverable) — reuses
 *     CorpusService.delete, the same service method the bearer-auth v1
 *     `DELETE /api/docs/:id` route calls. Requires `?confirm=true`; the dashboard
 *     UI only issues the request after its own confirmation dialog, but the
 *     server-side confirm gate stays as defense-in-depth (SPEC-027 AC-DH-6).
 *   - POST /api/dashboard/docs/:id/restore is append-only — reuses VersionService.restore,
 *     which creates a new version N+1 rather than mutating history (SPEC-027 AC-DH-7).
 * Side-effect class: IO (delegates to service layer)
 * Source: SPEC-022 §9.1, §9.3, §9.4, §9.5, §9.6; SPEC-027 AC-DH-6, AC-DH-7
 */

import type { App } from "../../app.js";
import type { ActorContext } from "./auth.js";
import type { DocPatch, LinkType } from "@lore/core";
import { createDocInputSchema } from "@lore/core";
import { jsonOk, jsonError, loreErrorResponse, parseJsonBody } from "./middleware.js";
import { checkConcurrency } from "./concurrency.js";

// ─── Cookie-auth guard ────────────────────────────────────────────────────────

/**
 * Assert that the actor used a cookie session (not a bearer token).
 * Dashboard write endpoints are cookie-only (AC-DASH-WRITE-9).
 * Returns a 403 Response for bearer-token actors, null for cookie actors.
 *
 * @param actor - Resolved actor from authenticateRequest.
 * @returns 403 Response or null.
 */
function assertCookieActor(actor: ActorContext): Response | null {
  // reason: callerSurface absent means the actor pre-dates SPEC-024 (test fixtures).
  // We treat absent as "http_token" (most restrictive) to avoid silently allowing
  // bearer auth in tests that didn't opt in to the new surface tagging.
  if (actor.callerSurface !== "http_cookie") {
    return jsonError(
      {
        code: "FORBIDDEN",
        message: "Bearer-token sessions cannot use dashboard write endpoints. Use a cookie session (lore dashboard).",
      },
      403,
    );
  }
  return null;
}

/**
 * Emit a dashboard telemetry event after a successful write.
 * Separate from the service-internal event so source:"dashboard" is recorded.
 * Swallows all errors (telemetry must never fail the caller).
 */
function emitDashboardTelemetry(
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

// ─── Path matching helpers ────────────────────────────────────────────────────

type DashboardPathMatch =
  | { type: "create" }
  | { type: "patch"; id: string }
  | { type: "approve"; id: string }
  | { type: "reject"; id: string }
  | { type: "createLink"; id: string }
  | { type: "deleteLink"; id: string; linkId: string }
  | { type: "deleteDoc"; id: string }
  | { type: "restore"; id: string };

function matchDashboardPath(method: string, path: string): DashboardPathMatch | null {
  // POST /api/dashboard/docs
  if (method === "POST" && path === "/api/dashboard/docs") {
    return { type: "create" };
  }

  // PATCH /api/dashboard/docs/:id
  const patchMatch = path.match(/^\/api\/dashboard\/docs\/([^/]+)$/);
  if (patchMatch?.[1] !== undefined && method === "PATCH") {
    return { type: "patch", id: decodeURIComponent(patchMatch[1]) };
  }

  // DELETE /api/dashboard/docs/:id (soft delete — SPEC-027 AC-DH-6)
  const deleteDocMatch = path.match(/^\/api\/dashboard\/docs\/([^/]+)$/);
  if (deleteDocMatch?.[1] !== undefined && method === "DELETE") {
    return { type: "deleteDoc", id: decodeURIComponent(deleteDocMatch[1]) };
  }

  // POST /api/dashboard/docs/:id/approve
  const approveMatch = path.match(/^\/api\/dashboard\/docs\/([^/]+)\/approve$/);
  if (approveMatch?.[1] !== undefined && method === "POST") {
    return { type: "approve", id: decodeURIComponent(approveMatch[1]) };
  }

  // POST /api/dashboard/docs/:id/reject
  const rejectMatch = path.match(/^\/api\/dashboard\/docs\/([^/]+)\/reject$/);
  if (rejectMatch?.[1] !== undefined && method === "POST") {
    return { type: "reject", id: decodeURIComponent(rejectMatch[1]) };
  }

  // POST /api/dashboard/docs/:id/restore (append-only version restore — SPEC-027 AC-DH-7)
  const restoreMatch = path.match(/^\/api\/dashboard\/docs\/([^/]+)\/restore$/);
  if (restoreMatch?.[1] !== undefined && method === "POST") {
    return { type: "restore", id: decodeURIComponent(restoreMatch[1]) };
  }

  // DELETE /api/dashboard/docs/:id/links/:linkId
  const deleteLinkMatch = path.match(/^\/api\/dashboard\/docs\/([^/]+)\/links\/([^/]+)$/);
  if (deleteLinkMatch?.[1] !== undefined && deleteLinkMatch[2] !== undefined && method === "DELETE") {
    return {
      type: "deleteLink",
      id: decodeURIComponent(deleteLinkMatch[1]),
      linkId: decodeURIComponent(deleteLinkMatch[2]),
    };
  }

  // POST /api/dashboard/docs/:id/links
  const createLinkMatch = path.match(/^\/api\/dashboard\/docs\/([^/]+)\/links$/);
  if (createLinkMatch?.[1] !== undefined && method === "POST") {
    return { type: "createLink", id: decodeURIComponent(createLinkMatch[1]) };
  }

  return null;
}

// ─── Route handlers ───────────────────────────────────────────────────────────

/**
 * POST /api/dashboard/docs — create a new document.
 * Validates body against createDocInputSchema (client-side Zod shortcut + server SSOT).
 * Returns 201 with new DocRecord. Emits source:"dashboard" telemetry.
 */
async function handleDashboardCreate(
  req: Request,
  app: App,
  actor: ActorContext,
): Promise<Response> {
  const body = await parseJsonBody(req);
  if (body === null || typeof body !== "object") {
    return jsonError({ code: "VALIDATION_ERROR", field: "body", message: "Request body must be JSON" }, 422);
  }

  // Zod parse — mirrors what the client validates client-side; server is SSOT.
  const parsed = createDocInputSchema.safeParse(body);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return jsonError(
      {
        code: "VALIDATION_ERROR",
        field: firstIssue?.path.join(".") ?? "body",
        message: firstIssue?.message ?? "Validation failed",
      },
      422,
    );
  }

  const result = await app.corpusService.create(parsed.data);
  if (!result.ok) return loreErrorResponse(result.error);

  emitDashboardTelemetry(app, "create", { doc_id: result.value.id, type: result.value.type });
  return jsonOk({ doc: result.value }, 201);
}

/**
 * PATCH /api/dashboard/docs/:id — edit content/title/priority/tags.
 * Checks If-Match header for optimistic concurrency.
 * Stale version → 409 with { current, mine, diff }.
 * Returns 200 with updated DocRecord. Status auto-reset if approved doc is edited.
 */
async function handleDashboardPatch(
  req: Request,
  id: string,
  app: App,
  actor: ActorContext,
): Promise<Response> {
  const body = await parseJsonBody(req);
  if (body === null || typeof body !== "object") {
    return jsonError({ code: "VALIDATION_ERROR", field: "body", message: "Request body must be JSON" }, 422);
  }

  const patch = body as DocPatch;

  // Load current document to check version and enable diff on conflict.
  const currentResult = await app.corpusService.get(id);
  if (!currentResult.ok) return loreErrorResponse(currentResult.error);
  const currentDoc = currentResult.value.doc;

  // Optimistic concurrency check (SPEC-022 §9.4).
  const clientContent = typeof patch.content === "string" ? patch.content : currentDoc.content;
  const conflict = checkConcurrency(req, currentDoc, clientContent);
  if (conflict !== null) {
    return jsonError(conflict, 409);
  }

  const result = await app.corpusService.set(id, patch);
  if (!result.ok) return loreErrorResponse(result.error);

  emitDashboardTelemetry(app, "update", {
    doc_id: result.value.id,
    status_changed: result.value.status !== currentDoc.status,
    reviewer: actor.owner ?? actor.name,
  });
  return jsonOk({ doc: result.value });
}

/**
 * POST /api/dashboard/docs/:id/approve — transition document to approved status.
 * Uses session actor's owner as the reviewer identity (AC-DASH-WRITE-7).
 * Returns 200 with the approved DocRecord.
 */
async function handleDashboardApprove(
  id: string,
  app: App,
  actor: ActorContext,
): Promise<Response> {
  // reason: SPEC-022 Q3 — session user is the reviewer. Actor.owner is the api_keys.owner
  // field (e.g. "admin" or the user's email if set at key creation). Fallback to actor.name
  // (api_key_name) when owner is absent to ensure reviewer is never empty.
  const reviewer = actor.owner ?? actor.name;

  const result = await app.reviewService.approve(id, { reviewer });
  if (!result.ok) return loreErrorResponse(result.error);

  emitDashboardTelemetry(app, "approve", { doc_id: result.value.id, reviewer });
  return jsonOk({ doc: result.value });
}

/**
 * POST /api/dashboard/docs/:id/reject — transition document to draft status with reason.
 * Returns 200 with the rejected DocRecord.
 */
async function handleDashboardReject(
  req: Request,
  id: string,
  app: App,
  actor: ActorContext,
): Promise<Response> {
  const body = await parseJsonBody(req);
  const reason = (body !== null && typeof body === "object" && "reason" in body)
    ? String((body as Record<string, unknown>)["reason"])
    : undefined;

  const reviewer = actor.owner ?? actor.name;
  const result = await app.reviewService.reject(id, { reviewer, ...(reason !== undefined ? { reason } : {}) });
  if (!result.ok) return loreErrorResponse(result.error);

  emitDashboardTelemetry(app, "reject", { doc_id: result.value.id, reviewer });
  return jsonOk({ doc: result.value });
}

/**
 * POST /api/dashboard/docs/:id/links — add a link from :id to another doc.
 * Body: { to: string, type: LinkType, note?: string }
 * Returns 201 on success. LINK_CYCLE → 422 (via loreErrorResponse).
 */
async function handleDashboardCreateLink(
  req: Request,
  fromId: string,
  app: App,
): Promise<Response> {
  const body = await parseJsonBody(req);
  if (body === null || typeof body !== "object") {
    return jsonError({ code: "VALIDATION_ERROR", field: "body", message: "Request body must be JSON" }, 422);
  }

  const { to, type } = body as Record<string, unknown>;
  if (typeof to !== "string" || to.trim() === "") {
    return jsonError({ code: "VALIDATION_ERROR", field: "to", message: "'to' must be a non-empty string" }, 422);
  }
  if (typeof type !== "string" || type.trim() === "") {
    return jsonError({ code: "VALIDATION_ERROR", field: "type", message: "'type' must be a non-empty string" }, 422);
  }

  const result = await app.corpusService.link(fromId, to.trim(), type.trim() as LinkType);
  if (!result.ok) return loreErrorResponse(result.error);

  return jsonOk({ ok: true }, 201);
}

/**
 * DELETE /api/dashboard/docs/:id/links/:linkId — remove a link from :id to :linkId.
 * Returns 204 on success.
 */
async function handleDashboardDeleteLink(
  fromId: string,
  toId: string,
  app: App,
): Promise<Response> {
  const result = await app.corpusService.unlink(fromId, toId);
  if (!result.ok) return loreErrorResponse(result.error);

  return new Response(null, { status: 204 });
}

/**
 * DELETE /api/dashboard/docs/:id — soft-delete a document (30-day recoverable).
 * Reuses CorpusService.delete (same method the bearer-auth `DELETE /api/docs/:id`
 * route calls). Requires `?confirm=true`; the dashboard UI's confirm dialog is
 * the primary gate, this is a defense-in-depth server-side check.
 * Returns 200 with { id, recoverable_until }. Missing confirm → DELETE_REQUIRES_CONFIRM (400).
 */
async function handleDashboardDelete(
  req: Request,
  id: string,
  app: App,
): Promise<Response> {
  const confirm = new URL(req.url).searchParams.get("confirm") === "true";

  const result = await app.corpusService.delete(id, confirm);
  if (!result.ok) return loreErrorResponse(result.error);

  emitDashboardTelemetry(app, "delete", { doc_id: result.value.id });
  return jsonOk(result.value);
}

/**
 * POST /api/dashboard/docs/:id/restore — restore a document to a previous version.
 * Body: { version: number }. Reuses VersionService.restore — append-only, creates
 * a new version N+1 rather than mutating history (SPEC-027 AC-DH-7).
 * Returns 200 with { doc: DocRecord }. Invalid/missing version → VALIDATION_ERROR (422).
 */
async function handleDashboardRestore(
  req: Request,
  id: string,
  app: App,
): Promise<Response> {
  const body = await parseJsonBody(req);
  if (body === null || typeof body !== "object") {
    return jsonError({ code: "VALIDATION_ERROR", field: "body", message: "Request body must be JSON with 'version'" }, 422);
  }

  const { version } = body as Record<string, unknown>;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return jsonError({ code: "VALIDATION_ERROR", field: "version", message: "'version' must be a positive integer" }, 422);
  }

  const result = await app.versionService.restore(id, version);
  if (!result.ok) return loreErrorResponse(result.error);

  emitDashboardTelemetry(app, "restore", {
    doc_id: result.value.id,
    restored_from_version: version,
    new_version: result.value.version,
  });
  return jsonOk({ doc: result.value });
}

// ─── Route dispatcher ─────────────────────────────────────────────────────────

/**
 * Dispatch dashboard write requests.
 * All routes check cookie auth first; bearer-token sessions get 403.
 * Returns null if the path is not a dashboard route.
 *
 * @param req   - Incoming request.
 * @param url   - Parsed URL.
 * @param app   - Wired application instance.
 * @param actor - Resolved auth actor from the main auth gate.
 * @returns Response or null (null → caller returns 404).
 */
export async function handleDashboardRoute(
  req: Request,
  url: URL,
  app: App,
  actor: ActorContext,
): Promise<Response | null> {
  const method = req.method.toUpperCase();
  const path = url.pathname;

  const match = matchDashboardPath(method, path);
  if (match === null) return null;

  // Cookie-only guard (AC-DASH-WRITE-9) — applies to ALL dashboard write endpoints.
  const guardResponse = assertCookieActor(actor);
  if (guardResponse !== null) return guardResponse;

  switch (match.type) {
    case "create":
      return handleDashboardCreate(req, app, actor);
    case "patch":
      return handleDashboardPatch(req, match.id, app, actor);
    case "approve":
      return handleDashboardApprove(match.id, app, actor);
    case "reject":
      return handleDashboardReject(req, match.id, app, actor);
    case "createLink":
      return handleDashboardCreateLink(req, match.id, app);
    case "deleteLink":
      return handleDashboardDeleteLink(match.id, match.linkId, app);
    case "deleteDoc":
      return handleDashboardDelete(req, match.id, app);
    case "restore":
      return handleDashboardRestore(req, match.id, app);
  }
}
