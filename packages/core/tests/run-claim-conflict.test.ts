/**
 * @layer core-unit AC-RID-12 (hasClaimConflict; the AC's oracle is the CLI integration suite)
 * Table for hasClaimConflict (spec D6, BR-1040/BR-1043/BR-1056): the decision is by harness run ONLY, never by name;
 * a missing run (on either side) is never "the same holder"; stale holders are taken over.
 *
 * Dimensions: HAPPY (same run refresh, stale takeover), NEGATIVE (conflict cases, a missing run on either side),
 * BOUNDARY (null runs on both sides), STATE (decision does not depend on name), REGRESSION (R1/R2 same-name case is
 * the falsifier from AC-RID-12: a name comparison would turn it red; two parties with no run and one name conflict).
 *
 * @spec_ref AC-RID-12
 * @spec_ref spec-every-write-is-made-by-a-known-party-an-attested-agent-run (end state 4)
 */
import { describe, it, expect } from "vitest";
import { hasClaimConflict, type ClaimHolder, type ClaimParty, type RunId } from "@lore/core";

const R1 = "cc:s1" as RunId;
const R2 = "cc:s2" as RunId;

const holder = (by: string, harnessRun: RunId | null, over: Partial<ClaimHolder> = {}): ClaimHolder => ({
  by,
  harnessRun,
  stale: false,
  ...over,
});
const party = (by: string, harnessRun: RunId | null): ClaimParty => ({ by, harnessRun });

describe("hasClaimConflict is exported", () => {
  it("is a function", () => {
    expect(typeof hasClaimConflict).toBe("function");
  });
});

describe("holder with a run, fresh", () => {
  it("different run, same name: conflict naming the holder run (falsifier for name comparison)", () => {
    expect(hasClaimConflict(holder("a", R1), party("a", R2))).toEqual({
      kind: "conflict",
      holder: "a",
      holderRun: R1,
    });
  });

  it("different run, different name: conflict", () => {
    expect(hasClaimConflict(holder("a", R1), party("b", R2))).toEqual({
      kind: "conflict",
      holder: "a",
      holderRun: R1,
    });
  });

  it("same run: refresh", () => {
    expect(hasClaimConflict(holder("a", R1), party("a", R1))).toEqual({ kind: "refresh" });
  });

  it("same run under a different claimed name: still refresh (run decides, not name)", () => {
    expect(hasClaimConflict(holder("a", R1), party("zzz", R1))).toEqual({ kind: "refresh" });
  });

  it("claimant with no run: conflict naming the holder run", () => {
    expect(hasClaimConflict(holder("a", R1), party("a", null))).toEqual({
      kind: "conflict",
      holder: "a",
      holderRun: R1,
    });
  });
});

describe("holder with no run (a lease written before runs existed), fresh", () => {
  it("claimant with a run: conflict with holderRun null, even under the same name", () => {
    expect(hasClaimConflict(holder("a", null), party("a", R1))).toEqual({
      kind: "conflict",
      holder: "a",
      holderRun: null,
    });
  });

  it("BOUNDARY: claimant with no run and the SAME name: conflict, never a refresh (a name is not an identity)", () => {
    expect(hasClaimConflict(holder("a", null), party("a", null))).toEqual({
      kind: "conflict",
      holder: "a",
      holderRun: null,
    });
  });

  it("claimant with no run and a different name: conflict naming the holder", () => {
    expect(hasClaimConflict(holder("a", null), party("b", null))).toEqual({
      kind: "conflict",
      holder: "a",
      holderRun: null,
    });
  });
});

describe("stale holder: taken over without stealing", () => {
  it("stale holder, different run: takeover", () => {
    expect(hasClaimConflict(holder("a", R1, { stale: true }), party("b", R2))).toEqual({ kind: "takeover" });
  });

  it("stale holder, claimant with no run: takeover", () => {
    expect(hasClaimConflict(holder("a", R1, { stale: true }), party("b", null))).toEqual({ kind: "takeover" });
  });

  it("stale holder with no run, different name: takeover", () => {
    expect(hasClaimConflict(holder("a", null, { stale: true }), party("b", null))).toEqual({ kind: "takeover" });
  });

  it("stale holder with no run, claimant with a run: takeover", () => {
    expect(hasClaimConflict(holder("a", null, { stale: true }), party("b", R1))).toEqual({
      kind: "takeover",
    });
  });
});

describe("decision depends on its inputs (not a constant)", () => {
  it("the same holder yields different decisions for different claimants", () => {
    const h = holder("a", R1);
    const kinds = [hasClaimConflict(h, party("a", R1)).kind, hasClaimConflict(h, party("a", R2)).kind];
    expect(kinds).toEqual(["refresh", "conflict"]);
  });

  it("conflict carries the holder's own name and run, not the claimant's", () => {
    expect(hasClaimConflict(holder("holder-x", R2), party("claimant-y", R1))).toEqual({
      kind: "conflict",
      holder: "holder-x",
      holderRun: R2,
    });
  });
});
