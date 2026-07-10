/**
 * Tests for @lore/core assessment.ts computeAssessmentFacts (SPEC-040 D1). Pure function,
 * no IO. Spec-first: assertions come from SPEC-040 §T1 D1 and AC-ADF-10 — not from
 * reading the implementation body first.
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      full bundle (plan + spec + tasks with mixed evidence) produces every
 *               facts sub-object correctly, reusing computeAcCoverage verbatim
 *   NEGATIVE:   malformed extra.ac_scope (non-array, non-string entries) degrades to []
 *               rather than throwing; missing knowledge_links reports "unavailable" not "0 known"
 *   BOUNDARY:   empty tasks array; empty declaredCriteria; diffMeta omitted entirely;
 *               ac_scope entries matching zero declared criteria (all dangling)
 *   ERROR:      n/a at this layer — computeAssessmentFacts never throws (asserted directly)
 *   STATE:      attested vs self-reported evidence counts accumulate correctly per task
 *               and in the aggregate attested_evidence_ratio
 *   REGRESSION: coverage counts are computed from the FULL bundle, independent of any
 *               prompt-truncation concept (this module never truncates the bundle itself)
 *
 * @spec_ref AC-ADF-10
 */

import { describe, it, expect } from "vitest";
import { computeAssessmentFacts, type DiffMeta, type PlanBundle } from "../src/assessment.js";
import type { AcceptanceCriterion } from "../src/acceptance.js";
import type { DocId, DocRecord } from "../src/types.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

let _seq = 0;

function nextId(prefix: string): DocId {
  _seq += 1;
  return `01H${prefix}${String(_seq).padStart(20 - prefix.length, "0")}`;
}

function makePlan(overrides: Partial<DocRecord> = {}): DocRecord {
  const id = nextId("PLAN");
  return {
    id,
    slug: `plan-fixture-${id.slice(-4)}`,
    type: "plan",
    role: "plan",
    title: `Plan ${id}`,
    status: "active",
    priority: "medium",
    content: "Plan body",
    parent_id: null,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    created_by: "alice",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
    ...overrides,
  } as DocRecord;
}

function makeSpec(overrides: Partial<DocRecord> = {}): DocRecord {
  const id = nextId("SPEC");
  return {
    id,
    slug: `spec-fixture-${id.slice(-4)}`,
    type: "spec",
    role: "spec",
    title: `Spec ${id}`,
    status: "approved",
    priority: "medium",
    content: "Spec body",
    parent_id: null,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    created_by: "alice",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
    ...overrides,
  } as DocRecord;
}

function makeTask(overrides: Partial<DocRecord> = {}): DocRecord {
  const id = nextId("TASK");
  return {
    id,
    slug: `task-fixture-${id.slice(-4)}`,
    type: "task",
    role: "plan",
    title: `Task ${id}`,
    status: "draft",
    priority: "medium",
    content: "Task body",
    parent_id: "01HPLANAAAAAAAAAAAAAAAAAAA",
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    created_by: "alice",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: { plan_id: "01HPLANAAAAAAAAAAAAAAAAAAA" },
    ...overrides,
  } as DocRecord;
}

function scriptAc(id: string): AcceptanceCriterion {
  return {
    id,
    statement: `Statement for ${id}`,
    verify: { mode: "script", oracle: "test", command: "bun test" },
  };
}

function selfReportedEvidence(overrides: Record<string, unknown> = {}) {
  return {
    oracle: "test",
    command: "bun test",
    result: "pass",
    recorded_at: "2026-07-02T00:00:00.000Z",
    recorded_by: "alice",
    ...overrides,
  };
}

function attestedEvidence(overrides: Record<string, unknown> = {}) {
  return {
    ...selfReportedEvidence(),
    attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 100, timed_out: false },
    ...overrides,
  };
}

// ─── HAPPY ─────────────────────────────────────────────────────────────────

describe("computeAssessmentFacts — HAPPY (full bundle)", () => {
  it("produces AC coverage identical to computeAcCoverage's direct output", () => {
    const plan = makePlan();
    const spec = makeSpec();
    const criteria = [scriptAc("AC-1"), scriptAc("AC-2")];
    const task = makeTask({
      extra: { plan_id: plan.id, verification_evidence: [attestedEvidence({ ac_ref: "AC-1" })] },
    });
    const bundle: PlanBundle = { plan, spec, tasks: [task] };

    const facts = computeAssessmentFacts(bundle, criteria);

    expect(facts.ac_coverage).toHaveLength(2);
    const ac1 = facts.ac_coverage.find((c) => c.ac_id === "AC-1");
    expect(ac1?.pass).toBe(1);
    expect(ac1?.attested_pass).toBe(1);
    const ac2 = facts.ac_coverage.find((c) => c.ac_id === "AC-2");
    expect(ac2?.pass).toBe(0);
  });

  it("per-task evidence completeness reports has_evidence, unique oracle_kinds, and attested/self-reported split", () => {
    const plan = makePlan();
    const task = makeTask({
      extra: {
        plan_id: plan.id,
        verification_evidence: [
          attestedEvidence({ oracle: "test" }),
          selfReportedEvidence({ oracle: "test" }),
          selfReportedEvidence({ oracle: "tsc" }),
        ],
      },
    });
    const bundle: PlanBundle = { plan, tasks: [task] };

    const facts = computeAssessmentFacts(bundle, []);

    expect(facts.task_evidence).toHaveLength(1);
    const entry = facts.task_evidence[0]!;
    expect(entry.task_id).toBe(task.id);
    expect(entry.has_evidence).toBe(true);
    expect([...entry.oracle_kinds].sort()).toEqual(["test", "tsc"]);
    expect(entry.attested_count).toBe(1);
    expect(entry.self_reported_count).toBe(2);
  });

  it("scope facts compare plan.extra.ac_scope against the declared criteria set, reporting dangling ids", () => {
    const plan = makePlan({ extra: { ac_scope: ["AC-1", "AC-2", "AC-NOT-DECLARED"] } });
    const spec = makeSpec();
    const criteria = [scriptAc("AC-1"), scriptAc("AC-2")];
    const bundle: PlanBundle = { plan, spec, tasks: [] };

    const facts = computeAssessmentFacts(bundle, criteria);

    expect(facts.scope).toBeDefined();
    expect(facts.scope?.declared_ids).toEqual(["AC-1", "AC-2"]);
    expect(facts.scope?.scoped_ids).toEqual(["AC-1", "AC-2", "AC-NOT-DECLARED"]);
    expect(facts.scope?.dangling).toEqual(["AC-NOT-DECLARED"]);
  });

  it("knowledge_capture reports count and unique sub_types from bundle.knowledge_links, source 'bundle'", () => {
    const plan = makePlan();
    const bundle: PlanBundle = {
      plan,
      tasks: [],
      knowledge_links: [
        { slug: "knowledge-retro-1", sub_type: "retro", title: "Retro 1" },
        { slug: "knowledge-retro-2", sub_type: "retro", title: "Retro 2" },
        { slug: "knowledge-research-1", sub_type: "research", title: "Research 1" },
      ],
    };

    const facts = computeAssessmentFacts(bundle, []);

    expect(facts.knowledge_capture.count).toBe(3);
    expect([...facts.knowledge_capture.sub_types].sort()).toEqual(["research", "retro"]);
    expect(facts.knowledge_capture.source).toBe("bundle");
  });

  it("regression facts report tests_touched true and diff_available true when diffMeta has test_files", () => {
    const plan = makePlan();
    const bundle: PlanBundle = { plan, tasks: [] };
    const diffMeta: DiffMeta = {
      source_files: ["src/foo.ts"],
      test_files: ["src/foo.test.ts"],
      other_files: [],
    };

    const facts = computeAssessmentFacts(bundle, [], diffMeta);

    expect(facts.regression.diff_available).toBe(true);
    expect(facts.regression.tests_touched).toBe(true);
  });

  it("attested_evidence_ratio is the attested/total evidence fraction across all tasks", () => {
    const plan = makePlan();
    const taskA = makeTask({ extra: { plan_id: plan.id, verification_evidence: [attestedEvidence()] } });
    const taskB = makeTask({
      extra: { plan_id: plan.id, verification_evidence: [selfReportedEvidence(), selfReportedEvidence()] },
    });
    const bundle: PlanBundle = { plan, tasks: [taskA, taskB] };

    const facts = computeAssessmentFacts(bundle, []);

    // 1 attested / 3 total = 0.333...
    expect(facts.regression.attested_evidence_ratio).toBeCloseTo(1 / 3, 5);
  });
});

// ─── NEGATIVE ──────────────────────────────────────────────────────────────

describe("computeAssessmentFacts — NEGATIVE (malformed/absent inputs never throw)", () => {
  it("plan.extra.ac_scope that is not an array degrades to an empty scoped_ids list, never throws", () => {
    const plan = makePlan({ extra: { ac_scope: "not-an-array" } });
    const spec = makeSpec();
    const bundle: PlanBundle = { plan, spec, tasks: [] };

    expect(() => computeAssessmentFacts(bundle, [scriptAc("AC-1")])).not.toThrow();
    const facts = computeAssessmentFacts(bundle, [scriptAc("AC-1")]);
    expect(facts.scope?.scoped_ids).toEqual([]);
  });

  it("plan.extra.ac_scope containing non-string entries filters them out, never throws", () => {
    const plan = makePlan({ extra: { ac_scope: ["AC-1", 42, null, { nested: true }, "AC-2"] } });
    const spec = makeSpec();
    const bundle: PlanBundle = { plan, spec, tasks: [] };

    const facts = computeAssessmentFacts(bundle, [scriptAc("AC-1")]);
    expect(facts.scope?.scoped_ids).toEqual(["AC-1", "AC-2"]);
  });

  it("plan.extra that is null/non-object degrades ac_scope to [], never throws", () => {
    const plan = makePlan({ extra: null as unknown as Record<string, unknown> });
    const spec = makeSpec();
    const bundle: PlanBundle = { plan, spec, tasks: [] };

    expect(() => computeAssessmentFacts(bundle, [])).not.toThrow();
    expect(computeAssessmentFacts(bundle, []).scope?.scoped_ids).toEqual([]);
  });

  it("absent knowledge_links reports source 'unavailable' with count 0 — never conflated with a genuine zero", () => {
    const plan = makePlan();
    const bundle: PlanBundle = { plan, tasks: [] };

    const facts = computeAssessmentFacts(bundle, []);

    expect(facts.knowledge_capture.source).toBe("unavailable");
    expect(facts.knowledge_capture.count).toBe(0);
    expect(facts.knowledge_capture.sub_types).toEqual([]);
  });

  it("a task with malformed verification_evidence (non-array) degrades to has_evidence: false, never throws", () => {
    const plan = makePlan();
    const task = makeTask({ extra: { plan_id: plan.id, verification_evidence: "not-an-array" } });
    const bundle: PlanBundle = { plan, tasks: [task] };

    expect(() => computeAssessmentFacts(bundle, [])).not.toThrow();
    const facts = computeAssessmentFacts(bundle, []);
    expect(facts.task_evidence[0]?.has_evidence).toBe(false);
  });
});

// ─── BOUNDARY ──────────────────────────────────────────────────────────────

describe("computeAssessmentFacts — BOUNDARY", () => {
  it("a spec-less bundle (bundle.spec undefined) yields scope explicitly absent, no throw (AC-ADF-10)", () => {
    const plan = makePlan();
    const bundle: PlanBundle = { plan, tasks: [] };

    expect(() => computeAssessmentFacts(bundle, [])).not.toThrow();
    const facts = computeAssessmentFacts(bundle, []);
    expect(facts.scope).toBeUndefined();
    expect("scope" in facts).toBe(false);
  });

  it("empty tasks array yields an empty task_evidence array and zero-valued ac_coverage rows, not an omission", () => {
    const plan = makePlan();
    const spec = makeSpec();
    const bundle: PlanBundle = { plan, spec, tasks: [] };

    const facts = computeAssessmentFacts(bundle, [scriptAc("AC-1")]);

    expect(facts.task_evidence).toEqual([]);
    expect(facts.ac_coverage).toHaveLength(1);
    expect(facts.ac_coverage[0]).toMatchObject({ pass: 0, fail: 0, attested_pass: 0, attested_fail: 0 });
  });

  it("empty declaredCriteria yields an empty ac_coverage array, and (when spec present) an empty declared_ids scope", () => {
    const plan = makePlan({ extra: { ac_scope: ["AC-DANGLING"] } });
    const spec = makeSpec();
    const bundle: PlanBundle = { plan, spec, tasks: [] };

    const facts = computeAssessmentFacts(bundle, []);

    expect(facts.ac_coverage).toEqual([]);
    expect(facts.scope?.declared_ids).toEqual([]);
    expect(facts.scope?.dangling).toEqual(["AC-DANGLING"]);
  });

  it("diffMeta omitted entirely (undefined) yields diff_available false and tests_touched false", () => {
    const plan = makePlan();
    const bundle: PlanBundle = { plan, tasks: [] };

    const facts = computeAssessmentFacts(bundle, []);

    expect(facts.regression.diff_available).toBe(false);
    expect(facts.regression.tests_touched).toBe(false);
  });

  it("diffMeta present but test_files empty yields tests_touched false while diff_available stays true", () => {
    const plan = makePlan();
    const bundle: PlanBundle = { plan, tasks: [] };
    const diffMeta: DiffMeta = { source_files: ["src/foo.ts"], test_files: [], other_files: [] };

    const facts = computeAssessmentFacts(bundle, [], diffMeta);

    expect(facts.regression.diff_available).toBe(true);
    expect(facts.regression.tests_touched).toBe(false);
  });

  it("zero total evidence across all tasks yields attested_evidence_ratio 0, never NaN", () => {
    const plan = makePlan();
    const task = makeTask({ extra: { plan_id: plan.id } });
    const bundle: PlanBundle = { plan, tasks: [task] };

    const facts = computeAssessmentFacts(bundle, []);

    expect(facts.regression.attested_evidence_ratio).toBe(0);
    expect(Number.isNaN(facts.regression.attested_evidence_ratio)).toBe(false);
  });

  it("ac_scope entries that match ZERO declared criteria are ALL reported as dangling", () => {
    const plan = makePlan({ extra: { ac_scope: ["AC-X", "AC-Y"] } });
    const spec = makeSpec();
    const bundle: PlanBundle = { plan, spec, tasks: [] };

    const facts = computeAssessmentFacts(bundle, [scriptAc("AC-UNRELATED")]);

    expect(facts.scope?.dangling).toEqual(["AC-X", "AC-Y"]);
  });

  it("plan.extra.ac_scope entirely absent (no key at all) yields an empty scoped_ids, not a throw", () => {
    const plan = makePlan();
    const spec = makeSpec();
    const bundle: PlanBundle = { plan, spec, tasks: [] };

    const facts = computeAssessmentFacts(bundle, [scriptAc("AC-1")]);
    expect(facts.scope?.scoped_ids).toEqual([]);
    expect(facts.scope?.dangling).toEqual([]);
  });
});

// ─── STATE ─────────────────────────────────────────────────────────────────

describe("computeAssessmentFacts — STATE (multi-task accumulation)", () => {
  it("attested and self-reported counts accumulate independently per task across a multi-task bundle", () => {
    const plan = makePlan();
    const taskAllAttested = makeTask({
      extra: { plan_id: plan.id, verification_evidence: [attestedEvidence(), attestedEvidence()] },
    });
    const taskAllSelfReported = makeTask({
      extra: { plan_id: plan.id, verification_evidence: [selfReportedEvidence()] },
    });
    const taskNoEvidence = makeTask({ extra: { plan_id: plan.id } });
    const bundle: PlanBundle = { plan, tasks: [taskAllAttested, taskAllSelfReported, taskNoEvidence] };

    const facts = computeAssessmentFacts(bundle, []);

    expect(facts.task_evidence).toHaveLength(3);
    expect(facts.task_evidence[0]).toMatchObject({ attested_count: 2, self_reported_count: 0, has_evidence: true });
    expect(facts.task_evidence[1]).toMatchObject({ attested_count: 0, self_reported_count: 1, has_evidence: true });
    expect(facts.task_evidence[2]).toMatchObject({ attested_count: 0, self_reported_count: 0, has_evidence: false });
  });
});

// ─── REGRESSION ────────────────────────────────────────────────────────────

describe("computeAssessmentFacts — REGRESSION (facts computed from the full bundle, independent of prompt truncation, AC-ADF-10)", () => {
  it("coverage counts reflect ALL evidence entries on a task even when the task's content is far longer than any prompt char budget", () => {
    // computeAssessmentFacts operates on the raw DocRecord/evidence array — it has no
    // concept of "prompt truncation" at all (that only exists in the prompt-builder,
    // a different module). A task whose `content` would be truncated in a judge prompt
    // must still contribute its FULL evidence set to the facts.
    const plan = makePlan();
    const spec = makeSpec();
    const criteria = [scriptAc("AC-1")];
    const longContentTask = makeTask({
      content: "x".repeat(50_000), // far over any ai.assess.max_task_chars budget
      extra: {
        plan_id: plan.id,
        verification_evidence: [
          attestedEvidence({ ac_ref: "AC-1" }),
          attestedEvidence({ ac_ref: "AC-1" }),
          selfReportedEvidence({ ac_ref: "AC-1", result: "fail" }),
        ],
      },
    });
    const bundle: PlanBundle = { plan, spec, tasks: [longContentTask] };

    const facts = computeAssessmentFacts(bundle, criteria);

    const ac1 = facts.ac_coverage.find((c) => c.ac_id === "AC-1");
    expect(ac1?.pass).toBe(2);
    expect(ac1?.attested_pass).toBe(2);
    expect(ac1?.fail).toBe(1);
    expect(facts.task_evidence[0]?.attested_count).toBe(2);
    expect(facts.task_evidence[0]?.self_reported_count).toBe(1);
  });

  it("computeAssessmentFacts never throws across every fixture combination exercised in this file", () => {
    const plan = makePlan();
    const spec = makeSpec();
    const task = makeTask({ extra: { plan_id: plan.id, verification_evidence: [attestedEvidence()] } });
    const bundle: PlanBundle = { plan, spec, tasks: [task], knowledge_links: [] };
    const diffMeta: DiffMeta = { source_files: [], test_files: [], other_files: [] };

    expect(() => computeAssessmentFacts(bundle, [scriptAc("AC-1")], diffMeta)).not.toThrow();
  });
});
