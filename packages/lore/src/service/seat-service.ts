/**
 * SeatService — thin `GitPort` orchestration for the `lore seat` verb family
 * (SPEC-057 §Design Decisions D5). Every DECISION (is this plan ready to
 * enter, is this branch safe to delete) lives in a pure predicate in
 * `@lore/core`'s `seat.ts` — this service only sequences git calls and
 * translates their results into `Result`s, mirroring `DriftCheckService`'s
 * "orchestrator delegates classification to a pure core function" shape.
 *
 * Public surface:
 *   - GitPort — the 6-method port every git operation goes through
 *     (`worktreeAdd`, `worktreeList`, `worktreeRemove`, `isMerged`,
 *     `rebaseFromMain`, `isDirty`; `currentBranch` deliberately absent, D1 —
 *     no consumer). The real implementation
 *     (`packages/lore/src/adapters/real-git-port.ts`) shells `git` via
 *     `node:child_process`; tests inject a scripted fake.
 *   - WorktreeInfo — one `worktreeList()` entry.
 *   - GetReadyReport — the injected readiness thunk `enter` consults.
 *   - SeatService.enter/list/resume/remove.
 *
 * @invariant `enter`'s sequence is `isDirty → rebaseFromMain → getReadyReport →
 *   worktreeAdd`, in that EXACT order (D5) — a dirty main checkout aborts
 *   before any other call; the readiness thunk is consulted strictly between
 *   the rebase and the worktree creation, never before or after.
 * @invariant `enter` has NO rollback machinery (D7) — a `worktreeAdd` failure
 *   after a successful `rebaseFromMain` leaves a BENIGN partial state (main
 *   freshly rebased, no worktree created); this is independently desirable,
 *   not something to undo. `enter` is idempotent-retryable: a second call
 *   re-runs the FULL sequence with no special-cased "already rebased" skip —
 *   this service holds no cross-call state.
 * @invariant `remove` refuses to delete an UNMERGED seat branch unless
 *   `opts.force === true` (D4, data-loss guard) — the error names the branch
 *   and the `--force` escape explicitly.
 * @invariant `remove` does not require a live `worktreeList()` registration
 *   to proceed — a merged (or forced) removal still calls
 *   `gitPort.worktreeRemove` even when no matching entry is found (a
 *   corpus/git-state drift edge case); the real `GitPort` implementation is
 *   the one that fails loud on a genuinely nonexistent path, not this
 *   service (see `remove`'s own JSDoc for the exact fallback).
 *
 * Side-effect class: IO (via the injected `GitPort` + `StoreInterface`; no
 *   direct filesystem or `child_process` access — those live behind the port).
 *
 * Source: SPEC-057 §Module Boundary, §Public Interface, §Design Decisions D1/D4/D5/D7.
 */

import { basename, dirname, join } from "node:path";

import { err, ok } from "@lore/core";
import { seatBranchName, sanitizeBranchSegment, assertSeatEntryReady, parseSeatBranch } from "@lore/core";
import type { LoreError, Result } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { resolveDoc } from "./resolve.js";

// ─── GitPort (D1) ────────────────────────────────────────────────────────

/** One `worktreeList()` entry. `branch: null` marks a detached-HEAD worktree. */
export interface WorktreeInfo {
  path: string;
  branch: string | null;
  /** ISO-8601 creation timestamp — derivation is a `GitPort`-implementation concern (real vs. fake), not this service's. */
  createdAt: string;
}

/**
 * The 6-method git port every `SeatService` operation goes through
 * (`currentBranch` deliberately absent — D1, no consumer). Every method
 * returns a `Result` for EXPECTED failures (a nonzero git exit, an ENOENT);
 * only genuinely unexpected faults reject the promise.
 */
export interface GitPort {
  worktreeAdd(path: string, branch: string): Promise<Result<void, LoreError>>;
  worktreeList(): Promise<Result<WorktreeInfo[], LoreError>>;
  worktreeRemove(path: string, force: boolean): Promise<Result<void, LoreError>>;
  isMerged(branch: string, into: string): Promise<Result<boolean, LoreError>>;
  rebaseFromMain(cwd: string): Promise<Result<void, LoreError>>;
  isDirty(cwd: string): Promise<Result<boolean, LoreError>>;
}

/**
 * Narrow readiness-report shape `SeatService` reads via the injected
 * `getReadyReport` thunk — matches `@lore/core`'s `SeatReadyReportLike`
 * (the shape `assertSeatEntryReady` actually consumes), NOT the full
 * `ReadyReport` from `task-workflow-service.ts` (this service must not
 * import that service — no cross-service imports).
 */
export interface SeatReadyReportLike {
  anchor_conflicts: Array<{ task_slug: string; holder: string; paths: string[] }>;
}

/**
 * Resolves a plan's current readiness report, by resolved plan id — injected
 * so `SeatService` never imports `TaskWorkflowService` directly (no
 * cross-service imports; mirrors `GateDependencies.getPlanBundle`'s shape).
 */
export type GetReadyReport = (planId: string) => Promise<SeatReadyReportLike>;

/** Options for {@link SeatService.enter}. */
export interface SeatEnterOpts {
  /** Absolute path to the main checkout — the directory `isDirty`/`rebaseFromMain` operate on, and the base the seat worktree path is computed relative to. */
  mainCwd: string;
}

/** One entry in {@link SeatService.list}'s result — the SPEC-057 G13 cost counter-metric data surface. */
export interface SeatListEntry {
  branch: string;
  created_at: string;
  merged: boolean;
}

/** The base branch every seat is entered from / merged against. Not yet configurable — no PRD mandate for it (mirrors the worktree-path convention's "code, not config" posture). */
const SEAT_BASE_BRANCH = "main";

/**
 * Strips a doc slug's own `plan-` type prefix (`{type}-{kebab-title}`,
 * `packages/core/src/CLAUDE.md`'s DocRecord convention) before it's handed to
 * `seatBranchName` — a resolved plan doc's slug is already `plan-<title>`,
 * and `seatBranchName` composes `plan/` on top of whatever it's given
 * verbatim (it does not itself know about doc-slug conventions — see its
 * JSDoc), so calling it on the RAW doc slug would double the segment
 * (`plan/plan-<title>`). Only the leading occurrence is stripped — a plan
 * literally titled "Plan" would slug to `plan-plan`, and this strips only
 * the type-prefix `plan-`, leaving `plan` (correct, not `""`).
 */
function deriveShortPlanSlug(docSlug: string): string {
  return docSlug.replace(/^plan-/, "");
}

/** Wraps an underlying `GitPort` failure with the failed step's name, so a caller (and this module's own test suite) can assert which step aborted the sequence without depending on the port implementation's own message wording. */
function wrapStepError(step: string, underlying: LoreError): LoreError {
  const underlyingMessage = "message" in underlying ? underlying.message : JSON.stringify(underlying);
  return {
    code: "STORE_ERROR",
    message: `seat entry step "${step}" failed: ${underlyingMessage}`,
  };
}

/**
 * Computes the seat worktree's filesystem path from the main checkout's own
 * path, per the SPEC-057 §Structure convention `../<repo>-seat-<plan-slug>`
 * (code, not config — no PRD mandate for configurability): a sibling
 * directory of the main checkout, named `<repo-basename>-seat-<short-plan-slug>`.
 */
function computeSeatWorktreePath(mainCwd: string, shortPlanSlug: string): string {
  const repoName = basename(mainCwd);
  const parent = dirname(mainCwd);
  return join(parent, `${repoName}-seat-${sanitizeBranchSegment(shortPlanSlug)}`);
}

/**
 * Thin `GitPort` orchestrator for the `lore seat` verb family. Holds no
 * cross-call state — every method resolves its plan/branch fresh from the
 * store and the injected port on each invocation (the idempotent-retry
 * invariant `enter` documents at the module level falls straight out of this).
 */
export class SeatService {
  constructor(
    private readonly store: StoreInterface,
    private readonly gitPort: GitPort,
    private readonly getReadyReport: GetReadyReport,
  ) {}

  /**
   * Enters (creates) a seat worktree for `planIdOrSlug`. Sequence (D5, exact
   * order): resolve the plan → `isDirty(mainCwd)` → `rebaseFromMain(mainCwd)`
   * → `getReadyReport(plan.id)` + `assertSeatEntryReady` → `worktreeAdd`.
   * A dirty main checkout aborts BEFORE rebase/readiness/worktreeAdd. No
   * rollback on a later-step failure (D7) — see module JSDoc.
   *
   * @param planIdOrSlug - The target plan's id or slug.
   * @param opts - See {@link SeatEnterOpts}.
   * @returns `ok({path, branch})` on success; `err` naming the failed step
   *   otherwise (dirty-main / anchor-conflict / a wrapped `GitPort` failure).
   */
  async enter(
    planIdOrSlug: string,
    opts: SeatEnterOpts,
  ): Promise<Result<{ path: string; branch: string }, LoreError>> {
    const planResult = await resolveDoc(this.store, planIdOrSlug);
    if (!planResult.ok) return planResult;
    const plan = planResult.value;

    const dirtyResult = await this.gitPort.isDirty(opts.mainCwd);
    if (!dirtyResult.ok) return err(wrapStepError("isDirty", dirtyResult.error));
    if (dirtyResult.value) {
      return err({
        code: "VALIDATION_ERROR",
        field: "gate:seat-entry:dirty-main",
        message: `Seat entry blocked: main checkout "${opts.mainCwd}" has uncommitted changes — commit or stash before entering a seat.`,
        value: opts.mainCwd,
      });
    }

    const rebaseResult = await this.gitPort.rebaseFromMain(opts.mainCwd);
    if (!rebaseResult.ok) return err(wrapStepError("rebaseFromMain", rebaseResult.error));

    const readyReport = await this.getReadyReport(plan.id);
    const readyCheck = assertSeatEntryReady(readyReport);
    if (!readyCheck.ok) return readyCheck;

    const shortSlug = deriveShortPlanSlug(plan.slug);
    const branch = seatBranchName(shortSlug);
    const path = computeSeatWorktreePath(opts.mainCwd, shortSlug);

    const addResult = await this.gitPort.worktreeAdd(path, branch);
    if (!addResult.ok) return err(wrapStepError("worktreeAdd", addResult.error));

    return ok({ path, branch });
  }

  /**
   * Lists every active seat worktree — the G13 cost counter-metric data
   * surface (SPEC-057 AC-S-7). Filters `worktreeList()` down to entries
   * whose branch is a genuine seat branch (`parseSeatBranch(...) !== null`)
   * and resolves each one's merge status via `isMerged` against
   * {@link SEAT_BASE_BRANCH}.
   *
   * @returns `ok([])` for a corpus/repo with no active seats — an empty list
   *   is a valid result, never an error.
   */
  async list(): Promise<Result<SeatListEntry[], LoreError>> {
    const listResult = await this.gitPort.worktreeList();
    if (!listResult.ok) return listResult;

    const entries: SeatListEntry[] = [];
    for (const worktree of listResult.value) {
      if (worktree.branch === null) continue;
      if (parseSeatBranch(worktree.branch) === null) continue;

      const mergedResult = await this.gitPort.isMerged(worktree.branch, SEAT_BASE_BRANCH);
      if (!mergedResult.ok) return mergedResult;

      entries.push({ branch: worktree.branch, created_at: worktree.createdAt, merged: mergedResult.value });
    }

    return ok(entries);
  }

  /**
   * Resumes (re-enters) an EXISTING seat worktree for `planIdOrSlug` by
   * locating it via `worktreeList()` — never creates one (a resume with no
   * matching seat errs rather than silently falling back to `enter`'s
   * creation path; those are deliberately separate verbs, SPEC-057 §Public
   * Interface).
   *
   * @param planIdOrSlug - The target plan's id or slug.
   * @returns `ok({path, branch})` for the matching worktree; `err` when no
   *   seat worktree exists for this plan yet.
   */
  async resume(planIdOrSlug: string): Promise<Result<{ path: string; branch: string }, LoreError>> {
    const planResult = await resolveDoc(this.store, planIdOrSlug);
    if (!planResult.ok) return planResult;
    const plan = planResult.value;

    const expectedBranch = seatBranchName(deriveShortPlanSlug(plan.slug));

    const listResult = await this.gitPort.worktreeList();
    if (!listResult.ok) return listResult;

    const match = listResult.value.find((w) => w.branch === expectedBranch);
    if (match === undefined) {
      return err({
        code: "VALIDATION_ERROR",
        field: "gate:seat-resume:not-found",
        message: `No seat worktree found for plan "${plan.slug}" (expected branch "${expectedBranch}") — run \`lore seat ${plan.slug}\` to create one.`,
        value: expectedBranch,
      });
    }

    return ok({ path: match.path, branch: expectedBranch });
  }

  /**
   * Removes a plan's seat worktree + branch. Refuses an UNMERGED branch
   * unless `opts.force === true` (D4, data-loss guard). Does not require a
   * `worktreeList()` registration to exist for a merged (or forced) removal
   * to proceed — when no matching entry is found, `gitPort.worktreeRemove`
   * is still invoked, with the seat's branch name as a best-effort path
   * fallback (a corpus/git-state drift edge case; the real `GitPort` is what
   * fails loud on a genuinely nonexistent path — this service does not mask
   * that by refusing to attempt the call).
   *
   * @param planIdOrSlug - The target plan's id or slug.
   * @param opts - `{force?: boolean}` — bypasses the unmerged-branch refusal.
   * @returns `ok(undefined)` on success; `err` naming the branch + `--force`
   *   escape when unmerged and not forced, or a wrapped `GitPort` failure.
   */
  async remove(planIdOrSlug: string, opts?: { force?: boolean }): Promise<Result<void, LoreError>> {
    const planResult = await resolveDoc(this.store, planIdOrSlug);
    if (!planResult.ok) return planResult;
    const plan = planResult.value;

    const branch = seatBranchName(deriveShortPlanSlug(plan.slug));
    const force = opts?.force === true;

    const mergedResult = await this.gitPort.isMerged(branch, SEAT_BASE_BRANCH);
    if (!mergedResult.ok) return err(wrapStepError("isMerged", mergedResult.error));

    if (!mergedResult.value && !force) {
      return err({
        code: "VALIDATION_ERROR",
        field: "gate:seat-remove:unmerged",
        message: `Refusing to remove seat branch "${branch}" — it has unmerged commits. Re-run with --force to delete it anyway (commits will be LOST).`,
        value: branch,
      });
    }

    const listResult = await this.gitPort.worktreeList();
    if (!listResult.ok) return err(wrapStepError("worktreeList", listResult.error));
    const match = listResult.value.find((w) => w.branch === branch);
    // reason: no live git worktree registration matches this seat's branch —
    // corpus/git-state drift, not this service's job to reconcile. Falling
    // back to the branch name itself as the "path" keeps the removal
    // best-effort rather than refusing outright; the real GitPort fails loud
    // on a path git doesn't recognize (see module JSDoc).
    const path = match?.path ?? branch;

    const removeResult = await this.gitPort.worktreeRemove(path, force);
    if (!removeResult.ok) return err(wrapStepError("worktreeRemove", removeResult.error));

    return ok(undefined);
  }
}
