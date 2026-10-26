/**
 * Tests for the SPEC-069 ad-hoc-task claim gap fix
 * (task-fix-spec-069-gap-adhoc-task-claim-structurally-impossible) —
 * `TaskWorkflowService.enforceClaimGate`'s handling of a task whose `parent_id`
 * resolves but is NOT `type: "plan"` (every `--adhoc` task, SPEC-069 §Design
 * Decisions D2 — auto-parented to the root PRD). Against an `InMemoryStore` —
 * vitest, no `bun:sqlite`, mirrors `claim-anchor-gate.test.ts`'s harness.
 *
 * Root cause: `getPlanBundle(task.parent_id)` hard-failed with `{VALIDATION_ERROR,
 * field: "type"}` for a non-plan parent, making an ad-hoc task's `claim()` always
 * return that error — structurally unclaimable. The fix routes that SPECIFIC
 * failure shape (`checkpoint-registry.ts::isNonPlanParentError`) through the SAME
 * "no governing plan" vacuous-pass-on-upstreamApproved treatment `parent_id ===
 * null` already gets, while still running `noAnchorOverlap` against every OTHER
 * corpus-wide `extra.adhoc === true` task (`findAdhocSiblingTasks`) — never an
 * empty sibling list, which would silently make the predicate permanently unable
 * to fire for the whole `--adhoc` channel (SPEC-042 "runs UNCONDITIONALLY").
 *
 * Six-dimension coverage:
 *   HAPPY:      an ad-hoc task (no anchors) claims successfully — AC-1.
 *   NEGATIVE:   n/a beyond the above.
 *   BOUNDARY:   an ad-hoc task with anchors but no OTHER ad-hoc sibling claims
 *               successfully (no conflict possible).
 *   ERROR:      n/a — mirrors noAnchorOverlap's own "no ERROR path by design".
 *   STATE:      two ad-hoc tasks sharing a fresh-claimed anchor, DIFFERENT actor
 *               → blocked (AC-3); SAME actor → passes; disjoint anchors → passes;
 *               a real (non-ad-hoc) legacy `parent_id: null` task's sibling scope
 *               is UNCHANGED (still `[]`, never widened to the ad-hoc universe).
 *   REGRESSION: a real plan-parented task's claim path (getPlanBundle succeeds)
 *               is untouched (AC-2, mirrors claim-anchor-gate.test.ts's existing
 *               end-to-end suite, which itself stays green — see task evidence).
 *
 * @spec_ref SPEC-069 §Design Decisions D2; SPEC-042 §Design Decisions D5;
 *   task-fix-spec-069-gap-adhoc-task-claim-structurally-impossible
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import type { CreateDocInput, DocRecord } from "@lore/core";
import { actedStore } from "../../live-invocation.js";
import { runOfName } from "../../helpers/test-run-identity.js";

import { fakeWorktreeProbe } from "../../helpers/fake-worktree-probe.js";
// ─── Fixtures (mirrors claim-anchor-gate.test.ts) ──────────────────────────

async function mustCreate(cs: CorpusService, input: CreateDocInput): Promise<DocRecord> {
  const result = await cs.create(input);
  if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

function makeServices() {
  const store = actedStore(new InMemoryStore());
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const enforcer = new GateEnforcer(undefined);
  // reason: task-two-concurrent-orchestrators-both-resolve-to-agent-main — the 7th
  // ctor arg is the env `claim()` captures `extra.claim.session_id` from, and the
  // same-actor anchor-overlap exemption now requires that captured fact on both
  // sides. Injected with a FIXED value (never the ambient `process.env` default) so
  // the same-actor cases below model ONE session deterministically, on any machine.
  const taskWorkflowService = new TaskWorkflowService(
    store,
    undefined,
    { claimTtlMinutes: 120 },
    undefined,
    { enforcer, getPlanBundle: corpusService.getPlanBundle.bind(corpusService) },
    undefined,
    { CLAUDE_CODE_SESSION_ID: "3de02220-adhoc" }, undefined, undefined, undefined, undefined, undefined, fakeWorktreeProbe(),
  );
  return { store, corpusService, taskWorkflowService };
}

/** SPEC-069 §Design Decisions D2 — a root PRD is required before any --adhoc task can auto-parent. */
async function createRootPrd(cs: CorpusService): Promise<string> {
  const prd = await mustCreate(cs, { type: "prd", title: "Root PRD", content: "# PRD" } as CreateDocInput);
  return prd.id;
}

/** Creates an ad-hoc task: no --parent/--plan-id, `extra.adhoc: true` — `CorpusService._createImpl` auto-parents to the root PRD. */
async function createAdhocTask(cs: CorpusService, title: string, anchors?: string[]): Promise<string> {
  const task = await mustCreate(cs, {
    type: "task",
    title,
    content: `# ${title}`,
    extra: { adhoc: true, ...(anchors !== undefined ? { file_anchors: anchors } : {}) },
  } as CreateDocInput);
  return task.id;
}

/** A real plan-parented task (non-ad-hoc), for the REGRESSION check. */
async function createPlanParentedTask(cs: CorpusService, anchors?: string[]): Promise<string> {
  const plan = await mustCreate(cs, { type: "plan", title: "Real Plan", content: "# Plan" } as CreateDocInput);
  const task = await mustCreate(cs, {
    type: "task",
    title: "Real Plan Task",
    parent_id: plan.id,
    content: "# Task",
    extra: { plan_id: plan.id, ...(anchors !== undefined ? { file_anchors: anchors } : {}) },
  } as CreateDocInput);
  return task.id;
}

describe("TaskWorkflowService.claim — ad-hoc task (SPEC-069 gap fix)", () => {
  // HAPPY — AC-1: the reported reproduction case, minimal shape.
  it("AC-1: claims an ad-hoc task with no anchors and no other ad-hoc siblings", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    await createRootPrd(corpusService);
    const taskId = await createAdhocTask(corpusService, "Adhoc Task");

    const result = await taskWorkflowService.claim(taskId, { by: "agent:t1", harnessRun: runOfName("agent:t1") });
    expect(result.ok).toBe(true);
  });

  // BOUNDARY — an ad-hoc task WITH anchors, but no other ad-hoc task exists at all.
  it("claims an ad-hoc task declaring anchors when it is the ONLY ad-hoc task in the corpus", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    await createRootPrd(corpusService);
    const taskId = await createAdhocTask(corpusService, "Solo Adhoc Task", ["src/solo.ts"]);

    const result = await taskWorkflowService.claim(taskId, { by: "agent:t1", harnessRun: runOfName("agent:t1") });
    expect(result.ok).toBe(true);
  });

  // STATE — AC-3: distinct-actor overlapping claim across two ad-hoc tasks IS blocked.
  it("AC-3: blocks a distinct-actor overlapping claim between two ad-hoc tasks", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    await createRootPrd(corpusService);
    const taskOneId = await createAdhocTask(corpusService, "Adhoc One", ["src/shared.ts"]);
    const taskTwoId = await createAdhocTask(corpusService, "Adhoc Two", ["src/shared.ts"]);

    const first = await taskWorkflowService.claim(taskOneId, { by: "agent:t1", harnessRun: runOfName("agent:t1") });
    expect(first.ok).toBe(true);

    const second = await taskWorkflowService.claim(taskTwoId, { by: "agent:t2", harnessRun: runOfName("agent:t2") });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe("VALIDATION_ERROR");
    expect((second.error as { field?: string }).field).toBe("gate:task-claim:anchor-overlap");
  });

  // STATE — same-actor, same-session overlap across two ad-hoc tasks never blocks
  // (both claims come from one service instance, i.e. one captured session id).
  it("a same-actor same-session overlapping claim between two ad-hoc tasks never blocks", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    await createRootPrd(corpusService);
    const taskOneId = await createAdhocTask(corpusService, "Adhoc Same Actor One", ["src/shared.ts"]);
    const taskTwoId = await createAdhocTask(corpusService, "Adhoc Same Actor Two", ["src/shared.ts"]);

    const first = await taskWorkflowService.claim(taskOneId, { by: "agent:same", harnessRun: runOfName("agent:same") });
    expect(first.ok).toBe(true);

    const second = await taskWorkflowService.claim(taskTwoId, { by: "agent:same", harnessRun: runOfName("agent:same") });
    expect(second.ok).toBe(true);
  });

  // STATE — disjoint anchors across two ad-hoc tasks never blocks.
  it("disjoint anchors between two ad-hoc tasks never blocks", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    await createRootPrd(corpusService);
    const taskOneId = await createAdhocTask(corpusService, "Adhoc Disjoint One", ["src/a.ts"]);
    const taskTwoId = await createAdhocTask(corpusService, "Adhoc Disjoint Two", ["src/b.ts"]);

    const first = await taskWorkflowService.claim(taskOneId, { by: "agent:t1", harnessRun: runOfName("agent:t1") });
    expect(first.ok).toBe(true);

    const second = await taskWorkflowService.claim(taskTwoId, { by: "agent:t2", harnessRun: runOfName("agent:t2") });
    expect(second.ok).toBe(true);
  });

  // STATE — a legacy `parent_id: null` (non-ad-hoc) task's sibling scope stays `[]`,
  // UNCHANGED by this fix — it must not accidentally start comparing against the
  // ad-hoc universe just because both are "no governing plan" cases.
  it("REGRESSION: a legacy parent_id-null task's anchor scope stays empty, even with an overlapping ad-hoc sibling elsewhere", async () => {
    const { store, corpusService, taskWorkflowService } = makeServices();
    await createRootPrd(corpusService);

    // An ad-hoc task holds a fresh claim on an anchor.
    const adhocId = await createAdhocTask(corpusService, "Adhoc Holder", ["src/legacy-shared.ts"]);
    const adhocClaim = await taskWorkflowService.claim(adhocId, { by: "agent:holder", harnessRun: runOfName("agent:holder") });
    expect(adhocClaim.ok).toBe(true);

    // A separate, REAL plan-parented task (deliberately NOT ad-hoc — this proves
    // the routing decision keys on the STRUCTURAL parent_id/type fact, never on
    // `extra.adhoc`) declares the SAME anchor, then is corrupted to `parent_id:
    // null` (legacy/corrupted row — schema-illegal for a normal create, forced
    // directly via the store, mirrors task-workflow-service.test.ts's identical
    // "force parent_id: null" fixture pattern).
    const legacyTaskId = await createPlanParentedTask(corpusService, ["src/legacy-shared.ts"]);
    const forceNull = await store.update(legacyTaskId, { parent_id: null });
    if (!forceNull.ok) throw new Error(`force parent_id:null failed: ${JSON.stringify(forceNull.error)}`);

    const result = await taskWorkflowService.claim(legacyTaskId, { by: "agent:other", harnessRun: runOfName("agent:other") });
    expect(result.ok).toBe(true);
  });

  // REGRESSION — AC-2: a real plan-parented task's claim path is untouched.
  it("REGRESSION: a real plan-parented task still claims via the getPlanBundle-succeeds branch", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const taskId = await createPlanParentedTask(corpusService);

    const result = await taskWorkflowService.claim(taskId, { by: "agent:t1", harnessRun: runOfName("agent:t1") });
    expect(result.ok).toBe(true);
  });
});
