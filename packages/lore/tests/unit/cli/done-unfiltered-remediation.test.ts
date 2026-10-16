/**
 * AC-CRIT-10 — spec-close-the-eight-verified-critical-defects-no-judge-listing §Design F7:
 * `lore done`'s unfiltered-test-file floor honors a `lore verify` row's attested
 * `execution_root`, and its refusal names only routes that actually pass the floor.
 *
 * Coverage: HAPPY / NEGATIVE / STATE / REGRESSION
 */
import { describe, it, expect } from "vitest";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { TaskWorkflowService, type VerifiedEvidenceInput } from "../../../src/service/task-workflow-service.js";
import type { CreateDocInput } from "@lore/core";

const ANCHOR = "packages/lore/tests/unit/x.bun.test.ts";

async function setup() {
  const store = new InMemoryStore();
  const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const svc = new TaskWorkflowService(store, undefined, { claimTtlMinutes: 120 });
  const plan = await cs.create({ type: "plan", title: "P", content: "b" } as CreateDocInput);
  if (!plan.ok) throw new Error("plan");
  const task = await cs.create({
    type: "task",
    title: "T",
    parent_id: plan.value.id,
    content: "b",
    extra: { plan_id: plan.value.id, file_anchors: [ANCHOR] },
  } as CreateDocInput);
  if (!task.ok) throw new Error("task");
  return { svc, taskId: task.value.id };
}

function verifyRow(command: string, executionRoot?: string): VerifiedEvidenceInput {
  return {
    oracle: "test",
    command,
    result: "pass",
    recorded_by: "runner",
    capture_source: "runner",
    attestation: {
      runner: "lore-cli",
      exit_code: 0,
      duration_ms: 1,
      timed_out: false,
      ...(executionRoot !== undefined ? { execution_root: executionRoot, execution_mode: "worktree" as const } : {}),
    },
  };
}

describe("AC-CRIT-10 done honors attestation.execution_root", () => {
  it("HAPPY: a verify pass row with execution_root=packages/lore clears the unfiltered floor", async () => {
    const { svc, taskId } = await setup();
    await svc.recordVerifiedEvidence(taskId, verifyRow("bun test tests/unit/x.bun.test.ts", "packages/lore"), "2026-10-16T00:00:00.000Z");
    const done = await svc.done(taskId, { by: "alice" });    expect(done.ok).toBe(true);
  });

  it("NEGATIVE: the same row without execution_root is refused, and the refusal names only passing routes", async () => {
    const { svc, taskId } = await setup();
    await svc.recordVerifiedEvidence(taskId, verifyRow("bun test tests/unit/x.bun.test.ts"), "2026-10-16T00:00:00.000Z");
    const done = await svc.done(taskId, { by: "alice" });
    expect(done.ok).toBe(false);
    if (done.ok || done.error.code !== "VALIDATION_ERROR") throw new Error("expected VALIDATION_ERROR");
    const message = done.error.message;
    expect(message).toContain(ANCHOR);
    expect(message).toContain("lore verify --execution-root");
    // No self-reported '--result pass' route (a self-report never satisfies the attested floor).
    expect(message).not.toMatch(/--result pass(?![^`]*--capture)/);
  });

  it("REGRESSION: a root-relative unfiltered command still passes with no execution_root", async () => {
    const { svc, taskId } = await setup();
    await svc.recordVerifiedEvidence(taskId, verifyRow(`bun test ${ANCHOR}`), "2026-10-16T00:00:00.000Z");
    expect((await svc.done(taskId, { by: "alice" })).ok).toBe(true);
  });
});
