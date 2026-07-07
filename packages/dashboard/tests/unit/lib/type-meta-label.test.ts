// @vitest-environment jsdom
/**
 * Tests for lib/type-meta-label.ts — formatTypeMetaLabel / isNotablePriority
 * (SPEC-036 §1 D3, AC-36-8, AC-36-9).
 *
 * The task-variant test matrix enumerates the CLI badge rule table
 * (`formatWorkflowBadge`, packages/lore/src/adapters/cli/utils.ts): unclaimed,
 * claimed fresh, claimed stale, with/without evidence — AC-36-8 parity.
 *
 * Test plan:
 *   HAPPY:
 *     - spec/adr/knowledge/plan each render their expected label
 *     - task: claimed (fresh) + evidence renders "claimed:X ✔p/✘f"
 *     - task: claimed + stale renders the "(stale)" suffix
 *
 *   NEGATIVE:
 *     - task: unclaimed with no evidence returns null (nothing to show)
 *     - isNotablePriority returns false for medium/low
 *
 *   BOUNDARY:
 *     - plan: phase_count === 1 uses singular "phase" (not "phases")
 *     - plan: phase_count === 0 renders "0 phases"
 *     - task: claimed with zero evidence renders claim only, no evidence part
 *     - task: unclaimed but with evidence renders evidence only, no claim part
 *
 *   STATE:
 *     - (n/a — pure function, no state)
 *
 *   REGRESSION:
 *     - task: claim_stale explicitly false does NOT render "(stale)"
 *     - isNotablePriority returns true for critical AND high
 */

import { describe, it, expect } from "vitest";
import { formatTypeMetaLabel, isNotablePriority } from "../../../src/lib/type-meta-label";
import type { DocTypeMeta } from "@lore/core";

describe("formatTypeMetaLabel", () => {
  describe("happy path", () => {
    it("spec renders its kind", () => {
      const meta: DocTypeMeta = { t: "spec", kind: "tech" };
      expect(formatTypeMetaLabel(meta)).toBe("tech");
    });

    it("adr renders its decision_status", () => {
      const meta: DocTypeMeta = { t: "adr", decision_status: "accepted" };
      expect(formatTypeMetaLabel(meta)).toBe("accepted");
    });

    it("knowledge renders its sub_type", () => {
      const meta: DocTypeMeta = { t: "knowledge", sub_type: "retro" };
      expect(formatTypeMetaLabel(meta)).toBe("retro");
    });

    it("plan renders its phase_count as plural", () => {
      const meta: DocTypeMeta = { t: "plan", phase_count: 3 };
      expect(formatTypeMetaLabel(meta)).toBe("3 phases");
    });

    it("task: claimed (fresh) with evidence renders claim + pass/fail counts", () => {
      const meta: DocTypeMeta = {
        t: "task",
        claimed_by: "alice",
        claim_stale: false,
        evidence_pass: 2,
        evidence_fail: 1,
      };
      expect(formatTypeMetaLabel(meta)).toBe("claimed:alice ✔2/✘1");
    });

    it("task: claimed and stale renders the (stale) suffix", () => {
      const meta: DocTypeMeta = {
        t: "task",
        claimed_by: "bob",
        claim_stale: true,
        evidence_pass: 0,
        evidence_fail: 1,
      };
      expect(formatTypeMetaLabel(meta)).toBe("claimed:bob (stale) ✔0/✘1");
    });
  });

  describe("negative", () => {
    it("task: unclaimed with no evidence returns null", () => {
      const meta: DocTypeMeta = { t: "task", evidence_pass: 0, evidence_fail: 0 };
      expect(formatTypeMetaLabel(meta)).toBeNull();
    });
  });

  describe("boundary", () => {
    it("plan: phase_count === 1 uses singular 'phase'", () => {
      const meta: DocTypeMeta = { t: "plan", phase_count: 1 };
      expect(formatTypeMetaLabel(meta)).toBe("1 phase");
    });

    it("plan: phase_count === 0 renders '0 phases'", () => {
      const meta: DocTypeMeta = { t: "plan", phase_count: 0 };
      expect(formatTypeMetaLabel(meta)).toBe("0 phases");
    });

    it("task: claimed with zero evidence renders claim only, no evidence part", () => {
      const meta: DocTypeMeta = { t: "task", claimed_by: "alice", evidence_pass: 0, evidence_fail: 0 };
      expect(formatTypeMetaLabel(meta)).toBe("claimed:alice");
    });

    it("task: unclaimed but with evidence renders evidence only, no claim part", () => {
      const meta: DocTypeMeta = { t: "task", evidence_pass: 3, evidence_fail: 0 };
      expect(formatTypeMetaLabel(meta)).toBe("✔3/✘0");
    });
  });

  describe("regression", () => {
    it("task: claim_stale explicitly false does not render '(stale)'", () => {
      const meta: DocTypeMeta = {
        t: "task",
        claimed_by: "alice",
        claim_stale: false,
        evidence_pass: 0,
        evidence_fail: 0,
      };
      expect(formatTypeMetaLabel(meta)).toBe("claimed:alice");
      expect(formatTypeMetaLabel(meta)).not.toContain("stale");
    });
  });
});

describe("isNotablePriority", () => {
  describe("happy path", () => {
    it("returns true for critical", () => {
      expect(isNotablePriority("critical")).toBe(true);
    });

    it("returns true for high", () => {
      expect(isNotablePriority("high")).toBe(true);
    });
  });

  describe("negative", () => {
    it("returns false for medium", () => {
      expect(isNotablePriority("medium")).toBe(false);
    });

    it("returns false for low", () => {
      expect(isNotablePriority("low")).toBe(false);
    });
  });
});
