/**
 * AC-OWN-2 (spec-multi-session-concurrency-queryable-ownership-checkout) —
 * `TaskWorkflowService.claim` AUTO-CAPTURES `claim.branch` from the caller's
 * worktree when `--branch` is not given explicitly, via a REAL `git`
 * subprocess against a throwaway `mkdtemp` repo — never a mocked git state
 * (mirrors `measureWorktreeCleanliness`'s own "no fake git" precedent in
 * `task-workflow-service.ts`).
 *
 * The load-bearing distinction this AC exists to prove: when no branch is
 * measurable, the persisted claim has NO `branch` key at all — "unmeasured"
 * — and is NEVER coerced to a placeholder value a later consumer could
 * mistake for "unowned" (a DIFFERENT fact, `lore territory`'s job). Mirrors
 * `gate-predicates.ts::compareClaimSessions`'s three-valued discipline:
 * "not measured" and "known to be absent" are different facts with opposite
 * safe defaults, and this task exists specifically to stop them being
 * collapsed.
 *
 * Six-dimension coverage:
 *   HAPPY:      a worktree on a named branch, no --branch given → auto-captured
 *   NEGATIVE:   an EXPLICIT --branch always wins over auto-detection, even
 *               when it disagrees with the worktree's real git branch
 *   BOUNDARY:   detached HEAD → claim.branch absent, never the literal "HEAD"
 *   ERROR:      a worktree path that does not exist on disk → claim.branch
 *               absent, claim() does not throw/reject
 *   STATE:      a same-holder fresh refresh with no branch/worktree re-passed
 *               carries the PREVIOUSLY auto-detected branch forward unchanged
 *   REGRESSION: no --worktree given at all → detection is never attempted
 *               (claim.branch stays absent, exactly as before this task)
 *
 * @spec_ref spec-multi-session-concurrency-queryable-ownership-checkout AC-OWN-2
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CreateDocInput, DocRecord } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import { actedStore } from "../../live-invocation.js";
import { runOfName } from "../../helpers/test-run-identity.js";

import { fakeWorktreeProbe } from "../../helpers/fake-worktree-probe.js";
// ─── Real git-repo fixtures (throwaway `mkdtemp` — NEVER this repo's own tree) ──

const cleanupDirs: string[] = [];

afterEach(() => {
  // reason: best-effort per-test cleanup — a failure here is a disk leak in
  // the test runner's own tmpdir, never a correctness issue for assertions
  // already made above it (mirrors falsifier-execution-root.bun.test.ts).
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

/** `git init` + one seed commit, checked out on `branch`. */
function makeRepoOnBranch(branch: string): { repoRoot: string } {
  const repoRoot = mkdtempSync(join(tmpdir(), "lore-ac-own-2-"));
  git(repoRoot, "init", "-q", "-b", branch);
  git(repoRoot, "config", "user.email", "ac-own-2@example.com");
  git(repoRoot, "config", "user.name", "AC-OWN-2 Test");
  git(repoRoot, "commit", "-q", "--allow-empty", "-m", "seed");
  cleanupDirs.push(repoRoot);
  return { repoRoot };
}

/** A repo whose HEAD is detached (checked out on a commit sha, no branch). */
function makeDetachedRepo(): { repoRoot: string } {
  const { repoRoot } = makeRepoOnBranch("main");
  const sha = git(repoRoot, "rev-parse", "HEAD");
  git(repoRoot, "checkout", "-q", sha);
  return { repoRoot };
}

// ─── Doc/service fixtures ───────────────────────────────────────────────────

async function mustCreate(cs: CorpusService, input: CreateDocInput): Promise<DocRecord> {
  const result = await cs.create(input);
  if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

function makeServices() {
  const store = actedStore(new InMemoryStore());
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const taskWorkflowService = new TaskWorkflowService(store, undefined, { claimTtlMinutes: 120 }, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, fakeWorktreeProbe());
  return { store, corpusService, taskWorkflowService };
}

async function createPlanAndTask(cs: CorpusService): Promise<{ taskId: string }> {
  const plan = await mustCreate(cs, { type: "plan", title: "Plan", content: "# Plan" } as CreateDocInput);
  const task = await mustCreate(cs, {
    type: "task",
    title: "Task",
    parent_id: plan.id,
    content: "# Task",
    extra: { plan_id: plan.id },
  } as CreateDocInput);
  return { taskId: task.id };
}

// ─── AC-OWN-2 ────────────────────────────────────────────────────────────────

describe("TaskWorkflowService.claim — auto-captures claim.branch from the worktree (AC-OWN-2)", () => {
  it("HAPPY: a worktree on a named branch, no --branch given, auto-captures that branch", async () => {
    const { repoRoot } = makeRepoOnBranch("feat/ownership-binding");
    const { corpusService, taskWorkflowService } = makeServices();
    const { taskId } = await createPlanAndTask(corpusService);

    const result = await taskWorkflowService.claim(taskId, { by: "alice", harnessRun: runOfName("alice"), worktree: repoRoot });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.value.extra["claim"] as Record<string, unknown>)["branch"]).toBe(
      "feat/ownership-binding",
    );
  });

  it("NEGATIVE: an explicit --branch wins outright, even when it disagrees with the real git branch", async () => {
    const { repoRoot } = makeRepoOnBranch("actual-branch");
    const { corpusService, taskWorkflowService } = makeServices();
    const { taskId } = await createPlanAndTask(corpusService);

    const result = await taskWorkflowService.claim(taskId, {
      by: "alice", harnessRun: runOfName("alice"),
      worktree: repoRoot,
      branch: "declared-branch",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.value.extra["claim"] as Record<string, unknown>)["branch"]).toBe("declared-branch");
  });

  it('BOUNDARY: a detached HEAD worktree records NO branch — never the literal "HEAD"', async () => {
    const { repoRoot } = makeDetachedRepo();
    const { corpusService, taskWorkflowService } = makeServices();
    const { taskId } = await createPlanAndTask(corpusService);

    const result = await taskWorkflowService.claim(taskId, { by: "alice", harnessRun: runOfName("alice"), worktree: repoRoot });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const claim = result.value.extra["claim"] as Record<string, unknown>;
    expect(claim["branch"]).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(claim, "branch")).toBe(false);
  });

  it("ERROR: a worktree path that does not exist on disk records no branch and never throws", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const { taskId } = await createPlanAndTask(corpusService);

    const result = await taskWorkflowService.claim(taskId, {
      by: "alice", harnessRun: runOfName("alice"),
      worktree: "/definitely/does/not/exist/lore-ac-own-2",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const claim = result.value.extra["claim"] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(claim, "branch")).toBe(false);
  });

  it("STATE: a same-holder fresh refresh with no branch/worktree re-passed carries the auto-detected branch forward", async () => {
    const { repoRoot } = makeRepoOnBranch("carried-forward-branch");
    const { corpusService, taskWorkflowService } = makeServices();
    const { taskId } = await createPlanAndTask(corpusService);

    const first = await taskWorkflowService.claim(
      taskId,
      { by: "alice", harnessRun: runOfName("alice"), worktree: repoRoot },
      () => "2026-08-12T09:00:00.000Z",
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect((first.value.extra["claim"] as Record<string, unknown>)["branch"]).toBe(
      "carried-forward-branch",
    );

    const refresh = await taskWorkflowService.claim(
      taskId,
      { by: "alice", harnessRun: runOfName("alice") },
      () => "2026-08-12T09:05:00.000Z",
    );
    expect(refresh.ok).toBe(true);
    if (!refresh.ok) return;
    expect((refresh.value.extra["claim"] as Record<string, unknown>)["branch"]).toBe(
      "carried-forward-branch",
    );
  });

  it("REGRESSION: no --worktree given at all — detection is never attempted, branch stays absent", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const { taskId } = await createPlanAndTask(corpusService);

    const result = await taskWorkflowService.claim(taskId, { by: "alice", harnessRun: runOfName("alice") });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const claim = result.value.extra["claim"] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(claim, "branch")).toBe(false);
  });
});
