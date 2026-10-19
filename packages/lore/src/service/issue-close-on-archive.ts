/**
 * `IssueCloseOnArchive` — the ONE post-archive step that closes every GitHub issue a just-archived
 * CARRIER names in `extra.issues` (a task archived by `lore done`, a plan archived by `lore archive` /
 * `lore set --status archived`), plus the PUSH-ONLY `lore issues --sync` repair that closes whatever an archive
 * left open (spec-github-owns-issue-report-state-no-mirror-task-work-carries, AC-GS-8, AC-GS-16).
 *
 * Public surface:
 *   - `ArchiveIssueClosePort` — the optional port `CorpusService` and `TaskWorkflowService` each hold
 *     (services never import each other; `app.ts` wires one instance into both). `onArchived(doc, actor)`
 *     NEVER throws and NEVER returns an error: it returns the lines to show, because the archive is
 *     already committed ("post-commit: the archive is never rolled back").
 *   - `IssueCloseItem` — one reportable line (`stream` says stdout vs stderr).
 *   - `IssueCloseOnArchive` — the implementation: `onArchived`, `planSync`, `applySync`.
 *   - `IssueSyncListing` / `IssueSyncOutcome` — the complete live listing `--sync` is handed, and what it found and did.
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
 *   - The corpus is read-only here except for `issue_close_failed` audit rows: `--sync` repairs GitHub from the
 *     carriers and never writes a document, version or link.
 *   - `planSync`/`applySync` take the COMPLETE listing as an argument; a listing that failed never reaches them,
 *     so an empty plan means "nothing to do" and never "could not look".
 *
 * Side-effect class: IO (store reads, audit append, GitHub via the injected `IssueCloser`).
 *
 * Source: spec-github-owns-issue-report-state-no-mirror-task-work-carries, AC-GS-8.
 */

import type { GithubIssueSnapshot, IssueCloser } from "./issue-closer-port.js";
import { EXPLICIT_TERMINAL_RESOLUTIONS } from "./issue-resolution.js";
import type { GithubListedIssue } from "./github-intake-port.js";
import { joinIssueStatuses } from "./github-issue-listing.js";
import { labelToResolution, resolutionToLabel } from "./resolution-projector.js";
import type { GithubIssueRef } from "./resolution-projector.js";
import { err, isInvalidated, issueRefSchema } from "@lore/core";
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
  /** The failing call's error, present on every failure kind; `--sync` maps it to its exit code. */
  readonly error?: LoreError;
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

/** The complete live listing `--sync` reads: every issue (PRs excluded) and the repository's numeric id. */
export interface IssueSyncListing {
  readonly issues: readonly GithubListedIssue[];
  readonly repoId: number;
}

/** What one planned repair does to one issue. */
export type IssueSyncAction =
  /** An open issue an archived carrier fixed: close it as completed, comment, converge `resolution:fixed`. */
  | "close"
  /** A closed issue an archived carrier fixed whose labels are not exactly `resolution:fixed`. */
  | "label_fixed"
  /** An open issue carrying `resolution:*` labels it must not have (retired or stray verdict). */
  | "strip_labels";

/** One planned repair. */
export interface IssueSyncChange {
  readonly number: number;
  readonly action: IssueSyncAction;
  /** Slug of the archived carrier that fixed the issue; `undefined` for `strip_labels`. */
  readonly carrierSlug?: string;
  /** Labels `strip_labels` removes; empty for the other actions. */
  readonly removeLabels: readonly string[];
}

/** One applied repair: the lines to print and, when a call failed, that call's error. */
export interface IssueSyncApplied {
  readonly number: number;
  readonly action: IssueSyncAction;
  readonly lines: readonly string[];
  readonly failure?: LoreError;
}

/** What {@link IssueCloseOnArchive.planSync} found. */
export interface IssueSyncPlan {
  readonly changes: readonly IssueSyncChange[];
}

/** Result of {@link IssueCloseOnArchive.planSync} / {@link IssueCloseOnArchive.applySync}. */
export type IssueSyncOutcome =
  | { readonly kind: "not_configured"; readonly message: string }
  | { readonly kind: "store_error"; readonly error: LoreError }
  | { readonly kind: "planned"; readonly plan: IssueSyncPlan; readonly applied?: readonly IssueSyncApplied[] };

/** The actor `--sync` writes failure audit rows as. */
const SYNC_ACTOR = "lore issues --sync";

/** Prefix of every verdict label; the corpus never reads state from one, `--sync` only removes strays. */
const RESOLUTION_LABEL_PREFIX = "resolution:";

const NOT_CONFIGURED_MESSAGE =
  "GitHub not configured — run lore issues --sync after configuring feedback.upstream";

/**
 * Is `resolution` a verdict a maintainer sets when closing an issue as not-fixed (ADR status table)? Those are exactly
 * the hand-settable terminal states, read from the SSOT set rather than re-listed (AC-DC-9: one construction site).
 */
function isVerdictResolution(resolution: IssueResolution): boolean {
  return [...EXPLICIT_TERMINAL_RESOLUTIONS].some((verdict) => verdict === resolution);
}

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
    if (resolution !== undefined && isVerdictResolution(resolution)) return resolution;
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
          error: snapshot.error,
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
   * Plans the repairs a COMPLETE live listing calls for, without writing anything.
   *
   * @param listing - the complete listing (a failed listing never gets here)
   * @returns `not_configured` when no closer is wired; `store_error` when the carriers cannot be read; `planned` otherwise
   */
  async planSync(listing: IssueSyncListing): Promise<IssueSyncOutcome> {
    if (this.closer === undefined) return { kind: "not_configured", message: NOT_CONFIGURED_MESSAGE };
    const planned = await this.planChanges(listing);
    if (!planned.ok) return { kind: "store_error", error: planned.error };
    return { kind: "planned", plan: { changes: planned.changes.map((entry) => entry.change) } };
  }

  /**
   * {@link planSync}, then pushes each change to GitHub. A failing call is recorded on its
   * `applied` entry (and audited when a carrier names it) and never aborts the loop.
   */
  async applySync(listing: IssueSyncListing): Promise<IssueSyncOutcome> {
    if (this.closer === undefined) return { kind: "not_configured", message: NOT_CONFIGURED_MESSAGE };
    if (this.upstreamRepo === undefined) return { kind: "not_configured", message: NOT_CONFIGURED_MESSAGE };
    const closer = this.closer;
    const planned = await this.planChanges(listing);
    if (!planned.ok) return { kind: "store_error", error: planned.error };

    const applied: IssueSyncApplied[] = [];
    for (const { change, carrier } of planned.changes) {
      const ref: GithubIssueRef = { repo: this.upstreamRepo, issueNumber: change.number, repo_id: listing.repoId };
      if (change.action === "close" && carrier !== undefined) {
        const items = await this.closeOne(closer, ref, carrier, SYNC_ACTOR);
        const failure = items.find((item) => item.error !== undefined)?.error;
        applied.push({ number: change.number, action: change.action, lines: items.map((item) => item.message), ...(failure !== undefined ? { failure } : {}) });
      } else if (change.action === "label_fixed" && carrier !== undefined) {
        const labelled = await closer.labelIssue(ref, resolutionToLabel("fixed"));
        if (labelled.ok) {
          applied.push({ number: change.number, action: change.action, lines: [`issue #${change.number}: converged to resolution:fixed (fixed by ${carrier.slug})`] });
        } else {
          const audited = await this.auditFailureForDoc(carrier, SYNC_ACTOR, "label", change.number, describeError(labelled.error));
          applied.push({ number: change.number, action: change.action, lines: [`issue #${change.number}: label FAILED: ${describeError(labelled.error)}${audited}`], failure: labelled.error });
        }
      } else {
        const removed: Result<void, LoreError> =
          closer.removeLabels === undefined
            ? err({ code: "VALIDATION_ERROR", field: "closer", message: "this closer cannot remove labels", value: change.removeLabels.join(",") })
            : await closer.removeLabels(ref, change.removeLabels);
        applied.push(
          removed.ok
            ? { number: change.number, action: change.action, lines: [`issue #${change.number}: removed stray label(s) ${change.removeLabels.join(", ")}`] }
            : { number: change.number, action: change.action, lines: [`issue #${change.number}: label removal FAILED: ${describeError(removed.error)}`], failure: removed.error },
        );
      }
    }
    return { kind: "planned", plan: { changes: planned.changes.map((entry) => entry.change) }, applied };
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /**
   * Joins the listing against the carriers (tasks and plans naming an issue, archived ones included) and
   * decides one change per issue that needs one. Pure over its two inputs apart from the store read.
   */
  private async planChanges(
    listing: IssueSyncListing,
  ): Promise<{ ok: true; changes: ReadonlyArray<{ change: IssueSyncChange; carrier?: DocRecord }> } | { ok: false; error: LoreError }> {
    const carriers: DocRecord[] = [];
    for (const type of ["task", "plan"] as const) {
      const found = await this.store.findMany({ type });
      if (!found.ok) return { ok: false, error: found.error };
      carriers.push(...found.value.filter((doc) => readCarrierIssueRefs(doc).length > 0));
    }
    const nowIso = this.now();
    const rows = joinIssueStatuses(listing.issues, carriers, listing.repoId, nowIso);
    const changes: Array<{ change: IssueSyncChange; carrier?: DocRecord }> = [];
    for (const row of rows) {
      const number = row.issue.number;
      const resolutionLabels = (row.issue.labels ?? []).filter((label) => label.startsWith(RESOLUTION_LABEL_PREFIX));
      const fixer = carriers
        .filter((doc) => doc.status === "archived" && !isInvalidated(doc, nowIso))
        .filter((doc) => readCarrierIssueRefs(doc).some((ref) => ref.repo_id === listing.repoId && ref.number === number))
        .sort((a, b) => a.slug.localeCompare(b.slug))[0];
      if (row.status === "fixed (close pending)" && fixer !== undefined) {
        changes.push({ change: { number, action: "close", carrierSlug: fixer.slug, removeLabels: [] }, carrier: fixer });
      } else if (row.status === "fixed" && fixer !== undefined) {
        const exact = resolutionLabels.length === 1 && resolutionLabels[0] === resolutionToLabel("fixed");
        if (!exact) changes.push({ change: { number, action: "label_fixed", carrierSlug: fixer.slug, removeLabels: [] }, carrier: fixer });
      } else if (row.issue.state !== "closed" && resolutionLabels.length > 0) {
        changes.push({ change: { number, action: "strip_labels", removeLabels: resolutionLabels } });
      }
    }
    return { ok: true, changes };
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
        error: closeResult.error,
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
          error: commentResult.error,
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
        error: labelResult.error,
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
}
