/**
 * IssueFilingService — files failed milestone findings by root cause (BR-1379), the one implementation behind both
 * the automatic review batch and `lore assess --file-issues`.
 *
 * Purpose: group findings by root-cause fingerprint, search the open issues for each fingerprint first, file ONE issue
 *   per fingerprint that has none, and record it on every plan that shares it, one known-defect entry per failed
 *   dimension of that plan carrying the fingerprint (`extra.known_defects`; no corpus document, no link).
 * Public surface: {@link Fence}, {@link IssuePort}, {@link IssueRef}, {@link FilingGroup}, {@link IssueFilingService}.
 * Invariants:
 *   - One group (and so at most one new issue) per fingerprint, however many plans or batches hit it; an open issue
 *     carrying the fingerprint is linked, never duplicated. Across concurrent reviews this holds because search-then-create
 *     runs under the store lease `issue:<fingerprint>` (BR-1511); it no longer rests on one corpus-wide batch lease.
 *   - Filing is idempotent: a re-run after a partial failure finds the issue it already filed (it is open and tagged)
 *     and only completes the missing records.
 *   - The number of a just-created issue comes from the create call, never from a listing.
 *   - A group's failure is a value on that group (`error`), never thrown; the other groups still run. The caller keeps
 *     the review's verdict and retries only the filing next batch.
 *   - Entries are recorded per plan; an entry already recorded is not an error (the port appends idempotently by key).
 * Side-effect class: IO through the injected {@link IssuePort}.
 *
 * Reference: Sentry error grouping by fingerprint.
 * @spec_ref spec-plans-close-themselves-level-triggered-reconciliation-of (AC-PCR-4, BR-1379)
 * @spec_ref spec-a-plan-s-known-defects-are-its-own-record-of-github-issues (AC-KD-2, BR-1421)
 */

import type { LoreError, MilestoneDimension, Result } from "@lore/core";
import { err, ok } from "@lore/core";
import { issueLeaseKey, leaseLostError, type LeaseHandle, type ReviewLeases } from "./review-batch-lease.js";

/** Renews the caller's lease and answers whether it still holds it (false: write nothing, stop). */
export type Fence = () => Promise<boolean>;
import { issueTitleOf, rootCauseOf, type FailedFinding, type RootCause } from "./root-cause-fingerprint.js";

/** A filed or found issue. */
export interface IssueRef {
  readonly number: number;
  readonly url?: string;
}

/** What the real tracker and corpus provide; tests pass a fake. */
export interface IssuePort {
  /** The OPEN issue whose title carries `[fp:<short>]`, or `undefined`. */
  readonly findOpenByFingerprint: (short: string) => Promise<Result<IssueRef | undefined, LoreError>>;
  /** Files ONE new issue. */
  readonly file: (input: IssueInput) => Promise<Result<IssueRef, LoreError>>;
  /**
   * Appends one known-defect entry per finding (dimension + fingerprint) of this issue to the plan's
   * `extra.known_defects`, with the plan's expected version; an entry already recorded is success. Creates no document.
   */
  readonly recordKnownDefects: (plan: string, issue: IssueRef, findings: readonly IssueFinding[]) => Promise<Result<void, LoreError>>;
}

/** The finding a filed or reused issue covers. */
export interface IssueFinding {
  readonly dimension: MilestoneDimension;
  readonly fingerprint: string;
}

/** The content of one new issue. */
export interface IssueInput {
  readonly title: string;
  /** Carries the full fingerprint, the dimension, the plans and each finding. */
  readonly body: string;
  readonly fingerprint: string;
  readonly dimension: MilestoneDimension;
  readonly plans: readonly string[];
}

/** The outcome for one root cause. */
export interface FilingGroup {
  readonly cause: RootCause;
  readonly plans: readonly string[];
  /** The issue linked (filed now or already open); absent when the group failed before one existed. */
  readonly issue?: IssueRef;
  /** True when an open issue already carried the fingerprint (nothing was filed). */
  readonly reused: boolean;
  /** Plans whose known-defect entries for the issue were recorded. */
  readonly linked: readonly string[];
  /** The failure of this group (search, filing or recording); the plans not in `linked` still need their filing retried. */
  readonly error?: LoreError;
}

function bodyOf(cause: RootCause, findings: readonly FailedFinding[]): string {
  const lines = [
    `Root-cause fingerprint: ${cause.fingerprint}`,
    `Dimension: ${cause.dimension}`,
    `Cause: ${cause.label}`,
    `Plans: ${[...new Set(findings.map((f) => f.plan))].sort().join(", ")}`,
    "",
    "Findings:",
  ];
  for (const f of findings) {
    lines.push(`- ${f.plan} (${f.reviewSlug}): ${f.reason}${f.reference.length > 0 ? ` [${f.reference}]` : ""}`);
  }
  return lines.join("\n");
}

/** See the module header. */
export class IssueFilingService {
  constructor(
    private readonly port: IssuePort,
    private readonly rootCause: (finding: FailedFinding) => Result<RootCause, LoreError> = rootCauseOf,
    /** The keyed leases that make search-then-create one holder per fingerprint (BR-1511); absent only in bare constructions. */
    private readonly leases?: ReviewLeases,
  ) {}

  /**
   * Files and links the findings by root cause.
   *
   * @param findings - every failed dimension of the plans under filing
   * @param fence - renews the caller's own lease (a plan lease) and answers whether it still holds it; asked before each
   *   known-defect write, which is not made when it answers false (BR-1511). Absent in bare constructions.
   * @returns one group per fingerprint, in first-seen order; each group carries its own error when it failed; an error
   *   when any finding has no root cause (a stored regression review lacking `suite_failing_files`)
   */
  async fileFindings(findings: readonly FailedFinding[], fence?: Fence): Promise<Result<FilingGroup[], LoreError>> {
    const byFingerprint = new Map<string, { cause: RootCause; findings: FailedFinding[] }>();
    for (const finding of findings) {
      const caused = this.rootCause(finding);
      if (!caused.ok) return caused;
      const cause = caused.value;
      const group = byFingerprint.get(cause.fingerprint);
      if (group === undefined) byFingerprint.set(cause.fingerprint, { cause, findings: [finding] });
      else group.findings.push(finding);
    }
    const groups: FilingGroup[] = [];
    for (const { cause, findings: members } of byFingerprint.values()) {
      groups.push(await this.fileGroup(cause, members, fence));
    }
    return ok(groups);
  }

  private async fileGroup(cause: RootCause, members: readonly FailedFinding[], fence: Fence | undefined): Promise<FilingGroup> {
    const plans = [...new Set(members.map((m) => m.plan))].sort();
    const findOrFile = async (handle?: LeaseHandle): Promise<Result<{ readonly issue: IssueRef; readonly reused: boolean }, LoreError>> => {
      const open = await this.port.findOpenByFingerprint(cause.short);
      if (!open.ok) return open;
      if (open.value !== undefined) return ok({ issue: open.value, reused: true });
      // reason: BR-1511 fencing — the lease is renewed right before the create; a renewal that fails means another holder may own the key, so nothing is created.
      if (handle !== undefined) {
        const renewed = await handle.renewNow();
        if (!renewed.ok) return renewed;
        if (!renewed.value) return err(leaseLostError());
      }
      const filed = await this.port.file({
        title: issueTitleOf(cause),
        body: bodyOf(cause, members),
        fingerprint: cause.fingerprint,
        dimension: cause.dimension,
        plans,
      });
      return filed.ok ? ok({ issue: filed.value, reused: false }) : filed;
    };
    // reason: BR-1511 — search-then-create runs under `issue:<fingerprint>`, so concurrent reviews create at most one open
    // issue per root cause; the search inside the lease is what lets the second holder find the first one's issue.
    const found = this.leases === undefined ? await findOrFile() : await this.leases.withWaiting(issueLeaseKey(cause.fingerprint), (handle) => findOrFile(handle));
    if (!found.ok) return { cause, plans, reused: false, linked: [], error: found.error };
    const { issue, reused } = found.value;
    const linked: string[] = [];
    for (const plan of plans) {
      const dimensions = [...new Set(members.filter((m) => m.plan === plan).map((m) => m.dimension))];
      if (fence !== undefined && !(await fence())) return { cause, plans, issue, reused, linked, error: leaseLostError() };
      const result = await this.port.recordKnownDefects(
        plan,
        issue,
        dimensions.map((dimension) => ({ dimension, fingerprint: cause.fingerprint })),
      );
      if (!result.ok) return { cause, plans, issue, reused, linked, error: result.error };
      linked.push(plan);
    }
    return { cause, plans, issue, reused, linked };
  }
}
