/**
 * AC-DR-3 — the record-edit gate on the rewrite paths OTHER than `CorpusService.set`:
 * `AcService` add/set/remove, `VersionService.restore`, `PhaseService` add/rm/rename.
 *
 * Spec: spec-documents-are-living-or-records-a-locked-record-is-never (D6, D12, D16, D17).
 * Rules: BR-1048 (refusal on every rewrite path), BR-1046 (a closed plan's phases are records).
 *
 * Dimensions:
 *   HAPPY       ac add/set/rm on a draft spec; restore of a draft doc; phase add/rename/rm on an open plan
 *   NEGATIVE    ac add/set/rm on an approved spec; restore on an approved ADR; phase add/rm/rename on an
 *               archived plan — all `gate:record-edit`, nothing written
 *   BOUNDARY    `ac cite` on an approved spec succeeds (not a rewrite); a draft spec that was approved
 *               earlier is still locked
 *   ERROR       a refusal leaves criteria / versions / phases exactly as they were
 *   STATE       gate disabled -> `ac add` goes through
 *   REGRESSION  link, invalidate, anchor add, tags and priority on locked docs are not refused
 *   DI          the four services cannot be constructed without a RecordLockService (@ts-expect-error)
 */

import { describe, it, expect } from "vitest";
import { LoreConfigSchema, type AcceptanceCriterion, type CreateDocInput, type DocRecord, type LoreError } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { AcService } from "../../../src/service/ac-service.js";
import { VersionService } from "../../../src/service/version-service.js";
import { PhaseService } from "../../../src/service/phase-service.js";
import { ValidityService } from "../../../src/service/validity-service.js";
import { DriftCheckService } from "../../../src/service/drift-check-service.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";

interface Fixture {
  readonly store: InMemoryStore;
  readonly corpus: CorpusService;
  readonly ac: AcService;
  readonly versions: VersionService;
  readonly phases: PhaseService;
}

function makeFixture(gateEnforcer?: GateEnforcer): Fixture {
  const store = new InMemoryStore();
  const lock = new RecordLockService(store, gateEnforcer);
  return {
    store,
    corpus: new CorpusService(store, lock),
    ac: new AcService(store, lock),
    versions: new VersionService(store, lock),
    phases: new PhaseService(store, lock),
  };
}

const SCRIPT_AC = {
  id: "AC-LOCK-1",
  statement: "Rejects a malformed request with exit code 4",
  verify: { mode: "script", oracle: "test", command: "bunx vitest run x.test.ts" },
} as const;

const SECOND_SCRIPT_AC = {
  id: "AC-LOCK-2",
  statement: "Returns the stored record within 200 ms",
  verify: { mode: "script", oracle: "test", command: "bunx vitest run y.test.ts" },
} as const;

async function mustCreate(corpus: CorpusService, input: CreateDocInput): Promise<DocRecord> {
  const created = await corpus.create(input);
  if (!created.ok) throw new Error(`create failed: ${JSON.stringify(created.error)}`);
  return created.value;
}

/** Status write + its version row, without the approval gates this suite does not exercise. */
async function forceStatus(store: InMemoryStore, doc: DocRecord, status: DocRecord["status"]): Promise<DocRecord> {
  const current = await store.find(doc.id);
  if (!current.ok || current.value === null) throw new Error("fixture doc vanished");
  const nextVersion = current.value.version + 1;
  const updated = await store.update(doc.id, { status, version: nextVersion }, { expected_version: current.value.version });
  if (!updated.ok) throw new Error(`forceStatus failed: ${JSON.stringify(updated.error)}`);
  const inserted = await store.insertVersion({
    doc_id: doc.id,
    version: nextVersion,
    content: updated.value.content,
    extra: updated.value.extra,
    status,
    title: updated.value.title,
    action: "update",
    created_at: new Date().toISOString(),
    created_by: "tester",
    slug: updated.value.slug,
  });
  if (!inserted.ok) throw new Error("insertVersion failed");
  return updated.value;
}

async function specWithCriterion(f: Fixture, title = "Spec under test"): Promise<DocRecord> {
  const spec = await mustCreate(f.corpus, { type: "spec", title, content: "body" });
  const added = await f.ac.addCriterion(spec.slug, SCRIPT_AC);
  if (!added.ok) throw new Error(`fixture ac add failed: ${JSON.stringify(added.error)}`);
  return spec;
}

async function criteriaOf(store: InMemoryStore, docId: string): Promise<AcceptanceCriterion[]> {
  const doc = await store.find(docId as DocRecord["id"]);
  if (!doc.ok || doc.value === null) throw new Error("doc vanished");
  return (doc.value.extra["acceptance_criteria"] as AcceptanceCriterion[] | undefined) ?? [];
}

async function versionCount(store: InMemoryStore, docId: string): Promise<number> {
  const versions = await store.findVersions(docId as DocRecord["id"], { limit: 1000 });
  if (!versions.ok) throw new Error("findVersions failed");
  return versions.value.length;
}

function expectRecordEditRefusal(error: LoreError): void {
  expect(error.code).toBe("VALIDATION_ERROR");
  if (error.code !== "VALIDATION_ERROR") return;
  expect(error.field).toBe("gate:record-edit");
  expect(error.message).toContain("locked record");
}

async function closedPlan(f: Fixture): Promise<DocRecord> {
  const prd = await mustCreate(f.corpus, { type: "prd", title: "Root", content: "root" });
  const plan = await mustCreate(f.corpus, { type: "plan", title: "Closed plan", parent_id: prd.id, content: "p" });
  const added = await f.phases.addPhase(plan.slug, "build");
  if (!added.ok) throw new Error("fixture phase add failed");
  await forceStatus(f.store, plan, "approved");
  await forceStatus(f.store, plan, "active");
  return forceStatus(f.store, plan, "archived");
}

describe("record-edit gate on AcService (AC-DR-3)", () => {
  it("NEGATIVE: ac add on an approved spec is refused and the criteria are unchanged", async () => {
    const f = makeFixture();
    const spec = await specWithCriterion(f);
    await forceStatus(f.store, spec, "approved");
    const versionsBefore = await versionCount(f.store, spec.id);

    const result = await f.ac.addCriterion(spec.slug, SECOND_SCRIPT_AC);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expectRecordEditRefusal(result.error);
    expect(await criteriaOf(f.store, spec.id)).toHaveLength(1);
    expect(await versionCount(f.store, spec.id)).toBe(versionsBefore);
  });

  it("NEGATIVE: ac set on an approved spec is refused and the statement is unchanged", async () => {
    const f = makeFixture();
    const spec = await specWithCriterion(f);
    await forceStatus(f.store, spec, "approved");

    const result = await f.ac.setCriterion(spec.slug, "AC-LOCK-1", { statement: "Rejects everything with exit code 9" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expectRecordEditRefusal(result.error);
    expect((await criteriaOf(f.store, spec.id))[0]?.statement).toBe(SCRIPT_AC.statement);
  });

  it("NEGATIVE: ac rm on an approved spec is refused and the criterion stays", async () => {
    const f = makeFixture();
    const spec = await specWithCriterion(f);
    await forceStatus(f.store, spec, "approved");

    const result = await f.ac.removeCriterion(spec.slug, "AC-LOCK-1");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expectRecordEditRefusal(result.error);
    expect(await criteriaOf(f.store, spec.id)).toHaveLength(1);
  });

  it("BOUNDARY: a spec that is draft again but was approved earlier still refuses ac add", async () => {
    const f = makeFixture();
    const spec = await specWithCriterion(f);
    const approved = await forceStatus(f.store, spec, "approved");
    await forceStatus(f.store, approved, "draft");

    const result = await f.ac.addCriterion(spec.slug, SECOND_SCRIPT_AC);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expectRecordEditRefusal(result.error);
  });

  it("BOUNDARY: ac cite on an approved spec is not a rewrite and succeeds", async () => {
    const f = makeFixture();
    const spec = await specWithCriterion(f);
    await forceStatus(f.store, spec, "approved");

    const result = await f.ac.citeCriterion(spec.slug, "AC-LOCK-1", ["BR-1"]);

    expect(result.ok).toBe(true);
  });

  it("HAPPY: ac add, set and rm all work on a draft spec", async () => {
    const f = makeFixture();
    const spec = await specWithCriterion(f);

    const added = await f.ac.addCriterion(spec.slug, SECOND_SCRIPT_AC);
    const edited = await f.ac.setCriterion(spec.slug, "AC-LOCK-1", { statement: "Rejects a malformed request with exit code 2" });
    const removed = await f.ac.removeCriterion(spec.slug, "AC-LOCK-2");

    expect(added.ok).toBe(true);
    expect(edited.ok).toBe(true);
    expect(removed.ok).toBe(true);
    expect(await criteriaOf(f.store, spec.id)).toHaveLength(1);
  });

  it("STATE: with the gate disabled, ac add on an approved spec goes through", async () => {
    const store = new InMemoryStore();
    const config = LoreConfigSchema.parse({
      project: { name: "test-project", author: "alice" },
      workflow: { gates: { "record-edit": { enabled: false } } },
    });
    const lock = new RecordLockService(store, new GateEnforcer(config));
    const corpus = new CorpusService(store, lock);
    const ac = new AcService(store, lock);
    const spec = await mustCreate(corpus, { type: "spec", title: "Gate off", content: "body" });
    await ac.addCriterion(spec.slug, SCRIPT_AC);
    await forceStatus(store, spec, "approved");

    const result = await ac.addCriterion(spec.slug, SECOND_SCRIPT_AC);

    expect(result.ok).toBe(true);
  });
});

describe("record-edit gate on VersionService.restore (AC-DR-3)", () => {
  async function adrWithTwoVersions(f: Fixture): Promise<DocRecord> {
    const adr = await mustCreate(f.corpus, {
      type: "adr",
      title: "Use SQLite",
      content: "decision v1",
      extra: { decision_status: "proposed" },
    });
    const edited = await f.corpus.set(adr.slug, { content: "decision v2" });
    if (!edited.ok) throw new Error("fixture edit failed");
    return edited.value;
  }

  it("NEGATIVE: restore on an approved ADR is refused and writes no version", async () => {
    const f = makeFixture();
    const adr = await adrWithTwoVersions(f);
    await forceStatus(f.store, adr, "approved");
    const before = await versionCount(f.store, adr.id);

    const result = await f.versions.restore(adr.slug, 1);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expectRecordEditRefusal(result.error);
    expect(await versionCount(f.store, adr.id)).toBe(before);
    const stored = await f.store.find(adr.id);
    expect(stored.ok && stored.value?.content).toContain("decision v2");
  });

  it("HAPPY: restore on a draft ADR still works", async () => {
    const f = makeFixture();
    const adr = await adrWithTwoVersions(f);

    const result = await f.versions.restore(adr.slug, 1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.content).toContain("decision v1");
  });

  it("REGRESSION: restore on a living doc (prd) is not gated even when approved", async () => {
    const f = makeFixture();
    const prd = await mustCreate(f.corpus, { type: "prd", title: "Living", content: "v1" });
    const edited = await f.corpus.set(prd.slug, { content: "v2" });
    if (!edited.ok) throw new Error("fixture edit failed");
    await forceStatus(f.store, edited.value, "approved");

    const result = await f.versions.restore(prd.slug, 1);

    expect(result.ok).toBe(true);
  });
});

describe("record-edit gate on PhaseService (AC-DR-3, D16)", () => {
  it("NEGATIVE: phase add, rename and rm on an archived plan are refused and the phase list is unchanged", async () => {
    const f = makeFixture();
    const plan = await closedPlan(f);

    const added = await f.phases.addPhase(plan.slug, "ship");
    const renamed = await f.phases.renamePhase(plan.slug, "build", "construct");
    const removed = await f.phases.removePhase(plan.slug, "build");

    for (const result of [added, renamed, removed]) {
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expectRecordEditRefusal(result.error);
    }
    const listed = await f.phases.listPhases(plan.slug);
    expect(listed.ok && listed.value.map((p) => p.name)).toEqual(["build"]);
  });

  it("NEGATIVE: a deprecated plan is closed too", async () => {
    const f = makeFixture();
    const prd = await mustCreate(f.corpus, { type: "prd", title: "Root", content: "root" });
    const plan = await mustCreate(f.corpus, { type: "plan", title: "Dropped plan", parent_id: prd.id, content: "p" });
    await forceStatus(f.store, plan, "deprecated");

    const result = await f.phases.addPhase(plan.slug, "ship");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expectRecordEditRefusal(result.error);
  });

  it("HAPPY: phase add, rename and rm succeed on an open plan, even an approved one (D3)", async () => {
    const f = makeFixture();
    const prd = await mustCreate(f.corpus, { type: "prd", title: "Root", content: "root" });
    const plan = await mustCreate(f.corpus, { type: "plan", title: "Open plan", parent_id: prd.id, content: "p" });
    await forceStatus(f.store, plan, "approved");

    const added = await f.phases.addPhase(plan.slug, "build");
    const renamed = await f.phases.renamePhase(plan.slug, "build", "construct");
    const removed = await f.phases.removePhase(plan.slug, "construct");

    expect(added.ok).toBe(true);
    expect(renamed.ok).toBe(true);
    expect(removed.ok).toBe(true);
  });
});

describe("non-rewrite writes on locked records are not refused (AC-DR-3 REGRESSION)", () => {
  it("accepts link, anchor add, tags and priority on an approved spec", async () => {
    const f = makeFixture();
    const spec = await specWithCriterion(f);
    await forceStatus(f.store, spec, "approved");
    const other = await mustCreate(f.corpus, { type: "spec", title: "Newer spec", content: "n" });

    const linked = await f.corpus.link(other.slug, spec.slug, "relates-to");
    const anchored = await new DriftCheckService(f.store).addCodeAnchors(spec.slug, ["packages/lore/src/app.ts"]);
    const tagged = await f.corpus.set(spec.slug, { tags: ["seen"], priority: "high" });

    expect(linked.ok).toBe(true);
    expect(anchored.ok).toBe(true);
    expect(tagged.ok).toBe(true);
  });

  it("accepts invalidate on an approved ADR", async () => {
    const f = makeFixture();
    const adr = await mustCreate(f.corpus, {
      type: "adr",
      title: "Old decision",
      content: "d",
      extra: { decision_status: "proposed" },
    });
    await forceStatus(f.store, adr, "approved");

    const result = await new ValidityService(f.store).invalidate(adr.slug, { by: "tester", reason: "no longer true" });

    expect(result.ok).toBe(true);
  });
});

describe("required dependency (AC-DR-3, D17)", () => {
  it("the four rewrite-path services do not construct without a RecordLockService", () => {
    const store = new InMemoryStore();
    // @ts-expect-error — recordLock is a REQUIRED second constructor argument
    const corpus = () => new CorpusService(store);
    // @ts-expect-error — recordLock is a REQUIRED second constructor argument
    const versions = () => new VersionService(store);
    // @ts-expect-error — recordLock is a REQUIRED second constructor argument
    const ac = () => new AcService(store);
    // @ts-expect-error — recordLock is a REQUIRED second constructor argument
    const phases = () => new PhaseService(store);

    // The type errors above are the oracle (`bun run typecheck:lore-tests`); at runtime the missing
    // dependency surfaces the first time a rewrite path asks the lock, which would throw, never pass.
    expect([corpus, versions, ac, phases]).toHaveLength(4);
  });
});
