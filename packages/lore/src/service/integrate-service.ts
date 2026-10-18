/**
 * IntegrateService — `lore integrate <branch>`: the one path by which a branch lands on main.
 *
 * Purpose: merge a branch onto the CURRENT main inside the session's own detached integration worktree, run the
 * project's post-merge floor on the merged tree, then advance `refs/heads/main` with a compare-and-swap
 * (`git update-ref refs/heads/main <new> <base>`). Git's own ref lock + old-value check refuses a lost race, so no
 * exclusivity is needed (adr-main-advances-only-by-lore-integrate-per-session, Option A; experiments E4, E8).
 * Public surface: IntegrateService.integrate, IntegrateOutcome, integrateExitCode, IntegrateRequest,
 *   IntegrateDeps, IntegrateGit, FloorRunner, INTEGRATE_MAX_ATTEMPTS, INTEGRATE_EXIT_LOST_RACES, INTEGRATE_MARKER_ENV,
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
 * Side-effect class: IO (git subprocesses through the injected IntegrateGit, the floor through FloorRunner, the loss
 *   ledger's files, creation of one worktree directory).
 *
 * Seams for INT-T2 (not built here): the hook install (consumes INTEGRATE_MARKER_ENV), `origin/main` as a branch
 * argument (fetch before resolving), and detaching/refreshing the shared checkout after a landing (the `landed`
 * outcome is where a caller hooks that).
 *
 * Source: spec-main-advances-only-through-lore-integrate-per-session AC-INT-1, BR-1245.
 */
import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { err, ok, type LoreError, type Result } from "@lore/core";
import type { IntegrateLossLedger } from "./integrate-loss-ledger.js";

/** Attempts (merge + floor + CAS) one call makes before it gives up with exit 75. */
export const INTEGRATE_MAX_ATTEMPTS = 3;

/** Exit code of `lost_races`: EX_TEMPFAIL — the call is safe to re-run. */
export const INTEGRATE_EXIT_LOST_RACES = 75;

/** The environment marker present on the CAS (and only on it); the main-ref hook of INT-T2 keys on it. */
export const INTEGRATE_MARKER_ENV = "LORE_INTEGRATE";

/** The branch integrations land on. */
const TARGET_REF = "refs/heads/main";
const TARGET_NAME = "main";

/** How much of a failing floor's output the outcome carries. */
const FLOOR_TAIL_CHARS = 4000;

/** Raw outcome of one git call; never thrown. */
export interface GitOutcome {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs `git <args>` in `cwd` (with `env` merged over the process environment); never throws. */
export type IntegrateGit = (cwd: string, args: readonly string[], env?: Readonly<Record<string, string>>) => GitOutcome;

/** Runs the floor shell command in `cwd`; `output` is stdout+stderr merged. Never throws. */
export type FloorRunner = (command: string, cwd: string) => { readonly status: number; readonly output: string };

export interface IntegrateDeps {
  readonly git: IntegrateGit;
  readonly runFloor: FloorRunner;
  readonly ledger: IntegrateLossLedger;
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
  /** Merge commit message; default `merge(<branch>): <tip subject>`. */
  readonly message?: string;
}

export type IntegrateOutcome =
  | { readonly kind: "landed"; readonly branch: string; readonly sha: string; readonly base: string; readonly attempts: number; readonly worktree: string }
  | { readonly kind: "already_integrated"; readonly branch: string; readonly main: string }
  | { readonly kind: "floor_failed"; readonly branch: string; readonly attempts: number; readonly exit_status: number; readonly output_tail: string }
  | { readonly kind: "conflict"; readonly branch: string; readonly paths: readonly string[] }
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

export class IntegrateService {
  constructor(private readonly deps: IntegrateDeps) {}

  /**
   * Lands `request.branch` on main, or reports exactly why it did not.
   *
   * @returns ok(outcome) for every defined outcome (landed, already integrated, floor failed, conflict, lost races —
   *   map with {@link integrateExitCode}); err for a refused request (missing floor key, unknown branch, empty session)
   *   or a git/filesystem failure.
   */
  async integrate(request: IntegrateRequest): Promise<Result<IntegrateOutcome, LoreError>> {
    const { git, projectRoot, ledger, log } = this.deps;
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
    const tipResult = this.resolveCommit(request.branch);
    if (!tipResult.ok) return tipResult;
    const tip = tipResult.value;

    const worktree = this.ensureWorktree(request.sessionId);
    if (!worktree.ok) return worktree;
    const wt = worktree.value;

    const message = request.message ?? this.defaultMessage(request.branch, tip);
    const movedBy: string[] = [];
    let lastConsecutiveLosses = 0;

    for (let attempt = 1; attempt <= INTEGRATE_MAX_ATTEMPTS; attempt += 1) {
      const base = this.resolveCommit(TARGET_REF);
      if (!base.ok) return base;
      if (git(projectRoot, ["merge-base", "--is-ancestor", tip, base.value]).status === 0) {
        const cleared = ledger.clear(request.branch);
        if (!cleared.ok) return cleared;
        return ok({ kind: "already_integrated", branch: request.branch, main: base.value });
      }
      log(`integrate: ${request.branch} attempt ${attempt}/${INTEGRATE_MAX_ATTEMPTS} on ${short(base.value)}`);

      const reset = this.resetWorktree(wt, base.value);
      if (!reset.ok) return reset;
      const merged = git(wt, ["merge", "--no-ff", "-m", message, tip], { GIT_MERGE_AUTOEDIT: "no" });
      if (merged.status !== 0) return this.afterFailedMerge(request.branch, wt, base.value, merged);

      const floor = this.deps.runFloor(request.floorCommand, wt);
      if (floor.status !== 0) {
        const back = this.resetWorktree(wt, base.value);
        if (!back.ok) return back;
        return ok({ kind: "floor_failed", branch: request.branch, attempts: attempt, exit_status: floor.status, output_tail: floor.output.slice(-FLOOR_TAIL_CHARS) });
      }

      const head = git(wt, ["rev-parse", "HEAD"]);
      if (head.status !== 0) return err(gitFailure("rev-parse HEAD in the integration worktree", head));
      const merge = head.stdout.trim();
      const swapped = git(projectRoot, ["update-ref", TARGET_REF, merge, base.value], { [INTEGRATE_MARKER_ENV]: "1" });
      if (swapped.status === 0) {
        const cleared = ledger.clear(request.branch);
        if (!cleared.ok) return cleared;
        return ok({ kind: "landed", branch: request.branch, sha: merge, base: base.value, attempts: attempt, worktree: wt });
      }

      const now = this.resolveCommit(TARGET_REF);
      if (!now.ok) return now;
      if (now.value === base.value) return err(gitFailure(`advancing ${TARGET_NAME} (main did not move, so this is not a lost race)`, swapped));
      const moved = this.describeMoves(base.value, now.value);
      movedBy.push(...moved);
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
