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
import { parentLegal, specKindValid, hasSkeleton } from "../../../src/service/gate-predicates.js";

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

  // STATE dimension: N/A. All three predicates are pure functions of their arguments —
  // no persisted state, no store, no lifecycle transition to exercise. Exempt per
  // ~/.claude/skills/test/ (pure-function modules carry no STATE dimension).
});
