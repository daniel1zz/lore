/**
 * Derives a plan's review diff from each landing `lore integrate` recorded (`extra.landing`: `main_before`,
 * `landing_commit`): per changed file, the NET diff across the plan's landings (`assess-final-state-diff.ts`, BR-1508).
 * Commits and tasks are still read per landing (#459). A task with no landing record has no
 * measured diff: it is named in `unlanded_tasks` (and `tasks_not_measured`), never attributed by searching commit messages
 * for its slug (BR-1291, BR-1336), and there is NO commit-range fallback (the old first-parent range derivation admitted
 * another plan's commits, #459, and was removed with the facts-layer work).
 *
 * Zero attributed commits is reported as the named status `"no_commits_found"`, or, when every task of the plan is already
 * `archived` (merged work is a certainty), `"unverifiable_convention_mismatch"`: the dimension it would inform must be
 * reported unverifiable, never scored. Neither is ever silently downgraded to an empty `"derived"` diff.
 *
 * Source: spec-the-milestone-review-measures-its-facts-per-landing-and (AC-AF-8); SPEC-026 §3 D3;
 * adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the;
 * spec-a-task-is-archived-only-on-a-landing-lore-recorded-one
 */

import { spawnSync } from "node:child_process";
import { buildFinalStateDiff } from "./assess-final-state-diff.js";

/** Explicit maxBuffer — the 1 MiB spawnSync default silently truncates a growing diff/log payload. */
const GIT_MAX_BUFFER = 20 * 1024 * 1024;

/**
 * How one task's commits were found: `recorded_range` (the landing recorded on the task), or `not_measured`
 * (no usable landing record — never guessed from commit messages), or `no_code` (a corpus-only task, BR-1509).
 */
export type TaskAttribution = "recorded_range" | "not_measured" | "no_code";

/** One commit selected into the derived diff, and which task slug(s) referenced it. */
export interface DerivedCommit {
  sha: string;
  subject: string;
  matched_task_slugs: string[];
}

/**
 * Result of {@link deriveLandingDiffForPlan} — always returned, never throws. `warnings`
 * collects non-fatal git-command failures — informational only, never a reason to fail the whole derivation.
 *
 * @invariant `"no_commits_found"` and `"unverifiable_convention_mismatch"` are DISTINCT
 *   values, never collapsed into one shared empty result (adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the
 *   Q2: "an empty result and a clean result must not be the same value"). `"no_commits_found"` means "this plan
 *   plausibly has no merged work yet"; `"unverifiable_convention_mismatch"` means "this plan's tasks are ALL archived
 *   (merged work is a certainty) yet zero commits were derived" (a contradiction; the dimension it would otherwise
 *   inform must be reported unverifiable, never scored).
 */
export interface CommitDerivationResult {
  status: "derived" | "no_commits_found" | "unverifiable_convention_mismatch";
  commits: DerivedCommit[];
  /** Task slugs for which NO commit was attributed (a superset of `tasks_not_measured`). */
  tasks_without_commits: string[];
  /** Task slugs with NO usable landing record — their commits were never measured ("not measured" is never "zero commits", issue #180). */
  tasks_not_measured: string[];
  /** How each task's commits were found, per slug. */
  attribution: Record<string, TaskAttribution>;
  /** Always `0` here: a landing's range is exact, nothing merged in from main is ever in it. Kept for the stored diff-source line. */
  excluded_merged_commit_count: number;
  /** The reviewer's diff: one NET diff per changed file (BR-1508). `""` unless status is `"derived"`. */
  diff_text: string;
  /** Files of landings that could not be mapped to main: shown to no call, so gates over them are not-measured. */
  not_seen_files: string[];
  warnings: string[];
}

/**
 * The one-line "N landing(s) (each main_before..landing_commit), M commit(s)" summary of a landing-derived diff — the
 * single rendering both the stderr announcement and the persisted `Diff source:` line use. A diff is built from landings,
 * never from a commit range, so the wording names landings.
 */
export function describeLandingCount(landingCount: number, commitCount: number): string {
  return `${String(landingCount)} landing(s), ${String(commitCount)} commit(s): each file's net diff from its first landing's main_before to the main commit of its last landing (final state, not intermediate landings)`;
}

/**
 * How a `lore assess` run's diff (if any) was obtained — persisted on the review's `diff_source` and surfaced in the
 * `--json`/MCP envelopes, so `diff_available` alone is never the only auditable signal.
 */
export type DiffSourceRecord =
  | { mode: "explicit_diff"; range: string }
  | { mode: "explicit_diff_file"; path: string }
  /** MCP-only override — the caller passed pre-acquired `diff_text` directly (MCP has no subprocess/file-read seam of its own). */
  | { mode: "explicit_diff_text" }
  | ({ mode: "auto_derived" } & CommitDerivationResult & { landings?: readonly PlanLanding[] });

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

/** One landing of a plan's tasks as the review measures it: the range `main_before..landing_commit` and its landed footprint. */
export interface PlanLanding {
  landing_commit: string;
  main_before: string;
  /** Slugs of the plan's tasks recorded as landing in this commit. */
  task_slugs: string[];
  /** This landing's `outside_anchors` (BR-1346); `undefined` when the landing did not measure it. */
  outside_anchors: string[] | undefined;
  /**
   * MEASURED from the range, never copied from the stored `kind` label: `true` iff `main_before === landing_commit` (the
   * landing put nothing on main, so it contributes no diff).
   */
  range_empty: boolean;
}

/** {@link CommitDerivationResult} for a diff built from landings, plus the facts the review gates read. */
export interface LandingDerivationResult extends CommitDerivationResult {
  /** Tasks of the plan with NO usable landing: named, no diff; regression and security become not-measured. */
  unlanded_tasks: string[];
  /** Corpus-only tasks (BR-1509): no file anchors, never claimed on a branch, no landing record. They contribute nothing and are never unlanded. */
  no_code_tasks: string[];
  /** Every distinct landing of the plan (one per landing commit), in task order. */
  landings: PlanLanding[];
}

/** The slice of a task the landing derivation reads (`landing` = parsed `extra.landing`, `undefined` = none). */
export interface LandingTaskInput {
  slug: string;
  /** `true` for a corpus-only task (`isCorpusOnlyTask`, BR-1509); absent for every other task. */
  corpus_only?: boolean;
  landing:
    | {
        main_before: string;
        landing_commit: string;
        outside_anchors?: string[] | undefined;
      }
    | undefined;
}

/**
 * Builds a plan's review diff from each landing's own range: `git diff <main_before> <landing_commit>` per distinct
 * landing. `main_before` is main's head when the branch landed, so commits other plans put on main between two
 * landings are never in a landing's range (#459). A task with no landing record contributes nothing and is named in
 * `unlanded_tasks`; there is NO commit-range fallback. A landing whose `main_before` equals its `landing_commit` contributes
 * nothing and its tasks are named in `tasks_without_commits`; the stored `kind` is never consulted. Never throws: a landing whose objects are missing is a warning
 * and its task is reported unlanded.
 *
 * @param cwd - repository root
 * @param tasks - every task of the plan with its parsed landing
 * @param allTasksArchived - whether every task is archived (zero commits then is `unverifiable_convention_mismatch`)
 * @param options - `ref`: the ref landings are placed on (default `main`); `env`: environment for git
 */
export function deriveLandingDiffForPlan(
  cwd: string,
  tasks: readonly LandingTaskInput[],
  allTasksArchived: boolean,
  options: { readonly env?: NodeJS.ProcessEnv; readonly ref?: string } = {},
): LandingDerivationResult {
  const warnings: string[] = [];
  const unlanded: string[] = [];
  const noCode: string[] = [];
  const withoutCommits: string[] = [];
  const attribution: Record<string, TaskAttribution> = {};
  const landings = new Map<string, PlanLanding>();
  const landingCommits = new Map<string, string[]>();
  const commitMap = new Map<string, { subject: string; taskSlugs: Set<string> }>();

  const markUnlanded = (slug: string): void => {
    unlanded.push(slug);
    withoutCommits.push(slug);
    attribution[slug] = "not_measured";
  };

  for (const task of tasks) {
    const l = task.landing;
    // reason: BR-1509 — a corpus-only task changes no code: it has no diff and no landing to measure, so it is listed as
    // having no code and is never `unlanded` (which would make regression and security not measured).
    if (l === undefined && task.corpus_only === true) {
      noCode.push(task.slug);
      attribution[task.slug] = "no_code";
      continue;
    }
    if (l === undefined) {
      markUnlanded(task.slug);
      continue;
    }
    const known = landings.get(l.landing_commit);
    if (known !== undefined) {
      known.task_slugs.push(task.slug);
      attribution[task.slug] = "recorded_range";
      for (const sha of landingCommits.get(l.landing_commit) ?? []) commitMap.get(sha)?.taskSlugs.add(task.slug);
      if (known.range_empty) withoutCommits.push(task.slug);
      continue;
    }
    const entry: PlanLanding = {
      landing_commit: l.landing_commit,
      main_before: l.main_before,
      task_slugs: [task.slug],
      outside_anchors: l.outside_anchors,
      range_empty: l.main_before === l.landing_commit,
    };
    // reason: spec "Diff" (BR-1372) — the stored `kind` label is never trusted: only an empty range (main_before ==
    // landing_commit) contributes nothing; a landing labelled no-change whose range is non-empty is measured below.
    if (entry.range_empty) {
      landings.set(l.landing_commit, entry);
      attribution[task.slug] = "recorded_range";
      withoutCommits.push(task.slug);
      continue;
    }
    if (!commitExists(cwd, l.landing_commit) || !commitExists(cwd, l.main_before)) {
      warnings.push(`${task.slug}: landing ${l.main_before}..${l.landing_commit} not found in this repository — the task is treated as unlanded`);
      markUnlanded(task.slug);
      continue;
    }
    const log = runGit(cwd, ["log", "--no-merges", "--reverse", "--format=%H%x09%s", `${l.main_before}..${l.landing_commit}`]);
    if (!log.ok) {
      warnings.push(log.warning);
      markUnlanded(task.slug);
      continue;
    }
    landings.set(l.landing_commit, entry);
    attribution[task.slug] = "recorded_range";
    const shas: string[] = [];
    for (const c of parseLogLines(log.stdout)) {
      shas.push(c.sha);
      const existing = commitMap.get(c.sha);
      if (existing) existing.taskSlugs.add(task.slug);
      else commitMap.set(c.sha, { subject: c.subject, taskSlugs: new Set([task.slug]) });
    }
    landingCommits.set(l.landing_commit, shas);
  }

  const base = {
    tasks_without_commits: withoutCommits,
    tasks_not_measured: [...unlanded],
    attribution,
    excluded_merged_commit_count: 0,
    warnings,
    unlanded_tasks: unlanded,
    no_code_tasks: noCode,
    landings: [...landings.values()],
  };
  if (commitMap.size === 0) {
    return { ...base, status: allTasksArchived ? "unverifiable_convention_mismatch" : "no_commits_found", commits: [], diff_text: "", not_seen_files: [] };
  }
  // reason: BR-1508 — the reviewer reads each file's NET diff, not the union of per-landing diffs; one diff path only.
  const net = buildFinalStateDiff(
    cwd,
    options.env ?? process.env,
    options.ref ?? "main",
    [...landingCommits.keys()].map((commit) => {
      const landing = landings.get(commit) as PlanLanding;
      return { landing_commit: landing.landing_commit, main_before: landing.main_before };
    }),
  );
  warnings.push(...net.warnings);
  return {
    ...base,
    status: "derived",
    commits: [...commitMap.entries()].map(([sha, e]) => ({ sha, subject: e.subject, matched_task_slugs: [...e.taskSlugs].sort() })),
    diff_text: net.diff_text,
    not_seen_files: [...net.not_seen_files],
  };
}
