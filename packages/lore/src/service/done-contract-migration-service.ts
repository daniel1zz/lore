/**
 * Module: done-contract-migration-service — `lore migrate done-contract [--apply]`: compiles the done contract of every
 *   in-flight task, all or nothing, and converts the claims of the old protocol.
 *
 * Purpose: a corpus written before the done contract holds approved and active tasks with no `extra.done_contract`, no
 *   `extra.kind`, and claims that name no branch. This migration gives every such task its contract through the SAME compile
 *   `lore approve` runs (`DoneContractService.compileForApprove`: no second set of rules) and releases every claim that
 *   names no branch, so no verb ever has to describe a task without a contract or a legacy claim (AC-DCS1-22, AC-DCS1-23).
 * Public surface: {@link DoneContractMigrationService} (`preview`, `apply`, `checkDecisions`), {@link MigrationDecisions},
 *   {@link MigrationGap}, {@link MigrationRow}, {@link MigrationReport}, {@link MigrationGitPort}, {@link MigrationContractPort},
 *   {@link migrationGaps}, {@link DONE_CONTRACT_MIGRATION_GAPS}, {@link DECISION_NOT_NEEDED}, {@link DONE_CONTRACT_MIGRATE_OPERATION}.
 * Invariants:
 *   - ALL OR NOTHING (ledger D43): with any gap `apply` writes nothing and returns the refusal listing every gap, per task,
 *     with the command that fills it; the user's decisions arrive in the same call ({@link MigrationDecisions}).
 *   - with no gap every task is written in ONE store transaction (the first task is the primary write, the rest are its
 *     companion writes; a failure rolls all of them back). One version per task, through the one write route.
 *   - the contract is compiled by `compileForApprove` with the task's kind set; the migration never moves a task's status.
 *   - idempotent: a task holding a contract and no no-branch claim is never written, so a second `apply` writes nothing.
 *   - a failing read is RETURNED, never reported as an empty migration.
 * Side-effect class: IO (store reads and git reads; writes only through the injected write route).
 *
 * Source: spec-done-contract-compiled-at-approve-task-kinds-write-sets (AC-DCS1-22, AC-DCS1-23), ledger D39, D43.
 */

import {
  doneContractSchema,
  err,
  extractEvidence,
  extractFileAnchors,
  extractHeldClaim,
  isTaskKind,
  ok,
  type AuditEntry,
  type DocRecord,
  type DoneContract,
  type LoreError,
  type Result,
  type TaskClaim,
  type TaskKind,
} from "@lore/core";
import type { CompanionDocWrite, StoreInterface } from "../store/store-interface.js";
import { resolveWriteActorFor } from "../store/write-context-store.js";
import { claimedNamesOf } from "./branch-membership.js";
import type { DocWritePort } from "./corpus-service.js";
import { DONE_CONTRACT_UNCOMPILABLE } from "./done-contract-compile.js";
import type { ApproveContractOpts } from "./done-contract-service.js";
import type { FloorRunner } from "./integrate-service.js";
import type { LandingTask, OracleOutcome, OracleProof, OracleRecordInput, OracleRecordSummary, OracleRunInput, OracleSettings } from "./integrate-oracle-service.js";
import { readTaskLanding, type TaskLanding } from "./task-commit-range.js";
import { isRunnerProducedRedRun } from "./task-workflow-service.js";

/** `details.operation` of every audit row this migration writes (grep-friendly, stable). */
export const DONE_CONTRACT_MIGRATE_OPERATION = "done-contract-migrate";

/** Stable refusal name of an `--apply` (or preview decision check) that found gaps. */
export const DONE_CONTRACT_MIGRATION_GAPS = "done-contract-migration-gaps";

/** Stable refusal name of a decision given for a task that does not list that gap. */
export const DECISION_NOT_NEEDED = "decision-not-needed";

/** The git reads the migration needs beyond the compile's own. */
export interface MigrationGitPort {
  /** The full commit id `ref` names, or `undefined` when git cannot resolve it to a commit. */
  resolveCommit(ref: string): string | undefined;
  /** Tip commit of the local branch `name`, or `undefined` when no such branch exists. */
  branchTip(name: string): string | undefined;
  /** Whether `ancestor` is an ancestor of (or equal to) `descendant`; throws when git cannot tell. */
  isAncestor(ancestor: string, descendant: string): boolean;
}

/** The ref the landed tasks are attested on. */
const MAIN_REF = "refs/heads/main";

/** The main tree a union run executes in, held for the duration of one callback. */
export interface MainTree {
  readonly worktree: string;
  /** Main's newest commit: the commit the tree is. It contains every landing commit that is on main. */
  readonly commit: string;
}

/**
 * What the attestation of landed tasks needs (BR-1549), all of it the integrate machinery: the merge queue turn, a worktree of main's
 * tree, the oracle runner and the integrate row writer. Wired by the command; absent in a bare construction (then a pending landed task
 * is refused loudly, never stored without an attestation).
 */
export interface LandedAttestPort {
  /** Holds one turn of the repository's merge queue around `fn` (the turn a landing takes). */
  inTurn<T>(fn: () => Promise<T>): Promise<T>;
  /** Checks main's newest commit out in a detached worktree for the duration of `fn`, and removes it afterwards. */
  withMainTree<T>(fn: (tree: MainTree) => Promise<T>): Promise<T>;
  readonly prove: (input: OracleRunInput) => Promise<Result<OracleProof, LoreError>>;
  readonly record: (input: OracleRecordInput) => Promise<OracleRecordSummary>;
  readonly settings: OracleSettings;
  readonly runCommand: FloorRunner;
  readonly log: (line: string) => void;
  readonly clock: () => number;
}

/** What the migration needs of `DoneContractService`: the approve compile itself, plus the kind inference input. */
export interface MigrationContractPort {
  compileForApprove(task: DocRecord, opts: ApproveContractOpts): Promise<Result<DoneContract, LoreError>>;
  hasLiveScriptAc(task: DocRecord): Promise<Result<boolean, LoreError>>;
}

/** The user's decisions, keyed by task slug; all given in the same invocation as the migration. */
export interface MigrationDecisions {
  readonly kinds: ReadonlyMap<string, TaskKind>;
  readonly redWaivers: ReadonlyMap<string, string>;
  readonly tips: ReadonlyMap<string, string>;
}

/** No decisions at all. */
export const NO_DECISIONS: MigrationDecisions = { kinds: new Map(), redWaivers: new Map(), tips: new Map() };

/** What is missing for one task: its stable name, the words, and the command that fills it. */
export interface MigrationGap {
  readonly slug: string;
  readonly code:
    | "kind-invalid"
    | "needs-red-waiver"
    | "unknown-tip"
    | "config-key"
    | "falsifier-correction"
    | "uncompilable"
    | "live-branch-claim"
    | "anchor-absent"
    | "landing-not-on-main"
    | "landed-oracle-failed"
    | "landed-oracle-excluded"
    | "landed-evidence-not-recorded";
  readonly message: string;
  readonly fill: string;
}

/** One task as the migration lists it. */
export interface MigrationRow {
  readonly slug: string;
  readonly status: string;
  readonly kind: TaskKind | undefined;
  readonly kindSource: "stored" | "inferred" | "decided" | "invalid";
  /** The contract that would be (or was) stored; `undefined` when the task has a gap or already holds one. */
  readonly contract: DoneContract | undefined;
  readonly alreadyCompiled: boolean;
  /** The claim that names no branch is released by `--apply`. */
  readonly releasesClaim: boolean;
  /** The landing commit of a task that already landed: its contract is compiled there and attested by the union run; `undefined` otherwise. */
  readonly landedAt: string | undefined;
  readonly gaps: readonly MigrationGap[];
}

/** What `preview` and `apply` report. */
export interface MigrationReport {
  readonly applied: boolean;
  readonly rows: readonly MigrationRow[];
  /** Every gap: a task's own (also on its row) and the failures of the union run (not on a row). */
  readonly gaps: readonly MigrationGap[];
  /** Tasks actually written (`apply`); empty for a preview. */
  readonly written: readonly string[];
  /** Landed tasks whose integrate rows the union run recorded (`apply`). */
  readonly attested: readonly string[];
}

/** The text an `--apply` with gaps prints: every gapped task with the command that fills it; the other tasks were stored. */
export function migrationGaps(gaps: readonly MigrationGap[]): LoreError {
  const lines = gaps.map((gap) => `  - ${gap.slug}: ${gap.code}: ${gap.message}\n      fill it: ${gap.fill}`);
  return {
    code: "VALIDATION_ERROR",
    field: "done_contract_migration",
    message:
      `${DONE_CONTRACT_MIGRATION_GAPS}: ${gaps.length} task gap${gaps.length === 1 ? "" : "s"} remain; every task without one was stored. ` +
      `Fill each gap and run the migration again (it only touches what is still open):\n${lines.join("\n")}`,
    value: { refusal: DONE_CONTRACT_MIGRATION_GAPS, gaps },
  };
}

function decisionNotNeeded(problems: readonly string[]): LoreError {
  return {
    code: "VALIDATION_ERROR",
    field: "decision",
    message: `${DECISION_NOT_NEEDED}: nothing was written.\n${problems.map((problem) => `  - ${problem}`).join("\n")}`,
    value: { refusal: DECISION_NOT_NEEDED },
  };
}

/** The per-cause lines of an uncompilable refusal: `  - <code>: <message>`. */
function causesOf(error: LoreError): { code: string; message: string }[] {
  const causes: { code: string; message: string }[] = [];
  if (error.code !== "VALIDATION_ERROR") return causes;
  for (const line of error.message.split("\n")) {
    const match = /^ {2}- ([a-z-]+): (.*)$/.exec(line);
    if (match !== null) causes.push({ code: match[1] ?? "", message: match[2] ?? "" });
  }
  return causes;
}

const CONFIG_KEY_OF_CAUSE: Readonly<Record<string, string>> = {
  "no-typecheck": "typecheck",
  "no-install": "install",
  "no-test-command": "test_file",
};

/** What one task needs, worked out before anything is written. */
interface Plan {
  readonly row: MigrationRow;
  readonly task: DocRecord;
  /** The `extra` the task is written with; `undefined` when nothing changes. */
  readonly nextExtra: Record<string, unknown> | undefined;
  readonly auditRows: readonly Omit<AuditEntry, "timestamp" | "actor">[];
  readonly summary: string;
  /** The red waiver was needed (so a `--red-waiver` for this task is listed). */
  readonly waiverListed: boolean;
  /** An unknown tip was found (so a `--tip` for this task is listed). */
  readonly tipListed: boolean;
  /** The task's newest landing when it is code that already landed on main and no integrate row of that landing exists yet: the union run attests it. */
  readonly pendingAttest: TaskLanding | undefined;
}

export class DoneContractMigrationService {
  /**
   * @param store - read access to tasks and their claim and release audit rows
   * @param writer - the one write route (`CorpusService`)
   * @param contracts - the approve-time compile, reused exactly
   * @param git - the git reads for tips and commits
   */
  constructor(
    private readonly store: StoreInterface,
    private readonly writer: DocWritePort,
    private readonly contracts: MigrationContractPort,
    private readonly git: MigrationGitPort,
  ) {}

  /**
   * Problems with the decisions that are the caller's usage errors (exit 2): a blank red-waiver reason, a commit git cannot resolve.
   * (A kind outside the three is refused when the flag is parsed.)
   *
   * @param decisions - the parsed decisions
   * @returns the messages, empty when every decision is well formed
   */
  checkDecisions(decisions: MigrationDecisions): string[] {
    const problems: string[] = [];
    for (const [slug, reason] of decisions.redWaivers) if (reason.trim() === "") problems.push(`--red-waiver ${slug}= needs a non-blank reason`);
    for (const [slug, commit] of decisions.tips) if (this.git.resolveCommit(commit) === undefined) problems.push(`--tip ${slug}=${commit}: git cannot resolve ${commit} to a commit`);
    return problems;
  }

  /**
   * Lists every approved or active task with its inferred kind and either its contract or its gaps. Writes nothing.
   *
   * @param decisions - the decisions given with the call (a preview applies them, so the user sees the gaps that remain)
   * @returns the report; `err` when a read fails or a decision names a task that does not list that gap
   */
  async preview(decisions: MigrationDecisions = NO_DECISIONS): Promise<Result<MigrationReport, LoreError>> {
    const planned = await this.planAll(decisions);
    if (!planned.ok) return planned;
    return ok({ applied: false, rows: planned.value.map((plan) => plan.row), gaps: planned.value.flatMap((plan) => plan.row.gaps), written: [], attested: [] });
  }

  /**
   * Stores the contract of every task that compiles, in one transaction, and leaves each gapped task as it is (BR-1490 as amended): a
   * gap never blocks another task, and the migration can be run again until nothing is left open. The tasks that already landed on
   * main are compiled at their landing commit and then attested by ONE union run of their oracles on main's tree, inside one turn of
   * the merge queue and through integrate's runner, recorded as integrate rows of their landing (BR-1549, AC-DCF-3).
   *
   * @param decisions - the decisions given with the call
   * @param attest - the integrate machinery that attests the landed tasks; a landed task needing it with none given is refused (nothing written)
   * @returns the report, whose `gaps` hold every task still open; `err` on a failed read or write, or an unusable decision
   */
  async apply(decisions: MigrationDecisions = NO_DECISIONS, attest?: LandedAttestPort): Promise<Result<MigrationReport, LoreError>> {
    const first = await this.planAll(decisions);
    if (!first.ok) return first;
    const wantsAttest = first.value.some((plan) => plan.pendingAttest !== undefined && plan.row.gaps.length === 0);
    if (!wantsAttest) return this.applyPlans(first.value, undefined);
    if (attest === undefined) {
      return err({
        code: "VALIDATION_ERROR",
        field: "done_contract_migration",
        message: "tasks that already landed on main need the union run of their oracles (BR-1549), and this call has no integrate runner or merge queue; nothing was written",
      });
    }
    // reason: the turn is taken BEFORE the plan that is acted on, so a migration that waited behind another sees the rows the first one
    // recorded and finds nothing left to run (a concurrent migration re-runs no oracle).
    return await attest.inTurn(async () => {
      const planned = await this.planAll(decisions);
      if (!planned.ok) return planned;
      return this.applyPlans(planned.value, attest);
    });
  }

  private async applyPlans(plans: readonly Plan[], attest: LandedAttestPort | undefined): Promise<Result<MigrationReport, LoreError>> {
    const rows = plans.map((plan) => plan.row);
    const taskGaps = rows.flatMap((row) => row.gaps);

    const stored = await this.storeContracts(plans);
    if (!stored.ok) return stored;
    const pending = plans.filter((plan) => plan.pendingAttest !== undefined && plan.row.gaps.length === 0);
    if (attest === undefined || pending.length === 0) {
      return ok({ applied: true, rows, gaps: taskGaps, written: stored.value, attested: [] });
    }
    const union = await this.runLandedUnion(attest, pending);
    if (!union.ok) return union;
    return ok({ applied: true, rows, gaps: [...taskGaps, ...union.value.gaps], written: stored.value, attested: union.value.attested });
  }

  /**
   * One run of the union of the landed tasks' oracles on main's newest commit, then the integrate rows of each task whose oracles all
   * passed, bound to that commit and to the task's own landing (BR-1549). A failed oracle, a task left out of the run and a write that
   * failed each become a gap naming the task, so the migration exits 4 and the other tasks stay attested.
   */
  private async runLandedUnion(attest: LandedAttestPort, pending: readonly Plan[]): Promise<Result<{ gaps: MigrationGap[]; attested: string[] }, LoreError>> {
    const found = await this.store.findMany({ type: "task" });
    if (!found.ok) return found;
    const bySlug = new Map(found.value.map((doc) => [doc.slug, doc]));
    const tasks: LandingTask[] = [];
    const landingOf = new Map<string, string>();
    for (const plan of pending) {
      const doc = bySlug.get(plan.row.slug);
      const contract = doneContractSchema.safeParse(doc?.extra["done_contract"]);
      if (doc === undefined || !contract.success || plan.pendingAttest === undefined) {
        return err({ code: "VALIDATION_ERROR", field: "done_contract", message: `${plan.row.slug}: its stored contract cannot be read back, so it cannot be attested`, value: plan.row.slug });
      }
      tasks.push({ slug: doc.slug, doc, contract: contract.data, via: "claimed" });
      landingOf.set(doc.slug, plan.pendingAttest.landing_commit);
    }
    const main = this.git.resolveCommit(MAIN_REF);
    if (main === undefined) return err({ code: "VALIDATION_ERROR", field: "main", message: `git cannot resolve ${MAIN_REF}, so the landed tasks cannot be attested` });
    return await attest.withMainTree(async (tree) => {
      const nowIso = new Date(attest.clock()).toISOString();
      attest.log(`migrate: running the union of the oracles of ${tasks.map((task) => task.slug).join(", ")} on ${tree.commit.slice(0, 12)} (one run per distinct oracle)`);
      const proof = await attest.prove({
        branch: "landed tasks",
        // reason: the tasks landed through different branches; the deleted-file check reads the claim start of each task to main's tip.
        tip: tree.commit,
        tasks,
        worktree: tree.worktree,
        commit: tree.commit,
        base: tree.commit,
        floor: undefined,
        settings: attest.settings,
        runCommand: attest.runCommand,
        log: attest.log,
        clock: attest.clock,
        nowIso,
        keepFailures: true,
      });
      if (!proof.ok) return proof;
      const gaps: MigrationGap[] = [];
      const failedBy = new Map<string, OracleOutcome[]>();
      for (const outcome of proof.value.outcomes) {
        if (outcome.passed) continue;
        for (const slug of outcome.oracle.tasks) failedBy.set(slug, [...(failedBy.get(slug) ?? []), outcome]);
      }
      for (const [slug, outcomes] of failedBy) {
        for (const outcome of outcomes) {
          gaps.push({ slug, code: "landed-oracle-failed", message: `oracle ${outcome.oracle.id} failed on main ${tree.commit.slice(0, 12)}: ${outcome.cause}`, fill: `fix it on main, then run lore migrate done-contract --apply again (the task keeps its contract and is attested by the next run)` });
        }
      }
      for (const left of proof.value.excluded) {
        gaps.push({ slug: left.task, code: "landed-oracle-excluded", message: left.message, fill: `lore done ${left.task} names the floor; fix it, then run lore migrate done-contract --apply again` });
      }
      const ready = proof.value.tasks.filter((task) => !failedBy.has(task.slug));
      const attested: string[] = [];
      // reason: one record call per landing commit, because an integrate row names the landing it belongs to (recorded_at_landing).
      for (const landing of new Set(ready.map((task) => landingOf.get(task.slug) as string))) {
        const recorded = await attest.record({
          tasks: ready.filter((task) => landingOf.get(task.slug) === landing),
          commit: tree.commit,
          landingCommit: landing,
          outcomes: proof.value.outcomes,
          by: attest.settings.by,
          nowIso,
          log: attest.log,
        });
        attested.push(...recorded.recorded);
        for (const slug of recorded.failed) {
          gaps.push({ slug, code: "landed-evidence-not-recorded", message: "the rows of the union run could not be written to the task", fill: "run lore migrate done-contract --apply again" });
        }
      }
      return ok({ gaps, attested });
    });
  }

  /** Writes every compilable plan in ONE store transaction; returns the slugs written. */
  private async storeContracts(planned: readonly Plan[]): Promise<Result<string[], LoreError>> {
    const writes = planned.filter((plan) => plan.nextExtra !== undefined);
    if (writes.length === 0) return ok([]);

    const now = new Date().toISOString();
    const actor = resolveWriteActorFor(this.store);
    const audits = writes.flatMap((plan) =>
      plan.auditRows.map((row): AuditEntry => ({ ...row, timestamp: now, actor, details: { ...row.details, version: plan.task.version + 1 } })),
    );
    const companions = writes.slice(1).map((plan) => companionWrite(plan, actor, now));
    const [primary] = writes;
    if (primary === undefined || primary.nextExtra === undefined) return ok([]);
    const written = await this.writer.writeDoc({
      doc: primary.task,
      patch: { extra: primary.nextExtra },
      action: "update",
      changeSummary: primary.summary,
      auditAction: "update",
      auditDetails: { operation: DONE_CONTRACT_MIGRATE_OPERATION },
      auditSessionId: `${DONE_CONTRACT_MIGRATE_OPERATION}-${primary.task.id}`,
      lock: "none",
      now,
      extras: { ...(companions.length > 0 ? { also_update: companions } : {}), ...(audits.length > 0 ? { also_audit: audits } : {}) },
    });
    if (!written.ok) return written;
    return ok(writes.map((plan) => plan.task.slug));
  }

  private async planAll(decisions: MigrationDecisions): Promise<Result<Plan[], LoreError>> {
    const tasks = await this.store.findMany({ type: "task" });
    if (!tasks.ok) return tasks;
    const inFlight = tasks.value
      .filter((task) => task.deleted_at === null && (task.status === "approved" || task.status === "active"))
      .sort((a, b) => a.slug.localeCompare(b.slug));
    const plans: Plan[] = [];
    for (const task of inFlight) {
      const plan = await this.planTask(task, decisions);
      if (!plan.ok) return plan;
      plans.push(plan.value);
    }
    const unused = unusedDecisions(plans, decisions);
    if (unused.length > 0) return err(decisionNotNeeded(unused));
    return ok(plans);
  }

  private async planTask(task: DocRecord, decisions: MigrationDecisions): Promise<Result<Plan, LoreError>> {
    const claimRows = await this.store.queryAudit({ doc_id: task.id, action: "claim" });
    if (!claimRows.ok) return claimRows;
    const releaseRows = await this.store.queryAudit({ doc_id: task.id, action: "release" });
    if (!releaseRows.ok) return releaseRows;
    const held = extractHeldClaim(task);
    const namesBranch = claimedNamesOf(claimRows.value, task).length > 0;
    const holdsNoBranchClaim = held !== undefined && held.branch === undefined && held.worktree === undefined;
    // reason: BR-1549 — a task whose work already landed on main is judged at its landing, never at the migration commit.
    const landing = readTaskLanding(task.extra);
    const gaps: MigrationGap[] = [];
    const gap = (code: MigrationGap["code"], message: string, fill: string): void => {
      gaps.push({ slug: task.slug, code, message, fill });
    };

    // kind: a stored one, else the user's decision, else inferred.
    const stored = task.extra["kind"];
    const decidedKind = decisions.kinds.get(task.slug);
    let kind: TaskKind | undefined;
    let kindSource: MigrationRow["kindSource"];
    const hasContract = task.extra["done_contract"] !== undefined;
    if (isTaskKind(stored)) {
      kind = stored;
      kindSource = "stored";
    } else if (decidedKind !== undefined) {
      kind = decidedKind;
      kindSource = "decided";
    } else if (stored !== undefined && stored !== null) {
      kindSource = "invalid";
      gap("kind-invalid", `extra.kind holds ${JSON.stringify(stored)}, which is none of code, check, corpus`, `lore migrate done-contract --apply --kind ${task.slug}=<code|check|corpus>`);
    } else {
      const scripted = await this.contracts.hasLiveScriptAc(task);
      if (!scripted.ok) return scripted;
      kind = inferKind(extractFileAnchors(task).length > 0 || namesBranch || landing !== undefined, scripted.value);
      kindSource = "inferred";
    }

    const evidence = extractEvidence(task);
    const started = namesBranch || held !== undefined || claimRows.value.length > 0 || evidence.length > 0;
    const waiver = decisions.redWaivers.get(task.slug);
    const needsWaiver = kind === "code" && started && !evidence.some(isRunnerProducedRedRun);
    if (!hasContract && needsWaiver && waiver === undefined) {
      gap(
        "needs-red-waiver",
        "a code task with a claim or evidence and no runner-produced red run: say why it has none",
        `lore migrate done-contract --apply --red-waiver ${task.slug}="<reason>"`,
      );
    }

    // tip: a branch claim whose end is unknown cannot be judged for landing.
    let nextClaim: TaskClaim | undefined = held;
    const extraAudits: Omit<AuditEntry, "timestamp" | "actor">[] = [];
    const tipDecision = decisions.tips.get(task.slug);
    const tipResolved = tipDecision === undefined ? undefined : this.git.resolveCommit(tipDecision);
    let tipListed = false;
    // reason: a task approved with a contract already had its tips recorded by the verbs; only an older one can be missing one.
    if (!hasContract && namesBranch && !holdsNoBranchClaim) {
      const latestRelease = [...releaseRows.value]
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
        .reverse()
        .find((row) => typeof row.details?.["end_tip"] === "string" && row.details["end_tip"] !== "");
      const releasedTip = latestRelease?.details?.["end_tip"] as string | undefined;
      const names = claimedNamesOf(claimRows.value, task).filter((name) => !name.startsWith("/"));
      const refTip = names.map((name) => this.git.branchTip(name)).find((tip) => tip !== undefined);
      const landedTip = (task.extra["landing"] as { tip?: unknown } | undefined)?.tip;
      const knownTip = refTip ?? held?.end_tip ?? releasedTip ?? (typeof landedTip === "string" ? landedTip : undefined);
      if (held !== undefined && held.end_tip === undefined && refTip === undefined && releasedTip !== undefined) {
        nextClaim = { ...held, end_tip: releasedTip };
      } else if (knownTip === undefined) {
        tipListed = true;
        if (tipResolved !== undefined) {
          if (held !== undefined) nextClaim = { ...held, end_tip: tipResolved };
          else extraAudits.push({ action: "release", session_id: task.id, doc_id: task.id, details: { operation: DONE_CONTRACT_MIGRATE_OPERATION, end_tip: tipResolved, reason: "tip given with --tip" } });
        } else {
          gap(
            "unknown-tip",
            "its claim named a branch that no longer exists and no tip was recorded, so where the work ended is unknown",
            `lore migrate done-contract --apply --tip ${task.slug}=<commit>`,
          );
        }
      }
    }

    // contract: the same compile approve runs.
    let contract: DoneContract | undefined;
    let nextExtra: Record<string, unknown> | undefined;
    const landedOnMain = landing !== undefined && this.git.isAncestor(landing.landing_commit, MAIN_REF);
    if (!hasContract && landing !== undefined && !landedOnMain) {
      gap(
        "landing-not-on-main",
        `its landing record names ${landing.landing_commit.slice(0, 12)}, which main does not contain, so the task cannot be compiled at its landing`,
        `lore integrate ${landing.branch} (lands it again), or correct the landing record`,
      );
    } else if (!hasContract && kind !== undefined) {
      const compiled = await this.contracts.compileForApprove(
        { ...task, extra: { ...task.extra, kind } },
        { ...(needsWaiver && waiver !== undefined ? { redWaiverReason: waiver.trim() } : {}), ...(landing !== undefined ? { compileAt: landing.landing_commit } : {}) },
      );
      if (compiled.ok) {
        contract = compiled.value;
      } else if (compiled.error.code === "VALIDATION_ERROR" && compiled.error.message.startsWith(`${DONE_CONTRACT_UNCOMPILABLE}:`)) {
        for (const cause of causesOf(compiled.error)) addCauseGap(gap, task.slug, cause);
        if (held !== undefined && !holdsNoBranchClaim) {
          gap("live-branch-claim", "it cannot be compiled and holds a live claim on a branch; its holder must finish or release the claim first", `lore release ${task.slug}`);
        }
      } else {
        return compiled;
      }
    }

    const releases = holdsNoBranchClaim;
    if (contract !== undefined || releases || nextClaim !== held) {
      const next: Record<string, unknown> = { ...task.extra };
      if (contract !== undefined) {
        next["kind"] = kind;
        next["done_contract"] = contract;
      }
      if (releases) {
        delete next["claim"];
        extraAudits.push({
          action: "release",
          session_id: task.id,
          doc_id: task.id,
          details: { operation: DONE_CONTRACT_MIGRATE_OPERATION, previous_holder: held?.by, reason: "a claim that names no branch is released by the done-contract migration" },
        });
      } else if (nextClaim !== held && nextClaim !== undefined) {
        next["claim"] = nextClaim;
      }
      nextExtra = next;
    }
    const parts: string[] = [];
    if (contract !== undefined) parts.push(`done contract stored (kind ${kind})`);
    if (releases) parts.push("no-branch claim released");
    const row: MigrationRow = { slug: task.slug, status: task.status, kind, kindSource, contract, alreadyCompiled: hasContract, releasesClaim: releases, landedAt: landing?.landing_commit, gaps };
    // reason: BR-1549 — the union run attests a code task that landed on main and holds no integrate row of that landing yet; a task
    // already attested (by integrate or by an earlier migration) is not run again.
    const storedContract = hasContract ? doneContractSchema.safeParse(task.extra["done_contract"]) : undefined;
    const contractKind = storedContract?.success === true ? storedContract.data.kind : contract?.kind;
    const attested = landing !== undefined && evidence.some((entry) => entry.attestation?.recorded_at_landing === landing.landing_commit && entry.result === "pass");
    const pendingAttest = landing !== undefined && landedOnMain && contractKind === "code" && gaps.length === 0 && !attested ? landing : undefined;
    return ok({
      row,
      task,
      nextExtra: gaps.length > 0 ? undefined : nextExtra,
      auditRows: extraAudits,
      summary: `done-contract migration: ${parts.join("; ") || "tip recorded"}`,
      waiverListed: !hasContract && needsWaiver,
      tipListed,
      pendingAttest,
    });
  }
}

/** The kind a task without one is given: file anchors or a claim that named a branch give code, else its script AC decides. */
function inferKind(changesFiles: boolean, hasScriptAc: boolean): TaskKind {
  if (changesFiles) return "code";
  return hasScriptAc ? "check" : "corpus";
}

function addCauseGap(gap: (code: MigrationGap["code"], message: string, fill: string) => void, slug: string, cause: { code: string; message: string }): void {
  const key = CONFIG_KEY_OF_CAUSE[cause.code];
  if (key !== undefined) {
    gap("config-key", cause.message, `set workflow.done_contract.${key} in .lore/config.yaml`);
    return;
  }
  if (cause.code === "falsifier-literal-absent") {
    const ac = /^(\S+) declares/.exec(cause.message)?.[1] ?? "<AC-id>";
    gap("falsifier-correction", cause.message, `lore ac set <spec> ${ac} --correction "<reason>" (with the corrected --falsifier-* flags)`);
    return;
  }
  if (cause.code === "anchor-absent") {
    const path = /^the test file (\S+) is anchored/.exec(cause.message)?.[1] ?? "<path>";
    gap("anchor-absent", `${cause.code}: ${cause.message}`, `lore anchor rm ${slug} ${path}, or lore anchor add ${slug} ${path} --creates`);
    return;
  }
  gap("uncompilable", `${cause.code}: ${cause.message}`, `lore set ${slug} --correction "<reason>" (returns the task to draft), then lore approve ${slug}`);
}

/** A decision whose task does not list that gap (or that is not an in-flight task at all). */
function unusedDecisions(plans: readonly Plan[], decisions: MigrationDecisions): string[] {
  const problems: string[] = [];
  const bySlug = new Map(plans.map((plan) => [plan.row.slug, plan]));
  for (const slug of decisions.kinds.keys()) {
    const plan = bySlug.get(slug);
    if (plan === undefined) problems.push(`--kind ${slug}=...: ${slug} is not an approved or active task`);
    else if (plan.row.kindSource === "stored") problems.push(`--kind ${slug}=...: ${slug} already has its kind (${plan.row.kind}); it is locked`);
  }
  for (const slug of decisions.redWaivers.keys()) {
    const plan = bySlug.get(slug);
    if (plan === undefined) problems.push(`--red-waiver ${slug}=...: ${slug} is not an approved or active task`);
    else if (!plan.waiverListed) problems.push(`--red-waiver ${slug}=...: ${slug} does not need a red waiver`);
  }
  for (const slug of decisions.tips.keys()) {
    const plan = bySlug.get(slug);
    if (plan === undefined) problems.push(`--tip ${slug}=...: ${slug} is not an approved or active task`);
    else if (!plan.tipListed) problems.push(`--tip ${slug}=...: ${slug} does not list an unknown tip`);
  }
  return problems;
}

function companionWrite(plan: Plan, actor: string, now: string): CompanionDocWrite {
  const version = plan.task.version + 1;
  const extra = plan.nextExtra ?? plan.task.extra;
  return {
    id: plan.task.id,
    patch: { extra, version, updated_at: now },
    opts: { expected_version: plan.task.version },
    snapshot: true,
    version: {
      doc_id: plan.task.id,
      version,
      content: plan.task.content,
      extra,
      status: plan.task.status,
      title: plan.task.title,
      action: "update",
      created_at: now,
      created_by: actor,
      change_summary: plan.summary,
      slug: plan.task.slug,
    },
    audit: {
      timestamp: now,
      actor,
      session_id: plan.task.id,
      action: "update",
      doc_id: plan.task.id,
      details: { operation: DONE_CONTRACT_MIGRATE_OPERATION, version, new_version: version },
    },
  };
}
