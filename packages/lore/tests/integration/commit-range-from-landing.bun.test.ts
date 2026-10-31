// @reads assets/project/reference-transaction
/**
 * A task's commit range is a fact of its LANDING (`lore integrate`), not of its last claim.
 * Throwaway git repos + InMemoryStore only (never the repo's `.lore/`).
 *
 *   AC-LAND-1 (a): claim on branch B, B landed through the real IntegrateService, the task re-claimed from a detached
 *     worktree of main to add evidence, then done -> commit_range names B's head and the landing commit, and
 *     assess's derived diff contains B's own file.
 *   AC-LAND-1 (b): nothing reconstructs a landing from main's history (BR-1291) — B landed with no recorder, or merged by
 *     hand, has no landing: done refuses `not-landed`; integrating the already-integrated branch records it (BR-1336).
 *   NEGATIVE: a branch with no landing record is not invented one, and assess never backfills from `merge(<branch>)`.
 *   REGRESSION: integrate with no matching task records nothing and still lands.
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { ok } from "@lore/core";
import type { CreateDocInput } from "@lore/core";
import { RecordLockService } from "../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../src/service/gate-enforcer.js";
import { InMemoryStore } from "../../src/store/in-memory-store.js";
import { CorpusService } from "../../src/service/corpus-service.js";
import { TaskWorkflowService } from "../../src/service/task-workflow-service.js";
import { createRealWorktreeProbe } from "../../src/service/worktree-cleanup.js";
import { readTaskLanding } from "../../src/service/task-commit-range.js";
import { IntegrateService, type IntegrateGit } from "../../src/service/integrate-service.js";
import { IntegrateLossLedger } from "../../src/service/integrate-loss-ledger.js";
import { immediateIntegrateQueue } from "../helpers/immediate-integrate-queue";
import { IntegrateAttemptLedger } from "../../src/service/integrate-attempt-ledger.js";
import { deriveLandingDiffForPlan } from "../../src/adapters/cli/assess-commit-derivation.js";
import { actedStore } from "../live-invocation.js";
import { installShippedGuard } from "./support/main-guard-repo.js";
import { runOfName } from "../helpers/test-run-identity.js";

import { ensureRequirementsDocId } from "../helpers/parented-create.js";
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

/** git with the integrate marker: what a deliberate human bypass of the main-ref guard looks like. */
function runMarked(dir: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd: dir, env: { ...GIT_ENV, LORE_INTEGRATE: "1" }, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function commit(dir: string, file: string, message: string): string {
  writeFileSync(join(dir, file), `${message}\n`);
  run(dir, "add", file);
  run(dir, "commit", "-q", "-m", message);
  return run(dir, "rev-parse", "HEAD");
}

const gitRunner: IntegrateGit = (cwd, args, env) => {
  const r = spawnSync("git", [...args], { cwd, encoding: "utf8", env: { ...GIT_ENV, ...env } });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};

interface Fixture {
  readonly repo: string;
  readonly svc: TaskWorkflowService;
  readonly store: ReturnType<typeof actedStore>;
  readonly taskId: string;
  readonly slug: string;
  readonly ownCommit: string;
  readonly branchHead: string;
}

/**
 * A runner-attested pass the landing predicate counts: recorded AFTER the latest claim and bound to a clean commit on main
 * (`head_sha`). Evidence from before a re-claim, or bound to nothing, does not count.
 */
async function recordCountingPass(svc: TaskWorkflowService, taskId: string, headSha: string): Promise<void> {
  const ev = await svc.recordVerifiedEvidence(
    taskId,
    {
      oracle: "tsc", command: "bun run typecheck", result: "pass", recorded_by: "runner", capture_source: "runner",
      attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1, timed_out: false, head_sha: headSha, worktree_dirty: false },
    },
    new Date(Date.now() + 1000).toISOString(),
  );
  if (!ev.ok) throw new Error(`evidence ${JSON.stringify(ev.error)}`);
}

/** A repo on main with branch `feat-landing` carrying one own commit, and a task claimed on that branch name. */
async function fixture(probeOverride?: Partial<ReturnType<typeof createRealWorktreeProbe>>): Promise<Fixture> {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "lore-landing-")));
  dirs.push(repo);
  run(repo, "init", "-q", "-b", "main");
  commit(repo, "seed.txt", "seed");
  run(repo, "branch", "feat-landing");
  commit(repo, "main-moved.txt", "chore: main moved on");
  // the shared checkout is a detached view of main and the shipped guard is installed: integrate refuses to run without it
  run(repo, "checkout", "-q", "--detach", "main");
  installShippedGuard(repo, join(repo, ".git", "guard-hooks"));

  const store = actedStore(new InMemoryStore());
  const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const svc = new TaskWorkflowService(
    store, undefined, { claimTtlMinutes: 120 },
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    {
      ...createRealWorktreeProbe(repo),
      // reason: the orchestrator's evidence repair re-claims from a detached worktree, which today's claim refuses (BR-1468); the fixture hides
      // the path from the existence probe while the re-claim runs so the legacy re-claim shape stays covered.
      pathExists: (path: string) => {
        if (hideNextPathProbe) return false;
        return createRealWorktreeProbe(repo).pathExists(path);
      },
      ...probeOverride,
    },
  );
  const plan = await cs.create({ parent_id: await ensureRequirementsDocId(cs), type: "plan", title: "Landing plan", content: "body" } as CreateDocInput);
  if (!plan.ok) throw new Error("plan");
  const task = await cs.create({
    type: "task", title: "Landing task", parent_id: plan.value.id, content: "body", extra: { kind: "code", plan_id: plan.value.id },
  } as CreateDocInput);
  if (!task.ok) throw new Error("task");
  const claim = await svc.claim(task.value.id, { by: "alice", harnessRun: runOfName("alice"), worktree: "feat-landing" });
  if (!claim.ok) throw new Error(`claim ${JSON.stringify(claim.error)}`);
  await recordCountingPass(svc, task.value.id, run(repo, "rev-parse", "main"));
  // the branch's own work comes AFTER the claim, so the claim's recorded base_sha (the branch tip at claim time) precedes it
  run(repo, "checkout", "-q", "feat-landing");
  const ownCommit = commit(repo, "own-landing-file.txt", "feat: the branch's own work");
  run(repo, "checkout", "-q", "--detach", "main");
  return { repo, svc, store, taskId: task.value.id, slug: task.value.slug, ownCommit, branchHead: ownCommit };
}

function integrateService(f: Fixture, withRecorder: boolean): IntegrateService {
  const ledgerDir = mkdtempSync(join(tmpdir(), "lore-landing-ledger-"));
  dirs.push(ledgerDir);
  return new IntegrateService({
    git: gitRunner,
    lease: { acquire: () => ok({ kind: "held", release: () => {} }) },
    runFloor: () => ({ status: 0, output: "" }),
    corpus: { take: () => ok({ takenAt: "t" }), remove: () => ok(undefined) },
    ledger: new IntegrateLossLedger(ledgerDir),
    queue: immediateIntegrateQueue(),
    attempts: new IntegrateAttemptLedger(ledgerDir),
    projectRoot: f.repo,
    worktreesRoot: join(f.repo, ".claude", "worktrees"),
    log: () => undefined,
    ...(withRecorder ? { landings: { record: (landing) => f.svc.recordLanding(landing) } } : {}),
  });
}

/** The orchestrator's evidence repair: release, then re-claim from a fresh DETACHED worktree of main. */
let hideNextPathProbe = false;

async function reclaimFromDetachedMain(f: Fixture): Promise<void> {
  const holder = mkdtempSync(join(tmpdir(), "lore-landing-evid-"));
  dirs.push(holder);
  const detached = join(holder, "evid");
  run(f.repo, "worktree", "add", "-q", "--detach", detached, "main");
  const released = await f.svc.release(f.taskId, { by: "alice", harnessRun: runOfName("alice") });
  if (!released.ok) throw new Error(`release ${JSON.stringify(released.error)}`);
  hideNextPathProbe = true;
  const reclaimed = await f.svc.claim(f.taskId, { by: "alice", harnessRun: runOfName("alice"), worktree: realpathSync(detached) });
  hideNextPathProbe = false;
  if (!reclaimed.ok) throw new Error(`reclaim ${JSON.stringify(reclaimed.error)}`);
  // reason: only a pass recorded after the LATEST claim counts, so the evidence repair re-attests on the re-claim.
  await recordCountingPass(f.svc, f.taskId, run(f.repo, "rev-parse", "main"));
}

describe("AC-LAND-1: a task's commit range is recorded at landing, so a later re-claim cannot replace it", () => {
  it("AC-LAND-1 (a): landed through lore integrate, re-claimed from a detached main worktree, then done -> range names the branch head and the landing commit; assess diff holds the branch's own file", async () => {
    const f = await fixture();
    const landed = await integrateService(f, true).integrate({ branch: "feat-landing", sessionId: "s1", floorCommand: "true" });
    expect(landed.ok && landed.value.kind).toBe("landed");
    const mergeSha = landed.ok && landed.value.kind === "landed" ? landed.value.sha : "";
    await reclaimFromDetachedMain(f);

    const done = await f.svc.done(f.taskId, { by: "alice", harnessRun: runOfName("alice") });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    const range = done.value.task.extra["commit_range"] as Record<string, unknown>;
    expect(range).toMatchObject({ state: "recorded", head: f.branchHead, landing_commit: mergeSha });
    expect(done.value.task.extra["landing"]).toMatchObject({ branch: "feat-landing", branch_head: f.branchHead, landing_commit: mergeSha });

    const derived = deriveLandingDiffForPlan(f.repo, [{ slug: f.slug, landing: readTaskLanding(done.value.task.extra) }], true);
    expect(derived.status).toBe("derived");
    expect(derived.commits.map((c) => c.sha)).toEqual([f.ownCommit]);
    expect(derived.diff_text).toContain("own-landing-file.txt");
    expect(derived.diff_text).not.toContain("main-moved.txt");
  }, 60_000);

  it("AC-LAND-1 (b): landed WITHOUT a recorder there is no recorded landing; integrating the already-integrated branch records it and done then archives with the same range", async () => {
    const f = await fixture();
    // landed WITHOUT a landing recorder: only the `merge(feat-landing)` commit on main remains; the range is never backfilled from it
    await integrateService(f, false).integrate({ branch: "feat-landing", sessionId: "s2", floorCommand: "true" });
    await reclaimFromDetachedMain(f);

    const again = await integrateService(f, true).integrate({ branch: "feat-landing", sessionId: "s2b", floorCommand: "true" });
    expect(again.ok && again.value.kind).toBe("already_integrated");
    const done = await f.svc.done(f.taskId, { by: "alice", harnessRun: runOfName("alice") });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.value.task.extra["landing"]).toMatchObject({ branch: "feat-landing", branch_head: f.branchHead });
    expect(done.value.task.extra["commit_range"]).toMatchObject({ state: "recorded", head: f.branchHead, head_source: "landing" });
    const derived = deriveLandingDiffForPlan(f.repo, [{ slug: f.slug, landing: readTaskLanding(done.value.task.extra) }], true);
    expect(derived.commits.map((c) => c.sha)).toEqual([f.ownCommit]);
    expect(derived.diff_text).toContain("own-landing-file.txt");
  }, 60_000);

  it("AC-LAND-1 (b) assess: a range that recorded main itself (no landing) is never backfilled from a merge(<branch>) commit", async () => {
    const f = await fixture();
    await integrateService(f, false).integrate({ branch: "feat-landing", sessionId: "s5", floorCommand: "true" });
    const main = run(f.repo, "rev-parse", "main");
    // the measured defect: the evidence re-claim recorded main itself as the range (base == head)
    const stale = { state: "recorded", head: main, base: main, head_source: "worktree", worktree: "feat-landing", recorded_at: "t" };
    // a task that only carries a stale `commit_range` has no landing record: the review names it unlanded and measures no diff for it
    const derived = deriveLandingDiffForPlan(f.repo, [{ slug: f.slug, landing: readTaskLanding({ commit_range: stale }) }], true);
    expect(derived.unlanded_tasks).toEqual([f.slug]);
    expect(derived.commits.map((c) => c.sha)).not.toContain(f.ownCommit);
    expect(derived.diff_text).not.toContain("own-landing-file.txt");
  }, 60_000);

  it("NEGATIVE: work committed on the branch after the claim that is not on main is refused [floor: not-landed]", async () => {
    const f = await fixture();
    // work done AFTER the claim and never merged
    run(f.repo, "checkout", "-q", "feat-landing");
    commit(f.repo, "after-claim.txt", "feat: work after the claim");
    run(f.repo, "checkout", "-q", "--detach", "main");
    const done = await f.svc.done(f.taskId, { by: "alice", harnessRun: runOfName("alice") });
    expect(done.ok).toBe(false);
    expect(!done.ok && "message" in done.error ? done.error.message : "").toContain("[floor: not-landed]");
    const task = await f.store.find(f.taskId);
    expect(task.ok && task.value !== null ? task.value.status : "unreadable").not.toBe("archived");
  }, 60_000);

  it("HISTORY: a re-landing replaces extra.landing and appends the replaced one to extra.landing_history", async () => {
    const f = await fixture();
    // reason: the landing's kind is measured by the one predicate (landingOf) from real facts, so each landing names a
    // branch head that really reached main by merge commit (the BR-1245 premise of the predicate).
    const mergeOntoMain = (): string => {
      // reason: the shipped guard refuses any working copy on `main`, so the merge commit is built with plumbing.
      const tree = run(f.repo, "merge-tree", "--write-tree", "main", "feat-landing");
      const merged = run(f.repo, "commit-tree", tree, "-p", "main", "-p", "feat-landing", "-m", "merge feat-landing");
      run(f.repo, "update-ref", "refs/heads/main", merged);
      return merged;
    };
    const m0 = run(f.repo, "rev-parse", "main");
    const m1 = mergeOntoMain();
    const first = { branch: "feat-landing", branch_head: f.branchHead, main_before: m0, main_after: m1, landing_commit: m1 };
    expect((await f.svc.recordLanding(first)).ok).toBe(true);
    run(f.repo, "checkout", "-q", "feat-landing");
    const h2 = commit(f.repo, "second-landing-file.txt", "feat: second round");
    run(f.repo, "checkout", "-q", "--detach", "main");
    const m2 = mergeOntoMain();
    const second = { branch: "feat-landing", branch_head: h2, main_before: m1, main_after: m2, landing_commit: m2 };
    expect((await f.svc.recordLanding(second)).ok).toBe(true);
    expect((await f.svc.recordLanding(second)).ok).toBe(true); // idempotent: no duplicate history entry
    const task = await f.store.find(f.taskId);
    const extra = task.ok && task.value !== null ? task.value.extra : {};
    expect(extra["landing"]).toMatchObject(second);
    expect((extra["landing_history"] as unknown[]).map((l) => (l as { branch_head: string }).branch_head)).toEqual([f.branchHead]);
  }, 60_000);

  it("NEGATIVE: landing a different branch records nothing on a task claimed elsewhere", async () => {
    const f = await fixture();
    run(f.repo, "checkout", "-q", "-b", "other-branch", "main");
    commit(f.repo, "other.txt", "feat: other");
    run(f.repo, "checkout", "-q", "--detach", "main");
    const landed = await integrateService(f, true).integrate({ branch: "other-branch", sessionId: "s4", floorCommand: "true" });
    expect(landed.ok && landed.value.kind).toBe("landed");
    const task = await f.store.find(f.taskId);
    expect(task.ok && task.value !== null ? task.value.extra["landing"] : "unreadable").toBeUndefined();
  }, 60_000);

  it("REGRESSION: integrate with no task claimed on the branch records nothing and still lands", async () => {
    const f = await fixture();
    run(f.repo, "checkout", "-q", "-b", "unclaimed-branch", "main");
    commit(f.repo, "unclaimed.txt", "feat: unclaimed");
    run(f.repo, "checkout", "-q", "--detach", "main");
    mkdirSync(join(f.repo, ".claude", "worktrees"), { recursive: true });
    const landed = await integrateService(f, true).integrate({ branch: "unclaimed-branch", sessionId: "s3", floorCommand: "true" });
    expect(landed.ok && landed.value.kind).toBe("landed");
  }, 60_000);
});
