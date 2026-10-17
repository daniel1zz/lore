/**
 * `workflow.gates."ac-cite"` config schema + raw accessor (citation gate C4/D5 of
 * spec-baseline-slice-2-completeness-census-per-branch-citation, AC-BLS2-2).
 *
 * Dimensions: HAPPY (mode + armed_branches parse; accessor returns just those keys), NEGATIVE (unknown
 * mode / non-array armed_branches / empty slug rejected at load), BOUNDARY (neither key => accessor
 * undefined; `enabled` alone is not the gate's switch), REGRESSION (a pre-existing gates entry with only
 * `enabled` still parses unchanged).
 *
 * @spec_ref spec-baseline-slice-2-completeness-census-per-branch-citation#AC-BLS2-2
 */

import { describe, it, expect } from "vitest";
import { LoreConfigSchema, resolveCiteGateRaw, CITE_GATE_MODES } from "@lore/core";

const base = { project: { name: "p", author: "a" } };
const withGate = (gate: unknown) => ({ ...base, workflow: { gates: { "ac-cite": gate } } });

describe("workflow.gates.\"ac-cite\" schema", () => {
  it("accepts every declared mode", () => {
    for (const mode of CITE_GATE_MODES) {
      expect(LoreConfigSchema.safeParse(withGate({ mode })).success).toBe(true);
    }
  });

  it("accepts armed_branches as a list of slugs", () => {
    expect(LoreConfigSchema.safeParse(withGate({ mode: "enforce", armed_branches: ["baseline-branch-a"] })).success).toBe(true);
  });

  it("rejects an unknown mode at load", () => {
    expect(LoreConfigSchema.safeParse(withGate({ mode: "block" })).success).toBe(false);
  });

  it("rejects armed_branches that is not a list of non-empty strings", () => {
    expect(LoreConfigSchema.safeParse(withGate({ armed_branches: "baseline-branch-a" })).success).toBe(false);
    expect(LoreConfigSchema.safeParse(withGate({ armed_branches: [""] })).success).toBe(false);
  });

  it("rejects the two-state `enabled` key on the ac-cite entry (its switch is the three-state mode)", () => {
    expect(LoreConfigSchema.safeParse(withGate({ enabled: false })).success).toBe(false);
  });

  it("still parses every other gates entry that carries only the legacy `enabled` key", () => {
    expect(LoreConfigSchema.safeParse({ ...base, workflow: { gates: { "task-claim": { enabled: false } } } }).success).toBe(true);
  });
});

describe("resolveCiteGateRaw", () => {
  const parsed = (gate: unknown) => {
    const r = LoreConfigSchema.safeParse(withGate(gate));
    if (!r.success) throw new Error("fixture config rejected");
    return r.data;
  };

  it("returns only the configured mode / armed_branches keys", () => {
    expect(resolveCiteGateRaw(parsed({ mode: "report", armed_branches: ["x"] }))).toEqual({ mode: "report", armed_branches: ["x"] });
    expect(resolveCiteGateRaw(parsed({ mode: "enforce" }))).toEqual({ mode: "enforce" });
  });

  it("returns undefined when no config, no workflow, no entry, or neither key is set", () => {
    expect(resolveCiteGateRaw(undefined)).toBeUndefined();
    expect(resolveCiteGateRaw(LoreConfigSchema.parse(base))).toBeUndefined();
    expect(resolveCiteGateRaw(parsed({}))).toBeUndefined();
  });
});
