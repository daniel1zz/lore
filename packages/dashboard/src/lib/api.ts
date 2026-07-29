/**
 * Typed fetch wrapper for the Lore HTTP API.
 * Purpose: all API calls from the dashboard go through these helpers; they parse
 *   the server's { ok, data } envelope and normalize errors.
 * Public surface: apiList, apiSearch, apiTree, apiGetDoc, apiGetStatus,
 *   apiGetJudgments, apiGetAuditForDoc, apiGetAuditVerify, apiGetCalibrationStats,
 *   apiGetPendingReview, apiGetConfig, apiGetMachineConfig,
 *   apiGetIssueReports, apiGetEvidencePanel, evidencePanelQueryKey,
 *   apiGetReadyReport, apiGetPhaseStatus, apiGetProjects
 * Invariants: 5-second timeout via AbortSignal.timeout; never leaks raw Response objects.
 *   Throws ApiError on non-2xx or server-side { ok: false } — EXCEPT `apiGetReadyReport`,
 *   which returns `Result<T, ApiError>` (the only Result-returning function in
 *   this file; every other export throws).
 * Side-effect class: IO (fetch)
 * Source: SPEC-011 §3, §5; SPEC-015 §3; SPEC-033 F1 (feedback-loop read routes);
 *   SPEC-037 §2 (readiness route client); SPEC-062 §Design D3 / SPEC-064 §Design D6
 *   (config GET reads — both team and machine scope, available to cookie AND
 *   bearer sessions, mirroring every other read in this file — see
 *   `config-routes.ts`'s module header on the auth-surface split); SPEC-075
 *   §Module Boundary (evidence-panel projection read); SPEC-077 S1/S3 (execution
 *   read surface — ready report incl. sessions/anchor_conflicts/claim_ttl_minutes,
 *   NEW phase-status route client). A stale flat-array reader for this same
 *   route (SPEC-037 D1 original, `ReadyRecord[]`-typed) was DELETED as a live
 *   SPEC-042 regression fix — the server has returned the `ReadyReport` OBJECT
 *   `{records, sessions, anchor_conflicts}` since SPEC-042, and that reader's
 *   flat typing let two consumers ship a `records.length`/`records.filter` call
 *   directly on that object (`undefined === 0` silently false, then a
 *   render-time TypeError on `.filter`) — see `task-fix-live-spec-042-
 *   regression-apigetready-types-api-ready`. `apiGetReadyReport` (this file,
 *   below) is the ONLY client for `GET /api/ready/:planIdOrSlug` now.
 * SPEC-078 D5/T10: `fetchJson`'s internal request routes through
 *   `project-api.ts`'s `apiFetch(project, resourcePath)` — every path literal
 *   in this file dropped its "/api" prefix (that prefix is now built
 *   exclusively inside `project-api.ts`, the ONE module allowed to write it,
 *   per the `dashboard-local/no-raw-api-literal` ESLint rule). Every exported
 *   function in this file takes `project: string | null` as its FIRST
 *   parameter (no default — SPEC-078 T10 threads the caller's
 *   `useProjectParam()` output explicitly rather than silently defaulting to
 *   `null`, so a forgotten thread-through fails typecheck, not silently at
 *   runtime). `project === null` reproduces today's registry-less paths,
 *   byte-identical to pre-SPEC-078 behavior.
 */

import type {
  AcCoverageFact,
  AuditEntry,
  ConfigEffect,
  DocRecord,
  DocSummary,
  DocType,
  DocTypeMeta,
  DocStatus,
  EvidencePanelProjection,
  GlobalLoreConfig,
  LoreConfig,
  ReadyRecord,
  ReadySession,
  ReviewJudgment,
  Result,
  SearchHit,
} from "@lore/core";
import { ok } from "@lore/core";
import { apiFetch, queryKeys } from "./project-api";
import type { ProjectsResponse } from "./project-api";

// ─── Error type ──────────────────────────────────────────────────────────────

/** Structured API error returned when the server responds with { ok: false } or non-2xx. */
export class ApiError extends Error {
  /** HTTP status code or 0 for network/timeout errors. */
  readonly status: number;
  /** Server error code if present. */
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

// ─── Response types (mirrors the Lore HTTP server shapes) ───────────────────

export interface DocNavigation {
  parent: DocSummary | null;
  /**
   * Root-first `parent_id` chain, excluding the current doc (SPEC-036 §1 D1,
   * AC-36-1). Empty for root docs. `ancestors[0]` is the tree root;
   * `ancestors[ancestors.length - 1]` equals `parent` when `parent` is
   * non-null. Mirrors `CorpusService.get`'s `navigation.ancestors`
   * (`packages/lore/src/service/corpus-service.ts`) exactly.
   */
  ancestors: DocSummary[];
  siblings: DocSummary[];
  children: DocSummary[];
  related: Array<DocSummary & { link_type: string }>;
}

export interface ResolvedComponent {
  name: string;
  props: Record<string, unknown>;
  data: unknown;
  position: { start: number; end: number };
}

export interface ResolutionWarning {
  message: string;
  component: string;
  position: { start: number; end: number };
}

export interface ResolvedMdx {
  content: string;
  resolvedComponents: ResolvedComponent[];
  warnings: ResolutionWarning[];
}

export interface DocWithNavigation {
  doc: DocRecord;
  navigation: DocNavigation;
  resolvedMdx?: ResolvedMdx;
}

export interface ListResponse {
  docs: DocSummary[];
  total: number;
}

/**
 * A single full-text search hit. Mirrors `SearchHit`
 * (`packages/lore/src/store/store-interface.ts`) exactly — `CorpusService.search`
 * returns `Result<{ results: SearchHit[] }, LoreError>` with NO `total` field, so the
 * result count on the search page is derived client-side as `results.length`. A past
 * version of this type guessed a `{docs, total}` shape that the server never emits,
 * which crashed `data.docs.map` at runtime (SPEC-031 read-path contract drift).
 *
 * This is a direct re-export of `@lore/core`'s `SearchHit` (browser-safe, exported
 * via the barrel) rather than a hand-duplicated interface — `SearchHit` already IS
 * the SSOT shape the HTTP layer emits, so declaring a second copy here would be a
 * driftable dual-source type for zero benefit (SPEC-037 §2 added `type`/`status`;
 * re-exporting means this file can never fall out of sync with that addition).
 * `snippet` wraps matched spans in `SNIPPET_MARK_OPEN`/`SNIPPET_MARK_CLOSE`
 * (also re-exported below) — render with `<mark>`, never `dangerouslySetInnerHTML`.
 */
export type { SearchHit } from "@lore/core";
export { SNIPPET_MARK_OPEN, SNIPPET_MARK_CLOSE } from "@lore/core";

export interface SearchResponse {
  results: SearchHit[];
}

/**
 * A node in the corpus tree. Mirrors `TreeNode`
 * (`packages/lore/src/service/corpus-service.ts`) exactly — `CorpusService.tree`
 * returns `Result<TreeNode, LoreError>`, a SINGLE recursive root object, not an array
 * of top-level nodes. Doc fields live under `.doc` (a `DocSummary`), not flattened
 * onto the node itself. A past version of this type flattened `{id,slug,title,...}`
 * directly onto the node, which crashed `nodes.map is not a function` at runtime
 * (SPEC-031 read-path contract drift).
 */
export interface TreeNode {
  doc: DocSummary;
  children: TreeNode[];
}

export interface StatusResponse {
  total_docs: number;
  by_type: Record<string, number>;
  by_status: Record<string, number>;
}

// ─── Filter types ─────────────────────────────────────────────────────────────

export interface ListOpts {
  type?: DocType;
  status?: DocStatus;
  parent_id?: string;
  since?: string;
  /**
   * Tag names to filter by — server semantics are AND (a doc must carry
   * EVERY listed tag), matching `ListFilters.tags`'s existing in-memory
   * `requiredTags.every(...)` filter (`packages/lore/src/store/sqlite-store.ts`).
   * Joined into a single comma-separated `tags` query param by {@link apiList}
   * (SPEC-036 §1 D2).
   */
  tags?: string[];
}

export interface SearchOpts {
  type?: DocType;
  status?: DocStatus;
}

export interface TreeOpts {
  root?: string;
  depth?: number;
}

export interface GetDocOpts {
  resolveMdx?: boolean;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Build a URLSearchParams string from an options object, omitting undefined values.
 * @param opts - Key-value pairs to serialize.
 * @returns Query string (without leading "?"), or empty string if no params.
 */
function buildQueryString(opts: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(opts)) {
    if (value !== undefined) {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : "";
}

/**
 * Fetch a resource path (the portion AFTER "/api" — see `project-api.ts`'s
 * `apiFetch` doc comment) with a 5-second timeout, returning parsed JSON
 * data. Throws ApiError on non-2xx HTTP status or server { ok: false }.
 *
 * Routes through `apiFetch` (SPEC-078 D5) with the caller-supplied `project`
 * — `null` resolves to today's registry-less paths, byte-identical to the
 * pre-SPEC-078 direct `fetch(path)` call this replaced.
 *
 * @param project - Registry project name, or `null` for registry-less mode.
 * @throws {ApiError} On HTTP error, server error, or timeout.
 */
async function fetchJson<T>(project: string | null, resourcePath: string): Promise<T> {
  let response: Response;
  try {
    response = await apiFetch(project, resourcePath, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
      // reason: credentials: "include" sends the lore_sid session cookie set by bootstrapAuthIfNeeded().
      // Without this flag, the browser omits cookies even for same-origin requests made via
      // the Vite proxy. AC-A-S3. SPEC-016 §3.9.
      credentials: "include",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error";
    throw new ApiError(0, "NETWORK_ERROR", message);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(response.status, "PARSE_ERROR", "Failed to parse JSON response");
  }

  const envelope = body as { ok: boolean; data?: T; error?: { code?: string; message?: string } };

  if (!response.ok || !envelope.ok) {
    const errPayload = envelope.error ?? {};
    throw new ApiError(
      response.status,
      errPayload.code ?? "API_ERROR",
      errPayload.message ?? `HTTP ${response.status}`,
    );
  }

  return envelope.data as T;
}

// ─── Public API functions ────────────────────────────────────────────────────

/**
 * Fetch the corpus status (total docs, by_type, by_status).
 *
 * @param project - Registry project name, or `null` for registry-less mode.
 * @returns Status snapshot from the server.
 * @throws {ApiError} On HTTP or network error.
 */
export async function apiGetStatus(project: string | null): Promise<StatusResponse> {
  return fetchJson<StatusResponse>(project, "/status");
}

/**
 * Fetch a filtered list of documents.
 *
 * @param project - Registry project name, or `null` for registry-less mode.
 * @param opts - Optional filter parameters.
 * @returns Paginated docs and total count.
 * @throws {ApiError} On HTTP or network error.
 */
export async function apiList(project: string | null, opts: ListOpts = {}): Promise<ListResponse> {
  // reason: `tags` is a string[] but buildQueryString only accepts scalar values —
  // join it into the same comma-separated form the HTTP server already comma-splits
  // (routes.ts) before building the rest of the query string from the scalar fields.
  const { tags, ...scalarOpts } = opts;
  const qs = buildQueryString({
    ...(scalarOpts as Record<string, string | undefined>),
    ...(tags !== undefined && tags.length > 0 ? { tags: tags.join(",") } : {}),
  });
  return fetchJson<ListResponse>(project, `/docs${qs}`);
}

/**
 * Full-text search across the corpus.
 *
 * @param project - Registry project name, or `null` for registry-less mode.
 * @param query - Search string (FTS5 query).
 * @param opts - Optional type/status filters.
 * @returns Matching docs and total count.
 * @throws {ApiError} On HTTP or network error.
 */
export async function apiSearch(
  project: string | null,
  query: string,
  opts: SearchOpts = {},
): Promise<SearchResponse> {
  const qs = buildQueryString({ q: query, ...opts } as Record<string, string | undefined>);
  return fetchJson<SearchResponse>(project, `/search${qs}`);
}

/**
 * Fetch the document tree rooted at an optional ID.
 *
 * @param project - Registry project name, or `null` for registry-less mode.
 * @param opts - Optional root ID and depth.
 * @returns The recursive root `TreeNode` (never a bare array — see `TreeNode` doc comment).
 * @throws {ApiError} On HTTP or network error (e.g. no PRD exists to default to).
 */
export async function apiTree(project: string | null, opts: TreeOpts = {}): Promise<TreeNode> {
  const qs = buildQueryString(opts as Record<string, string | number | undefined>);
  return fetchJson<TreeNode>(project, `/tree${qs}`);
}

/**
 * Fetch a single document by ID or slug, optionally with MDX placeholders resolved.
 *
 * @param project - Registry project name, or `null` for registry-less mode.
 * @param idOrSlug - Document ULID or slug.
 * @param opts.resolveMdx - When true, server resolves MDX placeholders and includes resolvedMdx field.
 * @returns DocWithNavigation, optionally extended with resolvedMdx.
 * @throws {ApiError} On HTTP or network error.
 */
export async function apiGetDoc(
  project: string | null,
  idOrSlug: string,
  opts: GetDocOpts = {},
): Promise<DocWithNavigation> {
  const qs = buildQueryString({ resolveMdx: opts.resolveMdx });
  return fetchJson<DocWithNavigation>(project, `/docs/${encodeURIComponent(idOrSlug)}${qs}`);
}

// ─── Version history ──────────────────────────────────────────────────────────

/**
 * A version log entry from the server. Mirrors `VersionEntry`
 * (`packages/lore/src/service/version-service.ts`) exactly — that service type is the
 * only source of truth for this shape; do not add fields here that the service doesn't
 * populate (e.g. a past `title` / `status` drifted in without the server ever emitting
 * them, which silently rendered as `undefined` in the UI).
 */
export interface VersionLogEntry {
  version: number;
  action: string;
  created_at: string;
  created_by: string;
  change_summary?: string;
}

/** Unified diff between two versions. */
export interface VersionDiffResponse {
  from_version: number;
  to_version: number;
  content_diff: string;
}

/**
 * Fetch version history for a document.
 *
 * @param project - Registry project name, or `null` for registry-less mode.
 * @param idOrSlug - Document ULID or slug.
 * @param opts - Pagination options.
 * @returns Version log entries, newest first — `GET /api/docs/:id/log`'s `data` field
 *   is a bare array (`VersionService.log` returns `Result<VersionEntry[], LoreError>`;
 *   `routes.ts::handleVersionLog` does `jsonOk(result.value)` with no `{versions,total}`
 *   wrapper — see `packages/lore/tests/unit/adapters/http/routes.test.ts`
 *   "GET /api/docs/:id/log" which asserts `Array.isArray(body.data)`).
 * @throws {ApiError} On HTTP or network error.
 */
export async function apiGetVersionLog(
  project: string | null,
  idOrSlug: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<VersionLogEntry[]> {
  const qs = buildQueryString(opts as Record<string, number | undefined>);
  return fetchJson<VersionLogEntry[]>(project, `/docs/${encodeURIComponent(idOrSlug)}/log${qs}`);
}

/**
 * Fetch a unified diff between two versions of a document.
 *
 * @param project - Registry project name, or `null` for registry-less mode.
 * @param idOrSlug - Document ULID or slug.
 * @param opts - from/to version numbers.
 * @returns Unified diff.
 * @throws {ApiError} On HTTP or network error.
 */
export async function apiGetVersionDiff(
  project: string | null,
  idOrSlug: string,
  opts: { from?: number; to?: number } = {},
): Promise<VersionDiffResponse> {
  const qs = buildQueryString(opts as Record<string, number | undefined>);
  return fetchJson<VersionDiffResponse>(project, `/docs/${encodeURIComponent(idOrSlug)}/diff${qs}`);
}

// ─── SPEC-033 F1: feedback-loop reads (judgments, audit, calibration stats) ──

/**
 * A doc's latest AI review judgment plus its full history. Mirrors the shape
 * `GET /api/judgments/:docId` returns (`routes.ts::handleGetJudgments`) — the
 * server never wraps this further, so `history` includes `latest` as its
 * first element when a judgment exists (never de-duplicated server-side).
 */
export interface JudgmentsResponse {
  latest: ReviewJudgment | null;
  history: ReviewJudgment[];
}

/**
 * One versions row with no matching audit entry. Mirrors `AuditMiss`
 * (`packages/lore/src/service/audit-service.ts`) exactly — that service type
 * is the only source of truth for this shape.
 */
export interface AuditMissRow {
  doc_id: string;
  version: number;
  action: string;
  created_at: string;
}

/** Response shape of `GET /api/audit/verify`. Mirrors `AuditVerifyResult` (`audit-service.ts`). */
export interface AuditVerifyResponse {
  clean: boolean;
  misses: AuditMissRow[];
  since: string;
}

/**
 * One aggregated calibration statistic row. Mirrors `CalibrationStats`
 * (`packages/lore/src/service/judgment-service.ts`) exactly.
 */
export interface CalibrationStatsRow {
  doc_type: DocType;
  prompt_version: string;
  n: number;
  agreement_rate: number;
  wilson_lower_bound: number;
  window_limit: number;
}

/** Optional narrowing filters for {@link apiGetCalibrationStats}. */
export interface CalibrationStatsOpts {
  docType?: DocType;
  promptVersion?: string;
}

/**
 * Fetch a document's latest AI review judgment plus its full history.
 *
 * @param project - Registry project name, or `null` for registry-less mode.
 * @param docId - Document ULID.
 * @returns `{ latest, history }` — `latest` is `null` when the doc has never been judged.
 * @throws {ApiError} On HTTP or network error.
 */
export async function apiGetJudgments(project: string | null, docId: string): Promise<JudgmentsResponse> {
  return fetchJson<JudgmentsResponse>(project, `/judgments/${encodeURIComponent(docId)}`);
}

/**
 * Fetch a document's audit trail (newest first). Actor strings are RAW —
 * AI-judge entries look like `ai:claude-cli:claude-sonnet-5:v1`; decode them
 * with `parseAuditActor` (browser-safe, `@lore/core`) for display, never here.
 *
 * @param project - Registry project name, or `null` for registry-less mode.
 * @param docId - Document ULID.
 * @returns Audit entries for the doc.
 * @throws {ApiError} On HTTP or network error.
 */
export async function apiGetAuditForDoc(project: string | null, docId: string): Promise<AuditEntry[]> {
  return fetchJson<AuditEntry[]>(project, `/audit/${encodeURIComponent(docId)}`);
}

/**
 * Run the versions⋈audit completeness oracle across the whole corpus.
 *
 * @param project - Registry project name, or `null` for registry-less mode.
 * @param opts.since - Optional ISO 8601 watermark override.
 * @returns `{ clean, misses, since }`.
 * @throws {ApiError} On HTTP or network error.
 */
export async function apiGetAuditVerify(
  project: string | null,
  opts: { since?: string } = {},
): Promise<AuditVerifyResponse> {
  const qs = buildQueryString(opts as Record<string, string | undefined>);
  return fetchJson<AuditVerifyResponse>(project, `/audit/verify${qs}`);
}

/**
 * Fetch Wilson-bound calibration agreement stats per (doc_type, prompt_version).
 *
 * @param project - Registry project name, or `null` for registry-less mode.
 * @param opts - Optional doc_type/prompt_version narrowing.
 * @returns One row per distinct (doc_type, prompt_version) pair present in the window.
 * @throws {ApiError} On HTTP or network error.
 */
export async function apiGetCalibrationStats(
  project: string | null,
  opts: CalibrationStatsOpts = {},
): Promise<CalibrationStatsRow[]> {
  const qs = buildQueryString({ doc_type: opts.docType, prompt_version: opts.promptVersion });
  return fetchJson<CalibrationStatsRow[]>(project, `/calibration/stats${qs}`);
}

// ─── SPEC-033 F2: pending-review queue (home page + triage panels) ──────────

/**
 * One pending (draft-status) document row. Mirrors `PendingDoc`
 * (`packages/lore/src/service/review-service.ts`) exactly — `ReviewService.pending`
 * returns `Result<PendingDoc[], LoreError>`; `GET /api/review/pending`
 * (`routes.ts::handleReviewPending`) emits the bare array via `jsonOk(result.value)`,
 * no `{docs,total}` wrapper — same bare-array precedent as `apiGetVersionLog`.
 * Carries `version` (unlike `DocSummary`, which omits it) — required to detect a
 * stale judgment via `judgment.doc_version < row.version` (`JudgmentBadge`).
 * `meta` mirrors `DocSummary.meta` (SPEC-036 §2 D3) — same `deriveTypeMeta`
 * projection, server-side, now also applied to `PendingDoc` rows; absent for
 * `prd` or when the doc's type-specific `extra` is missing/malformed.
 */
export interface PendingDocRow {
  id: string;
  type: DocType;
  title: string;
  status: "draft";
  created_by: string;
  updated_at: string;
  version: number;
  change_summary?: string;
  meta?: DocTypeMeta;
}

/** Optional narrowing filters for {@link apiGetPendingReview}. Mirrors `PendingFilters`. */
export interface PendingReviewOpts {
  author?: string;
  type?: DocType;
  since?: string;
}

/**
 * Fetch documents in draft status awaiting review.
 *
 * @param project - Registry project name, or `null` for registry-less mode.
 * @param opts - Optional author/type/since filters.
 * @returns Pending doc rows (server order — `ReviewService.pending`'s underlying
 *   `findMany` query, not independently re-sorted here).
 * @throws {ApiError} On HTTP or network error.
 */
export async function apiGetPendingReview(
  project: string | null,
  opts: PendingReviewOpts = {},
): Promise<PendingDocRow[]> {
  const qs = buildQueryString(opts as Record<string, string | undefined>);
  return fetchJson<PendingDocRow[]>(project, `/review/pending${qs}`);
}

// ─── SPEC-037 D1: computed readiness ─────────────────────────────────────────

/**
 * Per-task computed readiness record. Direct re-export of `ReadyRecord`
 * (`packages/core/src/task-workflow.ts:104-126`) — that module is browser-safe
 * and already exported via the `@lore/core` barrel, so re-exporting (rather
 * than hand-copying the shape into a second interface, as the other response
 * types in this file do for shapes that live server-side only) mirrors it
 * EXACTLY with zero drift risk. `task` is a narrow `DocSummary` projection
 * with NO `.meta` (server contract, SPEC-037 §0) — callers that need
 * type-differentiated meta must join against `navigation.children` instead.
 *
 * @invariant This type has NO dedicated fetch function of its own — the route
 *   that produces it, `GET /api/ready/:planIdOrSlug`, has always returned the
 *   FULL `ReadyReport` object `{records, sessions, anchor_conflicts}` (SPEC-042),
 *   never a bare `ReadyRecord[]`. A now-deleted flat-array reader once typed
 *   that route's response as `ReadyRecord[]` directly and was removed as a
 *   live regression fix (`task-fix-live-spec-042-regression-apigetready-types-api-ready`)
 *   — use {@link apiGetReadyReport} and read `.value.records`.
 */
export type { ReadyRecord } from "@lore/core";

// ─── SPEC-062/SPEC-064: config read (team + machine scope) ──────────────────

/**
 * Response shape shared by `GET /api/config` and `GET /api/config/machine`
 * (`handleGetConfig`/`handleGetMachineConfig`, `config-routes.ts`) — the
 * redacted config, its per-leaf-key effect classification, and a sha256
 * `hash` over the redacted view (the `If-Match` value a subsequent
 * `apiPatchConfig`/`apiPatchMachineConfig` call must send, SPEC-064 D5).
 */
export interface ConfigReadResponse<C> {
  config: C;
  effects: Record<string, ConfigEffect>;
  hash: string;
}

/**
 * Fetch the TEAM-scope config (`.lore/config.yaml`, `LoreConfigSchema`),
 * redacted per `CONFIG_REDACT_KEYS`. Available to both cookie and bearer
 * sessions (SPEC-062 D3).
 *
 * @param project - Registry project name, or `null` for registry-less mode.
 * @throws {ApiError} On HTTP or network error.
 */
export async function apiGetConfig(project: string | null): Promise<ConfigReadResponse<LoreConfig>> {
  return fetchJson<ConfigReadResponse<LoreConfig>>(project, "/config");
}

/**
 * Fetch the MACHINE-scope config (XDG global config, `GlobalLoreConfigSchema`
 * — `{defaults?}` only), redacted per `CONFIG_REDACT_KEYS`. A missing file on
 * disk is NOT an error (SPEC-064 D7) — the server returns an empty/near-empty
 * `config` with `ok: true`, same shape as a populated one. Available to both
 * cookie and bearer sessions, mirroring {@link apiGetConfig} (SPEC-064 D6).
 *
 * @throws {ApiError} On HTTP or network error (including a malformed on-disk
 *   global config — SPEC-064 D7's "loud banner in that scope only" is a
 *   caller-side concern: this function still just throws `ApiError`, the
 *   Settings route's machine-scope panel is what must not let that failure
 *   blank the team-scope panel too).
 * @param project - Registry project name, or `null` for registry-less mode.
 */
export async function apiGetMachineConfig(
  project: string | null,
): Promise<ConfigReadResponse<GlobalLoreConfig>> {
  return fetchJson<ConfigReadResponse<GlobalLoreConfig>>(project, "/config/machine");
}

// ─── SPEC-074: dashboard Issues triage projection ────────────────────────────

/**
 * A filed issue report's D2-computed resolution
 * (spec-issue-closure-loop-computed-resolution-agent-reachable). Mirrors the
 * SAME literal union `packages/lore/src/service/issue-resolution.ts`'s
 * `IssueResolution` server type declares — duplicated here (not imported)
 * because this package depends on `@lore/core` only (browser-safe boundary,
 * `packages/dashboard/CLAUDE.md`), and `issue-resolution.ts` lives in the
 * server-only `packages/lore/src` tree. A wire-contract type mirror across a
 * network boundary, not a "third copy" of a validated list (that concern is
 * `linkTypeSchema.options` / `LINK_TYPES`, an enumerable value the frontend
 * DOES import) — there is nowhere browser-safe for the frontend to import
 * this union's VALUES from, only its literal shape.
 */
export type IssueResolution = "open" | "resolving" | "fixed" | "rejected" | "wontfix";

/**
 * One row of the `GET /api/issue-reports` projection. Mirrors `IssueReportRow`
 * (`packages/lore/src/adapters/http/issue-reports-routes.ts`) exactly — the 8
 * report-identity fields plus lifecycle `status` plus the D7 computed
 * `resolution`. Never carries the full `extra.issue_report` payload (e.g.
 * `expected`/`actual`/`repro_command`) — the detail view reads those via the
 * existing `GET /api/docs/:id` route (`apiGetDoc`), per the server module's
 * own doc comment.
 *
 * `status` and `resolution` are INTENTIONALLY independent (see the server
 * type's own doc comment) — a row can render `status: "draft"` alongside
 * `resolution: "fixed"` (an unclosed escalation, D5(a)); consumers must
 * render `resolution`, never infer it from `status`.
 */
export interface IssueReportRow {
  id: string;
  slug: string;
  title: string;
  reporter_project: string;
  reporter_actor: string;
  lore_version: string;
  reported_at: string;
  possible_duplicates: string[];
  status: string;
  resolution: IssueResolution;
}

/**
 * Response shape of `GET /api/issue-reports`. `open_count` counts rows whose
 * `resolution` is `"open"` (D7/D8) — can be strictly less than `rows.length`
 * once a row has resolved but not yet been archived (see `IssueReportRow`).
 */
export interface IssueReportsResponse {
  rows: IssueReportRow[];
  open_count: number;
}

/**
 * Fetch the open incoming issue-report projection (SPEC-074) — the SAME
 * endpoint the dashboard's nav badge, home card, and Issues list page all
 * read (spec's "one endpoint, no second count route" design note — see
 * `src/lib/issue-reports-query.ts`, this file's shared TanStack Query binding).
 *
 * @param project - Registry project name, or `null` for registry-less mode.
 * @returns `{ rows, open_count }` — rows sorted `reported_at` descending.
 * @throws {ApiError} On HTTP or network error.
 */
export async function apiGetIssueReports(project: string | null): Promise<IssueReportsResponse> {
  return fetchJson<IssueReportsResponse>(project, "/issue-reports");
}

// ─── SPEC-075: dashboard adjudication workbench (evidence-panel read) ───────

/**
 * TanStack Query key for a doc's evidence-panel projection — a shared helper
 * (not a bare literal) so `EvidenceTab` (self-contained fetch, mounted only
 * when its tab is active) and `DocDetail` (fetches once for `AdjudicationBar`,
 * mounted unconditionally in the header for in-review docs) resolve to the
 * SAME cache entry — one network request when both are mounted, never two.
 *
 * @param project - Registry project name, or `null` for registry-less mode.
 * @param idOrSlug - Document ULID or slug.
 */
export function evidencePanelQueryKey(project: string | null, idOrSlug: string): readonly unknown[] {
  return queryKeys.scope(project, ["evidence-panel", idOrSlug]);
}

/**
 * Fetch the dashboard adjudication workbench's Evidence-tab projection for one
 * doc (SPEC-075 §Module Boundary). Thin pipe over `GET /api/evidence-panel/:idOrSlug`
 * — the response `data` field IS the `EvidencePanelProjection` discriminated
 * union verbatim (`VerificationProjectionService.evidencePanel`,
 * `packages/lore/src/service/verification-projection-service.ts`), no
 * client-side re-shaping.
 *
 * @param project - Registry project name, or `null` for registry-less mode.
 * @param idOrSlug - Document ULID, slug, or unique id-prefix.
 * @returns The assembled projection, discriminated by `doc_type`.
 * @throws {ApiError} On HTTP or network error (e.g. `DOC_NOT_FOUND` for an
 *   unknown id, or `VALIDATION_ERROR` for the D9 phase-children-without-tasks
 *   hierarchy-assumption violation).
 */
export async function apiGetEvidencePanel(
  project: string | null,
  idOrSlug: string,
): Promise<EvidencePanelProjection> {
  return fetchJson<EvidencePanelProjection>(project, `/evidence-panel/${encodeURIComponent(idOrSlug)}`);
}

// ─── SPEC-077: dashboard execution read surface ─────────────────────────────

/**
 * One SPEC-042 D7 anchor-overlap advisory entry. Hand-copied (not a `@lore/core`
 * re-export) — `AnchorConflict` is declared in `packages/lore/src/service/
 * task-workflow-service.ts` (a LORE-package-only type), and `@lore/dashboard`
 * must never depend on `@lore/lore` (module invariant, `packages/dashboard/
 * CLAUDE.md`). Mirrors that interface exactly: `task_slug` is the task IN THIS
 * REPORT the conflict applies to; `holder`/`paths` describe the fresh foreign
 * sibling claim it collides with.
 */
export interface AnchorConflict {
  task_slug: string;
  holder: string;
  paths: string[];
}

/**
 * `TaskWorkflowService.ready`'s FULL return shape (`ReadyReport`,
 * `packages/lore/src/service/task-workflow-service.ts`) plus the SPEC-077 S4
 * additive `claim_ttl_minutes` field — the resolved `workflow.claim_ttl_minutes`
 * config value, so the execution page's claim countdown never hardcodes the TTL.
 * Hand-copied for the same `@lore/lore` boundary reason as {@link AnchorConflict}.
 *
 * @invariant This is the CORRECTED shape for `GET /api/ready/:planIdOrSlug` —
 *   the route has returned `{records, sessions, anchor_conflicts}` (not a bare
 *   `ReadyRecord[]`) since SPEC-042 landed `sessions`/`anchor_conflicts` on
 *   `ReadyReport`. A now-deleted flat-array reader typed this route's response
 *   as a flat `ReadyRecord[]` (a latent SPEC-042-era contract drift discovered
 *   while building this route's SPEC-077 consumer) and broke two live
 *   consumers at render time; it was DELETED as a regression fix
 *   (`task-fix-live-spec-042-regression-apigetready-types-api-ready`) — this
 *   is now the ONLY client type/function pair for this route.
 */
export interface ReadyReportResponse {
  records: ReadyRecord[];
  sessions: ReadySession[];
  anchor_conflicts: AnchorConflict[];
  /** SPEC-077 S4 additive field — `workflow.claim_ttl_minutes`, HTTP-layer enrichment. */
  claim_ttl_minutes: number;
}

/**
 * Fetch the full computed readiness report for a plan — records, derived
 * sessions, anchor conflicts, and the claim TTL (SPEC-077 S1/S4). Thin pipe
 * over `GET /api/ready/:planIdOrSlug`, typed to the route's ACTUAL response
 * shape (see {@link ReadyReportResponse}'s invariant note). Result-returning
 * (never throws), per the SPEC-037 §2 contract, so callers (`ExecutionPage`,
 * `ActivePlansPanel`'s per-plan readiness row, `PlanExecution`'s Execution
 * section) can degrade a single plan's readiness fetch without needing
 * TanStack Query's `isError`/`error` machinery.
 *
 * @param project - Registry project name, or `null` for registry-less mode.
 * @param planIdOrSlug - Plan document ULID or slug.
 * @returns `{ok: true, value: ReadyReportResponse}` on success; `{ok: false, error: ApiError}`
 *   on any HTTP/network/server error (422 for a non-plan target, 404 for unknown id).
 */
export async function apiGetReadyReport(
  project: string | null,
  planIdOrSlug: string,
): Promise<Result<ReadyReportResponse, ApiError>> {
  try {
    const data = await fetchJson<ReadyReportResponse>(project, `/ready/${encodeURIComponent(planIdOrSlug)}`);
    return ok(data);
  } catch (caught) {
    const apiError =
      caught instanceof ApiError
        ? caught
        : new ApiError(0, "NETWORK_ERROR", caught instanceof Error ? caught.message : "Unknown error");
    return { ok: false, error: apiError };
  }
}

/**
 * AC-scope coverage summary for one phase — mirrors the server's
 * `PhaseScorecardAcSummary` (`packages/lore/src/service/phase-workflow-service.ts`)
 * field-for-field; this client type is NOT independently authored.
 */
export interface PhaseScorecardAcSummary {
  total: number;
  attested: number;
  blocking: string[];
}

/**
 * Aggregate checklist-state counts for one phase (per-item detail lives in
 * {@link PhaseScorecardChecklistItem}[] instead). Mirrors the server's
 * `PhaseScorecardChecklistSummary` field-for-field.
 */
export interface PhaseScorecardChecklistSummary {
  total: number;
  satisfied: number;
  blocking: string[];
  dropped_named: string[];
  manual_selfattested: string[];
}

/**
 * One checklist item within a {@link PhaseScorecard}. `state`/`trust` are
 * rendered VERBATIM by `PhaseProgressPanel` — never re-derived client-side
 * (mirrors this codebase's "manual-vs-attested trust labels ... never
 * re-derived" convention for evidence-panel projections, `packages/dashboard/
 * CLAUDE.md`). Mirrors the server's `PhaseScorecardChecklistItem`
 * (`packages/lore/src/service/phase-workflow-service.ts`) field-for-field —
 * NOT independently authored (a prior version of this type invented an
 * unreal `trust_label` field name and was the root cause of a live
 * `/execution` page crash, SPEC-077 T2 client-shape-drift fix).
 */
export interface PhaseScorecardChecklistItem {
  id: string;
  statement: string;
  /** "satisfied" | "blocking" | "dropped" — rendered verbatim. */
  state: string;
  /** "manual" | "attested" — which trust channel satisfies this item, rendered verbatim. */
  trust: string;
}

/**
 * One SPEC-056 phase-DOC's execution scorecard — SPEC-077 S2 `PhaseProgressPanel`
 * projection. Mirrors the server's `PhaseScorecard` (`packages/lore/src/service/
 * phase-workflow-service.ts`, the `GET /api/phase-status/:planIdOrSlug`
 * response's SSOT) field-for-field, incl. the `source: "phase-doc"`
 * discriminant added by `adr-planphasestatus-projects-declared-extra-phases-
 * alongside`. There is NO `dropped_item_names` field on the real response —
 * dropped item names are derived client-side from `checklist_items` entries
 * whose `state === "dropped"` (see `PhaseProgressPanel.tsx`'s
 * `droppedItemNames` helper).
 */
export interface PhaseScorecard {
  source: "phase-doc";
  phase_id: string;
  phase_slug: string;
  phase_title: string;
  state: string;
  /** True iff `state === "vacuous"` (SPEC-056 §Design Decisions D3 anti-vacuous-completion guard). */
  vacuous: boolean;
  ac_scope: PhaseScorecardAcSummary;
  checklist: PhaseScorecardChecklistSummary;
  checklist_items: PhaseScorecardChecklistItem[];
  /** Full blocking list — AC ids followed by checklist item ids. */
  blocking: string[];
  claim: { by: string; at: string; stale: boolean } | null;
  /** Legacy SPEC-023 string-linkage diagnostic count — see server JSDoc; not rendered here. */
  task_count: number;
}

/**
 * One SPEC-023 DECLARED phase (`plan.extra.phases[]`) with no corresponding
 * SPEC-056 phase doc — mirrors the server's `DeclaredPhaseScorecard`
 * (`packages/lore/src/service/phase-workflow-service.ts`) field-for-field
 * (`adr-planphasestatus-projects-declared-extra-phases-alongside`).
 * Deliberately has NO `checklist`/`checklist_items`/`claim`/`phase_id`/`state`/
 * `vacuous` — those are phase-DOC-only concepts (see the server type's own
 * JSDoc for why). `ac_coverage` is `AcCoverageFact[]` (`@lore/core`,
 * `acceptance.ts`) — the SAME shape `SpecAcCoveragePanel` already renders,
 * never a locally-invented summary shape.
 */
export interface DeclaredPhaseScorecard {
  source: "declared";
  phase_title: string;
  /** `true` when this phase name is absent from the plan's CURRENT `extra.phases[]` — an orphaned task-phase reference. */
  orphaned: boolean;
  /** Count of `task`-typed plan children whose `extra.phase` names this phase. */
  task_count: number;
  /** Sum of `verification_evidence[].result` across every task grouped here. */
  evidence: { pass: number; fail: number };
  /** AC-scope coverage for this phase's tasks, computed server-side via `computeAcCoverage` — never recomputed here. */
  ac_coverage: AcCoverageFact[];
}

/**
 * One `planPhaseStatus` entry — a discriminated union (tag: `source`) of the
 * two phase-authoring paths this corpus supports, mirroring the server's
 * `PlanPhaseEntry` (`adr-planphasestatus-projects-declared-extra-phases-
 * alongside`). A client that only ever saw `PhaseScorecard` entries before
 * this ADR must branch on `source` to keep rendering correctly now that the
 * array is mixed — see `PhaseProgressPanel.tsx`.
 */
export type PlanPhaseEntry = PhaseScorecard | DeclaredPhaseScorecard;

/** Response shape of the `GET /api/phase-status/:planIdOrSlug` route (SPEC-077 S3, extended by adr-planphasestatus-projects-declared-extra-phases-alongside). */
export interface PhaseStatusResponse {
  plan: { id: string; slug: string; title: string };
  phases: PlanPhaseEntry[];
}

/**
 * Fetch per-phase execution scorecards for a plan (SPEC-077 S3, T1 sibling
 * task). Thin pipe over `GET /api/phase-status/:planIdOrSlug`; a plan with no
 * phases returns `{plan, phases: []}` (still 200, not an error).
 *
 * @param project - Registry project name, or `null` for registry-less mode.
 * @param planIdOrSlug - Plan document ULID or slug.
 * @throws {ApiError} On HTTP or network error (404 unknown id, 422 non-plan target).
 */
export async function apiGetPhaseStatus(
  project: string | null,
  planIdOrSlug: string,
): Promise<PhaseStatusResponse> {
  return fetchJson<PhaseStatusResponse>(project, `/phase-status/${encodeURIComponent(planIdOrSlug)}`);
}

// ─── SPEC-078 D7: project registry + mount-state health projection ──────────

/**
 * Fetch the mount registry projection (SPEC-078 D7) — one entry per
 * `dashboard.projects` registry item plus this serving instance's identity.
 * ALWAYS called with `project: null` — discovering which projects exist is
 * structurally a registry-less-mode query (there is no project to scope it
 * to yet), so unlike every other function in this file this one takes no
 * `project` parameter.
 *
 * The route (`GET /api/projects`, T8) does not exist until the server-wave
 * task lands — until then this call always resolves to a 404 `ApiError`,
 * which callers (`useProjectsQuery`, `lib/use-projects-query.ts`) treat as
 * the "no registry" signal and degrade to single-project chrome (the SAME
 * degrade path as a real empty/absent `dashboard.projects` config — see that
 * module's doc comment for the silent-vs-loud error split).
 *
 * @returns Registry entries + serving instance identity.
 * @throws {ApiError} On HTTP or network error (404 = no registry route/config).
 */
export async function apiGetProjects(): Promise<ProjectsResponse> {
  return fetchJson<ProjectsResponse>(null, "/projects");
}
