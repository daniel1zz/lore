/**
 * Tests for @lore/core assessment.ts's diff-range scope-mismatch guard —
 * `isFileInScopeForAnchors` (the classification rule) and `computeScopeMismatchWarning` (the
 * function that scores it). Pure functions, no IO.
 *
 * Governing task: task-computescopemismatchwarning-cannot-distinguish-a-too-wide.
 * `computeScopeMismatchWarning` used to warn whenever fewer than half a diff's files
 * intersected a plan's declared task anchors — but test files are essentially never declared
 * as anchors, so a correctly-scoped plan whose tasks shipped more tests than source files
 * tripped the warning routinely (measured twice: 17 files/4 intersecting, 8 files/2
 * intersecting — both plans were correctly scoped). This file pins:
 *   (1) non-intersecting files that are RECOGNIZED TESTS of an in-scope source file no longer
 *       count as drift (the false-positive fix), and
 *   (2) the two early-return `undefined`s (no anchors declared / no diff files) are now a
 *       distinct `ScopeMismatchNotMeasured` value, never confusable with "measured, fine".
 *
 * Six-dimension coverage:
 *   HAPPY:      isFileInScopeForAnchors classifies direct-overlap / test-of-anchor / neither
 *               correctly; computeScopeMismatchWarning still warns on a genuine too-wide range
 *   NEGATIVE:   RED — a fixture where every non-intersecting file is a recognized test beside
 *               a declared anchor used to WARN; after the fix it does not
 *   BOUNDARY:   RED — an anchor-less plan (and a diff-less run) used to return bare
 *               `undefined`; after the fix each returns its own distinct not-measured value.
 *               Also: the exactly-half-intersecting boundary the pre-fix JSDoc pinned.
 *   ERROR:      the functions are documented precondition-only / never-throw — malformed or
 *               degenerate `deriveTestedSourcePath` output (empty string, non-matching path)
 *               is handled defensively, never thrown
 *   STATE:      a diff mixing an in-scope test-of-anchor file WITH a genuinely out-of-scope
 *               file converges to the correct aggregate in-scope count (per-file
 *               classification state folds correctly into the whole)
 *   REGRESSION: the exactly-half boundary and the genuine-drift warning both keep their
 *               PRE-FIX count pairs byte-identical; the message no longer asserts an
 *               unestablished cause ("the range may be too wide")
 */

import { describe, it, expect } from "vitest";
import {
  computeScopeMismatchWarning,
  isFileInScopeForAnchors,
  scopeMismatchWarningSchema,
  type DeriveTestedSourcePath,
} from "../src/assessment.js";

/** This repo's own test→source convention (NOT implemented in @lore/core — AC4). */
const repoDeriveTestedSourcePath: DeriveTestedSourcePath = (f) => {
  if (f.endsWith(".bun.test.ts")) return f.slice(0, -".bun.test.ts".length) + ".ts";
  if (f.endsWith(".test.ts")) return f.slice(0, -".test.ts".length) + ".ts";
  return undefined;
};

describe("isFileInScopeForAnchors — the classification rule (AC1)", () => {
  it("HAPPY: a file that directly overlaps a declared anchor is in scope", () => {
    expect(isFileInScopeForAnchors("src/a.ts", ["src/a.ts"])).toBe(true);
  });

  it("HAPPY: a recognized test of an in-scope source file is in scope", () => {
    expect(isFileInScopeForAnchors("src/a.test.ts", ["src/a.ts"], repoDeriveTestedSourcePath)).toBe(true);
    expect(isFileInScopeForAnchors("src/a.bun.test.ts", ["src/a.ts"], repoDeriveTestedSourcePath)).toBe(true);
  });

  it("HAPPY: a file that is neither a declared anchor nor a recognized test of one is out of scope", () => {
    expect(isFileInScopeForAnchors("docs/readme.md", ["src/a.ts"], repoDeriveTestedSourcePath)).toBe(false);
  });

  it("NEGATIVE: a test file for a source path NOT among the declared anchors is out of scope", () => {
    // "src/z.test.ts" derives to "src/z.ts", which is not an anchor — must not be swept in.
    expect(isFileInScopeForAnchors("src/z.test.ts", ["src/a.ts"], repoDeriveTestedSourcePath)).toBe(false);
  });

  it("BOUNDARY: without a deriveTestedSourcePath, a test file is judged by direct overlap only", () => {
    expect(isFileInScopeForAnchors("src/a.test.ts", ["src/a.ts"])).toBe(false);
  });

  it("ERROR: a deriveTestedSourcePath returning an empty string never throws and never overlaps", () => {
    expect(() => isFileInScopeForAnchors("weird/path.ts", ["src/a.ts"], () => "")).not.toThrow();
    expect(isFileInScopeForAnchors("weird/path.ts", ["src/a.ts"], () => "")).toBe(false);
  });
});

describe("computeScopeMismatchWarning — RED first (task-computescopemismatchwarning-cannot-distinguish-a-too-wide)", () => {
  it("NEGATIVE (RED a): every non-intersecting file is a recognized test beside a declared anchor → no longer warns", () => {
    const diffFiles = ["src/foo.ts", "src/foo.test.ts", "src/foo.bun.test.ts"];
    const taskAnchors = ["src/foo.ts"];

    // Pre-fix, this identical input warned: intersectingCount (direct-overlap only) = 1,
    // diffFiles.length = 3, 1 < 1.5 → warning. Post-fix, all three files are in scope.
    const result = computeScopeMismatchWarning(diffFiles, taskAnchors, repoDeriveTestedSourcePath);
    expect(result).toBeUndefined();
  });

  it("BOUNDARY (RED b1): an anchor-less plan returns the explicit not-measured VALUE, not mere falsiness", () => {
    const result = computeScopeMismatchWarning(["src/a.ts"], []);
    // Assert the VALUE — `toBeUndefined()`/`toBeFalsy()` would also have passed on the
    // pre-fix bare-`undefined` behaviour, which is exactly the conflation this task closes.
    expect(result).toEqual({ status: "not-measured", reason: "not-measured: no task declares file_anchors" });
  });

  it("BOUNDARY (RED b2): a diff touching no files returns its own distinct not-measured VALUE", () => {
    const result = computeScopeMismatchWarning([], ["src/a.ts"]);
    expect(result).toEqual({ status: "not-measured", reason: "not-measured: diff touched no files" });
  });

  it("BOUNDARY: the two not-measured reasons are themselves distinct from each other", () => {
    const noAnchors = computeScopeMismatchWarning(["src/a.ts"], []);
    const noDiffFiles = computeScopeMismatchWarning([], ["src/a.ts"]);
    expect(noAnchors).not.toEqual(noDiffFiles);
  });
});

describe("computeScopeMismatchWarning — CONTROLS (byte-identical to pre-fix behaviour)", () => {
  it("CONTROL (AC6): a genuinely too-wide range (non-anchor, non-test files) still warns, same count pair as pre-fix", () => {
    const diffFiles = ["src/a.ts", "docs/readme.md", "packages/dashboard/x.tsx"];
    const taskAnchors = ["src/a.ts"];

    const result = computeScopeMismatchWarning(diffFiles, taskAnchors, repoDeriveTestedSourcePath);
    expect(result).toBeDefined();
    // Pre-fix this same input produced { diff_file_count: 3, intersecting_count: 1, ... } —
    // neither non-intersecting file is a recognized test, so the classification change does
    // not touch these numbers at all.
    expect(result?.diff_file_count).toBe(3);
    expect(result?.intersecting_count).toBe(1);
  });

  it("REGRESSION (AC2): the message names what it found, never asserts the unestablished cause", () => {
    const result = computeScopeMismatchWarning(
      ["src/a.ts", "docs/readme.md", "packages/dashboard/x.tsx"],
      ["src/a.ts"],
    );
    expect(result).toBeDefined();
    expect(result?.message).not.toContain("may be too wide");
    expect(result?.message).toContain("3 files");
    expect(result?.message).toContain("1");
  });

  it("REGRESSION/BOUNDARY (AC7): exactly half of the diff's files in scope → still no warning, byte-identical to pre-fix", () => {
    // The pre-fix JSDoc's own pinned boundary: 1 of 2 files intersects — exactly half.
    const result = computeScopeMismatchWarning(["src/a.ts", "src/b.ts"], ["src/a.ts"], repoDeriveTestedSourcePath);
    expect(result).toBeUndefined();
  });
});

describe("computeScopeMismatchWarning — STATE (mixed in-scope/out-of-scope aggregation)", () => {
  it("STATE: a diff mixing a direct anchor, a test-of-anchor, and a genuinely out-of-scope file aggregates correctly", () => {
    const diffFiles = ["src/a.ts", "src/a.test.ts", "docs/readme.md"];
    const taskAnchors = ["src/a.ts"];

    // In scope: src/a.ts (direct), src/a.test.ts (test-of-anchor) = 2 of 3 → 2 >= 1.5 → no warning.
    const result = computeScopeMismatchWarning(diffFiles, taskAnchors, repoDeriveTestedSourcePath);
    expect(result).toBeUndefined();
  });

  it("STATE: the same mixed diff WITHOUT deriveTestedSourcePath still warns (test file not reclassified)", () => {
    const diffFiles = ["src/a.ts", "src/a.test.ts", "docs/readme.md"];
    const taskAnchors = ["src/a.ts"];

    // In scope by direct overlap only: src/a.ts = 1 of 3 → 1 < 1.5 → warns.
    const result = computeScopeMismatchWarning(diffFiles, taskAnchors);
    expect(result).toBeDefined();
    expect(result?.intersecting_count).toBe(1);
  });
});

describe("ScopeMismatchNotMeasured / ScopeMismatchWarning stay structurally distinct", () => {
  it("ERROR: a not-measured outcome never satisfies the persisted ScopeMismatchWarning schema", () => {
    const notMeasured = computeScopeMismatchWarning(["src/a.ts"], []);
    const parsed = scopeMismatchWarningSchema.safeParse(notMeasured);
    expect(parsed.success).toBe(false);
  });

  it("HAPPY: a real warning still satisfies the persisted ScopeMismatchWarning schema", () => {
    const warning = computeScopeMismatchWarning(
      ["src/a.ts", "docs/readme.md", "packages/dashboard/x.tsx"],
      ["src/a.ts"],
    );
    const parsed = scopeMismatchWarningSchema.safeParse(warning);
    expect(parsed.success).toBe(true);
  });
});
