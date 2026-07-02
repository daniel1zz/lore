/**
 * Optimistic-concurrency helper for PATCH /api/dashboard/docs/:id.
 * Purpose: compare the client's If-Match version against the server's current version;
 *   on mismatch, produce a 409 payload containing the diff so the dashboard can render
 *   the ConflictModal (SPEC-022 §9.4).
 * Public surface: checkConcurrency
 * Invariants:
 *   - X-Force-Overwrite: 1 header bypasses the check unconditionally (§9.4 step 5).
 *   - If-Match absent → check is skipped (legacy path, no concurrency enforcement).
 *   - If-Match present and matches → ok to proceed (returns null).
 *   - If-Match present and stale → returns ConflictPayload (caller must return 409).
 *   - Diff is a unified diff (createTwoFilesPatch), client vs server content.
 * Side-effect class: pure
 * Source: SPEC-022 §9.4
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
