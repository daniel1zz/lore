/**
 * Unit tests for the deterministic gate predicates that back `lore gate spec-create`
 * (a separate, not-yet-implemented CLI task). Pure functions only — no store, no IO,
 * no bun:sqlite — hence vitest, not `.bun.test`.
 *
 * Test philosophy: every test encodes a requirement from the IoC vertical-slice
 * tech-spec §4.1/§11, not what the code happens to do.
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / ERROR / REGRESSION.
 * STATE is intentionally absent — these are pure functions with no persisted or
 * mutable state to transition (see "STATE dimension" note at the bottom of this file).
 *
 * @spec_ref TECH-SPEC "Corpus-governed spec-production loop — IoC vertical slice" §4.1 §11
 */

import { describe, it, expect } from "vitest";
import { SPEC_KINDS } from "@lore/core";
import {
  parentLegal,
  specKindValid,
  hasSkeleton,
  upstreamApproved,
  upstreamHasAcceptanceCriteria,
} from "../../../src/service/gate-predicates.js";

describe("gate-predicates", () => {
  describe("parentLegal", () => {
    // HAPPY
    it("passes when parent.type is the legal parent type for spec (prd)", () => {
      expect(parentLegal({ type: "prd" })).toEqual({ ok: true });
    });

    // NEGATIVE
    it("fails with PARENT_REQUIRED when parent is null", () => {
      expect(parentLegal(null)).toEqual({ ok: false, reason: "PARENT_REQUIRED" });
    });

    // BOUNDARY
    it("fails with PARENT_REQUIRED when parent is undefined", () => {
      expect(parentLegal(undefined)).toEqual({ ok: false, reason: "PARENT_REQUIRED" });
    });

    // ERROR
    it("fails with INVALID_PARENT_TYPE when parent.type is not a legal parent type for spec", () => {
      expect(parentLegal({ type: "task" })).toEqual({
        ok: false,
        reason: "INVALID_PARENT_TYPE",
      });
    });

    it("fails with INVALID_PARENT_TYPE for another illegal parent type (plan)", () => {
      expect(parentLegal({ type: "plan" })).toEqual({
        ok: false,
        reason: "INVALID_PARENT_TYPE",
      });
    });
  });

  describe("specKindValid", () => {
    // HAPPY
    it("passes for kind='tech'", () => {
      expect(specKindValid("tech")).toEqual({ ok: true });
    });

    // BOUNDARY — the key edge: undefined means "will default to feature at create time",
    // and MUST pass, not block.
    it("passes for kind=undefined (defaults to feature at create time, must not block)", () => {
      expect(specKindValid(undefined)).toEqual({ ok: true });
    });

    // NEGATIVE
    it("fails with INVALID_SPEC_KIND for an unrecognized kind string", () => {
      expect(specKindValid("x")).toEqual({ ok: false, reason: "INVALID_SPEC_KIND" });
    });

    // REGRESSION — every SSOT-declared kind passes, sourced from @lore/core, not hardcoded
    it("passes for every kind declared in the SPEC_KINDS SSOT", () => {
      for (const kind of SPEC_KINDS) {
        expect(specKindValid(kind)).toEqual({ ok: true });
      }
    });
  });

  describe("hasSkeleton", () => {
    // HAPPY
    it("passes when content contains a level-2 markdown heading", () => {
      expect(hasSkeleton("## Overview\nx")).toEqual({ ok: true });
    });

    // NEGATIVE
    it("fails with MISSING_SKELETON when content has no heading at all", () => {
      expect(hasSkeleton("no heading here")).toEqual({
        ok: false,
        reason: "MISSING_SKELETON",
      });
    });

    // BOUNDARY
    it("fails with MISSING_SKELETON for empty content", () => {
      expect(hasSkeleton("")).toEqual({ ok: false, reason: "MISSING_SKELETON" });
    });

    it("fails with MISSING_SKELETON when only a level-1 heading is present (not '## ')", () => {
      expect(hasSkeleton("# Title\nx")).toEqual({ ok: false, reason: "MISSING_SKELETON" });
    });

    it("passes when the '## ' heading is not on the first line", () => {
      expect(hasSkeleton("intro text\n## Overview\nx")).toEqual({ ok: true });
    });
  });

  describe("upstreamApproved", () => {
    // HAPPY
    it("passes when upstream.type matches expectedType and status is 'approved'", () => {
      expect(upstreamApproved({ type: "spec", status: "approved" }, "spec")).toEqual({
        ok: true,
      });
    });

    // NEGATIVE — draft and in-review both fail, same reason
    it("fails with UPSTREAM_NOT_APPROVED when status is 'draft'", () => {
      expect(upstreamApproved({ type: "spec", status: "draft" }, "spec")).toEqual({
        ok: false,
        reason: "UPSTREAM_NOT_APPROVED",
      });
    });

    it("fails with UPSTREAM_NOT_APPROVED when status is 'in-review'", () => {
      expect(upstreamApproved({ type: "spec", status: "in-review" }, "spec")).toEqual({
        ok: false,
        reason: "UPSTREAM_NOT_APPROVED",
      });
    });

    // BOUNDARY — the key decision this task made: "active" is a status further along
    // the lifecycle than "approved" but does NOT clear this gate, to stay identical to
    // evaluateReadiness's upstream_unapproved advisory (parentSpecStatus !== "approved").
    it("fails with UPSTREAM_NOT_APPROVED when status is 'active' (deliberately NOT accepted — matches evaluateReadiness)", () => {
      expect(upstreamApproved({ type: "spec", status: "active" }, "spec")).toEqual({
        ok: false,
        reason: "UPSTREAM_NOT_APPROVED",
      });
    });

    // ERROR — wrong type
    it("fails with UPSTREAM_WRONG_TYPE when upstream.type does not match expectedType", () => {
      expect(upstreamApproved({ type: "prd", status: "approved" }, "spec")).toEqual({
        ok: false,
        reason: "UPSTREAM_WRONG_TYPE",
      });
    });

    // BOUNDARY/ERROR — missing upstream
    it("fails with UPSTREAM_MISSING when upstream is null", () => {
      expect(upstreamApproved(null, "spec")).toEqual({ ok: false, reason: "UPSTREAM_MISSING" });
    });

    it("fails with UPSTREAM_MISSING when upstream is undefined", () => {
      expect(upstreamApproved(undefined, "spec")).toEqual({
        ok: false,
        reason: "UPSTREAM_MISSING",
      });
    });

    // STATE — same upstream doc transitioning draft -> approved flips the verdict,
    // exercising the predicate as a state-transition oracle even though the function
    // itself is pure (no mutation, just re-invoked with the "next" state).
    it("flips from NOT_APPROVED to ok as the same upstream's status transitions draft -> approved", () => {
      const draftUpstream = { type: "spec", status: "draft" };
      const approvedUpstream = { type: "spec", status: "approved" };
      expect(upstreamApproved(draftUpstream, "spec")).toEqual({
        ok: false,
        reason: "UPSTREAM_NOT_APPROVED",
      });
      expect(upstreamApproved(approvedUpstream, "spec")).toEqual({ ok: true });
    });
  });

  describe("upstreamHasAcceptanceCriteria", () => {
    // HAPPY
    it("passes when extra.acceptance_criteria has >= 1 valid entry", () => {
      expect(
        upstreamHasAcceptanceCriteria({
          extra: {
            acceptance_criteria: [
              {
                id: "AC-GATE-1",
                statement: "upstream spec has at least one declared AC",
                verify: { mode: "human" },
              },
            ],
          },
        }),
      ).toEqual({ ok: true });
    });

    // NEGATIVE — declared but empty array
    it("fails with UPSTREAM_NO_AC when extra.acceptance_criteria is an empty array", () => {
      expect(upstreamHasAcceptanceCriteria({ extra: { acceptance_criteria: [] } })).toEqual({
        ok: false,
        reason: "UPSTREAM_NO_AC",
      });
    });

    // BOUNDARY — field entirely absent from extra
    it("fails with UPSTREAM_NO_AC when extra.acceptance_criteria is absent", () => {
      expect(upstreamHasAcceptanceCriteria({ extra: {} })).toEqual({
        ok: false,
        reason: "UPSTREAM_NO_AC",
      });
    });

    // ERROR — malformed shape fails schema validation, must not throw
    it("fails with UPSTREAM_NO_AC when extra.acceptance_criteria fails schema validation (not an array)", () => {
      expect(
        upstreamHasAcceptanceCriteria({ extra: { acceptance_criteria: "not-an-array" } }),
      ).toEqual({ ok: false, reason: "UPSTREAM_NO_AC" });
    });

    // BOUNDARY/ERROR — missing upstream spec entirely (no doc resolved at all)
    it("fails with UPSTREAM_NO_AC when upstreamSpec is null", () => {
      expect(upstreamHasAcceptanceCriteria(null)).toEqual({
        ok: false,
        reason: "UPSTREAM_NO_AC",
      });
    });

    it("fails with UPSTREAM_NO_AC when upstreamSpec is undefined", () => {
      expect(upstreamHasAcceptanceCriteria(undefined)).toEqual({
        ok: false,
        reason: "UPSTREAM_NO_AC",
      });
    });

    // STATE — same spec transitioning from 0 AC to 1 declared AC flips the verdict
    it("flips from UPSTREAM_NO_AC to ok as the same spec's declared AC count goes 0 -> 1", () => {
      const specWithNoAc = { extra: { acceptance_criteria: [] } };
      const specWithOneAc = {
        extra: {
          acceptance_criteria: [
            { id: "AC-GATE-2", statement: "x", verify: { mode: "human" } },
          ],
        },
      };
      expect(upstreamHasAcceptanceCriteria(specWithNoAc)).toEqual({
        ok: false,
        reason: "UPSTREAM_NO_AC",
      });
      expect(upstreamHasAcceptanceCriteria(specWithOneAc)).toEqual({ ok: true });
    });

    // REGRESSION — stays SSOT with AcService's extractCriteria: a spec whose
    // acceptance_criteria entries are individually well-formed per
    // acceptanceCriterionSchema (script mode) is recognized identically to human mode.
    it("passes for a script-mode AC entry, matching AcService's own AC counting", () => {
      expect(
        upstreamHasAcceptanceCriteria({
          extra: {
            acceptance_criteria: [
              {
                id: "AC-GATE-3",
                statement: "script mode AC",
                verify: { mode: "script", oracle: "test", command: "bunx vitest run x" },
              },
            ],
          },
        }),
      ).toEqual({ ok: true });
    });
  });

  // STATE dimension (parentLegal / specKindValid / hasSkeleton): N/A. Those three
  // predicates are pure functions of their arguments with no persisted or mutable
  // state to transition. Exempt per ~/.claude/skills/test/ (pure-function modules
  // carry no STATE dimension). upstreamApproved / upstreamHasAcceptanceCriteria DO
  // get STATE-dimension coverage above (same upstream doc re-checked across a
  // status/AC-count transition), since they gate a corpus doc's own lifecycle.
});
