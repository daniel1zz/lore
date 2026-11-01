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
  readonly code: "kind-invalid" | "needs-red-waiver" | "unknown-tip" | "config-key" | "falsifier-correction" | "uncompilable" | "live-branch-claim";
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
  readonly gaps: readonly MigrationGap[];
}

/** What `preview` and `apply` report. */
export interface MigrationReport {
  readonly applied: boolean;
  readonly rows: readonly MigrationRow[];
  readonly gaps: readonly MigrationGap[];
  /** Tasks actually written (`apply`); empty for a preview. */
  readonly written: readonly string[];
}

/** The refusal an `--apply` with gaps returns: every gap, per task, with its command; nothing was written. */
export function migrationGaps(gaps: readonly MigrationGap[]): LoreError {
  const lines = gaps.map((gap) => `  - ${gap.slug}: ${gap.code}: ${gap.message}\n      fill it: ${gap.fill}`);
  return {
    code: "VALIDATION_ERROR",
    field: "done_contract_migration",
    message:
      `${DONE_CONTRACT_MIGRATION_GAPS}: ${gaps.length} gap${gaps.length === 1 ? "" : "s"} stop the migration; nothing was written. ` +
      `Fill every gap in one call and run it again:\n${lines.join("\n")}`,
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
    return ok({ applied: false, rows: planned.value.map((plan) => plan.row), gaps: planned.value.flatMap((plan) => plan.row.gaps), written: [] });
  }

  /**
   * Stores every contract in one transaction, or writes nothing.
   *
   * @param decisions - the decisions given with the call
   * @returns the report; `err(migrationGaps)` while any task has a gap (nothing written); `err` on a failed read or write
   */
  async apply(decisions: MigrationDecisions = NO_DECISIONS): Promise<Result<MigrationReport, LoreError>> {
    const planned = await this.planAll(decisions);
    if (!planned.ok) return planned;
    const rows = planned.value.map((plan) => plan.row);
    const gaps = rows.flatMap((row) => row.gaps);
    if (gaps.length > 0) return err(migrationGaps(gaps));

    const writes = planned.value.filter((plan) => plan.nextExtra !== undefined);
    if (writes.length === 0) return ok({ applied: true, rows, gaps: [], written: [] });

    const now = new Date().toISOString();
    const actor = resolveWriteActorFor(this.store);
    const audits = writes.flatMap((plan) =>
      plan.auditRows.map((row): AuditEntry => ({ ...row, timestamp: now, actor, details: { ...row.details, version: plan.task.version + 1 } })),
    );
    const companions = writes.slice(1).map((plan) => companionWrite(plan, actor, now));
    const [primary] = writes;
    if (primary === undefined || primary.nextExtra === undefined) return ok({ applied: true, rows, gaps: [], written: [] });
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
    return ok({ applied: true, rows, gaps: [], written: writes.map((plan) => plan.task.slug) });
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
      kind = inferKind(extractFileAnchors(task).length > 0 || namesBranch, scripted.value);
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
    if (!hasContract && kind !== undefined) {
      const compiled = await this.contracts.compileForApprove(
        { ...task, extra: { ...task.extra, kind } },
        needsWaiver && waiver !== undefined ? { redWaiverReason: waiver.trim() } : {},
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
    const row: MigrationRow = { slug: task.slug, status: task.status, kind, kindSource, contract, alreadyCompiled: hasContract, releasesClaim: releases, gaps };
    return ok({
      row,
      task,
      nextExtra: gaps.length > 0 ? undefined : nextExtra,
      auditRows: extraAudits,
      summary: `done-contract migration: ${parts.join("; ") || "tip recorded"}`,
      waiverListed: !hasContract && needsWaiver,
      tipListed,
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
