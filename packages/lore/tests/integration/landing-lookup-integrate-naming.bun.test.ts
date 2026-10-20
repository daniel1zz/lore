// @reads assets/project/reference-transaction
/**
 * The landing lookup matches what `lore integrate` actually writes: the merge commit is named by the BRANCH
 * (`merge(<branch>)`), while a claim from a linked worktree records the worktree PATH. Both `recordLanding`
 * (integrate time) and the done-time `not-landed` floor must therefore derive their candidate names from the claim's
 * branch, read from git when the claim recorded only the path.
 *
 * Throwaway git repo + InMemoryStore only (never the repo's `.lore/`). The existing commit-range-from-landing
 * fixture claims with a branch NAME as `worktree`, which is why it never saw this defect.
 *
 *   LAND-NAME (a): claim from a linked worktree (path) whose claim recorded no branch -> integrate B ->
 *     extra.landing names B and the merge commit; done prints no "commit range taken from the claim" note.
 *   LAND-NAME (b): same, but the landing record is missing (integrate without a recorder) -> done refuses
 *     `not-landed`; nothing is backfilled from `merge(B)` (BR-1291).
 *   LAND-NAME (c): the claim recorded its branch (auto-capture) -> same outcome (control, must stay green).
 *   NEGATIVE: landing a branch no claim's worktree is on records nothing.
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
import { detectWorktreeBranch } from "../../src/adapters/real-git-port.js";
import { createRealWorktreeProbe } from "../../src/service/worktree-cleanup.js";
import { IntegrateService, type IntegrateGit } from "../../src/service/integrate-service.js";
import { IntegrateLossLedger } from "../../src/service/integrate-loss-ledger.js";
import { IntegrateAttemptLedger } from "../../src/service/integrate-attempt-ledger.js";
import { actedStore } from "../live-invocation.js";
import { installShippedGuard } from "./support/main-guard-repo.js";
import { runOfName } from "../helpers/test-run-identity.js";

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Tester",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "Tester",
  GIT_COMMITTER_EMAIL: "t@example.com",
};
const BRANCH = "worktree-agent-landing-name";
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

const gitRunner: IntegrateGit = (cwd, args, env) => {
  const r = spawnSync("git", [...args], { cwd, encoding: "utf8", env: { ...GIT_ENV, ...env } });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};

interface Fixture {
  readonly repo: string;
  readonly worktree: string;
  readonly svc: TaskWorkflowService;
  readonly store: ReturnType<typeof actedStore>;
  readonly taskId: string;
}

/**
 * A repo on main; a LINKED worktree on branch BRANCH holding one own commit; a task claimed from that worktree's
 * PATH. `recordsBranch: false` models a claim whose recorded names hold only the path (branch not measured).
 */
async function fixture(recordsBranch: boolean): Promise<Fixture> {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "lore-landing-name-")));
  dirs.push(repo);
  run(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "seed.txt"), "seed\n");
  run(repo, "add", "seed.txt");
  run(repo, "commit", "-q", "-m", "seed");
  // the shared checkout is a detached view of main and the shipped guard is installed: integrate refuses to run without it
  run(repo, "checkout", "-q", "--detach", "main");
  installShippedGuard(repo, join(repo, ".git", "guard-hooks"));
  const worktreesRoot = join(repo, ".claude", "worktrees");
  mkdirSync(worktreesRoot, { recursive: true });
  const worktree = join(worktreesRoot, BRANCH);
  run(repo, "worktree", "add", "-q", "-b", BRANCH, worktree, "main");
  const realWorktree = realpathSync(worktree);

  const store = actedStore(new InMemoryStore());
  const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  // reason: the branch is unmeasured only AT CLAIM TIME (the claim then records the path alone); the landing lookup
  // that runs later reads the worktree's branch from git for real.
  let claiming = true;
  const detectBranch = recordsBranch
    ? undefined
    : async (path: string) => (claiming ? ({ status: "unmeasured" } as const) : detectWorktreeBranch(path));
  const svc = new TaskWorkflowService(
    store, undefined, { claimTtlMinutes: 120 },
    undefined, undefined, undefined, undefined, undefined, undefined,
    detectBranch, undefined, undefined,
    createRealWorktreeProbe(repo),
  );
  const plan = await cs.create({ type: "plan", title: "Landing name plan", content: "body" } as CreateDocInput);
  if (!plan.ok) throw new Error("plan");
  const task = await cs.create({
    type: "task", title: "Landing name task", parent_id: plan.value.id, content: "body", extra: { plan_id: plan.value.id },
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
  const claim = await svc.claim(task.value.id, { by: "alice", harnessRun: runOfName("alice"), worktree: realWorktree });
  if (!claim.ok) throw new Error(`claim ${JSON.stringify(claim.error)}`);
  claiming = false;
  // reason: BR-1353 — a first claim starts from main, so the branch's own work is committed AFTER the claim.
  writeFileSync(join(realWorktree, "own-file.txt"), "own\n");
  run(realWorktree, "add", "own-file.txt");
  run(realWorktree, "commit", "-q", "-m", "feat: the branch's own work");
  return { repo, worktree: realWorktree, svc, store, taskId: task.value.id };
}

function integrateService(f: Fixture, withRecorder: boolean): IntegrateService {
  const ledgerDir = mkdtempSync(join(tmpdir(), "lore-landing-name-ledger-"));
  dirs.push(ledgerDir);
  return new IntegrateService({
    git: gitRunner,
    lease: { acquire: () => ok({ kind: "held", release: () => {} }) },
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

async function landAndFinish(f: Fixture, withRecorder: boolean) {
  const landed = await integrateService(f, withRecorder).integrate({ branch: BRANCH, sessionId: "s1", floorCommand: "true" });
  expect(landed.ok && landed.value.kind).toBe("landed");
  const mergeSha = landed.ok && landed.value.kind === "landed" ? landed.value.sha : "";
  // the real integrate naming: `merge(<branch>): <branch subject>`
  expect(run(f.repo, "log", "-1", "--format=%s", "main").startsWith(`merge(${BRANCH})`)).toBe(true);
  const afterLand = await f.store.find(f.taskId);
  const landing = afterLand.ok && afterLand.value !== null ? afterLand.value.extra["landing"] : "unreadable";
  const done = await f.svc.done(f.taskId, { by: "alice", harnessRun: runOfName("alice") });
  return { mergeSha, landing, done };
}

describe("LAND-NAME: the landing lookup matches the branch name `lore integrate` writes", () => {
  it("LAND-NAME (a): a claim that recorded only the worktree path is matched by its branch at integrate time and at done", async () => {
    const f = await fixture(false);
    const { mergeSha, landing, done } = await landAndFinish(f, true);
    expect(landing).toMatchObject({ branch: BRANCH, landing_commit: mergeSha });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.value.commit_range_note).toBeUndefined();
    expect(done.value.task.extra["landing"]).toMatchObject({ branch: BRANCH, landing_commit: mergeSha });
    expect(done.value.task.extra["commit_range"]).toMatchObject({ state: "recorded", head_source: "landing", landing_commit: mergeSha });
  }, 60_000);

  it("LAND-NAME (b): no landing record, path-only claim -> done is refused [floor: not-landed]; nothing is backfilled from merge(<branch>)", async () => {
    const f = await fixture(false);
    const { landing, done } = await landAndFinish(f, false);
    expect(landing).toBeUndefined();
    expect(done.ok).toBe(false);
    expect(!done.ok && "message" in done.error ? done.error.message : "").toContain("[floor: not-landed]");
  }, 60_000);

  it("LAND-NAME (c): control, the claim recorded its branch (auto-capture) -> same outcome", async () => {
    const f = await fixture(true);
    const { mergeSha, landing, done } = await landAndFinish(f, true);
    expect(landing).toMatchObject({ branch: BRANCH, landing_commit: mergeSha });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.value.commit_range_note).toBeUndefined();
  }, 60_000);

  it("NEGATIVE: landing a branch no claim's worktree is on records nothing", async () => {
    const f = await fixture(false);
    run(f.repo, "branch", "other-branch", "main");
    const landed = await integrateService(f, true).integrate({ branch: "other-branch", sessionId: "s2", floorCommand: "true" });
    expect(landed.ok).toBe(true);
    const task = await f.store.find(f.taskId);
    expect(task.ok && task.value !== null ? task.value.extra["landing"] : "unreadable").toBeUndefined();
  }, 60_000);
});
