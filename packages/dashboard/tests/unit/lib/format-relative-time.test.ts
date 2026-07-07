/**
 * Tests for lib/format-relative-time.ts — formatRelativeTime.
 * Extracted from DocCard.tsx (SPEC-037 §1 D3) — this test file pins the exact
 * same thresholds DocCard's inline version previously had (untested directly,
 * only indirectly via a loose regex in DocCard.test.tsx).
 *
 * Test plan:
 *   HAPPY:
 *     - a timestamp 5 days ago renders "5 days ago"
 *     - a timestamp ~2 months ago renders "N months ago"
 *
 *   BOUNDARY:
 *     - exactly now (0ms elapsed) renders "today"
 *     - exactly 1 day ago renders "yesterday" (not "1 days ago")
 *     - exactly 1 year ago renders "1 years ago" (12 months threshold)
 *
 *   REGRESSION:
 *     - a far-future timestamp (negative elapsed) does not throw
 */

import { describe, it, expect } from "vitest";
import { formatRelativeTime } from "../../../src/lib/format-relative-time";

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

describe("formatRelativeTime", () => {
  describe("happy path", () => {
    it("renders '5 days ago' for a 5-day-old timestamp", () => {
      expect(formatRelativeTime(daysAgo(5))).toBe("5 days ago");
    });

    it("renders 'N months ago' for a ~2-month-old timestamp", () => {
      expect(formatRelativeTime(daysAgo(65))).toBe("2 months ago");
    });
  });

  describe("boundary", () => {
    it("renders 'today' for the current instant", () => {
      expect(formatRelativeTime(new Date().toISOString())).toBe("today");
    });

    it("renders 'yesterday' for exactly 1 day ago", () => {
      expect(formatRelativeTime(daysAgo(1))).toBe("yesterday");
    });

    it("renders '1 years ago' for a 366-day-old timestamp", () => {
      expect(formatRelativeTime(daysAgo(366))).toBe("1 years ago");
    });
  });

  describe("regression", () => {
    it("does not throw for a future timestamp", () => {
      const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 3).toISOString();
      expect(() => formatRelativeTime(future)).not.toThrow();
    });
  });
});
