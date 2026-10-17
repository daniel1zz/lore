// @spawns packages/lore/src/index.ts
/**
 * Staleness accounts for ended runs and orphaned_dirty claims.
 *
 * @spec_ref AC-ROI-5
 *   spec-run-only-write-identity-and-run-end-claim-release Scope 5; ADR decision 5; BR-1058.
 *
 * The clean re-check is LAZY (claim time and `lore ready`; no sweep), so every verdict below is observed by
 * performing a claim or reading `lore ready`, never by waiting for a background job.
 *
 * Coverage: HAPPY (ended+clean takeover, dirty claim cleaned -> takeover) / NEGATIVE (open run still holds,
 * aged orphaned_dirty refuses a plain claim) / BOUNDARY (older than claim_ttl_minutes) / STATE (steal
 * output names the dirty worktree, `lore ready` reflects the lazy re-check) / REGRESSION (open-run claim
 * stays fresh).
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const setDefaultTimeout = (ms: number): void => { vi.setConfig({ testTimeout: ms, hookTimeout: ms }); };
import { CLAIM_CONFLICT_EXIT, ageClaim, createCorpus, getClaim, registerRun, type Corpus } from "./cli/support/claim-run-fixture.js";
import {
  claimAs,
  cleanupWorktrees,
  commitAll,
  endRun,
  makeWorktree,
  readyClaimStale,
} from "./support/run-end-fixture.js";

setDefaultTimeout(180_000);

/** Well past the default `claim_ttl_minutes` (120). */
const BEYOND_TTL_MINUTES = 500;

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
  const run = `cc:end-stale-${counter}`;
  registerRun(corpus.dir, run);
  return run;
}

/** A task claimed by `run` from a dirty `worktree`, then the run is ended: the claim is kept as orphaned_dirty. */
async function orphanedDirtyTask(run: string, worktree: string): Promise<string> {
  const task = await corpus.newTarget("task");
  expect(claimAs(corpus.dir, task, run, { worktree }).exitCode).toBe(0);
  expect(endRun(corpus.dir, run).exitCode).toBe(0);
  expect(getClaim(corpus.dir, task)?.["orphaned_dirty"]).toBeDefined();
  return task;
}

describe("ended run + clean worktree is stale at once (AC-ROI-5)", () => {
  it("lets a plain claim take a FRESH claim of an ended run whose worktree is clean", async () => {
    const run = freshRun();
    const rival = freshRun();
    expect(endRun(corpus.dir, run).exitCode).toBe(0);
    const task = await corpus.newTarget("task");
    expect(claimAs(corpus.dir, task, run, { worktree: makeWorktree({ dirty: false }) }).exitCode).toBe(0);

    const r = claimAs(corpus.dir, task, rival);

    expect(r.exitCode).toBe(0);
    expect(getClaim(corpus.dir, task)?.harness_run).toBe(rival);
  });

  it("control: the same fresh claim of a run that has NOT ended refuses a plain claim", async () => {
    const run = freshRun();
    const rival = freshRun();
    const task = await corpus.newTarget("task");
    expect(claimAs(corpus.dir, task, run, { worktree: makeWorktree({ dirty: false }) }).exitCode).toBe(0);

    const r = claimAs(corpus.dir, task, rival);

    expect(r.exitCode).toBe(CLAIM_CONFLICT_EXIT);
    expect(getClaim(corpus.dir, task)?.harness_run).toBe(run);
  });

  it("shows the ended-run claim as stale in `lore ready`, and the open-run claim as fresh", async () => {
    const ended = freshRun();
    const open = freshRun();
    expect(endRun(corpus.dir, ended).exitCode).toBe(0);
    const endedTask = await corpus.newTarget("task");
    const openTask = await corpus.newTarget("task");
    expect(claimAs(corpus.dir, endedTask, ended, { worktree: makeWorktree({ dirty: false }) }).exitCode).toBe(0);
    expect(claimAs(corpus.dir, openTask, open, { worktree: makeWorktree({ dirty: false }) }).exitCode).toBe(0);

    expect(readyClaimStale(corpus.dir, endedTask)).toBe(true);
    expect(readyClaimStale(corpus.dir, openTask)).toBe(false);
  });
});

describe("orphaned_dirty claims are exempt from age (AC-ROI-5)", () => {
  it("refuses a plain claim even when older than claim_ttl_minutes", async () => {
    const run = freshRun();
    const rival = freshRun();
    const task = await orphanedDirtyTask(run, makeWorktree({ dirty: true }));
    ageClaim(corpus.dir, task, BEYOND_TTL_MINUTES);

    const r = claimAs(corpus.dir, task, rival);

    expect(r.exitCode).toBe(CLAIM_CONFLICT_EXIT);
    expect(getClaim(corpus.dir, task)?.harness_run).toBe(run);
    expect(readyClaimStale(corpus.dir, task)).toBe(false);
  });

  it("yields to --steal, whose output names the dirty worktree it inherits", async () => {
    const run = freshRun();
    const rival = freshRun();
    const wt = makeWorktree({ dirty: true });
    const task = await orphanedDirtyTask(run, wt);
    ageClaim(corpus.dir, task, BEYOND_TTL_MINUTES);

    const r = claimAs(corpus.dir, task, rival, { steal: true });

    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(wt);
    const taken = getClaim(corpus.dir, task);
    expect(taken?.harness_run).toBe(rival);
    expect(taken?.["orphaned_dirty"]).toBeUndefined();
  });

  it("becomes stale once its worktree is clean: `lore ready` agrees and a plain claim then takes it", async () => {
    const run = freshRun();
    const rival = freshRun();
    const wt = makeWorktree({ dirty: true });
    const task = await orphanedDirtyTask(run, wt);
    ageClaim(corpus.dir, task, BEYOND_TTL_MINUTES);
    expect(readyClaimStale(corpus.dir, task)).toBe(false);

    commitAll(wt);

    expect(readyClaimStale(corpus.dir, task)).toBe(true);
    const r = claimAs(corpus.dir, task, rival);
    expect(r.exitCode).toBe(0);
    expect(getClaim(corpus.dir, task)?.harness_run).toBe(rival);
    expect(getClaim(corpus.dir, task)?.["orphaned_dirty"]).toBeUndefined();
  });
});
