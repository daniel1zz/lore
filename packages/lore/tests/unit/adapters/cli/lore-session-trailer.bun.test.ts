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
 * ── task-the-lore-session-trailer-is-inert-whenever-core-hookspath ──────────
 * Two further describe blocks below close the gap the assessment named:
 * AC-OWN-4's own oracle never drove the configuration THIS repo ships
 * (`git config core.hooksPath hooks`, a directory outside `.git` — the
 * pre-fix code's `hooksDirIsInsideGitDir` check silently skipped exactly
 * that case). Direction chosen (recorded in `real-git-port.ts`'s own doc):
 * SUPPORT the outside-the-git-dir case (Direction 1) rather than merely
 * report the skip, because it is achievable without writing outside the
 * repo (the hook lands inside a KNOWN working tree of the repo, protected
 * from dirtying `git status` via the repo's own `$GIT_COMMON_DIR/info/
 * exclude`) — see `real-git-port.ts::ensureSessionTrailerHookInstalled`'s
 * own JSDoc for the full rationale.
 *
 *   "core.hooksPath outside the git dir..." describe block:
 *     HAPPY:      hooksPath outside .git but INSIDE the repo (this repo's
 *                 own shape) — the trailer STILL LANDS
 *     STATE:      installing there NEVER dirties `git status` (the exact
 *                 invariant the pre-fix skip existed to protect)
 *     REGRESSION: a SECOND claim under the same hooksPath shape is
 *                 idempotent — no duplicate `info/exclude` line, no error
 *     BOUNDARY:   a hooksPath resolving OUTSIDE every working tree of the
 *                 repo entirely (a genuinely foreign directory) is STILL
 *                 silently skipped, and nothing is ever written there — the
 *                 blast-radius containment this fix's own doc promises
 *
 * The marker's second defect — `writeClaimSessionMarker` had no clearing
 * path on release, so a released worktree's later commits kept the stale
 * trailer — is fixed by the newly-exported `unbindClaimSessionForTrailer`
 * (real-git-port.ts), now WIRED into `TaskWorkflowService._releaseImpl` via
 * the `releaseClaimTrailerBinding` injected port (task-workflow-service.ts),
 * mirroring `installClaimTrailerBinding`'s existing `_claimImpl` call site.
 * The block below drives the unbind ONLY through
 * `taskWorkflowService.release(...)` — never by calling the exported port
 * directly — so it proves the WIRING, not merely the underlying capability:
 *
 *   "a released claim's session no longer taints later commits" describe block:
 *     STATE:    releasing a claim via `taskWorkflowService.release(...)`
 *               clears the marker it bound — a LATER commit in that same
 *               worktree carries no trailer
 *     NEGATIVE: releasing an OLDER claim whose worktree marker was already
 *               overwritten by a SECOND, newer claim on the same worktree is
 *               a no-op through the service exactly as it is at the port
 *               level — it never erases the newer, still-live claim's marker
 *
 * @spec_ref spec-multi-session-concurrency-queryable-ownership-checkout AC-OWN-4
 */

import { RecordLockService } from "../../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../../src/service/gate-enforcer.js";
import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

/** `git status --porcelain` output — "" means a clean tree (no untracked/modified paths). */
function gitStatusPorcelain(repoRoot: string): string {
  return git(repoRoot, "status", "--porcelain");
}

/**
 * Configures `repoRoot`'s `core.hooksPath` to `relativeDir` — a directory
 * INSIDE the repo's own working tree but OUTSIDE `.git` — mirroring THIS
 * repo's own shipped shape (`hooks/pre-push` et al, root CLAUDE.md's
 * `git config core.hooksPath hooks` instruction). Creates and COMMITS a
 * placeholder tracked file inside it first, so the directory is genuinely
 * TRACKED — the exact precondition `ensureSessionTrailerHookInstalled`'s
 * dirtying risk depends on (an untracked hooks dir would never dirty `git
 * status` in the first place, so it would not exercise the fix at all).
 */
function configureTrackedHooksPathOutsideGitDir(repoRoot: string, relativeDir: string): void {
  const hooksDirAbs = join(repoRoot, relativeDir);
  mkdirSync(hooksDirAbs, { recursive: true });
  writeFileSync(join(hooksDirAbs, "placeholder.sh"), "#!/bin/sh\n", "utf8");
  git(repoRoot, "add", join(relativeDir, "placeholder.sh"));
  git(repoRoot, "commit", "-q", "-m", `track ${relativeDir}`);
  git(repoRoot, "config", "core.hooksPath", relativeDir);
}

// ─── Service fixtures ───────────────────────────────────────────────────────

function makeServices(processEnv: Record<string, string | undefined> = {}) {
  const store = new InMemoryStore();
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
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
    const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
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

// ─── task-the-lore-session-trailer-is-inert-whenever-core-hookspath ────────

describe("core.hooksPath outside the git dir but inside the repo still gets the trailer (AC-OWN-4, Direction 1)", () => {
  it("HAPPY: hooksPath outside .git but inside the repo (this repo's own shape) still lands the trailer", async () => {
    const { repoRoot } = makeRepo();
    configureTrackedHooksPathOutsideGitDir(repoRoot, "hooks");
    const { corpusService, taskWorkflowService } = makeServices({
      CLAUDE_CODE_SESSION_ID: "hookspath-happy-1234",
    });
    const { taskId } = await createPlanAndTask(corpusService);

    const claimResult = await taskWorkflowService.claim(taskId, { by: "alice", worktree: repoRoot });
    expect(claimResult.ok).toBe(true);

    commitFile(repoRoot, "under-claim.txt", "content\n", "commit under active claim, hooksPath outside .git");

    expect(readLoreSessionTrailer(repoRoot)).toBe(sessionIdDiscriminator("hookspath-happy-1234"));
  });

  it("STATE: installing the hook into a hooksPath outside .git never dirties the working tree", async () => {
    const { repoRoot } = makeRepo();
    configureTrackedHooksPathOutsideGitDir(repoRoot, "hooks");
    // reason: the CONFIGURE step above already commits its own placeholder
    // file, so the tree is clean again by the time we measure the baseline —
    // this assertion is about what `lore claim` itself introduces, not about
    // the fixture setup.
    expect(gitStatusPorcelain(repoRoot)).toBe("");

    const { corpusService, taskWorkflowService } = makeServices({
      CLAUDE_CODE_SESSION_ID: "hookspath-clean-1234",
    });
    const { taskId } = await createPlanAndTask(corpusService);
    const claimResult = await taskWorkflowService.claim(taskId, { by: "alice", worktree: repoRoot });
    expect(claimResult.ok).toBe(true);

    // reason: this is the invariant the pre-fix code's blanket skip existed
    // to protect — a `commit-msg` file now genuinely exists inside the
    // TRACKED `hooks/` dir (proven by the HAPPY case above), so an oracle
    // that only checked "the file was written" would pass even if `git
    // status` had gone dirty. Assert the actual promise directly.
    expect(gitStatusPorcelain(repoRoot)).toBe("");
  });

  it("REGRESSION: a second claim under the same hooksPath shape is idempotent — no duplicate exclude line, no error", async () => {
    const { repoRoot } = makeRepo();
    configureTrackedHooksPathOutsideGitDir(repoRoot, "hooks");
    const { corpusService, taskWorkflowService } = makeServices({
      CLAUDE_CODE_SESSION_ID: "hookspath-idempotent-1",
    });
    const { taskId } = await createPlanAndTask(corpusService);

    const first = await taskWorkflowService.claim(taskId, { by: "alice", worktree: repoRoot });
    expect(first.ok).toBe(true);
    const excludeContentAfterFirst = readFileSync(join(repoRoot, ".git", "info", "exclude"), "utf8");
    const patternOccurrences = excludeContentAfterFirst.split("\n").filter((line) => line === "/hooks/commit-msg")
      .length;
    expect(patternOccurrences).toBe(1);

    const second = await taskWorkflowService.claim(taskId, { by: "alice", worktree: repoRoot });
    expect(second.ok).toBe(true);
    const excludeContentAfterSecond = readFileSync(join(repoRoot, ".git", "info", "exclude"), "utf8");
    expect(excludeContentAfterSecond.split("\n").filter((line) => line === "/hooks/commit-msg").length).toBe(1);
    expect(gitStatusPorcelain(repoRoot)).toBe("");
  });

  it("BOUNDARY: a hooksPath resolving outside every working tree of the repo is still silently skipped", async () => {
    const { repoRoot } = makeRepo();
    const foreignDir = mkdtempSync(join(tmpdir(), "lore-ac-own-4-foreign-hooks-"));
    cleanupDirs.push(foreignDir);
    git(repoRoot, "config", "core.hooksPath", foreignDir);

    const { corpusService, taskWorkflowService } = makeServices({
      CLAUDE_CODE_SESSION_ID: "hookspath-foreign-1234",
    });
    const { taskId } = await createPlanAndTask(corpusService);
    const claimResult = await taskWorkflowService.claim(taskId, { by: "alice", worktree: repoRoot });
    expect(claimResult.ok).toBe(true);

    commitFile(repoRoot, "under-claim.txt", "content\n", "commit under active claim, hooksPath entirely foreign");

    // reason: install was refused, so the trailer never lands — AND nothing
    // was ever written into the foreign directory itself (the blast-radius
    // containment `ensureSessionTrailerHookInstalled`'s own doc promises).
    expect(readLoreSessionTrailer(repoRoot)).toBe("");
    expect(readdirSync(foreignDir)).toEqual([]);
  });
});

describe("a released claim's session no longer taints later commits (AC-OWN-4, second defect)", () => {
  it("STATE: taskWorkflowService.release clears the marker it bound — a later commit carries no trailer", async () => {
    const { repoRoot } = makeRepo();
    const { corpusService, taskWorkflowService } = makeServices({
      CLAUDE_CODE_SESSION_ID: "release-state-5678",
    });
    const { taskId } = await createPlanAndTask(corpusService);

    const claimResult = await taskWorkflowService.claim(taskId, { by: "alice", worktree: repoRoot });
    expect(claimResult.ok).toBe(true);
    commitFile(repoRoot, "before-release.txt", "content\n", "commit while the claim is still active");
    expect(readLoreSessionTrailer(repoRoot)).toBe(sessionIdDiscriminator("release-state-5678"));

    const releaseResult = await taskWorkflowService.release(taskId, { by: "alice" });
    expect(releaseResult.ok).toBe(true);

    commitFile(repoRoot, "after-release.txt", "content\n", "commit after the claim was released");
    expect(readLoreSessionTrailer(repoRoot)).toBe("");
  });

  it("NEGATIVE: releasing an older claim whose marker was already overwritten by a newer claim is a no-op — the newer claim's marker survives", async () => {
    const { repoRoot } = makeRepo();
    const { corpusService: corpusA, taskWorkflowService: serviceA } = makeServices({
      CLAUDE_CODE_SESSION_ID: "aaaa3333-release-negative-first",
    });
    const { corpusService: corpusB, taskWorkflowService: serviceB } = makeServices({
      CLAUDE_CODE_SESSION_ID: "bbbb4444-release-negative-second",
    });
    const { taskId: firstTaskId } = await createPlanAndTask(corpusA);
    const { taskId: secondTaskId } = await createPlanAndTask(corpusB);

    const firstClaim = await serviceA.claim(firstTaskId, { by: "alice", worktree: repoRoot });
    expect(firstClaim.ok).toBe(true);
    // reason: a DIFFERENT task claims the SAME worktree before the first
    // claim's (stale) release call ever runs — mirrors AC-OWN-4's own STATE
    // case ("re-claiming overwrites the marker"), just staged as the
    // precondition here instead of the assertion.
    const secondClaim = await serviceB.claim(secondTaskId, { by: "bob", worktree: repoRoot });
    expect(secondClaim.ok).toBe(true);

    const releaseResult = await serviceA.release(firstTaskId, { by: "alice" });
    expect(releaseResult.ok).toBe(true);

    commitFile(repoRoot, "after-mismatched-release.txt", "content\n", "commit after a stale claim's release");
    expect(readLoreSessionTrailer(repoRoot)).toBe(sessionIdDiscriminator("bbbb4444-release-negative-second"));
  });
});
