/**
 * Tests for the derived session registry (SPEC-042 §Design Decisions D1, D7, D8):
 * `TaskWorkflowService.ready`'s plan-scoped `sessions[]`/`anchor_conflicts[]`/
 * `anchorless` advisory, and `SessionService.bootstrap`'s corpus-wide
 * `active_sessions`. Against `InMemoryStore`, vitest.
 *
 * Six-dimension coverage:
 *   HAPPY:      distinct (by, machine, worktree) triples group into distinct
 *               sessions; a single claim produces a singleton session
 *   NEGATIVE:   two claims both stale → sessions: [] (staleness filter)
 *   BOUNDARY:   empty corpus → active_sessions: []; plan with zero claims →
 *               sessions: [], anchor_conflicts: []
 *   ERROR:      n/a — deriveSessions/ready/bootstrap have no ERROR path for
 *               well-formed input at this layer
 *   STATE:      legacy machine-less claims by one actor group into ONE session
 *               (absent = stable key); anchorless advisory fires only when ≥1
 *               sibling declares anchors — zero-adoption plan → NO marker
 *   REGRESSION: mutation-counting proxy proves ready() AND bootstrap() perform
 *               ZERO store writes; bootstrapReportSchema.parse round-trips a
 *               report WITH active_sessions populated (Zod-strip regression, S6)
 *
 * @spec_ref SPEC-042 AC-S3-6, AC-S3-10
 */

import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import { SessionService } from "../../../src/service/session-service.js";
import { bootstrapReportSchema, type BootstrapReport } from "@lore/core";
import type { CreateDocInput, DocRecord } from "@lore/core";
import type { StoreInterface } from "../../../src/store/store-interface.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const MUTATING_METHODS = [
  "insert",
  "update",
  "softDelete",
  "addLink",
  "removeLink",
  "insertVersion",
  "appendAuditEntry",
  "insertJudgment",
  "insertCalibrationRecord",
] as const;

function countingProxy(store: StoreInterface): { proxy: StoreInterface; counts: Record<string, number> } {
  const counts: Record<string, number> = {};
  for (const name of MUTATING_METHODS) counts[name] = 0;

  const proxy = new Proxy(store, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop === "string" && (MUTATING_METHODS as readonly string[]).includes(prop)) {
        return (...args: unknown[]) => {
          counts[prop] = (counts[prop] ?? 0) + 1;
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      if (typeof value === "function") {
        return value.bind(target);
      }
      return value;
    },
  });

  return { proxy: proxy as StoreInterface, counts };
}

async function mustCreate(cs: CorpusService, input: CreateDocInput): Promise<DocRecord> {
  const result = await cs.create(input);
  if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

function makeServices(store: StoreInterface = new InMemoryStore()) {
  const corpusService = new CorpusService(store);
  const taskWorkflowService = new TaskWorkflowService(store, undefined, { claimTtlMinutes: 120 });
  const sessionService = new SessionService(store, {
    claimTtlMinutes: 120,
    handoffTtlMinutes: 10080,
    createHandoffDoc: corpusService.createHandoffDoc.bind(corpusService),
  });
  return { store, corpusService, taskWorkflowService, sessionService };
}

async function createPlan(cs: CorpusService, title = "Plan"): Promise<string> {
  const plan = await mustCreate(cs, { type: "plan", title, content: "# Plan" } as CreateDocInput);
  return plan.id;
}

async function createTask(cs: CorpusService, planId: string, title: string, anchors?: string[]): Promise<string> {
  const task = await mustCreate(cs, {
    type: "task",
    title,
    parent_id: planId,
    content: `# ${title}`,
    extra: { plan_id: planId, ...(anchors !== undefined ? { file_anchors: anchors } : {}) },
  } as CreateDocInput);
  return task.id;
}

// ─── TaskWorkflowService.ready — sessions / anchor_conflicts / anchorless ─────

describe("TaskWorkflowService.ready — sessions (SPEC-042 D1, D7)", () => {
  // HAPPY — distinct actors, same machine, distinct worktree → two sessions
  it("two claims by DIFFERENT actors, same machine, different worktree → two sessions", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskOneId = await createTask(corpusService, planId, "Task One");
    const taskTwoId = await createTask(corpusService, planId, "Task Two");

    await taskWorkflowService.claim(taskOneId, { by: "agent:t1", machine: "hostA", worktree: "/w1" });
    await taskWorkflowService.claim(taskTwoId, { by: "agent:t2", machine: "hostA", worktree: "/w2" });

    const report = await taskWorkflowService.ready(planId);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.sessions).toHaveLength(2);
    const bySlugs = report.value.sessions.map((s) => s.task_slugs).sort();
    expect(bySlugs.flat().sort()).toEqual(
      report.value.records.map((r) => r.task.slug).sort(),
    );
  });

  // STATE — same actor, same machine, DIFFERENT worktree → still two sessions
  // (worktree is the field that discriminates concurrent agents on a single-machine team)
  it("two claims by the SAME actor + machine but DIFFERENT worktree → two sessions", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskOneId = await createTask(corpusService, planId, "Task One");
    const taskTwoId = await createTask(corpusService, planId, "Task Two");

    await taskWorkflowService.claim(taskOneId, { by: "agent:t1", machine: "hostA", worktree: "/w1" });
    await taskWorkflowService.claim(taskTwoId, { by: "agent:t1", machine: "hostA", worktree: "/w2" });

    const report = await taskWorkflowService.ready(planId);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.sessions).toHaveLength(2);
  });

  // STATE — legacy machine-less claims by ONE actor group into ONE session
  it("legacy machine-less/worktree-less claims by one actor group into ONE session", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskOneId = await createTask(corpusService, planId, "Task One");
    const taskTwoId = await createTask(corpusService, planId, "Task Two");

    // No machine/worktree passed at all — mirrors a pre-SPEC-042 caller.
    await taskWorkflowService.claim(taskOneId, { by: "agent:t1" });
    await taskWorkflowService.claim(taskTwoId, { by: "agent:t1" });

    const report = await taskWorkflowService.ready(planId);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.sessions).toHaveLength(1);
    expect(report.value.sessions[0]?.by).toBe("agent:t1");
    expect(report.value.sessions[0]?.machine).toBeUndefined();
    expect(report.value.sessions[0]?.worktree).toBeUndefined();
    expect(report.value.sessions[0]?.task_slugs).toHaveLength(2);
  });

  // NEGATIVE — two claims both stale → sessions: []
  it("two claims that are BOTH stale produce sessions: [] (staleness filter)", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskOneId = await createTask(corpusService, planId, "Task One");
    const taskTwoId = await createTask(corpusService, planId, "Task Two");

    await taskWorkflowService.claim(taskOneId, { by: "agent:t1" }, () => "2026-07-08T00:00:00.000Z");
    await taskWorkflowService.claim(taskTwoId, { by: "agent:t2" }, () => "2026-07-08T00:00:00.000Z");

    // 200 minutes later — past the 120min TTL.
    const report = await taskWorkflowService.ready(planId, () => "2026-07-08T03:20:00.000Z");
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.sessions).toEqual([]);
  });

  // HAPPY — a single claim produces a singleton session
  it("a single fresh claim produces a singleton session", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId, "Solo Task");

    await taskWorkflowService.claim(taskId, { by: "agent:t1", machine: "hostA" });

    const report = await taskWorkflowService.ready(planId);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.sessions).toHaveLength(1);
    expect(report.value.sessions[0]?.task_slugs).toHaveLength(1);
  });

  // BOUNDARY — plan with zero claims → sessions: [], anchor_conflicts: []
  it("a plan whose tasks hold no claims at all → sessions: [], anchor_conflicts: []", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    await createTask(corpusService, planId, "Unclaimed Task");

    const report = await taskWorkflowService.ready(planId);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.sessions).toEqual([]);
    expect(report.value.anchor_conflicts).toEqual([]);
  });

  // STATE — anchorless advisory: fires ONLY when ≥1 sibling declares anchors
  it("anchorless fires on a claimed, anchor-less task when a SIBLING declares anchors", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const anchoredTaskId = await createTask(corpusService, planId, "Anchored Task", ["src/a"]);
    const bareTaskId = await createTask(corpusService, planId, "Bare Task"); // no anchors

    await taskWorkflowService.claim(bareTaskId, { by: "agent:t2" });

    const report = await taskWorkflowService.ready(planId);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    const bareRecord = report.value.records.find((r) => r.task.id === bareTaskId);
    expect(bareRecord?.anchorless).toBe(true);
    const anchoredRecord = report.value.records.find((r) => r.task.id === anchoredTaskId);
    expect(anchoredRecord?.anchorless).toBeUndefined();
  });

  // STATE — zero-adoption plan (no task anywhere declares anchors) → NO marker
  it("a zero-adoption plan (no task declares anchors) never sets anchorless", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId, "Bare Task"); // no anchors anywhere

    await taskWorkflowService.claim(taskId, { by: "agent:t1" });

    const report = await taskWorkflowService.ready(planId);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.records[0]?.anchorless).toBeUndefined();
  });

  // REGRESSION — ready() performs zero store mutations (mirrors session-readonly.test.ts's proxy)
  it("ready() performs zero store mutations, even when it computes sessions/anchor_conflicts", async () => {
    const rawStore = new InMemoryStore();
    const seed = makeServices(rawStore);
    const planId = await createPlan(seed.corpusService);
    const taskOneId = await createTask(seed.corpusService, planId, "Task One", ["src/a"]);
    const taskTwoId = await createTask(seed.corpusService, planId, "Task Two");
    await seed.taskWorkflowService.claim(taskOneId, { by: "agent:t1", machine: "hostA" });
    await seed.taskWorkflowService.claim(taskTwoId, { by: "agent:t2", machine: "hostB" });

    const { proxy, counts } = countingProxy(rawStore);
    const wrapped = new TaskWorkflowService(proxy, undefined, { claimTtlMinutes: 120 });

    const result = await wrapped.ready(planId);
    expect(result.ok).toBe(true);

    for (const name of MUTATING_METHODS) {
      expect(counts[name]).toBe(0);
    }
  });
});

// ─── SessionService.bootstrap — active_sessions (SPEC-042 D8) ─────────────────

describe("SessionService.bootstrap — active_sessions (SPEC-042 D8)", () => {
  // BOUNDARY — empty corpus → active_sessions: []
  it("an empty corpus → active_sessions: []", async () => {
    const { sessionService } = makeServices();
    const result = await sessionService.bootstrap("alice");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.active_sessions).toEqual([]);
  });

  // HAPPY — corpus-wide sessions over active plans' tasks
  it("aggregates sessions across every ACTIVE plan's tasks", async () => {
    const { corpusService, taskWorkflowService, sessionService } = makeServices();
    const planAId = await createPlan(corpusService, "Plan A");
    const planBId = await createPlan(corpusService, "Plan B");
    const taskAId = await createTask(corpusService, planAId, "Task A");
    const taskBId = await createTask(corpusService, planBId, "Task B");

    await taskWorkflowService.claim(taskAId, { by: "agent:t1", machine: "hostA" });
    await taskWorkflowService.claim(taskBId, { by: "agent:t2", machine: "hostB" });

    const result = await sessionService.bootstrap("alice");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.active_sessions).toHaveLength(2);
  });

  // STATE — an archived plan's claims are EXCLUDED from active_sessions
  it("a claim on an ARCHIVED plan's task is excluded from active_sessions", async () => {
    const { corpusService, taskWorkflowService, sessionService } = makeServices();
    const planId = await createPlan(corpusService, "Archived Plan");
    const taskId = await createTask(corpusService, planId, "Task");
    await taskWorkflowService.claim(taskId, { by: "agent:t1" });

    // reason: SPEC-002 §3 lifecycle only allows archived via approved (draft→
    // archived is illegal, enforced by CorpusService.set's INVALID_TRANSITION
    // check, B1 blocker fix) — route through the legal draft→approved→archived
    // chain rather than a direct (previously bug-permitted) jump.
    const approveResult = await corpusService.set(planId, { status: "approved" });
    expect(approveResult.ok).toBe(true);
    const archiveResult = await corpusService.set(planId, { status: "archived" });
    expect(archiveResult.ok).toBe(true);

    const result = await sessionService.bootstrap("alice");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.active_sessions).toEqual([]);
  });

  // REGRESSION — bootstrap() performs zero store mutations (mirrors session-readonly.test.ts)
  it("bootstrap() performs zero store mutations while computing active_sessions", async () => {
    const rawStore = new InMemoryStore();
    const seed = makeServices(rawStore);
    const planId = await createPlan(seed.corpusService);
    const taskId = await createTask(seed.corpusService, planId, "Task");
    await seed.taskWorkflowService.claim(taskId, { by: "agent:t1", machine: "hostA" });

    const { proxy, counts } = countingProxy(rawStore);
    const wrapped = new SessionService(proxy, {
      claimTtlMinutes: 120,
      handoffTtlMinutes: 10080,
      createHandoffDoc: () => {
        throw new Error("bootstrap must never call createHandoffDoc");
      },
    });

    const result = await wrapped.bootstrap("alice");
    expect(result.ok).toBe(true);

    for (const name of MUTATING_METHODS) {
      expect(counts[name]).toBe(0);
    }
  });

  // REGRESSION — Zod-strip regression (review S6): bootstrapReportSchema.parse
  // round-trips a report WITH active_sessions populated, the field survives parse.
  it("bootstrapReportSchema.parse round-trips active_sessions without stripping it", () => {
    const report: BootstrapReport = {
      root: null,
      active_plans: [],
      pending_reviews: { count: 0, slugs: [] },
      my_claims: [],
      armed_gates: [],
      latest_handoffs: [],
      resume_hint: null,
      corpus: { total_docs: 0, last_updated: null },
      active_sessions: [
        {
          by: "agent:t1",
          machine: "hostA",
          worktree: "/w1",
          branches: ["wt-a"],
          task_slugs: ["task-one"],
          newest_at: "2026-07-11T10:00:00.000Z",
        },
      ],
    };
    const parsed = bootstrapReportSchema.parse(report);
    expect(parsed.active_sessions).toEqual(report.active_sessions);
    expect(parsed.active_sessions).toHaveLength(1);
  });
});
