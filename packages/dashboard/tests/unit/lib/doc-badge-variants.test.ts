/**
 * Tests for lib/doc-badge-variants.ts — getTypeBadgeVariant / getStatusBadgeVariant.
 * Extracted from DocCard.tsx (SPEC-037 §1 D5) so SearchResultCard reuses the
 * exact same variant table instead of a second, driftable copy.
 *
 * Test plan:
 *   HAPPY:
 *     - prd/spec type → "default"; adr/plan type → "secondary"
 *     - active/approved status → "default"; draft/in-review status → "secondary"
 *
 *   BOUNDARY:
 *     - archived/deprecated status → "outline"
 *
 *   REGRESSION:
 *     - an unrecognized type/status string falls back to "outline" (never throws)
 */

import { describe, it, expect } from "vitest";
import { getTypeBadgeVariant, getStatusBadgeVariant } from "../../../src/lib/doc-badge-variants";

describe("getTypeBadgeVariant", () => {
  describe("happy path", () => {
    it("returns 'default' for prd and spec", () => {
      expect(getTypeBadgeVariant("prd")).toBe("default");
      expect(getTypeBadgeVariant("spec")).toBe("default");
    });

    it("returns 'secondary' for adr and plan", () => {
      expect(getTypeBadgeVariant("adr")).toBe("secondary");
      expect(getTypeBadgeVariant("plan")).toBe("secondary");
    });
  });

  describe("regression", () => {
    it("returns 'outline' for an unrecognized type", () => {
      expect(getTypeBadgeVariant("not-a-real-type")).toBe("outline");
    });
  });
});

describe("getStatusBadgeVariant", () => {
  describe("happy path", () => {
    it("returns 'default' for active and approved", () => {
      expect(getStatusBadgeVariant("active")).toBe("default");
      expect(getStatusBadgeVariant("approved")).toBe("default");
    });

    it("returns 'secondary' for draft and in-review", () => {
      expect(getStatusBadgeVariant("draft")).toBe("secondary");
      expect(getStatusBadgeVariant("in-review")).toBe("secondary");
    });
  });

  describe("boundary", () => {
    it("returns 'outline' for archived and deprecated", () => {
      expect(getStatusBadgeVariant("archived")).toBe("outline");
      expect(getStatusBadgeVariant("deprecated")).toBe("outline");
    });
  });

  describe("regression", () => {
    it("returns 'outline' for an unrecognized status", () => {
      expect(getStatusBadgeVariant("not-a-real-status")).toBe("outline");
    });
  });
});
