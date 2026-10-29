/**
 * One landing predicate, decided from git facts (spec-lore-done-closes-a-commitless-task-through-an-audited-no).
 *
 * `lore done` used to ask "did `lore integrate` write a landing record?". That made a task that changed nothing
 * unfinishable (it has no commit to integrate) and let a commit that reached main by any other route read as
 * unlanded. This module asks git instead: where did the claimed work start (`start_head`), where does it end (`tip`),
 * and is that tip on the integration branch?
 *
 * Pure: every git answer arrives through the {@link LandingGitFacts} port (implemented by `real-git-port.ts`). No IO here,
 * browser-safe. Every measurement that cannot be taken is `unmeasurable`, never a guess: a tip is never defaulted
 * to `start_head` and never taken from an evidence head.
 *
 * Reachability relies on `lore integrate` landing by merge commit (BR-1245): the branch tip stays an ancestor of main.
 */

import { z } from "zod";

/** A git answer that may be unavailable; `reason` is what git (or the port) said. */
export type FactResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };

/** The git questions the landing predicate may ask. Every method is synchronous and total (no throw). */
export interface LandingGitFacts {
  /** Name of the integration branch (`main`, else `master`). */
  integrationBranch(): FactResult<string>;
  /** Commit the integration branch points at now. */
  integrationHead(): FactResult<string>;
  /** Whether `commit` is reachable from the integration branch; an error when the object cannot be read. */
  isOnIntegration(commit: string): FactResult<boolean>;
  /** Whether `commit` is an ancestor of (or equal to) `of`; an error when either object cannot be read. */
  isAncestor(commit: string, of: string): FactResult<boolean>;
  /** Tip of the local branch `name`; `null` when no such ref exists. */
  branchTip(name: string): FactResult<string | null>;
  /** Path of the linked worktree that has `name` checked out; `null` when none does. */
  worktreeOfBranch(name: string): FactResult<string | null>;
  /** Whether the directory exists on disk. */
  pathExists(path: string): boolean;
  /** Any tracked or untracked change in the worktree at `path`. */
  isDirty(path: string): FactResult<boolean>;
  /** `HEAD` of the checkout at `path`. */
  headOf(path: string): FactResult<string>;
  /** Whether `dir` lies inside the linked worktree that has branch `branch` checked out. */
  isInsideBranchWorktree(dir: string, branch: string): FactResult<boolean>;
  /** Whether the repo-relative `path` is a file of the integration branch's tree. */
  pathExistsInIntegration(path: string): FactResult<boolean>;
  /**
   * Where main stood before the merge that brought `commit` onto it: the first parent of the oldest commit on the integration
   * branch's first-parent history that contains `commit`. A fact of the history, so no claim or re-claim can move it. An error
   * when `commit` is not on the integration branch, or reached it without a merge (no merge marks where the work began).
   */
  landingStartOf(commit: string): FactResult<string>;
}

/** What the claim history says about the work (read from the claim, its audit rows and the release rows). */
export interface LandingClaimFacts {
  /** The commit the claimed work started from (`base_sha` of the branch claim, or main's head for a no-branch claim). */
  readonly start_head?: string;
  /** Branch names the claims named, most recent first. Empty together with `worktrees`: a no-branch claim. */
  readonly branches: readonly string[];
  /** Absolute worktree paths the claims named. */
  readonly worktrees: readonly string[];
  /** Newest tip recorded at an evidence capture or a release. */
  readonly end_tip?: string;
}

export type LandingKind = "no-change" | "commits";

/** The fixed reasons a landing refuses (`[floor: not-landed]` reason tokens). */
export type NotLandedReason = "tip-not-on-main" | "uncommitted-work" | "unrecoverable-claim-branch-unlanded" | "no-measurable-claim";

/** Audit action of the marker migration 040 writes for a claim released before tips were recorded (#473). */
export const UNRECOVERABLE_CLAIM_ACTION = "claim-unrecoverable";
/** The reason an unrecoverable claim carries, verbatim in the marker's details. */
export const UNRECOVERABLE_CLAIM_REASON = "released before tips were recorded";

export type LandingVerdict =
  | {
      readonly state: "landed";
      readonly kind: LandingKind;
      readonly start_head: string;
      readonly tip: string;
      readonly integration_head: string;
      readonly integration_branch: string;
    }
  | {
      readonly state: "not-landed";
      readonly reason: NotLandedReason;
      readonly branch?: string;
      readonly tip?: string;
      readonly dirty_paths_in?: string;
      readonly integration_branch: string;
    }
  | { readonly state: "unmeasurable"; readonly reason: string };

/** What `lore done` stores on `extra.landing` for work it measured itself (merged into an integrate-written record). */
export const measuredLandingSchema = z.object({
  kind: z.enum(["no-change", "commits"]),
  start_head: z.string().min(1),
  tip: z.string().min(1),
  integration_head: z.string().min(1),
  measured_at: z.string().min(1),
});

export type MeasuredLanding = z.infer<typeof measuredLandingSchema>;

/** Reads the measured-landing fields off `extra.landing`; `undefined` when absent or incomplete. */
export function readMeasuredLanding(extra: Record<string, unknown> | undefined): MeasuredLanding | undefined {
  const raw = extra?.["landing"];
  if (raw === undefined || raw === null || typeof raw !== "object") return undefined;
  const parsed = measuredLandingSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/**
 * The one landing predicate.
 *
 * - no branch and no worktree named (a corpus-only claim): nothing to land, `no-change`, start = tip = `start_head`
 *   (or main's head when none was recorded);
 * - a worktree that still exists with any uncommitted change: `not-landed` / `uncommitted-work`;
 * - tip = the ref's tip while the branch exists, else the newest recorded `end_tip`, else `unmeasurable`;
 * - tip = `start_head`: `no-change` (commitless work lands trivially);
 * - otherwise the tip must be an ancestor of the integration branch: `commits`, else `not-landed` / `tip-not-on-main`;
 *   a tip object git cannot read is `unmeasurable`.
 *
 * @example
 * landingOf({ start_head: "a", branches: ["b"], worktrees: [] }, facts) // tip a, ref a => { state: "landed", kind: "no-change", ... }
 */
export function landingOf(claim: LandingClaimFacts, facts: LandingGitFacts): LandingVerdict {
  const integration = facts.integrationBranch();
  if (!integration.ok) return { state: "unmeasurable", reason: `the integration branch is unreadable (${integration.reason})` };
  const head = facts.integrationHead();
  if (!head.ok) return { state: "unmeasurable", reason: `the integration branch head is unreadable (${head.reason})` };

  if (claim.branches.length === 0 && claim.worktrees.length === 0) {
    const start = claim.start_head ?? head.value;
    return { state: "landed", kind: "no-change", start_head: start, tip: start, integration_head: head.value, integration_branch: integration.value };
  }

  if (claim.start_head === undefined) {
    return {
      state: "unmeasurable",
      reason: "no start commit was recorded for the claim (re-claim the task on a branch so the work has a start)",
    };
  }
  const start = claim.start_head;

  let refTip: string | undefined;
  let refBranch: string | undefined;
  const paths = new Set<string>();
  for (const path of claim.worktrees) paths.add(path);
  for (const name of claim.branches) {
    const tip = facts.branchTip(name);
    if (!tip.ok) return { state: "unmeasurable", reason: `branch ${name} cannot be read (${tip.reason})` };
    if (tip.value === null) continue;
    if (refTip === undefined) {
      refTip = tip.value;
      refBranch = name;
    }
    const where = facts.worktreeOfBranch(name);
    if (!where.ok) return { state: "unmeasurable", reason: `the worktree of branch ${name} cannot be read (${where.reason})` };
    if (where.value !== null) paths.add(where.value);
  }
  for (const path of paths) {
    if (!facts.pathExists(path)) continue;
    const dirty = facts.isDirty(path);
    if (!dirty.ok) return { state: "unmeasurable", reason: `worktree ${path} cannot be inspected (${dirty.reason})` };
    if (dirty.value) {
      return {
        state: "not-landed",
        reason: "uncommitted-work",
        ...(refBranch !== undefined ? { branch: refBranch } : {}),
        dirty_paths_in: path,
        integration_branch: integration.value,
      };
    }
  }

  const tip = refTip ?? claim.end_tip;
  if (tip === undefined) {
    return {
      state: "unmeasurable",
      reason:
        "the branch is gone and no tip was recorded for it (`lore release` records the tip; re-claim the task on a branch, " +
        "do the work there and release it)",
    };
  }
  const branchName = refBranch ?? claim.branches[0];

  if (tip === start) {
    return { state: "landed", kind: "no-change", start_head: start, tip, integration_head: head.value, integration_branch: integration.value };
  }
  const onMain = facts.isOnIntegration(tip);
  if (!onMain.ok) return { state: "unmeasurable", reason: `the tip ${tip.slice(0, 12)} cannot be checked (${onMain.reason})` };
  if (!onMain.value) {
    return {
      state: "not-landed",
      reason: "tip-not-on-main",
      ...(branchName !== undefined ? { branch: branchName } : {}),
      tip,
      integration_branch: integration.value,
    };
  }
  return { state: "landed", kind: "commits", start_head: start, tip, integration_head: head.value, integration_branch: integration.value };
}

/**
 * Judges the branch refs of a task's unrecoverable claims (their work range cannot be measured, but a ref that still exists
 * can show work that never landed): a ref gone, or whose tip is on the integration branch, is excluded; a ref whose tip is
 * NOT reachable from it refuses. `undefined` means every ref is gone or landed (the claims are listed, not judged).
 *
 * @param branches - the branch names of the task's unrecoverable claims
 */
export function unrecoverableBranchVerdict(branches: readonly string[], facts: LandingGitFacts): LandingVerdict | undefined {
  const integration = facts.integrationBranch();
  if (!integration.ok) return { state: "unmeasurable", reason: `the integration branch is unreadable (${integration.reason})` };
  for (const name of branches) {
    const tip = facts.branchTip(name);
    if (!tip.ok) return { state: "unmeasurable", reason: `branch ${name} cannot be read (${tip.reason})` };
    if (tip.value === null) continue; // ref gone: listed and excluded
    const onMain = facts.isOnIntegration(tip.value);
    if (!onMain.ok) return { state: "unmeasurable", reason: `the tip ${tip.value.slice(0, 12)} of branch ${name} cannot be checked (${onMain.reason})` };
    if (!onMain.value) {
      return { state: "not-landed", reason: "unrecoverable-claim-branch-unlanded", branch: name, tip: tip.value, integration_branch: integration.value };
    }
  }
  return undefined;
}

/** How the task was claimed, which decides what a counting pass must prove. */
export type PassMode = "unclaimed" | "branch" | "no-branch";

export interface CountingPassContext {
  readonly mode: PassMode;
  /** Time of the task's latest claim; a row recorded before it never counts. */
  readonly latestClaimAt?: string;
  /** The measured tip of the claimed branch, when known: a pass at a commit on the branch still counts for the not-landed floor. */
  readonly tip?: string;
}

/** The evidence-row fields the counting rule reads. */
export interface CountingPassRow {
  readonly result: string;
  readonly recorded_at: string;
  readonly attestation?: { readonly head_sha?: string | undefined; readonly worktree_dirty?: boolean | undefined; readonly main_head?: string | undefined } | undefined;
}

/**
 * Whether one evidence row counts as the attested pass `lore done` requires, under the landing predicate:
 * a runner-attested pass recorded after the latest claim; on a branch claim it must also be bound to a clean commit
 * (`head_sha` present, tree not dirty) reachable from main (or from the branch's own tip); on a no-branch claim its
 * `head_sha` must equal the `main_head` recorded with it. An unclaimed task is judged by the attestation alone.
 */
export function countsAsLandedPass(row: CountingPassRow, ctx: CountingPassContext, facts: LandingGitFacts): boolean {
  if (row.result !== "pass" || row.attestation === undefined) return false;
  if (ctx.latestClaimAt !== undefined && row.recorded_at < ctx.latestClaimAt) return false;
  if (ctx.mode === "unclaimed") return true;
  const { head_sha: head, worktree_dirty: dirty, main_head: mainHead } = row.attestation;
  if (head === undefined) return false;
  if (ctx.mode === "no-branch") return mainHead !== undefined && head === mainHead;
  if (dirty === true) return false;
  const onMain = facts.isOnIntegration(head);
  if (onMain.ok && onMain.value) return true;
  if (ctx.tip === undefined) return false;
  const onBranch = facts.isAncestor(head, ctx.tip);
  return onBranch.ok && onBranch.value;
}
