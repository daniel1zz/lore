/**
 * Claim conflict, the `lore done` holder check and the `lore ready` overlap test identify the holder by RUN.
 *
 * @spec_ref AC-ROI-3
 *   spec-run-only-write-identity-and-run-end-claim-release Scope 3 + 5; BR-1056, BR-1058;
 *   ADR adr-write-identity-is-the-attested-run-alone-a-run-s-claims-end decisions 3 and 5.
 *
 * Service-level over the REAL `createApp` composition root and a real SQLite corpus in a mkdtemp directory
 * (never the repo's own `.lore/`): `DoneOpts.harnessRun` is a service option, the CLI passes it in task T2.
 *
 * Coverage dimensions:
 *   HAPPY      — the holder run itself archives; a clean ended-run claim does not block an overlapping claim
 *   NEGATIVE   — another run with the SAME derived name cannot archive a fresh claim, and the refusal names the
 *                holding run; an unattested caller against a run-holding claim is a conflict
 *   STATE      — `lore ready` reports overlap between two runs sharing one name as two holders; an
 *                `orphaned_dirty` claim aged past `claim_ttl_minutes` still blocks the overlapping sibling and
 *                stays a live session
 *   BOUNDARY   — a claim older than the TTL by hours, still blocking because it is orphaned_dirty
 *   REGRESSION — both parties unattested keep the name comparison (legacy path); the same run on two tasks is
 *                one holder and reports no overlap
 */

import { afterAll, afterEach, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { createApp } from "../../src/app.js";
import type { App } from "../../src/app.js";
import type { CreateDocInput, DocRecord, RunId } from "@lore/core";
import { cleanupWorktrees, commitAll, makeWorktree } from "./support/run-end-fixture.js";

setDefaultTimeout(120_000);

/** One derived name shared by two different runs — the situation BR-1056 exists for. */
const SHARED_NAME = "agent:shared-name";
const SHARED_ANCHOR = "packages/core/src/session.ts";
const BEYOND_TTL_MINUTES = 500;

let tmpDir: string;
let originalCwd: string;
let sessionCounter = 0;

beforeEach(() => {
  tmpDir = resolve(mkdtempSync(join(tmpdir(), "lore-run-owned-done-")));
  mkdirSync(join(tmpDir, ".lore"), { recursive: true });
  (createApp(dbPath()) as App).close();
  originalCwd = process.cwd();
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpDir, { recursive: true, force: true });
});

afterAll(() => cleanupWorktrees());

function dbPath(): string {
  return join(tmpDir, ".lore", "lore.db");
}

async function withApp<T>(fn: (app: App) => Promise<T>): Promise<T> {
  const app = createApp(dbPath()) as App;
  try {
    return await fn(app);
  } finally {
    app.close();
  }
}

/** Registers a fresh run through the real RunService and returns its id. */
async function newRun(): Promise<RunId> {
  sessionCounter += 1;
  return withApp(async (app) => {
    const result = await app.runService!.register({
      harness: "claude-code",
      sessionId: `owned-${sessionCounter}`,
      composition: { schemaVersion: 1 as const, fragments: [] },
    });
    if (!result.ok) throw new Error(`register failed: ${JSON.stringify(result.error)}`);
    return result.value.id;
  });
}

async function endRun(run: RunId): Promise<void> {
  const result = await withApp((app) => app.runService!.end(run, "session-end"));
  if (!result.ok) throw new Error(`end failed: ${JSON.stringify(result.error)}`);
}

async function createPlanWithTasks(anchorsPerTask: string[][]): Promise<{ planId: string; taskIds: string[] }> {
  return withApp(async (app) => {
    const plan = await app.corpusService.create({ type: "plan", title: "Run Owned Plan", content: "# Plan" } as CreateDocInput);
    if (!plan.ok) throw new Error(`plan create failed: ${JSON.stringify(plan.error)}`);
    const taskIds: string[] = [];
    for (const [index, anchors] of anchorsPerTask.entries()) {
      const task = await app.corpusService.create({
        type: "task",
        title: `Run Owned Task ${index + 1}`,
        parent_id: plan.value.id,
        content: "# Task",
        extra: { plan_id: plan.value.id, file_anchors: anchors },
      } as CreateDocInput);
      if (!task.ok) throw new Error(`task create failed: ${JSON.stringify(task.error)}`);
      taskIds.push(task.value.id);
    }
    return { planId: plan.value.id, taskIds };
  });
}

function claimAs(taskId: string, by: string, run: RunId | null, worktree?: string) {
  return withApp((app) =>
    app.taskWorkflowService.claim(taskId, {
      by,
      ...(run !== null ? { harnessRun: run } : {}),
      ...(worktree !== undefined ? { worktree } : {}),
    }),
  );
}

function doneAs(taskId: string, by: string, run: RunId | null) {
  return withApp((app) =>
    app.taskWorkflowService.done(taskId, {
      by,
      ...(run !== null ? { harnessRun: run } : {}),
      overrideReason: "AC-ROI-3 fixture: the holder check is the behaviour under test, not the evidence floor",
    }),
  );
}

async function fetchTask(id: string): Promise<DocRecord> {
  return withApp(async (app) => {
    const result = await app.corpusService.get(id);
    if (!result.ok) throw new Error(`get failed: ${JSON.stringify(result.error)}`);
    return result.value.doc;
  });
}

/** Overwrites the stored claim with `patch` merged over it (ages or re-attributes a real, service-written claim). */
function patchClaim(taskId: string, patch: Record<string, unknown>): void {
  const db = new Database(dbPath());
  try {
    const row = db.query("SELECT extra FROM docs WHERE id = ?").get(taskId) as { extra: string } | null;
    if (row === null) throw new Error(`no doc ${taskId}`);
    const extra = JSON.parse(row.extra) as { claim?: Record<string, unknown> };
    if (extra.claim === undefined) throw new Error(`no claim to patch on ${taskId}`);
    extra.claim = { ...extra.claim, ...patch };
    db.query("UPDATE docs SET extra = ? WHERE id = ?").run(JSON.stringify(extra), taskId);
  } finally {
    db.close();
  }
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function errorText(result: { ok: boolean; error?: unknown }): string {
  return JSON.stringify(result.error);
}

describe("lore done decides the holder by run (AC-ROI-3)", () => {
  it("NEGATIVE: refuses run B, which carries the same derived name as the holding run A, and the refusal names run A", async () => {
    const { taskIds } = await createPlanWithTasks([[]]);
    const runA = await newRun();
    const runB = await newRun();
    expect((await claimAs(taskIds[0]!, SHARED_NAME, runA)).ok).toBe(true);

    const refused = await doneAs(taskIds[0]!, SHARED_NAME, runB);

    expect(refused.ok).toBe(false);
    expect(errorText(refused)).toContain(runA);
    expect(errorText(refused)).toContain("fresh claim");
    expect((await fetchTask(taskIds[0]!)).status).not.toBe("archived");
  });

  it("HAPPY control: the holding run itself archives its own fresh claim", async () => {
    const { taskIds } = await createPlanWithTasks([[]]);
    const runA = await newRun();
    expect((await claimAs(taskIds[0]!, SHARED_NAME, runA)).ok).toBe(true);

    const done = await doneAs(taskIds[0]!, SHARED_NAME, runA);

    expect(done.ok).toBe(true);
    expect((await fetchTask(taskIds[0]!)).status).toBe("archived");
  });

  it("NEGATIVE: an unattested caller with the holder's name still cannot archive a run-held fresh claim", async () => {
    const { taskIds } = await createPlanWithTasks([[]]);
    const runA = await newRun();
    expect((await claimAs(taskIds[0]!, SHARED_NAME, runA)).ok).toBe(true);

    const refused = await doneAs(taskIds[0]!, SHARED_NAME, null);

    expect(refused.ok).toBe(false);
    expect(errorText(refused)).toContain(runA);
  });

  it("REGRESSION: both sides unattested compare by name (a different name refused, the same name archives)", async () => {
    const { taskIds } = await createPlanWithTasks([[], []]);
    expect((await claimAs(taskIds[0]!, "agent:legacy-a", null)).ok).toBe(true);
    expect((await claimAs(taskIds[1]!, "agent:legacy-b", null)).ok).toBe(true);

    const foreign = await doneAs(taskIds[0]!, "agent:legacy-b", null);
    const own = await doneAs(taskIds[1]!, "agent:legacy-b", null);

    expect(foreign.ok).toBe(false);
    expect(own.ok).toBe(true);
  });

  it("BOUNDARY: a fresh claim whose run has ended with a clean worktree no longer blocks another run's done", async () => {
    const { taskIds } = await createPlanWithTasks([[]]);
    const runA = await newRun();
    const runB = await newRun();
    await endRun(runA);
    expect((await claimAs(taskIds[0]!, SHARED_NAME, runA, makeWorktree({ dirty: false }))).ok).toBe(true);

    const done = await doneAs(taskIds[0]!, SHARED_NAME, runB);

    expect(done.ok).toBe(true);
  });
});

describe("claim conflict decides by run (AC-ROI-3)", () => {
  it("NEGATIVE: a claimant without a run against a holder with a run is a conflict, even with the holder's name", async () => {
    const { taskIds } = await createPlanWithTasks([[]]);
    const runA = await newRun();
    expect((await claimAs(taskIds[0]!, SHARED_NAME, runA)).ok).toBe(true);

    const conflict = await claimAs(taskIds[0]!, SHARED_NAME, null);

    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.error.code).toBe("CLAIM_CONFLICT");
  });

  it("NEGATIVE: a second run with the same derived name is a conflict, not a refresh", async () => {
    const { taskIds } = await createPlanWithTasks([[]]);
    const runA = await newRun();
    const runB = await newRun();
    expect((await claimAs(taskIds[0]!, SHARED_NAME, runA)).ok).toBe(true);

    const conflict = await claimAs(taskIds[0]!, SHARED_NAME, runB);

    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.error.code).toBe("CLAIM_CONFLICT");
  });
});

describe("lore ready overlap decides by run (AC-ROI-3)", () => {
  /** Two anchor-overlapping tasks each held (fresh) by the given runs; the gate would refuse the second, so the claim is seeded. */
  async function seedOverlappingHolders(runForFirst: RunId, runForSecond: RunId): Promise<string> {
    const { planId, taskIds } = await createPlanWithTasks([[SHARED_ANCHOR], ["docs/unrelated-anchor.md"]]);
    expect((await claimAs(taskIds[0]!, SHARED_NAME, runForFirst)).ok).toBe(true);
    expect((await claimAs(taskIds[1]!, SHARED_NAME, runForSecond)).ok).toBe(true);
    const db = new Database(dbPath());
    try {
      const row = db.query("SELECT extra FROM docs WHERE id = ?").get(taskIds[1]!) as { extra: string };
      const extra = JSON.parse(row.extra) as Record<string, unknown>;
      extra["file_anchors"] = [SHARED_ANCHOR];
      db.query("UPDATE docs SET extra = ? WHERE id = ?").run(JSON.stringify(extra), taskIds[1]!);
    } finally {
      db.close();
    }
    return planId;
  }

  it("STATE: two runs sharing one name over overlapping anchors are reported as two holders", async () => {
    const runA = await newRun();
    const runB = await newRun();
    const planId = await seedOverlappingHolders(runA, runB);

    const report = await withApp((app) => app.taskWorkflowService.ready(planId));

    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.anchor_conflicts).toHaveLength(2);
    expect(report.value.anchor_conflicts.map((c) => c.task_slug).sort()).toHaveLength(2);
    expect(new Set(report.value.anchor_conflicts.map((c) => c.holder))).toEqual(new Set([SHARED_NAME]));
  });

  it("REGRESSION control: ONE run holding both overlapping tasks is one holder and reports no overlap", async () => {
    const runA = await newRun();
    const planId = await seedOverlappingHolders(runA, runA);

    const report = await withApp((app) => app.taskWorkflowService.ready(planId));

    expect(report.ok).toBe(true);
    if (report.ok) expect(report.value.anchor_conflicts).toEqual([]);
  });
});

describe("the anchor-overlap gate and ready sessions use run-aware staleness (BR-1058)", () => {
  /** A task claimed by `run` from a dirty worktree, then the run ends: kept as orphaned_dirty, then aged past the TTL. */
  async function orphanedDirtyAged(run: RunId, taskId: string): Promise<void> {
    expect((await claimAs(taskId, "agent:holder-a", run, makeWorktree({ dirty: true }))).ok).toBe(true);
    await endRun(run);
    expect((await fetchTask(taskId)).extra["claim"]).toMatchObject({ orphaned_dirty: expect.anything() });
    patchClaim(taskId, { at: minutesAgo(BEYOND_TTL_MINUTES) });
  }

  it("STATE: an orphaned_dirty claim older than claim_ttl_minutes still blocks an overlapping sibling claim and stays a session", async () => {
    const { planId, taskIds } = await createPlanWithTasks([[SHARED_ANCHOR], [SHARED_ANCHOR]]);
    const runA = await newRun();
    const runB = await newRun();
    await orphanedDirtyAged(runA, taskIds[0]!);

    const blocked = await claimAs(taskIds[1]!, "agent:rival-b", runB);

    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect((blocked.error as { field?: string }).field).toBe("gate:task-claim:anchor-overlap");
    const report = await withApp((app) => app.taskWorkflowService.ready(planId));
    expect(report.ok).toBe(true);
    if (report.ok) expect(report.value.sessions.map((s) => s.by)).toContain("agent:holder-a");
  });

  it("HAPPY: a claim whose run has ended and whose worktree is clean does not block the overlapping sibling, nor count as a session", async () => {
    const { planId, taskIds } = await createPlanWithTasks([[SHARED_ANCHOR], [SHARED_ANCHOR]]);
    const runA = await newRun();
    const runB = await newRun();
    await endRun(runA);
    expect((await claimAs(taskIds[0]!, "agent:holder-a", runA, makeWorktree({ dirty: false }))).ok).toBe(true);

    const report = await withApp((app) => app.taskWorkflowService.ready(planId));
    expect(report.ok).toBe(true);
    if (report.ok) expect(report.value.sessions.map((s) => s.by)).not.toContain("agent:holder-a");

    const allowed = await claimAs(taskIds[1]!, "agent:rival-b", runB);

    expect(allowed.ok).toBe(true);
  });

  it("NEGATIVE control: the same overlap with an OPEN run still blocks", async () => {
    const { taskIds } = await createPlanWithTasks([[SHARED_ANCHOR], [SHARED_ANCHOR]]);
    const runA = await newRun();
    const runB = await newRun();
    expect((await claimAs(taskIds[0]!, "agent:holder-a", runA, makeWorktree({ dirty: false }))).ok).toBe(true);

    const blocked = await claimAs(taskIds[1]!, "agent:rival-b", runB);

    expect(blocked.ok).toBe(false);
  });

  it("STATE: an orphaned_dirty claim whose worktree has since been committed clean stops blocking", async () => {
    const { taskIds } = await createPlanWithTasks([[SHARED_ANCHOR], [SHARED_ANCHOR]]);
    const runA = await newRun();
    const runB = await newRun();
    const worktree = makeWorktree({ dirty: true });
    expect((await claimAs(taskIds[0]!, "agent:holder-a", runA, worktree)).ok).toBe(true);
    await endRun(runA);
    patchClaim(taskIds[0]!, { at: minutesAgo(BEYOND_TTL_MINUTES) });
    expect((await claimAs(taskIds[1]!, "agent:rival-b", runB)).ok).toBe(false);

    commitAll(worktree);

    expect((await claimAs(taskIds[1]!, "agent:rival-b", runB)).ok).toBe(true);
  });
});
