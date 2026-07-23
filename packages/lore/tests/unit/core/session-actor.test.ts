/**
 * AC-069-2 — `@lore/core`'s `session-actor.ts`: `sessionActorFromId` format,
 * sanitization, and fail-loud-on-empty invariants (SPEC-069 F1, D2/D3).
 *
 * Six-dimension coverage: HAPPY (real Claude Code session id shape) / NEGATIVE
 * (mixed-case, punctuation-laden id sanitizes to a non-empty prefix) / BOUNDARY
 * (sanitized id shorter than the 8-char window; whitespace-only input) / ERROR
 * (empty string and all-punctuation input both fail loud, never a bare prefix)
 * / STATE (pure — identical input always yields identical output, no mutation
 * of the input string) / REGRESSION (the `SESSION_ACTOR_PREFIX` constant's
 * literal value, pinned so a future edit can't silently rename the namespace).
 *
 * Runner: vitest (pure fn, no bun:sqlite, no IO).
 */

import { describe, it, expect } from "vitest";
import { SESSION_ACTOR_PREFIX, sessionActorFromId } from "@lore/core";

describe("SPEC-069 AC-069-2: sessionActorFromId", () => {
  it("REGRESSION: SESSION_ACTOR_PREFIX is the literal 'agent:session-' namespace", () => {
    expect(SESSION_ACTOR_PREFIX).toBe("agent:session-");
  });

  it("HAPPY: a real Claude Code session-id shape sanitizes to its lowercase 8-char prefix", () => {
    expect(sessionActorFromId("3DE02220-5d69-4b5a-ac23-d66e14c0261b")).toBe(
      "agent:session-3de02220",
    );
  });

  it("NEGATIVE: mixed-case + punctuation collapses non-[a-z0-9-] runs to a single '-' before truncation", () => {
    // "AB_c!!12345" -> lowercase "ab_c!!12345" -> collapse "_"/"!!" runs -> "ab-c-12345"
    // -> first 8 chars: "ab-c-123"
    expect(sessionActorFromId("AB_c!!12345")).toBe("agent:session-ab-c-123");
  });

  it("BOUNDARY: a sanitized id shorter than 8 chars is used verbatim (no padding)", () => {
    expect(sessionActorFromId("abc")).toBe("agent:session-abc");
  });

  it("BOUNDARY: an already-8-char sanitized id is returned unchanged, untruncated further", () => {
    expect(sessionActorFromId("abcdefgh")).toBe("agent:session-abcdefgh");
  });

  it("ERROR: an empty string throws rather than returning a bare prefix", () => {
    expect(() => sessionActorFromId("")).toThrow();
  });

  it("ERROR: an all-punctuation input (sanitizes to empty) throws rather than returning a bare prefix", () => {
    expect(() => sessionActorFromId("!!!___")).toThrow();
  });

  it("ERROR: a whitespace-only input sanitizes to empty and throws", () => {
    expect(() => sessionActorFromId("   ")).toThrow();
  });

  it("STATE: identical input always yields identical output (pure, no hidden state)", () => {
    const id = "session-XYZ-42";
    expect(sessionActorFromId(id)).toBe(sessionActorFromId(id));
  });

  it("STATE: the input string is never mutated", () => {
    const id = "Immutable-INPUT-99";
    const before = id.slice();
    sessionActorFromId(id);
    expect(id).toBe(before);
  });
});
