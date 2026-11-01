/**
 * Review judge prompt v9 (judge per template dimension): v9 renders one instruction per applicable template dimension, the
 * document's own answers and the template's open proposals, and adds the verdict rules; it needs `bundle.template`.
 *
 * Coverage:
 *   HAPPY:      every dimension is its own instruction; the output rules name dimension_verdicts and missing_dimensions
 *   NEGATIVE:   a bundle with no template is refused loudly (never rendered as v8)
 *   BOUNDARY:   a dimension whose applies_to excludes the kind gets no instruction; no open proposals renders "(none)"
 *   STATE:      open proposals are listed with their id and count; the document's answers are shown per dimension
 *   REGRESSION: v9 for a templated bundle = the v8 body plus additions only (v8's own text is a prefix of the v9 head)
 */

import { describe, expect, it } from "vitest";
import type { ReviewBundle, Template } from "@lore/core";
import {
  REVIEW_TEMPLATES,
  ReviewTemplateContextMissingError,
  TEMPLATE_DIMENSION_RULES_V9,
} from "../../../src/ai/review-template.js";
import { FROZEN_BUNDLES, FROZEN_BUDGETS, FROZEN_CHECKS, FROZEN_NOW } from "../../fixtures/design-necessity/frozen-bundles.js";

const TEMPLATE: Template = {
  doc_type: "spec",
  kind: "tech",
  version: 2,
  fields: { type: "object", properties: { summary: { type: "string" } } },
  dimensions: [
    { id: "edge-cases", question: "Which edge cases does it handle?" },
    { id: "evidence", question: "What proves it?", needs_refs: true },
    { id: "feature-only", question: "Feature-only question?", applies_to: ["feature"] },
  ],
  checks: [],
  render: [{ heading: "Summary", fields: ["summary"] }],
};

function templated(pending: ReviewBundle["template"] extends infer T ? (T extends { pendingProposals: infer P } ? P : never) : never): ReviewBundle {
  const base = FROZEN_BUNDLES.spec;
  return {
    ...base,
    doc: { ...base.doc, extra: { ...base.doc.extra, template_ref: "spec-tech-template@2", dimensions: [{ id: "edge-cases", status: "handled", answer: "empty and full cache" }] } },
    template: { ref: "spec-tech-template@2", template: TEMPLATE, kind: "tech", pendingProposals: pending },
  };
}

const v9 = (bundle: ReviewBundle): string => REVIEW_TEMPLATES["v9"]!(bundle, FROZEN_CHECKS, FROZEN_BUDGETS, FROZEN_NOW).prompt;

describe("review prompt v9", () => {
  it("HAPPY: one instruction per applicable dimension and the verdict rules", () => {
    const prompt = v9(templated([]));
    expect(prompt).toContain('Judge dimension "edge-cases": Which edge cases does it handle?');
    expect(prompt).toContain('Judge dimension "evidence": What proves it? (an answer must cite refs)');
    expect(prompt).toContain("template spec-tech-template@2");
    expect(prompt.endsWith(TEMPLATE_DIMENSION_RULES_V9)).toBe(true);
    expect(TEMPLATE_DIMENSION_RULES_V9).toContain('"dimension_verdicts"');
    expect(TEMPLATE_DIMENSION_RULES_V9).toContain('"missing_dimensions"');
  });

  it("NEGATIVE: a bundle without a template is refused, not rendered as v8", () => {
    expect(() => v9(FROZEN_BUNDLES.spec)).toThrow(ReviewTemplateContextMissingError);
  });

  it("BOUNDARY: a dimension that does not apply to the kind gets no instruction; no open proposals reads (none)", () => {
    const prompt = v9(templated([]));
    expect(prompt).not.toContain("feature-only");
    expect(prompt).toContain("# Open Template Proposals");
    expect(prompt).toMatch(/Open Template Proposals[\s\S]*?```\n\(none\)\n```/);
  });

  it("STATE: open proposals are listed with id and count; the document's answer is shown, an unanswered dimension says so", () => {
    const prompt = v9(templated([{ id: "prop-abc", question: "How is it rolled back?", count: 3 }]));
    expect(prompt).toContain("prop-abc (raised 3x): How is it rolled back?");
    expect(prompt).toContain("the document answers (handled): empty and full cache");
    expect(prompt).toContain("the document gives NO answer for this dimension");
  });

  it("REGRESSION: the v8 body is untouched; v9 only inserts the dimensions block and appends the rules", () => {
    const bundle = templated([]);
    const v8 = REVIEW_TEMPLATES["v8"]!(bundle, FROZEN_CHECKS, FROZEN_BUDGETS, FROZEN_NOW).prompt;
    const prompt = v9(bundle);
    const dimensionsAt = prompt.indexOf("# Template Dimensions");
    expect(dimensionsAt).toBeGreaterThan(-1);
    expect(prompt.slice(0, dimensionsAt)).toBe(v8.slice(0, dimensionsAt));
    expect(prompt.length).toBeGreaterThan(v8.length);
  });
});
