/**
 * Pure predicates and payload assembly for SPEC-072 upstream issue reporting
 * (`lore report-issue`). All exports here are total, side-effect-free
 * functions over already-typed inputs (no IO, no `Date.now()`, no
 * `Math.random()`) — orchestration (config loading, upstream DB probing,
 * store IO) lives in `IssueReportService` (`packages/lore/src/service/`), a
 * later phase of this spec.
 *
 * Public surface:
 *   - `IssueReportPayload` — the 7-field shape persisted under a filed
 *     report's `extra.issue_report` (SPEC-072 §4).
 *   - `matchRootPrd` — R-5a identity-pin check: does the upstream corpus's
 *     root PRD match the consumer's configured `feedback.upstream.root_prd`?
 *   - `countOpenReports` — R-5d rate-cap check: how many still-open
 *     (status=draft) reports has this reporter project already filed
 *     upstream?
 *   - `buildIssueReportExtra` — assembles the `extra` payload for the
 *     upstream ad-hoc draft task `createDraft` writes.
 *   - `OPEN_REPORT_CAP` — the R-5d rate-cap ceiling (10).
 *
 * Invariants:
 *   - `extra.issue_report` is deliberately NOT a Zod-validated field on the
 *     shared `taskExtraSchema` (SPEC-072 §11 Downstream Handoff, "P5
 *     admission rule": no typed-schema field until a pure function reads
 *     it) — it stays untyped `extra` passthrough. `countOpenReports` reads
 *     it defensively (mirrors `task-workflow.ts::safeTaskExtra`'s guard
 *     shape) rather than via a schema parse, so a malformed/legacy `extra`
 *     value degrades to "not a match" instead of throwing.
 *   - `countOpenReports`'s task-shape parameter carries `id` in ADDITION to
 *     the `{status, extra}` pair named in the spec's §4 Public Interface
 *     listing — that literal signature is structurally incapable of
 *     producing a meaningful `ids: string[]` result (nothing in `{status,
 *     extra}` alone identifies which upstream doc a match came from), and
 *     R-5d's own failure message ("lists the 10 open ids") needs those doc
 *     ids. Confirmed via the spec's raw markdown (no truncation) before
 *     concluding this is a spec omission, not a misread — documented here so
 *     the next reader doesn't "fix" the extra field back out.
 *
 * Side-effect class: pure.
 *
 * Source: SPEC-072 §4 Public Interface, §5 check sequence (steps 5, 6).
 */

/**
 * The 7 fields persisted verbatim under a filed report's `extra.issue_report`
 * (SPEC-072 AC-072-1: "all 7 extra.issue_report fields populated").
 */
export interface IssueReportPayload {
  reporter_project: string;
  reporter_actor: string;
  lore_version: string;
  repro_command?: string;
  expected: string;
  actual: string;
  reported_at: string;
  possible_duplicates: string[];
}

/**
 * R-5a identity-pin check: does the upstream corpus's actual root PRD match
 * the consumer's configured `feedback.upstream.root_prd`? `expected` may name
 * either the root PRD's `slug` OR its `id` (SPEC-072 §Downstream Handoff:
 * "expected root-PRD slug or id") — either one matching is sufficient.
 *
 * @param root - the upstream corpus's resolved root PRD `{id, slug}`, or
 *   `null` when the upstream corpus has no root doc at all (empty/malformed
 *   corpus — treated as a mismatch, never a crash)
 * @param expected - `feedback.upstream.root_prd` from the consumer's config
 * @returns `{ok: true}` on match; `{ok: false, found}` on mismatch, where
 *   `found` is the upstream root's slug (human-readable identity for the
 *   error message) or `null` when there was no upstream root at all
 * @example
 *   matchRootPrd({id: "01ABC", slug: "prd-lore"}, "prd-lore") // => {ok: true}
 *   matchRootPrd({id: "01ABC", slug: "prd-lore"}, "01ABC")    // => {ok: true}
 *   matchRootPrd({id: "01ABC", slug: "prd-lore"}, "prd-other")
 *     // => {ok: false, found: "prd-lore"}
 *   matchRootPrd(null, "prd-lore") // => {ok: false, found: null}
 */
export function matchRootPrd(
  root: { id: string; slug: string } | null,
  expected: string,
): { ok: true } | { ok: false; found: string | null } {
  if (root === null) {
    return { ok: false, found: null };
  }
  if (root.id === expected || root.slug === expected) {
    return { ok: true };
  }
  return { ok: false, found: root.slug };
}

/**
 * Defensive `extra.issue_report.reporter_project` reader — mirrors
 * `task-workflow.ts::safeTaskExtra`'s guard shape (duplicated rather than
 * imported to avoid a reverse dependency from this module into
 * `task-workflow.ts`). A malformed/legacy `extra` (null, array, wrong nested
 * shape) reads as "no reporter_project" rather than throwing.
 *
 * @param extra - a task's raw `extra` field (untyped storage)
 * @returns the nested `issue_report.reporter_project` string, or `undefined`
 *   when absent or the shape doesn't match
 */
function readReporterProject(extra: unknown): string | undefined {
  if (extra === null || typeof extra !== "object" || Array.isArray(extra)) {
    return undefined;
  }
  const issueReport = (extra as Record<string, unknown>)["issue_report"];
  if (issueReport === null || typeof issueReport !== "object" || Array.isArray(issueReport)) {
    return undefined;
  }
  const reporterProject = (issueReport as Record<string, unknown>)["reporter_project"];
  return typeof reporterProject === "string" ? reporterProject : undefined;
}

/**
 * R-5d rate-cap check: how many still-open (status=`draft`) upstream ad-hoc
 * reports has `reporterProject` already filed? A report stops being "open"
 * the moment it leaves `draft` (approved/rejected/archived by the upstream
 * reviewer) — this function counts ONLY current drafts, never the reporter's
 * full filing history.
 *
 * @param tasks - candidate upstream tasks, each carrying at least its own
 *   `id`, lifecycle `status`, and untyped `extra` (see module invariant above
 *   re: the `id` field)
 * @param reporterProject - the filing reporter's project identity (must
 *   match `extra.issue_report.reporter_project` exactly)
 * @returns `{open, ids}` — the count and the doc ids of every matching task,
 *   in input order (never re-sorted, never deduplicated — the store layer
 *   guarantees distinct ids per row)
 * @example
 *   countOpenReports(
 *     [{id: "t1", status: "draft", extra: {issue_report: {reporter_project: "consumer-a"}}}],
 *     "consumer-a",
 *   ) // => {open: 1, ids: ["t1"]}
 */
export function countOpenReports(
  tasks: ReadonlyArray<{ id: string; status: string; extra?: unknown }>,
  reporterProject: string,
): { open: number; ids: string[] } {
  const ids: string[] = [];
  for (const task of tasks) {
    if (task.status !== "draft") continue;
    if (readReporterProject(task.extra) !== reporterProject) continue;
    ids.push(task.id);
  }
  return { open: ids.length, ids };
}

/**
 * Assembles the `extra` payload for the upstream ad-hoc draft task
 * `UpstreamPort.createDraft` writes. Pure structural wrap — every field of
 * `p` is carried verbatim; no defaulting, no derived fields.
 *
 * @param p - the fully-assembled report payload
 * @returns `{adhoc: true, issue_report: {...p}}` — `adhoc: true` marks the
 *   task as SPEC-069's ad-hoc dispatch shape (excluded from `lore ready
 *   --adhoc` output until approved, per AC-072-1)
 * @example
 *   buildIssueReportExtra({
 *     reporter_project: "consumer-a", reporter_actor: "agent:x",
 *     lore_version: "0.5.0", expected: "exit 0", actual: "exit 4",
 *     reported_at: "2026-07-24T00:00:00.000Z", possible_duplicates: [],
 *   })
 *   // => {adhoc: true, issue_report: {reporter_project: "consumer-a", ...}}
 */
export function buildIssueReportExtra(p: IssueReportPayload): Record<string, unknown> {
  return {
    adhoc: true,
    issue_report: { ...p },
  };
}

/**
 * R-5d rate-cap ceiling — the maximum number of simultaneously-open
 * (status=`draft`) reports a single reporter project may have filed upstream
 * before `lore report-issue` refuses to file another (SPEC-072 §5 step 6,
 * AC-072-6).
 */
export const OPEN_REPORT_CAP = 10;
