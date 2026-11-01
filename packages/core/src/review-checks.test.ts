/**
 * Tests for @lore/core review-checks — runDeterministicChecks and its five constituent
 * mechanical (non-LLM) pre-checks: schema, parent_contract, tree_position, link_integrity,
 * evidence_completeness. Pure function over a hand-built ReviewBundle, no IO.
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      every check passes on well-formed bundles (per doc type where relevant)
 *   NEGATIVE:   every check fails on malformed input, with a detail string naming the
 *               offending field/reason
 *   BOUNDARY:   passthrough extra fields still validate; link_integrity's zero-length-array
 *               vs undefined boundary; tree_position matching ANY of several modeled parent
 *               types (not just the first one found)
 *   ERROR:      n/a — pure function, reports via CheckResult.outcome, never throws
 *   STATE:      n/a — no state machine in this module (ReviewBundle in, CheckResult[] out,
 *               referentially transparent every call)
 *   REGRESSION: runDeterministicChecks always returns exactly 5 entries in the fixed order
 *               [schema, parent_contract, tree_position, link_integrity,
 *               evidence_completeness], regardless of bundle content; ROOT_TYPES is pinned
 *               to exactly ["prd"] via parent_contract's behavior
 *
 * @spec_ref SPEC-034 §1, §4
 */

import { describe, expect, it } from "vitest";
import { runDeterministicChecks, type ReviewBundle } from "./review-checks.js";
import { DOC_TYPE_ROLE_MAP, type DocRecord, type DocType } from "./types.js";
import type { TreeBlueprint } from "./tree-blueprint.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Valid `extra` payload per doc type — used as the "happy path" baseline for each type. */
const VALID_EXTRA: Record<DocType, Record<string, unknown>> = {
  prd: {},
  spec: {},
  adr: { decision_status: "accepted" },
  plan: {},
  task: { plan_id: "01ARZ3PLAN0000000000001" },
  knowledge: { sub_type: "reference" },
  // SPEC-056 T4 — "phase" is now a real DocType; forced by VALID_EXTRA's
  // Record<DocType, ...> exhaustiveness. No existing test iterates
  // Object.keys(VALID_EXTRA), so this addition is compile-only (no new
  // assertions implied).
  phase: { plan_id: "01ARZ3PLAN0000000000001" },
  baseline: { node: "root" },
  template: {
    template: {
      doc_type: "spec",
      version: 1,
      fields: { type: "object", properties: { summary: { type: "string" } } },
      dimensions: [{ id: "scope", question: "What is in scope?" }],
      checks: [],
      render: [{ heading: "Summary", fields: ["summary"] }],
    },
  },
};

function makeDoc(type: DocType, overrides: Partial<DocRecord> = {}): DocRecord {
  return {
    id: "01ARZ3DOC00000000000001",
    slug: `${type}-test-doc`,
    type,
    role: DOC_TYPE_ROLE_MAP[type],
    title: "Test Doc",
    status: "draft",
    priority: "medium",
    content: "Some content body.",
    parent_id: null,
    created_at: "2026-07-06T00:00:00.000Z",
    updated_at: "2026-07-06T00:00:00.000Z",
    created_by: "alice",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: VALID_EXTRA[type],
    ...overrides,
  };
}

function makeBundle(doc: DocRecord, overrides: Partial<ReviewBundle> = {}): ReviewBundle {
  return {
    doc,
    links: [],
    ...overrides,
  };
}

function findCheck(results: ReturnType<typeof runDeterministicChecks>, check: string) {
  return results.find((r) => r.check === check);
}

// ─── runDeterministicChecks — overall shape ─────────────────────────────────

describe("runDeterministicChecks — overall shape", () => {
  it("HAPPY: always returns exactly 5 entries", () => {
    const bundle = makeBundle(makeDoc("prd"));
    const results = runDeterministicChecks(bundle);
    expect(results).toHaveLength(5);
  });

  it("REGRESSION: entries are always in the fixed order [schema, parent_contract, tree_position, link_integrity, evidence_completeness]", () => {
    const bundle1 = makeBundle(makeDoc("prd"));
    const bundle2 = makeBundle(makeDoc("task", { parent_id: "01ARZ3PLAN0000000000001" }), {
      brokenLinkTargets: ["01ARZ3MISSING000000001"],
    });
    const order = [
      "schema",
      "parent_contract",
      "tree_position",
      "link_integrity",
      "evidence_completeness",
    ];
    expect(runDeterministicChecks(bundle1).map((r) => r.check)).toEqual(order);
    expect(runDeterministicChecks(bundle2).map((r) => r.check)).toEqual(order);
  });

  it("REGRESSION: is referentially transparent — same bundle in, same result out, called twice", () => {
    const bundle = makeBundle(makeDoc("adr", { parent_id: "01ARZ3PARENT00000000001" }), {
      parent: makeDoc("spec", { id: "01ARZ3PARENT00000000001" }),
    });
    expect(runDeterministicChecks(bundle)).toEqual(runDeterministicChecks(bundle));
  });
});

// ─── Check: schema ───────────────────────────────────────────────────────────

describe("check: schema", () => {
  it("HAPPY: passes for every doc type with valid extra", () => {
    const types: DocType[] = ["prd", "spec", "adr", "plan", "task", "knowledge"];
    for (const type of types) {
      const results = runDeterministicChecks(makeBundle(makeDoc(type)));
      expect(findCheck(results, "schema")).toEqual({ check: "schema", outcome: "pass" });
    }
  });

  it("NEGATIVE: adr with an invalid decision_status fails with a detail naming the field", () => {
    const doc = makeDoc("adr", { extra: { decision_status: "not-a-real-status" } });
    const results = runDeterministicChecks(makeBundle(doc));
    const schemaCheck = findCheck(results, "schema");
    expect(schemaCheck?.outcome).toBe("fail");
    expect(schemaCheck?.detail).toContain("decision_status");
  });

  it("NEGATIVE: task missing extra.plan_id fails", () => {
    const doc = makeDoc("task", { extra: {} });
    const results = runDeterministicChecks(makeBundle(doc));
    const schemaCheck = findCheck(results, "schema");
    expect(schemaCheck?.outcome).toBe("fail");
    expect(schemaCheck?.detail).toContain("plan_id");
  });

  it("NEGATIVE: knowledge with an invalid sub_type fails", () => {
    const doc = makeDoc("knowledge", { extra: { sub_type: "not-a-sub-type" } });
    const results = runDeterministicChecks(makeBundle(doc));
    const schemaCheck = findCheck(results, "schema");
    expect(schemaCheck?.outcome).toBe("fail");
    expect(schemaCheck?.detail).toContain("sub_type");
  });

  it("BOUNDARY: extra passthrough fields alongside the required ones still pass (not stripped/rejected)", () => {
    const doc = makeDoc("adr", {
      extra: { decision_status: "accepted", custom_metadata: "anything goes here" },
    });
    const results = runDeterministicChecks(makeBundle(doc));
    expect(findCheck(results, "schema")?.outcome).toBe("pass");
  });

  it("NEVER produces 'skipped' — this check has no skip condition", () => {
    const types: DocType[] = ["prd", "spec", "adr", "plan", "task", "knowledge"];
    for (const type of types) {
      const results = runDeterministicChecks(makeBundle(makeDoc(type)));
      expect(findCheck(results, "schema")?.outcome).not.toBe("skipped");
      const invalidDoc = makeDoc(type, { extra: { totally: "wrong" } });
      const invalidResults = runDeterministicChecks(makeBundle(invalidDoc));
      expect(findCheck(invalidResults, "schema")?.outcome).not.toBe("skipped");
    }
  });
});

// ─── Check: parent_contract ──────────────────────────────────────────────────

describe("check: parent_contract", () => {
  it("HAPPY: a prd with no parent passes (prd is the only ROOT_TYPE)", () => {
    const doc = makeDoc("prd", { parent_id: null });
    const results = runDeterministicChecks(makeBundle(doc));
    expect(findCheck(results, "parent_contract")).toEqual({ check: "parent_contract", outcome: "pass" });
  });

  it("NEGATIVE: spec parented under prd fails (BR-2: a spec takes no parent)", () => {
    const parent = makeDoc("prd", { id: "01ARZ3PARENT00000000001" });
    const doc = makeDoc("spec", { parent_id: parent.id });
    const results = runDeterministicChecks(makeBundle(doc, { parent }));
    expect(findCheck(results, "parent_contract")?.outcome).toBe("fail");
  });

  it("HAPPY: adr parented under spec passes (adr allows prd OR spec)", () => {
    const parent = makeDoc("spec", { id: "01ARZ3PARENT00000000002" });
    const doc = makeDoc("adr", { parent_id: parent.id });
    const results = runDeterministicChecks(makeBundle(doc, { parent }));
    expect(findCheck(results, "parent_contract")?.outcome).toBe("pass");
  });

  it("HAPPY: task parented under plan passes", () => {
    const parent = makeDoc("plan", { id: "01ARZ3PARENT00000000003" });
    const doc = makeDoc("task", { parent_id: parent.id });
    const results = runDeterministicChecks(makeBundle(doc, { parent }));
    expect(findCheck(results, "parent_contract")?.outcome).toBe("pass");
  });

  it("HAPPY: knowledge parented under another knowledge passes (self-parenting is explicitly allowed)", () => {
    const parent = makeDoc("knowledge", { id: "01ARZ3PARENT00000000004" });
    const doc = makeDoc("knowledge", { parent_id: parent.id });
    const results = runDeterministicChecks(makeBundle(doc, { parent }));
    expect(findCheck(results, "parent_contract")?.outcome).toBe("pass");
  });

  it("HAPPY: a spec with no parent passes (spec is parentless, BR-1)", () => {
    const doc = makeDoc("spec", { parent_id: null });
    const results = runDeterministicChecks(makeBundle(doc));
    expect(findCheck(results, "parent_contract")?.outcome).toBe("pass");
  });

  it("NEGATIVE: a spec WITH a resolved parent fails (BR-2: a spec is never filed under a document)", () => {
    const parent = makeDoc("prd", { id: "01ARZ3PARENT00000000009" });
    const doc = makeDoc("spec", { parent_id: parent.id });
    const results = runDeterministicChecks(makeBundle(doc, { parent }));
    expect(findCheck(results, "parent_contract")?.outcome).toBe("fail");
  });

  it("NEGATIVE: a task parented under a spec fails (task only allows plan)", () => {
    const parent = makeDoc("spec", { id: "01ARZ3PARENT00000000005" });
    const doc = makeDoc("task", { parent_id: parent.id });
    const results = runDeterministicChecks(makeBundle(doc, { parent }));
    const check = findCheck(results, "parent_contract");
    expect(check?.outcome).toBe("fail");
    expect(check?.detail).toContain("spec");
  });

  it("NEGATIVE: a prd WITH a parent still fails — prd is root, so any resolved parent is invalid", () => {
    const parent = makeDoc("spec", { id: "01ARZ3PARENT00000000006" });
    const doc = makeDoc("prd", { parent_id: parent.id });
    const results = runDeterministicChecks(makeBundle(doc, { parent }));
    expect(findCheck(results, "parent_contract")?.outcome).toBe("fail");
  });

  it("REGRESSION: ROOT_TYPES contains only 'prd' — every other parented type without a parent fails (spec is parentless, BR-1)", () => {
    const nonRootTypes: DocType[] = ["adr", "plan", "task", "knowledge"];
    for (const type of nonRootTypes) {
      const doc = makeDoc(type, { parent_id: null });
      const results = runDeterministicChecks(makeBundle(doc));
      expect(findCheck(results, "parent_contract")?.outcome).toBe("fail");
    }
  });

  it("NEVER produces 'skipped'", () => {
    const results = runDeterministicChecks(makeBundle(makeDoc("prd")));
    expect(findCheck(results, "parent_contract")?.outcome).not.toBe("skipped");
  });
});

// ─── Check: tree_position ────────────────────────────────────────────────────

const SIMPLE_BLUEPRINT: TreeBlueprint = {
  version: 1,
  root: {
    type: "prd",
    min: 0,
    max: null,
    children: [
      {
        type: "spec",
        min: 0,
        max: null,
        children: [
          {
            type: "plan",
            min: 0,
            max: null,
            children: [
              { type: "task", min: 0, max: null, children: [] },
              { type: "knowledge", min: 0, max: null, children: [] },
            ],
          },
        ],
      },
      // knowledge is ALSO modeled directly under prd — tests the "collect the SET of
      // parent types across the whole tree" semantics, not just the first match found.
      { type: "knowledge", min: 0, max: null, children: [] },
    ],
  },
};

describe("check: tree_position", () => {
  it("SKIPPED (BOUNDARY): blueprint absent → skipped with the exact detail string", () => {
    const doc = makeDoc("spec", { parent_id: "01ARZ3PARENT00000000001" });
    const parent = makeDoc("prd", { id: "01ARZ3PARENT00000000001" });
    const results = runDeterministicChecks(makeBundle(doc, { parent }));
    expect(findCheck(results, "tree_position")).toEqual({
      check: "tree_position",
      outcome: "skipped",
      detail: "no lore.tree.yaml",
    });
  });

  it("HAPPY: root type (prd) with no parent matches the blueprint's root position", () => {
    const doc = makeDoc("prd", { parent_id: null });
    const results = runDeterministicChecks(makeBundle(doc, { blueprint: SIMPLE_BLUEPRINT }));
    expect(findCheck(results, "tree_position")?.outcome).toBe("pass");
  });

  it("HAPPY (spec-fresh-install-probe-fixes-a-fresh-consumer-can-run-the#AC-FIP-1, BR-2/BR-400): a PARENTLESS spec passes — its slot is 'no parent'", () => {
    const doc = makeDoc("spec", { parent_id: null });
    const results = runDeterministicChecks(makeBundle(doc, { blueprint: SIMPLE_BLUEPRINT }));
    expect(findCheck(results, "tree_position")?.outcome).toBe("pass");
  });

  // re-baseline: old assertion "spec under prd passes" -> fails, because BR-2/BR-400 make parentless the only legal
  // spec position (tree-check reports a parented spec as misplaced; review must agree).
  it("NEGATIVE (REGRESSION): a spec that still HAS a parent fails — misplaced, same verdict as check-tree", () => {
    const parent = makeDoc("prd", { id: "01ARZ3PARENT00000000002" });
    const doc = makeDoc("spec", { parent_id: parent.id });
    const results = runDeterministicChecks(makeBundle(doc, { parent, blueprint: SIMPLE_BLUEPRINT }));
    const check = findCheck(results, "tree_position");
    expect(check?.outcome).toBe("fail");
    expect(check?.detail).toContain("takes no parent");
  });

  it("NEGATIVE (control): a parentless task (type that requires a parent) still fails", () => {
    const doc = makeDoc("task", { parent_id: null });
    const results = runDeterministicChecks(makeBundle(doc, { blueprint: SIMPLE_BLUEPRINT }));
    const check = findCheck(results, "tree_position");
    expect(check?.outcome).toBe("fail");
    expect(check?.detail).toContain("(none)");
  });

  it("HAPPY (STATE): knowledge is modeled under BOTH plan and prd — matching EITHER modeled parent passes", () => {
    const planParent = makeDoc("plan", { id: "01ARZ3PARENT00000000003" });
    const docUnderPlan = makeDoc("knowledge", { parent_id: planParent.id });
    const resultsUnderPlan = runDeterministicChecks(
      makeBundle(docUnderPlan, { parent: planParent, blueprint: SIMPLE_BLUEPRINT }),
    );
    expect(findCheck(resultsUnderPlan, "tree_position")?.outcome).toBe("pass");

    const prdParent = makeDoc("prd", { id: "01ARZ3PARENT00000000004" });
    const docUnderPrd = makeDoc("knowledge", { parent_id: prdParent.id });
    const resultsUnderPrd = runDeterministicChecks(
      makeBundle(docUnderPrd, { parent: prdParent, blueprint: SIMPLE_BLUEPRINT }),
    );
    expect(findCheck(resultsUnderPrd, "tree_position")?.outcome).toBe("pass");
  });

  it("NEGATIVE: a type not modeled anywhere in the blueprint fails with 'not modeled' in the detail", () => {
    // adr is not present anywhere in SIMPLE_BLUEPRINT.
    const parent = makeDoc("prd", { id: "01ARZ3PARENT00000000005" });
    const doc = makeDoc("adr", { parent_id: parent.id });
    const results = runDeterministicChecks(makeBundle(doc, { parent, blueprint: SIMPLE_BLUEPRINT }));
    const check = findCheck(results, "tree_position");
    expect(check?.outcome).toBe("fail");
    expect(check?.detail).toContain("not modeled");
  });

  it("NEGATIVE: a modeled type under the WRONG parent type fails", () => {
    // task is only modeled under plan in SIMPLE_BLUEPRINT — parent it under a spec instead.
    const wrongParent = makeDoc("spec", { id: "01ARZ3PARENT00000000006" });
    const doc = makeDoc("task", { parent_id: wrongParent.id });
    const results = runDeterministicChecks(makeBundle(doc, { parent: wrongParent, blueprint: SIMPLE_BLUEPRINT }));
    const check = findCheck(results, "tree_position");
    expect(check?.outcome).toBe("fail");
    expect(check?.detail).not.toBe(undefined);
  });

  it("NEGATIVE: a modeled root type (prd) WITH an actual parent present fails — root expects null parent", () => {
    const parent = makeDoc("spec", { id: "01ARZ3PARENT00000000007" });
    const doc = makeDoc("prd", { parent_id: parent.id });
    const results = runDeterministicChecks(makeBundle(doc, { parent, blueprint: SIMPLE_BLUEPRINT }));
    expect(findCheck(results, "tree_position")?.outcome).toBe("fail");
  });
});

// ─── Check: link_integrity ────────────────────────────────────────────────────

describe("check: link_integrity", () => {
  it("HAPPY: brokenLinkTargets absent → pass", () => {
    const results = runDeterministicChecks(makeBundle(makeDoc("prd")));
    expect(findCheck(results, "link_integrity")).toEqual({ check: "link_integrity", outcome: "pass" });
  });

  it("BOUNDARY: brokenLinkTargets explicitly an empty array → pass, same as absent", () => {
    const results = runDeterministicChecks(makeBundle(makeDoc("prd"), { brokenLinkTargets: [] }));
    expect(findCheck(results, "link_integrity")?.outcome).toBe("pass");
  });

  it("NEGATIVE: a single broken link target fails and names it in detail", () => {
    const results = runDeterministicChecks(
      makeBundle(makeDoc("prd"), { brokenLinkTargets: ["01ARZ3BROKEN0000000001"] }),
    );
    const check = findCheck(results, "link_integrity");
    expect(check?.outcome).toBe("fail");
    expect(check?.detail).toContain("01ARZ3BROKEN0000000001");
  });

  it("NEGATIVE: multiple broken link targets are all named in detail", () => {
    const results = runDeterministicChecks(
      makeBundle(makeDoc("prd"), {
        brokenLinkTargets: ["01ARZ3BROKEN0000000001", "01ARZ3BROKEN0000000002"],
      }),
    );
    const check = findCheck(results, "link_integrity");
    expect(check?.outcome).toBe("fail");
    expect(check?.detail).toContain("01ARZ3BROKEN0000000001");
    expect(check?.detail).toContain("01ARZ3BROKEN0000000002");
  });

  it("NEVER produces 'skipped'", () => {
    const passResults = runDeterministicChecks(makeBundle(makeDoc("prd")));
    expect(findCheck(passResults, "link_integrity")?.outcome).not.toBe("skipped");
    const failResults = runDeterministicChecks(
      makeBundle(makeDoc("prd"), { brokenLinkTargets: ["01ARZ3BROKEN0000000003"] }),
    );
    expect(findCheck(failResults, "link_integrity")?.outcome).not.toBe("skipped");
  });
});

// ─── Check: evidence_completeness ───────────────────────────────────────────

describe("check: evidence_completeness", () => {
  it("SKIPPED: any non-task doc type skips with the exact detail string", () => {
    const nonTaskTypes: DocType[] = ["prd", "spec", "adr", "plan", "knowledge"];
    for (const type of nonTaskTypes) {
      const results = runDeterministicChecks(makeBundle(makeDoc(type)));
      expect(findCheck(results, "evidence_completeness")).toEqual({
        check: "evidence_completeness",
        outcome: "skipped",
        detail: "not a task doc",
      });
    }
  });

  it("HAPPY: a task with a non-empty verification_evidence array passes", () => {
    const doc = makeDoc("task", {
      extra: {
        plan_id: "01ARZ3PLAN0000000000001",
        verification_evidence: [
          { oracle: "tsc", command: "bun run typecheck", result: "pass", recorded_at: "2026-07-01T00:00:00.000Z", recorded_by: "alice" },
        ],
      },
    });
    const results = runDeterministicChecks(makeBundle(doc));
    expect(findCheck(results, "evidence_completeness")?.outcome).toBe("pass");
  });

  it("NEGATIVE: a task with an empty verification_evidence array fails", () => {
    const doc = makeDoc("task", {
      extra: { plan_id: "01ARZ3PLAN0000000000001", verification_evidence: [] },
    });
    const results = runDeterministicChecks(makeBundle(doc));
    const check = findCheck(results, "evidence_completeness");
    expect(check?.outcome).toBe("fail");
    expect(check?.detail).toContain("verification_evidence");
  });

  it("NEGATIVE: a task with no verification_evidence key at all fails", () => {
    const doc = makeDoc("task", { extra: { plan_id: "01ARZ3PLAN0000000000001" } });
    const results = runDeterministicChecks(makeBundle(doc));
    expect(findCheck(results, "evidence_completeness")?.outcome).toBe("fail");
  });

  it("BOUNDARY: a non-array verification_evidence value fails rather than throwing", () => {
    const doc = makeDoc("task", {
      extra: { plan_id: "01ARZ3PLAN0000000000001", verification_evidence: "not-an-array" },
    });
    expect(() => runDeterministicChecks(makeBundle(doc))).not.toThrow();
    const results = runDeterministicChecks(makeBundle(doc));
    expect(findCheck(results, "evidence_completeness")?.outcome).toBe("fail");
  });
});
