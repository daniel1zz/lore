/**
 * The single live join (carrier model): a complete GitHub issue listing x the carriers (tasks and plans whose
 * `extra.issues` names a listed issue) -> one displayed status per listed issue. Every read surface
 * (`lore issues`, `lore issue resolve`, the status check, the dashboard, MCP, HTTP) uses this one join.
 *
 * GitHub owns every issue fact; the corpus owns only the work that resolves an issue. This module is store-free and
 * total, exactly like `issue-resolution.ts`: no `StoreInterface`, no `GhRunner`, no IO. Every fact arrives as an
 * ARGUMENT — the listing (already fetched), the carrier docs (already store-read) and the read instant.
 *
 * Public surface:
 *   - `IssueStatusRow` — one listed issue with its derived status and the slugs of the carriers that produced it.
 *   - `joinIssueStatuses(issues, carriers, repoId, nowIso)` — the one join.
 *   - `namesIssue(doc, repoId, issueNumber)` — does a carrier's `extra.issues` name `(repoId, number)`? (shared with
 *     `issue-adoption.ts`, so the two never disagree on what "names" means.)
 *
 * Invariants:
 *   - The join key is `(repo_id, number)`, NEVER a repository name — a rename cannot orphan a carrier.
 *   - Exactly one row per element of `issues`, in the SAME order; a carrier naming a number absent from the listing
 *     produces no row (it is an `unknown_ref` for the status check, not a listing entry).
 *   - Status derivation is `issue-resolution.ts::deriveIssueStatus`; nothing here decides a status itself.
 *
 * Side-effect class: pure.
 *
 * Source: spec-github-owns-issue-report-state-no-mirror-task-work-carries D4/D5, AC-GS-3.
 */

import { isInvalidated, type DocRecord, type IssueStatus } from "@lore/core";

import type { GithubListedIssue } from "./github-intake-port.js";
import { deriveIssueStatus, type CarrierFact } from "./issue-resolution.js";

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
