/**
 * Tests for BR-960 / AC-BLC-5 (lore issue #126): the review judge prompt for an architecture
 * standard node shows every AS rule's four parts verbatim; a business leaf's prompt carries no
 * four-part section; the structured-part size cap counts instead of silently dropping (BR-269).
 *
 * Six-dimension coverage: HAPPY (four parts rendered), NEGATIVE (business leaf and a
 * debt-registry rule have no four-part text), BOUNDARY (empty current_exceptions; cap overflow),
 * REGRESSION (existing rule line fields still rendered).
 */
import { describe, it, expect } from "vitest";
import { REVIEW_TEMPLATES, REVIEW_PROMPT_VERSION } from "../../../src/ai/review-template.js";
import type { DocRecord, ReviewBundle, CheckResult } from "@lore/core";

const BUDGETS = { max_context_chars: 4000 };
const NOW = "2026-02-01T00:00:00.000Z";
const CHECKS: CheckResult[] = [{ check: "schema", outcome: "pass" }];
// The ACTIVE version must carry the four parts (AC-BLC-5); v3-v6 are frozen and tested separately below.
const v2 = REVIEW_TEMPLATES[REVIEW_PROMPT_VERSION]!;

function makeBaselineBundle(extra: Record<string, unknown>): ReviewBundle {
  const doc = {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    slug: "baseline-node",
    type: "baseline",
    role: "spec",
    title: "Node",
    status: "in-review",
    priority: "medium",
    content: "## Body\n\nprose",
    parent_id: null,
    extra,
    tags: [],
    version: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
    created_by: "system",
    deleted_at: null,
  } as DocRecord;
  return { doc, links: [] };
}

function standardRule(n: number, text = "x") {
  return {
    id: `AS-${n}`,
    statement: `standard statement ${n}`,
    confidence: "established",
    enforced_by: "prompt-only",
    examples: ["e"],
    lifecycle: "live",
    current_reality: `REALITY-${n}-${text}`,
    target_rule: `TARGET-${n}-${text}`,
    current_exceptions: n % 2 === 0 ? [] : ["AD-3", "AD-7"],
    migration: `MIGRATION-${n}-${text}`,
  };
}

const standardNode = (rules: unknown[]) => makeBaselineBundle({ tree: "architecture", node: "standard", rules });

describe("AC-BLC-5 — judge sees architecture standard four parts", () => {
  it("HAPPY: every AS rule's four parts appear verbatim", () => {
    const out = v2(standardNode([standardRule(1), standardRule(2)]), CHECKS, BUDGETS, NOW).prompt;
    for (const n of [1, 2]) {
      expect(out).toContain(`current_reality: REALITY-${n}-x`);
      expect(out).toContain(`target_rule: TARGET-${n}-x`);
      expect(out).toContain(`migration: MIGRATION-${n}-x`);
    }
    expect(out).toContain("current_exceptions: AD-3, AD-7");
  });

  it("BOUNDARY: an empty current_exceptions is stated as none, not omitted", () => {
    const out = v2(standardNode([standardRule(2)]), CHECKS, BUDGETS, NOW).prompt;
    expect(out).toContain("current_exceptions: (none)");
  });

  it("REGRESSION: the existing rule line fields are still rendered", () => {
    const out = v2(standardNode([standardRule(1)]), CHECKS, BUDGETS, NOW).prompt;
    expect(out).toContain("- AS-1 [confidence=established, lifecycle=live, enforced_by=prompt-only]: standard statement 1");
  });

  it("NEGATIVE: a business leaf prompt has no four-part section", () => {
    const leaf = makeBaselineBundle({
      node: "leaf",
      rules: [{ id: "BR-1", statement: "s", confidence: "established", enforced_by: "guaranteed", examples: ["e"], lifecycle: "live" }],
    });
    const out = v2(leaf, CHECKS, BUDGETS, NOW).prompt;
    expect(out).toContain("BR-1");
    // the rendered label is `<key>: <value>`; the bare word "migration" also appears in the v4 design_necessity rule
    for (const key of ["current_reality", "target_rule", "current_exceptions", "migration"]) {
      expect(out).not.toContain(`${key}:`);
    }
  });

  it("NEGATIVE: a debt-registry rule gets no four-part section", () => {
    const debt = makeBaselineBundle({
      tree: "architecture",
      node: "debt-registry",
      rules: [{ id: "AD-1", statement: "s", confidence: "established", enforced_by: "prompt-only", examples: ["e"], lifecycle: "live" }],
    });
    const out = v2(debt, CHECKS, BUDGETS, NOW).prompt;
    expect(out).toContain("AD-1");
    expect(out).not.toContain("current_reality");
  });

  it("BOUNDARY: past the structured size cap, omitted rules are counted, not dropped silently (BR-269)", () => {
    const big = "z".repeat(900);
    const rules = Array.from({ length: 120 }, (_, i) => standardRule(i + 1, big));
    const out = v2(standardNode(rules), CHECKS, BUDGETS, NOW).prompt;
    expect(out).toMatch(/\[\d+ rules omitted for prompt budget/);
    expect(out).toContain("REALITY-1-");
  });
});

describe("AC-BLC-5 — prompt version freeze", () => {
  const v3 = REVIEW_TEMPLATES["v3"]!;

  it("STATE: the active version is a registered template, at or after v5", () => {
    expect(typeof REVIEW_TEMPLATES[REVIEW_PROMPT_VERSION]).toBe("function");
    expect(Number(REVIEW_PROMPT_VERSION.slice(1))).toBeGreaterThanOrEqual(5);
  });

  it("HAPPY: v3 shows a standard node's four parts; with those lines stripped no four-part key remains", () => {
    const bundle = standardNode([standardRule(1)]);
    const v3Out = v3(bundle, CHECKS, BUDGETS, NOW).prompt;
    expect(v3Out).toContain("current_reality: REALITY-1-x");
    const stripped = v3Out.replace(/\n {2}(current_reality|target_rule|current_exceptions|migration): [^\n]*/g, "");
    for (const key of ["current_reality", "target_rule", "current_exceptions", "migration"]) {
      expect(stripped).not.toContain(key);
    }
  });

  it("HAPPY: v6 equals v5 for a standard node plus exactly the rules' examples lines (D9, BR-960); v5 shows none", () => {
    const bundle = standardNode([standardRule(1)]);
    const v5Out = REVIEW_TEMPLATES["v5"]!(bundle, CHECKS, BUDGETS, NOW).prompt;
    const v6Out = REVIEW_TEMPLATES["v6"]!(bundle, CHECKS, BUDGETS, NOW).prompt;
    expect(v5Out).not.toContain("examples:");
    expect(v6Out).toContain("\n  examples: e");
    expect(v6Out.replace(/\n {2}examples: [^\n]*/g, "")).toBe(v5Out);
  });
});
