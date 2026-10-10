/**
 * Tests for @lore/core requirement.ts (SPEC-055) — requirementSchema, prdRequirementsSchema
 * unique-id refinement, acceptanceCriterionSchema.requirement_refs, computeRequirementCoverage
 * truth table, and requirementCoverageExitCode. Pure, no IO.
 *
 * Six-dimension coverage:
 *   HAPPY:      a well-formed requirement + a full-coverage computation.
 *   NEGATIVE:   out-of-enum priority, malformed id, duplicate ids in the array.
 *   BOUNDARY:   empty requirements array → all-empty coverage (vacuous).
 *   STATE:      an uncovered P0 surfaces in uncovered_p0 and drives exit code 3.
 *   REGRESSION: an AC with no requirement_refs still parses.
 *
 * Source: SPEC-055 §Acceptance Criteria AC-055-1..AC-055-4.
 */

import { describe, it, expect } from "vitest";
import {
  requirementSchema,
  prdRequirementsSchema,
  computeRequirementCoverage,
  requirementCoverageExitCode,
  type Requirement,
} from "../../src/requirement.js";
import { acceptanceCriterionSchema } from "../../src/acceptance.js";

const R1: Requirement = { id: "R-1", statement: "user can log in", priority: "P0" };
const R2: Requirement = { id: "R-2", statement: "user can export", priority: "P1" };

// ─── AC-055-1: requirementSchema ─────────────────────────────────────────────

describe("SPEC-055 AC-055-1 — requirementSchema", () => {
  it("HAPPY: a well-formed R-1 P0 requirement parses", () => {
    expect(requirementSchema.safeParse(R1).success).toBe(true);
    expect(requirementSchema.safeParse({ id: "R-NEG-2", statement: "invalid input rejected", priority: "P0" }).success).toBe(true);
  });

  it("NEGATIVE: an out-of-enum priority is rejected", () => {
    expect(requirementSchema.safeParse({ id: "R-1", statement: "x", priority: "P9" }).success).toBe(false);
  });

  it("NEGATIVE: a malformed id (no R- prefix) is rejected", () => {
    expect(requirementSchema.safeParse({ id: "REQ-1", statement: "x", priority: "P0" }).success).toBe(false);
    expect(requirementSchema.safeParse({ id: "1", statement: "x", priority: "P0" }).success).toBe(false);
  });
});

// ─── AC-055-2: prdRequirementsSchema + AC requirement_refs ───────────────────

describe("SPEC-055 AC-055-2 — prdRequirementsSchema unique + AC requirement_refs", () => {
  it("HAPPY: a unique-id array parses", () => {
    expect(prdRequirementsSchema.safeParse([R1, R2]).success).toBe(true);
  });

  it("NEGATIVE: two entries sharing an id are rejected", () => {
    expect(prdRequirementsSchema.safeParse([R1, { ...R2, id: "R-1" }]).success).toBe(false);
  });

  it("HAPPY: an AC with requirement_refs parses", () => {
    const ac = {
      id: "AC-1",
      statement: "returns 200 for a valid login",
      verify: { mode: "human" as const },
      requirement_refs: ["R-1"],
    };
    expect(acceptanceCriterionSchema.safeParse(ac).success).toBe(true);
  });

  it("REGRESSION: an AC with NO requirement_refs still parses", () => {
    const ac = { id: "AC-1", statement: "x is < 5", verify: { mode: "human" as const } };
    const parsed = acceptanceCriterionSchema.safeParse(ac);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.requirement_refs).toBeUndefined();
  });
});

// ─── AC-055-3: computeRequirementCoverage truth table ────────────────────────

describe("SPEC-055 AC-055-3 — computeRequirementCoverage", () => {
  it("HAPPY: every requirement id in refs → empty uncovered", () => {
    const c = computeRequirementCoverage([R1, R2], ["R-1", "R-2"]);
    expect(c.covered.sort()).toEqual(["R-1", "R-2"]);
    expect(c.uncovered).toEqual([]);
    expect(c.uncovered_p0).toEqual([]);
    expect(c.total).toBe(2);
  });

  it("STATE: a P0 id in no ref → non-empty uncovered_p0", () => {
    const c = computeRequirementCoverage([R1, R2], ["R-2"]);
    expect(c.uncovered).toEqual(["R-1"]);
    expect(c.uncovered_p0).toEqual(["R-1"]);
  });

  it("BOUNDARY: an uncovered P1 does NOT populate uncovered_p0", () => {
    const c = computeRequirementCoverage([R1, R2], ["R-1"]);
    expect(c.uncovered).toEqual(["R-2"]);
    expect(c.uncovered_p0).toEqual([]);
  });

  it("BOUNDARY: an empty requirements array → all-empty (vacuous)", () => {
    const c = computeRequirementCoverage([], []);
    expect(c).toEqual({ total: 0, covered: [], uncovered: [], uncovered_p0: [], migrated: [], unmigrated: [] });
  });
});

// ─── AC-055-4: requirementCoverageExitCode ───────────────────────────────────

describe("SPEC-055 AC-055-4 — requirementCoverageExitCode", () => {
  it("STATE: exit 3 iff uncovered_p0 non-empty", () => {
    expect(requirementCoverageExitCode(computeRequirementCoverage([R1], ["R-1"]))).toBe(0);
    expect(requirementCoverageExitCode(computeRequirementCoverage([R1], []))).toBe(3);
  });

  it("BOUNDARY: an uncovered P1 (no P0 gap) is exit 0", () => {
    expect(requirementCoverageExitCode(computeRequirementCoverage([R2], []))).toBe(0);
  });
});
