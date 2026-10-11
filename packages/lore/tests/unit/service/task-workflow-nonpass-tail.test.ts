/**
 * TaskWorkflowService._addEvidenceImpl's fourth self-report-only guard
 * (spec-evidence-output-tail-integrity-a-self-reported-non-pass §D1/§D3,
 * `rejectMissingNonPassOutputTail`, task-t1-self-reported-fail-expected-fail-
 * must-carry-a-non-empty).
 *
 * A self-reported `result: "fail"` or `"expected-fail"` row carries no runner
 * attestation — its `output_tail` is the ONLY evidence of what actually
 * happened. Two live incidents (spec Overview: `plan-implementation-resume-
 * coverage-floor-satisfaction` AC-RCS-1/AC-RCS-2, and
 * `task-test-changed-cannot-see-the-whole-integration-cli-tier-the`, all 6
 * rows) recorded `tail bytes: 0` on red-first evidence — a claim resting on
 * nothing observed. This file proves the new guard closes that hole while
 * leaving one adjacent, deliberately-untouched path open:
 *   - AC-ETI-5: a runner-ATTESTED `fail` via `recordVerifiedEvidence` (the
 *     shared `appendEvidenceEntry` chokepoint this guard deliberately does
 *     NOT bind — a silent/timed-out run can legitimately yield `""`)
 *
 * ⛔ SUPERSEDED (task-a-non-empty-output-tail-can-be-hand-authored-prose-and-
 * the): AC-ETI-4 originally pinned a self-reported `pass` as OUT OF SCOPE for
 * any tail requirement (D2 — that gap belonged solely to the separate
 * `findFilteredPassRefusal` guard). That asymmetry — the PASS row, the one
 * that unlocks `done()`'s archival floor, carried no tail requirement at all
 * — was measured and closed: `rejectMissingPassOutputTail` now binds
 * self-reported `pass` rows identically to this file's `fail`/`expected-fail`
 * cases, exempting only `capture_source: "runner"` rows (`lore evidence
 * --capture`). AC-ETI-4's test below now asserts the CORRECTED behavior, not
 * its original one.
 *
 * @spec_ref AC-ETI-1, AC-ETI-2, AC-ETI-3, AC-ETI-4 (superseded), AC-ETI-5
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { TaskWorkflowService, type EvidenceInput } from "../../../src/service/task-workflow-service.js";
import { exitCode } from "../../../src/adapters/cli/utils.js";
import type { CreateDocInput } from "@lore/core";

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function makeServices(ttl = 120) {
  const store = new InMemoryStore();
  const corpusService = new CorpusService(store, new RecordLockService(store));
  const taskWorkflowService = new TaskWorkflowService(store, undefined, { claimTtlMinutes: ttl });
  return { store, corpusService, taskWorkflowService };
}

async function createPlan(cs: CorpusService, title = "Non-Pass Tail Plan"): Promise<string> {
  const result = await cs.create({ type: "plan", title, content: "body" } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create plan: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

async function createTask(cs: CorpusService, planId: string, title = "Non-Pass Tail Task"): Promise<string> {
  const result = await cs.create({
    type: "task",
    title,
    parent_id: planId,
    content: "body",
    extra: { plan_id: planId },
  } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create task: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

function evidence(overrides: Partial<EvidenceInput> = {}): EvidenceInput {
  return {
    oracle: "test",
    command: "bunx vitest run some.test.ts",
    result: "fail",
    recorded_by: "alice",
    // reason: task-capture-source-is-optional-at-the-evidence-write-boundary —
    // now compile-time-required on EvidenceInput.
    capture_source: "self-report",
    ...overrides,
  };
}

// ─── AC-ETI-1 ─────────────────────────────────────────────────────────────────

describe("AC-ETI-1 — self-reported fail with no output_tail is rejected", () => {
  it("AC-ETI-1: result=fail with output_tail omitted is rejected VALIDATION_ERROR field=output_tail, row not appended", async () => {
    const { store, corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const result = await taskWorkflowService.addEvidence(taskId, evidence({ result: "fail" }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("output_tail");
    expect(exitCode(result.error)).toBe(4);

    // Row not appended — direct store re-read, version untouched.
    const after = await store.find(taskId);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value?.version).toBe(1);
    expect(after.value?.extra["verification_evidence"]).toBeUndefined();
  });
});

// ─── AC-ETI-2 ─────────────────────────────────────────────────────────────────

describe("AC-ETI-2 — whitespace-only output_tail rejected identically to absent (D3 trim test)", () => {
  it("AC-ETI-2: result=fail with output_tail='\\n' (a silent shell capture) is rejected the same as no tail", async () => {
    const { store, corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const result = await taskWorkflowService.addEvidence(
      taskId,
      evidence({ result: "fail", output_tail: "\n" }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("output_tail");
    expect(result.error.value).toBe("\n");

    const after = await store.find(taskId);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value?.version).toBe(1);
  });

  it("AC-ETI-2: result=fail with output_tail='   ' (spaces only) is rejected identically", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const result = await taskWorkflowService.addEvidence(
      taskId,
      evidence({ result: "fail", output_tail: "   " }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("output_tail");
  });
});

// ─── AC-ETI-3 ─────────────────────────────────────────────────────────────────

describe("AC-ETI-3 — expected-fail with no output_tail rejected on the same predicate as fail (D1)", () => {
  it("AC-ETI-3: result=expected-fail with output_tail omitted is rejected VALIDATION_ERROR field=output_tail", async () => {
    const { store, corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const result = await taskWorkflowService.addEvidence(taskId, evidence({ result: "expected-fail" }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("output_tail");

    const after = await store.find(taskId);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value?.version).toBe(1);
    expect(after.value?.extra["verification_evidence"]).toBeUndefined();
  });

  it("AC-ETI-3: an expected-fail WITH a genuine non-empty output_tail is accepted (guard fires on emptiness, not on the result value itself)", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const result = await taskWorkflowService.addEvidence(
      taskId,
      evidence({ result: "expected-fail", output_tail: "AssertionError: expected 1 to equal 2" }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.extra["verification_evidence"]).toHaveLength(1);
  });
});

// ─── AC-ETI-4 (SUPERSEDED — now closes the PASS-side asymmetry) ──────────────

describe("AC-ETI-4 — a self-reported pass with no output_tail is now REJECTED (task-a-non-empty-output-tail-can-be-hand-authored-prose-and-the)", () => {
  it("AC-ETI-4: result=pass, unfiltered command, output_tail omitted — REFUSED, naming the --capture repair", async () => {
    const { store, corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const result = await taskWorkflowService.addEvidence(
      taskId,
      evidence({ oracle: "tsc", command: "bun run typecheck", result: "pass" }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("output_tail");
    expect((result.error as { message: string }).message).toContain("--capture");

    const after = await store.find(taskId);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value?.version).toBe(1);
    expect(after.value?.extra["verification_evidence"]).toBeUndefined();
  });

  // reason: SUPERSEDED (task-raise-the-evidence-tail-guard-s-predicate-to-its-
  // own, spec-falsifiability-reachability-a-feedable-checkpoint-an §D5) — this
  // test used to prove a HAND-AUTHORED non-empty tail alone was enough for a
  // self-reported "pass" on a capturable oracle like "tsc". That is exactly
  // the defect D5 closes: measured 2026-08-10, 2 of 3 dispatched agents
  // satisfied "non-empty tail" by typing a fabricated summary themselves, and
  // both PASSED this exact check. The predicate is now raised to require
  // `capture_source: "runner"` for every oracle except "manual" — this
  // scenario (self-reported, oracle "tsc", hand-typed tail) is REFUSED going
  // forward. The genuinely-still-legal sibling ("manual" oracle self-report,
  // or ANY oracle with capture_source: "runner") is covered by the next two
  // tests in this describe block, unchanged.
  it("AC-ETI-4 SUPERSEDED-CONTROL: a hand-authored non-empty output_tail alone no longer suffices for a capturable oracle — refused, naming --capture", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const result = await taskWorkflowService.addEvidence(
      taskId,
      evidence({
        oracle: "tsc",
        command: "bun run typecheck",
        result: "pass",
        output_tail: "tsc exited 0, no diagnostics",
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("output_tail");
    expect((result.error as { message: string }).message).toContain("--capture");
  });

  it("AC-ETI-4 CONTROL: the SAME pass row on --oracle manual WITH a genuine non-empty output_tail is still accepted (D5's one surviving self-report escape)", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const result = await taskWorkflowService.addEvidence(
      taskId,
      evidence({
        oracle: "manual",
        command: "checked the login page by hand",
        result: "pass",
        output_tail: "logged in 3 times rapidly, 4th attempt correctly blocked",
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.version).toBe(2);
    expect(result.value.extra["verification_evidence"]).toHaveLength(1);
  });

  it("AC-ETI-4 CONTROL: the SAME pass row with capture_source \"runner\" and NO tail is accepted (independently verified by the capture)", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const result = await taskWorkflowService.addEvidence(
      taskId,
      evidence({
        oracle: "tsc",
        command: "bun run typecheck",
        result: "pass",
        capture_source: "runner",
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.extra["verification_evidence"]).toHaveLength(1);
  });
});

// ─── AC-ETI-5 (CONTROL) ───────────────────────────────────────────────────────

describe("AC-ETI-5 — CONTROL: a runner-attested fail with an empty output_tail still appends via recordVerifiedEvidence", () => {
  it("AC-ETI-5: recordVerifiedEvidence(result=fail, output_tail='', attestation=...) succeeds — the guard binds the self-report path only", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);
    const nowIso = "2026-08-01T00:00:00.000Z";

    const result = await taskWorkflowService.recordVerifiedEvidence(
      taskId,
      {
        oracle: "test",
        command: "bun test some.bun.test.ts",
        result: "fail",
        recorded_by: "lore-verify",
        output_tail: "",
        capture_source: "runner",
        attestation: { runner: "lore-cli", exit_code: 1, duration_ms: 42, timed_out: false },
      },
      nowIso,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.version).toBe(2);
    const evidenceArr = result.value.extra["verification_evidence"] as Array<Record<string, unknown>>;
    expect(evidenceArr).toHaveLength(1);
    expect(evidenceArr[0]?.["result"]).toBe("fail");
    expect(evidenceArr[0]?.["output_tail"]).toBe("");
  });

  it("AC-ETI-5: recordVerifiedEvidence(result=fail, output_tail=undefined, attestation=...) also succeeds — an absent tail is likewise unbound on the attested path", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);
    const nowIso = "2026-08-01T00:00:00.000Z";

    const result = await taskWorkflowService.recordVerifiedEvidence(
      taskId,
      {
        oracle: "test",
        command: "bun test timed-out.bun.test.ts",
        result: "fail",
        recorded_by: "lore-verify",
        capture_source: "runner",
        attestation: { runner: "lore-cli", exit_code: 1, duration_ms: 30000, timed_out: true },
      },
      nowIso,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.extra["verification_evidence"]).toHaveLength(1);
  });
});
