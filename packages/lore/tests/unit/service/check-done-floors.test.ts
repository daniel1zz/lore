/**
 * AC-AP-9 — one copy of the `lore done` floors, returned as data
 * (spec-approval-and-plan-closure-go-through-the-same-checks-on, D5; issue #47).
 *
 * `TaskWorkflowService.checkDoneFloors(taskIdOrSlug)` returns
 * `Result<{ floor, error } | null>`: the first failing floor in `_doneImpl`'s order
 * (not-landed, attested-pass, red-first, unfiltered-test-file, contract-oracles — the floors of
 * the contract stored at approve, AC-DCS1-7) or `null`. `error` is the exact LoreError `done()`
 * returns, plus `details.floor`. The `--override-attestation` branch stays inside `_doneImpl`.
 *
 * A task here is a landed `code` task holding a stored contract (done-contract-unit-fixture.ts):
 * the floors come from that contract, never from the task's live fields (the retired
 * `extra.red_first` / `ac_scope` declarations are not read).
 *
 * Dimensions: NEGATIVE (a-d, not-landed), HAPPY (e), STATE (no writes on refusal), BOUNDARY (g
 * order), REGRESSION (f override stays in done).
 *
 * @spec_ref spec-approval-and-plan-closure-go-through-the-same-checks-on
 */

import { describe, it, expect } from "vitest";
import { alwaysAutoOverridePort } from "../../helpers/always-auto-override-port.js";
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
import { actedStore } from "../../live-invocation.js";

import { fakeWorktreeProbe } from "../../helpers/fake-worktree-probe.js";
import { ensureRequirementsDocId } from "../../helpers/parented-create.js";
import { LANDING_COMMIT, landedPass, landedTaskExtra, testFileCommand, unitDoneContract } from "./done-contract-unit-fixture.js";
type DoneFloorId = "not-landed" | "attested-pass" | "red-first" | "unfiltered-test-file" | "contract-oracles";

/** The data contract of `checkDoneFloors` (spec D5). */
interface WithCheckDoneFloors {
  checkDoneFloors(taskIdOrSlug: string): Promise<Result<{ floor: DoneFloorId; error: LoreError } | null, LoreError>>;
}

function makeServices(wireOverridePort = true) {
  const store = actedStore(new InMemoryStore());
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const taskWorkflowService = new TaskWorkflowService(store, undefined, { claimTtlMinutes: 120 }, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, fakeWorktreeProbe());
  if (wireOverridePort) taskWorkflowService.setOverrideDecisionPort(alwaysAutoOverridePort()); // AU-T7: explicit test port; no port = refused
  const floors = taskWorkflowService as unknown as WithCheckDoneFloors;
  return { store, corpusService, taskWorkflowService, floors };
}

type Services = ReturnType<typeof makeServices>;

async function createTask(s: Services, title: string, extra: Record<string, unknown> = {}): Promise<string> {
  const plan = await s.corpusService.create({ parent_id: await ensureRequirementsDocId(s.corpusService), type: "plan", title: `${title} Plan`, content: "body" } as CreateDocInput);
  if (!plan.ok) throw new Error(`plan create failed: ${JSON.stringify(plan.error)}`);
  const task = await s.corpusService.create({
    type: "task",
    title,
    parent_id: plan.value.id,
    content: "body",
    extra: { plan_id: plan.value.id, ...landedTaskExtra(), ...extra },
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
    // reason: AC-DCS1-27 (b) — a pass counts for a code oracle when it names the landing it was recorded for.
    attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1, timed_out: false, recorded_at_landing: LANDING_COMMIT },
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

  it("(b) red-first: a contract with red_required and no red run -> floor red-first, same error from done(), no writes", async () => {
    const s = makeServices();
    const taskId = await createTask(s, "Floor B", landedTaskExtra({ redRequired: true }));
    await addAttested(s, taskId);
    await expectFloorThenDoneMatches(s, taskId, "red-first");
  });

  it("(c) contract-oracles: a counted pass of some other command, typecheck oracle unmet -> floor contract-oracles, same error, no writes", async () => {
    const s = makeServices();
    const taskId = await createTask(s, "Floor C");
    // reason: an attested pass that counts (it names the landing) but ran a command that is not the contract's typecheck oracle,
    // so the attested-pass floor is met and the oracle floor is what refuses.
    const written = await s.taskWorkflowService.recordVerifiedEvidence(taskId, landedPass("bun run lint"), "2026-10-12T09:00:00.000Z");
    expect(written.ok).toBe(true);
    await expectFloorThenDoneMatches(s, taskId, "contract-oracles");
  });

  it("(c2) not-landed: a task claimed on a branch the probe cannot measure -> floor not-landed, same error, no writes", async () => {
    const s = makeServices();
    const taskId = await createTask(s, "Floor C2");
    await addAttested(s, taskId);
    const claimed = await s.taskWorkflowService.claim(taskId, { by: "alice", worktree: "wt-unmeasured" });
    expect(claimed.ok).toBe(true);
    await expectFloorThenDoneMatches(s, taskId, "not-landed");
  });

  it("(d) unfiltered-test-file: a contract test-file oracle with no unfiltered pass run -> floor unfiltered-test-file, same error, no writes", async () => {
    const s = makeServices();
    const FILE = "packages/lore/tests/unit/service/check-done-floors.test.ts";
    const taskId = await createTask(s, "Floor D", landedTaskExtra({ redRequired: true, testFiles: [FILE] }));
    await addAttested(s, taskId);
    await addEvidence(s, taskId, runnerCapturedFail());
    // a pass narrowed to one case is never the unfiltered run (the contract's own command is exact)
    const narrowed = await s.taskWorkflowService.recordVerifiedEvidence(taskId, landedPass(`${testFileCommand(FILE)} -t "case"`), "2026-10-12T09:00:00.000Z");
    expect(narrowed.ok).toBe(true);
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

  it("override port required: --override-attestation with NO override port wired is refused loudly and nothing is archived", async () => {
    const s = makeServices(false);
    // reason: the override port is consulted when the override is consumed, after every floor that follows the attested-pass
    // floor has passed, so the contract here holds no oracle for those floors to judge.
    const taskId = await createTask(s, "Floor F no port", { done_contract: { ...unitDoneContract(), oracles: [] } });
    await addEvidence(s, taskId, runnerCapturedPass());
    const done = await s.taskWorkflowService.done(taskId, { by: "alice", overrideReason: "manual browser check: verified in staging" });
    expect(done.ok).toBe(false);
    if (!done.ok) expect(done.error).toMatchObject({ code: "VALIDATION_ERROR", field: "autonomy" });
    const after = await s.store.find(taskId as never);
    expect(after.ok && after.value?.status).not.toBe("archived");
  });

  it("(f) REGRESSION: --override-attestation with a reason still archives an unattested task with the audited reason", async () => {
    const s = makeServices();
    // reason: the override waives only the attested-pass floor; the oracle floors still judge every contract oracle, so the
    // archive path is exercised with a contract that holds no oracle (see the refusal case below).
    const taskId = await createTask(s, "Floor F", { done_contract: { ...unitDoneContract(), oracles: [] } });
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

  it("(f2) NEGATIVE: --override-attestation never waives a contract oracle -> refused [floor: contract-oracles], nothing archived", async () => {
    const s = makeServices();
    const taskId = await createTask(s, "Floor F2");
    await addEvidence(s, taskId, runnerCapturedPass());

    const done = await s.taskWorkflowService.done(taskId, { by: "alice", overrideReason: "manual browser check: verified in staging" });
    expect(done.ok).toBe(false);
    if (done.ok) return;
    expect(detailsFloor(done.error)).toBe("contract-oracles");
    expect(done.error).toMatchObject({ code: "VALIDATION_ERROR" });
    const after = await s.store.find(taskId as never);
    expect(after.ok && after.value?.status).not.toBe("archived");
  });

  it("(g) order: a task failing both attested-pass and red-first reports attested-pass", async () => {
    const s = makeServices();
    const taskId = await createTask(s, "Floor G", landedTaskExtra({ redRequired: true }));
    await addEvidence(s, taskId, runnerCapturedPass());

    const checked = await s.floors.checkDoneFloors(taskId);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.value?.floor).toBe("attested-pass");
    expect(detailsFloor(checked.value?.error as LoreError)).toBe("attested-pass");
  });
});
