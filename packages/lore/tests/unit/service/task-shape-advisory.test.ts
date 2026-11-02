/**
 * Unit tests of the task-body shape fingerprint and the repeated-task advisory (AC-AT-3; BR-1564).
 * Dimensions: HAPPY (3 same-shape tasks grouped), NEGATIVE (dissimilar bodies), BOUNDARY (exactly 2 / exactly 3, empty body),
 * STATE (archived tasks ignored), REGRESSION (each normalisation rule alone).
 */
import { describe, expect, it } from "vitest";
import {
  findRepeatedTaskShapes,
  formatRepeatedTaskAdvisory,
  normaliseTaskShape,
} from "../../../src/service/task-shape-advisory.js";

const task = (slug: string, content: string, status = "draft") => ({ slug, status, content });

describe("normaliseTaskShape", () => {
  it("collapses digits", () => expect(normaliseTaskShape("fix 12 sites")).toBe(normaliseTaskShape("fix 7 sites")));
  it("collapses file paths", () => {
    expect(normaliseTaskShape("edit src/a/b.ts now")).toBe(normaliseTaskShape("edit lib/c.ts now"));
    expect(normaliseTaskShape("edit a.ts now")).toBe(normaliseTaskShape("edit b.json now"));
  });
  it("collapses document slugs, typed ids, ULIDs and kebab slugs", () => {
    expect(normaliseTaskShape("see task-foo-bar")).toBe(normaliseTaskShape("see plan-x"));
    expect(normaliseTaskShape("cite AC-AT-3")).toBe(normaliseTaskShape("cite BR-1564"));
    expect(normaliseTaskShape("id 01M6E0PK5VQF15EBYKJJJCB96S")).toBe(normaliseTaskShape("id 01M6E0PJSK02CM5TC90FC012B5"));
    expect(normaliseTaskShape("rename alpha-beta-gamma")).toBe(normaliseTaskShape("rename one-two-three"));
  });
  it("collapses whitespace and case", () => expect(normaliseTaskShape("A  b\n\nC")).toBe("a b c"));
  it("keeps differing words apart", () => expect(normaliseTaskShape("rename the helper")).not.toBe(normaliseTaskShape("delete the helper")));
});

describe("findRepeatedTaskShapes", () => {
  const same = (n: number) => `Rename helper in src/f${n}.ts across ${n} call sites`;
  it("groups three same-shape open tasks in input order", () => {
    const groups = findRepeatedTaskShapes([task("t1", same(1)), task("t2", same(22)), task("t3", same(333))]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.slugs).toEqual(["t1", "t2", "t3"]);
  });
  it("does not group two", () => expect(findRepeatedTaskShapes([task("t1", same(1)), task("t2", same(2))])).toEqual([]));
  it("does not group three dissimilar bodies", () => {
    expect(findRepeatedTaskShapes([task("a", "add a cache"), task("b", "remove the log"), task("c", "write docs")])).toEqual([]);
  });
  it("ignores archived tasks, so 2 open + 1 archived is no group", () => {
    expect(findRepeatedTaskShapes([task("t1", same(1)), task("t2", same(2)), task("t3", same(3), "archived")])).toEqual([]);
  });
  it("ignores empty bodies", () => expect(findRepeatedTaskShapes([task("a", ""), task("b", "  "), task("c", "\n")])).toEqual([]));
  it("reports two groups separately", () => {
    const g = findRepeatedTaskShapes([
      task("a1", "do x 1"), task("b1", "other thing 1"), task("a2", "do x 2"), task("b2", "other thing 2"), task("a3", "do x 3"), task("b3", "other thing 3"),
    ]);
    expect(g.map((x) => x.slugs)).toEqual([["a1", "a2", "a3"], ["b1", "b2", "b3"]]);
  });
});

describe("formatRepeatedTaskAdvisory", () => {
  it("names the plan and every task and suggests one scripted task", () => {
    const text = formatRepeatedTaskAdvisory({ fingerprint: "f", slugs: ["t1", "t2", "t3"] }, "plan-p");
    for (const s of ["plan-p", "t1", "t2", "t3", "scripted"]) expect(text).toContain(s);
  });
});
