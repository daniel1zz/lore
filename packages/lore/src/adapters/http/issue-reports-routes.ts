/**
 * GET /api/issue-reports — the dashboard Issues read: ONE row per issue GitHub currently lists,
 * each with its DERIVED status and the corpus work (carriers) that names it.
 *
 * GitHub owns every issue fact; the corpus owns only the work that resolves an issue
 * (spec-github-owns-issue-report-state-no-mirror-task-work-carries D4/D5, AC-GS-14). So this route
 * reads exactly two things: the live GitHub listing (through the intake port) and the carriers
 * (tasks and plans whose `extra.issues` names an issue). It never reads a mirror task, a review
 * audit trail or a `resolves` edge, and it stores no status: `joinIssueStatuses` derives it per request.
 *
 * Public surface: handleGetIssueReports, IssueListingPort, IssueListingRow, IssueReportsBody.
 *
 * Invariants:
 *   - Read-only: this route never writes.
 *   - Source of rows is the LISTING. A carrier naming an issue the listing does not contain produces
 *     no row, and a legacy draft task carrying `extra.issue_report` is not a carrier, so an empty
 *     listing yields zero rows whatever the corpus holds.
 *   - A port failure is never swallowed into an empty list: the `LoreError` maps through
 *     `loreErrorResponse` (AUTH_REQUIRED 401, TRANSPORT_UNAVAILABLE 503, RATE_LIMITED 429 with its
 *     `reset`), and the error body has no `rows` key, so a client cannot mistake it for "no issues".
 *   - `open_count` counts rows whose derived status is `open` (the nav badge reads it).
 *
 * Side-effect class: IO (one `gh` listing through the port, two read-only corpus queries).
 *
 * Source: spec-github-owns-issue-report-state-no-mirror-task-work-carries T9, AC-GS-14.
 */

import type { App } from "../../app.js";
import { jsonOk, loreErrorResponse } from "./middleware.js";
import { err, ok, type DocRecord, type IssueStatus, type LoreError, type Result } from "@lore/core";
import type { GitHubIntakePort } from "../../service/github-intake-port.js";
import { joinIssueStatuses } from "../../service/github-issue-listing.js";

/** The two port reads this route needs; `GitHubIntakePort` satisfies it, a test stub can too. */
export type IssueListingPort = Pick<GitHubIntakePort, "verifyTarget" | "listIssues">;

/** One listed GitHub issue with its derived status and the carriers naming it. */
export interface IssueListingRow {
  number: number;
  title: string;
  /** GitHub's own `open` / `closed`. */
  state: string;
  status: IssueStatus;
  /** Slug of the first carrier (sorted), or `null` when no work names the issue. */
  carrier: string | null;
  /** Every carrier slug, sorted. */
  carriers: string[];
}

/** Success body of `GET /api/issue-reports`. */
export interface IssueReportsBody {
  rows: IssueListingRow[];
  open_count: number;
}

/**
 * Reads every carrier: a task or plan, archived ones included, whose `extra.issues` is present.
 * `joinIssueStatuses` does the exact `(repo_id, number)` matching; this only narrows the corpus.
 */
async function readCarriers(app: App): Promise<Result<DocRecord[], LoreError>> {
  const carriers: DocRecord[] = [];
  for (const type of ["task", "plan"] as const) {
    const listed = await app.corpusService.listFull({ type });
    if (!listed.ok) return err(listed.error);
    for (const doc of listed.value.docs) {
      const extra = doc.extra as Record<string, unknown> | null | undefined;
      if (extra !== null && extra !== undefined && Array.isArray(extra["issues"])) carriers.push(doc);
    }
  }
  return ok(carriers);
}

/**
 * GET /api/issue-reports — the live join. Available to both cookie and bearer sessions.
 *
 * @param app - wired application (corpus reads and the default intake port)
 * @param port - the intake port to list through; defaults to `app.issueIntake`. Injected in tests.
 * @returns 200 {@link IssueReportsBody} in listing order; a `LoreError` response when the port or
 *   the corpus read fails (no `rows` key), or 422 when no GitHub intake is configured.
 */
export async function handleGetIssueReports(app: App, port?: IssueListingPort): Promise<Response> {
  let listingPort = port;
  if (listingPort === undefined) {
    const wired = app.issueIntake;
    if (wired === undefined) {
      return loreErrorResponse({
        code: "VALIDATION_ERROR",
        field: "feedback.upstream",
        message: "no GitHub issue intake is wired for this corpus; set feedback.upstream.repo in .lore/config.yaml",
        value: undefined,
      });
    }
    if (!wired.ok) return loreErrorResponse(wired.error);
    listingPort = wired.value;
  }

  const verified = await listingPort.verifyTarget();
  if (!verified.ok) return loreErrorResponse(verified.error);
  const listing = await listingPort.listIssues();
  if (!listing.ok) return loreErrorResponse(listing.error);

  const carriers = await readCarriers(app);
  if (!carriers.ok) return loreErrorResponse(carriers.error);

  const joined = joinIssueStatuses(listing.value.issues, carriers.value, verified.value.id, new Date().toISOString());
  const rows = joined.map(
    (row): IssueListingRow => ({
      number: row.issue.number,
      title: row.issue.title,
      state: row.issue.state,
      status: row.status,
      carrier: row.carrierSlugs[0] ?? null,
      carriers: [...row.carrierSlugs],
    }),
  );
  const body: IssueReportsBody = { rows, open_count: rows.filter((row) => row.status === "open").length };
  return jsonOk(body);
}
