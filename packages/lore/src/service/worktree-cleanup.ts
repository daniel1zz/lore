/**
 * Worktree cleanup — decides, and carries out, the removal of a claim-recorded git worktree
 * once its task is archived/deprecated (issue #106; rules BR-961 / BR-962; spec
 * lore-owns-worktree-cleanup-archive-removes-the-task-s, AC-WTC-1 / AC-WTC-2).
 *
 * Public surface:
 *   - {@link WorktreeGitProbe}            — the ONLY IO seam: every git/fs question the predicate asks
 *   - {@link createRealWorktreeProbe}     — the real implementation (git subprocesses, plain commands)
 *   - {@link parseQuietMinutes}           — `LORE_WORKTREE_QUIET_MINUTES` -> minutes (default 30), fail loud
 *   - {@link collectRecordedWorktrees}    — claim audit history (+ current claim) -> recorded worktrees + claim-time base
 *   - {@link gatherWorktreeFacts}         — probe -> {@link WorktreeFacts} (IO, never throws)
 *   - {@link decideWorktreeCleanup}       — PURE: facts + quiet window + clock -> decision
 *   - {@link evaluateRecordedWorktree}    — gather + decide
 *   - {@link applyWorktreeRemoval}        — `git worktree remove` then `git branch -d` (never forced)
 *   - {@link formatWorktreeOutcomeLine}   — the `worktree: ...` line `lore done` prints
 *
 * Invariants:
 *   - REMOVE only when ALL hold: path exists and is a LINKED worktree of the repo (never the main
 *     checkout); no tracked/untracked changes; >= 1 commit beyond the worktree HEAD recorded at claim
 *     time (`base_sha`) with every such commit reachable from `main`; no reflog activity for the quiet
 *     window; not `git worktree lock`ed; not recorded by a still-active task's claim; the caller's cwd
 *     is not inside it.
 *   - NO silent fallback: any git call that fails, or a missing claim-time base, yields
 *     `not-measured` (with the reason) — NEVER `remove`. "Unmeasured" is never read as "safe".
 *   - Removal is plain `git worktree remove` + `git branch -d`; neither `--force` nor `-D` ever appears.
 *     Git itself therefore refuses a dirty/locked worktree or an unmerged branch even if a probe lied.
 *
 * Side-effect class: pure ({@link decideWorktreeCleanup}, {@link parseQuietMinutes},
 *   {@link collectRecordedWorktrees}, {@link formatWorktreeOutcomeLine}); IO via the injected probe
 *   (everything else). The real probe spawns `git` subprocesses and reads the filesystem.
 *
 * Source: issue #106; BR-961, BR-962.
 */

import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { err, ok, type LoreError, type Result } from "@lore/core";
import type { AuditEntry } from "@lore/core";

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
  /** Newest reflog entry time (epoch seconds) across `HEAD` of the worktree and `refs/heads/<branch>`. */
  newestReflogEpochSeconds(path: string, branch: string): ProbeResult<number>;
  /** `git rev-parse HEAD` in `path`. */
  headSha(path: string): ProbeResult<string>;
  /** `git rev-parse --verify refs/heads/<name>` run in `cwd` (any worktree of the repo — branch refs are shared). */
  branchTip(cwd: string, name: string): ProbeResult<string>;
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

/** What the probe measured about one recorded worktree — the pure decision's only input. */
export type WorktreeFacts =
  | { readonly kind: "gone" }
  | { readonly kind: "not-measured"; readonly reason: string }
  | { readonly kind: "main-checkout" }
  | { readonly kind: "claimed-by-active-task" }
  | { readonly kind: "cwd-inside-worktree" }
  | {
      readonly kind: "measured";
      readonly locked: boolean;
      readonly dirty: boolean;
      readonly ownCommitCount: number;
      /** Commits of the branch not reachable from `main`. Only meaningful when `ownCommitCount > 0`. */
      readonly unmergedCount: number;
      readonly newestReflogEpochSeconds: number;
    };

export type WorktreeDecisionKind = "remove" | "keep" | "not-measured" | "gone";

/** Decision plus the reason token(s): `no-own-commits`, `uncommitted-changes`, `unmerged-commits`, `recent-activity`, `locked`, ... */
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
  readonly quietMinutes: number;
  readonly nowEpochSeconds: number;
  /** Paths (resolved forms) recorded by the current claim of a NOT-yet-terminal task. */
  readonly activeClaimedPaths: ReadonlySet<string>;
}

/** The outcome `lore done` reports and stores in the done audit row. */
export interface WorktreeOutcome {
  readonly worktree: string;
  readonly decision: WorktreeDecisionKind;
  readonly reason: string;
}

// ── Pure: quiet window ──────────────────────────────────────────────────────

/** Default reflog quiet window, minutes. */
export const DEFAULT_WORKTREE_QUIET_MINUTES = 30;

/**
 * Parses `LORE_WORKTREE_QUIET_MINUTES`. Unset -> {@link DEFAULT_WORKTREE_QUIET_MINUTES}. A set value
 * must be a non-negative integer; anything else is a loud VALIDATION_ERROR (never a silent default).
 *
 * @example parseQuietMinutes(undefined) // ok(30)
 * @example parseQuietMinutes("0")       // ok(0)
 * @example parseQuietMinutes("soon")    // err(VALIDATION_ERROR)
 */
export function parseQuietMinutes(raw: string | undefined): Result<number, LoreError> {
  if (raw === undefined) return ok(DEFAULT_WORKTREE_QUIET_MINUTES);
  if (!/^[0-9]+$/.test(raw.trim())) {
    return err({
      code: "VALIDATION_ERROR",
      field: "LORE_WORKTREE_QUIET_MINUTES",
      message: `LORE_WORKTREE_QUIET_MINUTES must be a non-negative integer number of minutes, got "${raw}"`,
      value: raw,
    });
  }
  return ok(Number(raw.trim()));
}

// ── Head resolution: worktree path OR branch name ───────────────────────────

/** Which resolution produced a measured sha. */
export type HeadSource = "worktree" | "branch";

/**
 * Measures the HEAD a claim's `--worktree` value stands for. Lore's own dispatch protocol claims
 * with `--worktree "$(git branch --show-current)"`, i.e. a branch NAME, so a path-only reading
 * would leave every real claim unmeasured (issue #180 retry).
 *
 * An ABSOLUTE path naming an existing directory is a worktree: `rev-parse HEAD` inside it.
 * Anything else is a branch name: `refs/heads/<name>` resolved from `repoCwd` (branch refs are
 * shared by every worktree). A relative value is never read as a directory — it would resolve
 * against the caller's cwd and silently measure the wrong repository for a branch named like a
 * folder.
 *
 * @example
 * resolveClaimHead(probe, "feature-x", "/repo") // → {ok:true, value:{sha, source:"branch"}}
 */
export function resolveClaimHead(
  probe: WorktreeGitProbe,
  target: string,
  repoCwd: string,
): ProbeResult<{ sha: string; source: HeadSource }> {
  if (isAbsolute(target) && probe.pathExists(target)) {
    const head = probe.headSha(target);
    return head.ok ? { ok: true, value: { sha: head.value, source: "worktree" } } : head;
  }
  const tip = probe.branchTip(repoCwd, target);
  return tip.ok ? { ok: true, value: { sha: tip.value, source: "branch" } } : tip;
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
 * The cleanup predicate (BR-961), pure over measured facts.
 *
 * `measured` facts: every failing clause is listed (comma-joined, fixed order: locked,
 * uncommitted-changes, no-own-commits, unmerged-commits, recent-activity) -> `keep`; all clauses
 * holding -> `remove`. `unmerged-commits` is only reported when the branch has own commits.
 * "Recent" means the newest reflog entry is younger than `quietMinutes` (so `0` never blocks).
 *
 * @param facts - what the probe measured
 * @param quietMinutes - reflog quiet window (see {@link parseQuietMinutes})
 * @param nowEpochSeconds - injected clock
 * @example
 * decideWorktreeCleanup({kind:"gone"}, 30, 0) // {decision:"gone", reason:"path does not exist"}
 */
export function decideWorktreeCleanup(
  facts: WorktreeFacts,
  quietMinutes: number,
  nowEpochSeconds: number,
): WorktreeDecision {
  switch (facts.kind) {
    case "gone":
      return { decision: "gone", reason: "path does not exist" };
    case "not-measured":
      return { decision: "not-measured", reason: facts.reason };
    case "main-checkout":
      return { decision: "keep", reason: "main-checkout" };
    case "claimed-by-active-task":
      return { decision: "keep", reason: "claimed-by-active-task" };
    case "cwd-inside-worktree":
      return { decision: "keep", reason: "cwd-inside-worktree" };
    case "measured": {
      const reasons: string[] = [];
      if (facts.locked) reasons.push("locked");
      if (facts.dirty) reasons.push("uncommitted-changes");
      if (facts.ownCommitCount < 1) reasons.push("no-own-commits");
      else if (facts.unmergedCount > 0) reasons.push("unmerged-commits");
      const ageSeconds = nowEpochSeconds - facts.newestReflogEpochSeconds;
      if (ageSeconds < quietMinutes * 60) reasons.push("recent-activity");
      if (reasons.length > 0) return { decision: "keep", reason: reasons.join(", ") };
      return { decision: "remove", reason: "clean, merged, quiet" };
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

function isInside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith("/") ? parent : `${parent}/`);
}

/**
 * Measures one recorded worktree through `probe`. NEVER throws; every probe failure becomes
 * `{kind:"not-measured", reason}` (a missing claim-time base included — there is no safe default).
 */
export function gatherWorktreeFacts(
  probe: WorktreeGitProbe,
  recorded: RecordedWorktree,
  activeClaimedPaths: ReadonlySet<string>,
): { readonly facts: WorktreeFacts; readonly repoRoot?: string; readonly branch?: string } {
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
  const mainEntry = entries[0] as ListedWorktree;
  if (index === 0) return { facts: { kind: "main-checkout" } };

  const cwdReal = probe.realPath(probe.currentWorkingDirectory());
  if (isInside(cwdReal, real)) return { facts: { kind: "cwd-inside-worktree" } };

  const repoRoot = mainEntry.path;
  const branch = entry.branch;
  if (branch === undefined) return { facts: { kind: "not-measured", reason: "detached HEAD (no branch to delete)" } };
  if (recorded.baseSha === undefined) {
    return { facts: { kind: "not-measured", reason: "no claim-time base recorded (claim predates worktree-cleanup tracking)" } };
  }

  const dirty = probe.isDirty(recorded.path);
  if (!dirty.ok) return { facts: { kind: "not-measured", reason: `git status failed: ${dirty.reason}` } };
  const own = probe.countCommits(recorded.path, `${recorded.baseSha}..${branch}`);
  if (!own.ok) return { facts: { kind: "not-measured", reason: `own-commit count failed: ${own.reason}` } };
  let unmergedCount = 0;
  if (own.value > 0) {
    const unmerged = probe.countCommits(recorded.path, `main..${branch}`);
    if (!unmerged.ok) return { facts: { kind: "not-measured", reason: `merged-into-main check failed: ${unmerged.reason}` } };
    unmergedCount = unmerged.value;
  }
  const reflog = probe.newestReflogEpochSeconds(recorded.path, branch);
  if (!reflog.ok) return { facts: { kind: "not-measured", reason: `reflog read failed: ${reflog.reason}` } };

  return {
    facts: {
      kind: "measured",
      locked: entry.locked,
      dirty: dirty.value,
      ownCommitCount: own.value,
      unmergedCount,
      newestReflogEpochSeconds: reflog.value,
    },
    repoRoot,
    branch,
  };
}

/** Gathers facts for `recorded` and decides. */
export function evaluateRecordedWorktree(
  probe: WorktreeGitProbe,
  recorded: RecordedWorktree,
  ctx: WorktreeEvaluationContext,
): WorktreeEvaluation {
  const gathered = gatherWorktreeFacts(probe, recorded, ctx.activeClaimedPaths);
  const decision = decideWorktreeCleanup(gathered.facts, ctx.quietMinutes, ctx.nowEpochSeconds);
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

function reflogEpoch(cwd: string, ref: string): number | undefined {
  const out = runGit(cwd, ["reflog", "show", "--date=unix", "--format=%gd", "-1", ref]);
  if (!out.ok) return undefined;
  const match = /@\{(\d+)\}/.exec(out.value);
  return match === null ? undefined : Number(match[1]);
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
    newestReflogEpochSeconds: (path, branch) => {
      const epochs = [reflogEpoch(path, "HEAD"), reflogEpoch(path, `refs/heads/${branch}`)].filter(
        (epoch): epoch is number => epoch !== undefined,
      );
      return epochs.length === 0 ? { ok: false, reason: "no readable reflog entry for HEAD or the branch" } : { ok: true, value: Math.max(...epochs) };
    },
    headSha: (path) => {
      const out = runGit(path, ["rev-parse", "HEAD"]);
      return out.ok ? { ok: true, value: out.value.trim() } : out;
    },
    branchTip: (cwd, name) => {
      const out = runGit(cwd, ["rev-parse", "--verify", `refs/heads/${name}`]);
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
