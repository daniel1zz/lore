/**
 * GET /api/issue-reports — SPEC-074 dashboard Issues triage read projection.
 * Surfaces every still-open (status draft|in-review) incoming issue report
 * (a `task` doc carrying `extra.issue_report`, written by the upstream
 * `lore report-issue` consumer flow — SPEC-072) as a slim row the dashboard's
 * Issues page/nav badge/home card render directly, plus the corpus-wide open
 * count the badge polls.
 *
 * Public surface: handleGetIssueReports, IssueReportRow.
 *
 * Invariants:
 *   - Read-only — this route never writes. Approve/reject stay on the
 *     pre-existing SPEC-022 cookie-gated `/api/dashboard/*` adjudication
 *     routes (out of this spec's scope, see SPEC-074 §Scope "Out").
 *   - Built over `CorpusService.listFull({type: "task"})` (an EXISTING narrow
 *     read method — `list()` alone strips `extra`, which this projection
 *     needs to see `issue_report`), with the draft/in-review status filter
 *     and `issue_report`-presence filter applied HERE, adapter-side —
 *     `ListFilters` has no "status is one of a set" nor "extra key present"
 *     predicate, so this is deliberately not pushed into CorpusService (see
 *     SPEC-074 §Design: "if the list surface can't express it, a narrow
 *     read-only helper is acceptable [over CorpusService], never a write").
 *   - Auth: cookie OR bearer, same duality as every other v1 GET route
 *     (dispatched from `routes.ts`'s general `/api/*` table, not the
 *     cookie-only `/api/dashboard/*` namespace — SPEC-062 GET precedent).
 *   - `extra.issue_report` is deliberately untyped passthrough (SPEC-072 §11
 *     "no typed-schema field until a pure function reads it") — every nested
 *     field is read DEFENSIVELY (malformed/legacy shape degrades a field to
 *     `""`/`[]`, never a thrown error), mirroring
 *     `packages/core/src/issue-report.ts::readReporterProject`'s guard shape.
 *   - `open_count` is always exactly `rows.length` — the same "one endpoint,
 *     no second count route" the spec's §Design calls for (the nav badge and
 *     the Issues page both poll this single projection).
 *   - Zero matching tasks → `{rows: [], open_count: 0}` with HTTP 200, never
 *     an error (AC-074-5) — an empty result is a fact, not a failure.
 *
 * Side-effect class: pure read (delegates to `CorpusService.listFull`, itself
 *   a read-only store query; this module performs no writes and no IO of its
 *   own).
 *
 * Source: SPEC-074 §Scope, §Design; AC-074-5.
 */

import type { App } from "../../app.js";
import { jsonOk, loreErrorResponse } from "./middleware.js";
import type { DocRecord } from "@lore/core";

/**
 * One row of the `GET /api/issue-reports` projection — exactly the 9 fields
 * SPEC-074 §Design declares (the 8 report-identity fields plus lifecycle
 * `status`), nothing else. Never carries the full `extra.issue_report`
 * payload (e.g. `expected`/`actual`/`repro_command` are NOT projected here —
 * the dashboard's detail view reads those via the existing `GET
 * /api/docs/:id` route, per SPEC-074 §Design "detail view rendering the full
 * extra.issue_report payload").
 */
export interface IssueReportRow {
  id: string;
  slug: string;
  title: string;
  reporter_project: string;
  reporter_actor: string;
  lore_version: string;
  reported_at: string;
  possible_duplicates: string[];
  status: string;
}

/**
 * Defensively project a task `DocRecord` into an {@link IssueReportRow},
 * reading its `extra.issue_report` nested payload. Mirrors
 * `packages/core/src/issue-report.ts::readReporterProject`'s guard shape
 * (duplicated rather than imported — that module's reader is scoped to a
 * single field for a single caller; this one needs the whole payload shape
 * and lives in a different package layer).
 *
 * @param doc - a `task`-typed `DocRecord` already known to carry a non-null
 *   `extra.issue_report` object (callers check presence before calling this;
 *   see {@link isIssueReportTask})
 * @returns the projected row; every nested field that is missing or the
 *   wrong type degrades to `""` (or `[]` for `possible_duplicates`) rather
 *   than throwing — malformed upstream data must never crash this route
 */
function projectIssueReportRow(doc: DocRecord): IssueReportRow {
  const issueReport = (doc.extra as Record<string, unknown>)["issue_report"] as Record<string, unknown>;

  const readString = (key: string): string => {
    const value = issueReport[key];
    return typeof value === "string" ? value : "";
  };

  const possibleDuplicates = issueReport["possible_duplicates"];
  const duplicates = Array.isArray(possibleDuplicates)
    ? possibleDuplicates.filter((entry): entry is string => typeof entry === "string")
    : [];

  return {
    id: doc.id,
    slug: doc.slug,
    title: doc.title,
    reporter_project: readString("reporter_project"),
    reporter_actor: readString("reporter_actor"),
    lore_version: readString("lore_version"),
    reported_at: readString("reported_at"),
    possible_duplicates: duplicates,
    status: doc.status,
  };
}

/**
 * Whether a task `DocRecord` is a still-open incoming issue report: status
 * ∈ {draft, in-review} AND `extra.issue_report` is present (a non-null,
 * non-array object — the same defensive shape check
 * `readReporterProject`/`countOpenReports` in `@lore/core` use for this same
 * nested field). Approved (or later-lifecycle) reports are EXCLUDED — once a
 * reviewer approves or rejects a report it leaves this open set entirely
 * (SPEC-074 AC-074-5's "approved reports excluded from open set").
 *
 * @param doc - candidate `DocRecord` (any type; non-`task` docs never match)
 */
function isOpenIssueReportTask(doc: DocRecord): boolean {
  if (doc.type !== "task") return false;
  if (doc.status !== "draft" && doc.status !== "in-review") return false;

  const extra = doc.extra;
  if (extra === null || extra === undefined || typeof extra !== "object" || Array.isArray(extra)) return false;

  const issueReport = (extra as Record<string, unknown>)["issue_report"];
  return issueReport !== null && typeof issueReport === "object" && !Array.isArray(issueReport);
}

/**
 * GET /api/issue-reports — the dashboard Issues triage projection.
 * Available to both cookie and bearer sessions (see module header).
 *
 * @param app - Wired application instance.
 * @returns 200 `{rows: IssueReportRow[], open_count: number}`, rows sorted
 *   `reported_at` descending (newest first — malformed/missing `reported_at`
 *   values sort last, never crash the sort); `open_count` is always
 *   `rows.length`. A `CorpusService` store failure surfaces via the standard
 *   `loreErrorResponse` mapping (never this route's own error shape).
 */
export async function handleGetIssueReports(app: App): Promise<Response> {
  const result = await app.corpusService.listFull({ type: "task" });
  if (!result.ok) return loreErrorResponse(result.error);

  const rows = result.value.docs
    .filter(isOpenIssueReportTask)
    .map(projectIssueReportRow)
    .sort((a, b) => (a.reported_at < b.reported_at ? 1 : a.reported_at > b.reported_at ? -1 : 0));

  return jsonOk({ rows, open_count: rows.length });
}
