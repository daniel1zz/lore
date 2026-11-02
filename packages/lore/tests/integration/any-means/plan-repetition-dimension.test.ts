// @reads assets/templates/**
/**
 * AC-AT-2 (spec-helpers-may-change-files-by-any-means-territory-is, S2, BR-1564): the plan seed carries a required
 * `repetition` dimension (does the change repeat one pattern across many sites; which script does it; which sites need
 * hand work; an n/a answer says why). A plan whose dimension answers omit it is refused naming it; with it answered the
 * plan validates. Validated against the shipped seed directly.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { parseTemplate, validateDocument, type Template } from "@lore/core";

const SEED = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..", "assets", "templates", "plan.json");

const FIELDS = {
  goal: { statement: "g", measure: "m" },
  spec_ref: "spec-x",
  phases: [{ name: "P1", description: "d", why_this_order: "w" }],
  task_criteria_map: ["AC-X-1"],
  close_condition: "all tasks done",
};

describe("AC-AT-2 plan seed repetition dimension", () => {
  let plan: Template;
  beforeAll(() => {
    const parsed = parseTemplate(JSON.parse(readFileSync(SEED, "utf8")));
    if (!parsed.ok) throw new Error("plan seed does not parse");
    plan = parsed.value;
  });

  const answers = (skip: string[] = []) =>
    plan.dimensions.filter((d) => !skip.includes(d.id)).map((d) => ({ id: d.id, status: "handled" as const, answer: "a", refs: ["AC-X-1"] }));

  it("AC-AT-2 the seed declares a repetition dimension asking about a repeated pattern and its script", () => {
    const dim = plan.dimensions.find((d) => d.id === "repetition");
    expect(dim).toBeDefined();
    expect(dim!.question).toMatch(/repeat/i);
    expect(dim!.question).toMatch(/script/i);
    expect(dim!.question).toMatch(/hand/i);
  });

  it("AC-AT-2 a plan whose dimensions omit repetition is refused naming it", () => {
    const result = validateDocument(plan, FIELDS, answers(["repetition"]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(JSON.stringify(result.error)).toContain("repetition");
  });

  it("AC-AT-2 a plan with repetition answered validates", () => {
    expect(validateDocument(plan, FIELDS, answers()).ok).toBe(true);
  });

  it("AC-AT-2 an n/a repetition answer validates only with a reason", () => {
    const withNa = (answer: string) => [...answers(["repetition"]), { id: "repetition", status: "na" as const, answer }];
    expect(validateDocument(plan, FIELDS, withNa("one site only, nothing repeats")).ok).toBe(true);
    expect(validateDocument(plan, FIELDS, withNa("")).ok).toBe(false);
  });
});
