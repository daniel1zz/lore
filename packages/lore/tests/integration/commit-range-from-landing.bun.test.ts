/**
 * A task's commit range is a fact of its LANDING (`lore integrate`), not of its last claim.
 * Throwaway git repos + InMemoryStore only (never the repo's `.lore/`).
 *
 *   AC-LAND-1 (a): claim on branch B, B landed through the real IntegrateService, the task re-claimed from a detached
 *     worktree of main to add evidence, then done -> commit_range names B's head and the landing commit, and
 *     assess's derived diff contains B's own file.
 *   AC-LAND-1 (b): backfill — B merged by a plain `merge(<branch>)` commit with no landing record -> the same range.
 *   NEGATIVE: a branch with no `merge(<branch>)` commit and no landing record is not invented a landing; the claim's
 *     own range is kept.
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
import { collectRecordedRanges } from "../../src/service/task-commit-range.js";
import { IntegrateService, type IntegrateGit } from "../../src/service/integrate-service.js";
import { IntegrateLossLedger } from "../../src/service/integrate-loss-ledger.js";
import { IntegrateAttemptLedger } from "../../src/service/integrate-attempt-ledger.js";
import { deriveCommitSetForPlan } from "../../src/adapters/cli/assess-commit-derivation.js";
import { actedStore } from "../live-invocation.js";

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

/** A repo on main with branch `feat-landing` carrying one own commit, and a task claimed on that branch name. */
async function fixture(): Promise<Fixture> {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "lore-landing-")));
  dirs.push(repo);
  run(repo, "init", "-q", "-b", "main");
  commit(repo, "seed.txt", "seed");
  run(repo, "checkout", "-q", "-b", "feat-landing");
  const ownCommit = commit(repo, "own-landing-file.txt", "feat: the branch's own work");
  run(repo, "checkout", "-q", "main");
  commit(repo, "main-moved.txt", "chore: main moved on");

  const store = actedStore(new InMemoryStore());
  const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const svc = new TaskWorkflowService(
    store, undefined, { claimTtlMinutes: 120 },
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    createRealWorktreeProbe(repo),
  );
  const plan = await cs.create({ type: "plan", title: "Landing plan", content: "body" } as CreateDocInput);
  if (!plan.ok) throw new Error("plan");
  const task = await cs.create({
    type: "task", title: "Landing task", parent_id: plan.value.id, content: "body", extra: { plan_id: plan.value.id },
  } as CreateDocInput);
  if (!task.ok) throw new Error("task");
  const ev = await svc.recordVerifiedEvidence(
    task.value.id,
    {
      oracle: "tsc", command: "bun run typecheck", result: "pass", recorded_by: "runner", capture_source: "runner",
      attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1, timed_out: false },
    },
    "2026-10-19T09:00:00.000Z",
  );
  if (!ev.ok) throw new Error(`evidence ${JSON.stringify(ev.error)}`);
  const claim = await svc.claim(task.value.id, { by: "alice", worktree: "feat-landing" });
  if (!claim.ok) throw new Error(`claim ${JSON.stringify(claim.error)}`);
  return { repo, svc, store, taskId: task.value.id, slug: task.value.slug, ownCommit, branchHead: ownCommit };
}

function integrateService(f: Fixture, withRecorder: boolean): IntegrateService {
  const ledgerDir = mkdtempSync(join(tmpdir(), "lore-landing-ledger-"));
  dirs.push(ledgerDir);
  return new IntegrateService({
    git: gitRunner,
    runFloor: () => ({ status: 0, output: "" }),
    corpus: { take: () => ok({ takenAt: "t" }), remove: () => ok(undefined) },
    ledger: new IntegrateLossLedger(ledgerDir),
    attempts: new IntegrateAttemptLedger(ledgerDir),
    projectRoot: f.repo,
    worktreesRoot: join(f.repo, ".claude", "worktrees"),
    log: () => undefined,
    ...(withRecorder ? { landings: { record: (landing) => f.svc.recordLanding(landing) } } : {}),
  });
}

/** The orchestrator's evidence repair: release, then re-claim from a fresh DETACHED worktree of main. */
async function reclaimFromDetachedMain(f: Fixture): Promise<void> {
  const holder = mkdtempSync(join(tmpdir(), "lore-landing-evid-"));
  dirs.push(holder);
  const detached = join(holder, "evid");
  run(f.repo, "worktree", "add", "-q", "--detach", detached, "main");
  const released = await f.svc.release(f.taskId, { by: "alice" });
  if (!released.ok) throw new Error(`release ${JSON.stringify(released.error)}`);
  const reclaimed = await f.svc.claim(f.taskId, { by: "alice", worktree: realpathSync(detached) });
  if (!reclaimed.ok) throw new Error(`reclaim ${JSON.stringify(reclaimed.error)}`);
}

describe("AC-LAND-1: a task's commit range is recorded at landing, so a later re-claim cannot replace it", () => {
  it("AC-LAND-1 (a): landed through lore integrate, re-claimed from a detached main worktree, then done -> range names the branch head and the landing commit; assess diff holds the branch's own file", async () => {
    const f = await fixture();
    const landed = await integrateService(f, true).integrate({ branch: "feat-landing", sessionId: "s1", floorCommand: "true" });
    expect(landed.ok && landed.value.kind).toBe("landed");
    const mergeSha = landed.ok && landed.value.kind === "landed" ? landed.value.sha : "";
    await reclaimFromDetachedMain(f);

    const done = await f.svc.done(f.taskId, { by: "alice" });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    const range = done.value.task.extra["commit_range"] as Record<string, unknown>;
    expect(range).toMatchObject({ state: "recorded", head: f.branchHead, landing_commit: mergeSha });
    expect(done.value.task.extra["landing"]).toMatchObject({ branch: "feat-landing", branch_head: f.branchHead, landing_commit: mergeSha });

    const ranges = collectRecordedRanges([{ slug: f.slug, extra: done.value.task.extra }]);
    const derived = deriveCommitSetForPlan(f.repo, [f.slug], true, ranges);
    expect(derived.status).toBe("derived");
    expect(derived.commits.map((c) => c.sha)).toEqual([f.ownCommit]);
    expect(derived.diff_text).toContain("own-landing-file.txt");
    expect(derived.diff_text).not.toContain("main-moved.txt");
  }, 60_000);

  it("AC-LAND-1 (b): backfill from a `merge(<branch>)` commit with no landing record produces the same record", async () => {
    const withRecord = await fixture();
    await integrateService(withRecord, true).integrate({ branch: "feat-landing", sessionId: "s1", floorCommand: "true" });
    await reclaimFromDetachedMain(withRecord);
    const doneA = await withRecord.svc.done(withRecord.taskId, { by: "alice" });

    const backfilled = await fixture();
    // landed WITHOUT a landing recorder: only the `merge(feat-landing)` commit on main remains
    await integrateService(backfilled, false).integrate({ branch: "feat-landing", sessionId: "s2", floorCommand: "true" });
    expect(backfilled.svc).toBeDefined();
    await reclaimFromDetachedMain(backfilled);
    const doneB = await backfilled.svc.done(backfilled.taskId, { by: "alice" });

    expect(doneA.ok && doneB.ok).toBe(true);
    if (!doneA.ok || !doneB.ok) return;
    const strip = (extra: Record<string, unknown>): unknown => {
      const { recorded_at: _a, ...range } = extra["commit_range"] as Record<string, unknown>;
      const { recorded_at: _b, ...landing } = extra["landing"] as Record<string, unknown>;
      return { range, landing };
    };
    const a = strip(doneA.value.task.extra) as { range: Record<string, string>; landing: Record<string, string> };
    const b = strip(doneB.value.task.extra) as { range: Record<string, string>; landing: Record<string, string> };
    // the two repos are separate histories (different shas), so compare the shape and the roles of each sha
    expect(Object.keys(b.landing).sort()).toEqual(Object.keys(a.landing).sort());
    expect(Object.keys(b.range).sort()).toEqual(Object.keys(a.range).sort());
    expect(b.range["head"]).toBe(b.landing["branch_head"]);
    expect(b.range["landing_commit"]).toBe(b.landing["landing_commit"]);
    expect(b.landing["branch"]).toBe("feat-landing");
    const ranges = collectRecordedRanges([{ slug: backfilled.slug, extra: doneB.value.task.extra }]);
    const derived = deriveCommitSetForPlan(backfilled.repo, [backfilled.slug], true, ranges);
    expect(derived.commits.map((c) => c.sha)).toEqual([backfilled.ownCommit]);
    expect(derived.diff_text).toContain("own-landing-file.txt");
  }, 60_000);

  it("AC-LAND-1 (b) assess: a task archived before this change (range = main, no landing) is backfilled from merge(<branch>)", async () => {
    const f = await fixture();
    await integrateService(f, false).integrate({ branch: "feat-landing", sessionId: "s5", floorCommand: "true" });
    const main = run(f.repo, "rev-parse", "main");
    // the measured defect: the evidence re-claim recorded main itself as the range (base == head)
    const stale = { state: "recorded", head: main, base: main, head_source: "worktree", worktree: "feat-landing", recorded_at: "t" };
    const ranges = collectRecordedRanges([{ slug: f.slug, extra: { commit_range: stale } }]);
    const derived = deriveCommitSetForPlan(f.repo, [f.slug], true, ranges);
    expect(derived.commits.map((c) => c.sha)).toEqual([f.ownCommit]);
    expect(derived.diff_text).toContain("own-landing-file.txt");
    expect(derived.attribution[f.slug]).toBe("recorded_range");
  }, 60_000);

  it("NEGATIVE: landing a different branch records nothing on a task claimed elsewhere", async () => {
    const f = await fixture();
    run(f.repo, "checkout", "-q", "-b", "other-branch", "main");
    commit(f.repo, "other.txt", "feat: other");
    run(f.repo, "checkout", "-q", "main");
    const landed = await integrateService(f, true).integrate({ branch: "other-branch", sessionId: "s4", floorCommand: "true" });
    expect(landed.ok && landed.value.kind).toBe("landed");
    const task = await f.store.find(f.taskId);
    expect(task.ok && task.value !== null ? task.value.extra["landing"] : "unreadable").toBeUndefined();
  }, 60_000);

  it("REGRESSION: integrate with no task claimed on the branch records nothing and still lands", async () => {
    const f = await fixture();
    run(f.repo, "checkout", "-q", "-b", "unclaimed-branch", "main");
    commit(f.repo, "unclaimed.txt", "feat: unclaimed");
    run(f.repo, "checkout", "-q", "main");
    mkdirSync(join(f.repo, ".claude", "worktrees"), { recursive: true });
    const landed = await integrateService(f, true).integrate({ branch: "unclaimed-branch", sessionId: "s3", floorCommand: "true" });
    expect(landed.ok && landed.value.kind).toBe("landed");
  }, 60_000);
});
