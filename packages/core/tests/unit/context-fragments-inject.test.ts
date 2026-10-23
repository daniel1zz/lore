/**
 * @layer core-module (context-fragments.ts)
 * @spec_ref AC-IT-1
 * Spec: spec-fragment-injection-timing-one-inject-enum-a-per-turn (Frontmatter)
 *
 * Six-dimension coverage: HAPPY (valid timing lists), NEGATIVE (each illegal combination, each naming its field),
 * BOUNDARY (single-value lists, description presence), ERROR (retired keys name the migration command, not a generic
 * unrecognized-key message), REGRESSION (hasMainSessionTiming ownership predicate).
 */
import { describe, expect, it } from "vitest";
import { FragmentFrontmatterSchema, hasMainSessionTiming } from "../../src/context-fragments.js";

const base = { id: "x", title: "X" };

function refusal(raw: unknown): { fields: string[]; text: string } {
  const r = FragmentFrontmatterSchema.safeParse(raw);
  expect(r.success).toBe(false);
  if (r.success) return { fields: [], text: "" };
  return { fields: r.error.issues.map((i) => String(i.path[0])), text: r.error.issues.map((i) => i.message).join("; ") };
}

describe("AC-IT-1 FragmentFrontmatterSchema inject", () => {
  it("AC-IT-1 accepts every legal inject list", () => {
    const legal: unknown[] = [
      { ...base, inject: ["launch"] },
      { ...base, inject: ["user-prompt"] },
      { ...base, inject: ["subagent-start"] },
      { ...base, inject: ["launch", "subagent-start"] },
      { ...base, inject: ["user-prompt", "subagent-start"], agents: ["lore-reader"] },
      { ...base, inject: ["on-demand"], description: "When to load" },
    ];
    for (const raw of legal) expect(FragmentFrontmatterSchema.safeParse(raw).success, JSON.stringify(raw)).toBe(true);
  });

  it("AC-IT-1 refuses an empty inject and a duplicate value, naming inject", () => {
    expect(refusal({ ...base, inject: [] }).fields).toContain("inject");
    const dup = refusal({ ...base, inject: ["launch", "launch"] });
    expect(dup.fields).toContain("inject");
    expect(dup.text).toContain("repeat");
  });

  it("AC-IT-1 refuses two main-session timings, naming inject", () => {
    for (const inject of [
      ["launch", "user-prompt"],
      ["launch", "on-demand"],
      ["on-demand", "user-prompt"],
    ]) {
      const r = refusal({ ...base, inject, description: "d" });
      expect(r.fields, inject.join("+")).toContain("inject");
      expect(r.text).toContain("main-session");
    }
  });

  it("AC-IT-1 refuses on-demand together with subagent-start, naming inject", () => {
    const r = refusal({ ...base, inject: ["on-demand", "subagent-start"], description: "d" });
    expect(r.fields).toContain("inject");
    expect(r.text).toContain("on-demand must be the only value");
  });

  it("AC-IT-1 refuses agents without subagent-start, naming agents", () => {
    expect(refusal({ ...base, inject: ["launch"], agents: ["lore-reader"] }).fields).toContain("agents");
  });

  it("AC-IT-1 refuses on-demand without description and description without on-demand, naming description", () => {
    expect(refusal({ ...base, inject: ["on-demand"] }).fields).toContain("description");
    expect(refusal({ ...base, inject: ["launch"], description: "d" }).fields).toContain("description");
  });

  it("AC-IT-1 refuses an empty agents list", () => {
    expect(refusal({ ...base, inject: ["subagent-start"], agents: [] }).fields).toContain("agents");
  });

  it("AC-IT-1 refuses audience, mode and delivery with a message naming 'lore migrate fragments', not a generic unrecognized-key one", () => {
    const old = { ...base, audience: ["main"], mode: "static", delivery: "rules" };
    for (const extra of [{ audience: ["main"] }, { mode: "static" }, { delivery: "skill" }, old]) {
      const raw = { ...base, inject: ["launch"], ...extra };
      const r = refusal(raw);
      expect(r.text).toContain("lore migrate fragments");
      expect(r.text).not.toContain("Unrecognized key");
    }
    // An old-format file has no inject at all: the migration message must still surface.
    expect(refusal(old).text).toContain("lore migrate fragments");
  });

  it("AC-IT-1 hasMainSessionTiming is true for launch, on-demand and user-prompt and false for subagent-start only", () => {
    expect(hasMainSessionTiming({ inject: ["launch", "subagent-start"] })).toBe(true);
    expect(hasMainSessionTiming({ inject: ["on-demand"] })).toBe(true);
    expect(hasMainSessionTiming({ inject: ["user-prompt"] })).toBe(true);
    expect(hasMainSessionTiming({ inject: ["subagent-start"] })).toBe(false);
  });
});
