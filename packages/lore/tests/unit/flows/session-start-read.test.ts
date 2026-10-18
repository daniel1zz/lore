/**
 * Unit suite for `readSessionStartIso`'s DISCRIMINATED return value
 * (`packages/lore/src/flows/feed-flow.ts`) —
 * task-the-session-start-marker-collapses-five-distinct AC 1, AC 4.
 *
 * Scope: this file proves the pure(-ish, env/fs-seamed) READ function in
 * isolation — given an env map (and a real marker file this suite writes to
 * `os.tmpdir()`, the function's own only IO surface), does it correctly
 * distinguish the five previously-collapsed conditions. The IO-wired
 * consumer (`buildResumeFeed`'s `authorshipUndeterminedNote` +
 * `renderResumeFeed` insertion, plus the stderr line for `"unreadable"`) is
 * covered separately by `feed-resume-same-session.test.ts`.
 *
 * RED-before-GREEN: every scenario below was run against the PRE-fix
 * `readSessionStartIso` (returning `string | undefined`) and failed to
 * compile / failed to distinguish kinds — see this task's final report for
 * the exact RED failure text captured before the discriminated return type
 * existed.
 *
 * Six-dimension coverage:
 *   HAPPY:      env var set + a valid marker -> kind "measured", startedAt
 *               equal to the marker's own started_at string
 *   NEGATIVE:   neither CLAUDE_CODE_SESSION_ID nor CLAUDE_SESSION_ID set ->
 *               kind "no-session-id" (AC 4a)
 *   BOUNDARY:   env var set but the marker file does not exist -> kind
 *               "no-marker" (AC 4b), and asserted DISTINCT from
 *               "no-session-id" (the exact collapse this task fixes) —
 *               plus CLAUDE_SESSION_ID (the fallback var) alone is honoured
 *               the same way CLAUDE_CODE_SESSION_ID is
 *   ERROR:      a marker with a wrong-TYPED started_at ({"started_at":12345})
 *               -> kind "unreadable" via the NON-throwing code path (AC 4c);
 *               a marker with invalid JSON -> kind "unreadable" via the
 *               THROWING code path (AC 4d) — asserted separately, with
 *               DIFFERENT `detail` text, proving they are actually two
 *               distinct branches and not one that happens to catch both
 *   STATE:      referential transparency — two calls with the same env/
 *               marker produce structurally equal results; a blank
 *               (whitespace-only) session id is treated as absent, matching
 *               the pre-existing trim() convention
 *   REGRESSION: the fix's whole point as a single assertion — "no-session-id"
 *               and "no-marker" are DIFFERENT string values (pre-fix, both
 *               were the same `undefined`)
 *
 * @spec_ref task-the-session-start-marker-collapses-five-distinct
 *   §Acceptance Criteria AC 1, AC 4
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sessionStartMarkerFilename } from "@lore/core";
import { readSessionStartIso, type SessionStartReadResult } from "../../../src/flows/feed-flow.js";

// ─── Marker file isolation — same convention as feed-resume-same-session.test.ts ──

let testSessionId: string;
let markerPath: string;

function writeMarker(content: string): void {
  writeFileSync(markerPath, content, "utf8");
}

beforeEach(() => {
  testSessionId = `test-session-read-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  markerPath = join(tmpdir(), sessionStartMarkerFilename(testSessionId));
});

afterEach(() => {
  if (existsSync(markerPath)) rmSync(markerPath);
});

// ─── HAPPY ───────────────────────────────────────────────────────────────────

describe("HAPPY — env var set + valid marker", () => {
  it('kind "measured", startedAt equal to the marker\'s own started_at string', () => {
    writeMarker(JSON.stringify({ started_at: "2026-08-01T10:00:00.000Z" }));
    const result = readSessionStartIso({ CLAUDE_CODE_SESSION_ID: testSessionId }, tmpdir());
    expect(result).toEqual({ kind: "measured", startedAt: "2026-08-01T10:00:00.000Z" });
  });

  it("CLAUDE_SESSION_ID (the fallback var) alone is honoured the same way", () => {
    writeMarker(JSON.stringify({ started_at: "2026-08-01T11:00:00.000Z" }));
    const result = readSessionStartIso({ CLAUDE_SESSION_ID: testSessionId }, tmpdir());
    expect(result).toEqual({ kind: "measured", startedAt: "2026-08-01T11:00:00.000Z" });
  });
});

// ─── NEGATIVE — AC 4a ────────────────────────────────────────────────────────

describe('NEGATIVE — AC 4a: neither session-id env var is set', () => {
  it('kind "no-session-id" when both env vars are absent', () => {
    const result: SessionStartReadResult = readSessionStartIso({}, tmpdir());
    expect(result.kind).toBe("no-session-id");
  });
});

// ─── BOUNDARY — AC 4b ────────────────────────────────────────────────────────

describe('BOUNDARY — AC 4b: session id present, marker absent', () => {
  it('kind "no-marker" — distinguishable from "no-session-id"', () => {
    // Deliberately do NOT write a marker file.
    const result = readSessionStartIso({ CLAUDE_CODE_SESSION_ID: testSessionId }, tmpdir());
    expect(result.kind).toBe("no-marker");
    expect(result.kind).not.toBe("no-session-id");
  });

  it('control: "no-session-id" and "no-marker" are DIFFERENT string values — proves the two are not the same collapsed sentinel', () => {
    const noSessionId = readSessionStartIso({}, tmpdir());
    const noMarker = readSessionStartIso({ CLAUDE_CODE_SESSION_ID: testSessionId }, tmpdir());
    expect(noSessionId.kind).not.toBe(noMarker.kind);
  });
});

// ─── ERROR — AC 4c / AC 4d, distinct code paths ─────────────────────────────

describe("ERROR — AC 4c: marker with a wrong-TYPED started_at (non-throwing path)", () => {
  it('kind "unreadable", detail names the missing string field', () => {
    writeMarker(JSON.stringify({ started_at: 12345 }));
    const result = readSessionStartIso({ CLAUDE_CODE_SESSION_ID: testSessionId }, tmpdir());
    expect(result.kind).toBe("unreadable");
    if (result.kind !== "unreadable") return;
    expect(result.detail).toContain("started_at");
  });
});

describe("ERROR — AC 4d: marker with invalid JSON (throwing path)", () => {
  it('kind "unreadable", detail names the JSON parse failure — DIFFERENT detail text from AC 4c', () => {
    writeMarker("{ not valid json");
    const result = readSessionStartIso({ CLAUDE_CODE_SESSION_ID: testSessionId }, tmpdir());
    expect(result.kind).toBe("unreadable");
    if (result.kind !== "unreadable") return;
    expect(result.detail).toContain("JSON");
  });

  it("control: the two unreadable triggers (4c wrong-type vs 4d invalid-JSON) produce DIFFERENT detail strings — proves they are genuinely separate branches, not one catch-all", () => {
    writeMarker(JSON.stringify({ started_at: 12345 }));
    const wrongType = readSessionStartIso({ CLAUDE_CODE_SESSION_ID: testSessionId }, tmpdir());

    const secondSessionId = `${testSessionId}-b`;
    const secondMarkerPath = join(tmpdir(), sessionStartMarkerFilename(secondSessionId));
    writeFileSync(secondMarkerPath, "{ not valid json", "utf8");
    try {
      const invalidJson = readSessionStartIso({ CLAUDE_CODE_SESSION_ID: secondSessionId }, tmpdir());
      expect(wrongType.kind).toBe("unreadable");
      expect(invalidJson.kind).toBe("unreadable");
      if (wrongType.kind !== "unreadable" || invalidJson.kind !== "unreadable") return;
      expect(wrongType.detail).not.toBe(invalidJson.detail);
    } finally {
      if (existsSync(secondMarkerPath)) rmSync(secondMarkerPath);
    }
  });
});

// ─── STATE ───────────────────────────────────────────────────────────────────

describe("STATE — referential transparency + blank-session-id boundary", () => {
  it("two calls with the same env/marker produce structurally equal results", () => {
    writeMarker(JSON.stringify({ started_at: "2026-08-01T12:00:00.000Z" }));
    const env = { CLAUDE_CODE_SESSION_ID: testSessionId };
    const first = readSessionStartIso(env, tmpdir());
    const second = readSessionStartIso(env, tmpdir());
    expect(first).toEqual(second);
  });

  it('a whitespace-only session id is treated as absent -> kind "no-session-id" (matches the pre-existing trim() convention)', () => {
    const result = readSessionStartIso({ CLAUDE_CODE_SESSION_ID: "   " }, tmpdir());
    expect(result.kind).toBe("no-session-id");
  });
});

// ─── REGRESSION ──────────────────────────────────────────────────────────────

describe("REGRESSION — the defect this task fixes, as a single assertion", () => {
  it('"no-session-id" and "no-marker" are DIFFERENT values (pre-fix, both were the SAME undefined sentinel)', () => {
    const noSessionId = readSessionStartIso({}, tmpdir());
    const noMarker = readSessionStartIso({ CLAUDE_CODE_SESSION_ID: testSessionId }, tmpdir());
    // Pre-fix this would have been `undefined === undefined` (both branches
    // returned the same collapsed sentinel) — post-fix these are distinct
    // discriminated kinds.
    expect(noSessionId).not.toEqual(noMarker);
    expect(noSessionId.kind).toBe("no-session-id");
    expect(noMarker.kind).toBe("no-marker");
  });
});
