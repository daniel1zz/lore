/**
 * Bundles used to snapshot the v1-v3 review prompt builders (frozen output fixture
 * `review-prompt-v1-v3-frozen.json`). Pure data; the v4 test replays them.
 * Side-effect class: pure.
 */
import type { DocRecord, ReviewBundle, CheckResult, AcceptanceCriterion } from "@lore/core";

export const FROZEN_BUDGETS = { max_doc_chars: 8000, max_context_chars: 4000 };
export const FROZEN_NOW = "2026-02-01T00:00:00.000Z";
export const FROZEN_CHECKS: CheckResult[] = [{ check: "schema", outcome: "pass" }];

function makeDoc(overrides: Partial<DocRecord>): DocRecord {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    slug: "spec-example-feature",
    type: "spec",
    role: "requirement",
    title: "Example Feature",
    status: "in-review",
    priority: "medium",
    content: "## Overview/Goal\n\nDo the thing.",
    parent_id: null,
    extra: {},
    tags: [],
    version: 3,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
    created_by: "system",
    deleted_at: null,
    ...overrides,
  } as DocRecord;
}

const AC: AcceptanceCriterion = {
  id: "AC-1",
  statement: "the dashboard P95 load < 200ms",
  verify: { mode: "human" },
};

export const FROZEN_BUNDLES: Record<"spec" | "plan" | "adr", ReviewBundle> = {
  spec: {
    doc: makeDoc({ extra: { spec_kind: "feature", acceptance_criteria: [AC] } }),
    links: [],
  },
  plan: {
    doc: makeDoc({ type: "plan", slug: "plan-example", title: "Example Plan", extra: {} }),
    links: [],
  },
  adr: {
    doc: makeDoc({ type: "adr", slug: "adr-example", title: "Example ADR", extra: {} }),
    links: [],
  },
};
