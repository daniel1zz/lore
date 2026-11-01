/**
 * LandService — `lore land <task | integration-branch>`: the implementer's one closing verb after `lore finish`
 * (spec-integrate-proves-and-lands-evidence-at-landing-the-merge AC-DCS2-7, AC-DCS2-8, AC-DCS2-9, AC-DCS2-19; ledger D28).
 *
 * Purpose: compose the capabilities that already exist, adding no second landing path. Main moves only through the integrate the
 * injected {@link LandPorts.integrate} port runs (`IntegrateService`); this service decides WHAT to land and in which order.
 *   - a task of a plan without an integration branch: require the contract met, integrate the task's branch (the integrate runs the
 *     oracle union, records the rows and archives per contract, and `lore done`'s cleanup removes the worktree and branch);
 *   - a task of a plan with one: require the contract met, fold the task tip into the integration branch inside a queue turn
 *     (fast-forward when the branch is an ancestor of the tip, else a merge; a conflict is refused with the branch unchanged), log
 *     `folded`, and when no open code task of the plan is left unfolded integrate the branch in the SAME turn;
 *   - an integration branch named directly: integrate it.
 * Public surface: {@link LandService}, {@link LandPorts}, {@link LandOutcome}, {@link LandGit}, {@link createLandGit},
 *   {@link LandIntegrateFailed}, {@link PlanCloseSeam}.
 * Invariants:
 *   - every step is idempotent and resumable: a step already in the task's execution log is skipped, a failed step leaves the earlier
 *     ones recorded (nothing is rolled back) and names the command to run again; an oracle failure of the integrate keeps exit 1;
 *   - the fold is a compare-and-swap of the branch ref against the head it merged onto (`update-ref <new> <old>`): a ref that moved
 *     meanwhile is exit 75 `fold-raced`, nothing changed;
 *   - the trigger of the branch landing is "no open code task of the plan is unfolded", never "this is the last open task": a folded
 *     task stays approved until the branch lands. Check and corpus tasks never gate it (they finish on main by themselves);
 *   - no silent fallback: an unreadable ref, a missing contract or an unreadable log is a refusal naming it.
 * Side-effect class: git (reads, the merge-tree computation, one commit object, one ref update), the queue, corpus writes through the
 *   injected ports.
 */

import { spawnSync } from "node:child_process";
import {
  doneContractSchema,
  err,
  extractEvidence,
  extractHeldClaim,
  ok,
  readExecutionLog,
  type DocId,
  type DocRecord,
  type DoneContract,
  type ExecutionLogEntry,
  type LoreError,
  type Result,
  type TaskClaim,
} from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { IntegrateQueueTimeoutError, IntegrateQueueUnreadableError, type QueueTaker } from "./integrate-queue.js";
import { isPlanMember } from "./plan-membership.js";
import { resolveDoc } from "./resolve.js";
import { formatWorktreeOutcomeLine, type WorktreeOutcome } from "./worktree-cleanup.js";

/** Exit code of "busy, try later" (EX_TEMPFAIL); the same class the integrate queue uses. */
export const LAND_EXIT_BUSY = 75;

/** The result of one git call; never thrown. */
export interface LandGitResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs `git <args>` in the repository the landing works on. */
export type LandGit = (args: readonly string[]) => LandGitResult;

/** The real {@link LandGit} over the repository at `cwd`, run with the invocation's environment `env`. */
export function createLandGit(cwd: string, env: Readonly<Record<string, string | undefined>>): LandGit {
  return (args) => {
    const run = spawnSync("git", [...args], { cwd, encoding: "utf8", env: { ...env } });
    return { status: run.status ?? 1, stdout: run.stdout ?? "", stderr: run.stderr ?? run.error?.message ?? "" };
  };
}

/** Thrown by the integrate port when `lore integrate` ended with a non-zero exit (its own output is already printed). */
export class LandIntegrateFailed extends Error {
  constructor(readonly exit: number) {
    super(`integrate exited ${exit}`);
    this.name = "LandIntegrateFailed";
  }
}

/** Called after the integration branch of a plan landed on main: the seam the plan-close task wires (AC-DCS2-11). */
export interface PlanCloseSeam {
  afterBranchLanded(plan: DocRecord): Promise<void>;
}

/** The writes and runs `LandService` composes; `app.ts` / `commands/land.ts` bind them (services never import each other). */
export interface LandPorts {
  readonly store: StoreInterface;
  /** Git of the main checkout (refs are shared by every worktree). */
  readonly git: LandGit;
  /** The merge queue; folds take their turn here, so a fold and an integrate never race. */
  readonly queue: { runInTurn<T>(taker: QueueTaker, fn: () => Promise<T>): Promise<T> };
  /** `lore integrate <branch>`; throws {@link LandIntegrateFailed} when it did not succeed. When called inside a held turn it shares it. */
  readonly integrate: { integrate(branch: string): Promise<void> };
  /** The `lore done` walk for a task (archives it, removes its worktree and branch); the refusal is returned, never thrown. Its worktree outcomes are printed by land. */
  readonly done: (slug: string) => Promise<Result<{ readonly worktree_outcomes?: readonly WorktreeOutcome[] }, LoreError>>;
  /** Appends execution-log entries to a task. */
  readonly log: { appendEntries(task: DocRecord, entries: readonly ExecutionLogEntry[]): Promise<Result<ExecutionLogEntry[], LoreError>> };
  /** The caller's session id (names the queue ticket). */
  readonly session: string;
  readonly now: () => string;
  /** Absent until the plan-close task wires it; then it is skipped and said so, never silently. */
  readonly planClose?: PlanCloseSeam;
}

/** What one `lore land` did. */
export interface LandOutcome {
  /** Process exit code: 0 done or nothing to do, 1 an integrate oracle failed, 4 a later step refused, 75 busy / fold raced. */
  readonly exit: number;
  readonly lines: readonly string[];
  readonly errors: readonly string[];
}

/** The turn a fold holds; handed to the branch landing so it runs inside the same queue turn, with what the fold already said. */
interface HeldTurn {
  readonly session: string;
  /** The task the caller named (the target of every "run again" hint). */
  readonly target: string;
  /** The summary lines of the steps already done in this turn. */
  readonly lines: readonly string[];
}

/** The outcome of one resumable step: skipped (already in the execution log) or run, and the exit code of what it ran. */
interface StepResult {
  readonly skipped: boolean;
  readonly step: string;
  readonly exit: number;
}

const skipStep = (step: string): StepResult => ({ skipped: true, step, exit: 0 });
const ranStep = (step: string, exit: number): StepResult => ({ skipped: false, step, exit });

/** A view of one task's execution log keyed by (kind, tip). */
class TaskLog {
  constructor(private readonly entries: readonly ExecutionLogEntry[]) {}
  has(kind: "folded" | "landed", tip: string): boolean {
    return this.entries.some((entry) => entry.kind === kind && entry.tip === tip);
  }
  foldedTips(): string[] {
    return this.entries.flatMap((entry) => (entry.kind === "folded" ? [entry.tip] : []));
  }
}

function readLog(task: DocRecord): Result<TaskLog, LoreError> {
  try {
    return ok(new TaskLog(readExecutionLog(task.extra)));
  } catch (cause) {
    return err({ code: "VALIDATION_ERROR", field: "execution_log", message: `${task.slug}: the stored execution log is unreadable (${cause instanceof Error ? cause.message : String(cause)}); nothing was changed` });
  }
}

function refusal(field: string, message: string, value?: unknown): LoreError {
  return { code: "VALIDATION_ERROR", field, message: `${field}: ${message}`, ...(value !== undefined ? { value } : {}) };
}

const short = (sha: string): string => sha.slice(0, 12);

/** A task the landing is about to archive (read before the landing: afterwards it is no longer open). */
interface LandEntry {
  readonly slug: string;
}

const landEntryOf = (task: DocRecord): LandEntry => ({ slug: task.slug });

/** The branch a claim worked on: the recorded branch, else the `--worktree <branch>` value (a non-absolute path is a branch name). */
function claimBranchOf(claim: TaskClaim | undefined): string | undefined {
  return claim?.branch ?? (claim?.worktree !== undefined && !claim.worktree.startsWith("/") ? claim.worktree : undefined);
}

export class LandService {
  constructor(private readonly ports: LandPorts) {}

  /**
   * Lands a task or an integration branch.
   *
   * @param target - a task slug or id, or the name of a local branch
   * @returns the outcome (see {@link LandOutcome}), or a refusal (exit 4: a contract not met, a conflict, a target that cannot be landed)
   */
  async land(target: string): Promise<Result<LandOutcome, LoreError>> {
    const doc = await resolveDoc(this.ports.store, target);
    if (doc.ok && doc.value.type === "task") return this.landTask(doc.value);
    const branchHead = this.resolveBranch(target);
    if (!branchHead.ok) return branchHead;
    if (branchHead.value !== null) return this.landBranch(target);
    if (!doc.ok) return doc;
    return err(refusal("land-target", `${target} is a ${doc.value.type}, not a task or a branch; \`lore land\` takes a task or the integration branch of a plan`));
  }

  // ───────────────────────────── a task ─────────────────────────────

  private async landTask(task: DocRecord): Promise<Result<LandOutcome, LoreError>> {
    const contract = doneContractSchema.safeParse(task.extra["done_contract"]);
    if (!contract.success) {
      return err(refusal("contract-missing", `${task.slug} holds no done contract; it is compiled at approve (\`lore approve ${task.slug}\`)`));
    }
    if (task.status === "archived") return ok({ exit: 0, lines: [`land: ${task.slug} is already archived; nothing to do`], errors: [] });
    if (contract.data.kind !== "code") {
      return err(refusal("land-not-code", `${task.slug} is a ${contract.data.kind} task: it finishes on main by itself (\`lore finish ${task.slug}\`), it is never landed`));
    }
    const claim = extractHeldClaim(task);
    const branch = claimBranchOf(claim);
    if (claim === undefined || branch === undefined) {
      return err(refusal("no-claim", `${task.slug} holds no claim on a branch, so there is no work to land; take it with \`lore start ${task.slug}\` first`));
    }
    const tipResult = this.resolveBranch(branch);
    if (!tipResult.ok) return tipResult;
    if (tipResult.value === null) return err(refusal("branch-missing", `the branch ${branch} of ${task.slug} no longer exists; nothing can be landed`));
    const tip = tipResult.value;
    const log = readLog(task);
    if (!log.ok) return log;

    // reason: the contract is judged once, before anything moves; a task already folded or landed passed it then, and its rows are
    // bound to a later commit now, so a resume never re-judges it.
    if (!log.value.has("folded", tip) && !log.value.has("landed", tip)) {
      const unmet = this.unmetItems(task, contract.data, claim, tip);
      if (unmet.length > 0) {
        return err(
          refusal(
            "land-contract-unmet",
            `${task.slug} is not finished at ${short(tip)}: ${unmet.length} item(s) unmet; nothing was changed.\n${unmet.map((item) => `  - ${item}`).join("\n")}\n` +
              `Run \`lore finish ${task.slug}\` in its worktree, then \`lore land ${task.slug}\`.`,
            unmet,
          ),
        );
      }
    }

    if (contract.data.landing_route === "integration-branch") {
      const planId = task.extra["plan_id"];
      const plan = typeof planId === "string" ? await this.ports.store.find(planId as DocId) : undefined;
      if (plan === undefined || !plan.ok || plan.value === null) return err(refusal("plan-missing", `the plan of ${task.slug} cannot be read; nothing was changed`));
      return this.landIntoIntegrationBranch(task, plan.value);
    }
    return this.landOnMain(task, branch, tip, log.value);
  }

  /** The items of the contract with no attested pass at `tip`, plus the finished mark and the red run (the predicates `finish` records). */
  private unmetItems(task: DocRecord, contract: DoneContract, claim: TaskClaim, tip: string): string[] {
    const rows = extractEvidence(task);
    const unmet: string[] = [];
    const seen = new Set<string>();
    for (const oracle of [...contract.oracles, ...contract.added_oracles]) {
      if (seen.has(oracle.id)) continue;
      seen.add(oracle.id);
      const command = oracle.command ?? oracle.id;
      const passed = rows.some((row) => row.result === "pass" && row.attestation?.head_sha === tip && row.command === command);
      if (!passed) unmet.push(`${oracle.id}: no runner-attested pass at ${short(tip)} (\`${command}\`)`);
    }
    if (contract.red_required && !rows.some((row) => row.result === "fail" || row.result === "expected-fail")) {
      unmet.push("red-first: no runner-produced red run is on record");
    }
    if (claim.finished_commit !== tip) unmet.push(`finished: the claim is not finished at ${short(tip)} (finished commit ${claim.finished_commit === undefined ? "none" : short(claim.finished_commit)})`);
    return unmet;
  }

  // ───────────────────────────── main route ─────────────────────────────

  private async landOnMain(task: DocRecord, branch: string, tip: string, log: TaskLog): Promise<Result<LandOutcome, LoreError>> {
    const integrated = await this.integrateStep(branch, tip, log);
    if (integrated.exit !== 0) return ok(this.failed(integrated.exit, `integrating ${branch}`, task.slug));
    const lines = [integrated.skipped ? `land: ${branch} already landed on main (execution log); resuming at the done walk` : `land: landed ${branch} on main`];
    const archived = await this.archiveWalk([{ slug: task.slug }], task.slug);
    return ok({ exit: archived.errors.length === 0 ? 0 : 4, lines: [...lines, ...archived.lines], errors: archived.errors });
  }

  /** The integrate of the main route, skipped when the execution log already holds the landing of this tip. */
  private async integrateStep(branch: string, tip: string, log: TaskLog): Promise<StepResult> {
    if (log.has("landed", tip)) return skipStep("landed");
    return ranStep("landed", await this.integrateOnce(branch));
  }

  // ───────────────────────────── integration-branch route ─────────────────────────────

  private async landIntoIntegrationBranch(task: DocRecord, plan: DocRecord): Promise<Result<LandOutcome, LoreError>> {
    const branch = String(plan.extra["integration_branch"]);
    const taker: QueueTaker = { session: this.ports.session, branch };
    try {
      return await this.ports.queue.runInTurn(taker, async (): Promise<Result<LandOutcome, LoreError>> => {
        const folded = await this.foldIntoIntegrationBranch(task, plan);
        if (!folded.ok) return folded;
        if (folded.value.kind === "raced") {
          return ok({ exit: LAND_EXIT_BUSY, lines: [], errors: [`fold-raced: ${branch} moved while ${task.slug} was being folded (it was ${short(folded.value.expected)}, it is ${short(folded.value.actual)}); nothing was changed. Run \`lore land ${task.slug}\` again`] });
        }
        const lines = [
          folded.value.kind === "already"
            ? `land: ${task.slug} is already folded into ${branch}`
            : `land: folded ${task.slug} into ${branch} (${folded.value.kind} ${short(folded.value.foldCommit)})`,
        ];
        const turn: HeldTurn = { session: this.ports.session, target: task.slug, lines };
        const open = await this.openCodeTasks(plan);
        if (!open.ok) return open;
        const branchTip = this.resolveBranch(branch);
        if (!branchTip.ok) return branchTip;
        const unfolded = open.value.filter((candidate) => !this.isFolded(candidate, branchTip.value ?? ""));
        if (unfolded.length === 0) return this.integrateBranch(plan, turn);
        return ok({
          exit: 0,
          lines: [...lines, `land: ${unfolded.length} open code task(s) of the plan are not folded yet (${unfolded.map((candidate) => candidate.slug).join(", ")}); main is unchanged`],
          errors: [],
        });
      });
    } catch (cause) {
      return this.queueFailure(cause);
    }
  }

  /**
   * Folds the tip of `task` into the plan's integration branch: fast-forward when the branch is an ancestor of the tip, else a merge.
   * A task whose tip the branch already holds only gets its `folded` entry (a resume after a crash between the ref update and the log).
   */
  private async foldIntoIntegrationBranch(task: DocRecord, plan: DocRecord): Promise<Result<FoldResult, LoreError>> {
    const branch = plan.extra["integration_branch"];
    if (typeof branch !== "string" || branch === "") return err(refusal("integration-branch-missing", `the plan of ${task.slug} declares no integration branch`));
    const claim = extractHeldClaim(task);
    const claimBranch = claimBranchOf(claim);
    if (claimBranch === undefined) return err(refusal("no-claim", `${task.slug} holds no claim on a branch`));
    const tipResult = this.resolveBranch(claimBranch);
    if (!tipResult.ok) return tipResult;
    const headResult = this.resolveBranch(branch);
    if (!headResult.ok) return headResult;
    if (tipResult.value === null) return err(refusal("branch-missing", `the branch ${claimBranch} of ${task.slug} no longer exists`));
    if (headResult.value === null) return err(refusal("integration-branch-missing", `the integration branch ${branch} does not exist; create it with \`lore plan integration-branch\``));
    const tip = tipResult.value;
    const head = headResult.value;
    if (this.isFolded(task, head)) return ok({ kind: "already", foldCommit: head });

    let foldCommit: string;
    let kind: "fast-forward" | "merge" | "contained";
    if (this.isAncestor(tip, head)) {
      foldCommit = head;
      kind = "contained";
    } else if (this.isAncestor(head, tip)) {
      foldCommit = tip;
      kind = "fast-forward";
    } else {
      const merged = this.mergeCommit(task.slug, branch, head, tip);
      if (!merged.ok) return merged;
      foldCommit = merged.value;
      kind = "merge";
    }
    if (kind !== "contained") {
      const moved = this.ports.git(["update-ref", `refs/heads/${branch}`, foldCommit, head]);
      if (moved.status !== 0) {
        const actual = this.resolveBranch(branch);
        return ok({ kind: "raced", expected: head, actual: actual.ok && actual.value !== null ? actual.value : head });
      }
    }
    const appended = await this.ports.log.appendEntries(task, [{ kind: "folded", at: this.ports.now(), tip, fold_commit: foldCommit }]);
    if (!appended.ok) return appended;
    return ok({ kind: kind === "contained" ? "already-contained" : kind, foldCommit });
  }

  /** The merge commit of `tip` onto `head` computed without a working tree; a conflict names its files and changes nothing. */
  private mergeCommit(slug: string, branch: string, head: string, tip: string): Result<string, LoreError> {
    const tree = this.ports.git(["merge-tree", "--write-tree", "--name-only", head, tip]);
    if (tree.status === 1) {
      const lines = tree.stdout.split("\n");
      const files: string[] = [];
      for (const line of lines.slice(1)) {
        if (line === "") break;
        files.push(line);
      }
      return err(
        refusal(
          "fold-conflict",
          `${slug} conflicts with ${branch} in ${files.length} path(s); ${branch} is unchanged:\n${files.map((file) => `  ${file}`).join("\n")}\n` +
            `Merge ${branch} into the task branch in its worktree, resolve, commit, run \`lore finish ${slug}\` and \`lore land ${slug}\` again.`,
          files,
        ),
      );
    }
    if (tree.status !== 0) return err({ code: "STORE_ERROR", message: `land: git merge-tree of ${branch} and ${slug} failed (exit ${tree.status}): ${tree.stderr.trim()}` });
    const treeId = tree.stdout.split("\n")[0]?.trim() ?? "";
    const commit = this.ports.git(["commit-tree", treeId, "-p", head, "-p", tip, "-m", `fold(${slug}): merge ${short(tip)} into ${branch}`]);
    if (commit.status !== 0) return err({ code: "STORE_ERROR", message: `land: creating the fold commit failed (exit ${commit.status}): ${commit.stderr.trim()}` });
    return ok(commit.stdout.trim());
  }

  /** The open code tasks of `plan`: approved or active, of kind code. Check and corpus tasks never gate the landing. */
  private async openCodeTasks(plan: DocRecord): Promise<Result<DocRecord[], LoreError>> {
    const all = await this.ports.store.findMany({ type: "task" });
    if (!all.ok) return all;
    return ok(all.value.filter((task) => isPlanMember(task, plan.id) && task.extra["kind"] === "code" && (task.status === "approved" || task.status === "active")));
  }

  /** Whether the log of `task` holds a `folded` entry whose tip the branch (at `branchTip`) contains. */
  private isFolded(task: DocRecord, branchTip: string): boolean {
    const log = readLog(task);
    if (!log.ok) return false;
    return log.value.foldedTips().some((tip) => this.isAncestor(tip, branchTip));
  }

  // ───────────────────────────── landing the branch ─────────────────────────────

  /** Integrates the plan's integration branch into main inside the turn the fold holds, then archives and reports (AC-DCS2-19). */
  private async integrateBranch(plan: DocRecord, turn: HeldTurn): Promise<Result<LandOutcome, LoreError>> {
    const branch = String(plan.extra["integration_branch"]);
    // reason: the tasks the landing archives are read BEFORE it (afterwards they are archived and no longer open).
    const open = await this.openCodeTasks(plan);
    if (!open.ok) return open;
    const entries = open.value.map(landEntryOf);
    // reason: the queue instance holds this turn, so the integrate port's own ticket shares it instead of waiting behind the fold.
    const exit = await this.integrateOnce(branch);
    if (exit !== 0) return ok({ ...this.failed(exit, `integrating ${branch}`, turn.target), lines: turn.lines });
    const archived = await this.archiveWalk(entries, turn.target);
    await this.ports.planClose?.afterBranchLanded(plan);
    return ok({
      exit: archived.errors.length === 0 ? 0 : 4,
      lines: [...turn.lines, `land: landed ${branch} on main`, ...archived.lines],
      errors: archived.errors,
    });
  }

  /** `lore land <integration-branch>`: integrates the branch itself, also when it is already in main (integrate's oracle run is the proof). */
  private async landBranch(branch: string): Promise<Result<LandOutcome, LoreError>> {
    const plans = await this.ports.store.findMany({ type: "plan" });
    if (!plans.ok) return plans;
    const declaring = plans.value.filter((plan) => plan.extra["integration_branch"] === branch);
    // reason: read BEFORE the integrate, which archives them; only the tasks the branch holds are landed by it, an unfolded task keeps
    // its own branch and is not walked.
    const entries: LandEntry[] = [];
    const head = this.resolveBranch(branch);
    if (!head.ok) return head;
    for (const plan of declaring) {
      const open = await this.openCodeTasks(plan);
      if (!open.ok) return open;
      for (const task of open.value) if (head.value !== null && this.isFolded(task, head.value)) entries.push(landEntryOf(task));
    }
    const exit = await this.integrateOnce(branch);
    if (exit !== 0) return ok(this.failed(exit, `integrating ${branch}`, branch));
    const archived = await this.archiveWalk(entries, branch);
    for (const plan of declaring) await this.ports.planClose?.afterBranchLanded(plan);
    return ok({ exit: archived.errors.length === 0 ? 0 : 4, lines: [`land: landed ${branch} on main`, ...archived.lines], errors: archived.errors });
  }

  /** Runs the one integrate; the exit code of a failed one, 0 when it succeeded. */
  private async integrateOnce(branch: string): Promise<number> {
    try {
      await this.integrate.integrate(branch);
      return 0;
    } catch (cause) {
      if (cause instanceof LandIntegrateFailed) return cause.exit;
      throw cause;
    }
  }

  private get integrate(): LandPorts["integrate"] {
    return this.ports.integrate;
  }

  /** The done walk for tasks the landing should have archived: those still open get `lore done`, whose refusal is reported with the next command. */
  private async archiveWalk(entries: readonly LandEntry[], target: string): Promise<{ readonly lines: string[]; readonly errors: string[] }> {
    const lines: string[] = [];
    const errors: string[] = [];
    for (const { slug } of entries) {
      const found = await resolveDoc(this.ports.store, slug);
      if (!found.ok) {
        errors.push(`land: ${slug} cannot be read: ${found.error.code}`);
        continue;
      }
      if (found.value.status === "archived") {
        lines.push(`land: archived ${slug}`);
        continue;
      }
      const done = await this.ports.done(slug);
      if (done.ok) {
        lines.push(`land: archived ${slug}`);
        // reason: the done walk's worktree outcome (removed / gone / kept <reason>) is carried through in done's own form; the autopilot
        // skill tells agents to follow a kept reason, so dropping it would leave a kept worktree unreported.
        for (const outcome of done.value.worktree_outcomes ?? []) lines.push(formatWorktreeOutcomeLine(outcome));
        continue;
      }
      errors.push(`land: ${slug} is landed but not archived: ${"message" in done.error ? done.error.message : done.error.code}\nland: the landing stays recorded; fix the cause, then run \`lore land ${target}\` again`);
    }
    return { lines, errors };
  }

  // ───────────────────────────── helpers ─────────────────────────────

  private failed(exit: number, what: string, target: string): LandOutcome {
    return {
      exit,
      lines: [],
      errors: [`land: ${what} failed (exit ${exit}); every earlier step stays recorded. Fix the cause shown above, then run \`lore land ${target}\` again`],
    };
  }

  /** The commit of local branch `name`, `null` when there is none; a git fault is an error, never "absent". */
  private resolveBranch(name: string): Result<string | null, LoreError> {
    const run = this.ports.git(["rev-parse", "--verify", "--quiet", `refs/heads/${name}^{commit}`]);
    if (run.status === 0) return ok(run.stdout.trim());
    if (run.status === 1 && run.stderr.trim() === "") return ok(null);
    return err({ code: "STORE_ERROR", message: `land: branch ${name} cannot be read (git exit ${run.status}): ${run.stderr.trim()}` });
  }

  private isAncestor(commit: string, of: string): boolean {
    return this.ports.git(["merge-base", "--is-ancestor", commit, of]).status === 0;
  }

  private queueFailure(cause: unknown): Result<LandOutcome, LoreError> {
    if (cause instanceof IntegrateQueueTimeoutError) {
      return ok({ exit: LAND_EXIT_BUSY, lines: [], errors: [`integrate-queue-timeout: waited ${cause.waitedSeconds.toFixed(0)}s for the merge queue (limit ${cause.limitSeconds}s); nothing was changed; run \`lore land\` again`] });
    }
    if (cause instanceof IntegrateQueueUnreadableError) return err({ code: "STORE_ERROR", message: cause.message });
    throw cause;
  }
}

type FoldResult =
  | { readonly kind: "fast-forward" | "merge" | "already-contained"; readonly foldCommit: string }
  | { readonly kind: "already"; readonly foldCommit: string }
  | { readonly kind: "raced"; readonly expected: string; readonly actual: string };
