/**
 * `noAnchorOverlap` / `findAnchorOverlapConflict` compare holders by RUN (BR-1056).
 *
 * @spec_ref spec-run-only-write-identity-and-run-end-claim-release#AC-ROI-3
 *   spec-run-only-write-identity-and-run-end-claim-release Scope 3.
 *
 * Coverage: NEGATIVE (two runs sharing a name; exactly one side attested) / HAPPY (the same run is one holder) /
 * REGRESSION (neither side attested keeps the name+session comparison; a stale sibling never conflicts) /
 * BOUNDARY (an absent `harness_run` key counts as no run).
 */

import { describe, expect, it } from "vitest";
import { findAnchorOverlapConflict, noAnchorOverlap, type SiblingClaimInfo } from "../../../src/service/gate-predicates.js";

const NAME = "agent:session-aaaaaaaa";

function sibling(overrides: Partial<SiblingClaimInfo> = {}): SiblingClaimInfo {
  return { slug: "task-1", title: "T1", by: NAME, at: "2026-10-12T00:00:00.000Z", stale: false, anchors: ["src/a"], ...overrides };
}

describe("noAnchorOverlap decides by run", () => {
  it("NEGATIVE: two runs that share a derived name conflict even with an identical session id", () => {
    const result = findAnchorOverlapConflict(NAME, ["src/a"], [sibling({ harness_run: "cc:one", session_id: "3de02220" })], "3de02220", "cc:two");

    expect(result?.kind).toBe("foreign-run");
    expect(noAnchorOverlap(NAME, ["src/a"], [sibling({ harness_run: "cc:one" })], "3de02220", "cc:two").ok).toBe(false);
  });

  it("NEGATIVE: an unattested claimant against a run-holding sibling is a different holder", () => {
    expect(findAnchorOverlapConflict(NAME, ["src/a"], [sibling({ harness_run: "cc:one", session_id: "3de02220" })], "3de02220", null)?.kind).toBe("foreign-run");
    expect(findAnchorOverlapConflict(NAME, ["src/a"], [sibling({ harness_run: "cc:one" })], "3de02220")?.kind).toBe("foreign-run");
  });

  it("NEGATIVE: an attested claimant against an unattested sibling is a different holder", () => {
    expect(findAnchorOverlapConflict(NAME, ["src/a"], [sibling({ harness_run: null, session_id: "3de02220" })], "3de02220", "cc:one")?.kind).toBe("foreign-run");
    expect(findAnchorOverlapConflict(NAME, ["src/a"], [sibling()], "3de02220", "cc:one")?.kind).toBe("foreign-run");
  });

  it("HAPPY: the same run is one holder, whatever the session facts say", () => {
    expect(findAnchorOverlapConflict(NAME, ["src/a"], [sibling({ harness_run: "cc:one" })], undefined, "cc:one")).toBeUndefined();
    expect(noAnchorOverlap(NAME, ["src/a"], [sibling({ harness_run: "cc:one" })], undefined, "cc:one")).toEqual({ ok: true });
  });

  it("REGRESSION: with no run on either side the name-and-session comparison is unchanged", () => {
    expect(findAnchorOverlapConflict(NAME, ["src/a"], [sibling({ session_id: "3de02220" })], "3de02220")).toBeUndefined();
    expect(findAnchorOverlapConflict(NAME, ["src/a"], [sibling({ session_id: "7ab19c04" })], "3de02220")?.kind).toBe("foreign-session");
    expect(findAnchorOverlapConflict(NAME, ["src/a"], [sibling()], "3de02220")?.kind).toBe("session-not-measured");
    expect(findAnchorOverlapConflict("agent:other", ["src/a"], [sibling({ harness_run: null })], undefined, null)?.kind).toBe("foreign-actor");
  });

  it("REGRESSION: a stale or non-overlapping sibling never conflicts, run or not", () => {
    expect(findAnchorOverlapConflict(NAME, ["src/a"], [sibling({ harness_run: "cc:one", stale: true })], undefined, "cc:two")).toBeUndefined();
    expect(findAnchorOverlapConflict(NAME, ["src/a"], [sibling({ harness_run: "cc:one", anchors: ["src/zzz"] })], undefined, "cc:two")).toBeUndefined();
  });
});
