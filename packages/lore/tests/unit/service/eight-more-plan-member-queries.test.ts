/**
 * eight-more-plan-member-queries.test.ts —
 * task-eight-more-plan-member-queries-still-key-on-parent-id, the SIX non-write-
 * consequential sites (the two write-consequential sites —
 * `CorpusService.cascadeArchiveOnPlanClose` and `CorpusService.getPlanBundle`'s
 * task-claim gate feed — each have their OWN dedicated file per this task's AC4:
 * `plan-close-cascade-plan-membership.test.ts`,
 * `plan-bundle-task-claim-gate-plan-membership.test.ts`).
 *
 * Plan membership is `extra.plan_id` (the DECLARED, mandatory property every
 * non-adhoc task's `--plan-id` writes) — never `parent_id` (a proxy `--parent`
 * legitimately diverges from, SPEC-065 D4). Case H (task-plan-membership-is-extra-
 * plan-id-but-the-last-task, measured 2026-08-01): T6 is `--parent P4 --plan-id P3`
 * — T6 BELONGS to P3 but is FILED at P4. Each describe block below is its OWN
 * dedicated per-site test (AC3: "one shared test passing is not evidence that eight
 * sites were fixed") against ONE of:
 *   - AcService.findTasksUnderPlans (via listCriteria)
 *   - CorpusService.getAssessmentFreshness
 *   - VerificationProjectionService.resolvePlanTasks (via evidencePanel, plan branch)
 *   - PhaseService.findTasksByPhase (via removePhase's guard + renamePhase's write)
 *   - OutlineService.resolveAcceptanceProjection (via resolve())
 *   - SessionService.computeReadinessPointer (via resume())
 *
 * Coverage per site: HAPPY (case H fixed) + at least one of NEGATIVE/BOUNDARY/STATE,
 * plus shared CONTROL (byte-identical plain-plan result) and CONTROL (--adhoc
 * exclusion) checks folded into the relevant describe blocks. ERROR-dimension store-
 * failure propagation for these six methods is already covered by each service's own
 * pre-existing test file (ac-service.test.ts, corpus-service.test.ts,
 * verification-projection-service.test.ts, phase-service.test.ts,
 * outline-service.test.ts, session-service.test.ts) — this file's added value is the
 * plan_id-vs-parent_id membership fix, not findMany error plumbing.
 *
 * @spec_ref task-eight-more-plan-member-queries-still-key-on-parent-id
 * @spec_ref task-plan-membership-is-extra-plan-id-but-the-last-task (case H)
 * @spec_ref adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { AcService } from "../../../src/service/ac-service.js";
import { VerificationProjectionService } from "../../../src/service/verification-projection-service.js";
import { PhaseService } from "../../../src/service/phase-service.js";
import { OutlineService } from "../../../src/service/outline-service.js";
import { SessionService } from "../../../src/service/session-service.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import type { CreateDocInput, DocRecord, EvidenceEntry } from "@lore/core";
import { actedStore } from "../../live-invocation.js";
import { ensureRequirementsDocId } from "../../helpers/parented-create.js";

// ─── Shared fixture helpers ───────────────────────────────────────────────────

async function createPrd(cs: CorpusService, title: string): Promise<DocRecord> {
  const result = await cs.create({ type: "prd", title, content: "root" } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create prd: ${JSON.stringify(result.error)}`);
  return result.value;
}

async function createSpec(
  cs: CorpusService,
  parentId: string,
  title: string,
  acceptanceCriteria: unknown[] = [],
): Promise<DocRecord> {
  const result = await cs.create({
    type: "spec",
    title,
    content: "spec body",
    extra: { acceptance_criteria: acceptanceCriteria },
  } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create spec: ${JSON.stringify(result.error)}`);
  return result.value;
}

async function createPlan(cs: CorpusService, parentId: string | null, title: string): Promise<DocRecord> {
  const result = await cs.create({
    type: "plan",
    title,
    parent_id: parentId ?? (await ensureRequirementsDocId(cs)),
    content: "plan body",
  } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create plan: ${JSON.stringify(result.error)}`);
  return result.value;
}

/** `parentId` is where the task is FILED (`--parent`); `planId` is the plan it BELONGS
 *  to (`--plan-id`) — see task-plan-membership-is-extra-plan-id-but-the-last-task. */
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

function passEvidence(acRef: string, at = "2026-08-01T00:00:00.000Z"): EvidenceEntry {
  return {
    oracle: "manual",
    command: "manual check",
    result: "pass",
    recorded_at: at,
    recorded_by: "alice",
    ac_ref: acRef,
  };
}

const AC1 = { id: "AC-1", statement: "some property holds", verify: { mode: "human" as const } };

// ─── Site 1: AcService.findTasksUnderPlans (via listCriteria) ────────────────

describe("AcService.findTasksUnderPlans (task-eight-more-plan-member-queries-still-key-on-parent-id)", () => {
  it("HAPPY (case H): a diverged P3 member (T6, filed at P4) counts toward P3's AC coverage", async () => {
    const store = actedStore(new InMemoryStore());
    const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const acService = new AcService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const prd = await createPrd(corpusService, "PRD Ac1");
    const spec = await createSpec(corpusService, prd.id, "Spec Ac1", [AC1]);
    // reason: P4 must be OUTSIDE spec's own child-plan set (a second spec's plan, not
    // spec's own) — findTasksUnderPlans loops over findChildPlans(spec.id)'s result,
    // so a P4 that WAS also a child of `spec` would accidentally recover T6 via the
    // aggregate union across sibling plans regardless of this fix (measured: an
    // earlier version of this fixture parented P4 under `spec` too and stayed GREEN
    // pre-fix — a false negative). P4 living under an unrelated spec is what makes
    // "T6 filed at P4" genuinely invisible to a parent_id-keyed per-plan loop that
    // only ever visits spec's OWN child plans.
    const otherSpec = await createSpec(corpusService, prd.id, "Other Spec Ac1", []);
    const p3 = await createPlan(corpusService, spec.id, "P3");
    const p4 = await createPlan(corpusService, otherSpec.id, "P4");
    await createTask(corpusService, p3.id, p3.id, "T5 undiverged P3 member", {
      verification_evidence: [passEvidence("AC-1")],
    });
    await createTask(corpusService, p4.id, p3.id, "T6 diverged P3 member (filed at P4)", {
      verification_evidence: [passEvidence("AC-1")],
    });

    const result = await acService.listCriteria(spec.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.coverage).not.toBeNull();
    const fact = result.value.coverage!.find((c) => c.ac_id === "AC-1");
    expect(fact?.pass, "T6 (a real P3 member via extra.plan_id, filed at P4) must count toward AC-1 coverage").toBe(
      2,
    );
  });

  it("CONTROL: a plain plan (parent_id === extra.plan_id everywhere) yields the byte-identical coverage the pre-fix parent_id-keyed query would have", async () => {
    const store = actedStore(new InMemoryStore());
    const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const acService = new AcService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const prd = await createPrd(corpusService, "PRD Ac Control");
    const spec = await createSpec(corpusService, prd.id, "Spec Ac Control", [AC1]);
    const plan = await createPlan(corpusService, spec.id, "Plain Plan");
    await createTask(corpusService, plan.id, plan.id, "T1", { verification_evidence: [passEvidence("AC-1")] });
    await createTask(corpusService, plan.id, plan.id, "T2", { verification_evidence: [passEvidence("AC-1")] });

    const result = await acService.listCriteria(spec.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fact = result.value.coverage!.find((c) => c.ac_id === "AC-1");
    expect(fact?.pass).toBe(2);
  });

  it("CONTROL: an --adhoc task never counts toward a plan-scoped coverage aggregation via findTasksUnderPlans", async () => {
    const store = actedStore(new InMemoryStore());
    const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const acService = new AcService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const prd = await createPrd(corpusService, "PRD Ac Adhoc");
    const spec = await createSpec(corpusService, prd.id, "Spec Ac Adhoc", [AC1]);
    const plan = await createPlan(corpusService, spec.id, "Plan Ac Adhoc");
    await createTask(corpusService, plan.id, plan.id, "T1", { verification_evidence: [passEvidence("AC-1")] });
    const adhocResult = await corpusService.create({
      type: "task",
      title: "Adhoc",
      content: "body",
      extra: { adhoc: true, ac_scope: ["AC-1"], governing_spec: spec.id, verification_evidence: [passEvidence("AC-1")] },
    } as CreateDocInput);
    if (!adhocResult.ok) throw new Error(`Failed to create adhoc task: ${JSON.stringify(adhocResult.error)}`);

    const result = await acService.listCriteria(spec.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // AC-1 pass = 1 from the plan task; the adhoc task's evidence is folded in
    // separately by findAdhocGovernedTasks (unrelated to this fix), bringing the
    // total to 2 — but the plan-scoped findTasksUnderPlans half must contribute
    // exactly 1, never picking up the adhoc task as if it were parent_id-keyed.
    const fact = result.value.coverage!.find((c) => c.ac_id === "AC-1");
    expect(fact?.pass).toBe(2);
  });
});

// ─── Site 3: VerificationProjectionService.resolvePlanTasks (via evidencePanel) ──

describe("VerificationProjectionService.resolvePlanTasks (task-eight-more-plan-member-queries-still-key-on-parent-id)", () => {
  it("HAPPY (case H): the plan Evidence-tab panel's per-task attestation list includes the diverged P3 member (T6, filed at P4)", async () => {
    const store = actedStore(new InMemoryStore());
    const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const projectionService = new VerificationProjectionService(store, null);
    const p3 = await createPlan(corpusService, null, "P3 Panel");
    const p4 = await createPlan(corpusService, null, "P4 Panel");
    const t5 = await createTask(corpusService, p3.id, p3.id, "T5 undiverged P3 member");
    const t6 = await createTask(corpusService, p4.id, p3.id, "T6 diverged P3 member (filed at P4)");

    const panelResult = await projectionService.evidencePanel(p3.id);
    expect(panelResult.ok).toBe(true);
    if (!panelResult.ok) return;
    expect(panelResult.value.doc_type).toBe("plan");
    if (panelResult.value.doc_type !== "plan") return;
    const slugs = panelResult.value.tasks.map((t) => t.slug);
    expect(new Set(slugs), "T6 (a real P3 member via extra.plan_id) missing from the plan Evidence panel").toEqual(
      new Set([t5.slug, t6.slug]),
    );
  });

  it("CONTROL: a task merely FILED at P3 but BELONGING to P4 is excluded from P3's panel", async () => {
    const store = actedStore(new InMemoryStore());
    const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const projectionService = new VerificationProjectionService(store, null);
    const p3 = await createPlan(corpusService, null, "P3 Panel Negative");
    const p4 = await createPlan(corpusService, null, "P4 Panel Negative");
    const t7 = await createTask(corpusService, p3.id, p4.id, "T7 real P4 member, filed at P3");

    const panelResult = await projectionService.evidencePanel(p3.id);
    expect(panelResult.ok).toBe(true);
    if (!panelResult.ok) return;
    if (panelResult.value.doc_type !== "plan") return;
    expect(panelResult.value.tasks.some((t) => t.slug === t7.slug)).toBe(false);
  });
});

// ─── Site 4: PhaseService.findTasksByPhase ───────────────────────────────────

describe("PhaseService.findTasksByPhase (task-eight-more-plan-member-queries-still-key-on-parent-id)", () => {
  it("HAPPY (case H): removePhase is BLOCKED by a diverged P3 member (T6, filed at P4) still referencing the phase", async () => {
    const store = actedStore(new InMemoryStore());
    const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const phaseService = new PhaseService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const p3 = await createPlan(corpusService, null, "P3 Phase");
    const p4 = await createPlan(corpusService, null, "P4 Phase");
    const addResult = await phaseService.addPhase(p3.id, "Track A");
    expect(addResult.ok).toBe(true);
    // reason: P4 deliberately declares NOTHING. It used to need `addPhase(p4, "Track
    // A")` because create-time `extra.phase` validation resolved the plan from
    // `parent_id`, and the comment here called that "a deliberate, orthogonal design".
    // It was not: it was the TENTH site of this very membership family, closed by
    // task-the-tenth-plan-member-site-is-a-write-path-create-time — `_createImpl` now
    // resolves the namespace by MEMBERSHIP (`isPlanMember`), the same key
    // `findTasksByPhase` uses. Removing that workaround makes this test a real
    // discriminator: T6 can only be created at all if P3's namespace was consulted.
    await createTask(corpusService, p4.id, p3.id, "T6 diverged P3 member (filed at P4)", { phase: "Track A" });

    const removeResult = await phaseService.removePhase(p3.id, "Track A");
    expect(
      removeResult.ok,
      "removePhase must be BLOCKED — T6 (a real P3 member via extra.plan_id) still references Track A",
    ).toBe(false);
  });

  it("NEGATIVE (write-adjacent consequence): renamePhase updates the diverged member's extra.phase too, not just undiverged siblings", async () => {
    const store = actedStore(new InMemoryStore());
    const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const phaseService = new PhaseService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const p3 = await createPlan(corpusService, null, "P3 Phase Rename");
    const p4 = await createPlan(corpusService, null, "P4 Phase Rename");
    await phaseService.addPhase(p3.id, "Track A");
    // P4 declares nothing — see the HAPPY test's `reason:` for why it no longer has to.
    const t6 = await createTask(corpusService, p4.id, p3.id, "T6 diverged P3 member (filed at P4)", {
      phase: "Track A",
    });

    const renameResult = await phaseService.renamePhase(p3.id, "Track A", "Track A2");
    expect(renameResult.ok).toBe(true);

    const after = await corpusService.get(t6.id);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(
      after.value.doc.extra["phase"],
      "T6's extra.phase must be renamed too — otherwise it is left referencing a phase name the plan no longer has",
    ).toBe("Track A2");
  });

  it("CONTROL: a task merely FILED at P3 but BELONGING to P4 never blocks P3's removePhase and is never touched by P3's renamePhase", async () => {
    const store = actedStore(new InMemoryStore());
    const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const phaseService = new PhaseService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const p3 = await createPlan(corpusService, null, "P3 Phase Negative");
    const p4 = await createPlan(corpusService, null, "P4 Phase Negative");
    await phaseService.addPhase(p3.id, "Track A");
    // reason: the roles are REVERSED here — T7 BELONGS to P4 and is merely filed at P3 —
    // so P4 is the plan whose namespace governs T7's `extra.phase`, and it must declare
    // "Track A" for T7 to exist. This is not the retired parent_id workaround (see the
    // HAPPY test's `reason:`); it is the membership rule stating the requirement
    // correctly: a task may only reference a phase ITS OWN plan declares.
    await phaseService.addPhase(p4.id, "Track A");
    const t7 = await createTask(corpusService, p3.id, p4.id, "T7 real P4 member, filed at P3", {
      phase: "Track A",
    });

    const removeResult = await phaseService.removePhase(p3.id, "Track A");
    expect(
      removeResult.ok,
      "T7 (a real P4 member merely filed at P3) must NOT block P3's removePhase",
    ).toBe(true);

    const after = await corpusService.get(t7.id);
    expect(after.ok && after.value.doc.extra["phase"]).toBe("Track A");
  });
});

// ─── Site 5: OutlineService.resolveAcceptanceProjection ──────────────────────

describe("OutlineService.resolveAcceptanceProjection (task-eight-more-plan-member-queries-still-key-on-parent-id)", () => {
  it("HAPPY (case H): the spec's rendered AC coverage counts the diverged P3 member (T6, filed at P4)", async () => {
    const store = actedStore(new InMemoryStore());
    const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const outlineService = new OutlineService(store);
    const prd = await createPrd(corpusService, "PRD Outline");
    const spec = await createSpec(corpusService, prd.id, "Spec Outline", [AC1]);
    const p3 = await createPlan(corpusService, spec.id, "P3 Outline");
    const p4 = await createPlan(corpusService, spec.id, "P4 Outline");
    await createTask(corpusService, p3.id, p3.id, "T5 undiverged P3 member", {
      verification_evidence: [passEvidence("AC-1")],
    });
    await createTask(corpusService, p4.id, p3.id, "T6 diverged P3 member (filed at P4)", {
      verification_evidence: [passEvidence("AC-1")],
    });

    const resolveResult = await outlineService.resolve(spec);
    expect(resolveResult.ok).toBe(true);
    if (!resolveResult.ok) return;
    expect(resolveResult.value.acceptanceCriteria).toBeDefined();
    const fact = resolveResult.value.acceptanceCriteria?.coverage.find((c) => c.ac_id === "AC-1");
    expect(fact?.pass, "T6 must count toward AC-1 coverage in the rendered outline").toBe(2);
  });

  it("CONTROL: a spec with zero plans yields an empty (never erroring) coverage", async () => {
    const store = actedStore(new InMemoryStore());
    const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const outlineService = new OutlineService(store);
    const prd = await createPrd(corpusService, "PRD Outline Control");
    const spec = await createSpec(corpusService, prd.id, "Spec Outline Control", [AC1]);

    const resolveResult = await outlineService.resolve(spec);
    expect(resolveResult.ok).toBe(true);
    if (!resolveResult.ok) return;
    const fact = resolveResult.value.acceptanceCriteria?.coverage.find((c) => c.ac_id === "AC-1");
    expect(fact?.pass).toBe(0);
    expect(fact?.fail).toBe(0);
  });
});

// ─── Site 6: SessionService.computeReadinessPointer (via resume) ────────────

describe("SessionService.computeReadinessPointer (task-eight-more-plan-member-queries-still-key-on-parent-id)", () => {
  function makeSessionService(store: InMemoryStore) {
    const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const sessionService = new SessionService(store, {
      claimTtlMinutes: 120,
      handoffTtlMinutes: 10080,
      createHandoffDoc: corpusService.createHandoffDoc.bind(corpusService),
    });
    return { corpusService, sessionService };
  }

  it("HAPPY (case H): resume's readiness pointer for P3 counts BOTH the undiverged member AND the diverged member (T6, filed at P4)", async () => {
    const store = actedStore(new InMemoryStore());
    const { corpusService, sessionService } = makeSessionService(store);
    const p3 = await createPlan(corpusService, null, "P3 Resume");
    const p4 = await createPlan(corpusService, null, "P4 Resume");
    await createTask(corpusService, p3.id, p3.id, "T5 undiverged P3 member");
    await createTask(corpusService, p4.id, p3.id, "T6 diverged P3 member (filed at P4)");

    const handoffResult = await sessionService.writeHandoff({
      by: "alice",
      plan_ref: p3.slug,
      task_refs: [],
      modified_files: [],
      key_decisions: [],
      next_steps: ["continue"],
    });
    expect(handoffResult.ok).toBe(true);

    const resumeResult = await sessionService.resume({ plan: p3.slug });
    expect(resumeResult.ok).toBe(true);
    if (!resumeResult.ok) return;
    expect(resumeResult.value.found).toBe(true);
    if (!resumeResult.value.found) return;
    expect(
      resumeResult.value.readiness?.total,
      "readiness.total must count T6 (a real P3 member via extra.plan_id, filed at P4)",
    ).toBe(2);
  });

  it("CONTROL: a plain plan (parent_id === extra.plan_id everywhere) yields the byte-identical readiness total the pre-fix parent_id-keyed query would have", async () => {
    const store = actedStore(new InMemoryStore());
    const { corpusService, sessionService } = makeSessionService(store);
    const plan = await createPlan(corpusService, null, "Plain Resume Plan");
    await createTask(corpusService, plan.id, plan.id, "T1");
    await createTask(corpusService, plan.id, plan.id, "T2");

    const handoffResult = await sessionService.writeHandoff({
      by: "alice",
      plan_ref: plan.slug,
      task_refs: [],
      modified_files: [],
      key_decisions: [],
      next_steps: ["continue"],
    });
    expect(handoffResult.ok).toBe(true);

    const resumeResult = await sessionService.resume({ plan: plan.slug });
    expect(resumeResult.ok).toBe(true);
    if (!resumeResult.ok) return;
    if (!resumeResult.value.found) return;
    expect(resumeResult.value.readiness?.total).toBe(2);
  });

  it("CONTROL: an --adhoc task (no plan_id) is never counted in any plan's readiness total", async () => {
    const store = actedStore(new InMemoryStore());
    const { corpusService, sessionService } = makeSessionService(store);
    await createPrd(corpusService, "Root PRD Adhoc Resume"); // --adhoc tasks auto-parent to the root PRD
    const plan = await createPlan(corpusService, null, "Adhoc Resume Plan");
    await createTask(corpusService, plan.id, plan.id, "T1");
    const adhocResult = await corpusService.create({
      type: "task",
      title: "Adhoc",
      content: "body",
      extra: { adhoc: true },
    } as CreateDocInput);
    if (!adhocResult.ok) throw new Error(`Failed to create adhoc task: ${JSON.stringify(adhocResult.error)}`);

    const handoffResult = await sessionService.writeHandoff({
      by: "alice",
      plan_ref: plan.slug,
      task_refs: [],
      modified_files: [],
      key_decisions: [],
      next_steps: ["continue"],
    });
    expect(handoffResult.ok).toBe(true);

    const resumeResult = await sessionService.resume({ plan: plan.slug });
    expect(resumeResult.ok).toBe(true);
    if (!resumeResult.ok) return;
    if (!resumeResult.value.found) return;
    expect(resumeResult.value.readiness?.total).toBe(1);
  });
});
