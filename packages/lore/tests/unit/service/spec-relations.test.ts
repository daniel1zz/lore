/**
 * Unit tests for the pure Implements / Implemented by computation (AC-BLS3B-4, BR-1008).
 * Dimensions: HAPPY, BOUNDARY (count 3 over 2 specs), NEGATIVE (missing/retired rule listed, malformed skipped),
 * STATE (archived spec reported with its status), REGRESSION (a branch node carries no view).
 */
import { describe, expect, it } from "vitest";
import type { DocRecord } from "@lore/core";
import {
  computeImplementedBy,
  computeImplements,
  formatImplementedByLines,
  formatImplementsLines,
} from "../../../src/service/spec-relations.js";

function node(slug: string, kind: "leaf" | "standard" | "branch", rules: Array<[string, string]>, deleted = false): DocRecord {
  return {
    id: `id-${slug}`,
    slug,
    type: "baseline",
    status: "approved",
    deleted_at: deleted ? "2026-01-01T00:00:00Z" : null,
    extra: {
      node: kind,
      ...(kind === "standard" ? { tree: "architecture" } : {}),
      rules: rules.map(([id, lifecycle]) => ({ id, lifecycle, statement: `s ${id}` })),
    },
  } as unknown as DocRecord;
}

function spec(slug: string, criteria: Array<[string, string[]]>, status = "draft", extra: unknown[] = []): DocRecord {
  return {
    id: `id-${slug}`,
    slug,
    type: "spec",
    status,
    deleted_at: null,
    extra: { acceptance_criteria: [...criteria.map(([id, cites]) => ({ id, cites })), ...extra] },
  } as unknown as DocRecord;
}

const leaf = node("leaf-one", "leaf", [["BR-1", "live"], ["BR-2", "retired"]]);
const std = node("std-one", "standard", [["AS-1", "live"]]);
const branch = node("branch-one", "branch", []);

describe("computeImplements", () => {
  it("HAPPY: resolves rules in both trees to node slug, state and criteria", () => {
    const view = computeImplements(spec("s", [["AC-1", ["BR-1"]], ["AC-2", ["BR-1", "AS-1"]]]), [leaf, std, branch]);
    expect(view.count).toBe(3);
    expect(view.rules).toEqual([
      { rule_id: "BR-1", node_slug: "leaf-one", state: "live", criteria: ["AC-1", "AC-2"] },
      { rule_id: "AS-1", node_slug: "std-one", state: "live", criteria: ["AC-2"] },
    ]);
  });

  it("NEGATIVE: a missing rule is listed with null node and state missing; a retired rule keeps its state", () => {
    const view = computeImplements(spec("s", [["AC-1", ["BR-404", "BR-2"]]]), [leaf]);
    expect(view.count).toBe(2);
    expect(view.rules).toContainEqual({ rule_id: "BR-404", node_slug: null, state: "missing", criteria: ["AC-1"] });
    expect(view.rules).toContainEqual({ rule_id: "BR-2", node_slug: "leaf-one", state: "retired", criteria: ["AC-1"] });
  });

  it("BOUNDARY: no criteria or no cites gives an empty view; a repeated cite in one criterion counts once", () => {
    expect(computeImplements(spec("s", []), [leaf])).toEqual({ rules: [], count: 0 });
    expect(computeImplements(spec("s", [["AC-1", []]]), [leaf]).count).toBe(0);
    expect(computeImplements(spec("s", [["AC-1", ["BR-1", "BR-1"]]]), [leaf]).count).toBe(1);
  });

  it("ERROR: malformed criteria are skipped, never thrown", () => {
    const view = computeImplements(spec("s", [["AC-1", ["BR-1"]]], "draft", [null, "x", { id: 5 }, { id: "AC-9" }]), [leaf]);
    expect(view.count).toBe(1);
  });

  it("a soft-deleted node's rules are not resolved", () => {
    const view = computeImplements(spec("s", [["AC-1", ["BR-1"]]]), [node("gone", "leaf", [["BR-1", "live"]], true)]);
    expect(view.rules[0]?.state).toBe("missing");
  });
});

describe("computeImplementedBy", () => {
  const a = spec("spec-a", [["AC-A-1", ["BR-1"]], ["AC-A-2", ["BR-1"]]]);
  const b = spec("spec-b", [["AC-B-1", ["BR-1"]]], "archived");

  it("BOUNDARY: a rule cited by 3 criteria of 2 specs shows count 3, archived spec included with its status", () => {
    const view = computeImplementedBy(leaf, [a, b]);
    expect(view.count).toBe(3);
    expect(view.citations).toEqual([
      { rule_id: "BR-1", spec: "spec-a", doc_status: "draft", criterion: "AC-A-1" },
      { rule_id: "BR-1", spec: "spec-a", doc_status: "draft", criterion: "AC-A-2" },
      { rule_id: "BR-1", spec: "spec-b", doc_status: "archived", criterion: "AC-B-1" },
    ]);
    expect(view.rules).toEqual([{ rule_id: "BR-1", state: "live" }, { rule_id: "BR-2", state: "retired" }]);
  });

  it("HAPPY: an architecture standard collects AS citations", () => {
    expect(computeImplementedBy(std, [spec("s", [["AC-1", ["AS-1"]]])]).count).toBe(1);
  });

  it("zero citations gives count 0", () => {
    expect(computeImplementedBy(leaf, [spec("s", [["AC-1", ["BR-99"]]])])).toMatchObject({ citations: [], count: 0 });
  });

  it("REGRESSION: a node carrying no rules (branch) has an empty view", () => {
    expect(computeImplementedBy(branch, [a])).toEqual({ rules: [], citations: [], count: 0 });
  });
});

describe("formatters", () => {
  it("render a count line and flag non-live rules", () => {
    const by = formatImplementedByLines(computeImplementedBy(leaf, [spec("s", [["AC-1", ["BR-2"]]])]));
    expect(by).toContain("BR-2 [retired]: s (draft) AC-1");
    expect(by[by.length - 1]).toBe("Count: 1 citation");
    const impl = formatImplementsLines(computeImplements(spec("s", [["AC-1", ["BR-404"]]]), [leaf]));
    expect(impl).toContain("BR-404 -> (no such rule) [missing]: AC-1");
  });
});
