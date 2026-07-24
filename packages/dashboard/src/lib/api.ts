/**
 * Typed fetch wrapper for the Lore HTTP API.
 * Purpose: all API calls from the dashboard go through these helpers; they parse
 *   the server's { ok, data } envelope and normalize errors.
 * Public surface: apiList, apiSearch, apiTree, apiGetDoc, apiGetStatus,
 *   apiGetJudgments, apiGetAuditForDoc, apiGetAuditVerify, apiGetCalibrationStats,
 *   apiGetPendingReview, apiGetReady, apiGetConfig, apiGetMachineConfig,
 *   apiGetIssueReports, apiGetEvidencePanel, evidencePanelQueryKey
 * Invariants: 5-second timeout via AbortSignal.timeout; never leaks raw Response objects.
 *   Throws ApiError on non-2xx or server-side { ok: false } — EXCEPT `apiGetReady`,
 *   which returns `Result<ReadyRecord[], ApiError>` per its SPEC-037 §2 contract
 *   (the only Result-returning function in this file; every other export throws).
 * Side-effect class: IO (fetch)
 * Source: SPEC-011 §3, §5; SPEC-015 §3; SPEC-033 F1 (feedback-loop read routes);
 *   SPEC-037 §2 (readiness route client); SPEC-062 §Design D3 / SPEC-064 §Design D6
 *   (config GET reads — both team and machine scope, available to cookie AND
 *   bearer sessions, mirroring every other read in this file — see
 *   `config-routes.ts`'s module header on the auth-surface split); SPEC-075
 *   §Module Boundary (evidence-panel projection read)
 */

import type {
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
  ReviewJudgment,
  Result,
  SearchHit,
} from "@lore/core";
import { ok } from "@lore/core";

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
 * Fetch a URL with a 5-second timeout, returning parsed JSON data.
 * Throws ApiError on non-2xx HTTP status or server { ok: false }.
 *
 * @throws {ApiError} On HTTP error, server error, or timeout.
 */
async function fetchJson<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
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
 * @returns Status snapshot from the server.
 * @throws {ApiError} On HTTP or network error.
 */
export async function apiGetStatus(): Promise<StatusResponse> {
  return fetchJson<StatusResponse>("/api/status");
}

/**
 * Fetch a filtered list of documents.
 *
 * @param opts - Optional filter parameters.
 * @returns Paginated docs and total count.
 * @throws {ApiError} On HTTP or network error.
 */
export async function apiList(opts: ListOpts = {}): Promise<ListResponse> {
  // reason: `tags` is a string[] but buildQueryString only accepts scalar values —
  // join it into the same comma-separated form the HTTP server already comma-splits
  // (routes.ts) before building the rest of the query string from the scalar fields.
  const { tags, ...scalarOpts } = opts;
  const qs = buildQueryString({
    ...(scalarOpts as Record<string, string | undefined>),
    ...(tags !== undefined && tags.length > 0 ? { tags: tags.join(",") } : {}),
  });
  return fetchJson<ListResponse>(`/api/docs${qs}`);
}

/**
 * Full-text search across the corpus.
 *
 * @param query - Search string (FTS5 query).
 * @param opts - Optional type/status filters.
 * @returns Matching docs and total count.
 * @throws {ApiError} On HTTP or network error.
 */
export async function apiSearch(query: string, opts: SearchOpts = {}): Promise<SearchResponse> {
  const qs = buildQueryString({ q: query, ...opts } as Record<string, string | undefined>);
  return fetchJson<SearchResponse>(`/api/search${qs}`);
}

/**
 * Fetch the document tree rooted at an optional ID.
 *
 * @param opts - Optional root ID and depth.
 * @returns The recursive root `TreeNode` (never a bare array — see `TreeNode` doc comment).
 * @throws {ApiError} On HTTP or network error (e.g. no PRD exists to default to).
 */
export async function apiTree(opts: TreeOpts = {}): Promise<TreeNode> {
  const qs = buildQueryString(opts as Record<string, string | number | undefined>);
  return fetchJson<TreeNode>(`/api/tree${qs}`);
}

/**
 * Fetch a single document by ID or slug, optionally with MDX placeholders resolved.
 *
 * @param idOrSlug - Document ULID or slug.
 * @param opts.resolveMdx - When true, server resolves MDX placeholders and includes resolvedMdx field.
 * @returns DocWithNavigation, optionally extended with resolvedMdx.
 * @throws {ApiError} On HTTP or network error.
 */
export async function apiGetDoc(idOrSlug: string, opts: GetDocOpts = {}): Promise<DocWithNavigation> {
  const qs = buildQueryString({ resolveMdx: opts.resolveMdx });
  return fetchJson<DocWithNavigation>(`/api/docs/${encodeURIComponent(idOrSlug)}${qs}`);
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
  idOrSlug: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<VersionLogEntry[]> {
  const qs = buildQueryString(opts as Record<string, number | undefined>);
  return fetchJson<VersionLogEntry[]>(`/api/docs/${encodeURIComponent(idOrSlug)}/log${qs}`);
}

/**
 * Fetch a unified diff between two versions of a document.
 *
 * @param idOrSlug - Document ULID or slug.
 * @param opts - from/to version numbers.
 * @returns Unified diff.
 * @throws {ApiError} On HTTP or network error.
 */
export async function apiGetVersionDiff(
  idOrSlug: string,
  opts: { from?: number; to?: number } = {},
): Promise<VersionDiffResponse> {
  const qs = buildQueryString(opts as Record<string, number | undefined>);
  return fetchJson<VersionDiffResponse>(`/api/docs/${encodeURIComponent(idOrSlug)}/diff${qs}`);
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
 * @param docId - Document ULID.
 * @returns `{ latest, history }` — `latest` is `null` when the doc has never been judged.
 * @throws {ApiError} On HTTP or network error.
 */
export async function apiGetJudgments(docId: string): Promise<JudgmentsResponse> {
  return fetchJson<JudgmentsResponse>(`/api/judgments/${encodeURIComponent(docId)}`);
}

/**
 * Fetch a document's audit trail (newest first). Actor strings are RAW —
 * AI-judge entries look like `ai:claude-cli:claude-sonnet-5:v1`; decode them
 * with `parseAuditActor` (browser-safe, `@lore/core`) for display, never here.
 *
 * @param docId - Document ULID.
 * @returns Audit entries for the doc.
 * @throws {ApiError} On HTTP or network error.
 */
export async function apiGetAuditForDoc(docId: string): Promise<AuditEntry[]> {
  return fetchJson<AuditEntry[]>(`/api/audit/${encodeURIComponent(docId)}`);
}

/**
 * Run the versions⋈audit completeness oracle across the whole corpus.
 *
 * @param opts.since - Optional ISO 8601 watermark override.
 * @returns `{ clean, misses, since }`.
 * @throws {ApiError} On HTTP or network error.
 */
export async function apiGetAuditVerify(opts: { since?: string } = {}): Promise<AuditVerifyResponse> {
  const qs = buildQueryString(opts as Record<string, string | undefined>);
  return fetchJson<AuditVerifyResponse>(`/api/audit/verify${qs}`);
}

/**
 * Fetch Wilson-bound calibration agreement stats per (doc_type, prompt_version).
 *
 * @param opts - Optional doc_type/prompt_version narrowing.
 * @returns One row per distinct (doc_type, prompt_version) pair present in the window.
 * @throws {ApiError} On HTTP or network error.
 */
export async function apiGetCalibrationStats(
  opts: CalibrationStatsOpts = {},
): Promise<CalibrationStatsRow[]> {
  const qs = buildQueryString({ doc_type: opts.docType, prompt_version: opts.promptVersion });
  return fetchJson<CalibrationStatsRow[]>(`/api/calibration/stats${qs}`);
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
 * @param opts - Optional author/type/since filters.
 * @returns Pending doc rows (server order — `ReviewService.pending`'s underlying
 *   `findMany` query, not independently re-sorted here).
 * @throws {ApiError} On HTTP or network error.
 */
export async function apiGetPendingReview(opts: PendingReviewOpts = {}): Promise<PendingDocRow[]> {
  const qs = buildQueryString(opts as Record<string, string | undefined>);
  return fetchJson<PendingDocRow[]>(`/api/review/pending${qs}`);
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
 */
export type { ReadyRecord } from "@lore/core";

/**
 * Fetch computed task readiness for a plan (SPEC-025 `TaskWorkflowService.ready`,
 * exposed over HTTP by SPEC-037 D1). Unlike every other function in this file,
 * this does NOT throw on failure — it returns `Result<ReadyRecord[], ApiError>`
 * per the SPEC-037 §2 contract, so callers (e.g. `ActivePlansPanel`'s per-plan
 * readiness query) can degrade a single row without needing TanStack Query's
 * `isError`/`error` machinery to distinguish "no data yet" from "this plan's
 * readiness fetch failed."
 *
 * @param planIdOrSlug - Plan document ULID or slug.
 * @returns `{ok: true, value: ReadyRecord[]}` on success; `{ok: false, error: ApiError}`
 *   on any HTTP/network/server error (422 for a non-plan target, 404 for unknown id).
 */
export async function apiGetReady(planIdOrSlug: string): Promise<Result<ReadyRecord[], ApiError>> {
  try {
    const data = await fetchJson<ReadyRecord[]>(`/api/ready/${encodeURIComponent(planIdOrSlug)}`);
    return ok(data);
  } catch (caught) {
    // reason: `@lore/core`'s `err()` helper requires `E extends LoreError` — `ApiError`
    // is a distinct client-side error class, so the failure branch is built directly
    // rather than forcing it through a helper typed for the wrong error union.
    const apiError =
      caught instanceof ApiError
        ? caught
        : new ApiError(0, "NETWORK_ERROR", caught instanceof Error ? caught.message : "Unknown error");
    return { ok: false, error: apiError };
  }
}

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
 * @throws {ApiError} On HTTP or network error.
 */
export async function apiGetConfig(): Promise<ConfigReadResponse<LoreConfig>> {
  return fetchJson<ConfigReadResponse<LoreConfig>>("/api/config");
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
 */
export async function apiGetMachineConfig(): Promise<ConfigReadResponse<GlobalLoreConfig>> {
  return fetchJson<ConfigReadResponse<GlobalLoreConfig>>("/api/config/machine");
}

// ─── SPEC-074: dashboard Issues triage projection ────────────────────────────

/**
 * One row of the `GET /api/issue-reports` projection. Mirrors `IssueReportRow`
 * (`packages/lore/src/adapters/http/issue-reports-routes.ts`) exactly — the 8
 * report-identity fields plus lifecycle `status`. Never carries the full
 * `extra.issue_report` payload (e.g. `expected`/`actual`/`repro_command`) —
 * the detail view reads those via the existing `GET /api/docs/:id` route
 * (`apiGetDoc`), per the server module's own doc comment.
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
}

/** Response shape of `GET /api/issue-reports`. `open_count` is always `rows.length`. */
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
 * @returns `{ rows, open_count }` — rows sorted `reported_at` descending.
 * @throws {ApiError} On HTTP or network error.
 */
export async function apiGetIssueReports(): Promise<IssueReportsResponse> {
  return fetchJson<IssueReportsResponse>("/api/issue-reports");
}

// ─── SPEC-075: dashboard adjudication workbench (evidence-panel read) ───────

/**
 * TanStack Query key for a doc's evidence-panel projection — a shared helper
 * (not a bare literal) so `EvidenceTab` (self-contained fetch, mounted only
 * when its tab is active) and `DocDetail` (fetches once for `AdjudicationBar`,
 * mounted unconditionally in the header for in-review docs) resolve to the
 * SAME cache entry — one network request when both are mounted, never two.
 *
 * @param idOrSlug - Document ULID or slug.
 */
export function evidencePanelQueryKey(idOrSlug: string): readonly [string, string] {
  return ["evidence-panel", idOrSlug] as const;
}

/**
 * Fetch the dashboard adjudication workbench's Evidence-tab projection for one
 * doc (SPEC-075 §Module Boundary). Thin pipe over `GET /api/evidence-panel/:idOrSlug`
 * — the response `data` field IS the `EvidencePanelProjection` discriminated
 * union verbatim (`VerificationProjectionService.evidencePanel`,
 * `packages/lore/src/service/verification-projection-service.ts`), no
 * client-side re-shaping.
 *
 * @param idOrSlug - Document ULID, slug, or unique id-prefix.
 * @returns The assembled projection, discriminated by `doc_type`.
 * @throws {ApiError} On HTTP or network error (e.g. `DOC_NOT_FOUND` for an
 *   unknown id, or `VALIDATION_ERROR` for the D9 phase-children-without-tasks
 *   hierarchy-assumption violation).
 */
export async function apiGetEvidencePanel(idOrSlug: string): Promise<EvidencePanelProjection> {
  return fetchJson<EvidencePanelProjection>(`/api/evidence-panel/${encodeURIComponent(idOrSlug)}`);
}
