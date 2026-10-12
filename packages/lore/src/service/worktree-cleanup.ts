/**
 * Worktree cleanup — decides, and carries out, the removal of a claim-recorded git worktree
 * once its task is archived/deprecated (issue #106; rules BR-961 / BR-962; spec
 * lore-owns-worktree-cleanup-archive-removes-the-task-s, AC-WTC-1 / AC-WTC-2).
 *
 * Public surface:
 *   - {@link WorktreeGitProbe}            — the ONLY IO seam: every git/fs question the predicate asks
 *   - {@link createRealWorktreeProbe}     — the real implementation (git subprocesses, plain commands)
 *   - {@link collectRecordedWorktrees}    — claim audit history (+ current claim) -> recorded worktrees + claim-time base
 *   - {@link gatherWorktreeFacts}         — probe -> {@link WorktreeFacts} (IO, never throws)
 *   - {@link decideWorktreeCleanup}       — PURE: facts -> decision (the removal clauses come from `decideWorktreeRemoval`)
 *   - {@link evaluateRecordedWorktree}    — gather + decide
 *   - {@link applyWorktreeRemoval}        — `git worktree remove` then `git branch -d` (never forced)
 *   - {@link formatWorktreeOutcomeLine}   — the `worktree: ...` line `lore done` prints
 *
 * Invariants:
 *   - REMOVE only when ALL hold: the single worktree-removal test (`worktree-removal-test.ts`: linked, clean, merged,
 *     not locked, nobody inside, owned-or-abandoned — the ONE copy of those clauses) says removable; >= 1 commit
 *     beyond the worktree HEAD recorded at claim time (`base_sha`); not recorded by a still-active task's claim.
 *     No elapsed time is consulted (spec-one-worktree-removal-test-for-the-guard-lore-done-and-a D5).
 *   - NO silent fallback: any git call that fails, or a missing claim-time base, yields
 *     `not-measured` (with the reason) — NEVER `remove`. "Unmeasured" is never read as "safe".
 *   - Removal is plain `git worktree remove` + `git branch -d`; neither `--force` nor `-D` ever appears.
 *     Git itself therefore refuses a dirty/locked worktree or an unmerged branch even if a probe lied.
 *
 * Side-effect class: pure ({@link decideWorktreeCleanup}, {@link collectRecordedWorktrees},
 *   {@link formatWorktreeOutcomeLine}); IO via the injected probe and removal-facts port (everything else). The
 *   real probe spawns `git` subprocesses and reads the filesystem.
 *
 * Source: issue #106; BR-961, BR-962; spec-one-worktree-removal-test-for-the-guard-lore-done-and-a (BR-1079).
 */

import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import type { AuditEntry } from "@lore/core";
import {
  decideWorktreeRemoval,
  type Measured,
  type WorktreeRemovalFacts,
  type WorktreeRemovalFactsPort,
} from "./worktree-removal-test.js";

// ── Types ───────────────────────────────────────────────────────────────────

/** Outcome of one probe question: a measured value, or the reason it could not be measured. */
export type ProbeResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };

/** One entry of `git worktree list --porcelain`. `path` is exactly as git printed it. */
export interface ListedWorktree {
  readonly path: string;
  /** Short branch name; `undefined` for a detached HEAD. */
  readonly branch: string | undefined;
  readonly locked: boolean;
}

/**
 * Every git/fs question the cleanup predicate asks. Injectable so the decision pipeline is testable
 * without a real repository; {@link createRealWorktreeProbe} is the production implementation.
 * Each method NEVER throws — failure is `{ok:false, reason}`.
 */
export interface WorktreeGitProbe {
  pathExists(path: string): boolean;
  /** Canonical path (symlinks resolved); the input unchanged when it cannot be resolved. */
  realPath(path: string): string;
  /** The caller process's own working directory. */
  currentWorkingDirectory(): string;
  /** `git worktree list --porcelain`, run from `cwd` (any worktree of the repo). Entry 0 is the main checkout. */
  listWorktrees(cwd: string): ProbeResult<readonly ListedWorktree[]>;
  /** Any tracked or untracked change in the worktree at `path`. */
  isDirty(path: string): ProbeResult<boolean>;
  /** `git rev-list --count <range>` run in `cwd`. */
  countCommits(cwd: string, range: string): ProbeResult<number>;
  /** The integration branch (`main`, else `master`) a worktree must be merged into, resolved in `cwd`. */
  integrationBranch(cwd: string): ProbeResult<string>;
  /** `git rev-parse HEAD` in `path`. */
  headSha(path: string): ProbeResult<string>;
  /** Plain `git worktree remove <path>` run from `repoRoot`. */
  removeWorktree(repoRoot: string, path: string): ProbeResult<true>;
  /** Plain `git branch -d <branch>` run from `repoRoot`. */
  deleteBranch(repoRoot: string, branch: string): ProbeResult<true>;
}

/** A worktree path some claim recorded, with the worktree HEAD captured at claim time when known. */
export interface RecordedWorktree {
  readonly path: string;
  /** Worktree HEAD at the (earliest) claim that recorded `path`; `undefined` for a pre-#106 claim. */
  readonly baseSha: string | undefined;
}

/** What was measured about one recorded worktree — the pure decision's only input. */
export type WorktreeFacts =
  | { readonly kind: "gone" }
  | { readonly kind: "not-measured"; readonly reason: string }
  | { readonly kind: "claimed-by-active-task" }
  | {
      readonly kind: "measured";
      /** The facts the single removal test reads. */
      readonly removal: WorktreeRemovalFacts;
      /** Commits beyond the claim-time base; a miss names why (detached HEAD, no base, git failure, main checkout). */
      readonly ownCommitCount: Measured<number>;
    };

export type WorktreeDecisionKind = "remove" | "keep" | "not-measured" | "gone";

/** Decision plus the reason token(s): `no-own-commits`, `uncommitted-changes`, `unmerged-commits`, `run-not-ended`, `locked`, ... */
export interface WorktreeDecision {
  readonly decision: WorktreeDecisionKind;
  readonly reason: string;
}

/** {@link WorktreeDecision} plus what removal needs (`repoRoot`, `branch`), present iff `decision === "remove"`. */
export interface WorktreeEvaluation extends WorktreeDecision {
  readonly worktree: string;
  readonly repoRoot?: string;
  readonly branch?: string;
}

/** Context shared by every evaluation in one `done` / `sweep` pass. */
export interface WorktreeEvaluationContext {
  /** The caller's harness session id (D2); `null` = unknown, never the owner. */
  readonly callerSession: string | null;
  /** Paths (resolved forms) recorded by the current claim of a NOT-yet-terminal task. */
  readonly activeClaimedPaths: ReadonlySet<string>;
}

/** The outcome `lore done` reports and stores in the done audit row. */
export interface WorktreeOutcome {
  readonly worktree: string;
  readonly decision: WorktreeDecisionKind;
  readonly reason: string;
}

// ── Pure: recorded worktrees from claim history ─────────────────────────────

/**
 * Collects the worktrees a task's claims recorded: every claim audit row's `details.worktree`
 * (+ `details.base_sha`) — which survives `lore release` — plus the current `extra.claim.worktree`.
 * Per distinct path the EARLIEST row's base wins (a later refresh re-measures a HEAD that may have
 * advanced; the earliest base is the conservative "own commits" boundary). A path known only from the
 * current claim (pre-#106 claim) has `baseSha: undefined`.
 *
 * @param claimAuditRows - audit entries with `action === "claim"` for one task, any order
 * @param currentClaimWorktree - `extra.claim.worktree`, when a claim is held
 */
export function collectRecordedWorktrees(
  claimAuditRows: readonly AuditEntry[],
  currentClaimWorktree: string | undefined,
): RecordedWorktree[] {
  const ascending = [...claimAuditRows].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const byPath = new Map<string, string | undefined>();
  for (const row of ascending) {
    const path = row.details?.["worktree"];
    if (typeof path !== "string" || path.trim() === "") continue;
    const base = row.details?.["base_sha"];
    const baseSha = typeof base === "string" && base !== "" ? base : undefined;
    if (!byPath.has(path)) byPath.set(path, baseSha);
    else if (byPath.get(path) === undefined && baseSha !== undefined) byPath.set(path, baseSha);
  }
  if (currentClaimWorktree !== undefined && currentClaimWorktree.trim() !== "" && !byPath.has(currentClaimWorktree)) {
    byPath.set(currentClaimWorktree, undefined);
  }
  return [...byPath.entries()].map(([path, baseSha]) => ({ path, baseSha }));
}

// ── Pure: the decision ──────────────────────────────────────────────────────

/**
 * The cleanup predicate (BR-961), pure over measured facts. The removal clauses are `decideWorktreeRemoval`'s;
 * `lore done` adds only "the branch carries >= 1 own commit beyond the claim-time base".
 *
 * `measured` facts: every failing clause is listed (comma-joined: the removal test's tokens in its fixed order, then
 * `no-own-commits`) -> `keep`; an unmeasurable clause with nothing proven keeps -> `not-measured`; all clauses holding
 * -> `remove`.
 *
 * @example
 * decideWorktreeCleanup({kind:"gone"}) // {decision:"gone", reason:"path does not exist"}
 */
export function decideWorktreeCleanup(facts: WorktreeFacts): WorktreeDecision {
  switch (facts.kind) {
    case "gone":
      return { decision: "gone", reason: "path does not exist" };
    case "not-measured":
      return { decision: "not-measured", reason: facts.reason };
    case "claimed-by-active-task":
      return { decision: "keep", reason: "claimed-by-active-task" };
    case "measured": {
      const removal = decideWorktreeRemoval(facts.removal);
      const keep = removal.verdict === "keep" ? [...removal.reasons] : [];
      const unmeasured = removal.verdict === "not-measured" ? [...removal.reasons] : [];
      if (facts.ownCommitCount.ok) {
        if (facts.ownCommitCount.value < 1) keep.push("no-own-commits");
      } else {
        unmeasured.push(facts.ownCommitCount.reason);
      }
      if (keep.length > 0) return { decision: "keep", reason: keep.join(", ") };
      if (unmeasured.length > 0) return { decision: "not-measured", reason: unmeasured.join("; ") };
      return { decision: "remove", reason: "clean, merged, unoccupied" };
    }
    default: {
      const unreachable: never = facts;
      return unreachable;
    }
  }
}

// ── IO: gather facts ────────────────────────────────────────────────────────

function normalizedForms(probe: WorktreeGitProbe, path: string): string[] {
  const forms = new Set<string>([resolve(path)]);
  if (probe.pathExists(path)) forms.add(probe.realPath(path));
  return [...forms];
}

/** Normalized (resolved + canonical) path forms of `paths`, for the active-claim membership test. */
export function buildActiveClaimedPathSet(probe: WorktreeGitProbe, paths: readonly string[]): Set<string> {
  const set = new Set<string>();
  for (const path of paths) for (const form of normalizedForms(probe, path)) set.add(form);
  return set;
}

/**
 * Measures one recorded worktree through `probe` and the removal-facts port. NEVER throws; every probe failure becomes
 * `{kind:"not-measured", reason}` or a `Measured` miss (a missing claim-time base included — there is no safe default).
 */
export async function gatherWorktreeFacts(
  probe: WorktreeGitProbe,
  removal: WorktreeRemovalFactsPort,
  recorded: RecordedWorktree,
  activeClaimedPaths: ReadonlySet<string>,
  callerSession: string | null,
): Promise<{ readonly facts: WorktreeFacts; readonly repoRoot?: string; readonly branch?: string }> {
  if (!probe.pathExists(recorded.path)) return { facts: { kind: "gone" } };

  const forms = normalizedForms(probe, recorded.path);
  if (forms.some((form) => activeClaimedPaths.has(form))) return { facts: { kind: "claimed-by-active-task" } };

  const listed = probe.listWorktrees(recorded.path);
  if (!listed.ok) return { facts: { kind: "not-measured", reason: `git worktree list failed: ${listed.reason}` } };
  const entries = listed.value;
  const real = probe.realPath(recorded.path);
  const index = entries.findIndex((entry) => probe.realPath(entry.path) === real);
  if (index < 0) return { facts: { kind: "not-measured", reason: "not a linked worktree of its repository" } };
  const entry = entries[index] as ListedWorktree;
  const repoRoot = (entries[0] as ListedWorktree).path;
  const branch = entry.branch;

  const removalFacts = await removal.gatherRemovalFacts(recorded.path, callerSession);
  let ownCommitCount: Measured<number>;
  if (index === 0) ownCommitCount = { ok: false, reason: "main checkout" };
  else if (branch === undefined) ownCommitCount = { ok: false, reason: "detached HEAD (no branch to delete)" };
  else if (recorded.baseSha === undefined) {
    ownCommitCount = { ok: false, reason: "no claim-time base recorded (claim predates worktree-cleanup tracking)" };
  } else {
    const own = probe.countCommits(recorded.path, `${recorded.baseSha}..${branch}`);
    ownCommitCount = own.ok ? own : { ok: false, reason: `own-commit count failed: ${own.reason}` };
  }
  return {
    facts: { kind: "measured", removal: removalFacts, ownCommitCount },
    repoRoot,
    ...(branch !== undefined ? { branch } : {}),
  };
}

/** Gathers facts for `recorded` and decides. */
export async function evaluateRecordedWorktree(
  probe: WorktreeGitProbe,
  removal: WorktreeRemovalFactsPort,
  recorded: RecordedWorktree,
  ctx: WorktreeEvaluationContext,
): Promise<WorktreeEvaluation> {
  const gathered = await gatherWorktreeFacts(probe, removal, recorded, ctx.activeClaimedPaths, ctx.callerSession);
  const decision = decideWorktreeCleanup(gathered.facts);
  return {
    worktree: recorded.path,
    ...decision,
    ...(decision.decision === "remove" && gathered.repoRoot !== undefined && gathered.branch !== undefined
      ? { repoRoot: gathered.repoRoot, branch: gathered.branch }
      : {}),
  };
}

// ── IO: removal ─────────────────────────────────────────────────────────────

/**
 * Carries out a `remove` evaluation: plain `git worktree remove`, then plain `git branch -d`.
 * A failed worktree removal -> `not-measured` with `remove-failed: ...` (nothing was removed). A failed
 * branch delete AFTER a successful worktree removal still reports `remove` (the worktree is gone) with
 * the branch note appended to the reason — visible, never swallowed.
 *
 * @param evaluation - must have `decision === "remove"` (anything else is returned unchanged)
 */
export function applyWorktreeRemoval(probe: WorktreeGitProbe, evaluation: WorktreeEvaluation): WorktreeOutcome {
  if (evaluation.decision !== "remove" || evaluation.repoRoot === undefined || evaluation.branch === undefined) {
    return { worktree: evaluation.worktree, decision: evaluation.decision, reason: evaluation.reason };
  }
  const removed = probe.removeWorktree(evaluation.repoRoot, evaluation.worktree);
  if (!removed.ok) {
    return { worktree: evaluation.worktree, decision: "not-measured", reason: `remove-failed: ${removed.reason}` };
  }
  const branchDeleted = probe.deleteBranch(evaluation.repoRoot, evaluation.branch);
  return {
    worktree: evaluation.worktree,
    decision: "remove",
    reason: branchDeleted.ok ? "removed" : `removed; branch ${evaluation.branch} kept: ${branchDeleted.reason}`,
  };
}

/**
 * The one line `lore done` prints per recorded worktree:
 * `worktree: removed <path>` | `worktree: kept <path>: <reason>` | `worktree: not-measured <path>: <reason>`
 * | `worktree: gone <path>`.
 */
export function formatWorktreeOutcomeLine(outcome: WorktreeOutcome): string {
  switch (outcome.decision) {
    case "remove":
      return outcome.reason === "removed" ? `worktree: removed ${outcome.worktree}` : `worktree: removed ${outcome.worktree} (${outcome.reason})`;
    case "keep":
      return `worktree: kept ${outcome.worktree}: ${outcome.reason}`;
    case "not-measured":
      return `worktree: not-measured ${outcome.worktree}: ${outcome.reason}`;
    case "gone":
      return `worktree: gone ${outcome.worktree}`;
  }
}

// ── Real probe ──────────────────────────────────────────────────────────────

const PROBE_GIT_TIMEOUT_MS = 30_000;

function runGit(cwd: string, args: readonly string[]): ProbeResult<string> {
  const run = spawnSync("git", [...args], { cwd, encoding: "utf8", timeout: PROBE_GIT_TIMEOUT_MS });
  if (run.error !== undefined) return { ok: false, reason: run.error.message };
  if (run.status !== 0) {
    const detail = (run.stderr ?? "").trim().split("\n")[0] ?? "";
    return { ok: false, reason: `git ${args[0] ?? ""} exited ${String(run.status)}${detail !== "" ? `: ${detail}` : ""}` };
  }
  return { ok: true, value: run.stdout ?? "" };
}

function parseListPorcelain(stdout: string): ListedWorktree[] {
  const entries: ListedWorktree[] = [];
  for (const block of stdout.split("\n\n")) {
    const lines = block.split("\n").filter((line) => line !== "");
    const pathLine = lines.find((line) => line.startsWith("worktree "));
    if (pathLine === undefined) continue;
    const branchLine = lines.find((line) => line.startsWith("branch "));
    entries.push({
      path: pathLine.slice("worktree ".length),
      branch: branchLine === undefined ? undefined : branchLine.slice("branch ".length).replace(/^refs\/heads\//, ""),
      locked: lines.some((line) => line === "locked" || line.startsWith("locked ")),
    });
  }
  return entries;
}

/** The production {@link WorktreeGitProbe}: real `git` subprocesses (plain, never forced) and `node:fs`. */
export function createRealWorktreeProbe(): WorktreeGitProbe {
  return {
    pathExists: (path) => existsSync(path),
    realPath: (path) => {
      try {
        return realpathSync(path);
      } catch {
        // reason: an unresolvable path (deleted, permissions) has no canonical form; the caller
        // compares the resolved input instead — never a measurement, so nothing is fabricated.
        return resolve(path);
      }
    },
    currentWorkingDirectory: () => process.cwd(),
    listWorktrees: (cwd) => {
      const out = runGit(cwd, ["worktree", "list", "--porcelain"]);
      return out.ok ? { ok: true, value: parseListPorcelain(out.value) } : out;
    },
    isDirty: (path) => {
      const out = runGit(path, ["status", "--porcelain"]);
      return out.ok ? { ok: true, value: out.value.trim() !== "" } : out;
    },
    countCommits: (cwd, range) => {
      const out = runGit(cwd, ["rev-list", "--count", range]);
      if (!out.ok) return out;
      const count = Number(out.value.trim());
      return Number.isInteger(count) && count >= 0 ? { ok: true, value: count } : { ok: false, reason: `unparseable rev-list count "${out.value.trim()}"` };
    },
    integrationBranch: (cwd) => {
      for (const candidate of ["main", "master"]) {
        if (runGit(cwd, ["rev-parse", "--verify", "--quiet", candidate]).ok) return { ok: true, value: candidate };
      }
      return { ok: false, reason: "neither `main` nor `master` exists" };
    },
    headSha: (path) => {
      const out = runGit(path, ["rev-parse", "HEAD"]);
      return out.ok ? { ok: true, value: out.value.trim() } : out;
    },
    removeWorktree: (repoRoot, path) => {
      const out = runGit(repoRoot, ["worktree", "remove", path]);
      return out.ok ? { ok: true, value: true } : out;
    },
    deleteBranch: (repoRoot, branch) => {
      const out = runGit(repoRoot, ["branch", "-d", branch]);
      return out.ok ? { ok: true, value: true } : out;
    },
  };
}
