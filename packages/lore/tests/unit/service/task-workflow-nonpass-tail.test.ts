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
 * leaving the two adjacent, deliberately-untouched paths open:
 *   - AC-ETI-4: a self-reported `pass` (D2 — owned by the separate
 *     `findFilteredPassRefusal` guard, never this one)
 *   - AC-ETI-5: a runner-ATTESTED `fail` via `recordVerifiedEvidence` (the
 *     shared `appendEvidenceEntry` chokepoint this guard deliberately does
 *     NOT bind — a silent/timed-out run can legitimately yield `""`)
 *
 * @spec_ref AC-ETI-1, AC-ETI-2, AC-ETI-3, AC-ETI-4, AC-ETI-5
 */

import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { TaskWorkflowService, type EvidenceInput } from "../../../src/service/task-workflow-service.js";
import { exitCode } from "../../../src/adapters/cli/utils.js";
import type { CreateDocInput } from "@lore/core";

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function makeServices(ttl = 120) {
  const store = new InMemoryStore();
  const corpusService = new CorpusService(store);
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

// ─── AC-ETI-4 (CONTROL) ───────────────────────────────────────────────────────

describe("AC-ETI-4 — CONTROL: pass with unfiltered command and no output_tail is still accepted (D2)", () => {
  it("AC-ETI-4: result=pass, unfiltered command, output_tail omitted — accepted, new predicate does not widen into the pass path", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    const result = await taskWorkflowService.addEvidence(
      taskId,
      evidence({ oracle: "tsc", command: "bun run typecheck", result: "pass" }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.version).toBe(2);
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
        attestation: { runner: "lore-cli", exit_code: 1, duration_ms: 30000, timed_out: true },
      },
      nowIso,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.extra["verification_evidence"]).toHaveLength(1);
  });
});
