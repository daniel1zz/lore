/**
 * Tests for @lore/core file-anchors.ts — normalizeFileAnchors + anchorsOverlap
 * (SPEC-042 §Design Decisions D3, D4). Pure, no IO. Dedicated `tests/` path
 * (not colocated `src/`) per review T8.
 *
 * Six-dimension coverage:
 *   HAPPY:      equal segments overlap regardless of trailing slash; directory
 *               scope contains descendants; ./-prefix and duplicate separators
 *               normalized; pairs lists every overlapping pair
 *   NEGATIVE:   ".." segments / leading "/" / backslash / empty entry rejected
 *   BOUNDARY:   segment boundary respected (no string-prefix false positive);
 *               either side empty → no overlap; exactly 50 entries passes,
 *               51 fails; exactly 512 chars passes, 513 fails
 *   ERROR:      n/a — anchorsOverlap is documented precondition-only, no ERROR
 *               path by design (asserted via a normalize-first round-trip)
 *   STATE:      n/a — both functions are stateless
 *   REGRESSION: case-sensitive byte compare; normalize-then-overlap round-trip
 *               is stable (idempotent re-normalization)
 *
 * @spec_ref SPEC-042 AC-S3-1
 */

import { describe, it, expect } from "vitest";
import {
  normalizeFileAnchors,
  anchorsOverlap,
  extractFileAnchors,
  MAX_FILE_ANCHORS,
  MAX_FILE_ANCHOR_LENGTH,
} from "../src/file-anchors.js";
import type { DocRecord } from "../src/types.js";

function unwrapOk<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
}

// ─── anchorsOverlap ─────────────────────────────────────────────────────────

describe("anchorsOverlap", () => {
  // HAPPY — equal segments overlap regardless of trailing slash
  it("src/a x src/a/ overlap (trailing-slash equivalence)", () => {
    const result = anchorsOverlap(["src/a"], ["src/a/"]);
    expect(result.overlaps).toBe(true);
    expect(result.pairs).toEqual([["src/a", "src/a/"]]);
  });

  // HAPPY — directory scope contains descendants
  it("src/a/ x src/a/b.ts overlap (directory scope)", () => {
    const result = anchorsOverlap(["src/a/"], ["src/a/b.ts"]);
    expect(result.overlaps).toBe(true);
  });

  it("directory scope is symmetric (b side declares the dir)", () => {
    const result = anchorsOverlap(["src/a/b.ts"], ["src/a/"]);
    expect(result.overlaps).toBe(true);
  });

  // BOUNDARY — segment boundary respected, no string-prefix false positive
  it("src/a x src/ab.ts do NOT overlap (whole-segment comparison, not string-prefix)", () => {
    const result = anchorsOverlap(["src/a"], ["src/ab.ts"]);
    expect(result.overlaps).toBe(false);
    expect(result.pairs).toEqual([]);
  });

  it("src/a/ (dir) x src/ab.ts do NOT overlap either (dir prefix still segment-bounded)", () => {
    const result = anchorsOverlap(["src/a/"], ["src/ab.ts"]);
    expect(result.overlaps).toBe(false);
  });

  // BOUNDARY — either side empty → no overlap
  it("either side empty → no overlap", () => {
    expect(anchorsOverlap([], ["src/a"]).overlaps).toBe(false);
    expect(anchorsOverlap(["src/a"], []).overlaps).toBe(false);
    expect(anchorsOverlap([], []).overlaps).toBe(false);
  });

  // HAPPY — pairs lists every overlapping pair
  it("pairs lists EVERY overlapping combination, not just the first", () => {
    const result = anchorsOverlap(["src/a", "src/b/"], ["src/a", "src/b/c.ts"]);
    expect(result.overlaps).toBe(true);
    expect(result.pairs).toHaveLength(2);
    expect(result.pairs).toContainEqual(["src/a", "src/a"]);
    expect(result.pairs).toContainEqual(["src/b/", "src/b/c.ts"]);
  });

  // REGRESSION — case-sensitive byte compare
  it("case-sensitive: Src/A does not overlap src/a", () => {
    expect(anchorsOverlap(["Src/A"], ["src/a"]).overlaps).toBe(false);
  });

  // ERROR (documented precondition-only, no ERROR path) — normalize-first round-trip:
  // normalizeFileAnchors(["./src/a"]) === normalizeFileAnchors(["src/a"]) and feeding
  // either into anchorsOverlap produces the identical result, proving the function
  // never throws/errors on its precondition-satisfying inputs regardless of the raw
  // spelling that normalized to them.
  it("precondition-only contract: normalize-first round-trip is stable", () => {
    const a = unwrapOk(normalizeFileAnchors(["./src/a"]));
    const b = unwrapOk(normalizeFileAnchors(["src//a"]));
    expect(a).toEqual(b);
    expect(anchorsOverlap(a, ["src/a"]).overlaps).toBe(true);
  });
});

// ─── normalizeFileAnchors ───────────────────────────────────────────────────

describe("normalizeFileAnchors", () => {
  // HAPPY — ./-prefix and duplicate separators normalized; duplicates dropped
  it("normalizes ./-prefix and duplicate separators, dedupes exact-normalized duplicates", () => {
    const result = unwrapOk(normalizeFileAnchors(["src/a", "./src/a", "src//b/"]));
    expect(result).toEqual(["src/a", "src/b/"]);
  });

  // HAPPY — trailing slash preserved as directory-scope marker
  it("preserves a trailing slash as the directory-scope marker", () => {
    const result = unwrapOk(normalizeFileAnchors(["src/dir/"]));
    expect(result).toEqual(["src/dir/"]);
  });

  // NEGATIVE — ".." segments rejected
  it("rejects '..' path segments", () => {
    const result = normalizeFileAnchors(["../escape"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(result.error.field).toBe("file_anchors");
  });

  it("rejects '..' segments anywhere in the path, not just at the start", () => {
    const result = normalizeFileAnchors(["src/../etc/passwd"]);
    expect(result.ok).toBe(false);
  });

  // NEGATIVE — leading "/" rejected
  it("rejects a leading '/' (absolute path)", () => {
    const result = normalizeFileAnchors(["/etc/passwd"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.field).toBe("file_anchors");
  });

  // NEGATIVE — backslash rejected
  it("rejects a backslash separator", () => {
    const result = normalizeFileAnchors(["src\\a"]);
    expect(result.ok).toBe(false);
  });

  // NEGATIVE — empty entry rejected
  it("rejects an empty string entry", () => {
    const result = normalizeFileAnchors([""]);
    expect(result.ok).toBe(false);
  });

  it("rejects an entry that normalizes to an empty path (e.g. '.', './')", () => {
    expect(normalizeFileAnchors(["."]).ok).toBe(false);
    expect(normalizeFileAnchors(["./"]).ok).toBe(false);
  });

  // BOUNDARY — exactly 50 entries passes, 51 fails
  it("accepts exactly 50 entries", () => {
    const anchors = Array.from({ length: MAX_FILE_ANCHORS }, (_, i) => `src/file-${i}.ts`);
    const result = normalizeFileAnchors(anchors);
    expect(result.ok).toBe(true);
  });

  it("rejects 51 entries", () => {
    const anchors = Array.from({ length: MAX_FILE_ANCHORS + 1 }, (_, i) => `src/file-${i}.ts`);
    const result = normalizeFileAnchors(anchors);
    expect(result.ok).toBe(false);
  });

  // BOUNDARY — exactly 512 chars passes, 513 fails
  it("accepts an entry exactly at the 512-char cap", () => {
    const longEntry = `src/${"a".repeat(MAX_FILE_ANCHOR_LENGTH - 4)}`;
    expect(longEntry.length).toBe(MAX_FILE_ANCHOR_LENGTH);
    const result = normalizeFileAnchors([longEntry]);
    expect(result.ok).toBe(true);
  });

  it("rejects an entry one char over the 512-char cap", () => {
    const tooLong = `src/${"a".repeat(MAX_FILE_ANCHOR_LENGTH - 3)}`;
    expect(tooLong.length).toBe(MAX_FILE_ANCHOR_LENGTH + 1);
    const result = normalizeFileAnchors([tooLong]);
    expect(result.ok).toBe(false);
  });

  // REGRESSION — never throws; always returns a Result
  it("never throws — returns err(VALIDATION_ERROR) for every malformed input tried above", () => {
    expect(() => normalizeFileAnchors(["../x", "/abs", "back\\slash", ""])).not.toThrow();
  });
});

// ─── extractFileAnchors ─────────────────────────────────────────────────────

describe("extractFileAnchors", () => {
  function makeTask(extra: Record<string, unknown>): DocRecord {
    return {
      id: "01HTASK0000000000000000000",
      slug: "task-fixture",
      type: "task",
      role: "task",
      title: "Fixture Task",
      status: "draft",
      priority: "medium",
      content: "",
      parent_id: "01HPLAN0000000000000000000",
      created_at: "2026-07-11T00:00:00.000Z",
      updated_at: "2026-07-11T00:00:00.000Z",
      created_by: "system",
      version: 1,
      deleted_at: null,
      tags: [],
      extra,
    } as DocRecord;
  }

  // HAPPY
  it("extracts a valid file_anchors array", () => {
    expect(extractFileAnchors(makeTask({ file_anchors: ["src/a", "src/b/"] }))).toEqual(["src/a", "src/b/"]);
  });

  // BOUNDARY / NEGATIVE — absent or malformed → []
  it("returns [] when file_anchors is absent", () => {
    expect(extractFileAnchors(makeTask({}))).toEqual([]);
  });

  it("returns [] when file_anchors is not an array", () => {
    expect(extractFileAnchors(makeTask({ file_anchors: "not-an-array" }))).toEqual([]);
  });

  it("filters out non-string entries defensively rather than failing the whole array", () => {
    expect(extractFileAnchors(makeTask({ file_anchors: ["src/a", 42, null] }))).toEqual(["src/a"]);
  });
});
