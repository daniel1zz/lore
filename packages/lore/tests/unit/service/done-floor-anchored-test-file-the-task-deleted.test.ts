/**
 * task-done-floor-accepts-an-anchored-test-file-the-task-deleted
 *
 * The `unfiltered-test-file` done floor demands a run of every anchored test file. A task that DELETES a
 * test file must anchor it (the turn-end review requires deleted files to be anchored), so the floor must
 * accept a file the task's own branch removed, and must keep refusing a file that never existed.
 * Real service over InMemoryStore + a real temp git repo (never the repo `.lore/`).
 *   HAPPY:      branch deletes the anchored test file and lands -> archives; the done message names it.
 *   NEGATIVE:   anchored test file exists nowhere and was never deleted by the branch -> refused naming it.
 *   NEGATIVE:   file deleted on main by someone else, branch kept it -> refused (not "removed by this task").
 *   NEGATIVE:   branch deleted it but has not landed (file still on main) -> refused.
 *   ERROR:      git cannot measure -> refused naming the measurement failure (fail closed).
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import { createRealWorktreeProbe, type WorktreeGitProbe } from "../../../src/service/worktree-cleanup.js";
import { formatDoneMessage } from "../../../src/adapters/cli/done-render.js";
import type { CreateDocInput, LoreError } from "@lore/core";
import { actedStore } from "../../live-invocation.js";
import { runOfName } from "../../helpers/test-run-identity.js";

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Tester",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "Tester",
  GIT_COMMITTER_EMAIL: "t@example.com",
};
const DELETED_TEST = "packages/x/tests/gone.test.ts";
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) {
    const d = dirs.pop();
    if (d !== undefined) rmSync(d, { recursive: true, force: true });
  }
});

/** The refusal's message; a floor refusal is always a VALIDATION_ERROR. */
function refusalText(error: LoreError): string {
  if (error.code !== "VALIDATION_ERROR") throw new Error(`expected a floor refusal, got ${error.code}`);
  return error.message;
}

function run(dir: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd: dir, env: GIT_ENV, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function write(dir: string, file: string, body: string): void {
  mkdirSync(join(dir, file, ".."), { recursive: true });
  writeFileSync(join(dir, file), body);
}

function commitAll(dir: string, message: string): void {
  run(dir, "add", "-A");
  run(dir, "commit", "-q", "-m", message);
}

/** A repo on `main` holding the test file, plus branch `agent-x` checked out from it. */
function seedRepo(): string {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "lore-done-deleted-anchor-")));
  dirs.push(repo);
  run(repo, "init", "-q", "-b", "main");
  write(repo, DELETED_TEST, "test('x', () => {});\n");
  write(repo, "seed.txt", "seed\n");
  commitAll(repo, "seed");
  run(repo, "checkout", "-q", "-b", "agent-x");
  return repo;
}

async function claimedTask(
  repo: string,
  anchors: string[],
  probe: WorktreeGitProbe = createRealWorktreeProbe(repo),
): Promise<{ svc: TaskWorkflowService; taskId: string }> {
  const store = actedStore(new InMemoryStore());
  const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const svc = new TaskWorkflowService(
    store, undefined, { claimTtlMinutes: 120 },
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    probe,
  );
  const plan = await cs.create({ type: "plan", title: "Deleted anchor plan", content: "body" } as CreateDocInput);
  if (!plan.ok) throw new Error("plan");
  const task = await cs.create({
    type: "task", title: "Deleted anchor task", parent_id: plan.value.id, content: "body",
    extra: { plan_id: plan.value.id, file_anchors: anchors },
  } as CreateDocInput);
  if (!task.ok) throw new Error("task");
  const claim = await svc.claim(task.value.id, { by: "alice", harnessRun: runOfName("alice"), worktree: "agent-x" });
  if (!claim.ok) throw new Error(`claim ${JSON.stringify(claim.error)}`);
  // reason: the landing predicate counts a pass recorded AFTER the latest claim and bound to a clean commit on main (head_sha).
  const ev = await svc.recordVerifiedEvidence(
    task.value.id,
    {
      oracle: "tsc", command: "bun run typecheck", result: "pass", recorded_by: "runner", capture_source: "runner",
      attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1, timed_out: false, head_sha: run(repo, "rev-parse", "main"), worktree_dirty: false },
    },
    new Date(Date.now() + 1000).toISOString(),
  );
  if (!ev.ok) throw new Error("evidence");
  return { svc, taskId: task.value.id };
}

function branchDeletesTestFileAndLands(repo: string): void {
  run(repo, "rm", "-q", DELETED_TEST);
  commitAll(repo, "delete the test file");
  run(repo, "checkout", "-q", "main");
  run(repo, "merge", "--no-ff", "-q", "-m", "land", "agent-x");
}

/** What `lore integrate` records on the claimant when it lands `agent-x` (BR-1336); the `not-landed` floor reads only this. */
async function recordLandingOfAgentX(repo: string, svc: TaskWorkflowService): Promise<void> {
  const mergeSha = run(repo, "rev-parse", "main");
  const recorded = await svc.recordLanding({
    branch: "agent-x",
    branch_head: run(repo, "rev-parse", "agent-x"),
    main_before: run(repo, "rev-parse", `${mergeSha}^1`),
    main_after: mergeSha,
    landing_commit: mergeSha,
  });
  if (!recorded.ok) throw new Error(`recordLanding ${JSON.stringify(recorded.error)}`);
}

describe("done floor: an anchored test file the task deleted", () => {
  it("HAPPY: archives when the claimed branch deleted the anchored test file and landed, and the done message names it", async () => {
    const repo = seedRepo();
    const { svc, taskId } = await claimedTask(repo, [DELETED_TEST]);
    branchDeletesTestFileAndLands(repo);
    await recordLandingOfAgentX(repo, svc);

    const done = await svc.done(taskId, { by: "alice", harnessRun: runOfName("alice") });
    expect(done.ok, JSON.stringify(done.ok ? null : done.error)).toBe(true);
    if (!done.ok) return;
    expect(done.value.task.status).toBe("archived");
    expect(done.value.removed_test_anchors).toEqual([DELETED_TEST]);
    expect(formatDoneMessage(done.value)).toContain(`${DELETED_TEST}: removed by this task`);
  }, 60_000);

  it("NEGATIVE: an anchored test file that exists nowhere and was never deleted by the branch is still refused naming it", async () => {
    const repo = seedRepo();
    const typo = "packages/x/tests/never-existed.test.ts";
    const { svc, taskId } = await claimedTask(repo, [typo]);
    write(repo, "other.txt", "o\n");
    commitAll(repo, "unrelated work");
    run(repo, "checkout", "-q", "main");
    run(repo, "merge", "--no-ff", "-q", "-m", "land", "agent-x");

    const done = await svc.done(taskId, { by: "alice", harnessRun: runOfName("alice") });
    expect(done.ok).toBe(false);
    if (done.ok) return;
    expect(refusalText(done.error)).toContain(typo);
    expect(refusalText(done.error)).toContain("[floor: unfiltered-test-file]");
  }, 60_000);

  it("NEGATIVE: a file someone else deleted on main while the branch kept it is not removed by this task", async () => {
    const repo = seedRepo();
    const { svc, taskId } = await claimedTask(repo, [DELETED_TEST]);
    write(repo, "other.txt", "o\n");
    commitAll(repo, "unrelated work");
    run(repo, "checkout", "-q", "main");
    run(repo, "rm", "-q", DELETED_TEST);
    commitAll(repo, "someone else deletes it on main");
    run(repo, "merge", "--no-ff", "-q", "-m", "land", "agent-x");

    const done = await svc.done(taskId, { by: "alice", harnessRun: runOfName("alice") });
    expect(done.ok).toBe(false);
    if (done.ok) return;
    expect(refusalText(done.error)).toContain(DELETED_TEST);
    expect(refusalText(done.error)).toContain("[floor: unfiltered-test-file]");
  }, 60_000);

  it("NEGATIVE: a branch that deleted the file but has not landed (file still on main) is refused", async () => {
    const repo = seedRepo();
    const { svc, taskId } = await claimedTask(repo, [DELETED_TEST]);
    run(repo, "rm", "-q", DELETED_TEST);
    commitAll(repo, "delete the test file");

    const done = await svc.done(taskId, { by: "alice", harnessRun: runOfName("alice") });
    expect(done.ok).toBe(false);
    if (done.ok) return;
    expect(refusalText(done.error)).toContain(DELETED_TEST);
  }, 60_000);

  it("ERROR: when git cannot measure, the refusal names the measurement failure and never assumes deleted", async () => {
    const repo = seedRepo();
    const real = createRealWorktreeProbe(repo);
    const blind: WorktreeGitProbe = {
      ...real,
      pathExistsAtRef: () => ({ ok: false, reason: "simulated ls-tree failure" }),
    };
    const { svc, taskId } = await claimedTask(repo, [DELETED_TEST], blind);
    branchDeletesTestFileAndLands(repo);

    const done = await svc.done(taskId, { by: "alice", harnessRun: runOfName("alice") });
    expect(done.ok).toBe(false);
    if (done.ok) return;
    expect(refusalText(done.error)).toContain(DELETED_TEST);
    expect(refusalText(done.error)).toContain("simulated ls-tree failure");
  }, 60_000);
});
