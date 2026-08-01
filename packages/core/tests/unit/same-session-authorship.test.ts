/**
 * Unit suite for `@lore/core`'s `isSameSessionAuthorship` / `sessionStartMarkerFilename`
 * (session.ts) — task-verifying-a-handoff-you-just-authored-arms-the-coverage
 * D1, D2.
 *
 * Scope: this file proves the PURE predicate in isolation — given a
 * `{by, at}` record, a current actor, and a `sessionStartIso` (already read
 * by the caller), does it correctly decide "same session" per the ADR's Q1
 * (identity alone rejected) and Q2 (unknown boundary must arm) reviews. The
 * IO wiring that actually reads the session-start marker and calls this
 * predicate (`feed-flow.ts::buildResumeFeed`) is covered separately by
 * `packages/lore/tests/unit/feed-resume-same-session.test.ts`.
 *
 * Six-dimension coverage:
 *   HAPPY:      identity match + record.at AFTER sessionStartIso -> true
 *               (the RED scenario: verifying my own just-authored ticket)
 *   NEGATIVE:   identity mismatch (CONTROL 5's shape: a different actor's
 *               handoff) -> false, even though record.at is AFTER
 *               sessionStartIso — identity alone is never sufficient
 *   BOUNDARY:   record.at === sessionStartIso exactly (>=, not >) -> true;
 *               record.at one millisecond BEFORE sessionStartIso -> false
 *               (CONTROL 6's shape: a genuinely earlier session's ticket)
 *   ERROR:      N/A — pure internal predicate over already-shaped inputs;
 *               no untrusted external boundary here for a Zod parse to guard
 *   STATE:      referential transparency — repeated calls with the same
 *               input produce the identical boolean, interleaved with a
 *               different-input call to rule out hidden internal state
 *   REGRESSION: sessionStartIso === undefined ALWAYS returns false (arm),
 *               regardless of identity match or record.at value — the Q2
 *               fail-safe direction; checked BEFORE identity, per the
 *               function's own documented invariant
 *
 * @spec_ref task-verifying-a-handoff-you-just-authored-arms-the-coverage
 *   §Candidate predicates (2); §Oracle; §Proxy/Silence/Opt-in ADR review Q1/Q2
 */

import { describe, it, expect } from "vitest";
import { isSameSessionAuthorship, sessionStartMarkerFilename } from "../../src/session.js";

const ACTOR_A = "agent:main-orchestrator";
const ACTOR_B = "agent:bob";

describe("HAPPY — same actor, handoff created after session start", () => {
  it("identity match + record.at AFTER sessionStartIso -> true (verifying my own just-authored ticket)", () => {
    const result = isSameSessionAuthorship(
      { by: ACTOR_A, at: "2026-08-01T10:05:00.000Z" },
      ACTOR_A,
      "2026-08-01T10:00:00.000Z",
    );
    expect(result).toBe(true);
  });
});

describe("NEGATIVE — CONTROL 5 shape: identity mismatch", () => {
  it("a DIFFERENT actor's handoff -> false even though record.at is well after sessionStartIso", () => {
    const result = isSameSessionAuthorship(
      { by: ACTOR_B, at: "2026-08-01T10:05:00.000Z" },
      ACTOR_A,
      "2026-08-01T10:00:00.000Z",
    );
    expect(result).toBe(false);
  });

  it("control: the SAME record/session-start pair, with matching identity substituted in, DOES return true — proves the negative above is identity-driven, not a broken function", () => {
    const result = isSameSessionAuthorship(
      { by: ACTOR_A, at: "2026-08-01T10:05:00.000Z" },
      ACTOR_A,
      "2026-08-01T10:00:00.000Z",
    );
    expect(result).toBe(true);
  });
});

describe("BOUNDARY — record.at vs sessionStartIso, exact and off-by-one-ms", () => {
  it("record.at === sessionStartIso exactly -> true (>=, not a strict >)", () => {
    const sameInstant = "2026-08-01T10:00:00.000Z";
    const result = isSameSessionAuthorship({ by: ACTOR_A, at: sameInstant }, ACTOR_A, sameInstant);
    expect(result).toBe(true);
  });

  it("CONTROL 6 shape: record.at one millisecond BEFORE sessionStartIso -> false (a genuinely earlier session's ticket)", () => {
    const result = isSameSessionAuthorship(
      { by: ACTOR_A, at: "2026-08-01T09:59:59.999Z" },
      ACTOR_A,
      "2026-08-01T10:00:00.000Z",
    );
    expect(result).toBe(false);
  });
});

describe("STATE — referential transparency", () => {
  it("repeated calls with the same input produce the identical result, interleaved with a different-input call", () => {
    const record = { by: ACTOR_A, at: "2026-08-01T10:05:00.000Z" };
    const first = isSameSessionAuthorship(record, ACTOR_A, "2026-08-01T10:00:00.000Z");
    const interleaved = isSameSessionAuthorship(record, ACTOR_B, "2026-08-01T10:00:00.000Z");
    const second = isSameSessionAuthorship(record, ACTOR_A, "2026-08-01T10:00:00.000Z");

    expect(first).toBe(true);
    expect(interleaved).toBe(false);
    expect(second).toBe(true);
    expect(second).toBe(first);
  });
});

describe("REGRESSION — Q2 fail-safe: unknown session boundary always arms", () => {
  it("sessionStartIso === undefined -> false, EVEN WITH a matching identity and a record.at that would otherwise satisfy BOTH facts", () => {
    const result = isSameSessionAuthorship(
      { by: ACTOR_A, at: "2026-08-01T10:05:00.000Z" },
      ACTOR_A,
      undefined,
    );
    expect(result).toBe(false);
  });

  it("control: the identical record/actor pair WITH a session-start fact present returns true — proves the case above fails specifically on the missing boundary, not on some other broken input", () => {
    const result = isSameSessionAuthorship(
      { by: ACTOR_A, at: "2026-08-01T10:05:00.000Z" },
      ACTOR_A,
      "2026-08-01T10:00:00.000Z",
    );
    expect(result).toBe(true);
  });
});

describe("sessionStartMarkerFilename — HAPPY + BOUNDARY", () => {
  it("a well-formed UUID session id passes through unchanged inside the filename", () => {
    expect(sessionStartMarkerFilename("3de02220-5d69-4b5a-ac23-d66e14c0261b")).toBe(
      "lore-session-start-3de02220-5d69-4b5a-ac23-d66e14c0261b.json",
    );
  });

  it("BOUNDARY: characters outside [A-Za-z0-9._-] are replaced with '-', never left unsanitized or dropped", () => {
    const result = sessionStartMarkerFilename("weird/id with spaces!and$symbols");
    expect(result).toBe("lore-session-start-weird-id-with-spaces-and-symbols.json");
    expect(result).not.toContain("/");
    expect(result).not.toContain(" ");
    expect(result).not.toContain("!");
    expect(result).not.toContain("$");
  });
});
