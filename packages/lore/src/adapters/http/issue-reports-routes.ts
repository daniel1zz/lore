/**
 * GET /api/issue-reports — SPEC-074 dashboard Issues triage read projection.
 * Surfaces every still-open incoming issue report (a `task` doc carrying
 * `extra.issue_report`, written by the upstream `lore report-issue` consumer
 * flow — SPEC-072) as a slim row the dashboard's Issues page/nav badge/home
 * card render directly, plus the corpus-wide open count the badge polls.
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
 *   - "Open" is NOT status alone. `ReviewService.reject`
 *     (`service/review-service.ts`) never transitions a doc OFF
 *     `draft`/`in-review` (SPEC-005 §3/§4 — rejection returns a doc TO
 *     `draft`, there is no distinct "rejected" `DocStatus`) — so a rejected
 *     report's `status` is indistinguishable from a never-yet-reviewed one.
 *     The audit trail is the ONLY record of "this draft was actually
 *     rejected". This mirrors the EXACT decision shape
 *     `flows/upstream-context-flow.ts::UpstreamPort.getDocStatus` already
 *     uses for the SAME invariant (latest `"reject"` audit entry wins unless
 *     superseded by a later `"approve"`), generalized here from a single-doc
 *     `queryAudit({doc_id, action: "reject", limit: 1})` lookup to two
 *     BATCHED whole-corpus queries (`action: "reject"` / `action: "approve"`,
 *     via `app.auditService.query`) — one round trip per action covering
 *     every candidate at once, since `AuditFilters` has no "doc_id IN (...)"
 *     predicate to scope a single query to just the candidate set. See
 *     `hasOpenIssueReportShape` (sync status+shape gate) and
 *     `wasRejectedWithoutLaterApproval` (the audit-derived exclusion) below.
 *   - Auth: cookie OR bearer, same duality as every other v1 GET route
 *     (dispatched from `routes.ts`'s general `/api/*` table, not the
 *     cookie-only `/api/dashboard/*` namespace — SPEC-062 GET precedent).
 *   - `extra.issue_report` is deliberately untyped passthrough (SPEC-072 §11
 *     "no typed-schema field until a pure function reads it") — every nested
 *     field is read DEFENSIVELY (malformed/legacy shape degrades a field to
 *     `""`/`[]`, never a thrown error), mirroring
 *     the same null/array/typeof guard shape every defensive
 *     `extra.issue_report` reader in this codebase uses.
 *   - `open_count` is the count of rows whose COMPUTED `resolution` is
 *     `"open"` (D8, spec-issue-closure-loop-computed-resolution-agent-reachable
 *     — "the nav badge counts computed-open reports rather than draft
 *     docs"). Pre-D8 this was always exactly `rows.length`; post-D8 `rows`
 *     still holds every still-governed report (unchanged SPEC-074 filter —
 *     see {@link IssueReportRow}'s doc comment for why a `"fixed"`/
 *     `"resolving"` row deliberately stays IN `rows`) while `open_count` can
 *     now be STRICTLY LESS than `rows.length` — that gap is the visible
 *     signal for an unclosed escalation (D5(a)), not a bug. The nav badge and
 *     the Issues page still both poll this SAME single projection (one
 *     endpoint, no second count route).
 *   - Zero matching tasks → `{rows: [], open_count: 0}` with HTTP 200, never
 *     an error (AC-074-5) — an empty result is a fact, not a failure.
 *
 * Side-effect class: pure read (delegates to `CorpusService.listFull`,
 *   `CorpusService.getResolvesInEdgesForIssues`, and `AuditService.query`,
 *   all read-only store queries; this module performs no writes and no IO of
 *   its own).
 *
 * Source: SPEC-074 §Scope, §Design (AC-074-3, AC-074-5);
 *   spec-issue-closure-loop-computed-resolution-agent-reachable §D7 (AC-ICL-9).
 */

import type { App } from "../../app.js";
import { jsonOk, loreErrorResponse } from "./middleware.js";
import type { AuditEntry, DocRecord } from "@lore/core";
import { computeIssueResolution, type IssueResolution } from "../../service/issue-resolution.js";

/**
 * One row of the `GET /api/issue-reports` projection — the 9 fields SPEC-074
 * §Design declares (the 8 report-identity fields plus lifecycle `status`)
 * PLUS `resolution` (D7, spec-issue-closure-loop-computed-resolution-agent-reachable).
 * Never carries the full `extra.issue_report` payload (e.g.
 * `expected`/`actual`/`repro_command` are NOT projected here — the
 * dashboard's detail view reads those via the existing `GET /api/docs/:id`
 * route, per SPEC-074 §Design "detail view rendering the full
 * extra.issue_report payload").
 *
 * ⛔ WIRE-CONTRACT UNION, IMPORTED not mirrored (verify every clause below by
 * grep before trusting this prose — that is the failure mode this comment
 * previously fell into): `resolution` is typed by
 * `service/issue-resolution.ts`'s `IssueResolution`, which
 * spec-the-defect-channel-cannot-be-honestly-maintained-an §M3 extended with
 * `superseded` and `duplicate`. `packages/dashboard/src/lib/api.ts` imports
 * that SAME vocabulary from `@lore/core` — `IssueResolution` as a type and
 * `ISSUE_RESOLUTION_MEMBERS` as a value (AC-DC-12) — and re-exports both
 * rather than hand-copying the union; its own module header states the
 * re-export is "reference-identical — this module constructs no list". The
 * two presentation-only badge switches
 * (`components/IssuesList.tsx::resolutionBadgeVariant`,
 * `components/IssueDetail.tsx::resolutionBadgeVariant`) both import
 * `IssueResolution` from `api.ts` and are `never`-checked over it, so a member
 * added upstream to `IssueResolution` fails `bun run typecheck` INSIDE those
 * two files rather than falling through to an implicit `undefined` badge
 * variant. The oracle pinning this shape end-to-end is
 * `packages/dashboard/tests/unit/issue-resolution-union-parity.test.ts` — it
 * asserts the re-export by `toBe` identity (not set comparison, which a hand
 * copy with today's contents would also satisfy) AND overlays a widened
 * `@lore/core` onto the real dashboard source to require both switches to
 * fail to compile. If `grep` disagrees with a sentence above, the sentence is
 * wrong, not the file.
 *
 * `status` stays the RAW doc lifecycle status (draft/in-review/...) —
 * unchanged meaning, kept for the same reasons SPEC-074 always projected it
 * (e.g. the in-review badge). `resolution` is the NEW, orthogonal, COMPUTED
 * field (D2: open/resolving/fixed/rejected/wontfix/superseded/duplicate) — the two are
 * INTENTIONALLY independent: a report can sit at `status: "draft"` (never
 * manually archived, D5(a)/spec's "no auto-advancing the issue task's own
 * status" non-goal) while its `resolution` is already `"fixed"` (a
 * `resolves` edge landed on an `active`/`archived` fixing doc) — this is
 * EXACTLY the "unclosed escalation" shape spec's Overview describes as the
 * failure mode D7/D8 exist to make visible on the dashboard, not to hide by
 * excluding the row.
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
  resolution: IssueResolution;
}

/**
 * Defensively project a task `DocRecord` into an {@link IssueReportRow},
 * reading its `extra.issue_report` nested payload. Mirrors
 * the same null/array/typeof guard shape every defensive `extra.issue_report`
 * reader in this codebase uses (duplicated rather than imported — every such
 * reader is scoped to a
 * single field for a single caller; this one needs the whole payload shape
 * and lives in a different package layer).
 *
 * @param doc - a `task`-typed `DocRecord` already known to carry a non-null
 *   `extra.issue_report` object (callers check presence before calling this;
 *   see {@link hasOpenIssueReportShape})
 * @param resolution - this doc's D2 computed resolution, already derived by
 *   the caller via `computeIssueResolution` (this function does no
 *   computation of its own — it is a pure structural projection, same as
 *   every other field here)
 * @returns the projected row; every nested field that is missing or the
 *   wrong type degrades to `""` (or `[]` for `possible_duplicates`) rather
 *   than throwing — malformed upstream data must never crash this route
 */
function projectIssueReportRow(doc: DocRecord, resolution: IssueResolution): IssueReportRow {
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
    resolution,
  };
}

/**
 * Whether a task `DocRecord` HAS THE SHAPE of a still-open incoming issue
 * report: status ∈ {draft, in-review} AND `extra.issue_report` is present (a
 * non-null, non-array object — the same defensive shape check every
 * `extra.issue_report` reader in this codebase uses for this same
 * nested field). Approved (or later-lifecycle) reports are EXCLUDED by this
 * check — once a reviewer approves a report its `status` itself leaves
 * `draft`/`in-review` (SPEC-074 AC-074-5's "approved reports excluded from
 * open set").
 *
 * This is a NECESSARY but not SUFFICIENT condition for "open" — a doc can
 * pass this shape check and still have been rejected (status stays `draft`
 * on reject, see module header). Callers MUST additionally apply
 * {@link wasRejectedWithoutLaterApproval} before treating a match as truly
 * open (see `handleGetIssueReports`).
 *
 * @param doc - candidate `DocRecord` (any type; non-`task` docs never match)
 */
function hasOpenIssueReportShape(doc: DocRecord): boolean {
  if (doc.type !== "task") return false;
  if (doc.status !== "draft" && doc.status !== "in-review") return false;

  const extra = doc.extra;
  if (extra === null || extra === undefined || typeof extra !== "object" || Array.isArray(extra)) return false;

  const issueReport = (extra as Record<string, unknown>)["issue_report"];
  return issueReport !== null && typeof issueReport === "object" && !Array.isArray(issueReport);
}

/**
 * Builds a `doc_id -> latest timestamp` map for a single-action `queryAudit`
 * result. `queryAudit`'s documented contract orders rows `timestamp DESC`
 * (newest first — see `StoreInterface.queryAudit`), so the FIRST row seen per
 * `doc_id` while iterating is that doc's most recent entry for the action;
 * this is the same "index 0 wins" reasoning
 * `flows/upstream-context-flow.ts::getDocStatus` uses for its own
 * `limit: 1`-scoped single-doc read, generalized here to one UNSCOPED
 * (`doc_id` omitted) query covering every doc's most recent entry for that
 * action in a single round trip.
 *
 * @param entries - a `queryAudit({action: "..."})` result (single action,
 *   every doc, newest-first)
 * @returns doc_id -> that doc's most recent `timestamp` for this action;
 *   entries with no `doc_id` (non-doc audit rows) are skipped
 */
function latestAuditTimestampByDoc(entries: readonly AuditEntry[]): Map<string, string> {
  const latest = new Map<string, string>();
  for (const entry of entries) {
    if (entry.doc_id === undefined) continue;
    if (!latest.has(entry.doc_id)) latest.set(entry.doc_id, entry.timestamp);
  }
  return latest;
}

/**
 * Whether a doc's most recent `"reject"` audit entry is NEWER than its most
 * recent `"approve"` entry — i.e. the doc was rejected and has NOT since been
 * re-approved. Mirrors the decision shape
 * `flows/upstream-context-flow.ts::UpstreamPort.getDocStatus` uses (a later
 * approve supersedes an earlier reject; a doc never rejected at all is never
 * excluded), generalized from that function's single-doc lookup to the
 * batched maps {@link latestAuditTimestampByDoc} builds across every
 * candidate at once.
 *
 * @param docId - candidate doc id
 * @param rejectedAt - doc_id -> latest `"reject"` audit timestamp (see {@link latestAuditTimestampByDoc})
 * @param approvedAt - doc_id -> latest `"approve"` audit timestamp
 * @returns true when this doc has a reject entry with no later approve entry
 *   (i.e. it must be excluded from the open set)
 */
function wasRejectedWithoutLaterApproval(
  docId: string,
  rejectedAt: ReadonlyMap<string, string>,
  approvedAt: ReadonlyMap<string, string>,
): boolean {
  const rejectedTimestamp = rejectedAt.get(docId);
  if (rejectedTimestamp === undefined) return false;
  const approvedTimestamp = approvedAt.get(docId);
  return approvedTimestamp === undefined || rejectedTimestamp > approvedTimestamp;
}

/**
 * GET /api/issue-reports — the dashboard Issues triage projection.
 * Available to both cookie and bearer sessions (see module header).
 *
 * @param app - Wired application instance.
 * @returns 200 `{rows: IssueReportRow[], open_count: number}`, rows sorted
 *   `reported_at` descending (newest first — malformed/missing `reported_at`
 *   values sort last, never crash the sort); `open_count` counts rows whose
 *   computed `resolution` is `"open"` (D7/D8 — see {@link IssueReportRow}'s
 *   doc comment; can be strictly less than `rows.length`). A store failure
 *   (`CorpusService.listFull`, either `AuditService.query` call, or
 *   `CorpusService.getResolvesInEdgesForIssues`) surfaces via the standard
 *   `loreErrorResponse` mapping (never this route's own error shape).
 */
export async function handleGetIssueReports(app: App): Promise<Response> {
  const result = await app.corpusService.listFull({ type: "task" });
  if (!result.ok) return loreErrorResponse(result.error);

  const candidates = result.value.docs.filter(hasOpenIssueReportShape);

  // reason: two BATCHED whole-corpus audit queries (one per action) rather
  // than one queryAudit per candidate doc — AuditFilters has no "doc_id IN
  // (...)" predicate, so this is the narrowest single-round-trip-per-action
  // shape the store surface supports. See module header + these two
  // functions' own JSDoc.
  const [rejectResult, approveResult] = await Promise.all([
    app.auditService.query({ action: "reject" }),
    app.auditService.query({ action: "approve" }),
  ]);
  if (!rejectResult.ok) return loreErrorResponse(rejectResult.error);
  if (!approveResult.ok) return loreErrorResponse(approveResult.error);

  const rejectedAt = latestAuditTimestampByDoc(rejectResult.value);
  const approvedAt = latestAuditTimestampByDoc(approveResult.value);

  const governedDocs = candidates.filter(
    (doc) => !wasRejectedWithoutLaterApproval(doc.id, rejectedAt, approvedAt),
  );

  // D7 — one BATCHED lookup (two round trips total, see the method's own
  // JSDoc) of every resolves in-edge + source-doc status across the WHOLE
  // governed set, never one query per row.
  const resolvesContextResult = await app.corpusService.getResolvesInEdgesForIssues(
    governedDocs.map((doc) => doc.id),
  );
  if (!resolvesContextResult.ok) return loreErrorResponse(resolvesContextResult.error);
  const resolvesContextById = resolvesContextResult.value;

  const rows = governedDocs
    .map((doc) => {
      const resolvesContext = resolvesContextById.get(doc.id) ?? { resolvesInEdges: [], sourceDocs: [] };
      const resolution = computeIssueResolution(doc, resolvesContext.resolvesInEdges, resolvesContext.sourceDocs);
      return projectIssueReportRow(doc, resolution);
    })
    .sort((a, b) => (a.reported_at < b.reported_at ? 1 : a.reported_at > b.reported_at ? -1 : 0));

  const openCount = rows.filter((row) => row.resolution === "open").length;

  return jsonOk({ rows, open_count: openCount });
}
