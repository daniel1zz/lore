/**
 * phase-migration-plan-membership.test.ts — SITE 9 of the plan-membership sweep
 * (task-a-ninth-plan-member-query-hides-in-the-one-shot-task-phase), the one that
 * hides in `PhaseMigrationService.migrateTasks` (`lore migrate tasks-to-phases`).
 *
 * Plan membership is `extra.plan_id` — the DECLARED, mandatory property every
 * non-adhoc task's `--plan-id` writes. `parent_id` is a PROXY `--parent` legitimately
 * diverges from (`lore create task --plan-id P3 --parent P4` is a SUPPORTED shape,
 * SPEC-065 D4). Case H (task-plan-membership-is-extra-plan-id-but-the-last-task):
 * T6 is `--parent P4 --plan-id P3` — it BELONGS to P3 but is FILED at P4.
 *
 * Why this site's silence is the worst of the family, and why these assertions are
 * shaped the way they are: `migrateTasks` is ONE-SHOT. A read path keyed on the wrong
 * field returns a wrong answer that a later, fixed read corrects. This path WRITES
 * (archives every source task, stamps `extra.migrated_to`) and there is no second
 * run — a member it silently declines to move is declined PERMANENTLY, and a member
 * it moves under the wrong plan is mis-attributed permanently. So this file asserts
 * BOTH halves, per the governing task's `## Proxy / Silence / Opt-in` section:
 *   (a) every real member IS moved, under ITS OWN plan (never the plan it is filed
 *       under), and no task is moved twice; and
 *   (b) every task the migration DECLINES to move is NAMED in `report.warnings` —
 *       "absent from the output" is exactly the silence the Silence clause forbids.
 *       `lore migrate tasks-to-phases` prints `report.warnings` on both the dry-run
 *       and the applying run (`adapters/cli/commands/migrate.ts`), so a named
 *       declined member is genuinely visible to the operator BEFORE the
 *       unrecoverable write.
 *
 * Runner: vitest + `InMemoryStore` (`PhaseMigrationService` touches no `bun:sqlite` —
 * its only Node-side import is `@lore/core/node`'s CJK helpers, which an ASCII-only
 * fixture title never even loads). The pre-existing `phase-migration.bun.test.ts`
 * suite is bun-only because it drives a real `SQLiteStore` over a JSON fixture; it
 * stays the CONTROL for byte-identical undiverged migration (all 13 of its fixture
 * tasks have `parent_id === extra.plan_id`, verified 2026-08-03), and this file adds
 * the in-corpus divergence cases that fixture deliberately does not contain.
 * ⛔ Never touches the repo's own `.lore/` corpus (project CLAUDE.md hard rule).
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      case H — a diverged member (parent P4, plan_id P3) migrates under P3
 *   NEGATIVE:   the mirror — a NON-member merely FILED at P3 is never migrated under
 *               P3 (the pre-fix query would have archived it under the wrong plan)
 *   BOUNDARY:   a member whose `extra.plan_id` matches NO plan in the corpus — the
 *               unrecoverable-drop case: declined AND named in `warnings`
 *   ERROR:      the corpus-wide task enumeration failing surfaces a typed
 *               PhaseMigrationError with accurate {0,0,0} partial progress
 *   STATE:      second run stays idempotent for a diverged member (0 new writes) while
 *               the declined-member warning still fires — silence must not decay
 *               across runs; dry-run yields identical counts AND warnings, zero writes
 *   REGRESSION: an undiverged plan migrates with the byte-identical report the
 *               parent_id-keyed query produced, warnings empty; `--adhoc` tasks stay
 *               excluded and are never reported as declined members; no task is ever
 *               migrated twice
 *
 * @spec_ref task-a-ninth-plan-member-query-hides-in-the-one-shot-task-phase
 * @spec_ref task-eight-more-plan-member-queries-still-key-on-parent-id
 * @spec_ref task-plan-membership-is-extra-plan-id-but-the-last-task (case H)
 * @spec_ref adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the
 * @spec_ref spec-spec-056-phase-execution-model-phase-doc-type-computed-comp (D6/D6a, P7)
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { PhaseMigrationService } from "../../../src/service/phase-migration-service.js";
import type { StoreFilters } from "../../../src/store/store-interface.js";
import { err } from "@lore/core";
import type { CreateDocInput, DocRecord, EvidenceEntry, LoreError, Result } from "@lore/core";

// ─── Shared fixture helpers ───────────────────────────────────────────────────

/** A ULID-shaped id that is deliberately NOT the id of any doc in the fixture corpus. */
const MISSING_PLAN_ID = "01PHMIGGHOSTPLAN000000000";

async function createPrd(cs: CorpusService, title: string): Promise<DocRecord> {
  const result = await cs.create({ type: "prd", title, content: "root" } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create prd: ${JSON.stringify(result.error)}`);
  return result.value;
}

async function createSpec(cs: CorpusService, parentId: string, title: string): Promise<DocRecord> {
  const result = await cs.create({
    type: "spec",
    title,
    content: "spec body",
  } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create spec: ${JSON.stringify(result.error)}`);
  return result.value;
}

/** `phaseNames` become the plan's declared `extra.phases[]` (SPEC-023). */
async function createPlan(
  cs: CorpusService,
  parentId: string,
  title: string,
  phaseNames: string[] = [],
): Promise<DocRecord> {
  const result = await cs.create({
    type: "plan",
    title,
    parent_id: parentId,
    content: "plan body",
    extra: { phases: phaseNames.map((name) => ({ name })) },
  } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create plan: ${JSON.stringify(result.error)}`);
  return result.value;
}

/**
 * `parentId` is where the task is FILED (`--parent`); `planId` is the plan it BELONGS
 * to (`--plan-id`, i.e. `extra.plan_id`) — see
 * task-plan-membership-is-extra-plan-id-but-the-last-task.
 */
async function createTask(
  cs: CorpusService,
  parentId: string,
  planId: string,
  title: string,
  extraOverrides: Record<string, unknown> = {},
): Promise<DocRecord> {
  const result = await cs.create({
    type: "task",
    title,
    parent_id: parentId,
    content: "body",
    extra: { plan_id: planId, ...extraOverrides },
  } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create task: ${JSON.stringify(result.error)}`);
  return result.value;
}

function passEvidence(command: string, at = "2026-08-01T00:00:00.000Z"): EvidenceEntry {
  return {
    oracle: "manual",
    command,
    result: "pass",
    recorded_at: at,
    recorded_by: "alice",
  };
}

/** Every `phase` doc currently in the store (the migration's output set). */
async function readPhaseDocs(store: InMemoryStore): Promise<DocRecord[]> {
  const all = await store.findMany({});
  if (!all.ok) throw new Error("findMany({}) failed");
  return all.value.filter((d) => (d.type as string) === "phase");
}

function phaseDocsOfPlan(phases: DocRecord[], planId: string): DocRecord[] {
  return phases.filter((d) => d.extra["plan_id"] === planId);
}

function migratedFrom(doc: DocRecord): string[] {
  const raw = doc.extra["migrated_from"];
  return Array.isArray(raw) ? (raw as string[]) : [];
}

async function readDoc(store: InMemoryStore, id: string): Promise<DocRecord> {
  const found = await store.find(id);
  if (!found.ok || found.value === null) throw new Error(`doc ${id} not found`);
  return found.value;
}

// ─── Site 9: PhaseMigrationService.migrateTasks ───────────────────────────────

describe("PhaseMigrationService.migrateTasks — membership is extra.plan_id, not parent_id", () => {
  it("HAPPY (case H): a diverged member (T6: --parent P4 --plan-id P3) migrates under P3, not P4", async () => {
    const store = new InMemoryStore();
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const prd = await createPrd(cs, "PRD Mig H");
    const spec = await createSpec(cs, prd.id, "Spec Mig H");
    // reason: BOTH plans declare "core" so `CorpusService.create`'s cross-entity
    // phase validation — which resolves the plan from `parent_id`, NOT from
    // `extra.plan_id` (item 3 of the governing task) — accepts T6 while it is filed
    // at P4. That validation asymmetry is precisely why the fixture can exist.
    const p3 = await createPlan(cs, spec.id, "P3 Mig H", ["core"]);
    const p4 = await createPlan(cs, spec.id, "P4 Mig H", ["core"]);
    const t6 = await createTask(cs, p4.id, p3.id, "T6 diverged P3 member filed at P4", {
      phase: "core",
      verification_evidence: [passEvidence("t6 check")],
    });

    const svc = new PhaseMigrationService(store);
    const result = await svc.migrateTasks({ dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const phases = await readPhaseDocs(store);
    const p3Phases = phaseDocsOfPlan(phases, p3.id);
    const p3Core = p3Phases.find((d) => d.title === "core");
    expect(p3Core, "P3 must own a 'core' phase doc").toBeDefined();
    expect(
      migratedFrom(p3Core!),
      "T6 belongs to P3 (extra.plan_id) — a one-shot migration keyed on parent_id would move it under P4 permanently",
    ).toContain(t6.id);

    // The mirror half: P4 owns NO member, so its declared "core" phase is EMPTY.
    const p4Core = phaseDocsOfPlan(phases, p4.id).find((d) => d.title === "core");
    expect(p4Core, "P4's declared-but-unreferenced phase still migrates to an empty doc (P7)").toBeDefined();
    expect(migratedFrom(p4Core!), "T6 must NOT be attributed to the plan it is merely filed under").toEqual([]);

    // The source task is archived and stamped with the phase doc it landed in.
    const t6After = await readDoc(store, t6.id);
    expect(t6After.status).toBe("archived");
    expect(t6After.extra["migrated_to"]).toBe(p3Core!.id);
    // Its evidence rode along, tagged with its origin task (D6).
    expect(result.value.evidence_merged).toBe(1);
    const merged = p3Core!.extra["verification_evidence"] as Array<{ origin: string }>;
    expect(merged.map((e) => e.origin)).toEqual([t6.id]);
  });

  it("NEGATIVE: a NON-member merely filed at P3 (T7: --parent P3 --plan-id P4) is never migrated under P3", async () => {
    const store = new InMemoryStore();
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const prd = await createPrd(cs, "PRD Mig N");
    const spec = await createSpec(cs, prd.id, "Spec Mig N");
    const p3 = await createPlan(cs, spec.id, "P3 Mig N", ["core"]);
    const p4 = await createPlan(cs, spec.id, "P4 Mig N", ["core"]);
    const t7 = await createTask(cs, p3.id, p4.id, "T7 P4 member filed at P3", { phase: "core" });

    const svc = new PhaseMigrationService(store);
    const result = await svc.migrateTasks({ dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const phases = await readPhaseDocs(store);
    const p3Core = phaseDocsOfPlan(phases, p3.id).find((d) => d.title === "core");
    const p4Core = phaseDocsOfPlan(phases, p4.id).find((d) => d.title === "core");
    expect(migratedFrom(p3Core!), "a task filed at P3 but owned by P4 must not be archived under P3").toEqual([]);
    expect(migratedFrom(p4Core!), "T7 belongs to P4 via extra.plan_id").toContain(t7.id);
    expect(result.value.tasks_archived, "exactly one task exists and it moves exactly once").toBe(1);
  });

  it("REGRESSION: no task is migrated twice — every source task lands in exactly one phase doc", async () => {
    const store = new InMemoryStore();
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const prd = await createPrd(cs, "PRD Mig Once");
    const spec = await createSpec(cs, prd.id, "Spec Mig Once");
    const p3 = await createPlan(cs, spec.id, "P3 Mig Once", ["core"]);
    const p4 = await createPlan(cs, spec.id, "P4 Mig Once", ["core"]);
    const aligned = await createTask(cs, p3.id, p3.id, "T5 aligned P3 member", { phase: "core" });
    const diverged = await createTask(cs, p4.id, p3.id, "T6 diverged P3 member", { phase: "core" });
    const foreign = await createTask(cs, p3.id, p4.id, "T7 P4 member filed at P3", { phase: "core" });

    const svc = new PhaseMigrationService(store);
    const result = await svc.migrateTasks({ dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const phases = await readPhaseDocs(store);
    const allMigrated = phases.flatMap(migratedFrom);
    expect(new Set(allMigrated).size, "no duplicate attribution across phase docs").toBe(allMigrated.length);
    expect(allMigrated.sort()).toEqual([aligned.id, diverged.id, foreign.id].sort());
    expect(result.value.tasks_archived).toBe(3);
  });

  it("BOUNDARY + Silence: a task whose extra.plan_id matches no plan is DECLINED and NAMED in warnings", async () => {
    const store = new InMemoryStore();
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const prd = await createPrd(cs, "PRD Mig Orphan");
    const spec = await createSpec(cs, prd.id, "Spec Mig Orphan");
    const p3 = await createPlan(cs, spec.id, "P3 Mig Orphan", ["core"]);
    // Filed at P3 (so the PRE-FIX parent_id query WOULD have swept it up and archived
    // it under a plan it does not belong to) but owned by a plan that does not exist.
    //
    // reason: built in TWO steps, not one `createTask(cs, p3.id, MISSING_PLAN_ID, …)`
    // call. `CorpusService.create` now resolves a task's phase namespace by MEMBERSHIP
    // and REFUSES a phase whose declared `extra.plan_id` matches no plan
    // (task-the-tenth-plan-member-site-is-a-write-path-create-time), so this state is
    // no longer AUTHORABLE — it is only ARRIVED AT, exactly as it is in production:
    // the plan existed when the task was written and does not any more. Creating the
    // task legally and then re-pointing the stored `plan_id` reproduces that history
    // instead of asking the write path to accept what it now correctly rejects.
    const orphan = await createTask(cs, p3.id, p3.id, "T8 orphaned membership", {
      phase: "core",
    });
    const orphanExtra = { ...orphan.extra, plan_id: MISSING_PLAN_ID };
    const orphanUpdate = await store.update(orphan.id, {
      extra: orphanExtra,
      updated_at: "2026-08-02T00:00:00.000Z",
    });
    expect(orphanUpdate.ok, "the orphaning store.update must land, or this test proves nothing").toBe(true);

    const svc = new PhaseMigrationService(store);
    const result = await svc.migrateTasks({ dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const orphanAfter = await readDoc(store, orphan.id);
    expect(orphanAfter.status, "a non-member must not be archived by this plan's migration").not.toBe("archived");
    expect(orphanAfter.extra["migrated_to"]).toBeUndefined();

    const phases = await readPhaseDocs(store);
    expect(phases.flatMap(migratedFrom), "the orphan is attributed to no plan").toEqual([]);

    // The Silence floor: declined, and SAID SO. `lore migrate tasks-to-phases` prints
    // report.warnings verbatim, so this is what the operator actually sees.
    const named = result.value.warnings.filter((w) => w.includes(orphan.slug));
    expect(named.length, `orphan must be named in warnings; got: ${JSON.stringify(result.value.warnings)}`).toBe(1);
    expect(named[0]).toContain(MISSING_PLAN_ID);
    expect(named[0]!.toLowerCase()).toContain("not migrated");
  });

  it("REGRESSION: an --adhoc task stays excluded and is NOT reported as a declined member", async () => {
    const store = new InMemoryStore();
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const prd = await createPrd(cs, "PRD Mig Adhoc");
    const spec = await createSpec(cs, prd.id, "Spec Mig Adhoc");
    const plan = await createPlan(cs, spec.id, "Plan Mig Adhoc", ["core"]);
    await createTask(cs, plan.id, plan.id, "T1 plain member", { phase: "core" });
    // An --adhoc task is planless BY DESIGN (SPEC-069 D2) and auto-parents to the root
    // PRD — it is not a member the migration "declined", it is out of scope entirely.
    const adhocResult = await cs.create({
      type: "task",
      title: "T9 adhoc task",
      content: "body",
      extra: { adhoc: true },
    } as CreateDocInput);
    if (!adhocResult.ok) throw new Error(`Failed to create adhoc task: ${JSON.stringify(adhocResult.error)}`);

    const svc = new PhaseMigrationService(store);
    const result = await svc.migrateTasks({ dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const adhocAfter = await readDoc(store, adhocResult.value.id);
    expect(adhocAfter.status).not.toBe("archived");
    expect(adhocAfter.extra["migrated_to"]).toBeUndefined();
    expect(result.value.tasks_archived, "only the plan's own member migrates").toBe(1);
    expect(
      result.value.warnings.filter((w) => w.includes(adhocResult.value.slug)),
      "a planless --adhoc task is not a declined member and must not be reported as one",
    ).toEqual([]);
  });

  it("REGRESSION (CONTROL): an undiverged plan migrates with the byte-identical report and zero warnings", async () => {
    const store = new InMemoryStore();
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const prd = await createPrd(cs, "PRD Mig Control");
    const spec = await createSpec(cs, prd.id, "Spec Mig Control");
    const plan = await createPlan(cs, spec.id, "Plan Mig Control", ["core", "polish"]);
    await createTask(cs, plan.id, plan.id, "T1 control", {
      phase: "core",
      verification_evidence: [passEvidence("t1 check")],
    });
    await createTask(cs, plan.id, plan.id, "T2 control", {
      phase: "core",
      verification_evidence: [passEvidence("t2 check")],
    });
    await createTask(cs, plan.id, plan.id, "T3 control no phase", {});

    const svc = new PhaseMigrationService(store);
    const result = await svc.migrateTasks({ dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 3 phase docs: "core" (2 tasks), the solo group for T3, and the empty declared
    // "polish" — exactly what the parent_id-keyed query produced for this shape.
    expect(result.value).toEqual({
      dry_run: false,
      phases_created: 3,
      tasks_archived: 3,
      evidence_merged: 2,
      warnings: [],
    });
  });

  it("STATE: a second run is a no-op for the diverged member, but the declined-member warning still fires", async () => {
    const store = new InMemoryStore();
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const prd = await createPrd(cs, "PRD Mig Rerun");
    const spec = await createSpec(cs, prd.id, "Spec Mig Rerun");
    const p3 = await createPlan(cs, spec.id, "P3 Mig Rerun", ["core"]);
    const p4 = await createPlan(cs, spec.id, "P4 Mig Rerun", ["core"]);
    await createTask(cs, p4.id, p3.id, "T6 diverged P3 member rerun", { phase: "core" });
    const orphan = await createTask(cs, p3.id, MISSING_PLAN_ID, "T8 orphan rerun", {});

    const svc = new PhaseMigrationService(store);
    const first = await svc.migrateTasks({ dryRun: false });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.tasks_archived).toBe(1);

    const second = await svc.migrateTasks({ dryRun: false });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.phases_created, "idempotency marker #1/#2 still hold post-fix").toBe(0);
    expect(second.value.tasks_archived).toBe(0);
    expect(second.value.evidence_merged).toBe(0);
    // Silence must not DECAY across runs: the orphan is still un-migrated, so a
    // second run must still say so rather than reporting a clean 0/0/0.
    expect(
      second.value.warnings.filter((w) => w.includes(orphan.slug)).length,
      `re-run must still name the declined member; got: ${JSON.stringify(second.value.warnings)}`,
    ).toBe(1);
  });

  it("STATE: --dry-run yields identical counts AND identical warnings while writing nothing", async () => {
    const store = new InMemoryStore();
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const prd = await createPrd(cs, "PRD Mig Dry");
    const spec = await createSpec(cs, prd.id, "Spec Mig Dry");
    const p3 = await createPlan(cs, spec.id, "P3 Mig Dry", ["core"]);
    const p4 = await createPlan(cs, spec.id, "P4 Mig Dry", ["core"]);
    const t6 = await createTask(cs, p4.id, p3.id, "T6 diverged P3 member dry", { phase: "core" });
    const orphan = await createTask(cs, p3.id, MISSING_PLAN_ID, "T8 orphan dry", {});

    const svc = new PhaseMigrationService(store);
    const dry = await svc.migrateTasks({ dryRun: true });
    expect(dry.ok).toBe(true);
    if (!dry.ok) return;

    // Zero writes.
    expect(await readPhaseDocs(store)).toEqual([]);
    expect((await readDoc(store, t6.id)).status).not.toBe("archived");
    expect((await readDoc(store, orphan.id)).extra["migrated_to"]).toBeUndefined();

    // Dry-run is the ONLY recoverable checkpoint for a one-shot migration, so the
    // declined-member report must be complete HERE, before anything is written.
    expect(dry.value.dry_run).toBe(true);
    expect(dry.value.tasks_archived).toBe(1);
    expect(dry.value.warnings.filter((w) => w.includes(orphan.slug)).length).toBe(1);

    const applied = await svc.migrateTasks({ dryRun: false });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.value.phases_created).toBe(dry.value.phases_created);
    expect(applied.value.tasks_archived).toBe(dry.value.tasks_archived);
    expect(applied.value.evidence_merged).toBe(dry.value.evidence_merged);
    expect(applied.value.warnings).toEqual(dry.value.warnings);
  });

  it("ERROR: a failing corpus-wide task enumeration returns a typed error with accurate {0,0,0} partial progress", async () => {
    class TaskQueryFailingStore extends InMemoryStore {
      override async findMany(filters: StoreFilters): Promise<Result<DocRecord[], LoreError>> {
        if (filters.type === "task") {
          return err({ code: "STORE_ERROR", message: "boom: task enumeration failed" });
        }
        return super.findMany(filters);
      }
    }

    const store = new TaskQueryFailingStore();
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const prd = await createPrd(cs, "PRD Mig Err");
    const spec = await createSpec(cs, prd.id, "Spec Mig Err");
    await createPlan(cs, spec.id, "Plan Mig Err", ["core"]);

    const svc = new PhaseMigrationService(store);
    const result = await svc.migrateTasks({ dryRun: false });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const cause = result.error.cause;
    expect(cause.code).toBe("STORE_ERROR");
    // reason: LoreError is a discriminated union — narrow before reading `message`
    // (DOC_NOT_FOUND, for one, has no such field).
    if (cause.code !== "STORE_ERROR") return;
    expect(cause.message).toContain("task enumeration failed");
    expect(result.error.partial).toEqual({ phases_created: 0, tasks_archived: 0, evidence_merged: 0 });
  });
});
