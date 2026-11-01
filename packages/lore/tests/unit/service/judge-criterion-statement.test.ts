/**
 * @spec_ref spec-a-re-review-reuses-the-judge-s-verdict-for-every-unit (AC-JR-2, BR-1535)
 *
 * The assess wiring hands an AI criterion's STATEMENT to the judgment layer, so its verdict key reads statement and rubric together
 * (before this, every AI criterion was keyed by its rubric alone). Hand-built docs; no corpus, no git, no runner.
 *
 * Dimensions: HAPPY (the statement reaches the AI criterion input), NEGATIVE (a script criterion is not an AI criterion),
 * BOUNDARY (a statement edit changes the input), REGRESSION (rubric and ids are unchanged).
 */

import { describe, expect, it } from "vitest";
import { ok, type DocRecord } from "@lore/core";
import { measureCriteriaAtHead, planCriterionScopes } from "../../../src/service/milestone-attestation-facts.js";

const doc = (over: Partial<DocRecord> & { extra: Record<string, unknown>; slug: string; id: string; type: DocRecord["type"] }): DocRecord =>
  ({ title: over.slug, status: "approved", content: "", parent_id: null, deleted_at: null, version: 1, tags: [], ...over }) as unknown as DocRecord;

const spec = (statement: string): DocRecord =>
  doc({
    id: "S1",
    slug: "spec-one",
    type: "spec",
    extra: {
      acceptance_criteria: [
        { id: "AC-1", statement, verify: { mode: "ai", rubric: "The plan reads clearly." } },
        { id: "AC-2", statement: "A script criterion.", verify: { mode: "script", oracle: "test", command: "true" } },
      ],
    },
  });
const task = doc({ id: "T1", slug: "task-one", type: "task", extra: { ac_scope: ["AC-1", "AC-2"] } });

async function aiCriteriaOf(statement: string) {
  const scopes = planCriterionScopes(spec(statement), [task]).filter((s) => s.mode === "ai");
  const facts = await measureCriteriaAtHead({
    scopes,
    headCommit: "a".repeat(40),
    runner: { runCriteria: async () => ok([]) } as never,
    readRows: async () => ok([]),
  });
  return facts.ai_criteria;
}

describe("AI criterion statement in the judgment input", () => {
  it("AC-JR-2 the statement and the rubric both reach the AI criterion input", async () => {
    expect(await aiCriteriaOf("Readers can follow the plan.")).toEqual([
      { spec: "spec-one", ac: "AC-1", rubric: "The plan reads clearly.", statement: "Readers can follow the plan." },
    ]);
  });

  it("AC-JR-2 a statement edit changes the AI criterion input and nothing else", async () => {
    const before = await aiCriteriaOf("Readers can follow the plan.");
    const after = await aiCriteriaOf("Readers can follow the plan and its rollback.");
    expect(after[0]?.statement).not.toBe(before[0]?.statement);
    expect({ ...after[0], statement: "" }).toEqual({ ...before[0], statement: "" });
  });

  it("AC-JR-2 a script criterion is never listed as an AI criterion", async () => {
    const ids = (await aiCriteriaOf("s")).map((c) => c.ac);
    expect(ids).toEqual(["AC-1"]);
  });
});
