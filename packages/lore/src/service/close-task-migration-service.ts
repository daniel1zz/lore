/**
 * Module: close-task-migration-service — `lore migrate close-tasks [--apply]`: resolves every close task of the old protocol and runs
 *   the plan close that is then due (AC-DCS2-13; ledger D30, D41, D43).
 *
 * Purpose: before plan close became a function, a plan carried a task whose only job was to close it. This migration is the ONE place
 *   that recognises such a task (a non-terminal task whose slug starts with {@link CLOSE_TASK_SLUG_PREFIX} and whose anchors name no
 *   file); no gate, rule or other code path knows a close task. It releases the task's claim, records its evidence rows on the plan's
 *   execution log, deprecates it, removes its `blocks` edges, and then hands every plan left with no open task to the ONE plan close
 *   function (`PlanCloseService`, bound by the command through {@link ClosePlanPort}); it reimplements no close step.
 * Public surface: {@link CloseTaskMigrationService} (`preview`, `apply`), {@link ClosePlanPort}, {@link CloseTaskRow},
 *   {@link PlanCloseRow}, {@link CloseTaskMigrationReport}, {@link CLOSE_TASK_MIGRATE_OPERATION}, {@link CLOSE_TASK_SLUG_PREFIX}.
 * Invariants:
 *   - the preview writes nothing; it lists each close task with what `--apply` would do and each plan whose close is due.
 *   - every close task is resolved in a fixed order, each step idempotent and the last one atomic: release the claim, remove the
 *     `blocks` edges, then ONE store transaction writes the deprecation of the task together with the evidence-moved entries on its
 *     plan. A failure stops the run with the error; the task is still a close task then, and a rerun continues where it stopped.
 *   - a close task is non-terminal until its last step lands, so a second `--apply` finds none and writes nothing; the evidence rows
 *     stay on the deprecated task (its history) and are copied, one entry per row, to the plan log.
 *   - the plan close runs for a plan of a resolved close task whose remaining tasks are all terminal and that is not closed; a plan
 *     close that fails is recorded in the report and the other plans are still processed. A plan whose close failed is retried by the
 *     next `--apply` (its close task carries this migration's audit row and the plan is still open).
 *   - a failing read is RETURNED, never reported as "no close task"; a malformed evidence list is refused, never skipped.
 * Side-effect class: IO (store reads; writes only through the injected write route and the link removal of the corpus service).
 *
 * Source: spec-integrate-proves-and-lands-evidence-at-landing-the-merge AC-DCS2-13, ledger D30, D41, D43.
 */

import {
  err,
  extractEvidence,
  extractFileAnchors,
  ok,
  readClaimRecord,
  withExecutionLogEntries,
  type AuditEntry,
  type DocId,
  type DocRecord,
  type ExecutionLogEntry,
  type LoreError,
  type Result,
} from "@lore/core";
import type { CompanionDocWrite, StoreInterface } from "../store/store-interface.js";
import { PLAN_MEMBER_TERMINAL_STATUSES } from "../store/plan-progress.js";
import { resolveWriteActorFor } from "../store/write-context-store.js";
import type { DocWritePort } from "./corpus-service.js";
import { isPlanMember } from "./plan-membership.js";

/** `details.operation` of every audit row and version summary this migration writes (grep-friendly, stable). */
export const CLOSE_TASK_MIGRATE_OPERATION = "close-task-migrate";

/** The slug prefix of a close task; this file is the only place that names it. */
export const CLOSE_TASK_SLUG_PREFIX = "task-close-plan-";

/** What the migration needs of the corpus service: the one write route plus the removal of one link row. */
export interface CloseTaskWriter extends DocWritePort {
  removeLinkOfType(request: { readonly fromId: string; readonly toId: string; readonly linkType: string; readonly by?: string }): Promise<Result<boolean, LoreError>>;
}

/** The outcome of one plan close, as the command's binding of the one close function reports it. */
export type PlanCloseOutcome =
  | { readonly closed: true; readonly detail: string }
  | { readonly closed: false; readonly exitCode: number; readonly cause: string };

/** The one plan close function, bound by the command (it needs the loaded app, the invocation and the AI of the assess). */
export interface ClosePlanPort {
  closePlan(planSlug: string): Promise<PlanCloseOutcome>;
}

/** One close task as the migration lists it. */
export interface CloseTaskRow {
  readonly slug: string;
  readonly status: string;
  /** The plan it belongs to; `undefined` when it names none (nothing to close then). */
  readonly plan: string | undefined;
  /** The holder of the claim that `--apply` releases; `undefined` when none is held. */
  readonly claimHolder: string | undefined;
  readonly claimed: boolean;
  readonly evidenceRows: number;
  readonly blocksEdges: number;
}

/** One plan whose close is due, and what became of it. */
export interface PlanCloseRow {
  readonly plan: string;
  readonly state: "would-close" | "closed" | "failed" | "waiting";
  /** `waiting`: the open tasks that keep the plan from closing; `failed`: the cause; `closed`: what the close reported. */
  readonly detail: string;
  readonly exitCode?: number;
}

/** What `preview` and `apply` report. */
export interface CloseTaskMigrationReport {
  readonly applied: boolean;
  readonly rows: readonly CloseTaskRow[];
  readonly plans: readonly PlanCloseRow[];
  /** Close tasks resolved by `apply`; empty for a preview. */
  readonly resolved: readonly string[];
}

/** True for a task that is a close task by its slug and anchors alone (its status is judged by the caller). */
function looksLikeCloseTask(task: DocRecord): boolean {
  return task.deleted_at === null && task.slug.startsWith(CLOSE_TASK_SLUG_PREFIX) && extractFileAnchors(task).length === 0;
}

const isTerminal = (task: DocRecord): boolean => PLAN_MEMBER_TERMINAL_STATUSES.has(task.status);

function refusal(field: string, message: string, value?: unknown): LoreError {
  return { code: "VALIDATION_ERROR", field, message, value };
}

/** The `from` text of one moved evidence row: the row's own facts, so the plan log alone tells what was proved. */
function movedFrom(task: DocRecord, index: number, total: number, row: { oracle?: string; command?: string; result?: string; recorded_at?: string }): string {
  const parts = [`${task.slug}: evidence ${index + 1} of ${total}`, `oracle ${row.oracle ?? "?"}`, `result ${row.result ?? "?"}`];
  if (row.command !== undefined) parts.push(`command \`${row.command}\``);
  if (row.recorded_at !== undefined) parts.push(`recorded ${row.recorded_at}`);
  return parts.join("; ");
}

export class CloseTaskMigrationService {
  /**
   * @param store - read access to tasks, plans, links and audit rows
   * @param writer - the one write route plus the link removal (`CorpusService`)
   */
  constructor(
    private readonly store: StoreInterface,
    private readonly writer: CloseTaskWriter,
  ) {}

  /**
   * Lists every close task with what `apply` would do and every plan whose close is due. Writes nothing.
   *
   * @returns the report; `err` when a read fails
   */
  async preview(): Promise<Result<CloseTaskMigrationReport, LoreError>> {
    const found = await this.scan();
    if (!found.ok) return found;
    const plans = await this.duePlans(found.value.tasks, found.value.open, found.value.retry, "would-close");
    if (!plans.ok) return plans;
    return ok({ applied: false, rows: found.value.rows, plans: plans.value.rows, resolved: [] });
  }

  /**
   * Resolves every close task, then closes each plan that is due through `closer`.
   *
   * @param closer - the one plan close function
   * @returns the report (a plan whose close failed is a `failed` plan row; the caller exits 4 on it); `err` when a read or a write of
   *   a close task fails (the run stops there; tasks resolved before it stay resolved)
   */
  async apply(closer: ClosePlanPort): Promise<Result<CloseTaskMigrationReport, LoreError>> {
    const found = await this.scan();
    if (!found.ok) return found;
    const resolved: string[] = [];
    for (const task of found.value.open) {
      const done = await this.resolveTask(task);
      if (!done.ok) return done;
      resolved.push(task.slug);
    }
    // reason: re-read after the writes, so the plan close sees the tasks as they are now (the close tasks are terminal)
    const after = await this.scan();
    if (!after.ok) return after;
    const planned = await this.duePlans(after.value.tasks, found.value.open, after.value.retry, "would-close");
    if (!planned.ok) return planned;
    const rows: PlanCloseRow[] = [];
    for (const row of planned.value.rows) {
      if (row.state !== "would-close") {
        rows.push(row);
        continue;
      }
      const outcome = await closer.closePlan(row.plan);
      rows.push(outcome.closed ? { plan: row.plan, state: "closed", detail: outcome.detail } : { plan: row.plan, state: "failed", detail: outcome.cause, exitCode: outcome.exitCode });
    }
    return ok({ applied: true, rows: found.value.rows, plans: rows, resolved });
  }

  /** Every task, the close tasks among them with their facts, and the plans of earlier resolved close tasks that are still open. */
  private async scan(): Promise<Result<{ tasks: DocRecord[]; open: DocRecord[]; rows: CloseTaskRow[]; retry: DocRecord[] }, LoreError>> {
    const read = await this.store.findMany({ type: "task" });
    if (!read.ok) return read;
    const tasks = read.value.filter((task) => task.deleted_at === null);
    const open = tasks.filter((task) => looksLikeCloseTask(task) && !isTerminal(task)).sort((a, b) => a.slug.localeCompare(b.slug));
    const rows: CloseTaskRow[] = [];
    for (const task of open) {
      const row = await this.rowOf(task);
      if (!row.ok) return row;
      rows.push(row.value);
    }
    const retry: DocRecord[] = [];
    for (const task of tasks.filter((candidate) => looksLikeCloseTask(candidate) && candidate.status === "deprecated")) {
      const audit = await this.store.queryAudit({ doc_id: task.id, action: "update" });
      if (!audit.ok) return audit;
      if (audit.value.some((row) => row.details?.["operation"] === CLOSE_TASK_MIGRATE_OPERATION)) retry.push(task);
    }
    return ok({ tasks, open, rows, retry });
  }

  private async rowOf(task: DocRecord): Promise<Result<CloseTaskRow, LoreError>> {
    const evidence = this.evidenceOf(task);
    if (!evidence.ok) return evidence;
    const edges = await this.blocksEdgesOf(task);
    if (!edges.ok) return edges;
    const holder = readClaimRecord(task)?.by;
    return ok({
      slug: task.slug,
      status: task.status,
      plan: await this.planSlugOf(task),
      claimHolder: holder,
      claimed: task.extra["claim"] !== undefined,
      evidenceRows: evidence.value.length,
      blocksEdges: edges.value.length,
    });
  }

  /** The plan slug a task names through `extra.plan_id`; `undefined` when it names none or the plan is gone. */
  private async planSlugOf(task: DocRecord): Promise<string | undefined> {
    const id = task.extra["plan_id"];
    if (typeof id !== "string") return undefined;
    const plan = await this.store.find(id);
    return plan.ok && plan.value !== null ? plan.value.slug : undefined;
  }

  /** The evidence rows of a task; a stored list that does not parse is refused, never read as shorter. */
  private evidenceOf(task: DocRecord): Result<ReturnType<typeof extractEvidence>, LoreError> {
    const raw = task.extra["verification_evidence"];
    const rows = extractEvidence(task);
    if (Array.isArray(raw) && raw.length !== rows.length) {
      return err(refusal("verification_evidence", `${task.slug}: ${raw.length - rows.length} of its ${raw.length} evidence rows do not parse, so they cannot be moved to the plan log; nothing was written for it`, task.slug));
    }
    return ok(rows);
  }

  private async blocksEdgesOf(task: DocRecord): Promise<Result<Array<{ from: string; to: string }>, LoreError>> {
    const links = await this.store.findLinks(task.id, "both");
    if (!links.ok) return links;
    return ok(links.value.filter((link) => link.link_type === "blocks").map((link) => ({ from: link.from_id, to: link.to_id })));
  }

  /** The plans due for a close, in slug order: plans of this run's close tasks and of earlier resolved ones, still open. */
  private async duePlans(
    tasks: readonly DocRecord[],
    resolving: readonly DocRecord[],
    retry: readonly DocRecord[],
    dueState: "would-close",
  ): Promise<Result<{ rows: PlanCloseRow[] }, LoreError>> {
    const resolvingIds = new Set(resolving.map((task) => task.id));
    const planIds = new Set<string>();
    for (const task of [...resolving, ...retry]) {
      const id = task.extra["plan_id"];
      if (typeof id === "string") planIds.add(id);
    }
    const rows: PlanCloseRow[] = [];
    for (const id of planIds) {
      const plan = await this.store.find(id);
      if (!plan.ok) return plan;
      if (plan.value === null || plan.value.deleted_at !== null || plan.value.status === "archived" || plan.value.status === "deprecated") continue;
      const stillOpen = tasks.filter((task) => isPlanMember(task, id as DocId) && !isTerminal(task) && !resolvingIds.has(task.id));
      rows.push(
        stillOpen.length > 0
          ? { plan: plan.value.slug, state: "waiting", detail: `open task(s): ${stillOpen.map((task) => `${task.slug} (${task.status})`).join(", ")}` }
          : { plan: plan.value.slug, state: dueState, detail: "every remaining task is archived or deprecated" },
      );
    }
    return ok({ rows: rows.sort((a, b) => a.plan.localeCompare(b.plan)) });
  }

  /** Resolves one close task: release, edges, then the deprecation together with the plan log entries. */
  private async resolveTask(task: DocRecord): Promise<Result<void, LoreError>> {
    const evidence = this.evidenceOf(task);
    if (!evidence.ok) return evidence;
    const released = await this.releaseClaim(task);
    if (!released.ok) return released;
    const edges = await this.blocksEdgesOf(released.value);
    if (!edges.ok) return edges;
    for (const edge of edges.value) {
      const removed = await this.writer.removeLinkOfType({ fromId: edge.from, toId: edge.to, linkType: "blocks" });
      if (!removed.ok) return removed;
    }
    return await this.deprecateWithLog(released.value, evidence.value);
  }

  /** Clears the claim of a close task (one version, one `release` audit row); a task holding none is returned unchanged. */
  private async releaseClaim(task: DocRecord): Promise<Result<DocRecord, LoreError>> {
    if (task.extra["claim"] === undefined) return ok(task);
    const now = new Date().toISOString();
    const actor = resolveWriteActorFor(this.store);
    const extra: Record<string, unknown> = { ...task.extra };
    delete extra["claim"];
    const release: AuditEntry = {
      timestamp: now,
      actor,
      session_id: task.id,
      action: "release",
      doc_id: task.id,
      details: { operation: CLOSE_TASK_MIGRATE_OPERATION, previous_holder: readClaimRecord(task)?.by, reason: "a close task is resolved by the close-task migration" },
    };
    const written = await this.writer.writeDoc({
      doc: task,
      patch: { extra },
      action: "update",
      changeSummary: `${CLOSE_TASK_MIGRATE_OPERATION}: claim released`,
      auditAction: "update",
      auditDetails: { operation: CLOSE_TASK_MIGRATE_OPERATION, step: "release-claim" },
      auditSessionId: `${CLOSE_TASK_MIGRATE_OPERATION}-${task.id}`,
      lock: "none",
      now,
      extras: { also_audit: [release] },
    });
    return written.ok ? ok(written.value.doc) : written;
  }

  /** ONE transaction: the task becomes deprecated and its plan's execution log gains one evidence-moved entry per evidence row. */
  private async deprecateWithLog(task: DocRecord, evidence: ReturnType<typeof extractEvidence>): Promise<Result<void, LoreError>> {
    const now = new Date().toISOString();
    const actor = resolveWriteActorFor(this.store);
    const planId = task.extra["plan_id"];
    const plan = typeof planId === "string" ? await this.store.find(planId) : ok(null);
    if (!plan.ok) return plan;
    const companions: CompanionDocWrite[] = [];
    if (plan.value !== null && evidence.length > 0) {
      const entries: ExecutionLogEntry[] = evidence.map((row, index) => ({
        kind: "evidence-moved",
        at: now,
        from: movedFrom(task, index, evidence.length, row),
        to: `${plan.value?.slug ?? ""}: execution log`,
        task: task.slug,
      }));
      let extra: Record<string, unknown>;
      try {
        extra = withExecutionLogEntries(plan.value.extra, entries);
      } catch (cause) {
        return err(refusal("execution_log", `the stored execution log of ${plan.value.slug} does not parse, so the evidence of ${task.slug} cannot be moved there: ${cause instanceof Error ? cause.message : String(cause)}`, plan.value.slug));
      }
      companions.push(planLogWrite(plan.value, extra, actor, now, `evidence of ${task.slug} moved to the plan log`));
    }
    const written = await this.writer.writeDoc({
      doc: task,
      patch: { status: "deprecated" },
      action: "update",
      changeSummary: `${CLOSE_TASK_MIGRATE_OPERATION}: deprecated`,
      auditAction: "update",
      auditDetails: { operation: CLOSE_TASK_MIGRATE_OPERATION, step: "deprecate", evidence_moved: evidence.length },
      auditSessionId: `${CLOSE_TASK_MIGRATE_OPERATION}-${task.id}`,
      lock: "none",
      now,
      ...(companions.length > 0 ? { extras: { also_update: companions } } : {}),
    });
    return written.ok ? ok(undefined) : written;
  }
}

/** The companion write that appends the entries to a plan, with its version row and audit row. */
function planLogWrite(plan: DocRecord, extra: Record<string, unknown>, actor: string, now: string, summary: string): CompanionDocWrite {
  const version = plan.version + 1;
  return {
    id: plan.id,
    patch: { extra, version, updated_at: now },
    opts: { expected_version: plan.version },
    snapshot: true,
    version: {
      doc_id: plan.id,
      version,
      content: plan.content,
      extra,
      status: plan.status,
      title: plan.title,
      action: "update",
      created_at: now,
      created_by: actor,
      change_summary: `${CLOSE_TASK_MIGRATE_OPERATION}: ${summary}`,
      slug: plan.slug,
    },
    audit: {
      timestamp: now,
      actor,
      session_id: plan.id,
      action: "update",
      doc_id: plan.id,
      details: { operation: CLOSE_TASK_MIGRATE_OPERATION, version, new_version: version, execution_log: "evidence-moved" },
    },
  };
}
