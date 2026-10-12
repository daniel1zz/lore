/**
 * AC-RS-1 — fragment frontmatter `delivery` / `description` bounds.
 * Spec: spec-rule-store-git-tracked-fragment-selection-on-demand-skill (BR-1061).
 */
import { describe, expect, it } from "vitest";
import { FragmentFrontmatterSchema, OUTLET_IDS, resolveContextConfig } from "../../src/context-fragments.js";

const base = { id: "x", title: "X", audience: ["main"], mode: "static" } as const;
const skill = { ...base, delivery: "skill", description: "When to load this skill" };

describe("fragment id must not carry the lore- prefix (task-rs-t13 mechanism)", () => {
  it("accepts `x` and refuses `lore-x` naming why", () => {
    expect(FragmentFrontmatterSchema.safeParse(base).success).toBe(true);
    const r = FragmentFrontmatterSchema.safeParse({ ...base, id: "lore-x" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toContain("refresh prefixes 'lore-'");
  });
});

describe("AC-RS-1 fragment frontmatter delivery", () => {
  it("AC-RS-1 absent delivery parses as rules", () => {
    const r = FragmentFrontmatterSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.delivery).toBe("rules");
  });

  it("AC-RS-1 delivery skill with description passes", () => {
    expect(FragmentFrontmatterSchema.safeParse(skill).success).toBe(true);
  });

  it("AC-RS-1 delivery skill without description is a schema error", () => {
    const { description: _d, ...noDesc } = skill;
    expect(FragmentFrontmatterSchema.safeParse(noDesc).success).toBe(false);
  });

  it("AC-RS-1 1536-char description passes, 1537 fails", () => {
    expect(FragmentFrontmatterSchema.safeParse({ ...skill, description: "a".repeat(1536) }).success).toBe(true);
    expect(FragmentFrontmatterSchema.safeParse({ ...skill, description: "a".repeat(1537) }).success).toBe(false);
  });

  it("AC-RS-1 delivery skill with mode dynamic is a schema error", () => {
    expect(FragmentFrontmatterSchema.safeParse({ ...skill, mode: "dynamic" }).success).toBe(false);
  });

  it("AC-RS-1 delivery skill with a non-[main] audience is a schema error", () => {
    expect(FragmentFrontmatterSchema.safeParse({ ...skill, audience: ["subagent:*"] }).success).toBe(false);
    expect(FragmentFrontmatterSchema.safeParse({ ...skill, audience: ["main", "subagent:*"] }).success).toBe(false);
  });

  it("AC-RS-1 unknown delivery value is a schema error", () => {
    expect(FragmentFrontmatterSchema.safeParse({ ...base, delivery: "hook" }).success).toBe(false);
  });

  it("AC-RS-1 rules delivery keeps dynamic mode and subagent audience valid (regression)", () => {
    expect(FragmentFrontmatterSchema.safeParse({ ...base, mode: "dynamic", audience: ["subagent:*"] }).success).toBe(true);
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
