/**
 * IssueFilingService — files failed milestone findings by root cause (BR-1379), the one implementation behind both
 * the automatic review batch and `lore assess --file-issues`.
 *
 * Purpose: group findings by root-cause fingerprint, search the open issues for each fingerprint first, file ONE issue
 *   per fingerprint that has none, and link the issue to every plan that shares it.
 * Public surface: {@link IssuePort}, {@link IssueRef}, {@link FilingGroup}, {@link IssueFilingService}.
 * Invariants:
 *   - One group (and so at most one new issue) per fingerprint, however many plans or batches hit it; an open issue
 *     carrying the fingerprint is linked, never duplicated.
 *   - Filing is idempotent: a re-run after a partial failure finds the issue it already filed (it is open and tagged)
 *     and only completes the missing links.
 *   - A group's failure is a value on that group (`error`), never thrown; the other groups still run. The caller keeps
 *     the review's verdict and retries only the filing next batch.
 *   - Links are written per plan; a link that already exists is not an error (the port ignores DUPLICATE_LINK).
 * Side-effect class: IO through the injected {@link IssuePort}.
 *
 * Reference: Sentry error grouping by fingerprint.
 * @spec_ref spec-plans-close-themselves-level-triggered-reconciliation-of (AC-PCR-4, BR-1379)
 */

import type { LoreError, MilestoneDimension, Result } from "@lore/core";
import { ok } from "@lore/core";
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
   * Links the issue to the plan (a `known-defect` link: the plan-close coverage carrier) and records on the issue's carrier which finding
   * (dimension + fingerprint) it files, so plan close reads coverage from the record, never the title; an existing
   * link is success.
   */
  readonly linkToPlan: (plan: string, issue: IssueRef, finding: IssueFinding) => Promise<Result<void, LoreError>>;
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
  /** Plans whose link to the issue was written. */
  readonly linked: readonly string[];
  /** The failure of this group (search, filing or a link); the plans not in `linked` still need their filing retried. */
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
  constructor(private readonly port: IssuePort) {}

  /**
   * Files and links the findings by root cause.
   *
   * @param findings - every failed dimension of the plans under filing
   * @returns one group per fingerprint, in first-seen order; each group carries its own error when it failed; an error
   *   when any finding has no root cause (a stored regression review lacking `suite_failing_files`)
   */
  async fileFindings(findings: readonly FailedFinding[]): Promise<Result<FilingGroup[], LoreError>> {
    const byFingerprint = new Map<string, { cause: RootCause; findings: FailedFinding[] }>();
    for (const finding of findings) {
      const caused = rootCauseOf(finding);
      if (!caused.ok) return caused;
      const cause = caused.value;
      const group = byFingerprint.get(cause.fingerprint);
      if (group === undefined) byFingerprint.set(cause.fingerprint, { cause, findings: [finding] });
      else group.findings.push(finding);
    }
    const groups: FilingGroup[] = [];
    for (const { cause, findings: members } of byFingerprint.values()) {
      groups.push(await this.fileGroup(cause, members));
    }
    return ok(groups);
  }

  private async fileGroup(cause: RootCause, members: readonly FailedFinding[]): Promise<FilingGroup> {
    const plans = [...new Set(members.map((m) => m.plan))].sort();
    const open = await this.port.findOpenByFingerprint(cause.short);
    if (!open.ok) return { cause, plans, reused: false, linked: [], error: open.error };
    let issue = open.value;
    const reused = issue !== undefined;
    if (issue === undefined) {
      const filed = await this.port.file({
        title: issueTitleOf(cause),
        body: bodyOf(cause, members),
        fingerprint: cause.fingerprint,
        dimension: cause.dimension,
        plans,
      });
      if (!filed.ok) return { cause, plans, reused: false, linked: [], error: filed.error };
      issue = filed.value;
    }
    const linked: string[] = [];
    for (const plan of plans) {
      const result = await this.port.linkToPlan(plan, issue, { dimension: cause.dimension, fingerprint: cause.fingerprint });
      if (!result.ok) return { cause, plans, issue, reused, linked, error: result.error };
      linked.push(plan);
    }
    return { cause, plans, issue, reused, linked };
  }
}
