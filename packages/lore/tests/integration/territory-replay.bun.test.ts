/**
 * AC-REPLAY-1 (spec-multi-session-concurrency-queryable-ownership-checkout) —
 * the P1 sufficiency proof. Replays the 2026-08-11 diagnosis — "who owns this
 * branch/worktree, does it have unmerged work, and is its session alive" —
 * using ONLY the lore-shipped service methods that back `lore territory
 * --json` and `lore session list --json` (`SessionService.getActiveSessions`
 * / `deriveSessionLiveness`, `territory-partition.ts::partitionTerritory`),
 * called in-process against a REAL git repo — the SAME "in-process, chosen
 * over subprocess spawn for speed and determinism" idiom this codebase
 * already establishes (`spec-loop-e2e.bun.test.ts`'s own header,
 * `active-sessions-branches.bun.test.ts`'s fixture style).
 *
 * The AC demands a CONCLUSION, not a command: "yields the EXACT expected
 * value for each of the four facts ... foreign branch set, unmerged commit
 * count per branch, holder session_id per branch, liveness verdict per
 * session; the assertion fails if any of the four is an empty set". ALL FOUR
 * facts are reachable through lore alone and are asserted exactly, never as
 * an empty set, below — INCLUDING the count, closed since this test was
 * first written: `territory-partition.ts`'s `TerritoryEntry.unmerged_commits`
 * field (populated via `real-git-port.ts::countUnmergedCommitsSync`, wired at
 * `territory-partition.ts:242` for a worktree entry and `:266` for an orphan
 * branch entry) now carries the per-branch integer that `commands/
 * territory.ts` once had no signal for at all (the only git-backed signal
 * used to be the BOOLEAN `GitPort.isMerged`). See the "FACT 2" block in the
 * HAPPY case below — it reads `TerritoryEntry.unmerged_commits` off the SAME
 * `partition` this test already computed for facts 1/3, asserts it exactly
 * against ground truth, and never shells out to git to ANSWER a fact (per
 * the task brief: "do not paper over it by shelling out to git inside the
 * replay"). Every git subprocess call below is FIXTURE CONSTRUCTION (building
 * the throwaway repo + branches) or a ground-truth SELF-CHECK on that
 * construction, clearly marked, never part of a REPLAY step.
 *
 * ⛔ Never touches this repo's own `.lore/` corpus — every case uses a bare
 * `InMemoryStore` (no `bun:sqlite`, no `lore init`) plus throwaway `mkdtemp`
 * git repos, mirroring `active-sessions-branches.bun.test.ts`.
 *
 * Six-dimension coverage:
 *   HAPPY:      the AC's own fixture — exactly 2 sessions, exactly 3 branches
 *               (mine / foreign-with-1-unmerged-commit / unowned) — ALL FOUR
 *               facts reconstructed exactly, non-empty, through lore alone.
 *   NEGATIVE:   liveness distinguishes a DEAD session's holder from an ALIVE
 *               one — collapsing them was the GAP-D defect this spec closes.
 *   BOUNDARY:   `isMerged` — a boolean, coarser than the exact
 *               `unmerged_commits` count FACT 2 now reads — still DOES
 *               distinguish zero unmerged commits (merged branch) from at
 *               least one (foreign branch) as its own corroborating check.
 *   ERROR:      a claim with no measurable branch (detached HEAD worktree)
 *               never invents a branch name and is never classified
 *               `unowned` — the worktree still shows a real claimant.
 *   STATE:      releasing the foreign claim removes it from BOTH
 *               `getActiveSessions()` and the territory partition — a
 *               conclusion that only holds while the claim is live.
 *   REGRESSION: a session recorded on a DIFFERENT machine is reported
 *               `"unmeasured"`, NEVER `"dead"` — cross-machine liveness must
 *               stay advisory, never a false-negative kill signal.
 *
 * @spec_ref spec-multi-session-concurrency-queryable-ownership-checkout AC-REPLAY-1
 */

import { RecordLockService } from "../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../src/service/gate-enforcer.js";
import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CreateDocInput, DocRecord } from "@lore/core";
import { InMemoryStore } from "../../src/store/in-memory-store.js";
import { CorpusService } from "../../src/service/corpus-service.js";
import { TaskWorkflowService } from "../../src/service/task-workflow-service.js";
import { SessionService } from "../../src/service/session-service.js";
import type { SessionHeartbeatRecord } from "../../src/service/session-liveness.js";
import { RealGitPort } from "../../src/adapters/real-git-port.js";
import { partitionTerritory, type TerritoryEntry } from "../../src/adapters/cli/territory-partition.js";
import { actedStore } from "../live-invocation.js";
import { runOfName } from "../helpers/test-run-identity.js";

// ─── Real git-repo fixtures (throwaway `mkdtemp` — NEVER this repo's own tree) ──

const cleanupDirs: string[] = [];

afterEach(() => {
  // reason: best-effort per-test cleanup — mirrors active-sessions-branches.bun.test.ts.
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

/** FIXTURE CONSTRUCTION ONLY — never part of a "replay" step. See module header. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/**
 * `mkdtempSync(join(tmpdir(), prefix))` under a REAL path, not `os.tmpdir()`'s
 * raw value — on macOS `tmpdir()` returns `/var/folders/...`, a symlink whose
 * target is `/private/var/folders/...`, and `git worktree list --porcelain`
 * reports the RESOLVED path. Comparing an un-resolved mkdtemp path against
 * git's own porcelain output would silently never match — this fixes that at
 * construction time rather than at every comparison site.
 */
function mkdtempReal(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

function commitFile(repoRoot: string, name: string, message: string): void {
  writeFileSync(join(repoRoot, name), `${name} content\n`);
  git(repoRoot, "add", name);
  git(repoRoot, "commit", "-q", "-m", message);
}

/**
 * Builds the AC-REPLAY-1 fixture topology: ONE git repo whose main worktree
 * is "mine"'s worktree (branch `main`); an orphan branch `foreign-branch`
 * carrying EXACTLY one commit main does not have, checked out nowhere (the
 * exact 2026-08-11 shape: a branch with live unmerged work but no live
 * worktree in THIS listing); a fully-merged control branch (BOUNDARY, zero
 * unmerged commits); and a linked worktree on its own branch, claimed by
 * NOBODY (the `unowned` entry).
 */
function makeTerritoryFixtureRepo(): { repoRoot: string; unownedWorktreePath: string } {
  const repoRoot = mkdtempReal("lore-replay-fixture-");
  git(repoRoot, "init", "-q", "-b", "main");
  git(repoRoot, "config", "user.email", "ac-replay-1@example.com");
  git(repoRoot, "config", "user.name", "AC-REPLAY-1 Test");
  commitFile(repoRoot, "seed.txt", "seed");

  // `foreign-branch`: EXACTLY one commit ahead of main, checked out nowhere.
  git(repoRoot, "branch", "foreign-branch");
  git(repoRoot, "checkout", "-q", "foreign-branch");
  commitFile(repoRoot, "foreign-work.txt", "foreign session's in-flight work");
  git(repoRoot, "checkout", "-q", "main");

  // `merged-branch`: BOUNDARY control — fully merged into main, zero unmerged commits.
  git(repoRoot, "branch", "merged-branch");
  git(repoRoot, "checkout", "-q", "merged-branch");
  commitFile(repoRoot, "merged-work.txt", "already-integrated work");
  git(repoRoot, "checkout", "-q", "main");
  git(repoRoot, "merge", "-q", "--no-ff", "merged-branch", "-m", "merge merged-branch");

  // `unowned-branch`: a REAL linked worktree, claimed by no session at all.
  const wtParent = mkdtempReal("lore-replay-fixture-unowned-parent-");
  const unownedWorktreePath = join(wtParent, "unowned-wt");
  git(repoRoot, "worktree", "add", "-q", "-b", "unowned-branch", unownedWorktreePath);

  cleanupDirs.push(repoRoot, wtParent);
  return { repoRoot, unownedWorktreePath };
}

function makeDetachedRepo(): { repoRoot: string } {
  const repoRoot = mkdtempReal("lore-replay-detached-");
  git(repoRoot, "init", "-q", "-b", "main");
  git(repoRoot, "config", "user.email", "ac-replay-1@example.com");
  git(repoRoot, "config", "user.name", "AC-REPLAY-1 Test");
  commitFile(repoRoot, "seed.txt", "seed");
  const sha = git(repoRoot, "rev-parse", "HEAD");
  git(repoRoot, "checkout", "-q", sha);
  cleanupDirs.push(repoRoot);
  return { repoRoot };
}

// ─── Service fixtures ───────────────────────────────────────────────────────

/** In-memory heartbeat store — substitutes for the real `os.tmpdir()` sidecar (isolation, no cross-test-run pollution); everything else in `SessionService` is the REAL production implementation. */
function makeHeartbeatFakes(): {
  write: (sessionId: string, record: SessionHeartbeatRecord) => Promise<void>;
  read: (sessionId: string) => Promise<SessionHeartbeatRecord | undefined>;
  map: Map<string, SessionHeartbeatRecord>;
} {
  const map = new Map<string, SessionHeartbeatRecord>();
  return {
    map,
    write: async (sessionId, record) => {
      map.set(sessionId, record);
    },
    read: async (sessionId) => map.get(sessionId),
  };
}

function makeCorpusAndSession() {
  const store = actedStore(new InMemoryStore());
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const heartbeats = makeHeartbeatFakes();
  const sessionService = new SessionService(
    store,
    { claimTtlMinutes: 120, handoffTtlMinutes: 10080, createHandoffDoc: corpusService.createHandoffDoc.bind(corpusService) },
    // reason: default (REAL) probeProcessStartTimePort — `deriveSessionLiveness`
    // below probes `process.pid` for REAL, a genuinely-alive process (this test
    // runner itself), so the "alive" verdict in the HAPPY case is not faked at
    // all, only the heartbeat SIDECAR STORAGE tier is substituted (above).
    undefined,
    heartbeats.write,
    heartbeats.read,
  );
  return { store, corpusService, sessionService, heartbeats };
}

/** One "session": its own `TaskWorkflowService`, bound to its own injected `processEnv` — mirrors `claim-session-capture-app-wiring.bun.test.ts`'s "a fresh construction IS how two concurrently-live orchestrator processes differ" precedent. */
function makeTaskWorkflowService(store: InMemoryStore, sessionIdEnvValue: string | undefined): TaskWorkflowService {
  const processEnv: Record<string, string | undefined> =
    sessionIdEnvValue !== undefined ? { CLAUDE_CODE_SESSION_ID: sessionIdEnvValue } : {};
  return new TaskWorkflowService(
    store,
    undefined,
    { claimTtlMinutes: 120 },
    undefined,
    undefined,
    undefined,
    processEnv,
  );
}

async function mustCreate(cs: CorpusService, input: CreateDocInput): Promise<DocRecord> {
  const result = await cs.create(input);
  if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

async function createPlanAndTask(cs: CorpusService, title: string): Promise<{ planId: string; taskId: string }> {
  const plan = await mustCreate(cs, { type: "plan", title: `Plan for ${title}`, content: "# Plan" } as CreateDocInput);
  const task = await mustCreate(cs, {
    type: "task",
    title,
    parent_id: plan.id,
    content: `# ${title}`,
    extra: { plan_id: plan.id },
  } as CreateDocInput);
  return { planId: plan.id, taskId: task.id };
}

// ─── HAPPY: the AC's own fixture — exactly 2 sessions, exactly 3 branches ────

describe("AC-REPLAY-1: replaying the 2026-08-11 diagnosis through lore invocations alone", () => {
  it("HAPPY: territory + session liveness reconstruct ALL 4 of the AC's facts exactly, non-empty — the 4th (a per-branch commit COUNT) via TerritoryEntry.unmerged_commits (territory-partition.ts), asserted against ground truth by this test's own `expect(commitCountByBranch)` call below", async () => {
    const { repoRoot, unownedWorktreePath } = makeTerritoryFixtureRepo();
    const { store, corpusService, sessionService } = makeCorpusAndSession();

    const MINE_SESSION_ID = "3de02220";
    const FOREIGN_SESSION_ID = "7ab19c04";

    // ── seed EXACTLY 2 sessions ──
    const mineWorkflow = makeTaskWorkflowService(store, `${MINE_SESSION_ID}-mine-orchestrator`);
    const { taskId: mineTaskId } = await createPlanAndTask(corpusService, "Mine task");
    const mineClaim = await mineWorkflow.claim(mineTaskId, { by: "agent:mine", harnessRun: runOfName("agent:mine"), worktree: repoRoot });
    expect(mineClaim.ok).toBe(true);

    const foreignWorkflow = makeTaskWorkflowService(store, `${FOREIGN_SESSION_ID}-foreign-orchestrator`);
    const { taskId: foreignTaskId } = await createPlanAndTask(corpusService, "Foreign task");
    // reason: no live worktree for the foreign session's branch — the EXACT
    // 2026-08-11 shape ("a live peer's in-flight branch", worktree already
    // gone) — `branch` is explicit since there is no worktree to auto-detect it from.
    const foreignClaim = await foreignWorkflow.claim(foreignTaskId, { by: "agent:foreign", harnessRun: runOfName("agent:foreign"), branch: "foreign-branch" });
    expect(foreignClaim.ok).toBe(true);

    // ── REPLAY step 1: `lore territory --json`'s own two data sources ──
    const gitPort = new RealGitPort(repoRoot);
    const worktreeListResult = await gitPort.worktreeList();
    expect(worktreeListResult.ok).toBe(true);
    if (!worktreeListResult.ok) return;

    const activeSessionsResult = await sessionService.getActiveSessions();
    expect(activeSessionsResult.ok).toBe(true);
    if (!activeSessionsResult.ok) return;
    // fixture precondition: exactly 2 sessions.
    expect(activeSessionsResult.value).toHaveLength(2);

    // ── REPLAY step 2: the EXACT pure fn behind `lore territory --json` ──
    const partition = partitionTerritory(
      worktreeListResult.value.map((w) => ({ path: w.path, branch: w.branch })),
      activeSessionsResult.value,
      MINE_SESSION_ID, // resolveClaimSessionId's sanitized discriminator for the mine env value
    );

    // fixture precondition: exactly 3 branches (mine / foreign / unowned).
    expect(partition.mine.find((e) => e.path === repoRoot)).toBeDefined();
    expect(partition.unowned.find((e) => e.path === unownedWorktreePath)).toBeDefined();

    // FACT 1 — foreign branch set. MUST be non-empty and EXACT.
    const foreignBranches = partition.foreign.filter((e): e is TerritoryEntry & { branch: string } => e.branch !== undefined);
    expect(foreignBranches.length).toBeGreaterThan(0);
    expect(new Set(foreignBranches.map((e) => e.branch))).toEqual(new Set(["foreign-branch"]));

    // FACT 3 — holder session_id per branch. MUST be non-empty and EXACT.
    const holderByBranch: Record<string, string | undefined> = {};
    for (const entry of foreignBranches) holderByBranch[entry.branch] = entry.holder?.session_id;
    expect(holderByBranch).toEqual({ "foreign-branch": FOREIGN_SESSION_ID });

    // ── REPLAY step 3: `lore session list`'s self-registration + liveness join ──
    const machine = "replay-test-machine";
    // reason: self-registration mirrors `commands/session.ts` EXACTLY — record
    // THIS process's OWN pid before querying. Real pid, real probe: nothing here is faked.
    await sessionService.recordOwnHeartbeat(MINE_SESSION_ID, process.pid, machine);
    // The foreign session never runs `lore session list|show` on THIS machine —
    // exactly the "a session that never does is honestly reported unmeasured,
    // never fabricated" case the service's own JSDoc documents.
    const livenessRecords = await sessionService.deriveSessionLiveness(activeSessionsResult.value, machine);

    // FACT 4 — liveness verdict per session. MUST be non-empty and EXACT.
    expect(livenessRecords.length).toBe(2);
    const livenessBySessionId: Record<string, string> = {};
    for (const record of livenessRecords) {
      if (record.session_id !== undefined) livenessBySessionId[record.session_id] = record.liveness;
    }
    expect(livenessBySessionId).toEqual({
      [MINE_SESSION_ID]: "alive",
      [FOREIGN_SESSION_ID]: "unmeasured",
    });

    // ── FACT 2 — unmerged commit count per branch. Reachable through lore's
    // OWN territory partition since `countUnmergedCommits`/
    // `countUnmergedCommitsSync` landed (`real-git-port.ts:283`, wired into
    // `partitionTerritory` at `territory-partition.ts:242`/`:266`):
    // `partition.foreign` entries now carry `TerritoryEntry.unmerged_commits`
    // (`territory-partition.ts:105`) directly — no git shell-out needed in
    // THIS step. The `isMerged` boolean check below is a SEPARATE,
    // corroborating signal (the BOUNDARY dimension further down this file
    // exercises it directly) — no longer the only route to this fact. ──

    // Corroborating signal, via the SAME production adapter class
    // `SeatService` calls (`RealGitPort.isMerged`) — never an ad hoc `git log
    // main..<branch>` — confirms "foreign-branch has unmerged work" (yes),
    // independent of the exact count read below:
    const isMergedResult = await gitPort.isMerged("foreign-branch", "main");
    expect(isMergedResult.ok).toBe(true);
    if (isMergedResult.ok) expect(isMergedResult.value).toBe(false); // corroborates: foreign-branch has >=1 unmerged commit.

    // Reconstruct the per-branch commit-COUNT map using ONLY the lore-surfaced
    // fact already gathered above: `partition.foreign`'s own
    // `TerritoryEntry.unmerged_commits` field (`territory-partition.ts:105`,
    // populated by `measureUnmergedCommits` at `:242`/`:266`) — no new git
    // invocation in THIS step.
    const commitCountByBranch: Record<string, number> = {};
    for (const entry of partition.foreign) {
      if (entry.unmerged_commits !== undefined) {
        commitCountByBranch[entry.branch ?? "?"] = entry.unmerged_commits;
      }
    }

    // Ground truth (FIXTURE VERIFICATION, never part of the replay above — see
    // module header): the foreign branch has EXACTLY 1 commit main does not.
    const groundTruthUnmergedCount = Number(git(repoRoot, "rev-list", "--count", "main..foreign-branch"));
    expect(groundTruthUnmergedCount).toBe(1); // fixture sanity check only.

    // FACT 2, asserted exactly against ground truth, THIS line: fed
    // EXCLUSIVELY by `TerritoryEntry.unmerged_commits` above — a lore-shipped
    // surface, never a git shell-out — and it matches, non-empty. Combined
    // with facts 1/3 (asserted above) and fact 4 (asserted below), all FOUR
    // facts the AC names are now reconstructed through lore alone in this one
    // test — see this file's module header for the mechanism (`real-git-
    // port.ts::countUnmergedCommitsSync` wired into `territory-partition.ts`)
    // that closed what used to be a genuine gap here.
    expect(commitCountByBranch).toEqual({ "foreign-branch": groundTruthUnmergedCount });
  });
});

// ─── NEGATIVE: dead vs alive liveness (GAP-D — the exact defect this closes) ──

describe("AC-REPLAY-1 dimension: NEGATIVE — a dead session's holder is distinguished from an alive one", () => {
  it("a session whose recorded pid no longer resolves is 'dead'; a session whose recorded pid genuinely IS running is 'alive'", async () => {
    const { store, corpusService } = makeCorpusAndSession();
    const heartbeats = makeHeartbeatFakes();

    const ALIVE_SESSION_ID = "a11ve000";
    const DEAD_SESSION_ID = "dead0000";
    const machine = "negative-test-machine";

    // reason: the ALIVE probe returns a FIXED, real-looking start time for
    // `process.pid` on EVERY call — consistent between the recording call
    // (inside recordOwnHeartbeat) and the later verifying call (inside
    // deriveSessionLiveness), exactly as a real re-probe of a still-running
    // pid would report the identical, unchanging `lstart`. `999_999` (the
    // "dead" pid) always probes to `null` — "no such process" — on EVERY
    // call, including the recording call, which is why the dead session's
    // heartbeat is written directly below rather than through
    // `recordOwnHeartbeat` (a genuinely-dead pid could not have called that
    // method on itself just now; its heartbeat is a fact recorded IN THE
    // PAST, while it was still alive, by a DIFFERENT probe outcome for that
    // pid at that time).
    const ALIVE_STARTED_AT = "2026-01-01T00:00:00.000Z";
    const sessionService = new SessionService(
      store,
      { claimTtlMinutes: 120, handoffTtlMinutes: 10080, createHandoffDoc: corpusService.createHandoffDoc.bind(corpusService) },
      async (pid) => (pid === process.pid ? ALIVE_STARTED_AT : null),
      heartbeats.write,
      heartbeats.read,
    );

    const aliveWorkflow = makeTaskWorkflowService(store, `${ALIVE_SESSION_ID}-x`);
    const { taskId: aliveTaskId } = await createPlanAndTask(corpusService, "Alive holder task");
    await aliveWorkflow.claim(aliveTaskId, { by: "agent:alive-holder", harnessRun: runOfName("agent:alive-holder"), machine });

    const deadWorkflow = makeTaskWorkflowService(store, `${DEAD_SESSION_ID}-x`);
    const { taskId: deadTaskId } = await createPlanAndTask(corpusService, "Dead holder task");
    await deadWorkflow.claim(deadTaskId, { by: "agent:dead-holder", harnessRun: runOfName("agent:dead-holder"), machine });

    await sessionService.recordOwnHeartbeat(ALIVE_SESSION_ID, process.pid, machine);
    // Dead session's heartbeat is a fact from when its pid WAS alive — recorded
    // directly (never through today's probe, which now reports that pid gone).
    await heartbeats.write(DEAD_SESSION_ID, { pid: 999_999, started_at: "2025-01-01T00:00:00.000Z", machine });

    const sessionsResult = await sessionService.getActiveSessions();
    expect(sessionsResult.ok).toBe(true);
    if (!sessionsResult.ok) return;

    const liveness = await sessionService.deriveSessionLiveness(sessionsResult.value, machine);
    const bySessionId: Record<string, string> = {};
    for (const record of liveness) if (record.session_id !== undefined) bySessionId[record.session_id] = record.liveness;

    expect(bySessionId).toEqual({
      [ALIVE_SESSION_ID]: "alive",
      [DEAD_SESSION_ID]: "dead",
    });
  });
});

// ─── BOUNDARY: isMerged distinguishes zero vs nonzero unmerged commits ──────

describe("AC-REPLAY-1 dimension: BOUNDARY — the boolean isMerged signal DOES distinguish zero from nonzero unmerged commits (a coarser, corroborating check beside the exact TerritoryEntry.unmerged_commits count FACT 2 now reads)", () => {
  it("a fully-merged branch reports isMerged=true (zero unmerged); the foreign branch reports isMerged=false (>=1 unmerged)", async () => {
    const { repoRoot } = makeTerritoryFixtureRepo();
    const gitPort = new RealGitPort(repoRoot);

    const mergedResult = await gitPort.isMerged("merged-branch", "main");
    expect(mergedResult.ok).toBe(true);
    if (mergedResult.ok) expect(mergedResult.value).toBe(true); // zero unmerged commits

    const foreignResult = await gitPort.isMerged("foreign-branch", "main");
    expect(foreignResult.ok).toBe(true);
    if (foreignResult.ok) expect(foreignResult.value).toBe(false); // >= 1 unmerged commit
  });
});

// ─── ERROR: an unmeasurable branch is never invented, never "unowned" ───────

describe("AC-REPLAY-1 dimension: ERROR — a claim with no measurable branch stays absent, and its worktree is never misclassified unowned", () => {
  it("a detached-HEAD worktree's claim records branches: [] and the worktree entry is still 'mine' (claimed), not 'unowned'", async () => {
    const { repoRoot } = makeDetachedRepo();
    const { store, corpusService, sessionService } = makeCorpusAndSession();
    const SESSION_ID = "de7ac4ed";

    const workflow = makeTaskWorkflowService(store, `${SESSION_ID}-x`);
    const { taskId } = await createPlanAndTask(corpusService, "Detached-HEAD task");
    const claimed = await workflow.claim(taskId, { by: "agent:detached", harnessRun: runOfName("agent:detached"), worktree: repoRoot });
    expect(claimed.ok).toBe(true);

    const sessionsResult = await sessionService.getActiveSessions();
    expect(sessionsResult.ok).toBe(true);
    if (!sessionsResult.ok) return;
    const session = sessionsResult.value.find((s) => s.worktree === repoRoot);
    expect(session).toBeDefined();
    expect(session?.branches).toEqual([]); // unmeasured branch -> absent, never a placeholder

    const gitPort = new RealGitPort(repoRoot);
    const worktreeListResult = await gitPort.worktreeList();
    expect(worktreeListResult.ok).toBe(true);
    if (!worktreeListResult.ok) return;

    const partition = partitionTerritory(
      worktreeListResult.value.map((w) => ({ path: w.path, branch: w.branch })),
      sessionsResult.value,
      SESSION_ID,
    );
    // The worktree HAS a claimant (this session) — it must be "mine", never "unowned",
    // even though that claimant's branch could not be measured.
    expect(partition.mine.find((e) => e.path === repoRoot)).toBeDefined();
    expect(partition.unowned.find((e) => e.path === repoRoot)).toBeUndefined();
  });
});

// ─── STATE: releasing a claim removes it from both surfaces ─────────────────

describe("AC-REPLAY-1 dimension: STATE — releasing the foreign claim removes it from active_sessions and the territory partition", () => {
  it("before release: the foreign branch is present and foreign; after release: gone from both", async () => {
    const { repoRoot } = makeTerritoryFixtureRepo();
    const { store, corpusService, sessionService } = makeCorpusAndSession();
    const FOREIGN_SESSION_ID = "5ea5ed00";

    const foreignWorkflow = makeTaskWorkflowService(store, `${FOREIGN_SESSION_ID}-x`);
    const { taskId } = await createPlanAndTask(corpusService, "Releasable foreign task");
    await foreignWorkflow.claim(taskId, { by: "agent:foreign-to-release", harnessRun: runOfName("agent:foreign-to-release"), branch: "foreign-branch" });

    const gitPort = new RealGitPort(repoRoot);
    const worktreeListResult = await gitPort.worktreeList();
    expect(worktreeListResult.ok).toBe(true);
    if (!worktreeListResult.ok) return;

    // reason: `compareClaimSessions` treats an `undefined` currentSessionId as
    // "not-measured" for EVERY comparison (never "different-session"), which
    // would classify every entry `unmeasured`, not `foreign` — a caller whose
    // OWN session id is unmeasurable is, correctly, never told anyone else is
    // "foreign" to it (mirrors the anchor-overlap mutex's identical rule). A
    // real replaying session always resolves a concrete (if unrelated) id.
    const OBSERVER_SESSION_ID = "0b5e2be9";

    const beforeSessions = await sessionService.getActiveSessions();
    expect(beforeSessions.ok).toBe(true);
    if (!beforeSessions.ok) return;
    expect(beforeSessions.value).toHaveLength(1);
    const beforePartition = partitionTerritory(
      worktreeListResult.value.map((w) => ({ path: w.path, branch: w.branch })),
      beforeSessions.value,
      OBSERVER_SESSION_ID,
    );
    expect(beforePartition.foreign.some((e) => e.branch === "foreign-branch")).toBe(true);

    const released = await foreignWorkflow.release(taskId, { by: "agent:foreign-to-release", harnessRun: runOfName("agent:foreign-to-release") });
    expect(released.ok).toBe(true);

    const afterSessions = await sessionService.getActiveSessions();
    expect(afterSessions.ok).toBe(true);
    if (!afterSessions.ok) return;
    expect(afterSessions.value).toHaveLength(0);
    const afterPartition = partitionTerritory(
      worktreeListResult.value.map((w) => ({ path: w.path, branch: w.branch })),
      afterSessions.value,
      OBSERVER_SESSION_ID,
    );
    expect(afterPartition.foreign.some((e) => e.branch === "foreign-branch")).toBe(false);
  });
});

// ─── REGRESSION: cross-machine liveness stays advisory, never a false "dead" ─

describe("AC-REPLAY-1 dimension: REGRESSION — a session on another machine is 'unmeasured', never 'dead' (probing is same-machine only)", () => {
  it("a session recorded on a different machine short-circuits to unmeasured WITHOUT ever consulting the probe", async () => {
    const { store, corpusService } = makeCorpusAndSession();
    const heartbeats = makeHeartbeatFakes();
    const SESSION_ID = "07he1305";
    let probeCalled = false;

    const sessionService = new SessionService(
      store,
      { claimTtlMinutes: 120, handoffTtlMinutes: 10080, createHandoffDoc: corpusService.createHandoffDoc.bind(corpusService) },
      async () => {
        probeCalled = true;
        return null; // if consulted, this WOULD read as "dead" — proving it must never be consulted here.
      },
      heartbeats.write,
      heartbeats.read,
    );

    const workflow = makeTaskWorkflowService(store, `${SESSION_ID}-x`);
    const { taskId } = await createPlanAndTask(corpusService, "Cross-machine task");
    await workflow.claim(taskId, { by: "agent:remote-machine", harnessRun: runOfName("agent:remote-machine"), machine: "other-machine" });
    // Heartbeat recorded from THIS (the "other") machine's own perspective —
    // `recordOwnHeartbeat` legitimately calls the probe too (self-verification
    // at record time), so the flag is reset below to scope the assertion to
    // deriveSessionLiveness's OWN cross-machine short-circuit specifically.
    await sessionService.recordOwnHeartbeat(SESSION_ID, 4242, "other-machine");
    probeCalled = false;

    const sessionsResult = await sessionService.getActiveSessions();
    expect(sessionsResult.ok).toBe(true);
    if (!sessionsResult.ok) return;

    const liveness = await sessionService.deriveSessionLiveness(sessionsResult.value, "this-machine");
    expect(liveness).toHaveLength(1);
    expect(liveness[0]?.liveness).toBe("unmeasured");
    expect(liveness[0]?.liveness).not.toBe("dead");
    expect(probeCalled).toBe(false);
  });
});
