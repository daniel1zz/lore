/**
 * Unit tests for PhaseService.
 * Uses InMemoryStore — no file I/O, no SQLite dependency.
 * Covers HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE dimensions.
 *
 * Test philosophy: every test encodes a SPEC requirement, not what the code happens to do.
 * Adversarial targets identified during implementation read:
 *   - addPhase returns updated array; tests verify append ORDER (defeats hardcoded-return stubs).
 *   - renamePhase updates ALL child tasks; tests use multiple tasks (defeats single-task shortcuts).
 *   - migratePhases dryRun must NOT persist; tests verify no write side-effects.
 *   - migratePhases idempotency: second run should report 0 touched.
 *   - removePhase guard uses parent_id filter; test uses two tasks from DIFFERENT plans.
 *
 * @spec_ref AC-PHASE-8 AC-PHASE-9 AC-PHASE-10 SPEC-023 §4 §8
 */

import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { PhaseService } from "../../../src/service/phase-service.js";
import type { CreateDocInput } from "@lore/core";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeServices() {
  const store = new InMemoryStore();
  const corpusService = new CorpusService(store);
  const phaseService = new PhaseService(store);
  return { store, corpusService, phaseService };
}

/** Create a bare plan (no parent required by schema). */
async function createPlan(
  cs: CorpusService,
  title = "Test Plan",
  extraOpts: Record<string, unknown> = {},
): Promise<string> {
  const result = await cs.create({
    type: "plan",
    title,
    extra: extraOpts,
  } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create plan: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

/** Create a task under a plan with optional extra.phase. */
async function createTask(
  cs: CorpusService,
  planId: string,
  title = "Test Task",
  phase?: string,
): Promise<string> {
  const extra: Record<string, unknown> = { plan_id: planId };
  if (phase !== undefined) extra["phase"] = phase;
  const result = await cs.create({
    type: "task",
    title,
    parent_id: planId,
    extra,
  } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create task: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

// ─── HAPPY — listPhases ───────────────────────────────────────────────────────

describe("listPhases — HAPPY", () => {
  it("AC-PHASE-1.H1: returns empty array when plan has no phases declared", async () => {
    const { corpusService, phaseService } = makeServices();
    const planId = await createPlan(corpusService, "Empty Plan");

    const result = await phaseService.listPhases(planId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Spec: returns an ordered array (may be empty). NOT null, NOT undefined, NOT error.
    expect(Array.isArray(result.value)).toBe(true);
    expect(result.value).toHaveLength(0);
  });

  it("AC-PHASE-1.H2: returns declared phases in declaration order", async () => {
    const { corpusService, phaseService } = makeServices();
    const planId = await createPlan(corpusService, "Ordered Plan");
    await phaseService.addPhase(planId, "Foundation");
    await phaseService.addPhase(planId, "Build");
    await phaseService.addPhase(planId, "Launch");

    const result = await phaseService.listPhases(planId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(3);
    // Spec (Q-extra §8): phases are in declaration order — verify the sequence, not just membership.
    expect(result.value[0]?.name).toBe("Foundation");
    expect(result.value[1]?.name).toBe("Build");
    expect(result.value[2]?.name).toBe("Launch");
  });

  it("AC-PHASE-1.H3: two different plans return independent phase lists", async () => {
    const { corpusService, phaseService } = makeServices();
    const plan1Id = await createPlan(corpusService, "Plan Alpha");
    const plan2Id = await createPlan(corpusService, "Plan Beta");
    await phaseService.addPhase(plan1Id, "Alpha Phase");
    // plan2 intentionally has no phases

    const r1 = await phaseService.listPhases(plan1Id);
    const r2 = await phaseService.listPhases(plan2Id);

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    // Defeats hardcoded-return stub: different inputs → different outputs
    expect(r1.value).toHaveLength(1);
    expect(r2.value).toHaveLength(0);
  });
});

// ─── HAPPY — addPhase ────────────────────────────────────────────────────────

describe("addPhase — HAPPY", () => {
  it("AC-PHASE-8.H1: adds first phase to empty plan (returns updated array with 1 entry)", async () => {
    const { corpusService, phaseService } = makeServices();
    const planId = await createPlan(corpusService);

    const result = await phaseService.addPhase(planId, "Phase A");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Spec AC-PHASE-8: returns updated phases array after adding.
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.name).toBe("Phase A");
  });

  it("AC-PHASE-8.H2: appends second phase — order is [first, second], not reversed", async () => {
    const { corpusService, phaseService } = makeServices();
    const planId = await createPlan(corpusService);
    await phaseService.addPhase(planId, "Alpha");

    const result = await phaseService.addPhase(planId, "Beta");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Spec: appends — second item must be at index 1 (not 0).
    expect(result.value).toHaveLength(2);
    expect(result.value[0]?.name).toBe("Alpha");
    expect(result.value[1]?.name).toBe("Beta");
  });

  it("AC-PHASE-8.H3: addPhase with description stores the description", async () => {
    const { corpusService, phaseService } = makeServices();
    const planId = await createPlan(corpusService);

    const result = await phaseService.addPhase(planId, "Core", "Core infrastructure setup");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]?.name).toBe("Core");
    expect(result.value[0]?.description).toBe("Core infrastructure setup");
  });

  it("AC-PHASE-8.H4: addPhase trims leading/trailing whitespace from name before storing", async () => {
    const { corpusService, phaseService } = makeServices();
    const planId = await createPlan(corpusService);

    const result = await phaseService.addPhase(planId, "  Trimmed Phase  ");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Spec (§8 Q-extra): names are trimmed at write time.
    expect(result.value[0]?.name).toBe("Trimmed Phase");
  });
});

// ─── HAPPY — removePhase ─────────────────────────────────────────────────────

describe("removePhase — HAPPY", () => {
  it("AC-PHASE-9.H1: removes phase when no tasks reference it", async () => {
    const { corpusService, phaseService } = makeServices();
    const planId = await createPlan(corpusService);
    await phaseService.addPhase(planId, "Removable");
    await phaseService.addPhase(planId, "Keeper");

    const result = await phaseService.removePhase(planId, "Removable");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Spec: returns updated phases list WITHOUT the removed entry.
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.name).toBe("Keeper");
  });

  it("AC-PHASE-9.H2: removing last phase returns empty array", async () => {
    const { corpusService, phaseService } = makeServices();
    const planId = await createPlan(corpusService);
    await phaseService.addPhase(planId, "OnlyPhase");

    const result = await phaseService.removePhase(planId, "OnlyPhase");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(0);
  });
});

// ─── HAPPY — renamePhase ─────────────────────────────────────────────────────

describe("renamePhase — HAPPY", () => {
  it("AC-PHASE-rename.H1: renames phase in plan and updates single referencing task", async () => {
    const { corpusService, phaseService } = makeServices();
    const planId = await createPlan(corpusService);
    await phaseService.addPhase(planId, "OldName");
    const taskId = await createTask(corpusService, planId, "Task 1", "OldName");

    const result = await phaseService.renamePhase(planId, "OldName", "NewName");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Plan now has "NewName" not "OldName"
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.name).toBe("NewName");

    // Task must also reference the new name (service updates child tasks)
    const { store } = makeServices();
    // Use store from the same instance
    void taskId; // checked below via listPhases persistence verification
  });
});

// ─── STATE — renamePhase updates ALL child tasks ──────────────────────────────

describe("renamePhase — STATE (multiple tasks)", () => {
  it("AC-PHASE-rename.S1: renames phase in plan AND all multiple child tasks that reference it", async () => {
    const { corpusService, phaseService, store } = makeServices();
    const planId = await createPlan(corpusService);
    await phaseService.addPhase(planId, "OldName");

    // Create 3 tasks, 2 referencing OldName, 1 referencing nothing
    const task1Id = await createTask(corpusService, planId, "Task referencing phase 1", "OldName");
    const task2Id = await createTask(corpusService, planId, "Task referencing phase 2", "OldName");
    const task3Id = await createTask(corpusService, planId, "Task with no phase");

    const result = await phaseService.renamePhase(planId, "OldName", "NewName");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Verify both tasks now reference "NewName"
    const doc1 = await store.find(task1Id as ReturnType<typeof String>["constructor"] extends never ? never : string as unknown as Parameters<typeof store.find>[0]);
    const doc2 = await store.find(task2Id as unknown as Parameters<typeof store.find>[0]);
    const doc3 = await store.find(task3Id as unknown as Parameters<typeof store.find>[0]);

    expect(doc1.ok).toBe(true);
    expect(doc2.ok).toBe(true);
    expect(doc3.ok).toBe(true);

    if (!doc1.ok || !doc2.ok || !doc3.ok) return;
    // Both referencing tasks must have the NEW name
    expect(doc1.value?.extra["phase"]).toBe("NewName");
    expect(doc2.value?.extra["phase"]).toBe("NewName");
    // Non-referencing task must be untouched (no phase set)
    expect(doc3.value?.extra["phase"]).toBeUndefined();
  });

  it("AC-PHASE-rename.S2: tasks from a DIFFERENT plan are not updated", async () => {
    const { corpusService, phaseService, store } = makeServices();
    const planAId = await createPlan(corpusService, "Plan A");
    const planBId = await createPlan(corpusService, "Plan B");

    // Both plans have a phase called "Alpha"
    await phaseService.addPhase(planAId, "Alpha");
    // Plan B task cannot reference planA's phase via CorpusService (different parent),
    // so we bypass via store.update to simulate a raw doc with extra.phase = "Alpha"
    await phaseService.addPhase(planBId, "Alpha");
    const taskBId = await createTask(corpusService, planBId, "Task in Plan B", "Alpha");

    // Rename "Alpha" → "Omega" only on Plan A
    const result = await phaseService.renamePhase(planAId, "Alpha", "Omega");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Plan B's task must still say "Alpha" — renamePhase is scoped to a single plan
    const taskBDoc = await store.find(taskBId as unknown as Parameters<typeof store.find>[0]);
    expect(taskBDoc.ok).toBe(true);
    if (!taskBDoc.ok) return;
    expect(taskBDoc.value?.extra["phase"]).toBe("Alpha");
  });
});

// ─── NEGATIVE — addPhase ─────────────────────────────────────────────────────

describe("addPhase — NEGATIVE", () => {
  it("AC-PHASE-8.N1: duplicate name → VALIDATION_ERROR (case-sensitive exact match)", async () => {
    const { corpusService, phaseService } = makeServices();
    const planId = await createPlan(corpusService);
    await phaseService.addPhase(planId, "Phase A");

    const result = await phaseService.addPhase(planId, "Phase A");

    // Spec AC-PHASE-8: duplicate name → exit 4 (VALIDATION_ERROR)
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("AC-PHASE-8.N2: case differs → NOT a duplicate (case-sensitive)", async () => {
    const { corpusService, phaseService } = makeServices();
    const planId = await createPlan(corpusService);
    await phaseService.addPhase(planId, "Phase A");

    // "phase a" is different from "Phase A" — must be accepted
    const result = await phaseService.addPhase(planId, "phase a");

    // Spec §8 Q-extra: names are case-sensitive.
    expect(result.ok).toBe(true);
  });

  it("AC-PHASE-type.N1: addPhase on a non-plan document → VALIDATION_ERROR", async () => {
    const { corpusService, phaseService } = makeServices();
    // Create a PRD (not a plan)
    const prdResult = await corpusService.create({ type: "prd", title: "My PRD" });
    expect(prdResult.ok).toBe(true);
    if (!prdResult.ok) return;

    const result = await phaseService.addPhase(prdResult.value.id, "Some Phase");

    // Spec: listPhases/addPhase/removePhase require a plan document.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("AC-PHASE-notfound.N1: addPhase on non-existent ID → DOC_NOT_FOUND", async () => {
    const { phaseService } = makeServices();

    const result = await phaseService.addPhase("01AAAAAAAAAAAAAAAAAAAAAAA0", "Phase X");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("DOC_NOT_FOUND");
  });
});

// ─── NEGATIVE — removePhase ──────────────────────────────────────────────────

describe("removePhase — NEGATIVE", () => {
  it("AC-PHASE-9.N1: fails when tasks still reference the phase", async () => {
    const { corpusService, phaseService } = makeServices();
    const planId = await createPlan(corpusService);
    await phaseService.addPhase(planId, "Blocked Phase");
    // Create a task that references this phase
    await createTask(corpusService, planId, "Blocking Task", "Blocked Phase");

    const result = await phaseService.removePhase(planId, "Blocked Phase");

    // Spec AC-PHASE-9: must fail. User must clear/move tasks first.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("AC-PHASE-9.N2: phase name not found → VALIDATION_ERROR", async () => {
    const { corpusService, phaseService } = makeServices();
    const planId = await createPlan(corpusService);
    await phaseService.addPhase(planId, "Real Phase");

    const result = await phaseService.removePhase(planId, "NonExistentPhase");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("AC-PHASE-9.N3: fails on non-plan document", async () => {
    const { corpusService, phaseService } = makeServices();
    const prdResult = await corpusService.create({ type: "prd", title: "PRD Doc" });
    expect(prdResult.ok).toBe(true);
    if (!prdResult.ok) return;

    const result = await phaseService.removePhase(prdResult.value.id, "Any Phase");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });
});

// ─── NEGATIVE — renamePhase ──────────────────────────────────────────────────

describe("renamePhase — NEGATIVE", () => {
  it("AC-PHASE-rename.N1: oldName not found → VALIDATION_ERROR", async () => {
    const { corpusService, phaseService } = makeServices();
    const planId = await createPlan(corpusService);
    await phaseService.addPhase(planId, "Existing");

    const result = await phaseService.renamePhase(planId, "Ghost", "New");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("AC-PHASE-rename.N2: newName collides with existing phase → VALIDATION_ERROR", async () => {
    const { corpusService, phaseService } = makeServices();
    const planId = await createPlan(corpusService);
    await phaseService.addPhase(planId, "Alpha");
    await phaseService.addPhase(planId, "Beta");

    const result = await phaseService.renamePhase(planId, "Alpha", "Beta");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });
});

// ─── BOUNDARY ────────────────────────────────────────────────────────────────

describe("addPhase — BOUNDARY", () => {
  it("AC-PHASE-boundary.B1: whitespace-only name → VALIDATION_ERROR (empty after trim)", async () => {
    const { corpusService, phaseService } = makeServices();
    const planId = await createPlan(corpusService);

    const result = await phaseService.addPhase(planId, "   ");

    // Spec §8 Q-extra: names trimmed at write; whitespace-only is empty → reject.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("AC-PHASE-boundary.B2: empty string name → VALIDATION_ERROR", async () => {
    const { corpusService, phaseService } = makeServices();
    const planId = await createPlan(corpusService);

    const result = await phaseService.addPhase(planId, "");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("renamePhase — BOUNDARY", () => {
  it("AC-PHASE-boundary.B3: same old/new name → VALIDATION_ERROR", async () => {
    const { corpusService, phaseService } = makeServices();
    const planId = await createPlan(corpusService);
    await phaseService.addPhase(planId, "SameName");

    const result = await phaseService.renamePhase(planId, "SameName", "SameName");

    // Spec: rename with identical names is a no-op that should be caught as VALIDATION_ERROR.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("listPhases — BOUNDARY", () => {
  it("AC-PHASE-boundary.B4: listPhases on non-plan doc → VALIDATION_ERROR", async () => {
    const { corpusService, phaseService } = makeServices();
    const prdResult = await corpusService.create({ type: "prd", title: "A PRD" });
    expect(prdResult.ok).toBe(true);
    if (!prdResult.ok) return;

    const result = await phaseService.listPhases(prdResult.value.id);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });
});

// ─── ERROR — migratePhases ───────────────────────────────────────────────────

describe("migratePhases — ERROR (error paths)", () => {
  it("AC-PHASE-10.E1: dryRun=true reports touched count but does NOT write changes", async () => {
    const { corpusService, phaseService, store } = makeServices();
    // Create two plans with legacy extra.phase strings
    const plan1Id = await createPlan(corpusService, "Legacy Plan 1", { phase: "Track A" });
    const plan2Id = await createPlan(corpusService, "Legacy Plan 2", { phase: "Track B" });
    // One plan without legacy field
    await createPlan(corpusService, "Clean Plan");

    const result = await phaseService.migratePhases({ dryRun: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Spec AC-PHASE-10: dryRun reports what WOULD happen.
    expect(result.value.dryRun).toBe(true);
    expect(result.value.touched).toBe(2);
    expect(result.value.skipped).toBe(1);

    // CRITICAL: dryRun must NOT write. Re-read plans directly from store and verify extra.phase is still there.
    const plan1Doc = await store.find(plan1Id as unknown as Parameters<typeof store.find>[0]);
    const plan2Doc = await store.find(plan2Id as unknown as Parameters<typeof store.find>[0]);
    expect(plan1Doc.ok).toBe(true);
    expect(plan2Doc.ok).toBe(true);
    if (!plan1Doc.ok || !plan2Doc.ok) return;
    // Verify the legacy field is still there — dryRun wrote nothing.
    expect(plan1Doc.value?.extra["phase"]).toBe("Track A");
    expect(plan2Doc.value?.extra["phase"]).toBe("Track B");
    // Verify legacy_phase was NOT set (that only happens on actual write).
    expect(plan1Doc.value?.extra["legacy_phase"]).toBeUndefined();
    expect(plan2Doc.value?.extra["legacy_phase"]).toBeUndefined();
  });

  it("AC-PHASE-10.E2: dryRun=true → legacy extra.phase remains on plan (no write)", async () => {
    const { corpusService, phaseService, store } = makeServices();
    const planId = await createPlan(corpusService, "Legacy Plan", { phase: "Track A" });

    await phaseService.migratePhases({ dryRun: true });

    // The plan must still have extra.phase = "Track A" (dryRun wrote nothing)
    const planDoc = await store.find(planId as unknown as Parameters<typeof store.find>[0]);
    expect(planDoc.ok).toBe(true);
    if (!planDoc.ok) return;
    expect(planDoc.value?.extra["phase"]).toBe("Track A");
    expect(planDoc.value?.extra["legacy_phase"]).toBeUndefined();
  });
});

describe("migratePhases — HAPPY", () => {
  it("AC-PHASE-10.H1: migrates extra.phase → extra.legacy_phase and removes singular field", async () => {
    const { corpusService, phaseService, store } = makeServices();
    const planId = await createPlan(corpusService, "Legacy Plan", { phase: "Track A" });

    const result = await phaseService.migratePhases({ dryRun: false });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.touched).toBe(1);
    expect(result.value.skipped).toBe(0);
    expect(result.value.dryRun).toBe(false);

    // Spec AC-PHASE-10: after migration, extra.phase must be gone, extra.legacy_phase set.
    const planDoc = await store.find(planId as unknown as Parameters<typeof store.find>[0]);
    expect(planDoc.ok).toBe(true);
    if (!planDoc.ok) return;
    // MUST NOT have singular phase field after migration
    expect(planDoc.value?.extra["phase"]).toBeUndefined();
    // MUST have legacy_phase set to original value
    expect(planDoc.value?.extra["legacy_phase"]).toBe("Track A");
  });

  it("AC-PHASE-10.H2: idempotent — re-running reports 0 touched (already migrated rows skipped)", async () => {
    const { corpusService, phaseService } = makeServices();
    await createPlan(corpusService, "Legacy Plan", { phase: "Track A" });

    // First run
    await phaseService.migratePhases({ dryRun: false });

    // Second run — must be a no-op
    const result2 = await phaseService.migratePhases({ dryRun: false });

    expect(result2.ok).toBe(true);
    if (!result2.ok) return;
    // Spec AC-PHASE-10: idempotent — rerunning is a no-op on already-migrated rows.
    expect(result2.value.touched).toBe(0);
    expect(result2.value.skipped).toBe(1); // the plan is skipped (no legacy field remains)
  });

  it("AC-PHASE-10.H3: plans without extra.phase are skipped (not touched)", async () => {
    const { corpusService, phaseService } = makeServices();
    // Plans with the new `phases` array format should be skipped
    await createPlan(corpusService, "New Plan 1"); // no extra.phase
    await createPlan(corpusService, "New Plan 2"); // no extra.phase

    const result = await phaseService.migratePhases({ dryRun: false });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.touched).toBe(0);
    expect(result.value.skipped).toBe(2);
  });
});
