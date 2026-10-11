/**
 * PhaseWorkflowService._addEvidenceImpl's fourth self-report-only guard —
 * phase-tier parity twin of `task-workflow-nonpass-tail.test.ts`
 * (spec-evidence-output-tail-integrity-a-self-reported-non-pass §D1/§D3/§D4
 * scope note, task-t1-self-reported-fail-expected-fail-must-carry-a-non-empty,
 * AC-ETI-6).
 *
 * Both CLI (`commands/evidence.ts:304`) and MCP (`mcp/tools.ts:1456`) fall back
 * to `PhaseWorkflowService.addEvidence` on a `{field:"type", value:"phase"}`
 * rejection from the task-tier call — fixing only `TaskWorkflowService` would
 * leave this fallback channel open to the exact same tail-less non-pass row the
 * task tier now refuses. `rejectMissingNonPassOutputTail` is imported from
 * `task-workflow-service.js` (SSOT, same precedent as this file's own
 * `rejectBlankClaimWorktree`/`computeArchiveWalk` re-use) rather than
 * re-derived here, so the two tiers cannot silently diverge on wording or rule.
 *
 * Mirrors `phase-workflow-inconclusive-guard.test.ts`'s fixture shape
 * (raw-insert plan+phase, `type: "phase"` is migration-created only).
 *
 * @spec_ref AC-ETI-6
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect } from "vitest";
import { NoOpTelemetry } from "@lore/core";
import type { DocRecord, DocType, CreateDocInput } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { PhaseWorkflowService } from "../../../src/service/phase-workflow-service.js";
import { TaskWorkflowService, type EvidenceInput } from "../../../src/service/task-workflow-service.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { exitCode } from "../../../src/adapters/cli/utils.js";

// ─── Fixtures (mirrors phase-workflow-inconclusive-guard.test.ts's raw-insert
// pattern — `type: "phase"` is migration-created only, D6a, never via
// CorpusService.create) ──

function makePlanRecord(overrides: Partial<DocRecord> = {}): DocRecord {
  const base: DocRecord = {
    id: "01HPLAN0000000000000ETI01",
    slug: "plan-nonpass-tail-guard",
    type: "plan",
    role: "plan",
    title: "Plan Non-Pass Tail Guard",
    status: "approved",
    priority: "medium",
    content: "# Plan",
    parent_id: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    created_by: "system",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
  };
  return { ...base, ...overrides };
}

function makePhaseRecord(overrides: Partial<DocRecord> = {}): DocRecord {
  const base: DocRecord = {
    id: "01HPHASEETI0000000000001",
    slug: "phase-nonpass-tail-guard",
    type: "phase" as unknown as DocType,
    role: "plan",
    title: "Phase Non-Pass Tail Guard",
    status: "draft",
    priority: "medium",
    content: "# Phase",
    parent_id: "01HPLAN0000000000000ETI01",
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    created_by: "system",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: { plan_id: "01HPLAN0000000000000ETI01" },
  };
  return { ...base, ...overrides, extra: { ...base.extra, ...overrides.extra } };
}

async function mustInsert(store: InMemoryStore, doc: DocRecord): Promise<DocRecord> {
  const result = await store.insert(doc);
  if (!result.ok) throw new Error(`insert failed: ${JSON.stringify(result.error)}`);
  return result.value;
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

async function makePhaseServices() {
  const store = new InMemoryStore();
  const service = new PhaseWorkflowService(store, new NoOpTelemetry(), { claimTtlMinutes: 120 });
  await mustInsert(store, makePlanRecord());
  const phase = await mustInsert(store, makePhaseRecord());
  return { store, service, phase };
}

// ─── AC-ETI-6 ─────────────────────────────────────────────────────────────────

describe("AC-ETI-6 — phase-tier self-report path rejects a tail-less non-pass row identically to the task tier", () => {
  it("AC-ETI-6: result=fail with output_tail omitted on a phase doc is rejected VALIDATION_ERROR field=output_tail", async () => {
    const { store, service, phase } = await makePhaseServices();

    const result = await service.addEvidence(phase.slug, evidence({ result: "fail" }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("output_tail");
    expect(exitCode(result.error)).toBe(4);

    const after = await store.find(phase.id);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value?.version).toBe(1);
    expect(after.value?.extra["verification_evidence"]).toBeUndefined();
  });

  it("AC-ETI-6: result=fail with whitespace-only output_tail ('\\n') on a phase doc is rejected identically to an absent tail (D3)", async () => {
    const { service, phase } = await makePhaseServices();

    const result = await service.addEvidence(phase.slug, evidence({ result: "fail", output_tail: "\n" }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("output_tail");
  });

  it("AC-ETI-6: result=expected-fail with output_tail omitted on a phase doc is rejected on the same predicate as fail (D1)", async () => {
    const { service, phase } = await makePhaseServices();

    const result = await service.addEvidence(phase.slug, evidence({ result: "expected-fail" }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("output_tail");
  });

  it("AC-ETI-6: CONTROL — result=pass with no output_tail on a phase doc is still accepted (D2, guard does not widen into the pass path)", async () => {
    const { service, phase } = await makePhaseServices();

    const result = await service.addEvidence(
      phase.slug,
      evidence({ oracle: "tsc", command: "bun run typecheck", result: "pass" }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.version).toBe(2);
    expect(result.value.extra["verification_evidence"]).toHaveLength(1);
  });

  it("AC-ETI-6: the phase rejection is byte-identical (code/field/message/value/exit-code) to TaskWorkflowService's own rejection for the same input — parity, not just 'some error'", async () => {
    // Phase-path rejection
    const { service: phaseService, phase } = await makePhaseServices();
    const phaseResult = await phaseService.addEvidence(phase.slug, evidence({ result: "fail" }));

    // Task-path rejection (same fixture pattern as phase-workflow-inconclusive-guard.test.ts)
    const taskStore = new InMemoryStore();
    const corpusService = new CorpusService(taskStore, new RecordLockService(taskStore, new GateEnforcer(undefined)));
    const taskWorkflowService = new TaskWorkflowService(taskStore, undefined, { claimTtlMinutes: 120 });
    const planResult = await corpusService.create({
      type: "plan",
      title: "Test Plan",
      content: "body",
    } as CreateDocInput);
    if (!planResult.ok) throw new Error("plan create failed");
    const taskResult = await corpusService.create({
      type: "task",
      title: "Test Task",
      parent_id: planResult.value.id,
      content: "body",
      extra: { plan_id: planResult.value.id },
    } as CreateDocInput);
    if (!taskResult.ok) throw new Error("task create failed");
    const taskEvidenceResult = await taskWorkflowService.addEvidence(
      taskResult.value.id,
      evidence({ result: "fail" }),
    );

    expect(phaseResult.ok).toBe(false);
    expect(taskEvidenceResult.ok).toBe(false);
    if (phaseResult.ok || taskEvidenceResult.ok) return;

    expect(phaseResult.error.code).toBe(taskEvidenceResult.error.code);
    if (phaseResult.error.code !== "VALIDATION_ERROR" || taskEvidenceResult.error.code !== "VALIDATION_ERROR") {
      throw new Error("expected both rejections to be VALIDATION_ERROR");
    }
    expect(phaseResult.error.field).toBe(taskEvidenceResult.error.field);
    expect(phaseResult.error.message).toBe(taskEvidenceResult.error.message);
    expect(phaseResult.error.value).toBe(taskEvidenceResult.error.value);
    expect(exitCode(phaseResult.error)).toBe(exitCode(taskEvidenceResult.error));
  });
});
