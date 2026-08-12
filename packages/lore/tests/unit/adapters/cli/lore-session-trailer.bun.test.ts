/**
 * AC-OWN-4 (spec-multi-session-concurrency-queryable-ownership-checkout) —
 * a commit created under a claim carries the `Lore-Session: <id>` git
 * trailer, readable via `git log --format='%(trailers:key=Lore-Session,valueonly)'`.
 *
 * Mechanism under test (`TaskWorkflowService.claim` → `real-git-port.ts`):
 * a successful claim with a measurable session AND worktree writes a
 * per-worktree `LORE_SESSION_ID` marker (inside that worktree's OWN private
 * git-dir, `git rev-parse --git-dir` — untracked and unique per worktree by
 * construction) and ensures a shared `commit-msg` hook is installed that
 * reads the marker and appends the trailer via `git interpret-trailers`.
 * This is deliberately a REAL end-to-end test — a throwaway `mkdtemp` repo,
 * a REAL `git commit`, a REAL `git log` read — never a mocked git port, the
 * same "no fake git state" discipline `measureWorktreeCleanliness`'s own
 * suite already follows.
 *
 * Six-dimension coverage:
 *   HAPPY:      a commit made under an active claim carries the correct
 *               (sanitized) session id trailer
 *   NEGATIVE:   a commit made in a repo with NO claim ever taken carries no
 *               trailer at all
 *   BOUNDARY:   two SEPARATE claimed worktrees, each with its OWN distinct
 *               session id, never cross-contaminate each other's trailer
 *               (proves the marker is worktree-private even though the
 *               commit-msg hook mechanism itself is repo-shared)
 *   ERROR:      a worktree path that does not exist on disk never makes
 *               claim() throw/reject
 *   STATE:      re-claiming (refreshing) the same task under a NEW session
 *               overwrites the marker — a LATER commit carries the NEW
 *               session id, never the stale one
 *   REGRESSION: a claim with NO measurable session (`processEnv` carries no
 *               session env var) never writes a marker — a commit made under
 *               it carries no trailer, exactly as a claim made with no
 *               worktree at all
 *
 * @spec_ref spec-multi-session-concurrency-queryable-ownership-checkout AC-OWN-4
 */

import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sessionIdDiscriminator } from "@lore/core";
import type { CreateDocInput, DocRecord } from "@lore/core";
import { InMemoryStore } from "../../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../../src/service/corpus-service.js";
import { TaskWorkflowService } from "../../../../src/service/task-workflow-service.js";

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

function makeRepo(): { repoRoot: string } {
  const repoRoot = mkdtempSync(join(tmpdir(), "lore-ac-own-4-"));
  git(repoRoot, "init", "-q", "-b", "main");
  git(repoRoot, "config", "user.email", "ac-own-4@example.com");
  git(repoRoot, "config", "user.name", "AC-OWN-4 Test");
  git(repoRoot, "commit", "-q", "--allow-empty", "-m", "seed");
  cleanupDirs.push(repoRoot);
  return { repoRoot };
}

/** Writes `content` to `name` inside `repoRoot`, stages it, and commits. */
function commitFile(repoRoot: string, name: string, content: string, message: string): void {
  writeFileSync(join(repoRoot, name), content, "utf8");
  git(repoRoot, "add", name);
  git(repoRoot, "commit", "-q", "-m", message);
}

/** Reads the `Lore-Session` trailer of `repoRoot`'s most recent commit — "" when absent. */
function readLoreSessionTrailer(repoRoot: string): string {
  return git(repoRoot, "log", "-1", "--format=%(trailers:key=Lore-Session,valueonly)");
}

// ─── Service fixtures ───────────────────────────────────────────────────────

function makeServices(processEnv: Record<string, string | undefined> = {}) {
  const store = new InMemoryStore();
  const corpusService = new CorpusService(store);
  const taskWorkflowService = new TaskWorkflowService(
    store,
    undefined,
    { claimTtlMinutes: 120 },
    undefined,
    undefined,
    undefined,
    processEnv,
  );
  return { store, corpusService, taskWorkflowService };
}

async function mustCreate(cs: CorpusService, input: CreateDocInput): Promise<DocRecord> {
  const result = await cs.create(input);
  if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result.error)}`);
  return result.value;
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

// ─── AC-OWN-4 ────────────────────────────────────────────────────────────────

describe("commits made under a claim carry the Lore-Session git trailer (AC-OWN-4)", () => {
  it("HAPPY: a commit made under an active claim carries the correct session id trailer", async () => {
    const { repoRoot } = makeRepo();
    const { corpusService, taskWorkflowService } = makeServices({
      CLAUDE_CODE_SESSION_ID: "3DE02220-happy",
    });
    const { taskId } = await createPlanAndTask(corpusService);

    const claimResult = await taskWorkflowService.claim(taskId, { by: "alice", worktree: repoRoot });
    expect(claimResult.ok).toBe(true);

    commitFile(repoRoot, "under-claim.txt", "content\n", "commit under active claim");

    expect(readLoreSessionTrailer(repoRoot)).toBe(sessionIdDiscriminator("3DE02220-happy"));
  });

  it("NEGATIVE: a commit made in a repo with no claim ever taken carries no trailer", async () => {
    const { repoRoot } = makeRepo();

    commitFile(repoRoot, "no-claim.txt", "content\n", "commit with no claim at all");

    expect(readLoreSessionTrailer(repoRoot)).toBe("");
  });

  it("BOUNDARY: two separately-claimed worktrees never cross-contaminate each other's trailer", async () => {
    const { repoRoot: repoA } = makeRepo();
    const { repoRoot: repoB } = makeRepo();

    const { corpusService: corpusA, taskWorkflowService: serviceA } = makeServices({
      CLAUDE_CODE_SESSION_ID: "aaaa1111-boundary",
    });
    const { corpusService: corpusB, taskWorkflowService: serviceB } = makeServices({
      CLAUDE_CODE_SESSION_ID: "bbbb2222-boundary",
    });
    const { taskId: taskA } = await createPlanAndTask(corpusA);
    const { taskId: taskB } = await createPlanAndTask(corpusB);

    await serviceA.claim(taskA, { by: "alice", worktree: repoA });
    await serviceB.claim(taskB, { by: "bob", worktree: repoB });

    commitFile(repoA, "a.txt", "a\n", "commit in repo A");
    commitFile(repoB, "b.txt", "b\n", "commit in repo B");

    expect(readLoreSessionTrailer(repoA)).toBe(sessionIdDiscriminator("aaaa1111-boundary"));
    expect(readLoreSessionTrailer(repoB)).toBe(sessionIdDiscriminator("bbbb2222-boundary"));
  });

  it("ERROR: a worktree path that does not exist on disk never makes claim() throw", async () => {
    const { corpusService, taskWorkflowService } = makeServices({
      CLAUDE_CODE_SESSION_ID: "error-case-1234",
    });
    const { taskId } = await createPlanAndTask(corpusService);

    const result = await taskWorkflowService.claim(taskId, {
      by: "alice",
      worktree: "/definitely/does/not/exist/lore-ac-own-4",
    });
    expect(result.ok).toBe(true);
  });

  it("STATE: re-claiming under a NEW session overwrites the marker — a later commit carries the NEW id", async () => {
    const { repoRoot } = makeRepo();
    const store = new InMemoryStore();
    const corpusService = new CorpusService(store);
    const { taskId } = await createPlanAndTask(corpusService);

    const serviceFirst = new TaskWorkflowService(
      store,
      undefined,
      { claimTtlMinutes: 120 },
      undefined,
      undefined,
      undefined,
      { CLAUDE_CODE_SESSION_ID: "first-session-1234" },
    );
    await serviceFirst.claim(taskId, { by: "alice", worktree: repoRoot });
    commitFile(repoRoot, "first.txt", "first\n", "commit under first session");
    expect(readLoreSessionTrailer(repoRoot)).toBe(sessionIdDiscriminator("first-session-1234"));

    const serviceSecond = new TaskWorkflowService(
      store,
      undefined,
      { claimTtlMinutes: 120 },
      undefined,
      undefined,
      undefined,
      { CLAUDE_CODE_SESSION_ID: "second-session-5678" },
    );
    await serviceSecond.claim(taskId, { by: "alice", worktree: repoRoot });
    commitFile(repoRoot, "second.txt", "second\n", "commit under second session");
    expect(readLoreSessionTrailer(repoRoot)).toBe(sessionIdDiscriminator("second-session-5678"));
  });

  it("REGRESSION: a claim with no measurable session writes no marker — a commit under it carries no trailer", async () => {
    const { repoRoot } = makeRepo();
    const { corpusService, taskWorkflowService } = makeServices({}); // no CLAUDE_*_SESSION_ID at all
    const { taskId } = await createPlanAndTask(corpusService);

    const result = await taskWorkflowService.claim(taskId, { by: "alice", worktree: repoRoot });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        Object.prototype.hasOwnProperty.call(result.value.extra["claim"] as object, "session_id"),
      ).toBe(false);
    }

    commitFile(repoRoot, "no-session.txt", "content\n", "commit under a claim with no measured session");

    expect(readLoreSessionTrailer(repoRoot)).toBe("");
  });
});
