/**
 * AC-AP-9 — one copy of the `lore done` floors, returned as data
 * (spec-approval-and-plan-closure-go-through-the-same-checks-on, D5; issue #47).
 *
 * `TaskWorkflowService.checkDoneFloors(taskIdOrSlug)` returns
 * `Result<{ floor, error } | null>`: the first failing floor in `_doneImpl`'s order
 * (attested-pass, red-first, no-new-tests, unfiltered-test-file) or `null`. `error` is
 * the exact LoreError `done()` returns, plus `details.floor`. The
 * `--override-attestation` branch stays inside `_doneImpl`.
 *
 * RED STATE: `checkDoneFloors` does not exist yet (the paired implement task adds
 * it). Cases (a)-(e) and (g) therefore fail at the call `checkDoneFloors is not a
 * function` — a TypeError that is acceptable ONLY because it is that one missing
 * method. Case (f) is a REGRESSION guard on the override path; its first half also
 * calls the missing method.
 *
 * Dimensions: NEGATIVE (a-d), HAPPY (e), STATE (no writes on refusal), BOUNDARY (g
 * order), REGRESSION (f override stays in done).
 *
 * @spec_ref spec-approval-and-plan-closure-go-through-the-same-checks-on
 */

import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import {
  TaskWorkflowService,
  type EvidenceInput,
  type VerifiedEvidenceInput,
} from "../../../src/service/task-workflow-service.js";
import type { CreateDocInput, LoreError, Result } from "@lore/core";

type DoneFloorId = "attested-pass" | "red-first" | "no-new-tests" | "unfiltered-test-file";

/** The contract the paired task adds (spec D5). Cast: the method does not exist yet. */
interface WithCheckDoneFloors {
  checkDoneFloors(taskIdOrSlug: string): Promise<Result<{ floor: DoneFloorId; error: LoreError } | null, LoreError>>;
}

function makeServices() {
  const store = new InMemoryStore();
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const taskWorkflowService = new TaskWorkflowService(store, undefined, { claimTtlMinutes: 120 });
  const floors = taskWorkflowService as unknown as WithCheckDoneFloors;
  return { store, corpusService, taskWorkflowService, floors };
}

type Services = ReturnType<typeof makeServices>;

async function createTask(s: Services, title: string, extra: Record<string, unknown> = {}): Promise<string> {
  const plan = await s.corpusService.create({ type: "plan", title: `${title} Plan`, content: "body" } as CreateDocInput);
  if (!plan.ok) throw new Error(`plan create failed: ${JSON.stringify(plan.error)}`);
  const task = await s.corpusService.create({
    type: "task",
    title,
    parent_id: plan.value.id,
    content: "body",
    extra: { plan_id: plan.value.id, ...extra },
  } as CreateDocInput);
  if (!task.ok) throw new Error(`task create failed: ${JSON.stringify(task.error)}`);
  return task.value.id;
}

function attestedPass(): VerifiedEvidenceInput {
  return {
    oracle: "tsc",
    command: "bun run typecheck",
    result: "pass",
    recorded_by: "runner",
    capture_source: "runner",
    attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1, timed_out: false },
  };
}

function runnerCapturedPass(): EvidenceInput {
  return {
    oracle: "test",
    command: "bunx vitest run packages/lore/tests/unit/service/check-done-floors.test.ts",
    result: "pass",
    recorded_by: "agent:check-done-floors",
    output_tail: "Test Files  1 passed (1)",
    capture_source: "runner",
  };
}

function runnerCapturedFail(): EvidenceInput {
  return { ...runnerCapturedPass(), result: "fail", output_tail: "AssertionError: expected 1 to be 2" };
}

async function addAttested(s: Services, taskId: string): Promise<void> {
  const r = await s.taskWorkflowService.recordVerifiedEvidence(taskId, attestedPass(), "2026-10-12T09:00:00.000Z");
  if (!r.ok) throw new Error(`attested evidence failed: ${JSON.stringify(r.error)}`);
}

async function addEvidence(s: Services, taskId: string, row: EvidenceInput): Promise<void> {
  const r = await s.taskWorkflowService.addEvidence(taskId, row);
  if (!r.ok) throw new Error(`evidence failed: ${JSON.stringify(r.error)}`);
}

async function snapshotWrites(s: Services, taskId: string): Promise<{ versions: number; audits: number }> {
  const versions = await s.store.findVersions(taskId as never);
  const audits = await s.store.queryAudit({ doc_id: taskId as never });
  if (!versions.ok || !audits.ok) throw new Error("snapshot read failed");
  return { versions: versions.value.length, audits: audits.value.length };
}

function detailsFloor(error: LoreError): unknown {
  return (error as unknown as { details?: { floor?: unknown } }).details?.floor;
}

/**
 * Shared body of cases (a)-(d): checkDoneFloors names the floor, its error carries
 * details.floor, done() returns a deep-equal error, and neither call writes.
 */
async function expectFloorThenDoneMatches(s: Services, taskId: string, floor: DoneFloorId): Promise<void> {
  const before = await snapshotWrites(s, taskId);

  const checked = await s.floors.checkDoneFloors(taskId);
  expect(checked.ok).toBe(true);
  if (!checked.ok) return;
  expect(checked.value).not.toBeNull();
  if (checked.value === null) return;
  expect(checked.value.floor).toBe(floor);
  expect(detailsFloor(checked.value.error)).toBe(floor);
  expect(checked.value.error.code).toBe("VALIDATION_ERROR");

  const done = await s.taskWorkflowService.done(taskId, { by: "alice" });
  expect(done.ok).toBe(false);
  if (done.ok) return;
  // byte-identical: done() returns checkDoneFloors' error, details.floor included
  expect(done.error).toEqual(checked.value.error);

  expect(await snapshotWrites(s, taskId)).toEqual(before);
  const after = await s.corpusService.get(taskId);
  expect(after.ok).toBe(true);
  if (after.ok) expect(after.value.doc.status).toBe("draft");
}

describe("AC-AP-9 checkDoneFloors contract and byte-identical done refusals", () => {
  it("(a) attested-pass: no attested pass -> floor attested-pass, done() returns the same error, no writes", async () => {
    const s = makeServices();
    const taskId = await createTask(s, "Floor A");
    await addEvidence(s, taskId, runnerCapturedPass());
    await expectFloorThenDoneMatches(s, taskId, "attested-pass");
  });

  it("(b) red-first: declared red_first without a red run -> floor red-first, same error from done(), no writes", async () => {
    const s = makeServices();
    const taskId = await createTask(s, "Floor B", { red_first: true });
    await addAttested(s, taskId);
    await expectFloorThenDoneMatches(s, taskId, "red-first");
  });

  it("(c) no-new-tests: declared ac_scope [] without a red run or declaration -> floor no-new-tests, same error, no writes", async () => {
    const s = makeServices();
    const taskId = await createTask(s, "Floor C", { ac_scope: [] });
    await addAttested(s, taskId);
    await expectFloorThenDoneMatches(s, taskId, "no-new-tests");
  });

  it("(d) unfiltered-test-file: test-file anchor with no unfiltered pass run -> floor unfiltered-test-file, same error, no writes", async () => {
    const s = makeServices();
    const taskId = await createTask(s, "Floor D", {
      file_anchors: ["packages/lore/tests/unit/service/check-done-floors.test.ts"],
      red_first: true,
    });
    await addAttested(s, taskId);
    await addEvidence(s, taskId, runnerCapturedFail());
    await expectFloorThenDoneMatches(s, taskId, "unfiltered-test-file");
  });

  it("(e) a task meeting every floor gets null, and done() archives it", async () => {
    const s = makeServices();
    const taskId = await createTask(s, "Floor E");
    await addAttested(s, taskId);

    const checked = await s.floors.checkDoneFloors(taskId);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.value).toBeNull();

    const done = await s.taskWorkflowService.done(taskId, { by: "alice" });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.value.transitions).toEqual(["approved", "active", "archived"]);
  });

  it("(f) REGRESSION: --override-attestation with a reason still archives an unattested task with the audited reason", async () => {
    const s = makeServices();
    const taskId = await createTask(s, "Floor F");
    await addEvidence(s, taskId, runnerCapturedPass());

    // checkDoneFloors never reads the override: the unattested task still reports the floor.
    const checked = await s.floors.checkDoneFloors(taskId);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.value?.floor).toBe("attested-pass");

    const REASON = "manual browser check: verified in staging";
    const done = await s.taskWorkflowService.done(taskId, { by: "alice", overrideReason: REASON });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.value.task.status).toBe("archived");

    const audit = await s.store.queryAudit({ doc_id: taskId as never });
    expect(audit.ok).toBe(true);
    if (!audit.ok) return;
    const doneSteps = audit.value.filter((e) => e.details?.["done"] === true);
    expect(doneSteps.length).toBeGreaterThan(0);
    expect(doneSteps.every((e) => e.details?.["override_reason"] === REASON)).toBe(true);
  });

  it("(g) order: a task failing both attested-pass and red-first reports attested-pass", async () => {
    const s = makeServices();
    const taskId = await createTask(s, "Floor G", { red_first: true });
    await addEvidence(s, taskId, runnerCapturedPass());

    const checked = await s.floors.checkDoneFloors(taskId);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.value?.floor).toBe("attested-pass");
    expect(detailsFloor(checked.value?.error as LoreError)).toBe("attested-pass");
  });
});
