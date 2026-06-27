/**
 * HTTP API route handler — maps URL patterns to service calls.
 * Each route parses params/query/body, calls the service, and returns a JSON envelope.
 * Source: SPEC-011 §3; SPEC-016 §3.2 (auth routes: local-bootstrap, me, logout)
 */

import type { App } from "../../app.js";
import type { ActorContext } from "./auth.js";
import { ALLOWED_ORIGINS } from "./auth.js";
import { jsonOk, jsonError, loreErrorResponse, parseJsonBody, corsHeaders } from "./middleware.js";
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
    return handleCreateDoc(req, app);
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

  // POST /api/links
  if (method === "POST" && path === "/api/links") {
    return handleCreateLink(req, app);
  }

  // /api/docs/:idOrSlug  (with optional suffix)
  const docsMatch = matchDocsPath(path);
  if (docsMatch !== null) {
    return handleDocRoute(req, method, docsMatch, url, app);
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

async function handleCreateDoc(req: Request, app: App): Promise<Response> {
  const body = await parseJsonBody(req);
  if (body === null || typeof body !== "object") {
    return jsonError({ code: "VALIDATION_ERROR", field: "body", message: "Request body must be JSON" }, 422);
  }
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
