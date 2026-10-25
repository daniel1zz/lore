/**
 * AC-CRIT-1 — a parent spec cut by `max_context_chars` must be NOTICED in the review prompt:
 * shown/total chars plus the section headings that fell after the cut (reuses
 * buildOmittedSectionsNotice). Before this, only the doc body had a notice (SPEC-040 D8).
 *
 * @spec_ref AC-CRIT-1
 */
import { describe, it, expect } from "vitest";
import { REVIEW_TEMPLATES, REVIEW_PROMPT_VERSION } from "../../../src/ai/review-template.js";
import type { DocRecord, ReviewBundle } from "@lore/core";

const BUDGETS = { max_context_chars: 8000 };

function makeDoc(overrides: Partial<DocRecord>): DocRecord {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FAV" as DocRecord["id"],
    slug: "spec-parent-trunc" as DocRecord["slug"],
    type: "spec",
    role: "spec",
    title: "Parent Truncation Spec",
    status: "draft",
    priority: "medium",
    content: "short",
    parent_id: null,
    created_at: "2026-07-10T00:00:00.000Z",
    updated_at: "2026-07-10T00:00:00.000Z",
    created_by: "tester",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
    ...overrides,
  } as DocRecord;
}

const PARENT_CONTENT = "## D1\n" + "p".repeat(9000) + "\n## D8\nthe late decision\n";

describe("review prompt — parent truncation notice (AC-CRIT-1)", () => {
  for (const version of ["v1", "v3"]) {
    it(`AC-CRIT-1 ${version}: parent over max_context_chars gets a notice with shown/total chars naming D8`, () => {
      const bundle: ReviewBundle = {
        doc: makeDoc({ content: "small body" }),
        parent: makeDoc({ slug: "spec-the-parent" as DocRecord["slug"], title: "The Parent", content: PARENT_CONTENT }),
        links: [],
      };
      const result = REVIEW_TEMPLATES[version]!(bundle, [], BUDGETS);
      expect(result.prompt).toContain("# Parent Truncation Notice");
      expect(result.prompt).toContain(`8000 of ${PARENT_CONTENT.length} chars`);
      const notice = result.prompt.slice(result.prompt.indexOf("# Parent Truncation Notice"));
      expect(notice).toMatch(/Sections not shown[^\n]*D8/);
      expect(result.truncated).toContain("parent");
      expect(result.truncated).not.toContain("doc");
    });
  }

  it("NEGATIVE: a parent that fits has no parent notice", () => {
    const bundle: ReviewBundle = {
      doc: makeDoc({ content: "small body" }),
      parent: makeDoc({ content: "## D8\nfits\n" }),
      links: [],
    };
    const result = REVIEW_TEMPLATES[REVIEW_PROMPT_VERSION]!(bundle, [], BUDGETS);
    expect(result.prompt).not.toContain("# Parent Truncation Notice");
  });

  it("BOUNDARY: a parent exactly at max_context_chars is not cut and has no notice", () => {
    const bundle: ReviewBundle = {
      doc: makeDoc({ content: "small body" }),
      parent: makeDoc({ content: "z".repeat(8000) }),
      links: [],
    };
    const result = REVIEW_TEMPLATES[REVIEW_PROMPT_VERSION]!(bundle, [], BUDGETS);
    expect(result.prompt).not.toContain("# Parent Truncation Notice");
  });
});
