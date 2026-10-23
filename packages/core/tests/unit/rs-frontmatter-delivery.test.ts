/**
 * AC-RS-1 — fragment frontmatter on-demand delivery / `description` bounds, re-keyed to `inject`.
 * Spec: spec-rule-store-git-tracked-fragment-selection-on-demand-skill (BR-1061); the delivery / audience / mode
 * fields are superseded by `inject` (spec-fragment-injection-timing-one-inject-enum-a-per-turn, AC-IT-1 owns the
 * full refusal matrix). The kept property: a skill fragment needs a bounded description, and skills outlets exist.
 */
import { describe, expect, it } from "vitest";
import { FragmentFrontmatterSchema, OUTLET_IDS, resolveContextConfig } from "../../src/context-fragments.js";

const base = { id: "x", title: "X", inject: ["launch"] } as const;
const skill = { id: "x", title: "X", inject: ["on-demand"], description: "When to load this skill" };

describe("fragment id must not carry the lore- prefix (task-rs-t13 mechanism)", () => {
  it("accepts `x` and refuses `lore-x` naming why", () => {
    expect(FragmentFrontmatterSchema.safeParse(base).success).toBe(true);
    const r = FragmentFrontmatterSchema.safeParse({ ...base, id: "lore-x" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toContain("refresh prefixes 'lore-'");
  });
});

describe("AC-RS-1 fragment frontmatter on-demand delivery", () => {
  it("AC-RS-1 on-demand with description passes", () => {
    expect(FragmentFrontmatterSchema.safeParse(skill).success).toBe(true);
  });

  it("AC-RS-1 on-demand without description is a schema error", () => {
    const { description: _d, ...noDesc } = skill;
    expect(FragmentFrontmatterSchema.safeParse(noDesc).success).toBe(false);
  });

  it("AC-RS-1 1536-char description passes, 1537 fails", () => {
    expect(FragmentFrontmatterSchema.safeParse({ ...skill, description: "a".repeat(1536) }).success).toBe(true);
    expect(FragmentFrontmatterSchema.safeParse({ ...skill, description: "a".repeat(1537) }).success).toBe(false);
  });

  it("AC-RS-1 on-demand beside any other timing is a schema error", () => {
    expect(FragmentFrontmatterSchema.safeParse({ ...skill, inject: ["on-demand", "subagent-start"] }).success).toBe(false);
  });

  it("AC-RS-1 a helper-only fragment stays valid (regression)", () => {
    expect(FragmentFrontmatterSchema.safeParse({ ...base, inject: ["subagent-start"] }).success).toBe(true);
  });

  it("AC-RS-1 skills outlets exist and resolve like rules outlets", () => {
    expect(OUTLET_IDS).toContain("skills:project");
    expect(OUTLET_IDS).toContain("skills:user");
    const g = { context: { language: "zh", fragments: { disable: ["g"] } } };
    const p = { context: { language: "en", fragments: { disable: ["p"] } } };
    expect(resolveContextConfig(g, p, "skills:user")).toEqual(resolveContextConfig(g, p, "rules:user"));
    expect(resolveContextConfig(g, p, "skills:project")).toEqual(resolveContextConfig(g, p, "rules:project"));
  });
});
