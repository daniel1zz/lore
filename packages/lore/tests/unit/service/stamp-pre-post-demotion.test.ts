/**
 * AC-CT-5 (SPEC-143, corrected 2026-10-17 / R13) — the runner reads the state
 * stamp (`head_sha` + `worktree_dirty`) BEFORE and AFTER the AC command.
 *
 * Seam (spec-pinned): every state change here is REAL. The executor is the real
 * `executeVerifySpawnSpec` (a real `sh -c` child), and the AC command itself runs a
 * real `git commit` (or writes a real uncommitted file) in a throwaway git repo, so
 * the change lands BETWEEN the runner's two reads. No fake `GitPort`, no hand-fed
 * second digest: a fake would prove the comparison executes, never that the runner
 * reads where a concurrent write can land.
 *
 * Scenarios (failure-first):
 *  - state_moved : a commit lands mid-run -> `stamp_unbound_reason: "state_moved"`,
 *                  NO `state_stamp`, and the post-run HEAD is NOT recorded as `head_sha`.
 *  - dirty_tree  : uncommitted file at the PRE read, and (separately) at the POST read
 *                  -> `stamp_unbound_reason: "dirty_tree"`, NO `state_stamp`.
 *  - CONTROL     : clean tree, nothing moves -> `state_stamp` present, no reason. Without
 *                  this a runner that demotes everything would pass the three above.
 *  - PRECEDENCE  : head moved AND tree dirty -> `state_moved` (a moved state is the
 *                  stronger fact; documented so the choice is not accidental).
 *  - git absent  : no stamp and no reason (nothing was measured; never a guessed reason).
 */
import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok } from "@lore/core";
import type { AcceptanceCriterion, DocRecord, LoreError, PlanBundle, Result } from "@lore/core";
import { VerifyRunnerService } from "../../../src/service/verify-runner-service.js";
import type { VerifySpawnSpec, VerifyExecutionResult } from "../../../src/service/verify-spawn.js";
import { executeVerifySpawnSpec } from "../../../src/service/verify-executor.js";
import type { VerifiedEvidenceInput } from "../../../src/service/task-workflow-service.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function makeTempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

const GIT_IDENT = ["-c", "user.name=t", "-c", "user.email=t@example.com"];

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", [...GIT_IDENT, ...args], { cwd, encoding: "utf8" }).trim();
}

function makeRepo(): { repo: string; head: string } {
  const repo = makeTempDir("lore-ct5-repo-");
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "a.txt"), "one\n");
  git(repo, "add", "a.txt");
  git(repo, "commit", "-q", "-m", "c1");
  return { repo, head: git(repo, "rev-parse", "HEAD") };
}

const NOW = "2026-10-17T10:00:00.000Z";
const FRESH_CLAIM_AT = "2026-10-17T09:59:00.000Z";
const COMMIT_CMD = `git ${GIT_IDENT.join(" ")} commit --allow-empty -q -m moved-mid-run`;

function makeDoc(overrides: Partial<DocRecord> & Pick<DocRecord, "id" | "type" | "title">): DocRecord {
  return {
    slug: overrides.id,
    role: "plan",
    status: "approved",
    priority: "medium",
    content: "body",
    parent_id: null,
    created_at: "2026-10-17T00:00:00.000Z",
    updated_at: "2026-10-17T00:00:00.000Z",
    created_by: "alice",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
    ...overrides,
  } as DocRecord;
}

function bundle(command: string): PlanBundle {
  const ac: AcceptanceCriterion = {
    id: "AC-1",
    statement: "AC-1 statement",
    verify: { mode: "script", oracle: "other", command },
  };
  return {
    plan: makeDoc({ id: "plan-1", type: "plan", title: "Plan" }),
    spec: makeDoc({ id: "spec-1", type: "spec", title: "Spec", extra: { acceptance_criteria: [ac] } }),
    tasks: [
      makeDoc({
        id: "task-1",
        type: "task",
        title: "Task",
        slug: "task-1",
        parent_id: "plan-1",
        extra: { ac_scope: ["AC-1"], claim: { by: "alice", at: FRESH_CLAIM_AT } },
      }),
    ],
  };
}

type Attestation = NonNullable<VerifiedEvidenceInput["attestation"]>;

/** Runs the REAL executor with `command` inside `repo` and returns the recorded attestation. */
async function attestRealRun(repo: string, command: string): Promise<Attestation> {
  const recorded: VerifiedEvidenceInput[] = [];
  const service = new VerifyRunnerService(
    async (): Promise<Result<PlanBundle, LoreError>> => ok(bundle(command)),
    async (id, entry): Promise<Result<DocRecord, LoreError>> => {
      recorded.push(entry);
      return ok(makeDoc({ id, type: "task", title: "Task" }));
    },
    async (spec: VerifySpawnSpec): Promise<Result<VerifyExecutionResult, LoreError>> => executeVerifySpawnSpec(spec),
    { tmpDir: tmpdir(),
      repoRoot: repo,
      defaultTimeoutMs: 60_000,
      claimTtlMinutes: 120,
      requireCommandApproval: false,
      envAllowlist: [],
      envPassthroughAll: true,
      processEnv: process.env as Record<string, string>,
    },
  );
  const result = await service.verifyPlan("plan-1", {
    by: "alice",
    nowIso: NOW,
    executionRoot: { root: repo, mode: "worktree" },
  });
  if (!result.ok) throw new Error(`verifyPlan failed (fixture bug): ${JSON.stringify(result.error)}`);
  expect(recorded).toHaveLength(1);
  const attestation = recorded[0]!.attestation;
  if (attestation === undefined) throw new Error("runner recorded no attestation (fixture bug)");
  return attestation;
}

describe("AC-CT-5: the runner reads the stamp before and after the command", () => {
  it("CONTROL: clean tree, nothing moves -> stamped (state_stamp present, no demotion reason)", async () => {
    const { repo, head } = makeRepo();
    const att = await attestRealRun(repo, "true");
    expect(att.state_stamp, "clean control must carry a state_stamp").toEqual({ head_sha: head, worktree_dirty: false });
    expect(att.stamp_unbound_reason).toBeUndefined();
    expect(att.head_sha).toBe(head);
    expect(att.worktree_dirty).toBe(false);
  });

  it("state_moved: a REAL commit made by the AC command lands between the reads -> demoted, post-run HEAD never recorded", async () => {
    const { repo, head } = makeRepo();
    const att = await attestRealRun(repo, COMMIT_CMD);
    const postHead = git(repo, "rev-parse", "HEAD");
    expect(postHead, "fixture: the commit must really have landed").not.toBe(head);
    expect(att.stamp_unbound_reason).toBe("state_moved");
    expect(att.state_stamp, "a moved run must not be stamped").toBeUndefined();
    expect(att.head_sha, "the post-run HEAD must never be recorded as the measured state").not.toBe(postHead);
    expect("head_sha" in att, "no head_sha at all on a moved run").toBe(false);
    expect("worktree_dirty" in att).toBe(false);
  });

  it("dirty_tree (pre read): an uncommitted file present before the command -> demoted", async () => {
    const { repo, head } = makeRepo();
    writeFileSync(join(repo, "pending.txt"), "x\n");
    const att = await attestRealRun(repo, "true");
    expect(att.stamp_unbound_reason).toBe("dirty_tree");
    expect(att.state_stamp).toBeUndefined();
    expect(att.worktree_dirty).toBe(true);
    expect(att.head_sha).toBe(head);
  });

  it("dirty_tree (post read): the AC command itself leaves a REAL uncommitted file -> demoted", async () => {
    const { repo } = makeRepo();
    const att = await attestRealRun(repo, "echo x > left-behind.txt");
    expect(att.stamp_unbound_reason).toBe("dirty_tree");
    expect(att.state_stamp).toBeUndefined();
    expect(att.worktree_dirty).toBe(true);
  });

  it("PRECEDENCE: head moved AND tree dirty -> state_moved", async () => {
    const { repo } = makeRepo();
    writeFileSync(join(repo, "pending.txt"), "x\n");
    const att = await attestRealRun(repo, COMMIT_CMD);
    expect(att.stamp_unbound_reason).toBe("state_moved");
    expect(att.state_stamp).toBeUndefined();
  });

  it("git cannot answer (execution root is not a work tree): nothing measured -> no stamp and NO invented reason", async () => {
    // reason: an empty-PATH variant is unreliable under the bun runtime (attestation-head-sha.test.ts is
    // excluded from vitest for that reason), so "git cannot answer" is produced by a real non-repo directory.
    const notARepo = makeTempDir("lore-ct5-norepo-");
    const att = await attestRealRun(notARepo, "true");
    expect(att.state_stamp).toBeUndefined();
    expect(att.stamp_unbound_reason).toBeUndefined();
    expect("head_sha" in att).toBe(false);
  });
});
