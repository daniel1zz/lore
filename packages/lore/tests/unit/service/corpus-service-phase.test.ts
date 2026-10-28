/**
 * Unit tests for CorpusService cross-entity phase validation (AC-PHASE-3, AC-PHASE-4).
 * Uses InMemoryStore — no SQLite dependency.
 *
 * The cross-entity constraint (task.extra.phase must match parent plan.extra.phases[].name)
 * cannot be expressed in Zod alone — it lives in CorpusService.create() and CorpusService.set().
 * These tests verify the service-layer enforcement, not the Zod schema.
 *
 * Adversarial targets:
 *   - The implementation has a `if (parentForPhase !== null)` guard in create() that skips
 *     validation when the parent cannot be fetched. This could be a silent fallback bug.
 *   - Case sensitivity: "alpha" vs "Alpha" must be treated as different names.
 *   - set() path (update): same cross-entity validation must apply, not just create().
 *
 * @spec_ref AC-PHASE-3 AC-PHASE-4 SPEC-023 §4
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { PhaseService } from "../../../src/service/phase-service.js";
import type { CreateDocInput, DocPatch } from "@lore/core";
import { actedStore } from "../../live-invocation.js";

import { ensureRequirementsDocId } from "../../helpers/parented-create.js";
// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeServices() {
  const store = actedStore(new InMemoryStore());
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const phaseService = new PhaseService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  return { store, corpusService, phaseService };
}

/** Create a plan and optionally add phases to it. */
async function setupPlan(
  cs: CorpusService,
  ps: PhaseService,
  phaseNames: string[] = [],
): Promise<string> {
  const planR = await cs.create({ parent_id: await ensureRequirementsDocId(cs), type: "plan", title: "Test Plan" } as CreateDocInput);
  if (!planR.ok) throw new Error(`Failed to create plan: ${JSON.stringify(planR.error)}`);
  for (const name of phaseNames) {
    const addR = await ps.addPhase(planR.value.id, name);
    if (!addR.ok) throw new Error(`Failed to add phase: ${JSON.stringify(addR.error)}`);
  }
  return planR.value.id;
}

/** Create a task under a plan without a phase. */
async function createTaskNoPhase(cs: CorpusService, planId: string, title = "Task"): Promise<string> {
  const r = await cs.create({
    type: "task",
    title,
    parent_id: planId,
    extra: { plan_id: planId },
  } as CreateDocInput);
  if (!r.ok) throw new Error(`Failed to create task: ${JSON.stringify(r.error)}`);
  return r.value.id;
}

// ─── AC-PHASE-3 Sub-case 1: parent plan has NO phases ────────────────────────

describe("CorpusService.create — task with phase when plan has NO phases", () => {
  it("AC-PHASE-3.1: VALIDATION_ERROR when plan has no phases and task specifies extra.phase", async () => {
    const { corpusService, phaseService } = makeServices();
    const planId = await setupPlan(corpusService, phaseService, []); // no phases

    const result = await corpusService.create({
      type: "task",
      title: "Orphaned Phase Task",
      parent_id: planId,
      extra: { plan_id: planId, phase: "Ghost Phase" },
    } as CreateDocInput);

    // Spec AC-PHASE-3 sub-case 1: parent has no phases → VALIDATION_ERROR
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("AC-PHASE-3.1b: VALIDATION_ERROR even when plan has empty phases array explicitly", async () => {
    const { corpusService, store } = makeServices();
    const planR = await corpusService.create({ parent_id: await ensureRequirementsDocId(corpusService), type: "plan", title: "Empty Array Plan" } as CreateDocInput);
    expect(planR.ok).toBe(true);
    if (!planR.ok) return;

    // Set plan.extra.phases to explicit empty array via store.update
    await store.update(planR.value.id, { extra: { phases: [] }, updated_at: new Date().toISOString() });

    const result = await corpusService.create({
      type: "task",
      title: "Phase Task",
      parent_id: planR.value.id,
      extra: { plan_id: planR.value.id, phase: "Phase A" },
    } as CreateDocInput);

    // An explicitly empty phases array is treated the same as absent phases.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });
});

// ─── AC-PHASE-3 Sub-case 2: phase name not in plan's phases ──────────────────

describe("CorpusService.create — task with unknown phase name", () => {
  it("AC-PHASE-3.2: VALIDATION_ERROR when phase name does not match any declared phase", async () => {
    const { corpusService, phaseService } = makeServices();
    const planId = await setupPlan(corpusService, phaseService, ["Alpha", "Beta"]);

    const result = await corpusService.create({
      type: "task",
      title: "Bad Phase Task",
      parent_id: planId,
      extra: { plan_id: planId, phase: "Gamma" }, // "Gamma" not declared
    } as CreateDocInput);

    // Spec AC-PHASE-3 sub-case 2: name not found → VALIDATION_ERROR
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("AC-PHASE-3.2b: VALIDATION_ERROR for case mismatch (case-sensitive matching)", async () => {
    const { corpusService, phaseService } = makeServices();
    const planId = await setupPlan(corpusService, phaseService, ["Alpha"]);

    const result = await corpusService.create({
      type: "task",
      title: "Case Mismatch Task",
      parent_id: planId,
      extra: { plan_id: planId, phase: "alpha" }, // "alpha" ≠ "Alpha"
    } as CreateDocInput);

    // Spec §8 Q-extra: matching is case-sensitive.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });
});

// ─── AC-PHASE-3 Sub-case 3: phase name matches → success ─────────────────────

describe("CorpusService.create — task with valid phase name", () => {
  it("AC-PHASE-3.3: task created successfully when phase name matches exactly", async () => {
    const { corpusService, phaseService } = makeServices();
    const planId = await setupPlan(corpusService, phaseService, ["Alpha", "Beta"]);

    const result = await corpusService.create({
      type: "task",
      title: "Valid Phase Task",
      parent_id: planId,
      extra: { plan_id: planId, phase: "Alpha" },
    } as CreateDocInput);

    // Spec AC-PHASE-3 sub-case 3: phase found → task created.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.extra["phase"]).toBe("Alpha");
  });

  it("AC-PHASE-3.3b: tasks with different valid phases on same plan both succeed", async () => {
    const { corpusService, phaseService } = makeServices();
    const planId = await setupPlan(corpusService, phaseService, ["Alpha", "Beta"]);

    const r1 = await corpusService.create({
      type: "task",
      title: "Task in Alpha",
      parent_id: planId,
      extra: { plan_id: planId, phase: "Alpha" },
    } as CreateDocInput);

    const r2 = await corpusService.create({
      type: "task",
      title: "Task in Beta",
      parent_id: planId,
      extra: { plan_id: planId, phase: "Beta" },
    } as CreateDocInput);

    // Defeats hardcoded-return stubs: two different inputs, two different results.
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.value.extra["phase"]).toBe("Alpha");
    expect(r2.value.extra["phase"]).toBe("Beta");
  });
});

// ─── AC-PHASE-4: task without extra.phase always succeeds ────────────────────

describe("CorpusService.create — task WITHOUT extra.phase (backward compat)", () => {
  it("AC-PHASE-4.1: task without extra.phase succeeds even when plan has phases declared", async () => {
    const { corpusService, phaseService } = makeServices();
    const planId = await setupPlan(corpusService, phaseService, ["Alpha", "Beta"]);

    const result = await corpusService.create({
      type: "task",
      title: "No-Phase Task",
      parent_id: planId,
      extra: { plan_id: planId }, // no phase field
    } as CreateDocInput);

    // Spec AC-PHASE-4: backward compat — task without phase is always valid.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.extra["phase"]).toBeUndefined();
  });

  it("AC-PHASE-4.2: task without extra.phase succeeds on plan with no phases either", async () => {
    const { corpusService, phaseService } = makeServices();
    const planId = await setupPlan(corpusService, phaseService, []); // no phases on plan

    const result = await corpusService.create({
      type: "task",
      title: "No-Phase Task on Phaseless Plan",
      parent_id: planId,
      extra: { plan_id: planId },
    } as CreateDocInput);

    expect(result.ok).toBe(true);
  });
});

// ─── set() path: cross-entity validation on UPDATE ───────────────────────────

describe("CorpusService.set — updating task extra.phase", () => {
  it("AC-PHASE-3.set.1: set() with unknown phase → VALIDATION_ERROR", async () => {
    const { corpusService, phaseService } = makeServices();
    const planId = await setupPlan(corpusService, phaseService, ["Alpha"]);
    const taskId = await createTaskNoPhase(corpusService, planId);

    const patch: DocPatch = { extra: { plan_id: planId, phase: "NonExistent" } };
    const result = await corpusService.set(taskId, patch);

    // Spec AC-PHASE-3: same constraint applies at update time (set() path).
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("AC-PHASE-3.set.2: set() with valid phase → success", async () => {
    const { corpusService, phaseService } = makeServices();
    const planId = await setupPlan(corpusService, phaseService, ["Alpha", "Beta"]);
    const taskId = await createTaskNoPhase(corpusService, planId);

    const patch: DocPatch = { extra: { plan_id: planId, phase: "Beta" } };
    const result = await corpusService.set(taskId, patch);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.extra["phase"]).toBe("Beta");
  });

  it("AC-PHASE-3.set.3: set() with unknown phase on plan with NO phases → VALIDATION_ERROR", async () => {
    const { corpusService, phaseService } = makeServices();
    const planId = await setupPlan(corpusService, phaseService, []); // no phases
    const taskId = await createTaskNoPhase(corpusService, planId);

    const patch: DocPatch = { extra: { plan_id: planId, phase: "SomePhase" } };
    const result = await corpusService.set(taskId, patch);

    // Sub-case 1 of AC-PHASE-3 applies to set() path too.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });
});
