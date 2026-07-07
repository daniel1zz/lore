// @vitest-environment jsdom
/**
 * Tests for lib/tag-vocabulary.ts — computeTagVocabulary (SPEC-036 §1 D2, AC-36-6).
 *
 * Test plan:
 *   HAPPY:
 *     - Aggregates distinct tags with correct counts across multiple docs
 *     - Sorts by count descending
 *
 *   NEGATIVE:
 *     - Docs with empty tags arrays contribute nothing
 *
 *   BOUNDARY:
 *     - Empty doc list returns []
 *     - Single doc with a single tag returns one entry with count 1
 *
 *   STATE:
 *     - (n/a — pure function, no state)
 *
 *   REGRESSION:
 *     - Ties in count are broken by tag name ascending (stable, deterministic order)
 */

import { describe, it, expect } from "vitest";
import { computeTagVocabulary } from "../../../src/lib/tag-vocabulary";
import type { DocSummary } from "@lore/core";

function makeDoc(id: string, tags: string[]): DocSummary {
  return {
    id,
    slug: `plan-${id}`,
    title: id,
    type: "plan",
    status: "active",
    updated_at: "2024-01-01T00:00:00Z",
    tags,
    priority: "medium",
  };
}

describe("computeTagVocabulary", () => {
  describe("happy path", () => {
    it("aggregates distinct tags with correct counts", () => {
      const docs = [makeDoc("1", ["a", "b"]), makeDoc("2", ["a"]), makeDoc("3", ["b", "c"])];
      expect(computeTagVocabulary(docs)).toEqual([
        { tag: "a", count: 2 },
        { tag: "b", count: 2 },
        { tag: "c", count: 1 },
      ]);
    });

    it("sorts by count descending", () => {
      const docs = [makeDoc("1", ["rare"]), makeDoc("2", ["common"]), makeDoc("3", ["common"])];
      const result = computeTagVocabulary(docs);
      expect(result[0]).toEqual({ tag: "common", count: 2 });
      expect(result[1]).toEqual({ tag: "rare", count: 1 });
    });
  });

  describe("negative", () => {
    it("docs with empty tags arrays contribute nothing", () => {
      const docs = [makeDoc("1", []), makeDoc("2", [])];
      expect(computeTagVocabulary(docs)).toEqual([]);
    });
  });

  describe("boundary", () => {
    it("returns [] for an empty doc list", () => {
      expect(computeTagVocabulary([])).toEqual([]);
    });

    it("a single doc with a single tag returns one entry with count 1", () => {
      const docs = [makeDoc("1", ["solo"])];
      expect(computeTagVocabulary(docs)).toEqual([{ tag: "solo", count: 1 }]);
    });
  });

  describe("regression", () => {
    it("breaks count ties by tag name ascending", () => {
      const docs = [makeDoc("1", ["zebra"]), makeDoc("2", ["apple"])];
      expect(computeTagVocabulary(docs)).toEqual([
        { tag: "apple", count: 1 },
        { tag: "zebra", count: 1 },
      ]);
    });
  });
});
