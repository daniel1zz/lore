/**
 * Tests for JudgmentService.computeCalibrationStats's SPEC-044 D12/AC-SP-11 kind
 * disaggregation — the group key gains the joined judgment `kind`, so review and
 * staleness calibrations NEVER pool into one Wilson bound even under the identical
 * `(doc_type, prompt_version)` pair. Uses InMemoryStore — no IO, no bun:sqlite.
 * New precedent file, follows the same style as `judgment-service.test.ts`.
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      a doc_type calibrated under BOTH kind="review" and kind="staleness",
 *               same literal "v1" prompt-version, yields TWO CalibrationStats rows,
 *               each carrying the correct `kind` field and correct per-kind n/
 *               agreement_rate
 *   NEGATIVE:   n/a beyond the disaggregation itself (covered under HAPPY/STATE)
 *   BOUNDARY:   a doc_type with ONLY kind="review" calibrations still yields exactly
 *               ONE row (no phantom empty "staleness" row)
 *   ERROR:      n/a — JudgmentService's own writes never fail against InMemoryStore
 *   STATE:      recording a staleness calibration AFTER an existing review calibration
 *               for the SAME doc_type does not retroactively merge into the review row
 *   REGRESSION: a doc_type filter narrows to matching-doc_type rows of BOTH kinds
 *               (filter is doc_type-scoped, not kind-scoped) — pre-SPEC-044 filter
 *               semantics (doc_type/prompt_version only) stay unchanged
 *
 * @spec_ref SPEC-044 §Design Decisions D12; AC-SP-11
 */

import { describe, it, expect, vi } from "vitest";
import { JudgmentService } from "../../../src/service/judgment-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import type { NewReviewJudgment, Telemetry, TelemetryEvent } from "@lore/core";
import { actedStore } from "../../live-invocation.js";

function makeService() {
  const store = actedStore(new InMemoryStore());
  const telemetry: Telemetry = { record: vi.fn(), emit: vi.fn(), close: vi.fn() };
  return { service: new JudgmentService(store, telemetry), store };
}

function makeReviewJudgment(docId: string, overrides: Partial<NewReviewJudgment> = {}): NewReviewJudgment {
  return {
    doc_id: docId,
    doc_version: 1,
    decision: "approve",
    confidence: 0.9,
    reasons: [{ dimension: "completeness", finding: "All good" }],
    checks: [{ check: "schema", outcome: "pass" }],
    blocking_questions: [],
    judge: { provider: "test-provider", model: "test-provider", prompt_version: "v1" },
    kind: "review",
    ...overrides,
  };
}

function makeStalenessJudgment(docId: string, overrides: Partial<NewReviewJudgment> = {}): NewReviewJudgment {
  return {
    doc_id: docId,
    doc_version: 1,
    decision: "escalate",
    confidence: 0.7,
    reasons: [{ dimension: "staleness", finding: "linked API changed" }],
    checks: [],
    blocking_questions: ["still true?"],
    judge: { provider: "test-provider", model: "test-provider", prompt_version: "v1" },
    kind: "staleness",
    ...overrides,
  };
}

// ─── HAPPY ──────────────────────────────────────────────────────────────────

describe("HAPPY — computeCalibrationStats disaggregates by kind (AC-SP-11)", () => {
  it("a doc_type calibrated under BOTH kind='review' and kind='staleness' (same 'v1' prompt-version) yields TWO stat rows", async () => {
    const { service } = makeService();

    // 2 review calibrations (both confirmed) on doc_type "knowledge".
    for (let i = 0; i < 2; i += 1) {
      const judgment = await service.record(makeReviewJudgment(`01ARZ3REVIEWDOC000000${i}`));
      if (!judgment.ok) throw new Error("record failed");
      const calibrated = await service.recordCalibration({
        judgment: judgment.value,
        docType: "knowledge",
        currentDocVersion: 1,
        humanOutcome: "confirmed",
        deltaReasons: [],
        actor: "alice",
      });
      if (!calibrated.ok || !calibrated.value.recorded) throw new Error("recordCalibration failed");
    }

    // 1 staleness calibration (confirmed) on the SAME doc_type "knowledge".
    const stalenessJudgment = await service.record(makeStalenessJudgment("01ARZ3STALEDOC0000000A"));
    if (!stalenessJudgment.ok) throw new Error("record failed");
    const stalenessCalibrated = await service.recordCalibration({
      judgment: stalenessJudgment.value,
      docType: "knowledge",
      currentDocVersion: 1,
      humanOutcome: "confirmed",
      deltaReasons: [],
      actor: "bob",
    });
    if (!stalenessCalibrated.ok || !stalenessCalibrated.value.recorded) {
      throw new Error("recordCalibration (staleness) failed");
    }

    const result = await service.computeCalibrationStats({ doc_type: "knowledge" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toHaveLength(2);

    const reviewStats = result.value.find((s) => s.kind === "review");
    const stalenessStats = result.value.find((s) => s.kind === "staleness");
    expect(reviewStats).toBeDefined();
    expect(stalenessStats).toBeDefined();

    expect(reviewStats?.prompt_version).toBe("v1");
    expect(stalenessStats?.prompt_version).toBe("v1");
    expect(reviewStats?.n).toBe(2);
    expect(stalenessStats?.n).toBe(1);
    expect(reviewStats?.agreement_rate).toBe(1);
    expect(stalenessStats?.agreement_rate).toBe(1);
  });
});

// ─── BOUNDARY ───────────────────────────────────────────────────────────────

describe("BOUNDARY — a doc_type with only kind='review' calibrations yields exactly ONE row", () => {
  it("no phantom empty 'staleness' row appears", async () => {
    const { service } = makeService();
    const judgment = await service.record(makeReviewJudgment("01ARZ3ONLYREVIEWDOC001"));
    if (!judgment.ok) throw new Error("record failed");
    const calibrated = await service.recordCalibration({
      judgment: judgment.value,
      docType: "adr",
      currentDocVersion: 1,
      humanOutcome: "confirmed",
      deltaReasons: [],
      actor: "alice",
    });
    if (!calibrated.ok || !calibrated.value.recorded) throw new Error("recordCalibration failed");

    const result = await service.computeCalibrationStats({ doc_type: "adr" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.kind).toBe("review");
  });
});

// ─── STATE ──────────────────────────────────────────────────────────────────

describe("STATE — a later staleness calibration does not retroactively merge into an existing review row", () => {
  it("review row's n stays 1 after a staleness calibration is recorded for the same doc_type", async () => {
    const { service } = makeService();

    const reviewJudgment = await service.record(makeReviewJudgment("01ARZ3STATEREVIEWDOC01"));
    if (!reviewJudgment.ok) throw new Error("record failed");
    const reviewCalibrated = await service.recordCalibration({
      judgment: reviewJudgment.value,
      docType: "knowledge",
      currentDocVersion: 1,
      humanOutcome: "confirmed",
      deltaReasons: [],
      actor: "alice",
    });
    if (!reviewCalibrated.ok || !reviewCalibrated.value.recorded) throw new Error("recordCalibration failed");

    const midResult = await service.computeCalibrationStats({ doc_type: "knowledge" });
    expect(midResult.ok).toBe(true);
    if (!midResult.ok) return;
    expect(midResult.value).toHaveLength(1);
    expect(midResult.value[0]?.n).toBe(1);

    const stalenessJudgment = await service.record(makeStalenessJudgment("01ARZ3STATESTALEDOC01"));
    if (!stalenessJudgment.ok) throw new Error("record failed");
    const stalenessCalibrated = await service.recordCalibration({
      judgment: stalenessJudgment.value,
      docType: "knowledge",
      currentDocVersion: 1,
      humanOutcome: "confirmed",
      deltaReasons: [],
      actor: "bob",
    });
    if (!stalenessCalibrated.ok || !stalenessCalibrated.value.recorded) throw new Error("recordCalibration failed");

    const afterResult = await service.computeCalibrationStats({ doc_type: "knowledge" });
    expect(afterResult.ok).toBe(true);
    if (!afterResult.ok) return;
    expect(afterResult.value).toHaveLength(2);
    const reviewRow = afterResult.value.find((s) => s.kind === "review");
    expect(reviewRow?.n).toBe(1); // unchanged — never merged with the staleness row
  });
});

// ─── REGRESSION ─────────────────────────────────────────────────────────────

describe("REGRESSION — doc_type filter narrows to matching-doc_type rows of BOTH kinds", () => {
  it("filter is doc_type-scoped, not kind-scoped — pre-SPEC-044 filter semantics unchanged", async () => {
    const { service } = makeService();

    const reviewJudgment = await service.record(makeReviewJudgment("01ARZ3REGRESSREVIEW001"));
    if (!reviewJudgment.ok) throw new Error("record failed");
    const reviewCalibrated = await service.recordCalibration({
      judgment: reviewJudgment.value,
      docType: "spec",
      currentDocVersion: 1,
      humanOutcome: "confirmed",
      deltaReasons: [],
      actor: "alice",
    });
    if (!reviewCalibrated.ok || !reviewCalibrated.value.recorded) throw new Error("recordCalibration failed");

    const stalenessJudgment = await service.record(makeStalenessJudgment("01ARZ3REGRESSSTALE0001"));
    if (!stalenessJudgment.ok) throw new Error("record failed");
    const stalenessCalibrated = await service.recordCalibration({
      judgment: stalenessJudgment.value,
      docType: "spec",
      currentDocVersion: 1,
      humanOutcome: "confirmed",
      deltaReasons: [],
      actor: "bob",
    });
    if (!stalenessCalibrated.ok || !stalenessCalibrated.value.recorded) throw new Error("recordCalibration failed");

    // Unrelated doc_type — must never leak into the "spec" filter's results.
    const otherTypeJudgment = await service.record(makeReviewJudgment("01ARZ3REGRESSOTHER0001"));
    if (!otherTypeJudgment.ok) throw new Error("record failed");
    const otherCalibrated = await service.recordCalibration({
      judgment: otherTypeJudgment.value,
      docType: "task",
      currentDocVersion: 1,
      humanOutcome: "overridden",
      deltaReasons: ["wrong"],
      actor: "carol",
    });
    if (!otherCalibrated.ok || !otherCalibrated.value.recorded) throw new Error("recordCalibration failed");

    const result = await service.computeCalibrationStats({ doc_type: "spec" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    expect(result.value.every((s) => s.doc_type === "spec")).toBe(true);
    expect(result.value.map((s) => s.kind).sort()).toEqual(["review", "staleness"]);
  });
});
