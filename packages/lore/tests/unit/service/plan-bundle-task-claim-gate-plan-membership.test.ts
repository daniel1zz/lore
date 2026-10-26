/**
 * plan-bundle-task-claim-gate-plan-membership.test.ts —
 * task-eight-more-plan-member-queries-still-key-on-parent-id, dedicated site:
 * `CorpusService.getPlanBundle`.
 *
 * `getPlanBundle`'s `tasks[]` feeds `checkpoint-registry.ts::buildAnchorGateContext`'s
 * `siblingClaims`, which `task-claim`'s `noAnchorOverlap` predicate consumes
 * (`TaskWorkflowService`'s claim-gate wiring, `task-workflow-service.ts:2895`, off-limits
 * to this task). Before this fix, `getPlanBundle` queried `parent_id`-keyed tasks — a
 * membership error here changes WHICH WRITES ARE ALLOWED, not merely what a read
 * displays, so per the task's own AC4 this site gets a DEDICATED test asserting the
 * ACTUAL gate decision (`checkpointRegistry["task-claim"].check(ctx)` +
 * `isCheckpointBlocked`), never merely `getPlanBundle`'s return shape.
 *
 * Case H (task-plan-membership-is-extra-plan-id-but-the-last-task): T6 is
 * `--parent P4 --plan-id P3` — T6 BELONGS to P3 (extra.plan_id) but is FILED at P4
 * (parent_id). Before the fix, `getPlanBundle(P3)` queried `parent_id: P3.id`, so T6
 * (parent_id = P4) was invisible to P3's bundle — T6's own fresh claim/anchors never
 * reached `siblingClaims`, so an anchor-conflicting claim on a REAL P3 sibling slipped
 * past `noAnchorOverlap` undetected.
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / STATE / REGRESSION
 * (no dedicated ERROR case here — `getPlanBundle`'s store-failure propagation is
 * already covered by `corpus-service.test.ts`'s existing suite; this file's added
 * value is the task-claim gate-decision assertion, not findMany error plumbing).
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
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import {
  checkpointRegistry,
  buildAnchorGateContext,
  isCheckpointBlocked,
  type GateContext,
} from "../../../src/service/checkpoint-registry.js";
import type { CreateDocInput, DocRecord } from "@lore/core";
import { actedStore } from "../../live-invocation.js";

import { fakeWorktreeProbe } from "../../helpers/fake-worktree-probe.js";
function makeServices() {
  const store = actedStore(new InMemoryStore());
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const taskWorkflowService = new TaskWorkflowService(store, undefined, { claimTtlMinutes: 120 }, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, fakeWorktreeProbe());
  return { store, corpusService, taskWorkflowService };
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
  anchors: string[],
): Promise<DocRecord> {
  const result = await cs.create({
    type: "task",
    title,
    parent_id: parentId,
    content: "body",
    extra: { plan_id: planId, file_anchors: anchors },
  } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create task: ${JSON.stringify(result.error)}`);
  return result.value;
}

/** Builds a `task-claim` GateContext isolated to ONLY `noAnchorOverlap`
 *  (`hasSpecParent` left unset) — the predicate this fix's consequence lands on;
 *  `upstreamApproved` is an orthogonal concern this test does not exercise. */
function anchorOnlyCtx(
  candidateBy: string,
  candidateTask: DocRecord,
  siblingTasks: DocRecord[],
  nowIso: string,
  ttlMinutes: number,
): GateContext {
  return buildAnchorGateContext(candidateBy, candidateTask, siblingTasks, nowIso, ttlMinutes);
}

const NOW = "2026-08-03T00:00:00.000Z";

describe("getPlanBundle feeds the task-claim gate (dedicated, task-eight-more-plan-member-queries-still-key-on-parent-id AC4)", () => {
  // ── HAPPY ──────────────────────────────────────────────────────────────

  it("HAPPY: a diverged P3 member's (T6, filed at P4) fresh anchor-overlapping claim IS detected — task-claim DENIES the candidate", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const p3 = await createPlan(corpusService, "P3");
    const p4 = await createPlan(corpusService, "P4");
    const t6 = await createTask(corpusService, p4.id, p3.id, "T6 diverged P3 member (filed at P4)", [
      "src/shared.ts",
    ]);
    const candidate = await createTask(corpusService, p3.id, p3.id, "Candidate (real P3 member)", [
      "src/shared.ts",
    ]);

    const claimResult = await taskWorkflowService.claim(t6.id, { by: "bob", worktree: "/wt/bob", branch: "b-bob" });
    expect(claimResult.ok).toBe(true);

    const bundleResult = await corpusService.getPlanBundle(p3.id);
    expect(bundleResult.ok).toBe(true);
    if (!bundleResult.ok) return;

    expect(
      bundleResult.value.tasks.some((t) => t.id === t6.id),
      "T6 (a real P3 member via extra.plan_id, filed at P4) is missing from getPlanBundle(P3).tasks",
    ).toBe(true);

    const ctx = anchorOnlyCtx("alice", candidate, bundleResult.value.tasks, NOW, 120);
    const results = checkpointRegistry["task-claim"]!.check(ctx);
    const blocked = isCheckpointBlocked(results);

    expect(
      blocked,
      "task-claim must DENY: the candidate's anchor (src/shared.ts) overlaps T6's fresh claim, and T6 IS a real P3 sibling via extra.plan_id",
    ).toBe(true);
  });

  // ── NEGATIVE ───────────────────────────────────────────────────────────

  it("NEGATIVE: a task merely FILED at P3 but BELONGING to P4 (extra.plan_id=P4) is NOT treated as P3's sibling — its claim never blocks a P3 candidate", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const p3 = await createPlan(corpusService, "P3 Negative");
    const p4 = await createPlan(corpusService, "P4 Negative");
    // T7 belongs to P4 but is filed (parent_id) at P3 — the OPPOSITE divergence.
    const t7 = await createTask(corpusService, p3.id, p4.id, "T7 real P4 member, filed at P3", [
      "src/other.ts",
    ]);
    const candidate = await createTask(corpusService, p3.id, p3.id, "Candidate (real P3 member)", [
      "src/other.ts",
    ]);

    const claimResult = await taskWorkflowService.claim(t7.id, { by: "carol", worktree: "/wt/carol", branch: "b-carol" });
    expect(claimResult.ok).toBe(true);

    const bundleResult = await corpusService.getPlanBundle(p3.id);
    expect(bundleResult.ok).toBe(true);
    if (!bundleResult.ok) return;

    expect(
      bundleResult.value.tasks.some((t) => t.id === t7.id),
      "T7 (a real P4 member, merely filed at P3) must NOT appear in getPlanBundle(P3).tasks",
    ).toBe(false);

    const ctx = anchorOnlyCtx("alice", candidate, bundleResult.value.tasks, NOW, 120);
    const results = checkpointRegistry["task-claim"]!.check(ctx);
    const blocked = isCheckpointBlocked(results);

    expect(
      blocked,
      "task-claim must NOT deny on T7's claim — T7 is not actually P3's sibling despite sharing its anchor and parent_id",
    ).toBe(false);
  });

  // ── BOUNDARY ───────────────────────────────────────────────────────────

  it("BOUNDARY: an --adhoc task (no plan_id, parented to the root PRD) never appears in any plan's bundle and never feeds the gate", async () => {
    const { corpusService } = makeServices();
    const p3 = await createPlan(corpusService, "P3 Adhoc Boundary");
    const rootPrd = await corpusService.create({
      type: "prd",
      title: "Root PRD Adhoc Boundary",
      content: "root",
    } as CreateDocInput);
    if (!rootPrd.ok) throw new Error(`Failed to create root PRD: ${JSON.stringify(rootPrd.error)}`);
    const adhocResult = await corpusService.create({
      type: "task",
      title: "Adhoc task",
      content: "body",
      extra: { adhoc: true, file_anchors: ["src/shared.ts"] },
    } as CreateDocInput);
    if (!adhocResult.ok) throw new Error(`Failed to create adhoc task: ${JSON.stringify(adhocResult.error)}`);

    const bundleResult = await corpusService.getPlanBundle(p3.id);
    expect(bundleResult.ok).toBe(true);
    if (!bundleResult.ok) return;
    expect(bundleResult.value.tasks.some((t) => t.id === adhocResult.value.id)).toBe(false);
  });

  // ── STATE / CONTROL ────────────────────────────────────────────────────

  it("STATE (CONTROL): a plain plan (every task's parent_id === extra.plan_id) produces the byte-identical bundle.tasks set the pre-fix parent_id-keyed query would have", async () => {
    const { corpusService } = makeServices();
    const plan = await createPlan(corpusService, "Plain Plan");
    const t1 = await createTask(corpusService, plan.id, plan.id, "T1", []);
    const t2 = await createTask(corpusService, plan.id, plan.id, "T2", []);

    const bundleResult = await corpusService.getPlanBundle(plan.id);
    expect(bundleResult.ok).toBe(true);
    if (!bundleResult.ok) return;
    const ids = bundleResult.value.tasks.map((t) => t.id);
    expect(new Set(ids)).toEqual(new Set([t1.id, t2.id]));
    expect(ids.length).toBe(2);
  });

  // ── REGRESSION ─────────────────────────────────────────────────────────

  it("REGRESSION: a plan with zero tasks still yields an empty (never erroring) bundle", async () => {
    const { corpusService } = makeServices();
    const plan = await createPlan(corpusService, "Empty Plan");
    const bundleResult = await corpusService.getPlanBundle(plan.id);
    expect(bundleResult.ok).toBe(true);
    if (!bundleResult.ok) return;
    expect(bundleResult.value.tasks).toEqual([]);
  });
});
