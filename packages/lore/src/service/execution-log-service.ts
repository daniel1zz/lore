/**
 * ExecutionLogService — the standalone writer of `extra.execution_log` on a task or a plan (AC-DCS2-14, ledger D28).
 *
 * Purpose: a task is a locked intent body plus an execution log that lore appends to. This service appends entries to a document
 *   that is written on its own (a plan's evidence-moved entries; the `superseded` entry of every task whose ac_scope holds a
 *   corrected or superseded criterion). Writers that record an event in a write of their own (`lore done`, `lore integrate`'s
 *   landing and evidence rows) put the same entries into THAT write with {@link withExecutionLogEntries}, so the entry and the
 *   event are one corpus write.
 * Public surface: {@link ExecutionLogService} (`appendEntries`, `recordSuperseded`), {@link ExecutionLogPort}.
 * Invariants:
 *   - the log only grows: every write is read-append-write of the stored log, every other `extra` key and the body, title and
 *     status are carried through byte-identical (a test hashes the body of every stored version);
 *   - an invalid entry or an unreadable stored log is refused with nothing written;
 *   - a write that loses a version race is re-read and retried (3 attempts), then reported, never dropped.
 * Side-effect class: store IO through the one `DocWritePort`.
 */

import { err, ok, executionLogEntrySchema, readClaimRecord, withExecutionLogEntries } from "@lore/core";
import type { DocRecord, ExecutionLogEntry, LoreError, Result } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { bareDocWriter, type DocWritePort } from "./corpus-service.js";

/** What `AcService` needs from the log: the `superseded` entry of every task holding a criterion. */
export interface ExecutionLogPort {
  /**
   * Appends a `superseded` entry naming `acId` and `reason` to every task whose ac_scope holds `acId`.
   *
   * @returns the slugs written
   */
  readonly recordSuperseded: (specSlug: string, acId: string, reason: string, via: "correction" | "supersede") => Promise<Result<string[], LoreError>>;
}

/** The resolution `lore done` uses to find the spec a criterion id of a task's scope belongs to (`TaskWorkflowService.resolveCriterionSpec`). */
export interface CriterionSpecResolver {
  readonly resolveCriterionSpec: (task: DocRecord, acId: string) => Promise<Result<string | null, LoreError>>;
}

const MAX_WRITE_ATTEMPTS = 3;

export class ExecutionLogService implements ExecutionLogPort {
  private readonly writer: DocWritePort;

  /**
   * @param store - storage, for reading the tasks and re-reading a document after a lost version race
   * @param writer - the one write route; a bare test gets a bare writer
   */
  constructor(
    private readonly store: StoreInterface,
    writer: DocWritePort | undefined,
    // reason: AC-DCS2-14 — a task is matched by (spec, AC id), never by the id alone: plans implement several specs and ids repeat.
    private readonly resolver: CriterionSpecResolver,
  ) {
    this.writer = writer ?? bareDocWriter(store);
  }

  /**
   * Appends `entries`, in order, to the log of a task or a plan, one corpus write per entry.
   *
   * @param task - the document (task or plan) to append to
   * @param entries - the entries, each validated before anything is written
   * @returns the entries written, or `VALIDATION_ERROR` for an invalid entry (nothing written) / the write's error
   */
  async appendEntries(task: DocRecord, entries: readonly ExecutionLogEntry[]): Promise<Result<ExecutionLogEntry[], LoreError>> {
    if (task.type !== "task" && task.type !== "plan") {
      return err({ code: "VALIDATION_ERROR", field: "type", message: `An execution log belongs to a task or a plan, not a ${task.type}`, value: task.type });
    }
    const parsed = entries.map((entry) => executionLogEntrySchema.safeParse(entry));
    const invalid = parsed.find((result) => !result.success);
    if (invalid !== undefined && !invalid.success) {
      return err({
        code: "VALIDATION_ERROR",
        field: "execution_log",
        message: `Invalid execution-log entry: ${invalid.error.issues.map((issue) => `${issue.path.join(".") || "kind"}: ${issue.message}`).join("; ")}`,
        value: entries,
      });
    }
    for (const entry of entries) {
      const appended = await this.append(task, entry);
      if (!appended.ok) return appended;
      task = appended.value;
    }
    return ok([...entries]);
  }

  /**
   * One read-append-write with a re-read and retry on a lost version race.
   *
   * @returns the written document
   */
  private async append(task: DocRecord, entry: ExecutionLogEntry): Promise<Result<DocRecord, LoreError>> {
    let current = task;
    let failure: LoreError | undefined;
    for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt += 1) {
      let extra: Record<string, unknown>;
      try {
        extra = withExecutionLogEntries(current.extra, [entry]);
      } catch (cause) {
        return err({ code: "VALIDATION_ERROR", field: "execution_log", message: `The stored execution log of "${current.slug}" does not parse: ${cause instanceof Error ? cause.message : String(cause)}`, value: current.extra["execution_log"] });
      }
      const written = await this.writer.writeDoc({
        doc: current,
        patch: { extra },
        action: "update",
        changeSummary: `execution log: ${entry.kind}`,
        auditAction: "update",
        auditDetails: { execution_log: entry.kind },
        auditSessionId: `execution-log-${current.id}`,
        lock: "none",
        now: entry.at,
        // reason: a lifecycle write from a linked worktree needs the declared intent of the holder's claim (DocWriteRequest.foreignIntent).
        foreignIntent: readClaimRecord(current)?.worktree !== undefined,
      });
      if (written.ok) return ok(written.value.doc);
      failure = written.error;
      if (written.error.code !== "STALE_VERSION") return written;
      const reread = await this.store.find(current.id);
      if (!reread.ok) return reread;
      if (reread.value === null) return err({ code: "DOC_NOT_FOUND", id: current.id } as LoreError);
      current = reread.value;
    }
    return err(failure as LoreError);
  }

  /**
   * Appends a `superseded` entry to every task whose ac_scope holds `acId` AND whose governing specs resolve that id to `specSlug`
   * (any status: a finished task keeps its history too). A task bound to another spec's criterion of the same id is never touched;
   * an id declared by several of a task's specs is refused (`ac-oracle-ambiguous`).
   *
   * @param specSlug - the spec whose criterion was corrected or superseded
   * @param acId - the corrected or superseded criterion
   * @param reason - the correction or supersede reason
   * @param via - which verb ran
   * @returns the slugs written
   */
  async recordSuperseded(specSlug: string, acId: string, reason: string, via: "correction" | "supersede"): Promise<Result<string[], LoreError>> {
    const tasks = await this.store.findMany({ type: "task" });
    if (!tasks.ok) return tasks;
    const slugs: string[] = [];
    const at = new Date().toISOString();
    for (const task of tasks.value) {
      const scope = task.extra["ac_scope"];
      if (!Array.isArray(scope) || !scope.includes(acId)) continue;
      const governing = await this.resolver.resolveCriterionSpec(task, acId);
      if (!governing.ok) return governing;
      if (governing.value !== specSlug) continue;
      const entry: ExecutionLogEntry = { kind: "superseded", at, ac: acId, reason, via };
      const appended = await this.appendEntries(task, [entry]);
      if (!appended.ok) return appended;
      slugs.push(task.slug);
    }
    return ok(slugs);
  }
}
