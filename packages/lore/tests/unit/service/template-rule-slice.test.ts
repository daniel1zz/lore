/**
 * template-rule-slice: the rule text a gate denial and `lore feed spec-create` quote comes from the approved template
 * (spec-every-document-is-stored-as-structured-fields-validated-by, "One source").
 *
 * Coverage:
 *   HAPPY:      the slice names the required fields, every dimension id, the checks and the `lore template show` pointer
 *   NEGATIVE:   a lookup refusal is NAMED in the slice (source `template lookup`), never an invented rule
 *   BOUNDARY:   a kind-less template, a template with no required field and no checks
 *   REGRESSION: the same template always yields byte-identical text; it never reproduces a dimension question
 */

import { describe, expect, it } from "vitest";
import { err, ok, parseTemplate, validationError, type Template } from "@lore/core";
import { resolveRuleSlice, templateRuleSlice } from "../../../src/service/template-rule-slice.js";
import type { ResolvedTemplate, TemplateService } from "../../../src/service/template-service.js";

function template(overrides: Record<string, unknown> = {}): Template {
  const parsed = parseTemplate({
    doc_type: "spec",
    kind: "feature",
    version: 2,
    fields: { type: "object", required: ["summary", "scope"], properties: { summary: { type: "string" }, scope: { type: "array", items: { type: "string" } } } },
    dimensions: [
      { id: "edge-cases", question: "A VERY SPECIFIC QUESTION that must not be copied into a feeding pack" },
      { id: "failure-modes", question: "How does it fail?" },
    ],
    checks: ["refs-resolve", "goal-has-measure"],
    render: [{ heading: "Summary", fields: ["summary"] }],
    ...overrides,
  });
  if (!parsed.ok) throw new Error(`fixture template invalid: ${JSON.stringify(parsed.error)}`);
  return parsed.value;
}

function resolved(value: Template, slug = "spec-feature-template"): ResolvedTemplate {
  return { slug, version: value.version, ref: `${slug}@${String(value.version)}`, template: value };
}

describe("templateRuleSlice", () => {
  it("HAPPY: names the ref, required fields, dimension ids, checks and the template show pointer", () => {
    const slice = templateRuleSlice(resolved(template()));
    expect(slice.source).toBe("template spec-feature-template@2");
    expect(slice.markdown).toContain("What a spec feature must satisfy (template spec-feature-template@2)");
    expect(slice.markdown).toContain("required: summary, scope");
    expect(slice.markdown).toContain("edge-cases, failure-modes");
    expect(slice.markdown).toContain("refs-resolve, goal-has-measure");
    expect(slice.markdown).toContain("lore template show spec --kind feature");
  });

  it("REGRESSION: never reproduces a dimension question, and is byte-identical for the same template", () => {
    const first = templateRuleSlice(resolved(template()));
    const second = templateRuleSlice(resolved(template()));
    expect(second).toEqual(first);
    expect(first.markdown).not.toContain("A VERY SPECIFIC QUESTION");
  });

  it("BOUNDARY: a kind-less template with no required field and no checks says none, and points at the kind-less show", () => {
    const slice = templateRuleSlice(
      resolved(template({ doc_type: "task", kind: undefined, fields: { type: "object", properties: { a: { type: "string" } } }, checks: [], render: [{ heading: "A", fields: ["a"] }] }), "task-template"),
    );
    expect(slice.markdown).toContain("What a task must satisfy");
    expect(slice.markdown).toContain("required: none");
    expect(slice.markdown).toContain("Checks run at promote: none.");
    expect(slice.markdown).toContain("`lore template show task`");
    expect(slice.markdown).not.toContain("--kind");
  });
});

describe("resolveRuleSlice", () => {
  it("HAPPY: reads the latest approved template of the slot", async () => {
    const service = { resolveTemplate: async () => ok(resolved(template())) } as unknown as TemplateService;
    const slice = await resolveRuleSlice(service, "spec", "feature");
    expect(slice.source).toBe("template spec-feature-template@2");
  });

  it("NEGATIVE: a refused lookup is named in the slice, never replaced by an invented rule", async () => {
    const service = {
      resolveTemplate: async () => err(validationError("template", "no approved template for spec/feature: create one", "spec/feature")),
    } as unknown as TemplateService;
    const slice = await resolveRuleSlice(service, "spec", "feature");
    expect(slice.source).toBe("template lookup");
    expect(slice.markdown).toContain("No rule could be read from an approved template");
    expect(slice.markdown).toContain("no approved template for spec/feature");
  });
});
