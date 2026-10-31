/**
 * Seed templates `plan` and `task` (assets/templates/plan.json, task.json) parse under `parseTemplate`
 * and carry the fields, markers, dimensions and checks the structured-documents spec requires.
 *
 * Dimensions: HAPPY (parse, sample documents validate), NEGATIVE (missing required field, bad `kind`),
 *   BOUNDARY (kind enum edges, optional system-filled fields), REGRESSION (render paths all resolve).
 *
 * @spec_ref AC-ST-8
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseTemplate, renderDocument, validateDocument, type Template } from "@lore/core";

const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");

function load(name: "plan" | "task"): Template {
  const raw: unknown = JSON.parse(readFileSync(join(REPO_ROOT, "assets", "templates", `${name}.json`), "utf8"));
  const parsed = parseTemplate(raw);
  if (!parsed.ok) throw new Error(`${name}.json: ${JSON.stringify(parsed.error)}`);
  return parsed.value;
}

type Props = Record<string, Record<string, unknown>>;
const props = (t: Template): Props => (t.fields as { properties: Props }).properties;
const required = (t: Template): string[] => (t.fields as { required?: string[] }).required ?? [];

describe("seed template plan", () => {
  const plan = load("plan");
  it("HAPPY: parses as doc_type plan v1 with the two required checks", () => {
    expect(plan.doc_type).toBe("plan");
    expect(plan.version).toBe(1);
    expect([...plan.checks].sort()).toEqual(["goal-has-measure", "refs-resolve"]);
  });
  it("HAPPY: carries the spec-listed fields with their markers", () => {
    const p = props(plan);
    for (const f of ["goal", "spec_ref", "issues", "phases", "task_criteria_map", "corpus_steps", "after_landing_steps", "close_condition"]) {
      expect(p[f], f).toBeDefined();
    }
    expect(p.goal!["x-goal"]).toBe(true);
    expect(p.task_criteria_map!["x-ref-list"]).toBe(true);
  });
  it("HAPPY: dimensions are ordering, criteria-coverage, close-condition, concurrency, cost; coverage needs refs", () => {
    expect(plan.dimensions.map((d) => d.id)).toEqual(["ordering", "criteria-coverage", "close-condition", "concurrency", "cost"]);
    expect(plan.dimensions.find((d) => d.id === "criteria-coverage")?.needs_refs).toBe(true);
  });
  it("HAPPY: a sample document validates and renders", () => {
    const fields = {
      goal: { statement: "g", measure: "m" },
      spec_ref: "spec-x",
      phases: [{ name: "P1", description: "d", why_this_order: "w" }],
      task_criteria_map: ["AC-X-1"],
      close_condition: "all tasks done",
    };
    const dims = plan.dimensions.map((d) => ({ id: d.id, status: "handled" as const, answer: "a", refs: ["AC-X-1"] }));
    expect(validateDocument(plan, fields, dims).ok).toBe(true);
    expect(renderDocument(plan, fields)).toContain("P1");
  });
  it("NEGATIVE: a plan without goal or close_condition is refused", () => {
    expect(validateDocument(plan, { spec_ref: "spec-x" }, []).ok).toBe(false);
  });
});

describe("seed template task", () => {
  const task = load("task");
  it("HAPPY: parses as doc_type task v1 with refs-resolve", () => {
    expect(task.doc_type).toBe("task");
    expect(task.version).toBe(1);
    expect([...task.checks]).toEqual(["refs-resolve"]);
  });
  it("BOUNDARY: done-contract fields exist; kind is required, system-filled fields are optional", () => {
    const p = props(task);
    for (const f of ["kind", "objective", "spec_ref", "ac_scope", "anchors", "issues_resolved", "done_condition", "approach",
      "done_contract", "write_set", "red_waiver_reason", "execution_log_refs"]) {
      expect(p[f], f).toBeDefined();
    }
    expect(required(task)).toContain("kind");
    expect(required(task)).not.toContain("done_contract");
    expect(required(task)).not.toContain("write_set");
    expect(p.kind!.enum).toEqual(["code", "check", "corpus"]);
    expect(p.ac_scope!["x-ref-list"]).toBe(true);
  });
  it("HAPPY: dimensions are done-condition, red-first, scope-boundary, concurrency, rollback", () => {
    expect(task.dimensions.map((d) => d.id)).toEqual(["done-condition", "red-first", "scope-boundary", "concurrency", "rollback"]);
  });
  it("HAPPY: a minimal sample validates", () => {
    const fields = { kind: "code", objective: "o", spec_ref: "spec-x", ac_scope: ["AC-X-1"], anchors: ["a.ts"], done_condition: "d" };
    const dims = task.dimensions.map((d) => ({ id: d.id, status: "handled" as const, answer: "a" }));
    expect(validateDocument(task, fields, dims).ok).toBe(true);
  });
  it("NEGATIVE: missing kind and an unknown kind are both refused", () => {
    expect(validateDocument(task, { objective: "o" }, []).ok).toBe(false);
    const bad = validateDocument(task, { kind: "other", objective: "o", spec_ref: "s", ac_scope: [], anchors: [], done_condition: "d" }, []);
    expect(bad.ok).toBe(false);
  });
});
