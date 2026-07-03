/**
 * Typed fetch wrapper for the Lore HTTP API.
 * Purpose: all API calls from the dashboard go through these helpers; they parse
 *   the server's { ok, data } envelope and normalize errors.
 * Public surface: apiList, apiSearch, apiTree, apiGetDoc, apiGetStatus
 * Invariants: 5-second timeout via AbortSignal.timeout; never leaks raw Response objects.
 *   Throws ApiError on non-2xx or server-side { ok: false }.
 * Side-effect class: IO (fetch)
 */

import type { DocRecord, DocSummary, DocType, DocStatus } from "@lore/core";

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
 */
export interface SearchHit {
  id: string;
  slug: string;
  title: string;
  snippet: string;
  score: number;
}

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
  const qs = buildQueryString(opts as Record<string, string | undefined>);
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
