/**
 * AC-CS-2 — landing a spec's rule change set: `RuleChangeService.apply` (InMemoryStore).
 *
 * Spec: spec-a-spec-carries-its-rule-changes-the-baseline-takes-them (Model, D2, D3, D4, Edge cases).
 * Rules: BR-86 / BR-257 (a criterion may cite a rule its own spec proposes), BR-626 (a rule enters the tree as
 * live only through apply), BR-641 (lifecycle moves only live->retired; proposed->live via apply; proposed->retired
 * on abandonment), BR-1007 (a spec is approvable when it cites a live rule or one its OWN change set proposes).
 *
 * Dimensions:
 *   HAPPY       (a) every citing criterion attested-green: each touched leaf is written ONCE (one version naming the
 *               spec), proposed -> live, modify rewrites, retire carries its note
 *   NEGATIVE    (b) a self-reported pass / an expected-fail / no run / a latest attested fail each refuse and write
 *               nothing, naming the criterion; (e) `rule set --lifecycle deprecated` refused naming retire + change set;
 *               another spec's proposal does not satisfy the approval citation
 *   STATE       (c) apply twice is a no-op the second time; (d) a spec deprecated before landing retires its
 *               proposed ids "never landed: <spec>"; plan close lands the change set / is refused while it would fail
 *   BOUNDARY    an empty change set is a no-op; a spec citing only its own proposal is approvable
 *   REGRESSION  a landed `modify` no longer blocks another spec's modify of the same id
 */

import { describe, it, expect } from "vitest";
import type { DocId, DocRecord, EvidenceEntry } from "@lore/core";
import { makeSpec, makeWorld, reload, scriptCriterion, type World } from "./rule-change-world.js";
import { ownProposedRules } from "../../../src/service/rule-changes.js";
import { requireSpecCitesLiveRule } from "../../../src/service/spec-approval-citation.js";

const ADD_A = { op: "add" as const, leaf: "leaf-a", statement: "Landed rule on leaf A", examples: ["a1"], enforced_by: "guaranteed" as const };
const ADD_B = { op: "add" as const, statement: "Landed rule on leaf B", examples: ["b1"], enforced_by: "both" as const };

type Kind = "attested-pass" | "attested-fail" | "self-reported-pass" | "expected-fail" | "none";

function evidence(acRef: string, kind: Exclude<Kind, "none">, at: string): EvidenceEntry {
  const base = { oracle: "test" as const, command: `bunx vitest run ${acRef}`, recorded_at: at, recorded_by: "agent:t", ac_ref: acRef };
  const attestation = (exit: number) => ({ runner: "lore-cli" as const, exit_code: exit, duration_ms: 1, timed_out: false });
  switch (kind) {
    case "attested-pass": return { ...base, result: "pass", attestation: attestation(0) };
    case "attested-fail": return { ...base, result: "fail", attestation: attestation(1) };
    case "self-reported-pass": return { ...base, result: "pass" };
    case "expected-fail": return { ...base, result: "expected-fail", attestation: attestation(1) };
  }
}

/** Give a spec a plan + task carrying `rows` as its evidence (the lineage rule-state and apply both read). */
async function recordEvidence(world: World, spec: DocRecord, rows: EvidenceEntry[]): Promise<DocRecord> {
  const plan = await world.corpus.create({ type: "plan", title: `Plan of ${spec.slug}`, parent_id: spec.id, content: "plan" });
  if (!plan.ok) throw new Error(`plan create failed: ${JSON.stringify(plan.error)}`);
  const task = await world.corpus.create({ type: "task", title: `Task of ${spec.slug}`, parent_id: plan.value.id, content: "t", extra: { plan_id: plan.value.id } });
  if (!task.ok) throw new Error(`task create failed: ${JSON.stringify(task.error)}`);
  const written = await world.store.update(task.value.id, { extra: { ...task.value.extra, verification_evidence: rows } });
  if (!written.ok) throw new Error("evidence write failed");
  return plan.value;
}

async function setStatus(world: World, id: DocId, status: DocRecord["status"]): Promise<void> {
  const current = await reload(world, id);
  const updated = await world.store.update(id, { status, version: current.version + 1 }, { expected_version: current.version });
  if (!updated.ok) throw new Error(`status write failed: ${JSON.stringify(updated.error)}`);
}

async function mustPropose(world: World, spec: string, input: Parameters<World["changes"]["propose"]>[1]) {
  const r = await world.changes.propose(spec, input);
  if (!r.ok) throw new Error(`propose failed: ${JSON.stringify(r.error)}`);
  return r.value.change;
}

async function mustCite(world: World, spec: string, acId: string, ruleIds: string[]): Promise<void> {
  const r = await world.ac.addCriterion(spec, scriptCriterion(acId, ruleIds));
  if (!r.ok) throw new Error(`addCriterion failed: ${JSON.stringify(r.error)}`);
}

/** Leaf B with a live BR-2, so retire / cross-leaf cases have a second leaf. */
async function addLeafB(world: World): Promise<DocRecord> {
  const node = await world.rules.addNode("branch-a", { node: "leaf", label: "B leaf", title: "leaf-b", content: "b" });
  if (!node.ok) throw new Error(`leaf-b failed: ${JSON.stringify(node.error)}`);
  const rule = await world.rules.addRule(node.value.slug, { statement: "A live rule on leaf B", confidence: "established", enforced_by: "both", examples: ["x"] }, { by: "test" });
  if (!rule.ok || rule.value.ruleId !== "BR-2") throw new Error(`seed BR-2 failed: ${JSON.stringify(rule)}`);
  return reload(world, node.value.id);
}

async function registryState(world: World, id: string): Promise<string | undefined> {
  const rows = await world.store.listRuleRegistry();
  if (!rows.ok) throw new Error("registry read failed");
  return rows.value.find((r) => r.id === id)?.lifecycle;
}

const rulesOf = (doc: DocRecord) => doc.extra["rules"] as Array<Record<string, unknown>>;

async function versionLog(world: World, id: DocId) {
  const log = await world.store.findVersions(id);
  if (!log.ok) throw new Error("version log read failed");
  return log.value;
}

/** A spec with the full change set of case (a): add on A, modify BR-1, retire BR-2, add on B. */
async function fullSpec(world: World, kinds: Record<string, Kind>) {
  const leafB = await addLeafB(world);
  const spec = await makeSpec(world, "Landing spec");
  const addA = await mustPropose(world, spec.slug, ADD_A);
  const addB = await mustPropose(world, spec.slug, { ...ADD_B, leaf: leafB.slug });
  await mustPropose(world, spec.slug, { op: "modify", id: "BR-1", statement: "BR-1 rewritten by landing" });
  await mustPropose(world, spec.slug, { op: "retire", id: "BR-2", note: "no longer true after landing" });
  await mustCite(world, spec.slug, "AC-L-1", [addA.id]);
  await mustCite(world, spec.slug, "AC-L-2", [addB.id, "BR-1"]);
  await mustCite(world, spec.slug, "AC-L-3", ["BR-2"]);
  const rows = Object.entries(kinds).filter(([, k]) => k !== "none").map(([ac, k]) => evidence(ac, k as Exclude<Kind, "none">, "2026-10-12T10:00:00.000Z"));
  const plan = await recordEvidence(world, await reload(world, spec.id), rows);
  return { spec: await reload(world, spec.id), plan, addA, addB, leafB };
}

const ALL_PASS: Record<string, Kind> = { "AC-L-1": "attested-pass", "AC-L-2": "attested-pass", "AC-L-3": "attested-pass" };

describe("rule apply: landing (AC-CS-2a)", () => {
  it("HAPPY: writes each touched leaf ONCE naming the spec; proposed -> live, modify rewrites, retire carries its note", async () => {
    const world = await makeWorld();
    const { spec, addA, addB, leafB } = await fullSpec(world, ALL_PASS);
    const leafA0 = await reload(world, world.leafId);

    const applied = await world.changes.apply(spec.slug, { by: "agent:t" });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.value.kind).toBe("applied");

    const leafA1 = await reload(world, world.leafId);
    const leafB1 = await reload(world, leafB.id);
    expect(leafA1.version).toBe(leafA0.version + 1);
    expect(leafB1.version).toBe(leafB.version + 1);
    for (const doc of [leafA1, leafB1]) {
      const newest = (await versionLog(world, doc.id)).find((v) => v.version === doc.version);
      expect(newest?.change_summary ?? "").toContain(spec.slug);
    }
    const a = rulesOf(leafA1);
    expect(a.find((r) => r["id"] === "BR-1")).toMatchObject({ statement: "BR-1 rewritten by landing", lifecycle: "live" });
    expect(a.find((r) => r["id"] === addA.id)).toMatchObject({ statement: ADD_A.statement, lifecycle: "live", enforced_by: "guaranteed" });
    const b = rulesOf(leafB1);
    expect(b.find((r) => r["id"] === "BR-2")).toMatchObject({ lifecycle: "retired", retired_note: "no longer true after landing" });
    expect(b.find((r) => r["id"] === addB.id)).toMatchObject({ statement: ADD_B.statement, lifecycle: "live" });
    expect(await registryState(world, addA.id)).toBe("live");
    expect(await registryState(world, addB.id)).toBe("live");
    expect(await registryState(world, "BR-2")).toBe("retired");
    const stored = (await reload(world, spec.id)).extra["rule_changes"] as Array<{ applied_at?: string }>;
    expect(stored.every((c) => typeof c.applied_at === "string")).toBe(true);
  });

  it("STATE: the landed rule is part of the snapshot views (rule find lists it)", async () => {
    const world = await makeWorld();
    const { spec, addA } = await fullSpec(world, ALL_PASS);
    expect((await world.changes.apply(spec.slug)).ok).toBe(true);
    const found = await world.read.find({ text: ADD_A.statement });
    expect(found.ok && found.value).toContain(addA.id);
  });
});

describe("rule apply: the evidence gate (AC-CS-2b)", () => {
  const CASES: Array<[string, Record<string, Kind>, RegExp]> = [
    ["a self-reported pass does not count", { ...ALL_PASS, "AC-L-2": "self-reported-pass" }, /AC-L-2/],
    ["an expected-fail does not count", { ...ALL_PASS, "AC-L-1": "expected-fail" }, /AC-L-1/],
    ["no run at all does not count", { ...ALL_PASS, "AC-L-3": "none" }, /AC-L-3/],
    ["a latest attested fail does not count", { ...ALL_PASS, "AC-L-2": "attested-fail" }, /AC-L-2/],
  ];
  for (const [name, kinds, naming] of CASES) {
    it(`NEGATIVE: ${name}: exit-4 refusal naming the criterion, nothing written`, async () => {
      const world = await makeWorld();
      const { spec, addA } = await fullSpec(world, kinds);
      const leafA0 = await reload(world, world.leafId);
      const specV0 = (await reload(world, spec.id)).version;
      const refused = await world.changes.apply(spec.slug);
      expect(refused.ok).toBe(false);
      if (refused.ok) return;
      expect(refused.error.code).toBe("VALIDATION_ERROR");
      expect("message" in refused.error && refused.error.message).toMatch(naming);
      expect((await reload(world, world.leafId)).version).toBe(leafA0.version);
      expect((await reload(world, spec.id)).version).toBe(specV0);
      expect(await registryState(world, addA.id)).toBe("proposed");
      expect(await registryState(world, "BR-2")).toBe("live");
    });
  }

  it("NEGATIVE: a criterion that cites NO changed id is not part of the gate", async () => {
    const world = await makeWorld();
    const spec = await makeSpec(world, "Spec with a bystander");
    const add = await mustPropose(world, spec.slug, ADD_A);
    await mustCite(world, spec.slug, "AC-P-1", [add.id]);
    await mustCite(world, spec.slug, "AC-P-2", ["BR-1"]);
    await recordEvidence(world, await reload(world, spec.id), [evidence("AC-P-1", "attested-pass", "2026-10-12T10:00:00.000Z")]);
    expect((await world.changes.apply(spec.slug)).ok).toBe(true);
  });

  it("STATE: the LATEST attested run decides (fail then pass lands)", async () => {
    const world = await makeWorld();
    const spec = await makeSpec(world, "Spec re-run");
    const add = await mustPropose(world, spec.slug, ADD_A);
    await mustCite(world, spec.slug, "AC-R-1", [add.id]);
    await recordEvidence(world, await reload(world, spec.id), [
      evidence("AC-R-1", "attested-fail", "2026-10-12T09:00:00.000Z"),
      evidence("AC-R-1", "attested-pass", "2026-10-12T10:00:00.000Z"),
    ]);
    expect((await world.changes.apply(spec.slug)).ok).toBe(true);
  });
});

describe("rule apply: unproven changes (AC-CS-2f)", () => {
  it("NEGATIVE: an add cited by NO criterion is refused naming the id; nothing is written", async () => {
    const world = await makeWorld();
    const spec = await makeSpec(world, "Uncited add");
    const add = await mustPropose(world, spec.slug, ADD_A);
    const leaf0 = await reload(world, world.leafId);
    const refused = await world.changes.apply(spec.slug);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect("message" in refused.error && refused.error.message).toContain(add.id);
    expect("message" in refused.error && refused.error.message).toContain("unproven");
    expect((await reload(world, world.leafId)).version).toBe(leaf0.version);
    expect(await registryState(world, add.id)).toBe("proposed");
  });

  it("NEGATIVE: a modify cited by no criterion is refused naming the id, even when another change is proven", async () => {
    const world = await makeWorld();
    const spec = await makeSpec(world, "Uncited modify");
    const add = await mustPropose(world, spec.slug, ADD_A);
    await mustPropose(world, spec.slug, { op: "modify", id: "BR-1", statement: "unproven rewrite" });
    await mustCite(world, spec.slug, "AC-U-1", [add.id]);
    await recordEvidence(world, await reload(world, spec.id), [evidence("AC-U-1", "attested-pass", "2026-10-12T10:00:00.000Z")]);
    const refused = await world.changes.apply(spec.slug);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect("message" in refused.error && refused.error.message).toContain("BR-1");
    expect(await registryState(world, add.id)).toBe("proposed");
  });

  it("HAPPY: a retire needs no citing criterion", async () => {
    const world = await makeWorld();
    const spec = await makeSpec(world, "Uncited retire");
    await mustPropose(world, spec.slug, { op: "retire", id: "BR-1", note: "no longer true" });
    const landed = await world.changes.apply(spec.slug);
    expect(landed.ok && landed.value.kind).toBe("applied");
    expect(await registryState(world, "BR-1")).toBe("retired");
  });

  it("STATE: plan close inherits it and is refused naming the unproven id", async () => {
    const world = await makeWorld();
    const spec = await makeSpec(world, "Uncited at close");
    const add = await mustPropose(world, spec.slug, ADD_A);
    const plan = await world.corpus.create({ type: "plan", title: "Plan unproven", parent_id: spec.id, content: "p" });
    if (!plan.ok) throw new Error("plan create failed");
    await setStatus(world, plan.value.id, "active");
    const closed = await world.corpus.set(plan.value.slug, { status: "archived" });
    expect(closed.ok).toBe(false);
    if (!closed.ok) expect("message" in closed.error && closed.error.message).toContain(add.id);
  });
});

describe("rule apply: idempotence (AC-CS-2c)", () => {
  it("STATE: apply twice is a no-op the second time (no leaf or spec version moves)", async () => {
    const world = await makeWorld();
    const { spec } = await fullSpec(world, ALL_PASS);
    expect((await world.changes.apply(spec.slug)).ok).toBe(true);
    const leaf1 = await reload(world, world.leafId);
    const spec1 = await reload(world, spec.id);
    const second = await world.changes.apply(spec.slug);
    expect(second.ok && second.value.kind).toBe("noop");
    expect((await reload(world, world.leafId)).version).toBe(leaf1.version);
    expect((await reload(world, spec.id)).version).toBe(spec1.version);
  });

  it("BOUNDARY: a spec with no change set is a no-op", async () => {
    const world = await makeWorld();
    const spec = await makeSpec(world, "Plain spec");
    const r = await world.changes.apply(spec.slug);
    expect(r.ok && r.value.kind).toBe("noop");
  });

  it("REGRESSION: after landing, another spec may modify the same id", async () => {
    const world = await makeWorld();
    const specA = await makeSpec(world, "Spec A");
    await mustPropose(world, specA.slug, { op: "modify", id: "BR-1", statement: "A's wording" });
    await mustCite(world, specA.slug, "AC-A-1", ["BR-1"]);
    await recordEvidence(world, await reload(world, specA.id), [evidence("AC-A-1", "attested-pass", "2026-10-12T10:00:00.000Z")]);
    const specB = await makeSpec(world, "Spec B");
    expect((await world.changes.propose(specB.slug, { op: "modify", id: "BR-1", statement: "B's wording" })).ok).toBe(false);
    expect((await world.changes.apply(specA.slug)).ok).toBe(true);
    expect((await world.changes.propose(specB.slug, { op: "modify", id: "BR-1", statement: "B's wording" })).ok).toBe(true);
    // A's landed entry is not re-applied when B's change lands later
    expect((await world.changes.apply(specA.slug)).ok).toBe(true);
    const leaf = await reload(world, world.leafId);
    expect(rulesOf(leaf).find((r) => r["id"] === "BR-1")?.["statement"]).toBe("A's wording");
  });
});

describe("rule apply: abandonment (AC-CS-2d)", () => {
  it("STATE: a spec deprecated before landing retires its proposed ids 'never landed: <spec>'", async () => {
    const world = await makeWorld();
    const spec = await makeSpec(world, "Abandoned spec");
    const add = await mustPropose(world, spec.slug, ADD_A);
    await mustCite(world, spec.slug, "AC-X-1", [add.id]);
    await setStatus(world, spec.id, "approved");
    const leaf0 = await reload(world, world.leafId);
    const deprecated = await world.corpus.set(spec.slug, { status: "deprecated" });
    expect(deprecated.ok).toBe(true);
    const leaf1 = await reload(world, world.leafId);
    expect(leaf1.version).toBe(leaf0.version + 1);
    expect(rulesOf(leaf1).find((r) => r["id"] === add.id)).toMatchObject({ lifecycle: "retired", retired_note: `never landed: ${spec.slug}` });
    expect(await registryState(world, add.id)).toBe("retired");
    // the id is still readable (a tombstone) and apply on the abandoned spec changes nothing further
    const again = await world.changes.apply(spec.slug);
    expect(again.ok && again.value.kind).toBe("noop");
    expect((await reload(world, world.leafId)).version).toBe(leaf1.version);
  });

  it("NEGATIVE: an abandoned spec's modify/retire entries touch no rule", async () => {
    const world = await makeWorld();
    const spec = await makeSpec(world, "Abandoned modifier");
    await mustPropose(world, spec.slug, { op: "modify", id: "BR-1", statement: "never lands" });
    await setStatus(world, spec.id, "approved");
    expect((await world.corpus.set(spec.slug, { status: "deprecated" })).ok).toBe(true);
    expect(rulesOf(await reload(world, world.leafId)).find((r) => r["id"] === "BR-1")?.["statement"]).not.toBe("never lands");
  });
});

describe("rule set --lifecycle deprecated (AC-CS-2e, D4)", () => {
  it("NEGATIVE: refused, naming retire and the change set; nothing changes", async () => {
    const world = await makeWorld();
    const before = await reload(world, world.leafId);
    const refused = await world.rules.setRule("BR-1", { lifecycle: "deprecated" }, { by: "t" });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    const message = "message" in refused.error ? refused.error.message : "";
    expect(message).toContain("retire");
    expect(message).toContain("change set");
    expect((await reload(world, world.leafId)).version).toBe(before.version);
  });

  it("HAPPY: retiring a live rule directly still works (control)", async () => {
    const world = await makeWorld();
    expect((await world.rules.setRule("BR-1", { lifecycle: "retired", note: "gone" }, { by: "t" })).ok).toBe(true);
  });
});

describe("spec approval citation of an own proposal (BR-1007, AC-CS-2)", () => {
  it("HAPPY: a spec whose criteria cite only ids its OWN change set proposes is approvable (set --status approved)", async () => {
    const world = await makeWorld();
    const spec = await makeSpec(world, "Own proposal only");
    const add = await mustPropose(world, spec.slug, ADD_A);
    await mustCite(world, spec.slug, "AC-O-1", [add.id]);
    const fresh = await reload(world, spec.id);
    const cited = await requireSpecCitesLiveRule(world.store, spec.slug, fresh.extra["acceptance_criteria"], ownProposedRules(fresh.extra));
    expect(cited.ok).toBe(true);
    const approved = await world.corpus.set(spec.slug, { status: "approved" });
    expect(approved.ok).toBe(true);
  });

  it("NEGATIVE: another spec's proposal does not satisfy the requirement", async () => {
    const world = await makeWorld();
    const specA = await makeSpec(world, "Proposer");
    const add = await mustPropose(world, specA.slug, ADD_A);
    const specB = await makeSpec(world, "Borrower");
    // The gate refuses this write, so plant the criterion directly: approval must still refuse it.
    const plantedB = await world.store.update(specB.id, { extra: { acceptance_criteria: [scriptCriterion("AC-B-1", [add.id])] } });
    expect(plantedB.ok).toBe(true);
    const fresh = await reload(world, specB.id);
    const cited = await requireSpecCitesLiveRule(world.store, specB.slug, fresh.extra["acceptance_criteria"], ownProposedRules(fresh.extra));
    expect(cited.ok).toBe(false);
    const approved = await world.corpus.set(specB.slug, { status: "approved" });
    expect(approved.ok).toBe(false);
  });
});

describe("plan close lands the change set (AC-CS-2, D3)", () => {
  async function closableWorld(kinds: Record<string, Kind>) {
    const world = await makeWorld();
    const { spec, plan, addA } = await fullSpec(world, kinds);
    await setStatus(world, plan.id, "active");
    return { world, spec, plan, addA };
  }

  it("NEGATIVE: closing the plan while apply would fail is refused naming the criterion; the plan stays open", async () => {
    const { world, plan, addA } = await closableWorld({ ...ALL_PASS, "AC-L-3": "none" });
    const closed = await world.corpus.set(plan.slug, { status: "archived" });
    expect(closed.ok).toBe(false);
    if (closed.ok) return;
    expect("message" in closed.error && closed.error.message).toContain("AC-L-3");
    expect((await reload(world, plan.id)).status).toBe("active");
    expect(await registryState(world, addA.id)).toBe("proposed");
  });

  it("HAPPY: closing the plan applies the change set and archives it", async () => {
    const { world, plan, addA } = await closableWorld(ALL_PASS);
    const closed = await world.corpus.set(plan.slug, { status: "archived" });
    expect(closed.ok).toBe(true);
    expect((await reload(world, plan.id)).status).toBe("archived");
    expect(await registryState(world, addA.id)).toBe("live");
  });

  it("REGRESSION: closing a plan whose spec has no change set is unaffected", async () => {
    const world = await makeWorld();
    const spec = await makeSpec(world, "No changes");
    const plan = await world.corpus.create({ type: "plan", title: "Plain plan", parent_id: spec.id, content: "p" });
    if (!plan.ok) throw new Error("plan create failed");
    await setStatus(world, plan.value.id, "active");
    expect((await world.corpus.set(plan.value.slug, { status: "archived" })).ok).toBe(true);
  });
});
