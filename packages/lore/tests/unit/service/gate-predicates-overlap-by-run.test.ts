/**
 * `noAnchorOverlap` / `findAnchorOverlapConflict` compare holders by RUN ONLY (BR-1056, BR-1040).
 *
 * @spec_ref spec-run-only-write-identity-and-run-end-claim-release#AC-ROI-3
 *   spec-run-only-write-identity-and-run-end-claim-release Scope 3.
 * @spec_ref spec-every-write-is-made-by-a-known-party-an-attested-agent-run#AC-HID-3
 *
 * Coverage: NEGATIVE (two runs sharing a name; a missing run on either side) / HAPPY (the same run is one holder) /
 * REGRESSION (a stale or non-overlapping sibling never conflicts) / BOUNDARY (an absent `harness_run` key counts as
 * no run; no run equals no run is NOT one holder).
 */

import { describe, expect, it } from "vitest";
import { findAnchorOverlapConflict, noAnchorOverlap, type SiblingClaimInfo } from "../../../src/service/gate-predicates.js";

const NAME = "agent:session-aaaaaaaa";

function sibling(overrides: Partial<SiblingClaimInfo> = {}): SiblingClaimInfo {
  return { slug: "task-1", title: "T1", by: NAME, at: "2026-10-12T00:00:00.000Z", stale: false, anchors: ["src/a"], ...overrides };
}

describe("noAnchorOverlap decides by run", () => {
  it("NEGATIVE: two runs that share a derived name conflict", () => {
    expect(findAnchorOverlapConflict(["src/a"], [sibling({ harness_run: "cc:one" })], "cc:two")?.kind).toBe("foreign-run");
    expect(noAnchorOverlap(["src/a"], [sibling({ harness_run: "cc:one" })], "cc:two").ok).toBe(false);
  });

  it("NEGATIVE: a claimant with no run against a run-holding sibling is a different holder", () => {
    expect(findAnchorOverlapConflict(["src/a"], [sibling({ harness_run: "cc:one" })], null)?.kind).toBe("foreign-run");
    expect(findAnchorOverlapConflict(["src/a"], [sibling({ harness_run: "cc:one" })])?.kind).toBe("foreign-run");
  });

  it("NEGATIVE: a claimant with a run against a sibling whose lease names no run is a different holder", () => {
    expect(findAnchorOverlapConflict(["src/a"], [sibling({ harness_run: null })], "cc:one")?.kind).toBe("foreign-run");
    expect(findAnchorOverlapConflict(["src/a"], [sibling()], "cc:one")?.kind).toBe("foreign-run");
  });

  it("BOUNDARY: no run on either side is NOT one holder: a shared name never makes them one", () => {
    expect(findAnchorOverlapConflict(["src/a"], [sibling({ harness_run: null })], null)?.kind).toBe("foreign-run");
    expect(findAnchorOverlapConflict(["src/a"], [sibling()])?.kind).toBe("foreign-run");
  });

  it("HAPPY: the same run is one holder", () => {
    expect(findAnchorOverlapConflict(["src/a"], [sibling({ harness_run: "cc:one" })], "cc:one")).toBeUndefined();
    expect(noAnchorOverlap(["src/a"], [sibling({ harness_run: "cc:one" })], "cc:one")).toEqual({ ok: true });
  });

  it("REGRESSION: a stale or non-overlapping sibling never conflicts, run or not", () => {
    expect(findAnchorOverlapConflict(["src/a"], [sibling({ harness_run: "cc:one", stale: true })], "cc:two")).toBeUndefined();
    expect(findAnchorOverlapConflict(["src/a"], [sibling({ harness_run: "cc:one", anchors: ["src/zzz"] })], "cc:two")).toBeUndefined();
  });

  it("REGRESSION: a candidate declaring no anchors conflicts with nothing", () => {
    expect(findAnchorOverlapConflict([], [sibling({ harness_run: "cc:one" })], "cc:two")).toBeUndefined();
    expect(noAnchorOverlap(undefined, [sibling({ harness_run: "cc:one" })], "cc:two")).toEqual({ ok: true });
  });
});
