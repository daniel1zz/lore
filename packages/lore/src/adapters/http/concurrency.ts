/**
 * Optimistic-concurrency helper for PATCH /api/dashboard/docs/:id.
 * Purpose: compare the client's If-Match version against the server's current version;
 *   on mismatch, produce a 409 payload containing the diff so the dashboard can render
 *   the ConflictModal (SPEC-022 §9.4).
 * Public surface: checkConcurrency, resolveExpectedVersion, buildConflictPayload
 * Invariants:
 *   - X-Force-Overwrite: 1 header bypasses the check unconditionally (§9.4 step 5).
 *   - If-Match absent → check is skipped (legacy path, no concurrency enforcement).
 *   - If-Match present and matches → ok to proceed (returns null).
 *   - If-Match present and stale → returns ConflictPayload (caller must return 409).
 *   - Diff is a unified diff (createTwoFilesPatch), client vs server content.
 * Side-effect class: pure
 * Source: SPEC-022 §9.4
 *
 * BUG-003 (audit finding) — `checkConcurrency` is a ROUTE-LEVEL PRECHECK only: it
 * compares the client's declared version against a single `currentDoc` SNAPSHOT the
 * caller already read. It cannot see a second writer committing BETWEEN that snapshot
 * read and the route's later `CorpusService.set` call — that race is now caught by
 * `set`'s OWN CAS, guarded via `resolveExpectedVersion` threading the SAME client-
 * declared version into `set`'s `opts.expectedVersion` (see corpus-service.ts `set`'s
 * JSDoc for the full race walkthrough). `buildConflictPayload` is the SHARED
 * diff-rendering logic behind both this precheck AND that second, deeper conflict —
 * dashboard-routes.ts's `handleDashboardPatch` calls it again when `set` itself
 * returns `STALE_VERSION`, so both conflict sources render the IDENTICAL ConflictModal
 * payload shape.
 */

import { createTwoFilesPatch } from "diff";
import type { DocRecord } from "@lore/core";

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Payload returned when a PATCH has a stale version (409 conflict).
 * Client uses this to render the ConflictModal.
 */
export interface ConflictPayload {
  /** The current server version of the document. */
  current: DocRecord;
  /** The content the client attempted to write. */
  mine: string;
  /** Unified diff: client ("yours") → server ("theirs"). */
  diff: string;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Build a {@link ConflictPayload} for a stale-version conflict — the shared
 * diff-rendering logic used by BOTH the route-level precheck ({@link checkConcurrency})
 * and BUG-003's fix (a second writer's commit landing BETWEEN the precheck read and
 * the subsequent `CorpusService.set` call, caught only by `set`'s own CAS — see
 * dashboard-routes.ts's `handleDashboardPatch`). Pulled out to a single function so
 * both conflict sources render an IDENTICAL `{current, mine, diff}` shape rather than
 * two independently-maintained copies of the same diff logic.
 *
 * @param currentDoc - The document as it currently exists on the server (post-conflict).
 * @param clientContent - Content the client tried to write.
 */
export function buildConflictPayload(currentDoc: DocRecord, clientContent: string): ConflictPayload {
  // reason: createTwoFilesPatch labels are "yours" (client draft) and "theirs" (server current).
  // This phrasing matches the ConflictModal copy ("You wrote" vs "Now on server").
  const diff = createTwoFilesPatch(
    "yours",
    "theirs",
    clientContent,
    currentDoc.content,
    "",
    "",
  );

  return {
    current: currentDoc,
    mine: clientContent,
    diff,
  };
}

/**
 * Check optimistic concurrency for a PATCH request.
 *
 * Compares the `If-Match` header value (integer version) against the server's
 * current `doc.version`. Returns a `ConflictPayload` when stale, `null` when ok.
 *
 * @param req          - Incoming HTTP Request (headers inspected).
 * @param currentDoc   - The document as it currently exists on the server.
 * @param clientContent - Content the client tried to write (from request body).
 * @returns ConflictPayload when the versions differ, null otherwise.
 *
 * @example
 *   const conflict = checkConcurrency(req, doc, body.content ?? "");
 *   if (conflict !== null) return jsonError({ ...conflict }, 409);
 */
export function checkConcurrency(
  req: Request,
  currentDoc: DocRecord,
  clientContent: string,
): ConflictPayload | null {
  // reason: X-Force-Overwrite: 1 is the explicit force path (§9.4 step 5).
  // The client sets it after the user clicks "Force overwrite" in the ConflictModal.
  // Bypassing the check here means the write lands unconditionally at latest version.
  const forceOverwrite = req.headers.get("X-Force-Overwrite") === "1";
  if (forceOverwrite) return null;

  const ifMatch = req.headers.get("If-Match");
  // reason: If-Match absent → legacy client or explicit opt-out of concurrency check.
  // We let the write proceed; service layer handles sequential writes correctly.
  if (ifMatch === null) return null;

  const clientVersion = parseInt(ifMatch, 10);
  if (!Number.isNaN(clientVersion) && clientVersion === currentDoc.version) {
    return null; // versions match — safe to write
  }

  // Stale version: produce a diff so the UI can show "what changed since you last loaded".
  return buildConflictPayload(currentDoc, clientContent);
}

/**
 * Derive the `expectedVersion` CAS guard to thread into `CorpusService.set`
 * (BUG-003 fix) — from the SAME headers {@link checkConcurrency} inspects:
 *   - `X-Force-Overwrite: 1` → `undefined` (unconditional write — matches the
 *     force-bypass semantics `checkConcurrency` already applies; a caller who
 *     explicitly asked to overwrite regardless of current state must not then
 *     get rejected by a CAS guard).
 *   - `If-Match` absent or non-numeric → `undefined` (the pre-existing
 *     unconditional-write legacy path — UNCHANGED by this fix).
 *   - `If-Match` present and numeric → that value. This becomes the REAL
 *     race-safe guard `set()`'s internal CAS uses — closing BUG-003, where a
 *     fresh internal re-read inside `set()` previously made the `If-Match`
 *     precheck advisory-only (see this module's header comment for the full
 *     race).
 *
 * @param req - Incoming HTTP Request (headers inspected — same two headers
 *   {@link checkConcurrency} reads, no new header contract).
 */
export function resolveExpectedVersion(req: Request): number | undefined {
  if (req.headers.get("X-Force-Overwrite") === "1") return undefined;

  const ifMatch = req.headers.get("If-Match");
  if (ifMatch === null) return undefined;

  const clientVersion = parseInt(ifMatch, 10);
  return Number.isNaN(clientVersion) ? undefined : clientVersion;
}
