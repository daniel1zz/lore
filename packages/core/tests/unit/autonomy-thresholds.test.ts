/**
 * Governed thresholds (AC-AU-9) — the pure half: seed, schema, change classification, class edits.
 * HAPPY: seed equals the code table; equal records have no change. NEGATIVE: out-of-range and unknown-class edits
 * refuse. BOUNDARY: each field's tighten/loosen direction. STATE: the seed is a copy, never the constants. REGRESSION:
 * dist-npm/ stays in the seeded regenerable set.
 */
import { describe, expect, it } from "vitest";
import {
  OPERATION_CLASS_REGISTRY,
  WORKTREE_REMOVE_REGENERABLE_PATTERNS,
  applyClassEdit,
  diffGovernedThresholds,
  governedThresholdsSchema,
  registryOf,
  seedGovernedThresholds,
} from "../../src/autonomy/index.js";

function edited(classId: string, edit: Parameters<typeof applyClassEdit>[2]) {
  const result = applyClassEdit(seedGovernedThresholds(), classId, edit);
  if (!result.ok) throw new Error(result.message);
  return result.record;
}

describe("seedGovernedThresholds", () => {
  it("matches the code table and parses as a governed record", () => {
    const seed = seedGovernedThresholds();
    expect(governedThresholdsSchema.safeParse(seed).success).toBe(true);
    expect(registryOf(seed)).toEqual(OPERATION_CLASS_REGISTRY);
    expect(seed.worktreeRemoveRegenerable).toEqual([...WORKTREE_REMOVE_REGENERABLE_PATTERNS]);
    expect(seed.worktreeRemoveRegenerable).toContain("dist-npm/");
  });

  it("is a copy: mutating it never touches the registry constants", () => {
    const seed = seedGovernedThresholds();
    (seed.classes["stash-drop"] as { threshold: number }).threshold = 0.01;
    seed.worktreeRemoveRegenerable.push("x/");
    expect((OPERATION_CLASS_REGISTRY["stash-drop"] as { threshold: number }).threshold).toBe(0.8);
    expect(WORKTREE_REMOVE_REGENERABLE_PATTERNS).not.toContain("x/");
  });

  it("rejects an unknown key and an out-of-range threshold", () => {
    expect(governedThresholdsSchema.safeParse({ ...seedGovernedThresholds(), extra: 1 }).success).toBe(false);
    const bad = seedGovernedThresholds();
    (bad.classes["stash-drop"] as { threshold: number }).threshold = 1.5;
    expect(governedThresholdsSchema.safeParse(bad).success).toBe(false);
  });
});

describe("diffGovernedThresholds", () => {
  const seed = seedGovernedThresholds();

  it("equal records change nothing", () => {
    expect(diffGovernedThresholds(seed, seedGovernedThresholds())).toEqual({ loosened: [], tightened: [] });
  });

  it.each([
    ["higher threshold tightens", { threshold: 0.9 }, "tightened"],
    ["lower threshold loosens", { threshold: 0.7 }, "loosened"],
    ["lower prior tightens", { priorConfidence: 0.5 }, "tightened"],
    ["higher prior loosens", { priorConfidence: 0.99 }, "loosened"],
    ["lower declared recoverability tightens", { declaredRecoverability: "irreversible-local" as const }, "tightened"],
    ["higher declared recoverability loosens", { declaredRecoverability: "reversible" as const }, "loosened"],
    ["normal -> human-always tightens", { tier: "human-always" as const }, "tightened"],
    ["a judge turned on tightens", { usesJudge: true }, "tightened"],
  ])("%s", (_name, edit, side) => {
    const change = diffGovernedThresholds(seed, edited("stash-drop", edit));
    expect(change[side as "tightened" | "loosened"]).toHaveLength(1);
    expect(change[side === "tightened" ? "loosened" : "tightened"]).toHaveLength(0);
  });

  it("human-always -> normal loosens; a regenerable pattern added loosens, removed tightens; a class added as normal loosens", () => {
    const toNormal = edited("push-force", { tier: "normal", threshold: 0.9, priorConfidence: 0.9, declaredRecoverability: "reversible" });
    expect(diffGovernedThresholds(seed, toNormal).loosened[0]).toMatch(/push-force\.tier: human-always -> normal/);
    expect(diffGovernedThresholds(seed, { ...seed, worktreeRemoveRegenerable: [...seed.worktreeRemoveRegenerable, "x/"] }).loosened).toEqual(["worktreeRemoveRegenerable: + x/"]);
    expect(diffGovernedThresholds(seed, { ...seed, worktreeRemoveRegenerable: seed.worktreeRemoveRegenerable.filter((p) => p !== "dist-npm/") }).tightened).toEqual(["worktreeRemoveRegenerable: - dist-npm/"]);
    const added = { ...seed, classes: { ...seed.classes, "brand-new": { tier: "normal" as const, declaredRecoverability: "reversible" as const, threshold: 0.8, priorConfidence: 0.9, usesJudge: false } } };
    expect(diffGovernedThresholds(seed, added).loosened[0]).toMatch(/brand-new: class added/);
  });

  it("a mixed change reports both sides (the caller treats any loosening as a loosening)", () => {
    const mixed = edited("stash-drop", { threshold: 0.9, priorConfidence: 0.99 });
    const change = diffGovernedThresholds(seed, mixed);
    expect(change.tightened).toHaveLength(1);
    expect(change.loosened).toHaveLength(1);
  });
});

describe("applyClassEdit", () => {
  const seed = seedGovernedThresholds();

  it("returns a new record and leaves its input untouched", () => {
    const result = applyClassEdit(seed, "stash-drop", { threshold: 0.9 });
    expect(result.ok).toBe(true);
    expect((seed.classes["stash-drop"] as { threshold: number }).threshold).toBe(0.8);
  });

  it("refuses an unknown class naming the known ones", () => {
    const result = applyClassEdit(seed, "no-such", { threshold: 0.9 });
    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.message).toMatch(/unknown class "no-such".*stash-drop/);
  });

  it("refuses a normal-only field on a class that would be human-always, and a value out of range", () => {
    expect(applyClassEdit(seed, "stash-drop", { tier: "human-always", threshold: 0.9 })).toMatchObject({ ok: false });
    expect(applyClassEdit(seed, "stash-drop", { threshold: 2 })).toMatchObject({ ok: false });
  });

  it("turning a human-always class normal needs every normal field", () => {
    expect(applyClassEdit(seed, "push-force", { tier: "normal", threshold: 0.9 })).toMatchObject({ ok: false });
  });
});
