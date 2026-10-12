/**
 * plan-close-cascade-plan-membership.test.ts —
 * task-eight-more-plan-member-queries-still-key-on-parent-id, dedicated site:
 * `CorpusService.cascadeArchiveOnPlanClose` (spec-lifecycle-archival-plan-close-
 * cascade-deterministic §Design Decisions D2).
 *
 * The cascade ARCHIVES documents when a plan closes — a membership error here is a
 * WRITE-PATH defect, not cosmetic (per this task's own AC4): before this fix, the
 * cascade queried `parent_id`-keyed tasks, which gets membership wrong in BOTH
 * directions simultaneously:
 *   - a task merely FILED under the closing plan (`--parent`) but BELONGING
 *     (`extra.plan_id`) to a DIFFERENT plan would be wrongly ARCHIVED;
 *   - a task that truly BELONGS to the closing plan but is FILED elsewhere (a
 *     diverged member) would be silently STRANDED — never archived at all, because
 *     the `parent_id`-keyed fetch never even sees it.
 *
 * Both directions are asserted here directly against the cascade's own
 * `PlanCloseCascadeResult` (`archived`/`skipped`/`failed`) AND the persisted doc
 * status after the plan-close `set()` call — not merely inferred from
 * `getPlanBundle`'s shape (that is the SEPARATE dedicated site,
 * plan-bundle-task-claim-gate-plan-membership.test.ts).
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / STATE / REGRESSION
 *
 * @spec_ref task-eight-more-plan-member-queries-still-key-on-parent-id
 * @spec_ref task-plan-membership-is-extra-plan-id-but-the-last-task (case H)
 * @spec_ref spec-lifecycle-archival-plan-close-cascade-deterministic §Design Decisions D2
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { err, ok } from "@lore/core";
import type { CreateDocInput, DocRecord, LoreError, Result } from "@lore/core";

/**
 * RE-BASELINED by spec-approval-and-plan-closure-go-through-the-same-checks-on
 * (AC-AP-5, BR-1072, #47). The cascade now asks an injected `DoneFloorPort` about
 * every member task before archiving it. This file's membership cases keep their
 * original assertions (membership is by `extra.plan_id`, never `parent_id`) and now
 * also pin that the port is asked about EXACTLY the members: the stub logs every id
 * it is asked about. Cases (b)-(d) at the bottom pin the port contract:
 * `{floor, error}` -> skipped + floor, `err` -> failed, `null` -> archived.
 *
 * The port types are declared structurally here (the spec's D2/D5 shape) so this
 * file compiles before the paired implement task adds `setDoneFloorPort`; wiring
 * goes through {@link wireDoneFloorPort}, whose existence check is an assertion.
 */
type StubFloor = "attested-pass" | "red-first" | "no-new-tests" | "unfiltered-test-file";
type StubVerdict = Result<{ floor: StubFloor; error: LoreError } | null, LoreError>;

class StubDoneFloorPort {
  readonly asked: string[] = [];
  constructor(private readonly verdictFor: (taskId: string) => StubVerdict = () => ok(null)) {}
  async checkDoneFloors(taskId: string): Promise<StubVerdict> {
    this.asked.push(taskId);
    return this.verdictFor(taskId);
  }
}

function wireDoneFloorPort(cs: CorpusService, port: StubDoneFloorPort): void {
  const target = cs as unknown as { setDoneFloorPort?: (p: StubDoneFloorPort) => void };
  expect(
    typeof target.setDoneFloorPort,
    "CorpusService.setDoneFloorPort must exist (added by the paired implement task, spec D5)",
  ).toBe("function");
  target.setDoneFloorPort!(port);
}

function makeServices(port?: StubDoneFloorPort) {
  const store = new InMemoryStore();
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  if (port !== undefined) wireDoneFloorPort(corpusService, port);
  return { store, corpusService };
}

function floorRefusal(floor: StubFloor): StubVerdict {
  return ok({
    floor,
    error: { code: "VALIDATION_ERROR", field: "extra.verification_evidence", message: `refused by ${floor}`, details: { floor } } as LoreError,
  });
}

async function createPlan(cs: CorpusService, title: string): Promise<DocRecord> {
  const result = await cs.create({ type: "plan", title, content: "body" } as CreateDocInput);
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
): Promise<DocRecord> {
  const result = await cs.create({
    type: "task",
    title,
    parent_id: parentId,
    content: "body",
    extra: { plan_id: planId },
  } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create task: ${JSON.stringify(result.error)}`);
  return result.value;
}

/** Promotes a fresh `draft` plan to `approved` (fast-track) — the closeable-from
 *  precondition (`VALID_TRANSITIONS`: draft -> approved -> archived directly). */
async function approvePlan(cs: CorpusService, planId: string): Promise<void> {
  const result = await cs.set(planId, { status: "approved" });
  if (!result.ok) throw new Error(`Failed to approve plan: ${JSON.stringify(result.error)}`);
}

async function closePlan(cs: CorpusService, planId: string) {
  return cs.set(planId, { status: "archived" }, { by: "agent:closer" });
}

describe("cascadeArchiveOnPlanClose (dedicated, task-eight-more-plan-member-queries-still-key-on-parent-id AC4)", () => {
  // ── HAPPY ──────────────────────────────────────────────────────────────

  it("HAPPY: closing P3 archives its real undiverged member alongside the diverged one", async () => {
    const port = new StubDoneFloorPort();
    const { corpusService } = makeServices(port);
    const p3 = await createPlan(corpusService, "P3 Cascade Happy");
    const undiverged = await createTask(corpusService, p3.id, p3.id, "Undiverged P3 member");
    await approvePlan(corpusService, p3.id);

    const closeResult = await closePlan(corpusService, p3.id);
    expect(closeResult.ok).toBe(true);
    if (!closeResult.ok) return;
    expect(port.asked, "the cascade asks the done-floor port about exactly the member task").toEqual([undiverged.id]);

    expect(closeResult.value.cascade?.archived.some((a) => a.doc_id === undiverged.id)).toBe(true);
    const after = await corpusService.get(undiverged.id);
    expect(after.ok && after.value.doc.status).toBe("archived");
  });

  // ── NEGATIVE (AC4 direction 1: no non-member archived) ─────────────────

  it("NEGATIVE: a task merely FILED at P3 but BELONGING to P4 (extra.plan_id=P4) is NOT archived when P3 closes", async () => {
    const port = new StubDoneFloorPort();
    const { corpusService } = makeServices(port);
    const p3 = await createPlan(corpusService, "P3 Cascade Negative");
    const p4 = await createPlan(corpusService, "P4 Cascade Negative");
    // T7 belongs to P4 but is filed (parent_id) at P3.
    const t7 = await createTask(corpusService, p3.id, p4.id, "T7 real P4 member, filed at P3");
    await approvePlan(corpusService, p3.id);

    const closeResult = await closePlan(corpusService, p3.id);
    expect(closeResult.ok).toBe(true);
    if (!closeResult.ok) return;
    expect(port.asked, "a non-member filed under the plan is never checked").toEqual([]);

    expect(
      closeResult.value.cascade?.archived.some((a) => a.doc_id === t7.id),
      "T7 (a real P4 member, merely filed at P3) must NOT be in P3's cascade.archived",
    ).toBe(false);

    const after = await corpusService.get(t7.id);
    expect(after.ok, "T7 must still resolve").toBe(true);
    if (!after.ok) return;
    expect(after.value.doc.status, "T7's status must be UNCHANGED (still draft) — it is not P3's member").toBe(
      "draft",
    );
  });

  // ── BOUNDARY (AC4 direction 2: no member stranded) ──────────────────────

  it("BOUNDARY: a diverged real P3 member (T6, filed at P4) IS archived when P3 closes — not silently stranded", async () => {
    const port = new StubDoneFloorPort();
    const { corpusService } = makeServices(port);
    const p3 = await createPlan(corpusService, "P3 Cascade Boundary");
    const p4 = await createPlan(corpusService, "P4 Cascade Boundary");
    // T6 belongs to P3 but is filed (parent_id) at P4 — the diverged member case H.
    const t6 = await createTask(corpusService, p4.id, p3.id, "T6 diverged P3 member, filed at P4");
    await approvePlan(corpusService, p3.id);

    const closeResult = await closePlan(corpusService, p3.id);
    expect(closeResult.ok).toBe(true);
    if (!closeResult.ok) return;
    expect(port.asked, "a diverged member (filed elsewhere, belongs here) is checked through the port").toEqual([t6.id]);

    expect(
      closeResult.value.cascade?.archived.some((a) => a.doc_id === t6.id),
      "T6 (a real P3 member via extra.plan_id, filed at P4) must be archived by P3's cascade — not stranded",
    ).toBe(true);

    const after = await corpusService.get(t6.id);
    expect(after.ok && after.value.doc.status).toBe("archived");

    // T6 must NOT also be double-archived by P4's own (separate) close.
    const p4Approve = await corpusService.set(p4.id, { status: "approved" });
    expect(p4Approve.ok).toBe(true);
    const p4Close = await closePlan(corpusService, p4.id);
    expect(p4Close.ok).toBe(true);
    if (!p4Close.ok) return;
    expect(
      p4Close.value.cascade?.archived.some((a) => a.doc_id === t6.id),
      "T6 already belongs to P3 (not P4) — P4's OWN cascade must not also claim it",
    ).toBe(false);
  });

  // ── STATE (CONTROL) ─────────────────────────────────────────────────────

  it("STATE (CONTROL): a plain plan (every task's parent_id === extra.plan_id) cascades byte-identically to the pre-fix parent_id-keyed behavior", async () => {
    const port = new StubDoneFloorPort();
    const { corpusService } = makeServices(port);
    const plan = await createPlan(corpusService, "Plain Cascade Plan");
    const t1 = await createTask(corpusService, plan.id, plan.id, "T1");
    const t2 = await createTask(corpusService, plan.id, plan.id, "T2");
    await approvePlan(corpusService, plan.id);

    const closeResult = await closePlan(corpusService, plan.id);
    expect(closeResult.ok).toBe(true);
    if (!closeResult.ok) return;
    expect([...port.asked].sort()).toEqual([t1.id, t2.id].sort());

    const archivedIds = new Set((closeResult.value.cascade?.archived ?? []).map((a) => a.doc_id));
    expect(archivedIds).toEqual(new Set([t1.id, t2.id]));
  });

  // ── REGRESSION ─────────────────────────────────────────────────────────

  it("REGRESSION: an --adhoc task (no plan_id, parented to the root PRD) is never touched by any plan's cascade", async () => {
    const port = new StubDoneFloorPort();
    const { corpusService } = makeServices(port);
    const p3 = await createPlan(corpusService, "P3 Cascade Regression");
    const rootPrd = await corpusService.create({
      type: "prd",
      title: "Root PRD Cascade Regression",
      content: "root",
    } as CreateDocInput);
    if (!rootPrd.ok) throw new Error(`Failed to create root PRD: ${JSON.stringify(rootPrd.error)}`);
    const adhocResult = await corpusService.create({
      type: "task",
      title: "Adhoc task",
      content: "body",
      extra: { adhoc: true },
    } as CreateDocInput);
    if (!adhocResult.ok) throw new Error(`Failed to create adhoc task: ${JSON.stringify(adhocResult.error)}`);
    await approvePlan(corpusService, p3.id);

    const closeResult = await closePlan(corpusService, p3.id);
    expect(closeResult.ok).toBe(true);
    if (!closeResult.ok) return;
    expect(closeResult.value.cascade?.archived.some((a) => a.doc_id === adhocResult.value.id)).toBe(false);
    expect(port.asked, "an adhoc task is never asked about").toEqual([]);

    const after = await corpusService.get(adhocResult.value.id);
    expect(after.ok && after.value.doc.status).toBe("draft");
  });
});

describe("cascadeArchiveOnPlanClose port contract (AC-AP-5, BR-1072, D5/D6)", () => {
  // (a) membership by extra.plan_id — the call log equals the member set exactly.
  it("(a) REGRESSION: the port is asked about exactly the extra.plan_id members; a task filed under the plan but belonging elsewhere is neither checked nor archived", async () => {
    const port = new StubDoneFloorPort();
    const { corpusService } = makeServices(port);
    const p3 = await createPlan(corpusService, "P3 Port Membership");
    const p4 = await createPlan(corpusService, "P4 Port Membership");
    const own = await createTask(corpusService, p3.id, p3.id, "Own member filed at P3");
    const diverged = await createTask(corpusService, p4.id, p3.id, "Diverged member filed at P4");
    const foreign = await createTask(corpusService, p3.id, p4.id, "Foreign task filed at P3");
    await approvePlan(corpusService, p3.id);

    const closeResult = await closePlan(corpusService, p3.id);
    expect(closeResult.ok).toBe(true);
    if (!closeResult.ok) return;

    expect([...port.asked].sort()).toEqual([own.id, diverged.id].sort());
    expect(closeResult.value.cascade?.archived.map((a) => a.doc_id).sort()).toEqual([own.id, diverged.id].sort());
    const after = await corpusService.get(foreign.id);
    expect(after.ok && after.value.doc.status).toBe("draft");
  });

  // (b) {floor, error} -> skipped with that floor, task untouched.
  it("(b) NEGATIVE: a stub returning {floor:'no-new-tests', error} puts that member in skipped with the floor and leaves it open; the other member is archived", async () => {
    let refusedId = "";
    const port = new StubDoneFloorPort((id) => (id === refusedId ? floorRefusal("no-new-tests") : ok(null)));
    const { corpusService } = makeServices(port);
    const plan = await createPlan(corpusService, "Port Floor Plan");
    const refused = await createTask(corpusService, plan.id, plan.id, "Refused member");
    const cleared = await createTask(corpusService, plan.id, plan.id, "Cleared member");
    refusedId = refused.id;
    await approvePlan(corpusService, plan.id);

    const closeResult = await closePlan(corpusService, plan.id);
    expect(closeResult.ok).toBe(true);
    if (!closeResult.ok) return;
    const cascade = closeResult.value.cascade!;

    const skipped = cascade.skipped.find((s) => s.doc_id === refused.id) as { floor?: string; reason: string } | undefined;
    expect(skipped, "the refused member is listed in skipped").toBeDefined();
    expect(skipped?.floor).toBe("no-new-tests");
    expect(skipped?.reason).toContain("no-new-tests");
    expect(cascade.failed).toEqual([]);
    expect(cascade.archived.map((a) => a.doc_id)).toEqual([cleared.id]);

    const after = await corpusService.get(refused.id);
    expect(after.ok && after.value.doc.status).toBe("draft");
  });

  // (c) port err -> failed (D6), never a skip, never a rollback of the plan.
  it("(c) ERROR: a stub returning err for one member puts it in cascade.failed with that message; the plan stays archived and the other members are still processed", async () => {
    let brokenId = "";
    const port = new StubDoneFloorPort((id) =>
      id === brokenId
        ? err({ code: "STORE_ERROR", message: "port exploded on this member" } as LoreError)
        : ok(null),
    );
    const { corpusService } = makeServices(port);
    const plan = await createPlan(corpusService, "Port Error Plan");
    const broken = await createTask(corpusService, plan.id, plan.id, "Broken member");
    const fine = await createTask(corpusService, plan.id, plan.id, "Fine member");
    brokenId = broken.id;
    await approvePlan(corpusService, plan.id);

    const closeResult = await closePlan(corpusService, plan.id);
    expect(closeResult.ok).toBe(true);
    if (!closeResult.ok) return;
    expect(closeResult.value.status).toBe("archived");
    const cascade = closeResult.value.cascade!;

    expect(cascade.failed.map((f) => f.doc_id)).toEqual([broken.id]);
    expect(cascade.failed[0]?.reason).toContain("port exploded on this member");
    expect(cascade.skipped.some((s) => s.doc_id === broken.id), "an error is a failure, not a skip").toBe(false);
    expect(cascade.archived.map((a) => a.doc_id)).toEqual([fine.id]);

    const planAfter = await corpusService.get(plan.id);
    expect(planAfter.ok && planAfter.value.doc.status).toBe("archived");
    const brokenAfter = await corpusService.get(broken.id);
    expect(brokenAfter.ok && brokenAfter.value.doc.status).toBe("draft");
  });

  // (d) null -> archived as before.
  it("(d) HAPPY: a stub returning null archives the member", async () => {
    const port = new StubDoneFloorPort(() => ok(null));
    const { corpusService } = makeServices(port);
    const plan = await createPlan(corpusService, "Port Null Plan");
    const member = await createTask(corpusService, plan.id, plan.id, "Clearing member");
    await approvePlan(corpusService, plan.id);

    const closeResult = await closePlan(corpusService, plan.id);
    expect(closeResult.ok).toBe(true);
    if (!closeResult.ok) return;
    expect(port.asked).toEqual([member.id]);
    expect(closeResult.value.cascade?.archived.map((a) => a.doc_id)).toEqual([member.id]);
    expect(closeResult.value.cascade?.skipped).toEqual([]);
    expect(closeResult.value.cascade?.failed).toEqual([]);
    const after = await corpusService.get(member.id);
    expect(after.ok && after.value.doc.status).toBe("archived");
  });
});
