/**
 * Module: integrate-oracle-service — the evidence `lore integrate` produces at landing (spec-integrate-proves-and-lands-evidence-at-
 * landing-the-merge AC-DCS2-1 to AC-DCS2-4; spec-done-contract-compiled-at-approve-task-kinds-write-sets AC-DCS1-27, AC-DCS1-30).
 *
 * Purpose: select the tasks a landing belongs to, run the UNION of their contract oracles once on the merged tree (bounded, each oracle
 *   once, a failing one re-run once), and record one runner-attested row per oracle per task, bound to the commit that became main.
 * Public surface: {@link IntegrateOracleService} (`select`, `prove`, `record`), {@link LandingOracles}, {@link unionOracles},
 *   {@link collectLandingTasks}, {@link LandingTask}, {@link UnionOracle}, {@link OracleOutcome}, {@link OracleProof},
 *   {@link OracleSettings}, {@link ORACLE_TIMEOUT_DEFAULT_SECONDS}, {@link INTEGRATE_ORACLE_FAILED}.
 * Invariants:
 *   - ONE selection rule ({@link collectLandingTasks}): tasks claimed on the branch, plus — when the branch is a plan's declared
 *     integration branch — the plan's approved or active code tasks with no landing record whose recorded claim tip the branch contains.
 *     A draft, deprecated, archived, check or corpus task is never selected.
 *   - the oracles that run are exactly the union of the selected tasks' contract oracles (plus write-set additions), de-duplicated by
 *     command, minus the ids `workflow.integrate.floor_covers` names; nothing is sampled and the full suite never runs.
 *   - a failing oracle (after its single re-run; `typecheck` is never re-run) refuses the landing with `integrate-oracle-failed`
 *     BEFORE main moves; every oracle still runs, so every failure is named.
 *   - the rows of one task are written in ONE corpus write (a stale write is re-read and retried up to 3 times); a failed write is a
 *     WARNING line, never silent, and never un-lands main.
 *   - a flaky oracle is attached to the one flaky-tests ledger issue; a ledger failure never blocks the landing and is recorded on the row
 *     as `ledger_error` and printed.
 * Side-effect class: IO (git reads, the oracle commands through the verify runner, the install command, the tracker, corpus writes).
 */

import {
  err,
  extractFileAnchors,
  extractHeldClaim,
  doneContractSchema,
  ok,
  type AuditEntry,
  type DocRecord,
  type DoneContract,
  type DoneContractOracle,
  type LoreError,
  type Result,
} from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { claimedNamesOf, isTaskOfIntegrationBranch, planIntegrationBranches } from "./branch-membership.js";
import { createGitRunner, deletedByDiff, missingOracleFiles, pathExistsAt, type TestFileOracle } from "./evidence-binding.js";
import type { StampOutcome } from "./git-state-stamp.js";
import type { FlakyLedgerService } from "./issue-filing-service.js";
import type { FloorRunner } from "./integrate-service.js";
import { readTaskLanding } from "./task-commit-range.js";
import type { EvaluatedOracle, TaskWorkflowService, VerifiedEvidenceInput } from "./task-workflow-service.js";
import type { ContractOracleToRun, VerifyRunnerService } from "./verify-runner-service.js";

/** The name every oracle refusal of `lore integrate` prints first (exit 1, the code of a failed floor). */
export const INTEGRATE_ORACLE_FAILED = "integrate-oracle-failed";

/** `workflow.integrate.oracle_timeout_seconds` when the config does not set it. */
export const ORACLE_TIMEOUT_DEFAULT_SECONDS = 900;

/** Runs `git <args>` in `cwd`; never throws. */
export type OracleGit = (cwd: string, args: readonly string[]) => { readonly status: number; readonly stdout: string };

/** Stale corpus writes retried per task when the rows are recorded. */
const RECORD_MAX_ATTEMPTS = 3;

/** One task of a landing. */
export interface LandingTask {
  readonly slug: string;
  readonly doc: DocRecord;
  readonly contract: DoneContract;
  /** Why it was selected: it was claimed on the branch, or it belongs to the plan whose integration branch this is. */
  readonly via: "claimed" | "integration-branch";
}

/** One distinct oracle of the union. */
export interface UnionOracle {
  /** The id of the first task's oracle that named this command. */
  readonly id: string;
  readonly command: string;
  readonly oracle: ContractOracleToRun["oracle"];
  /** Every task of the landing that holds this oracle, in selection order. */
  readonly tasks: readonly string[];
}

/** What the integrate-time settings are: the CURRENT config's install command, the per-oracle timeout, the floor-covered ids. */
export interface OracleSettings {
  readonly installCommand: string | undefined;
  readonly timeoutSeconds: number;
  readonly floorCovers: ReadonlySet<string>;
  /** Who is recorded as the writer of the rows. */
  readonly by: string;
}

/** One run of one oracle's command. */
interface Attempt {
  readonly passed: boolean;
  /** `passed`, `failed (exit N)`, `timeout`, `inconclusive (...)`. */
  readonly cause: string;
  readonly durationMs: number;
  readonly row: VerifiedEvidenceInput | undefined;
}

/** The outcome of one distinct oracle of the union. */
export interface OracleOutcome {
  readonly oracle: UnionOracle;
  readonly passed: boolean;
  readonly cause: string;
  readonly durationMs: number;
  /** Present on a pass that needed its single re-run: what the first run reported. */
  readonly flaky?: { readonly firstOutcome: string };
  /** The row of the final run (the passing one). */
  readonly row: VerifiedEvidenceInput | undefined;
}

/** What `prove` hands back: the tasks whose oracles ran, the tasks left out with their floor, and one outcome per distinct oracle. */
export interface OracleProof {
  readonly tasks: readonly LandingTask[];
  readonly excluded: readonly { readonly task: string; readonly floor: "missing-oracle-file" | "oracle-unresolved"; readonly paths: readonly string[]; readonly message: string }[];
  readonly outcomes: readonly OracleOutcome[];
}

/** Everything `prove` needs from the landing. */
export interface OracleRunInput {
  readonly branch: string;
  readonly tip: string;
  readonly tasks: readonly LandingTask[];
  /** The integration worktree, holding the tree that becomes main (or main's tip for an already-integrated branch). */
  readonly worktree: string;
  /** The commit the oracles run on: the merge commit, or main's tip T. */
  readonly commit: string;
  /** The main the landing started from; equals `commit` for an already-integrated branch. */
  readonly base: string;
  /** The floor command's own measurement, reused for the floor-covered oracle ids. */
  readonly floor: { readonly durationMs: number; readonly stamp: StampOutcome } | undefined;
  readonly settings: OracleSettings;
  readonly runCommand: FloorRunner;
  readonly log: (line: string) => void;
  readonly clock: () => number;
  readonly nowIso: string;
}

/** Everything `record` needs. */
export interface OracleRecordInput {
  readonly tasks: readonly LandingTask[];
  /** The commit that became main (the landing commit). */
  readonly commit: string;
  readonly outcomes: readonly OracleOutcome[];
  readonly by: string;
  readonly nowIso: string;
  readonly log: (line: string) => void;
}

/** The slugs whose rows were written, and the ones whose write failed. */
export interface OracleRecordSummary {
  readonly recorded: readonly string[];
  readonly failed: readonly string[];
}

/** The port `IntegrateService` calls; wired by the composition root, absent in a bare construction (then nothing is proven). */
export interface LandingOracles {
  readonly select: (branch: string, tip: string) => Promise<Result<readonly LandingTask[], LoreError>>;
  readonly prove: (input: OracleRunInput) => Promise<Result<OracleProof, LoreError>>;
  readonly record: (input: OracleRecordInput) => Promise<OracleRecordSummary>;
}

/** The reads and writes the service composes (the composition root wires the real ones). */
export interface IntegrateOracleDeps {
  readonly store: Pick<StoreInterface, "findMany" | "queryAudit">;
  readonly workflow: Pick<TaskWorkflowService, "liveOracleCommands" | "recordIntegrateEvidence" | "deriveFinishAdditions">;
  readonly verify: Pick<VerifyRunnerService, "runContractOracles">;
  readonly ledger: FlakyLedgerService;
  /** Git in the main checkout (refs live there). */
  readonly git: OracleGit;
  readonly projectRoot: string;
}

const ELIGIBLE_STATUSES: ReadonlySet<string> = new Set(["approved", "active"]);

function auditDetail(row: AuditEntry, key: string): string | undefined {
  const value = row.details?.[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function newestFirst(rows: readonly AuditEntry[]): AuditEntry[] {
  return [...rows].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

/**
 * The ONE selection rule of a landing (AC-DCS2-1): (a) the tasks claimed on `branch`, plus (b) when `branch` is a plan's declared
 * integration branch, every task of that plan that is approved or active, kind code, has no landing record and whose recorded claim tip
 * (the live claim's branch tip, else the `end_tip` of the newest release row) is an ancestor of `tip`. Never a draft, deprecated,
 * archived, check or corpus task.
 *
 * @param deps - store and git reads
 * @param branch - the branch being landed, as typed
 * @param tip - its commit
 * @returns the selected tasks in corpus order, or the failing read
 */
export async function collectLandingTasks(deps: Pick<IntegrateOracleDeps, "store" | "git" | "projectRoot">, branch: string, tip: string): Promise<Result<LandingTask[], LoreError>> {
  const tasks = await deps.store.findMany({ type: "task" });
  if (!tasks.ok) return tasks;
  const plans = await deps.store.findMany({ type: "plan" });
  if (!plans.ok) return plans;
  const claims = await deps.store.queryAudit({ action: "claim" });
  if (!claims.ok) return claims;
  const releases = await deps.store.queryAudit({ action: "release" });
  if (!releases.ok) return releases;
  const integrationBranches = planIntegrationBranches(plans.value);
  const selected: LandingTask[] = [];
  for (const task of tasks.value) {
    if (!ELIGIBLE_STATUSES.has(task.status)) continue;
    const contract = doneContractSchema.safeParse(task.extra["done_contract"]);
    if (!contract.success || contract.data.kind !== "code") continue;
    const landing = readTaskLanding(task.extra);
    const claimRows = claims.value.filter((row) => row.doc_id === task.id);
    if (claimedNamesOf(claimRows, task).includes(branch)) {
      // reason: a landing of this very branch head already recorded on the task means a previous run handled it (idempotent re-run).
      if (landing !== undefined && landing.branch === branch && landing.branch_head === tip) continue;
      selected.push({ slug: task.slug, doc: task, contract: contract.data, via: "claimed" });
      continue;
    }
    if (!isTaskOfIntegrationBranch(task, integrationBranches, branch) || landing !== undefined) continue;
    const claimTip = recordedClaimTip(deps, task, newestFirst(releases.value.filter((row) => row.doc_id === task.id)));
    if (claimTip === undefined) continue;
    const contained = deps.git(deps.projectRoot, ["merge-base", "--is-ancestor", claimTip, tip]);
    if (contained.status === 0) selected.push({ slug: task.slug, doc: task, contract: contract.data, via: "integration-branch" });
  }
  return ok(selected);
}

/** The commit a task's claim ended on: the live claim's branch tip, else the `end_tip` of the newest release row; `undefined` when neither exists. */
function recordedClaimTip(deps: Pick<IntegrateOracleDeps, "git" | "projectRoot">, task: DocRecord, releasesNewestFirst: readonly AuditEntry[]): string | undefined {
  const held = extractHeldClaim(task);
  if (held !== undefined) {
    const names = [held.branch, held.worktree].filter((name): name is string => name !== undefined && !name.startsWith("/"));
    for (const name of names) {
      const tip = deps.git(deps.projectRoot, ["rev-parse", "--verify", "-q", `refs/heads/${name}^{commit}`]);
      if (tip.status === 0 && tip.stdout.trim() !== "") return tip.stdout.trim();
    }
    if (held.end_tip !== undefined) return held.end_tip;
    return undefined;
  }
  for (const row of releasesNewestFirst) {
    const endTip = auditDetail(row, "end_tip");
    if (endTip !== undefined) return endTip;
  }
  return undefined;
}

/**
 * The union of the oracles of `tasks`, de-duplicated by command and keeping the tasks that hold each (AC-DCS2-1: two tasks sharing an
 * oracle cause one run and two rows).
 *
 * @param perTask - for each task slug, its resolved oracles (id, command, kind)
 * @returns the distinct oracles in first-seen order
 */
export function unionOracles(perTask: ReadonlyMap<string, readonly { readonly id: string; readonly command: string; readonly oracle: ContractOracleToRun["oracle"] }[]>): UnionOracle[] {
  const byCommand = new Map<string, { id: string; command: string; oracle: ContractOracleToRun["oracle"]; tasks: string[] }>();
  for (const [slug, oracles] of perTask) {
    for (const oracle of oracles) {
      const known = byCommand.get(oracle.command);
      if (known === undefined) byCommand.set(oracle.command, { id: oracle.id, command: oracle.command, oracle: oracle.oracle, tasks: [slug] });
      else if (!known.tasks.includes(slug)) known.tasks.push(slug);
    }
  }
  return [...byCommand.values()];
}

/** The oracle kind a contract oracle id is run and recorded under. */
function kindOfOracle(evaluated: EvaluatedOracle): ContractOracleToRun["oracle"] {
  if (evaluated.id.startsWith("ac:")) {
    const kind = evaluated.oracleKind;
    return kind === undefined || kind === "manual" ? "other" : kind;
  }
  return evaluated.id === "typecheck" ? "tsc" : evaluated.id.startsWith("test:") ? "test" : "other";
}

/** The test files a command names (a path ending in `.test.<ext>` / `.spec.<ext>`), for the refusal's file list. */
function testFilesNamedBy(command: string): string[] {
  return [...command.matchAll(/[\w./@-]+\.(?:test|spec)\.[cm]?[jt]sx?/g)].map((match) => match[0]);
}

/** Whether `path` lies under the approved anchor `anchor` (a file, or a `dir/`). */
function anchorCovers(anchor: string, path: string): boolean {
  const file = anchor.split("#")[0] ?? anchor;
  return file.endsWith("/") ? path.startsWith(file) : path === file;
}

function seconds(ms: number): string {
  return (ms / 1000).toFixed(3);
}

/** See the module header. */
export class IntegrateOracleService implements LandingOracles {
  constructor(private readonly deps: IntegrateOracleDeps) {}

  /** {@link collectLandingTasks} over this service's reads. */
  select(branch: string, tip: string): Promise<Result<readonly LandingTask[], LoreError>> {
    return collectLandingTasks(this.deps, branch, tip);
  }

  /**
   * Evaluates each task's contract against the merged tree, runs the install command of the current config once and then every distinct
   * oracle of the union once and in order, and returns the outcomes.
   *
   * @returns the proof, or `err` naming every failed oracle (`integrate-oracle-failed`) when any oracle still fails after its re-run
   */
  async prove(input: OracleRunInput): Promise<Result<OracleProof, LoreError>> {
    const prepared = await this.prepare(input);
    if (!prepared.ok) return prepared;
    const { runnable, excluded, perTask: tasks } = prepared.value;
    const floorCovers = input.settings.floorCovers;
    const union = unionOracles(tasks).filter((o) => !floorCovers.has(o.id));
    const covered = unionOracles(tasks).filter((o) => floorCovers.has(o.id));
    const outcomes: OracleOutcome[] = [];

    if (union.length > 0) {
      const install = input.settings.installCommand;
      if (install === undefined) {
        input.log("integrate: install skipped (workflow.done_contract.install is not set)");
      } else {
        const started = input.clock();
        const installed = input.runCommand(install, input.worktree);
        input.log(`phase install ${seconds(input.clock() - started)}s`);
        if (installed.status !== 0) {
          return err({ code: "STORE_ERROR", message: `${INTEGRATE_ORACLE_FAILED}: the install command \`${install}\` failed (exit ${installed.status}); no oracle ran and main is unchanged\n${installed.output.slice(-2000).trimEnd()}` });
        }
      }
    }

    for (const oracle of covered) outcomes.push(this.floorCoveredOutcome(oracle, input));
    const owner = runnable[0];
    for (const oracle of union) {
      if (owner === undefined) break;
      const started = input.clock();
      const outcome = await this.proveOracle(oracle, owner.doc, input);
      input.log(`phase ${oracle.id} ${seconds(input.clock() - started)}s`);
      outcomes.push(outcome);
    }

    const failed = outcomes.filter((outcome) => !outcome.passed);
    const oracleFailure = (list: readonly OracleOutcome[]): LoreError => this.describeFailure(list, runnable, input);
    if (failed.length > 0) return err(oracleFailure(failed));
    return ok({ tasks: runnable, excluded, outcomes });
  }

  /**
   * Records the rows of a proven landing: attaches each flaky oracle to the ledger issue, then writes, per task, one runner-attested row
   * per oracle that task holds (bound to `commit`, marked recorded by integrate, `flaky` and `ledger_error` where they apply) in ONE
   * corpus write, re-reading and retrying a stale write up to 3 times.
   */
  async record(input: OracleRecordInput): Promise<OracleRecordSummary> {
    const flakyExtras = new Map<string, { readonly ledgerError?: string }>();
    for (const outcome of input.outcomes) {
      if (outcome.flaky === undefined) continue;
      const attached = await this.deps.ledger.attach({
        oracle: outcome.oracle.id,
        command: outcome.oracle.command,
        tasks: outcome.oracle.tasks,
        landingCommit: input.commit,
        firstOutcome: outcome.flaky.firstOutcome,
        secondOutcome: "passed",
      });
      if (attached.ok) {
        input.log(`integrate: flaky ${outcome.oracle.id} (tasks ${outcome.oracle.tasks.join(", ")}): failed once, passed on its re-run; ledger issue #${String(attached.value.issue.number)} ${attached.value.created ? "filed" : "commented"}`);
        flakyExtras.set(outcome.oracle.command, {});
      } else {
        const cause = "message" in attached.error ? attached.error.message : attached.error.code;
        input.log(`integrate: flaky ${outcome.oracle.id} (tasks ${outcome.oracle.tasks.join(", ")}): failed once, passed on its re-run; the ledger issue was NOT updated: ${cause}`);
        flakyExtras.set(outcome.oracle.command, { ledgerError: cause });
      }
    }

    const recorded: string[] = [];
    const failed: string[] = [];
    for (const task of input.tasks) {
      const rows: VerifiedEvidenceInput[] = [];
      const oracleIds: string[] = [];
      for (const outcome of input.outcomes) {
        if (!outcome.passed || outcome.row === undefined || !outcome.oracle.tasks.includes(task.slug)) continue;
        oracleIds.push(outcome.oracle.id);
        const extra = flakyExtras.get(outcome.oracle.command);
        rows.push({
          ...outcome.row,
          recorded_by: input.by,
          ...(outcome.flaky !== undefined ? { flaky: true as const } : {}),
          ...(extra?.ledgerError !== undefined ? { ledger_error: extra.ledgerError } : {}),
          attestation: { ...(outcome.row.attestation as NonNullable<VerifiedEvidenceInput["attestation"]>), recorded_at_landing: input.commit },
        });
      }
      if (rows.length === 0) continue;
      let written = await this.deps.workflow.recordIntegrateEvidence(task.slug, rows, input.by, input.nowIso, oracleIds);
      for (let attempt = 1; !written.ok && written.error.code === "STALE_VERSION" && attempt < RECORD_MAX_ATTEMPTS; attempt += 1) {
        written = await this.deps.workflow.recordIntegrateEvidence(task.slug, rows, input.by, input.nowIso, oracleIds);
      }
      if (written.ok) {
        recorded.push(task.slug);
      } else {
        failed.push(task.slug);
        const cause = "message" in written.error ? written.error.message : written.error.code;
        input.log(`integrate: WARNING: the evidence rows of ${task.slug} were not recorded (${written.error.code}): ${cause}; re-run lore integrate on the branch or record them with lore verify`);
      }
    }
    return { recorded, failed };
  }

  /**
   * Evaluates every selected task's contract against the merged tree (AC-DCS1-30): resolves each oracle to the command that proves it,
   * drops the test files the task's own landing deleted, and leaves out a task whose anchored test file is absent from the landed tree
   * without having been deleted (it is not archived: `lore done` refuses it with the floor missing-oracle-file).
   */
  private async prepare(input: OracleRunInput): Promise<
    Result<
      {
        runnable: LandingTask[];
        excluded: OracleProof["excluded"][number][];
        perTask: Map<string, { id: string; command: string; oracle: ContractOracleToRun["oracle"] }[]>;
      },
      LoreError
    >
  > {
    const git = createGitRunner(input.worktree);
    const claims = await this.deps.store.queryAudit({ action: "claim" });
    if (!claims.ok) return claims;
    const runnable: LandingTask[] = [];
    const excluded: OracleProof["excluded"][number][] = [];
    const perTask = new Map<string, { id: string; command: string; oracle: ContractOracleToRun["oracle"] }[]>();
    for (const task of input.tasks) {
      const oracles: DoneContractOracle[] = [];
      const held = extractHeldClaim(task.doc);
      let additions: DoneContractOracle[] = [];
      if (held !== undefined) {
        const derived = this.deps.workflow.deriveFinishAdditions(task.doc, held, task.contract);
        if (!derived.ok) return derived;
        additions = derived.value;
      }
      for (const oracle of [...task.contract.oracles, ...task.contract.added_oracles, ...additions]) {
        if (!oracles.some((known) => known.id === oracle.id)) oracles.push(oracle);
      }
      const evaluated = await this.deps.workflow.liveOracleCommands(task.doc, oracles);
      if (!evaluated.ok) return evaluated;

      const unresolved = evaluated.value.filter((oracle) => oracle.unresolved !== undefined);
      if (unresolved.length > 0) {
        const message = `${task.slug}: ${unresolved.map((oracle) => `${oracle.id} (${oracle.unresolved ?? ""})`).join("; ")}`;
        input.log(`integrate: ${task.slug} leaves the oracle run: ${message}`);
        excluded.push({ task: task.slug, floor: "oracle-unresolved", paths: [], message });
        continue;
      }
      const testOracles: TestFileOracle[] = evaluated.value.filter((oracle) => oracle.id.startsWith("test:")).map((oracle) => ({ id: oracle.id, path: oracle.id.slice("test:".length) }));
      const present = new Map<string, boolean>();
      for (const oracle of testOracles) {
        const exists = pathExistsAt(git, input.commit, oracle.path);
        if (typeof exists !== "boolean") return err({ code: "STORE_ERROR", message: `integrate: ${exists.unmeasurable}` });
        present.set(oracle.path, exists);
      }
      let removed: readonly TestFileOracle[] = [];
      if (testOracles.some((oracle) => present.get(oracle.path) === false)) {
        const from = this.startOf(task, claims.value, input);
        const deleted = deletedByDiff(git, from, input.tip);
        // reason: an unreadable diff deletes nothing, so an absent file refuses its task (fail closed, as `lore done` does).
        const deletedByTask: ReadonlySet<string> = "unmeasurable" in deleted ? new Set<string>() : deleted;
        const verdict = missingOracleFiles(testOracles, { has: (path) => present.get(path) === true }, deletedByTask);
        if (verdict.missing.length > 0) {
          const message = `${task.slug} is not archived [floor: missing-oracle-file]: ${verdict.missing.join(", ")} is absent from the landed tree and the landing did not delete it`;
          input.log(`integrate: ${message}`);
          excluded.push({ task: task.slug, floor: "missing-oracle-file", paths: verdict.missing, message });
          continue;
        }
        removed = verdict.removed;
        for (const gone of removed) input.log(`integrate: ${task.slug}: ${gone.path} was deleted by the landing, so ${gone.id} leaves the oracle set (recorded on the task when it is archived)`);
      }
      const kept = evaluated.value.filter((oracle) => !removed.some((gone) => gone.id === oracle.id));
      runnable.push(task);
      perTask.set(
        task.slug,
        kept.flatMap((oracle) => (oracle.command === undefined ? [] : [{ id: oracle.id, command: oracle.command, oracle: kindOfOracle(oracle) }])),
      );
    }
    return ok({ runnable, excluded, perTask });
  }

  /** The commit a task's own work starts from: its newest claim row's start, else the merge base of the branch with main. */
  private startOf(task: LandingTask, claims: readonly AuditEntry[], input: OracleRunInput): string {
    for (const row of newestFirst(claims.filter((candidate) => candidate.doc_id === task.doc.id))) {
      const start = auditDetail(row, "start_head") ?? auditDetail(row, "base_sha");
      if (start !== undefined) return start;
    }
    const base = this.deps.git(this.deps.projectRoot, ["merge-base", input.base, input.tip]);
    return base.status === 0 && base.stdout.trim() !== "" ? base.stdout.trim() : input.base;
  }

  /** The row of an oracle the floor command already ran: the floor's result, stamped with the state measured around the floor. */
  private floorCoveredOutcome(oracle: UnionOracle, input: OracleRunInput): OracleOutcome {
    const durationMs = input.floor?.durationMs ?? 0;
    const row: VerifiedEvidenceInput = {
      oracle: oracle.oracle,
      command: oracle.command,
      result: "pass",
      recorded_by: input.settings.by,
      capture_source: "runner",
      output_tail: `covered by the floor command of this landing (workflow.integrate.floor_covers names ${oracle.id}); the floor exited 0`,
      attestation: {
        runner: "lore-cli",
        exit_code: 0,
        duration_ms: durationMs,
        timed_out: false,
        execution_root: input.worktree,
        execution_mode: "worktree",
        ...(input.floor?.stamp ?? {}),
      },
    };
    return { oracle, passed: true, cause: "passed (floor)", durationMs, row };
  }

  /** Runs one oracle; a failing one (not `typecheck`) is re-run alone once, and a pass on the re-run is flaky. */
  private async proveOracle(oracle: UnionOracle, owner: DocRecord, input: OracleRunInput): Promise<OracleOutcome> {
    const first = await this.attempt(oracle, owner, input);
    if (first.passed) return { oracle, passed: true, cause: first.cause, durationMs: first.durationMs, row: first.row };
    // reason: typecheck is deterministic, so a failing one is never re-run (AC-DCS2-4).
    if (oracle.oracle === "tsc") return { oracle, passed: false, cause: first.cause, durationMs: first.durationMs, row: first.row };
    const rerun = await this.attempt(oracle, owner, input);
    const markFlaky = (flakyOracle: UnionOracle, second: Attempt): OracleOutcome => ({
      oracle: flakyOracle,
      passed: true,
      cause: second.cause,
      durationMs: first.durationMs + second.durationMs,
      flaky: { firstOutcome: first.cause },
      row: second.row,
    });
    if (rerun.passed) return markFlaky(oracle, rerun);
    return { oracle, passed: false, cause: `${first.cause}; re-run: ${rerun.cause}`, durationMs: first.durationMs + rerun.durationMs, row: rerun.row };
  }

  /** One run of an oracle's command through the same runner path as `lore verify` and `lore finish`, with the per-oracle timeout. */
  private async attempt(oracle: UnionOracle, owner: DocRecord, input: OracleRunInput): Promise<Attempt> {
    const collected: VerifiedEvidenceInput[] = [];
    const started = input.clock();
    const ran = await this.deps.verify.runContractOracles(
      owner,
      [{ id: oracle.id, oracle: oracle.oracle, command: oracle.command, timeoutMs: input.settings.timeoutSeconds * 1000 }],
      {
        by: input.settings.by,
        nowIso: input.nowIso,
        executionRoot: { root: input.worktree, mode: "worktree" },
        commandsApprovedByContract: true,
        collectRows: (row) => collected.push(row),
      },
    );
    const durationMs = input.clock() - started;
    if (!ran.ok) {
      const cause = "message" in ran.error ? ran.error.message : ran.error.code;
      return { passed: false, cause: `could not run: ${cause}`, durationMs, row: undefined };
    }
    const result = ran.value.results[0];
    if (result === undefined) return { passed: false, cause: "the runner reported no result", durationMs, row: undefined };
    const row = collected[0];
    if (result.result === "pass" && row !== undefined) return { passed: true, cause: "passed", durationMs, row };
    if (result.timed_out) return { passed: false, cause: `timeout (${String(input.settings.timeoutSeconds)}s)`, durationMs, row };
    if (result.result === "inconclusive") return { passed: false, cause: `inconclusive (exit ${String(result.exit_code)}: ${result.completeness ?? result.binary_freshness ?? "no test ran"})`, durationMs, row };
    return { passed: false, cause: `failed (exit ${String(result.exit_code)})`, durationMs, row };
  }

  /**
   * The refusal: every failed oracle with the tasks that hold it, its id, command and cause, and the files — the test files its command
   * names plus the approved anchors of those tasks that the landing changed (the tasks' own changed files when no anchor was changed).
   */
  private describeFailure(failed: readonly OracleOutcome[], tasks: readonly LandingTask[], input: OracleRunInput): LoreError {
    const git = createGitRunner(input.worktree);
    const diff = (from: string, to: string): string[] => {
      const out = git(["diff", "--name-only", from, to]);
      return out.ok ? out.stdout.split("\n").filter((line) => line !== "") : [];
    };
    const landingChanged = input.base === input.commit ? [] : diff(input.base, input.commit);
    const lines: string[] = [`${INTEGRATE_ORACLE_FAILED}: ${String(failed.length)} oracle(s) of the landing of ${input.branch} failed; main is unchanged and nothing was recorded`];
    for (const outcome of failed) {
      const holders = tasks.filter((task) => outcome.oracle.tasks.includes(task.slug));
      const anchorsChanged = new Set<string>();
      for (const holder of holders) {
        const anchors = extractFileAnchors(holder.doc);
        for (const path of landingChanged) if (anchors.some((anchor) => anchorCovers(anchor, path))) anchorsChanged.add(path);
      }
      let files = [...new Set([...testFilesNamedBy(outcome.oracle.command), ...anchorsChanged])];
      if (anchorsChanged.size === 0) {
        const own = new Set<string>();
        for (const holder of holders) for (const path of diff(this.startFor(holder, input), input.tip)) own.add(path);
        files = [...new Set([...testFilesNamedBy(outcome.oracle.command), ...own])];
      }
      lines.push(`  - oracle ${outcome.oracle.id}: ${outcome.cause}`);
      lines.push(`    command: ${outcome.oracle.command}`);
      lines.push(`    tasks: ${outcome.oracle.tasks.join(", ")}`);
      lines.push(`    files: ${files.length === 0 ? "(none could be named)" : files.join(", ")}`);
    }
    lines.push("fix the work on its branch and re-run lore integrate");
    return { code: "STORE_ERROR", message: lines.join("\n") };
  }

  /** The start commit of a task for the own-changed-files fallback (its claim base, else the merge base of the branch with main). */
  private startFor(task: LandingTask, input: OracleRunInput): string {
    const claimed = task.doc.extra["claim"] as { start_head?: unknown } | undefined;
    if (typeof claimed?.start_head === "string" && claimed.start_head !== "") return claimed.start_head;
    const base = this.deps.git(this.deps.projectRoot, ["merge-base", input.base, input.tip]);
    return base.status === 0 && base.stdout.trim() !== "" ? base.stdout.trim() : input.base;
  }
}
