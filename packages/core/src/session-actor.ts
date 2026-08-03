/**
 * Session-derived actor identity (SPEC-069 F1, W2 fix). Pure, browser-safe
 * module — no IO, no `Date.now()`/`Math.random()`, no Node builtins.
 *
 * Public surface:
 *   - SESSION_ACTOR_PREFIX — the `agent:session-` namespace prefix.
 *   - sessionIdDiscriminator(sessionId) — the bare sanitized session
 *     discriminator (no namespace prefix), used BOTH by
 *     {@link sessionActorFromId} below and by the claim record's
 *     `session_id` capture (`task-workflow.ts::taskClaimSchema`,
 *     task-two-concurrent-orchestrators-both-resolve-to-agent-main).
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
 *   - {@link sessionIdDiscriminator} is the SINGLE definition of "how a raw
 *     session id becomes a stable short discriminator". A claim record's
 *     `session_id` and an `agent:session-…` actor MUST agree byte-for-byte on
 *     that transform, so neither re-implements the slice/sanitize pair —
 *     otherwise the same session could be recorded under two spellings and the
 *     `noAnchorOverlap` session comparison would silently read "different
 *     session" for one run.
 *
 * Side-effect class: pure
 *
 * Source: SPEC-069 §Design Decisions D1/D2/D3, §Module Boundary;
 *   task-two-concurrent-orchestrators-both-resolve-to-agent-main §Required fix 1
 *   (the session INSTANCE is a captured claim fact, independent of actor
 *   resolution — both spellings share this one transform).
 */

import { sanitizeBranchSegment } from "./seat.js";

/** Namespace prefix for session-derived actor identities (SPEC-069 D2). */
export const SESSION_ACTOR_PREFIX = "agent:session-";

/** Number of sanitized characters kept from the session id (SPEC-069 §Module Boundary). */
const SESSION_ID_PREFIX_LENGTH = 8;

/**
 * The bare session discriminator: the first {@link SESSION_ID_PREFIX_LENGTH}
 * characters of the sanitized (lowercased, non-`[a-z0-9-]` collapsed) session
 * id, with NO namespace prefix. The SSOT for that transform — consumed by
 * {@link sessionActorFromId} (which only adds the `agent:session-` namespace)
 * and by the claim record's `session_id` capture
 * (`TaskWorkflowService.claim`, task-two-concurrent-orchestrators-both-resolve-to-agent-main
 * §Required fix 1).
 *
 * Fail-loud, never lossy: an id sanitizing to the empty string throws rather
 * than returning `""`, because an empty discriminator is indistinguishable
 * from "no session was measured" — and "not measured" is a verdict the
 * `noAnchorOverlap` session comparison must reach on ABSENCE only, never on a
 * silently-emptied capture.
 *
 * @param sessionId - Raw session id (e.g. `CLAUDE_CODE_SESSION_ID` /
 *   `CLAUDE_SESSION_ID` env value). Callers wanting a graceful "no session"
 *   answer must check for unset/blank BEFORE calling.
 * @returns The sanitized ≤{@link SESSION_ID_PREFIX_LENGTH}-char discriminator.
 * @throws {Error} when `sessionId` sanitizes to the empty string.
 * @example
 *   sessionIdDiscriminator("3DE02220-5d69-4b5a-ac23-d66e14c0261b"); // => "3de02220"
 * @example
 *   sessionIdDiscriminator("AB_c!!12345"); // => "ab-c-123" (8 sanitized chars kept)
 */
export function sessionIdDiscriminator(sessionId: string): string {
  const sanitized = sanitizeBranchSegment(sessionId);
  if (sanitized === "") {
    throw new Error(
      `sessionIdDiscriminator: session id ${JSON.stringify(sessionId)} sanitizes to an empty ` +
        "string (no [a-z0-9-] characters) — refusing to return an empty, unmeasurable discriminator.",
    );
  }
  return sanitized.slice(0, SESSION_ID_PREFIX_LENGTH);
}

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
 *   such session. Message wording comes from
 *   {@link sessionIdDiscriminator} (the shared transform), so callers must
 *   match on the THROW, never on remembered message text.
 * @example
 *   sessionActorFromId("3DE02220-5d69-4b5a-ac23-d66e14c0261b");
 *   // => "agent:session-3de02220"
 * @example
 *   sessionActorFromId("AB_c!!12345"); // => "agent:session-ab-c-123" (8 sanitized chars kept)
 */
export function sessionActorFromId(sessionId: string): string {
  return SESSION_ACTOR_PREFIX + sessionIdDiscriminator(sessionId);
}
