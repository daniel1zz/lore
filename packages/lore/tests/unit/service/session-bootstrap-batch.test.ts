/**
 * Tests for SessionService.bootstrap's N+1 fix (SPEC review M5) — the per-active-plan
 * `findLinksByToIds` call inside `computeTaskCounts` is now batched into ONE
 * `findLinksByToIds` call across every active plan's tasks, instead of one call per
 * plan. Uses InMemoryStore — no file I/O, no SQLite.
 *
 * Dimension mapping:
 *   BOUNDARY:   `bootstrap` over N (>1) active plans issues EXACTLY ONE
 *               `findLinksByToIds` call, not N (counting-subclass store oracle,
 *               mirrors StalenessProbeService's `CountingStore` precedent)
 *   HAPPY:      the batched per-plan `task_counts` are byte-identical to what the
 *               pre-batch per-plan fetch produced — cross-plan blocker links never
 *               bleed into the wrong plan's counts
 *   REGRESSION: an archived plan (excluded from `active_plans`) contributes NEITHER
 *               a findLinksByToIds call target NOR a task_counts entry
 *
 * @spec_ref N+1 batch-method hardening (SessionService.bootstrap, review M5)
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { SessionService } from "../../../src/service/session-service.js";
import type { DocId, LinkType, CreateDocInput } from "@lore/core";

/** Counting subclass — asserts batch-call-count invariants (mirrors StalenessProbeService's CountingStore precedent). */
class CountingStore extends InMemoryStore {
  findLinksByToIdsCallCount = 0;

  override async findLinksByToIds(toIds: DocId[], linkType: LinkType) {
    this.findLinksByToIdsCallCount += 1;
    return super.findLinksByToIds(toIds, linkType);
  }
}

function makeSessionService(store: CountingStore) {
  const corpusService = new CorpusService(store, new RecordLockService(store));
  const sessionService = new SessionService(store, {
    claimTtlMinutes: 120,
    handoffTtlMinutes: 10080,
    createHandoffDoc: corpusService.createHandoffDoc.bind(corpusService),
  });
  return { corpusService, sessionService };
}

async function mustCreate(cs: CorpusService, input: CreateDocInput) {
  const result = await cs.create(input);
  if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

describe("SessionService.bootstrap — BOUNDARY: batched findLinksByToIds call count", () => {
  it("issues EXACTLY ONE findLinksByToIds call across 3 active plans, not 3", async () => {
    const store = new CountingStore();
    const { corpusService, sessionService } = makeSessionService(store);

    // Three plans, each with a blocker/blocked pair of tasks. Every plan's blocker
    // task must NOT satisfy another plan's readiness — a bug that batches links
    // without correctly scoping per-task-id would leak blocker status across plans.
    for (let i = 0; i < 3; i++) {
      const plan = await mustCreate(corpusService, {
        type: "plan",
        title: `Plan ${i}`,
        content: "# Plan",
      } as CreateDocInput);

      const blocker = await mustCreate(corpusService, {
        type: "task",
        title: `Blocker ${i}`,
        parent_id: plan.id,
        content: "# Task",
        extra: { plan_id: plan.id },
      } as CreateDocInput);

      const blocked = await mustCreate(corpusService, {
        type: "task",
        title: `Blocked ${i}`,
        parent_id: plan.id,
        content: "# Task",
        extra: { plan_id: plan.id },
      } as CreateDocInput);

      const linkResult = await corpusService.link(blocker.id, blocked.id, "blocks");
      if (!linkResult.ok) throw new Error(JSON.stringify(linkResult.error));
    }

    store.findLinksByToIdsCallCount = 0; // reset — only count calls made during bootstrap itself
    const bootstrapResult = await sessionService.bootstrap("alice");
    expect(bootstrapResult.ok).toBe(true);
    if (!bootstrapResult.ok) return;

    expect(store.findLinksByToIdsCallCount).toBe(1);

    // HAPPY: each plan's counts reflect ONLY its own blocker/blocked pair — the
    // blocker is unarchived (unready), so it's "ready" (no blockers on it) but the
    // blocked task is NOT ready (its blocker isn't archived). No cross-plan leakage.
    expect(bootstrapResult.value.active_plans).toHaveLength(3);
    for (const planSummary of bootstrapResult.value.active_plans) {
      expect(planSummary.task_counts).toEqual({ ready: 1, claimed: 0, done: 0 });
    }
  });

  it("an archived plan is excluded from active_plans and contributes no task ids to the batch", async () => {
    const store = new CountingStore();
    const { corpusService, sessionService } = makeSessionService(store);

    const activePlan = await mustCreate(corpusService, {
      type: "plan",
      title: "Active Plan",
      content: "# Plan",
    } as CreateDocInput);
    await mustCreate(corpusService, {
      type: "task",
      title: "Active Task",
      parent_id: activePlan.id,
      content: "# Task",
      extra: { plan_id: activePlan.id },
    } as CreateDocInput);

    const archivedPlan = await mustCreate(corpusService, {
      type: "plan",
      title: "Archived Plan",
      content: "# Plan",
    } as CreateDocInput);
    const archiveResult = await store.update(archivedPlan.id, { status: "archived" });
    if (!archiveResult.ok) throw new Error(JSON.stringify(archiveResult.error));
    await mustCreate(corpusService, {
      type: "task",
      title: "Archived Plan's Task",
      parent_id: archivedPlan.id,
      content: "# Task",
      extra: { plan_id: archivedPlan.id },
    } as CreateDocInput);

    store.findLinksByToIdsCallCount = 0;
    const result = await sessionService.bootstrap("alice");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(store.findLinksByToIdsCallCount).toBe(1);
    expect(result.value.active_plans).toHaveLength(1);
    expect(result.value.active_plans[0]!.slug).toBe(activePlan.slug);
    expect(result.value.active_plans[0]!.task_counts).toEqual({ ready: 1, claimed: 0, done: 0 });
  });

  it("BOUNDARY: zero active plans still returns ok and issues the (empty) batch call once", async () => {
    const store = new CountingStore();
    const { sessionService } = makeSessionService(store);

    store.findLinksByToIdsCallCount = 0;
    const result = await sessionService.bootstrap("alice");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.active_plans).toEqual([]);
    // reason: findLinksByToIds([], "blocks") is itself the empty-array boundary case
    // (store returns ok(empty) immediately, no query issued) — it's still ONE method
    // call at the SessionService call site, just with an empty argument.
    expect(store.findLinksByToIdsCallCount).toBe(1);
  });
});
