/**
 * `IssueCloseOnArchive` — the ONE post-archive step that closes every GitHub issue a just-archived
 * CARRIER names in `extra.issues` (a task archived by `lore done`, a plan archived by `lore archive` /
 * `lore set --status archived`), plus the legacy `lore issues --sync` drift repair, which a later task
 * of the same plan rewrites (spec-github-owns-issue-report-state-no-mirror-task-work-carries, AC-GS-8).
 *
 * Public surface:
 *   - `ArchiveIssueClosePort` — the optional port `CorpusService` and `TaskWorkflowService` each hold
 *     (services never import each other; `app.ts` wires one instance into both). `onArchived(doc, actor)`
 *     NEVER throws and NEVER returns an error: it returns the lines to show, because the archive is
 *     already committed ("post-commit: the archive is never rolled back").
 *   - `IssueCloseItem` — one reportable line (`stream` says stdout vs stderr).
 *   - `IssueCloseOnArchive` — the implementation: `onArchived`, `planSync`, `applySync`.
 *   - `ISSUE_CLOSE_FAILED_AUDIT_ACTION` — the audit action written on every failed GitHub call.
 *
 * Invariants:
 *   - Keyed on the carrier: a document with no valid `extra.issues` is a no-op (no GitHub call at all).
 *   - EVERY named issue is attempted, in declared order; one failure never skips the rest.
 *   - An issue already closed with a verdict (`not_planned` / `duplicate`) is skipped, never rewritten.
 *   - Post-commit and non-fatal: a GitHub failure is printed + audited (one `issue_close_failed` row per
 *     failed call, naming the issue), never an `err` that could read as "the archive failed".
 *   - Absent closer is LOUD (one `not_configured` line naming `lore issues --sync`), never silent.
 *   - Close, comment and label are three independent calls; a comment or label failure never undoes
 *     the close. An already-closed (completed) issue gets no second comment.
 *   - The repo written to is the configured upstream; a carrier names only `repo_id`.
 *   - The corpus is read-only here except for `issue_close_failed` audit rows.
 *
 * Side-effect class: IO (store reads, audit append, GitHub via the injected `IssueCloser`).
 *
 * Source: spec-github-owns-issue-report-state-no-mirror-task-work-carries, AC-GS-8.
 */

import { TERMINAL_ISSUE_RESOLUTIONS, computeIssueResolution, hasIssueReport } from "./issue-resolution.js";
import type { GithubIssueSnapshot, IssueCloser } from "./issue-closer-port.js";
import { labelToResolution, readGithubIssueRef, resolutionToLabel } from "./resolution-projector.js";
import type { GithubIssueRef } from "./resolution-projector.js";
import { issueRefSchema, ok } from "@lore/core";
import type { DocRecord, IssueRef, IssueResolution, LoreError, Result } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { bareDocWriter, type DocWritePort } from "./corpus-service.js";

/** Audit action written once per failed GitHub call (close, comment or label). */
export const ISSUE_CLOSE_FAILED_AUDIT_ACTION = "issue_close_failed";

/** What one reported line is about. */
export type IssueCloseKind =
  | "closed"
  | "already_closed"
  | "close_failed"
  | "comment_failed"
  | "label_failed"
  | "read_failed"
  | "not_configured"
  | "skipped_verdict";

/** One line the caller prints. `number` is absent when the report carries no GitHub ref. */
export interface IssueCloseItem {
  readonly kind: IssueCloseKind;
  readonly number?: number;
  readonly message: string;
  readonly stream: "stdout" | "stderr";
}

/** The port a service calls right after an archive commit. */
export interface ArchiveIssueClosePort {
  /**
   * @param doc - the document that was just archived (post-commit state)
   * @param actor - the resolved actor of the archiving write, recorded on failure audit rows
   * @returns the lines to show; empty when the document resolves no report and says nothing about one
   */
  onArchived(doc: DocRecord, actor: string): Promise<IssueCloseItem[]>;
}

/** One `lore issues --sync` drift row (spec Public Interface). */
export interface IssueDriftEntry {
  readonly number: number;
  readonly slug: string;
  readonly computed: IssueResolution;
  readonly github_state: "open" | "closed";
  readonly missing_label: boolean;
  /** Present (true) only when the report's own task was archived through `lore done` (D3) — it is closed, not just labelled. */
  readonly completed_via_done?: true;
}

/** One `--sync --apply` outcome. `closed` = THIS apply closed it; `labelled` = the label is now present. */
export interface IssueSyncApplied {
  readonly number: number;
  readonly closed: boolean;
  readonly labelled: boolean;
  readonly error?: string;
}

/** A report whose GitHub state could not be read — reported, never skipped silently. */
export interface IssueSyncUnreadable {
  readonly number: number;
  readonly slug: string;
  readonly error: string;
}

/** What {@link IssueCloseOnArchive.planSync} found. */
export interface IssueSyncPlan {
  readonly drift: readonly IssueDriftEntry[];
  readonly unreadable: readonly IssueSyncUnreadable[];
}

/** Result of {@link IssueCloseOnArchive.planSync} / {@link IssueCloseOnArchive.applySync}. */
export type IssueSyncOutcome =
  | { readonly kind: "not_configured"; readonly message: string }
  | { readonly kind: "store_error"; readonly error: LoreError }
  | { readonly kind: "planned"; readonly plan: IssueSyncPlan; readonly applied?: readonly IssueSyncApplied[] };

const NOT_CONFIGURED_MESSAGE =
  "GitHub not configured — run lore issues --sync after configuring feedback.upstream";

/** `resolution:*` verdicts a maintainer sets when closing an issue as not-fixed (spec ADR status table). */
const VERDICT_RESOLUTIONS: ReadonlySet<IssueResolution> = new Set<IssueResolution>(["rejected", "wontfix", "superseded", "duplicate"]);

/**
 * The verdict an issue was ALREADY closed with, or `undefined` when it is open or closed as completed.
 * reason: archiving a carrier must never overwrite a maintainer's "not a defect" with `completed`
 * (AC-GS-8). A `not_planned` close with no `resolution:*` verdict label still counts — as "not planned" —
 * because it is not a fix either.
 */
function closedVerdictOf(snapshot: GithubIssueSnapshot): string | undefined {
  if (snapshot.state !== "closed") return undefined;
  const reason = snapshot.stateReason;
  if (reason !== "not_planned" && reason !== "duplicate") return undefined;
  for (const label of snapshot.labels) {
    const resolution = labelToResolution(label);
    if (resolution !== undefined && VERDICT_RESOLUTIONS.has(resolution)) return resolution;
  }
  return reason === "duplicate" ? "duplicate" : "not planned";
}

/**
 * The issues a carrier names, in declared order; `[]` for a non-carrier or a malformed `extra.issues`.
 * reason: the write path (`judgeIssueCarrierExtra`) already refuses a malformed bag, so a malformed one
 * here is legacy or hand-edited data; each entry is Zod-parsed and an invalid one is dropped rather than
 * allowed to abort the archive that is already committed.
 */
function readCarrierIssueRefs(doc: DocRecord): readonly IssueRef[] {
  if (doc.type !== "task" && doc.type !== "plan") return [];
  const raw = doc.extra["issues"];
  if (!Array.isArray(raw)) return [];
  const refs: IssueRef[] = [];
  for (const entry of raw) {
    const parsed = issueRefSchema.safeParse(entry);
    if (parsed.success) refs.push(parsed.data);
  }
  return refs;
}

function describeError(error: LoreError): string {
  return "message" in error ? error.message : error.code;
}

/** A report plus the facts D1/D3 need to judge it. */
interface ReportFacts {
  readonly task: DocRecord;
  readonly computed: IssueResolution;
  readonly hasArchivedSource: boolean;
  /** The archived-or-active resolving sources, in link order. */
  readonly sources: readonly DocRecord[];
}

/** See the module header. */
export class IssueCloseOnArchive implements ArchiveIssueClosePort {
  private readonly store: StoreInterface;
  private readonly writer: DocWritePort;
  private readonly closer: IssueCloser | undefined;
  private readonly upstreamRepo: string | undefined;
  private readonly now: () => string;

  /**
   * @param store - corpus read access + the audit append for failure rows
   * @param closer - the GitHub write capability; `undefined` when `feedback.upstream` is not a GitHub repo
   * @param upstreamRepo - the configured `owner/repo`; PREFERRED over the stored ref's repo (a rename
   *   leaves the stored string stale — same rule as `lore issue resolve`)
   * @param now - clock seam for the comment date and audit timestamps
   */
  constructor(
    store: StoreInterface,
    closer: IssueCloser | undefined,
    upstreamRepo: string | undefined,
    now: () => string = () => new Date().toISOString(),
    // reason: AC-DCL-5 — the ONE write route (`CorpusService`); `app.ts` passes the composed one, a bare test gets a
    // bare writer. This step never calls `store.appendAuditEntry` itself.
    writer?: DocWritePort,
  ) {
    this.writer = writer ?? bareDocWriter(store);
    this.store = store;
    this.closer = closer;
    this.upstreamRepo = upstreamRepo;
    this.now = now;
  }

  /** True iff a GitHub closer is wired. */
  get isConfigured(): boolean {
    return this.closer !== undefined;
  }

  async onArchived(doc: DocRecord, actor: string): Promise<IssueCloseItem[]> {
    const refs = readCarrierIssueRefs(doc);
    if (refs.length === 0) return [];
    if (this.closer === undefined) return [{ kind: "not_configured", message: NOT_CONFIGURED_MESSAGE, stream: "stdout" }];
    const closer = this.closer;
    if (this.upstreamRepo === undefined) {
      // reason: a carrier names `repo_id`, not `owner/repo`; the configured upstream is the only repo the
      // closer may write to. A closer wired without it is a composition bug, so say so instead of guessing.
      return [
        {
          kind: "read_failed",
          message: `issue close step has no configured upstream repo to close ${refs.length} issue(s) named by ${doc.slug} — run lore issues --sync`,
          stream: "stderr",
        },
      ];
    }
    const repo = this.upstreamRepo;

    const items: IssueCloseItem[] = [];
    // reason: every named issue is attempted — a failure on one never skips the rest (AC-GS-8, three-issue fixture).
    for (const issueRef of refs) {
      const ref: GithubIssueRef = { repo, issueNumber: issueRef.number, repo_id: issueRef.repo_id };
      const snapshot = await closer.readIssue(ref);
      if (!snapshot.ok) {
        const reason = describeError(snapshot.error);
        const audited = await this.auditFailureForDoc(doc, actor, "read", ref.issueNumber, reason);
        items.push({
          kind: "read_failed",
          number: ref.issueNumber,
          message: `issue #${ref.issueNumber}: could not read GitHub state: ${reason} — run lore issues --sync${audited}`,
          stream: "stderr",
        });
        continue;
      }
      const verdict = closedVerdictOf(snapshot.value);
      if (verdict !== undefined) {
        items.push({
          kind: "skipped_verdict",
          number: ref.issueNumber,
          message: `issue #${ref.issueNumber} skipped: closed as ${verdict}`,
          stream: "stdout",
        });
        continue;
      }
      items.push(...(await this.closeOne(closer, ref, doc, actor)));
    }
    return items;
  }

  /**
   * Finds every drifted report (D3 a/b) without writing anything.
   *
   * @returns `not_configured` when no closer is wired; `planned` otherwise
   */
  async planSync(): Promise<IssueSyncOutcome> {
    if (this.closer === undefined) return { kind: "not_configured", message: NOT_CONFIGURED_MESSAGE };
    const reports = await this.store.findMany({ type: "task" });
    if (!reports.ok) return { kind: "store_error", error: reports.error };

    const drift: IssueDriftEntry[] = [];
    const unreadable: IssueSyncUnreadable[] = [];
    for (const task of reports.value) {
      if (!hasIssueReport(task.extra)) continue;
      const ref = readGithubIssueRef(task.extra);
      if (ref === undefined) continue;
      const facts = await this.readReportFacts(task.id);
      if (!facts.ok) return { kind: "store_error", error: facts.error };
      if (facts.facts === null) continue;
      const { computed, hasArchivedSource } = facts.facts;
      let completedViaDone = false;
      if (computed === "closed") {
        const completion = await this.wasCompletedThroughDone(task);
        if (!completion.ok) return { kind: "store_error", error: completion.error };
        completedViaDone = completion.value;
      }
      const wantsClose = (computed === "fixed" && hasArchivedSource) || completedViaDone;
      const wantsLabelOnly = computed !== "fixed" && TERMINAL_ISSUE_RESOLUTIONS.has(computed);
      if (!wantsClose && !wantsLabelOnly) continue;

      const effective = this.effectiveRef(ref);
      const snapshot = await this.closer.readIssue(effective);
      if (!snapshot.ok) {
        unreadable.push({ number: ref.issueNumber, slug: task.slug, error: describeError(snapshot.error) });
        continue;
      }
      const missingLabel = !snapshot.value.labels.includes(resolutionToLabel(computed));
      const listed = wantsClose ? snapshot.value.state === "open" || missingLabel : missingLabel;
      if (!listed) continue;
      drift.push({
        number: ref.issueNumber,
        slug: task.slug,
        computed,
        github_state: snapshot.value.state,
        missing_label: missingLabel,
        ...(completedViaDone ? { completed_via_done: true as const } : {}),
      });
    }
    return { kind: "planned", plan: { drift, unreadable } };
  }

  /**
   * {@link planSync}, then repairs each drift entry: a `fixed` report is closed (if open) and labelled;
   * every other terminal state is ONLY labelled — never closed (BR-537 / Q2 is a separate product
   * decision). Failures land in `applied[].error` and the audit log; they never abort the loop.
   */
  async applySync(): Promise<IssueSyncOutcome> {
    const planned = await this.planSync();
    if (planned.kind !== "planned" || this.closer === undefined) return planned;
    const closer = this.closer;
    const reports = await this.store.findMany({ type: "task" });
    if (!reports.ok) return { kind: "store_error", error: reports.error };
    const bySlug = new Map(reports.value.map((task) => [task.slug, task]));

    const applied: IssueSyncApplied[] = [];
    for (const entry of planned.plan.drift) {
      const task = bySlug.get(entry.slug);
      const rawRef = task === undefined ? undefined : readGithubIssueRef(task.extra);
      if (task === undefined || rawRef === undefined) {
        applied.push({ number: entry.number, closed: false, labelled: false, error: "report vanished during sync" });
        continue;
      }
      const ref = this.effectiveRef(rawRef);
      let closed = false;
      let error: string | undefined;
      if ((entry.computed === "fixed" || entry.completed_via_done === true) && entry.github_state === "open") {
        const closeResult = await closer.closeIssue(ref);
        if (closeResult.ok) {
          closed = !closeResult.value.alreadyClosed;
        } else {
          error = `close failed: ${describeError(closeResult.error)}`;
          await this.auditFailure(task, "close", entry.number, describeError(closeResult.error), "lore issues --sync");
        }
      }
      let labelled = !entry.missing_label;
      if (error === undefined && entry.missing_label) {
        const labelResult = await closer.labelIssue(ref, resolutionToLabel(entry.computed));
        if (labelResult.ok) {
          labelled = true;
        } else {
          error = `label failed: ${describeError(labelResult.error)}`;
          await this.auditFailure(task, "label", entry.number, describeError(labelResult.error), "lore issues --sync");
        }
      }
      applied.push({ number: entry.number, closed, labelled, ...(error !== undefined ? { error } : {}) });
    }
    return { kind: "planned", plan: planned.plan, applied };
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /** D3 — true iff the done walk's own audit row shows `lore done` archived this task. */
  private async wasCompletedThroughDone(task: DocRecord): Promise<Result<boolean, LoreError>> {
    if (task.status !== "archived") return ok(false);
    const rows = await this.store.queryAudit({ doc_id: task.id, action: "update" });
    if (!rows.ok) return rows;
    return ok(rows.value.some((row) => row.details?.["done"] === true && row.details?.["status_to"] === "archived"));
  }

  /** The configured repo wins over the stored one (rename-proof); the stored ref supplies the number. */
  private effectiveRef(ref: GithubIssueRef): GithubIssueRef {
    return this.upstreamRepo === undefined ? ref : { ...ref, repo: this.upstreamRepo };
  }

  /** Loads one report + its resolving sources and computes its resolution (same call shape as `lore issues`). */
  private async readReportFacts(
    reportId: string,
  ): Promise<{ ok: true; facts: ReportFacts | null } | { ok: false; error: LoreError }> {
    const found = await this.store.find(reportId);
    if (!found.ok) return { ok: false, error: found.error };
    const task = found.value;
    if (task === null || !hasIssueReport(task.extra)) return { ok: true, facts: null };

    const inbound = await this.store.findLinks(task.id, "in");
    if (!inbound.ok) return { ok: false, error: inbound.error };
    const edges = inbound.value.filter((link) => link.link_type === "resolves");
    const sourcesById = await this.store.findByIds(edges.map((edge) => edge.from_id));
    if (!sourcesById.ok) return { ok: false, error: sourcesById.error };
    const sources = [...sourcesById.value.values()];
    const computed = computeIssueResolution(
      task,
      edges.map((edge) => ({ from_id: edge.from_id })),
      sources.map((source) => ({ id: source.id, status: source.status })),
    );
    return {
      ok: true,
      facts: {
        task,
        computed,
        hasArchivedSource: sources.some((source) => source.status === "archived"),
        sources,
      },
    };
  }

  /** Close, comment, label — three independent calls (D2). */
  private async closeOne(
    closer: IssueCloser,
    ref: GithubIssueRef,
    doc: DocRecord,
    actor: string,
    wording?: { readonly comment: string; readonly label: string },
  ): Promise<IssueCloseItem[]> {
    const items: IssueCloseItem[] = [];
    const number = ref.issueNumber;
    const label = wording?.label ?? resolutionToLabel("fixed");
    const closeResult = await closer.closeIssue(ref);
    if (!closeResult.ok) {
      const reason = describeError(closeResult.error);
      const audited = await this.auditFailureForDoc(doc, actor, "close", number, reason);
      items.push({
        kind: "close_failed",
        number,
        message: `issue #${number}: close FAILED: ${reason} — run lore issues --sync${audited}`,
        stream: "stderr",
      });
      return items;
    }

    if (closeResult.value.alreadyClosed) {
      items.push({
        kind: "already_closed",
        number,
        message: `issue #${number}: already closed on GitHub (fixed by ${doc.slug})`,
        stream: "stdout",
      });
    } else {
      items.push({
        kind: "closed",
        number,
        message: `issue #${number}: closed on GitHub (fixed by ${doc.slug})`,
        stream: "stdout",
      });
      const comment = wording?.comment ?? `Fixed by ${doc.type} ${doc.slug} (archived ${this.now().slice(0, 10)})`;
      const commentResult = await closer.commentIssue(ref, comment);
      if (!commentResult.ok) {
        const reason = describeError(commentResult.error);
        const audited = await this.auditFailureForDoc(doc, actor, "comment", number, reason);
        items.push({
          kind: "comment_failed",
          number,
          message: `issue #${number}: closed, but the comment FAILED: ${reason}${audited}`,
          stream: "stderr",
        });
      }
    }

    const labelResult = await closer.labelIssue(ref, label);
    if (!labelResult.ok) {
      const reason = describeError(labelResult.error);
      const audited = await this.auditFailureForDoc(doc, actor, "label", number, reason);
      items.push({
        kind: "label_failed",
        number,
        message: `issue #${number}: closed, but the ${label} label FAILED: ${reason} — run lore issues --sync${audited}`,
        stream: "stderr",
      });
    }
    return items;
  }

  private async auditFailureForDoc(
    doc: DocRecord,
    actor: string,
    step: "read" | "close" | "comment" | "label",
    number: number,
    reason: string,
  ): Promise<string> {
    const written = await this.writer.appendAudit({
      timestamp: this.now(),
      by: actor,
      sessionId: doc.id,
      action: ISSUE_CLOSE_FAILED_AUDIT_ACTION,
      docId: doc.id,
      details: { issue: number, step, error: reason, source: doc.slug },
    });
    return written.ok ? "" : ` (audit row NOT written: ${describeError(written.error)})`;
  }

  private async auditFailure(
    task: DocRecord,
    step: "close" | "comment" | "label",
    number: number,
    reason: string,
    source: string,
  ): Promise<void> {
    await this.writer.appendAudit({
      timestamp: this.now(),
      by: "lore issues --sync",
      sessionId: task.id,
      action: ISSUE_CLOSE_FAILED_AUDIT_ACTION,
      docId: task.id,
      details: { issue: number, step, error: reason, source },
    });
  }
}
