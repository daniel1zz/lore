/**
 * Tests for lib/parent-suggestions.ts — filterParentSuggestions /
 * formatParentSuggestionLabel (dogfood 2026-07-26 ISSUE-004).
 *
 * Test plan:
 *   HAPPY:
 *     - filters to valid-parent-type candidates only (task -> plan)
 *     - matches on title substring, case-insensitive
 *     - matches on slug substring, case-insensitive
 *     - formatParentSuggestionLabel renders "title — slug (type)"
 *   NEGATIVE:
 *     - a valid-parent-type doc whose title/slug doesn't match the query is excluded
 *     - a title/slug match of the WRONG parent type is excluded (task can't parent under adr)
 *   BOUNDARY:
 *     - empty query matches every valid-parent-type candidate (starter list)
 *     - whitespace-only query behaves like empty (trimmed)
 *     - results capped at PARENT_SUGGESTION_LIMIT even with more matches available
 *   STATE:
 *     - (n/a — pure function, no state)
 *   REGRESSION:
 *     - empty docs array returns [] (never throws)
 *     - PARENT_TYPE_CONTRACT for "prd" (no valid parents) always yields []
 */

import { describe, it, expect } from "vitest";
import {
  filterParentSuggestions,
  formatParentSuggestionLabel,
  PARENT_SUGGESTION_LIMIT,
} from "../../../src/lib/parent-suggestions";
import type { DocSummary, DocType } from "@lore/core";

function makeDoc(overrides: Partial<DocSummary> & Pick<DocSummary, "id" | "slug" | "type" | "title">): DocSummary {
  return {
    status: "approved",
    updated_at: "2026-07-26T00:00:00.000Z",
    tags: [],
    priority: "medium",
    ...overrides,
  };
}

describe("parent-suggestions", () => {
  const plan1 = makeDoc({ id: "01PLAN1", slug: "plan-auth-rollout", type: "plan", title: "Auth rollout plan" });
  const plan2 = makeDoc({ id: "01PLAN2", slug: "plan-billing", type: "plan", title: "Billing plan" });
  const spec1 = makeDoc({ id: "01SPEC1", slug: "spec-auth", type: "spec", title: "Auth spec" });
  const adr1 = makeDoc({ id: "01ADR1", slug: "adr-auth-decision", type: "adr", title: "Auth decision" });

  describe("happy path", () => {
    it("filters to valid-parent-type candidates only (task's only valid parent is plan)", () => {
      const result = filterParentSuggestions([plan1, spec1, adr1], "task", "");
      expect(result).toEqual([plan1]);
    });

    it("matches on title substring, case-insensitive", () => {
      const result = filterParentSuggestions([plan1, plan2], "task", "AUTH");
      expect(result).toEqual([plan1]);
    });

    it("matches on slug substring, case-insensitive", () => {
      const result = filterParentSuggestions([plan1, plan2], "task", "BILLING");
      expect(result).toEqual([plan2]);
    });

    it("formats a suggestion label as 'title — slug (type)'", () => {
      expect(formatParentSuggestionLabel(plan1)).toBe("Auth rollout plan — plan-auth-rollout (plan)");
    });
  });

  describe("negative", () => {
    it("excludes a valid-parent-type doc whose title/slug doesn't match the query", () => {
      const result = filterParentSuggestions([plan1, plan2], "task", "zzz-no-match");
      expect(result).toEqual([]);
    });

    it("excludes a title/slug match of the wrong parent type (adr can't parent a task)", () => {
      // "auth" matches adr1's title, but adr is not a valid parent for "task".
      const result = filterParentSuggestions([adr1], "task", "auth");
      expect(result).toEqual([]);
    });
  });

  describe("boundary", () => {
    it("an empty query matches every valid-parent-type candidate (starter list)", () => {
      const result = filterParentSuggestions([plan1, plan2, spec1], "task", "");
      expect(result).toEqual([plan1, plan2]);
    });

    it("a whitespace-only query behaves like an empty query (trimmed)", () => {
      const result = filterParentSuggestions([plan1, plan2], "task", "   ");
      expect(result).toEqual([plan1, plan2]);
    });

    it("caps results at PARENT_SUGGESTION_LIMIT even with more matches available", () => {
      const manyPlans = Array.from({ length: PARENT_SUGGESTION_LIMIT + 5 }, (_, i) =>
        makeDoc({ id: `01PLAN${i}`, slug: `plan-x-${i}`, type: "plan", title: `Plan ${i}` }),
      );
      const result = filterParentSuggestions(manyPlans, "task", "");
      expect(result).toHaveLength(PARENT_SUGGESTION_LIMIT);
      expect(result).toEqual(manyPlans.slice(0, PARENT_SUGGESTION_LIMIT));
    });
  });

  describe("regression", () => {
    it("an empty docs array returns [] without throwing", () => {
      expect(filterParentSuggestions([], "task", "anything")).toEqual([]);
    });

    it("'prd' has no valid parents — every candidate is excluded regardless of query", () => {
      const result = filterParentSuggestions([plan1, spec1, adr1], "prd" as DocType, "");
      expect(result).toEqual([]);
    });
  });
});
