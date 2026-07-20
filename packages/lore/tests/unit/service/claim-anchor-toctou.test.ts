/**
 * BUG-011 — cross-doc TOCTOU hardening for the `task-claim` / `phase-claim`
 * anchor-overlap gate. Audit finding: `enforceClaimGate`'s pre-write predicate reads
 * sibling claims via a FRESH `getPlanBundle` snapshot, but that snapshot is taken
 * BEFORE this method's own CAS write commits — per-doc CAS only serializes writes to
 * the SAME row, it says nothing about the cross-row "no two anchor-overlapping
 * siblings both hold a fresh claim" invariant SPEC-042 established. Two interleaved
 * `claim()` calls on anchor-overlapping sibling tasks/phases could each pass their own
 * pre-write gate check (neither has written yet) and then both successfully CAS-write
 * their own claim — the exact scenario SPEC-042's own gate exists to prevent.
 *
 * Fix under test (write-then-verify, no new lock infra): after a successful CAS write,
 * `claim()` re-runs the SAME gate check against a fresh read. The later of two racing
 * writers always observes the earlier writer's already-committed claim in this
 * post-write re-check (the store serializes all writes on one connection — a read
 * strictly after your own write is ordered after every write that preceded it) and
 * self-rolls-back its own just-written claim, returning the identical anchor-overlap
 * gate error a pre-write rejection would have produced.
 *
 * Six-dimension coverage:
 *   HAPPY:      no interleaving injected — claim succeeds normally, unaffected by the
 *               new post-write re-check (TaskWorkflowService + PhaseWorkflowService)
 *   STATE:      (1) a sibling claim injected in the exact "gate passed, about to
 *               write" gap is detected post-write and the later writer self-rolls-back
 *               (the core red-then-green scenario for both doc types); (2) a
 *               same-holder refresh in the presence of a foreign STALE overlapping
 *               sibling is never falsely rolled back (TTL semantics preserved); (3) a
 *               fresh claim held by the SAME actor as an overlapping sibling is never
 *               falsely rolled back
 *   BOUNDARY:   a task/phase never conflicts with itself — the candidate is excluded
 *               from its own sibling set even under the new post-write re-check
 *   REGRESSION: the interleaved race does NOT trigger a rollback when
 *               `workflow.gates."task-claim"/"phase-claim".enabled` is `false`, or
 *               when the service was constructed with no `gate` dependency at all
 *               (byte-identical to pre-BUG-011 ungated behavior)
 *
 * @spec_ref BUG-011 (audit finding); SPEC-042 §Design Decisions D5; SPEC-056 D2/D7
 */

import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import { PhaseWorkflowService } from "../../../src/service/phase-workflow-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import type { GateDependencies } from "../../../src/service/gate-enforcer.js";
import type { CreateDocInput, DocRecord, DocType, LoreConfig } from "@lore/core";

// ─── Shared interleave helper ─────────────────────────────────────────────────

/**
 * Wraps `store.update` so that the FIRST call matching `triggerId` runs `inject`
 * (an async side-effect performed via the store's own, un-wrapped `update`) BEFORE
 * proceeding with the real update — simulating a concurrent writer landing in the
 * exact "gate check already ran, own CAS write about to commit" gap. Deterministic
 * (no timers/`Promise.all` races) — mirrors this codebase's existing sequential-CAS
 * interleave recipe (see `task-workflow-service.test.ts`'s own module header), but
 * hooks the STORE's write call instead of the service's `now()` seam, since this
 * race is cross-DOC (task A's write vs. task B's claim), not a single-doc CAS replay.
 */
function interleaveFirstUpdate(
  store: InMemoryStore,
  triggerId: string,
  inject: () => Promise<void>,
): void {
  const originalUpdate = store.update.bind(store);
  let triggered = false;
  store.update = async (id, patch, opts) => {
    if (!triggered && id === triggerId) {
      triggered = true;
      await inject();
    }
    return originalUpdate(id, patch, opts);
  };
}

// ─── TaskWorkflowService section ──────────────────────────────────────────────

async function mustCreate(cs: CorpusService, input: CreateDocInput): Promise<DocRecord> {
  const result = await cs.create(input);
  if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

function makeTaskServices(config?: LoreConfig, withGate = true) {
  const store = new InMemoryStore();
  const corpusService = new CorpusService(store);
  const gate: GateDependencies | undefined = withGate
    ? { enforcer: new GateEnforcer(config), getPlanBundle: corpusService.getPlanBundle.bind(corpusService) }
    : undefined;
  const taskWorkflowService = new TaskWorkflowService(store, undefined, { claimTtlMinutes: 120 }, undefined, gate);
  return { store, corpusService, taskWorkflowService };
}

async function createTopLevelPlan(cs: CorpusService): Promise<string> {
  const plan = await mustCreate(cs, { type: "plan", title: "Top-Level Plan", content: "# Plan" } as CreateDocInput);
  return plan.id;
}

async function createTask(
  cs: CorpusService,
  planId: string,
  title: string,
  anchors?: string[],
): Promise<{ id: string; slug: string }> {
  const task = await mustCreate(cs, {
    type: "task",
    title,
    parent_id: planId,
    content: `# ${title}`,
    extra: { plan_id: planId, ...(anchors !== undefined ? { file_anchors: anchors } : {}) },
  } as CreateDocInput);
  return { id: task.id, slug: task.slug };
}

describe("TaskWorkflowService.claim — BUG-011 TOCTOU hardening", () => {
  // HAPPY — no interleaving, claim succeeds unaffected by the new post-write re-check
  it("HAPPY: a solo claim with no sibling conflict succeeds normally", async () => {
    const { corpusService, taskWorkflowService } = makeTaskServices();
    const planId = await createTopLevelPlan(corpusService);
    const taskOne = await createTask(corpusService, planId, "Task One", ["src/a"]);

    const result = await taskWorkflowService.claim(taskOne.id, { by: "agent:t1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.extra["claim"]).toMatchObject({ by: "agent:t1" });
  });

  // STATE — the core race: a conflicting sibling claim lands in the exact
  // "gate passed, own write about to commit" gap.
  it("STATE: a sibling claim injected between gate-check and write is caught post-write — the LATER writer self-rolls-back", async () => {
    const { store, corpusService, taskWorkflowService } = makeTaskServices();
    const planId = await createTopLevelPlan(corpusService);
    const taskOne = await createTask(corpusService, planId, "Task One", ["src/a"]);
    const taskTwo = await createTask(corpusService, planId, "Task Two", ["src/a"]);

    // Simulate: agent:t2's pre-write gate check on Task One already ran and saw no
    // conflict (Task Two had no claim yet) — THEN, in the gap before Task One's own
    // CAS write commits, a concurrent actor agent:t1 claims the anchor-overlapping
    // Task Two. This is exactly the race a pre-write-only gate cannot see.
    interleaveFirstUpdate(store, taskOne.id, async () => {
      const claimTwo = await taskWorkflowService.claim(taskTwo.id, { by: "agent:t1" });
      expect(claimTwo.ok).toBe(true);
    });

    const result = await taskWorkflowService.claim(taskOne.id, { by: "agent:t2" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect((result.error as { field?: string }).field).toBe("gate:task-claim:anchor-overlap");

    // Self-rollback: Task One must NOT be left holding agent:t2's claim — it was a
    // fresh acquire (no pre-existing claim), so rollback removes `extra.claim` entirely.
    const afterRollback = await store.find(taskOne.id);
    if (!afterRollback.ok || afterRollback.value === null) throw new Error("task one not found");
    expect(afterRollback.value.extra["claim"]).toBeUndefined();

    // Task Two's claim (the winner, committed first) is untouched.
    const taskTwoDoc = await store.find(taskTwo.id);
    if (!taskTwoDoc.ok || taskTwoDoc.value === null) throw new Error("task two not found");
    expect(taskTwoDoc.value.extra["claim"]).toMatchObject({ by: "agent:t1" });
  });

  // STATE — a same-holder refresh is never falsely rolled back by a STALE foreign
  // overlapping sibling (TTL semantics preserved post-write, not just pre-write).
  it("STATE: a same-holder refresh is not falsely rolled back when the overlapping sibling's claim is STALE", async () => {
    const { store, corpusService, taskWorkflowService } = makeTaskServices();
    const planId = await createTopLevelPlan(corpusService);
    const taskOne = await createTask(corpusService, planId, "Task One", ["src/a"]);
    const taskTwo = await createTask(corpusService, planId, "Task Two", ["src/a"]);

    // agent:t9 claims Task Two far in the past — will be stale by the time Task One
    // is claimed/refreshed at T=120min+ later (TTL=120).
    await taskWorkflowService.claim(taskTwo.id, { by: "agent:t9" }, () => "2026-07-11T06:00:00.000Z");

    const first = await taskWorkflowService.claim(
      taskOne.id,
      { by: "agent:t1" },
      () => "2026-07-11T09:00:00.000Z",
    );
    expect(first.ok).toBe(true);

    const refresh = await taskWorkflowService.claim(
      taskOne.id,
      { by: "agent:t1" },
      () => "2026-07-11T09:30:00.000Z",
    );
    expect(refresh.ok).toBe(true);
    if (!refresh.ok) return;
    expect(refresh.value.extra["claim"]).toMatchObject({ by: "agent:t1" });

    const doc = await store.find(taskOne.id);
    if (!doc.ok || doc.value === null) throw new Error("task one not found");
    expect(doc.value.extra["claim"]).toMatchObject({ by: "agent:t1" });
  });

  // STATE — a fresh claim held by the SAME actor on an overlapping sibling never
  // falsely rolls back (noAnchorOverlap's own same-actor exemption, now also proven
  // to hold under the post-write re-check, not just the pre-write one).
  it("STATE: an overlapping sibling claim held by the SAME actor is not falsely rolled back", async () => {
    const { store, corpusService, taskWorkflowService } = makeTaskServices();
    const planId = await createTopLevelPlan(corpusService);
    const taskOne = await createTask(corpusService, planId, "Task One", ["src/a"]);
    const taskTwo = await createTask(corpusService, planId, "Task Two", ["src/a"]);

    const first = await taskWorkflowService.claim(taskTwo.id, { by: "agent:t1" });
    expect(first.ok).toBe(true);

    const second = await taskWorkflowService.claim(taskOne.id, { by: "agent:t1" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.extra["claim"]).toMatchObject({ by: "agent:t1" });

    const doc = await store.find(taskOne.id);
    if (!doc.ok || doc.value === null) throw new Error("task one not found");
    expect(doc.value.extra["claim"]).toMatchObject({ by: "agent:t1" });
  });

  // BOUNDARY — a task never conflicts with itself, even under the post-write re-check
  // (buildAnchorGateContext excludes the candidate from its own sibling set).
  it("BOUNDARY: a task never self-conflicts — repeated claim/refresh by the same actor on the same task always succeeds", async () => {
    const { store, corpusService, taskWorkflowService } = makeTaskServices();
    const planId = await createTopLevelPlan(corpusService);
    const taskOne = await createTask(corpusService, planId, "Task One", ["src/a"]);

    const first = await taskWorkflowService.claim(taskOne.id, { by: "agent:t1" });
    expect(first.ok).toBe(true);
    const second = await taskWorkflowService.claim(taskOne.id, { by: "agent:t1" });
    expect(second.ok).toBe(true);

    const doc = await store.find(taskOne.id);
    if (!doc.ok || doc.value === null) throw new Error("task one not found");
    expect(doc.value.extra["claim"]).toMatchObject({ by: "agent:t1" });
  });

  // REGRESSION — the SAME injected race does NOT trigger a rollback when the
  // anchor-overlap sub-predicate is disabled by config (SPEC-042 D6 knob).
  it("REGRESSION: the injected race does not roll back when anchor_overlap is disabled by config", async () => {
    const config = {
      project: { name: "x", author: "y" },
      workflow: {
        claim_ttl_minutes: 120,
        gates: { "task-claim": { anchor_overlap: { enabled: false } } },
      },
    } as unknown as LoreConfig;
    const { store, corpusService, taskWorkflowService } = makeTaskServices(config);
    const planId = await createTopLevelPlan(corpusService);
    const taskOne = await createTask(corpusService, planId, "Task One", ["src/a"]);
    const taskTwo = await createTask(corpusService, planId, "Task Two", ["src/a"]);

    interleaveFirstUpdate(store, taskOne.id, async () => {
      const claimTwo = await taskWorkflowService.claim(taskTwo.id, { by: "agent:t1" });
      expect(claimTwo.ok).toBe(true);
    });

    const result = await taskWorkflowService.claim(taskOne.id, { by: "agent:t2" });
    expect(result.ok).toBe(true); // anchor_overlap disabled — both claims coexist, as configured

    const doc = await store.find(taskOne.id);
    if (!doc.ok || doc.value === null) throw new Error("task one not found");
    expect(doc.value.extra["claim"]).toMatchObject({ by: "agent:t2" });
  });

  // REGRESSION — with NO gate dependency at all (bare construction, the pre-existing
  // "ungated" unit-test shape every other service constructor supports), the injected
  // race is invisible — byte-identical to pre-GateEnforcer/pre-BUG-011 behavior.
  it("REGRESSION: a service constructed with no gate dependency ignores the race entirely (ungated, byte-identical)", async () => {
    const { store, corpusService, taskWorkflowService } = makeTaskServices(undefined, /* withGate */ false);
    const planId = await createTopLevelPlan(corpusService);
    const taskOne = await createTask(corpusService, planId, "Task One", ["src/a"]);
    const taskTwo = await createTask(corpusService, planId, "Task Two", ["src/a"]);

    interleaveFirstUpdate(store, taskOne.id, async () => {
      const claimTwo = await taskWorkflowService.claim(taskTwo.id, { by: "agent:t1" });
      expect(claimTwo.ok).toBe(true);
    });

    const result = await taskWorkflowService.claim(taskOne.id, { by: "agent:t2" });
    expect(result.ok).toBe(true);

    const doc = await store.find(taskOne.id);
    if (!doc.ok || doc.value === null) throw new Error("task one not found");
    expect(doc.value.extra["claim"]).toMatchObject({ by: "agent:t2" });
  });
});

// ─── PhaseWorkflowService section ─────────────────────────────────────────────

function makePlanRecord(overrides: Partial<DocRecord> = {}): DocRecord {
  const base: DocRecord = {
    id: "01HPLANTOCTOU0000000000001",
    slug: "plan-toctou",
    type: "plan",
    role: "plan",
    title: "Plan TOCTOU",
    status: "approved",
    priority: "medium",
    content: "# Plan",
    parent_id: null,
    created_at: "2026-07-20T00:00:00.000Z",
    updated_at: "2026-07-20T00:00:00.000Z",
    created_by: "system",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
  };
  return { ...base, ...overrides };
}

function makePhaseRecord(overrides: Partial<DocRecord> = {}): DocRecord {
  const base: DocRecord = {
    id: "01HPHASETOCTOU000000000001",
    slug: "phase-one",
    type: "phase" as unknown as DocType,
    role: "plan",
    title: "Phase One",
    status: "draft",
    priority: "medium",
    content: "# Phase One",
    parent_id: "01HPLANTOCTOU0000000000001",
    created_at: "2026-07-20T00:00:00.000Z",
    updated_at: "2026-07-20T00:00:00.000Z",
    created_by: "system",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
  };
  return { ...base, ...overrides, extra: { ...base.extra, ...overrides.extra } };
}

async function mustInsert(store: InMemoryStore, doc: DocRecord): Promise<DocRecord> {
  const result = await store.insert(doc);
  if (!result.ok) throw new Error(`insert failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

function makePhaseServices(config?: LoreConfig, withGate = true) {
  const store = new InMemoryStore();
  const corpusService = new CorpusService(store);
  const gate: GateDependencies | undefined = withGate
    ? { enforcer: new GateEnforcer(config), getPlanBundle: corpusService.getPlanBundle.bind(corpusService) }
    : undefined;
  const phaseWorkflowService = new PhaseWorkflowService(
    store,
    undefined,
    { claimTtlMinutes: 120 },
    undefined,
    gate,
  );
  return { store, phaseWorkflowService };
}

describe("PhaseWorkflowService.claim — BUG-011 TOCTOU hardening (mirrors TaskWorkflowService)", () => {
  // HAPPY
  it("HAPPY: a solo claim with no sibling conflict succeeds normally", async () => {
    const { store, phaseWorkflowService } = makePhaseServices();
    await mustInsert(store, makePlanRecord());
    await mustInsert(store, makePhaseRecord({ extra: { file_anchors: ["src/a"] } }));

    const result = await phaseWorkflowService.claim("phase-one", { by: "agent:p1" });
    expect(result.ok).toBe(true);
  });

  // STATE — the core race, on phase docs.
  it("STATE: a sibling claim injected between gate-check and write is caught post-write — the LATER writer self-rolls-back", async () => {
    const { store, phaseWorkflowService } = makePhaseServices();
    await mustInsert(store, makePlanRecord());
    const phaseOne = await mustInsert(store, makePhaseRecord({ extra: { file_anchors: ["src/a"] } }));
    const phaseTwo = await mustInsert(
      store,
      makePhaseRecord({
        id: "01HPHASETOCTOU000000000002",
        slug: "phase-two",
        title: "Phase Two",
        extra: { file_anchors: ["src/a"] },
      }),
    );

    interleaveFirstUpdate(store, phaseOne.id, async () => {
      const claimTwo = await phaseWorkflowService.claim(phaseTwo.slug, { by: "agent:p1" });
      expect(claimTwo.ok).toBe(true);
    });

    const result = await phaseWorkflowService.claim(phaseOne.slug, { by: "agent:p2" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect((result.error as { field?: string }).field).toBe("gate:phase-claim:anchor-overlap");

    const afterRollback = await store.find(phaseOne.id);
    if (!afterRollback.ok || afterRollback.value === null) throw new Error("phase one not found");
    expect(afterRollback.value.extra["claim"]).toBeUndefined();

    const phaseTwoDoc = await store.find(phaseTwo.id);
    if (!phaseTwoDoc.ok || phaseTwoDoc.value === null) throw new Error("phase two not found");
    expect(phaseTwoDoc.value.extra["claim"]).toMatchObject({ by: "agent:p1" });
  });

  // STATE — same-actor overlap never falsely rolled back.
  it("STATE: an overlapping sibling claim held by the SAME actor is not falsely rolled back", async () => {
    const { store, phaseWorkflowService } = makePhaseServices();
    await mustInsert(store, makePlanRecord());
    const phaseOne = await mustInsert(store, makePhaseRecord({ extra: { file_anchors: ["src/a"] } }));
    const phaseTwo = await mustInsert(
      store,
      makePhaseRecord({
        id: "01HPHASETOCTOU000000000002",
        slug: "phase-two",
        title: "Phase Two",
        extra: { file_anchors: ["src/a"] },
      }),
    );

    const first = await phaseWorkflowService.claim(phaseTwo.slug, { by: "agent:p1" });
    expect(first.ok).toBe(true);

    const second = await phaseWorkflowService.claim(phaseOne.slug, { by: "agent:p1" });
    expect(second.ok).toBe(true);

    const doc = await store.find(phaseOne.id);
    if (!doc.ok || doc.value === null) throw new Error("phase one not found");
    expect(doc.value.extra["claim"]).toMatchObject({ by: "agent:p1" });
  });

  // BOUNDARY — self never conflicts with self.
  it("BOUNDARY: a phase never self-conflicts — repeated claim/refresh by the same actor always succeeds", async () => {
    const { store, phaseWorkflowService } = makePhaseServices();
    await mustInsert(store, makePlanRecord());
    const phaseOne = await mustInsert(store, makePhaseRecord({ extra: { file_anchors: ["src/a"] } }));

    const first = await phaseWorkflowService.claim(phaseOne.slug, { by: "agent:p1" });
    expect(first.ok).toBe(true);
    const second = await phaseWorkflowService.claim(phaseOne.slug, { by: "agent:p1" });
    expect(second.ok).toBe(true);
  });

  // REGRESSION — no gate dependency → race invisible, byte-identical to ungated behavior.
  it("REGRESSION: a service constructed with no gate dependency ignores the race entirely (ungated, byte-identical)", async () => {
    const { store, phaseWorkflowService } = makePhaseServices(undefined, /* withGate */ false);
    await mustInsert(store, makePlanRecord());
    const phaseOne = await mustInsert(store, makePhaseRecord({ extra: { file_anchors: ["src/a"] } }));
    const phaseTwo = await mustInsert(
      store,
      makePhaseRecord({
        id: "01HPHASETOCTOU000000000002",
        slug: "phase-two",
        title: "Phase Two",
        extra: { file_anchors: ["src/a"] },
      }),
    );

    interleaveFirstUpdate(store, phaseOne.id, async () => {
      const claimTwo = await phaseWorkflowService.claim(phaseTwo.slug, { by: "agent:p1" });
      expect(claimTwo.ok).toBe(true);
    });

    const result = await phaseWorkflowService.claim(phaseOne.slug, { by: "agent:p2" });
    expect(result.ok).toBe(true);

    const doc = await store.find(phaseOne.id);
    if (!doc.ok || doc.value === null) throw new Error("phase one not found");
    expect(doc.value.extra["claim"]).toMatchObject({ by: "agent:p2" });
  });
});
