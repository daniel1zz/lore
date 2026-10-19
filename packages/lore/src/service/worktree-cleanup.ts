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
 *   - {@link ignoredPathsOutsideLossFreeSet} / {@link WorktreeRemovalGatePort} — AC-AU-11: the ignored-file rule
 *     (loss-free = byte-identical to main's copy, OR in the class's declared regenerable set)
 *     and the decide(worktree-remove) gate every removal path runs AFTER the removal test says removable
 *   - {@link SCRATCH_OWNER_FILE} + scratch helpers — lore-attested-red-* falsifier scratch worktrees and their owner marker
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
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
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
  /** `git rev-parse --verify refs/heads/<name>` run in `cwd` (any worktree of the repo — branch refs are shared). */
  branchTip(cwd: string, name: string): ProbeResult<string>;
  /** Plain `git worktree remove <path>` run from `repoRoot`. */
  removeWorktree(repoRoot: string, path: string): ProbeResult<true>;
  /** Plain `git branch -d <branch>` run from `repoRoot`. */
  deleteBranch(repoRoot: string, branch: string): ProbeResult<true>;
  /** `git status --ignored --porcelain` in `path`: every IGNORED path (as git printed it, `!! ` prefix stripped). */
  ignoredPaths(path: string): ProbeResult<readonly string[]>;
  /**
   * Whether the ignored path `relPath` of worktree `path` is byte-identical to the same path in the main checkout
   * (the first entry of `git worktree list`). Optional: an absent method proves nothing, so the path stays listed.
   */
  ignoredPathIdenticalToMain?(path: string, relPath: string): ProbeResult<boolean>;
  /**
   * Whether the repo-relative `path` is a file of the tree at `ref` (`ls-tree --full-tree`), run in `cwd`.
   * Optional: an absent method cannot measure, so {@link measureAnchorRemoval} reports `not-measured`.
   */
  pathExistsAtRef?(cwd: string, ref: string, path: string): ProbeResult<boolean>;
  /** The owner marker of the falsifier scratch worktree at `path`: `null` when the marker file is absent. */
  scratchOwner(path: string): ProbeResult<{ readonly pid: number } | null>;
  /** Whether process `pid` exists (signal 0). A pid that cannot be probed counts as alive (keep wins). */
  isPidAlive(pid: number): boolean;
  /**
   * `git worktree remove --force <path>` from `repoRoot`, then removal of the scratch parent directory. ONLY for a
   * falsifier scratch worktree (see {@link isFalsifierScratchPath}); refuses any other path.
   */
  removeScratchWorktree(repoRoot: string, path: string): ProbeResult<true>;
}

// ── Falsifier scratch worktrees (lore-attested-red-*) ───────────────────────

/** Prefix of the temp directory `createFalsifierScratchWorktree` makes; the worktree is its child `wt`. */
export const SCRATCH_PARENT_PREFIX = "lore-attested-red-";
/** Leaf directory name of the scratch worktree inside its parent. */
export const SCRATCH_WORKTREE_LEAF = "wt";
/** Owner marker written beside the scratch worktree (in its parent dir): `{"pid": <creating process>}`. */
export const SCRATCH_OWNER_FILE = "owner.json";

/** Whether `path` is the `wt` directory inside a `lore-attested-red-*` temp directory (a falsifier scratch worktree). */
export function isFalsifierScratchPath(path: string): boolean {
  return basename(path) === SCRATCH_WORKTREE_LEAF && basename(dirname(path)).startsWith(SCRATCH_PARENT_PREFIX);
}

/** Records the creating process in the scratch parent dir so a later sweep can prove its run ended. Never throws. */
export function writeScratchOwner(parentDir: string, pid: number): ProbeResult<true> {
  try {
    writeFileSync(join(parentDir, SCRATCH_OWNER_FILE), JSON.stringify({ pid }));
    return { ok: true, value: true };
  } catch (cause) {
    return { ok: false, reason: cause instanceof Error ? cause.message : String(cause) };
  }
}

// ── The ignored-file rule (AC-AU-11) ────────────────────────────────────────

/** Regex for one gitignore-style glob: `**` crosses segments, `*` and `?` stay inside one. */
function globToRegExp(glob: string): RegExp {
  let source = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i] as string;
    if (char === "*") {
      if (glob[i + 1] === "*") {
        const slashFollows = glob[i + 2] === "/";
        source += slashFollows ? "(?:.*/)?" : ".*";
        i += slashFollows ? 2 : 1;
      } else source += "[^/]*";
    } else if (char === "?") source += "[^/]";
    else source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

/** Whether `path` (as git printed it; a directory ends with `/`) is, or lies under, a path matching `pattern`. */
function matchesRegenerablePattern(path: string, pattern: string): boolean {
  const isDirectory = path.endsWith("/");
  const segments = path.split("/").filter((segment) => segment !== "");
  const directoryOnly = pattern.endsWith("/");
  const body = directoryOnly ? pattern.slice(0, -1) : pattern;
  const matcher = globToRegExp(body);
  const unanchored = !body.includes("/");
  // Candidates: every leading prefix of the path. A prefix shorter than the whole path is a directory by construction.
  for (let length = 1; length <= segments.length; length++) {
    const isWhole = length === segments.length;
    if (directoryOnly && isWhole && !isDirectory) continue;
    const candidate = unanchored ? (segments[length - 1] as string) : segments.slice(0, length).join("/");
    if (matcher.test(candidate)) return true;
    // `dir/**` must match the collapsed directory itself, which git prints as `dir/`.
    if (isWhole && isDirectory && !unanchored && matcher.test(`${candidate}/`)) return true;
  }
  return false;
}

/**
 * The ignored paths NOT in the declared regenerable set — rule (b). The set is GOVERNED data (AC-AU-9): callers pass
 * `DecisionService.governed().regenerablePatterns`, never the code seed.
 *
 * @param ignored - ignored paths as the status listing printed them (directories end with `/`)
 * @param patterns - the governed regenerable patterns
 * @example
 * ignoredPathsOutsideRegenerableSet(["node_modules/", ".env"], ["node_modules/"]) // [".env"]
 */
export function ignoredPathsOutsideRegenerableSet(ignored: readonly string[], patterns: readonly string[]): string[] {
  return ignored.filter((path) => !patterns.some((pattern) => matchesRegenerablePattern(path, pattern)));
}

/**
 * The ignored paths that are NEITHER regenerable (rule (b)) NOR byte-identical to the main checkout's copy (rule (a)).
 * These are the only paths whose removal could lose data; a non-empty result escalates the removal.
 * A probe that cannot prove identity (method absent, or `ok: false`) leaves the path listed — unproven is never loss-free.
 */
export function ignoredPathsOutsideLossFreeSet(
  probe: Pick<WorktreeGitProbe, "ignoredPathIdenticalToMain">,
  worktreePath: string,
  ignored: readonly string[],
  patterns: readonly string[],
): string[] {
  return ignoredPathsOutsideRegenerableSet(ignored, patterns).filter((path) => {
    const identical = probe.ignoredPathIdenticalToMain?.(worktreePath, path);
    return !(identical?.ok === true && identical.value);
  });
}

/**
 * Whether `relPath` (a file, or a directory ending `/`) under `worktreeRoot` is byte-identical to the same path under
 * `mainRoot`: a directory needs the same entry names with identical bytes; a path absent in main is NOT identical.
 * Symlinks compare by target. Absence on either side is `false`, not an error.
 */
export function isPathIdenticalUnder(worktreeRoot: string, mainRoot: string, relPath: string): boolean {
  const here = join(worktreeRoot, relPath);
  const there = join(mainRoot, relPath);
  let hereStat;
  let thereStat;
  try {
    hereStat = lstatSync(here);
    thereStat = lstatSync(there);
  } catch {
    // reason: a missing side means "not identical" (absent in main is never proof), not an error to surface.
    return false;
  }
  if (hereStat.isSymbolicLink() || thereStat.isSymbolicLink()) {
    return hereStat.isSymbolicLink() && thereStat.isSymbolicLink() && readlinkSync(here) === readlinkSync(there);
  }
  if (hereStat.isDirectory() || thereStat.isDirectory()) {
    if (!(hereStat.isDirectory() && thereStat.isDirectory())) return false;
    const names = readdirSync(here).sort();
    const otherNames = readdirSync(there).sort();
    if (names.length !== otherNames.length || names.some((name, index) => name !== otherNames[index])) return false;
    return names.every((name) => isPathIdenticalUnder(worktreeRoot, mainRoot, join(relPath, name)));
  }
  if (!hereStat.isFile() || !thereStat.isFile() || hereStat.size !== thereStat.size) return false;
  return readFileSync(here).equals(readFileSync(there));
}

/** What a removal path learns from the decide(worktree-remove) gate. */
export type WorktreeRemovalGate =
  | { readonly allowed: true; readonly record_id: number }
  | {
      readonly allowed: false;
      /** Printable reason naming the ignored paths and the decision record (`worktree: kept <path>: <reason>`). */
      readonly reason: string;
      readonly ignored_paths: readonly string[];
      readonly record_id?: number;
    };

/**
 * Port: the decide(worktree-remove) gate (AC-AU-11), run AFTER the removal test said removable. Implemented by
 * `WorktreeRemovalService`; NEVER throws — an unmeasurable or failed decision is `allowed: false`.
 */
export interface WorktreeRemovalGatePort {
  gateRemoval(path: string): Promise<WorktreeRemovalGate>;
}

/**
 * Port: removes a falsifier scratch worktree through decide(worktree-remove) (AC-AU-11). `removed: false` carries the
 * reason (an escalated decision keeps the worktree). NEVER throws.
 */
export interface ScratchRemovalPort {
  removeScratchWorktree(repoRoot: string, worktreeDir: string): Promise<{ removed: boolean; reason?: string }>;
}

function isWorktreeRemovalGatePort(port: object): port is WorktreeRemovalGatePort {
  return typeof (port as Partial<WorktreeRemovalGatePort>).gateRemoval === "function";
}

/** A worktree path some claim recorded, with the worktree HEAD captured at claim time when known. */
export interface RecordedWorktree {
  readonly path: string;
  /** Worktree HEAD at the (earliest) claim that recorded `path`; `undefined` for a pre-#106 claim. */
  readonly baseSha: string | undefined;
}

/** What was measured about one recorded worktree — the pure decision's only input. */
export type WorktreeFacts =
  | { readonly kind: "gone"; /** The failed lookups, naming both the path and the branch form. */ readonly lookups?: string }
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

// ── Anchored test files a task deleted ──────────────────────────────────────

/** Whether one anchored path was removed by the task's own branch, kept, or could not be measured. */
export type AnchorRemovalVerdict =
  | { readonly kind: "removed" }
  | { readonly kind: "kept" }
  | { readonly kind: "not-measured"; readonly reason: string };

/**
 * THE predicate "this path was deleted by this task" — the `unfiltered-test-file` done floor and its
 * "removed by this task" message both read this one verdict (never a second copy).
 *
 * Removed iff the path is in the tree at `base` (the claim-time `base_sha`), absent at the claim head (the branch deleted it) AND absent on the integration
 * branch (the deletion landed). A path someone else deleted on main (kept at the head) or a deletion that has
 * not landed (still on main) is `kept`. Any measurement failure is `not-measured` with its reason — never `removed`.
 *
 * @param refs.base - the claim's recorded `base_sha`; `undefined` (a claim that recorded none) is `not-measured`
 * @example
 * measureAnchorRemoval(probe, cwd, { base, head, integration: "main" }, "t/x.test.ts") // { kind: "removed" }
 */
export function measureAnchorRemoval(
  probe: Pick<WorktreeGitProbe, "pathExistsAtRef">,
  cwd: string,
  refs: { readonly base: string | undefined; readonly head: string; readonly integration: string },
  path: string,
): AnchorRemovalVerdict {
  const exists = probe.pathExistsAtRef;
  if (exists === undefined) return { kind: "not-measured", reason: "this probe cannot read a path at a ref" };
  // reason: after landing, merge-base(integration, head) IS the head, so only the claim-time base_sha still marks
  // where the branch started; a claim that recorded none cannot be measured and is refused, never guessed.
  const base = refs.base;
  if (base === undefined) return { kind: "not-measured", reason: "the claim recorded no base commit to compare against" };
  // Order: a path absent at the base was never there to delete, so that answer ends the walk first.
  const questions: ReadonlyArray<readonly [label: string, ref: string, wantPresent: boolean]> = [
    ["the claim base", base, true],
    ["the claim head", refs.head, false],
    [refs.integration, refs.integration, false],
  ];
  for (const [label, ref, wantPresent] of questions) {
    const at = exists(cwd, ref, path);
    if (!at.ok) return { kind: "not-measured", reason: `could not read ${path} at ${label}: ${at.reason}` };
    if (at.value !== wantPresent) return { kind: "kept" };
  }
  return { kind: "removed" };
}

// ── Worktree resolution: worktree path OR branch name → linked-worktree directory ──

/** How a recorded `--worktree` value resolved to a directory. */
export type WorktreeResolution =
  | { readonly kind: "resolved"; readonly path: string; readonly source: HeadSource }
  | { readonly kind: "unresolved"; /** Both failed lookups, ready to print. */ readonly lookups: string }
  | { readonly kind: "not-measured"; readonly reason: string };

/**
 * Resolves the directory a claim's `--worktree` value stands for — the ONE branch→directory resolver
 * (the sibling {@link resolveClaimHead} resolves the same value to a sha). Lore's dispatch protocol records the
 * BRANCH name, so reading the value only as a path made every real claim look `gone`.
 *
 * An ABSOLUTE value naming an existing directory is the worktree itself. Otherwise the value is a branch name,
 * matched exactly against `git worktree list --porcelain` run from `repoCwd` (any worktree of the repo; the list
 * is repo-wide). A relative value is never read as a directory (same rule as `resolveClaimHead`). A failed
 * `git worktree list` is `not-measured` — never `unresolved`: an unreadable list must not read as "gone".
 *
 * @example
 * resolveClaimWorktree(probe, "agent-x", "/repo") // → {kind:"resolved", path:"/wt/agent-x", source:"branch"}
 */
export function resolveClaimWorktree(probe: WorktreeGitProbe, value: string, repoCwd: string): WorktreeResolution {
  if (isAbsolute(value) && probe.pathExists(value)) return { kind: "resolved", path: value, source: "worktree" };
  const pathLookup = isAbsolute(value) ? `no directory at path ${value}` : `${value} is not an absolute path`;
  const listed = probe.listWorktrees(repoCwd);
  if (!listed.ok) return { kind: "not-measured", reason: `${pathLookup}; git worktree list failed: ${listed.reason}` };
  const match = listed.value.find((entry) => entry.branch === value);
  if (match !== undefined) return { kind: "resolved", path: match.path, source: "branch" };
  return { kind: "unresolved", lookups: `${pathLookup}; no worktree has branch ${value}` };
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
      return { decision: "gone", reason: facts.lookups ?? "path does not exist" };
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

/** Resolved + canonical forms of a claim's worktree value (a branch name is first resolved to its directory). */
function normalizedForms(probe: WorktreeGitProbe, value: string): string[] {
  const resolution = resolveClaimWorktree(probe, value, probe.currentWorkingDirectory());
  const path = resolution.kind === "resolved" ? resolution.path : value;
  // reason: an unresolved recorded value that is not absolute is a branch name; it has no directory form, and
  // resolving it lexically or on disk would read the process's working directory.
  if (!isAbsolute(path)) return [path];
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
): Promise<{ readonly facts: WorktreeFacts; readonly worktreePath?: string; readonly repoRoot?: string; readonly branch?: string }> {
  const resolution = resolveClaimWorktree(probe, recorded.path, probe.currentWorkingDirectory());
  if (resolution.kind === "unresolved") return { facts: { kind: "gone", lookups: resolution.lookups } };
  if (resolution.kind === "not-measured") return { facts: { kind: "not-measured", reason: resolution.reason } };
  const worktreePath = resolution.path;

  const forms = normalizedForms(probe, worktreePath);
  if (forms.some((form) => activeClaimedPaths.has(form))) return { facts: { kind: "claimed-by-active-task" }, worktreePath };

  const listed = probe.listWorktrees(worktreePath);
  if (!listed.ok) return { facts: { kind: "not-measured", reason: `git worktree list failed: ${listed.reason}` } };
  const entries = listed.value;
  const real = probe.realPath(worktreePath);
  const index = entries.findIndex((entry) => probe.realPath(entry.path) === real);
  if (index < 0) return { facts: { kind: "not-measured", reason: "not a linked worktree of its repository" } };
  const entry = entries[index] as ListedWorktree;
  const repoRoot = (entries[0] as ListedWorktree).path;
  const branch = entry.branch;

  const removalFacts = await removal.gatherRemovalFacts(worktreePath, callerSession);
  let ownCommitCount: Measured<number>;
  if (index === 0) ownCommitCount = { ok: false, reason: "main checkout" };
  else if (branch === undefined) ownCommitCount = { ok: false, reason: "detached HEAD (no branch to delete)" };
  else if (recorded.baseSha === undefined) {
    ownCommitCount = { ok: false, reason: "no claim-time base recorded (claim predates worktree-cleanup tracking)" };
  } else {
    const own = probe.countCommits(worktreePath, `${recorded.baseSha}..${branch}`);
    ownCommitCount = own.ok ? own : { ok: false, reason: `own-commit count failed: ${own.reason}` };
  }
  return {
    facts: { kind: "measured", removal: removalFacts, ownCommitCount },
    worktreePath,
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
  const worktree = gathered.worktreePath ?? recorded.path;
  // AC-AU-11: the removal test (above, unchanged) decides keep/removable first; only a `remove` reaches decide().
  // reason: a port without `gateRemoval` is a bare unit construction (no autonomy wiring); every shipped
  // composition root hands in `WorktreeRemovalService`, which has it.
  if (decision.decision === "remove" && gathered.worktreePath !== undefined && isWorktreeRemovalGatePort(removal)) {
    const gate = await removal.gateRemoval(gathered.worktreePath);
    if (!gate.allowed) return { worktree, decision: "keep", reason: gate.reason };
  }
  return {
    // the resolved directory when one was found, so removal and every printed line name the real path
    worktree,
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
 * | `worktree: gone <value>: <path lookup>; <branch lookup>`.
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
      return `worktree: gone ${outcome.worktree}: ${outcome.reason}`;
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
/**
 * @param cwd - the directory the invocation runs in (`Invocation.cwd`), answered by `currentWorkingDirectory()`
 */
export function createRealWorktreeProbe(cwd: string): WorktreeGitProbe {
  return {
    // reason: a relative path is resolved by the OS against the process's working directory; a recorded value that is
    // not absolute is a branch name, never a place on disk (resolveClaimWorktree states the same rule).
    pathExists: (path) => isAbsolute(path) && existsSync(path),
    realPath: (path) => {
      if (!isAbsolute(path)) return path;
      try {
        return realpathSync(path);
      } catch {
        // reason: an unresolvable path (deleted, permissions) has no canonical form; the caller
        // compares the resolved input instead — never a measurement, so nothing is fabricated.
        return resolve(path);
      }
    },
    currentWorkingDirectory: () => cwd,
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
    pathExistsAtRef: (cwd, ref, path) => {
      const out = runGit(cwd, ["ls-tree", "--full-tree", "--name-only", ref, "--", path]);
      return out.ok ? { ok: true, value: out.value.split("\n").some((line) => line === path) } : out;
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
    ignoredPaths: (path) => {
      const out = runGit(path, ["status", "--ignored", "--porcelain"]);
      if (!out.ok) return out;
      const ignored = out.value
        .split("\n")
        .filter((line) => line.startsWith("!! "))
        .map((line) => line.slice(3).replace(/^"(.*)"$/, "$1"));
      return { ok: true, value: ignored };
    },
    ignoredPathIdenticalToMain: (path, relPath) => {
      const listed = runGit(path, ["worktree", "list", "--porcelain"]);
      if (!listed.ok) return listed;
      const main = parseListPorcelain(listed.value)[0];
      if (main === undefined) return { ok: false, reason: "git worktree list named no main checkout" };
      if (resolve(main.path) === resolve(path)) return { ok: true, value: false };
      try {
        return { ok: true, value: isPathIdenticalUnder(path, main.path, relPath) };
      } catch (cause) {
        return { ok: false, reason: `identity compare failed: ${cause instanceof Error ? cause.message : String(cause)}` };
      }
    },
    scratchOwner: (path) => {
      const markerPath = join(dirname(path), SCRATCH_OWNER_FILE);
      if (!existsSync(markerPath)) return { ok: true, value: null };
      try {
        const parsed: unknown = JSON.parse(readFileSync(markerPath, "utf8"));
        const pid = (parsed as { pid?: unknown } | null)?.pid;
        return typeof pid === "number" && Number.isInteger(pid) && pid > 0
          ? { ok: true, value: { pid } }
          : { ok: false, reason: `owner marker ${markerPath} carries no valid pid` };
      } catch (cause) {
        return { ok: false, reason: `owner marker ${markerPath} unreadable: ${cause instanceof Error ? cause.message : String(cause)}` };
      }
    },
    isPidAlive: (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (cause) {
        // reason: ESRCH = no such process (dead); EPERM = exists but not ours (alive). Anything else is unprobeable -> alive.
        return (cause as NodeJS.ErrnoException).code !== "ESRCH";
      }
    },
    removeScratchWorktree: (repoRoot, path) => {
      if (!isFalsifierScratchPath(path)) return { ok: false, reason: `${path} is not a falsifier scratch worktree path` };
      // reason: --force is allowed ONLY here — a scratch worktree is dirty by construction (the declared mutation is
      // applied inside it); the decide(worktree-remove) gate has already ruled on its ignored files.
      const out = runGit(repoRoot, ["worktree", "remove", "--force", path]);
      try {
        rmSync(dirname(path), { recursive: true, force: true });
      } catch (cause) {
        return { ok: false, reason: `scratch dir not removed: ${cause instanceof Error ? cause.message : String(cause)}` };
      }
      return out.ok ? { ok: true, value: true } : out;
    },
  };
}
