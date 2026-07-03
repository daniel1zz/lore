/**
 * Tests for truncateDiffByFile() / classifyDiffFilePriority() (SPEC-028).
 *
 * Spec-first expected behaviours (SPEC-028 AC-AE-2, AC-AE-3, AC-AE-4, AC-AE-5), re-derived
 * from the module's own header JSDoc (packages/lore/src/ai/diff-truncation.ts) BEFORE
 * reading the implementation body, then cross-checked against the actual code:
 *   - Within-budget diffs pass through byte-identical, no matter their internal shape
 *     (fast path runs BEFORE any parsing — a within-budget diff is never re-tokenized)
 *   - Over-budget diffs are truncated at file boundaries — never a half-file
 *   - Priority order is production source (src/) > test files > everything else, and
 *     test-ness is checked BEFORE source-ness (co-located `src/foo.test.ts` ranks as test)
 *   - A single file that alone exceeds the whole budget gets a labeled head-truncation,
 *     with every other file reported as fully omitted — the label reserves space in the
 *     budget, with a final hard clamp guaranteeing `result.text.length <= maxChars` even
 *     when the label itself would otherwise be longer than `maxChars`
 *   - A diff with no recognizable `diff --git` headers is a documented PASSTHROUGH, not
 *     a thrown error (see module header for the fail-loud-vs-passthrough rationale)
 *   - Kept-file order in the output text follows ORIGINAL diff order (chunks.filter over
 *     the unsorted `chunks` array), NOT priority order — priority only decides WHICH files
 *     survive, not the order they're rendered in
 *   - The greedy keep loop reserves one budget char per "\n" join separator between kept
 *     chunks (not just each chunk's own length) — `result.text.length` never exceeds
 *     `maxChars`, even when kept-file sizes sum to exactly the budget
 *
 * Six-dimension coverage:
 *   HAPPY:      diff fits the budget → byte-identical passthrough, untruncated
 *   NEGATIVE:   oversized mixed src/tests/docs diff → correct keep/drop sets by priority
 *   BOUNDARY:   diffText.length === maxChars (not truncated); exact-budget greedy
 *               inclusion accounting for the join separator; a single file whose OWN
 *               chunk exceeds the whole budget (head-truncation fallback); a budget
 *               smaller than the head-truncation label itself (hard-clamp safety net)
 *   ERROR:      diff text with no `diff --git` headers at all → passthrough single chunk,
 *               never throws; a reasonably-budgeted malformed diff still respects the
 *               content-budget arithmetic
 *   STATE:      priority ordering is stable/deterministic — same input always yields the
 *               same keep/omit set, and file position within a priority group doesn't
 *               change the group-level ordering (source always wins over test/other)
 *   REGRESSION: when truncation happens, the result carries real per-file paths (usable
 *               to build "diff:<path>" markers) — never collapses to an opaque flag; kept
 *               files are rendered in original diff order, not priority order; two prior
 *               budget-overflow bugs (join-separator accounting, label-reservation on a
 *               pathologically small budget — found during independent test review, then
 *               fixed in the implementation) stay fixed, verified by the tests tagged
 *               "REGRESSION (fixed)" in the BOUNDARY section
 *
 * @spec_ref AC-AE-2, AC-AE-3, AC-AE-4, AC-AE-5
 */

import { describe, it, expect } from "vitest";
import { truncateDiffByFile, classifyDiffFilePriority } from "../../../src/ai/diff-truncation.js";

// ─── Fixture builders ─────────────────────────────────────────────────────────

/** Build a single-file unified-diff chunk of a given approximate body length. */
function makeFileDiff(path: string, bodyChars: number): string {
  const body = "+".repeat(bodyChars);
  return `diff --git a/${path} b/${path}\nindex 111..222 100644\n--- a/${path}\n+++ b/${path}\n@@ -1,1 +1,1 @@\n${body}`;
}

// ─── classifyDiffFilePriority ─────────────────────────────────────────────────

describe("classifyDiffFilePriority", () => {
  it("classifies a plain src/ file as source", () => {
    expect(classifyDiffFilePriority("packages/core/src/assessment.ts")).toBe("source");
  });

  it("classifies a *.test.ts file under src/ as test, NOT source (co-located test convention)", () => {
    expect(classifyDiffFilePriority("packages/core/src/assessment.test.ts")).toBe("test");
  });

  it("classifies a *.spec.ts file under src/ as test too (spec suffix, not just test suffix)", () => {
    expect(classifyDiffFilePriority("packages/dashboard/src/components/Button.spec.tsx")).toBe("test");
  });

  it("classifies a tests/ directory file as test", () => {
    expect(classifyDiffFilePriority("packages/lore/tests/unit/ai/diff-truncation.test.ts")).toBe("test");
  });

  it("classifies a docs/ file as other", () => {
    expect(classifyDiffFilePriority("docs/requirements/spec/SPEC-028.md")).toBe("other");
  });

  it("classifies a root-level config file as other", () => {
    expect(classifyDiffFilePriority("package.json")).toBe("other");
  });

  it("is case-insensitive for the tests/ directory pattern", () => {
    expect(classifyDiffFilePriority("packages/lore/Tests/Unit/Foo.Test.ts")).toBe("test");
  });

  it("does NOT classify a directory merely CONTAINING 'test' as a substring as test (false-positive guard)", () => {
    // "latest" contains "test" as a substring but is not the "tests"/"test" directory segment.
    expect(classifyDiffFilePriority("packages/core/src/latest/foo.ts")).toBe("source");
  });

  it("does NOT classify a directory merely CONTAINING 'src' as a substring as source (false-positive guard)", () => {
    // "mysrc" contains "src" as a substring but is not the "src/" path segment.
    expect(classifyDiffFilePriority("mysrc/foo.ts")).toBe("other");
  });
});

// ─── HAPPY: within budget ─────────────────────────────────────────────────────

describe("truncateDiffByFile — HAPPY: within budget", () => {
  it("returns the diff text byte-identical when it fits the budget", () => {
    const diff = makeFileDiff("packages/core/src/foo.ts", 50);
    const result = truncateDiffByFile(diff, 10_000);
    expect(result.text).toBe(diff);
    expect(result.truncated).toBe(false);
    expect(result.omittedFiles).toEqual([]);
    expect(result.headTruncatedFile).toBeUndefined();
  });

  it("passes through a multi-file diff untouched when the whole thing fits", () => {
    const diff = [makeFileDiff("src/a.ts", 100), makeFileDiff("src/b.ts", 100), makeFileDiff("tests/a.test.ts", 100)].join(
      "\n",
    );
    const result = truncateDiffByFile(diff, 10_000);
    expect(result.text).toBe(diff);
    expect(result.truncated).toBe(false);
  });
});

// ─── NEGATIVE: oversized mixed src/tests/docs diff ────────────────────────────

describe("truncateDiffByFile — NEGATIVE: oversized mixed-priority diff", () => {
  it("keeps the source file and drops the docs file when budget only fits one", () => {
    const srcChunk = makeFileDiff("packages/core/src/important.ts", 300);
    const docsChunk = makeFileDiff("docs/README.md", 300);
    const diff = `${srcChunk}\n${docsChunk}`;
    // Budget fits the source chunk alone but not both.
    const budget = srcChunk.length + 10;
    const result = truncateDiffByFile(diff, budget);

    expect(result.truncated).toBe(true);
    expect(result.omittedFiles).toEqual(["docs/README.md"]);
    expect(result.text).toContain("important.ts");
    expect(result.text).not.toContain("docs/README.md");
  });

  it("prioritizes source over test over other even when they appear in reverse order in the diff", () => {
    const otherChunk = makeFileDiff("docs/other.md", 300);
    const testChunk = makeFileDiff("packages/core/src/thing.test.ts", 300);
    const srcChunk = makeFileDiff("packages/core/src/thing.ts", 300);
    // Diff order: other, test, source (deliberately reversed vs. priority order).
    const diff = `${otherChunk}\n${testChunk}\n${srcChunk}`;
    // Budget fits exactly two of the three chunks.
    const budget = srcChunk.length + testChunk.length + 10;
    const result = truncateDiffByFile(diff, budget);

    expect(result.truncated).toBe(true);
    expect(result.omittedFiles).toEqual(["docs/other.md"]);
    expect(result.text).toContain("thing.ts");
    expect(result.text).toContain("thing.test.ts");
  });

  it("skips a large lower-priority file that would not fit but keeps a smaller one after it", () => {
    // Two "other" files: one too big to fit in remaining budget, a smaller one that does.
    const srcChunk = makeFileDiff("src/main.ts", 100);
    const bigOther = makeFileDiff("docs/BIG.md", 5000);
    const smallOther = makeFileDiff("docs/small.md", 50);
    const diff = `${srcChunk}\n${bigOther}\n${smallOther}`;
    // Budget: room for src + smallOther, but not bigOther.
    const budget = srcChunk.length + smallOther.length + 10;
    const result = truncateDiffByFile(diff, budget);

    expect(result.omittedFiles).toEqual(["docs/BIG.md"]);
    expect(result.text).toContain("main.ts");
    expect(result.text).toContain("small.md");
    expect(result.text).not.toContain("BIG.md");
  });
});

// ─── BOUNDARY ─────────────────────────────────────────────────────────────────

describe("truncateDiffByFile — BOUNDARY", () => {
  it("diffText.length === maxChars is NOT truncated (strict > comparison, mirrors truncateSection)", () => {
    const diff = makeFileDiff("src/exact.ts", 50);
    const result = truncateDiffByFile(diff, diff.length);
    expect(result.truncated).toBe(false);
    expect(result.text).toBe(diff);
  });

  it("a single file whose own chunk exceeds the WHOLE budget triggers labeled head-truncation", () => {
    const hugeFile = makeFileDiff("packages/core/src/huge.ts", 5000);
    const otherFile = makeFileDiff("docs/other.md", 100);
    const diff = `${hugeFile}\n${otherFile}`;
    const budget = 500; // far smaller than hugeFile alone

    const result = truncateDiffByFile(diff, budget);

    expect(result.truncated).toBe(true);
    expect(result.headTruncatedFile).toBeDefined();
    expect(result.headTruncatedFile?.filePath).toBe("packages/core/src/huge.ts");
    expect(result.headTruncatedFile?.totalChars).toBe(hugeFile.length);
    expect(result.omittedFiles).toEqual(["docs/other.md"]);
    // The label announcing truncation must be visible in the output text.
    expect(result.text).toContain("TRUNCATED");
    expect(result.text).toContain("huge.ts");
    // The kept content must be an actual PREFIX (head) of the original file's chunk —
    // never garbage/re-ordered text — up to the reported keptChars length.
    const keptChars = result.headTruncatedFile?.keptChars ?? -1;
    expect(hugeFile.startsWith(result.text.slice(0, keptChars))).toBe(true);
    // Final text must not blow the budget by more than a rounding margin (label reserved).
    // At this budget (500 chars, well above the label's own length) this invariant holds.
    expect(result.text.length).toBeLessThanOrEqual(budget);
  });

  it("greedy inclusion keeps a chunk whose length exactly equals the remaining budget, INCLUDING the join separator (<=, not <)", () => {
    const fileA = makeFileDiff("src/a.ts", 100); // source, kept first
    const fileB = makeFileDiff("packages/lore/tests/unit/b.test.ts", 100); // test, kept second
    const fileC = makeFileDiff("docs/c.md", 50); // other, must be dropped
    const diff = `${fileA}\n${fileB}\n${fileC}`;
    // Budget is EXACTLY the sum of the two higher-priority chunks PLUS the one "\n" that
    // joins them in the final assembled text — zero slack beyond that, so fileC must drop.
    const budget = fileA.length + fileB.length + 1;
    expect(diff.length).toBeGreaterThan(budget); // sanity: must not take the fast path

    const result = truncateDiffByFile(diff, budget);
    expect(result.omittedFiles).toEqual(["docs/c.md"]);
    expect(result.text).toContain("a.ts");
    expect(result.text).toContain("b.test.ts");
    expect(result.text.length).toBeLessThanOrEqual(budget);
  });

  it("REGRESSION (fixed): joining >1 kept chunks with \"\\n\" never pushes result.text.length over maxChars, even when kept-file sizes sum to exactly the budget", () => {
    // Same fixture as the test above, but budgeted with ZERO slack for the join separator
    // (budget = fileA.length + fileB.length exactly, one char short of what's needed to
    // keep both). This only asserts the hard budget contract — which specific file gets
    // dropped when the join separator itself doesn't fit is an implementation detail.
    const fileA = makeFileDiff("src/a.ts", 100);
    const fileB = makeFileDiff("packages/lore/tests/unit/b.test.ts", 100);
    const fileC = makeFileDiff("docs/c.md", 50);
    const diff = `${fileA}\n${fileB}\n${fileC}`;
    const budget = fileA.length + fileB.length;

    const result = truncateDiffByFile(diff, budget);

    // Hard contract: `truncateDiffByFile(diffText, maxChars)` truncates TO `maxChars`.
    // A prior bug let the "\n" join separator between kept chunks push `text.length` one
    // char over budget whenever kept-file sizes summed to exactly the budget — fixed by
    // reserving the join cost during the greedy walk itself.
    expect(result.text.length).toBeLessThanOrEqual(budget);
  });

  it("REGRESSION (fixed): a budget smaller than the head-truncation label's own length still clamps result.text.length to maxChars", () => {
    // Same fixture as the head-truncation test above, but with a budget so small that the
    // labeled-truncation-notice string itself (~170+ chars, since it embeds the file path,
    // char counts, and the budget number) is longer than maxChars. A prior bug let
    // `contentBudget` floor at 0 (`Math.max(0, maxChars - label.length)`) while still
    // appending the full label, so the "budget" was not actually enforced in this regime —
    // fixed by a final hard clamp on the assembled text.
    const hugeFile = makeFileDiff("packages/core/src/huge.ts", 5000);
    const otherFile = makeFileDiff("docs/other.md", 100);
    const diff = `${hugeFile}\n${otherFile}`;
    const budget = 50; // smaller than the label text alone

    const result = truncateDiffByFile(diff, budget);

    expect(result.headTruncatedFile).toBeDefined();
    expect(result.text.length).toBeLessThanOrEqual(budget);
  });
});

// ─── ERROR: malformed diff (documented passthrough) ──────────────────────────

describe("truncateDiffByFile — ERROR: malformed/unrecognizable diff header (documented passthrough choice)", () => {
  it("a diff with no `diff --git` headers at all never throws — treated as one opaque chunk", () => {
    const notADiff = "some random text\nthat is not a unified diff\nat all".repeat(200);
    expect(() => truncateDiffByFile(notADiff, 100)).not.toThrow();

    const result = truncateDiffByFile(notADiff, 100);
    expect(result.truncated).toBe(true);
    // Passthrough: single opaque chunk, head-truncated like any oversized single file.
    expect(result.headTruncatedFile?.filePath).toBe("(unparsed diff)");
    expect(result.omittedFiles).toEqual([]);
  });

  it("an unparsed diff within budget still passes through byte-identical", () => {
    const notADiff = "just some plain text, no diff markers here";
    const result = truncateDiffByFile(notADiff, 10_000);
    expect(result.text).toBe(notADiff);
    expect(result.truncated).toBe(false);
  });

  it("an unparsed diff head-truncated with a REALISTIC (non-pathological) budget respects the content-budget arithmetic", () => {
    // Same passthrough shape as above, but with a budget generous enough that the
    // truncation label fits comfortably inside it (unlike the FOUND DEFECT boundary
    // tests above) — this is the realistic production shape (default max_diff_chars =
    // 24000), so it must behave correctly.
    const notADiff = "x".repeat(50_000);
    const budget = 2000;
    const result = truncateDiffByFile(notADiff, budget);

    expect(result.headTruncatedFile?.filePath).toBe("(unparsed diff)");
    expect(result.headTruncatedFile?.totalChars).toBe(50_000);
    expect(result.text.length).toBeLessThanOrEqual(budget);
    // The kept content is a genuine prefix of the original, not garbage.
    const keptChars = result.headTruncatedFile?.keptChars ?? -1;
    expect(notADiff.slice(0, keptChars)).toBe(result.text.slice(0, keptChars));
  });
});

// ─── STATE: deterministic priority ordering ──────────────────────────────────

describe("truncateDiffByFile — STATE: deterministic priority ordering", () => {
  it("running the same input twice yields an identical result", () => {
    const diff = [makeFileDiff("docs/z.md", 400), makeFileDiff("src/a.ts", 400), makeFileDiff("tests/b.test.ts", 400)].join(
      "\n",
    );
    const budget = 900;
    const first = truncateDiffByFile(diff, budget);
    const second = truncateDiffByFile(diff, budget);
    expect(first).toEqual(second);
  });

  it("source always outranks test and other regardless of where it sits in the original diff", () => {
    const src = makeFileDiff("src/keep-me.ts", 300);
    const test = makeFileDiff("tests/drop-me.test.ts", 300);
    const other = makeFileDiff("docs/drop-me-too.md", 300);
    // Two different original orderings of the same three files.
    const orderingA = [test, other, src].join("\n");
    const orderingB = [other, src, test].join("\n");
    const budget = src.length + 10;

    const resultA = truncateDiffByFile(orderingA, budget);
    const resultB = truncateDiffByFile(orderingB, budget);

    expect(resultA.text).toContain("keep-me.ts");
    expect(resultB.text).toContain("keep-me.ts");
    expect(resultA.omittedFiles.sort()).toEqual(["docs/drop-me-too.md", "tests/drop-me.test.ts"]);
    expect(resultB.omittedFiles.sort()).toEqual(["docs/drop-me-too.md", "tests/drop-me.test.ts"]);
  });
});

// ─── REGRESSION: real per-file paths, never an opaque flag ───────────────────

describe("truncateDiffByFile — REGRESSION: truncation carries real file paths, not an opaque marker", () => {
  it("omittedFiles contains actual file path strings usable to build 'diff:<path>' markers", () => {
    const src = makeFileDiff("src/keep.ts", 200);
    const dropped1 = makeFileDiff("docs/drop1.md", 500);
    const dropped2 = makeFileDiff("docs/drop2.md", 500);
    const diff = [src, dropped1, dropped2].join("\n");
    const budget = src.length + 10;

    const result = truncateDiffByFile(diff, budget);

    expect(result.omittedFiles).toContain("docs/drop1.md");
    expect(result.omittedFiles).toContain("docs/drop2.md");
    // Never a bare boolean/opaque flag standing in for real paths.
    expect(result.omittedFiles.every((p) => typeof p === "string" && p.length > 0)).toBe(true);
  });

  it("kept files are rendered in ORIGINAL diff order, not priority order", () => {
    // Diff order: test, other, source — deliberately NOT priority order.
    const testChunk = makeFileDiff("packages/core/src/thing.test.ts", 300);
    const otherChunk = makeFileDiff("docs/other.md", 300);
    const srcChunk = makeFileDiff("packages/core/src/thing.ts", 300);
    const diff = `${testChunk}\n${otherChunk}\n${srcChunk}`;
    // Budget fits test + source (both survive priority selection) but not other.
    const budget = srcChunk.length + testChunk.length + 10;

    const result = truncateDiffByFile(diff, budget);

    expect(result.omittedFiles).toEqual(["docs/other.md"]);
    // Priority selection would rank source before test, but the OUTPUT TEXT must preserve
    // original relative order (test appears before source in the source diff).
    expect(result.text).toBe(`${testChunk}\n${srcChunk}`);
  });
});
