/** @spec_ref AC-CORE-002 */
import { describe, it, expect } from "vitest";
import {
  slugSchema,
  createDocInputSchema,
  docPatchSchema,
  isValidTransition,
  slugify,
  docTypeSchema,
  docStatusSchema,
  docRoleSchema,
  prioritySchema,
  linkTypeSchema,
  specExtraSchema,
  SPEC_KINDS,
  knowledgeExtraSchema,
} from "@lore/core";

// Test plan for schemas module:
// HAPPY: valid inputs pass, transitions valid, slugify correct
// NEGATIVE: invalid inputs fail (missing required fields, wrong types)
// BOUNDARY: slug length limits, title edge cases
// ERROR: N/A — no external dependencies (pure Zod)
// STATE: isValidTransition — lifecycle graph
// REGRESSION: N/A — no known regressions

describe("slugSchema (AC-CORE-002.E01, AC-CORE-002.E02)", () => {
  it("AC-CORE-002.E01: accepts 'spec-auth-v2'", () => {
    const result = slugSchema.safeParse("spec-auth-v2");
    expect(result.success).toBe(true);
  });

  it("accepts 'prd-lore'", () => {
    const result = slugSchema.safeParse("prd-lore");
    expect(result.success).toBe(true);
  });

  it("accepts 'adr-turso-selection'", () => {
    const result = slugSchema.safeParse("adr-turso-selection");
    expect(result.success).toBe(true);
  });

  it("[boundary] accepts slug at minimum length (3 chars: a-b)", () => {
    const result = slugSchema.safeParse("a-b");
    expect(result.success).toBe(true);
  });

  it("AC-CORE-002.E02: rejects 'INVALID SLUG!'", () => {
    const result = slugSchema.safeParse("INVALID SLUG!");
    expect(result.success).toBe(false);
  });

  it("AC-CORE-002.E03: rejects slug starting with hyphen", () => {
    const result = slugSchema.safeParse("-invalid");
    expect(result.success).toBe(false);
  });

  it("[negative] rejects slug with uppercase", () => {
    const result = slugSchema.safeParse("Spec-Auth");
    expect(result.success).toBe(false);
  });

  it("[negative] rejects slug with spaces", () => {
    const result = slugSchema.safeParse("spec auth");
    expect(result.success).toBe(false);
  });

  it("[negative] rejects slug with underscores", () => {
    const result = slugSchema.safeParse("spec_auth");
    expect(result.success).toBe(false);
  });

  it("[negative] rejects single character slug", () => {
    const result = slugSchema.safeParse("a");
    expect(result.success).toBe(false);
  });

  it("[negative] rejects slug ending with hyphen", () => {
    const result = slugSchema.safeParse("spec-");
    expect(result.success).toBe(false);
  });

  it("[boundary] rejects 2-char slug (minimum is 3)", () => {
    // 'ab' = 2 chars, pattern requires [a-z][a-z0-9-]{1,62}[a-z0-9] which is min 3
    const result = slugSchema.safeParse("ab");
    expect(result.success).toBe(false);
  });

  it("[boundary] accepts exactly 64-char slug", () => {
    const slug = "a" + "b".repeat(62) + "c"; // 64 chars
    expect(slug.length).toBe(64);
    const result = slugSchema.safeParse(slug);
    expect(result.success).toBe(true);
  });

  it("[boundary] rejects 65-char slug", () => {
    const slug = "a" + "b".repeat(63) + "c"; // 65 chars
    expect(slug.length).toBe(65);
    const result = slugSchema.safeParse(slug);
    expect(result.success).toBe(false);
  });
});

describe("Enum schemas", () => {
  it("docTypeSchema accepts all 6 doc types", () => {
    for (const t of ["prd", "spec", "adr", "plan", "knowledge", "task"]) {
      expect(docTypeSchema.safeParse(t).success).toBe(true);
    }
  });

  it("[negative] docTypeSchema rejects unknown type", () => {
    expect(docTypeSchema.safeParse("unknown").success).toBe(false);
  });

  it("docStatusSchema accepts all 6 doc statuses", () => {
    for (const s of [
      "draft",
      "in-review",
      "approved",
      "active",
      "archived",
      "deprecated",
    ]) {
      expect(docStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  it("[negative] docStatusSchema rejects unknown status", () => {
    expect(docStatusSchema.safeParse("pending").success).toBe(false);
  });

  it("docRoleSchema accepts all 5 doc roles", () => {
    for (const r of ["intent", "spec", "decision", "plan", "knowledge"]) {
      expect(docRoleSchema.safeParse(r).success).toBe(true);
    }
  });

  it("prioritySchema accepts all 4 priorities", () => {
    for (const p of ["critical", "high", "medium", "low"]) {
      expect(prioritySchema.safeParse(p).success).toBe(true);
    }
  });

  it("linkTypeSchema accepts all 7 link types", () => {
    for (const lt of [
      "parent",
      "implements",
      "informs",
      "supersedes",
      "relates-to",
      "blocks",
      "governs",
    ]) {
      expect(linkTypeSchema.safeParse(lt).success).toBe(true);
    }
  });

  it("[negative] linkTypeSchema rejects unknown link type", () => {
    expect(linkTypeSchema.safeParse("consumes").success).toBe(false);
  });
});

describe("createDocInputSchema (AC-CORE-002)", () => {
  it("AC-CORE-002.01: valid spec input with parent_id passes", () => {
    const result = createDocInputSchema.safeParse({
      type: "spec",
      title: "Auth Service",
      parent_id: "01J5X7KZRF4AXRHX9WKE6DVP6P",
      extra: {},
    });
    expect(result.success).toBe(true);
  });

  it("AC-CORE-002.02: valid adr input with decision_status passes", () => {
    const result = createDocInputSchema.safeParse({
      type: "adr",
      title: "Use Turso",
      extra: { decision_status: "accepted" },
    });
    expect(result.success).toBe(true);
  });

  it("AC-CORE-002.03: valid task input with plan_id and parent_id passes", () => {
    const result = createDocInputSchema.safeParse({
      type: "task",
      title: "Implement auth",
      parent_id: "01J5X7KZRF4AXRHX9WKE6DVP6P",
      extra: { plan_id: "01J5X7KZRF4AXRHX9WKE6DVP7Q" },
    });
    expect(result.success).toBe(true);
  });

  it("valid prd input (no parent_id required) passes", () => {
    const result = createDocInputSchema.safeParse({
      type: "prd",
      title: "Lore PRD",
      extra: {},
    });
    expect(result.success).toBe(true);
  });

  it("valid knowledge input with sub_type passes", () => {
    const result = createDocInputSchema.safeParse({
      type: "knowledge",
      title: "Research Notes",
      extra: { sub_type: "research" },
    });
    expect(result.success).toBe(true);
  });

  it("valid plan input (no parent_id required) passes", () => {
    const result = createDocInputSchema.safeParse({
      type: "plan",
      title: "Phase 1 Plan",
      extra: {},
    });
    expect(result.success).toBe(true);
  });

  it("accepts optional tags", () => {
    const result = createDocInputSchema.safeParse({
      type: "prd",
      title: "Lore PRD",
      tags: ["v1", "auth"],
      extra: {},
    });
    expect(result.success).toBe(true);
  });

  it("accepts optional content", () => {
    const result = createDocInputSchema.safeParse({
      type: "prd",
      title: "Lore PRD",
      content: "# Lore\n\nContent here.",
      extra: {},
    });
    expect(result.success).toBe(true);
  });

  it("accepts optional priority", () => {
    const result = createDocInputSchema.safeParse({
      type: "prd",
      title: "Lore PRD",
      priority: "critical",
      extra: {},
    });
    expect(result.success).toBe(true);
  });

  it("AC-CORE-002.N01: spec without parent_id fails", () => {
    const result = createDocInputSchema.safeParse({
      type: "spec",
      title: "Auth Service",
      extra: {},
    });
    expect(result.success).toBe(false);
  });

  it("AC-CORE-002.N02: adr without decision_status in extra fails", () => {
    const result = createDocInputSchema.safeParse({
      type: "adr",
      title: "Use Turso",
      extra: {},
    });
    expect(result.success).toBe(false);
  });

  it("AC-CORE-002.N03: task without plan_id in extra fails", () => {
    const result = createDocInputSchema.safeParse({
      type: "task",
      title: "Implement auth",
      parent_id: "01J5X7KZRF4AXRHX9WKE6DVP6P",
      extra: {},
    });
    expect(result.success).toBe(false);
  });

  it("AC-CORE-002.N04: knowledge without sub_type in extra fails", () => {
    const result = createDocInputSchema.safeParse({
      type: "knowledge",
      title: "Research Notes",
      extra: {},
    });
    expect(result.success).toBe(false);
  });

  describe("knowledge sub_type=prompt / sub_type=skill (AC-P1-1)", () => {
    // HAPPY: sub_type + full extra.prompt/extra.skill payload validates.
    it("[happy] sub_type=prompt with extra.prompt={variables:[...]} passes", () => {
      const result = createDocInputSchema.safeParse({
        type: "knowledge",
        title: "Refine Prompt",
        extra: { sub_type: "prompt", prompt: { variables: ["x"] } },
      });
      expect(result.success).toBe(true);
    });

    it("[happy] sub_type=skill with extra.skill={applies_to:...} passes", () => {
      const result = createDocInputSchema.safeParse({
        type: "knowledge",
        title: "Refine Skill",
        extra: { sub_type: "skill", skill: { applies_to: "spec" } },
      });
      expect(result.success).toBe(true);
    });

    // HAPPY: nested extra.prompt / extra.skill are both optional — sub_type alone passes.
    it("[happy] sub_type=prompt with extra.prompt omitted passes", () => {
      const result = createDocInputSchema.safeParse({
        type: "knowledge",
        title: "Refine Prompt",
        extra: { sub_type: "prompt" },
      });
      expect(result.success).toBe(true);
    });

    it("[happy] sub_type=skill with extra.skill omitted passes", () => {
      const result = createDocInputSchema.safeParse({
        type: "knowledge",
        title: "Refine Skill",
        extra: { sub_type: "skill" },
      });
      expect(result.success).toBe(true);
    });

    // NEGATIVE: wrong-typed nested fields fail loud (VALIDATION_ERROR-mapped upstream).
    it("[negative] extra.prompt.variables as a non-array string fails", () => {
      const result = createDocInputSchema.safeParse({
        type: "knowledge",
        title: "Refine Prompt",
        extra: { sub_type: "prompt", prompt: { variables: "notarray" } },
      });
      expect(result.success).toBe(false);
    });

    it("[negative] extra.skill.applies_to as a number fails", () => {
      const result = createDocInputSchema.safeParse({
        type: "knowledge",
        title: "Refine Skill",
        extra: { sub_type: "skill", skill: { applies_to: 123 } },
      });
      expect(result.success).toBe(false);
    });

    // NEGATIVE: same two checks against knowledgeExtraSchema directly (unit-level, no
    // createDocInputSchema wrapper) — confirms the nested schemas reject bad shapes on
    // their own, not merely because the wrapper's other checks also fail.
    it("[negative] knowledgeExtraSchema rejects extra.prompt.variables as a string", () => {
      const result = knowledgeExtraSchema.safeParse({
        sub_type: "prompt",
        prompt: { variables: "notarray" },
      });
      expect(result.success).toBe(false);
    });

    it("[negative] knowledgeExtraSchema rejects extra.skill.applies_to as a number", () => {
      const result = knowledgeExtraSchema.safeParse({
        sub_type: "skill",
        skill: { applies_to: 123 },
      });
      expect(result.success).toBe(false);
    });

    // BOUNDARY: sub_type missing still fails regardless of a well-formed nested payload —
    // the pre-existing requirement (AC-CORE-002.N04) is unaffected by adding prompt/skill.
    it("[boundary] sub_type missing fails even with a well-formed extra.prompt", () => {
      const result = createDocInputSchema.safeParse({
        type: "knowledge",
        title: "Refine Prompt",
        extra: { prompt: { variables: ["x"] } },
      });
      expect(result.success).toBe(false);
    });

    // REGRESSION: pre-existing sub_types still validate unaffected by the new branches.
    it.each(["ideation", "retro", "research", "reference"] as const)(
      "[regression] sub_type=%s (pre-existing) still passes",
      (subType) => {
        const result = createDocInputSchema.safeParse({
          type: "knowledge",
          title: "Pre-existing sub_type",
          extra: { sub_type: subType },
        });
        expect(result.success).toBe(true);
      },
    );
  });

  it("[negative] task without parent_id fails", () => {
    const result = createDocInputSchema.safeParse({
      type: "task",
      title: "Implement auth",
      extra: { plan_id: "01J5X7KZRF4AXRHX9WKE6DVP6P" },
    });
    expect(result.success).toBe(false);
  });

  it("[negative] fails without title", () => {
    const result = createDocInputSchema.safeParse({
      type: "prd",
      extra: {},
    });
    expect(result.success).toBe(false);
  });

  it("[negative] fails without type", () => {
    const result = createDocInputSchema.safeParse({
      title: "Lore PRD",
      extra: {},
    });
    expect(result.success).toBe(false);
  });

  it("[negative] fails with invalid type", () => {
    const result = createDocInputSchema.safeParse({
      type: "invalid-type",
      title: "Test",
      extra: {},
    });
    expect(result.success).toBe(false);
  });

  it("[negative] fails with invalid priority", () => {
    const result = createDocInputSchema.safeParse({
      type: "prd",
      title: "Test",
      priority: "urgent",
      extra: {},
    });
    expect(result.success).toBe(false);
  });

  it("[boundary] accepts empty extra object for prd", () => {
    const result = createDocInputSchema.safeParse({
      type: "prd",
      title: "Lore PRD",
      extra: {},
    });
    expect(result.success).toBe(true);
  });

  // spec_kind taxonomy (SPEC-032 §3.1) — schema layer validates ONLY: absent stays
  // valid (100+ pre-SPEC-032 specs unaffected), explicit invalid value fails loud.
  // The "feature" default-on-create is materialized service-side, not by this schema.
  it("AC-SPECKIND.01: spec input with no spec_kind in extra passes (regression: pre-existing specs)", () => {
    const result = createDocInputSchema.safeParse({
      type: "spec",
      title: "Auth Service",
      parent_id: "01J5X7KZRF4AXRHX9WKE6DVP6P",
      extra: {},
    });
    expect(result.success).toBe(true);
  });

  it("AC-SPECKIND.02: spec input with spec_kind='design' passes", () => {
    const result = createDocInputSchema.safeParse({
      type: "spec",
      title: "Design Spec",
      parent_id: "01J5X7KZRF4AXRHX9WKE6DVP6P",
      extra: { spec_kind: "design" },
    });
    expect(result.success).toBe(true);
  });

  it("AC-SPECKIND.03: spec input with spec_kind='tech' passes", () => {
    const result = createDocInputSchema.safeParse({
      type: "spec",
      title: "Tech Spec",
      parent_id: "01J5X7KZRF4AXRHX9WKE6DVP6P",
      extra: { spec_kind: "tech" },
    });
    expect(result.success).toBe(true);
  });

  it("AC-SPECKIND.N01: spec input with spec_kind='bogus' fails loud", () => {
    const result = createDocInputSchema.safeParse({
      type: "spec",
      title: "Auth Service",
      parent_id: "01J5X7KZRF4AXRHX9WKE6DVP6P",
      extra: { spec_kind: "bogus" },
    });
    expect(result.success).toBe(false);
  });

  it("[negative] non-spec types are not affected by an invalid spec_kind-shaped extra key", () => {
    // spec_kind is only meaningful (and validated) when type === 'spec'; a prd carrying
    // the same key with a bogus value is untouched by the spec-only superRefine branch.
    const result = createDocInputSchema.safeParse({
      type: "prd",
      title: "Lore PRD",
      extra: { spec_kind: "bogus" },
    });
    expect(result.success).toBe(true);
  });
});

describe("specExtraSchema (SPEC-032 §3.1)", () => {
  it("accepts an empty object (field absent)", () => {
    expect(specExtraSchema.safeParse({}).success).toBe(true);
  });

  it("accepts each declared spec kind", () => {
    for (const kind of SPEC_KINDS) {
      expect(specExtraSchema.safeParse({ spec_kind: kind }).success).toBe(true);
    }
  });

  it("[negative] rejects an unknown spec_kind value", () => {
    expect(specExtraSchema.safeParse({ spec_kind: "bogus" }).success).toBe(false);
  });

  it("preserves arbitrary passthrough keys alongside spec_kind", () => {
    const result = specExtraSchema.safeParse({ spec_kind: "tech", custom_field: "value" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data["custom_field"]).toBe("value");
    }
  });

  it("[boundary] preserves passthrough keys when spec_kind is absent", () => {
    const result = specExtraSchema.safeParse({ some_legacy_field: 42 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data["some_legacy_field"]).toBe(42);
    }
  });
});

describe("docPatchSchema", () => {
  it("accepts a valid partial patch", () => {
    const result = docPatchSchema.safeParse({
      title: "New Title",
      status: "in-review",
    });
    expect(result.success).toBe(true);
  });

  it("[boundary] accepts empty patch", () => {
    const result = docPatchSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts all patch fields", () => {
    const result = docPatchSchema.safeParse({
      title: "T",
      content: "C",
      status: "approved",
      priority: "high",
      tags: ["a"],
      extra: { k: "v" },
      slug: "spec-new-name",
    });
    expect(result.success).toBe(true);
  });

  it("[negative] rejects invalid status", () => {
    const result = docPatchSchema.safeParse({ status: "invalid" });
    expect(result.success).toBe(false);
  });

  it("[negative] rejects invalid priority", () => {
    const result = docPatchSchema.safeParse({ priority: "urgent" });
    expect(result.success).toBe(false);
  });
});

describe("isValidTransition() (AC-CORE-004)", () => {
  // HAPPY: valid transitions from the lifecycle diagram
  it("AC-CORE-004.01: draft -> in-review", () => {
    expect(isValidTransition("draft", "in-review")).toBe(true);
  });

  it("AC-CORE-004.02: draft -> approved", () => {
    expect(isValidTransition("draft", "approved")).toBe(true);
  });

  it("AC-CORE-004.03: in-review -> approved", () => {
    expect(isValidTransition("in-review", "approved")).toBe(true);
  });

  it("in-review -> draft (reject back to draft)", () => {
    expect(isValidTransition("in-review", "draft")).toBe(true);
  });

  it("AC-CORE-004.04: approved -> active", () => {
    expect(isValidTransition("approved", "active")).toBe(true);
  });

  it("AC-CORE-004.05: active -> archived", () => {
    expect(isValidTransition("active", "archived")).toBe(true);
  });

  it("AC-CORE-004.06: active -> deprecated", () => {
    expect(isValidTransition("active", "deprecated")).toBe(true);
  });

  it("approved -> archived", () => {
    expect(isValidTransition("approved", "archived")).toBe(true);
  });

  it("approved -> deprecated", () => {
    expect(isValidTransition("approved", "deprecated")).toBe(true);
  });

  // NEGATIVE: invalid transitions
  it("AC-CORE-004.N01: archived -> approved is invalid", () => {
    expect(isValidTransition("archived", "approved")).toBe(false);
  });

  it("AC-CORE-004.N02: deprecated -> draft is invalid", () => {
    expect(isValidTransition("deprecated", "draft")).toBe(false);
  });

  it("AC-CORE-004.N03: approved -> draft is invalid", () => {
    expect(isValidTransition("approved", "draft")).toBe(false);
  });

  it("[negative] archived -> draft is invalid", () => {
    expect(isValidTransition("archived", "draft")).toBe(false);
  });

  it("[negative] archived -> active is invalid", () => {
    expect(isValidTransition("archived", "active")).toBe(false);
  });

  it("[negative] deprecated -> active is invalid", () => {
    expect(isValidTransition("deprecated", "active")).toBe(false);
  });

  it("[negative] active -> draft is invalid", () => {
    expect(isValidTransition("active", "draft")).toBe(false);
  });

  // BOUNDARY: self and skip transitions
  it("[boundary] same status to same status is invalid", () => {
    expect(isValidTransition("draft", "draft")).toBe(false);
  });

  it("[boundary] draft -> archived (skip) is invalid", () => {
    expect(isValidTransition("draft", "archived")).toBe(false);
  });

  // STATE: full lifecycle chains
  it("[state] full chain: draft->in-review->approved->active->archived", () => {
    expect(isValidTransition("draft", "in-review")).toBe(true);
    expect(isValidTransition("in-review", "approved")).toBe(true);
    expect(isValidTransition("approved", "active")).toBe(true);
    expect(isValidTransition("active", "archived")).toBe(true);
  });

  it("[state] full chain: draft->approved->active->deprecated", () => {
    expect(isValidTransition("draft", "approved")).toBe(true);
    expect(isValidTransition("approved", "active")).toBe(true);
    expect(isValidTransition("active", "deprecated")).toBe(true);
  });
});

describe("slugify() (AC-CORE-003)", () => {
  it("AC-CORE-003.01: slugify('spec', 'Auth Service v2') returns 'spec-auth-service-v2'", () => {
    const slug = slugify("spec", "Auth Service v2");
    expect(slug).toBe("spec-auth-service-v2");
  });

  it("lowercases all characters", () => {
    const slug = slugify("prd", "UPPER CASE TITLE");
    expect(slug).toBe("prd-upper-case-title");
  });

  it("replaces spaces with hyphens", () => {
    const slug = slugify("adr", "Use Turso For Storage");
    expect(slug).toBe("adr-use-turso-for-storage");
  });

  it("AC-CORE-003.03: replaces non-alphanumeric characters with hyphens", () => {
    const slug = slugify("spec", "Auth (v2) test");
    expect(slug).not.toMatch(/[^a-z0-9-]/);
    expect(slug).toBe("spec-auth-v2-test");
  });

  it("AC-CORE-003.04: deduplicates consecutive hyphens", () => {
    const slug = slugify("spec", "auth  v2"); // double space
    expect(slug).not.toContain("--");
  });

  it("handles hyphenated titles", () => {
    const slug = slugify("spec", "auth-v2");
    expect(slug).toBe("spec-auth-v2");
  });

  it("AC-CORE-003.02: 100+ char title truncated to max 64 chars", () => {
    const longTitle = "A".repeat(100) + " " + "B".repeat(100);
    const slug = slugify("spec", longTitle);
    expect(slug.length).toBeLessThanOrEqual(64);
  });

  it("result does not exceed 64 chars", () => {
    const slug = slugify("spec", "auth service v2");
    expect(slug.length).toBeLessThanOrEqual(64);
  });

  it("[boundary] empty title produces just the type prefix", () => {
    const slug = slugify("prd", "");
    expect(slug.startsWith("prd")).toBe(true);
  });

  it("[negative] AC-CORE-003.N01: title with only special chars produces valid slug with type prefix", () => {
    const slug = slugify("prd", "!!!---");
    expect(typeof slug).toBe("string");
    // When title contains only special chars, result is the type prefix
    expect(slug.startsWith("prd")).toBe(true);
  });
});
