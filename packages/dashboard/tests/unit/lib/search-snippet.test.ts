/**
 * Tests for lib/search-snippet.ts — splitSnippetIntoSegments (SPEC-037 §1 D5, AC-37-8).
 *
 * Test plan:
 *   HAPPY:
 *     - a single matched span splits into [before, matched, after]
 *     - a snippet with two separate matched spans splits into 5 segments
 *
 *   NEGATIVE:
 *     - a snippet with no sentinels returns a single non-matched segment
 *
 *   BOUNDARY:
 *     - empty string returns an empty array
 *     - a matched span at the very start/end of the snippet (no leading/trailing text)
 *
 *   ERROR:
 *     - an unterminated open marker treats the remainder as matched (no crash, no data loss)
 *
 *   STATE:
 *     - (n/a — pure function, no state)
 *
 *   REGRESSION:
 *     - literal `[`/`]` characters pass through as plain (non-matched) text —
 *       the exact collision the sentinel switch fixes (AC-37-8)
 */

import { describe, it, expect } from "vitest";
import { splitSnippetIntoSegments } from "../../../src/lib/search-snippet";
import { SNIPPET_MARK_OPEN, SNIPPET_MARK_CLOSE } from "@lore/core";

describe("splitSnippetIntoSegments", () => {
  describe("happy path", () => {
    it("splits a single matched span into [before, matched, after]", () => {
      const snippet = `a ${SNIPPET_MARK_OPEN}bc${SNIPPET_MARK_CLOSE} d`;
      expect(splitSnippetIntoSegments(snippet)).toEqual([
        { text: "a ", matched: false },
        { text: "bc", matched: true },
        { text: " d", matched: false },
      ]);
    });

    it("splits two separate matched spans into five segments", () => {
      const snippet = `x ${SNIPPET_MARK_OPEN}one${SNIPPET_MARK_CLOSE} mid ${SNIPPET_MARK_OPEN}two${SNIPPET_MARK_CLOSE} y`;
      expect(splitSnippetIntoSegments(snippet)).toEqual([
        { text: "x ", matched: false },
        { text: "one", matched: true },
        { text: " mid ", matched: false },
        { text: "two", matched: true },
        { text: " y", matched: false },
      ]);
    });
  });

  describe("negative", () => {
    it("returns a single non-matched segment when there are no sentinels", () => {
      expect(splitSnippetIntoSegments("plain text, no markers")).toEqual([
        { text: "plain text, no markers", matched: false },
      ]);
    });
  });

  describe("boundary", () => {
    it("returns an empty array for an empty string", () => {
      expect(splitSnippetIntoSegments("")).toEqual([]);
    });

    it("handles a matched span with no leading or trailing text", () => {
      const snippet = `${SNIPPET_MARK_OPEN}whole${SNIPPET_MARK_CLOSE}`;
      expect(splitSnippetIntoSegments(snippet)).toEqual([{ text: "whole", matched: true }]);
    });
  });

  describe("error", () => {
    it("treats an unterminated open marker's remainder as matched, without crashing", () => {
      const snippet = `before ${SNIPPET_MARK_OPEN}unterminated`;
      expect(() => splitSnippetIntoSegments(snippet)).not.toThrow();
      expect(splitSnippetIntoSegments(snippet)).toEqual([
        { text: "before ", matched: false },
        { text: "unterminated", matched: true },
      ]);
    });
  });

  describe("regression", () => {
    it("renders literal [ and ] brackets as plain, non-matched text (AC-37-8)", () => {
      expect(splitSnippetIntoSegments("see the [bracketed] term here")).toEqual([
        { text: "see the [bracketed] term here", matched: false },
      ]);
    });
  });
});
