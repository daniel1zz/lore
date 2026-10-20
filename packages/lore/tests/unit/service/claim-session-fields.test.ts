/**
 * Tests for claim capture + carry-forward refresh (SPEC-042 §Design Decisions D2)
 * at the `TaskWorkflowService.claim` service level, against `InMemoryStore` — no
 * gate wired (this file is purely about claim-field capture semantics, not the
 * anchor-overlap gate — see claim-anchor-gate.test.ts for that).
 *
 * Six-dimension coverage:
 *   HAPPY:      a same-holder refresh PRESERVES machine/worktree/branch (D2 carry-
 *               forward), updating only `at`
 *   NEGATIVE:   n/a beyond STATE's transition matrix below
 *   BOUNDARY:   re-passing any field on a refresh OVERRIDES the carried-forward value
 *   STATE:      a new-holder acquire (post-release), a --steal, and a stale takeover
 *               each start fresh with NO inherited fields
 *   ERROR:      n/a — claim() has its existing DOC_NOT_FOUND/CLAIM_CONFLICT/
 *               STALE_VERSION error paths, untouched by this spec's changes
 *   REGRESSION: legacy claims without machine/worktree (pre-SPEC-042 shape) still
 *               validate, render, and refresh correctly
 *
 * @spec_ref SPEC-042 AC-S3-4
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import { buildTaskClaim, taskClaimSchema } from "@lore/core";
import type { CreateDocInput, DocRecord } from "@lore/core";
import { actedStore } from "../../live-invocation.js";
import { runOfName } from "../../helpers/test-run-identity.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

async function mustCreate(cs: CorpusService, input: CreateDocInput): Promise<DocRecord> {
  const result = await cs.create(input);
  if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

function makeServices() {
  const store = actedStore(new InMemoryStore());
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

// ─── Service-level: TaskWorkflowService.claim carry-forward ──────────────────

describe("TaskWorkflowService.claim — carry-forward refresh (SPEC-042 D2)", () => {
  it("a same-holder fresh refresh preserves machine/worktree/branch, updating only `at`", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const { taskId } = await createPlanAndTask(corpusService);

    const first = await taskWorkflowService.claim(
      taskId,
      { by: "alice", harnessRun: runOfName("alice"), machine: "A", worktree: "/w", branch: "b1" },
      () => "2026-07-11T09:00:00.000Z",
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.extra["claim"]).toEqual({
      by: "alice",
      at: "2026-07-11T09:00:00.000Z",
      branch: "b1",
      machine: "A",
      worktree: "/w",
      harness_run: runOfName("alice"),
    });

    const refresh = await taskWorkflowService.claim(taskId, { by: "alice", harnessRun: runOfName("alice") }, () => "2026-07-11T09:30:00.000Z");
    expect(refresh.ok).toBe(true);
    if (!refresh.ok) return;
    expect(refresh.value.extra["claim"]).toEqual({
      by: "alice",
      at: "2026-07-11T09:30:00.000Z",
      branch: "b1",
      machine: "A",
      worktree: "/w",
      harness_run: runOfName("alice"),
    });
  });

  // BOUNDARY — re-passing a field on a refresh OVERRIDES the carried-forward value
  it("re-passing `branch` on a same-holder refresh overrides the carried-forward value", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const { taskId } = await createPlanAndTask(corpusService);

    await taskWorkflowService.claim(
      taskId,
      { by: "alice", harnessRun: runOfName("alice"), machine: "A", worktree: "/w", branch: "b1" },
      () => "2026-07-11T09:00:00.000Z",
    );

    const refresh = await taskWorkflowService.claim(
      taskId,
      { by: "alice", harnessRun: runOfName("alice"), branch: "b2" },
      () => "2026-07-11T09:30:00.000Z",
    );
    expect(refresh.ok).toBe(true);
    if (!refresh.ok) return;
    expect(refresh.value.extra["claim"]).toMatchObject({ branch: "b2", machine: "A", worktree: "/w" });
  });

  it("re-passing `machine` and `worktree` together overrides both, branch still carries forward", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const { taskId } = await createPlanAndTask(corpusService);

    await taskWorkflowService.claim(
      taskId,
      { by: "alice", harnessRun: runOfName("alice"), machine: "A", worktree: "/w", branch: "b1" },
      () => "2026-07-11T09:00:00.000Z",
    );

    const refresh = await taskWorkflowService.claim(
      taskId,
      { by: "alice", harnessRun: runOfName("alice"), machine: "B", worktree: "/w2" },
      () => "2026-07-11T09:30:00.000Z",
    );
    expect(refresh.ok).toBe(true);
    if (!refresh.ok) return;
    expect(refresh.value.extra["claim"]).toMatchObject({ machine: "B", worktree: "/w2", branch: "b1" });
  });

  // STATE — new-holder acquire (post-release) starts fresh, no inherited fields
  it("a new-holder acquire after release starts fresh — no inherited fields from the prior holder", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const { taskId } = await createPlanAndTask(corpusService);

    await taskWorkflowService.claim(
      taskId,
      { by: "alice", harnessRun: runOfName("alice"), machine: "A", worktree: "/w", branch: "b1" },
      () => "2026-07-11T09:00:00.000Z",
    );
    await taskWorkflowService.release(taskId, { by: "alice", harnessRun: runOfName("alice") }, () => "2026-07-11T09:10:00.000Z");

    const acquire = await taskWorkflowService.claim(taskId, { by: "bob", harnessRun: runOfName("bob") }, () => "2026-07-11T09:20:00.000Z");
    expect(acquire.ok).toBe(true);
    if (!acquire.ok) return;
    expect(acquire.value.extra["claim"]).toEqual({ by: "bob", at: "2026-07-11T09:20:00.000Z", harness_run: runOfName("bob") });
  });

  // STATE — --steal starts fresh, no inherited fields from the stolen-from holder
  it("a --steal claim starts fresh — no inherited fields from the fresh claim it overrides", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const { taskId } = await createPlanAndTask(corpusService);

    await taskWorkflowService.claim(
      taskId,
      { by: "alice", harnessRun: runOfName("alice"), machine: "A", worktree: "/w", branch: "b1" },
      () => "2026-07-11T09:00:00.000Z",
    );

    const steal = await taskWorkflowService.claim(
      taskId,
      { by: "bob", harnessRun: runOfName("bob"), steal: true },
      () => "2026-07-11T09:05:00.000Z",
    );
    expect(steal.ok).toBe(true);
    if (!steal.ok) return;
    expect(steal.value.extra["claim"]).toEqual({ by: "bob", at: "2026-07-11T09:05:00.000Z", harness_run: runOfName("bob") });
  });

  // STATE — a stale takeover BY THE SAME ACTOR still starts fresh (staleness breaks
  // session continuity by design, D2)
  it("a stale takeover by the SAME actor still starts fresh — no inherited fields", async () => {
    const { corpusService, taskWorkflowService } = makeServices(); // 120min TTL
    const { taskId } = await createPlanAndTask(corpusService);

    await taskWorkflowService.claim(
      taskId,
      { by: "alice", harnessRun: runOfName("alice"), machine: "A", worktree: "/w", branch: "b1" },
      () => "2026-07-08T00:00:00.000Z",
    );

    // 200 minutes later — well past the 120min TTL, so this is a stale takeover,
    // not a fresh same-holder refresh, EVEN THOUGH `by` is identical.
    const takeover = await taskWorkflowService.claim(
      taskId,
      { by: "alice", harnessRun: runOfName("alice") },
      () => "2026-07-08T03:20:00.000Z",
    );
    expect(takeover.ok).toBe(true);
    if (!takeover.ok) return;
    expect(takeover.value.extra["claim"]).toEqual({ by: "alice", at: "2026-07-08T03:20:00.000Z", harness_run: runOfName("alice") });
  });

  // REGRESSION — a stale takeover by a DIFFERENT actor also starts fresh (the
  // pre-existing "stale claimable without --steal" path, now composed with carry-forward)
  it("a stale takeover by a DIFFERENT actor starts fresh, no --steal required", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const { taskId } = await createPlanAndTask(corpusService);

    await taskWorkflowService.claim(
      taskId,
      { by: "alice", harnessRun: runOfName("alice"), machine: "A", worktree: "/w", branch: "b1" },
      () => "2026-07-08T00:00:00.000Z",
    );

    const takeover = await taskWorkflowService.claim(
      taskId,
      { by: "bob", harnessRun: runOfName("bob") },
      () => "2026-07-08T03:20:00.000Z", // 200 min later, stale
    );
    expect(takeover.ok).toBe(true);
    if (!takeover.ok) return;
    expect(takeover.value.extra["claim"]).toEqual({ by: "bob", at: "2026-07-08T03:20:00.000Z", harness_run: runOfName("bob") });
  });

  // REGRESSION — legacy claims without machine/worktree still validate, render, refresh
  it("a legacy claim (no machine/worktree field at all) still validates and refreshes", async () => {
    const { store, taskWorkflowService } = makeServices();
    const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const { taskId } = await createPlanAndTask(corpusService);

    // Simulate a pre-SPEC-042 legacy claim written directly to the store (no
    // machine/worktree keys present at all, not merely undefined).
    const taskResult = await store.find(taskId);
    if (!taskResult.ok || taskResult.value === null) throw new Error("task not found");
    const legacyClaim = { by: "carol", at: "2026-07-05T00:00:00.000Z", branch: "legacy-branch", harness_run: runOfName("carol") };
    expect(taskClaimSchema.safeParse(legacyClaim).success).toBe(true);
    const updateResult = await store.update(taskId, {
      extra: { ...taskResult.value.extra, claim: legacyClaim },
    });
    if (!updateResult.ok) throw new Error("seed update failed");

    const refresh = await taskWorkflowService.claim(taskId, { by: "carol", harnessRun: runOfName("carol") }, () => "2026-07-05T01:00:00.000Z");
    expect(refresh.ok).toBe(true);
    if (!refresh.ok) return;
    // carry-forward on a legacy claim: branch inherited, no machine/worktree keys appear
    expect(refresh.value.extra["claim"]).toEqual({
      by: "carol",
      at: "2026-07-05T01:00:00.000Z",
      branch: "legacy-branch",
      harness_run: runOfName("carol"),
    });
  });
});

// ─── Pure buildTaskClaim unit tests (core-level assertions, service-adjacent) ──

describe("buildTaskClaim (pure, @lore/core) — carry-forward contract", () => {
  const previous = { by: "alice", at: "T0", branch: "b1", machine: "A", worktree: "/w" };

  it("carryForward=true merges forward omitted fields, overrides re-passed ones", () => {
    expect(buildTaskClaim(previous, { by: "alice", at: "T1" }, true)).toEqual({
      by: "alice",
      at: "T1",
      branch: "b1",
      machine: "A",
      worktree: "/w",
    });
    expect(buildTaskClaim(previous, { by: "alice", at: "T1", branch: "b2" }, true)).toEqual({
      by: "alice",
      at: "T1",
      branch: "b2",
      machine: "A",
      worktree: "/w",
    });
  });

  it("carryForward=false inherits NOTHING, even when `by` matches `previous.by`", () => {
    expect(buildTaskClaim(previous, { by: "alice", at: "T1" }, false)).toEqual({ by: "alice", at: "T1" });
  });

  it("carryForward=true with previous=undefined behaves identically to false (nothing to inherit)", () => {
    expect(buildTaskClaim(undefined, { by: "alice", at: "T1" }, true)).toEqual({ by: "alice", at: "T1" });
  });
});
