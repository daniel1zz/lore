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
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import type { CreateDocInput, DocRecord } from "@lore/core";

function makeServices() {
  const store = new InMemoryStore();
  const corpusService = new CorpusService(store, new RecordLockService(store));
  return { store, corpusService };
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
    const { corpusService } = makeServices();
    const p3 = await createPlan(corpusService, "P3 Cascade Happy");
    const undiverged = await createTask(corpusService, p3.id, p3.id, "Undiverged P3 member");
    await approvePlan(corpusService, p3.id);

    const closeResult = await closePlan(corpusService, p3.id);
    expect(closeResult.ok).toBe(true);
    if (!closeResult.ok) return;

    expect(closeResult.value.cascade?.archived.some((a) => a.doc_id === undiverged.id)).toBe(true);
    const after = await corpusService.get(undiverged.id);
    expect(after.ok && after.value.doc.status).toBe("archived");
  });

  // ── NEGATIVE (AC4 direction 1: no non-member archived) ─────────────────

  it("NEGATIVE: a task merely FILED at P3 but BELONGING to P4 (extra.plan_id=P4) is NOT archived when P3 closes", async () => {
    const { corpusService } = makeServices();
    const p3 = await createPlan(corpusService, "P3 Cascade Negative");
    const p4 = await createPlan(corpusService, "P4 Cascade Negative");
    // T7 belongs to P4 but is filed (parent_id) at P3.
    const t7 = await createTask(corpusService, p3.id, p4.id, "T7 real P4 member, filed at P3");
    await approvePlan(corpusService, p3.id);

    const closeResult = await closePlan(corpusService, p3.id);
    expect(closeResult.ok).toBe(true);
    if (!closeResult.ok) return;

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
    const { corpusService } = makeServices();
    const p3 = await createPlan(corpusService, "P3 Cascade Boundary");
    const p4 = await createPlan(corpusService, "P4 Cascade Boundary");
    // T6 belongs to P3 but is filed (parent_id) at P4 — the diverged member case H.
    const t6 = await createTask(corpusService, p4.id, p3.id, "T6 diverged P3 member, filed at P4");
    await approvePlan(corpusService, p3.id);

    const closeResult = await closePlan(corpusService, p3.id);
    expect(closeResult.ok).toBe(true);
    if (!closeResult.ok) return;

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
    const { corpusService } = makeServices();
    const plan = await createPlan(corpusService, "Plain Cascade Plan");
    const t1 = await createTask(corpusService, plan.id, plan.id, "T1");
    const t2 = await createTask(corpusService, plan.id, plan.id, "T2");
    await approvePlan(corpusService, plan.id);

    const closeResult = await closePlan(corpusService, plan.id);
    expect(closeResult.ok).toBe(true);
    if (!closeResult.ok) return;

    const archivedIds = new Set((closeResult.value.cascade?.archived ?? []).map((a) => a.doc_id));
    expect(archivedIds).toEqual(new Set([t1.id, t2.id]));
  });

  // ── REGRESSION ─────────────────────────────────────────────────────────

  it("REGRESSION: an --adhoc task (no plan_id, parented to the root PRD) is never touched by any plan's cascade", async () => {
    const { corpusService } = makeServices();
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

    const after = await corpusService.get(adhocResult.value.id);
    expect(after.ok && after.value.doc.status).toBe("draft");
  });
});
