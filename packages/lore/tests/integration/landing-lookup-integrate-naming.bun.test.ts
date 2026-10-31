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
import { immediateIntegrateQueue } from "../helpers/immediate-integrate-queue";
import { IntegrateAttemptLedger } from "../../src/service/integrate-attempt-ledger.js";
import { findFirstParentCommitContaining } from "../../src/adapters/cli/assess-regression-git.js";
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
  let hideNextPathProbe = false;
  const detectBranch = recordsBranch
    ? undefined
    : async (path: string) => {
        if (!claiming) return detectWorktreeBranch(path);
        hideNextPathProbe = true;
        return { status: "unmeasured" } as const;
      };
  const svc = new TaskWorkflowService(
    store, undefined, { claimTtlMinutes: 120 },
    undefined, undefined, undefined, undefined, undefined, undefined,
    detectBranch, undefined, undefined,
    // reason: a path-only claim is the legacy shape; today's claim refuses a readable worktree with no branch (BR-1468), so the
    // fixture hides the path from the one existence probe the refusal makes, right after the unmeasured branch read.
    {
      ...createRealWorktreeProbe(repo),
      pathExists: (path: string) => {
        if (hideNextPathProbe) {
          hideNextPathProbe = false;
          return false;
        }
        return createRealWorktreeProbe(repo).pathExists(path);
      },
    },
  );
  const plan = await cs.create({ parent_id: await ensureRequirementsDocId(cs), type: "plan", title: "Landing name plan", content: "body" } as CreateDocInput);
  if (!plan.ok) throw new Error("plan");
  const task = await cs.create({
    type: "task", title: "Landing name task", parent_id: plan.value.id, content: "body",
    extra: {
      kind: "code",
      plan_id: plan.value.id,
      // the contract `lore approve` compiles, stored straight into this in-memory corpus (no git config here to compile from): a code
      // task with no oracle of its own, red run waived, so `lore done` asks only for a landing and one counted pass
      done_contract: {
        compiled_at_commit: run(repo, "rev-list", "--max-parents=0", "main"),
        kind: "code",
        base_branch: "main",
        oracles: [],
        red_required: false,
        red_waiver_reason: "the red run is not the subject of this test",
        landing_route: "main",
        new_symbols: [],
        added_oracles: [],
      },
    },
  } as CreateDocInput);
  if (!task.ok) throw new Error("task");
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
    queue: immediateIntegrateQueue(),
    attempts: new IntegrateAttemptLedger(ledgerDir),
    projectRoot: f.repo,
    worktreesRoot: join(f.repo, ".claude", "worktrees"),
    log: () => undefined,
    // D44: where an already-integrated branch entered main is measured from main's first-parent history
    firstParentContaining: (commit, ref) => findFirstParentCommitContaining(f.repo, GIT_ENV, commit, ref),
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
  // the pass `lore done` counts under the done-contract model (AC-DCS1-27 (b)): it names the landing it was recorded for (what
  // `lore integrate` stamps on the rows it records); the task's contract holds no oracle, so one counted pass is all it asks for
  const ev = await f.svc.recordVerifiedEvidence(
    f.taskId,
    {
      oracle: "tsc", command: "bun run typecheck", result: "pass", recorded_by: "runner", capture_source: "runner",
      attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1, timed_out: false, recorded_at_landing: mergeSha },
    },
    new Date(Date.now() + 1000).toISOString(),
  );
  if (!ev.ok) throw new Error(`evidence ${JSON.stringify(ev.error)}`);
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

  // reason: the retired half archived by reachability alone (kind commits) when integrate recorded no landing. `lore done` now judges a
  // code task's evidence against its landing record (AC-DCS1-27): with none there is no landed commit to bind a pass to, so it is
  // refused (evidence-unmeasurable) and nothing is backfilled from merge(<branch>).
  it("LAND-NAME (b): no landing record, path-only claim -> done is refused, no landing record is backfilled from merge(<branch>)", async () => {
    const f = await fixture(false);
    const { landing, done } = await landAndFinish(f, false);
    expect(landing).toBeUndefined(); // integrate recorded nothing (no recorder wired)
    expect(done.ok).toBe(false);
    expect(!done.ok && "message" in done.error ? done.error.message : "").toContain("no landing record");
    const task = await f.store.find(f.taskId);
    expect(task.ok && task.value !== null ? task.value.extra["landing"] : "unreadable").toBeUndefined();
    expect(task.ok && task.value !== null ? task.value.status : "unreadable").not.toBe("archived");
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
    // a branch with a commit of its own (a branch sitting on main's root commit cannot be placed in main's history, D44)
    run(f.repo, "checkout", "-q", "-b", "other-branch", "main");
    writeFileSync(join(f.repo, "other.txt"), "other\n");
    run(f.repo, "add", "other.txt");
    run(f.repo, "commit", "-q", "-m", "feat: other");
    run(f.repo, "checkout", "-q", "--detach", "main");
    const landed = await integrateService(f, true).integrate({ branch: "other-branch", sessionId: "s2", floorCommand: "true" });
    expect(landed.ok, JSON.stringify(landed)).toBe(true);
    const task = await f.store.find(f.taskId);
    expect(task.ok && task.value !== null ? task.value.extra["landing"] : "unreadable").toBeUndefined();
  }, 60_000);
});
