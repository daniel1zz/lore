// @layer service-verification-projection
/**
 * Six-dimension tests for VerificationProjectionService (SPEC-075 §Module Boundary
 * D1/D3/D9). Uses InMemoryStore + CorpusService (fixture builder only) — no file I/O,
 * no SQLite. Mirrors `attestation-floor.test.ts`'s harness shape: a task's
 * `extra.verification_evidence` is seeded directly at `CorpusService.create` time
 * (production doesn't gate that field's shape at create time — same fixture style
 * this test suite's sibling already relies on).
 *
 * Dimension mapping:
 *   HAPPY:      task/spec/plan doc_types each assemble their union member via the
 *               ONLY core SSOT fns (computeAcCoverage / buildTaskAttestationInfos /
 *               deriveAttestationSummary) — AC-075-2
 *   NEGATIVE:   unknown id/slug → DOC_NOT_FOUND; every non-evidence doc type (prd,
 *               adr, knowledge, phase) → {doc_type: "other"}
 *   BOUNDARY:   zero evidence / spec-without-ACs / plan-with-zero-tasks explicit
 *               empty states — AC-075-3
 *   ERROR:      a plan with ≥1 phase child and zero task children → VALIDATION_ERROR
 *               (D9 fail-loud) — AC-075-3; the SAME failure propagates through a
 *               spec's aggregate assembly when one of its child plans trips it
 *   STATE:      a task with a mix of ac_ref'd and ac_ref-less evidence yields
 *               DISTINCT (deduplicated) ac_refs, in encounter order
 *   REGRESSION: the constructor's injected minRatio (not a hardcoded 0.5) is what
 *               `deriveAttestationSummary` is evaluated against — a ratio that fails
 *               the default floor passes once minRatio is lowered
 *
 * @spec_ref AC-075-2 AC-075-3
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect } from "vitest";
import { ulid } from "ulidx";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { VerificationProjectionService } from "../../../src/service/verification-projection-service.js";
import { computeAcCoverage, deriveClaimedAcCoverage } from "@lore/core";
import type { AcceptanceCriterion, CreateDocInput, DocRecord, EvidenceEntry } from "@lore/core";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** A self-reported (never attested) evidence entry. */
function selfReportedEntry(command: string, opts: Partial<EvidenceEntry> = {}): EvidenceEntry {
  return {
    oracle: "test",
    command,
    result: "pass",
    recorded_at: "2026-07-24T00:00:00.000Z",
    recorded_by: "agent:t",
    ...opts,
  };
}

/** A runner-issued (attested) evidence entry — SPEC-039 §2 D1 sole-injection shape. */
function attestedEntry(command: string, opts: Partial<EvidenceEntry> = {}): EvidenceEntry {
  return {
    oracle: "test",
    command,
    result: "pass",
    recorded_at: "2026-07-24T00:00:00.000Z",
    recorded_by: "agent:t",
    attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 100, timed_out: false },
    ...opts,
  };
}

function makeHarness() {
  const store = new InMemoryStore();
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const projectionService = new VerificationProjectionService(store, 0.5);
  return { store, corpusService, projectionService };
}

async function mustCreate(cs: CorpusService, input: CreateDocInput): Promise<DocRecord> {
  const result = await cs.create(input);
  if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

async function makePrd(cs: CorpusService): Promise<DocRecord> {
  return mustCreate(cs, { type: "prd", title: "Root PRD", content: "# PRD\n\nroot" } as CreateDocInput);
}

async function makeSpec(
  cs: CorpusService,
  prd: DocRecord,
  criteria: AcceptanceCriterion[] = [],
): Promise<DocRecord> {
  return mustCreate(cs, {
    type: "spec",
    title: "Test Spec",
    content: "## Spec\n\nbody",
    extra: criteria.length > 0 ? { acceptance_criteria: criteria } : {},
  } as CreateDocInput);
}

async function makePlan(cs: CorpusService, parent: DocRecord, extra: Record<string, unknown> = {}): Promise<DocRecord> {
  return mustCreate(cs, {
    type: "plan",
    title: "Test Plan",
    parent_id: parent.id,
    content: "## Plan\n\nbody",
    extra,
  } as CreateDocInput);
}

async function makeTask(
  cs: CorpusService,
  plan: DocRecord,
  title: string,
  evidence: EvidenceEntry[] = [],
): Promise<DocRecord> {
  return mustCreate(cs, {
    type: "task",
    title,
    parent_id: plan.id,
    content: "## Task\n\nbody",
    extra: { plan_id: plan.id, verification_evidence: evidence },
  } as CreateDocInput);
}

/**
 * Like {@link makeTask}, but also declares `extra.ac_scope` — the task-owned
 * declared-scope fact `deriveDeclaredScopeCoverage` reads (task-meets-floor-
 * renders-pass-while-the-declared-scope-conjunct). A task built via plain
 * `makeTask` never sets this key at all (absent, not empty) — that absence is
 * exactly what `findDeclaredAcScope` (`@lore/core`) reports as UNDECLARED.
 */
async function makeTaskWithScope(
  cs: CorpusService,
  plan: DocRecord,
  title: string,
  acScope: string[],
  evidence: EvidenceEntry[] = [],
): Promise<DocRecord> {
  return mustCreate(cs, {
    type: "task",
    title,
    parent_id: plan.id,
    content: "## Task\n\nbody",
    extra: { plan_id: plan.id, ac_scope: acScope, verification_evidence: evidence },
  } as CreateDocInput);
}

/** Raw-inserts a `phase` doc directly (migration-created only, never via CorpusService.create). */
async function makePhase(store: InMemoryStore, plan: DocRecord): Promise<DocRecord> {
  const id = ulid();
  const doc: DocRecord = {
    id,
    slug: `phase-test-${id.slice(-8).toLowerCase()}`,
    type: "phase",
    role: "plan",
    title: "Test Phase",
    status: "draft",
    priority: "medium",
    content: "# Phase",
    parent_id: plan.id,
    created_at: "2026-07-24T00:00:00.000Z",
    updated_at: "2026-07-24T00:00:00.000Z",
    created_by: "system",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: { plan_id: plan.id },
  };
  const result = await store.insert(doc);
  if (!result.ok) throw new Error(`phase insert failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

const AC_1: AcceptanceCriterion = {
  id: "AC-1",
  statement: "system does the thing",
  verify: { mode: "script", oracle: "test", command: "bun test" },
};
const AC_2: AcceptanceCriterion = {
  id: "AC-2",
  statement: "system does the other thing",
  verify: { mode: "script", oracle: "test", command: "bun test" },
};

// ─── HAPPY (AC-075-2): all three unions assemble via core SSOT fns only ──────

describe("VerificationProjectionService — HAPPY (AC-075-2)", () => {
  it("AC-075-2: task doc_type assembles {evidence, ac_refs} straight from extra.verification_evidence", async () => {
    const { corpusService, projectionService } = makeHarness();
    const prd = await makePrd(corpusService);
    const spec = await makeSpec(corpusService, prd, [AC_1]);
    const plan = await makePlan(corpusService, spec);
    const task = await makeTask(corpusService, plan, "Task", [
      selfReportedEntry("bun test", { ac_ref: "AC-1" }),
    ]);

    const result = await projectionService.evidencePanel(task.slug);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.doc_type).toBe("task");
    if (result.value.doc_type !== "task") return;
    expect(result.value.evidence).toHaveLength(1);
    expect(result.value.evidence[0]?.command).toBe("bun test");
    expect(result.value.ac_refs).toEqual(["AC-1"]);
  });

  it("AC-075-2: spec doc_type's coverage is computeAcCoverage's OWN output, aggregated across every child plan's tasks", async () => {
    const { corpusService, projectionService } = makeHarness();
    const prd = await makePrd(corpusService);
    const spec = await makeSpec(corpusService, prd, [AC_1, AC_2]);
    const planA = await makePlan(corpusService, spec);
    const planB = await makePlan(corpusService, spec);
    await makeTask(corpusService, planA, "Task A", [selfReportedEntry("bun test a", { ac_ref: "AC-1" })]);
    await makeTask(corpusService, planB, "Task B", [
      attestedEntry("bun test b", { ac_ref: "AC-1" }),
      selfReportedEntry("bun test c", { ac_ref: "AC-2", result: "fail" }),
    ]);

    const result = await projectionService.evidencePanel(spec.slug);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.doc_type).toBe("spec");
    if (result.value.doc_type !== "spec") return;
    expect(result.value.task_count).toBe(2);
    expect(result.value.criteria).toEqual([AC_1, AC_2]);
    const ac1Fact = result.value.coverage.find((f) => f.ac_id === "AC-1");
    expect(ac1Fact?.pass).toBe(2);
    expect(ac1Fact?.attested_pass).toBe(1);
    const ac2Fact = result.value.coverage.find((f) => f.ac_id === "AC-2");
    expect(ac2Fact?.fail).toBe(1);
  });

  it("AC-075-2: plan doc_type's attestation summary surfaces zero_attested_tasks for a task with evidence but no attestation", async () => {
    const { corpusService, projectionService } = makeHarness();
    const prd = await makePrd(corpusService);
    const spec = await makeSpec(corpusService, prd);
    const plan = await makePlan(corpusService, spec);
    const fabricationRiskTask = await makeTask(corpusService, plan, "Fabrication-risk task", [
      selfReportedEntry("bun test"),
    ]);
    await makeTask(corpusService, plan, "Fully-attested task", [attestedEntry("bun test 2")]);

    const result = await projectionService.evidencePanel(plan.slug);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.doc_type).toBe("plan");
    if (result.value.doc_type !== "plan") return;
    expect(result.value.tasks).toHaveLength(2);
    expect(result.value.attestation.total_evidence).toBe(2);
    expect(result.value.attestation.attested).toBe(1);
    expect(result.value.attestation.zero_attested_tasks).toEqual([fabricationRiskTask.slug]);
    // reason: spec-declared-scope-attestation-contract-task-owned-ac-scope §Facts
    // D5 DEMOTED the per-task zero-attested condition to a reported fact — the
    // panel still SURFACES the offending task (the assertion above, which is what
    // AC-075-2 is about), while `meets_floor` now carries the RATIO conjunct alone
    // and this harness configures no `min_ratio` (unconfigured => the conjunct does
    // not run). Inverted in the same slice that demoted the condition; the plan's
    // gate verdict additionally depends on the DECLARED-scope conjunct, which this
    // projection does not (yet) compute.
    expect(result.value.attestation.meets_floor).toBe(true);
  });
});

// ─── BOUNDARY (AC-075-3): explicit empty states ──────────────────────────────

describe("VerificationProjectionService — BOUNDARY (AC-075-3)", () => {
  it("AC-075-3: a task with zero evidence renders an explicit empty state, not an error", async () => {
    const { corpusService, projectionService } = makeHarness();
    const prd = await makePrd(corpusService);
    const spec = await makeSpec(corpusService, prd);
    const plan = await makePlan(corpusService, spec);
    const task = await makeTask(corpusService, plan, "Never-executed task", []);

    const result = await projectionService.evidencePanel(task.slug);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ doc_type: "task", evidence: [], ac_refs: [] });
  });

  it("AC-075-3: a spec with no declared acceptance_criteria renders {criteria: [], coverage: []}, not an error", async () => {
    const { corpusService, projectionService } = makeHarness();
    const prd = await makePrd(corpusService);
    const spec = await makeSpec(corpusService, prd); // no criteria
    const plan = await makePlan(corpusService, spec);
    await makeTask(corpusService, plan, "Task", [selfReportedEntry("bun test")]);

    const result = await projectionService.evidencePanel(spec.slug);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.doc_type).toBe("spec");
    if (result.value.doc_type !== "spec") return;
    expect(result.value.criteria).toEqual([]);
    expect(result.value.coverage).toEqual([]);
    expect(result.value.task_count).toBe(1);
  });

  it("AC-075-3: a plan with zero tasks renders a vacuous-pass attestation summary (ratio: null), not an error", async () => {
    const { corpusService, projectionService } = makeHarness();
    const prd = await makePrd(corpusService);
    const spec = await makeSpec(corpusService, prd);
    const plan = await makePlan(corpusService, spec);

    const result = await projectionService.evidencePanel(plan.slug);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      doc_type: "plan",
      tasks: [],
      attestation: {
        total_evidence: 0,
        attested: 0,
        ratio: null,
        min_ratio: 0.5,
        claimed_ac_coverage: { exercised_acs: [], unattested_acs: [], meets_coverage: true },
        meets_floor: true,
        zero_attested_tasks: [],
      },
      // reason: task-meets-floor-renders-pass-while-the-declared-scope-conjunct
      // — a plan with zero tasks has nothing to declare, so the declared-scope
      // fact is vacuously satisfied (`scope_undeclared: false`, no evidence-
      // bearing task exists to have left it undeclared) and the verdict is a
      // resolved pass, not the `notApplicable` sentinel (that sentinel is for
      // an UNRESOLVED caller, `UNRESOLVED_DECLARED_SCOPE` — this projection
      // always resolves the fact from the plan's own tasks).
      declared_scope_coverage: { declared_acs: [], unattested_acs: [], scope_undeclared: false, meets_coverage: true },
      declared_scope_verdict: { ok: true },
    });
  });

  it("AC-075-3 (D9): a plan with ≥1 phase child and zero task children returns fail-loud VALIDATION_ERROR", async () => {
    const { corpusService, projectionService, store } = makeHarness();
    const prd = await makePrd(corpusService);
    const spec = await makeSpec(corpusService, prd);
    const plan = await makePlan(corpusService, spec);
    await makePhase(store, plan);

    const result = await projectionService.evidencePanel(plan.slug);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    const message = (result.error as { message?: string }).message ?? "";
    expect(message).toContain(plan.id);
    expect(message).toContain("phase");
  });
});

// ─── NEGATIVE ─────────────────────────────────────────────────────────────────

describe("VerificationProjectionService — NEGATIVE", () => {
  it("an unresolvable id/slug returns DOC_NOT_FOUND", async () => {
    const { projectionService } = makeHarness();

    const result = await projectionService.evidencePanel("does-not-exist-at-all");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("DOC_NOT_FOUND");
  });

  it("a prd/adr/knowledge/phase doc projects as {doc_type: 'other'} — no evidence surface", async () => {
    const { corpusService, projectionService, store } = makeHarness();
    const prd = await makePrd(corpusService);
    const adr = await mustCreate(corpusService, {
      type: "adr",
      title: "Test ADR",
      parent_id: prd.id,
      content: "## ADR",
      extra: { decision_status: "accepted" },
    } as CreateDocInput);
    const knowledge = await mustCreate(corpusService, {
      type: "knowledge",
      title: "Test Knowledge",
      parent_id: prd.id,
      content: "## Knowledge",
      extra: { sub_type: "reference" },
    } as CreateDocInput);
    const spec = await makeSpec(corpusService, prd);
    const plan = await makePlan(corpusService, spec);
    const phase = await makePhase(store, plan);

    for (const doc of [prd, adr, knowledge, phase]) {
      const result = await projectionService.evidencePanel(doc.slug);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.value).toEqual({ doc_type: "other" });
    }
  });
});

// ─── ERROR: D9 propagates through nested (spec → plan) assembly ─────────────

describe("VerificationProjectionService — ERROR: D9 propagates through spec assembly", () => {
  it("a spec whose child plan has phase-children-without-tasks fails the WHOLE spec assembly, not just that plan", async () => {
    const { corpusService, projectionService, store } = makeHarness();
    const prd = await makePrd(corpusService);
    const spec = await makeSpec(corpusService, prd, [AC_1]);
    const healthyPlan = await makePlan(corpusService, spec);
    await makeTask(corpusService, healthyPlan, "Healthy task", [selfReportedEntry("bun test", { ac_ref: "AC-1" })]);
    const migratedPlan = await makePlan(corpusService, spec);
    await makePhase(store, migratedPlan);

    const result = await projectionService.evidencePanel(spec.slug);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });
});

// ─── STATE: distinct ac_refs, encounter order ────────────────────────────────

describe("VerificationProjectionService — STATE: distinct ac_refs", () => {
  it("a task's ac_refs are deduplicated and exclude entries with no ac_ref at all", async () => {
    const { corpusService, projectionService } = makeHarness();
    const prd = await makePrd(corpusService);
    const spec = await makeSpec(corpusService, prd);
    const plan = await makePlan(corpusService, spec);
    const task = await makeTask(corpusService, plan, "Task", [
      selfReportedEntry("bun test 1", { ac_ref: "AC-1" }),
      selfReportedEntry("bun test 2"), // no ac_ref — excluded
      attestedEntry("bun test 3", { ac_ref: "AC-1" }), // duplicate AC-1 — deduped
      selfReportedEntry("bun test 4", { ac_ref: "AC-2" }),
    ]);

    const result = await projectionService.evidencePanel(task.slug);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.value.doc_type !== "task") throw new Error("expected task doc_type");
    expect(result.value.ac_refs).toEqual(["AC-1", "AC-2"]);
    expect(result.value.evidence).toHaveLength(4);
  });
});

// ─── REGRESSION: constructor-injected minRatio, never a hardcoded default ────

describe("VerificationProjectionService — REGRESSION: constructor minRatio is honored", () => {
  it("a plan-wide ratio of 0.4 fails a service constructed with the default 0.5 floor but passes one constructed with 0.3", async () => {
    const { corpusService, store } = makeHarness();
    const prd = await makePrd(corpusService);
    const spec = await makeSpec(corpusService, prd);
    const plan = await makePlan(corpusService, spec);
    // 2 attested / 5 total = 0.4 ratio; every task individually has >=1 attested entry
    // (so only the ratio condition, never the per-task zero-attested condition, is in play).
    await makeTask(corpusService, plan, "Task A", [
      attestedEntry("bun test a"),
      selfReportedEntry("bun test a2"),
      selfReportedEntry("bun test a3"),
      selfReportedEntry("bun test a4"),
    ]);
    await makeTask(corpusService, plan, "Task B", [attestedEntry("bun test b")]);

    const strictService = new VerificationProjectionService(store, 0.5);
    const lenientService = new VerificationProjectionService(store, 0.3);

    const strictResult = await strictService.evidencePanel(plan.slug);
    const lenientResult = await lenientService.evidencePanel(plan.slug);

    expect(strictResult.ok).toBe(true);
    expect(lenientResult.ok).toBe(true);
    if (!strictResult.ok || !lenientResult.ok) return;
    if (strictResult.value.doc_type !== "plan" || lenientResult.value.doc_type !== "plan") {
      throw new Error("expected plan doc_type");
    }
    expect(strictResult.value.attestation.meets_floor).toBe(false);
    expect(lenientResult.value.attestation.meets_floor).toBe(true);
  });
});

// ─── AC-PCI-13: ratio disabled render — null min_ratio passes through ───────
// ─── verbatim, and claimed_ac_coverage equals the gate's own facts ──────────

describe("VerificationProjectionService — AC-PCI-13: ratio disabled render", () => {
  it("AC-PCI-13 ratio disabled render: a service constructed with null min_ratio renders it verbatim (never coerced to 0/0.5), and the plan panel's claimed_ac_coverage equals deriveClaimedAcCoverage(computeAcCoverage(...)) over the same fixture", async () => {
    const { corpusService, store } = makeHarness();
    const prd = await makePrd(corpusService);
    const spec = await makeSpec(corpusService, prd, [AC_1]);
    const plan = await makePlan(corpusService, spec);
    const task = await makeTask(corpusService, plan, "Task", [
      selfReportedEntry("bun test", { ac_ref: "AC-1" }),
    ]);

    const disabledService = new VerificationProjectionService(store, null);
    const result = await disabledService.evidencePanel(plan.slug);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.value.doc_type !== "plan") throw new Error("expected plan doc_type");
    expect(result.value.attestation.min_ratio).toBeNull();

    const expectedCoverage = deriveClaimedAcCoverage(computeAcCoverage([AC_1], [task]));
    expect(result.value.attestation.claimed_ac_coverage).toEqual(expectedCoverage);
    // AC-1 was claimed (>=1 ref) but the only ref is self-reported — unattested.
    expect(result.value.attestation.claimed_ac_coverage.unattested_acs).toEqual(["AC-1"]);
  });
});

// ─── task-meets-floor-renders-pass-while-the-declared-scope-conjunct: the ───
// ─── `plan` branch surfaces the DECLARED-scope conjunct (fact + verdict), ───
// ─── computed via the SAME core fns `CorpusService.set`'s plan-close gate ───
// ─── wiring feeds `attestationFloor`, so the dashboard badge and the gate ───
// ─── can never disagree ──────────────────────────────────────────────────────

describe("VerificationProjectionService — declared-scope conjunct (task-meets-floor-renders-pass-while-the-declared-scope-conjunct)", () => {
  it("HAPPY: a task that declares AC-1 and is fully attested resolves declared_scope_verdict to {ok: true}", async () => {
    const { corpusService, projectionService } = makeHarness();
    const prd = await makePrd(corpusService);
    const spec = await makeSpec(corpusService, prd, [AC_1]);
    const plan = await makePlan(corpusService, spec);
    await makeTaskWithScope(corpusService, plan, "Task", ["AC-1"], [
      attestedEntry("bun test", { ac_ref: "AC-1" }),
    ]);

    const result = await projectionService.evidencePanel(plan.slug);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.value.doc_type !== "plan") throw new Error("expected plan doc_type");
    expect(result.value.declared_scope_coverage).toEqual({
      declared_acs: ["AC-1"],
      unattested_acs: [],
      scope_undeclared: false,
      meets_coverage: true,
    });
    expect(result.value.declared_scope_verdict).toEqual({ ok: true });
    // control: a genuinely-passing plan still reports the ratio conjunct as met too —
    // proving this fixture is not "everything renders as failing now".
    expect(result.value.attestation.meets_floor).toBe(true);
  });

  it("NEGATIVE (the oracle fixture, mirrors AC-VS-6): an evidence-bearing task with NO declared ac_scope resolves declared_scope_verdict to the notApplicable(scope-undeclared) verdict, even though the ratio conjunct alone passes", async () => {
    const { corpusService, projectionService } = makeHarness();
    const prd = await makePrd(corpusService);
    const spec = await makeSpec(corpusService, prd, [AC_1]);
    const plan = await makePlan(corpusService, spec);
    // makeTask (not makeTaskWithScope) — extra.ac_scope is ABSENT, not empty.
    await makeTask(corpusService, plan, "Task", [attestedEntry("bun test", { ac_ref: "AC-1" })]);

    const result = await projectionService.evidencePanel(plan.slug);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.value.doc_type !== "plan") throw new Error("expected plan doc_type");
    // The RATIO conjunct alone passes (full attestation) — this is exactly the
    // defect fixture: `meets_floor` is true while the declared-scope conjunct
    // has nothing to audit at all.
    expect(result.value.attestation.meets_floor).toBe(true);
    expect(result.value.declared_scope_coverage.scope_undeclared).toBe(true);
    expect(result.value.declared_scope_coverage.declared_acs).toEqual([]);
    expect(result.value.declared_scope_verdict).toEqual({
      notApplicable: true,
      reason: "scope-undeclared",
      referent: plan.slug,
    });
  });

  it("BOUNDARY: a task that declares AC-1 but never attests it resolves declared_scope_verdict to {ok: false, unattested_acs: ['AC-1']}", async () => {
    const { corpusService, projectionService } = makeHarness();
    const prd = await makePrd(corpusService);
    const spec = await makeSpec(corpusService, prd, [AC_1]);
    const plan = await makePlan(corpusService, spec);
    await makeTaskWithScope(corpusService, plan, "Task", ["AC-1"], [
      selfReportedEntry("bun test", { ac_ref: "AC-1" }),
    ]);

    const result = await projectionService.evidencePanel(plan.slug);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.value.doc_type !== "plan") throw new Error("expected plan doc_type");
    expect(result.value.declared_scope_coverage.declared_acs).toEqual(["AC-1"]);
    expect(result.value.declared_scope_verdict).toEqual({ ok: false, unattested_acs: ["AC-1"] });
  });
});
