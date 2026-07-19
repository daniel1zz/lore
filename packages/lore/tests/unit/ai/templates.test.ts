/**
 * Tests for BUILT_IN_TEMPLATES and renderTemplate (SPEC-017 §3.9).
 *
 * Spec-first: SPEC-017 §3.9 defines the expected behavior before any code was read.
 *   - BUILT_IN_TEMPLATES must have exactly one entry for every DocType
 *   - renderTemplate: conditional blocks processed BEFORE substitutions
 *   - renderTemplate: unknown vars → empty string (never throws)
 *   - renderTemplate: {{#key}}…{{/key}} keeps body iff vars[key] is truthy
 *
 * Adversarial angles:
 *   - BUILT_IN_TEMPLATES missing a DocType → caught by the coverage check
 *   - Conditional block with var inside — ensures ordering (step 1 before step 2)
 *   - Unknown variable → spec says empty string, not "undefined" or exception
 *   - Template with no placeholders at all → returned verbatim
 *
 * @spec_ref AC-AI-9, SPEC-017 §3.9
 */

import { describe, it, expect } from "vitest";
import { BUILT_IN_TEMPLATES, renderTemplate } from "../../../src/ai/templates.js";

// ─── BUILT_IN_TEMPLATES coverage ────────────────────────────────────────────

describe("BUILT_IN_TEMPLATES", () => {
  const EXPECTED_DOC_TYPES = ["prd", "spec", "adr", "plan", "knowledge", "task", "phase"] as const;

  it("has exactly one entry for every DocType", () => {
    expect(Object.keys(BUILT_IN_TEMPLATES).sort()).toEqual([...EXPECTED_DOC_TYPES].sort());
  });

  it("prd template is non-empty string", () => {
    expect(BUILT_IN_TEMPLATES.prd).toBeTruthy();
    expect(typeof BUILT_IN_TEMPLATES.prd).toBe("string");
  });

  it("spec template contains {{#parent_title}} conditional block (used by AC-AI-4)", () => {
    expect(BUILT_IN_TEMPLATES.spec).toContain("{{#parent_title}}");
    expect(BUILT_IN_TEMPLATES.spec).toContain("{{/parent_title}}");
  });

  it("task template contains {{#parent_title}} conditional block", () => {
    expect(BUILT_IN_TEMPLATES.task).toContain("{{#parent_title}}");
    expect(BUILT_IN_TEMPLATES.task).toContain("{{/parent_title}}");
  });

  it("all templates contain {{title}} substitution", () => {
    for (const type of EXPECTED_DOC_TYPES) {
      expect(BUILT_IN_TEMPLATES[type]).toContain("{{title}}");
    }
  });
});

// ─── renderTemplate — simple substitution ───────────────────────────────────

describe("renderTemplate — simple substitution", () => {
  it("substitutes {{title}} with the provided title", () => {
    const result = renderTemplate("Title: {{title}}", { title: "X" });
    expect(result).toBe("Title: X");
  });

  it("substitutes multiple occurrences of {{title}}", () => {
    const result = renderTemplate("{{title}} is {{title}}", { title: "Foo" });
    expect(result).toBe("Foo is Foo");
  });

  it("leaves template without placeholders verbatim", () => {
    const result = renderTemplate("No placeholders here.", { title: "Ignored" });
    expect(result).toBe("No placeholders here.");
  });

  it("replaces unknown variable with empty string, not 'undefined'", () => {
    const result = renderTemplate("a {{unknown}} b", { title: "T" });
    expect(result).toBe("a  b");
    expect(result).not.toContain("undefined");
  });
});

// ─── renderTemplate — conditional blocks ────────────────────────────────────

describe("renderTemplate — conditional blocks", () => {
  const CONDITIONAL_TEMPLATE =
    "a{{#parent_title}} (under {{parent_title}}){{/parent_title}}";

  it("renders conditional body when parent_title is present", () => {
    const result = renderTemplate(CONDITIONAL_TEMPLATE, {
      title: "T",
      parent_title: "P",
    });
    expect(result).toBe("a (under P)");
  });

  it("omits conditional block entirely when parent_title is absent", () => {
    const result = renderTemplate(CONDITIONAL_TEMPLATE, { title: "T" });
    expect(result).toBe("a");
  });

  it("substitutes {{parent_title}} inside the conditional block correctly", () => {
    const result = renderTemplate(
      "Spec for {{title}}{{#parent_title}} under {{parent_title}}{{/parent_title}}.",
      { title: "Auth", parent_title: "Security PRD" },
    );
    expect(result).toBe("Spec for Auth under Security PRD.");
  });

  it("conditional + no parent_title → no orphaned text from the block", () => {
    const result = renderTemplate(
      "Doc titled {{title}}{{#parent_title}}, child of {{parent_title}}{{/parent_title}}.",
      { title: "My Doc" },
    );
    expect(result).toBe("Doc titled My Doc.");
  });

  it("two consecutive conditional blocks — both present", () => {
    const tpl =
      "{{#parent_title}}A={{parent_title}}{{/parent_title}} {{#parent_title}}B={{parent_title}}{{/parent_title}}";
    const result = renderTemplate(tpl, { title: "T", parent_title: "P" });
    expect(result).toBe("A=P B=P");
  });

  it("two conditional blocks — only present when parent_title given", () => {
    const tpl =
      "{{#parent_title}}A={{parent_title}}{{/parent_title}} mid {{#parent_title}}B={{parent_title}}{{/parent_title}}";
    const result = renderTemplate(tpl, { title: "T" });
    expect(result).toBe(" mid ");
  });
});

// ─── renderTemplate — real built-in templates ────────────────────────────────

describe("renderTemplate — real built-in spec template (AC-AI-4)", () => {
  it("spec template renders with parent_title interpolated into conditional block", () => {
    const result = renderTemplate(BUILT_IN_TEMPLATES.spec, {
      title: "Auth Flow",
      parent_title: "Security PRD",
    });
    expect(result).toContain("Auth Flow");
    expect(result).toContain("Security PRD");
    // Verify the conditional markers are NOT in the output
    expect(result).not.toContain("{{#parent_title}}");
    expect(result).not.toContain("{{/parent_title}}");
  });

  it("spec template renders without parent_title (no conditional text leaks)", () => {
    const result = renderTemplate(BUILT_IN_TEMPLATES.spec, { title: "My Spec" });
    expect(result).toContain("My Spec");
    expect(result).not.toContain("{{");
    expect(result).not.toContain("}}");
  });

  it("prd template substitutes title correctly", () => {
    const result = renderTemplate(BUILT_IN_TEMPLATES.prd, { title: "Notification Center" });
    expect(result).toContain("Notification Center");
    expect(result).not.toContain("{{title}}");
  });
});
