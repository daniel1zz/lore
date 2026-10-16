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
  for (const helper of trail.helpers.filter(isUnjudged)) {
    const workingCopy = canonicalPath(helper.working_copy ?? input.projectRoot, realpath);
    const inside = new Set<string>();
    const outside = new Set<string>();
    const classify = (absolute: string): void => {
      const canonical = canonicalPath(absolute, realpath);
      if (canonical === workingCopy || !canonical.startsWith(workingCopy + sep)) outside.add(absolute);
      else inside.add(relative(workingCopy, canonical).split(sep).join("/"));
    };
    if (helper.changes?.measured === true) {
      for (const file of helper.changes.value.files) inside.add(file.path);
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

    const claimed = await input.claimedTasks(helper.run);
    if (!claimed.ok) return err(claimed.error);
    const slugs = claimed.value.map((t) => t.slug);
    const anchors = claimed.value.flatMap((t) => [...t.file_anchors]);
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
