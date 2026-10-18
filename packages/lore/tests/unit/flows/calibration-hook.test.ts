/**
 * Tests for runCalibrationHook (SPEC-035 §3 D3) — implicit calibration capture
 * invoked by the `approve` / `reject` CLI commands after a successful
 * ReviewService transition. No bun:sqlite in the dependency chain (uses
 * InMemoryStore), so this runs under vitest.
 *
 * Spec-first expectations (from calibration-hook.ts's JSDoc, read BEFORE any
 * assertion was written against the actual source body):
 *   - Fetches judgmentService.latestFor(doc.id).
 *   - Fetch failure (!ok) -> stderr warning `warning: <approved|rejected>, but
 *     calibration record failed: <msg>` + ONE telemetry.record({ok:false, ...}).
 *   - No judgment exists (null) -> completely silent no-op (no stderr, no telemetry).
 *   - judgment.doc_version !== actedOnVersion -> completely silent skip (no
 *     stderr, no telemetry) — this is the "stale judgment" case, deliberately
 *     silent per spec (the pending badge already communicates staleness).
 *   - Otherwise pairs humanAction against judgment.decision:
 *       approve+approve -> confirmed   approve+reject/escalate -> overridden
 *       reject+reject   -> confirmed   reject+approve/escalate -> overridden
 *   - Calls recordCalibration(...) with deltaReasons = note!==undefined ? [note] : [].
 *   - recordCalibration failure (!ok) -> same stderr+telemetry pattern as fetch failure.
 *   - Success -> nothing printed, nothing else happens (silent success).
 *
 * Six-dimension coverage:
 *   HAPPY:      all 4 decision pairings that produce "confirmed" (2x) and
 *               "overridden" (2x), cross-checked against a real persisted row
 *               (queryCalibrationWindow), not just mock call args
 *   NEGATIVE:   no judgment exists for the doc at all -> silent no-op
 *   BOUNDARY:   escalate paired with both approve and reject -> always overridden
 *               (escalate is never a match for either human action)
 *   ERROR:      recordCalibration write failure (forced via a store subclass)
 *               -> stderr warning + telemetry, never thrown, exit path unaffected
 *   STATE:      doc_version mismatch (stale judgment) -> silent skip, distinct
 *               from the "no judgment" case even though both look "silent"
 *               from the outside
 *   REGRESSION: --calibration-note plumbing -> delta_reasons[0] when present,
 *               [] when omitted (guards against a future refactor collapsing
 *               `note` into the record unconditionally, or dropping it silently)
 *
 * @spec_ref SPEC-035 §3
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { runCalibrationHook } from "../../../src/flows/calibration-hook.js";
import { JudgmentService } from "../../../src/service/judgment-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { err } from "@lore/core";
import type {
  CalibrationRecord,
  DocRecord,
  LoreError,
  NewReviewJudgment,
  Result,
  ReviewDecision,
  Telemetry,
  TelemetryEvent,
} from "@lore/core";
import { actedStore } from "../../live-invocation.js";

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

/**
 * The telemetry passed to `new JudgmentService(...)` is a SEPARATE instance from
 * the telemetry passed as `runCalibrationHook`'s `deps.telemetry` — the service
 * instruments its OWN `record()`/`recordCalibration()` calls on its constructor
 * telemetry (see judgment-service.ts `_recordTelemetryEvent`), which is unrelated
 * noise for asserting on the HOOK's own `warnCalibrationFailure` telemetry.record
 * call. Tests that assert "telemetry.record was/wasn't called" by the hook MUST
 * pass a telemetry double that is NOT wired into the JudgmentService constructor,
 * or the service's own instrumentation pollutes the assertion.
 */
function makeService() {
  const store = actedStore(new InMemoryStore());
  const serviceTelemetry = makeMockTelemetry().telemetry;
  return { service: new JudgmentService(store, serviceTelemetry), store };
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

function makeDoc(overrides: Partial<DocRecord> = {}): DocRecord {
  return {
    id: "01ARZ3DOC00000000000001",
    slug: "spec-test-doc",
    type: "spec",
    role: "spec",
    title: "Test Doc",
    status: "approved",
    priority: "medium",
    content: "content",
    parent_id: null,
    created_at: "2026-07-06T00:00:00.000Z",
    updated_at: "2026-07-06T00:00:00.000Z",
    created_by: "agent:test",
    version: 2,
    deleted_at: null,
    tags: [],
    extra: {},
    ...overrides,
  };
}

/** A JudgmentService whose insertCalibrationRecord always fails, to exercise the write-failure branch. */
class FailingCalibrationStore extends InMemoryStore {
  override async insertCalibrationRecord(_record: CalibrationRecord): Promise<Result<void, LoreError>> {
    return err({ code: "STORE_ERROR", message: "forced failure" });
  }
}

// ─── HAPPY: decision pairing → human_outcome ─────────────────────────────────

describe("runCalibrationHook — HAPPY (decision pairing persists the correct human_outcome)", () => {
  const cases: Array<{
    humanAction: "approve" | "reject";
    aiDecision: ReviewDecision;
    expected: "confirmed" | "overridden";
  }> = [
    { humanAction: "approve", aiDecision: "approve", expected: "confirmed" },
    { humanAction: "approve", aiDecision: "reject", expected: "overridden" },
    { humanAction: "reject", aiDecision: "reject", expected: "confirmed" },
    { humanAction: "reject", aiDecision: "approve", expected: "overridden" },
    // BOUNDARY: escalate is never a match for either human action.
    { humanAction: "approve", aiDecision: "escalate", expected: "overridden" },
    { humanAction: "reject", aiDecision: "escalate", expected: "overridden" },
  ];

  for (const { humanAction, aiDecision, expected } of cases) {
    it(`${humanAction} vs AI "${aiDecision}" -> persists human_outcome "${expected}"`, async () => {
      const { service, store } = makeService();
      // reason: reviewJudgmentSchema requires a non-empty blocking_questions
      // whenever decision === "escalate" (and empty otherwise) — see
      // review-judgment.ts's documented superRefine invariant.
      const judgment = await service.record(
        makeNewJudgment({
          doc_id: "01ARZ3DOC00000000000010",
          doc_version: 3,
          decision: aiDecision,
          ...(aiDecision === "escalate" ? { blocking_questions: ["needs human review"] } : {}),
        }),
      );
      expect(judgment.ok).toBe(true);
      if (!judgment.ok) return;

      const doc = makeDoc({ id: "01ARZ3DOC00000000000010", version: 3 });

      await runCalibrationHook(
        { judgmentService: service, telemetry: makeMockTelemetry().telemetry },
        { updatedDoc: doc, actedOnVersion: 3, humanAction, actor: "alice" },
      );

      const windowResult = await store.queryCalibrationWindow({ limit: 200 });
      expect(windowResult.ok).toBe(true);
      if (!windowResult.ok) return;
      expect(windowResult.value).toHaveLength(1);
      expect(windowResult.value[0]?.human_outcome).toBe(expected);
      expect(windowResult.value[0]?.judgment_id).toBe(judgment.value.id);
      expect(windowResult.value[0]?.actor).toBe("alice");
    });
  }
});

// ─── --calibration-note plumbing ─────────────────────────────────────────────

describe("runCalibrationHook — REGRESSION (--calibration-note plumbing)", () => {
  it("note provided -> delta_reasons is [note]", async () => {
    const { service, store } = makeService();
    const judgment = await service.record(
      makeNewJudgment({ doc_id: "01ARZ3DOC00000000000020", doc_version: 1, decision: "approve" }),
    );
    expect(judgment.ok).toBe(true);
    if (!judgment.ok) return;

    const doc = makeDoc({ id: "01ARZ3DOC00000000000020", version: 1 });

    await runCalibrationHook(
      { judgmentService: service, telemetry: makeMockTelemetry().telemetry },
      {
        updatedDoc: doc,
        actedOnVersion: 1,
        humanAction: "approve",
        actor: "bob",
        note: "reviewer disagreed on X",
      },
    );

    const windowResult = await store.queryCalibrationWindow({ limit: 200 });
    expect(windowResult.ok).toBe(true);
    if (!windowResult.ok) return;
    expect(windowResult.value[0]?.delta_reasons).toEqual(["reviewer disagreed on X"]);
  });

  it("note omitted -> delta_reasons is []", async () => {
    const { service, store } = makeService();
    const judgment = await service.record(
      makeNewJudgment({ doc_id: "01ARZ3DOC00000000000021", doc_version: 1, decision: "approve" }),
    );
    expect(judgment.ok).toBe(true);
    if (!judgment.ok) return;

    const doc = makeDoc({ id: "01ARZ3DOC00000000000021", version: 1 });

    await runCalibrationHook(
      { judgmentService: service, telemetry: makeMockTelemetry().telemetry },
      { updatedDoc: doc, actedOnVersion: 1, humanAction: "approve", actor: "bob" },
    );

    const windowResult = await store.queryCalibrationWindow({ limit: 200 });
    expect(windowResult.ok).toBe(true);
    if (!windowResult.ok) return;
    expect(windowResult.value[0]?.delta_reasons).toEqual([]);
  });
});

// ─── STATE: stale judgment (doc_version mismatch) ────────────────────────────

describe("runCalibrationHook — STATE (judgment.doc_version !== actedOnVersion is a SILENT skip)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stale judgment -> no calibration record, no stderr write, no telemetry", async () => {
    const { service, store } = makeService();
    const { telemetry: hookTelemetry, records } = makeMockTelemetry();
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const judgment = await service.record(
      makeNewJudgment({ doc_id: "01ARZ3DOC00000000000030", doc_version: 1, decision: "approve" }),
    );
    expect(judgment.ok).toBe(true);
    if (!judgment.ok) return;

    // The doc has moved on to version 5 since the judgment was made at version 1.
    const doc = makeDoc({ id: "01ARZ3DOC00000000000030", version: 5 });

    await runCalibrationHook(
      { judgmentService: service, telemetry: hookTelemetry },
      { updatedDoc: doc, actedOnVersion: 5, humanAction: "approve", actor: "alice" },
    );

    const windowResult = await store.queryCalibrationWindow({ limit: 200 });
    expect(windowResult.ok).toBe(true);
    if (!windowResult.ok) return;
    expect(windowResult.value).toHaveLength(0);

    expect(stderrSpy).not.toHaveBeenCalled();
    expect(records).toHaveLength(0);
  });
});

// ─── NEGATIVE: no judgment exists ────────────────────────────────────────────

describe("runCalibrationHook — NEGATIVE (no judgment exists for the doc)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("latestFor returns null -> no calibration record, no stderr write, no telemetry", async () => {
    const { service, store } = makeService();
    const { telemetry: hookTelemetry, records } = makeMockTelemetry();
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const doc = makeDoc({ id: "01ARZ3DOC00000000000040", version: 1 });

    await runCalibrationHook(
      { judgmentService: service, telemetry: hookTelemetry },
      { updatedDoc: doc, actedOnVersion: 1, humanAction: "approve", actor: "alice" },
    );

    const windowResult = await store.queryCalibrationWindow({ limit: 200 });
    expect(windowResult.ok).toBe(true);
    if (!windowResult.ok) return;
    expect(windowResult.value).toHaveLength(0);

    expect(stderrSpy).not.toHaveBeenCalled();
    expect(records).toHaveLength(0);
  });
});

// ─── ERROR: recordCalibration write failure ──────────────────────────────────

describe("runCalibrationHook — ERROR (calibration write failure warns but never throws)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("approve: write failure -> stderr contains 'warning: approved, but calibration record failed:' + one telemetry.record(ok:false)", async () => {
    const store = actedStore(new FailingCalibrationStore());
    // reason: separate telemetry doubles — one wired into JudgmentService's own
    // constructor (its internal record()/recordCalibration() instrumentation is
    // irrelevant noise here), one passed as the hook's deps.telemetry (the only
    // one we assert against).
    const serviceTelemetry = makeMockTelemetry().telemetry;
    const service = new JudgmentService(store, serviceTelemetry);
    const { telemetry: hookTelemetry, records } = makeMockTelemetry();

    const stderrWrites: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      stderrWrites.push(String(chunk));
      return true;
    });

    const judgment = await service.record(
      makeNewJudgment({ doc_id: "01ARZ3DOC00000000000050", doc_version: 1, decision: "approve" }),
    );
    expect(judgment.ok).toBe(true);
    if (!judgment.ok) return;

    const doc = makeDoc({ id: "01ARZ3DOC00000000000050", version: 1 });

    await expect(
      runCalibrationHook(
        { judgmentService: service, telemetry: hookTelemetry },
        { updatedDoc: doc, actedOnVersion: 1, humanAction: "approve", actor: "alice" },
      ),
    ).resolves.toBeUndefined();

    expect(stderrWrites.join("")).toContain("warning: approved, but calibration record failed:");
    expect(records).toHaveLength(1);
    expect(records[0]?.ok).toBe(false);
    expect(records[0]?.error_code).toBe("STORE_ERROR");
    expect(records[0]?.service).toBe("cli.calibration-hook");
    expect(records[0]?.method).toBe("approve");
  });

  it("reject: write failure -> stderr contains 'warning: rejected, but calibration record failed:'", async () => {
    const store = actedStore(new FailingCalibrationStore());
    const serviceTelemetry = makeMockTelemetry().telemetry;
    const service = new JudgmentService(store, serviceTelemetry);
    const { telemetry: hookTelemetry, records } = makeMockTelemetry();

    const stderrWrites: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      stderrWrites.push(String(chunk));
      return true;
    });

    const judgment = await service.record(
      makeNewJudgment({ doc_id: "01ARZ3DOC00000000000051", doc_version: 1, decision: "reject" }),
    );
    expect(judgment.ok).toBe(true);
    if (!judgment.ok) return;

    const doc = makeDoc({ id: "01ARZ3DOC00000000000051", version: 1 });

    await runCalibrationHook(
      { judgmentService: service, telemetry: hookTelemetry },
      { updatedDoc: doc, actedOnVersion: 1, humanAction: "reject", actor: "alice" },
    );

    expect(stderrWrites.join("")).toContain("warning: rejected, but calibration record failed:");
    expect(records).toHaveLength(1);
    expect(records[0]?.ok).toBe(false);
    expect(records[0]?.method).toBe("reject");
  });
});
