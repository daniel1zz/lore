// @spawns-external git builds a throwaway repository with a linked worktree
// @spawns-external bun runs a copy of the oracle-lock writer inside the throwaway repository
// @spawns scripts/oracle-lock.ts
// @reads packages/lore/src/adapters/oracle-occupancy.ts
/**
 * BR-1512 (spec-the-state-binding-check-skips-only-when-the-oracle-lock-is) — the state stamp is withheld for oracle-lock
 * occupancy only when the holder runs in the SAME worktree as the run, and a review names why a criterion is unbound.
 *
 * AC-OL-1 (describe "per worktree"): throwaway repo with two REAL linked worktrees A and B; the lock is taken by the real
 * writer (`scripts/oracle-lock.ts`) for A; the real reader (`probeOccupancyForCheckout`) and the real executor run the verify
 * service. A run in B is stamped with B's head and writes no audit row; a run in A is skipped exactly as AC-CT-8 states; an
 * old-format lock (pid only) skips both; the writer records the holder's worktree and the reader returns it.
 * AC-OL-2 (describe "review names why"): the cause the real verify run reports travels through the real rerunner and the real
 * head-criteria runner into `measureCriteriaAtHead`, whose not-measured reason must name it.
 *
 * Never touches this repository's `.git` or `.lore/`: every lock lives in a `mkdtemp` repository's own `.git`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ok } from "@lore/core";
import type { AcceptanceCriterion, AuditEntry, DocRecord, LoreError, PlanBundle, Result } from "@lore/core";
import { VerifyRunnerService } from "../../../src/service/verify-runner-service.js";
import type { StateBindingOccupancyPort, VerifyPlanResult } from "../../../src/service/verify-runner-service.js";
import type { VerifySpawnSpec, VerifyExecutionResult } from "../../../src/service/verify-spawn.js";
import { executeVerifySpawnSpec } from "../../../src/service/verify-executor.js";
import type { VerifiedEvidenceInput } from "../../../src/service/task-workflow-service.js";
import { ORACLE_LOCK_FILE_NAME, probeOccupancy, probeOccupancyForCheckout } from "../../../src/adapters/oracle-occupancy.js";
import { STATE_BINDING_SKIP_AUDIT_ACTION } from "../../../src/service/state-binding-skip.js";
import { measureCriteriaAtHead } from "../../../src/service/milestone-attestation-facts.js";
import type { AttestationRow, CriterionScope } from "../../../src/service/milestone-attestation-facts.js";
import { createAppCriterionRerunner } from "../../../src/adapters/cli/assess-stale-refresh.js";
import { createGitHeadCriteriaRunner } from "../../../src/adapters/cli/assess-landing-attester.js";
import { main as acquireOracleLock, releaseLock } from "../../../../../scripts/oracle-lock.js";

const REPO_ROOT_OF_SOURCES = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const tempDirs: string[] = [];
const heldLocks: string[] = [];

afterEach(() => {
  while (heldLocks.length > 0) releaseLock(heldLocks.pop()!);
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

interface TwoWorktrees {
  readonly a: string;
  readonly b: string;
  readonly headA: string;
  readonly headB: string;
  /** The shared git directory: where every worktree's oracle lock lives. */
  readonly lockDir: string;
}

/** A repository (worktree A, branch main) with a real linked worktree B on its own commit. */
function makeTwoWorktrees(): TwoWorktrees {
  const a = makeTempDir("lore-ol-a-");
  git(a, "init", "-q", "-b", "main");
  writeFileSync(join(a, "a.txt"), "one\n");
  git(a, "add", "a.txt");
  git(a, "commit", "-q", "-m", "c1");
  const b = join(makeTempDir("lore-ol-b-parent-"), "b");
  git(a, "worktree", "add", "-q", "-b", "other", b);
  writeFileSync(join(b, "b.txt"), "two\n");
  git(b, "add", "b.txt");
  git(b, "commit", "-q", "-m", "c2 in B");
  const realB = realpathSync(b);
  return { a, b: realB, headA: git(a, "rev-parse", "HEAD"), headB: git(realB, "rev-parse", "HEAD"), lockDir: join(a, ".git") };
}

/** Takes the lock with the real writer for a holder running in `holderWorktree` (omitted = the old, pid-only format). */
function holdLock(lockDir: string, holderWorktree?: string): void {
  const prev = console.log;
  console.log = () => undefined;
  try {
    expect(acquireOracleLock(lockDir, holderWorktree), "fixture: the writer must acquire the free lock").toBe(0);
  } finally {
    console.log = prev;
  }
  heldLocks.push(lockDir);
}

// ─── service-level fixture (the real verify runner and executor) ──────────────

const NOW = "2026-10-31T10:00:00.000Z";

function makeDoc(overrides: Partial<DocRecord> & Pick<DocRecord, "id" | "type" | "title">): DocRecord {
  return {
    slug: overrides.id,
    role: "plan",
    status: "approved",
    priority: "medium",
    content: "body",
    parent_id: null,
    created_at: "2026-10-31T00:00:00.000Z",
    updated_at: "2026-10-31T00:00:00.000Z",
    created_by: "alice",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
    ...overrides,
  } as DocRecord;
}

function bundle(command: string): PlanBundle {
  const ac: AcceptanceCriterion = { id: "AC-1", statement: "AC-1 statement", verify: { mode: "script", oracle: "other", command } };
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
        extra: { ac_scope: ["AC-1"], claim: { by: "alice", at: "2026-10-31T09:59:00.000Z" } },
      }),
    ],
  };
}

interface ServiceRun {
  readonly result: VerifyPlanResult;
  readonly evidence: VerifiedEvidenceInput[];
  readonly audit: AuditEntry[];
}

/** Runs the real executor over `command` in `executionRoot`; `armed=false` omits the occupancy port (check ABSENT). */
async function runService(corpusRoot: string, executionRoot: string, command: string, armed: boolean): Promise<ServiceRun> {
  const evidence: VerifiedEvidenceInput[] = [];
  const audit: AuditEntry[] = [];
  const port: StateBindingOccupancyPort = {
    probe: probeOccupancyForCheckout,
    recordSkip: async (entry) => {
      audit.push(entry);
      return ok(undefined);
    },
  };
  const service = new VerifyRunnerService(
    async (): Promise<Result<PlanBundle, LoreError>> => ok(bundle(command)),
    async (id, entry): Promise<Result<DocRecord, LoreError>> => {
      evidence.push(entry);
      return ok(makeDoc({ id, type: "task", title: "Task" }));
    },
    async (spec: VerifySpawnSpec): Promise<Result<VerifyExecutionResult, LoreError>> => executeVerifySpawnSpec(spec),
    {
      tmpDir: tmpdir(),
      repoRoot: corpusRoot,
      defaultTimeoutMs: 60_000,
      claimTtlMinutes: 120,
      requireCommandApproval: false,
      envAllowlist: [],
      envPassthroughAll: true,
      processEnv: process.env as Record<string, string>,
    },
    undefined,
    undefined,
    armed ? port : undefined,
  );
  const verified = await service.verifyPlan("plan-1", { by: "alice", nowIso: NOW, executionRoot: { root: executionRoot, mode: "worktree" } });
  if (!verified.ok) throw new Error(`verifyPlan failed (fixture bug): ${JSON.stringify(verified.error)}`);
  return { result: verified.value, evidence, audit };
}

const exitCodeOf = (run: ServiceRun): number => {
  const r = run.result.results;
  if (r.some((x) => x.result === "inconclusive")) return 3;
  return r.some((x) => x.result === "fail") ? 1 : 0;
};
const withoutDuration = (run: ServiceRun) => run.result.results.map(({ duration_ms: _d, unbound_cause: _u, ...rest }) => rest);

describe("AC-OL-1: occupancy is per worktree", () => {
  it("per worktree: a lock held from A leaves a run in B STAMPED with B's head and writes no skip row", async () => {
    const { a, b, headA, headB, lockDir } = makeTwoWorktrees();
    expect(headB, "fixture: the two worktrees are at different commits").not.toBe(headA);
    holdLock(lockDir, a);

    const inB = await runService(a, b, "true", true);

    expect(inB.audit, "a holder elsewhere writes no state_binding_skipped row").toHaveLength(0);
    const att = inB.evidence[0]!.attestation!;
    expect(att.state_stamp, "stamped from B's own pre/post git state").toEqual({ head_sha: headB, worktree_dirty: false });
    expect(inB.result.warnings.filter((w) => w.includes("SKIPPED"))).toHaveLength(0);
    expect(inB.result.results[0]!.unbound_cause, "a stamped run has no unbound cause").toBeUndefined();
  });

  for (const [label, command, expectedExit] of [
    ["passing oracle", "true", 0],
    ["failing oracle", "false", 1],
  ] as const) {
    it(`per worktree: the SAME lock skips a run in A exactly as AC-CT-8 states (${label})`, async () => {
      const { a, lockDir } = makeTwoWorktrees();
      const absent = await runService(a, a, command, false);
      expect(exitCodeOf(absent), "fixture: the check-absent control").toBe(expectedExit);

      holdLock(lockDir, a);
      const inA = await runService(a, a, command, true);

      expect(inA.audit, "exactly one audit row").toHaveLength(1);
      const row = inA.audit[0]!;
      expect(row.action).toBe(STATE_BINDING_SKIP_AUDIT_ACTION);
      expect(row.details).toMatchObject({ ac_id: "AC-1", reason: "oracle_lock_held", holder_pid: process.pid, holder_worktree: a });
      expect(inA.evidence[0]!.attestation!.state_stamp, "no stamp").toBeUndefined();
      expect("head_sha" in inA.evidence[0]!.attestation!, "no head_sha").toBe(false);
      expect(withoutDuration(inA), "a skip changes no result").toEqual(withoutDuration(absent));
      expect(exitCodeOf(inA), "exit code equals the check-absent control").toBe(exitCodeOf(absent));
      const warning = inA.result.warnings.find((w) => w.includes("SKIPPED"));
      expect(warning, "the SKIPPED warning names the holder").toContain(`pid ${process.pid}`);
      expect(warning).toContain(a);
    });
  }

  it("per worktree: a lock holding only a live pid (old format) skips runs in BOTH A and B", async () => {
    const { a, b, lockDir } = makeTwoWorktrees();
    holdLock(lockDir); // pid only: the holder's location is unknown
    expect(readFileSync(join(lockDir, ORACLE_LOCK_FILE_NAME), "utf8")).toBe(String(process.pid));

    for (const root of [a, b]) {
      const run = await runService(a, root, "true", true);
      expect(run.audit, `old-format lock skips the run in ${root}`).toHaveLength(1);
      expect(run.evidence[0]!.attestation!.state_stamp).toBeUndefined();
      expect(run.audit[0]!.details?.["holder_worktree"], "no worktree is invented").toBeUndefined();
    }
  });

  it("per worktree: a holder worktree that is only a PREFIX of the run's root is a different worktree (no string-prefix match)", async () => {
    const { a, b, lockDir } = makeTwoWorktrees();
    holdLock(lockDir, `${b}-sibling`);
    const inB = await runService(a, b, "true", true);
    expect(inB.audit).toHaveLength(0);
    expect(inB.evidence[0]!.attestation!.state_stamp).toBeDefined();
  });

  it("per worktree: a dead holder is free in every worktree", async () => {
    const { a, b, lockDir } = makeTwoWorktrees();
    writeFileSync(join(lockDir, ORACLE_LOCK_FILE_NAME), `2147483646\n${a}`);
    const inA = await runService(a, a, "true", true);
    const inB = await runService(a, b, "true", true);
    expect(inA.audit).toHaveLength(0);
    expect(inB.audit).toHaveLength(0);
  });

  it("per worktree: the writer records the holder's worktree root and the reader returns it as holder_worktree", () => {
    const { a, lockDir } = makeTwoWorktrees();
    holdLock(lockDir, a);
    expect(readFileSync(join(lockDir, ORACLE_LOCK_FILE_NAME), "utf8")).toBe(`${process.pid}\n${a}`);
    expect(probeOccupancy(lockDir)).toEqual({
      kind: "held",
      holder_pid: process.pid,
      lock_path: join(lockDir, ORACLE_LOCK_FILE_NAME),
      holder_worktree: a,
    });
    expect(probeOccupancyForCheckout(a), "the checkout-level path finds it from A").toMatchObject({ kind: "held", holder_worktree: a });
  });

  it("per worktree: the real writer CLI run from a linked worktree records THAT worktree (realpath), sharing one lock file", () => {
    const repo = makeTempDir("lore-ol-cli-");
    git(repo, "init", "-q", "-b", "main");
    for (const rel of ["scripts/oracle-lock.ts", "packages/lore/src/adapters/oracle-occupancy.ts"]) {
      mkdirSync(join(repo, dirname(rel)), { recursive: true });
      cpSync(join(REPO_ROOT_OF_SOURCES, rel), join(repo, rel));
    }
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "writer copy");
    const linkedParent = makeTempDir("lore-ol-cli-b-");
    const linked = join(linkedParent, "b");
    git(repo, "worktree", "add", "-q", "-b", "other", linked);
    const realLinked = realpathSync(linked);

    for (const root of [repo, realLinked]) {
      const ran = spawnSync("bun", ["scripts/oracle-lock.ts", "cat", join(repo, ".git", ORACLE_LOCK_FILE_NAME)], { cwd: root, encoding: "utf8" });
      expect(ran.status, ran.stdout + ran.stderr).toBe(0);
      expect(ran.stdout, `the lock names the worktree the writer ran in (${root})`).toMatch(new RegExp(`^\\d+\\n${root.replace(/[.*+?^${}()|[\]\\]/g, "\\\\$&")}$`, "m"));
    }
  });
});

// ─── AC-OL-2 ──────────────────────────────────────────────────────────────────

const SCOPE: CriterionScope = { doc_slug: "spec-1", ac_id: "AC-1", mode: "script", holders: [{ task_slug: "task-1" }], command: "true" };

/** The review's chain over a REAL verify run: rerunner -> head-criteria runner (in the existing worktree) -> measureCriteriaAtHead. */
async function reviewOf(run: ServiceRun, headCommit: string, worktreeRoot: string): Promise<{ verdict: string; detail: string }> {
  const specDoc = makeDoc({ id: "spec-1", type: "spec", title: "Spec" });
  const adhoc = makeDoc({
    id: "task-adhoc",
    type: "task",
    title: "adhoc",
    slug: "task-adhoc",
    extra: { adhoc: true, ac_scope: ["AC-1"], governing_spec: "spec-1" },
  });
  const app = {
    corpusService: {
      listFull: async ({ type }: { type: string }) => ok({ docs: type === "spec" ? [specDoc] : [adhoc] }),
    },
  } as unknown as Parameters<typeof createAppCriterionRerunner>[0];
  const verify = { verifyAdhocTask: async () => ok(run.result) } as unknown as Parameters<typeof createAppCriterionRerunner>[1];
  const runner = createGitHeadCriteriaRunner(worktreeRoot, process.env, (root) =>
    createAppCriterionRerunner(app, verify, { executionRoot: root, by: "alice", nowIso: () => NOW }),
  );
  const rows: AttestationRow[] = run.evidence.flatMap((e) =>
    e.attestation?.state_stamp !== undefined && (e.result === "pass" || e.result === "fail")
      ? [{ id: "task-adhoc@t", doc_slug: "spec-1", ac_id: "AC-1", result: e.result, head_sha: e.attestation.state_stamp.head_sha, recorded_at: NOW }]
      : [],
  );
  const facts = await measureCriteriaAtHead({ scopes: [SCOPE], headCommit, runner, worktreeRoot, readRows: async () => ok(rows) });
  const row = facts.rows[0]!;
  return { verdict: row.verdict, detail: row.detail };
}

describe("AC-OL-2: review names why a criterion is unbound", () => {
  it("review names why: a run skipped for occupancy is not-measured naming state_binding_skipped, the holder pid and worktree", async () => {
    const { a, headA, lockDir } = makeTwoWorktrees();
    holdLock(lockDir, a);
    const run = await runService(a, a, "true", true);

    const review = await reviewOf(run, headA, a);

    expect(review.verdict).toBe("not-measured");
    expect(review.detail).toContain("state_binding_skipped");
    expect(review.detail).toContain(`pid ${process.pid}`);
    expect(review.detail).toContain(a);
    expect(review.detail, "the generic sentence stays").toContain("left no attestation stamped at that commit");
  });

  it("review names why: an old-format lock is named as an unknown worktree, never a guessed one", async () => {
    const { a, headA, lockDir } = makeTwoWorktrees();
    holdLock(lockDir);
    const review = await reviewOf(await runService(a, a, "true", true), headA, a);
    expect(review.detail).toContain("state_binding_skipped");
    expect(review.detail).toContain("worktree unknown");
  });

  it("review names why: HEAD moved during the run names state_moved", async () => {
    const { a, headA } = makeTwoWorktrees();
    const run = await runService(a, a, "git -c user.name=t -c user.email=t@example.com commit -q --allow-empty -m moved", true);
    const review = await reviewOf(run, headA, a);
    expect(review.verdict).toBe("not-measured");
    expect(review.detail).toContain("state_moved");
    expect(review.detail).not.toContain("state_binding_skipped");
  });

  it("review names why: a dirty tree names dirty_tree", async () => {
    const { a, headA } = makeTwoWorktrees();
    const run = await runService(a, a, "echo x > dirty.txt", true);
    const review = await reviewOf(run, headA, a);
    expect(review.verdict).toBe("not-measured");
    expect(review.detail).toContain("dirty_tree");
  });

  it("review names why: a stamped passing run (holder in another worktree) is measured pass as today", async () => {
    const { a, b, headB, lockDir } = makeTwoWorktrees();
    holdLock(lockDir, a);
    const run = await runService(a, b, "true", true);
    const review = await reviewOf(run, headB, b);
    expect(review.verdict).toBe("pass");
    expect(review.detail).not.toContain("not-measured");
    expect(review.detail).not.toContain("state_binding_skipped");
  });
});
