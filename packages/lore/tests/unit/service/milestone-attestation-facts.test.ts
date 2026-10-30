/**
 * @spec_ref spec-a-plan-s-tests-and-criteria-are-measured-once-at-its (AC-AO-3, BR-1498)
 * @layer reader AC-AO-3
 * (reader tests of corpus inputs; the decisions, criteria run once at the assessed commit, are owned by criteria-at-head.test.ts)
 *
 * Readers of the corpus for the criteria facts, over hand-built docs (no corpus, no git is touched). The landing-bound
 * cases this file held (bound-to-landing attestations, the post-landing batch attesting at landing commits) are superseded
 * by AC-AO-3 and deleted: attestationFacts, attestLandedCriteria, LandingAttesterPort and MainFirstParentPort no longer exist.
 *
 * Dimensions: HAPPY (live criteria in scope, superseded dropped), NEGATIVE (unstamped rows never read), BOUNDARY (no plan
 * lineage attributes nothing), STATE (an ad-hoc task counts for its recorded governing spec only).
 */

import { describe, expect, it } from "vitest";
import type { DocRecord } from "@lore/core";
import { attestationRowsOf, planCriterionScopes } from "../../../src/service/milestone-attestation-facts.js";

const L = "a".repeat(40);

describe("readers of the corpus for the criteria facts", () => {
  const doc = (over: Partial<DocRecord> & { extra: Record<string, unknown>; slug: string; id: string; type: DocRecord["type"] }): DocRecord =>
    ({ title: over.slug, status: "approved", content: "", parent_id: null, deleted_at: null, version: 1, tags: [], ...over }) as unknown as DocRecord;
  const attestation = (stamp: boolean) => ({
    runner: "lore-cli",
    exit_code: 0,
    duration_ms: 1,
    timed_out: false,
    ...(stamp ? { state_stamp: { head_sha: L, worktree_dirty: false } } : {}),
  });
  const evidence = (ac: string, stamp: boolean, result = "pass") => ({
    oracle: "test",
    command: "bun test",
    result,
    recorded_at: "2026-10-29T10:00:00.000Z",
    recorded_by: "agent:x",
    ac_ref: ac,
    attestation: attestation(stamp),
  });
  const spec = doc({
    id: "S1",
    slug: "spec-one",
    type: "spec",
    extra: {
      acceptance_criteria: [
        { id: "AC-1", statement: "s", verify: { mode: "script", oracle: "test", command: "true" } },
        { id: "AC-2", statement: "s", verify: { mode: "ai", rubric: "r" } },
        { id: "AC-3", statement: "s", verify: { mode: "script", oracle: "test", command: "true" }, superseded_by: { spec: "other", ac: "AC-3", reason: "moved", at: "2026-10-29T10:00:00.000Z", by: "x" } },
      ],
    },
  });
  const plan = doc({ id: "P1", slug: "plan-one", type: "plan", parent_id: "S1" as never, extra: {} });
  const taskDoc = (): DocRecord =>
    doc({
      id: "T1",
      slug: "task-one",
      type: "task",
      extra: { plan_id: "P1", ac_scope: ["AC-1", "AC-2", "AC-3"], verification_evidence: [evidence("AC-1", true), evidence("AC-1", false, "fail")] },
    });

  it("AC-AO-3 HAPPY: scopes keep live criteria in scope with their holders; superseded ones are dropped", () => {
    const scopes = planCriterionScopes(spec, [taskDoc()]);
    expect(scopes.map((s) => [s.ac_id, s.mode, s.holders.map((h) => h.task_slug)])).toEqual([
      ["AC-1", "script", ["task-one"]],
      ["AC-2", "ai", ["task-one"]],
    ]);
  });

  it("AC-AO-3 NEGATIVE: only stamped, conclusive attested rows are read; an unstamped one never decides", () => {
    const rows = attestationRowsOf([spec], [plan], [taskDoc()]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ doc_slug: "spec-one", ac_id: "AC-1", head_sha: L, result: "pass" });
  });

  it("AC-AO-3 BOUNDARY: a task with no plan lineage and no recorded spec attributes nothing, even when one spec declares the criterion (BR-1495)", () => {
    const adhoc = doc({ id: "T2", slug: "adhoc", type: "task", extra: { adhoc: true, ac_scope: ["AC-1"], verification_evidence: [evidence("AC-1", true)] } });
    expect(attestationRowsOf([spec], [plan], [adhoc])).toHaveLength(0);
    const recorded = doc({ id: "T4", slug: "adhoc-rec", type: "task", extra: { adhoc: true, ac_scope: ["AC-1"], governing_spec: spec.id, verification_evidence: [evidence("AC-1", true)] } });
    expect(attestationRowsOf([spec], [plan], [recorded])).toHaveLength(1);
  });

  it("AC-AO-3 STATE: an ad-hoc task that recorded its governing spec counts for that spec only, even when another spec declares the same id (BR-1495)", () => {
    const twin = doc({ id: "S2", slug: "spec-two", type: "spec", extra: { acceptance_criteria: [{ id: "AC-1", statement: "s", verify: { mode: "human" } }] } });
    const recorded = doc({ id: "T3", slug: "adhoc-recorded", type: "task", extra: { adhoc: true, ac_scope: ["AC-1"], governing_spec: twin.id, verification_evidence: [evidence("AC-1", true)] } });
    const rows = attestationRowsOf([spec, twin], [plan], [recorded]);
    expect(rows.map((r) => r.doc_slug)).toEqual(["spec-two"]);
  });
});
