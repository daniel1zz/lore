/**
 * Tests for @lore/core uat.ts (SPEC-054) — uatVerdictSchema, isP0Accepted truth table,
 * and the knowledgeExtraSchema sub_type "uat" presence superRefine. Pure, no IO.
 *
 * Six-dimension coverage:
 *   HAPPY:      a clean accept verdict is P0-accepted; a well-formed payload parses.
 *   NEGATIVE:   each of the four P0-failing conditions flips isP0Accepted to false;
 *               an out-of-enum verdict and a missing tier_results field are rejected.
 *   BOUNDARY:   an accept_with_conditions verdict with clean tiers is still P0-accepted.
 *   STATE:      knowledgeExtraSchema requires extra.uat when sub_type === "uat".
 *   REGRESSION: a non-uat sub_type with no uat field still parses.
 *
 * Source: SPEC-054 §Acceptance Criteria AC-054-1, AC-054-2, AC-054-3.
 */

import { describe, it, expect } from "vitest";
import { isP0Accepted, uatVerdictSchema, type UatVerdict } from "../../src/uat.js";
import { knowledgeExtraSchema } from "../../src/schemas.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ACCEPT_VERDICT: UatVerdict = {
  verdict: "accept",
  tier_results: [
    { tier: "P0", accepted: 5, rejected: 0, unverified: 0 },
    { tier: "P1", accepted: 3, rejected: 0, unverified: 0 },
  ],
  requirement_coverage: { total: 8, covered: 8, uncovered_p0: [] },
  uiux: { blocker_count: 0, min_dimension_score: 4 },
  run_meta: { at: "2026-07-18T00:00:00.000Z", by: "agent:uat" },
};

// ─── AC-054-1: isP0Accepted truth table ──────────────────────────────────────

describe("SPEC-054 AC-054-1 — isP0Accepted", () => {
  it("HAPPY: a clean accept verdict is P0-accepted", () => {
    expect(isP0Accepted(ACCEPT_VERDICT)).toBe(true);
  });

  it("BOUNDARY: accept_with_conditions with clean tiers is still P0-accepted", () => {
    expect(isP0Accepted({ ...ACCEPT_VERDICT, verdict: "accept_with_conditions" })).toBe(true);
  });

  it("NEGATIVE: verdict 'reject' fails", () => {
    expect(isP0Accepted({ ...ACCEPT_VERDICT, verdict: "reject" })).toBe(false);
  });

  it("NEGATIVE: a P0 tier row with rejected > 0 fails", () => {
    expect(
      isP0Accepted({
        ...ACCEPT_VERDICT,
        tier_results: [{ tier: "P0", accepted: 4, rejected: 1, unverified: 0 }],
      }),
    ).toBe(false);
  });

  it("NEGATIVE: a non-empty uncovered_p0 fails", () => {
    expect(
      isP0Accepted({
        ...ACCEPT_VERDICT,
        requirement_coverage: { total: 8, covered: 7, uncovered_p0: ["R-3"] },
      }),
    ).toBe(false);
  });

  it("NEGATIVE: a UIUX blocker fails", () => {
    expect(
      isP0Accepted({ ...ACCEPT_VERDICT, uiux: { blocker_count: 1, min_dimension_score: 2 } }),
    ).toBe(false);
  });

  it("STATE: a P1 tier rejection does NOT fail P0 acceptance (only P0 tier matters)", () => {
    expect(
      isP0Accepted({
        ...ACCEPT_VERDICT,
        tier_results: [
          { tier: "P0", accepted: 5, rejected: 0, unverified: 0 },
          { tier: "P1", accepted: 2, rejected: 1, unverified: 0 },
        ],
      }),
    ).toBe(true);
  });
});

// ─── AC-054-2: uatVerdictSchema ──────────────────────────────────────────────

describe("SPEC-054 AC-054-2 — uatVerdictSchema", () => {
  it("HAPPY: a well-formed payload parses", () => {
    expect(uatVerdictSchema.safeParse(ACCEPT_VERDICT).success).toBe(true);
  });

  it("NEGATIVE: an out-of-enum verdict is rejected", () => {
    expect(uatVerdictSchema.safeParse({ ...ACCEPT_VERDICT, verdict: "maybe" }).success).toBe(false);
  });

  it("NEGATIVE: a payload missing tier_results is rejected", () => {
    const { tier_results, ...rest } = ACCEPT_VERDICT;
    void tier_results;
    expect(uatVerdictSchema.safeParse(rest).success).toBe(false);
  });

  it("NEGATIVE: a negative accepted count is rejected", () => {
    expect(
      uatVerdictSchema.safeParse({
        ...ACCEPT_VERDICT,
        tier_results: [{ tier: "P0", accepted: -1, rejected: 0, unverified: 0 }],
      }).success,
    ).toBe(false);
  });
});

// ─── AC-054-3: knowledgeExtraSchema sub_type "uat" presence ──────────────────

describe("SPEC-054 AC-054-3 — knowledgeExtraSchema sub_type 'uat'", () => {
  it("STATE: sub_type 'uat' with no extra.uat fails to parse", () => {
    expect(knowledgeExtraSchema.safeParse({ sub_type: "uat" }).success).toBe(false);
  });

  it("HAPPY: sub_type 'uat' with a valid extra.uat parses", () => {
    expect(knowledgeExtraSchema.safeParse({ sub_type: "uat", uat: ACCEPT_VERDICT }).success).toBe(true);
  });

  it("REGRESSION: a non-uat sub_type with no uat field still parses", () => {
    expect(knowledgeExtraSchema.safeParse({ sub_type: "retro" }).success).toBe(true);
  });
});
