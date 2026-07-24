/**
 * Tests for @lore/core evidence-panel — buildTaskAttestationInfos,
 * deriveAttestationSummary, EvidencePanelProjection, summarizeForAdjudicationBar.
 * Pure functions, no IO.
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      buildTaskAttestationInfos derives evidenceCount/attestedCount per
 *               task; deriveAttestationSummary aggregates a mixed fully-attested
 *               set to meets_floor:true; summarizeForAdjudicationBar reduces every
 *               EvidencePanelProjection branch to the expected chip summary
 *   NEGATIVE:   a task with malformed extra.verification_evidence (non-array) does
 *               not throw and contributes zero counts (extractEvidence's own
 *               fail-closed behavior); a zero-attested task blocks even when the
 *               plan-wide ratio alone would pass (AC-075-11 condition 1)
 *   BOUNDARY:   empty tasks array; ratio exactly equal to minRatio passes
 *               (AC-075-11 condition 2 boundary, `>=` not `>`); a single task with
 *               zero evidence entries
 *   ERROR:      n/a beyond the malformed-input NEGATIVE case above — every public
 *               function here is total (never throws) by construction
 *   STATE:      zero_attested_tasks accumulates every offending task's slug (not
 *               just the first); a below-floor ratio blocks even when EVERY task
 *               individually carries >=1 attested entry (AC-075-11 condition 2
 *               tested independently of condition 1)
 *   REGRESSION: deriveAttestationSummary's vacuous-pass branch (total_evidence===0)
 *               yields ratio:null (never a fabricated 0) and meets_floor:true,
 *               matching gate-predicates.ts::attestationFloor's pre-delegation
 *               early-return behavior
 *
 * @spec_ref SPEC-075 §Design Decisions D2, D6, D10; AC-075-11 (parity with
 *   gate-predicates.ts::attestationFloor, both condition classes)
 */

import { describe, it, expect } from "vitest";
import {
  buildTaskAttestationInfos,
  deriveAttestationSummary,
  summarizeForAdjudicationBar,
  type AttestationSummary,
  type EvidencePanelProjection,
  type TaskAttestationInfo,
} from "./evidence-panel.js";
import type { AcCoverageFact, AcceptanceCriterion } from "./acceptance.js";
import type { EvidenceEntry } from "./task-workflow.js";
import type { DocId, DocRecord } from "./types.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

let _seq = 0;

function nextId(): DocId {
  _seq += 1;
  return `01HTASK${String(_seq).padStart(19, "0")}`;
}

function makeTask(overrides: Partial<DocRecord> = {}): DocRecord {
  const id = nextId();
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

function selfReportedEntry(command: string): EvidenceEntry {
  return {
    oracle: "test",
    command,
    result: "pass",
    recorded_at: "2026-07-23T00:00:00.000Z",
    recorded_by: "agent:t",
  };
}

function attestedEntry(command: string, result: "pass" | "fail" = "pass"): EvidenceEntry {
  return {
    oracle: "test",
    command,
    result,
    recorded_at: "2026-07-23T00:00:00.000Z",
    recorded_by: "agent:t",
    attestation: { runner: "lore-cli", exit_code: result === "pass" ? 0 : 1, duration_ms: 100, timed_out: false },
  };
}

function taskInfo(overrides: Partial<TaskAttestationInfo>): TaskAttestationInfo {
  return { slug: "task-x", title: "Task X", evidenceCount: 0, attestedCount: 0, ...overrides };
}

// ─── buildTaskAttestationInfos ───────────────────────────────────────────────

describe("buildTaskAttestationInfos", () => {
  it("HAPPY: derives evidenceCount/attestedCount per task from extra.verification_evidence", () => {
    const taskA = makeTask({
      slug: "task-a",
      title: "Task A",
      extra: {
        plan_id: "p",
        verification_evidence: [attestedEntry("bun test a"), selfReportedEntry("bun test a2")],
      },
    });
    const taskB = makeTask({
      slug: "task-b",
      title: "Task B",
      extra: { plan_id: "p", verification_evidence: [attestedEntry("bun test b")] },
    });

    const infos = buildTaskAttestationInfos([taskA, taskB]);

    expect(infos).toEqual([
      { slug: "task-a", title: "Task A", evidenceCount: 2, attestedCount: 1 },
      { slug: "task-b", title: "Task B", evidenceCount: 1, attestedCount: 1 },
    ]);
  });

  it("BOUNDARY: an empty tasks array yields an empty result", () => {
    expect(buildTaskAttestationInfos([])).toEqual([]);
  });

  it("BOUNDARY: a task with zero evidence entries yields evidenceCount:0, attestedCount:0", () => {
    const task = makeTask({ slug: "task-empty", extra: { plan_id: "p", verification_evidence: [] } });
    expect(buildTaskAttestationInfos([task])).toEqual([
      { slug: "task-empty", title: task.title, evidenceCount: 0, attestedCount: 0 },
    ]);
  });

  it("NEGATIVE: malformed (non-array) extra.verification_evidence does not throw, contributes zero counts", () => {
    const task = makeTask({ slug: "task-malformed", extra: { plan_id: "p", verification_evidence: "not-an-array" } });
    expect(() => buildTaskAttestationInfos([task])).not.toThrow();
    expect(buildTaskAttestationInfos([task])).toEqual([
      { slug: "task-malformed", title: task.title, evidenceCount: 0, attestedCount: 0 },
    ]);
  });

  it("STATE: preserves input order across multiple tasks with independent counts", () => {
    const tasks = [
      makeTask({ slug: "t1", extra: { plan_id: "p", verification_evidence: [selfReportedEntry("a")] } }),
      makeTask({ slug: "t2", extra: { plan_id: "p", verification_evidence: [] } }),
      makeTask({
        slug: "t3",
        extra: { plan_id: "p", verification_evidence: [attestedEntry("b"), attestedEntry("c")] },
      }),
    ];
    const infos = buildTaskAttestationInfos(tasks);
    expect(infos.map((i) => i.slug)).toEqual(["t1", "t2", "t3"]);
    expect(infos.map((i) => [i.evidenceCount, i.attestedCount])).toEqual([
      [1, 0],
      [0, 0],
      [2, 2],
    ]);
  });
});

// ─── deriveAttestationSummary ────────────────────────────────────────────────

describe("deriveAttestationSummary", () => {
  it("HAPPY: a fully-attested set at/above the floor yields meets_floor:true with a numeric ratio", () => {
    const infos = [taskInfo({ slug: "t1", evidenceCount: 2, attestedCount: 2 })];
    const summary = deriveAttestationSummary(infos, 0.5);
    expect(summary).toEqual<AttestationSummary>({
      total_evidence: 2,
      attested: 2,
      ratio: 1,
      min_ratio: 0.5,
      meets_floor: true,
      zero_attested_tasks: [],
    });
  });

  it("REGRESSION: vacuous pass — no evidence anywhere yields ratio:null (never a fabricated 0), meets_floor:true", () => {
    expect(deriveAttestationSummary([], 0.5)).toEqual<AttestationSummary>({
      total_evidence: 0,
      attested: 0,
      ratio: null,
      min_ratio: 0.5,
      meets_floor: true,
      zero_attested_tasks: [],
    });
    const zeroEvidenceTask = taskInfo({ slug: "never-run", evidenceCount: 0, attestedCount: 0 });
    expect(deriveAttestationSummary([zeroEvidenceTask], 0.5).ratio).toBeNull();
  });

  it("BOUNDARY: ratio exactly equal to minRatio passes (>=, not >)", () => {
    const infos = [taskInfo({ slug: "t1", evidenceCount: 2, attestedCount: 1 })];
    const summary = deriveAttestationSummary(infos, 0.5);
    expect(summary.ratio).toBe(0.5);
    expect(summary.meets_floor).toBe(true);
  });

  // ─── AC-075-11 condition 1: per-task zero-attested blocks even when the
  //     plan-wide ratio alone would pass ───────────────────────────────────
  it("NEGATIVE AC-075-11: a zero-attested task blocks even when the plan-wide ratio meets the floor", () => {
    // Task A: 10 attested. Task B: 1 self-reported, 0 attested. Ratio = 10/11 ≈ 0.91 (well above 0.5),
    // but Task B individually has evidence with zero attestation — condition 1 must still block.
    const infos = [
      taskInfo({ slug: "task-a", evidenceCount: 10, attestedCount: 10 }),
      taskInfo({ slug: "task-b", evidenceCount: 1, attestedCount: 0 }),
    ];
    const summary = deriveAttestationSummary(infos, 0.5);
    expect(summary.ratio).toBeCloseTo(10 / 11, 5);
    expect(summary.meets_floor).toBe(false);
    expect(summary.zero_attested_tasks).toEqual(["task-b"]);
  });

  // ─── AC-075-11 condition 2: ratio below floor blocks even when every task
  //     individually carries >=1 attested entry ───────────────────────────
  it("NEGATIVE AC-075-11: a below-floor ratio blocks even when every task has >=1 attested entry", () => {
    // Task A: 4 entries, 1 attested. Task B: 1 entry, 1 attested. Total 5 evidence / 2 attested = 0.4 < 0.5.
    // Neither task has zero attested entries — ONLY the ratio condition trips this case.
    const infos = [
      taskInfo({ slug: "task-a", evidenceCount: 4, attestedCount: 1 }),
      taskInfo({ slug: "task-b", evidenceCount: 1, attestedCount: 1 }),
    ];
    const summary = deriveAttestationSummary(infos, 0.5);
    expect(summary.ratio).toBe(0.4);
    expect(summary.zero_attested_tasks).toEqual([]);
    expect(summary.meets_floor).toBe(false);
  });

  it("STATE: zero_attested_tasks accumulates every offending task's slug, not just the first", () => {
    const infos = [
      taskInfo({ slug: "bad-1", evidenceCount: 3, attestedCount: 0 }),
      taskInfo({ slug: "good", evidenceCount: 1, attestedCount: 1 }),
      taskInfo({ slug: "bad-2", evidenceCount: 2, attestedCount: 0 }),
    ];
    const summary = deriveAttestationSummary(infos, 0.1);
    expect(summary.zero_attested_tasks).toEqual(["bad-1", "bad-2"]);
    expect(summary.meets_floor).toBe(false);
  });
});

// ─── summarizeForAdjudicationBar ─────────────────────────────────────────────

describe("summarizeForAdjudicationBar", () => {
  it("HAPPY: a task panel with a fail among passes reduces to fail-first status", () => {
    const panel: EvidencePanelProjection = {
      doc_type: "task",
      evidence: [attestedEntry("a", "pass"), attestedEntry("b", "fail"), selfReportedEntry("c")],
      ac_refs: [],
    };
    const summary = summarizeForAdjudicationBar(panel);
    expect(summary).toEqual({
      doc_type: "task",
      evidence_count: 3,
      attested_count: 2,
      pass_count: 2,
      fail_count: 1,
      status: "fail",
    });
  });

  it("HAPPY: a task panel with only passes reduces to status pass", () => {
    const panel: EvidencePanelProjection = {
      doc_type: "task",
      evidence: [attestedEntry("a")],
      ac_refs: [],
    };
    expect(summarizeForAdjudicationBar(panel).status).toBe("pass");
  });

  it("BOUNDARY: a task panel with no evidence at all reduces to status none", () => {
    const panel: EvidencePanelProjection = { doc_type: "task", evidence: [], ac_refs: [] };
    expect(summarizeForAdjudicationBar(panel)).toEqual({
      doc_type: "task",
      evidence_count: 0,
      attested_count: 0,
      pass_count: 0,
      fail_count: 0,
      status: "none",
    });
  });

  it("HAPPY: a spec panel aggregates pass/fail/attested across every AC's coverage fact", () => {
    const coverage: AcCoverageFact[] = [
      { ac_id: "AC-1", mode: "script", pass: 2, fail: 0, refs: [], attested_pass: 1, attested_fail: 0 },
      { ac_id: "AC-2", mode: "script", pass: 0, fail: 1, refs: [], attested_pass: 0, attested_fail: 1 },
    ];
    const criteria: AcceptanceCriterion[] = [];
    const panel: EvidencePanelProjection = { doc_type: "spec", criteria, coverage, task_count: 3 };
    expect(summarizeForAdjudicationBar(panel)).toEqual({
      doc_type: "spec",
      evidence_count: 3,
      attested_count: 2,
      pass_count: 2,
      fail_count: 1,
      status: "fail",
    });
  });

  it("BOUNDARY: a spec panel with no coverage rows at all reduces to status none", () => {
    const panel: EvidencePanelProjection = { doc_type: "spec", criteria: [], coverage: [], task_count: 0 };
    expect(summarizeForAdjudicationBar(panel).status).toBe("none");
  });

  it("HAPPY: a plan panel below the attestation floor reduces to status fail", () => {
    const panel: EvidencePanelProjection = {
      doc_type: "plan",
      attestation: {
        total_evidence: 5,
        attested: 2,
        ratio: 0.4,
        min_ratio: 0.5,
        meets_floor: false,
        zero_attested_tasks: [],
      },
      tasks: [],
    };
    expect(summarizeForAdjudicationBar(panel)).toEqual({
      doc_type: "plan",
      evidence_count: 5,
      attested_count: 2,
      pass_count: 0,
      fail_count: 0,
      status: "fail",
    });
  });

  it("REGRESSION: a plan panel with vacuous (no-evidence) attestation reduces to status none, not pass", () => {
    const panel: EvidencePanelProjection = {
      doc_type: "plan",
      attestation: {
        total_evidence: 0,
        attested: 0,
        ratio: null,
        min_ratio: 0.5,
        meets_floor: true,
        zero_attested_tasks: [],
      },
      tasks: [],
    };
    expect(summarizeForAdjudicationBar(panel).status).toBe("none");
  });

  it("BOUNDARY: the other-doc-type panel always reduces to a zeroed, status:none summary", () => {
    const panel: EvidencePanelProjection = { doc_type: "other" };
    expect(summarizeForAdjudicationBar(panel)).toEqual({
      doc_type: "other",
      evidence_count: 0,
      attested_count: 0,
      pass_count: 0,
      fail_count: 0,
      status: "none",
    });
  });
});
