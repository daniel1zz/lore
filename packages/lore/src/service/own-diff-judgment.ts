/**
 * own-diff-judgment — judges a branch's OWN change at `lore integrate`, before the floor runs
 * (spec-a-branch-s-own-diff-is-judged-at-integrate-the-turn-end, "Own-diff judgment at integrate").
 *
 * Purpose: work is judged where it enters main, on `git diff <merge-base(main, branch)> <branch>`: every write whatever
 * tool made it, and nothing merged in from main. Three rules, every refusal exits 4 and names its rule id:
 *   - BR-1348 the branch has at least one task: the tasks claimed on it plus every task of a plan whose declared
 *     integration branch it is ({@link BranchOwnershipReader});
 *   - BR-1346 no changed path, and no changed top-level symbol of a file another live claim holds by symbol, is held by
 *     an anchor of a task that is not the branch's and has not landed (same overlap rule as the claim gate and the
 *     edit-time anchor gate, `anchorsOverlap`);
 *   - BR-1347 a declared co-change rule's trigger matches the own change and nothing matching its `require` changed.
 * A change outside the branch's own tasks' anchors that no other live claim holds is NOT refused: it is returned as
 * `outside_anchors` and recorded on the landing, so what landed is always visible.
 *
 * Public surface: {@link OwnDiffJudgment}, {@link BranchOwnershipReader}, {@link OwnDiffVerdict}, {@link LandedFootprint},
 * {@link OWN_DIFF_RULE_COLLISION}, {@link OWN_DIFF_RULE_CO_CHANGE}, {@link OWN_DIFF_RULE_NO_TASK}.
 * Side-effect class: IO read-only (git subprocesses through the injected port, store reads). Writes nothing, ever.
 *
 * Invariants:
 *   - No silent fallback: git, the store, the audit log or the co-change config unreadable -> `err` naming the cause;
 *     the caller never lands an unjudged branch.
 *   - Symbols are found by `@lore/core`'s top-level symbol extraction, the ONE implementation (the edit-time hook uses a
 *     generated copy of it). Per-symbol diffs are read only for files some anchor holds by symbol; every other changed
 *     file is judged as a whole file.
 *   - A file whose symbols cannot be determined (not scannable, no declaration) is a change to the WHOLE file: fail closed.
 *   - Another LIVE claim = an unarchived task that is not a task of the branch, carries no landing, and either holds a
 *     claim (`extractHeldClaim`) or has a claim recorded on a branch that still exists and is not on main.
 */
import {
  anchorsOverlap,
  changedSymbols,
  err,
  extractFileAnchors,
  extractHeldClaim,
  isSymbolScannable,
  isTerminalStatus,
  ok,
  readClaimRecord,
  splitFileAnchor,
  type AuditEntry,
  type DocRecord,
  type LoreError,
  type Result,
} from "@lore/core";
import { detectWorktreeBranch, type BranchMeasurement } from "../adapters/real-git-port.js";
import type { StoreInterface } from "../store/store-interface.js";
import { reviewCoChange, type CoChangeRulesLoad, type GlobMatchFn } from "./co-change-review.js";
import { isPlanMember } from "./plan-membership.js";

/** Rule id: a change held by another live claim is refused. */
export const OWN_DIFF_RULE_COLLISION = "BR-1346";
/** Rule id: a co-change rule's trigger without its required file is refused. */
export const OWN_DIFF_RULE_CO_CHANGE = "BR-1347";
/** Rule id: a branch with no task is refused. */
export const OWN_DIFF_RULE_NO_TASK = "BR-1348";

const TARGET_REF = "refs/heads/main";

/** Raw outcome of one git call; structurally the same as the integrate service's `GitOutcome`. */
export interface OwnDiffGitOutcome {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs `git <args>` in `cwd`; never throws. */
export type OwnDiffGit = (cwd: string, args: readonly string[]) => OwnDiffGitOutcome;

/** A task with the anchors it declares. */
export interface AnchoredTask {
  readonly slug: string;
  readonly anchors: readonly string[];
}

/** A task that is not the branch's, as the judge needs to decide whether its claim is live. */
export interface OtherTask extends AnchoredTask {
  /** The task carries a held claim (`extractHeldClaim`). */
  readonly held: boolean;
  /** Branch names its claims recorded (worktree paths already resolved to the branch checked out there). */
  readonly claimedBranches: readonly string[];
}

/** Who owns what, for one branch. */
export interface BranchOwnership {
  /** Tasks of the branch: claimed on it, or of a plan whose declared integration branch it is. */
  readonly own: readonly AnchoredTask[];
  /** Unarchived, unlanded tasks that are not the branch's and declare at least one anchor. */
  readonly others: readonly OtherTask[];
}

/**
 * Reads the tasks of a branch and the other candidate live claims from the corpus.
 *
 * @invariant Read-only. A store or audit failure is an `err`, never an empty ownership.
 * @invariant `claimedNames` mirrors `TaskWorkflowService.claimedNames` (claim audit rows' `worktree` and `branch`, plus
 *   the current claim's); the duplicate exists only while that private method is held by another task, and must be
 *   replaced by a call to it.
 */
export class BranchOwnershipReader {
  constructor(
    private readonly store: StoreInterface,
    private readonly detectBranch: (worktree: string) => Promise<BranchMeasurement> = detectWorktreeBranch,
  ) {}

  /**
   * @param branch - the branch being integrated, as typed.
   * @returns the branch's tasks and every other unlanded task that could hold part of the repository.
   */
  async read(branch: string): Promise<Result<BranchOwnership, LoreError>> {
    const tasks = await this.store.findMany({ type: "task" });
    if (!tasks.ok) return tasks;
    const plans = await this.store.findMany({ type: "plan" });
    if (!plans.ok) return plans;
    const audit = await this.store.queryAudit({ action: "claim" });
    if (!audit.ok) return audit;
    const integrationBranchOfPlan = new Map<string, string>();
    for (const plan of plans.value) {
      const declared = plan.extra?.["integration_branch"];
      if (typeof declared === "string" && declared !== "") integrationBranchOfPlan.set(plan.id, declared);
    }
    const own: AnchoredTask[] = [];
    const others: OtherTask[] = [];
    for (const task of tasks.value) {
      if (task.status === "deprecated") continue;
      const names = await this.claimedBranchNames(task, audit.value);
      const planBranch = [...integrationBranchOfPlan].find(([planId]) => isPlanMember(task, planId))?.[1];
      const anchors = extractFileAnchors(task);
      if (names.includes(branch) || planBranch === branch) {
        own.push({ slug: task.slug, anchors });
        continue;
      }
      if (isTerminalStatus(task.status, "task") || task.extra?.["landing"] !== undefined || anchors.length === 0) continue;
      others.push({ slug: task.slug, anchors, held: extractHeldClaim(task) !== undefined, claimedBranches: names });
    }
    return ok({ own, others });
  }

  /** Every branch name `task`'s claims recorded; a recorded worktree path contributes the branch checked out there. */
  private async claimedBranchNames(task: DocRecord, audit: readonly AuditEntry[]): Promise<string[]> {
    const names = new Set<string>();
    const add = (value: unknown): void => {
      if (typeof value === "string" && value.trim() !== "") names.add(value);
    };
    for (const row of audit) {
      if (row.doc_id !== task.id) continue;
      add(row.details?.["worktree"]);
      add(row.details?.["branch"]);
    }
    const current = readClaimRecord(task);
    add(current?.worktree);
    add(current?.branch);
    for (const name of [...names]) {
      if (!name.startsWith("/")) continue;
      const measured = await this.detectBranch(name);
      if (measured.status === "measured") names.add(measured.branch);
    }
    return [...names];
  }
}

/** The own-change paths no task of the branch anchors: recorded on the landing. */
export interface LandedFootprint {
  readonly outside_anchors: readonly string[];
}

/** What a passed judgment hands back to the landing. */
export interface OwnDiffVerdict extends LandedFootprint {
  /** Tasks the change was judged against. */
  readonly tasks: readonly string[];
}

/** Dependencies of {@link OwnDiffJudgment}. */
export interface OwnDiffJudgmentDeps {
  readonly git: OwnDiffGit;
  /** The repository whose refs hold main (git commands run here). */
  readonly projectRoot: string;
  readonly ownership: Pick<BranchOwnershipReader, "read">;
  /** Co-change rules of the project (`workflow.turn_end.co_change`), or the reason they could not be read. */
  readonly loadCoChangeRules: () => CoChangeRulesLoad;
  /** Glob matcher for the co-change rules (the CLI passes `Bun.Glob`). */
  readonly matchesGlob: GlobMatchFn;
}

/** One changed file of the own change. */
interface ChangedFile {
  readonly path: string;
  /** `A` added, `D` deleted, anything else modified (type change included). */
  readonly kind: "A" | "D" | "M";
}

function refusal(message: string): LoreError {
  return { code: "VALIDATION_ERROR", field: "own-diff", message };
}

function gitFailure(what: string, outcome: OwnDiffGitOutcome): LoreError {
  return { code: "STORE_ERROR", message: `integrate: judging the own diff failed: ${what} (git exit ${outcome.status}): ${(outcome.stderr || outcome.stdout).trim()}` };
}

/** One violation of BR-1346: `label` is what the refusal names, `holder` the task, `anchor` the anchor that holds it. */
interface Collision {
  readonly label: string;
  readonly holder: string;
  readonly anchor: string;
}

/** Judges a branch's own change against the other live claims, the co-change rules and the branch's own tasks. */
export class OwnDiffJudgment {
  constructor(private readonly deps: OwnDiffJudgmentDeps) {}

  /**
   * @param branch - the branch as typed (names the refusal and selects its tasks).
   * @param tip - the branch tip commit sha.
   * @returns ok(verdict) when no rule refuses; err(VALIDATION_ERROR, field `own-diff`, exit 4) naming every refused
   *   rule; err(STORE_ERROR) when git, the claims or the co-change config could not be read.
   */
  async judge(branch: string, tip: string): Promise<Result<OwnDiffVerdict, LoreError>> {
    const read = this.readOwnChange(tip);
    if (!read.ok) return read;
    const changed = read.value.files;
    const base = read.value.base;
    const ownership = await this.deps.ownership.read(branch);
    if (!ownership.ok) return ownership;
    const rules = this.deps.loadCoChangeRules();
    if (!rules.measured) return err(refusal(`integrate: refused ${branch}: the co-change rules could not be read (${rules.reason}); fix the config, nothing was landed`));

    const live = this.liveOthers(branch, ownership.value.others);
    if (!live.ok) return live;
    const symbolPaths = new Set(
      [...ownership.value.own, ...live.value].flatMap((task) => task.anchors.map(splitFileAnchor)).filter((a) => a.symbol !== undefined).map((a) => a.path),
    );
    const candidates = new Map<string, string[]>();
    for (const file of changed) {
      const resolved = this.candidatesOf(file, base, tip, symbolPaths);
      if (!resolved.ok) return resolved;
      candidates.set(file.path, resolved.value);
    }

    const problems: string[] = [];
    if (ownership.value.own.length === 0) {
      problems.push(
        `${OWN_DIFF_RULE_NO_TASK}: no task belongs to branch ${branch}. Claim a task on it (lore claim <task> --worktree ${branch}) or declare it as a plan's integration branch (lore plan integration-branch <plan> ${branch}).`,
      );
    }
    const collisions = this.collisionsOf(live.value, candidates);
    if (collisions.length > 0) {
      problems.push(
        `${OWN_DIFF_RULE_COLLISION}: the own change of ${branch} is held by another live claim:\n` +
          collisions.map((c) => `  ${c.label}  held by ${c.holder} (anchor ${c.anchor})`).join("\n") +
          `\n  Wait for that task to land or be released, or move the change to another branch.`,
      );
    }
    const findings = reviewCoChange(rules.rules, [{ subject: { kind: "unknown" }, files: changed.map((f) => f.path) }], this.deps.matchesGlob);
    for (const finding of findings) problems.push(`${OWN_DIFF_RULE_CO_CHANGE}: ${finding.message}`);
    if (problems.length > 0) return err(refusal(`integrate: refused ${branch}; nothing was landed and nothing was changed:\n${problems.join("\n")}`));

    const ownAnchors = ownership.value.own.flatMap((task) => task.anchors);
    const outside = changed
      .filter((file) => (candidates.get(file.path) ?? []).some((candidate) => !anchorsOverlap([candidate], ownAnchors).overlaps))
      .map((file) => file.path)
      .sort();
    return ok({ outside_anchors: outside, tasks: ownership.value.own.map((task) => task.slug) });
  }

  /** `git diff --name-status` between `merge-base(main, tip)` and `tip`: the branch's own files; both sides of a rename. */
  private readOwnChange(tip: string): Result<{ readonly base: string; readonly files: ChangedFile[] }, LoreError> {
    const { git, projectRoot } = this.deps;
    const base = git(projectRoot, ["merge-base", TARGET_REF, tip]);
    if (base.status !== 0 || base.stdout.trim() === "") return err(gitFailure(`merge-base of ${TARGET_REF} and ${tip.slice(0, 12)}`, base));
    const mergeBase = base.stdout.trim();
    const diff = git(projectRoot, ["diff", "--name-status", "--no-renames", "-z", mergeBase, tip]);
    if (diff.status !== 0) return err(gitFailure(`git diff ${mergeBase.slice(0, 12)}..${tip.slice(0, 12)}`, diff));
    const tokens = diff.stdout.split("\0").filter((t) => t !== "");
    const files: ChangedFile[] = [];
    for (let i = 0; i + 1 < tokens.length; i += 2) {
      const status = tokens[i]?.[0];
      const path = tokens[i + 1];
      if (status === undefined || path === undefined) break;
      files.push({ path, kind: status === "A" ? "A" : status === "D" ? "D" : "M" });
    }
    return ok({ base: mergeBase, files });
  }

  /** The holders that are LIVE: held claim, or a claimed branch that exists and has not reached main. */
  private liveOthers(branch: string, others: readonly OtherTask[]): Result<OtherTask[], LoreError> {
    const { git, projectRoot } = this.deps;
    const live: OtherTask[] = [];
    for (const task of others) {
      if (task.held) {
        live.push(task);
        continue;
      }
      for (const name of task.claimedBranches) {
        if (name === branch || name.startsWith("/")) continue;
        const exists = git(projectRoot, ["rev-parse", "--verify", "-q", `${name}^{commit}`]);
        if (exists.status !== 0) continue; // a name that is no branch (a deleted one) holds nothing
        const onMain = git(projectRoot, ["merge-base", "--is-ancestor", exists.stdout.trim(), TARGET_REF]);
        if (onMain.status === 0) continue;
        if (onMain.status !== 1) return err(gitFailure(`is ${name} on main`, onMain));
        live.push(task);
        break;
      }
    }
    return ok(live);
  }

  /**
   * The anchor spellings a changed file stands for: its changed top-level symbols (`path#Symbol`) when some anchor holds
   * the file by symbol and the symbols can be told, else the whole file (`path`).
   */
  private candidatesOf(file: ChangedFile, base: string, tip: string, symbolPaths: ReadonlySet<string>): Result<string[], LoreError> {
    if (!symbolPaths.has(file.path) || !isSymbolScannable(file.path)) return ok([file.path]);
    const before = file.kind === "A" ? ok<string | null>(null) : this.showFile(base, file.path);
    if (!before.ok) return before;
    const after = file.kind === "D" ? ok<string | null>(null) : this.showFile(tip, file.path);
    if (!after.ok) return after;
    const symbols = changedSymbols(before.value, after.value);
    if (symbols === null || symbols.length === 0) return ok([file.path]);
    return ok(symbols.map((symbol) => `${file.path}#${symbol}`));
  }

  private showFile(rev: string, path: string): Result<string | null, LoreError> {
    const shown = this.deps.git(this.deps.projectRoot, ["show", `${rev}:${path}`]);
    if (shown.status !== 0) return err(gitFailure(`git show ${rev.slice(0, 12)}:${path}`, shown));
    return ok(shown.stdout);
  }

  /** Every (changed file or symbol, live holder) pair whose anchors overlap; names the finest thing held. */
  private collisionsOf(live: readonly OtherTask[], candidates: ReadonlyMap<string, readonly string[]>): Collision[] {
    const found = new Map<string, Collision>();
    for (const [path, spellings] of candidates) {
      for (const task of live) {
        for (const [mine, theirs] of anchorsOverlap([...spellings], [...task.anchors]).pairs) {
          const label = splitFileAnchor(theirs).symbol !== undefined ? mine : path;
          found.set(`${label}\0${task.slug}`, { label, holder: task.slug, anchor: theirs });
        }
      }
    }
    return [...found.values()].sort((a, b) => a.label.localeCompare(b.label) || a.holder.localeCompare(b.holder));
  }
}
