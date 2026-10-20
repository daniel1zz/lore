/**
 * AC-BIA-4 (spec-baseline-approval-is-per-item-an-edit-adds-a-pending, BR-1211): `lore rule apply` of a spec writes the
 * APPROVED version of each rule it changes and leaves the leaf approved. A spec that modifies a rule holding a pending direct
 * revision is refused (VALIDATION_ERROR, exit 4), naming the rule, and writes nothing.
 *
 * Service-level over the shared rule change-set world (InMemoryStore): the landing needs a spec, criteria and runner-attested
 * evidence, which the CLI would only reach through a real `lore verify`.
 *
 * Coverage:
 *   HAPPY      landing a modify of an approved rule: the approved statement is the spec's; the leaf stays approved, nothing pending.
 *   NEGATIVE   a pending direct revision of a changed rule refuses the apply (exit 4 class), naming the rule; nothing is written.
 *   BOUNDARY   a pending revision of a rule the spec does NOT change does not block it.
 *   STATE      after the pending revision is discarded the same apply lands.
 *   REGRESSION a landing never demotes the leaf (the old behaviour re-opened its approval).
 */

import { describe, expect, it } from "vitest";
import type { DocRecord, EvidenceEntry } from "@lore/core";
import { exitCode } from "../../src/adapters/cli/utils";
import { makeSpec, makeWorld, reload, scriptCriterion, type World } from "../unit/service/rule-change-world";

const LANDED = "BR-1 as the landed spec words it";

function attestedPass(acRef: string): EvidenceEntry {
  return {
    oracle: "test",
    command: `bunx vitest run ${acRef}`,
    recorded_at: "2026-10-12T10:00:00.000Z",
    recorded_by: "agent:t",
    ac_ref: acRef,
    result: "pass",
    attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1, timed_out: false },
  } as EvidenceEntry;
}

/** A spec modifying BR-1, citing it from AC-A-1, with a runner-attested pass recorded for it. */
async function landableSpec(world: World): Promise<DocRecord> {
  const spec = await makeSpec(world, "Landing spec");
  const proposed = await world.changes.propose(spec.slug, { op: "modify", id: "BR-1", statement: LANDED });
  if (!proposed.ok) throw new Error(`propose failed: ${JSON.stringify(proposed.error)}`);
  const cited = await world.ac.addCriterion(spec.slug, scriptCriterion("AC-A-1", ["BR-1"]));
  if (!cited.ok) throw new Error(`addCriterion failed: ${JSON.stringify(cited.error)}`);
  const stored = await reload(world, spec.id);
  const plan = await world.corpus.create({ type: "plan", title: "Plan of the landing spec", parent_id: spec.id, content: "plan" });
  if (!plan.ok) throw new Error(`plan create failed: ${JSON.stringify(plan.error)}`);
  const task = await world.corpus.create({ type: "task", title: "Task of the landing spec", parent_id: plan.value.id, content: "t", extra: { plan_id: plan.value.id } });
  if (!task.ok) throw new Error(`task create failed: ${JSON.stringify(task.error)}`);
  const written = await world.store.update(task.value.id, { extra: { ...task.value.extra, verification_evidence: [attestedPass("AC-A-1")] } });
  if (!written.ok) throw new Error("evidence write failed");
  return stored;
}

const statementOf = (doc: DocRecord, id: string): unknown => (doc.extra["rules"] as Array<Record<string, unknown>>).find((r) => r["id"] === id)?.["statement"];

describe("AC-BIA-4: a landed change set is approved by its spec", () => {
  it("HAPPY/REGRESSION: apply of a modify of an approved rule writes the approved version and leaves the leaf approved", async () => {
    const world = await makeWorld();
    const spec = await landableSpec(world);
    const leaf0 = await reload(world, world.leafId);
    expect(leaf0.status).toBe("approved");

    const applied = await world.changes.apply(spec.slug, { by: "agent:t" });
    expect(applied.ok).toBe(true);

    const leaf1 = await reload(world, world.leafId);
    expect(statementOf(leaf1, "BR-1")).toBe(LANDED);
    expect(leaf1.status).toBe("approved");
    expect(leaf1.version).toBe(leaf0.version + 1);
    expect(leaf1.extra["pending"]).toBeUndefined();
  });

  it("NEGATIVE: a changed rule holding a pending direct revision refuses the apply (exit 4), naming the rule; nothing is written", async () => {
    const world = await makeWorld();
    const spec = await landableSpec(world);
    const direct = await world.rules.setRule("BR-1", { statement: "A direct revision nobody has approved" }, { by: "test" });
    expect(direct.ok).toBe(true);
    const leaf0 = await reload(world, world.leafId);
    const specBefore = await reload(world, spec.id);

    const refused = await world.changes.apply(spec.slug, { by: "agent:t" });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.code).toBe("VALIDATION_ERROR");
    expect(exitCode(refused.error)).toBe(4);
    expect(JSON.stringify(refused.error)).toContain("BR-1");
    expect(JSON.stringify(refused.error)).toContain("pending direct revision");

    // nothing written: the leaf (approved version and the pending revision) and the spec's change set are as they were
    const leaf1 = await reload(world, world.leafId);
    expect(leaf1.version).toBe(leaf0.version);
    expect(statementOf(leaf1, "BR-1")).toBe(statementOf(leaf0, "BR-1"));
    expect(leaf1.extra["pending"]).toEqual(leaf0.extra["pending"]);
    const specAfter = await reload(world, spec.id);
    expect(specAfter.version).toBe(specBefore.version);
    expect((specAfter.extra["rule_changes"] as Array<{ applied_at?: string }>).every((c) => c.applied_at === undefined)).toBe(true);
  });

  it("STATE: once the pending revision is discarded the same apply lands", async () => {
    const world = await makeWorld();
    const spec = await landableSpec(world);
    await world.rules.setRule("BR-1", { statement: "A direct revision nobody has approved" }, { by: "test" });
    expect((await world.changes.apply(spec.slug, { by: "agent:t" })).ok).toBe(false);

    const discarded = await world.review.rejectItem("leaf-a", "BR-1", { reviewer: "test" });
    expect(discarded.ok).toBe(true);
    const applied = await world.changes.apply(spec.slug, { by: "agent:t" });
    expect(applied.ok).toBe(true);
    const leaf = await reload(world, world.leafId);
    expect(statementOf(leaf, "BR-1")).toBe(LANDED);
    expect(leaf.status).toBe("approved");
  });

  it("BOUNDARY: a pending revision of a rule the spec does not change does not block the landing", async () => {
    const world = await makeWorld();
    const added = await world.rules.addRule("leaf-a", { statement: "A second rule, still pending", confidence: "established", enforced_by: "both", examples: ["e"] }, { by: "test" });
    expect(added.ok).toBe(true);
    const spec = await landableSpec(world);
    const applied = await world.changes.apply(spec.slug, { by: "agent:t" });
    expect(applied.ok).toBe(true);
    const leaf = await reload(world, world.leafId);
    expect(statementOf(leaf, "BR-1")).toBe(LANDED);
    // the other item is untouched: still a pending add, so the leaf is still draft (derived), not demoted by the landing
    expect(Object.keys((leaf.extra["pending"] as { rules: Record<string, unknown> }).rules)).toEqual(["BR-2"]);
  });
});
