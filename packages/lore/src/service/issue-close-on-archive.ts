/**
 * `IssueCloseOnArchive` — the ONE post-archive step that closes the GitHub issue of every defect report
 * a just-archived spec / plan / task resolves, and the `lore issues --sync` drift repair built on the
 * same primitives (spec-archiving-the-work-that-resolves-a-defect-report-closes D1-D4, D6).
 *
 * Public surface:
 *   - `ArchiveIssueClosePort` — the optional port `CorpusService` and `TaskWorkflowService` each hold
 *     (services never import each other; `app.ts` wires one instance into both). `onArchived(doc, actor)`
 *     NEVER throws and NEVER returns an error: it returns the lines to show, because the archive is
 *     already committed (D1 "post-commit: the archive is never rolled back").
 *   - `IssueCloseItem` — one reportable line (`stream` says stdout vs stderr).
 *   - `IssueCloseOnArchive` — the implementation: `onArchived`, `planSync`, `applySync`.
 *   - `ISSUE_CLOSE_FAILED_AUDIT_ACTION` — the audit action written on every failed GitHub call.
 *
 * Invariants:
 *   - Post-commit and non-fatal: a GitHub failure is printed + audited, never an `err` that could
 *     read as "the archive failed".
 *   - Absent closer is LOUD (one `not_configured` line naming `lore issues --sync`), never silent (D4).
 *   - Close, comment and label are three independent calls; a comment or label failure never undoes
 *     the close (D2). An already-closed issue gets no second comment.
 *   - Only a report whose COMPUTED resolution is `fixed` with at least one ARCHIVED resolving source is
 *     touched (D1) — an explicit terminal verdict (`wontfix`, ...) outranks the link in
 *     `computeIssueResolution`, so it is never closed here.
 *   - The corpus is read-only here except for `issue_close_failed` audit rows; the issue task's own
 *     status is never changed (spec Out of scope).
 *
 * Side-effect class: IO (store reads, audit append, GitHub via the injected `IssueCloser`).
 *
 * Source: spec-archiving-the-work-that-resolves-a-defect-report-closes, AC-IC-1, AC-IC-4.
 */

import { TERMINAL_ISSUE_RESOLUTIONS, computeIssueResolution, hasIssueReport } from "./issue-resolution.js";
import type { IssueCloser } from "./issue-closer-port.js";
import { readGithubIssueRef, resolutionToLabel } from "./resolution-projector.js";
import type { GithubIssueRef } from "./resolution-projector.js";
import type { DocRecord, IssueResolution, LoreError } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";

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
  | "no_github_ref"
  | "unlinked_prose";

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

const PROSE_CLOSE_PATTERN = /\b(?:closes|fixes|resolves)\s+#(\d+)/gi;

/** The doc types whose prose is checked for a "closes #N" with no link (D6). */
const PROSE_CHECKED_TYPES: ReadonlySet<string> = new Set(["spec", "plan", "task"]);

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
  ) {
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
    const items: IssueCloseItem[] = [];
    const linked = await this.collectResolvedReportIds(doc);
    if (!linked.ok) {
      items.push({
        kind: "read_failed",
        message: `issue close step could not read ${doc.slug}'s links: ${describeError(linked.error)} — run lore issues --sync`,
        stream: "stderr",
      });
      return items;
    }

    let notedNotConfigured = false;
    for (const targetId of linked.ids) {
      const facts = await this.readReportFacts(targetId);
      if (!facts.ok) {
        items.push({
          kind: "read_failed",
          message: `issue close step could not read a report resolved by ${doc.slug}: ${describeError(facts.error)} — run lore issues --sync`,
          stream: "stderr",
        });
        continue;
      }
      if (facts.facts === null) continue; // not an issue report (the D1b write-time check normally prevents this)
      const { task, computed, hasArchivedSource } = facts.facts;
      // D1: only a computed `fixed` resting on an ARCHIVED source closes. An explicit terminal verdict
      // (wontfix, ...) outranks the link, so `computed` is not `fixed` and nothing happens.
      if (computed !== "fixed" || !hasArchivedSource) continue;

      const ref = readGithubIssueRef(task.extra);
      if (ref === undefined) {
        items.push({
          kind: "no_github_ref",
          message: `issue ${task.slug}: local-only report (no GitHub issue), nothing to close`,
          stream: "stdout",
        });
        continue;
      }
      if (this.closer === undefined) {
        if (!notedNotConfigured) {
          items.push({ kind: "not_configured", message: NOT_CONFIGURED_MESSAGE, stream: "stdout" });
          notedNotConfigured = true;
        }
        continue;
      }
      items.push(...(await this.closeOne(this.closer, this.effectiveRef(ref), doc, actor)));
    }

    items.push(...(await this.warnUnlinkedProse(doc, linked.ids)));
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
      const wantsClose = computed === "fixed" && hasArchivedSource;
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
      if (entry.computed === "fixed" && entry.github_state === "open") {
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

  /** The configured repo wins over the stored one (rename-proof); the stored ref supplies the number. */
  private effectiveRef(ref: GithubIssueRef): GithubIssueRef {
    return this.upstreamRepo === undefined ? ref : { ...ref, repo: this.upstreamRepo };
  }

  /** Targets of `doc`'s outgoing `resolves` links. */
  private async collectResolvedReportIds(
    doc: DocRecord,
  ): Promise<{ ok: true; ids: string[] } | { ok: false; error: LoreError }> {
    const links = await this.store.findLinks(doc.id, "out");
    if (!links.ok) return { ok: false, error: links.error };
    return { ok: true, ids: links.value.filter((link) => link.link_type === "resolves").map((link) => link.to_id) };
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
  ): Promise<IssueCloseItem[]> {
    const items: IssueCloseItem[] = [];
    const number = ref.issueNumber;
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
      const comment = `Fixed by ${doc.type} ${doc.slug} (archived ${this.now().slice(0, 10)})`;
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

    const labelResult = await closer.labelIssue(ref, resolutionToLabel("fixed"));
    if (!labelResult.ok) {
      const reason = describeError(labelResult.error);
      const audited = await this.auditFailureForDoc(doc, actor, "label", number, reason);
      items.push({
        kind: "label_failed",
        number,
        message: `issue #${number}: closed, but the ${resolutionToLabel("fixed")} label FAILED: ${reason} — run lore issues --sync${audited}`,
        stream: "stderr",
      });
    }
    return items;
  }

  /** D6 — "closes #N" in prose for a filed report this document has no `resolves` link to. */
  private async warnUnlinkedProse(doc: DocRecord, linkedIds: readonly string[]): Promise<IssueCloseItem[]> {
    if (!PROSE_CHECKED_TYPES.has(doc.type)) return [];
    const numbers = new Set<number>();
    for (const match of doc.content.matchAll(PROSE_CLOSE_PATTERN)) numbers.add(Number(match[1]));
    if (numbers.size === 0) return [];

    const reports = await this.store.findMany({ type: "task" });
    if (!reports.ok) {
      return [
        {
          kind: "read_failed",
          message: `could not check ${doc.slug}'s "closes #N" mentions against filed reports: ${describeError(reports.error)}`,
          stream: "stderr",
        },
      ];
    }
    const items: IssueCloseItem[] = [];
    for (const number of [...numbers].sort((a, b) => a - b)) {
      const report = reports.value.find((task) => readGithubIssueRef(task.extra)?.issueNumber === number);
      if (report === undefined || linkedIds.includes(report.id)) continue;
      items.push({
        kind: "unlinked_prose",
        number,
        message:
          `warning: ${doc.slug} says it fixes #${number} but has no resolves link, so GitHub issue #${number} is not closed — ` +
          `run: lore link ${doc.slug} ${report.slug} --type resolves`,
        stream: "stderr",
      });
    }
    return items;
  }

  private async auditFailureForDoc(
    doc: DocRecord,
    actor: string,
    step: "close" | "comment" | "label",
    number: number,
    reason: string,
  ): Promise<string> {
    const written = await this.store.appendAuditEntry({
      timestamp: this.now(),
      actor,
      session_id: doc.id,
      action: ISSUE_CLOSE_FAILED_AUDIT_ACTION,
      doc_id: doc.id,
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
    await this.store.appendAuditEntry({
      timestamp: this.now(),
      actor: "lore issues --sync",
      session_id: task.id,
      action: ISSUE_CLOSE_FAILED_AUDIT_ACTION,
      doc_id: task.id,
      details: { issue: number, step, error: reason, source },
    });
  }
}
