/**
 * AC-CRIT-10 — spec-close-the-eight-verified-critical-defects-no-judge-listing §Design F7, under the done-contract model
 * (spec-done-contract-compiled-at-approve-task-kinds-write-sets, AC-DCS1-7, AC-DCS1-27): `lore done`'s unfiltered-test-file floor
 * and its refusal's remediation.
 *
 * The floor no longer reads the task's anchors and no longer widens a root-relative command by a `lore verify` row's attested
 * `execution_root`: every anchored test file is a `test:<path>` oracle of the stored contract, run by the contract's own exact
 * command, and a row counts for it only when it ran EXACTLY that command and is bound to the landed code. So:
 *   - a row of the contract's exact command clears the floor, whatever `execution_root` it records;
 *   - a root-relative command that only an `execution_root` made equivalent (the retired widening) does NOT clear it;
 *   - the refusal names the oracle, its exact command, and only routes that actually pass the floor.
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
import { actedStore } from "../../live-invocation.js";

import { fakeWorktreeProbe } from "../../helpers/fake-worktree-probe.js";
import { ensureRequirementsDocId } from "../../helpers/parented-create.js";
import { landedPass, landedTaskExtra, testFileCommand } from "../service/done-contract-unit-fixture.js";
const ANCHOR = "packages/lore/tests/unit/x.bun.test.ts";

const REPO_ROOT = "/work/repo";

async function setup() {
  const store = actedStore(new InMemoryStore());
  const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const svc = new TaskWorkflowService(store, undefined, { claimTtlMinutes: 120, repoRoot: REPO_ROOT }, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, fakeWorktreeProbe());
  const plan = await cs.create({ parent_id: await ensureRequirementsDocId(cs), type: "plan", title: "P", content: "b" } as CreateDocInput);
  if (!plan.ok) throw new Error("plan");
  const task = await cs.create({
    type: "task",
    title: "T",
    parent_id: plan.value.id,
    content: "b",
    // reason: the anchored test file is a `test:<path>` oracle of the stored contract (AC-DCS1-1); a landed code task.
    extra: { plan_id: plan.value.id, ...landedTaskExtra({ testFiles: [ANCHOR] }) },
  } as CreateDocInput);
  if (!task.ok) throw new Error("task");
  // the typecheck oracle always has its counted pass here, so the test-file oracle alone decides
  await svc.recordVerifiedEvidence(task.value.id, landedPass(), "2026-10-16T00:00:00.000Z");
  return { store, svc, taskId: task.value.id };
}

function verifyRow(command: string, executionRoot?: string): VerifiedEvidenceInput {
  const base = landedPass(command);
  return {
    ...base,
    attestation: {
      ...(base.attestation as NonNullable<VerifiedEvidenceInput["attestation"]>),
      ...(executionRoot !== undefined ? { execution_root: executionRoot, execution_mode: "worktree" as const } : {}),
    },
  };
}

describe("AC-CRIT-10 done judges the contract's exact test-file command, never an execution_root widening", () => {
  it("HAPPY: a verify pass row of the contract's exact command clears the unfiltered floor whatever execution_root it records", async () => {
    const { svc, taskId } = await setup();
    await svc.recordVerifiedEvidence(taskId, verifyRow(testFileCommand(ANCHOR), "packages/lore"), "2026-10-16T00:00:00.000Z");
    const done = await svc.done(taskId, { by: "alice" });
    expect(done.ok).toBe(true);
  });

  it("HAPPY: an ABSOLUTE root inside the repo changes nothing — the exact command is what counts", async () => {
    const { svc, taskId } = await setup();
    await svc.recordVerifiedEvidence(taskId, verifyRow(testFileCommand(ANCHOR), `${REPO_ROOT}/packages/lore`), "2026-10-16T00:00:00.000Z");
    expect((await svc.done(taskId, { by: "alice" })).ok).toBe(true);
  });

  it("NEGATIVE: a root-relative command that only an execution_root made equivalent (the retired widening) is refused [floor: unfiltered-test-file]", async () => {
    const { svc, taskId } = await setup();
    await svc.recordVerifiedEvidence(taskId, verifyRow("bun test tests/unit/x.bun.test.ts", "packages/lore"), "2026-10-16T00:00:00.000Z");
    const done = await svc.done(taskId, { by: "alice" });
    expect(done.ok).toBe(false);
    if (done.ok || done.error.code !== "VALIDATION_ERROR") throw new Error("expected VALIDATION_ERROR");
    expect(done.error.message).toContain("[floor: unfiltered-test-file]");
  });

  it("NEGATIVE: an absolute root of a DIFFERENT directory does not change the verdict either", async () => {
    const { svc, taskId } = await setup();
    await svc.recordVerifiedEvidence(taskId, verifyRow("bun test tests/unit/x.bun.test.ts", "/some/other/repo/packages/lore"), "2026-10-16T00:00:00.000Z");
    const done = await svc.done(taskId, { by: "alice" });
    expect(done.ok).toBe(false);
  });

  it("NEGATIVE: a sibling directory sharing the repo-root string prefix is outside the repo", async () => {
    const { svc, taskId } = await setup();
    await svc.recordVerifiedEvidence(taskId, verifyRow("bun test tests/unit/x.bun.test.ts", `${REPO_ROOT}-evil/packages/lore`), "2026-10-16T00:00:00.000Z");
    expect((await svc.done(taskId, { by: "alice" })).ok).toBe(false);
  });

  it("NEGATIVE: the same row of another command is refused, and the refusal names the oracle, its exact command and only passing routes", async () => {
    const { svc, taskId } = await setup();
    await svc.recordVerifiedEvidence(taskId, verifyRow("bun test tests/unit/x.bun.test.ts"), "2026-10-16T00:00:00.000Z");
    const done = await svc.done(taskId, { by: "alice" });
    expect(done.ok).toBe(false);
    if (done.ok || done.error.code !== "VALIDATION_ERROR") throw new Error("expected VALIDATION_ERROR");
    const message = done.error.message;
    expect(message).toContain(ANCHOR);
    expect(message).toContain(testFileCommand(ANCHOR));
    expect(message).toContain("UNFILTERED");
    // Every route named records a runner-produced row: `--capture` or `lore verify`.
    expect(message).toContain("--capture");
    expect(message).toContain("lore verify");
    // No self-reported '--result pass' route (a self-report never satisfies the attested floor).
    expect(message).not.toMatch(/--result pass(?![^`]*--capture)/);
  });

  it("REGRESSION: the contract's exact command with no execution_root still passes", async () => {
    const { svc, taskId } = await setup();
    await svc.recordVerifiedEvidence(taskId, verifyRow(testFileCommand(ANCHOR)), "2026-10-16T00:00:00.000Z");
    expect((await svc.done(taskId, { by: "alice" })).ok).toBe(true);
  });

  it("STATE: a refusal writes nothing — the task stays draft at the same version", async () => {
    const { store, svc, taskId } = await setup();
    const before = await store.find(taskId);
    if (!before.ok || before.value === null) throw new Error("task not found");

    const refused = await svc.done(taskId, { by: "alice" });
    expect(refused.ok).toBe(false);

    const after = await store.find(taskId);
    if (!after.ok || after.value === null) throw new Error("task not found");
    expect(after.value.status).toBe("draft");
    expect(after.value.version).toBe(before.value.version);
  });
});
