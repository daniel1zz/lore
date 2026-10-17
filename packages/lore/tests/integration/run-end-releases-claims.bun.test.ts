/**
 * `lore run end` ends a run and its claims (clean claims released, dirty claims kept as orphaned_dirty).
 *
 * @spec_ref AC-ROI-4
 *   spec-run-only-write-identity-and-run-end-claim-release Scope 4; ADR decision 4; BR-1057, BR-1043.
 *
 * Drives the REAL CLI against an mkdtemp corpus (`lore init`, never the repo's `.lore/`), with REAL temp
 * repositories as the claims' worktrees, so the dirtiness measurement is a real `status` call.
 *
 * Coverage: HAPPY (clean release) / NEGATIVE (dirty kept, unknown run writes nothing, missing --reason) /
 *           BOUNDARY (no recorded worktree, vanished worktree) / STATE (ended_at, first end wins, other
 *           runs' claims untouched) / REGRESSION (release audit records the ending run).
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const setDefaultTimeout = (ms: number): void => { vi.setConfig({ testTimeout: ms, hookTimeout: ms }); };
import { rmSync } from "node:fs";
import { createCorpus, getClaim, registerRun, runLore, type Corpus } from "./cli/support/claim-run-fixture.js";
import {
  REASON,
  claimAs,
  cleanupWorktrees,
  countRows,
  endRun,
  getRunRow,
  latestAudit,
  makeWorktree,
} from "./support/run-end-fixture.js";

setDefaultTimeout(180_000);

let corpus: Corpus;
let counter = 0;

beforeAll(async () => {
  corpus = await createCorpus();
});

afterAll(() => {
  corpus.cleanup();
  cleanupWorktrees();
});

function freshRun(): string {
  counter += 1;
  const run = `cc:end-rel-${counter}`;
  registerRun(corpus.dir, run);
  return run;
}

describe("lore run end — claim release (AC-ROI-4)", () => {
  it("releases a claim whose worktree is clean, stamps ended_at/end_reason, and records the ENDING run on the release", async () => {
    const run = freshRun();
    const task = await corpus.newTarget("task");
    const wt = makeWorktree({ dirty: false });
    expect(claimAs(corpus.dir, task, run, { worktree: wt }).exitCode).toBe(0);
    expect(getClaim(corpus.dir, task)?.harness_run).toBe(run);

    const r = endRun(corpus.dir, run);

    expect(r.exitCode).toBe(0);
    expect(getClaim(corpus.dir, task)).toBeUndefined();
    const row = getRunRow(corpus.dir, run);
    expect(row?.ended_at).not.toBeNull();
    expect(row?.end_reason).toBe(REASON);
    const audit = latestAudit(corpus.dir, task);
    expect(audit.action).toBe("release");
    expect(audit.details["harness_run"]).toBe(run);
    expect(audit.details["worktree"]).toBe(wt);
  });

  it("keeps a claim whose worktree has uncommitted changes, marks it orphaned_dirty naming the worktree, and still ends the run", async () => {
    const run = freshRun();
    const task = await corpus.newTarget("task");
    const wt = makeWorktree({ dirty: true });
    expect(claimAs(corpus.dir, task, run, { worktree: wt }).exitCode).toBe(0);

    const r = endRun(corpus.dir, run);

    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(wt);
    const kept = getClaim(corpus.dir, task);
    expect(kept).toBeDefined();
    expect(kept?.["orphaned_dirty"]).toMatchObject({ worktree: wt });
    expect(kept?.harness_run).toBe(run);
    expect(getRunRow(corpus.dir, run)?.ended_at).not.toBeNull();
  });

  it("releases a claim with NO recorded worktree and records worktree: not-measured (never clean)", async () => {
    const run = freshRun();
    const task = await corpus.newTarget("task");
    expect(claimAs(corpus.dir, task, run).exitCode).toBe(0);
    expect(getClaim(corpus.dir, task)?.["worktree"]).toBeUndefined();

    const r = endRun(corpus.dir, run);

    expect(r.exitCode).toBe(0);
    expect(getClaim(corpus.dir, task)).toBeUndefined();
    const audit = latestAudit(corpus.dir, task);
    expect(audit.action).toBe("release");
    expect(audit.details["worktree"]).toBe("not-measured");
    expect(audit.details["worktree"]).not.toBe("clean");
  });

  it("releases a claim whose recorded worktree no longer exists as not-measured, never as clean", async () => {
    const run = freshRun();
    const task = await corpus.newTarget("task");
    const wt = makeWorktree({ dirty: false });
    expect(claimAs(corpus.dir, task, run, { worktree: wt }).exitCode).toBe(0);
    rmSync(wt, { recursive: true, force: true });

    const r = endRun(corpus.dir, run);

    expect(r.exitCode).toBe(0);
    expect(getClaim(corpus.dir, task)).toBeUndefined();
    expect(latestAudit(corpus.dir, task).details["worktree"]).toBe("not-measured");
  });

  it("handles every claim of the run, and leaves another run's claim untouched", async () => {
    const run = freshRun();
    const other = freshRun();
    const cleanTask = await corpus.newTarget("task");
    const dirtyTask = await corpus.newTarget("task");
    const othersTask = await corpus.newTarget("task");
    expect(claimAs(corpus.dir, cleanTask, run, { worktree: makeWorktree({ dirty: false }) }).exitCode).toBe(0);
    expect(claimAs(corpus.dir, dirtyTask, run, { worktree: makeWorktree({ dirty: true }) }).exitCode).toBe(0);
    expect(claimAs(corpus.dir, othersTask, other, { worktree: makeWorktree({ dirty: false }) }).exitCode).toBe(0);

    expect(endRun(corpus.dir, run).exitCode).toBe(0);

    expect(getClaim(corpus.dir, cleanTask)).toBeUndefined();
    expect(getClaim(corpus.dir, dirtyTask)?.["orphaned_dirty"]).toBeDefined();
    expect(getClaim(corpus.dir, othersTask)?.harness_run).toBe(other);
    expect(getRunRow(corpus.dir, other)?.ended_at).toBeNull();
  });

  it("exits 0 and writes nothing for an unknown run id", () => {
    const before = countRows(corpus.dir);

    const r = endRun(corpus.dir, "cc:never-registered");

    expect(r.exitCode).toBe(0);
    expect(countRows(corpus.dir)).toEqual(before);
    expect(getRunRow(corpus.dir, "cc:never-registered")).toBeNull();
  });

  it("keeps the FIRST end on a repeat: exit 0, ended_at and end_reason unchanged", () => {
    const run = freshRun();
    expect(endRun(corpus.dir, run, "first").exitCode).toBe(0);
    const first = getRunRow(corpus.dir, run);

    expect(endRun(corpus.dir, run, "second").exitCode).toBe(0);

    expect(getRunRow(corpus.dir, run)).toEqual(first);
    expect(first?.end_reason).toBe("first");
  });

  it("requires --reason (usage error, exit 2) and ends nothing", () => {
    const run = freshRun();

    const r = runLore(["run", "end", run], corpus.dir);

    expect(r.exitCode).toBe(2);
    expect(getRunRow(corpus.dir, run)?.ended_at).toBeNull();
  });
});
