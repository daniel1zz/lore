/**
 * Dashboard write route handlers — /api/dashboard/* namespace.
 * Purpose: eight write endpoints for the browser dashboard (SPEC-022 §9.3, SPEC-027 AC-DH-6/7).
 *   All routes require cookie-based authentication (AC-DASH-WRITE-9: bearer → 403).
 *   All writes flow through existing CorpusService / ReviewService / VersionService (SPEC-022 §9.5).
 *   Telemetry: emits source:"dashboard" events per AC-DASH-WRITE-TEL-1.
 * Public surface: handleDashboardRoute
 * Invariants:
 *   - CSRF: an `Origin` header present but not in `ALLOWED_ORIGINS` (auth.ts, checked via
 *     `middleware.ts::isOriginAllowed` — the SAME allowlist `POST /api/auth/local-bootstrap`
 *     uses, never a second one) → 403 on any write endpoint, checked BEFORE the cookie-actor
 *     guard. A MISSING Origin header is NOT rejected (see `assertAllowedOrigin` doc comment) —
 *     defense-in-depth alongside SameSite=Strict, not a replacement for it.
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
 *     Requires `?confirm=true`, mirroring the DELETE route's query-param gate
 *     (SPEC-027 AC-DH-11). `VersionService` has no confirm concept of its own — the
 *     gate is checked in this route before the service is ever called, using a
 *     route-local `RESTORE_REQUIRES_CONFIRM` code (400) rather than reusing
 *     `DELETE_REQUIRES_CONFIRM`: the operation is a restore, not a delete, and that
 *     LoreError variant lives in `@lore/core` (out of scope for this hardening
 *     pass) — naming the code after the actual verb keeps a client's error-code
 *     branch honest instead of overloading a delete-specific code.
 *     Restoring a version number that does not exist is a DIFFERENT failure and is
 *     NOT gated by confirm — it surfaces `VersionService.restore`'s own
 *     `DOC_NOT_FOUND` (404, via loreErrorResponse), explicitly chosen over
 *     `VALIDATION_ERROR`: the `version` argument already passed shape validation
 *     (positive integer) by the time the service is called, so the failure is "this
 *     specific historical snapshot isn't there" — the same class of failure as
 *     looking up a doc id that doesn't exist — not a malformed request.
 *   - Approve/reject run the SAME implicit calibration hook the CLI `approve`/`reject`
 *     commands run (`../../flows/calibration-hook.ts::runCalibrationHook`, SPEC-033
 *     F1) — calibration data must never be adapter-specific. The hook runs against
 *     the PRE-action doc version (mirrors CLI semantics exactly: approve pairs
 *     against `result.value.version - 1` since `ReviewService.approve` bumps the
 *     version; reject pairs against `result.value.version` unchanged since
 *     `ReviewService.reject` never bumps it). A hook failure is collected via the
 *     hook's optional `onWarning` callback into the response's `warnings: string[]`
 *     — it is NEVER a 5xx and NEVER rolls back the already-succeeded approve/reject
 *     (the hook's own invariant: calibration is a byproduct, never a gate). An
 *     optional `calibration_note` field in the request body flows through to the
 *     hook's `note` param (→ `delta_reasons[0]` on the persisted calibration row).
 * Side-effect class: IO (delegates to service layer)
 * Source: SPEC-022 §9.1, §9.3, §9.4, §9.5, §9.6; SPEC-027 AC-DH-6, AC-DH-7, AC-DH-11; SPEC-033 F1
 */

import type { App } from "../../app.js";
import type { ActorContext } from "./auth.js";
import type { DocPatch, LinkType } from "@lore/core";
import { createDocInputSchema } from "@lore/core";
import { jsonOk, jsonError, loreErrorResponse, parseJsonBody, isOriginAllowed, emitDashboardTelemetry } from "./middleware.js";
import { checkConcurrency, resolveExpectedVersion, buildConflictPayload } from "./concurrency.js";
import { runCalibrationHook } from "../../flows/calibration-hook.js";
import { handleDashboardConfigPatch, handleDashboardMachineConfigPatch } from "./config-routes.js";

// ─── CSRF Origin guard ────────────────────────────────────────────────────────

/**
 * Reject a state-changing dashboard request whose `Origin` header is present but not in
 * the SPEC-016 allowlist (`ALLOWED_ORIGINS`, checked via the shared `isOriginAllowed` —
 * no second allowlist). Defense-in-depth alongside `SameSite=Strict` + `assertCookieActor`:
 * SameSite blocks cross-site cookie attachment in modern browsers, but this catches
 * browsers/proxies that don't fully honor it.
 *
 * A request with NO `Origin` header is intentionally NOT rejected here — same-origin GETs
 * and non-browser cookie-bearing clients routinely omit it, and CORS/Origin checking is a
 * browser-enforced mechanism that non-browser callers never evaluate anyway (the same
 * "absent Origin ⇒ non-browser, not a CSRF vector" convention `middleware.ts`'s
 * `applyCorsOrigin` already documents). Only a present-and-disallowed Origin is evidence of
 * an actual cross-site browser request.
 *
 * @param req - Incoming request.
 * @returns 403 Response when Origin is present and disallowed, null otherwise.
 */
function assertAllowedOrigin(req: Request): Response | null {
  const origin = req.headers.get("Origin");
  if (origin !== null && !isOriginAllowed(origin)) {
    return jsonError(
      { code: "VALIDATION_ERROR", field: "Origin", message: `Origin not in allowlist: ${origin}` },
      403,
    );
  }
  return null;
}

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

// ─── Path matching helpers ────────────────────────────────────────────────────

type DashboardPathMatch =
  | { type: "create" }
  | { type: "patch"; id: string }
  | { type: "approve"; id: string }
  | { type: "reject"; id: string }
  | { type: "createLink"; id: string }
  | { type: "deleteLink"; id: string; linkId: string }
  | { type: "deleteDoc"; id: string }
  | { type: "restore"; id: string }
  | { type: "configPatch" }
  | { type: "machineConfigPatch" };

function matchDashboardPath(method: string, path: string): DashboardPathMatch | null {
  // POST /api/dashboard/docs
  if (method === "POST" && path === "/api/dashboard/docs") {
    return { type: "create" };
  }

  // PATCH /api/dashboard/config (SPEC-062 D4) — checked before the /docs/:id patterns
  // below since "config" would otherwise never collide with them anyway, but kept
  // early for readability (config is a distinct, non-doc resource).
  if (method === "PATCH" && path === "/api/dashboard/config") {
    return { type: "configPatch" };
  }

  // PATCH /api/dashboard/config/machine (SPEC-064 D6) — machine-scope sibling,
  // checked before /docs/:id for the same readability reason above. A distinct
  // literal path (not a ?scope= query param) keeps this exact-string dispatch
  // table one-entry-per-resource, matching every other route below.
  if (method === "PATCH" && path === "/api/dashboard/config/machine") {
    return { type: "machineConfigPatch" };
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
 *
 * BUG-003 (audit finding) fix — TWO independent conflict-detection layers, not one:
 *   1. `checkConcurrency` (unchanged) — an advisory PRECHECK against the single
 *      `currentDoc` snapshot read below. Fast-rejects the common case, but cannot see
 *      a second writer committing BETWEEN this read and step 2's `set()` call.
 *   2. `app.corpusService.set(..., {expectedVersion})` — the REAL race-safe guard.
 *      The client's declared `If-Match` version (via `resolveExpectedVersion`, the
 *      SAME headers `checkConcurrency` reads) is threaded straight into `set`'s CAS,
 *      REPLACING `set`'s own pre-fix internal fresh-read-based guard. A race that
 *      slips past layer 1 (both writers' precheck reads land before either commits)
 *      is now caught here: `set` returns `STALE_VERSION`, rendered as the SAME
 *      `{current, mine, diff}` ConflictPayload shape via `buildConflictPayload` (a
 *      fresh read of the doc, since `currentDoc` above is now stale) — the frontend's
 *      existing `mutations.ts` STALE_VERSION handling (built for exactly this shape)
 *      renders the ConflictModal instead of a generic error toast.
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

  // Optimistic concurrency check (SPEC-022 §9.4) — layer 1, see this function's JSDoc.
  const clientContent = typeof patch.content === "string" ? patch.content : currentDoc.content;
  const conflict = checkConcurrency(req, currentDoc, clientContent);
  if (conflict !== null) {
    return jsonError(conflict, 409);
  }

  // Layer 2 — see this function's JSDoc. `expectedVersion` is derived from the
  // request's own headers, independent of the (possibly already-stale-by-now)
  // `currentDoc` snapshot above.
  const expectedVersion = resolveExpectedVersion(req);
  const result = await app.corpusService.set(
    id,
    patch,
    expectedVersion !== undefined ? { expectedVersion } : undefined,
  );
  if (!result.ok) {
    if (result.error.code === "STALE_VERSION") {
      const latestResult = await app.corpusService.get(id);
      if (latestResult.ok) {
        return jsonError(buildConflictPayload(latestResult.value.doc, clientContent), 409);
      }
      // reason: the doc vanished between the failed CAS and this re-read (e.g. a
      // concurrent delete) — fall through to the generic STALE_VERSION error below,
      // still a 409 (loreErrorToStatus), just without the rich diff payload.
    }
    return loreErrorResponse(result.error);
  }

  emitDashboardTelemetry(app, "update", {
    doc_id: result.value.id,
    status_changed: result.value.status !== currentDoc.status,
    reviewer: actor.owner ?? actor.name,
  });
  return jsonOk({ doc: result.value });
}

/**
 * Extract an optional `calibration_note` string field from an already-parsed
 * JSON body (or `undefined` when the body is absent/malformed/lacks the field).
 * Shared by {@link handleDashboardApprove} and {@link handleDashboardReject} —
 * both feed this straight into `runCalibrationHook`'s `note` param.
 */
function extractCalibrationNote(body: unknown): string | undefined {
  if (body === null || typeof body !== "object" || !("calibration_note" in body)) return undefined;
  const value = (body as Record<string, unknown>)["calibration_note"];
  return typeof value === "string" ? value : undefined;
}

/**
 * POST /api/dashboard/docs/:id/approve — transition document to approved status.
 * Uses session actor's owner as the reviewer identity (AC-DASH-WRITE-7).
 * Runs the shared implicit calibration hook (SPEC-033 F1) against the
 * PRE-action version (`result.value.version - 1` — approve bumps the version).
 * Returns 200 with `{ doc, warnings }` — `warnings` is non-empty only when the
 * calibration hook hit a genuine IO failure; the approve itself already
 * succeeded and is never rolled back for a calibration failure.
 */
async function handleDashboardApprove(
  req: Request,
  id: string,
  app: App,
  actor: ActorContext,
): Promise<Response> {
  // reason: SPEC-022 Q3 — session user is the reviewer. Actor.owner is the api_keys.owner
  // field (e.g. "admin" or the user's email if set at key creation). Fallback to actor.name
  // (api_key_name) when owner is absent to ensure reviewer is never empty.
  const reviewer = actor.owner ?? actor.name;
  const body = await parseJsonBody(req);
  const calibrationNote = extractCalibrationNote(body);

  const result = await app.reviewService.approve(id, { reviewer });
  if (!result.ok) return loreErrorResponse(result.error);

  emitDashboardTelemetry(app, "approve", { doc_id: result.value.id, reviewer });

  const warnings: string[] = [];
  // reason: ReviewService.approve() bumps doc.version by 1 as part of the draft →
  // approved transition — the version the human was reviewing (and that a judgment
  // would be pinned to) is one less than the returned doc's version. Mirrors CLI
  // approve.ts's identical `doc.version - 1` computation exactly.
  await runCalibrationHook(
    { judgmentService: app.judgmentService, telemetry: app.telemetry, onWarning: (message: string) => warnings.push(message) },
    {
      updatedDoc: result.value,
      actedOnVersion: result.value.version - 1,
      humanAction: "approve",
      actor: reviewer,
      ...(calibrationNote !== undefined ? { note: calibrationNote } : {}),
    },
  );

  return jsonOk({ doc: result.value, warnings });
}

/**
 * POST /api/dashboard/docs/:id/reject — transition document to draft status with reason.
 * Runs the shared implicit calibration hook (SPEC-033 F1) against the doc's
 * CURRENT version (reject never bumps version).
 * Returns 200 with `{ doc, warnings }` — see {@link handleDashboardApprove} for the
 * `warnings` contract.
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
  const calibrationNote = extractCalibrationNote(body);

  const reviewer = actor.owner ?? actor.name;
  const result = await app.reviewService.reject(id, { reviewer, ...(reason !== undefined ? { reason } : {}) });
  if (!result.ok) return loreErrorResponse(result.error);

  emitDashboardTelemetry(app, "reject", { doc_id: result.value.id, reviewer });

  const warnings: string[] = [];
  // reason: ReviewService.reject() never bumps doc.version (status stays 'draft') —
  // the version the human was reviewing IS the returned doc's version. Mirrors CLI
  // reject.ts's identical (unchanged) version computation exactly.
  await runCalibrationHook(
    { judgmentService: app.judgmentService, telemetry: app.telemetry, onWarning: (message: string) => warnings.push(message) },
    {
      updatedDoc: result.value,
      actedOnVersion: result.value.version,
      humanAction: "reject",
      actor: reviewer,
      ...(calibrationNote !== undefined ? { note: calibrationNote } : {}),
    },
  );

  return jsonOk({ doc: result.value, warnings });
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
 * Requires `?confirm=true` (SPEC-027 AC-DH-11), mirroring the DELETE route's gate —
 * missing confirm → RESTORE_REQUIRES_CONFIRM (400). See module header for why this
 * is a route-local code rather than the shared `DELETE_REQUIRES_CONFIRM`.
 * Returns 200 with { doc: DocRecord }. Invalid/missing version → VALIDATION_ERROR (422).
 * A well-formed but nonexistent version → DOC_NOT_FOUND (404, see module header).
 */
async function handleDashboardRestore(
  req: Request,
  id: string,
  app: App,
): Promise<Response> {
  const confirm = new URL(req.url).searchParams.get("confirm") === "true";
  if (!confirm) {
    return jsonError(
      { code: "RESTORE_REQUIRES_CONFIRM", id, message: "Restore requires ?confirm=true" },
      400,
    );
  }

  const body = await parseJsonBody(req);
  if (body === null || typeof body !== "object") {
    return jsonError({ code: "VALIDATION_ERROR", field: "body", message: "Request body must be JSON with 'version'" }, 422);
  }

  const { version } = body as Record<string, unknown>;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return jsonError({ code: "VALIDATION_ERROR", field: "version", message: "'version' must be a positive integer" }, 422);
  }

  // reason: a nonexistent version surfaces VersionService.restore's own DOC_NOT_FOUND
  // (404) unmodified — see module header for why this is the correct contract and
  // not VALIDATION_ERROR.
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

  // CSRF Origin guard — applies to ALL dashboard write endpoints, checked BEFORE the
  // cookie-actor guard (fail on the cheaper, header-only check first).
  const originGuardResponse = assertAllowedOrigin(req);
  if (originGuardResponse !== null) return originGuardResponse;

  // Cookie-only guard (AC-DASH-WRITE-9) — applies to ALL dashboard write endpoints.
  const guardResponse = assertCookieActor(actor);
  if (guardResponse !== null) return guardResponse;

  switch (match.type) {
    case "create":
      return handleDashboardCreate(req, app, actor);
    case "patch":
      return handleDashboardPatch(req, match.id, app, actor);
    case "approve":
      return handleDashboardApprove(req, match.id, app, actor);
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
    case "configPatch":
      return handleDashboardConfigPatch(req, app, actor);
    case "machineConfigPatch":
      return handleDashboardMachineConfigPatch(req, app, actor);
  }
}
