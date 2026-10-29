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
import { ALLOWED_ORIGINS, resolveDocWriteOpts } from "./auth.js";
// reason: TYPE-ONLY import — routes.ts is reachable from vitest test suites
// (`bun:sqlite` is external to vitest, see project CLAUDE.md), so the runtime
// `createMachineAuthStores` value (which imports `bun:sqlite`) must never be imported
// here, only its return type. Production always supplies a real `getMachineAuth`
// accessor (`index.ts`); this module never constructs one itself.
import type { MachineAuthStores } from "./machine-auth.js";
import { jsonOk, jsonError, loreErrorResponse, parseJsonBody, splitDocPatchBody, corsHeaders } from "./middleware.js";
import { handleDashboardRoute } from "./dashboard-routes.js";
import { resolveExpectedVersion } from "./concurrency.js";
import { handleGetConfig, handleGetMachineConfig } from "./config-routes.js";
import { handleGetIssueReports } from "./issue-reports-routes.js";
import type { ListFilters, SearchFilters } from "../../service/corpus-service.js";
import type { PendingFilters } from "../../service/review-service.js";
import { formatTaskKindRequiredMessage, isActivePlan, isTaskKind } from "@lore/core";
import type { CreateDocInput, DocPatch } from "@lore/core";
import type { DocStatus, DocType, LinkType } from "@lore/core";
import { computeValidityState } from "../../flows/validity-state.js";

// ─── Auth route handlers (SPEC-016) ────────────────────────────────────────────

/**
 * Hostnames treated as guaranteed local dev — never crosses an untrusted network hop.
 * `URL#hostname` serializes an IPv6 host WITH brackets (e.g. `[::1]`, not `::1`) per the
 * WHATWG URL spec — both forms are listed defensively in case a future caller normalizes
 * the value before this check runs.
 */
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Decide whether the current request is in a "secure" context — i.e. whether it is safe
 * to mark the response cookie `Secure` without breaking plain-http local dev.
 *
 * `Secure` is added when EITHER of these holds (OR, not priority-ordered — a non-loopback
 * host gets `Secure` even if a proxy explicitly signals plain http, since we cannot verify
 * that signal and the conservative/non-breaking default is to harden):
 *   - HTTPS: `X-Forwarded-Proto: https` (reverse-proxy TLS termination — this adapter's own
 *     `Bun.serve` call in index.ts never configures TLS, so `req.url`'s scheme is always
 *     "http" even when a proxy in front of it terminates HTTPS) OR `req.url`'s own scheme
 *     is "https:" (in case a future deployment terminates TLS in-process).
 *   - Non-loopback: the request's hostname is not `localhost` / `127.0.0.1` / `::1`.
 * `Secure` is omitted only when NEITHER holds — plain-http loopback, i.e. local dev
 * (`lore dashboard` on localhost) — since browsers silently drop `Secure` cookies sent over
 * plain http, which would break that flow.
 *
 * @param req - Incoming request (POST /api/auth/local-bootstrap).
 * @returns true iff the Set-Cookie response should carry the `Secure` attribute.
 */
function isSecureRequestContext(req: Request): boolean {
  const forwardedProto = req.headers.get("X-Forwarded-Proto");
  const url = new URL(req.url);
  const isHttps = forwardedProto !== null ? forwardedProto.toLowerCase() === "https" : url.protocol === "https:";
  if (isHttps) return true;

  return !LOOPBACK_HOSTNAMES.has(url.hostname);
}

/**
 * POST /api/auth/local-bootstrap — trade raw API key for an HttpOnly session cookie.
 * Verifies Origin against the active allowlist and X-Lore-Token against the MACHINE-SCOPE
 * api_keys table (SPEC-078 D1 unconditional re-point — the "dashboard-local" key and the
 * session it mints live in `machineAuth`, never a per-corpus `App` — this route no longer
 * needs an `App` at all; bearer API keys stay per-corpus and are untouched by this route).
 * Called BEFORE authenticateRequest in index.ts (no prior auth required).
 *
 * @param req - Incoming request with X-Lore-Token header and Origin header.
 * @param machineAuth - Machine-scope auth stores (SPEC-078 D1); the SAME instance the
 *   server's cookie-auth path resolves sessions against.
 * @param allowedOrigins - The allowlist to check the request's Origin against; defaults to
 *   `ALLOWED_ORIGINS` (auth.ts's default-port 8787/5173 list). Production `index.ts`
 *   threads the server's actual configured allowlist so a non-default `--dashboard-port`
 *   is honored (task-dashboard-bootstrap-origin-allowlist-hardcodes-port-5173).
 * @returns 200 + Set-Cookie on success, 403 on bad Origin, 401 on bad token.
 */
export async function handleLocalBootstrap(
  req: Request,
  machineAuth: MachineAuthStores,
  allowedOrigins: readonly string[] = ALLOWED_ORIGINS,
): Promise<Response> {
  // Validate Origin against allowlist — CSRF protection for bootstrap endpoint.
  const origin = req.headers.get("Origin") ?? "";
  if (!allowedOrigins.includes(origin)) {
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

  // Validate the raw key against the MACHINE-SCOPE api_keys (SHA-256 match) — SPEC-078 D1.
  const validateResult = await machineAuth.apiKeyStore.validate(token.trim());
  if (!validateResult.ok) {
    return jsonError(
      { code: "VALIDATION_ERROR", field: "X-Lore-Token", message: "Invalid token" },
      401,
    );
  }

  const { session_id, expires_at } = machineAuth.sessionStore.create(validateResult.value.name);

  // reason: Set-Cookie must be in the Response headers, not in CORS headers.
  // Max-Age=2592000 = 30 days in seconds. Path=/api keeps the cookie scoped to API routes
  // only — Vite's / routes never see it, reducing exposure. SPEC-016 §3.2.
  // `Secure` is conditional on isSecureRequestContext (see its doc comment) — omitted for
  // loopback plain-http local dev (Secure cookies are silently dropped by browsers over
  // plain http, which would break `lore dashboard` on localhost), added for every other
  // (non-loopback / HTTPS / reverse-proxied) context as hardening.
  const secureFlag = isSecureRequestContext(req) ? "; Secure" : "";
  const cookieValue = `lore_sid=${session_id}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=2592000${secureFlag}`;
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
 *
 * @param getMachineAuth - Lazy accessor for the machine-scope auth stores (SPEC-078 D1),
 *   invoked ONLY by the `/api/auth/logout` branch below — every other route ignores it,
 *   so a bearer-only request never triggers machine-auth-store construction. OPTIONAL
 *   (no default value) so this dispatcher's many existing direct-call test suites —
 *   none of which exercise the logout branch — need no changes; production
 *   `startHttpServer` always supplies its own memoized getter. A logout request that
 *   somehow reaches this function without one wired gets a loud 500, never a silent
 *   no-op or an uncaught "not a function" throw.
 * @param allowedOrigins - Origin allowlist threaded to `/api/dashboard/*`'s CSRF guard
 *   (`handleDashboardRoute`); defaults to `ALLOWED_ORIGINS`. Production `index.ts` passes
 *   the server's actual configured allowlist (task-dashboard-bootstrap-origin-allowlist-
 *   hardcodes-port-5173).
 */
export async function handleApiRoute(
  req: Request,
  url: URL,
  app: App,
  actor: ActorContext,
  getMachineAuth?: () => MachineAuthStores,
  allowedOrigins: readonly string[] = ALLOWED_ORIGINS,
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
    return handleDashboardRoute(req, url, app, actor, allowedOrigins);
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
    if (getMachineAuth === undefined) {
      // reason: a wiring bug (production always supplies this), not a caller-input
      // error — fail loud with a 500 rather than silently no-op the logout or let an
      // uncaught "getMachineAuth is not a function" TypeError escape.
      return jsonError({ code: "STORE_ERROR", message: "Machine auth store not wired for this request" }, 500);
    }
    return handleLogout(actor, getMachineAuth());
  }

  // GET /api/status
  if (method === "GET" && path === "/api/status") {
    return handleStatus(app);
  }

  // GET /api/config (SPEC-062 D3) — available to both cookie and bearer sessions,
  // unlike PATCH /api/dashboard/config which is cookie-only (dispatched above).
  if (method === "GET" && path === "/api/config") {
    return handleGetConfig(app);
  }

  // GET /api/config/machine (SPEC-064 D6) — machine-scope sibling of GET /api/config,
  // same cookie-or-bearer duality; a DISTINCT path (not a ?scope= query param) so
  // this dispatcher's route table stays one-entry-per-resource.
  if (method === "GET" && path === "/api/config/machine") {
    return handleGetMachineConfig(app);
  }

  // GET /api/issue-reports (SPEC-074 AC-074-5) — available to both cookie and
  // bearer sessions, same auth duality as GET /api/config above; read-only
  // dashboard Issues triage projection, never a write.
  if (method === "GET" && path === "/api/issue-reports") {
    return handleGetIssueReports(app);
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

  // GET /api/decisions, /api/decisions/:id (HR-T3) — read-only, cookie or bearer.
  // reason: paths deliberately avoid the word "decide": the human channel has no HTTP route (AC-AU-3 (4) scan).
  if (method === "GET" && path === "/api/decisions") return handleListDecisions(app);
  const decisionMatch = /^\/api\/decisions\/([^/]+)$/.exec(path);
  if (decisionMatch !== null && method === "GET") return handleGetDecision(decisionMatch[1] ?? "", app);

  // POST /api/links
  if (method === "POST" && path === "/api/links") {
    return handleCreateLink(req, app, actor);
  }

  // /api/docs/:idOrSlug  (with optional suffix)
  const docsMatch = matchDocsPath(path);
  if (docsMatch !== null) {
    return handleDocRoute(req, method, docsMatch, url, app, actor);
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

  // GET /api/evidence-panel/:idOrSlug (SPEC-075 §Module Boundary)
  const evidencePanelMatch = matchEvidencePanelPath(path);
  if (evidencePanelMatch !== null && method === "GET") {
    return handleGetEvidencePanel(evidencePanelMatch, app);
  }

  // GET /api/phase-status/:planIdOrSlug (SPEC-077 S3)
  const phaseStatusMatch = matchPhaseStatusPath(path);
  if (phaseStatusMatch !== null && method === "GET") {
    return handleGetPhaseStatus(phaseStatusMatch, app);
  }

  // DELETE /api/links/:from/:to
  const linksDeleteMatch = matchLinksDeletePath(path);
  if (linksDeleteMatch !== null && method === "DELETE") {
    return handleDeleteLink(linksDeleteMatch.from, linksDeleteMatch.to, app, actor);
  }

  // /api/review/:id/approve or /api/review/:id/reject
  const reviewMatch = matchReviewPath(path);
  if (reviewMatch !== null && method === "POST") {
    // `?item=<BR-n|node>` (baseline nodes, BR-1338): approve / discard ONE item's pending revision
    return handleReviewAction(reviewMatch.id, reviewMatch.action, app, url.searchParams.get("item") ?? undefined);
  }

  return null;
}

// ─── Route handlers ─────────────────────────────────────────────────────────

/**
 * POST /api/auth/logout — delete the session row and clear the lore_sid cookie.
 * Idempotent: calling when no session row exists is a no-op (still returns ok).
 * SPEC-078 D1: deletes from the MACHINE-SCOPE sessions table (logout is store-wide —
 * it invalidates the session on every project's routes, not just whichever one the
 * logout request happened to be addressed to).
 */
function handleLogout(actor: ActorContext, machineAuth: MachineAuthStores): Response {
  // reason: actor.session_id for cookie-auth is the actual 32-hex session_id.
  // For bearer-auth, it's a hash prefix — no matching session row, so delete is a no-op.
  // Either way idempotent. SPEC-016 §3.2.
  machineAuth.sessionStore.delete(actor.session_id);

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
  const active = url.searchParams.get("active");

  // `active` is a named filter, not a status: only the literal `true`, only for plans.
  if (active !== null && (active !== "true" || type !== "plan")) {
    return jsonError(
      { code: "VALIDATION_ERROR", field: "active", message: "active=true is the only accepted value and requires type=plan" },
      422,
    );
  }

  if (type !== null) filters.type = type as DocType;
  if (status !== null) filters.status = status as DocStatus;
  if (parent_id !== null) filters.parent_id = parent_id;
  if (created_by !== null) filters.created_by = created_by;
  if (since !== null) filters.since = since;
  if (tags !== null) filters.tags = tags.split(",").filter(Boolean);

  const result = await app.corpusService.list(filters);
  if (!result.ok) return loreErrorResponse(result.error);
  if (active === null) return jsonOk(result.value);
  // reason: no limit/offset is passed above, so filtering after the fetch cannot shorten a page.
  const docs = result.value.docs.filter(isActivePlan);
  return jsonOk({ ...result.value, docs, total: docs.length });
}

/**
 * AC-DCS1-4 (BR-1488): the HTTP create route requires a task kind. The kind is read from the top-level `kind` field or from
 * `extra.kind` (a top-level one is moved into `extra`, the only place a task stores it); a missing or unknown one is a 400
 * naming the three kinds. Documents of any other type pass through untouched.
 *
 * @param body - the parsed request body
 * @returns the input to create, or the refusal (a `VALIDATION_ERROR` on field `kind`)
 */
function requireTaskKindOnCreate(
  body: Record<string, unknown>,
):
  | { readonly ok: true; readonly input: CreateDocInput }
  | { readonly ok: false; readonly error: { code: "VALIDATION_ERROR"; field: string; message: string } } {
  if (body["type"] !== "task") return { ok: true, input: body as unknown as CreateDocInput };
  const extra = typeof body["extra"] === "object" && body["extra"] !== null ? (body["extra"] as Record<string, unknown>) : {};
  const { kind: topLevelKind, ...rest } = body;
  const kind = topLevelKind ?? extra["kind"];
  if (!isTaskKind(kind)) {
    return {
      ok: false,
      error: { code: "VALIDATION_ERROR", field: "kind", message: formatTaskKindRequiredMessage(kind, "kind") },
    };
  }
  return { ok: true, input: { ...rest, extra: { ...extra, kind } } as unknown as CreateDocInput };
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

  // adr-dashboard-cookie-session-writes-attribute-author-via — resolveDocWriteOpts
  // is the single cookie-vs-bearer attribution policy seam (see auth.ts). Cookie
  // sessions get the full resolveActor chain + doc/version created_by attribution;
  // bearer sessions keep the pre-existing `by: actor.name` (API key name) behavior.
  const kindChecked = requireTaskKindOnCreate(body as Record<string, unknown>);
  if (!kindChecked.ok) return jsonError(kindChecked.error, 400);
  const result = await app.corpusService.create(kindChecked.input, resolveDocWriteOpts(actor));
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

// ─── Numeric query-param validation (BUG-006/007 audit) ────────────────────

/**
 * Result of validating an optional numeric query parameter via
 * {@link parseOptionalIntParam}. Discriminated on `ok` — the failure branch
 * carries a ready-to-return `422 VALIDATION_ERROR` Response, so a caller never
 * needs to hand-build its own error envelope for a malformed numeric param.
 */
type ParsedIntParam =
  | { readonly ok: true; readonly value: number | undefined }
  | { readonly ok: false; readonly response: Response };

/**
 * Validate an optional numeric query parameter's raw string value as a bounded
 * integer, mirroring the CLI's `adapters/cli/utils.ts::parsePositiveIntArg`
 * (same three rejected classes: non-numeric, fractional, out-of-bound/NaN) but
 * returning a ready-to-return `422` `Response` instead of a CLI exit code —
 * before this validation, a malformed `?limit=abc`/`?depth=abc` reached
 * `parseInt` unguarded and either silently no-opted the filter (`NaN` fails
 * every comparison) or propagated into a `bun:sqlite` `LIMIT ?` bind, surfacing
 * as a raw, unmapped `500` "datatype mismatch" (BUG-006/007 audit).
 *
 * @param raw - `url.searchParams.get(paramName)` — `null` means the param is absent
 * @param paramName - Query parameter name, used as both the error `field` and message
 * @param opts.min - Inclusive lower bound (default `1`); pass `0` for params like
 *   `offset` where zero is legal
 * @returns `{ok: true, value: undefined}` when `raw` is `null` (param omitted —
 *   NOT a validation failure); `{ok: true, value}` on a valid integer; `{ok:
 *   false, response}` — a `422` Response the caller returns immediately
 */
function parseOptionalIntParam(raw: string | null, paramName: string, opts?: { min?: number }): ParsedIntParam {
  if (raw === null) return { ok: true, value: undefined };

  const min = opts?.min ?? 1;
  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    return {
      ok: false,
      response: jsonError(
        { code: "VALIDATION_ERROR", field: paramName, message: `'${paramName}' must be an integer, got '${raw}'` },
        422,
      ),
    };
  }
  const value = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(value) || value < min) {
    return {
      ok: false,
      response: jsonError(
        {
          code: "VALIDATION_ERROR",
          field: paramName,
          message: `'${paramName}' must be an integer >= ${min}, got '${raw}'`,
        },
        422,
      ),
    };
  }
  return { ok: true, value };
}

async function handleTree(url: URL, app: App): Promise<Response> {
  const root = url.searchParams.get("root") ?? undefined;
  const depthParam = parseOptionalIntParam(url.searchParams.get("depth"), "depth", { min: 1 });
  if (!depthParam.ok) return depthParam.response;
  const depth = depthParam.value;

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
 * GET /api/ready/:planIdOrSlug (SPEC-037 D1; SPEC-077 S4 `claim_ttl_minutes`
 * enrichment) — computed readiness report over a plan's tasks, thin pipe over
 * `TaskWorkflowService.ready` (zero writes). A non-plan target surfaces the
 * service's existing `VALIDATION_ERROR` (422 via `loreErrorResponse`); an unknown
 * id surfaces `DOC_NOT_FOUND` (404). No new error codes, no per-route auth — rides
 * the same central cookie/bearer gate as every other v1 GET route.
 *
 * SPEC-077 S4: the response gains a top-level `claim_ttl_minutes` — the resolved
 * `workflow.claim_ttl_minutes` config value `app.taskWorkflowService` was
 * constructed with. This is HTTP-LAYER enrichment only — core `ReadyReport`
 * (`../../service/task-workflow-service.js`) stays untouched/pure; the dashboard's
 * claim-countdown UI divides by this field instead of hardcoding the TTL.
 */
async function handleGetReady(planIdOrSlug: string, app: App): Promise<Response> {
  const result = await app.taskWorkflowService.ready(planIdOrSlug);
  if (!result.ok) return loreErrorResponse(result.error);
  return jsonOk({ ...result.value, claim_ttl_minutes: app.taskWorkflowService.claimTtlMinutes });
}

/**
 * GET /api/evidence-panel/:idOrSlug (SPEC-075 §Module Boundary) — the dashboard
 * adjudication workbench's Evidence-tab projection for one doc. Thin pipe over
 * `VerificationProjectionService.evidencePanel` (zero writes); read-only, SPEC-033
 * read-family auth parity (cookie OR bearer — no per-route auth here, rides the
 * same central gate as every other v1 GET route). Unknown id → `DOC_NOT_FOUND`
 * (404); the D9 hierarchy-assumption violation (a plan with phase children and
 * zero task children) surfaces as `VALIDATION_ERROR` (422 via `loreErrorResponse`),
 * same as any other service-level validation failure.
 */
async function handleGetEvidencePanel(idOrSlug: string, app: App): Promise<Response> {
  if (app.verificationProjectionService === undefined) {
    return jsonError(
      { code: "STORE_ERROR", message: "VerificationProjectionService not wired on App" },
      500,
    );
  }
  const result = await app.verificationProjectionService.evidencePanel(idOrSlug);
  if (!result.ok) return loreErrorResponse(result.error);
  return jsonOk(result.value);
}

/**
 * GET /api/phase-status/:planIdOrSlug (SPEC-077 S3) — the dashboard execution read
 * surface's phase-progress projection for one plan. Thin pipe over
 * `PhaseWorkflowService.planPhaseStatus` (zero derivation in this file — see that
 * method's own JSDoc); read-only, same v1 read-family auth duality (cookie OR
 * bearer) as every other route in this dispatcher. Unknown id → `DOC_NOT_FOUND`
 * (404); a resolvable doc that is not type `plan` → `VALIDATION_ERROR` naming the
 * actual type (422 via `loreErrorResponse`), same non-member-type semantics as the
 * evidence-panel route. A plan with zero `phase` children returns `200` with
 * `phases: []` (not an error).
 */
async function handleGetPhaseStatus(planIdOrSlug: string, app: App): Promise<Response> {
  if (app.phaseWorkflowService === undefined) {
    return jsonError({ code: "STORE_ERROR", message: "PhaseWorkflowService not wired on App" }, 500);
  }
  const result = await app.phaseWorkflowService.planPhaseStatus(planIdOrSlug);
  if (!result.ok) return loreErrorResponse(result.error);
  return jsonOk(result.value);
}

/**
 * GET /api/audit/verify — versions⋈audit completeness oracle over every version. The
 * per-call `since` option is removed (as `lore audit --verify --since`): a request carrying it is refused 422.
 */
async function handleAuditVerify(url: URL, app: App): Promise<Response> {
  if (url.searchParams.has("since")) {
    return jsonError(
      {
        code: "VALIDATION_ERROR",
        field: "since",
        message: "since is not accepted: verification checks every version. History that predates the audit writers is recorded by `lore migrate audit-backfill --apply`.",
      },
      422,
    );
  }
  // reason: the full-chain verdict runs off the serving loop (worker per persistent store) and reads the anchor file,
  // so a dashboard "clean" means what `lore audit --verify` means.
  const result = await app.auditVerifyRunner.verify();
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

const DECISION_READ_UNAVAILABLE = { code: "STORE_ERROR", message: "Decision read service not wired for this app" };

/** GET /api/decisions — open decisions. Forwards to the pure read; never `listPending` (it appends). */
async function handleListDecisions(app: App): Promise<Response> {
  if (app.decisionReadService === undefined) return jsonError(DECISION_READ_UNAVAILABLE, 503);
  const result = await app.decisionReadService.readDecisionViews();
  if (!result.ok) return loreErrorResponse(result.error);
  return jsonOk(result.value);
}

/** GET /api/decisions/:id — one open decision; unknown id → 404. */
async function handleGetDecision(rawId: string, app: App): Promise<Response> {
  if (app.decisionReadService === undefined) return jsonError(DECISION_READ_UNAVAILABLE, 503);
  if (!/^\d+$/.test(rawId)) {
    return jsonError({ code: "VALIDATION_ERROR", field: "id", message: "Decision id must be a positive integer" }, 422);
  }
  const result = await app.decisionReadService.readDecisionView(Number(rawId));
  if (!result.ok) return loreErrorResponse(result.error);
  if (result.value === null) return jsonError({ code: "NOT_FOUND", message: `No open decision ${rawId}` }, 404);
  return jsonOk(result.value);
}

async function handleCreateLink(req: Request, app: App, actor: ActorContext): Promise<Response> {
  const body = await parseJsonBody(req);
  if (body === null || typeof body !== "object") {
    return jsonError({ code: "VALIDATION_ERROR", field: "body", message: "Request body must be JSON" }, 422);
  }
  const { from, to, type } = body as Record<string, unknown>;
  if (typeof from !== "string" || typeof to !== "string" || typeof type !== "string") {
    return jsonError({ code: "VALIDATION_ERROR", field: "body", message: "Required fields: from, to, type" }, 422);
  }
  // adr-dashboard-cookie-session-writes-attribute-author-via — resolveDocWriteOpts
  // (see auth.ts) is the single cookie-vs-bearer attribution policy seam.
  const result = await app.corpusService.link(from, to, type as LinkType, resolveDocWriteOpts(actor));
  if (!result.ok) return loreErrorResponse(result.error);
  return jsonOk(result.value, 201);
}

async function handleDeleteLink(from: string, to: string, app: App, actor: ActorContext): Promise<Response> {
  const result = await app.corpusService.unlink(from, to, resolveDocWriteOpts(actor));
  if (!result.ok) return loreErrorResponse(result.error);
  return jsonOk({ ok: true });
}

async function handleReviewAction(id: string, action: "approve" | "reject", app: App, item?: string): Promise<Response> {
  if (action === "approve") {
    const result = await app.reviewService.approve(id, item !== undefined ? { item } : undefined);
    if (!result.ok) return loreErrorResponse(result.error);
    return jsonOk(result.value);
  }

  if (item !== undefined) {
    const discarded = await app.reviewService.rejectItem(id, item);
    if (!discarded.ok) return loreErrorResponse(discarded.error);
    return jsonOk({ ...discarded.value.doc, discarded_item: discarded.value.discarded.item });
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

/** Matches GET /api/evidence-panel/:idOrSlug (SPEC-075 §Module Boundary). */
function matchEvidencePanelPath(path: string): string | null {
  const match = path.match(/^\/api\/evidence-panel\/([^/]+)$/);
  return match?.[1] !== undefined ? decodeURIComponent(match[1]) : null;
}

/** Matches GET /api/phase-status/:planIdOrSlug (SPEC-077 S3). */
function matchPhaseStatusPath(path: string): string | null {
  const match = path.match(/^\/api\/phase-status\/([^/]+)$/);
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
  actor: ActorContext,
): Promise<Response> {
  switch (match.type) {
    case "doc":
      return handleSingleDoc(req, method, match.idOrSlug, app, actor);
    case "log":
      return handleVersionLog(match.idOrSlug, url, app);
    case "diff":
      return handleVersionDiff(match.idOrSlug, url, app);
    case "restore":
      if (method !== "POST") return jsonError({ code: "VALIDATION_ERROR", field: "method", message: "Method not allowed" }, 405);
      return handleVersionRestore(req, match.idOrSlug, app);
  }
}

async function handleSingleDoc(
  req: Request,
  method: string,
  idOrSlug: string,
  app: App,
  actor: ActorContext,
): Promise<Response> {
  if (method === "GET") {
    const resolveMdx = new URL(req.url).searchParams.get("resolveMdx") === "true";
    const result = await app.corpusService.get(idOrSlug);
    if (!result.ok) return loreErrorResponse(result.error);

    // SPEC-043 §Design Decisions D6 — computed validity_state on every doc payload
    // (not gated behind resolveMdx — agents reading this route need the signal
    // regardless of whether they also asked for MDX resolution).
    const validityState = await computeValidityState(app, result.value.doc);

    // reason: AC-D-B1 — ?resolveMdx=true triggers OutlineService placeholder resolution;
    // response extends DocWithNavigation with a resolvedMdx field. AC-D-B2 guarantees
    // that without the flag the raw content is returned unchanged. See SPEC-015 §3.5.
    if (resolveMdx) {
      const resolveResult = await app.outlineService.resolve(result.value.doc);
      if (!resolveResult.ok) return loreErrorResponse(resolveResult.error);
      return jsonOk({ ...result.value, resolvedMdx: resolveResult.value, validity_state: validityState });
    }

    return jsonOk({ ...result.value, validity_state: validityState });
  }

  if (method === "PATCH") {
    const body = await parseJsonBody(req);
    if (body === null || typeof body !== "object") {
      return jsonError({ code: "VALIDATION_ERROR", field: "body", message: "Request body must be JSON" }, 422);
    }
    // adr-dashboard-cookie-session-writes-attribute-author-via — resolveDocWriteOpts
    // (see auth.ts) is the single cookie-vs-bearer attribution policy seam.
    // spec-documents-are-living-or-records D15: `correction` is a write option, split out of the patch.
    const split = splitDocPatchBody(body);
    if (!split.ok) return loreErrorResponse(split.error);
    // reason: D-OR-1 / AC-AP-2(e) — a bearer caller's `If-Match` is the same optimistic-concurrency
    // handle the dashboard route threads into set(); a status:approved PATCH delegates to approve,
    // which refuses a stale version with STALE_VERSION (409) before any write.
    const expectedVersion = resolveExpectedVersion(req);
    const result = await app.corpusService.set(idOrSlug, split.value.patch, {
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
      ...resolveDocWriteOpts(actor),
      ...(split.value.correction !== undefined ? { correction: split.value.correction } : {}),
    });
    if (!result.ok) return loreErrorResponse(result.error);
    return jsonOk(result.value);
  }

  if (method === "DELETE") {
    const confirmStr = new URL(req.url).searchParams.get("confirm");
    const confirm = confirmStr === "true";
    const result = await app.corpusService.delete(idOrSlug, confirm, resolveDocWriteOpts(actor));
    if (!result.ok) return loreErrorResponse(result.error);
    return jsonOk(result.value);
  }

  return jsonError({ code: "VALIDATION_ERROR", field: "method", message: "Method not allowed" }, 405);
}

async function handleVersionLog(idOrSlug: string, url: URL, app: App): Promise<Response> {
  const limitParam = parseOptionalIntParam(url.searchParams.get("limit"), "limit", { min: 1 });
  if (!limitParam.ok) return limitParam.response;
  const offsetParam = parseOptionalIntParam(url.searchParams.get("offset"), "offset", { min: 0 });
  if (!offsetParam.ok) return offsetParam.response;

  const opts = {
    ...(limitParam.value !== undefined ? { limit: limitParam.value } : {}),
    ...(offsetParam.value !== undefined ? { offset: offsetParam.value } : {}),
  };
  const result = await app.versionService.log(idOrSlug, opts);
  if (!result.ok) return loreErrorResponse(result.error);
  return jsonOk(result.value);
}

async function handleVersionDiff(idOrSlug: string, url: URL, app: App): Promise<Response> {
  const fromParam = parseOptionalIntParam(url.searchParams.get("from"), "from", { min: 1 });
  if (!fromParam.ok) return fromParam.response;
  const toParam = parseOptionalIntParam(url.searchParams.get("to"), "to", { min: 1 });
  if (!toParam.ok) return toParam.response;

  const opts = {
    ...(fromParam.value !== undefined ? { from: fromParam.value } : {}),
    ...(toParam.value !== undefined ? { to: toParam.value } : {}),
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
