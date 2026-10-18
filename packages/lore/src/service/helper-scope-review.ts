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
 * @invariant The session's own scratchpad (`.../claude-<uid>/<project>/<session>/scratchpad/`) is never
 *   repository content: a path under it is not "outside the working copy". Structural match on the session id of
 *   the trail, no agent-id allowlist; another session's scratchpad stays a finding.
 * @invariant Findings, per helper and kind (one finding lists every file of that kind): a file outside the
 *   helper's working copy; a file no anchor of any claimed task covers (matching is `anchorsOverlap`, no new
 *   matcher); changed files and no claimed task. A helper that changed nothing yields none, and an unmeasurable
 *   part is reported in `not_measured`, never as "changed nothing".
 */
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { anchorsOverlap, err, ok, type LoreError, type Result } from "@lore/core";
import type { SessionTrail, TrailHelper } from "@lore/core/node";
import type { RunClaimedTask } from "./run-service.js";

/** Resolves the tasks a run claimed (`RunService.claimedTasks`, injected so this module stays store-free). */
export type ClaimedTasksPort = (run: string) => Promise<Result<readonly RunClaimedTask[], LoreError>>;

/**
 * Resolves the OPEN claims whose recorded worktree is the given working-copy directory
 * (`RunService.openClaimsOfWorkingCopy`, injected). Covers a claiming run that has no end record yet.
 */
export type OpenClaimsOfWorkingCopyPort = (workingCopy: string) => Promise<Result<readonly RunClaimedTask[], LoreError>>;

/** `realpath` of an existing path; throws ENOENT otherwise (`fs.realpathSync` shape). */
export type RealpathFn = (path: string) => string;

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
        if (edit.run === helper.run) classify(isAbsolute(edit.file) ? edit.file : resolve(workingCopy, edit.file));
      }
    }
    const files = [...inside].sort();
    helpers.push({ agent_id: helper.agent_id, run: helper.run, end_count: helper.end_count, judged_end_count: helper.judged_end_count, files });
    if (inside.size === 0 && outside.size === 0) continue;

    const own = members.length > 1 ? ok(memberClaims) : await claimsOf(helper.run);
    if (!own.ok) return err(own.error);
    const openInCopy = await input.openClaimsOfWorkingCopy(workingCopy);
    if (!openInCopy.ok) return err(openInCopy.error);
    const judgedUnder = [...own.value, ...openInCopy.value];
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
      const uncovered = files.filter((file) => !anchorsOverlap([file], anchors).overlaps);
      if (uncovered.length > 0) {
        add("outside-anchors", uncovered, `Helper ${helper.agent_id} (${helper.run}) changed files outside the anchors of its task ${slugs.join(", ")}: ${listOf(uncovered)}`, slugs);
      }
    }
  }
  return ok({ helpers, findings, not_measured: notMeasured });
}
