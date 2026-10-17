/**
 * @layer core-unit (hasClaimConflict; the AC's oracle is the CLI integration suite)
 * RED table for hasClaimConflict (spec D6, BR-1040/1042): the decision is by
 * harness run, not by name; legacy holders and two unattested parties compare
 * by name; stale holders are taken over.
 *
 * Dimensions: HAPPY (same run refresh, stale takeover), NEGATIVE (conflict
 * cases), BOUNDARY (null runs on either side, legacy), STATE (decision does
 * not depend on name when runs decide), REGRESSION (R1/R2 same-name case is
 * the falsifier from AC-RID-12: a name comparison would turn it red).
 *
 * @spec_ref AC-RID-12
 */
import { describe, it, expect } from "vitest";
import { hasClaimConflict, type ClaimHolder, type ClaimParty, type RunId } from "@lore/core";

const R1 = "cc:s1" as RunId;
const R2 = "cc:s2" as RunId;

const holder = (by: string, harnessRun: RunId | null, over: Partial<ClaimHolder> = {}): ClaimHolder => ({
  by,
  harnessRun,
  legacy: false,
  stale: false,
  ...over,
});
const party = (by: string, harnessRun: RunId | null): ClaimParty => ({ by, harnessRun });

describe("hasClaimConflict is exported", () => {
  it("is a function", () => {
    expect(typeof hasClaimConflict).toBe("function");
  });
});

describe("attested holder, fresh", () => {
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

  it("unattested claimant: conflict naming the holder run", () => {
    expect(hasClaimConflict(holder("a", R1), party("a", null))).toEqual({
      kind: "conflict",
      holder: "a",
      holderRun: R1,
    });
  });
});

describe("unattested (non-legacy) holder, fresh", () => {
  it("attested claimant: conflict with holderRun null", () => {
    expect(hasClaimConflict(holder("a", null), party("a", R1))).toEqual({
      kind: "conflict",
      holder: "a",
      holderRun: null,
    });
  });

  it("both unattested, same name: refresh", () => {
    expect(hasClaimConflict(holder("a", null), party("a", null))).toEqual({ kind: "refresh" });
  });

  it("both unattested, different name: conflict naming the holder", () => {
    expect(hasClaimConflict(holder("a", null), party("b", null))).toEqual({
      kind: "conflict",
      holder: "a",
      holderRun: null,
    });
  });
});

describe("legacy holder (no harness_run key), fresh: compared by name", () => {
  const legacy = (by: string) => holder(by, null, { legacy: true });

  it("claimant with the same name and no run: refresh", () => {
    expect(hasClaimConflict(legacy("a"), party("a", null))).toEqual({ kind: "refresh" });
  });

  it("claimant with a different name: conflict", () => {
    expect(hasClaimConflict(legacy("a"), party("b", null))).toEqual({
      kind: "conflict",
      holder: "a",
      holderRun: null,
    });
  });

  it("attested claimant with the same name: not refused (name decides)", () => {
    expect(hasClaimConflict(legacy("a"), party("a", R1)).kind).not.toBe("conflict");
  });

  it("attested claimant with a different name: conflict", () => {
    expect(hasClaimConflict(legacy("a"), party("b", R1)).kind).toBe("conflict");
  });
});

describe("stale holder: taken over without stealing", () => {
  it("stale attested holder, different run: takeover", () => {
    expect(hasClaimConflict(holder("a", R1, { stale: true }), party("b", R2))).toEqual({ kind: "takeover" });
  });

  it("stale attested holder, unattested claimant: takeover", () => {
    expect(hasClaimConflict(holder("a", R1, { stale: true }), party("b", null))).toEqual({ kind: "takeover" });
  });

  it("stale unattested holder, different name: takeover", () => {
    expect(hasClaimConflict(holder("a", null, { stale: true }), party("b", null))).toEqual({ kind: "takeover" });
  });

  it("stale legacy holder, different name: takeover", () => {
    expect(hasClaimConflict(holder("a", null, { stale: true, legacy: true }), party("b", R1))).toEqual({
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
