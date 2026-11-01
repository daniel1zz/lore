/**
 * Known defects at plan close: which entries a closing plan keeps, and the GitHub issue writes for the ones it detaches
 * (BR-1510; spec-a-corpus-only-task-has-nothing-to-measure-and-a-closed D3, #529).
 *
 * Purpose: a plan that closes carries only the known defects its closing review (the latest review of the plan's
 *   current state) still fails or did not measure. The others are detached in the audited close; their issues are
 *   commented and closed unless another open plan (or a kept entry of this plan) still references them; a failed
 *   issue write is recorded pending on an audit row and retried by every later review batch until it succeeds.
 * Public surface: {@link planKnownDefectDetachment}, {@link closingFactsOf}, {@link issueWritesOf},
 *   {@link carryOutIssueWrites}, {@link foldPendingIssueWrites}, {@link retryPendingIssueWrites},
 *   {@link KNOWN_DEFECT_ISSUE_WRITES_AUDIT_ACTION}, {@link KnownDefectIssueWriter}.
 * Invariants:
 *   - Order of a close: (1) read every detached entry's issue and gather other open plans' known defects; an issue
 *     that cannot be read refuses the close and nothing is written; (2) the caller writes the plan record and the
 *     audit details in the close write; (3) {@link carryOutIssueWrites} runs after that write and never fails it.
 *   - A dimension the review did not measure (`not-measured`, `na`, an accepted gate) never detaches its entries.
 *   - A pending write is never dropped: it stays pending on a new audit row until a retry succeeds.
 *   - A retry of an issue's pending writes runs under the lease `issue-write:<n>` and re-reads the audit rows after acquiring (BR-1511).
 * Side-effect class: IO through injected ports (issue reader, issue writer, audit reader/appender); the pure parts
 *   ({@link closingFactsOf}, {@link issueWritesOf}, {@link foldPendingIssueWrites}) touch nothing.
 *
 * @spec_ref spec-a-corpus-only-task-has-nothing-to-measure-and-a-closed (AC-AQ-2, AC-AQ-3, BR-1510)
 */

import {
  err,
  MILESTONE_DIMENSIONS,
  ok,
  partitionKnownDefectsAtClose,
  readKnownDefects,
  type ClosingDimensionFacts,
  type DetachedKnownDefect,
  type DocRecord,
  type KnownDefectEntry,
  type LoreError,
  type MilestoneDimension,
  type MilestoneReview,
  type Result,
} from "@lore/core";
import { acceptedGatesOf, type GateAcceptanceLog } from "./gate-acceptance-service.js";
import type { IssueRead } from "./milestone-review-inputs.js";
import { issueWriteLeaseKey, type ReviewLeases } from "./review-batch-lease.js";
import { failingCausesOf } from "./root-cause-fingerprint.js";

/** Audit action of the row that records the issue writes of a close (or of a retry of earlier pending ones). */
export const KNOWN_DEFECT_ISSUE_WRITES_AUDIT_ACTION = "known-defect-issue-writes";

/** The GitHub write capability a close needs (comment, then close). */
export interface KnownDefectIssueWriter {
  readonly commentIssue: (issue: number, body: string) => Promise<Result<void, LoreError>>;
  /** Closes the issue as completed; an already-closed issue is success. */
  readonly closeIssue: (issue: number) => Promise<Result<void, LoreError>>;
}

/** The issue read a close needs (`PlanCloseIssuePort.readIssue`). */
export interface KnownDefectIssueReader {
  readonly readIssue: (issue: number) => Promise<Result<IssueRead, LoreError>>;
}

/** The latest review of the plan's current state, as plan close selects it. */
export interface ClosingReview {
  readonly doc: Pick<DocRecord, "slug">;
  readonly review: MilestoneReview;
}

/** One detached entry with the issue it names and whether the issue stays open for another reference. */
export interface DetachedWithIssue extends DetachedKnownDefect {
  /** Slugs of the other open plans (and `self` for a kept entry of this plan) that still reference the issue. */
  readonly sharedWith: readonly string[];
}

/** What a close keeps and detaches. */
export interface KnownDefectDetachment {
  readonly kept: readonly KnownDefectEntry[];
  readonly detached: readonly DetachedWithIssue[];
}

/** One GitHub write of a close, as recorded on the audit row. */
export interface IssueWriteRecord {
  readonly plan: string;
  readonly issue: number;
  readonly action: "comment" | "close";
  readonly status: "done" | "pending";
  /** The error of a pending write. */
  readonly error?: string;
  /** The comment text (kept on a comment write so a retry posts the same words). */
  readonly body?: string;
}

/** A planned write: what to do to which issue. */
export type PlannedIssueWrite = Pick<IssueWriteRecord, "plan" | "issue" | "action"> & { readonly body?: string };

function messageOf(error: LoreError): string {
  return "message" in error && typeof error.message === "string" ? error.message : error.code;
}

/**
 * The closing review's verdict and failing root-cause fingerprints per dimension.
 *
 * @param planSlug - the closing plan's slug (cause identity input)
 * @param latest - the closing review
 * @returns one fact per dimension; a failing dimension whose cause cannot be fingerprinted has NO fact, so its entries
 *   are kept (a cause that cannot be identified is never read as gone)
 */
export function closingFactsOf(planSlug: string, latest: ClosingReview): Partial<Record<MilestoneDimension, ClosingDimensionFacts>> {
  const facts: Partial<Record<MilestoneDimension, ClosingDimensionFacts>> = {};
  for (const dimension of MILESTONE_DIMENSIONS) {
    const judgment = latest.review.dimensions[dimension];
    if (judgment.verdict !== "fail") {
      facts[dimension] = { verdict: judgment.verdict, failingFingerprints: [] };
      continue;
    }
    // reason: BR-1513 — a regression charged with several files has one fingerprint PER file, all of them current; an entry
    // whose file is no longer red is the one that gets detached.
    const causes = failingCausesOf(planSlug, latest.doc.slug, latest.review, dimension);
    // reason: an unidentifiable failing cause leaves the dimension without a fact -> its entries are kept, never detached.
    if (causes.ok) facts[dimension] = { verdict: "fail", failingFingerprints: causes.value.map((c) => c.fingerprint) };
  }
  return facts;
}

/**
 * Step 1 of the close order: partitions the plan's known defects by the closing review and reads everything the issue
 * writes will need. Writes nothing.
 *
 * @param plan - the closing plan (its `extra` is the one the close will write)
 * @param latest - the closing review
 * @param otherOpenPlans - every other open plan (their `extra.known_defects` decide whether an issue is shared)
 * @param reader - the issue reader; absent only when no GitHub upstream is configured
 * @returns the detachment, or a VALIDATION_ERROR naming the first issue that cannot be read (the close is refused)
 */
export async function planKnownDefectDetachment(
  plan: Pick<DocRecord, "id" | "slug" | "extra">,
  latest: ClosingReview,
  otherOpenPlans: readonly Pick<DocRecord, "slug" | "extra">[],
  reader: KnownDefectIssueReader | undefined,
  acceptanceLog: GateAcceptanceLog,
): Promise<Result<KnownDefectDetachment, LoreError>> {
  const entries = readKnownDefects(plan.extra);
  const acceptedGates = await acceptedGatesOf(plan, latest, acceptanceLog);
  if (!acceptedGates.ok) return acceptedGates;
  const split = partitionKnownDefectsAtClose(entries, closingFactsOf(plan.slug, latest), acceptedGates.value);
  if (split.detached.length === 0) return ok({ kept: split.kept, detached: [] });
  const refuse = (message: string): LoreError => ({ code: "VALIDATION_ERROR", field: "gate:plan-close", message, rule: "BR-1510" });
  if (reader === undefined) {
    return err(refuse(`plan ${plan.slug} cannot close: ${split.detached.map((d) => `#${String(d.entry.number)}`).join(", ")} must be detached but no issue reader is wired (no GitHub upstream configured); nothing was written`));
  }
  const read = new Map<number, IssueRead>();
  for (const { entry } of split.detached) {
    if (read.has(entry.number)) continue;
    const fetched = await reader.readIssue(entry.number);
    if (!fetched.ok) return err(refuse(`plan ${plan.slug} cannot close: issue #${String(entry.number)} cannot be read, so its known defect cannot be detached: ${messageOf(fetched.error)}; nothing was written`));
    if (fetched.value.repoId !== entry.repo_id) {
      return err(refuse(`plan ${plan.slug} cannot close: known defect #${String(entry.number)} is recorded for repository id ${String(entry.repo_id)} but the configured repository has id ${String(fetched.value.repoId)}; nothing was written`));
    }
    read.set(entry.number, fetched.value);
  }
  const detached: DetachedWithIssue[] = split.detached.map((d) => {
    const sharedWith: string[] = [];
    if (split.kept.some((k) => k.repo_id === d.entry.repo_id && k.number === d.entry.number)) sharedWith.push(plan.slug);
    for (const other of otherOpenPlans) {
      if (readKnownDefects(other.extra).some((o) => o.repo_id === d.entry.repo_id && o.number === d.entry.number)) sharedWith.push(other.slug);
    }
    return { ...d, sharedWith };
  });
  return ok({ kept: split.kept, detached });
}

/**
 * The GitHub writes a detachment calls for: per detached issue one comment naming the closing review and its verdict
 * for the dimension, then a close unless the issue is still referenced elsewhere.
 *
 * @param planSlug - the closing plan
 * @param reviewSlug - the closing review
 * @param detachment - what {@link planKnownDefectDetachment} decided
 */
export function issueWritesOf(planSlug: string, reviewSlug: string, detachment: KnownDefectDetachment): PlannedIssueWrite[] {
  const writes: PlannedIssueWrite[] = [];
  const done = new Set<number>();
  for (const d of detachment.detached) {
    if (done.has(d.entry.number)) continue;
    const same = detachment.detached.filter((x) => x.entry.number === d.entry.number);
    done.add(d.entry.number);
    const dimensions = same.map((x) => `${x.entry.dimension} ${x.verdict === "pass" ? "passes" : "fails for another cause"}`).join(", ");
    const shared = same.some((x) => x.sharedWith.length > 0);
    const closing = shared ? `The issue stays open: still referenced by ${[...new Set(same.flatMap((x) => x.sharedWith))].join(", ")}.` : "Closing this issue.";
    const body = `Plan ${planSlug} closed on review ${reviewSlug}: ${dimensions}. This known defect is detached from the plan. ${closing}`;
    writes.push({ plan: planSlug, issue: d.entry.number, action: "comment", body });
    if (!shared) writes.push({ plan: planSlug, issue: d.entry.number, action: "close" });
  }
  return writes;
}

/**
 * Step 3: carries out `writes` in order; a failed write is recorded pending with its error and never stops the rest.
 *
 * @returns one record per write
 */
export async function carryOutIssueWrites(
  writes: readonly PlannedIssueWrite[],
  writer: KnownDefectIssueWriter | undefined,
  /** Renews the caller's lease and answers whether it still holds it; a write is not made (it stays pending) when it answers false (BR-1511). */
  fence?: () => Promise<boolean>,
): Promise<IssueWriteRecord[]> {
  const records: IssueWriteRecord[] = [];
  for (const write of writes) {
    const base = { plan: write.plan, issue: write.issue, action: write.action, ...(write.body !== undefined ? { body: write.body } : {}) } as const;
    if (writer === undefined) {
      records.push({ ...base, status: "pending", error: "no issue writer is wired (no GitHub upstream configured)" });
      continue;
    }
    if (fence !== undefined && !(await fence())) {
      records.push({ ...base, status: "pending", error: "the lease of this write expired and was taken over; not written" });
      continue;
    }
    const outcome = write.action === "comment" ? await writer.commentIssue(write.issue, write.body ?? "") : await writer.closeIssue(write.issue);
    records.push(outcome.ok ? { ...base, status: "done" } : { ...base, status: "pending", error: messageOf(outcome.error) });
  }
  return records;
}

/** An audit row as the pending fold reads it. */
export interface IssueWriteAuditRow {
  readonly id: number;
  readonly details?: Record<string, unknown> | undefined;
}

/**
 * The writes still pending: the latest record per (plan, issue, action) across the rows in id order, kept when pending.
 *
 * @param rows - every {@link KNOWN_DEFECT_ISSUE_WRITES_AUDIT_ACTION} row
 */
export function foldPendingIssueWrites(rows: readonly IssueWriteAuditRow[]): PlannedIssueWrite[] {
  const latest = new Map<string, IssueWriteRecord>();
  for (const row of [...rows].sort((a, b) => a.id - b.id)) {
    const writes = row.details?.["writes"];
    if (!Array.isArray(writes)) continue;
    for (const raw of writes) {
      if (raw === null || typeof raw !== "object") continue;
      const w = raw as Partial<IssueWriteRecord>;
      if (typeof w.plan !== "string" || typeof w.issue !== "number" || (w.action !== "comment" && w.action !== "close") || (w.status !== "done" && w.status !== "pending")) continue;
      latest.set(`${w.plan}|${String(w.issue)}|${w.action}`, w as IssueWriteRecord);
    }
  }
  return [...latest.values()]
    .filter((w) => w.status === "pending")
    .map((w) => ({ plan: w.plan, issue: w.issue, action: w.action, ...(w.body !== undefined ? { body: w.body } : {}) }));
}

/** The ports {@link retryPendingIssueWrites} drives. */
export interface PendingRetryPorts {
  readonly listRows: () => Promise<Result<readonly IssueWriteAuditRow[], LoreError>>;
  readonly writer: KnownDefectIssueWriter | undefined;
  readonly appendRow: (details: { readonly retry: true; readonly writes: readonly IssueWriteRecord[] }) => Promise<Result<void, LoreError>>;
  /** The keyed leases that give each issue's pending writes one retrying holder (BR-1511); absent only in bare constructions. */
  readonly leases?: ReviewLeases;
}

/**
 * Retries every pending issue write recorded by earlier closes and records the outcome on a new audit row. Nothing is
 * appended when nothing is pending.
 *
 * @returns the outcome records (empty when nothing was pending), or the error of reading or appending the audit
 */
export async function retryPendingIssueWrites(ports: PendingRetryPorts): Promise<Result<IssueWriteRecord[], LoreError>> {
  const rows = await ports.listRows();
  if (!rows.ok) return rows;
  const pending = foldPendingIssueWrites(rows.value);
  if (pending.length === 0) return ok([]);
  const leases = ports.leases;
  if (leases === undefined) {
    const records = await carryOutIssueWrites(pending, ports.writer);
    const appended = await ports.appendRow({ retry: true, writes: records });
    if (!appended.ok) return appended;
    return ok(records);
  }
  // reason: BR-1511 — the pending writes of one issue are retried under `issue-write:<n>`. The holder re-reads the audit rows
  // AFTER acquiring and appends its outcome row BEFORE releasing, so a second pass never sees a write as pending that the
  // first one did: without both, two concurrent retries comment twice.
  const outcomes: IssueWriteRecord[] = [];
  for (const issue of [...new Set(pending.map((w) => w.issue))]) {
    const taken = await leases.acquire(issueWriteLeaseKey(issue));
    if (!taken.ok) return taken;
    // reason: a busy key means another holder is retrying these writes right now; skipping is not a drop, they stay pending on the audit until a row says done.
    if (taken.value.state === "busy") continue;
    try {
      const fresh = await ports.listRows();
      if (!fresh.ok) return fresh;
      const stillPending = foldPendingIssueWrites(fresh.value).filter((w) => w.issue === issue);
      if (stillPending.length === 0) continue;
      const handle = taken.value.handle;
      const records = await carryOutIssueWrites(stillPending, ports.writer, async () => {
        const renewed = await handle.renewNow();
        return renewed.ok && renewed.value;
      });
      const appended = await ports.appendRow({ retry: true, writes: records });
      if (!appended.ok) return appended;
      outcomes.push(...records);
    } finally {
      await taken.value.handle.release();
    }
  }
  return ok(outcomes);
}
