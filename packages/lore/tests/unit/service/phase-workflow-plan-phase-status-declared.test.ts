/**
 * `PhaseWorkflowService.planPhaseStatus`'s declared-phase projection
 * (adr-planphasestatus-projects-declared-extra-phases-alongside, dogfood
 * ISSUE-007) — additive to `phase-workflow-service.test.ts`, kept as its own
 * file per that suite's own "additive, isolated" precedent
 * (`phase-workflow-evidence-renewal.test.ts`/`phase-workflow-inconclusive-
 * guard.test.ts`). Uses `CorpusService` + `InMemoryStore` (plain doc creation
 * — `type: "phase"` is directly creatable via `CorpusService.create`, no raw
 * `store.insert` needed for THIS suite's fixtures) rather than the historical
 * dynamic-import RED-test harness `phase-workflow-service.test.ts` still
 * carries — that harness's narrow `PhaseWorkflowServiceInstance` interface
 * pre-dates `planPhaseStatus` and deliberately isn't widened here to avoid
 * touching that file's own contract.
 *
 * Six-dimension coverage:
 *   HAPPY:      a declared-only plan (extra.phases, no phase doc) yields ONE
 *               declared scorecard per name with correct task_count / evidence
 *               pass-fail rollup / ac_coverage (reusing computeAcCoverage); a
 *               phase whose only task evidence is expected-fail reports
 *               evidence.expected_fail: 1, distinguishable from a phase with
 *               zero evidence (task-two-more-evidence-consumers-erase-an-
 *               expected-fail-row-doc)
 *   NEGATIVE:   a declared phase whose name ALSO matches a phase-doc title is
 *               NOT double-projected — the richer phase-doc scorecard wins
 *   BOUNDARY:   a declared phase with zero tasks yet renders task_count: 0 /
 *               evidence: {pass:0, fail:0} — a normal state, not an error
 *   ERROR:      a task's extra.phase naming neither a declared phase nor a
 *               phase-doc title surfaces as its own orphaned:true entry,
 *               never silently dropped
 *   STATE:      a mixed plan (one phase-doc phase + one declared-only phase)
 *               yields exactly one entry per distinct phase name, each tagged
 *               with the correct `source`
 *   REGRESSION: a phase-doc-only plan (no extra.phases declared at all) is
 *               UNCHANGED from the pre-ADR shape — same field values, only the
 *               additive `source: "phase-doc"` tag is new
 *
 * @spec_ref adr-planphasestatus-projects-declared-extra-phases-alongside
 */

import { describe, it, expect } from "vitest";
import { NoOpTelemetry } from "@lore/core";
import type { CreateDocInput } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { PhaseWorkflowService, type PhaseScorecard, type DeclaredPhaseScorecard } from "../../../src/service/phase-workflow-service.js";
import { CorpusService } from "../../../src/service/corpus-service.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────

async function makeFixture() {
  const store = new InMemoryStore();
  const corpusService = new CorpusService(store, new NoOpTelemetry());
  const service = new PhaseWorkflowService(store, new NoOpTelemetry(), { claimTtlMinutes: 120 });

  const prd = await corpusService.create({ type: "prd", title: "Declared Phase Root PRD", content: "root" });
  if (!prd.ok) throw new Error(`seed prd failed: ${JSON.stringify(prd.error)}`);

  const spec = await corpusService.create({
    type: "spec",
    title: "Declared Phase Spec",
    content: "## Spec",
    extra: {
      acceptance_criteria: [
        { id: "AC-1", statement: "does the thing", verify: { mode: "script", oracle: "test", command: "bun test" } },
      ],
    },
  } as CreateDocInput);
  if (!spec.ok) throw new Error(`seed spec failed: ${JSON.stringify(spec.error)}`);

  const plan = await corpusService.create({
    type: "plan",
    title: "Declared Phase Plan",
    parent_id: spec.value.id,
    content: "## Plan",
  } as CreateDocInput);
  if (!plan.ok) throw new Error(`seed plan failed: ${JSON.stringify(plan.error)}`);

  return { store, corpusService, service, planId: plan.value.id };
}

async function declarePhases(
  corpusService: CorpusService,
  planId: string,
  names: string[],
): Promise<void> {
  const result = await corpusService.set(planId, { extra: { phases: names.map((name) => ({ name })) } });
  if (!result.ok) throw new Error(`declarePhases failed: ${JSON.stringify(result.error)}`);
}

async function createTaskInPhase(
  corpusService: CorpusService,
  planId: string,
  phaseName: string,
  evidence: Array<{ result: "pass" | "fail" | "expected-fail" | "inconclusive"; ac_ref?: string }> = [],
): Promise<void> {
  const verification_evidence = evidence.map((e, i) => ({
    oracle: "test",
    command: `bun test ${i}`,
    result: e.result,
    recorded_at: "2026-07-26T00:00:00.000Z",
    recorded_by: "agent:t",
    ...(e.ac_ref !== undefined ? { ac_ref: e.ac_ref } : {}),
  }));
  const result = await corpusService.create({
    type: "task",
    title: `Task in ${phaseName}`,
    parent_id: planId,
    content: "## Task",
    extra: { plan_id: planId, phase: phaseName, verification_evidence },
  } as unknown as CreateDocInput);
  if (!result.ok) throw new Error(`seed task failed: ${JSON.stringify(result.error)}`);
}

async function createPhaseDoc(corpusService: CorpusService, planId: string, title: string): Promise<void> {
  const result = await corpusService.create({
    type: "phase",
    title,
    parent_id: planId,
    content: "## Phase",
    extra: { plan_id: planId },
  } as unknown as CreateDocInput);
  if (!result.ok) throw new Error(`seed phase doc failed: ${JSON.stringify(result.error)}`);
}

function isDeclared(entry: PhaseScorecard | DeclaredPhaseScorecard): entry is DeclaredPhaseScorecard {
  return entry.source === "declared";
}

// ─── HAPPY ────────────────────────────────────────────────────────────────

describe("planPhaseStatus — HAPPY: declared-only plan yields declared scorecards with correct rollups", () => {
  it("one declared phase with two tasks reports task_count/evidence/ac_coverage correctly", async () => {
    const { corpusService, service, planId } = await makeFixture();
    await declarePhases(corpusService, planId, ["Backend slice"]);
    await createTaskInPhase(corpusService, planId, "Backend slice", [
      { result: "pass", ac_ref: "AC-1" },
      { result: "fail" },
    ]);
    await createTaskInPhase(corpusService, planId, "Backend slice", [{ result: "pass" }]);

    const result = await service.planPhaseStatus(planId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.phases).toHaveLength(1);

    const entry = result.value.phases[0];
    expect(entry).toBeDefined();
    if (entry === undefined || !isDeclared(entry)) throw new Error("expected a declared scorecard");
    expect(entry.phase_title).toBe("Backend slice");
    expect(entry.orphaned).toBe(false);
    expect(entry.task_count).toBe(2);
    expect(entry.evidence).toEqual({ pass: 2, fail: 1 });
    const acFact = entry.ac_coverage.find((f) => f.ac_id === "AC-1");
    expect(acFact?.pass).toBe(1);
    expect(acFact?.fail).toBe(0);
  });

  it("task-two-more-evidence-consumers-erase-an-expected-fail-row-doc: a declared phase whose ONLY task evidence is expected-fail reports evidence.expected_fail: 1, distinguishable from a phase with zero evidence (which never carries that key at all)", async () => {
    const { corpusService, service, planId } = await makeFixture();
    await declarePhases(corpusService, planId, ["Red Phase", "Empty Phase"]);
    await createTaskInPhase(corpusService, planId, "Red Phase", [{ result: "expected-fail" }]);

    const result = await service.planPhaseStatus(planId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const byTitle = new Map(result.value.phases.map((p) => [p.phase_title, p]));
    const redPhase = byTitle.get("Red Phase");
    const emptyPhase = byTitle.get("Empty Phase");
    if (redPhase === undefined || !isDeclared(redPhase)) throw new Error("expected declared Red Phase");
    if (emptyPhase === undefined || !isDeclared(emptyPhase)) throw new Error("expected declared Empty Phase");

    expect(redPhase.evidence).toEqual({ pass: 0, fail: 0, expected_fail: 1 });
    expect(emptyPhase.evidence).toEqual({ pass: 0, fail: 0 });
    // CONTROL: pairwise distinct, and the distinguishing key's presence is direct.
    expect(redPhase.evidence).not.toEqual(emptyPhase.evidence);
    expect("expected_fail" in redPhase.evidence).toBe(true);
    expect("expected_fail" in emptyPhase.evidence).toBe(false);
  });

  it("multiple declared phases each get their own scorecard, tasks correctly partitioned by name", async () => {
    const { corpusService, service, planId } = await makeFixture();
    await declarePhases(corpusService, planId, ["Phase A", "Phase B"]);
    await createTaskInPhase(corpusService, planId, "Phase A", [{ result: "pass" }]);
    await createTaskInPhase(corpusService, planId, "Phase B", [{ result: "fail" }]);
    await createTaskInPhase(corpusService, planId, "Phase B", [{ result: "fail" }]);

    const result = await service.planPhaseStatus(planId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.phases).toHaveLength(2);

    const byTitle = new Map(result.value.phases.map((p) => [p.phase_title, p]));
    const phaseA = byTitle.get("Phase A");
    const phaseB = byTitle.get("Phase B");
    if (phaseA === undefined || !isDeclared(phaseA)) throw new Error("expected declared Phase A");
    if (phaseB === undefined || !isDeclared(phaseB)) throw new Error("expected declared Phase B");
    expect(phaseA.task_count).toBe(1);
    expect(phaseA.evidence).toEqual({ pass: 1, fail: 0 });
    expect(phaseB.task_count).toBe(2);
    expect(phaseB.evidence).toEqual({ pass: 0, fail: 2 });
  });
});

// ─── NEGATIVE ─────────────────────────────────────────────────────────────

describe("planPhaseStatus — NEGATIVE: a declared name matching a phase-doc title is not double-projected", () => {
  it("yields exactly ONE entry (the phase-doc one) for a name present in both extra.phases[] and a phase doc", async () => {
    const { corpusService, service, planId } = await makeFixture();
    await createPhaseDoc(corpusService, planId, "Shared Name");
    await declarePhases(corpusService, planId, ["Shared Name"]);

    const result = await service.planPhaseStatus(planId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.phases).toHaveLength(1);
    expect(result.value.phases[0]?.source).toBe("phase-doc");
  });
});

// ─── BOUNDARY ─────────────────────────────────────────────────────────────

describe("planPhaseStatus — BOUNDARY: a declared phase with zero tasks is a normal state", () => {
  it("renders task_count: 0 and evidence: {pass:0, fail:0}, not an error", async () => {
    const { corpusService, service, planId } = await makeFixture();
    await declarePhases(corpusService, planId, ["Empty Phase"]);

    const result = await service.planPhaseStatus(planId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.phases).toHaveLength(1);
    const entry = result.value.phases[0];
    if (entry === undefined || !isDeclared(entry)) throw new Error("expected a declared scorecard");
    expect(entry.task_count).toBe(0);
    expect(entry.evidence).toEqual({ pass: 0, fail: 0 });
    expect(entry.orphaned).toBe(false);
  });
});

// ─── ERROR ────────────────────────────────────────────────────────────────

describe("planPhaseStatus — ERROR: an orphaned task-phase reference is surfaced, never dropped", () => {
  it("a task's extra.phase naming neither a declared phase nor a phase-doc title yields orphaned:true", async () => {
    const { corpusService, service, planId } = await makeFixture();
    // Declare, write a task against it, then un-declare — simulating a later
    // `lore phase rm`/rename that leaves the task pointing at a name the plan
    // no longer declares anywhere.
    await declarePhases(corpusService, planId, ["Soon Removed"]);
    await createTaskInPhase(corpusService, planId, "Soon Removed", [{ result: "pass" }]);
    await declarePhases(corpusService, planId, []);

    const result = await service.planPhaseStatus(planId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.phases).toHaveLength(1);
    const entry = result.value.phases[0];
    if (entry === undefined || !isDeclared(entry)) throw new Error("expected a declared scorecard");
    expect(entry.phase_title).toBe("Soon Removed");
    expect(entry.orphaned).toBe(true);
    expect(entry.task_count).toBe(1);
  });
});

// ─── STATE ────────────────────────────────────────────────────────────────

describe("planPhaseStatus — STATE: a mixed plan yields both sources", () => {
  it("one phase-doc phase + one declared-only phase → two entries, correctly tagged", async () => {
    const { corpusService, service, planId } = await makeFixture();
    await createPhaseDoc(corpusService, planId, "Backend slice");
    await declarePhases(corpusService, planId, ["Backend slice", "Frontend slice"]);
    await createTaskInPhase(corpusService, planId, "Frontend slice", [{ result: "pass" }]);

    const result = await service.planPhaseStatus(planId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.phases).toHaveLength(2);

    const byTitle = new Map(result.value.phases.map((p) => [p.phase_title, p]));
    expect(byTitle.get("Backend slice")?.source).toBe("phase-doc");
    expect(byTitle.get("Frontend slice")?.source).toBe("declared");
  });
});

// ─── REGRESSION ───────────────────────────────────────────────────────────

describe("planPhaseStatus — REGRESSION: a phase-doc-only plan is unchanged (only the additive source tag is new)", () => {
  it("a plan with a phase doc and NO extra.phases declared reports exactly one phase-doc entry", async () => {
    const { corpusService, service, planId } = await makeFixture();
    await createPhaseDoc(corpusService, planId, "Only Phase Doc");

    const result = await service.planPhaseStatus(planId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.phases).toHaveLength(1);
    const entry = result.value.phases[0];
    expect(entry?.source).toBe("phase-doc");
    expect(entry?.phase_title).toBe("Only Phase Doc");
  });

  it("a plan with zero phase docs and zero declared phases still returns phases: []", async () => {
    const { service, planId } = await makeFixture();

    const result = await service.planPhaseStatus(planId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.phases).toEqual([]);
  });
});
