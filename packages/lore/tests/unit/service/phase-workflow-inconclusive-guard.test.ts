/**
 * PhaseWorkflowService._addEvidenceImpl's runtime "inconclusive" rejection guard
 * (SPEC-061 §Scope D2/D5, closure task task-t2-close-spec-061-deferred-gaps-phase-
 * path-inconclusive-gua, AC-061-G1).
 *
 * Post-implementation findings on SPEC-061's own spec doc flagged this as a
 * deliberately-deferred gap: `TaskWorkflowService._addEvidenceImpl` gained an
 * explicit runtime `hasOwnProperty`-style check rejecting a caller-supplied
 * `result: "inconclusive"` (mirroring its pre-existing `attestation`-smuggling
 * guard) — see `verify-completeness.test.ts`'s "caller-supplied inconclusive"
 * REGRESSION block, which this file's structure deliberately mirrors — but
 * `PhaseWorkflowService._addEvidenceImpl` (the SPEC-056 phase-doc-typed sibling)
 * only inherited the COMPILE-TIME exclusion (its `EvidenceInput` parameter type is
 * imported, not redeclared, from `task-workflow-service.ts`) with no runtime check
 * of its own. A candidate object built via `as EvidenceInput` on an untyped literal
 * — the exact pattern CLI commands assemble flag-derived candidates with — could
 * still smuggle the value past that compile-time-only exclusion through the
 * phase-target dispatch path. This file proves the gap is closed and the phase
 * path now behaves identically to the task path.
 *
 * Six-dimension coverage:
 *   HAPPY      — a legitimate pass/fail addEvidence call on a phase doc is
 *                UNAFFECTED by the new guard
 *   NEGATIVE   — a caller-supplied `result: "inconclusive"` (smuggled via an
 *                `as EvidenceInput` cast, the exact bypass vector the compile-time
 *                exclusion cannot stop) is rejected with VALIDATION_ERROR
 *   BOUNDARY   — the smuggled value survives even inside a FULLY well-formed
 *                candidate object (every other field present and valid) — the
 *                guard fires on `result` alone, not as a side effect of some other
 *                missing field
 *   ERROR      — the phase doc is left COMPLETELY UNCHANGED after a rejected call
 *                (no version bump, no evidence array at all) — same no-partial-
 *                write guarantee the task-path guard gives
 *   STATE      — the rejection's exact field/message/value/exit-code shape is
 *                BYTE-IDENTICAL to `TaskWorkflowService`'s own rejection for the
 *                same input (parity assertion, not just "some error")
 *   REGRESSION — the pre-existing `attestation`-smuggling guard on the phase path
 *                (already implemented) is unaffected by this addition — still
 *                rejects `attestation` the same way it always did
 *
 * @spec_ref AC-061-G1
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

// ─── Fixtures (mirrors phase-workflow-service.test.ts's raw-insert pattern —
// `type: "phase"` is migration-created only, D6a, never via CorpusService.create) ──

function makePlanRecord(overrides: Partial<DocRecord> = {}): DocRecord {
  const base: DocRecord = {
    id: "01HPLAN000000000000000001",
    slug: "plan-inconclusive-guard",
    type: "plan",
    role: "plan",
    title: "Plan Inconclusive Guard",
    status: "approved",
    priority: "medium",
    content: "# Plan",
    parent_id: null,
    created_at: "2026-07-21T00:00:00.000Z",
    updated_at: "2026-07-21T00:00:00.000Z",
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
    id: "01HPHASEGUARD00000000001",
    slug: "phase-inconclusive-guard",
    type: "phase" as unknown as DocType,
    role: "plan",
    title: "Phase Inconclusive Guard",
    status: "draft",
    priority: "medium",
    content: "# Phase",
    parent_id: "01HPLAN000000000000000001",
    created_at: "2026-07-21T00:00:00.000Z",
    updated_at: "2026-07-21T00:00:00.000Z",
    created_by: "system",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: { plan_id: "01HPLAN000000000000000001" },
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
    oracle: "tsc",
    command: "bun run typecheck",
    result: "pass",
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

describe("PhaseWorkflowService inconclusive guard — HAPPY", () => {
  it("a legitimate pass/fail addEvidence call on a phase doc is unaffected", async () => {
    const { service, phase } = await makePhaseServices();
    const result = await service.addEvidence(phase.slug, evidence({ result: "pass" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.version).toBe(2);
    expect(result.value.extra["verification_evidence"]).toHaveLength(1);
  });
});

describe("PhaseWorkflowService inconclusive guard — NEGATIVE", () => {
  it("a caller-supplied result:'inconclusive' smuggled via `as EvidenceInput` is rejected", async () => {
    const { service, phase } = await makePhaseServices();

    // reason: "inconclusive" is excluded from EvidenceInput's `result` type at
    // compile time (Exclude<EvidenceEntry["result"], "inconclusive">) — this cast
    // on a fresh object literal simulates a caller bypassing that exclusion, the
    // EXACT bypass vector CLI commands assemble flag-derived candidates with (the
    // gap this task closes: only the compile-time exclusion existed before).
    const smuggled = { ...evidence(), result: "inconclusive" } as unknown as EvidenceInput;

    const result = await service.addEvidence(phase.slug, smuggled);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("result");
    expect(result.error.message).toContain("lore verify");
    expect(result.error.value).toBe("inconclusive");
    expect(exitCode(result.error)).toBe(4);
  });
});

describe("PhaseWorkflowService inconclusive guard — BOUNDARY", () => {
  it("the guard fires on `result` alone even when every other field is fully well-formed", async () => {
    const { service, phase } = await makePhaseServices();
    const smuggled = {
      oracle: "test",
      command: "bun test",
      result: "inconclusive",
      recorded_by: "bob",
      output_tail: "some output",
    } as unknown as EvidenceInput;

    const result = await service.addEvidence(phase.slug, smuggled);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("result");
  });
});

describe("PhaseWorkflowService inconclusive guard — ERROR", () => {
  it("the phase doc's version and evidence array are untouched after rejection (direct store re-read)", async () => {
    const { store, service, phase } = await makePhaseServices();
    const smuggled = { ...evidence(), result: "inconclusive" } as unknown as EvidenceInput;

    const rejected = await service.addEvidence(phase.slug, smuggled);
    expect(rejected.ok).toBe(false);

    const after = await store.find(phase.id);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value?.version).toBe(1);
    expect(after.value?.extra["verification_evidence"]).toBeUndefined();
  });
});

describe("PhaseWorkflowService inconclusive guard — STATE (parity with TaskWorkflowService)", () => {
  it("the rejection shape is byte-identical to TaskWorkflowService's own rejection for the same input", async () => {
    // Phase-path rejection
    const { service: phaseService, phase } = await makePhaseServices();
    const phaseSmuggled = { ...evidence(), result: "inconclusive" } as unknown as EvidenceInput;
    const phaseResult = await phaseService.addEvidence(phase.slug, phaseSmuggled);

    // Task-path rejection (mirrors verify-completeness.test.ts's own fixture)
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
    const taskSmuggled = { ...evidence(), result: "inconclusive" } as unknown as EvidenceInput;
    const taskEvidenceResult = await taskWorkflowService.addEvidence(taskResult.value.id, taskSmuggled);

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

describe("PhaseWorkflowService inconclusive guard — REGRESSION", () => {
  it("the pre-existing attestation-smuggling guard on the phase path is unaffected", async () => {
    const { service, phase } = await makePhaseServices();
    const smuggled = {
      ...evidence(),
      attestation: { runner: "bun-spawn", exit_code: 0, duration_ms: 1, timed_out: false },
    } as unknown as EvidenceInput;

    const result = await service.addEvidence(phase.slug, smuggled);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("attestation");
  });
});
