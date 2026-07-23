/**
 * Session-derived actor identity (SPEC-069 F1, W2 fix). Pure, browser-safe
 * module — no IO, no `Date.now()`/`Math.random()`, no Node builtins.
 *
 * Public surface:
 *   - SESSION_ACTOR_PREFIX — the `agent:session-` namespace prefix.
 *   - sessionActorFromId(sessionId) — derives a stable, traceable actor
 *     identity from a caller-supplied session id (e.g. Claude Code's
 *     `CLAUDE_CODE_SESSION_ID`).
 *
 * Invariants:
 *   - Sanitization mirrors `./seat.ts::sanitizeBranchSegment` byte-for-byte
 *     (lowercase, collapse non-`[a-z0-9-]` runs to a single `-`, trim leading/
 *     trailing `-`) — reused directly rather than re-implemented, so the two
 *     never silently diverge.
 *   - A `sessionId` that sanitizes to the empty string throws — this module
 *     never returns a bare `SESSION_ACTOR_PREFIX` (that would collide across
 *     every session with an unusable id, and silently pass as a "valid" actor).
 *
 * Side-effect class: pure
 *
 * Source: SPEC-069 §Design Decisions D1/D2/D3, §Module Boundary.
 */

import { sanitizeBranchSegment } from "./seat.js";

/** Namespace prefix for session-derived actor identities (SPEC-069 D2). */
export const SESSION_ACTOR_PREFIX = "agent:session-";

/** Number of sanitized characters kept from the session id (SPEC-069 §Module Boundary). */
const SESSION_ID_PREFIX_LENGTH = 8;

/**
 * Derives a traceable actor identity from a raw session id: `agent:session-`
 * followed by the first {@link SESSION_ID_PREFIX_LENGTH} characters of the
 * sanitized (lowercased, non-`[a-z0-9-]` collapsed) id.
 *
 * @param sessionId - Raw session id (e.g. `CLAUDE_CODE_SESSION_ID`/`CLAUDE_SESSION_ID`
 *   env value). Caller is responsible for trimming/non-empty checks upstream
 *   if it wants a graceful fallback instead of a thrown error — this function
 *   itself is fail-loud on an unusable id.
 * @returns `SESSION_ACTOR_PREFIX + <sanitized 8-char prefix>`.
 * @throws {Error} when `sessionId` sanitizes to the empty string (e.g. an
 *   input containing only characters outside `[a-z0-9-]`) — never returns a
 *   bare `SESSION_ACTOR_PREFIX`, which would be indistinguishable across every
 *   such session.
 * @example
 *   sessionActorFromId("3DE02220-5d69-4b5a-ac23-d66e14c0261b");
 *   // => "agent:session-3de02220"
 * @example
 *   sessionActorFromId("AB_c!!12345"); // => "agent:session-ab-c-123" (8 sanitized chars kept)
 */
export function sessionActorFromId(sessionId: string): string {
  const sanitized = sanitizeBranchSegment(sessionId);
  if (sanitized === "") {
    throw new Error(
      `sessionActorFromId: session id ${JSON.stringify(sessionId)} sanitizes to an empty ` +
        "string (no [a-z0-9-] characters) — refusing to return a bare, collision-prone actor prefix.",
    );
  }
  return SESSION_ACTOR_PREFIX + sanitized.slice(0, SESSION_ID_PREFIX_LENGTH);
}
