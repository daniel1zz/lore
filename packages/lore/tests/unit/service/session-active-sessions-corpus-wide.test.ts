/**
 * `SessionService.bootstrap`'s `active_sessions` — corpus-wide derivation
 * RED-first suite for
 * `task-active-sessions-derives-only-over-active-plans-tasks-with`.
 *
 * The defect (measured 2026-08-02, from a live incident): `active_sessions`
 * derived over `activePlanIds.has(task.parent_id)`, so it was UNCONDITIONALLY
 * `[]` in any corpus with zero active plans (this repo measured 114 archived /
 * 0 active), and could never include an `--adhoc` task (SPEC-069 D2 parents
 * these to the root PRD, never a plan). A fresh session read that `[]` as
 * "nobody is working" and removed a live agent's worktree. Against
 * `InMemoryStore` (vitest) — zero filesystem writes, so there is no risk of
 * touching this repo's own `.lore/` corpus (the `mkdtemp` + `lore init`
 * hygiene rule applies to CLI/file-backed fixtures; this suite never
 * constructs one).
 *
 * Six-dimension coverage:
 *   HAPPY/REGRESSION: a fresh claim under an ACTIVE plan still appears, with
 *                      `by`/`machine`/`worktree`/task-grouping byte-identical
 *                      to the pre-fix shape for that case (no `stale` key).
 *   NEGATIVE:   (1, load-bearing) zero plans at all in the corpus + a claimed
 *               `--adhoc` task → appears. This is the exact incident shape and
 *               it returned `[]` before this fix.
 *               (2) a fresh claim on a task under an ARCHIVED plan → appears.
 *   BOUNDARY:   a claim whose `parent_id` resolves to nothing (broken ref /
 *               hard delete) does not throw and does not silently vanish.
 *   ERROR:      a claim whose `worktree`/`machine` fields are ABSENT (the
 *               documented MCP-caller shape, ClaimOpts's own JSDoc) is still
 *               reported, not dropped.
 *   STATE:      a task claimed then RELEASED disappears; a task claimed then
 *               ARCHIVED via `done()` (which does NOT clear `extra.claim`)
 *               likewise disappears — proving the terminal-status filter, not
 *               claim absence, is what excludes the second case.
 *   REGRESSION: `TaskWorkflowService.ready`'s plan-scoped `sessions[]` is
 *               UNCHANGED — still excludes a claim on a task OUTSIDE the
 *               queried plan, even though bootstrap's own scope widened.
 *               Required #2's `stale` decision: a claim that ages past the
 *               ttl is STILL reported (not silently dropped), flagged.
 *   CONTROL:    reconstructs the PRE-FIX plan-scoped filter (the exact
 *               snippet the task doc measured: `activePlanIds.has(parent_id)`)
 *               as a local, non-imported function and proves it reproduces
 *               `[]` against the SAME fixture the NEGATIVE test uses — so the
 *               NEGATIVE assertion above is provably capable of failing, not
 *               vacuously green.
 *
 * @spec_ref task-active-sessions-derives-only-over-active-plans-tasks-with
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { alwaysAutoOverridePort } from "../../helpers/always-auto-override-port.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import { SessionService } from "../../../src/service/session-service.js";
import { deriveSessions } from "@lore/core";
import type { CreateDocInput, DocRecord, ReadySession } from "@lore/core";
import type { StoreInterface } from "../../../src/store/store-interface.js";
import { actedStore } from "../../live-invocation.js";
import { runOfName } from "../../helpers/test-run-identity.js";

import { fakeWorktreeProbe } from "../../helpers/fake-worktree-probe.js";
function makeServices(store: StoreInterface = actedStore(new InMemoryStore())) {
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const taskWorkflowService = new TaskWorkflowService(store, undefined, { claimTtlMinutes: 120 }, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, fakeWorktreeProbe());
  taskWorkflowService.setOverrideDecisionPort(alwaysAutoOverridePort()); // AU-T7: explicit test port; no port = refused
  const sessionService = new SessionService(store, {
    claimTtlMinutes: 120,
    handoffTtlMinutes: 10080,
    createHandoffDoc: corpusService.createHandoffDoc.bind(corpusService),
  });
  return { store, corpusService, taskWorkflowService, sessionService };
}

async function mustCreate(cs: CorpusService, input: CreateDocInput): Promise<DocRecord> {
  const result = await cs.create(input);
  if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

async function createPrd(cs: CorpusService, title = "Root"): Promise<DocRecord> {
  return mustCreate(cs, { type: "prd", title, content: `# ${title}` } as CreateDocInput);
}

async function createPlan(cs: CorpusService, parentId: string, title = "Plan"): Promise<DocRecord> {
  return mustCreate(cs, { type: "plan", title, parent_id: parentId, content: `# ${title}` } as CreateDocInput);
}

async function createPlanTask(
  cs: CorpusService,
  planId: string,
  title = "Task",
): Promise<DocRecord> {
  return mustCreate(cs, {
    type: "task",
    title,
    parent_id: planId,
    content: `# ${title}`,
    extra: { plan_id: planId },
  } as CreateDocInput);
}

async function createAdhocTask(cs: CorpusService, title = "Adhoc"): Promise<DocRecord> {
  // reason: `extra.adhoc: true` relaxes BOTH `plan_id` (taskExtraSchema
  // superRefine) and `parent_id` (createDocInputSchema superRefine) — but
  // `CorpusService._createImpl`'s auto-parenting-to-root-PRD branch (SPEC-069
  // D2) fires ONLY when `parent_id` is OMITTED (`data.parent_id === undefined`)
  // — passing it explicitly instead hits the ordinary `isValidParentType`
  // check, which does not list `prd` as a legal task parent
  // (`INVALID_PARENT_TYPE`, measured). A caller-supplied root PRD id is
  // therefore NOT accepted here; the sole root PRD already in the corpus is
  // what `_createImpl` resolves to on its own.
  return mustCreate(cs, {
    type: "task",
    title,
    content: `# ${title}`,
    extra: { adhoc: true },
  } as CreateDocInput);
}

/**
 * Reconstructs the PRE-FIX `active_sessions` derivation — the exact snippet
 * the task doc measured (`session-service.ts:282-285`, before this fix):
 * intersect claim-bearing tasks with `activePlanIds.has(task.parent_id)`.
 * NOT imported from production (the fixed code no longer contains this logic)
 * — a local, deliberately-buggy reconstruction for the CONTROL test below,
 * proving the NEGATIVE assertions can actually fail.
 */
function preFixActiveSessions(allDocs: DocRecord[], nowIso: string, ttlMinutes: number): ReadySession[] {
  const activePlanIds = new Set(
    allDocs.filter((d) => d.type === "plan" && d.status !== "archived" && d.status !== "deprecated").map((d) => d.id),
  );
  const activeTasks = allDocs.filter(
    (d) => d.type === "task" && d.parent_id !== null && activePlanIds.has(d.parent_id),
  );
  return deriveSessions(activeTasks, nowIso, ttlMinutes);
}

// ─── NEGATIVE (load-bearing) — zero plans at all + an --adhoc claim ─────────

describe("bootstrap active_sessions — NEGATIVE: zero-plan corpus, adhoc claim (incident shape)", () => {
  it("a claimed --adhoc task appears in active_sessions when the corpus has NO plans at all", async () => {
    const { corpusService, taskWorkflowService, sessionService, store } = makeServices();
    await createPrd(corpusService);
    const adhoc = await createAdhocTask(corpusService, "Investigate the flaky timeout");
    await taskWorkflowService.claim(adhoc.id, { by: "agent:incident-repro", harnessRun: runOfName("agent:incident-repro"), worktree: "/repo/.worktrees/t1" });

    // This is the exact incident shape today: no plan exists anywhere in the
    // corpus, so `activePlanIds` (pre-fix) is empty and `activeTasks` is empty.
    const allDocsResult = await store.findMany({});
    expect(allDocsResult.ok).toBe(true);
    if (!allDocsResult.ok) return;
    expect(allDocsResult.value.some((d) => d.type === "plan")).toBe(false);

    const result = await sessionService.bootstrap("alice");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const session = result.value.active_sessions.find((s) => s.by === "agent:incident-repro");
    expect(session).toBeDefined();
    expect(session?.task_slugs).toContain(adhoc.slug);
    expect(session?.worktree).toBe("/repo/.worktrees/t1");
    expect(session?.stale).toBeUndefined();
  });
});

// ─── NEGATIVE (2) — a fresh claim under an ARCHIVED plan ────────────────────

describe("bootstrap active_sessions — NEGATIVE: fresh claim under an ARCHIVED plan", () => {
  it("appears (task's OWN status governs, never its parent plan's)", async () => {
    const { corpusService, taskWorkflowService, sessionService } = makeServices();
    const prd = await createPrd(corpusService);
    const plan = await createPlan(corpusService, prd.id, "Retired Plan");
    const task = await createPlanTask(corpusService, plan.id, "Member");
    await taskWorkflowService.claim(task.id, { by: "agent:t1", harnessRun: runOfName("agent:t1") });

    const approveResult = await corpusService.set(plan.id, { status: "approved" });
    expect(approveResult.ok).toBe(true);
    const archiveResult = await corpusService.set(plan.id, { status: "archived" });
    expect(archiveResult.ok).toBe(true);

    const result = await sessionService.bootstrap("alice");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const session = result.value.active_sessions.find((s) => s.by === "agent:t1");
    expect(session).toBeDefined();
    expect(session?.task_slugs).toContain(task.slug);
  });
});

// ─── HAPPY / REGRESSION — active plan, byte-identical shape ─────────────────

describe("bootstrap active_sessions — HAPPY/REGRESSION: active plan, byte-identical shape", () => {
  it("a claim under an active plan is byte-identical to the pre-fix shape (no stale key)", async () => {
    const { corpusService, taskWorkflowService, sessionService } = makeServices();
    const prd = await createPrd(corpusService);
    const plan = await createPlan(corpusService, prd.id, "Active Plan");
    const task = await createPlanTask(corpusService, plan.id, "Solo Member");
    await taskWorkflowService.claim(task.id, { by: "agent:t1", harnessRun: runOfName("agent:t1"), machine: "hostA", worktree: "/w1", branch: "feat/x" });

    const result = await sessionService.bootstrap("alice");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.active_sessions).toHaveLength(1);
    const session = result.value.active_sessions[0]!;
    expect(session).toEqual({
      by: "agent:t1",
      machine: "hostA",
      worktree: "/w1",
      branches: ["feat/x"],
      task_slugs: [task.slug],
      newest_at: expect.any(String),
      // BR-1363: always present; null = no address recorded for the holder's main run
      message_address: null,
    });
    expect(session).not.toHaveProperty("stale");
  });
});

// ─── BOUNDARY — a claim whose parent_id resolves to nothing ─────────────────

describe("bootstrap active_sessions — BOUNDARY: broken parent_id (hard delete / dangling ref)", () => {
  it("does not throw and does not silently vanish", async () => {
    const { corpusService, taskWorkflowService, sessionService, store } = makeServices();
    const prd = await createPrd(corpusService);
    const plan = await createPlan(corpusService, prd.id, "Plan");
    const task = await createPlanTask(corpusService, plan.id, "Orphaned-to-be");
    const claimResult = await taskWorkflowService.claim(task.id, { by: "agent:t1", harnessRun: runOfName("agent:t1") });
    expect(claimResult.ok).toBe(true);

    // reason: `claim()` bumped the version — re-fetch rather than reuse the
    // pre-claim `task.version` (which is now stale and would fail the CAS
    // check below with an unrelated STALE_VERSION, not the scenario this test
    // is actually about).
    const claimedDocResult = await store.find(task.id);
    expect(claimedDocResult.ok).toBe(true);
    if (!claimedDocResult.ok || claimedDocResult.value === null) return;
    const claimedDoc = claimedDocResult.value;

    // Simulate a hard delete of the parent: point parent_id at a ULID that
    // resolves to nothing. A raw store patch (not CorpusService.set, which
    // has no parent_id-patch surface) — mirrors a corrupted/partially-migrated
    // corpus row, not a shape this codebase's own writers would ever produce.
    const patchResult = await store.update(
      task.id,
      { parent_id: "01BOGUSPARENTDOESNOTEXIST0" },
      { expected_version: claimedDoc.version },
    );
    expect(patchResult.ok).toBe(true);

    const result = await sessionService.bootstrap("alice");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const session = result.value.active_sessions.find((s) => s.by === "agent:t1");
    expect(session).toBeDefined();
    expect(session?.task_slugs).toContain(task.slug);
  });
});

// ─── ERROR — absent worktree/machine (documented MCP-caller shape) ──────────

describe("bootstrap active_sessions — ERROR: absent worktree/machine fields", () => {
  it("a claim with no machine/worktree (MCP caller, ClaimOpts's own documented shape) is still reported, not dropped", async () => {
    const { corpusService, taskWorkflowService, sessionService } = makeServices();
    const prd = await createPrd(corpusService);
    const plan = await createPlan(corpusService, prd.id, "Plan");
    const task = await createPlanTask(corpusService, plan.id, "MCP-claimed");
    // No machine, no worktree — the exact shape ClaimOpts's own JSDoc
    // documents for an MCP caller (`machine`/`worktree` both caller-supplied
    // and optional; unlike the CLI, MCP does not auto-capture `os.hostname()`).
    await taskWorkflowService.claim(task.id, { by: "agent:mcp-caller", harnessRun: runOfName("agent:mcp-caller") });

    const result = await sessionService.bootstrap("alice");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const session = result.value.active_sessions.find((s) => s.by === "agent:mcp-caller");
    expect(session).toBeDefined();
    expect(session?.task_slugs).toContain(task.slug);
    expect(session?.machine).toBeUndefined();
    expect(session?.worktree).toBeUndefined();
  });
});

// ─── STATE — released / archived tasks disappear ────────────────────────────

describe("bootstrap active_sessions — STATE: released and archived tasks disappear", () => {
  it("a task claimed then RELEASED disappears from active_sessions", async () => {
    const { corpusService, taskWorkflowService, sessionService } = makeServices();
    const prd = await createPrd(corpusService);
    const plan = await createPlan(corpusService, prd.id, "Plan");
    const task = await createPlanTask(corpusService, plan.id, "Released");
    await taskWorkflowService.claim(task.id, { by: "agent:t1", harnessRun: runOfName("agent:t1") });

    const preRelease = await sessionService.bootstrap("alice");
    expect(preRelease.ok).toBe(true);
    if (preRelease.ok) {
      expect(preRelease.value.active_sessions.some((s) => s.by === "agent:t1")).toBe(true);
    }

    const releaseResult = await taskWorkflowService.release(task.id, { by: "agent:t1", harnessRun: runOfName("agent:t1") });
    expect(releaseResult.ok).toBe(true);

    const result = await sessionService.bootstrap("alice");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.active_sessions.some((s) => s.by === "agent:t1")).toBe(false);
  });

  it("a task claimed then ARCHIVED via done() disappears from active_sessions, even though extra.claim is NOT cleared by writeTaskStatus", async () => {
    const { corpusService, taskWorkflowService, sessionService, store } = makeServices();
    const prd = await createPrd(corpusService);
    const plan = await createPlan(corpusService, prd.id, "Plan");
    const task = await createPlanTask(corpusService, plan.id, "To Be Archived");
    await taskWorkflowService.claim(task.id, { by: "agent:t1", harnessRun: runOfName("agent:t1") });

    const doneResult = await taskWorkflowService.done(task.id, {
      by: "agent:t1", harnessRun: runOfName("agent:t1"),
      overrideReason: "STATE-dimension test: no runner-attested evidence needed for this assertion",
    });
    expect(doneResult.ok).toBe(true);
    if (!doneResult.ok) return;
    expect(doneResult.value.task.status).toBe("archived");

    // Verify the premise this STATE test exists to guard: writeTaskStatus does
    // NOT clear extra.claim (service/CLAUDE.md's own documented behavior) — if
    // this ever changed, the exclusion below would pass for the wrong reason
    // (claim absence, not the terminal-status filter).
    const archivedDocResult = await store.find(task.id);
    expect(archivedDocResult.ok).toBe(true);
    if (archivedDocResult.ok) {
      expect(archivedDocResult.value?.extra["claim"]).toBeDefined();
    }

    const result = await sessionService.bootstrap("alice");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.active_sessions.some((s) => s.by === "agent:t1")).toBe(false);
  });
});

// ─── REGRESSION — ready()'s plan-scoped sessions[] is UNCHANGED ─────────────

describe("TaskWorkflowService.ready — REGRESSION: plan-scoped sessions[] still excludes tasks outside the queried plan", () => {
  it("a claim on an unrelated adhoc task never appears in another plan's ready().sessions", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const prd = await createPrd(corpusService);
    const plan = await createPlan(corpusService, prd.id, "Plan A");
    const planTask = await createPlanTask(corpusService, plan.id, "Plan A Member");
    const adhoc = await createAdhocTask(corpusService, "Unrelated Adhoc");

    await taskWorkflowService.claim(planTask.id, { by: "agent:plan-a", harnessRun: runOfName("agent:plan-a") });
    await taskWorkflowService.claim(adhoc.id, { by: "agent:adhoc", harnessRun: runOfName("agent:adhoc") });

    const report = await taskWorkflowService.ready(plan.id);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.sessions).toHaveLength(1);
    expect(report.value.sessions[0]?.by).toBe("agent:plan-a");
    expect(report.value.sessions.some((s) => s.by === "agent:adhoc")).toBe(false);
  });
});

// ─── Required #2 — stale claims are REPORTED, flagged, not dropped ──────────

describe("bootstrap active_sessions — Required #2: a stale claim is reported, flagged, not dropped", () => {
  it("a claim aged past the ttl still appears in active_sessions, marked stale: true", async () => {
    const { corpusService, taskWorkflowService, sessionService } = makeServices();
    const prd = await createPrd(corpusService);
    const plan = await createPlan(corpusService, prd.id, "Plan");
    const task = await createPlanTask(corpusService, plan.id, "Long-running");

    // Claimed at T0; TTL is 120 minutes.
    await taskWorkflowService.claim(task.id, { by: "agent:long-runner", harnessRun: runOfName("agent:long-runner") }, () => "2026-08-01T00:00:00.000Z");

    // Read 20 hours later (1200 min > 120 min ttl) — the exact incident shape:
    // `stale: true`, ten times over, while a real process could still be alive.
    const result = await sessionService.bootstrap("alice", () => "2026-08-01T20:00:00.000Z");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const session = result.value.active_sessions.find((s) => s.by === "agent:long-runner");
    expect(session).toBeDefined();
    expect(session?.task_slugs).toContain(task.slug);
    expect(session?.stale).toBe(true);
  });

  it("a FRESH claim never carries the stale flag (present-iff-true)", async () => {
    const { corpusService, taskWorkflowService, sessionService } = makeServices();
    const prd = await createPrd(corpusService);
    const plan = await createPlan(corpusService, prd.id, "Plan");
    const task = await createPlanTask(corpusService, plan.id, "Just Claimed");
    await taskWorkflowService.claim(task.id, { by: "agent:fresh", harnessRun: runOfName("agent:fresh") }, () => "2026-08-01T00:00:00.000Z");

    const result = await sessionService.bootstrap("alice", () => "2026-08-01T00:05:00.000Z");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const session = result.value.active_sessions.find((s) => s.by === "agent:fresh");
    expect(session).toBeDefined();
    expect(session).not.toHaveProperty("stale");
  });
});

// ─── CONTROL — the NEGATIVE assertions can actually fail ────────────────────

describe("bootstrap active_sessions — CONTROL: the NEGATIVE assertions are not vacuously green", () => {
  it("the PRE-FIX plan-scoped filter, applied to the SAME zero-plan+adhoc fixture, reproduces [] — proving the fix (not the fixture) is what makes the NEGATIVE test above pass", async () => {
    const { corpusService, taskWorkflowService, sessionService, store } = makeServices();
    await createPrd(corpusService);
    const adhoc = await createAdhocTask(corpusService, "Control Fixture Task");
    await taskWorkflowService.claim(adhoc.id, { by: "agent:control", harnessRun: runOfName("agent:control") });

    const nowIso = "2026-08-01T00:01:00.000Z";
    const allDocsResult = await store.findMany({});
    expect(allDocsResult.ok).toBe(true);
    if (!allDocsResult.ok) return;

    // RED: the reverted (pre-fix) plan-scoped computation over this EXACT
    // fixture returns [] — proving the NEGATIVE test's fixture is a genuine
    // reproduction of the incident, not one that happens to pass regardless.
    const preFixResult = preFixActiveSessions(allDocsResult.value, nowIso, 120);
    expect(preFixResult).toEqual([]);

    // GREEN: the CURRENT, fixed sessionService.bootstrap over the SAME corpus
    // reports the session.
    const bootstrapResult = await sessionService.bootstrap("alice", () => nowIso);
    expect(bootstrapResult.ok).toBe(true);
    if (!bootstrapResult.ok) return;
    expect(bootstrapResult.value.active_sessions.some((s) => s.by === "agent:control")).toBe(true);
  });
});
