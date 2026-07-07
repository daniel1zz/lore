/**
 * HTTP API route handler — maps URL patterns to service calls.
 * Each route parses params/query/body, calls the service, and returns a JSON envelope.
 * Source: SPEC-011 §3; SPEC-016 §3.2 (auth routes: local-bootstrap, me, logout);
 *   SPEC-033 F1 (feedback-loop read routes: judgments, audit, calibration stats)
 *
 * SPEC-033 F1 read routes (GET /api/judgments/:docId, GET /api/audit/:docId,
 * GET /api/audit/verify, GET /api/calibration/stats) intentionally sit in THIS
 * dispatcher, not `dashboard-routes.ts` — they are read-only and available to
 * both bearer-token and cookie sessions (same auth duality as every other v1 GET
 * route below), unlike the cookie-only `/api/dashboard/*` WRITE surface.
 */

import type { App } from "../../app.js";
import type { ActorContext } from "./auth.js";
import { ALLOWED_ORIGINS } from "./auth.js";
import { jsonOk, jsonError, loreErrorResponse, parseJsonBody, corsHeaders } from "./middleware.js";
import { handleDashboardRoute } from "./dashboard-routes.js";
import type { ListFilters, SearchFilters } from "../../service/corpus-service.js";
import type { PendingFilters } from "../../service/review-service.js";
import type { CreateDocInput, DocPatch } from "@lore/core";
import type { DocStatus, DocType, LinkType } from "@lore/core";

// ─── Auth route handlers (SPEC-016) ────────────────────────────────────────────

/**
 * POST /api/auth/local-bootstrap — trade raw API key for an HttpOnly session cookie.
 * Verifies Origin against ALLOWED_ORIGINS and X-Lore-Token against api_keys.
 * Called BEFORE authenticateRequest in index.ts (no prior auth required).
 *
 * @param req - Incoming request with X-Lore-Token header and Origin header.
 * @param app - App instance (needs apiKeyStore and sessionStore).
 * @returns 200 + Set-Cookie on success, 403 on bad Origin, 401 on bad token.
 */
export async function handleLocalBootstrap(req: Request, app: App): Promise<Response> {
  // Validate Origin against allowlist — CSRF protection for bootstrap endpoint.
  const origin = req.headers.get("Origin") ?? "";
  if (!(ALLOWED_ORIGINS as readonly string[]).includes(origin)) {
    return jsonError(
      { code: "VALIDATION_ERROR", field: "Origin", message: `Origin not in allowlist: ${origin}` },
      403,
    );
  }

  const token = req.headers.get("X-Lore-Token");
  if (token === null || token.trim() === "") {
    return jsonError(
      { code: "VALIDATION_ERROR", field: "X-Lore-Token", message: "Missing X-Lore-Token header" },
      401,
    );
  }

  // Validate the raw key against api_keys (SHA-256 match).
  const validateResult = await app.apiKeyStore.validate(token.trim());
  if (!validateResult.ok) {
    return jsonError(
      { code: "VALIDATION_ERROR", field: "X-Lore-Token", message: "Invalid token" },
      401,
    );
  }

  if (app.sessionStore === undefined) {
    return jsonError({ code: "STORE_ERROR", message: "Session store not initialised" }, 500);
  }

  const { session_id, expires_at } = app.sessionStore.create(validateResult.value.name);

  // reason: Set-Cookie must be in the Response headers, not in CORS headers.
  // Max-Age=2592000 = 30 days in seconds. Path=/api keeps the cookie scoped to API routes
  // only — Vite's / routes never see it, reducing exposure. SPEC-016 §3.2.
  const cookieValue = `lore_sid=${session_id}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=2592000`;
  const headers = new Headers(corsHeaders({ "Content-Type": "application/json" }));
  headers.set("Set-Cookie", cookieValue);

  return new Response(
    JSON.stringify({ ok: true, data: { session_id, expires_at } }),
    { status: 200, headers },
  );
}

// ─── Route dispatcher ───────────────────────────────────────────────────────

/**
 * Dispatch authenticated API requests to service methods.
 * Returns null if the route is not matched (caller should return 404).
 */
export async function handleApiRoute(
  req: Request,
  url: URL,
  app: App,
  actor: ActorContext,
): Promise<Response | null> {
  const method = req.method.toUpperCase();
  const path = url.pathname;

  // OPTIONS — CORS preflight (already handled in server, but guard here too)
  if (method === "OPTIONS") return new Response(null, { status: 204 });

  // /api/dashboard/* — cookie-only write endpoints (SPEC-022 §9.3)
  // reason: dispatched BEFORE the v1 routes so the /api/dashboard/* namespace is
  // never accidentally matched by v1 wildcard patterns. Bearer-token actors get 403
  // inside handleDashboardRoute (AC-DASH-WRITE-9); unauthenticated already caught above.
  if (path.startsWith("/api/dashboard/")) {
    return handleDashboardRoute(req, url, app, actor);
  }

  // GET /api/auth/me — return session actor context (SPEC-016 §3.2)
  if (method === "GET" && path === "/api/auth/me") {
    return jsonOk({
      name: actor.name,
      owner: actor.owner ?? "admin",
      session_id: actor.session_id,
      expires_at: actor.expires_at ?? null,
    });
  }

  // POST /api/auth/logout — delete session + clear cookie (SPEC-016 §3.2)
  if (method === "POST" && path === "/api/auth/logout") {
    return handleLogout(actor, app);
  }

  // GET /api/status
  if (method === "GET" && path === "/api/status") {
    return handleStatus(app);
  }

  // GET /api/docs
  if (method === "GET" && path === "/api/docs") {
    return handleListDocs(url, app);
  }

  // POST /api/docs
  if (method === "POST" && path === "/api/docs") {
    return handleCreateDoc(req, app, actor);
  }

  // GET /api/search
  if (method === "GET" && path === "/api/search") {
    return handleSearch(url, app);
  }

  // GET /api/tree
  if (method === "GET" && path === "/api/tree") {
    return handleTree(url, app);
  }

  // GET /api/review/pending
  if (method === "GET" && path === "/api/review/pending") {
    return handleReviewPending(url, app);
  }

  // GET /api/audit/verify — MUST be checked before the /api/audit/:docId pattern
  // match below, or "verify" would be swallowed as a doc id.
  if (method === "GET" && path === "/api/audit/verify") {
    return handleAuditVerify(url, app);
  }

  // GET /api/calibration/stats
  if (method === "GET" && path === "/api/calibration/stats") {
    return handleCalibrationStats(url, app);
  }

  // POST /api/links
  if (method === "POST" && path === "/api/links") {
    return handleCreateLink(req, app);
  }

  // /api/docs/:idOrSlug  (with optional suffix)
  const docsMatch = matchDocsPath(path);
  if (docsMatch !== null) {
    return handleDocRoute(req, method, docsMatch, url, app);
  }

  // GET /api/judgments/:docId
  const judgmentsMatch = matchJudgmentsPath(path);
  if (judgmentsMatch !== null && method === "GET") {
    return handleGetJudgments(judgmentsMatch, app);
  }

  // GET /api/audit/:docId
  const auditDocMatch = matchAuditDocPath(path);
  if (auditDocMatch !== null && method === "GET") {
    return handleGetAuditForDoc(auditDocMatch, app);
  }

  // GET /api/ready/:planIdOrSlug (SPEC-037 D1)
  const readyMatch = matchReadyPath(path);
  if (readyMatch !== null && method === "GET") {
    return handleGetReady(readyMatch, app);
  }

  // DELETE /api/links/:from/:to
  const linksDeleteMatch = matchLinksDeletePath(path);
  if (linksDeleteMatch !== null && method === "DELETE") {
    return handleDeleteLink(linksDeleteMatch.from, linksDeleteMatch.to, app);
  }

  // /api/review/:id/approve or /api/review/:id/reject
  const reviewMatch = matchReviewPath(path);
  if (reviewMatch !== null && method === "POST") {
    return handleReviewAction(reviewMatch.id, reviewMatch.action, app);
  }

  return null;
}

// ─── Route handlers ─────────────────────────────────────────────────────────

/**
 * POST /api/auth/logout — delete the session row and clear the lore_sid cookie.
 * Idempotent: calling when no session row exists is a no-op (still returns ok).
 */
function handleLogout(actor: ActorContext, app: App): Response {
  if (app.sessionStore !== undefined) {
    // reason: actor.session_id for cookie-auth is the actual 32-hex session_id.
    // For bearer-auth, it's a hash prefix — no matching session row, so delete is a no-op.
    // Either way idempotent. SPEC-016 §3.2.
    app.sessionStore.delete(actor.session_id);
  }

  // Clear the cookie by setting Max-Age=0.
  const clearCookie = "lore_sid=; Path=/api; Max-Age=0";
  const headers = new Headers(corsHeaders({ "Content-Type": "application/json" }));
  headers.set("Set-Cookie", clearCookie);

  return new Response(
    JSON.stringify({ ok: true, data: { ok: true } }),
    { status: 200, headers },
  );
}

async function handleStatus(app: App): Promise<Response> {
  const result = await app.corpusService.status();
  if (!result.ok) return loreErrorResponse(result.error);
  return jsonOk(result.value);
}

async function handleListDocs(url: URL, app: App): Promise<Response> {
  const filters: ListFilters = {};
  const type = url.searchParams.get("type");
  const status = url.searchParams.get("status");
  const parent_id = url.searchParams.get("parent_id");
  const created_by = url.searchParams.get("created_by");
  const since = url.searchParams.get("since");
  const tags = url.searchParams.get("tags");

  if (type !== null) filters.type = type as DocType;
  if (status !== null) filters.status = status as DocStatus;
  if (parent_id !== null) filters.parent_id = parent_id;
  if (created_by !== null) filters.created_by = created_by;
  if (since !== null) filters.since = since;
  if (tags !== null) filters.tags = tags.split(",").filter(Boolean);

  const result = await app.corpusService.list(filters);
  if (!result.ok) return loreErrorResponse(result.error);
  return jsonOk(result.value);
}

async function handleCreateDoc(req: Request, app: App, actor: ActorContext): Promise<Response> {
  const body = await parseJsonBody(req);
  if (body === null || typeof body !== "object") {
    return jsonError({ code: "VALIDATION_ERROR", field: "body", message: "Request body must be JSON" }, 422);
  }
  // SPEC-024 AC-NOAI-6 / AC-NOAI-7: AI default resolution based on HTTP caller surface.
  // The HTTP API does not currently generate AI content — content must be in request body.
  // callerSurface is available here for future AI-over-HTTP support (e.g. body.ai: true).
  // AC-NOAI-6 (bearer=http_token → ai:false default) and AC-NOAI-7 (cookie=http_cookie → ai:true)
  // are proven by the resolveAiDefault algorithm and covered by unit tests (see SPEC-024 §9.4).
  // The _callerSurface variable is kept to signal intent to future implementers.
  // fence: when adding AI-over-HTTP, call app.resolveAiDefault(body.ai, actor.callerSurface) here.
  const _callerSurface = actor.callerSurface ?? "http_token"; // default to safest (AI off)
  void _callerSurface; // referenced above for documentation; suppress lint warning

  const result = await app.corpusService.create(body as CreateDocInput);
  if (!result.ok) return loreErrorResponse(result.error);
  return jsonOk(result.value, 201);
}

async function handleSearch(url: URL, app: App): Promise<Response> {
  const q = url.searchParams.get("q");
  if (q === null || q.trim() === "") {
    return jsonError({ code: "VALIDATION_ERROR", field: "q", message: "Query parameter 'q' is required" }, 422);
  }

  const filters: SearchFilters = {};
  const type = url.searchParams.get("type");
  const status = url.searchParams.get("status");
  const tags = url.searchParams.get("tags");

  if (type !== null) filters.type = type as DocType;
  if (status !== null) filters.status = status as DocStatus;
  if (tags !== null) filters.tags = tags.split(",").filter(Boolean);

  const result = await app.corpusService.search(q, filters);
  if (!result.ok) return loreErrorResponse(result.error);
  return jsonOk(result.value);
}

async function handleTree(url: URL, app: App): Promise<Response> {
  const root = url.searchParams.get("root") ?? undefined;
  const depthStr = url.searchParams.get("depth");
  const depth = depthStr !== null ? parseInt(depthStr, 10) : undefined;

  const result = await app.corpusService.tree(root, depth !== undefined ? { depth } : undefined);
  if (!result.ok) return loreErrorResponse(result.error);
  return jsonOk(result.value);
}

async function handleReviewPending(url: URL, app: App): Promise<Response> {
  const author = url.searchParams.get("author") ?? undefined;
  const typeParam = url.searchParams.get("type") ?? undefined;
  const since = url.searchParams.get("since") ?? undefined;

  const filters: PendingFilters = {};
  if (author !== undefined) filters.author = author;
  if (typeParam !== undefined) filters.type = typeParam as DocType;
  if (since !== undefined) filters.since = since;

  const result = await app.reviewService.pending(filters);
  if (!result.ok) return loreErrorResponse(result.error);
  return jsonOk(result.value);
}

// ─── SPEC-033 F1 feedback-loop read routes ──────────────────────────────────

/**
 * GET /api/judgments/:docId — the doc's latest AI review judgment plus its full
 * history, newest first. Thin pipe over `JudgmentService`; a doc with no
 * judgments yet returns `{ latest: null, history: [] }` (not a 404 — "no
 * judgment exists" is a valid, non-exceptional outcome, not a doc lookup failure).
 */
async function handleGetJudgments(docId: string, app: App): Promise<Response> {
  const latestResult = await app.judgmentService.latestFor(docId);
  if (!latestResult.ok) return loreErrorResponse(latestResult.error);

  const historyResult = await app.judgmentService.listFor(docId);
  if (!historyResult.ok) return loreErrorResponse(historyResult.error);

  return jsonOk({ latest: latestResult.value, history: historyResult.value });
}

/**
 * GET /api/audit/:docId — the doc's audit trail, newest first. Thin pipe over
 * `AuditService.query`. Actor strings are shipped RAW (e.g. `ai:claude-cli:...`
 * for AI-judge entries) — decoding into a human-readable form via
 * `parseAuditActor` is a client concern (browser-safe, `@lore/core`), not
 * duplicated server-side.
 */
async function handleGetAuditForDoc(docId: string, app: App): Promise<Response> {
  const result = await app.auditService.query({ doc_id: docId });
  if (!result.ok) return loreErrorResponse(result.error);
  return jsonOk(result.value);
}

/**
 * GET /api/ready/:planIdOrSlug (SPEC-037 D1) — computed readiness report over a
 * plan's tasks, thin pipe over `TaskWorkflowService.ready` (zero writes). A
 * non-plan target surfaces the service's existing `VALIDATION_ERROR` (422 via
 * `loreErrorResponse`); an unknown id surfaces `DOC_NOT_FOUND` (404). No new
 * error codes, no per-route auth — rides the same central cookie/bearer gate
 * as every other v1 GET route.
 */
async function handleGetReady(planIdOrSlug: string, app: App): Promise<Response> {
  const result = await app.taskWorkflowService.ready(planIdOrSlug);
  if (!result.ok) return loreErrorResponse(result.error);
  return jsonOk(result.value);
}

/**
 * GET /api/audit/verify[?since=<ISO8601>] — versions⋈audit completeness oracle.
 * `since` overrides the configured `audit.verify_since` watermark for this call
 * only (mirrors `lore audit --verify --since`); omitted, `AuditService.verify`
 * falls back to its constructor-resolved watermark.
 */
async function handleAuditVerify(url: URL, app: App): Promise<Response> {
  const since = url.searchParams.get("since");
  const result = await app.auditService.verify(since !== null ? { since } : undefined);
  if (!result.ok) return loreErrorResponse(result.error);
  return jsonOk(result.value);
}

/**
 * GET /api/calibration/stats[?doc_type=<type>][&prompt_version=<v>] — Wilson-bound
 * calibration agreement stats per (doc_type, prompt_version). Thin pipe over
 * `JudgmentService.computeCalibrationStats`; an empty filter object is never
 * passed when both query params are absent (mirrors the service's own
 * `filter?` optional-arg contract — `undefined`, not `{}`, means "no narrowing").
 */
async function handleCalibrationStats(url: URL, app: App): Promise<Response> {
  const docType = url.searchParams.get("doc_type");
  const promptVersion = url.searchParams.get("prompt_version");

  const filter: { doc_type?: DocType; prompt_version?: string } = {};
  if (docType !== null) filter.doc_type = docType as DocType;
  if (promptVersion !== null) filter.prompt_version = promptVersion;

  const result = await app.judgmentService.computeCalibrationStats(
    Object.keys(filter).length > 0 ? filter : undefined,
  );
  if (!result.ok) return loreErrorResponse(result.error);
  return jsonOk(result.value);
}

async function handleCreateLink(req: Request, app: App): Promise<Response> {
  const body = await parseJsonBody(req);
  if (body === null || typeof body !== "object") {
    return jsonError({ code: "VALIDATION_ERROR", field: "body", message: "Request body must be JSON" }, 422);
  }
  const { from, to, type } = body as Record<string, unknown>;
  if (typeof from !== "string" || typeof to !== "string" || typeof type !== "string") {
    return jsonError({ code: "VALIDATION_ERROR", field: "body", message: "Required fields: from, to, type" }, 422);
  }
  const result = await app.corpusService.link(from, to, type as LinkType);
  if (!result.ok) return loreErrorResponse(result.error);
  return jsonOk(result.value, 201);
}

async function handleDeleteLink(from: string, to: string, app: App): Promise<Response> {
  const result = await app.corpusService.unlink(from, to);
  if (!result.ok) return loreErrorResponse(result.error);
  return jsonOk({ ok: true });
}

async function handleReviewAction(id: string, action: "approve" | "reject", app: App): Promise<Response> {
  if (action === "approve") {
    const result = await app.reviewService.approve(id);
    if (!result.ok) return loreErrorResponse(result.error);
    return jsonOk(result.value);
  }

  const result = await app.reviewService.reject(id);
  if (!result.ok) return loreErrorResponse(result.error);
  return jsonOk(result.value);
}

// ─── /api/docs/:idOrSlug route handler ─────────────────────────────────────

type DocsPathMatch =
  | { type: "doc"; idOrSlug: string }
  | { type: "log"; idOrSlug: string }
  | { type: "diff"; idOrSlug: string }
  | { type: "restore"; idOrSlug: string };

function matchDocsPath(path: string): DocsPathMatch | null {
  // /api/docs/:idOrSlug/log
  const logMatch = path.match(/^\/api\/docs\/([^/]+)\/log$/);
  if (logMatch?.[1]) return { type: "log", idOrSlug: decodeURIComponent(logMatch[1]) };

  // /api/docs/:idOrSlug/diff
  const diffMatch = path.match(/^\/api\/docs\/([^/]+)\/diff$/);
  if (diffMatch?.[1]) return { type: "diff", idOrSlug: decodeURIComponent(diffMatch[1]) };

  // /api/docs/:idOrSlug/restore
  const restoreMatch = path.match(/^\/api\/docs\/([^/]+)\/restore$/);
  if (restoreMatch?.[1]) return { type: "restore", idOrSlug: decodeURIComponent(restoreMatch[1]) };

  // /api/docs/:idOrSlug
  const docMatch = path.match(/^\/api\/docs\/([^/]+)$/);
  if (docMatch?.[1]) return { type: "doc", idOrSlug: decodeURIComponent(docMatch[1]) };

  return null;
}

/** Matches GET /api/judgments/:docId. */
function matchJudgmentsPath(path: string): string | null {
  const match = path.match(/^\/api\/judgments\/([^/]+)$/);
  return match?.[1] !== undefined ? decodeURIComponent(match[1]) : null;
}

/**
 * Matches GET /api/audit/:docId. Callers dispatch the static
 * `/api/audit/verify` route BEFORE reaching this pattern (see
 * `handleApiRoute`), so `verify` is never mistaken for a doc id here — this
 * function itself has no special-case for it.
 */
function matchAuditDocPath(path: string): string | null {
  const match = path.match(/^\/api\/audit\/([^/]+)$/);
  return match?.[1] !== undefined ? decodeURIComponent(match[1]) : null;
}

/** Matches GET /api/ready/:planIdOrSlug (SPEC-037 D1). */
function matchReadyPath(path: string): string | null {
  const match = path.match(/^\/api\/ready\/([^/]+)$/);
  return match?.[1] !== undefined ? decodeURIComponent(match[1]) : null;
}

function matchLinksDeletePath(path: string): { from: string; to: string } | null {
  const match = path.match(/^\/api\/links\/([^/]+)\/([^/]+)$/);
  if (!match?.[1] || !match[2]) return null;
  return { from: decodeURIComponent(match[1]), to: decodeURIComponent(match[2]) };
}

function matchReviewPath(path: string): { id: string; action: "approve" | "reject" } | null {
  const approveMatch = path.match(/^\/api\/review\/([^/]+)\/approve$/);
  if (approveMatch?.[1]) return { id: decodeURIComponent(approveMatch[1]), action: "approve" };

  const rejectMatch = path.match(/^\/api\/review\/([^/]+)\/reject$/);
  if (rejectMatch?.[1]) return { id: decodeURIComponent(rejectMatch[1]), action: "reject" };

  return null;
}

async function handleDocRoute(
  req: Request,
  method: string,
  match: DocsPathMatch,
  url: URL,
  app: App,
): Promise<Response> {
  switch (match.type) {
    case "doc":
      return handleSingleDoc(req, method, match.idOrSlug, app);
    case "log":
      return handleVersionLog(match.idOrSlug, url, app);
    case "diff":
      return handleVersionDiff(match.idOrSlug, url, app);
    case "restore":
      if (method !== "POST") return jsonError({ code: "VALIDATION_ERROR", field: "method", message: "Method not allowed" }, 405);
      return handleVersionRestore(req, match.idOrSlug, app);
  }
}

async function handleSingleDoc(req: Request, method: string, idOrSlug: string, app: App): Promise<Response> {
  if (method === "GET") {
    const resolveMdx = new URL(req.url).searchParams.get("resolveMdx") === "true";
    const result = await app.corpusService.get(idOrSlug);
    if (!result.ok) return loreErrorResponse(result.error);

    // reason: AC-D-B1 — ?resolveMdx=true triggers OutlineService placeholder resolution;
    // response extends DocWithNavigation with a resolvedMdx field. AC-D-B2 guarantees
    // that without the flag the raw content is returned unchanged. See SPEC-015 §3.5.
    if (resolveMdx) {
      const resolveResult = await app.outlineService.resolve(result.value.doc);
      if (!resolveResult.ok) return loreErrorResponse(resolveResult.error);
      return jsonOk({ ...result.value, resolvedMdx: resolveResult.value });
    }

    return jsonOk(result.value);
  }

  if (method === "PATCH") {
    const body = await parseJsonBody(req);
    if (body === null || typeof body !== "object") {
      return jsonError({ code: "VALIDATION_ERROR", field: "body", message: "Request body must be JSON" }, 422);
    }
    const result = await app.corpusService.set(idOrSlug, body as DocPatch);
    if (!result.ok) return loreErrorResponse(result.error);
    return jsonOk(result.value);
  }

  if (method === "DELETE") {
    const confirmStr = new URL(req.url).searchParams.get("confirm");
    const confirm = confirmStr === "true";
    const result = await app.corpusService.delete(idOrSlug, confirm);
    if (!result.ok) return loreErrorResponse(result.error);
    return jsonOk(result.value);
  }

  return jsonError({ code: "VALIDATION_ERROR", field: "method", message: "Method not allowed" }, 405);
}

async function handleVersionLog(idOrSlug: string, url: URL, app: App): Promise<Response> {
  const limitStr = url.searchParams.get("limit");
  const offsetStr = url.searchParams.get("offset");
  const opts = {
    ...(limitStr !== null ? { limit: parseInt(limitStr, 10) } : {}),
    ...(offsetStr !== null ? { offset: parseInt(offsetStr, 10) } : {}),
  };
  const result = await app.versionService.log(idOrSlug, opts);
  if (!result.ok) return loreErrorResponse(result.error);
  return jsonOk(result.value);
}

async function handleVersionDiff(idOrSlug: string, url: URL, app: App): Promise<Response> {
  const fromStr = url.searchParams.get("from");
  const toStr = url.searchParams.get("to");
  const opts = {
    ...(fromStr !== null ? { from: parseInt(fromStr, 10) } : {}),
    ...(toStr !== null ? { to: parseInt(toStr, 10) } : {}),
  };
  const result = await app.versionService.diff(idOrSlug, opts);
  if (!result.ok) return loreErrorResponse(result.error);
  return jsonOk(result.value);
}

async function handleVersionRestore(req: Request, idOrSlug: string, app: App): Promise<Response> {
  const body = await parseJsonBody(req);
  if (body === null || typeof body !== "object") {
    return jsonError({ code: "VALIDATION_ERROR", field: "body", message: "Request body must be JSON with 'version'" }, 422);
  }
  const { version } = body as Record<string, unknown>;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return jsonError({ code: "VALIDATION_ERROR", field: "version", message: "'version' must be a positive integer" }, 422);
  }
  const result = await app.versionService.restore(idOrSlug, version);
  if (!result.ok) return loreErrorResponse(result.error);
  return jsonOk(result.value);
}
