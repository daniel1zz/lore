/**
 * Registering an ENDED run reopens it, and later claims by that run are owned by it.
 *
 * @spec_ref AC-ROI-6
 *   spec-run-only-write-identity-and-run-end-claim-release Scope 4 (last bullet); BR-1029 (re-registering
 *   changes nothing about the stored run — except that an ended run is reopened).
 *
 * Coverage: HAPPY (reopen clears ended_at/end_reason) / NEGATIVE (no reopen without a registration; a run
 * that stays ended does not hold its claim) / STATE (registered record unchanged, claim owned by the run) /
 * REGRESSION (registering an open run is a no-op).
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const setDefaultTimeout = (ms: number): void => { vi.setConfig({ testTimeout: ms, hookTimeout: ms }); };
import { CLAIM_CONFLICT_EXIT, createCorpus, getClaim, runLore, type Corpus } from "./cli/support/claim-run-fixture.js";
import { claimAs, cleanupWorktrees, endRun, getRunRow, makeWorktree } from "./support/run-end-fixture.js";

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

/** Registers through the CLI every time (the shared fixture memoises and would skip a re-registration). */
function register(session: string): string {
  const r = runLore(["run", "register", "--harness", "claude-code", "--session", session], corpus.dir);
  expect(r.exitCode).toBe(0);
  return `cc:${session}`;
}

function freshSession(): string {
  counter += 1;
  return `reopen-${counter}`;
}

describe("registering an ended run reopens it (AC-ROI-6)", () => {
  it("clears ended_at and end_reason, leaving the registered record untouched", () => {
    const session = freshSession();
    const run = register(session);
    const registered = getRunRow(corpus.dir, run)?.registered_at;
    expect(endRun(corpus.dir, run).exitCode).toBe(0);
    expect(getRunRow(corpus.dir, run)?.ended_at).not.toBeNull();

    register(session);

    const row = getRunRow(corpus.dir, run);
    expect(row?.ended_at).toBeNull();
    expect(row?.end_reason).toBeNull();
    expect(row?.registered_at).toBe(registered ?? "missing");
  });

  it("stays ended until a registration arrives", () => {
    const run = register(freshSession());
    expect(endRun(corpus.dir, run).exitCode).toBe(0);

    expect(runLore(["run", "show", run], corpus.dir).exitCode).toBe(0);

    expect(getRunRow(corpus.dir, run)?.ended_at).not.toBeNull();
  });

  it("registering an open run changes nothing", () => {
    const session = freshSession();
    const run = register(session);
    const before = getRunRow(corpus.dir, run);

    register(session);

    expect(getRunRow(corpus.dir, run)).toEqual(before);
  });

  it("a claim taken after the reopen is owned by the run: another run is refused naming it, the owner refreshes", async () => {
    const session = freshSession();
    const run = register(session);
    expect(endRun(corpus.dir, run).exitCode).toBe(0);
    register(session);
    const rival = register(freshSession());
    const task = await corpus.newTarget("task");
    const wt = makeWorktree({ dirty: false });

    expect(claimAs(corpus.dir, task, run, { worktree: wt }).exitCode).toBe(0);

    const refused = claimAs(corpus.dir, task, rival);
    expect(refused.exitCode).toBe(CLAIM_CONFLICT_EXIT);
    expect(refused.stderr).toContain(run);
    expect(getClaim(corpus.dir, task)?.harness_run).toBe(run);
    expect(claimAs(corpus.dir, task, run, { worktree: wt }).exitCode).toBe(0);
  });

  it("contrast: a claim taken by a run that stays ended is not owned — a clean ended run yields at once", async () => {
    const run = register(freshSession());
    const rival = register(freshSession());
    expect(endRun(corpus.dir, run).exitCode).toBe(0);
    const task = await corpus.newTarget("task");
    expect(claimAs(corpus.dir, task, run, { worktree: makeWorktree({ dirty: false }) }).exitCode).toBe(0);

    expect(claimAs(corpus.dir, task, rival).exitCode).toBe(0);

    expect(getClaim(corpus.dir, task)?.harness_run).toBe(rival);
  });
});
