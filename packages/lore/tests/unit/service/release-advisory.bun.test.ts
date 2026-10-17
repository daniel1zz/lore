/**
 * Tests for `lore release`'s zero-evidence advisory (spec claim-time-actor-
 * identity-guard-zero-evidence-release-advis, AC-RELEASE-ADVISORY) — the pure
 * `hasZeroReleaseEvidence`/`ZERO_EVIDENCE_RELEASE_WARNING` exports
 * (`task-workflow-service.ts`) and `TaskWorkflowService.release`'s own
 * unchanged `Result<DocRecord, LoreError>` contract, against an
 * `InMemoryStore`.
 *
 * Runner: `bun test` (declared oracle file per the governing spec's AC verify
 * command) — no `bun:sqlite` dependency here (`InMemoryStore` only), same
 * precedent `actor-identity-guard.bun.test.ts` documents.
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      a task released with ZERO verification_evidence entries →
 *               `hasZeroReleaseEvidence` reports `true` on the returned doc
 *   NEGATIVE:   a task released with >=1 evidence entry →
 *               `hasZeroReleaseEvidence` reports `false`
 *   BOUNDARY:   exactly 1 evidence entry (the boundary between zero and
 *               non-zero) → `false`; a task whose `verification_evidence` is
 *               malformed (fails schema) → treated identically to absent (`true`)
 *   ERROR:      n/a — `hasZeroReleaseEvidence` has no ERROR path (a pure read)
 *   STATE:      `release()` itself does NOT touch `extra.verification_evidence`
 *               — the array is byte-identical before/after release, so the
 *               advisory is computed from data `release()` already returns,
 *               zero extra store calls (spec §Design Notes)
 *   REGRESSION: `release()`'s own `Result<DocRecord, LoreError>` return shape
 *               is UNCHANGED — `.value` is the DocRecord directly (`.slug`,
 *               `.version`, `.extra` all reachable with no wrapper), so every
 *               pre-existing caller of `TaskWorkflowService.release` keeps
 *               working unmodified; a phase doc (same `extra` shape) is
 *               equally covered by `hasZeroReleaseEvidence` (adapter-level
 *               reuse, not re-derived per doc type)
 *
 * @spec_ref spec-claim-time-actor-identity-guard-zero-evidence-release-advis
 *   AC-RELEASE-ADVISORY
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import {
  TaskWorkflowService,
  hasZeroReleaseEvidence,
  ZERO_EVIDENCE_RELEASE_WARNING,
  type EvidenceInput,
} from "../../../src/service/task-workflow-service.js";
import type { CreateDocInput, DocRecord } from "@lore/core";

// ─── Fixtures ────────────────────────────────────────────────────────────────

async function mustCreate(cs: CorpusService, input: CreateDocInput): Promise<DocRecord> {
  const result = await cs.create(input);
  if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

function makeServices() {
  const store = new InMemoryStore();
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const taskWorkflowService = new TaskWorkflowService(store, undefined, { claimTtlMinutes: 120 });
  return { store, corpusService, taskWorkflowService };
}

async function createPlanAndTask(cs: CorpusService): Promise<{ planId: string; taskId: string }> {
  const plan = await mustCreate(cs, { type: "plan", title: "Plan", content: "# Plan" } as CreateDocInput);
  const task = await mustCreate(cs, {
    type: "task",
    title: "Task",
    parent_id: plan.id,
    content: "# Task",
    extra: { plan_id: plan.id },
  } as CreateDocInput);
  return { planId: plan.id, taskId: task.id };
}

// reason: SUPERSEDED default oracle (task-raise-the-evidence-tail-guard-s-
// predicate-to-its-own, D5) — was "tsc", now "manual". rejectMissingPass
// OutputTail's D5 raise refuses a self-reported "pass" for every OTHER
// oracle kind regardless of tail content; "manual" is the one kind that
// still lets a genuinely non-empty self-reported tail succeed, which is all
// this fixture's callers need (none of them test the tail guard itself).
function evidence(overrides: Partial<EvidenceInput> = {}): EvidenceInput {
  return {
    oracle: "manual",
    command: "bun run typecheck",
    result: "pass",
    recorded_by: "alice",
    output_tail: "ok",
    // reason: task-capture-source-is-optional-at-the-evidence-write-boundary —
    // now compile-time-required on EvidenceInput.
    capture_source: "self-report",
    ...overrides,
  };
}

// ─── Pure hasZeroReleaseEvidence unit tests ────────────────────────────────────

describe("hasZeroReleaseEvidence (pure)", () => {
  // HAPPY — absent verification_evidence
  it("returns true when extra.verification_evidence is absent entirely", () => {
    const doc = { extra: {} } as DocRecord;
    expect(hasZeroReleaseEvidence(doc)).toBe(true);
  });

  it("returns true when extra.verification_evidence is an empty array", () => {
    const doc = { extra: { verification_evidence: [] } } as unknown as DocRecord;
    expect(hasZeroReleaseEvidence(doc)).toBe(true);
  });

  // BOUNDARY — malformed evidence (fails schema) treated identically to absent
  it("returns true when extra.verification_evidence is malformed (fails schema safeParse)", () => {
    const doc = { extra: { verification_evidence: [{ not: "a valid entry" }] } } as unknown as DocRecord;
    expect(hasZeroReleaseEvidence(doc)).toBe(true);
  });

  it("returns true when extra.verification_evidence is not an array at all", () => {
    const doc = { extra: { verification_evidence: "oops" } } as unknown as DocRecord;
    expect(hasZeroReleaseEvidence(doc)).toBe(true);
  });

  // NEGATIVE / BOUNDARY — exactly 1 valid entry
  it("returns false when extra.verification_evidence carries exactly 1 valid entry", () => {
    const doc = {
      extra: {
        verification_evidence: [
          { oracle: "tsc", command: "bun run typecheck", result: "pass", recorded_at: "T0", recorded_by: "alice" },
        ],
      },
    } as unknown as DocRecord;
    expect(hasZeroReleaseEvidence(doc)).toBe(false);
  });

  // NEGATIVE — multiple entries
  it("returns false when extra.verification_evidence carries multiple entries", () => {
    const doc = {
      extra: {
        verification_evidence: [
          { oracle: "tsc", command: "bun run typecheck", result: "pass", recorded_at: "T0", recorded_by: "alice" },
          { oracle: "test", command: "bun test", result: "fail", recorded_at: "T1", recorded_by: "alice" },
        ],
      },
    } as unknown as DocRecord;
    expect(hasZeroReleaseEvidence(doc)).toBe(false);
  });
});

// ─── ZERO_EVIDENCE_RELEASE_WARNING — SSOT string, non-empty ────────────────────

describe("ZERO_EVIDENCE_RELEASE_WARNING", () => {
  it("is a non-empty, human-readable advisory string", () => {
    expect(typeof ZERO_EVIDENCE_RELEASE_WARNING).toBe("string");
    expect(ZERO_EVIDENCE_RELEASE_WARNING.length).toBeGreaterThan(0);
    expect(ZERO_EVIDENCE_RELEASE_WARNING).toContain("zero verification evidence");
  });
});

// ─── Service-level integration: TaskWorkflowService.release() ─────────────────

describe("TaskWorkflowService.release — zero-evidence advisory wiring (AC-RELEASE-ADVISORY)", () => {
  // HAPPY — AC-RELEASE-ADVISORY primary scenario: release exits ok, advisory computed true
  it("release()'s returned doc reports hasZeroReleaseEvidence=true for a never-evidenced task", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const { taskId } = await createPlanAndTask(corpusService);

    const claimResult = await taskWorkflowService.claim(taskId, { by: "alice" });
    expect(claimResult.ok).toBe(true);

    const releaseResult = await taskWorkflowService.release(taskId, { by: "alice" });
    expect(releaseResult.ok).toBe(true);
    if (!releaseResult.ok) return;
    // REGRESSION — the return value IS the DocRecord directly, not a wrapper.
    expect(releaseResult.value.slug).toBeDefined();
    expect(releaseResult.value.extra["claim"]).toBeUndefined();
    expect(hasZeroReleaseEvidence(releaseResult.value)).toBe(true);
  });

  // NEGATIVE — a task released with >=1 PASSING evidence entry → advisory false
  it("release()'s returned doc reports hasZeroReleaseEvidence=false when >=1 evidence was recorded", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const { taskId } = await createPlanAndTask(corpusService);

    await taskWorkflowService.claim(taskId, { by: "alice" });
    const evidenceResult = await taskWorkflowService.addEvidence(taskId, evidence());
    expect(evidenceResult.ok).toBe(true);

    const releaseResult = await taskWorkflowService.release(taskId, { by: "alice" });
    expect(releaseResult.ok).toBe(true);
    if (!releaseResult.ok) return;
    expect(hasZeroReleaseEvidence(releaseResult.value)).toBe(false);
  });

  // NEGATIVE — a FAILING evidence entry still counts as "evidence recorded" (the
  // advisory is about absence of any oracle record, not about pass/fail outcome)
  it("a FAILING evidence entry still counts — the advisory is about absence, not outcome", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const { taskId } = await createPlanAndTask(corpusService);

    await taskWorkflowService.claim(taskId, { by: "alice" });
    await taskWorkflowService.addEvidence(
      taskId,
      evidence({ result: "fail", output_tail: "AssertionError: expected 1 to equal 2" }),
    );

    const releaseResult = await taskWorkflowService.release(taskId, { by: "alice" });
    expect(releaseResult.ok).toBe(true);
    if (!releaseResult.ok) return;
    expect(hasZeroReleaseEvidence(releaseResult.value)).toBe(false);
  });

  // STATE — release() does not touch verification_evidence: the array is byte-
  // identical before and after release (zero extra store calls to compute the advisory)
  it("release() never mutates extra.verification_evidence", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const { taskId } = await createPlanAndTask(corpusService);

    await taskWorkflowService.claim(taskId, { by: "alice" });
    const evidenceResult = await taskWorkflowService.addEvidence(taskId, evidence());
    expect(evidenceResult.ok).toBe(true);
    if (!evidenceResult.ok) return;
    const beforeRelease = evidenceResult.value.extra["verification_evidence"];

    const releaseResult = await taskWorkflowService.release(taskId, { by: "alice" });
    expect(releaseResult.ok).toBe(true);
    if (!releaseResult.ok) return;
    expect(releaseResult.value.extra["verification_evidence"]).toEqual(beforeRelease);
  });

  // REGRESSION — release() is advisory-only: it exits ok even with zero evidence,
  // never a hard block (SPEC-025 evidence discipline stays prompt-enforced only).
  it("release() exits ok (never blocks) regardless of evidence state", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const { taskId } = await createPlanAndTask(corpusService);

    await taskWorkflowService.claim(taskId, { by: "alice" });
    const releaseResult = await taskWorkflowService.release(taskId, { by: "alice" });
    expect(releaseResult.ok).toBe(true);
  });

  // REGRESSION — a --force release by a non-holder is unaffected by this change
  it("a --force release by a non-holder still works, and the advisory still computes correctly", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const { taskId } = await createPlanAndTask(corpusService);

    await taskWorkflowService.claim(taskId, { by: "alice" });
    const releaseResult = await taskWorkflowService.release(taskId, { by: "bob", force: true });
    expect(releaseResult.ok).toBe(true);
    if (!releaseResult.ok) return;
    expect(hasZeroReleaseEvidence(releaseResult.value)).toBe(true);
  });
});
