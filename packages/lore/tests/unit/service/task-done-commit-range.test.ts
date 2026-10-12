/**
 * @spec_ref task-gh-1343388703-180
 *
 * `lore done` records `extra.commit_range` (base = the claim's recorded base_sha, head = the
 * claim worktree's HEAD at done time) so `lore assess` can find the task's commits without the
 * slug in a message. Real service over InMemoryStore + a real temp repo as the claimed
 * worktree (never the repo `.lore/`).
 *   HAPPY:      claim at base, commit, done -> range {base, head} recorded.
 *   BOUNDARY:   no worktree on the claim -> `not-measured` is recorded, with a reason.
 *   REGRESSION: done still archives (floors untouched) in both cases.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import type { CreateDocInput } from "@lore/core";

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Tester",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "Tester",
  GIT_COMMITTER_EMAIL: "t@example.com",
};
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) {
    const d = dirs.pop();
    if (d !== undefined) rmSync(d, { recursive: true, force: true });
  }
});

function run(dir: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd: dir, env: GIT_ENV, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function commit(dir: string, file: string, message: string): string {
  writeFileSync(join(dir, file), `${message}\n`);
  run(dir, "add", file);
  run(dir, "commit", "-q", "-m", message);
  return run(dir, "rev-parse", "HEAD");
}

async function makeArchivableTask(): Promise<{ svc: TaskWorkflowService; taskId: string }> {
  const store = new InMemoryStore();
  const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const svc = new TaskWorkflowService(store, undefined, { claimTtlMinutes: 120 });
  const plan = await cs.create({ type: "plan", title: "Range plan", content: "body" } as CreateDocInput);
  if (!plan.ok) throw new Error("plan");
  const task = await cs.create({
    type: "task",
    title: "Range task",
    parent_id: plan.value.id,
    content: "body",
    extra: { plan_id: plan.value.id },
  } as CreateDocInput);
  if (!task.ok) throw new Error("task");
  const ev = await svc.recordVerifiedEvidence(
    task.value.id,
    {
      oracle: "tsc",
      command: "bun run typecheck",
      result: "pass",
      recorded_by: "runner",
      capture_source: "runner",
      attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1, timed_out: false },
    },
    "2026-10-12T09:00:00.000Z",
  );
  if (!ev.ok) throw new Error(`evidence ${JSON.stringify(ev.error)}`);
  return { svc, taskId: task.value.id };
}

describe("lore done records extra.commit_range (issue #180)", () => {
  it("HAPPY: records base (claim base_sha) and head (worktree HEAD at done time)", async () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), "lore-done-range-test-")));
    dirs.push(repo);
    run(repo, "init", "-q", "-b", "main");
    const base = commit(repo, "seed.txt", "seed");
    const { svc, taskId } = await makeArchivableTask();

    const claim = await svc.claim(taskId, { by: "alice", worktree: repo });
    expect(claim.ok).toBe(true);
    commit(repo, "a.txt", "feat: a");
    const head = commit(repo, "b.txt", "feat: b");

    const done = await svc.done(taskId, { by: "alice" });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.value.task.status).toBe("archived");
    expect(done.value.task.extra["commit_range"]).toMatchObject({ state: "recorded", base, head, worktree: repo });
  });

  it("BOUNDARY: a task never claimed with a worktree records not-measured with a reason, and still archives", async () => {
    const { svc, taskId } = await makeArchivableTask();

    const done = await svc.done(taskId, { by: "alice" });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.value.task.status).toBe("archived");
    const range = done.value.task.extra["commit_range"] as { state?: string; reason?: string } | undefined;
    expect(range?.state).toBe("not-measured");
    expect(range?.reason).toMatch(/worktree/);
  });
});
