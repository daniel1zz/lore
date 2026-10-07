/**
 * PhaseWorkflowService._addEvidenceImpl refuses caller-supplied `head_sha` /
 * `worktree_dirty` (baseline slice 1 §C5, task c5b) — the parallel phase evidence
 * path [C5] reported unguarded. Reuses the exported `rejectCallerGitStamp`.
 *
 * Six-dimension coverage:
 *   HAPPY      — evidence without the fields is accepted (control)
 *   NEGATIVE   — top-level head_sha / worktree_dirty refused, naming the field
 *   BOUNDARY   — the same fields inside `capture_attestation` refused
 *   ERROR      — refusal leaves the phase doc untouched (no row written)
 *   STATE      — refusal equals the shared guard's own output
 *
 * @spec_ref AC-BLS1-4
 */

import { describe, it, expect } from "vitest";
import { NoOpTelemetry } from "@lore/core";
import type { DocRecord, DocType } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { PhaseWorkflowService } from "../../../src/service/phase-workflow-service.js";
import { rejectCallerGitStamp, type EvidenceInput } from "../../../src/service/task-workflow-service.js";

const PLAN_ID = "01HPLAN000000000000000GIT";
const PHASE_ID = "01HPHASEGITSTAMP00000001";
const PHASE_SLUG = "phase-git-stamp";

function planRecord(): DocRecord {
  return {
    id: PLAN_ID,
    slug: "plan-git-stamp",
    type: "plan",
    role: "plan",
    title: "Plan Git Stamp",
    status: "approved",
    priority: "medium",
    content: "# Plan",
    parent_id: null,
    created_at: "2026-10-07T00:00:00.000Z",
    updated_at: "2026-10-07T00:00:00.000Z",
    created_by: "system",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
  };
}

function phaseRecord(): DocRecord {
  return {
    id: PHASE_ID,
    slug: PHASE_SLUG,
    type: "phase" as unknown as DocType,
    role: "plan",
    title: "Phase Git Stamp",
    status: "draft",
    priority: "medium",
    content: "# Phase",
    parent_id: PLAN_ID,
    created_at: "2026-10-07T00:00:00.000Z",
    updated_at: "2026-10-07T00:00:00.000Z",
    created_by: "system",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: { plan_id: PLAN_ID },
  };
}

function evidence(extra: Record<string, unknown> = {}): EvidenceInput {
  return {
    oracle: "tsc",
    command: "bun run typecheck",
    result: "pass",
    recorded_by: "alice",
    capture_source: "self-report",
    ...extra,
  } as unknown as EvidenceInput;
}

async function setup() {
  const store = new InMemoryStore();
  const service = new PhaseWorkflowService(store, new NoOpTelemetry(), { claimTtlMinutes: 120 });
  for (const doc of [planRecord(), phaseRecord()]) {
    const r = await store.insert(doc);
    if (!r.ok) throw new Error(`insert failed: ${JSON.stringify(r.error)}`);
  }
  return { store, service };
}

async function expectRefusedAndUntouched(input: EvidenceInput, field: string) {
  const { store, service } = await setup();
  const result = await service.addEvidence(PHASE_SLUG, input);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.code).toBe("VALIDATION_ERROR");
  if (result.error.code !== "VALIDATION_ERROR") return;
  expect(result.error.field).toBe(field);
  expect(result.error.message).toContain(field);
  const after = await store.find(PHASE_ID);
  expect(after.ok).toBe(true);
  if (!after.ok) return;
  expect(after.value?.version).toBe(1);
  expect(after.value?.extra["verification_evidence"]).toBeUndefined();
}

describe("phase addEvidence git stamp — HAPPY (control)", () => {
  it("evidence without head_sha / worktree_dirty is accepted", async () => {
    const { service } = await setup();
    const result = await service.addEvidence(PHASE_SLUG, evidence());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.extra["verification_evidence"]).toHaveLength(1);
  });
});

describe("phase addEvidence git stamp — NEGATIVE", () => {
  it("refuses a caller-supplied head_sha", async () => {
    await expectRefusedAndUntouched(evidence({ head_sha: "a".repeat(40) }), "head_sha");
  });
  it("refuses a caller-supplied worktree_dirty", async () => {
    await expectRefusedAndUntouched(evidence({ worktree_dirty: false }), "worktree_dirty");
  });
});

describe("phase addEvidence git stamp — BOUNDARY (capture_attestation)", () => {
  it("refuses head_sha inside capture_attestation", async () => {
    await expectRefusedAndUntouched(
      evidence({ capture_attestation: { exit_code: 0, head_sha: "b".repeat(40) } }),
      "head_sha",
    );
  });
  it("refuses worktree_dirty inside capture_attestation", async () => {
    await expectRefusedAndUntouched(
      evidence({ capture_attestation: { exit_code: 0, worktree_dirty: true } }),
      "worktree_dirty",
    );
  });
});

describe("phase addEvidence git stamp — STATE (shared guard)", () => {
  it("the refusal equals rejectCallerGitStamp's own output", async () => {
    const { service } = await setup();
    const input = evidence({ head_sha: "c".repeat(40) });
    const result = await service.addEvidence(PHASE_SLUG, input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual(rejectCallerGitStamp(input));
  });
});
