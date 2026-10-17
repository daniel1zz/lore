/**
 * AC-OWN-3 (spec-multi-session-concurrency-queryable-ownership-checkout) —
 * `SessionService.bootstrap`'s `active_sessions[].branches` is POPULATED from
 * a claim's auto-captured `branch` (AC-OWN-2), replacing the always-empty
 * value measured on 2026-08-11 (GAP-C: "`active_sessions[].branches` exists
 * but was `[]` for a session whose worktree held a branch with one unmerged
 * commit").
 *
 * `deriveSessions` (`@lore/core`) already threads `claim.branch` into
 * `branches[]` — this suite proves the END-TO-END path through a REAL
 * `TaskWorkflowService.claim()` call against a throwaway `mkdtemp` git repo,
 * not just the pure aggregator in isolation.
 *
 * Six-dimension coverage:
 *   HAPPY:      a claim's auto-captured branch surfaces in active_sessions[].branches
 *   NEGATIVE:   a claim on a detached-HEAD worktree (no measurable branch) → branches: []
 *   BOUNDARY:   two tasks claimed by the SAME session on the SAME branch → the
 *               branch appears exactly ONCE (dedup), not duplicated per task
 *   ERROR:      a claim whose worktree path does not exist on disk → bootstrap()
 *               does not throw, branches: []
 *   STATE:      releasing the claim removes that session from active_sessions
 *               entirely (deriveSessions only iterates FRESH claims)
 *   REGRESSION: an EXPLICIT --branch (the pre-existing, already-working path)
 *               still surfaces correctly, unaffected by the new auto-capture
 *
 * @spec_ref spec-multi-session-concurrency-queryable-ownership-checkout AC-OWN-3
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CreateDocInput, DocRecord, ReadySession } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import { SessionService } from "../../../src/service/session-service.js";

// ─── Real git-repo fixtures (throwaway `mkdtemp` — NEVER this repo's own tree) ──

const cleanupDirs: string[] = [];

afterEach(() => {
  // reason: best-effort per-test cleanup — mirrors claim-branch-binding.bun.test.ts.
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop();
    if (dir === undefined) continue;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function makeRepoOnBranch(branch: string): { repoRoot: string } {
  const repoRoot = mkdtempSync(join(tmpdir(), "lore-ac-own-3-"));
  git(repoRoot, "init", "-q", "-b", branch);
  git(repoRoot, "config", "user.email", "ac-own-3@example.com");
  git(repoRoot, "config", "user.name", "AC-OWN-3 Test");
  git(repoRoot, "commit", "-q", "--allow-empty", "-m", "seed");
  cleanupDirs.push(repoRoot);
  return { repoRoot };
}

function makeDetachedRepo(): { repoRoot: string } {
  const { repoRoot } = makeRepoOnBranch("main");
  const sha = git(repoRoot, "rev-parse", "HEAD");
  git(repoRoot, "checkout", "-q", sha);
  return { repoRoot };
}

// ─── Service fixtures ───────────────────────────────────────────────────────

function makeServices() {
  const store = new InMemoryStore();
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const taskWorkflowService = new TaskWorkflowService(store, undefined, { claimTtlMinutes: 120 });
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

async function createPlanAndTask(cs: CorpusService, title = "Task"): Promise<{ planId: string; taskId: string }> {
  const plan = await mustCreate(cs, { type: "plan", title: "Plan", content: "# Plan" } as CreateDocInput);
  const task = await mustCreate(cs, {
    type: "task",
    title,
    parent_id: plan.id,
    content: `# ${title}`,
    extra: { plan_id: plan.id },
  } as CreateDocInput);
  return { planId: plan.id, taskId: task.id };
}

function findSessionByWorktree(sessions: ReadySession[], worktree: string): ReadySession | undefined {
  return sessions.find((s) => s.worktree === worktree);
}

// ─── AC-OWN-3 ────────────────────────────────────────────────────────────────

describe("SessionService.bootstrap — active_sessions[].branches populated from claim.branch (AC-OWN-3)", () => {
  it("HAPPY: a claim's auto-captured branch surfaces in active_sessions[].branches", async () => {
    const { repoRoot } = makeRepoOnBranch("release/y");
    const { corpusService, taskWorkflowService, sessionService } = makeServices();
    const { taskId } = await createPlanAndTask(corpusService);

    const claimResult = await taskWorkflowService.claim(taskId, { by: "agent:t1", worktree: repoRoot });
    expect(claimResult.ok).toBe(true);

    const bootstrap = await sessionService.bootstrap("agent:t1");
    expect(bootstrap.ok).toBe(true);
    if (!bootstrap.ok) return;
    const session = findSessionByWorktree(bootstrap.value.active_sessions, repoRoot);
    expect(session).toBeDefined();
    expect(session?.branches).toEqual(["release/y"]);
  });

  it("NEGATIVE: a detached-HEAD worktree with no measurable branch surfaces branches: []", async () => {
    const { repoRoot } = makeDetachedRepo();
    const { corpusService, taskWorkflowService, sessionService } = makeServices();
    const { taskId } = await createPlanAndTask(corpusService);

    await taskWorkflowService.claim(taskId, { by: "agent:t2", worktree: repoRoot });

    const bootstrap = await sessionService.bootstrap("agent:t2");
    expect(bootstrap.ok).toBe(true);
    if (!bootstrap.ok) return;
    const session = findSessionByWorktree(bootstrap.value.active_sessions, repoRoot);
    expect(session).toBeDefined();
    expect(session?.branches).toEqual([]);
  });

  it("BOUNDARY: two tasks claimed by the SAME session on the SAME branch dedup to one entry", async () => {
    const { repoRoot } = makeRepoOnBranch("shared-branch");
    const { corpusService, taskWorkflowService, sessionService } = makeServices();
    const { taskId: taskA } = await createPlanAndTask(corpusService, "Task A");
    const { taskId: taskB } = await createPlanAndTask(corpusService, "Task B");

    await taskWorkflowService.claim(taskA, { by: "agent:t3", worktree: repoRoot });
    await taskWorkflowService.claim(taskB, { by: "agent:t3", worktree: repoRoot });

    const bootstrap = await sessionService.bootstrap("agent:t3");
    expect(bootstrap.ok).toBe(true);
    if (!bootstrap.ok) return;
    const session = findSessionByWorktree(bootstrap.value.active_sessions, repoRoot);
    expect(session).toBeDefined();
    expect(session?.branches).toEqual(["shared-branch"]);
    expect(session?.task_slugs.length).toBe(2);
  });

  it("ERROR: a claim whose worktree path does not exist on disk never throws, branches: []", async () => {
    const { corpusService, taskWorkflowService, sessionService } = makeServices();
    const { taskId } = await createPlanAndTask(corpusService);
    const fakeWorktree = "/definitely/does/not/exist/lore-ac-own-3";

    await taskWorkflowService.claim(taskId, { by: "agent:t4", worktree: fakeWorktree });

    const bootstrap = await sessionService.bootstrap("agent:t4");
    expect(bootstrap.ok).toBe(true);
    if (!bootstrap.ok) return;
    const session = findSessionByWorktree(bootstrap.value.active_sessions, fakeWorktree);
    expect(session).toBeDefined();
    expect(session?.branches).toEqual([]);
  });

  it("STATE: releasing the claim removes that session from active_sessions entirely", async () => {
    const { repoRoot } = makeRepoOnBranch("to-be-released");
    const { corpusService, taskWorkflowService, sessionService } = makeServices();
    const { taskId } = await createPlanAndTask(corpusService);

    await taskWorkflowService.claim(taskId, { by: "agent:t5", worktree: repoRoot });
    let bootstrap = await sessionService.bootstrap("agent:t5");
    expect(bootstrap.ok).toBe(true);
    if (bootstrap.ok) {
      expect(findSessionByWorktree(bootstrap.value.active_sessions, repoRoot)).toBeDefined();
    }

    await taskWorkflowService.release(taskId, { by: "agent:t5" });
    bootstrap = await sessionService.bootstrap("agent:t5");
    expect(bootstrap.ok).toBe(true);
    if (!bootstrap.ok) return;
    expect(findSessionByWorktree(bootstrap.value.active_sessions, repoRoot)).toBeUndefined();
  });

  it("REGRESSION: an explicit --branch still surfaces correctly, unaffected by auto-capture", async () => {
    const { repoRoot } = makeRepoOnBranch("actual-branch");
    const { corpusService, taskWorkflowService, sessionService } = makeServices();
    const { taskId } = await createPlanAndTask(corpusService);

    await taskWorkflowService.claim(taskId, {
      by: "agent:t6",
      worktree: repoRoot,
      branch: "explicitly-declared",
    });

    const bootstrap = await sessionService.bootstrap("agent:t6");
    expect(bootstrap.ok).toBe(true);
    if (!bootstrap.ok) return;
    const session = findSessionByWorktree(bootstrap.value.active_sessions, repoRoot);
    expect(session).toBeDefined();
    expect(session?.branches).toEqual(["explicitly-declared"]);
  });
});
