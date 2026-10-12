/**
 * AC-CS-1 — a spec's rule change set (`extra.rule_changes`) and its citation (InMemoryStore).
 *
 * Spec: spec-a-spec-carries-its-rule-changes-the-baseline-takes-them (Model, D1, Edge cases).
 * Rules: BR-86 / BR-257 (a criterion cites a live rule OR one its own spec proposes), BR-626, BR-641,
 * BR-1069 (locked-spec correction exit).
 *
 * Dimensions:
 *   HAPPY       (a) propose add reserves the next BR id as registry state `proposed`, leaf rules byte-identical;
 *               (b) own spec cites the proposed id through the ENFORCING gate; (c) modify keeps the leaf text;
 *               (d) rule show of a proposed id names the proposing spec and the proposed text
 *   NEGATIVE    (b) ANOTHER spec citing the proposed id is refused; (c) a second spec modifying the same live id
 *               is refused naming the first; modify/retire of a non-live id refused; (e) locked spec refused
 *   BOUNDARY    an invalid add burns no id; a blank correction reason is refused; ids are never reused
 *   STATE       (e) correction on a locked spec writes ONE version and keeps the status
 *   REGRESSION  `lore set` cannot drop or replace extra.rule_changes
 */

import { describe, it, expect } from "vitest";
import type { DocRecord } from "@lore/core";
import { makeSpec, makeWorld, reload, lockSpec, scriptCriterion, type World } from "./rule-change-world.js";

const ADD = {
  op: "add" as const,
  leaf: "leaf-a",
  statement: "A new rule a spec is about to introduce",
  examples: ["when X then Y"],
  enforced_by: "guaranteed" as const,
};

async function mustPropose(world: World, spec: string, input: Parameters<World["changes"]["propose"]>[1], opts?: Parameters<World["changes"]["propose"]>[2]) {
  const result = await world.changes.propose(spec, input, opts);
  if (!result.ok) throw new Error(`propose failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

async function registryOf(world: World, id: string) {
  const rows = await world.store.listRuleRegistry();
  if (!rows.ok) throw new Error("registry read failed");
  return rows.value.find((row) => row.id === id);
}

describe("rule change set: propose (AC-CS-1a)", () => {
  it("HAPPY: add reserves the next BR id as `proposed` and leaves the leaf's rules byte-identical", async () => {
    const world = await makeWorld();
    const spec = await makeSpec(world, "Spec A");
    const before = JSON.stringify((await reload(world, world.leafId)).extra["rules"]);
    const proposed = await mustPropose(world, spec.slug, ADD);
    expect(proposed.change).toMatchObject({ op: "add", id: "BR-2", leaf: "leaf-a" });
    expect((await registryOf(world, "BR-2"))?.lifecycle).toBe("proposed");
    expect(JSON.stringify((await reload(world, world.leafId)).extra["rules"])).toBe(before);
    const stored = (await reload(world, spec.id)).extra["rule_changes"] as Array<{ id: string }>;
    expect(stored.map((c) => c.id)).toEqual(["BR-2"]);
  });

  it("BOUNDARY: ids are permanent - a second add gets BR-3 and a later live add gets BR-4", async () => {
    const world = await makeWorld();
    const spec = await makeSpec(world, "Spec A");
    await mustPropose(world, spec.slug, ADD);
    const second = await mustPropose(world, spec.slug, { ...ADD, statement: "Another rule" });
    expect(second.change).toMatchObject({ id: "BR-3" });
    const live = await world.rules.addRule("leaf-a", { statement: "Direct live add", confidence: "established", enforced_by: "both", examples: ["e"] }, { by: "test" });
    expect(live.ok && live.value.ruleId).toBe("BR-4");
  });

  it("BOUNDARY: an invalid add (no example / unknown leaf) is refused and burns no id", async () => {
    const world = await makeWorld();
    const spec = await makeSpec(world, "Spec A");
    const noExample = await world.changes.propose(spec.slug, { ...ADD, examples: [] });
    expect(noExample.ok).toBe(false);
    const noLeaf = await world.changes.propose(spec.slug, { ...ADD, leaf: "no-such-leaf" });
    expect(noLeaf.ok).toBe(false);
    const rows = await world.store.listRuleRegistry();
    expect(rows.ok && rows.value.map((r) => r.id)).toEqual(["BR-1"]);
    expect((await reload(world, spec.id)).extra["rule_changes"]).toBeUndefined();
  });

  it("HAPPY: modify keeps the leaf's current statement until apply and is listed by changes()", async () => {
    const world = await makeWorld();
    const spec = await makeSpec(world, "Spec A");
    const leafBefore = JSON.stringify((await reload(world, world.leafId)).extra["rules"]);
    await mustPropose(world, spec.slug, { op: "modify", id: "BR-1", statement: "A rewritten statement" });
    expect(JSON.stringify((await reload(world, world.leafId)).extra["rules"])).toBe(leafBefore);
    const listed = await world.changes.changes(spec.slug);
    expect(listed.ok && listed.value.changes).toEqual([{ op: "modify", id: "BR-1", statement: "A rewritten statement" }]);
    expect((await registryOf(world, "BR-1"))?.lifecycle).toBe("live");
  });

  it("HAPPY: retire names a live id and a note; the same spec re-proposing an id replaces its entry", async () => {
    const world = await makeWorld();
    const spec = await makeSpec(world, "Spec A");
    await mustPropose(world, spec.slug, { op: "modify", id: "BR-1", statement: "First wording" });
    await mustPropose(world, spec.slug, { op: "retire", id: "BR-1", note: "replaced by BR-9" });
    const listed = await world.changes.changes(spec.slug);
    expect(listed.ok && listed.value.changes).toEqual([{ op: "retire", id: "BR-1", note: "replaced by BR-9" }]);
  });

  it("NEGATIVE: modify/retire of an unknown id, a proposed id, or retire without a note is refused", async () => {
    const world = await makeWorld();
    const spec = await makeSpec(world, "Spec A");
    const proposed = await mustPropose(world, spec.slug, ADD);
    expect((await world.changes.propose(spec.slug, { op: "modify", id: "BR-77", statement: "x" })).ok).toBe(false);
    expect((await world.changes.propose(spec.slug, { op: "modify", id: proposed.change.id, statement: "x" })).ok).toBe(false);
    expect((await world.changes.propose(spec.slug, { op: "retire", id: "BR-1", note: "  " })).ok).toBe(false);
    expect((await world.changes.propose(spec.slug, { op: "modify", id: "BR-1" })).ok).toBe(false);
  });
});

describe("rule change set: citation (AC-CS-1b)", () => {
  it("HAPPY: a criterion of the SAME spec citing its proposed id passes the enforcing gate", async () => {
    const world = await makeWorld();
    const spec = await makeSpec(world, "Spec A");
    const { change } = await mustPropose(world, spec.slug, ADD);
    const added = await world.ac.addCriterion(spec.slug, scriptCriterion("AC-A-1", [change.id]));
    expect(added.ok).toBe(true);
  });

  it("NEGATIVE: a criterion of ANOTHER spec citing that proposed id is refused", async () => {
    const world = await makeWorld();
    const specA = await makeSpec(world, "Spec A");
    const specB = await makeSpec(world, "Spec B");
    const { change } = await mustPropose(world, specA.slug, ADD);
    const refused = await world.ac.addCriterion(specB.slug, scriptCriterion("AC-B-1", [change.id]));
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("AC_CITE_REQUIRED");
    expect((await reload(world, specB.id)).extra["acceptance_criteria"]).toBeUndefined();
  });

  it("NEGATIVE: an id nobody proposed or holds stays refused (control)", async () => {
    const world = await makeWorld();
    const spec = await makeSpec(world, "Spec A");
    const refused = await world.ac.addCriterion(spec.slug, scriptCriterion("AC-A-1", ["BR-99"]));
    expect(refused.ok).toBe(false);
  });

  it("HAPPY: a live rule is still citable by any spec", async () => {
    const world = await makeWorld();
    const spec = await makeSpec(world, "Spec B");
    expect((await world.ac.addCriterion(spec.slug, scriptCriterion("AC-B-1", ["BR-1"]))).ok).toBe(true);
  });
});

describe("rule change set: one spec per live id (AC-CS-1c)", () => {
  it("NEGATIVE: a second spec proposing to modify the same live id is refused, naming the first", async () => {
    const world = await makeWorld();
    const specA = await makeSpec(world, "Spec A");
    const specB = await makeSpec(world, "Spec B");
    await mustPropose(world, specA.slug, { op: "modify", id: "BR-1", statement: "A's wording" });
    const second = await world.changes.propose(specB.slug, { op: "modify", id: "BR-1", statement: "B's wording" });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe("VALIDATION_ERROR");
      expect("message" in second.error && second.error.message).toContain(specA.slug);
    }
    const retire = await world.changes.propose(specB.slug, { op: "retire", id: "BR-1", note: "gone" });
    expect(retire.ok).toBe(false);
    expect((await reload(world, specB.id)).extra["rule_changes"]).toBeUndefined();
  });
});

describe("rule show of a proposed id (AC-CS-1d)", () => {
  it("HAPPY: reports 'proposed by <spec>' with the proposed text and is not a baseline rule", async () => {
    const world = await makeWorld();
    const spec = await makeSpec(world, "Spec A");
    const { change } = await mustPropose(world, spec.slug, ADD);
    const shown = await world.read.show(change.id);
    expect(shown.ok).toBe(true);
    if (shown.ok) {
      expect(shown.value.state).toBe("proposed");
      expect(shown.value.proposed_by).toBe(spec.slug);
      expect(shown.value.statement).toBe(ADD.statement);
    }
  });

  it("NEGATIVE: a never-allocated id is still not found", async () => {
    const world = await makeWorld();
    expect((await world.read.show("BR-50")).ok).toBe(false);
  });
});

describe("rule change set on a locked spec (AC-CS-1e, BR-1069)", () => {
  async function lockedSpec(world: World): Promise<DocRecord> {
    const spec = await makeSpec(world, "Locked spec");
    await lockSpec(world, spec);
    return reload(world, spec.id);
  }

  it("NEGATIVE: propose is refused on a locked spec without --correction and writes nothing", async () => {
    const world = await makeWorld();
    const spec = await lockedSpec(world);
    const refused = await world.changes.propose(spec.slug, ADD);
    expect(refused.ok).toBe(false);
    if (!refused.ok && refused.error.code === "VALIDATION_ERROR") expect(refused.error.field).toBe("gate:record-edit");
    expect((await reload(world, spec.id)).version).toBe(spec.version);
    expect(await registryOf(world, "BR-2")).toBeUndefined();
  });

  it("HAPPY: with a correction it writes ONE version, keeps the status and records the reason", async () => {
    const world = await makeWorld();
    const spec = await lockedSpec(world);
    const result = await world.changes.propose(spec.slug, ADD, { correction: { reason: "criterion cites a rule we forgot" } });
    expect(result.ok).toBe(true);
    const after = await reload(world, spec.id);
    expect(after.status).toBe("approved");
    expect(after.version).toBe(spec.version + 1);
    const versions = await world.store.findVersions(spec.id, { limit: 100 });
    const last = versions.ok ? versions.value.find((v) => v.version === after.version) : undefined;
    expect(last?.change_summary).toContain("Correction: criterion cites a rule we forgot");
    expect((await registryOf(world, "BR-2"))?.lifecycle).toBe("proposed");
  });

  it("BOUNDARY: a blank correction reason is refused", async () => {
    const world = await makeWorld();
    const spec = await lockedSpec(world);
    const refused = await world.changes.propose(spec.slug, ADD, { correction: { reason: "   " } });
    expect(refused.ok).toBe(false);
    if (!refused.ok && refused.error.code === "VALIDATION_ERROR") expect(refused.error.field).toBe("correction.reason");
    expect((await reload(world, spec.id)).version).toBe(spec.version);
  });
});

describe("extra.rule_changes has one writer (REGRESSION)", () => {
  it("NEGATIVE: `lore set` replacing extra without rule_changes is refused", async () => {
    const world = await makeWorld();
    const spec = await makeSpec(world, "Spec A");
    await mustPropose(world, spec.slug, ADD);
    const current = await reload(world, spec.id);
    const { rule_changes: _dropped, ...rest } = current.extra;
    const refused = await world.corpus.set(spec.slug, { extra: rest });
    expect(refused.ok).toBe(false);
    if (!refused.ok && refused.error.code === "VALIDATION_ERROR") expect(refused.error.field).toBe("extra.rule_changes");
    const echoed = await world.corpus.set(spec.slug, { extra: current.extra });
    expect(echoed.ok).toBe(true);
  });

  it("STATE: other writers keep rule_changes (adding a criterion preserves it)", async () => {
    const world = await makeWorld();
    const spec = await makeSpec(world, "Spec A");
    await mustPropose(world, spec.slug, ADD);
    await world.ac.addCriterion(spec.slug, scriptCriterion("AC-A-1", ["BR-1"]));
    expect(((await reload(world, spec.id)).extra["rule_changes"] as unknown[]).length).toBe(1);
  });
});
