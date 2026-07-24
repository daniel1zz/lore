/**
 * Dashboard write API — typed wrappers for the /api/dashboard/* write endpoints.
 * Purpose: provide a typed, fetch-based client for the SPEC-022 write surface
 *   plus the SPEC-027 delete/restore surface (AC-DH-6, AC-DH-7) and the SPEC-033
 *   F1 calibration feedback loop on approve/reject.
 * Public surface: apiCreateDoc, apiPatchDoc, apiApproveDoc, apiRejectDoc,
 *   apiCreateLink, apiDeleteLink, apiDeleteDoc, apiRestoreVersion,
 *   apiPatchConfig, apiPatchMachineConfig, apiPostRouteView,
 *   ConflictError, ConfigConflictError, DashboardApiError
 * Invariants:
 *   - All writes use credentials:"include" so the lore_sid cookie is sent.
 *   - 409 responses are thrown as ConflictError (caller handles conflict modal).
 *   - 401 / 403 responses are thrown as DashboardApiError with status.
 *   - Client-side Zod validation happens before HTTP submission (AC-DASH-WRITE-10).
 *   - apiDeleteDoc always sends `?confirm=true` — the dashboard UI's own confirm
 *     dialog (rendered by the caller before invoking this function) IS the
 *     confirmation; the server's confirm gate is defense-in-depth, not a second
 *     user-facing prompt.
 *   - apiRestoreVersion always sends `?confirm=true` — same pattern (AC-DH-11):
 *     the HistoryTab "restore" button click is the user-facing confirmation.
 *   - apiApproveDoc / apiRejectDoc (SPEC-033 F1) accept an optional
 *     `calibrationNote` and resolve to `{ doc, warnings }` — `warnings` is a
 *     stable, always-present `string[]` (never absent/undefined) populated ONLY
 *     when the server's implicit calibration hook hit a genuine IO failure; the
 *     approve/reject itself already succeeded by the time `warnings` could be
 *     non-empty, so it is never a reason to treat the call as failed.
 *   - apiPatchConfig / apiPatchMachineConfig (SPEC-062/SPEC-064) send `If-Match`
 *     as the config `hash` (from a prior `apiGetConfig`/`apiGetMachineConfig`
 *     call, `lib/api.ts`) — NOT a `version` number, config has no `DocRecord`.
 *     409 is thrown as `ConfigConflictError` (a DISTINCT class from
 *     `ConflictError` — the server's config-conflict payload is
 *     `{current_hash, current}`, not `{current, mine, diff}`; see that class's
 *     own doc). Neither config PATCH route offers a force-overwrite escape
 *     (`config-routes.ts`'s module header: "no unconditional-write path" is
 *     deliberate for config, unlike the doc-PATCH route) — a conflict can only
 *     be resolved by re-reading and re-editing, never bypassed from this client.
 *   - apiPostRouteView (SPEC-075 D4) NEVER throws — network errors, timeouts, and
 *     non-2xx responses are all silently swallowed (the PRD-documented
 *     fire-and-forget telemetry exception; see its own doc comment).
 * Side-effect class: IO (fetch)
 * Source: SPEC-022 §9.3, §9.4; SPEC-027 AC-DH-6, AC-DH-7, AC-DH-11; SPEC-033 F1;
 *   SPEC-062 §Design D3-D5; SPEC-064 §Design D6; SPEC-075 D4 (route-view telemetry)
 */

import type { ConfigEffect, DocRecord, DocType, GlobalLoreConfig, LinkType, LoreConfig } from "@lore/core";
import { createDocInputSchema } from "@lore/core";
import type { z } from "zod";

// ─── Error types ──────────────────────────────────────────────────────────────

/** Structured error from a dashboard write endpoint. */
export class DashboardApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "DashboardApiError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Conflict error — thrown when PATCH returns 409 (stale version).
 * Carries the server payload so the caller can render the ConflictModal.
 */
export class ConflictError extends DashboardApiError {
  /** Current server version of the document. */
  readonly current: DocRecord;
  /** Content the client attempted to write. */
  readonly mine: string;
  /** Unified diff: client content → server current content. */
  readonly diff: string;

  constructor(current: DocRecord, mine: string, diff: string) {
    super(409, "STALE_VERSION", "Document was modified since you loaded it");
    this.name = "ConflictError";
    this.current = current;
    this.mine = mine;
    this.diff = diff;
  }
}

// ─── Request types ────────────────────────────────────────────────────────────

/** Input for creating a new document (mirrors CreateDocInput schema). */
export type CreateDocPayload = z.infer<typeof createDocInputSchema>;

/** Partial doc update — any combination of editable fields. */
export interface PatchDocPayload {
  title?: string;
  content?: string;
  status?: string;
  priority?: string;
  tags?: string[];
  extra?: Record<string, unknown>;
  slug?: string;
}

/** Options for PATCH — version for concurrency, forceOverwrite to bypass. */
export interface PatchDocOptions {
  /** Doc's current version number (sent as If-Match header). */
  version?: number;
  /** Skip concurrency check (X-Force-Overwrite: 1). */
  forceOverwrite?: boolean;
}

/** Payload for adding a link. */
export interface CreateLinkPayload {
  to: string;
  type: LinkType;
  note?: string;
}

// ─── Response types ───────────────────────────────────────────────────────────

/** Success envelope from doc write endpoints. */
interface DocWriteResponse {
  ok: boolean;
  data: { doc: DocRecord };
}

/**
 * Success payload from approve/reject (SPEC-033 F1). `warnings` is always a
 * `string[]` (possibly empty) — see the module header's `apiApproveDoc` /
 * `apiRejectDoc` invariant.
 */
export interface AdjudicateDocResult {
  doc: DocRecord;
  warnings: string[];
}

/** Success payload from the soft-delete endpoint (no DocRecord — doc is gone). */
export interface DeleteDocResult {
  id: string;
  /** ISO timestamp — the doc is recoverable via `lore restore`/version history until this date. */
  recoverable_until: string;
}

/**
 * Error envelope. The server always wraps error payloads under `error` (never at the
 * top level) — `jsonError(payload, status)` in `adapters/http/middleware.ts` produces
 * `{ ok: false, error: payload }` for every error response, including 409 conflicts
 * where `payload` is `checkConcurrency`'s `ConflictPayload` (`adapters/http/concurrency.ts`).
 * `current` / `mine` / `diff` therefore live under `error`, not as siblings of `error`.
 */
interface ErrorResponse {
  ok: boolean;
  error?: {
    code?: string;
    message?: string;
    /** For 409 conflict: concurrency payload (ConflictPayload — current/mine/diff). */
    current?: DocRecord;
    mine?: string;
    diff?: string;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Perform a write fetch with cookie credentials.
 * Throws DashboardApiError or ConflictError on failure.
 */
async function writeFetch<T>(
  path: string,
  method: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const headers: Record<string, string> = {
    "Accept": "application/json",
    ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    ...extraHeaders,
  };

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: "include",
      signal: AbortSignal.timeout(10000),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error";
    throw new DashboardApiError(0, "NETWORK_ERROR", message);
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new DashboardApiError(response.status, "PARSE_ERROR", "Failed to parse JSON response");
  }

  // Handle 409 Conflict — throw ConflictError with diff payload.
  if (response.status === 409) {
    const conflict = (parsed as ErrorResponse).error;
    if (conflict?.current !== undefined && conflict.mine !== undefined && conflict.diff !== undefined) {
      throw new ConflictError(conflict.current, conflict.mine, conflict.diff);
    }
    throw new DashboardApiError(409, "STALE_VERSION", "Document modified concurrently");
  }

  const envelope = parsed as { ok: boolean; data?: T; error?: { code?: string; message?: string } };
  if (!response.ok || !envelope.ok) {
    const err = envelope.error ?? {};
    throw new DashboardApiError(response.status, err.code ?? "API_ERROR", err.message ?? `HTTP ${response.status}`);
  }

  return envelope.data as T;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a new document via POST /api/dashboard/docs.
 * Validates payload client-side before submitting (AC-DASH-WRITE-10).
 *
 * @param payload - Document creation input.
 * @returns The created DocRecord.
 * @throws {DashboardApiError} On validation failure or HTTP error.
 */
export async function apiCreateDoc(payload: CreateDocPayload): Promise<DocRecord> {
  // Client-side Zod validation — AC-DASH-WRITE-10: rejects empty title before HTTP submit.
  const parsed = createDocInputSchema.safeParse(payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new DashboardApiError(
      422,
      "VALIDATION_ERROR",
      issue?.message ?? "Validation failed",
    );
  }

  const result = await writeFetch<{ doc: DocRecord }>("/api/dashboard/docs", "POST", parsed.data);
  return result.doc;
}

/**
 * Patch an existing document via PATCH /api/dashboard/docs/:id.
 * Sends If-Match header when version is provided for optimistic concurrency.
 * Throws ConflictError on 409 so the caller can render the ConflictModal.
 *
 * @param id - Document ULID or slug.
 * @param patch - Partial fields to update.
 * @param opts - Concurrency options (version / forceOverwrite).
 * @returns The updated DocRecord.
 * @throws {ConflictError} When the server version differs from the client's.
 * @throws {DashboardApiError} On other HTTP errors.
 */
export async function apiPatchDoc(
  id: string,
  patch: PatchDocPayload,
  opts: PatchDocOptions = {},
): Promise<DocRecord> {
  const extraHeaders: Record<string, string> = {};
  if (opts.forceOverwrite === true) {
    extraHeaders["X-Force-Overwrite"] = "1";
  } else if (opts.version !== undefined) {
    extraHeaders["If-Match"] = String(opts.version);
  }

  const result = await writeFetch<{ doc: DocRecord }>(
    `/api/dashboard/docs/${encodeURIComponent(id)}`,
    "PATCH",
    patch,
    extraHeaders,
  );
  return result.doc;
}

/**
 * Approve a document via POST /api/dashboard/docs/:id/approve.
 * Session user becomes the reviewer (AC-DASH-WRITE-7).
 * Runs the server's implicit calibration hook (SPEC-033 F1) — see
 * {@link AdjudicateDocResult} for the `warnings` contract.
 *
 * @param id - Document ULID or slug.
 * @param opts.calibrationNote - Optional note → the calibration record's `delta_reasons[0]`.
 * @returns `{ doc, warnings }` — the approved DocRecord plus any calibration warnings.
 * @throws {DashboardApiError} On HTTP error or invalid transition.
 */
export async function apiApproveDoc(
  id: string,
  opts: { calibrationNote?: string } = {},
): Promise<AdjudicateDocResult> {
  return writeFetch<AdjudicateDocResult>(
    `/api/dashboard/docs/${encodeURIComponent(id)}/approve`,
    "POST",
    opts.calibrationNote !== undefined ? { calibration_note: opts.calibrationNote } : undefined,
  );
}

/**
 * Reject a document via POST /api/dashboard/docs/:id/reject.
 * Runs the server's implicit calibration hook (SPEC-033 F1) — see
 * {@link AdjudicateDocResult} for the `warnings` contract.
 *
 * @param id - Document ULID or slug.
 * @param reason - Optional rejection reason.
 * @param opts.calibrationNote - Optional note → the calibration record's `delta_reasons[0]`.
 * @returns `{ doc, warnings }` — the rejected DocRecord plus any calibration warnings.
 * @throws {DashboardApiError} On HTTP error or invalid transition.
 */
export async function apiRejectDoc(
  id: string,
  reason?: string,
  opts: { calibrationNote?: string } = {},
): Promise<AdjudicateDocResult> {
  const body: Record<string, string> = {};
  if (reason !== undefined) body["reason"] = reason;
  if (opts.calibrationNote !== undefined) body["calibration_note"] = opts.calibrationNote;

  return writeFetch<AdjudicateDocResult>(
    `/api/dashboard/docs/${encodeURIComponent(id)}/reject`,
    "POST",
    Object.keys(body).length > 0 ? body : undefined,
  );
}

/**
 * Soft-delete a document via DELETE /api/dashboard/docs/:id.
 * Recoverable for 30 days (server-side `recoverable_until`, see `lore restore`).
 * Always sends `?confirm=true` — the caller is expected to have already shown
 * an explicit confirmation dialog before invoking this function (AC-DH-6).
 *
 * @param id - Document ULID or slug.
 * @returns The deleted doc's id and the recoverable-until timestamp.
 * @throws {DashboardApiError} On HTTP error (e.g. 404 if the doc doesn't exist).
 */
export async function apiDeleteDoc(id: string): Promise<DeleteDocResult> {
  return writeFetch<DeleteDocResult>(
    `/api/dashboard/docs/${encodeURIComponent(id)}?confirm=true`,
    "DELETE",
  );
}

/**
 * Restore a document to a previous version via POST /api/dashboard/docs/:id/restore.
 * Append-only — creates a new version N+1 with the target version's content
 * rather than deleting any history (AC-DH-7).
 * Always sends `?confirm=true` — the server requires it (AC-DH-11, mirroring
 * `apiDeleteDoc`'s confirm gate); the HistoryTab's "restore" button click IS the
 * user-facing confirmation, so no second dialog is added on the client.
 *
 * @param id - Document ULID or slug.
 * @param version - The version number to restore content from.
 * @returns The updated DocRecord (now at version N+1, status reset to draft).
 * @throws {DashboardApiError} On HTTP error (e.g. 404 if the version doesn't exist).
 */
export async function apiRestoreVersion(id: string, version: number): Promise<DocRecord> {
  const result = await writeFetch<{ doc: DocRecord }>(
    `/api/dashboard/docs/${encodeURIComponent(id)}/restore?confirm=true`,
    "POST",
    { version },
  );
  return result.doc;
}

/**
 * Add a link from a document via POST /api/dashboard/docs/:id/links.
 *
 * @param fromId - Source document ULID or slug.
 * @param payload - Link target and type.
 * @returns void on success.
 * @throws {DashboardApiError} On HTTP error or LINK_CYCLE (422).
 */
export async function apiCreateLink(fromId: string, payload: CreateLinkPayload): Promise<void> {
  await writeFetch<{ ok: boolean }>(
    `/api/dashboard/docs/${encodeURIComponent(fromId)}/links`,
    "POST",
    payload,
  );
}

/**
 * Remove a link via DELETE /api/dashboard/docs/:id/links/:linkId.
 *
 * @param fromId - Source document ULID or slug.
 * @param toId - Target document ULID or slug.
 * @returns void on success.
 * @throws {DashboardApiError} On HTTP error.
 */
export async function apiDeleteLink(fromId: string, toId: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(
      `/api/dashboard/docs/${encodeURIComponent(fromId)}/links/${encodeURIComponent(toId)}`,
      {
        method: "DELETE",
        credentials: "include",
        signal: AbortSignal.timeout(10000),
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error";
    throw new DashboardApiError(0, "NETWORK_ERROR", message);
  }

  if (!response.ok && response.status !== 204) {
    let errBody: { error?: { code?: string; message?: string } } = {};
    try {
      errBody = (await response.json()) as typeof errBody;
    } catch {
      // ignore parse errors
    }
    throw new DashboardApiError(
      response.status,
      errBody.error?.code ?? "API_ERROR",
      errBody.error?.message ?? `HTTP ${response.status}`,
    );
  }
}

// ─── SPEC-062/SPEC-064: config write (team + machine scope) ─────────────────

/**
 * Conflict error for a config PATCH (SPEC-062 D3-D5, SPEC-064 D6) — thrown on
 * 409. DISTINCT from {@link ConflictError}: config has no `DocRecord`/version,
 * so the server's conflict payload is `{current_hash, current}` (the FRESH
 * redacted config + its hash), not `{current, mine, diff}` — there is no
 * unified diff to render (config isn't a single text blob), and no
 * force-overwrite escape (`config-routes.ts` deliberately offers none for
 * either config PATCH route — see this module's header).
 */
export class ConfigConflictError extends DashboardApiError {
  /** Fresh redacted config read at rejection time. */
  readonly currentConfig: unknown;
  /** Fresh hash — the `If-Match` value a retry (fresh edit) must send. */
  readonly currentHash: string;

  constructor(currentConfig: unknown, currentHash: string) {
    super(409, "STALE_VERSION", "Config was modified since you loaded it");
    this.name = "ConfigConflictError";
    this.currentConfig = currentConfig;
    this.currentHash = currentHash;
  }
}

/** Success payload from a config PATCH — mirrors `ConfigUpdateResult` (`config-service.ts`). */
export interface ConfigUpdateResult<C> {
  config: C;
  effects: Record<string, ConfigEffect>;
  /** Dotted leaf-key paths the accepted patch touched (SPEC-062 D5). */
  updated: string[];
  /** Subset of `updated` requiring a process restart to take effect — NEVER undifferentiated success. */
  restart_required: string[];
  /** New hash — the `If-Match` value the NEXT edit session must freeze at edit-start. */
  hash: string;
}

/**
 * Shared PATCH implementation for both config scopes — sends `If-Match`
 * (the frozen base hash, SPEC-064 D5) and the raw patch object as the body
 * (NOT wrapped, unlike `apiCreateDoc`'s Zod-validated envelope — config
 * validation is entirely server-side, `ConfigService`/`GlobalConfigService`
 * own the `LoreConfigSchema`/`GlobalLoreConfigSchema` truth).
 *
 * @throws {ConfigConflictError} On 409 (stale `If-Match`).
 * @throws {DashboardApiError} On any other HTTP/network/validation error.
 */
async function writeConfigFetch<C>(
  path: string,
  patch: Record<string, unknown>,
  ifMatch: string,
): Promise<ConfigUpdateResult<C>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "PATCH",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "If-Match": ifMatch,
      },
      credentials: "include",
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify(patch),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error";
    throw new DashboardApiError(0, "NETWORK_ERROR", message);
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new DashboardApiError(response.status, "PARSE_ERROR", "Failed to parse JSON response");
  }

  if (response.status === 409) {
    const conflict = (parsed as { error?: { current_hash?: string; current?: unknown } }).error;
    if (conflict?.current !== undefined && conflict.current_hash !== undefined) {
      throw new ConfigConflictError(conflict.current, conflict.current_hash);
    }
    throw new DashboardApiError(409, "STALE_VERSION", "Config modified concurrently");
  }

  const envelope = parsed as {
    ok: boolean;
    data?: ConfigUpdateResult<C>;
    error?: { code?: string; message?: string };
  };
  if (!response.ok || !envelope.ok) {
    const err = envelope.error ?? {};
    throw new DashboardApiError(response.status, err.code ?? "API_ERROR", err.message ?? `HTTP ${response.status}`);
  }

  return envelope.data as ConfigUpdateResult<C>;
}

/**
 * Patch the TEAM-scope config via PATCH /api/dashboard/config.
 *
 * @param patch - Minimal nested patch (only the changed leaves — see
 *   `components/config-path-utils.ts::buildPatchFromChangedPaths`, whose
 *   whole reason to exist is keeping this argument minimal so
 *   `restart_required` stays honest, SPEC-062 D5).
 * @param ifMatch - The base hash frozen at edit-start (SPEC-064 D5).
 * @throws {ConfigConflictError} On 409.
 * @throws {DashboardApiError} On other HTTP/network errors (incl. a denied-key patch, 422).
 */
export async function apiPatchConfig(
  patch: Record<string, unknown>,
  ifMatch: string,
): Promise<ConfigUpdateResult<LoreConfig>> {
  return writeConfigFetch<LoreConfig>("/api/dashboard/config", patch, ifMatch);
}

/**
 * Patch the MACHINE-scope config via PATCH /api/dashboard/config/machine.
 * Same contract as {@link apiPatchConfig}, against `GlobalLoreConfigSchema`.
 *
 * @throws {ConfigConflictError} On 409.
 * @throws {DashboardApiError} On other HTTP/network errors.
 */
export async function apiPatchMachineConfig(
  patch: Record<string, unknown>,
  ifMatch: string,
): Promise<ConfigUpdateResult<GlobalLoreConfig>> {
  return writeConfigFetch<GlobalLoreConfig>("/api/dashboard/config/machine", patch, ifMatch);
}

// ─── SPEC-075 D4: route-view telemetry (fire-and-forget) ────────────────────

/**
 * Record one dashboard route-navigation event via
 * `POST /api/dashboard/telemetry/route-view` (SPEC-075 D4, PRD §21 F2).
 *
 * FIRE-AND-FORGET BY DESIGN (the two PRD-documented telemetry exceptions this
 * module otherwise never takes): unlike every other function in this file,
 * this NEVER throws to the caller — a network failure, a non-2xx response, or
 * a malformed body are all swallowed silently here. The route-view ping is a
 * pure observability signal (F2 IS the observability deliverable); a broken
 * telemetry sink or an offline network must never surface a toast, break
 * navigation, or throw an unhandled rejection in `use-route-telemetry.ts`'s
 * effect. The server side has its own matching fail-quiet exception (one
 * `console.error` line on a sink-write failure, still 204 to the client) —
 * see `handleDashboardRouteViewTelemetry`'s doc comment
 * (`packages/lore/src/adapters/http/dashboard-routes.ts`). Nothing is logged
 * client-side either — there is no dashboard-side console/telemetry channel
 * for this failure to land in beyond the browser's own network-tab trace.
 *
 * @param params.route_id - Pathname-shaped route identifier (server caps at
 *   200 chars via zod; this function does not pre-validate length — an
 *   oversized value simply fails server-side and is swallowed here like any
 *   other failure).
 * @param params.doc_type - The loaded doc's type, when on a doc route and
 *   cheaply available; omitted otherwise (never fabricated).
 */
export async function apiPostRouteView(params: { route_id: string; doc_type?: DocType }): Promise<void> {
  try {
    await fetch("/api/dashboard/telemetry/route-view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify(params),
    });
  } catch {
    // reason: fire-and-forget (SPEC-075 D4) — a network/timeout failure must never
    // surface to the UI or throw out of the caller's effect. See module doc comment.
  }
}
