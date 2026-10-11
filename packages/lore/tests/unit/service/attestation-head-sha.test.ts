/**
 * [C5t] RED — runner-issued attestations record `head_sha` and `worktree_dirty`
 * (baseline slice 1 §C5, covers AC-BLS1-4's "unknown when head_sha is absent / dirty").
 *
 * Runner: vitest (no `bun:sqlite` on this path — `InMemoryStore` + injected ports only).
 *
 * SEAM PINNED FOR C5 (the implementer may add to it, never move it):
 *   1. WHERE: `VerifyRunnerService.verifyPlan` stamps the two fields onto the SAME
 *      `attestation` object it already builds for `recordVerifiedEvidence`
 *      (alongside `execution_root` / `execution_mode`). No other write path may.
 *   2. WHAT IS MEASURED: git state of `opts.executionRoot.root` (the resolved
 *      execution root — NOT `config.repoRoot`, which is the corpus root). So a
 *      linked worktree reports its OWN HEAD. Probe = `git rev-parse HEAD` (full
 *      40-hex) + `git status --porcelain` non-empty => `worktree_dirty: true`.
 *   3. DEFAULT PROBE IS REAL GIT: these tests inject nothing new into the
 *      constructor; the 4-arg construction used by every existing test must keep
 *      working. (C5 may ALSO add an optional probe port as a later ctor arg for
 *      its own unit tests, but this file drives the default.)
 *   4. GIT UNAVAILABLE: the probe resolves `git` through `PATH` at call time, so an
 *      empty-PATH run must record an attestation WITHOUT `head_sha` (omitted, never
 *      `null`/`""`), must not throw, and must not fail the verify run.
 *      `worktree_dirty` is likewise omitted then (present-iff-computed).
 *   5. SELF-REPORT: `TaskWorkflowService.addEvidence` REFUSES a caller-supplied
 *      `head_sha` / `worktree_dirty` (top-level or inside `capture_attestation`)
 *      with a VALIDATION_ERROR whose message names the field — the same loud-refusal
 *      shape the sibling guard for `ac_oracle_generation` uses — and writes no row.
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok, NoOpTelemetry } from "@lore/core";
import type { AcceptanceCriterion, CreateDocInput, DocRecord, LoreError, PlanBundle, Result } from "@lore/core";
import { VerifyRunnerService } from "../../../src/service/verify-runner-service.js";
import type { VerifySpawnSpec, VerifyExecutionResult } from "../../../src/service/verify-spawn.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import type { EvidenceInput, VerifiedEvidenceInput } from "../../../src/service/task-workflow-service.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";

// ─── temp git fixtures (mkdtemp only — never the repo's own tree) ───────────

const tempDirs: string[] = [];
const ORIGINAL_PATH = process.env["PATH"];

afterEach(() => {
  if (ORIGINAL_PATH === undefined) delete process.env["PATH"];
  else process.env["PATH"] = ORIGINAL_PATH;
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com",
    },
  }).trim();
}

function commitFile(repo: string, name: string, content: string, message: string): string {
  writeFileSync(join(repo, name), content);
  git(repo, "add", name);
  git(repo, "commit", "-q", "-m", message);
  return git(repo, "rev-parse", "HEAD");
}

function makeRepo(): { repo: string; head: string } {
  const repo = makeTempDir("lore-c5t-repo-");
  git(repo, "init", "-q", "-b", "main");
  const head = commitFile(repo, "a.txt", "one\n", "c1");
  return { repo, head };
}

// ─── runner harness (same doubles as verify-execution-root.test.ts) ─────────

const NOW = "2026-07-21T10:00:00.000Z";
const FRESH_CLAIM_AT = "2026-07-21T09:59:00.000Z";
const PASS_EXECUTION: VerifyExecutionResult = { exitCode: 0, outputTail: "", durationMs: 5, timedOut: false };

function makeDoc(overrides: Partial<DocRecord> & Pick<DocRecord, "id" | "type" | "title">): DocRecord {
  return {
    slug: overrides.id,
    role: "plan",
    status: "approved",
    priority: "medium",
    content: "body",
    parent_id: null,
    created_at: "2026-07-08T00:00:00.000Z",
    updated_at: "2026-07-08T00:00:00.000Z",
    created_by: "alice",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
    ...overrides,
  } as DocRecord;
}

function scriptAc(id: string): AcceptanceCriterion {
  return { id, statement: `${id} statement`, verify: { mode: "script", oracle: "test", command: "run" } };
}

function bundle(): PlanBundle {
  return {
    plan: makeDoc({ id: "plan-1", type: "plan", title: "Plan" }),
    spec: makeDoc({
      id: "spec-1",
      type: "spec",
      title: "Spec",
      extra: { acceptance_criteria: [scriptAc("AC-1")] },
    }),
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

type Attestation = NonNullable<VerifiedEvidenceInput["attestation"]> & {
  head_sha?: unknown;
  worktree_dirty?: unknown;
};

/** Runs one verify at `root` (as the resolved execution root) and returns the recorded attestation. */
async function attestAt(root: string, corpusRoot: string = root): Promise<Attestation> {
  const recorded: VerifiedEvidenceInput[] = [];
  const service = new VerifyRunnerService(
    async (): Promise<Result<PlanBundle, LoreError>> => ok(bundle()),
    async (id, entry): Promise<Result<DocRecord, LoreError>> => {
      recorded.push(entry);
      return ok(makeDoc({ id, type: "task", title: "Task" }));
    },
    async (_spec: VerifySpawnSpec): Promise<Result<VerifyExecutionResult, LoreError>> => ok(PASS_EXECUTION),
    {
      repoRoot: corpusRoot,
      defaultTimeoutMs: 300000,
      claimTtlMinutes: 120,
      requireCommandApproval: false,
      envAllowlist: [],
      envPassthroughAll: true,
      processEnv: {},
    },
  );
  const result = await service.verifyPlan("plan-1", {
    by: "alice",
    nowIso: NOW,
    executionRoot: { root, mode: "worktree" },
  });
  if (!result.ok) throw new Error(`verifyPlan failed (fixture bug): ${JSON.stringify(result.error)}`);
  expect(recorded).toHaveLength(1);
  const attestation = recorded[0]!.attestation as Attestation | undefined;
  if (attestation === undefined) throw new Error("runner recorded no attestation at all (fixture bug)");
  return attestation;
}

// ─── scenarios ───────────────────────────────────────────────────────────────

describe("runner attestation head_sha / worktree_dirty (C5)", () => {
  it("clean repo: head_sha is the full HEAD sha and worktree_dirty is false", async () => {
    const { repo, head } = makeRepo();
    const attestation = await attestAt(repo);
    expect(attestation.head_sha, "attestation.head_sha missing — C5 must stamp git HEAD of the execution root").toBe(head);
    expect(
      attestation.worktree_dirty,
      "attestation.worktree_dirty missing — C5 must record false for a clean tree",
    ).toBe(false);
  });

  it("uncommitted tracked change: worktree_dirty is true (head_sha still HEAD)", async () => {
    const { repo, head } = makeRepo();
    writeFileSync(join(repo, "a.txt"), "changed\n");
    const attestation = await attestAt(repo);
    expect(attestation.worktree_dirty, "attestation.worktree_dirty missing — C5 must record true for a dirty tree").toBe(true);
    expect(attestation.head_sha, "attestation.head_sha missing on a dirty run").toBe(head);
  });

  it("untracked file also counts as dirty", async () => {
    const { repo } = makeRepo();
    writeFileSync(join(repo, "untracked.txt"), "x\n");
    const attestation = await attestAt(repo);
    expect(attestation.worktree_dirty, "attestation.worktree_dirty missing — untracked file must mark dirty").toBe(true);
  });

  it("linked worktree at a different commit: head_sha is the worktree's own HEAD, not the main checkout's", async () => {
    const { repo, head: mainHead } = makeRepo();
    const wtParent = makeTempDir("lore-c5t-wt-");
    const wt = join(wtParent, "linked");
    git(repo, "worktree", "add", "-q", "-b", "feature", wt);
    const wtHead = commitFile(wt, "b.txt", "two\n", "c2-in-worktree");
    expect(wtHead).not.toBe(mainHead);

    // corpus root = main checkout (config.repoRoot); execution root = linked worktree.
    const attestation = await attestAt(wt, repo);
    expect(
      attestation.head_sha,
      "attestation.head_sha missing/wrong — C5 must probe opts.executionRoot.root, not config.repoRoot",
    ).toBe(wtHead);
    expect(attestation.head_sha).not.toBe(mainHead);
    expect(attestation.worktree_dirty, "attestation.worktree_dirty missing for linked worktree").toBe(false);
  });

  it("git unavailable: head_sha (and worktree_dirty) omitted, no throw — with a positive control proving the fields exist when git works", async () => {
    const { repo, head } = makeRepo();

    // Control: same fixture, git reachable -> field present (RED until C5 lands).
    const withGit = await attestAt(repo);
    expect(withGit.head_sha, "control: attestation.head_sha missing even with git available").toBe(head);

    const emptyBin = makeTempDir("lore-c5t-nogit-");
    mkdirSync(join(emptyBin, "bin"));
    process.env["PATH"] = join(emptyBin, "bin");
    const withoutGit = await attestAt(repo); // must resolve, not throw
    expect("head_sha" in withoutGit, "head_sha must be omitted (not null/empty) when git is unavailable").toBe(false);
    expect("worktree_dirty" in withoutGit, "worktree_dirty must be omitted when git is unavailable").toBe(false);
  });
});

describe("self-reported evidence never carries head_sha / worktree_dirty (C5)", () => {
  async function makeTask(): Promise<{ svc: TaskWorkflowService; store: InMemoryStore; taskId: string }> {
    const store = new InMemoryStore();
    const corpus = new CorpusService(store, new RecordLockService(store));
    const svc = new TaskWorkflowService(store, new NoOpTelemetry(), { claimTtlMinutes: 120 });
    const plan = await corpus.create({ type: "plan", title: "P", content: "b" } as CreateDocInput);
    if (!plan.ok) throw new Error(`plan create failed: ${JSON.stringify(plan.error)}`);
    const task = await corpus.create({
      type: "task",
      title: "T",
      parent_id: plan.value.id,
      content: "b",
      extra: { plan_id: plan.value.id },
    } as CreateDocInput);
    if (!task.ok) throw new Error(`task create failed: ${JSON.stringify(task.error)}`);
    return { svc, store, taskId: task.value.id };
  }

  async function rows(store: InMemoryStore, taskId: string): Promise<unknown[]> {
    const found = await store.find(taskId);
    if (!found.ok || found.value === null) throw new Error("task fetch failed");
    const raw = found.value.extra["verification_evidence"];
    return Array.isArray(raw) ? raw : [];
  }

  const FAKE_SHA = "a".repeat(40);
  const base = {
    oracle: "test",
    command: "bunx vitest run x",
    // expected-fail + a failing tail: the shape the self-report path accepts, so the
    // ONLY thing that can refuse these rows is the head_sha / worktree_dirty guard.
    result: "expected-fail",
    recorded_by: "agent:c5t",
    capture_source: "self-report",
    output_tail: "1 failed",
  };

  it.each([
    ["top-level head_sha", { head_sha: FAKE_SHA }, "head_sha"],
    ["top-level worktree_dirty", { worktree_dirty: false }, "worktree_dirty"],
    [
      "head_sha smuggled via capture_attestation",
      { capture_attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1, timed_out: false, head_sha: FAKE_SHA } },
      "head_sha",
    ],
  ])("refuses %s naming the field and writes no row", async (_label, extra, field) => {
    const { svc, store, taskId } = await makeTask();
    const smuggled = { ...base, ...extra } as unknown as EvidenceInput;
    const result = await svc.addEvidence(taskId, smuggled);
    expect(result.ok, `addEvidence must refuse a caller-supplied ${field}`).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(result.error), `refusal must name ${field}`).toContain(field);
    expect(await rows(store, taskId)).toHaveLength(0);
  });
});
