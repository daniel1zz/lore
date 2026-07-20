/**
 * Unit tests for headChars() / tailChars() in @lore/core/truncate (BUG-001 fix).
 *
 * Failure-first discipline: the first describe block reproduces the ORIGINAL buggy
 * `text.slice(text.length - max)` / `text.slice(0, maxChars)` logic (copied verbatim
 * from the three tailChars call sites + truncateSection's head-slice, pre-fix) and
 * proves it produces an orphaned surrogate on a crafted input — the RED evidence that
 * the bug was real. Every subsequent block exercises the FIXED `headChars`/`tailChars`
 * and asserts the orphan never appears.
 *
 * Coverage dimensions (per this task's own AC — a pure function has no ERROR/STATE
 * surface, so only the four applicable dimensions are exercised):
 *   HAPPY:      plain ASCII truncation, both head and tail
 *   BOUNDARY:   exact-length input (no truncation), max=0, max=1, empty string, cut
 *               point landing exactly before / inside / after a surrogate pair
 *   NEGATIVE:   BMP-only input is byte-identical to the naive slice() these helpers
 *               replace (no unintended behavior change for the common case)
 *   REGRESSION: budget contract (`result.length <= max` always), idempotency on
 *               already-short input, fixed known-value pins
 *
 * @spec_ref BUG-001 audit finding (2026-07-20)
 */

import { describe, it, expect } from "vitest";
import { headChars, tailChars } from "./truncate.js";

/** U+1F389 PARTY POPPER — a real astral-plane emoji, encoded as a UTF-16 surrogate pair. */
const EMOJI = "🎉"; // "🎉"
const EMOJI_HIGH = "\uD83C";
const EMOJI_LOW = "\uDF89";

function isOrphanSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdfff;
}

// ─── RED: reproduce the pre-fix bug with the ORIGINAL naive implementations ───────

describe("RED — original naive slice() logic produces orphan surrogates (BUG-001 repro)", () => {
  /** Verbatim copy of the original buggy tailChars from evidence.ts/handoff.ts/verify-executor.ts. */
  function buggyTailChars(text: string, max: number): string {
    return text.length > max ? text.slice(text.length - max) : text;
  }

  /** Verbatim copy of the original buggy head-slice from assessment.ts::truncateSection. */
  function buggyHeadSlice(text: string, maxChars: number): string {
    return text.length <= maxChars ? text : text.slice(0, maxChars);
  }

  it("buggy tailChars splits a surrogate pair straddling the cut point, orphaning the low surrogate", () => {
    // "abc" + 🎉 (pair at index 3-4) + "def" — length 8. Cutting at start=4 (max=4)
    // lands exactly between the two halves of the pair.
    const text = "abc" + EMOJI + "def";
    expect(text.length).toBe(8);
    const result = buggyTailChars(text, 4);
    // Proves the bug: result starts with a lone low surrogate, not the intended emoji.
    expect(isOrphanSurrogate(result.charCodeAt(0))).toBe(true);
    expect(result.charCodeAt(0)).toBe(EMOJI_LOW.charCodeAt(0));
    expect(result).not.toContain(EMOJI);
  });

  it("buggy head-slice splits a surrogate pair straddling the cut point, orphaning the high surrogate", () => {
    // "abc" + 🎉 (pair at index 3-4) + "def". Cutting at end=4 (maxChars=4) also lands
    // exactly between the two halves — the head-truncation direction of the same bug.
    const text = "abc" + EMOJI + "def";
    const result = buggyHeadSlice(text, 4);
    expect(isOrphanSurrogate(result.charCodeAt(result.length - 1))).toBe(true);
    expect(result.charCodeAt(result.length - 1)).toBe(EMOJI_HIGH.charCodeAt(0));
    expect(result).not.toContain(EMOJI);
  });

  it("the SAME crafted input does NOT trigger the bug in the fixed headChars/tailChars", () => {
    const text = "abc" + EMOJI + "def";
    const fixedTail = tailChars(text, 4);
    const fixedHead = headChars(text, 4);
    expect(fixedTail.isWellFormed()).toBe(true);
    expect(fixedHead.isWellFormed()).toBe(true);
    expect(isOrphanSurrogate(fixedTail.charCodeAt(0))).toBe(false);
    expect(isOrphanSurrogate(fixedHead.charCodeAt(fixedHead.length - 1))).toBe(false);
    // Neither result contains a lone half of the emoji pair.
    expect(fixedTail.includes(EMOJI_LOW) && !fixedTail.includes(EMOJI)).toBe(false);
    expect(fixedHead.includes(EMOJI_HIGH) && !fixedHead.includes(EMOJI)).toBe(false);
  });
});

// ─── HAPPY ─────────────────────────────────────────────────────────────────────────

describe("HAPPY — plain ASCII truncation", () => {
  it("tailChars keeps the last N characters", () => {
    expect(tailChars("hello world", 5)).toBe("world");
  });

  it("headChars keeps the first N characters", () => {
    expect(headChars("hello world", 5)).toBe("hello");
  });

  it("tailChars on a multi-line oracle-output-shaped string keeps the most recent lines", () => {
    const output = "line1\nline2\nline3\nline4\nline5";
    expect(tailChars(output, 11)).toBe("line4\nline5");
  });
});

// ─── BOUNDARY ──────────────────────────────────────────────────────────────────────

describe("BOUNDARY — length/budget edges", () => {
  it("input shorter than budget is returned unchanged (both directions)", () => {
    expect(tailChars("hi", 10)).toBe("hi");
    expect(headChars("hi", 10)).toBe("hi");
  });

  it("input exactly equal to budget is returned unchanged (both directions)", () => {
    expect(tailChars("hello", 5)).toBe("hello");
    expect(headChars("hello", 5)).toBe("hello");
  });

  it("max=0 returns empty string regardless of input", () => {
    expect(tailChars("hello", 0)).toBe("");
    expect(headChars("hello", 0)).toBe("");
  });

  it("max=1 keeps exactly one code unit on plain ASCII", () => {
    expect(tailChars("hello", 1)).toBe("o");
    expect(headChars("hello", 1)).toBe("h");
  });

  it("empty string input returns empty string for any budget", () => {
    expect(tailChars("", 5)).toBe("");
    expect(headChars("", 5)).toBe("");
    expect(tailChars("", 0)).toBe("");
    expect(headChars("", 0)).toBe("");
  });

  it("negative max is treated the same as zero", () => {
    expect(tailChars("hello", -3)).toBe("");
    expect(headChars("hello", -3)).toBe("");
  });

  describe("cut point landing exactly BEFORE a surrogate pair (no split — pair is whole)", () => {
    const text = "ab" + EMOJI; // length 4: 'a','b',HIGH,LOW
    it("tailChars keeps the whole pair intact when the cut lands right before it", () => {
      // start = 4 - 2 = 2 → charCodeAt(2) is HIGH, not LOW → no shift needed
      expect(tailChars(text, 2)).toBe(EMOJI);
    });
    it("headChars keeps the prefix intact when the cut lands right before the pair", () => {
      // end = 2 → charCodeAt(1) is 'b' (not high surrogate) → no shift needed
      expect(headChars(text, 2)).toBe("ab");
    });
  });

  describe("cut point landing exactly INSIDE a surrogate pair (split — must shrink by 1)", () => {
    const text = "abc" + EMOJI + "def"; // length 8, pair at index 3-4
    it("tailChars shrinks the result by one unit rather than orphaning the low surrogate", () => {
      const result = tailChars(text, 4); // naive start=4 lands on the low surrogate
      expect(result).toBe("def");
      expect(result.length).toBe(3);
      expect(result.length).toBeLessThanOrEqual(4);
    });
    it("headChars shrinks the result by one unit rather than orphaning the high surrogate", () => {
      const result = headChars(text, 4); // naive end=4 lands after the high surrogate
      expect(result).toBe("abc");
      expect(result.length).toBe(3);
      expect(result.length).toBeLessThanOrEqual(4);
    });
  });

  describe("cut point landing exactly AFTER a surrogate pair (no split — pair is whole)", () => {
    const text = EMOJI + "cd"; // length 4: HIGH,LOW,'c','d'
    it("tailChars keeps the suffix intact when the cut lands right after the pair", () => {
      // start = 4 - 2 = 2 → charCodeAt(2) is 'c' (not low surrogate) → no shift
      expect(tailChars(text, 2)).toBe("cd");
    });
    it("headChars keeps the whole pair intact when the cut lands right after it", () => {
      // end = 2 → charCodeAt(1) is LOW (not high surrogate) → no shift
      expect(headChars(text, 2)).toBe(EMOJI);
    });
  });
});

// ─── NEGATIVE — BMP-only input unchanged (no unintended behavior shift) ────────────

describe("NEGATIVE — BMP-only input is byte-identical to naive slice()", () => {
  function naiveTail(text: string, max: number): string {
    return text.length > max ? text.slice(text.length - max) : text;
  }
  function naiveHead(text: string, max: number): string {
    return text.length > max ? text.slice(0, max) : text;
  }

  it("ASCII-only text matches naive slice() for a range of budgets", () => {
    const text = "the quick brown fox jumps over the lazy dog";
    for (const max of [0, 1, 5, 10, 20, 44, 45, 100]) {
      expect(tailChars(text, max)).toBe(naiveTail(text, max));
      expect(headChars(text, max)).toBe(naiveHead(text, max));
    }
  });

  it("BMP-only non-Latin text (no surrogate pairs) matches naive slice()", () => {
    // Chinese characters are all within the BMP — single code unit each, no pairs.
    const text = "这是一个测试字符串用于验证截断逻辑是否正确";
    for (const max of [0, 1, 3, 10, 21, 22, 50]) {
      expect(tailChars(text, max)).toBe(naiveTail(text, max));
      expect(headChars(text, max)).toBe(naiveHead(text, max));
    }
  });

  it("a large BMP-only string (perf-relevant shape) matches naive slice() at a realistic 4000-char budget", () => {
    const text = "x".repeat(10_000);
    expect(tailChars(text, 4000)).toBe(naiveTail(text, 4000));
    expect(headChars(text, 4000)).toBe(naiveHead(text, 4000));
  });
});

// ─── REGRESSION — budget contract + idempotency + fixed pins ──────────────────────

describe("REGRESSION — result never exceeds the requested budget", () => {
  it("tailChars result.length <= max holds across every surrogate-adjacent cut point", () => {
    const text = "abc" + EMOJI + "def";
    for (let max = 0; max <= text.length + 1; max++) {
      const result = tailChars(text, max);
      expect(result.length).toBeLessThanOrEqual(max);
    }
  });

  it("headChars result.length <= max holds across every surrogate-adjacent cut point", () => {
    const text = "abc" + EMOJI + "def";
    for (let max = 0; max <= text.length + 1; max++) {
      const result = headChars(text, max);
      expect(result.length).toBeLessThanOrEqual(max);
    }
  });

  it("a string of MANY consecutive emoji never yields an orphan surrogate at any cut point", () => {
    // `String.prototype.isWellFormed()` (ES2024) is the authoritative check: a string
    // is well-formed iff every surrogate code unit is correctly paired. Checking only
    // the boundary code units against the raw 0xD800-0xDFFF range would be WRONG here
    // — a slice that legitimately starts or ends with a COMPLETE pair also has code
    // units in that range; isWellFormed() distinguishes "is a surrogate" from "is an
    // unpaired surrogate".
    const text = EMOJI.repeat(50); // 100 code units, 50 astral code points
    for (let max = 0; max <= text.length + 1; max++) {
      expect(tailChars(text, max).isWellFormed()).toBe(true);
      expect(headChars(text, max).isWellFormed()).toBe(true);
    }
  });
});

describe("REGRESSION — idempotency on already-short input", () => {
  it("re-truncating an already-within-budget result is a no-op", () => {
    const text = "short";
    const once = tailChars(text, 100);
    const twice = tailChars(once, 100);
    expect(twice).toBe(once);
  });
});

describe("REGRESSION — fixed known-value pins (spec-first, not implementation-derived)", () => {
  it("evidence.ts real-world shape: 4000-char output_tail budget on ASCII CLI output", () => {
    const output = "PASS ".repeat(1000); // 5000 chars
    const result = tailChars(output, 4000);
    expect(result.length).toBe(4000);
    expect(result).toBe(output.slice(1000));
  });

  it("handoff.ts real-world shape: 2000-char failing-tail budget", () => {
    const output = "ERROR: something failed\n".repeat(200); // 5000 chars
    const result = tailChars(output, 2000);
    expect(result.length).toBe(2000);
  });
});
