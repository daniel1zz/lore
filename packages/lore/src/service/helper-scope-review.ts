/**
 * helper-scope-review — judges the files a helper run changed against the tasks it claimed
 * (spec session-trail, Design > Consumers "Helper scope", "Judging each helper end once"; AC-ST-8).
 *
 * Public surface: {@link reviewHelperScope} (trail + claimed-tasks port -> findings), types
 * {@link HelperScopeFinding}, {@link HelperScopeReview}, {@link ClaimedTasksPort}.
 *
 * @invariant Side-effect class: pure apart from the injected `realpath` and `claimedTasks` ports; it reads no
 *   file, writes nothing and never marks a helper judged (`judged_end_count` has one writer: the turn-end hook).
 * @invariant A helper's files are its measured changes (paths relative to its working copy) UNION the files named
 *   by any turn's edit records for that helper run (absolute as recorded, so a write by absolute path into
 *   another checkout is visible).
 * @invariant Attribution of MEASURED changes (decision (b), AU-T19). A helper record's measured diff is
 *   `diff(base, working tree)` taken at its stop — everything in the working copy, not what the helper itself
 *   changed — and every file in it is stamped with the helper's own run. Measured on session c1ffea04: 10 of 30
 *   helper records have `started_at == ended_at` (no SubagentStart record preceded the stop, so there is no
 *   start-time state to diff against) and helpers of one worktree (`a1714a6b…`, `a3228ca7…`, `a8bb13b6…` in
 *   `agent-a3228ca7…`) carry the same base and the same 32 files. A start snapshot (a) therefore cannot be
 *   built from what SubagentStart provides (a bare `{run, started_at, end_count:0}` record, written by a hook
 *   that must stay silent and cheap), and for the records above it would be absent. So helpers that share a
 *   working copy AND a base form one group: the group's measured files are judged ONCE, under the union of the
 *   tasks every member run claimed, and reported against the owner (the first member that claimed a task, else
 *   the first member). A nested helper is charged only with its OWN edit records (those are truly per-run).
 * @invariant Open claims of the working copy (AU-T22). A running implementer has no helper end record, so a
 *   group of its nested zero-duration helpers has no claiming member. The group (and a lone helper) is therefore
 *   also judged under every open claim whose RECORDED worktree resolves to the group's working copy (the port
 *   compares directories, never directory names or branch names). The owner stays a member run; these claims
 *   only widen the union of tasks and anchors.
 * @invariant Claims of the working copy across bases. An isolated helper is also judged under the tasks claimed by
 *   every OTHER run of the same isolated working copy, whatever its base (a SendMessage-resumed helper is a new run
 *   on a newer base, so it is outside the base group, and the claim it must match was released). Claims only widen
 *   the union; measured files are still charged per base group. No claim in the copy still yields no-claimed-task.
 * @invariant Each edit record is judged once (AU-T25). The edit records of ALL turns are read on every review, so a
 *   helper that ends again would be charged again with an edit an earlier review already reported. An edit whose
 *   `ts` is at or before the helper's `judged_at_ms` (the review-start snapshot instant, written with
 *   `judged_end_count`) is skipped; the decision is the event's own timestamp against the judged stamp, no path
 *   test. The measured `changes` diff is cumulative by design (decision (b)) and is not touched by this.
 * @invariant The session's own scratchpad (`.../claude-<uid>/<project>/<session>/scratchpad/`) is never
 *   repository content: a path under it is not "outside the working copy". Structural match on the session id of
 *   the trail, no agent-id allowlist; another session's scratchpad stays a finding.
 * @invariant Anchor coverage judges repository content only: a path the helper's working copy's git ignores
 *   (`git check-ignore`, run in that working copy, ONE batched spawn per helper) is never judged against anchors.
 *   One criterion, git's ignore rules: no `.scratch/` special case, no allowlist. A tracked path is never ignored
 *   (check-ignore does not report tracked files). A probe that fails, or whose output does not account for every
 *   input path, is reported in `not_measured` naming the paths, and those paths stay judged (never treated as
 *   ignored). Only an absent `ignoreProbe` skips the filter (unit fixtures with fake working copies).
 * @invariant Findings, per helper and kind (one finding lists every file of that kind): a file outside the
 *   helper's working copy; a file no anchor of any claimed task covers (matching is `anchorsOverlap`, no new
 *   matcher; a file a `workflow.turn_end.co_change` rule REQUIRES counts as covered when an anchor-covered changed
 *   file matched that rule's `when` (AU-T27: one rule list, the one `co-change-review` judges, no second path
 *   list)); changed files and no claimed task. A helper that changed nothing yields none, and an unmeasurable
 *   part is reported in `not_measured`, never as "changed nothing".
 */
import { spawnSync } from "node:child_process";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { anchorsOverlap, err, ok, type CoChangeRule, type LoreError, type Result } from "@lore/core";
import type { SessionTrail, TrailHelper } from "@lore/core/node";
import type { OpenClaimsOfWorkingCopy, RunClaimedTask } from "./run-service.js";
import type { GlobMatchFn } from "./co-change-review.js";

/** Resolves the tasks a run claimed (`RunService.claimedTasks`, injected so this module stays store-free). */
export type ClaimedTasksPort = (run: string) => Promise<Result<readonly RunClaimedTask[], LoreError>>;

/**
 * Resolves the OPEN claims whose recorded worktree is the given working-copy directory
 * (`RunService.openClaimsOfWorkingCopy`, injected). Covers a claiming run that has no end record yet.
 */
export type OpenClaimsOfWorkingCopyPort = (workingCopy: string) => Promise<Result<OpenClaimsOfWorkingCopy, LoreError>>;

/** `realpath` of an existing path; throws ENOENT otherwise (`fs.realpathSync` shape). */
export type RealpathFn = (path: string) => string;

/** Result of one `git check-ignore` spawn (`status` null = the process did not run to an exit). */
export interface IgnoreProbeRun {
  readonly status: number | null;
  readonly stdout: string;
}

/** Runs `git check-ignore --stdin -z -v --non-matching` in `workingCopy` with the NUL-joined `paths` on stdin. */
export type IgnoreProbeFn = (workingCopy: string, paths: readonly string[]) => IgnoreProbeRun;

/** The real {@link IgnoreProbeFn}: a synchronous git spawn in the helper's own working copy. */
export const spawnGitCheckIgnore: IgnoreProbeFn = (workingCopy, paths) => {
  const run = spawnSync("git", ["check-ignore", "--stdin", "-z", "-v", "--non-matching"], {
    cwd: workingCopy,
    input: paths.join("\0") + "\0",
    encoding: "utf8",
  });
  return { status: run.status, stdout: run.stdout ?? "" };
};

/** Paths of `paths` git ignores, or the reason the probe could not be trusted. */
type IgnoreVerdict = { readonly measured: true; readonly ignored: ReadonlySet<string> } | { readonly measured: false; readonly reason: string };

/**
 * Batch verdict. Exit 0 (something ignored) or 1 (nothing ignored) are the only valid statuses, and the `-v -z
 * --non-matching` output must hold exactly one 4-field record (source, line, pattern, path) per input path, in
 * input order: a 0-status run with empty stdout (seen under load) therefore reads as not measured. A record whose
 * pattern starts with `!` is a negation (the path is NOT ignored).
 */
function judgeIgnoreProbe(paths: readonly string[], run: IgnoreProbeRun): IgnoreVerdict {
  if (run.status !== 0 && run.status !== 1) return { measured: false, reason: `git check-ignore exited ${String(run.status)}` };
  const fields = run.stdout.split("\0");
  if (fields.at(-1) === "") fields.pop();
  if (fields.length !== paths.length * 4) return { measured: false, reason: `git check-ignore answered ${fields.length / 4} of ${paths.length} paths` };
  const ignored = new Set<string>();
  for (const [index, path] of paths.entries()) {
    const [source, , pattern, answered] = fields.slice(index * 4, index * 4 + 4);
    if (answered !== path) return { measured: false, reason: `git check-ignore answered ${String(answered)} where ${path} was asked` };
    if (source !== "" && !(pattern ?? "").startsWith("!")) ignored.add(path);
  }
  return { measured: true, ignored };
}

export type HelperScopeFindingKind = "outside-anchors" | "outside-working-copy" | "no-claimed-task";

export interface HelperScopeFinding {
  readonly kind: HelperScopeFindingKind;
  readonly helper: string;
  readonly run: string;
  /** Working-copy-relative paths, or absolute paths for `outside-working-copy`. */
  readonly files: readonly string[];
  /** Slugs of the tasks the helper claimed (empty for `no-claimed-task`). */
  readonly tasks: readonly string[];
  readonly message: string;
}

/** One judged helper end: what the review looked at. */
export interface JudgedHelper {
  readonly agent_id: string;
  readonly run: string;
  readonly end_count: number;
  readonly judged_end_count: number;
  readonly files: readonly string[];
}

export interface HelperScopeReview {
  readonly helpers: readonly JudgedHelper[];
  readonly findings: readonly HelperScopeFinding[];
  /** Parts that could not be measured (an unreadable edit log, a failed helper measurement). */
  readonly not_measured: readonly string[];
}

export interface ReviewHelperScopeInput {
  readonly trail: SessionTrail;
  readonly claimedTasks: ClaimedTasksPort;
  readonly openClaimsOfWorkingCopy: OpenClaimsOfWorkingCopyPort;
  /** The project root (directory holding `.lore/`); the base for edit records of a helper with no working copy. */
  readonly projectRoot: string;
  readonly realpath: RealpathFn;
  /** Git ignore probe; absent = no ignore filtering. The CLI passes {@link spawnGitCheckIgnore}. */
  readonly ignoreProbe?: IgnoreProbeFn;
  /** The validated co_change rules plus the glob matcher; absent = no co-change coverage (rules unmeasured or unset). */
  readonly coChange?: { readonly rules: readonly CoChangeRule[]; readonly matches: GlobMatchFn };
}

/** Helper ends not yet judged: `end_count` above `judged_end_count`. */
function isUnjudged(helper: TrailHelper): boolean {
  return helper.end_count > helper.judged_end_count;
}

/**
 * `path` with symlinks resolved as far as the path exists, the rest appended lexically — so a deleted file or a
 * `/var` vs `/private/var` spelling still compares equal to its working copy.
 */
function canonicalPath(path: string, realpath: RealpathFn): string {
  let existing = path;
  let rest = "";
  for (;;) {
    try {
      return rest === "" ? realpath(existing) : join(realpath(existing), rest);
    } catch {
      const parent = resolve(existing, "..");
      if (parent === existing) return path;
      rest = rest === "" ? existing.slice(parent.length + 1) : join(existing.slice(parent.length + 1), rest);
      existing = parent;
    }
  }
}

/**
 * True when an earlier review already judged this edit record: the helper's judged file stamps the instant of the
 * review-start snapshot (`judged_at_ms`), and an edit recorded at or before it was in scope of that review.
 * A judged file without the stamp (written before AU-T25) covers nothing, so such a helper is judged in full.
 */
function isCoveredByJudgedEnd(editTs: number, helper: TrailHelper): boolean {
  return helper.judged_at_ms !== undefined && editTs <= helper.judged_at_ms;
}

/** True when `canonical` is inside the scratchpad directory of `session` (never repository content). */
function isSessionScratchpad(canonical: string, session: string): boolean {
  const escaped = session.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`/claude-\\d+/[^/]+/${escaped}/scratchpad(/|$)`).test(canonical);
}

/** Helpers that share a working copy and a base: their measured diffs are one and the same. */
function groupKey(helper: TrailHelper, realpath: RealpathFn, projectRoot: string): string | null {
  if (helper.changes?.measured !== true) return null;
  return `${canonicalPath(helper.working_copy ?? projectRoot, realpath)}\0${helper.changes.value.base}`;
}

/**
 * Files of `files` that no anchor covers directly but a co_change rule requires because an anchor-covered file of
 * `files` matched that rule's `when`. Pure; a rule whose `when` only matched uncovered files unlocks nothing.
 */
function coChangeRequiredFiles(files: readonly string[], anchors: readonly string[], coChange: ReviewHelperScopeInput["coChange"]): Set<string> {
  const required = new Set<string>();
  if (coChange === undefined) return required;
  const anchored = files.filter((file) => anchorsOverlap([file], [...anchors]).overlaps);
  const any = (patterns: readonly string[], file: string): boolean => patterns.some((pattern) => coChange.matches(pattern, file));
  for (const rule of coChange.rules) {
    if (!anchored.some((file) => any(rule.when, file))) continue;
    for (const file of files) if (any(rule.require, file)) required.add(file);
  }
  return required;
}

/**
 * True when `mate` is another run of the same ISOLATED working copy as `helper` (any base). A helper resumed with
 * SendMessage is a new run re-rooted on a newer base in the same copy, so it is not in the helper's base group
 * (measured 2026-10-19: bases `7e52699` vs `ce70361`, one working copy); its edits belong to the claim the copy's
 * earlier run held, claimed AND released. A non-isolated helper's copy is the shared checkout and never qualifies.
 */
function sharesIsolatedCopy(mate: TrailHelper, helper: TrailHelper, workingCopy: string, realpath: RealpathFn): boolean {
  if (helper.isolated !== true || mate.isolated !== true || mate.working_copy === undefined) return false;
  return canonicalPath(mate.working_copy, realpath) === workingCopy;
}

function listOf(files: readonly string[]): string {
  return files.join(", ");
}

/**
 * Judge every helper end of `trail` that is not yet judged.
 *
 * @param input - the session trail, the claimed-tasks port, the project root and a realpath port.
 * @returns ok(review); the port's error when a claimed-task lookup fails (the verb then exits non-zero and the
 *   hook reports the helpers as not measured).
 */
export async function reviewHelperScope(input: ReviewHelperScopeInput): Promise<Result<HelperScopeReview, LoreError>> {
  const { trail, realpath } = input;
  const helpers: JudgedHelper[] = [];
  const findings: HelperScopeFinding[] = [];
  const notMeasured: string[] = [];
  for (const turn of trail.turns) {
    if (!turn.edits.measured) notMeasured.push(`turn ${turn.turn}: edit records unreadable (${turn.edits.reason})`);
  }
  const claimCache = new Map<string, Result<readonly RunClaimedTask[], LoreError>>();
  const claimsOf = async (run: string): Promise<Result<readonly RunClaimedTask[], LoreError>> => {
    const cached = claimCache.get(run);
    if (cached !== undefined) return cached;
    const fresh = await input.claimedTasks(run);
    claimCache.set(run, fresh);
    return fresh;
  };
  for (const helper of trail.helpers.filter(isUnjudged)) {
    const workingCopy = canonicalPath(helper.working_copy ?? input.projectRoot, realpath);
    const inside = new Set<string>();
    const outside = new Set<string>();
    const classify = (absolute: string): void => {
      const canonical = canonicalPath(absolute, realpath);
      if (isSessionScratchpad(canonical, trail.session)) return;
      if (canonical === workingCopy || !canonical.startsWith(workingCopy + sep)) outside.add(absolute);
      else inside.add(relative(workingCopy, canonical).split(sep).join("/"));
    };
    const key = groupKey(helper, realpath, input.projectRoot);
    const members = key === null ? [helper] : trail.helpers.filter((m) => groupKey(m, realpath, input.projectRoot) === key);
    const memberClaims: RunClaimedTask[] = [];
    let owner = helper;
    if (members.length > 1) {
      const ordered = [...members].sort((a, b) => (a.started_at + a.agent_id).localeCompare(b.started_at + b.agent_id));
      let ownerChosen = false;
      for (const member of ordered) {
        const claimed = await claimsOf(member.run);
        if (!claimed.ok) return err(claimed.error);
        memberClaims.push(...claimed.value);
        if (!ownerChosen && claimed.value.length > 0) {
          owner = member;
          ownerChosen = true;
        }
      }
      if (!ownerChosen) owner = ordered[0] ?? helper;
    }
    if (helper.changes?.measured === true) {
      if (owner.agent_id === helper.agent_id) for (const file of helper.changes.value.files) inside.add(file.path);
    } else if (helper.changes?.measured === false && helper.isolated === true) {
      notMeasured.push(`helper ${helper.agent_id}: changes not measured (${helper.changes.reason})`);
    }
    for (const turn of trail.turns) {
      if (!turn.edits.measured) continue;
      for (const edit of turn.edits.value) {
        if (edit.run === helper.run && !isCoveredByJudgedEnd(edit.ts, helper)) classify(isAbsolute(edit.file) ? edit.file : resolve(workingCopy, edit.file));
      }
    }
    if (input.ignoreProbe !== undefined && inside.size > 0) {
      const asked = [...inside].sort();
      let verdict: IgnoreVerdict;
      try {
        verdict = judgeIgnoreProbe(asked, input.ignoreProbe(workingCopy, asked));
      } catch (cause) {
        verdict = { measured: false, reason: `git check-ignore could not run: ${cause instanceof Error ? cause.message : String(cause)}` };
      }
      if (verdict.measured) for (const path of verdict.ignored) inside.delete(path);
      else notMeasured.push(`helper ${helper.agent_id}: ignore status not measured for ${listOf(asked)} (${verdict.reason})`);
    }
    const files = [...inside].sort();
    helpers.push({ agent_id: helper.agent_id, run: helper.run, end_count: helper.end_count, judged_end_count: helper.judged_end_count, files });
    if (inside.size === 0 && outside.size === 0) continue;

    const own = members.length > 1 ? ok(memberClaims) : await claimsOf(helper.run);
    if (!own.ok) return err(own.error);
    const copyMateClaims: RunClaimedTask[] = [];
    for (const mate of trail.helpers) {
      if (mate.run === helper.run || members.includes(mate) || !sharesIsolatedCopy(mate, helper, workingCopy, realpath)) continue;
      const claimed = await claimsOf(mate.run);
      if (!claimed.ok) return err(claimed.error);
      copyMateClaims.push(...claimed.value);
    }
    const openInCopy = await input.openClaimsOfWorkingCopy(workingCopy);
    if (!openInCopy.ok) return err(openInCopy.error);
    for (const note of openInCopy.value.not_measured) {
      if (!notMeasured.includes(note)) notMeasured.push(note);
    }
    const judgedUnder = [...own.value, ...copyMateClaims, ...openInCopy.value.tasks];
    const slugs = [...new Set(judgedUnder.map((t) => t.slug))];
    const anchors = judgedUnder.flatMap((t) => [...t.file_anchors]);
    const add = (kind: HelperScopeFindingKind, list: readonly string[], message: string, tasks: readonly string[]): void => {
      findings.push({ kind, helper: helper.agent_id, run: helper.run, files: list, tasks, message });
    };
    if (outside.size > 0) {
      const list = [...outside].sort();
      add("outside-working-copy", list, `Helper ${helper.agent_id} (${helper.run}) changed files outside its working copy ${workingCopy}: ${listOf(list)}`, slugs);
    }
    if (slugs.length === 0) {
      const list = [...files, ...[...outside].sort()];
      add("no-claimed-task", list, `Helper ${helper.agent_id} (${helper.run}) changed files but claimed no task: ${listOf(list)}`, []);
    } else {
      const requiredByCoChange = coChangeRequiredFiles(files, anchors, input.coChange);
      const uncovered = files.filter((file) => !anchorsOverlap([file], anchors).overlaps && !requiredByCoChange.has(file));
      if (uncovered.length > 0) {
        add("outside-anchors", uncovered, `Helper ${helper.agent_id} (${helper.run}) changed files outside the anchors of its task ${slugs.join(", ")}: ${listOf(uncovered)}`, slugs);
      }
    }
  }
  return ok({ helpers, findings, not_measured: notMeasured });
}
