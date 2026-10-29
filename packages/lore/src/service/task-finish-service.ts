/**
 * Module: task-finish-service — `lore finish` of a code task: runs every oracle of the stored done contract itself, reports ALL
 * unmet items at once, records the attested rows in one corpus write and keeps the claim, marked finished (AC-DCS1-15..17).
 *
 * Purpose: the implementer's one closing verb. It resolves the caller's claim, refuses what cannot be measured (no claim, a
 * shared branch, a cwd outside the claim worktree, a dirty tree), reads HEAD once as `preRunHead`, runs the contract's oracles at
 * that commit through the verify runner (the AC oracles by AC id, each test file as an unfiltered whole-file run, typecheck)
 * even after one fails, derives the write-set additions, and records every row, the additions and the finished mark in ONE write
 * (`TaskWorkflowService.recordFinishRun`: compare-and-swap on the task version, the claim holder, HEAD and the tree).
 * Public surface: {@link TaskFinishService}, {@link TaskFinishDeps}, {@link FinishInput}, {@link FinishOutcome}.
 * Invariants:
 *   - rows are measured by the runner (`VerifyRunnerService`) and written by `recordFinishRun`; this module records nothing of
 *     its own and copies no attestation rule.
 *   - a `fail` row is recorded only when it is a proven red (a runner summary reporting >= 1 failed test, BR-1077): any recorded
 *     fail row satisfies the red-first floor, so a broken command (exit 126/127, no summary) or a failing typecheck is reported
 *     as unmet and leaves no row.
 *   - `--red` runs only the AC oracles, records `expected-fail` rows only when EVERY oracle is a proven red, and otherwise writes
 *     nothing at all.
 *   - a check or corpus task is finished from the shared checkout, with no claim, no worktree and no subagent (AC-DCS1-19..21):
 *     the checkout is measured first (main working copy, HEAD = tip of main, clean tree), the run may change no file
 *     (`kind-wrote-files`), the rows are written once under `expectedVersion: task.version` and the task is archived by `done`.
 * Side-effect class: runs oracle processes through the verify runner; git reads; one corpus write.
 *
 * Source: spec-done-contract-compiled-at-approve-task-kinds-write-sets (AC-DCS1-15, AC-DCS1-16, AC-DCS1-17), ledger D28, D33.
 */

import { realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import {
  CAPTURE_TAIL_CHARS,
  doneContractSchema,
  err,
  extractHeldClaim,
  ok,
  parseFailedCaseCount,
  type DocRecord,
  type DoneContract,
  type DoneContractOracle,
  type LoreError,
  type Result,
  type RunId,
  type TaskClaim,
} from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { createGitRunner, type GitRunner } from "./evidence-binding.js";
import { decideStampOutcome, probeGitState } from "./git-state-stamp.js";
import { resolveDoc } from "./resolve.js";
import type { DoneOpts, FinishRunWrite, VerifiedEvidenceInput } from "./task-workflow-service.js";
import type { ContractOracleToRun, VerifyPlanResult, VerifyRunnerService } from "./verify-runner-service.js";

/** The named refusals of `lore finish`, each stated once. */
export const FINISH_REFUSALS = [
  "contract-missing",
  "red-not-required",
  "not-shared-checkout",
  "head-not-main-tip",
  "shared-checkout-dirty",
  "kind-wrote-files",
  "no-claim",
  "shared-branch",
  "not-in-claim-worktree",
  "dirty-worktree",
  "finish-unmet",
  "red-unexpected-pass",
  "red-not-measured",
] as const;

/** One of {@link FINISH_REFUSALS}. */
export type FinishRefusal = (typeof FINISH_REFUSALS)[number];

/** The services `lore finish` composes; `app.ts` binds them (services never import each other). */
export interface TaskFinishDeps {
  readonly store: StoreInterface;
  readonly workflow: {
    deriveFinishAdditions(task: DocRecord, claim: TaskClaim, contract: DoneContract): Result<DoneContractOracle[], LoreError>;
    recordFinishRun(input: FinishRunWrite): Promise<Result<DocRecord, LoreError>>;
    findSharedBranchHolder(task: DocRecord, branch: string, nowIso: string): Promise<Result<string | undefined, LoreError>>;
    /** Archives a check or corpus task whose rows were just recorded (the same `lore done` floors judge them). */
    done(idOrSlug: string, opts: DoneOpts): Promise<Result<unknown, LoreError>>;
  };
  readonly verify: Pick<VerifyRunnerService, "verifyPlan" | "verifyAdhocTask" | "runContractOracles">;
}

/** What one `lore finish` call is given. */
export interface FinishInput {
  /** Task slug or id. */
  readonly task: string;
  /** `--red`: run the red stage (AC oracles only). */
  readonly red: boolean;
  /** The caller's working directory (inside the claim worktree). */
  readonly cwd: string;
  /** The caller's actor name, recorded on the rows. */
  readonly by: string;
  /** The caller's verified run; `null` when it has none (then it holds no claim). */
  readonly harnessRun: string | null;
  /** The one reading of "now". */
  readonly nowIso: string;
}

/** What a successful `lore finish` did. */
export interface FinishOutcome {
  readonly slug: string;
  readonly mode: "finished" | "red";
  /** The commit the run read: on a finish, the commit every oracle ran on and the claim is finished at. */
  readonly head: string;
  /** The oracle ids that were run and their results, in run order. */
  readonly oracles: readonly { readonly id: string; readonly result: string }[];
  /** Oracle ids the write set added to the contract in this write. */
  readonly added_oracles: readonly string[];
  /** The next step the implementer prints. */
  readonly next_step: string;
}

/** One unmet item of a finish: an oracle id or a floor name, and why. */
interface UnmetItem {
  readonly name: string;
  readonly cause: string;
}

/** The result of one oracle of the run, before it is judged. */
interface OracleResult {
  readonly name: string;
  readonly passed: boolean;
  readonly cause: string;
}

function refusal(name: FinishRefusal, message: string, value?: unknown): LoreError {
  return { code: "VALIDATION_ERROR", field: name, message: `${name}: ${message}`, value: { refusal: name, ...(value !== undefined ? { detail: value } : {}) } };
}

/** The oracle of a corpus task that `finish` proves itself, from the file comparison (it has no command of its own). */
const CORPUS_ORACLE_ID = "corpus:files-unchanged";

/** The refusal of a check or corpus run that changed files; it names only the paths changed during the run. */
function kindWroteFiles(paths: readonly string[]): LoreError {
  return refusal(
    "kind-wrote-files",
    `the oracles changed ${paths.length} file(s) in the shared checkout: ${paths.join(", ")}. A check or corpus task changes no file (a corpus task changes the corpus only through lore commands); nothing was recorded.`,
    paths,
  );
}

/** The paths \`git status --porcelain\` lists (ignored paths are not listed), or why git could not answer. */
function readChangedPaths(git: GitRunner): { readonly ok: true; readonly paths: string[] } | { readonly ok: false; readonly reason: string } {
  const status = git(["status", "--porcelain", "--untracked-files=all"]);
  if (!status.ok) return status;
  return { ok: true, paths: status.stdout.split("\n").filter((line) => line.trim() !== "").map((line) => line.slice(3).trim()) };
}

function toUnmetItem(result: OracleResult): UnmetItem {
  return { name: result.name, cause: result.cause };
}

/**
 * Whether a recorded `fail` row is a proven red: its command ran (not exit 126/127) and the runner's own summary reports at least
 * one failed test (BR-1077). The single judgment behind both the red stage and the normal run's `fail` rows.
 */
function isProvenFail(entry: VerifiedEvidenceInput): boolean {
  const exit = entry.attestation?.exit_code;
  if (exit === 126 || exit === 127) return false;
  const summary = { failedTests: parseFailedCaseCount(entry.output_tail ?? "") ?? 0 };
  if (summary.failedTests < 1) return false;
  return true;
}

/** The oracle kind a contract oracle id is recorded under, or `undefined` for an id this flow cannot run. */
function oracleToRun(oracle: DoneContractOracle): ContractOracleToRun | undefined {
  if (oracle.command === undefined) return undefined;
  if (oracle.id.startsWith("test:")) return { id: oracle.id, oracle: "test", command: oracle.command };
  if (oracle.id === "typecheck") return { id: oracle.id, oracle: "tsc", command: oracle.command };
  return undefined;
}

export class TaskFinishService {
  constructor(private readonly deps: TaskFinishDeps) {}

  /**
   * Finishes (or, with `red`, runs the red stage of) a code task.
   *
   * @param input - see {@link FinishInput}
   * @returns the outcome, or a refusal (exit 4: every unmet item in ONE message), or a lost race (exit 5, nothing recorded)
   */
  async finish(input: FinishInput): Promise<Result<FinishOutcome, LoreError>> {
    const resolved = await resolveDoc(this.deps.store, input.task);
    if (!resolved.ok) return resolved;
    const task = resolved.value;
    if (task.type !== "task") return err({ code: "VALIDATION_ERROR", field: "type", message: `Expected a task document; got type '${task.type}'`, value: task.type });
    const stored = doneContractSchema.safeParse(task.extra["done_contract"]);
    if (!stored.success) {
      return err(refusal("contract-missing", `${task.slug} holds no done contract; it is compiled at approve (\`lore approve ${task.slug}\`), and finish judges only by the stored contract.`));
    }
    const contract = stored.data;

    if (input.red) {
      if (contract.kind !== "code") return err(refusal("red-not-required", `${task.slug} is a ${contract.kind} task, which has no red run.`));
      if (!contract.red_required) {
        return err(refusal("red-not-required", `${task.slug} waived its red run at approve (${contract.red_waiver_reason ?? "no reason recorded"}).`));
      }
    }
    // reason: AC-DCS1-19 — a check or corpus task holds no claim and has no worktree: it is finished from the shared checkout.
    if (contract.kind !== "code") return this.finishInSharedCheckout(task, contract, input);

    const claim = extractHeldClaim(task);
    // reason: a claim taken with `--worktree <branch>` (the dispatch protocol) records the branch NAME as its worktree.
    const branch = claim?.branch ?? (claim?.worktree !== undefined && !isAbsolute(claim.worktree) ? claim.worktree : undefined);
    if (claim === undefined || input.harnessRun === null || claim.harness_run !== input.harnessRun || branch === undefined) {
      return err(refusal("no-claim", `${task.slug} holds no claim by your run; take it with \`lore start ${task.slug}\` first.`));
    }

    // reason: AC-DCS1-14 — one shared-branch rule: the workflow service's, the same one `claim` applies.
    const shared = await this.deps.workflow.findSharedBranchHolder(task, branch, input.nowIso);
    if (!shared.ok) return shared;
    if (shared.value !== undefined) return err(refusal("shared-branch", shared.value));

    const git = createGitRunner(input.cwd);
    const place = this.measurePlace(git, claim, branch, task.slug);
    if (!place.ok) return place;
    const root = place.value;
    const rootGit = createGitRunner(root);

    const dirty = rootGit(["status", "--porcelain"]);
    if (!dirty.ok) return err(refusal("dirty-worktree", `the state of ${root} cannot be read (${dirty.reason}); nothing ran.`));
    const dirtyPaths = dirty.stdout.split("\n").filter((line) => line.trim() !== "").map((line) => line.slice(3).trim());
    if (dirtyPaths.length > 0) {
      return err(refusal("dirty-worktree", `${root} has uncommitted changes (${dirtyPaths.join(", ")}); commit them, then finish again. Nothing ran and nothing was recorded.`, dirtyPaths));
    }
    const head = rootGit(["rev-parse", "HEAD"]);
    if (!head.ok) return err(refusal("not-in-claim-worktree", `HEAD of ${root} cannot be read (${head.reason}).`));
    const preRunHead = head.stdout.trim();

    // The oracle set: the contract's, its added ones and the write-set additions derived again for this claim; never fewer.
    const additions = this.deps.workflow.deriveFinishAdditions(task, claim, contract);
    if (!additions.ok) return additions;
    const allOracles: DoneContractOracle[] = [];
    for (const oracle of [...contract.oracles, ...contract.added_oracles, ...additions.value]) {
      if (!allOracles.some((known) => known.id === oracle.id)) allOracles.push(oracle);
    }

    const collected: VerifiedEvidenceInput[] = [];
    const results: OracleResult[] = [];
    const run = await this.runOracles(task, allOracles, input, root, collected, results);
    if (!run.ok) return run;

    const recheck = (): { readonly ok: true } | { readonly ok: false; readonly path: string; readonly reason: string } => {
      const now = createGitRunner(root);
      const headNow = now(["rev-parse", "HEAD"]);
      if (!headNow.ok || headNow.stdout.trim() !== preRunHead) {
        return { ok: false, path: root, reason: `HEAD of ${root} moved while the oracles ran (it was ${preRunHead}); nothing was recorded. Run lore finish again.` };
      }
      const status = now(["status", "--porcelain"]);
      if (!status.ok || status.stdout.trim() !== "") {
        return { ok: false, path: root, reason: `${root} became dirty while the oracles ran; nothing was recorded. Commit or discard the change and run lore finish again.` };
      }
      return { ok: true };
    };

    if (input.red) return this.recordRed(task, input, preRunHead, collected, results, recheck);

    const unmet: UnmetItem[] = [];
    for (const result of results) {
      if (!result.passed) unmet.push(toUnmetItem(result));
    }
    if (contract.red_required && !this.hasRedRow(task)) {
      unmet.push({ name: "red-first", cause: "no runner-produced red run is on record (run `lore finish --red` before the work, or waive it at approve)" });
    }

    const written = await this.writeRun(task, input, {
      holderRun: input.harnessRun,
      // reason: any recorded `fail` row satisfies the red-first floor, so only a proven red is recorded as one (BR-1077).
      entries: collected.filter((row) => row.result !== "fail" || isProvenFail(row)),
      additions: additions.value,
      ...(unmet.length === 0 ? { finished_commit: preRunHead } : {}),
      recheck,
    });
    if (!written.ok) return written;
    if (unmet.length > 0) {
      const lines = unmet.map((item) => `  - ${item.name}: ${item.cause}`);
      return err(refusal("finish-unmet", `${task.slug} is not finished: ${unmet.length} item(s) unmet. Every oracle ran; the rows that could be measured are recorded and the claim is not marked finished.\n${lines.join("\n")}`, unmet.map((item) => item.name)));
    }
    return ok({
      slug: task.slug,
      mode: "finished",
      head: preRunHead,
      oracles: results.map((result) => ({ id: result.name, result: "pass" })),
      added_oracles: additions.value.map((oracle) => oracle.id),
      next_step: `lore land ${task.slug}`,
    });
  }

  /**
   * The ONE corpus write of every finish path (AC-DCS1-15, AC-DCS1-19, AC-DCS1-20): a compare-and-swap on the task version this
   * run read, so a rival write during the oracles makes it exit 5 with nothing recorded.
   */
  private writeRun(
    task: DocRecord,
    input: FinishInput,
    run: Pick<FinishRunWrite, "holderRun" | "entries" | "additions" | "recheck"> & { readonly finished_commit?: string },
  ): Promise<Result<DocRecord, LoreError>> {
    return this.deps.workflow.recordFinishRun({
      taskSlug: task.slug,
      expectedVersion: task.version,
      by: input.by,
      nowIso: input.nowIso,
      ...run,
    });
  }

  /**
   * Finishes a check or corpus task from the shared checkout (AC-DCS1-19..21): measures the checkout before anything runs, runs the
   * contract's oracles at that commit with no claim and no worktree, refuses `kind-wrote-files` when the run changed a file, proves
   * `corpus:files-unchanged` for a corpus task, records every row in one write and archives the task when its rows count.
   */
  private async finishInSharedCheckout(task: DocRecord, contract: DoneContract, input: FinishInput): Promise<Result<FinishOutcome, LoreError>> {
    const placed = this.measureSharedCheckout(contract, input.cwd, task.slug);
    if (!placed.ok) return placed;
    const { root, head: preRunHead } = placed.value;
    const rootGit = createGitRunner(root);

    const oracles: DoneContractOracle[] = [];
    for (const oracle of [...contract.oracles, ...contract.added_oracles]) {
      if (!oracles.some((known) => known.id === oracle.id)) oracles.push(oracle);
    }
    const collected: VerifiedEvidenceInput[] = [];
    const results: OracleResult[] = [];
    const startedAt = Date.now();
    const before = probeGitState(root);
    const run = await this.runOracles(task, oracles, input, root, collected, results, "corpus_root");
    if (!run.ok) return run;

    const after = readChangedPaths(rootGit);
    if (!after.ok) return err(refusal("shared-checkout-dirty", `the state of ${root} cannot be read after the run (${after.reason}); nothing was recorded.`));
    const changedFiles = after.paths;
    if (changedFiles.length > 0) return err(kindWroteFiles(changedFiles));

    if (oracles.some((oracle) => oracle.id === CORPUS_ORACLE_ID)) {
      // reason: the one oracle with no command of its own is proved here, from the comparison that just passed (AC-DCS1-21).
      collected.push({
        oracle: "other",
        command: CORPUS_ORACLE_ID,
        result: "pass",
        recorded_by: input.by,
        capture_source: "runner",
        output_tail: `no file changed in ${root} while the oracles ran`,
        attestation: {
          runner: "lore-cli",
          exit_code: 0,
          duration_ms: Date.now() - startedAt,
          timed_out: false,
          execution_root: root,
          execution_mode: "corpus_root",
          ...decideStampOutcome(before, probeGitState(root)),
        },
      });
      results.push({ name: CORPUS_ORACLE_ID, passed: true, cause: "passed" });
    }

    const recheck: FinishRunWrite["recheck"] = () => {
      const now = createGitRunner(root);
      const headNow = now(["rev-parse", "HEAD"]);
      const tip = now(["rev-parse", `refs/heads/${contract.base_branch}`]);
      if (!headNow.ok || headNow.stdout.trim() !== preRunHead || !tip.ok || tip.stdout.trim() !== preRunHead) {
        return { ok: false, path: root, reason: `HEAD or ${contract.base_branch} of ${root} moved while the oracles ran (it was ${preRunHead}); nothing was recorded. Run lore finish again.` };
      }
      const status = readChangedPaths(now);
      if (!status.ok || status.paths.length > 0) {
        return { ok: false, path: root, reason: `${root} changed while the oracles ran; nothing was recorded. Run lore finish again.` };
      }
      return { ok: true };
    };

    const unmet = results.filter((result) => !result.passed).map(toUnmetItem);
    const written = await this.writeRun(task, input, {
      holderRun: null,
      entries: collected.filter((row) => row.result !== "fail" || isProvenFail(row)),
      additions: [],
      recheck,
    });
    if (!written.ok) return written;
    if (unmet.length > 0) {
      const lines = unmet.map((item) => `  - ${item.name}: ${item.cause}`);
      return err(refusal("finish-unmet", `${task.slug} is not finished: ${unmet.length} item(s) unmet. Every oracle ran; the rows that could be measured are recorded and nothing is archived.\n${lines.join("\n")}`, unmet.map((item) => item.name)));
    }
    // reason: the rows just recorded are the evidence `done` judges by the second rule (a main commit containing the compile commit);
    // one that does not count is refused by `done` with its floor, and the rows stay.
    const archived = await this.deps.workflow.done(task.slug, { by: input.by, source: "cli", ...(input.harnessRun !== null ? { harnessRun: input.harnessRun as RunId } : {}) });
    if (!archived.ok) return archived;
    return ok({
      slug: task.slug,
      mode: "finished",
      head: preRunHead,
      oracles: results.map((result) => ({ id: result.name, result: "pass" })),
      added_oracles: [],
      next_step: `${task.slug} is archived`,
    });
  }

  /**
   * Measures the shared checkout before anything runs: the main working copy (git dir equals the common dir; never a linked
   * worktree), HEAD equal to the tip of the contract's base branch (never the branch NAME, the checkout is detached, BR-1342) and a
   * clean tree. Each refusal records nothing and runs no oracle.
   */
  private measureSharedCheckout(contract: DoneContract, cwd: string, slug: string): Result<{ root: string; head: string }, LoreError> {
    const git = createGitRunner(cwd);
    const top = git(["rev-parse", "--show-toplevel"]);
    const gitDir = git(["rev-parse", "--git-dir"]);
    const common = git(["rev-parse", "--git-common-dir"]);
    if (!top.ok || !gitDir.ok || !common.ok) {
      return err(refusal("not-shared-checkout", `${cwd} is not inside a git working copy; run \`lore finish ${slug}\` from the shared checkout. Nothing ran.`));
    }
    const root = realpathSync(top.stdout.trim());
    let linked: boolean;
    try {
      linked = realpathSync(resolve(cwd, gitDir.stdout.trim())) !== realpathSync(resolve(cwd, common.stdout.trim()));
    } catch (cause) {
      return err(refusal("not-shared-checkout", `the git directory of ${cwd} cannot be read (${cause instanceof Error ? cause.message : String(cause)}). Nothing ran.`));
    }
    if (linked) {
      return err(refusal("not-shared-checkout", `${root} is a linked worktree; a ${contract.kind} task is finished in the shared checkout (the main working copy). Nothing ran.`));
    }
    const rootGit = createGitRunner(root);
    const head = rootGit(["rev-parse", "HEAD"]);
    const tip = rootGit(["rev-parse", `refs/heads/${contract.base_branch}`]);
    if (!head.ok || !tip.ok) {
      return err(refusal("head-not-main-tip", `HEAD or ${contract.base_branch} of ${root} cannot be read (${!head.ok ? head.reason : !tip.ok ? tip.reason : ""}). Nothing ran.`));
    }
    if (head.stdout.trim() !== tip.stdout.trim()) {
      return err(
        refusal(
          "head-not-main-tip",
          `HEAD is ${head.stdout.trim()} but the tip of ${contract.base_branch} is ${tip.stdout.trim()}; run \`git checkout --detach ${contract.base_branch}\` in ${root}, then \`lore finish ${slug}\` again. Nothing ran and nothing was recorded.`,
          { head: head.stdout.trim(), tip: tip.stdout.trim() },
        ),
      );
    }
    const dirty = readChangedPaths(rootGit);
    if (!dirty.ok) return err(refusal("shared-checkout-dirty", `the state of ${root} cannot be read (${dirty.reason}); nothing ran.`));
    if (dirty.paths.length > 0) {
      return err(refusal("shared-checkout-dirty", `${root} has uncommitted or untracked files (${dirty.paths.join(", ")}); commit or remove them, then finish again. Nothing ran and nothing was recorded.`, dirty.paths));
    }
    return ok({ root, head: head.stdout.trim() });
  }

  /** Whether the task already holds a runner-produced red row (a `fail` or `expected-fail` row of a runner). */
  private hasRedRow(task: DocRecord): boolean {
    const rows = task.extra["verification_evidence"];
    if (!Array.isArray(rows)) return false;
    return rows.some((row) => {
      const entry = row as { result?: string; attestation?: unknown; capture_source?: string };
      return (entry.result === "expected-fail" || entry.result === "fail") && entry.attestation !== undefined && entry.capture_source === "runner";
    });
  }

  /** The root of the claim's worktree when `cwd` is inside it, else `not-in-claim-worktree`. */
  private measurePlace(git: GitRunner, claim: TaskClaim, branch: string, slug: string): Result<string, LoreError> {
    const top = git(["rev-parse", "--show-toplevel"]);
    const current = git(["symbolic-ref", "--short", "-q", "HEAD"]);
    if (!top.ok || !current.ok || current.stdout.trim() !== branch) {
      return err(refusal("not-in-claim-worktree", `run \`lore finish ${slug}\` inside the worktree of its claim (branch ${branch}); this directory is not on it. Nothing ran.`));
    }
    const root = realpathSync(top.stdout.trim());
    if (claim.worktree !== undefined && isAbsolute(claim.worktree)) {
      let recorded: string;
      try {
        recorded = realpathSync(claim.worktree);
      } catch (cause) {
        return err(refusal("not-in-claim-worktree", `the recorded worktree ${claim.worktree} cannot be read (${cause instanceof Error ? cause.message : String(cause)}).`));
      }
      if (recorded !== root) {
        return err(refusal("not-in-claim-worktree", `run \`lore finish ${slug}\` inside ${claim.worktree}, the worktree of its claim; this directory belongs to ${root}. Nothing ran.`));
      }
    }
    return ok(root);
  }

  /** Runs the AC oracles through the verify runner and the test-file and typecheck oracles as contract oracles; every one runs. */
  private async runOracles(
    task: DocRecord,
    oracles: readonly DoneContractOracle[],
    input: FinishInput,
    root: string,
    collected: VerifiedEvidenceInput[],
    results: OracleResult[],
    mode: "worktree" | "corpus_root" = "worktree",
  ): Promise<Result<void, LoreError>> {
    const baseOpts = {
      by: input.by,
      nowIso: input.nowIso,
      executionRoot: { root, mode },
      commandsApprovedByContract: true,
    };
    const acIds = oracles.filter((oracle) => oracle.id.startsWith("ac:")).map((oracle) => oracle.id.slice("ac:".length));
    const others: ContractOracleToRun[] = [];
    for (const oracle of input.red ? [] : oracles) {
      if (oracle.id.startsWith("ac:")) continue;
      // reason: proved by `finishInSharedCheckout` itself from the file comparison, never spawned.
      if (oracle.id === CORPUS_ORACLE_ID) continue;
      const runnable = oracleToRun(oracle);
      if (runnable === undefined) {
        results.push({ name: oracle.id, passed: false, cause: "this oracle has no command finish can run" });
        continue;
      }
      others.push(runnable);
    }

    if (acIds.length > 0) {
      const sink = (entry: VerifiedEvidenceInput): void => {
        collected.push(entry);
      };
      const opts = { ...baseOpts, acIds, explicitTaskIdOrSlug: task.slug, collectRows: sink };
      let ran: Result<VerifyPlanResult, LoreError>;
      if (task.extra["adhoc"] === true) {
        const specs = await this.deps.store.findMany({ type: "spec" });
        if (!specs.ok) return specs;
        ran = await this.deps.verify.verifyAdhocTask(task, specs.value, opts);
      } else {
        const planId = task.extra["plan_id"];
        if (typeof planId !== "string" || planId === "") return err({ code: "VALIDATION_ERROR", field: "plan_id", message: `${task.slug} names no plan, so its AC oracles cannot be resolved.`, value: task.slug });
        ran = await this.deps.verify.verifyPlan(planId, opts);
      }
      if (!ran.ok) return ran;
      for (const result of ran.value.results) {
        results.push({ name: `ac:${result.ac_id}`, passed: result.result === "pass", cause: describeRun(result) });
      }
      for (const superseded of ran.value.superseded) {
        const by = superseded.superseded_by;
        // reason: the reference stores the superseding spec's id; the message names its slug, which a person can open.
        const replacing = await this.deps.store.find(by.spec as DocRecord["id"]);
        const specName = replacing.ok && replacing.value !== null ? replacing.value.slug : by.spec;
        results.push({ name: `ac:${superseded.ac_id}`, passed: false, cause: `ac-superseded: superseded by ${specName}:${by.ac} (${by.reason}); correct the task to the replacing criterion` });
      }
      for (const skipped of ran.value.skipped) {
        results.push({ name: `ac:${skipped.ac_id}`, passed: false, cause: `no longer a script criterion (${skipped.mode}); correct the task` });
      }
    }

    if (others.length > 0) {
      const ran = await this.deps.verify.runContractOracles(task, others, { ...baseOpts, collectRows: (entry) => collected.push(entry) });
      if (!ran.ok) return ran;
      for (const result of ran.value.results) {
        results.push({ name: result.ac_id, passed: result.result === "pass", cause: describeRun(result) });
      }
    }
    return ok(undefined);
  }

  /**
   * The red stage: records `expected-fail` rows only when EVERY AC oracle ran and is a proven red; any oracle that passes
   * (`red-unexpected-pass`) or whose command did not run as a test (`red-not-measured`, exit 126/127 included) refuses the whole
   * stage and records nothing (BR-1077).
   */
  private async recordRed(
    task: DocRecord,
    input: FinishInput,
    preRunHead: string,
    collected: readonly VerifiedEvidenceInput[],
    results: readonly OracleResult[],
    recheck: FinishRunWrite["recheck"],
  ): Promise<Result<FinishOutcome, LoreError>> {
    const passing = results.filter((result) => result.passed).map((result) => result.name);
    if (passing.length > 0) {
      return err(refusal("red-unexpected-pass", `${passing.join(", ")} passed before the work exists, so there is no red run to record; write the failing test first. Nothing was recorded.`, passing));
    }
    const rows: VerifiedEvidenceInput[] = [];
    const proven = new Set<string>();
    for (const row of collected) {
      if (row.result === "fail" && isProvenFail(row)) {
        rows.push({ ...row, result: "expected-fail" });
        proven.add(`ac:${row.ac_ref}`);
      }
    }
    const names = results.filter((result) => !proven.has(result.name)).map((result) => result.name);
    if (names.length > 0) {
      return err(refusal("red-not-measured", `${names.join(", ")} did not produce a red the runner can prove (a command that could not start, exit 126/127, or no failed test in its summary is never a red, BR-1077). Nothing was recorded.`, names));
    }
    const written = await this.writeRun(task, input, { holderRun: input.harnessRun as string, entries: rows, additions: [], recheck });
    if (!written.ok) return written;
    return ok({
      slug: task.slug,
      mode: "red",
      head: preRunHead,
      oracles: results.map((result) => ({ id: result.name, result: "expected-fail" })),
      added_oracles: [],
      next_step: `implement, commit, then \`lore finish ${task.slug}\``,
    });
  }
}

/** Why an oracle is unmet, from what the runner reported (exit code, timeout, guard verdict). */
function describeRun(result: VerifyPlanResult["results"][number]): string {
  if (result.result === "pass") return "passed";
  if (result.timed_out) return "timed out";
  if (result.result === "inconclusive") return `inconclusive (exit ${result.exit_code}; the runner could not certify it: ${result.completeness ?? result.binary_freshness ?? "no test ran"})`;
  return `failed (exit ${result.exit_code})`;
}

/** The tail length a row's output keeps; re-exported so the CLI's help names one number. */
export const FINISH_OUTPUT_TAIL_CHARS = CAPTURE_TAIL_CHARS;
