/**
 * Author→trip test for the `lore set` wholesale-extra-replace footgun
 * (task-gate-feeding-pack-recovery-via-lore-set-extra-wholesale, incident
 * 2026-07-25): a plan-promote feeding pack told a caller to recover a
 * blocked `requires_uat` predicate via `set extra {"requires_uat": true}`.
 * Followed literally via MCP `lore_set`, the write REPLACED `extra`
 * wholesale and the plan lost its 4 `extra.phases` entries.
 *
 * This suite pins `CorpusService.set`'s `findDroppedStructuredExtraField`
 * guard (`corpus-service.ts`) — the service-layer half of the fix (option c).
 * The feeding-pack-text half (option b-lite) is pinned by
 * `checkpoint-registry.test.ts` / `requires-uat-gate.test.ts`'s existing
 * "lore set" + "requires_uat" substring assertions on the rewritten message.
 *
 * RED-first discipline: the FIRST test in each describe block below is the
 * literal old-feeding-pack-recovery shape, asserted to be REJECTED — before
 * this fix landed, that exact same patch SUCCEEDED and silently dropped the
 * structured field (the reproduced footgun). The paired HAPPY test in the
 * same block proves a compliant merged patch still gets through.
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / STATE / REGRESSION.
 *
 * @spec_ref task-gate-feeding-pack-recovery-via-lore-set-extra-wholesale
 */

import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { PhaseService } from "../../../src/service/phase-service.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import type { CreateDocInput } from "@lore/core";

function makeServices() {
  const store = new InMemoryStore();
  const corpusService = new CorpusService(store);
  const phaseService = new PhaseService(store);
  const taskWorkflowService = new TaskWorkflowService(store, undefined, { claimTtlMinutes: 120 });
  return { store, corpusService, phaseService, taskWorkflowService };
}

async function createPlanWithPhases(
  cs: CorpusService,
  ps: PhaseService,
  phaseNames: string[],
): Promise<string> {
  const planR = await cs.create({ type: "plan", title: "Phased Plan", content: "body" } as CreateDocInput);
  if (!planR.ok) throw new Error(`plan create failed: ${JSON.stringify(planR.error)}`);
  for (const name of phaseNames) {
    const addR = await ps.addPhase(planR.value.id, name);
    if (!addR.ok) throw new Error(`addPhase failed: ${JSON.stringify(addR.error)}`);
  }
  return planR.value.id;
}

async function createTask(cs: CorpusService, planId: string, title = "Task"): Promise<string> {
  const r = await cs.create({
    type: "task",
    title,
    parent_id: planId,
    content: "body",
    extra: { plan_id: planId },
  } as CreateDocInput);
  if (!r.ok) throw new Error(`task create failed: ${JSON.stringify(r.error)}`);
  return r.value.id;
}

// ─── AC-1: plan.extra.phases — the exact reported incident shape ────────────

describe("CorpusService.set — plan.extra.phases wholesale-drop guard", () => {
  it("NEGATIVE: rejects the OLD feeding-pack recovery shape — extra: {requires_uat: true} ONLY — naming the safe path", async () => {
    const { corpusService, phaseService } = makeServices();
    const planId = await createPlanWithPhases(corpusService, phaseService, ["P1", "P2", "P3", "P4"]);

    // The literal recovery text the plan-promote feeding pack used to render
    // (pre-fix): set extra to JUST {"requires_uat": true} — no phases key.
    const result = await corpusService.set(planId, { extra: { requires_uat: true } });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect((result.error as { field?: string }).field).toBe("extra.phases");
    const message = (result.error as { message?: string }).message ?? "";
    expect(message).toContain("extra.phases");
    expect(message).toContain("lore phase add");
    expect(message).toContain("lore get");

    // Prove the footgun did NOT fire — phases must survive untouched.
    const after = await corpusService.get(planId);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.doc.extra["phases"]).toHaveLength(4);
  });

  it("HAPPY: a compliant merged patch (phases preserved + requires_uat added) succeeds and phases survive", async () => {
    const { corpusService, phaseService } = makeServices();
    const planId = await createPlanWithPhases(corpusService, phaseService, ["P1", "P2", "P3", "P4"]);

    const current = await corpusService.get(planId);
    expect(current.ok).toBe(true);
    if (!current.ok) return;

    const merged = { ...current.value.doc.extra, requires_uat: true };
    const result = await corpusService.set(planId, { extra: merged });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.extra["requires_uat"]).toBe(true);
    expect(result.value.extra["phases"]).toHaveLength(4);
  });

  // BOUNDARY: a plan with NO phases declared is untouched by the guard —
  // there is nothing to drop, so an extra patch without a phases key is fine.
  it("BOUNDARY: a plan with no declared phases is unaffected — bare extra patch succeeds", async () => {
    const { corpusService, phaseService } = makeServices();
    const planId = await createPlanWithPhases(corpusService, phaseService, []); // no phases

    const result = await corpusService.set(planId, { extra: { requires_uat: true } });
    expect(result.ok).toBe(true);
  });

  // REGRESSION: explicitly restating the SAME phases array alongside a new
  // key still succeeds — this guard fires on ABSENCE, not on any edit at all.
  it("REGRESSION: a patch that restates extra.phases verbatim alongside a new key succeeds", async () => {
    const { corpusService, phaseService } = makeServices();
    const planId = await createPlanWithPhases(corpusService, phaseService, ["P1"]);

    const current = await corpusService.get(planId);
    expect(current.ok).toBe(true);
    if (!current.ok) return;

    const result = await corpusService.set(planId, {
      extra: { phases: current.value.doc.extra["phases"], requires_uat: true },
    });
    expect(result.ok).toBe(true);
  });
});

// ─── STATE: task.extra.claim / task.extra.verification_evidence ─────────────

describe("CorpusService.set — task.extra.claim / verification_evidence wholesale-drop guard", () => {
  it("NEGATIVE: rejects a patch that drops an active claim, naming lore claim/release", async () => {
    const { corpusService, taskWorkflowService, phaseService } = makeServices();
    const planId = await createPlanWithPhases(corpusService, phaseService, []);
    const taskId = await createTask(corpusService, planId);

    const claimResult = await taskWorkflowService.claim(taskId, { by: "agent:alice" });
    expect(claimResult.ok).toBe(true);

    const result = await corpusService.set(taskId, { extra: { assignee: "agent:alice" } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect((result.error as { field?: string }).field).toBe("extra.claim");
    const message = (result.error as { message?: string }).message ?? "";
    expect(message).toContain("lore claim");
  });

  it("NEGATIVE: rejects a patch that drops recorded evidence, naming lore evidence", async () => {
    const { corpusService, taskWorkflowService, phaseService } = makeServices();
    const planId = await createPlanWithPhases(corpusService, phaseService, []);
    const taskId = await createTask(corpusService, planId);

    const evidenceResult = await taskWorkflowService.addEvidence(taskId, {
      oracle: "tsc",
      command: "bun run typecheck",
      result: "pass",
      recorded_by: "agent:alice",
      output_tail: "ok",
      capture_source: "self-report",
    });
    expect(evidenceResult.ok).toBe(true);

    const result = await corpusService.set(taskId, { extra: { assignee: "agent:alice" } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect((result.error as { field?: string }).field).toBe("extra.verification_evidence");
    const message = (result.error as { message?: string }).message ?? "";
    expect(message).toContain("lore evidence");
  });

  it("HAPPY: a merged patch preserving claim + verification_evidence + a new field succeeds", async () => {
    const { corpusService, taskWorkflowService, phaseService } = makeServices();
    const planId = await createPlanWithPhases(corpusService, phaseService, []);
    const taskId = await createTask(corpusService, planId);

    await taskWorkflowService.claim(taskId, { by: "agent:alice" });
    await taskWorkflowService.addEvidence(taskId, {
      oracle: "tsc",
      command: "bun run typecheck",
      result: "pass",
      recorded_by: "agent:alice",
      output_tail: "ok",
      capture_source: "self-report",
    });

    const current = await corpusService.get(taskId);
    expect(current.ok).toBe(true);
    if (!current.ok) return;

    const result = await corpusService.set(taskId, {
      extra: { ...current.value.doc.extra, assignee: "agent:alice" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.extra["claim"]).toBeDefined();
    expect(result.value.extra["verification_evidence"]).toHaveLength(1);
    expect(result.value.extra["assignee"]).toBe("agent:alice");
  });
});
