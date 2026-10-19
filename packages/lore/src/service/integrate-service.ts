/**
 * IntegrateService — `lore integrate <branch>`: the one path by which a branch lands on main.
 *
 * Purpose: merge a branch onto the CURRENT main inside the session's own detached integration worktree, run the
 * project's post-merge floor on the merged tree, then advance `refs/heads/main` with a compare-and-swap
 * (`git update-ref refs/heads/main <new> <base>`). Git's own ref lock + old-value check refuses a lost race, so no
 * exclusivity is needed (adr-main-advances-only-by-lore-integrate-per-session, Option A; experiments E4, E8).
 * Landing record: after the CAS moved main, `deps.landings.record` writes `extra.landing` ({branch, branch_head,
 *   main_before, main_after, landing_commit}) on every task whose claim recorded the branch, so a task's commit range
 *   is a fact of its landing and a later re-claim cannot replace it (task-commit-range.ts). Never fails the landing.
 * Public surface: IntegrateService.integrate, LandingRecorder, IntegrateOutcome, integrateExitCode, IntegrateRequest,
 *   IntegrateDeps, IntegrateGit, FloorRunner, CorpusSnapshotter, INTEGRATE_MAX_ATTEMPTS, INTEGRATE_EXIT_LOST_RACES, INTEGRATE_MARKER_ENV,
 *   integrationWorktreePath.
 * Invariants:
 *   - Main moves ONLY by the CAS of an attempt whose merge passed the floor; every other outcome leaves main
 *     untouched and the integration worktree reset to the main it saw (nothing half-done: a conflict aborts the merge
 *     and resets, a failing floor resets, a lost race resets).
 *   - At most INTEGRATE_MAX_ATTEMPTS (3) attempts per call; each lost CAS proves another integration landed, so the
 *     system progresses (lock-free). The third loss is outcome `lost_races` (exit 75), recorded in the loss ledger.
 *   - Re-running after a crash past the CAS is a no-op: `merge-base --is-ancestor <tip> main` is checked at the start
 *     of every attempt (`already_integrated`), and clears the branch's stale loss entry.
 *   - The floor command is project config with NO default: absent -> err(VALIDATION_ERROR) before anything is touched.
 *   - The CAS runs with `LORE_INTEGRATE=1` in its environment: the marker a reference-transaction hook (INT-T2)
 *     uses to tell this verb's update of main from any other.
 *   - The integration worktree holds nothing that is not in refs (it is detached, reset on every attempt), so a
 *     crash before the CAS leaves no state that matters; the next call resets it.
 *   - Conflicts are NEVER resolved here: outcome `conflict` names the paths (exit 4); the session resolves in its own
 *     worktree and re-runs.
 *   - One run at a time per integration worktree: after the worktree exists and before any merge or snapshot the run
 *     takes the worktree's lease (IntegrationLease: an OS lock tied to the process, so a killed run frees it with no
 *     cleanup). A second run of the same session gets outcome `busy` (exit 75) naming the holder's pid, branch and start.
 * Side-effect class: IO (git subprocesses through the injected IntegrateGit, the floor through FloorRunner, the loss
 *   ledger's files, creation of one worktree directory, the lease).
 *
 * Before anything moves (after the request is validated, before the integration worktree exists):
 *   - a remote-tracking argument (`origin/main`: its first segment names a configured remote) is fetched first and is
 *     merged with fast-forward allowed, so inbound commits land as the remote's own commits when main has not diverged;
 *   - ANY worktree other than the shared checkout that has `refs/heads/main` checked out is refused (E3: a ref moving
 *     under a checked-out branch stages the inverse diff in that tree);
 *   - a shared checkout still on branch main is detached at main (`git checkout --detach main`: same commit, so edits
 *     and untracked files stay byte-identical); one that cannot be (merge/rebase/cherry-pick/revert in progress) is
 *     refused naming it. Both refusals are `err(VALIDATION_ERROR, field "worktree")`, exit 4.
 * The reference-transaction hook that refuses every other move of main ships as assets/project/reference-transaction
 * and is installed by `lore setup --project`; it recognises INTEGRATE_MARKER_ENV on the CAS.
 *
 * The floor's corpus (INT-T12): just before the floor runs, `deps.corpus.take` writes a consistent snapshot (VACUUM INTO)
 * of the shared corpus into `<integration worktree>/.lore/`, so a branch whose binary needs a newer schema migrates the
 * snapshot instead of tripping the foreign-schema guard on the live corpus; `remove` deletes it right after the floor.
 * One line `integrate: floor runs against a corpus snapshot taken <iso ts>` is logged per attempt.
 *
 * After the shared view is `refreshed` (INT-T11), `workflow.integrate.post_refresh_command` (this repo: `bun run
 * build`) runs in the shared checkout so its build artifacts (dist/lore, which ~/.local/bin/lore links to) match main.
 * Decision, (a) project config command in the view vs (b) install the floor's artifact from the integration worktree:
 * (a) chosen. The floor here is `check:floor` (checks, not a build) so (b) would still need a second build, and it would
 * need a per-project "which artifacts, copied where" key plus knowledge of the build's layout; (a) is one command the
 * project already owns, builds exactly once per landing (the floor does not build the shipped binary), and a build
 * writes only untracked/ignored output. Tracked changes left by the build are measured (`git status --untracked-files=no`)
 * and reported, never reverted. Outcome `rebuild`: rebuilt | rebuild_failed <exit> | skipped <reason> (key unset, or the
 * view was not `refreshed`); a failed rebuild is reported only: main has already moved and is never un-landed.
 *
 * Source: spec-main-advances-only-through-lore-integrate-per-session AC-INT-1, AC-INT-2, BR-1245, BR-1246.
 */
import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { err, ok, type LoreError, type Result } from "@lore/core";
import type { IntegrateLossLedger } from "./integrate-loss-ledger.js";
import type { AttemptRecord, IntegrateAttemptLedger } from "./integrate-attempt-ledger.js";
import type { LandingFact } from "./task-commit-range.js";

/** Attempts (merge + floor + CAS) one call makes before it gives up with exit 75. */
export const INTEGRATE_MAX_ATTEMPTS = 3;

/** Exit code of `lost_races`: EX_TEMPFAIL — the call is safe to re-run. */
export const INTEGRATE_EXIT_LOST_RACES = 75;

/** The environment marker present on the CAS (and only on it); the main-ref hook of INT-T2 keys on it. */
export const INTEGRATE_MARKER_ENV = "LORE_INTEGRATE";

/** The branch integrations land on. */
const TARGET_REF = "refs/heads/main";
const TARGET_NAME = "main";

/** How much of a failing floor's output the outcome carries: sized so the failed steps' re-printed blocks (run-chain prints them last, up to 2500 chars each) always fit. */
export const FLOOR_TAIL_CHARS = 12000;

/** Raw outcome of one git call; never thrown. */
export interface GitOutcome {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs `git <args>` in `cwd` (with `env` merged over the process environment); never throws. */
export type IntegrateGit = (cwd: string, args: readonly string[], env?: Readonly<Record<string, string>>) => GitOutcome;

/** One floor step's wall time, from the run-chain machine-readable timings (never parsed from prose). */
export interface FloorStepTiming {
  readonly step: string;
  readonly exit: number;
  readonly ms: number;
}

/** Name of the single step a floor is recorded as when its command emitted no per-step timings (a custom floor_command). */
export const FLOOR_UNTIMED_STEP = "floor (no per-step timings emitted)";

/**
 * Runs the floor shell command in `cwd`; `output` is stdout+stderr merged. Never throws. `steps` are the per-step
 * timings the floor command emitted (scripts/run-chain.ts via LORE_FLOOR_TIMINGS_FILE); absent = the command emitted none.
 */
export type FloorRunner = (command: string, cwd: string) => { readonly status: number; readonly output: string; readonly steps?: readonly FloorStepTiming[] };

/**
 * Gives the integration worktree a private copy of the shared corpus for the floor (INT-T12) and takes it away again.
 * `take` returns the ISO instant of the snapshot; `remove` deletes it. Neither ever writes the shared corpus.
 */
export interface CorpusSnapshotter {
  readonly take: (integrationWorktree: string) => Result<{ readonly takenAt: string }, LoreError>;
  readonly remove: (integrationWorktree: string) => Result<void, LoreError>;
}

/** Who holds an integration worktree's lease: written by the holder once it owns the lock, read by a refused second run. */
export interface LeaseHolder {
  readonly pid: number;
  readonly branch: string;
  /** ISO-8601 instant the holder started. */
  readonly started_at: string;
}

/** `held` = this run owns the lease until `release()`; `busy` = another live run does (`holder` names it; `undefined` = it had not recorded itself yet). */
export type LeaseGrant =
  | { readonly kind: "held"; readonly release: () => void }
  | { readonly kind: "busy"; readonly holder: LeaseHolder | undefined };

/**
 * The exclusive lease one integration worktree has while a run uses it. The implementation MUST be an OS-level lock
 * tied to the process (released by the kernel when the process dies, however it dies): a crashed run needs no cleanup.
 * `lockDir` is a directory belonging to that worktree; `acquire` never blocks.
 */
export interface IntegrationLease {
  readonly acquire: (lockDir: string, holder: LeaseHolder) => Result<LeaseGrant, LoreError>;
}

/**
 * Records a landing on every task whose claim (current or historical) recorded the landed branch. Resolves to the slugs
 * written. Wired by the CLI to `TaskWorkflowService.recordLanding` (the corpus write route); a failure never un-lands main.
 */
export interface LandingRecorder {
  readonly record: (landing: LandingFact) => Promise<Result<readonly string[], LoreError>>;
}

export interface IntegrateDeps {
  readonly git: IntegrateGit;
  /** One run at a time per integration worktree: a second run for the same session is refused (outcome `busy`, exit 75). */
  readonly lease: IntegrationLease;
  /** The running process's pid, recorded as the lease holder (default `process.pid`). */
  readonly pid?: number;
  /** Landing records (`extra.landing` on the branch's tasks). Absent in a bare construction: nothing is recorded. */
  readonly landings?: LandingRecorder;
  /** Floor corpus: the floor reads a snapshot of the shared corpus inside the integration worktree, never the live one. */
  readonly corpus: CorpusSnapshotter;
  readonly runFloor: FloorRunner;
  readonly ledger: IntegrateLossLedger;
  /** Per-attempt phase durations, kept per branch and NOT cleared on landing (see integrate-attempt-ledger.ts). */
  readonly attempts: IntegrateAttemptLedger;
  /** Wall clock in epoch milliseconds (default `Date.now`); injected so tests assert exact durations. */
  readonly clock?: () => number;
  /** The main checkout's root: the repo whose refs main lives in (git commands run here). */
  readonly projectRoot: string;
  /** Directory under which integration worktrees are created (`<main checkout>/.claude/worktrees`). */
  readonly worktreesRoot: string;
  /** Progress lines (attempts, lost races); the CLI wires stdout. */
  readonly log: (line: string) => void;
}

export interface IntegrateRequest {
  /** The branch (or any rev) to integrate, as typed. */
  readonly branch: string;
  /** The caller's session id: names the integration worktree. */
  readonly sessionId: string;
  /** `workflow.integrate.floor_command`; `undefined` = not configured. */
  readonly floorCommand: string | undefined;
  /** `workflow.integrate.post_refresh_command`; `undefined` = not configured (the rebuild is reported skipped). */
  readonly postRefreshCommand?: string | undefined;
  /** Merge commit message; default `merge(<branch>): <tip subject>`. */
  readonly message?: string;
}

/**
 * What happened to the shared checkout's read-only view of main after main moved (INT-T6): `refreshed` = it now sits at
 * main; `kept_dirty` = git refused because an uncommitted edit of `paths` would be overwritten, nothing was touched;
 * `not_measured` = the view was not eligible or git failed for another reason (`reason` says which), nothing was touched.
 */
export type SharedViewRefresh =
  | { readonly state: "refreshed" }
  | { readonly state: "kept_dirty"; readonly paths: readonly string[] }
  | { readonly state: "not_measured"; readonly reason: string };

/**
 * What happened to the shared checkout's build artifacts (INT-T11): `rebuilt` (with `tracked_changes` when the build
 * left tracked files modified), `rebuild_failed` (the command's exit status; main stays landed), or `skipped` (`reason`).
 */
export type SharedViewRebuild =
  | { readonly state: "rebuilt"; readonly tracked_changes?: readonly string[] }
  | { readonly state: "rebuild_failed"; readonly exit_status: number; readonly output_tail: string }
  | { readonly state: "skipped"; readonly reason: string };

export type IntegrateOutcome =
  | { readonly kind: "landed"; readonly branch: string; readonly sha: string; readonly base: string; readonly attempts: number; readonly worktree: string; readonly shared_view: SharedViewRefresh; readonly rebuild: SharedViewRebuild }
  | { readonly kind: "already_integrated"; readonly branch: string; readonly main: string; readonly shared_view: SharedViewRefresh; readonly rebuild: SharedViewRebuild }
  | { readonly kind: "floor_failed"; readonly branch: string; readonly attempts: number; readonly exit_status: number; readonly output_tail: string }
  | { readonly kind: "conflict"; readonly branch: string; readonly paths: readonly string[] }
  | { readonly kind: "busy"; readonly branch: string; readonly worktree: string; readonly holder: LeaseHolder | undefined }
  | {
      readonly kind: "lost_races";
      readonly branch: string;
      readonly attempts: number;
      /** `<sha12> <subject>` of every integration that moved main during this call, in order. */
      readonly moved_by: readonly string[];
      /** The branch's consecutive losses across calls (what `lore status` lists). */
      readonly consecutive_losses: number;
    };

/** Process exit code of an outcome: 0 landed / already integrated, 1 floor failed, 4 conflict, 75 lost races. */
export function integrateExitCode(outcome: IntegrateOutcome): number {
  switch (outcome.kind) {
    case "landed":
    case "already_integrated":
      return 0;
    case "floor_failed":
      return 1;
    case "conflict":
      return 4;
    case "lost_races":
    case "busy":
      return INTEGRATE_EXIT_LOST_RACES;
    default: {
      const unreachable: never = outcome;
      return unreachable;
    }
  }
}

/**
 * Deterministic integration-worktree path of one session: `<worktreesRoot>/integrate-<session id>`, the id reduced to
 * `[A-Za-z0-9_-]` (full length kept, so two sessions never share a tree).
 */
export function integrationWorktreePath(worktreesRoot: string, sessionId: string): string {
  return join(worktreesRoot, `integrate-${sessionId.replace(/[^A-Za-z0-9_-]/g, "-")}`);
}

function gitFailure(what: string, outcome: GitOutcome): LoreError {
  return { code: "STORE_ERROR", message: `integrate: ${what} failed (git exit ${outcome.status}): ${(outcome.stderr || outcome.stdout).trim()}` };
}

function short(sha: string): string {
  return sha.slice(0, 12);
}

/** The phase line printed (and recorded) per attempt: `-` marks a phase the attempt never reached. */
export function renderAttemptPhases(record: AttemptRecord, max: number): string {
  const ms = (v: number | null): string => (v === null ? "-" : `${v}ms`);
  const floor =
    record.floor === null ? "-" : `${record.floor.total_ms}ms (${record.floor.steps.map((st) => `${st.step} ${st.ms}ms`).join(", ")})`;
  return (
    `integrate: attempt ${record.attempt}/${max} phases: merge ${record.merge_ms}ms | corpus-snapshot ${ms(record.corpus_snapshot_ms)} | ` +
    `floor ${floor} | cas ${ms(record.cas_ms)} | total ${record.total_ms}ms -> ${record.outcome}`
  );
}

export class IntegrateService {
  constructor(private readonly deps: IntegrateDeps) {}

  /**
   * Lands `request.branch` on main, or reports exactly why it did not. While another run of the same session is live
   * the outcome is `busy` (exit 75, naming the holder), decided before any merge or snapshot.
   *
   * @returns ok(outcome) for every defined outcome (landed, already integrated, floor failed, conflict, lost races —
   *   map with {@link integrateExitCode}); err for a refused request (missing floor key, unknown branch, empty session)
   *   or a git/filesystem failure.
   */
  async integrate(request: IntegrateRequest): Promise<Result<IntegrateOutcome, LoreError>> {
    const { git, projectRoot, ledger, log } = this.deps;
    const clock = this.deps.clock ?? Date.now;
    if (request.sessionId.trim() === "") {
      return err({ code: "VALIDATION_ERROR", field: "session", message: "lore integrate needs the caller's session id: pass --session <id> or set CLAUDE_CODE_SESSION_ID" });
    }
    if (request.floorCommand === undefined || request.floorCommand.trim() === "") {
      return err({
        code: "VALIDATION_ERROR",
        field: "workflow.integrate.floor_command",
        message:
          "workflow.integrate.floor_command is not set in .lore/config.yaml (or the file failed to parse): lore integrate will not advance main on a tree whose floor was never named",
      });
    }
    const fetched = this.fetchRemoteTracking(request.branch);
    if (!fetched.ok) return fetched;
    const tipResult = this.resolveCommit(request.branch);
    if (!tipResult.ok) return tipResult;
    const tip = tipResult.value;

    const prepared = this.prepareSharedCheckout();
    if (!prepared.ok) return prepared;

    const worktree = this.ensureWorktree(request.sessionId);
    if (!worktree.ok) return worktree;
    const wt = worktree.value;

    // one run at a time per integration worktree: a second run would re-take the corpus snapshot under the first floor
    const gitDir = git(wt, ["rev-parse", "--path-format=absolute", "--git-dir"]);
    if (gitDir.status !== 0) return err(gitFailure("locating the git dir of the integration worktree", gitDir));
    const granted = this.deps.lease.acquire(gitDir.stdout.trim(), { pid: this.deps.pid ?? process.pid, branch: request.branch, started_at: new Date(clock()).toISOString() });
    if (!granted.ok) return granted;
    if (granted.value.kind === "busy") return ok({ kind: "busy", branch: request.branch, worktree: wt, holder: granted.value.holder });
    try {
      return await this.landOn(request, request.floorCommand, tip, wt);
    } finally {
      granted.value.release();
    }
  }

  /** The attempt loop, run while this process holds the integration worktree's lease. */
  private async landOn(request: IntegrateRequest, floorCommand: string, tip: string, wt: string): Promise<Result<IntegrateOutcome, LoreError>> {
    const { git, projectRoot, ledger, log } = this.deps;
    const clock = this.deps.clock ?? Date.now;
    const remoteOfBranch = this.remoteOf(request.branch);
    if (!remoteOfBranch.ok) return remoteOfBranch;
    const fromRemote = remoteOfBranch.value !== undefined;
    const message = request.message ?? this.defaultMessage(request.branch, tip);
    const movedBy: string[] = [];
    let lastConsecutiveLosses = 0;

    for (let attempt = 1; attempt <= INTEGRATE_MAX_ATTEMPTS; attempt += 1) {
      const base = this.resolveCommit(TARGET_REF);
      if (!base.ok) return base;
      if (git(projectRoot, ["merge-base", "--is-ancestor", tip, base.value]).status === 0) {
        // reason: BR-1336 — an already-integrated branch still records a landing on every claimant that holds none for
        // this head (the recorder skips tasks that already carry one). Main did not move, so main_before == main_after
        // and the branch head itself is the landed commit: it is an ancestor of main.
        await this.recordLanding({ branch: request.branch, branch_head: tip, main_before: base.value, main_after: base.value, landing_commit: tip });
        const cleared = ledger.clear(request.branch);
        if (!cleared.ok) return cleared;
        const view = this.refreshSharedView();
        return ok({ kind: "already_integrated", branch: request.branch, main: base.value, shared_view: view, rebuild: this.rebuildSharedView(view, request.postRefreshCommand) });
      }
      log(`integrate: ${request.branch} attempt ${attempt}/${INTEGRATE_MAX_ATTEMPTS} on ${short(base.value)}`);
      const attemptStart = clock();
      const startedAt = new Date(attemptStart).toISOString();
      const finish = (phases: Pick<AttemptRecord, "outcome" | "merge_ms" | "corpus_snapshot_ms" | "floor" | "cas_ms">): void =>
        this.recordAttempt(request.branch, { attempt, base: base.value, started_at: startedAt, total_ms: clock() - attemptStart, ...phases });

      const reset = this.resetWorktree(wt, base.value);
      if (!reset.ok) return reset;
      // an upstream ref may fast-forward (the remote's commits land as they are); a local branch always gets its own merge commit
      const mergeStart = clock();
      const merged = git(wt, ["merge", fromRemote ? "--ff" : "--no-ff", "-m", message, tip], { GIT_MERGE_AUTOEDIT: "no" });
      const mergeMs = clock() - mergeStart;
      if (merged.status !== 0) {
        const conflicted = this.afterFailedMerge(request.branch, wt, base.value, merged);
        if (conflicted.ok) finish({ outcome: "conflict", merge_ms: mergeMs, corpus_snapshot_ms: null, floor: null, cas_ms: null });
        return conflicted;
      }

      const snapshotStart = clock();
      const snapshot = this.deps.corpus.take(wt);
      const snapshotMs = clock() - snapshotStart;
      if (!snapshot.ok) return snapshot;
      log(`integrate: floor runs against a corpus snapshot taken ${snapshot.value.takenAt}`);
      const floorStart = clock();
      const floor = this.deps.runFloor(floorCommand, wt);
      const floorTotalMs = clock() - floorStart;
      const floorTimings = {
        total_ms: floorTotalMs,
        steps: floor.steps !== undefined && floor.steps.length > 0 ? floor.steps.map((st) => ({ step: st.step, exit: st.exit, ms: st.ms })) : [{ step: FLOOR_UNTIMED_STEP, exit: floor.status, ms: floorTotalMs }],
      };
      // the snapshot is removed whatever the floor said: it is never written back and never outlives its run
      const dropped = this.deps.corpus.remove(wt);
      if (!dropped.ok) return dropped;
      if (floor.status !== 0) {
        const back = this.resetWorktree(wt, base.value);
        if (!back.ok) return back;
        finish({ outcome: "floor_failed", merge_ms: mergeMs, corpus_snapshot_ms: snapshotMs, floor: floorTimings, cas_ms: null });
        return ok({ kind: "floor_failed", branch: request.branch, attempts: attempt, exit_status: floor.status, output_tail: floor.output.slice(-FLOOR_TAIL_CHARS) });
      }

      const head = git(wt, ["rev-parse", "HEAD"]);
      if (head.status !== 0) return err(gitFailure("rev-parse HEAD in the integration worktree", head));
      const merge = head.stdout.trim();
      const casStart = clock();
      const swapped = git(projectRoot, ["update-ref", TARGET_REF, merge, base.value], { [INTEGRATE_MARKER_ENV]: "1" });
      const casMs = clock() - casStart;
      if (swapped.status === 0) {
        finish({ outcome: "landed", merge_ms: mergeMs, corpus_snapshot_ms: snapshotMs, floor: floorTimings, cas_ms: casMs });
        await this.recordLanding({ branch: request.branch, branch_head: tip, main_before: base.value, main_after: merge, landing_commit: merge });
        const cleared = ledger.clear(request.branch);
        if (!cleared.ok) return cleared;
        const view = this.refreshSharedView();
        return ok({ kind: "landed", branch: request.branch, sha: merge, base: base.value, attempts: attempt, worktree: wt, shared_view: view, rebuild: this.rebuildSharedView(view, request.postRefreshCommand) });
      }

      const now = this.resolveCommit(TARGET_REF);
      if (!now.ok) return now;
      if (now.value === base.value) return err(gitFailure(`advancing ${TARGET_NAME} (main did not move, so this is not a lost race)`, swapped));
      const moved = this.describeMoves(base.value, now.value);
      movedBy.push(...moved);
      finish({ outcome: "lost_race", merge_ms: mergeMs, corpus_snapshot_ms: snapshotMs, floor: floorTimings, cas_ms: casMs });
      const recorded = ledger.recordLoss(request.branch, tip, moved);
      if (!recorded.ok) return recorded;
      lastConsecutiveLosses = recorded.value.losses;
      log(`integrate: ${request.branch} lost race ${attempt}/${INTEGRATE_MAX_ATTEMPTS}: main moved by ${moved.join(", ")}`);
    }

    const final = this.resolveCommit(TARGET_REF);
    if (!final.ok) return final;
    const back = this.resetWorktree(wt, final.value);
    if (!back.ok) return back;
    return ok({ kind: "lost_races", branch: request.branch, attempts: INTEGRATE_MAX_ATTEMPTS, moved_by: movedBy, consecutive_losses: lastConsecutiveLosses });
  }

  /**
   * Records the landing on the branch's tasks. Never fails the integration (main has already moved): a task that
   * could not be written is logged loudly, so the missing record is visible; `lore done` refuses that task as
   * `not-landed` until `lore integrate` is run again on the branch (BR-1336).
   */
  private async recordLanding(landing: LandingFact): Promise<void> {
    const recorder = this.deps.landings;
    if (recorder === undefined) return;
    const written = await recorder.record(landing);
    if (!written.ok) {
      this.deps.log(`integrate: WARNING: the landing of ${landing.branch} was not recorded on its tasks: ${written.error.code}${"message" in written.error ? ` ${written.error.message}` : ""}`);
      return;
    }
    this.deps.log(`integrate: landing of ${landing.branch} recorded on ${written.value.length === 0 ? "no task (none claimed this branch)" : written.value.join(", ")}`);
  }

  /**
   * Persists one attempt's phase record and prints its phase line. Never fails the integration (main may already have
   * moved): a record that cannot be written is logged loudly, not swallowed.
   */
  private recordAttempt(branch: string, record: AttemptRecord): void {
    this.deps.log(renderAttemptPhases(record, INTEGRATE_MAX_ATTEMPTS));
    const written = this.deps.attempts.recordAttempt(branch, record);
    if (!written.ok) this.deps.log(`integrate: WARNING: attempt ${record.attempt} phase durations were not recorded: ${written.error.code}${"message" in written.error ? ` ${written.error.message}` : ""}`);
  }

  /**
   * The configured remote named by the first path segment of `rev` (`origin/main` -> `origin`), else `ok(undefined)`;
   * err when `git remote` cannot list remotes (a remote-tracking argument must never be guessed local).
   */
  private remoteOf(rev: string): Result<string | undefined, LoreError> {
    const slash = rev.indexOf("/");
    if (slash <= 0) return ok(undefined);
    const candidate = rev.slice(0, slash);
    const remotes = this.deps.git(this.deps.projectRoot, ["remote"]);
    if (remotes.status !== 0) return err(gitFailure("git remote", remotes));
    return ok(remotes.stdout.split("\n").map((r) => r.trim()).includes(candidate) ? candidate : undefined);
  }

  /** Fetches the remote of a remote-tracking argument so the rev resolves to the remote's current tip. */
  private fetchRemoteTracking(rev: string): Result<void, LoreError> {
    const found = this.remoteOf(rev);
    if (!found.ok) return found;
    const remote = found.value;
    if (remote === undefined) return ok(undefined);
    this.deps.log(`integrate: fetching ${remote}`);
    const out = this.deps.git(this.deps.projectRoot, ["fetch", "-q", remote]);
    return out.status === 0 ? ok(undefined) : err(gitFailure(`git fetch ${remote}`, out));
  }

  /**
   * Refuses a repository where a ref move would stage a reverse diff in a checked-out tree, and detaches the shared
   * checkout when it is still on branch main (E3, E5; the ADR's Installation and migration).
   */
  private prepareSharedCheckout(): Result<void, LoreError> {
    const { git, projectRoot } = this.deps;
    const listed = git(projectRoot, ["worktree", "list", "--porcelain"]);
    if (listed.status !== 0) return err(gitFailure("git worktree list", listed));
    const shared = realpathSync(projectRoot);
    const isShared = (p: string): boolean => p === shared || (existsSync(p) && realpathSync(p) === shared);
    const onMain: string[] = [];
    for (const block of listed.stdout.split("\n\n")) {
      const lines = block.split("\n");
      const path = lines.find((l) => l.startsWith("worktree "))?.slice("worktree ".length);
      if (path !== undefined && lines.includes(`branch ${TARGET_REF}`)) onMain.push(path);
    }
    const others = onMain.filter((p) => !isShared(p));
    if (others.length > 0) {
      return err({
        code: "VALIDATION_ERROR",
        field: "worktree",
        message: `integrate: ${others.join(", ")} has ${TARGET_NAME} checked out; moving ${TARGET_NAME} under a checked-out branch stages a reverse diff there. Detach it (git -C <path> checkout --detach ${TARGET_NAME}) or switch it to another branch, then re-run. Nothing was changed`,
        value: others.join(", "),
      });
    }
    if (!onMain.some(isShared)) return ok(undefined);

    const inProgress = this.operationInProgress(shared);
    if (inProgress !== undefined) {
      return err({
        code: "VALIDATION_ERROR",
        field: "worktree",
        message: `integrate: the shared checkout ${shared} is on branch ${TARGET_NAME} with a ${inProgress} in progress and cannot be detached; finish or abort it (git -C ${shared} ${inProgress} --abort), then re-run. Nothing was changed`,
        value: shared,
      });
    }
    const detached = git(shared, ["checkout", "-q", "--detach", TARGET_NAME]);
    if (detached.status !== 0) {
      return err({
        code: "VALIDATION_ERROR",
        field: "worktree",
        message: `integrate: the shared checkout ${shared} is on branch ${TARGET_NAME} and could not be detached (git exit ${detached.status}): ${(detached.stderr || detached.stdout).trim()}. Nothing was changed`,
        value: shared,
      });
    }
    this.deps.log(`integrate: detached the shared checkout ${shared} at ${TARGET_NAME} (its edits are untouched)`);
    return ok(undefined);
  }

  /**
   * Moves the shared checkout's detached view to the current main with `git checkout --detach main` — never forced, so
   * git itself refuses (and loses nothing) when an uncommitted edit would be overwritten (ADR E5/E5b). Never fails the
   * integration: main already moved, so every non-refresh is reported, not thrown.
   */
  private refreshSharedView(): SharedViewRefresh {
    const { git, projectRoot } = this.deps;
    const gitDir = git(projectRoot, ["rev-parse", "--path-format=absolute", "--absolute-git-dir"]);
    const commonDir = git(projectRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    if (gitDir.status !== 0 || commonDir.status !== 0) {
      return { state: "not_measured", reason: `could not locate the git dir of ${projectRoot}: ${(gitDir.stderr || commonDir.stderr).trim()}` };
    }
    if (realpathSync(gitDir.stdout.trim()) !== realpathSync(commonDir.stdout.trim())) {
      return { state: "not_measured", reason: `${projectRoot} is a linked worktree, not the shared checkout` };
    }
    const branch = git(projectRoot, ["symbolic-ref", "-q", "HEAD"]);
    if (branch.status === 0) {
      return { state: "not_measured", reason: `the shared checkout is on ${branch.stdout.trim()}, not a detached view of ${TARGET_NAME}` };
    }
    const inProgress = this.operationInProgress(projectRoot);
    if (inProgress !== undefined) return { state: "not_measured", reason: `the shared checkout has a ${inProgress} in progress` };
    const moved = git(projectRoot, ["checkout", "-q", "--detach", TARGET_NAME]);
    if (moved.status === 0) return { state: "refreshed" };
    const text = `${moved.stderr}${moved.stdout}`;
    if (!text.includes("would be overwritten")) {
      return { state: "not_measured", reason: `git checkout --detach ${TARGET_NAME} exited ${moved.status}: ${text.trim()}` };
    }
    // git lists each blocking path on its own tab-indented line
    const paths = text.split("\n").filter((l) => l.startsWith("\t")).map((l) => l.trim());
    return { state: "kept_dirty", paths };
  }

  /**
   * Runs the project's post-refresh command in the shared checkout when its view is `refreshed`. Never fails the
   * integration: every non-rebuild is reported. A build that leaves tracked changes is reported with the paths.
   */
  private rebuildSharedView(view: SharedViewRefresh, command: string | undefined): SharedViewRebuild {
    if (command === undefined || command.trim() === "") return { state: "skipped", reason: "workflow.integrate.post_refresh_command is not set" };
    if (view.state !== "refreshed") return { state: "skipped", reason: `the shared checkout view is ${view.state}, not refreshed` };
    const { projectRoot, runFloor, git, log } = this.deps;
    log(`integrate: rebuilding the shared checkout ${projectRoot}: ${command}`);
    const ran = runFloor(command, projectRoot);
    if (ran.status !== 0) return { state: "rebuild_failed", exit_status: ran.status, output_tail: ran.output.slice(-FLOOR_TAIL_CHARS) };
    const status = git(projectRoot, ["status", "--porcelain=v1", "--untracked-files=no"]);
    const tracked = status.status === 0 ? status.stdout.split("\n").filter((l) => l.trim() !== "").map((l) => l.slice(3)) : [];
    return tracked.length === 0 ? { state: "rebuilt" } : { state: "rebuilt", tracked_changes: tracked };
  }

  /** The multi-step operation a checkout is in the middle of (it blocks a detach), or `undefined`. */
  private operationInProgress(checkout: string): "merge" | "rebase" | "cherry-pick" | "revert" | undefined {
    const states: ReadonlyArray<readonly [string, "merge" | "rebase" | "cherry-pick" | "revert"]> = [
      ["MERGE_HEAD", "merge"],
      ["rebase-merge", "rebase"],
      ["rebase-apply", "rebase"],
      ["CHERRY_PICK_HEAD", "cherry-pick"],
      ["REVERT_HEAD", "revert"],
    ];
    for (const [name, label] of states) {
      const located = this.deps.git(checkout, ["rev-parse", "--path-format=absolute", "--git-path", name]);
      if (located.status === 0 && existsSync(located.stdout.trim())) return label;
    }
    return undefined;
  }

  /** `rev` as a full commit sha, or a refusal naming the rev. */
  private resolveCommit(rev: string): Result<string, LoreError> {
    const out = this.deps.git(this.deps.projectRoot, ["rev-parse", "--verify", "-q", `${rev}^{commit}`]);
    if (out.status !== 0 || out.stdout.trim() === "") {
      return err({ code: "VALIDATION_ERROR", field: "branch", message: `integrate: ${rev} does not name a commit in this repository`, value: rev });
    }
    return ok(out.stdout.trim());
  }

  private defaultMessage(branch: string, tip: string): string {
    const subject = this.deps.git(this.deps.projectRoot, ["log", "-1", "--format=%s", tip]).stdout.trim();
    return subject === "" ? `merge(${branch})` : `merge(${branch}): ${subject}`;
  }

  /** Creates the session's detached integration worktree on first use, reuses it afterwards. */
  private ensureWorktree(sessionId: string): Result<string, LoreError> {
    const { git, projectRoot, worktreesRoot } = this.deps;
    const path = integrationWorktreePath(worktreesRoot, sessionId);
    const registered = git(projectRoot, ["worktree", "list", "--porcelain"]);
    if (registered.status !== 0) return err(gitFailure("git worktree list", registered));
    const known = registered.stdout.split("\n").filter((l) => l.startsWith("worktree ")).map((l) => l.slice("worktree ".length));
    const onDisk = existsSync(path);
    const canonical = onDisk ? realpathSync(path) : path;
    if (onDisk) {
      if (known.some((k) => k === path || k === canonical)) return ok(path);
      return err({ code: "STORE_ERROR", message: `integrate: ${path} exists but is not a worktree of this repository; remove it or use another session id` });
    }
    // registered-but-deleted (a cleaned-up directory): drop the stale registration before adding again
    if (known.includes(path)) git(projectRoot, ["worktree", "prune"]);
    const base = this.resolveCommit(TARGET_REF);
    if (!base.ok) return base;
    const added = git(projectRoot, ["worktree", "add", "-q", "--detach", path, base.value]);
    if (added.status !== 0) return err(gitFailure(`creating the integration worktree ${path}`, added));
    return ok(path);
  }

  /** Aborts any merge in progress and puts the worktree on `rev` with a clean tracked tree. */
  private resetWorktree(wt: string, rev: string): Result<void, LoreError> {
    this.deps.git(wt, ["merge", "--abort"]); // no merge in progress is the normal case: its failure is expected, not an error
    const out = this.deps.git(wt, ["checkout", "-q", "-f", "--detach", rev]);
    return out.status === 0 ? ok(undefined) : err(gitFailure(`resetting the integration worktree to ${short(rev)}`, out));
  }

  /** A merge that exited non-zero: unmerged paths mean a conflict (abort + reset, exit 4); anything else is an error. */
  private afterFailedMerge(branch: string, wt: string, base: string, merged: GitOutcome): Result<IntegrateOutcome, LoreError> {
    const unmerged = this.deps.git(wt, ["diff", "--name-only", "--diff-filter=U"]);
    const paths = unmerged.stdout.split("\n").map((p) => p.trim()).filter((p) => p !== "");
    const reset = this.resetWorktree(wt, base);
    if (!reset.ok) return reset;
    if (paths.length === 0) return err(gitFailure(`merging ${branch}`, merged));
    return ok({ kind: "conflict", branch, paths });
  }

  /** `<sha12> <subject>` of each first-parent commit that took main from `base` to `now`. */
  private describeMoves(base: string, now: string): string[] {
    const out = this.deps.git(this.deps.projectRoot, ["log", "--first-parent", "--format=%H %s", `${base}..${now}`]);
    const lines = out.stdout.split("\n").map((l) => l.trim()).filter((l) => l !== "");
    if (out.status !== 0 || lines.length === 0) return [`${short(now)} (main is not a descendant of ${short(base)})`];
    return lines.reverse().map((l) => `${short(l.slice(0, 40))}${l.slice(40)}`);
  }
}
