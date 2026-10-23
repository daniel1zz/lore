/**
 * task-deprecating-a-spec-retires-its-proposed-rule-ids-in-the (BR-1307 restated).
 *
 * Deprecating a spec and retiring its still-proposed rule ids are ONE outcome through the corpus's one write
 * route: both are committed, or the deprecation is refused naming the retiring failure and nothing is written
 * (the spec keeps its previous status, every proposed id stays proposed). No "re-run `lore rule apply`" seam.
 *
 * Dimensions (InMemoryStore):
 *   HAPPY       a successful deprecation retires the ids "never landed: <spec>" in the same command
 *   NEGATIVE    a landing port whose retire step fails refuses the deprecation; status and ids unchanged
 *   ERROR       a leaf that moves between planning and writing rolls the spec status back too (one transaction)
 *   REGRESSION  the refusal never tells the operator to finish by re-running `lore rule apply`
 *   BOUNDARY    a spec with no proposed ids deprecates with no leaf write
 */

import { describe, it, expect } from "vitest";
import { err } from "@lore/core";
import type { DocId, DocRecord } from "@lore/core";
import { makeSpec, makeWorld, reload, scriptCriterion, type World } from "./rule-change-world.js";
import type { RuleChangeLandingPort } from "../../../src/service/rule-landing-port.js";

const ADD = { op: "add" as const, leaf: "leaf-a", statement: "A rule that never lands", examples: ["e"], enforced_by: "guaranteed" as const };

async function approvedSpecWithProposal(world: World, title: string): Promise<{ spec: DocRecord; ruleId: string }> {
  const spec = await makeSpec(world, title);
  const proposed = await world.changes.propose(spec.slug, ADD);
  if (!proposed.ok) throw new Error(`propose failed: ${JSON.stringify(proposed.error)}`);
  const ruleId = proposed.value.change.id;
  const cited = await world.ac.addCriterion(spec.slug, scriptCriterion("AC-X-1", [ruleId]));
  if (!cited.ok) throw new Error(`cite failed: ${JSON.stringify(cited.error)}`);
  const current = await reload(world, spec.id);
  const approved = await world.store.update(spec.id, { status: "approved", version: current.version + 1 }, { expected_version: current.version });
  if (!approved.ok) throw new Error("approve failed");
  return { spec: await reload(world, spec.id), ruleId };
}

async function lifecycleOf(world: World, ruleId: string): Promise<string | undefined> {
  const rows = await world.store.listRuleRegistry();
  if (!rows.ok) throw new Error("registry read failed");
  return rows.value.find((r) => r.id === ruleId)?.lifecycle;
}

const RETIRE_FAILURE = { code: "VALIDATION_ERROR" as const, field: "rule_changes", message: "retiring the proposed ids failed on purpose" };

/** A landing port whose retire step fails, whichever way the corpus asks it to retire. */
function failingPort(): RuleChangeLandingPort {
  return {
    apply: async () => err(RETIRE_FAILURE),
    planAbandonment: async () => err(RETIRE_FAILURE),
    planRevival: async () => err(RETIRE_FAILURE),
  };
}

describe("task-deprecating-a-spec-retires-its-proposed-rule-ids-in-the", () => {
  it("HAPPY: a successful deprecation retires the proposed ids 'never landed: <spec>' in the same command", async () => {
    const world = await makeWorld();
    const { spec, ruleId } = await approvedSpecWithProposal(world, "Happy deprecation");
    const leaf0 = await reload(world, world.leafId);

    const deprecated = await world.corpus.set(spec.slug, { status: "deprecated" });

    expect(deprecated.ok).toBe(true);
    expect((await reload(world, spec.id)).status).toBe("deprecated");
    const leaf1 = await reload(world, world.leafId);
    expect(leaf1.version).toBe(leaf0.version + 1);
    const rules = leaf1.extra["rules"] as Array<Record<string, unknown>>;
    expect(rules.find((r) => r["id"] === ruleId)).toMatchObject({ lifecycle: "retired", retired_note: `never landed: ${spec.slug}` });
    expect(await lifecycleOf(world, ruleId)).toBe("retired");
  });

  it("NEGATIVE: a landing port whose retire step fails refuses the deprecation and writes nothing", async () => {
    const world = await makeWorld();
    const { spec, ruleId } = await approvedSpecWithProposal(world, "Refused deprecation");
    const specBefore = await reload(world, spec.id);
    const leafBefore = await reload(world, world.leafId);
    world.corpus.setRuleChangeLanding(failingPort());

    const refused = await world.corpus.set(spec.slug, { status: "deprecated" });

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.code).toBe("VALIDATION_ERROR");
    const specAfter = await reload(world, spec.id);
    expect(specAfter.status).toBe("approved");
    expect(specAfter.version).toBe(specBefore.version);
    expect((await reload(world, world.leafId)).version).toBe(leafBefore.version);
    expect(await lifecycleOf(world, ruleId)).toBe("proposed");
  });

  it("REGRESSION: the refusal names the retiring failure and never says to re-run `lore rule apply`", async () => {
    const world = await makeWorld();
    const { spec } = await approvedSpecWithProposal(world, "Message check");
    world.corpus.setRuleChangeLanding(failingPort());

    const refused = await world.corpus.set(spec.slug, { status: "deprecated" });

    expect(refused.ok).toBe(false);
    if (refused.ok || refused.error.code !== "VALIDATION_ERROR") return;
    expect(refused.error.message).toContain("retiring the proposed ids failed on purpose");
    expect(refused.error.message).not.toContain("lore rule apply");
    expect(refused.error.message).not.toContain("is now deprecated");
  });

  it("ERROR: a leaf that changes between planning and writing rolls the spec's status back (one transaction)", async () => {
    const world = await makeWorld();
    const { spec, ruleId } = await approvedSpecWithProposal(world, "Racing deprecation");
    const specBefore = await reload(world, spec.id);
    const racing: RuleChangeLandingPort = {
      apply: (ref, opts) => world.changes.apply(ref, opts),
      planRevival: (ref, opts) => world.changes.planRevival(ref, opts),
      planAbandonment: async (ref, opts) => {
        const plan = await world.changes.planAbandonment(ref, opts);
        // a concurrent writer bumps the leaf after the plan was read: the companion write's CAS must miss
        const leaf = await reload(world, world.leafId);
        const bumped = await world.store.update(world.leafId as DocId, { version: leaf.version + 1 }, { expected_version: leaf.version });
        if (!bumped.ok) throw new Error("race setup failed");
        return plan;
      },
    };
    world.corpus.setRuleChangeLanding(racing);

    const refused = await world.corpus.set(spec.slug, { status: "deprecated" });

    expect(refused.ok).toBe(false);
    const specAfter = await reload(world, spec.id);
    expect(specAfter.status).toBe("approved");
    expect(specAfter.version).toBe(specBefore.version);
    expect(await lifecycleOf(world, ruleId)).toBe("proposed");
  });

  it("BOUNDARY: a spec with no proposed ids deprecates and writes no leaf", async () => {
    const world = await makeWorld();
    const spec = await makeSpec(world, "Nothing proposed");
    const draft = await reload(world, spec.id);
    const approved = await world.store.update(spec.id, { status: "approved", version: draft.version + 1 }, { expected_version: draft.version });
    if (!approved.ok) throw new Error("approve failed");
    const leaf0 = await reload(world, world.leafId);

    const deprecated = await world.corpus.set(spec.slug, { status: "deprecated" });

    expect(deprecated.ok).toBe(true);
    expect((await reload(world, spec.id)).status).toBe("deprecated");
    expect((await reload(world, world.leafId)).version).toBe(leaf0.version);
  });
});
