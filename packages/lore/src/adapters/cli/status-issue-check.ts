/**
 * `computeIssueCheck` — the counts behind `lore status --check-issues`
 * (spec-github-owns-issue-report-state-no-mirror-task-work-carries D8, AC-GS-4, AC-GS-9).
 *
 * Counts are per ISSUE, taken from the live join (`joinIssueStatuses`: GitHub listing x carriers), never per
 * carrier and never from a stored status — the corpus stores none. The `IssueStatus` each count reads is the
 * ONE `deriveIssueStatus` verdict, so a count cannot disagree with `lore issues`:
 *
 *   closed_unverified_count   status `closed (unverified)`   closed on GitHub, no archived carrier
 *   adopted_abandoned_count   status `adopted (abandoned)`   open, every carrier dead (deprecated/invalidated)
 *   close_pending_count       status `fixed (close pending)` open, an archived carrier exists
 *   closed_no_verdict_count   status `closed (no verdict)`   closed not_planned without a resolution:* label
 *   unknown_ref_count         carriers naming a number absent from the live listing
 *   stale_open_count          status `open` (no carrier) whose GitHub `created_at` is at least
 *                             `feedback.stale_after_days` old (whole days, INCLUSIVE boundary, the rule
 *                             `staleness.ts` uses); a row with no `created_at` is never counted
 *
 * Each count is `members.length` of the same list `--enumerate <field>` prints (sorted `#<n>`), so
 * `count === enumerate().length` holds by construction (AC-FR-5).
 *
 * Vitest-safe sibling of `commands/status.ts` (see `adapters/cli/CLAUDE.md`): type-only service imports, no
 * `bun:sqlite`, no `gh`. The caller fetches the listing; this module only reads and counts.
 *
 * Side-effect class: pure (`computeIssueCheck`), store reads (`listCarrierDocs`).
 */

import { ok } from "@lore/core";
import type { DocRecord, IssueStatus, LoreError, Result } from "@lore/core";

import type { CorpusService } from "../../service/corpus-service.js";
import type { IssueStatusRow } from "../../service/github-issue-listing.js";

/** A carrier doc as the status check reads it: only `extra.issues` matters here. */
export type CarrierDoc = DocRecord;

/** The count fields `--check-issues` reports and `--enumerate` can list. */
export const ISSUE_CHECK_FIELDS = [
  "closed_unverified_count",
  "adopted_abandoned_count",
  "close_pending_count",
  "closed_no_verdict_count",
  "unknown_ref_count",
  "stale_open_count",
] as const;
export type IssueCheckField = (typeof ISSUE_CHECK_FIELDS)[number];

/** The derived status each status-keyed count reads (`unknown_ref_count` and `stale_open_count` have their own rules). */
const STATUS_OF_FIELD: Readonly<Record<Exclude<IssueCheckField, "unknown_ref_count" | "stale_open_count">, IssueStatus>> = {
  closed_unverified_count: "closed (unverified)",
  adopted_abandoned_count: "adopted (abandoned)",
  close_pending_count: "fixed (close pending)",
  closed_no_verdict_count: "closed (no verdict)",
};

/** What plain `lore status` reports: it did not contact GitHub, so it carries no count. */
export interface IssuesNotChecked {
  checked: false;
}

/** `--check-issues` result payload. */
export type IssueCheckPayload = { checked: true } & Record<IssueCheckField, number> & {
    /** The `#<n>` members behind each count, sorted by issue number. */
    members: Record<IssueCheckField, string[]>;
  };

const byNumber = (a: number, b: number): number => a - b;
const label = (n: number): string => `#${n}`;

/** Every `(repo_id, number)` a carrier's `extra.issues` names, read defensively (malformed entries name nothing). */
function namedRefs(doc: CarrierDoc): Array<{ repoId: number; number: number }> {
  const refs = (doc.extra as Record<string, unknown> | null | undefined)?.["issues"];
  if (!Array.isArray(refs)) return [];
  const out: Array<{ repoId: number; number: number }> = [];
  for (const ref of refs) {
    if (typeof ref !== "object" || ref === null) continue;
    const { repo_id, number } = ref as Record<string, unknown>;
    if (typeof repo_id === "number" && typeof number === "number") out.push({ repoId: repo_id, number });
  }
  return out;
}

/**
 * @param rows - the live join, exactly one row per listed issue
 * @param carriers - every task and plan with `extra.issues` (archived and dead ones included)
 * @param repoId - the configured repository's numeric id (the join key's first half)
 * @param staleAfterDays - resolved `feedback.stale_after_days`
 * @param nowMs - clock seam (the caller passes `Date.now()`)
 * @returns the six counts with their sorted `#<n>` members
 */
export function computeIssueCheck(
  rows: readonly IssueStatusRow[],
  carriers: readonly CarrierDoc[],
  repoId: number,
  staleAfterDays: number,
  nowMs: number,
): IssueCheckPayload {
  const members = {} as Record<IssueCheckField, string[]>;
  for (const field of ISSUE_CHECK_FIELDS) {
    if (field === "unknown_ref_count" || field === "stale_open_count") continue;
    const wanted = STATUS_OF_FIELD[field];
    members[field] = rows
      .filter((row) => row.status === wanted)
      .map((row) => row.issue.number)
      .sort(byNumber)
      .map(label);
  }

  const listed = new Set(rows.map((row) => row.issue.number));
  const unknown = new Set<number>();
  for (const doc of carriers) {
    for (const ref of namedRefs(doc)) {
      if (ref.repoId === repoId && !listed.has(ref.number)) unknown.add(ref.number);
    }
  }
  members["unknown_ref_count"] = [...unknown].sort(byNumber).map(label);

  members["stale_open_count"] = rows
    .filter((row) => {
      if (row.status !== "open" || row.issue.created_at === undefined) return false;
      const ageDays = Math.floor((nowMs - new Date(row.issue.created_at).getTime()) / 86_400_000);
      return Number.isFinite(ageDays) && ageDays >= staleAfterDays;
    })
    .map((row) => row.issue.number)
    .sort(byNumber)
    .map(label);

  const counts = {} as Record<IssueCheckField, number>;
  for (const field of ISSUE_CHECK_FIELDS) counts[field] = members[field].length;
  return { checked: true, ...counts, members };
}

/** Every task and plan whose `extra.issues` is an array — the carrier index `joinIssueStatuses` expects. */
export async function listCarrierDocs(
  corpus: Pick<CorpusService, "listFull">,
): Promise<Result<CarrierDoc[], LoreError>> {
  const carriers: CarrierDoc[] = [];
  for (const type of ["task", "plan"] as const) {
    const listed = await corpus.listFull({ type });
    if (!listed.ok) return listed;
    carriers.push(
      ...listed.value.docs.filter((doc) => Array.isArray((doc.extra as Record<string, unknown> | null | undefined)?.["issues"])),
    );
  }
  return ok(carriers);
}
