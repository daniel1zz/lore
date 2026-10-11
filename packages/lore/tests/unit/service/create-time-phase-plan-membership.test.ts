/**
 * The TENTH plan-member site — create-time (and set-time) `extra.phase`
 * validation must resolve the owning plan by MEMBERSHIP (`extra.plan_id`,
 * `isPlanMember`), never by the `parent_id` proxy.
 *
 * `lore create task --plan-id P --parent Q` with `P !== Q` is a SUPPORTED shape
 * (SPEC-065 D4). Every phase-scoped READ resolves the namespace by membership
 * (`PhaseService.findTasksByPhase`), so a `parent_id`-keyed write-time check
 * validated the phase name against the WRONG plan's namespace.
 *
 * ⛔ This is the family's first WRITE path: a task accepted before the fix may be
 * REFUSED after it, and vice versa. BOTH directions are asserted here — an
 * "accepts more" test alone is satisfiable by removing the check entirely.
 *
 * Six dimensions:
 *   HAPPY      — diverged task whose phase IS declared on its own plan P
 *   NEGATIVE   — diverged task whose phase is declared only on the FILING parent Q
 *   BOUNDARY   — case-sensitivity, and the both-namespaces-declare-it overlap
 *   ERROR      — unresolvable `extra.plan_id`, and a phase with no membership at all
 *   STATE      — the accepted diverged task is reachable by the membership-keyed
 *                phase reads (`removePhase` blocks on P, not on Q)
 *   REGRESSION — undiverged majority unchanged; `--adhoc` unaffected both ways
 *
 * @spec_ref task-the-tenth-plan-member-site-is-a-write-path-create-time
 * @spec_ref SPEC-065 D4, SPEC-023 §4 AC-PHASE-3
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { PhaseService } from "../../../src/service/phase-service.js";
import type { CreateDocInput, DocPatch } from "@lore/core";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeServices() {
  const store = new InMemoryStore();
  return { store, corpusService: new CorpusService(store, new RecordLockService(store)), phaseService: new PhaseService(store, new RecordLockService(store)) };
}

/** Create a plan carrying exactly `phaseNames` as its declared phase namespace. */
async function makePlan(
  corpusService: CorpusService,
  phaseService: PhaseService,
  title: string,
  phaseNames: readonly string[],
): Promise<string> {
  const planResult = await corpusService.create({ type: "plan", title } as CreateDocInput);
  if (!planResult.ok) throw new Error(`plan create failed: ${JSON.stringify(planResult.error)}`);
  for (const name of phaseNames) {
    const addResult = await phaseService.addPhase(planResult.value.id, name);
    if (!addResult.ok) throw new Error(`addPhase failed: ${JSON.stringify(addResult.error)}`);
  }
  return planResult.value.id;
}

/**
 * The canonical diverged shape: `--plan-id ownerPlanId --parent filingParentId`.
 * `extra.plan_id` IS the membership; `parent_id` is only where the doc is filed.
 */
async function createDivergedTask(
  corpusService: CorpusService,
  ownerPlanId: string,
  filingParentId: string,
  phase: string | undefined,
  title = "Diverged Task",
) {
  return corpusService.create({
    type: "task",
    title,
    parent_id: filingParentId,
    extra: phase === undefined ? { plan_id: ownerPlanId } : { plan_id: ownerPlanId, phase },
  } as CreateDocInput);
}

// ─── HAPPY: the phase is validated against the MEMBER plan P ─────────────────

describe("create — diverged task (--plan-id P --parent Q), phase declared on P", () => {
  it("AC-1: accepts a phase declared on the OWNING plan P even though the filing parent Q never declared it", async () => {
    const { corpusService, phaseService } = makeServices();
    const planP = await makePlan(corpusService, phaseService, "Owner Plan P", ["Phase A", "Phase B"]);
    const planQ = await makePlan(corpusService, phaseService, "Filing Parent Q", ["Phase Z"]);

    const result = await createDivergedTask(corpusService, planP, planQ, "Phase A");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.extra["phase"]).toBe("Phase A");
    expect(result.value.extra["plan_id"]).toBe(planP);
    expect(result.value.parent_id).toBe(planQ);
  });

  it("AC-1b: BOUNDARY — a name declared by BOTH namespaces is accepted (the two agree; no regression at the overlap)", async () => {
    const { corpusService, phaseService } = makeServices();
    const planP = await makePlan(corpusService, phaseService, "Owner P Overlap", ["Shared Phase"]);
    const planQ = await makePlan(corpusService, phaseService, "Parent Q Overlap", ["Shared Phase"]);

    const result = await createDivergedTask(corpusService, planP, planQ, "Shared Phase");

    expect(result.ok).toBe(true);
  });
});

// ─── NEGATIVE: the mirror direction — newly REFUSED ──────────────────────────

describe("create — diverged task, phase declared only on the FILING parent Q", () => {
  it("AC-2: REFUSES a phase declared on Q but not on the owning plan P (the direction the fix must not lose)", async () => {
    const { corpusService, phaseService } = makeServices();
    const planP = await makePlan(corpusService, phaseService, "Owner Plan P2", ["Phase A"]);
    const planQ = await makePlan(corpusService, phaseService, "Filing Parent Q2", ["Phase Z"]);

    const result = await createDivergedTask(corpusService, planP, planQ, "Phase Z");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("AC-2b: SILENCE — the refusal names WHICH plan's namespace was consulted (P), and P's declared names", async () => {
    const { corpusService, phaseService } = makeServices();
    const planP = await makePlan(corpusService, phaseService, "Owner Plan P3", ["Phase A"]);
    const planQ = await makePlan(corpusService, phaseService, "Filing Parent Q3", ["Phase Z"]);

    const result = await createDivergedTask(corpusService, planP, planQ, "Phase Z");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const message = "message" in result.error ? String(result.error.message) : "";
    // The consulted namespace is P's — its id must appear, Q's must NOT.
    expect(message).toContain(planP);
    expect(message).not.toContain(planQ);
    expect(message).toContain("Phase A");
  });

  it("AC-2c: REFUSES when the owning plan P declares NO phases at all, even though Q declares the name", async () => {
    const { corpusService, phaseService } = makeServices();
    const planP = await makePlan(corpusService, phaseService, "Phaseless Owner P", []);
    const planQ = await makePlan(corpusService, phaseService, "Filing Parent Q4", ["Phase Z"]);

    const result = await createDivergedTask(corpusService, planP, planQ, "Phase Z");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    const message = "message" in result.error ? String(result.error.message) : "";
    expect(message).toContain(planP);
  });

  it("AC-2d: BOUNDARY — case-sensitive against P's namespace ('phase a' ≠ 'Phase A')", async () => {
    const { corpusService, phaseService } = makeServices();
    const planP = await makePlan(corpusService, phaseService, "Owner Plan P5", ["Phase A"]);
    const planQ = await makePlan(corpusService, phaseService, "Filing Parent Q5", ["phase a"]);

    const result = await createDivergedTask(corpusService, planP, planQ, "phase a");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });
});

// ─── ERROR: membership that cannot be resolved ───────────────────────────────

describe("create — task whose extra.plan_id resolves to no plan", () => {
  it("AC-E1: REFUSES a phase when extra.plan_id names no live plan — never silently falls back to the parent", async () => {
    const { corpusService, phaseService } = makeServices();
    const planQ = await makePlan(corpusService, phaseService, "Filing Parent Q6", ["Phase Z"]);

    const result = await createDivergedTask(corpusService, "01JZZZZZZZZZZZZZZZZZZZZZZZ", planQ, "Phase Z");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    const message = "message" in result.error ? String(result.error.message) : "";
    expect(message).toContain("01JZZZZZZZZZZZZZZZZZZZZZZZ");
  });

  it("AC-E2: a task with NO phase and an unresolvable plan_id is untouched by this check (phase-less tasks never validate a namespace)", async () => {
    const { corpusService, phaseService } = makeServices();
    const planQ = await makePlan(corpusService, phaseService, "Filing Parent Q7", ["Phase Z"]);

    const result = await createDivergedTask(corpusService, "01JZZZZZZZZZZZZZZZZZZZZZZZ", planQ, undefined);

    expect(result.ok).toBe(true);
  });
});

// ─── STATE: the accepted diverged task is reachable by the membership reads ──

describe("phase rm agreement — the write-time namespace and the read-time namespace are the same", () => {
  it("AC-6: a diverged task accepted against P blocks `removePhase` on P, and does NOT block the same name on Q", async () => {
    const { corpusService, phaseService } = makeServices();
    const planP = await makePlan(corpusService, phaseService, "Owner Plan P8", ["Shared Name"]);
    const planQ = await makePlan(corpusService, phaseService, "Filing Parent Q8", ["Shared Name"]);

    const created = await createDivergedTask(corpusService, planP, planQ, "Shared Name");
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // P owns the member → removal is blocked and names the task.
    const removeFromP = await phaseService.removePhase(planP, "Shared Name");
    expect(removeFromP.ok).toBe(false);
    if (removeFromP.ok) return;
    const blockMessage = "message" in removeFromP.error ? String(removeFromP.error.message) : "";
    expect(blockMessage).toContain(created.value.slug);

    // Q merely FILES it → Q's identically-named phase is free to go.
    const removeFromQ = await phaseService.removePhase(planQ, "Shared Name");
    expect(removeFromQ.ok).toBe(true);
  });
});

// ─── REGRESSION: the undiverged majority ─────────────────────────────────────

describe("create — undiverged task (parent_id === extra.plan_id): CONTROL", () => {
  it("AC-3: a declared phase is still accepted", async () => {
    const { corpusService, phaseService } = makeServices();
    const planId = await makePlan(corpusService, phaseService, "Undiverged Plan", ["Phase A"]);

    const result = await createDivergedTask(corpusService, planId, planId, "Phase A");

    expect(result.ok).toBe(true);
  });

  it("AC-3b: an undeclared phase is still refused", async () => {
    const { corpusService, phaseService } = makeServices();
    const planId = await makePlan(corpusService, phaseService, "Undiverged Plan 2", ["Phase A"]);

    const result = await createDivergedTask(corpusService, planId, planId, "Phase Q");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("AC-3c: a phase on a plan declaring none is still refused", async () => {
    const { corpusService, phaseService } = makeServices();
    const planId = await makePlan(corpusService, phaseService, "Undiverged Phaseless", []);

    const result = await createDivergedTask(corpusService, planId, planId, "Phase A");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });
});

// ─── REGRESSION: --adhoc has no plan membership BY DESIGN ────────────────────

describe("create --adhoc — no plan membership, therefore no phase namespace", () => {
  it("AC-4: an adhoc task WITHOUT a phase is accepted, exactly as before (never dragged into a namespace)", async () => {
    const { corpusService } = makeServices();
    const prdResult = await corpusService.create({ type: "prd", title: "Root PRD" } as CreateDocInput);
    expect(prdResult.ok).toBe(true);
    if (!prdResult.ok) return;

    const result = await corpusService.create({
      type: "task",
      title: "Adhoc Task",
      extra: { adhoc: true },
    } as CreateDocInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.parent_id).toBe(prdResult.value.id);
    expect(result.value.extra["plan_id"]).toBeUndefined();
  });

  it("AC-4b: an adhoc task WITH a phase stays REFUSED (unchanged outcome), and the refusal says membership is absent", async () => {
    const { corpusService, phaseService } = makeServices();
    const prdResult = await corpusService.create({ type: "prd", title: "Root PRD 2" } as CreateDocInput);
    expect(prdResult.ok).toBe(true);
    // A plan declaring the very name exists — an adhoc task must NOT reach it.
    await makePlan(corpusService, phaseService, "Some Plan", ["Phase A"]);

    const result = await corpusService.create({
      type: "task",
      title: "Adhoc Task With Phase",
      extra: { adhoc: true, phase: "Phase A" },
    } as CreateDocInput);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    const message = "message" in result.error ? String(result.error.message) : "";
    expect(message).toContain("plan_id");
  });
});

// ─── set(): the same namespace, the same resolution ──────────────────────────

describe("set — updating a diverged task's extra.phase", () => {
  it("AC-S1: accepts a phase declared on the owning plan P (patch keeps plan_id = P)", async () => {
    const { corpusService, phaseService } = makeServices();
    const planP = await makePlan(corpusService, phaseService, "Set Owner P", ["Phase A"]);
    const planQ = await makePlan(corpusService, phaseService, "Set Parent Q", ["Phase Z"]);

    const created = await createDivergedTask(corpusService, planP, planQ, undefined, "Set Target");
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const patch: DocPatch = { extra: { plan_id: planP, phase: "Phase A" } };
    const result = await corpusService.set(created.value.id, patch);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.extra["phase"]).toBe("Phase A");
  });

  it("AC-S2: REFUSES a phase declared only on the filing parent Q", async () => {
    const { corpusService, phaseService } = makeServices();
    const planP = await makePlan(corpusService, phaseService, "Set Owner P2", ["Phase A"]);
    const planQ = await makePlan(corpusService, phaseService, "Set Parent Q2", ["Phase Z"]);

    const created = await createDivergedTask(corpusService, planP, planQ, undefined, "Set Target 2");
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const patch: DocPatch = { extra: { plan_id: planP, phase: "Phase Z" } };
    const result = await corpusService.set(created.value.id, patch);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    const message = "message" in result.error ? String(result.error.message) : "";
    expect(message).toContain(planP);
  });

  it("AC-S3: ERROR — a patch that sets a phase while DROPPING extra.plan_id is refused (a phase with no namespace)", async () => {
    const { corpusService, phaseService } = makeServices();
    const planId = await makePlan(corpusService, phaseService, "Set Drop Plan", ["Phase A"]);

    const created = await createDivergedTask(corpusService, planId, planId, undefined, "Set Drop Target");
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // `extra` REPLACES wholesale, so this patch leaves the task with no plan_id.
    const patch: DocPatch = { extra: { phase: "Phase A" } };
    const result = await corpusService.set(created.value.id, patch);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    const message = "message" in result.error ? String(result.error.message) : "";
    expect(message).toContain("plan_id");
  });
});
