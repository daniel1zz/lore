// @vitest-environment jsdom
/**
 * Tests for lib/library-search.ts — librarySearchSchema + tagsFromParam/tagsToParam
 * (SPEC-036 §1 D2, AC-36-5, AC-36-6).
 *
 * Test plan:
 *   HAPPY:
 *     - librarySearchSchema parses a full {type, status, tags} object
 *     - librarySearchSchema parses an empty object (all fields optional)
 *     - tagsFromParam splits a comma-joined string into a trimmed array
 *     - tagsToParam joins a tag array back into a comma-joined string
 *
 *   NEGATIVE:
 *     - librarySearchSchema rejects an invalid type value
 *     - librarySearchSchema rejects an invalid status value
 *
 *   BOUNDARY:
 *     - tagsFromParam(undefined) returns []
 *     - tagsToParam([]) returns undefined
 *     - tagsFromParam drops empty/whitespace-only entries
 *
 *   ERROR:
 *     - (n/a — pure sync functions, no IO)
 *
 *   STATE:
 *     - (n/a — pure functions, no state)
 *
 *   REGRESSION:
 *     - tagsFromParam/tagsToParam round-trip a tag list unchanged (order-preserving)
 */

import { describe, it, expect } from "vitest";
import { librarySearchSchema, tagsFromParam, tagsToParam } from "../../../src/lib/library-search";

describe("librarySearchSchema", () => {
  describe("happy path", () => {
    it("parses a full {type, status, tags} object", () => {
      const result = librarySearchSchema.parse({ type: "spec", status: "draft", tags: "a,b" });
      expect(result).toEqual({ type: "spec", status: "draft", tags: "a,b" });
    });

    it("parses an empty object (all fields optional)", () => {
      const result = librarySearchSchema.parse({});
      expect(result).toEqual({});
    });
  });

  describe("negative", () => {
    it("rejects an invalid type value", () => {
      expect(() => librarySearchSchema.parse({ type: "not-a-real-type" })).toThrow();
    });

    it("rejects an invalid status value", () => {
      expect(() => librarySearchSchema.parse({ status: "not-a-real-status" })).toThrow();
    });
  });
});

describe("tagsFromParam", () => {
  describe("happy path", () => {
    it("splits a comma-joined string into a trimmed array", () => {
      expect(tagsFromParam("a,b,c")).toEqual(["a", "b", "c"]);
    });
  });

  describe("boundary", () => {
    it("returns [] when the param is undefined", () => {
      expect(tagsFromParam(undefined)).toEqual([]);
    });

    it("drops empty/whitespace-only entries and trims surrounding whitespace", () => {
      expect(tagsFromParam("a, b,,  ,c")).toEqual(["a", "b", "c"]);
    });

    it("returns [] for a blank string", () => {
      expect(tagsFromParam("")).toEqual([]);
    });
  });
});

describe("tagsToParam", () => {
  describe("happy path", () => {
    it("joins a tag array into a comma-joined string", () => {
      expect(tagsToParam(["a", "b"])).toBe("a,b");
    });
  });

  describe("boundary", () => {
    it("returns undefined for an empty array", () => {
      expect(tagsToParam([])).toBeUndefined();
    });

    it("returns undefined when all entries are blank", () => {
      expect(tagsToParam(["  ", ""])).toBeUndefined();
    });
  });

  describe("regression", () => {
    it("round-trips a tag list unchanged through toParam -> fromParam", () => {
      const original = ["core", "v2", "urgent"];
      const param = tagsToParam(original);
      expect(tagsFromParam(param)).toEqual(original);
    });
  });
});
