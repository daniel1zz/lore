/**
 * site-declarations (BR-1344): the pure verdict on what a site's code declares, judged against the corpus's rule liveness.
 *
 * Dimensions: HAPPY (one live rule -> declared), NEGATIVE (none -> unmapped; two -> conflict naming both; retired / deprecated /
 * unknown -> that status naming the id), BOUNDARY (no liveness index -> a single id reads as declared; a missing lifecycle reads as
 * unknown, never live), STATE (the index reads every baseline node's `extra.rules`), REGRESSION (a conflict is never resolved by
 * picking the first id).
 * @spec_ref spec-refusal-sites-declare-their-rule-in-code-baseline-leaf#AC-RIC-1
 */
import { describe, expect, it } from "vitest";
import { classifySiteDeclaration, ruleStatusIndexOf } from "../../../src/service/site-declarations.js";

const nodes = [
  { extra: { node: "leaf", rules: [{ id: "BR-1", lifecycle: "live" }, { id: "BR-2", lifecycle: "retired" }] } },
  { extra: { node: "leaf", rules: [{ id: "BR-3", lifecycle: "deprecated" }, { id: "BR-4" }, { lifecycle: "live" }] } },
  { extra: { node: "root" } },
];

describe("ruleStatusIndexOf", () => {
  const statusOf = ruleStatusIndexOf(nodes);

  it("reads the lifecycle of every rule of every node", () => {
    expect(statusOf("BR-1")).toBe("live");
    expect(statusOf("BR-2")).toBe("retired");
    expect(statusOf("BR-3")).toBe("deprecated");
  });

  it("an id no node holds, and a rule with no recognised lifecycle, are unknown (never live)", () => {
    expect(statusOf("BR-99999")).toBe("unknown");
    expect(statusOf("BR-4")).toBe("unknown");
  });
});

describe("classifySiteDeclaration", () => {
  const statusOf = ruleStatusIndexOf(nodes);

  it("one live rule is declared", () => {
    expect(classifySiteDeclaration(["BR-1"], statusOf)).toEqual({ state: "declared", rule: "BR-1" });
  });

  it("no rule is unmapped", () => {
    expect(classifySiteDeclaration([], statusOf)).toEqual({ state: "unmapped" });
  });

  it("two rules are a conflict naming both, in the order given", () => {
    expect(classifySiteDeclaration(["BR-1", "BR-3"], statusOf)).toEqual({ state: "conflict", rules: ["BR-1", "BR-3"] });
  });

  it.each([
    ["BR-2", "retired"],
    ["BR-3", "deprecated"],
    ["BR-99999", "unknown"],
  ] as const)("a declared %s is reported as %s, naming the id", (rule, state) => {
    expect(classifySiteDeclaration([rule], statusOf)).toEqual({ state, rule });
  });

  it("without a liveness index a single id reads as declared (the caller says liveness was unchecked)", () => {
    expect(classifySiteDeclaration(["BR-99999"])).toEqual({ state: "declared", rule: "BR-99999" });
  });

  const predicate = (rule: string, line: number) => ({ rule, file: "p.ts", line, symbol: "check" });

  it("a site that declares nothing takes the rule of the one predicate above it, saying where the predicate is written", () => {
    expect(classifySiteDeclaration([], statusOf, [predicate("BR-1", 7)])).toEqual({ state: "declared", rule: "BR-1", via: predicate("BR-1", 7) });
  });

  it("a shared site reached through predicates of different rules is generic: it lists them and attributes the site to none", () => {
    expect(classifySiteDeclaration([], statusOf, [predicate("BR-1", 7), predicate("BR-3", 20)])).toEqual({
      state: "generic",
      rules: ["BR-1", "BR-3"],
      predicates: [predicate("BR-1", 7), predicate("BR-3", 20)],
    });
  });

  it("the site's own declaration wins over the predicate above it", () => {
    expect(classifySiteDeclaration(["BR-1"], statusOf, [predicate("BR-3", 20)])).toEqual({ state: "declared", rule: "BR-1" });
  });

  it("a predicate declaring a retired rule is reported retired, with the predicate", () => {
    expect(classifySiteDeclaration([], statusOf, [predicate("BR-2", 9)])).toEqual({ state: "retired", rule: "BR-2", via: predicate("BR-2", 9) });
  });

  it("no declaration and no predicate is unmapped", () => {
    expect(classifySiteDeclaration([], statusOf, [])).toEqual({ state: "unmapped" });
  });
});
