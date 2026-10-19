/**
 * Derives a plan's OWN commit set from the commit range each task RECORDED (`extra.landing`, written by `lore
 * integrate`; else `extra.commit_range`, written at done time). A task with no recorded range is reported as NOT
 * MEASURED (named in `tasks_not_measured`, `attribution: "not_measured"`) — it is never attributed by searching
 * commit messages for its slug, because that guess silently attributes (or misses) work (BR-1291, BR-1336). Under
 * concurrency a plan's commits are not contiguous in `main`, so a recorded per-task range (not one plan-wide range)
 * is the only sound source.
 *
 * Shared by both adapters that create an assessment (CLI `commands/assess.ts`, MCP `../mcp/tools.ts`).
 *
 * Per task: the own commits of a recorded range are the non-merge commits on the first-parent chain of `base..head`
 * (see {@link resolveRecordedRange}); each is diffed against its own first parent. A recorded range whose commit
 * objects are missing is NOT MEASURED too, with a warning.
 *
 * Zero attributed commits is reported as the named status `"no_commits_found"`, or — when every task of the plan is
 * already `archived` (merged work is a certainty) — `"unverifiable_convention_mismatch"`: the dimension it would
 * inform must be reported unverifiable, never scored. Neither is ever silently downgraded to an empty `"derived"` diff.
 *
 * Source: task-lore-assess-asks-the-caller-for-a-git-range-that-cannot-be; SPEC-026 §3 D3;
 * adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the;
 * spec-a-task-is-archived-only-on-a-landing-lore-recorded-one
 */

import { spawnSync } from "node:child_process";

/** Explicit maxBuffer — the 1 MiB spawnSync default silently truncates a growing diff/log payload. */
const GIT_MAX_BUFFER = 20 * 1024 * 1024;

/** git's well-known empty-tree object — the diff base for a root commit (no parents). */
const EMPTY_TREE_SHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/**
 * How one task's commits were found: `recorded_range` (a range recorded on the task), or `not_measured`
 * (no usable recorded range — never guessed from commit messages).
 */
export type TaskAttribution = "recorded_range" | "not_measured";

/**
 * A commit range recorded by `lore done` for one task. `base` absent = the claim predates
 * `base_sha`: only `head` is known, so only the head commit is attributed (a lower bound).
 */
export interface RecordedRange {
  base?: string;
  head: string;
  /** The branch/worktree the range was recorded for. */
  worktree?: string;
}

/** One commit selected into the derived diff, and which task slug(s) referenced it. */
export interface DerivedCommit {
  sha: string;
  subject: string;
  matched_task_slugs: string[];
}

/**
 * Result of {@link deriveCommitSetForPlan} — always returned, never throws. `warnings`
 * collects non-fatal git-command failures (e.g. a transient `merge-base` error) —
 * informational only, never a reason to fail the whole derivation.
 *
 * @invariant `"no_commits_found"` and `"unverifiable_convention_mismatch"` are DISTINCT
 *   values, never collapsed into one shared empty result (SPEC per
 *   adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the Q2: "an empty result
 *   and a clean result must not be the same value"). `"no_commits_found"` means "this
 *   plan plausibly has no merged work yet" (a legitimate, scoreable absence);
 *   `"unverifiable_convention_mismatch"` means "this plan's tasks are ALL archived
 *   (merged work is a certainty) yet zero commits matched — the commit-message
 *   convention was not followed, not that nothing happened" (a contradiction; the
 *   dimension it would otherwise inform must be reported unverifiable, never scored).
 */
export interface CommitDerivationResult {
  status: "derived" | "no_commits_found" | "unverifiable_convention_mismatch";
  commits: DerivedCommit[];
  /** Task slugs for which NO commit was attributed (a superset of `tasks_not_measured`). */
  tasks_without_commits: string[];
  /**
   * Task slugs with NO recorded range AND no slug match — their commits were never measured.
   * Distinct from a task whose recorded range measured zero commits (`attribution` is
   * `"recorded_range"` with no commit): "not measured" must never read as "zero commits"
   * (issue #180).
   */
  tasks_not_measured: string[];
  /** How each task's commits were found, per slug. */
  attribution: Record<string, TaskAttribution>;
  /**
   * Commits inside a recorded range that were NOT the task's own work: they reached the task
   * branch through `git merge main` (lore integrate's documented conflict-resolution step), so
   * they are excluded from `commits` and `diff_text`. Reported so the exclusion is auditable
   * ("N commits, excluding M merged in from main"). `0` when no recorded range merged anything.
   */
  excluded_merged_commit_count: number;
  /** Concatenated unified diff across every selected commit, oldest first. `""` unless status is `"derived"`. */
  diff_text: string;
  warnings: string[];
}

/**
 * The one-line "N commits, excluding M merged in from main" summary of a derivation — the
 * single rendering both the stderr announcement and the persisted `Diff source:` line use.
 */
export function describeCommitCount(commitCount: number, excludedMergedCount: number): string {
  return `${String(commitCount)} commit(s), excluding ${String(excludedMergedCount)} merged in from main`;
}

/**
 * How a `lore assess` run's diff (if any) was obtained — persisted on the created
 * assessment doc's `extra.diff_source` (additive `.passthrough()` key, never a core
 * `assessmentResultSchema` change) and surfaced in both adapters' `--json`/MCP
 * envelopes, so `diff_available` alone is never the only auditable signal (AC #3,
 * task-lore-assess-asks-the-caller-for-a-git-range-that-cannot-be).
 */
export type DiffSourceRecord =
  | { mode: "explicit_diff"; range: string }
  | { mode: "explicit_diff_file"; path: string }
  /** MCP-only override — the caller passed pre-acquired `diff_text` directly (MCP has no subprocess/file-read seam of its own). */
  | { mode: "explicit_diff_text" }
  | ({ mode: "auto_derived" } & CommitDerivationResult);

/** Runs one git subprocess; never throws — failures are reported via the returned shape. */
function runGit(cwd: string, args: string[]): { ok: true; stdout: string } | { ok: false; warning: string } {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: GIT_MAX_BUFFER });
  if (result.error) {
    return { ok: false, warning: `git ${args.join(" ")}: ${result.error.message}` };
  }
  if (result.status !== 0) {
    const reason = (result.stderr ?? "").trim() || `exit ${String(result.status)}`;
    return { ok: false, warning: `git ${args.join(" ")}: ${reason}` };
  }
  return { ok: true, stdout: result.stdout ?? "" };
}

/** The immediate parent shas of `sha` (0 for a root commit, 2+ for a merge commit). */
function parentsOf(cwd: string, sha: string, warnings: string[]): string[] {
  const result = runGit(cwd, ["rev-list", "--parents", "-1", sha]);
  if (!result.ok) {
    warnings.push(result.warning);
    return [];
  }
  const tokens = result.stdout.trim().split(/\s+/).filter((t) => t.length > 0);
  return tokens.slice(1); // drop the sha itself, keep parent sha(s)
}

/** `git diff <first-parent-or-empty-tree> <sha>` — exactly what this ONE commit introduced. */
function diffAgainstFirstParent(cwd: string, sha: string, warnings: string[]): string {
  const parents = parentsOf(cwd, sha, warnings);
  const base = parents[0] ?? EMPTY_TREE_SHA;
  const result = runGit(cwd, ["diff", base, sha]);
  if (!result.ok) {
    warnings.push(result.warning);
    return "";
  }
  return result.stdout;
}

/** `true` iff `sha` names a commit object present in the repo. */
function commitExists(cwd: string, sha: string): boolean {
  return runGit(cwd, ["cat-file", "-e", `${sha}^{commit}`]).ok;
}

/** Parses `%H%x09%s` log lines. */
function parseLogLines(stdout: string): { sha: string; subject: string }[] {
  const commits: { sha: string; subject: string }[] = [];
  for (const line of stdout.split("\n")) {
    const tab = line.indexOf("\t");
    if (line.length === 0 || tab === -1) continue;
    commits.push({ sha: line.slice(0, tab), subject: line.slice(tab + 1) });
  }
  return commits;
}

/**
 * Resolves one task's recorded range to its commits (oldest first) and the diff of the range.
 * `undefined` when the range cannot be verified (a missing object) — the caller reports the task
 * as not measured and the warning says why. Never throws.
 */
function resolveRecordedRange(
  cwd: string,
  slug: string,
  range: RecordedRange,
  warnings: string[],
): { commits: { sha: string; subject: string }[]; diff: string; excludedMerged: number } | undefined {
  if (!commitExists(cwd, range.head) || (range.base !== undefined && !commitExists(cwd, range.base))) {
    warnings.push(
      `${slug}: recorded commit range ${range.base ?? "(none)"}..${range.head} not found in this repository — the task is not measured`,
    );
    return undefined;
  }
  if (range.base === undefined) {
    warnings.push(
      `${slug}: recorded range is head-only (the claim predates base_sha) — only the head commit ${range.head.slice(0, 12)} is attributed`,
    );
    const log = runGit(cwd, ["log", "-1", "--format=%H%x09%s", range.head]);
    if (!log.ok) {
      warnings.push(log.warning);
      return undefined;
    }
    const commits = parseLogLines(log.stdout);
    const head = commits[0];
    if (head === undefined) return undefined;
    return { commits, diff: diffAgainstFirstParent(cwd, head.sha, warnings), excludedMerged: 0 };
  }
  // Rule: a task's OWN commits are the non-merge commits on the FIRST-PARENT chain of its head.
  // The integrate model merges main INTO the task branch (`git merge main`), so everything main
  // contributed arrives as a merge commit's SECOND parent and is never on the first-parent chain;
  // the task's own commits always are. `base..head` alone also lists every merged-in main commit,
  // which is the defect this replaces (a peer session's unrelated rewrite landed in the plan's diff).
  // Residual: a branch that fast-forwarded to main (no merge commit) leaves main's commits on the
  // first-parent chain and cannot be told apart from own commits here.
  const all = runGit(cwd, ["rev-list", "--count", `${range.base}..${range.head}`]);
  if (!all.ok) {
    warnings.push(all.warning);
    return undefined;
  }
  const log = runGit(cwd, [
    "log",
    "--first-parent",
    "--no-merges",
    "--reverse",
    "--format=%H%x09%s",
    `${range.base}..${range.head}`,
  ]);
  if (!log.ok) {
    warnings.push(log.warning);
    return undefined;
  }
  const commits = parseLogLines(log.stdout);
  // Everything in base..head that is not an own commit: the main commits merged in, plus the merge
  // commits themselves (whose content is main's, so it is never diffed).
  const excludedMerged = Math.max(0, Number.parseInt(all.stdout.trim(), 10) - commits.length);
  const diff = commits.map((c) => diffAgainstFirstParent(cwd, c.sha, warnings)).join("");
  return { commits, diff, excludedMerged };
}

/**
 * Derives the commit set + assembled diff for a plan's own tasks from their RECORDED ranges. Never throws — every
 * git-command failure degrades to a warning, and the affected task is reported as not measured (never guessed by
 * searching commit messages for its slug).
 *
 * ADR three-question review (adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the),
 * for the `allTasksArchived` → `"unverifiable_convention_mismatch"` branch specifically:
 *   1. **Proxy** — "every task archived" is a proxy for "merged work exists", not the
 *      property itself. Concrete input satisfying the proxy while the property still
 *      somehow failed: none is known — the lifecycle graph (`VALID_TRANSITIONS`)
 *      structurally requires a task to have passed through review/evidence gates to reach
 *      `archived`, so this proxy is as strong as the lifecycle graph it reads. What it
 *      does NOT distinguish (deliberately, per the task's own oracle) is genuinely-lost
 *      history (squashed/rewritten) from a convention mismatch — both are real causes of
 *      "cannot verify", and both get the identical honest answer.
 *   2. **Silence** — this is precisely what closes: zero commits on an all-archived plan
 *      used to collapse into the SAME `"no_commits_found"` value a genuinely-empty plan
 *      gets, which downstream (`AIProviderService.assessPlan`) let an absence-based
 *      `scope_fidelity` score publish as a real finding. `"unverifiable_convention_mismatch"`
 *      is a distinct, named value a caller MUST branch on — never a bare boolean/empty
 *      collapse.
 *   3. **Opt-in** — CLOSED (task-the-mcp-assess-adapter-still-calls-derivecommitsetforplan):
 *      `allTasksArchived` is now a REQUIRED third parameter — no default, no `?`. It was
 *      briefly optional-with-a-default ONLY so the pre-existing 2-arg
 *      `deriveCommitSetForPlan(cwd, taskSlugs)` call site in `../mcp/tools.ts` kept
 *      compiling while a concurrent session's file anchors excluded that file — which is
 *      exactly the proxy that let the MCP adapter's omission go unnoticed by the type
 *      checker (it still compiled, still passed all 12 pre-existing tests, and still
 *      silently reported `"no_commits_found"` for the contradiction state). Both adapters
 *      that create an assessment (CLI `commands/assess.ts`, MCP `../mcp/tools.ts`) now
 *      compute this fact from their own already-loaded `bundle.tasks` and MUST pass it — a
 *      third adapter that forgets fails `bun run typecheck`, not silently at runtime.
 *
 * @param cwd - Repository root to run git in (callers pass `process.cwd()` in
 *   production; tests pass a throwaway `git init` fixture directory).
 * @param taskSlugs - Every task-in-plan's slug (`bundle.tasks.map(t => t.slug)`).
 * @param recordedRanges - REQUIRED (no default, same reason as `allTasksArchived`): slug -> the range
 *   `lore integrate` recorded in `extra.landing` (else `extra.commit_range`). A task without one, or whose range
 *   cannot be verified, is NOT MEASURED (`tasks_not_measured`, `attribution: "not_measured"`).
 * @param allTasksArchived - REQUIRED. Whether EVERY task in the plan already has
 *   `status === "archived"` (caller-computed — this module never imports `@lore/core`'s
 *   `DocStatus` to stay a pure git wrapper). No default: every caller must compute and
 *   pass this fact explicitly (task-the-mcp-assess-adapter-still-calls-
 *   derivecommitsetforplan — see the ADR three-question review above, Q3).
 * @returns `status: "no_commits_found"` when no commit was attributed from any recorded range AND
 *   `allTasksArchived` is `false` — a named, honest boundary state, never a silent empty `"derived"` diff.
 *   `status: "unverifiable_convention_mismatch"` for that SAME zero-commit condition when `allTasksArchived` IS
 *   `true` — a distinct value, never collapsed with the above.
 *
 * @example
 * deriveCommitSetForPlan("/repo", ["task-a"], false, new Map([["task-a", { base: "abc", head: "def" }]]));
 * // → { status: "derived", commits: [...], tasks_not_measured: [], attribution: { "task-a": "recorded_range" }, ... }
 * @example
 * deriveCommitSetForPlan("/repo", ["task-b"], true, new Map()); // every task archived, none recorded
 * // → { status: "unverifiable_convention_mismatch", tasks_not_measured: ["task-b"], attribution: { "task-b": "not_measured" }, ... }
 */
export function deriveCommitSetForPlan(
  cwd: string,
  taskSlugs: string[],
  allTasksArchived: boolean,
  recordedRanges: ReadonlyMap<string, RecordedRange>,
): CommitDerivationResult {
  const warnings: string[] = [];
  const tasksWithoutCommits: string[] = [];
  const tasksNotMeasured: string[] = [];
  const attribution: Record<string, TaskAttribution> = {};
  const rangeCommits = new Map<string, { subject: string; taskSlugs: Set<string> }>();
  const rangeDiffs: string[] = [];
  let excludedMergedCommitCount = 0;

  for (const slug of taskSlugs) {
    const recorded = recordedRanges.get(slug);
    const resolvedRange = recorded === undefined ? undefined : resolveRecordedRange(cwd, slug, recorded, warnings);
    if (resolvedRange === undefined) {
      // reason: BR-1291 — no usable recorded range is NOT MEASURED; a task is never attributed by guessing from commit messages.
      tasksWithoutCommits.push(slug);
      tasksNotMeasured.push(slug);
      attribution[slug] = "not_measured";
      continue;
    }
    attribution[slug] = "recorded_range";
    excludedMergedCommitCount += resolvedRange.excludedMerged;
    if (resolvedRange.commits.length === 0) {
      // Measured zero: the range was recorded and is empty. NOT "not measured".
      tasksWithoutCommits.push(slug);
      continue;
    }
    for (const c of resolvedRange.commits) {
      const existing = rangeCommits.get(c.sha);
      if (existing) existing.taskSlugs.add(slug);
      else rangeCommits.set(c.sha, { subject: c.subject, taskSlugs: new Set([slug]) });
    }
    rangeDiffs.push(resolvedRange.diff);
  }

  if (rangeCommits.size === 0) {
    return {
      // reason: zero attributed commits on an all-archived plan is a CONTRADICTION (archived tasks
      // have merged work by definition) — reported as a distinct, named "cannot verify"
      // value, never silently folded into the same "no_commits_found" a genuinely
      // commit-less (still in-progress) plan gets
      // (adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the Q2).
      status: allTasksArchived ? "unverifiable_convention_mismatch" : "no_commits_found",
      commits: [],
      tasks_without_commits: [...taskSlugs],
      tasks_not_measured: tasksNotMeasured,
      attribution,
      excluded_merged_commit_count: excludedMergedCommitCount,
      diff_text: "",
      warnings,
    };
  }

  const commits: DerivedCommit[] = [...rangeCommits.entries()].map(([sha, e]) => ({
    sha,
    subject: e.subject,
    matched_task_slugs: [...e.taskSlugs].sort(),
  }));
  const diffText = rangeDiffs.join("");

  return {
    status: "derived",
    commits,
    tasks_without_commits: tasksWithoutCommits,
    tasks_not_measured: tasksNotMeasured,
    attribution,
    excluded_merged_commit_count: excludedMergedCommitCount,
    diff_text: diffText,
    warnings,
  };
}
