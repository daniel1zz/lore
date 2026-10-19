/**
 * SeatService — thin `GitPort` orchestration for the `lore seat` verb family
 * (SPEC-057 §Design Decisions D5). Every DECISION (is this plan ready to
 * enter, is this branch safe to delete) lives in a pure predicate in
 * `@lore/core`'s `seat.ts` — this service only sequences git calls and
 * translates their results into `Result`s, mirroring `DriftCheckService`'s
 * "orchestrator delegates classification to a pure core function" shape.
 *
 * Public surface:
 *   - GitPort — the 7-method port every git operation goes through
 *     (`worktreeAdd`, `worktreeList`, `worktreeRemove`, `isMerged`,
 *     `countUnmergedCommits`, `rebaseFromMain`, `isDirty`; `currentBranch`
 *     deliberately absent, D1 — no consumer). `countUnmergedCommits` is the
 *     count-yielding sibling of `isMerged` (spec-multi-session-concurrency-
 *     queryable-ownership-checkout §Scope L0, AC-REPLAY-1) — `isMerged`
 *     alone cannot tell a branch with one unmerged commit from one with two
 *     hundred. The real implementation
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
 * @invariant `remove` REQUIRES a live `worktreeList()` registration: a plan
 *   with no registered seat is refused (`gate:seat-remove:not-found`), never
 *   attempted against a guessed path. It then removes the worktree AND the
 *   branch (`GitPort.branchDelete`). The merge check runs against the main
 *   checkout's checked-out branch (first `worktreeList()` entry), and `force`
 *   skips it entirely.
 * @invariant `enter` refuses any non-plan target (`gate:seat-entry:not-a-plan`)
 *   before touching git, and a readiness-thunk error propagates as a `Result`.
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
 * The 7-method git port every `SeatService` operation goes through
 * (`currentBranch` deliberately absent — D1, no consumer). Every method
 * returns a `Result` for EXPECTED failures (a nonzero git exit, an ENOENT);
 * only genuinely unexpected faults reject the promise.
 */
export interface GitPort {
  worktreeAdd(path: string, branch: string): Promise<Result<void, LoreError>>;
  worktreeList(): Promise<Result<WorktreeInfo[], LoreError>>;
  worktreeRemove(path: string, force: boolean): Promise<Result<void, LoreError>>;
  isMerged(branch: string, into: string): Promise<Result<boolean, LoreError>>;
  /**
   * Force-deletes a local branch (`git branch -D`). The caller has already
   * decided deletion is safe (merge check passed, or `--force`) — `-d` would
   * wrongly refuse a squash-merged seat branch that `isMerged` accepts.
   */
  branchDelete(branch: string): Promise<Result<void, LoreError>>;
  /**
   * Counts commits reachable from `branch` but not from `into` (git's own
   * `into..branch` range syntax) — the fact `isMerged`'s boolean collapses:
   * a branch with 1 unmerged commit and a branch with 200 both read
   * `isMerged() === false`, yet only one is safe to delete without a second
   * thought (spec-multi-session-concurrency-queryable-ownership-checkout
   * §Scope L0, AC-REPLAY-1 — the 2026-08-11 diagnosis this closes).
   * @returns `ok(<non-negative integer>)` when both refs resolve — NEVER
   *   `ok(0)` for an UNCOUNTABLE branch (nonexistent `branch`/`into`, `cwd`
   *   outside any git work tree, any other git failure); those are `err`,
   *   so a caller can tell "measured zero" from "could not measure".
   */
  countUnmergedCommits(branch: string, into: string): Promise<Result<number, LoreError>>;
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
export type GetReadyReport = (planId: string) => Promise<Result<SeatReadyReportLike, LoreError>>;

/** Options for {@link SeatService.enter}. */
export interface SeatEnterOpts {
  /** Absolute path to the main checkout — the directory `isDirty`/`rebaseFromMain` operate on, and the base the seat worktree path is computed relative to. */
  mainCwd: string;
}

/** One entry in {@link SeatService.list}'s result — the SPEC-057 G13 cost counter-metric data surface. */
export interface SeatListEntry {
  branch: string;
  created_at: string;
  /** `null` = NOT MEASURED: the main checkout has no checked-out branch (detached HEAD), so there is no base to judge against (BR-380). Never a guess. */
  merged: boolean | null;
}

/**
 * The main checkout's checked-out branch — `git worktree list` always reports
 * the main working tree FIRST. A detached or missing main entry is an error
 * (never a silent fallback to a literal `"main"`).
 */
function mainCheckoutBranch(worktrees: readonly WorktreeInfo[]): Result<string, LoreError> {
  const main = worktrees[0];
  if (main === undefined || main.branch === null) {
    return err({
      code: "VALIDATION_ERROR",
      field: "gate:seat-remove:no-base-branch",
      message: "Cannot determine the base branch: the main checkout has no checked-out branch (detached HEAD?). Check out a branch in the main checkout and retry.",
      value: main?.path ?? "",
      rule: "BR-379",
    });
  }
  return ok(main.branch);
}

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
function wrapStepError(verb: "entry" | "remove", step: string, underlying: LoreError): LoreError {
  const underlyingMessage = "message" in underlying ? underlying.message : JSON.stringify(underlying);
  return {
    code: "STORE_ERROR",
    message: `seat ${verb} step "${step}" failed: ${underlyingMessage}`,
    rule: "BR-371",
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
    if (plan.type !== "plan") {
      return err({
        code: "VALIDATION_ERROR",
        field: "gate:seat-entry:not-a-plan",
        message: `Seat entry blocked: "${plan.slug}" is a ${plan.type}, not a plan — a seat belongs to a plan. Run \`lore seat <plan-slug>\` with a plan.`,
        value: plan.slug,
        rule: "BR-370",
      });
    }

    const dirtyResult = await this.gitPort.isDirty(opts.mainCwd);
    /** @lore-site BR-371 */
    if (!dirtyResult.ok) return err(wrapStepError("entry", "isDirty", dirtyResult.error));
    if (dirtyResult.value) {
      return err({
        code: "VALIDATION_ERROR",
        field: "gate:seat-entry:dirty-main",
        message: `Seat entry blocked: main checkout "${opts.mainCwd}" has uncommitted changes — commit or stash before entering a seat.`,
        value: opts.mainCwd,
        rule: "BR-367",
      });
    }

    const rebaseResult = await this.gitPort.rebaseFromMain(opts.mainCwd);
    /** @lore-site BR-371 */
    if (!rebaseResult.ok) return err(wrapStepError("entry", "rebaseFromMain", rebaseResult.error));

    const readyReport = await this.getReadyReport(plan.id);
    if (!readyReport.ok) return readyReport;
    const readyCheck = assertSeatEntryReady(readyReport.value);
    if (!readyCheck.ok) return readyCheck;

    const shortSlug = deriveShortPlanSlug(plan.slug);
    const branch = seatBranchName(shortSlug);
    const path = computeSeatWorktreePath(opts.mainCwd, shortSlug);

    const addResult = await this.gitPort.worktreeAdd(path, branch);
    /** @lore-site BR-371 */
    if (!addResult.ok) return err(wrapStepError("entry", "worktreeAdd", addResult.error));

    return ok({ path, branch });
  }

  /**
   * Lists every active seat worktree — the G13 cost counter-metric data
   * surface (SPEC-057 AC-S-7). Filters `worktreeList()` down to entries
   * whose branch is a genuine seat branch (`parseSeatBranch(...) !== null`)
   * and resolves each one's merge status via `isMerged` against the SAME base
   * branch `remove` uses ({@link mainCheckoutBranch}). A detached main checkout
   * yields `merged: null` (not measured) — never a guess, never an error.
   *
   * @returns `ok([])` for a corpus/repo with no active seats — an empty list
   *   is a valid result, never an error.
   */
  async list(): Promise<Result<SeatListEntry[], LoreError>> {
    const listResult = await this.gitPort.worktreeList();
    if (!listResult.ok) return listResult;

    const base = mainCheckoutBranch(listResult.value);
    const entries: SeatListEntry[] = [];
    for (const worktree of listResult.value) {
      if (worktree.branch === null) continue;
      if (parseSeatBranch(worktree.branch) === null) continue;

      if (!base.ok) {
        entries.push({ branch: worktree.branch, created_at: worktree.createdAt, merged: null });
        continue;
      }
      const mergedResult = await this.gitPort.isMerged(worktree.branch, base.value);
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
        rule: "BR-372",
      });
    }

    return ok({ path: match.path, branch: expectedBranch });
  }

  /**
   * Removes a plan's seat worktree + branch. Refuses an UNMERGED branch
   * unless `opts.force === true` (D4, data-loss guard); `force` skips the merge
   * check. A plan with no registered seat worktree is refused as not-found.
   * Order: worktree removal, then branch deletion.
   *
   * @param planIdOrSlug - The target plan's id or slug.
   * @param opts - `{force?: boolean}` — bypasses the refusal of an unmerged branch.
   * @returns `ok(undefined)` on success; `err` naming the branch + `--force`
   *   escape when unmerged and not forced, `gate:seat-remove:not-found` when no
   *   seat is registered, or a wrapped `GitPort` failure naming its step.
   */
  async remove(planIdOrSlug: string, opts?: { force?: boolean }): Promise<Result<void, LoreError>> {
    const planResult = await resolveDoc(this.store, planIdOrSlug);
    if (!planResult.ok) return planResult;
    const plan = planResult.value;

    const branch = seatBranchName(deriveShortPlanSlug(plan.slug));
    const force = opts?.force === true;

    const listResult = await this.gitPort.worktreeList();
    /** @lore-site BR-378 */
    if (!listResult.ok) return err(wrapStepError("remove", "worktreeList", listResult.error));
    const match = listResult.value.find((w) => w.branch === branch);
    if (match === undefined) {
      return err({
        code: "VALIDATION_ERROR",
        field: "gate:seat-remove:not-found",
        message: `No seat worktree found for plan "${plan.slug}" (expected branch "${branch}") — nothing to remove.`,
        value: branch,
        rule: "BR-378",
      });
    }

    if (!force) {
      const base = mainCheckoutBranch(listResult.value);
      if (!base.ok) return base;
      const mergedResult = await this.gitPort.isMerged(branch, base.value);
      /** @lore-site BR-378 */
      if (!mergedResult.ok) return err(wrapStepError("remove", "isMerged", mergedResult.error));
      if (!mergedResult.value) {
        return err({
          code: "VALIDATION_ERROR",
          field: "gate:seat-remove:unmerged",
          message: `Refusing to remove seat branch "${branch}" — it has unmerged commits. Re-run with --force to delete it anyway (commits will be LOST).`,
          value: branch,
          rule: "BR-374",
        });
      }
    }

    const removeResult = await this.gitPort.worktreeRemove(match.path, force);
    /** @lore-site BR-378 */
    if (!removeResult.ok) return err(wrapStepError("remove", "worktreeRemove", removeResult.error));

    const deleteResult = await this.gitPort.branchDelete(branch);
    /** @lore-site BR-378 */
    if (!deleteResult.ok) return err(wrapStepError("remove", "branchDelete", deleteResult.error));

    return ok(undefined);
  }
}
