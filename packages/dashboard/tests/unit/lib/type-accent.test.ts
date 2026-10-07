// @vitest-environment jsdom
/**
 * Tests for lib/type-accent.ts — TYPE_ACCENT map (SPEC-036 §1 D3, AC-36-9).
 *
 * Test plan:
 *   HAPPY:
 *     - Every DocType has a TYPE_ACCENT entry
 *     - Each entry includes a light-mode border-l-<hue>-<shade> class
 *     - Each entry includes a dark-mode variant class
 *
 *   NEGATIVE:
 *     - (n/a — TYPE_ACCENT is a fully-populated Record<DocType, string>, no partial/undefined case)
 *
 *   BOUNDARY:
 *     - Exactly 6 doc types are covered, no more, no fewer
 *
 *   STATE:
 *     - (n/a — pure constant, no state)
 *
 *   REGRESSION:
 *     - Every type maps to a DISTINCT accent class (no two types share a hue —
 *       collapsing two types onto one hue silently defeats the type-differentiation goal)
 */

import { describe, it, expect } from "vitest";
import { TYPE_ACCENT, TYPE_ACCENT_BORDER_CLASS } from "../../../src/lib/type-accent";
import type { DocType } from "@lore/core";

const ALL_TYPES: DocType[] = ["prd", "spec", "adr", "plan", "knowledge", "task", "phase", "baseline"];

describe("TYPE_ACCENT", () => {
  describe("happy path", () => {
    it("has an entry for every DocType", () => {
      for (const type of ALL_TYPES) {
        expect(TYPE_ACCENT[type]).toBeDefined();
        expect(typeof TYPE_ACCENT[type]).toBe("string");
      }
    });

    it("each entry includes a light-mode border-l-<hue>-<shade> class", () => {
      for (const type of ALL_TYPES) {
        expect(TYPE_ACCENT[type]).toMatch(/(?:^|\s)border-l-[a-z]+-\d{3}(?:\s|$)/);
      }
    });

    it("each entry includes a dark-mode variant class", () => {
      for (const type of ALL_TYPES) {
        expect(TYPE_ACCENT[type]).toMatch(/dark:border-l-[a-z]+-\d{3}/);
      }
    });

    it("TYPE_ACCENT_BORDER_CLASS is a border-l width utility", () => {
      expect(TYPE_ACCENT_BORDER_CLASS).toBe("border-l-4");
    });
  });

  describe("boundary", () => {
    it("covers exactly the 8 doc types, no more, no fewer (SPEC-056 T4 added 'phase'; baseline added by spec-baseline-slice-1)", () => {
      expect(Object.keys(TYPE_ACCENT).sort()).toEqual([...ALL_TYPES].sort());
    });
  });

  describe("regression", () => {
    it("every type maps to a distinct accent hue", () => {
      const hues = ALL_TYPES.map((type) => TYPE_ACCENT[type]);
      expect(new Set(hues).size).toBe(ALL_TYPES.length);
    });
  });
});
