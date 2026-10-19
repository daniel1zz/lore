/**
 * Read-time half of GitHub issue ingest (D3) — joins a live GitHub issue
 * listing against the corpus tasks already ingested from it, so a read
 * surface (`commands/issues.ts`, a later phase's anchor) can render EVERY
 * listed issue as either `ingested` (with its computed resolution) or
 * `not_ingested`
 * (spec-a-github-filed-defect-must-be-claimable-one-ingest-seam, G3, G5,
 * AC-GR-2, AC-GR-5).
 *
 * Store-free and total, exactly like `issue-resolution.ts`: no
 * `StoreInterface`, no `GhRunner`/`child_process`/`GitHubIntakePort`, no IO.
 * Every fact this module needs arrives as an ARGUMENT — the listing
 * (already fetched), the already-ingested tasks (already store-read), and a
 * caller-supplied `resolveOne` closure for the one fact this module cannot
 * compute itself (see below).
 *
 * Public surface:
 *   - `GithubIssueRow` — the per-issue join result: `{kind: "ingested", ...}`
 *     or `{kind: "not_ingested", issue}`. `not_ingested` is deliberately NOT
 *     a member of `@lore/core`'s `IssueResolution` vocabulary (D6) — it
 *     describes the ABSENCE of a corpus task, and that vocabulary is
 *     derived from `extra` on a task that EXISTS.
 *   - `ResolveIssueResolution` — the caller-supplied closure type.
 *   - `joinListing(issues, ingestedTasks, currentRepoId, resolveOne)` — the
 *     one join.
 *
 * Invariants:
 *   - AC-GR-5 / G5: the join key is `(repo_id, issueNumber)`, NEVER the
 *     stored `owner/repo` string — a task whose `readGithubIssueRef` ref
 *     carries no `repo_id` (written before this spec, or malformed) cannot
 *     match ANY listed issue by this key; it is treated as `not_ingested`
 *     for every currently-listed issue rather than falling back to a
 *     rename-unsafe string compare.
 *   - Exactly one row per element of `issues`, in the SAME order — this
 *     function never drops, reorders, or adds a row un-backed by a listed
 *     issue (G3: the read surface never lies about what GitHub currently
 *     lists).
 *   - The store's own verbatim-slug UNIQUE index (D2) guarantees at most one
 *     ingested task per `(repo_id, issueNumber)` pair; if a caller somehow
 *     passes duplicates anyway, the LAST matching entry in `ingestedTasks`
 *     wins (a `Map.set` overwrite) — never a crash, never a merged/averaged
 *     result.
 *   - `resolveOne` is a CALLBACK, never a direct import of
 *     `computeIssueResolution`: that function needs `resolvesInEdges`/
 *     `sourceDocs`/`hasRecordedReviewRejection`, all store-fetched, which a
 *     store-free joiner cannot gather itself. The caller (a store-backed
 *     adapter) gathers them and hands back a function from a matched task
 *     to its already-computed `IssueResolution`.
 *
 * Side-effect class: pure.
 *
 * Source: spec-a-github-filed-defect-must-be-claimable-one-ingest-seam, D3,
 *   D6, G3, G5, AC-GR-2, AC-GR-5.
 */

import { isInvalidated, type DocRecord, type IssueResolution, type IssueStatus } from "@lore/core";

import type { GithubListedIssue } from "./github-intake-port.js";
import { deriveIssueStatus, type CarrierFact } from "./issue-resolution.js";
import { readGithubIssueRef } from "./resolution-projector.js";

/**
 * Caller-supplied resolution lookup for ONE matched task — the adapter has
 * already gathered every store-fetched fact `computeIssueResolution`
 * (`issue-resolution.ts`) needs and wraps the result in this closure, so
 * `joinListing` itself never touches a store. See this module's header for
 * why this stays a callback rather than a direct import.
 */
export type ResolveIssueResolution = (task: DocRecord) => IssueResolution;

/**
 * One listed GitHub issue, joined against the corpus. `not_ingested` is
 * deliberately OUTSIDE the `IssueResolution` vocabulary (D6) — see this
 * module's header.
 */
export type GithubIssueRow =
  | {
      readonly kind: "ingested";
      readonly issue: GithubListedIssue;
      readonly task: DocRecord;
      readonly resolution: IssueResolution;
    }
  | {
      readonly kind: "not_ingested";
      readonly issue: GithubListedIssue;
    };

/**
 * Joins a live GitHub issue listing against the already-ingested corpus
 * tasks — pure, total, one row per listed issue.
 *
 * @param issues - the live listing (`GitHubIntakePort.listIssues`'s result),
 *   in whatever order the caller fetched it.
 * @param ingestedTasks - every corpus task that MIGHT carry a GitHub pointer
 *   (`extra.issue_report.github`) — a task with none, or with a `repo_id`
 *   that does not match `currentRepoId`, simply matches nothing (see this
 *   module's own AC-GR-5 invariant); the caller need not pre-filter.
 * @param currentRepoId - the CONFIGURED target repo's numeric id (D9: the
 *   id this call session resolved for `feedback.upstream.repo`, never a
 *   stored one) — the join key, alongside each issue's own number.
 * @param resolveOne - see {@link ResolveIssueResolution}.
 * @returns exactly `issues.length` rows, in the same order as `issues`.
 * @example
 *   joinListing(
 *     [{number: 7, title: "Bug", state: "open", body: "..."}],
 *     [],
 *     12345,
 *     () => "open",
 *   )
 *   // => [{kind: "not_ingested", issue: {number: 7, ...}}]
 */
export function joinListing(
  issues: readonly GithubListedIssue[],
  ingestedTasks: readonly DocRecord[],
  currentRepoId: number,
  resolveOne: ResolveIssueResolution,
): readonly GithubIssueRow[] {
  const taskByIssueNumber = new Map<number, DocRecord>();
  for (const task of ingestedTasks) {
    const ref = readGithubIssueRef(task.extra);
    if (ref === undefined || ref.repo_id === undefined) continue;
    if (ref.repo_id !== currentRepoId) continue;
    taskByIssueNumber.set(ref.issueNumber, task);
  }

  return issues.map((issue): GithubIssueRow => {
    const task = taskByIssueNumber.get(issue.number);
    if (task === undefined) {
      return { kind: "not_ingested", issue };
    }
    return { kind: "ingested", issue, task, resolution: resolveOne(task) };
  });
}

// ─── The single live join (carrier model) ───────────────────────────────────
//
// GitHub owns every issue fact; the corpus owns only the work that resolves an issue.
// `joinIssueStatuses` is the ONE join every read surface (`lore issues`, status check,
// dashboard, MCP, HTTP) uses: a live listing x the carriers (tasks and plans whose
// `extra.issues` names a listed issue) -> one displayed status per listed issue.
// `joinListing` above is the legacy mirror-task join, kept only until its last
// consumers (report-issue-wiring.ts, commands/issues.ts) migrate to this one.
// Source: spec-github-owns-issue-report-state-no-mirror-task-work-carries D4/D5, AC-GS-3.

/** One listed issue with its derived status and the carriers that produced it. */
export interface IssueStatusRow {
  readonly issue: GithubListedIssue;
  readonly status: IssueStatus;
  /** Slugs of every carrier naming this issue (live, archived and dead alike), sorted. */
  readonly carrierSlugs: readonly string[];
}

/**
 * Does the carrier's `extra.issues` name `(repoId, number)`? Reads `extra`
 * defensively: a malformed entry names nothing rather than throwing.
 */
export function namesIssue(doc: DocRecord, repoId: number, issueNumber: number): boolean {
  const refs = (doc.extra as Record<string, unknown> | null | undefined)?.["issues"];
  if (!Array.isArray(refs)) return false;
  return refs.some(
    (ref) =>
      typeof ref === "object" &&
      ref !== null &&
      (ref as Record<string, unknown>)["repo_id"] === repoId &&
      (ref as Record<string, unknown>)["number"] === issueNumber,
  );
}

/** What a carrier doc contributes to status derivation at the read instant `nowIso`. */
function carrierFactOf(doc: DocRecord, nowIso: string): CarrierFact {
  const type = doc.type === "plan" ? "plan" : "task";
  const claim = (doc.extra as Record<string, unknown> | null | undefined)?.["claim"];
  return {
    type,
    status: doc.status,
    invalidated: isInvalidated(doc, nowIso),
    hasOpenClaim: type === "task" && typeof claim === "object" && claim !== null,
  };
}

/**
 * Joins a complete live listing against the carrier docs: exactly one row per listed
 * issue, in listing order. The join key is `(repo_id, number)`, never a repo name.
 * A carrier naming a number absent from the listing produces no row (it is an
 * `unknown_ref` for the status check, not a listing entry).
 *
 * @param issues - the complete live listing (`GitHubIntakePort.listIssues`)
 * @param carriers - every task and plan with `extra.issues`, archived ones included
 * @param repoId - the configured repository's numeric id (the join key's first half)
 * @param nowIso - the read instant, injected so validity is deterministic
 * @example
 *   joinIssueStatuses([{number: 7, title: "t", state: "open", body: ""}], [], 1, "2026-01-01T00:00:00.000Z")
 *   // => [{issue: {number: 7, ...}, status: "open", carrierSlugs: []}]
 */
export function joinIssueStatuses(
  issues: readonly GithubListedIssue[],
  carriers: readonly DocRecord[],
  repoId: number,
  nowIso: string,
): readonly IssueStatusRow[] {
  return issues.map((issue): IssueStatusRow => {
    const naming = carriers.filter((doc) => namesIssue(doc, repoId, issue.number));
    return {
      issue,
      status: deriveIssueStatus(issue, naming.map((doc) => carrierFactOf(doc, nowIso))),
      carrierSlugs: naming.map((doc) => doc.slug).sort(),
    };
  });
}
