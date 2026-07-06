/**
 * Tests for JudgmentService (SPEC-034 §5) — record/latestFor/listFor/recordCalibration/
 * computeCalibrationStats. Uses InMemoryStore + a NoOp-style mock Telemetry — no IO, no
 * bun:sqlite. New precedent file (no direct sibling), follows the same InMemoryStore +
 * vitest style as corpus-service-get-plan-bundle.test.ts / ai-provider-service-assess.test.ts.
 *
 * Spec-first expectations (SPEC-034 §5):
 *   - record() generates id/created_at/created_by itself (created_by = formatJudgeActor(judge))
 *     and appends ONE audit entry with action="judge"
 *   - record() is append-only: two record() calls for the same doc_id both persist —
 *     listFor returns 2, latestFor returns the newer one
 *   - recordCalibration() returns ok(...) even for a deliberate SKIP (version_mismatch /
 *     not_latest_judgment are NOT LoreErrors) — result.ok===true, inspect .value.recorded
 *   - recordCalibration() version_mismatch: currentDocVersion !== judgment.doc_version
 *   - recordCalibration() not_latest_judgment: version matches, but a NEWER judgment now
 *     exists for the same doc — the one being calibrated is no longer latestJudgment
 *   - recordCalibration() happy path persists a row retrievable via queryCalibrationWindow
 *   - computeCalibrationStats(): empty store → [] (not an error); grouped per
 *     (doc_type, prompt_version) pair; n/agreement_rate/wilson_lower_bound cross-checked
 *     against wilsonLowerBound() imported directly from @lore/core; window_limit === 200
 *   - prompt_version: the REAL judge_prompt_version is reported per group, even
 *     unfiltered — a doc_type reviewed under two prompt versions produces two rows,
 *     never a collapsed "*" sentinel
 *   - n=1 boundary: wilson_lower_bound < agreement_rate (small-sample penalty), except when
 *     agreement_rate is 0, where wilson_lower_bound is also 0
 *
 * Six-dimension coverage:
 *   HAPPY:      record/latestFor/listFor round-trip; recordCalibration happy path; stats
 *               grouped correctly with cross-checked Wilson math
 *   NEGATIVE:   n/a beyond the two documented skip outcomes (covered under STATE below —
 *               they are not error paths, they are documented non-exceptional outcomes)
 *   BOUNDARY:   n=1 calibration record; empty calibration store; agreement_rate === 0
 *   ERROR:      n/a — JudgmentService's own writes never fail against InMemoryStore; the
 *               Result-wrapping is exercised implicitly via every .ok assertion below
 *   STATE:      version_mismatch and not_latest_judgment skip outcomes (both are genuine
 *               state-dependent branches — the SAME judgment input produces a different
 *               recordCalibration outcome depending on what else has happened to the doc)
 *   REGRESSION: record() is append-only (a second record() call does not overwrite/replace
 *               the first); the audit entry side effect is asserted via queryAudit
 *
 * @spec_ref SPEC-034 §5
 */

import { describe, it, expect, vi } from "vitest";
import { JudgmentService } from "../../../src/service/judgment-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { wilsonLowerBound } from "@lore/core";
import type { NewReviewJudgment, Telemetry, TelemetryEvent } from "@lore/core";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeMockTelemetry() {
  const records: TelemetryEvent[] = [];
  const telemetry: Telemetry = {
    record: vi.fn((event: TelemetryEvent) => {
      records.push(event);
    }),
    emit: vi.fn(),
    close: vi.fn(),
  };
  return { telemetry, records };
}

function makeService() {
  const store = new InMemoryStore();
  const { telemetry } = makeMockTelemetry();
  return { service: new JudgmentService(store, telemetry), store };
}

function makeNewJudgment(overrides: Partial<NewReviewJudgment> = {}): NewReviewJudgment {
  return {
    doc_id: "01ARZ3DOC00000000000001",
    doc_version: 1,
    decision: "approve",
    confidence: 0.9,
    reasons: [{ dimension: "completeness", finding: "All good" }],
    checks: [{ check: "schema", outcome: "pass" }],
    blocking_questions: [],
    judge: { provider: "test-provider", model: "test-provider", prompt_version: "v1" },
    ...overrides,
  };
}

// ─── record() ────────────────────────────────────────────────────────────────

describe("JudgmentService.record — HAPPY", () => {
  it("persists a judgment with generated id/created_at/created_by", async () => {
    const { service, store } = makeService();
    const newJudgment = makeNewJudgment();

    const result = await service.record(newJudgment);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBeTruthy();
    expect(result.value.created_at).toBeTruthy();
    expect(result.value.created_by).toBe("ai:test-provider:test-provider:v1");

    const listResult = await store.findJudgments(newJudgment.doc_id);
    expect(listResult.ok).toBe(true);
    if (!listResult.ok) return;
    expect(listResult.value).toHaveLength(1);
    expect(listResult.value[0]?.id).toBe(result.value.id);
  });

  it("appends an audit entry with action='judge' referencing the persisted judgment id", async () => {
    const { service, store } = makeService();
    const newJudgment = makeNewJudgment();

    const result = await service.record(newJudgment);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const auditResult = await store.queryAudit({ doc_id: newJudgment.doc_id });
    expect(auditResult.ok).toBe(true);
    if (!auditResult.ok) return;
    const judgeEntry = auditResult.value.find((e) => e.action === "judge");
    expect(judgeEntry).toBeDefined();
    expect(judgeEntry?.details?.["judgment_ref"]).toBe(result.value.id);
    expect(judgeEntry?.details?.["version"]).toBe(newJudgment.doc_version);
  });

  it("REGRESSION: append-only — a second record() call for the same doc creates a SECOND row, not an overwrite", async () => {
    const { service } = makeService();
    const docId = "01ARZ3DOC00000000000002";

    const first = await service.record(makeNewJudgment({ doc_id: docId, decision: "reject", confidence: 0.2 }));
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Ensure a distinguishable created_at ordering between the two records.
    await new Promise((resolve) => setTimeout(resolve, 2));

    const second = await service.record(makeNewJudgment({ doc_id: docId, decision: "approve", confidence: 0.95 }));
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(first.value.id).not.toBe(second.value.id);

    const listResult = await service.listFor(docId);
    expect(listResult.ok).toBe(true);
    if (!listResult.ok) return;
    expect(listResult.value).toHaveLength(2);

    const latestResult = await service.latestFor(docId);
    expect(latestResult.ok).toBe(true);
    if (!latestResult.ok) return;
    expect(latestResult.value?.id).toBe(second.value.id);
    expect(latestResult.value?.decision).toBe("approve");
  });
});

describe("JudgmentService.latestFor / listFor — BOUNDARY (no judgments yet)", () => {
  it("latestFor returns null when no judgment exists for the doc", async () => {
    const { service } = makeService();
    const result = await service.latestFor("01ARZ3NEVER0000000000001");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeNull();
  });

  it("listFor returns [] when no judgment exists for the doc", async () => {
    const { service } = makeService();
    const result = await service.listFor("01ARZ3NEVER0000000000002");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });
});

// ─── recordCalibration() ─────────────────────────────────────────────────────

describe("JudgmentService.recordCalibration — HAPPY", () => {
  it("records a calibration row when version matches and it is the latest judgment", async () => {
    const { service, store } = makeService();
    const recorded = await service.record(makeNewJudgment({ doc_id: "01ARZ3DOC00000000000003", doc_version: 2 }));
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;

    const outcome = await service.recordCalibration({
      judgment: recorded.value,
      docType: "spec",
      currentDocVersion: 2,
      humanOutcome: "confirmed",
      deltaReasons: [],
      actor: "alice",
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.recorded).toBe(true);
    if (!outcome.value.recorded) return;
    expect(outcome.value.record.human_outcome).toBe("confirmed");
    expect(outcome.value.record.judgment_id).toBe(recorded.value.id);

    const windowResult = await store.queryCalibrationWindow({ limit: 200 });
    expect(windowResult.ok).toBe(true);
    if (!windowResult.ok) return;
    expect(windowResult.value).toHaveLength(1);
    expect(windowResult.value[0]?.id).toBe(outcome.value.record.id);
  });
});

describe("JudgmentService.recordCalibration — STATE (version_mismatch)", () => {
  it("returns ok({recorded: false, reason: 'version_mismatch'}) when currentDocVersion differs from the judgment's doc_version", async () => {
    const { service, store } = makeService();
    const recorded = await service.record(makeNewJudgment({ doc_id: "01ARZ3DOC00000000000004", doc_version: 1 }));
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;

    const outcome = await service.recordCalibration({
      judgment: recorded.value,
      docType: "spec",
      currentDocVersion: 2, // doc has moved on since the judgment was made
      humanOutcome: "confirmed",
      deltaReasons: [],
      actor: "alice",
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value).toEqual({ recorded: false, reason: "version_mismatch" });

    const windowResult = await store.queryCalibrationWindow({ limit: 200 });
    expect(windowResult.ok).toBe(true);
    if (!windowResult.ok) return;
    expect(windowResult.value).toHaveLength(0);
  });
});

describe("JudgmentService.recordCalibration — STATE (not_latest_judgment)", () => {
  it("returns ok({recorded: false, reason: 'not_latest_judgment'}) when a newer judgment has since been recorded", async () => {
    const { service, store } = makeService();
    const docId = "01ARZ3DOC00000000000005";
    const firstJudgment = await service.record(makeNewJudgment({ doc_id: docId, doc_version: 1 }));
    expect(firstJudgment.ok).toBe(true);
    if (!firstJudgment.ok) return;

    await new Promise((resolve) => setTimeout(resolve, 2));

    // A newer judgment for the same doc + version has since been recorded (e.g. `lore review`
    // was re-run before the human got around to confirming/overriding the first one).
    const secondJudgment = await service.record(makeNewJudgment({ doc_id: docId, doc_version: 1 }));
    expect(secondJudgment.ok).toBe(true);
    if (!secondJudgment.ok) return;

    // Calibrating against the FIRST (now stale) judgment — version still matches (both are
    // doc_version 1), but it is no longer the doc's latest judgment.
    const outcome = await service.recordCalibration({
      judgment: firstJudgment.value,
      docType: "spec",
      currentDocVersion: 1,
      humanOutcome: "confirmed",
      deltaReasons: [],
      actor: "alice",
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value).toEqual({ recorded: false, reason: "not_latest_judgment" });

    const windowResult = await store.queryCalibrationWindow({ limit: 200 });
    expect(windowResult.ok).toBe(true);
    if (!windowResult.ok) return;
    expect(windowResult.value).toHaveLength(0);
  });

  it("calibrating against the SECOND (actually latest) judgment for the same scenario succeeds", async () => {
    const { service } = makeService();
    const docId = "01ARZ3DOC00000000000006";
    const firstJudgment = await service.record(makeNewJudgment({ doc_id: docId, doc_version: 1 }));
    expect(firstJudgment.ok).toBe(true);
    if (!firstJudgment.ok) return;

    await new Promise((resolve) => setTimeout(resolve, 2));

    const secondJudgment = await service.record(makeNewJudgment({ doc_id: docId, doc_version: 1 }));
    expect(secondJudgment.ok).toBe(true);
    if (!secondJudgment.ok) return;

    const outcome = await service.recordCalibration({
      judgment: secondJudgment.value,
      docType: "spec",
      currentDocVersion: 1,
      humanOutcome: "overridden",
      deltaReasons: ["missed a broken link"],
      actor: "bob",
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.recorded).toBe(true);
  });
});

// ─── computeCalibrationStats() ───────────────────────────────────────────────

describe("JudgmentService.computeCalibrationStats — BOUNDARY (empty store)", () => {
  it("returns [] when no calibration records exist, not an error", async () => {
    const { service } = makeService();
    const result = await service.computeCalibrationStats();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });
});

describe("JudgmentService.computeCalibrationStats — HAPPY (grouped by doc_type, cross-checked math)", () => {
  async function seedMixedCalibrationData(service: JudgmentService): Promise<void> {
    // 3 "spec" calibration records: 2 confirmed, 1 overridden.
    for (const [i, outcome] of (["confirmed", "confirmed", "overridden"] as const).entries()) {
      const judgment = await service.record(
        makeNewJudgment({ doc_id: `01ARZ3SPEC0000000000000${i}`, doc_version: 1 }),
      );
      if (!judgment.ok) throw new Error("record failed");
      const calibrated = await service.recordCalibration({
        judgment: judgment.value,
        docType: "spec",
        currentDocVersion: 1,
        humanOutcome: outcome,
        deltaReasons: [],
        actor: "alice",
      });
      if (!calibrated.ok) throw new Error("recordCalibration failed");
    }

    // 2 "task" calibration records: both overridden.
    for (const [i] of ["overridden", "overridden"].entries()) {
      const judgment = await service.record(
        makeNewJudgment({ doc_id: `01ARZ3TASK0000000000000${i}`, doc_version: 1 }),
      );
      if (!judgment.ok) throw new Error("record failed");
      const calibrated = await service.recordCalibration({
        judgment: judgment.value,
        docType: "task",
        currentDocVersion: 1,
        humanOutcome: "overridden",
        deltaReasons: ["wrong verdict"],
        actor: "bob",
      });
      if (!calibrated.ok) throw new Error("recordCalibration failed");
    }
  }

  it("produces one CalibrationStats entry per distinct doc_type, with n/agreement_rate/wilson_lower_bound matching the raw data", async () => {
    const { service } = makeService();
    await seedMixedCalibrationData(service);

    const result = await service.computeCalibrationStats();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toHaveLength(2);

    const specStats = result.value.find((s) => s.doc_type === "spec");
    const taskStats = result.value.find((s) => s.doc_type === "task");
    expect(specStats).toBeDefined();
    expect(taskStats).toBeDefined();

    expect(specStats?.n).toBe(3);
    expect(specStats?.agreement_rate).toBeCloseTo(2 / 3);
    expect(specStats?.wilson_lower_bound).toBeCloseTo(wilsonLowerBound(2, 3));
    expect(specStats?.window_limit).toBe(200);

    expect(taskStats?.n).toBe(2);
    expect(taskStats?.agreement_rate).toBe(0);
    expect(taskStats?.wilson_lower_bound).toBeCloseTo(wilsonLowerBound(0, 2));
    expect(taskStats?.window_limit).toBe(200);
  });

  it("doc_type filter narrows to a single group", async () => {
    const { service } = makeService();
    await seedMixedCalibrationData(service);

    const result = await service.computeCalibrationStats({ doc_type: "task" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.doc_type).toBe("task");
    expect(result.value[0]?.n).toBe(2);
  });

  it("prompt_version reports the REAL judge_prompt_version per group, even fully unfiltered", async () => {
    const { service } = makeService();
    await seedMixedCalibrationData(service);

    const result = await service.computeCalibrationStats();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // seedMixedCalibrationData only ever uses judge.prompt_version "v1" (makeNewJudgment's
    // default) — every group must report the real value, never a collapsed sentinel.
    for (const stat of result.value) {
      expect(stat.prompt_version).toBe("v1");
    }
  });

  it("REGRESSION: two prompt versions for the SAME doc_type produce two SEPARATE stats rows, never collapsed", async () => {
    const { service } = makeService();

    // 2 "spec" calibration records under prompt_version v1: both confirmed.
    for (let i = 0; i < 2; i += 1) {
      const judgment = await service.record(
        makeNewJudgment({
          doc_id: `01ARZ3PVA000000000000${i}`,
          judge: { provider: "test-provider", model: "test-provider", prompt_version: "v1" },
        }),
      );
      if (!judgment.ok) throw new Error("record failed");
      const calibrated = await service.recordCalibration({
        judgment: judgment.value,
        docType: "spec",
        currentDocVersion: 1,
        humanOutcome: "confirmed",
        deltaReasons: [],
        actor: "alice",
      });
      if (!calibrated.ok) throw new Error("recordCalibration failed");
    }

    // 1 "spec" calibration record under prompt_version v2: overridden.
    const judgmentV2 = await service.record(
      makeNewJudgment({
        doc_id: "01ARZ3PVB0000000000000",
        judge: { provider: "test-provider", model: "test-provider", prompt_version: "v2" },
      }),
    );
    if (!judgmentV2.ok) throw new Error("record failed");
    const calibratedV2 = await service.recordCalibration({
      judgment: judgmentV2.value,
      docType: "spec",
      currentDocVersion: 1,
      humanOutcome: "overridden",
      deltaReasons: ["prompt v2 disagreement"],
      actor: "bob",
    });
    if (!calibratedV2.ok) throw new Error("recordCalibration failed");

    const result = await service.computeCalibrationStats({ doc_type: "spec" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);

    const v1Stats = result.value.find((s) => s.prompt_version === "v1");
    const v2Stats = result.value.find((s) => s.prompt_version === "v2");
    expect(v1Stats).toBeDefined();
    expect(v2Stats).toBeDefined();
    expect(v1Stats?.n).toBe(2);
    expect(v1Stats?.agreement_rate).toBe(1);
    expect(v2Stats?.n).toBe(1);
    expect(v2Stats?.agreement_rate).toBe(0);
  });

  it("prompt_version equals the filter value verbatim when pinned", async () => {
    const { service } = makeService();
    await seedMixedCalibrationData(service);

    const result = await service.computeCalibrationStats({ prompt_version: "v1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBeGreaterThan(0);
    for (const stat of result.value) {
      expect(stat.prompt_version).toBe("v1");
    }
  });

  it("a prompt_version filter matching NOTHING (all judgments are v1) returns an empty array", async () => {
    const { service } = makeService();
    await seedMixedCalibrationData(service);

    const result = await service.computeCalibrationStats({ prompt_version: "v99-does-not-exist" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });
});

describe("JudgmentService.computeCalibrationStats — BOUNDARY (n=1 small-sample penalty)", () => {
  it("a single confirmed calibration record: wilson_lower_bound < agreement_rate (small-sample penalty)", async () => {
    const { service } = makeService();
    const judgment = await service.record(makeNewJudgment({ doc_id: "01ARZ3SOLO000000000001", doc_version: 1 }));
    expect(judgment.ok).toBe(true);
    if (!judgment.ok) return;
    const calibrated = await service.recordCalibration({
      judgment: judgment.value,
      docType: "adr",
      currentDocVersion: 1,
      humanOutcome: "confirmed",
      deltaReasons: [],
      actor: "alice",
    });
    expect(calibrated.ok).toBe(true);

    const result = await service.computeCalibrationStats({ doc_type: "adr" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    const stat = result.value[0]!;
    expect(stat.n).toBe(1);
    expect(stat.agreement_rate).toBe(1);
    expect(stat.wilson_lower_bound).toBeLessThan(stat.agreement_rate);
    expect(stat.wilson_lower_bound).toBeCloseTo(wilsonLowerBound(1, 1));
  });

  it("a single overridden calibration record: agreement_rate is 0 AND wilson_lower_bound is also 0", async () => {
    const { service } = makeService();
    const judgment = await service.record(makeNewJudgment({ doc_id: "01ARZ3SOLO000000000002", doc_version: 1 }));
    expect(judgment.ok).toBe(true);
    if (!judgment.ok) return;
    const calibrated = await service.recordCalibration({
      judgment: judgment.value,
      docType: "adr",
      currentDocVersion: 1,
      humanOutcome: "overridden",
      deltaReasons: ["wrong"],
      actor: "alice",
    });
    expect(calibrated.ok).toBe(true);

    const result = await service.computeCalibrationStats({ doc_type: "adr" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stat = result.value[0]!;
    expect(stat.n).toBe(1);
    expect(stat.agreement_rate).toBe(0);
    expect(stat.wilson_lower_bound).toBe(0);
  });
});
