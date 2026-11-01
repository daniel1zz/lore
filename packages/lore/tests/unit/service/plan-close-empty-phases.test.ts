/**
 * plan-close-empty-phases.test.ts — task-skill-implement-f8-done-a-plan-with-an-empty-declared.
 *
 * `lore done` of the last task must not advise `lore set <plan> --status archived`
 * while the plan declares a phase no task occupies (the plan-close gate would refuse
 * it). It names the empty phase(s) and the way out (`lore phase rm <plan> <phase>`
 * or add a task) instead. A plan with every declared phase populated keeps the
 * archive advisory (BR-211, AC-CLOSURE-3).
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / REGRESSION
 *
 * @spec_ref spec-close-the-eight-verified-critical-defects-no-judge-listing AC-CRIT-11
 */

import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import type { DoneResult } from "../../../src/service/task-workflow-service.js";
import { formatLastTaskAdvisory } from "../../../src/adapters/cli/done-render.js";
import type { CreateDocInput, DocRecord } from "@lore/core";
import { actedStore } from "../../live-invocation.js";

import { fakeWorktreeProbe } from "../../helpers/fake-worktree-probe.js";
import { ensureRequirementsDocId } from "../../helpers/parented-create.js";
import { LANDING_COMMIT, landedTaskExtra } from "./done-contract-unit-fixture.js";
function makeServices() {
  const store = actedStore(new InMemoryStore());
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const taskWorkflowService = new TaskWorkflowService(store, undefined, { claimTtlMinutes: 120 }, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, fakeWorktreeProbe());
  return { store, corpusService, taskWorkflowService };
}

async function createPlanWithPhases(
  store: InMemoryStore,
  cs: CorpusService,
  phases: string[],
): Promise<DocRecord> {
  const created = await cs.create({ parent_id: await ensureRequirementsDocId(cs), type: "plan", title: "Empty Phase Plan", content: "body" } as CreateDocInput);
  if (!created.ok) throw new Error(`plan create failed: ${JSON.stringify(created.error)}`);
  const updated = await store.update(created.value.id, {
    extra: { phases: phases.map((name) => ({ name })) },
    updated_at: new Date().toISOString(),
  });
  if (!updated.ok) throw new Error(`plan update failed: ${JSON.stringify(updated.error)}`);
  return updated.value;
}

async function createTaskInPhase(cs: CorpusService, plan: DocRecord, title: string, phase: string): Promise<DocRecord> {
  const created = await cs.create({
    type: "task",
    title,
    parent_id: plan.id,
    content: "body",
    // reason: `done` judges the stored contract and the landing (AC-DCS1-7); the fixture stores the shapes approve and integrate write.
    extra: { plan_id: plan.id, phase, ...landedTaskExtra() },
  } as CreateDocInput);
  if (!created.ok) throw new Error(`task create failed: ${JSON.stringify(created.error)}`);
  return created.value;
}

async function archive(tw: TaskWorkflowService, taskId: string): Promise<DoneResult> {
  await tw.addEvidence(taskId, {
    oracle: "tsc",
    command: "bun run typecheck",
    result: "pass",
    recorded_by: "alice",
    capture_source: "self-report",
  });
  await tw.recordVerifiedEvidence(
    taskId,
    {
      oracle: "tsc",
      command: "bun run typecheck",
      result: "pass",
      recorded_by: "runner",
      attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1, timed_out: false, recorded_at_landing: LANDING_COMMIT },
      capture_source: "runner",
    },
    "2026-08-01T09:00:00.000Z",
  );
  const done = await tw.done(taskId, { by: "alice" });
  if (!done.ok) throw new Error(`done failed: ${JSON.stringify(done.error)}`);
  return done.value;
}

describe("plan-close empty declared phases (AC-CRIT-11)", () => {
  it("AC-CRIT-11 HAPPY: phases [A,B], one task in A — result names B empty; advisory has no archive command and names `lore phase rm <plan> B`", async () => {
    const { store, corpusService, taskWorkflowService } = makeServices();
    const plan = await createPlanWithPhases(store, corpusService, ["A", "B"]);
    const task = await createTaskInPhase(corpusService, plan, "only task", "A");

    const result = await archive(taskWorkflowService, task.id);

    expect(result.plan_now_fully_terminal?.plan_slug).toBe(plan.slug);
    expect(result.plan_now_fully_terminal?.empty_phases).toEqual(["B"]);
    const advisory = formatLastTaskAdvisory(result);
    expect(advisory).toBeDefined();
    expect(advisory).not.toContain("--status archived");
    expect(advisory).toContain(`lore phase rm ${plan.slug} B`);
  });

  it("AC-CRIT-11 NEGATIVE: every declared phase populated and terminal — archive advisory still printed", async () => {
    const { store, corpusService, taskWorkflowService } = makeServices();
    const plan = await createPlanWithPhases(store, corpusService, ["A", "B"]);
    const a = await createTaskInPhase(corpusService, plan, "task a", "A");
    const b = await createTaskInPhase(corpusService, plan, "task b", "B");

    await archive(taskWorkflowService, a.id);
    const result = await archive(taskWorkflowService, b.id);

    expect(result.plan_now_fully_terminal?.empty_phases).toBeUndefined();
    expect(formatLastTaskAdvisory(result)).toContain(`lore set ${plan.slug} --status archived`);
  });

  it("AC-CRIT-11 BOUNDARY: plan declaring no phases keeps the archive advisory", async () => {
    const { store, corpusService, taskWorkflowService } = makeServices();
    const plan = await createPlanWithPhases(store, corpusService, []);
    const created = await corpusService.create({
      type: "task",
      title: "t",
      parent_id: plan.id,
      content: "body",
      extra: { plan_id: plan.id, ...landedTaskExtra() },
    } as CreateDocInput);
    if (!created.ok) throw new Error("task create failed");

    const result = await archive(taskWorkflowService, created.value.id);

    expect(formatLastTaskAdvisory(result)).toContain(`lore set ${plan.slug} --status archived`);
  });
});
