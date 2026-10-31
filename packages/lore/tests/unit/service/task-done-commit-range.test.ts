/**
 * @spec_ref task-gh-1343388703-180
 *
 * `lore done` records `extra.commit_range` from the landing `lore integrate` recorded on the task (base = main
 * before the landing, head = the branch head) so `lore assess` can find the task's commits without the slug in a
 * message; the claimed working copy's own head is never measured (BR-1291). Real service over InMemoryStore + a real
 * temp repo as the claimed worktree (never the repo `.lore/`).
 *   HAPPY:      claim, commit, landing recorded, done -> range {base, head} recorded from the landing.
 *   NEGATIVE:   the same without a landing -> refused `not-landed`.
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
import { createRealWorktreeProbe } from "../../../src/service/worktree-cleanup.js";
import { readMeasuredCommitRange, readTaskLanding } from "../../../src/service/task-commit-range.js";
import { deriveLandingDiffForPlan } from "../../../src/adapters/cli/assess-commit-derivation.js";
import type { CreateDocInput } from "@lore/core";
import { actedStore } from "../../live-invocation.js";
import { runOfName } from "../../helpers/test-run-identity.js";

import { ensureRequirementsDocId } from "../../helpers/parented-create.js";
import { unitDoneContract } from "./done-contract-unit-fixture.js";
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

/**
 * What the approve compile stores for a `corpus` task compiled at `compiledAt` (spec AC-DCS1-2: a corpus task always has the one
 * oracle `corpus:files-unchanged`, lands nothing, and waives no red run because none is required of it).
 */
function corpusContract(compiledAt: string): Record<string, unknown> {
  return {
    compiled_at_commit: compiledAt,
    kind: "corpus",
    base_branch: "main",
    oracles: [{ id: "corpus:files-unchanged" }],
    red_required: false,
    landing_route: "none",
    new_symbols: [],
    added_oracles: [],
  };
}

/**
 * A draft task of the given kind holding the stored contract `done` judges (AC-DCS1-7). A `code` task holds no landing yet
 * (the test's `recordLanding` writes it); a `corpus` task lands nothing and is compiled at `compiledAt`.
 */
async function makeArchivableTask(
  probeRepo: string = process.cwd(),
  shape: { readonly kind: "code" } | { readonly kind: "corpus"; readonly compiledAt: string } = { kind: "code" },
): Promise<{ svc: TaskWorkflowService; taskId: string }> {
  const store = actedStore(new InMemoryStore());
  const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const svc = new TaskWorkflowService(
    store, undefined, { claimTtlMinutes: 120 },
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    createRealWorktreeProbe(probeRepo),
  );
  const plan = await cs.create({ parent_id: await ensureRequirementsDocId(cs), type: "plan", title: "Range plan", content: "body" } as CreateDocInput);
  if (!plan.ok) throw new Error("plan");
  const task = await cs.create({
    type: "task",
    title: "Range task",
    parent_id: plan.value.id,
    content: "body",
    extra:
      shape.kind === "code"
        ? { plan_id: plan.value.id, kind: "code", done_contract: unitDoneContract() }
        : { plan_id: plan.value.id, kind: "corpus", done_contract: corpusContract(shape.compiledAt) },
  } as CreateDocInput);
  if (!task.ok) throw new Error("task");
  return { svc, taskId: task.value.id };
}

/**
 * A runner-attested pass of the contract's typecheck oracle that counts for a code task (AC-DCS1-27 (b)): it names the landing
 * it was recorded for, which is what `lore integrate` stamps on the rows it records at a landing.
 */
async function recordLandedPass(svc: TaskWorkflowService, taskId: string, landingCommit: string): Promise<void> {
  const ev = await svc.recordVerifiedEvidence(
    taskId,
    {
      oracle: "tsc", command: "bun run typecheck", result: "pass", recorded_by: "runner", capture_source: "runner",
      attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1, timed_out: false, recorded_at_landing: landingCommit },
    },
    new Date(Date.now() + 1000).toISOString(),
  );
  if (!ev.ok) throw new Error(`evidence ${JSON.stringify(ev.error)}`);
}

/** A runner-attested pass of the `corpus:files-unchanged` oracle taken at `headSha`, a commit of main (the rule for a corpus task, AC-DCS1-19). */
async function recordCorpusPass(svc: TaskWorkflowService, taskId: string, headSha: string): Promise<void> {
  const ev = await svc.recordVerifiedEvidence(
    taskId,
    {
      oracle: "other", command: "corpus:files-unchanged", result: "pass", recorded_by: "runner", capture_source: "runner",
      attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1, timed_out: false, head_sha: headSha, worktree_dirty: false },
    },
    new Date(Date.now() + 1000).toISOString(),
  );
  if (!ev.ok) throw new Error(`evidence ${JSON.stringify(ev.error)}`);
}

describe("lore done under the dispatch protocol: --worktree is a branch NAME (issue #180 retry)", () => {
  it("records state:recorded with head = the branch tip, and assess attributes the commits though the merge lacks the slug", async () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), "lore-done-branch-test-")));
    dirs.push(repo);
    run(repo, "init", "-q", "-b", "main");
    const base = commit(repo, "seed.txt", "seed");
    run(repo, "checkout", "-q", "-b", "agent-branch-x");

    // `.claude/rules/lore-worktree-dispatch.md`: implementers claim with the branch NAME.
    const probe = createRealWorktreeProbe(repo);
    const store = actedStore(new InMemoryStore());
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const svc = new TaskWorkflowService(
      store, undefined, { claimTtlMinutes: 120 },
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      probe,
    );
    const plan = await cs.create({ parent_id: await ensureRequirementsDocId(cs), type: "plan", title: "Branch plan", content: "body" } as CreateDocInput);
    if (!plan.ok) throw new Error("plan");
    const created = await cs.create({
      type: "task", title: "Branch task", parent_id: plan.value.id, content: "body",
      extra: { plan_id: plan.value.id, kind: "code", done_contract: unitDoneContract() },
    } as CreateDocInput);
    if (!created.ok) throw new Error("task");
    const taskId = created.value.id;

    const claim = await svc.claim(taskId, { by: "alice", harnessRun: runOfName("alice"), worktree: "agent-branch-x" });
    expect(claim.ok).toBe(true);
    const c1 = commit(repo, "a.txt", "feat: a");
    const c2 = commit(repo, "b.txt", "feat: b");
    run(repo, "checkout", "-q", "main");
    run(repo, "merge", "--no-ff", "-q", "-m", "merge branch without the slug", "agent-branch-x");
    // what `lore integrate` records on the claimant when it lands the branch (BR-1336); done reads only this
    const mergeSha = run(repo, "rev-parse", "main");
    const recorded = await svc.recordLanding({ branch: "agent-branch-x", branch_head: c2, main_before: base, main_after: mergeSha, landing_commit: mergeSha });
    expect(recorded.ok && recorded.value).toEqual([created.value.slug]);
    // reason: AC-DCS1-27 (b) — the pass `lore integrate` records at this landing names it; done counts only that (or a same-tree row).
    await recordLandedPass(svc, taskId, mergeSha);

    const done = await svc.done(taskId, { by: "alice", harnessRun: runOfName("alice") });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    const range = readMeasuredCommitRange(done.value.task.extra);
    expect(range).toMatchObject({ state: "recorded", head: c2, base, head_source: "landing", landing_commit: mergeSha });

    const landing = readTaskLanding(done.value.task.extra);
    const derived = deriveLandingDiffForPlan(repo, [{ slug: done.value.task.slug, landing }], true);
    expect(derived.status).toBe("derived");
    expect(derived.commits.map((c) => c.sha)).toEqual([c1, c2]);
    expect(derived.attribution[done.value.task.slug]).toBe("recorded_range");
  }, 60_000);
});

describe("lore done records extra.commit_range (issue #180)", () => {
  it("HAPPY: records base and head from the landing recorded on the task", async () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), "lore-done-range-test-")));
    dirs.push(repo);
    run(repo, "init", "-q", "-b", "main");
    const base = commit(repo, "seed.txt", "seed");
    const { svc, taskId } = await makeArchivableTask(repo);

    const claim = await svc.claim(taskId, { by: "alice", harnessRun: runOfName("alice"), worktree: repo });
    expect(claim.ok).toBe(true);
    commit(repo, "a.txt", "feat: a");
    const head = commit(repo, "b.txt", "feat: b");
    // the working copy is main itself, so its commits are on main already; the landing is what done reads (BR-1291)
    const recorded = await svc.recordLanding({ branch: "main", branch_head: head, main_before: base, main_after: head, landing_commit: head });
    expect(recorded.ok).toBe(true);
    await recordLandedPass(svc, taskId, head);

    const done = await svc.done(taskId, { by: "alice", harnessRun: runOfName("alice") });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.value.task.status).toBe("archived");
    expect(done.value.task.extra["commit_range"]).toMatchObject({ state: "recorded", base, head, worktree: "main", head_source: "landing" });
  });

  it("NEGATIVE: a claimed branch whose commits are not on main is refused [floor: not-landed], whatever evidence says", async () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), "lore-done-range-nolanding-")));
    dirs.push(repo);
    run(repo, "init", "-q", "-b", "main");
    const base = commit(repo, "seed.txt", "seed");
    run(repo, "checkout", "-q", "-b", "feat-unlanded");
    const { svc, taskId } = await makeArchivableTask(repo);
    expect((await svc.claim(taskId, { by: "alice", harnessRun: runOfName("alice"), worktree: "feat-unlanded" })).ok).toBe(true);
    // a pass naming some landing: the branch never landed, so the not-landed floor refuses before any evidence is judged
    await recordLandedPass(svc, taskId, base);
    commit(repo, "a.txt", "feat: a");

    const done = await svc.done(taskId, { by: "alice", harnessRun: runOfName("alice") });

    expect(done.ok).toBe(false);
    expect(!done.ok && "message" in done.error ? done.error.message : "").toContain("[floor: not-landed]");
  });

  it("BOUNDARY: a corpus task never claimed (it lands nothing) records not-measured with a reason, and still archives", async () => {
    // reason: only a check or corpus task is closed without a branch (AC-DCS1-14); its pass counts at a main commit that contains
    // the compile commit (AC-DCS1-27), so the repository is real and the row ran on main's head.
    const repo = realpathSync(mkdtempSync(join(tmpdir(), "lore-done-range-corpus-")));
    dirs.push(repo);
    run(repo, "init", "-q", "-b", "main");
    const base = commit(repo, "seed.txt", "seed");
    const { svc, taskId } = await makeArchivableTask(repo, { kind: "corpus", compiledAt: base });
    await recordCorpusPass(svc, taskId, base);

    const done = await svc.done(taskId, { by: "alice", harnessRun: runOfName("alice") });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.value.task.status).toBe("archived");
    const range = done.value.task.extra["commit_range"] as { state?: string; reason?: string } | undefined;
    expect(range?.state).toBe("not-measured");
    expect(range?.reason).toMatch(/no landing is recorded/);
  });
});
