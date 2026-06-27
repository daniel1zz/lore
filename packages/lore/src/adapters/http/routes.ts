/**
 * HTTP API route handler — maps URL patterns to service calls.
 * Each route parses params/query/body, calls the service, and returns a JSON envelope.
 * Source: SPEC-011 §3
 */

import type { App } from "../../app.js";
import type { ActorContext } from "./auth.js";
import { jsonOk, jsonError, loreErrorResponse, parseJsonBody } from "./middleware.js";
import type { ListFilters, SearchFilters } from "../../service/corpus-service.js";
import type { PendingFilters } from "../../service/review-service.js";
import type { CreateDocInput, DocPatch } from "../../core/schemas.js";
import type { DocStatus, DocType, LinkType } from "../../core/types.js";

// ─── Route dispatcher ───────────────────────────────────────────────────────

/**
 * Dispatch authenticated API requests to service methods.
 * Returns null if the route is not matched (caller should return 404).
 */
export async function handleApiRoute(
  req: Request,
  url: URL,
  app: App,
  _actor: ActorContext,
): Promise<Response | null> {
  const method = req.method.toUpperCase();
  const path = url.pathname;

  // OPTIONS — CORS preflight (already handled in server, but guard here too)
  if (method === "OPTIONS") return new Response(null, { status: 204 });

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
    const result = await app.corpusService.get(idOrSlug);
    if (!result.ok) return loreErrorResponse(result.error);
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
