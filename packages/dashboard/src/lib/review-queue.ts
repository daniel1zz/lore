/**
 * review-queue — client-side merge of `draft` + `in-review` documents into one
 * consistently-ordered dashboard review queue.
 * Purpose: `GET /api/review/pending` (`ReviewService.pending`, server-side) is
 *   DRAFT-ONLY by design — CLI `lore pending` semantics are documented as
 *   "draft docs pending review" and stay unchanged (ADR
 *   adr-dashboard-review-queues-include-in-review-docs-ahead-of). An
 *   `in-review` doc is the ONE status that renders an AdjudicationBar (it is
 *   literally awaiting approve/reject) yet, before this module, was reachable
 *   from NO dashboard queue — its only discovery path was a manual Library
 *   status filter (dogfood 2026-07-26 ISSUE-008). Both `PendingPanel` (home)
 *   and `TriageQueue` (`/pending`) source their rows from
 *   {@link fetchReviewQueueRows} instead of talking to `apiGetPendingReview`
 *   directly, so the merge logic lives in exactly one place — a dashboard-only
 *   read-layer change per the ADR, not a change to `ReviewService`/the HTTP
 *   route (CLI `lore pending` is untouched).
 * Public surface: ReviewQueueDocRow, fetchReviewQueueRows
 * Invariants:
 *   - `in-review` rows sort AHEAD of `draft` rows (ADR decision) — the merge
 *     concatenates the in-review batch before the draft batch; WITHIN each
 *     batch the server's own order is preserved (no independent re-sort),
 *     the same no-re-sort discipline `PendingPanel`'s original JSDoc already
 *     documented for the draft-only queue.
 *   - `apiGetPendingReview` already returns `version`/`created_by` per row
 *     (it projects the server's `PendingDoc` shape 1:1). `apiList` narrowed
 *     by `status: "in-review"` returns `DocSummary` rows, which structurally
 *     OMIT `version`/`created_by`/`meta`'s claim-staleness dimension
 *     (`CorpusService.toSummary` never populates `version`/`created_by` —
 *     see `@lore/core`'s `DocSummary` doc comment). Rather than fabricate a
 *     placeholder version — a fabricated LOWER version would falsely mark a
 *     fresh judgment "stale" in `JudgmentBadge`, a fabricated equal/higher
 *     one would falsely hide a real staleness — each in-review `DocSummary`
 *     is followed up with one `apiGetDoc` call for its real `DocRecord`, and
 *     `meta` is (re)derived from that full record via `@lore/core`'s
 *     `deriveTypeMeta` — the SAME "compute client-side, no claimTtlMinutes
 *     available" degrade `DocDetail.tsx` already documents (omits
 *     `claim_stale` rather than fabricating `false`). This mirrors the
 *     pre-existing per-row `apiGetJudgments` `Promise.all` fan-out both
 *     callers already perform — one bounded N+1, not a second one — and is
 *     cheap in practice: `in-review` is a transient adjudication-pending
 *     state, never the corpus's resting bulk.
 *   - `PendingReviewOpts.author` has no `apiList`/`ListOpts` equivalent
 *     (`ListOpts` filters on `type`/`status`/`parent_id`/`since`/`tags`,
 *     never `created_by`) — an author filter narrows the draft branch only.
 *     Neither current caller passes `author` (both call with no opts), so
 *     this is a documented, currently-inert gap rather than a live behavior
 *     change.
 * Side-effect class: IO (fetch via apiGetPendingReview / apiList / apiGetDoc)
 * Source: ADR adr-dashboard-review-queues-include-in-review-docs-ahead-of
 *   (dogfood 2026-07-26 ISSUE-008)
 */

import { deriveTypeMeta } from "@lore/core";
import { apiGetDoc, apiGetPendingReview, apiList } from "@/lib/api";
import type { PendingDocRow, PendingReviewOpts } from "@/lib/api";

/**
 * A row in the merged draft + in-review dashboard review queue. Structurally
 * identical to {@link PendingDocRow} except `status` is widened to include
 * `"in-review"` — every other field keeps the same meaning; this is NOT a
 * new independent shape, just `PendingDocRow`'s status literal relaxed for
 * the merge.
 */
export type ReviewQueueDocRow = Omit<PendingDocRow, "status"> & {
  status: "draft" | "in-review";
};

/**
 * Fetch one in-review `DocSummary` row's full record and project it into a
 * {@link ReviewQueueDocRow}. See module doc comment for why a per-row
 * `apiGetDoc` call is necessary (real `version`/`created_by`, never
 * fabricated).
 */
async function toInReviewRow(
  project: string | null,
  docId: string,
): Promise<ReviewQueueDocRow> {
  const { doc } = await apiGetDoc(project, docId);
  const meta = deriveTypeMeta(doc);
  return {
    id: doc.id,
    type: doc.type,
    title: doc.title,
    status: "in-review",
    created_by: doc.created_by,
    updated_at: doc.updated_at,
    version: doc.version,
    ...(meta !== undefined ? { meta } : {}),
  };
}

/**
 * Fetch the merged draft + in-review dashboard review queue: draft rows via
 * the existing `GET /api/review/pending` (unchanged), in-review rows via a
 * client-side `apiList` + per-row `apiGetDoc` fetch (see module doc comment).
 *
 * @param project - Registry project name, or `null` for registry-less mode.
 * @param opts - Optional author/type/since filters (author narrows the draft
 *   branch only — see module doc comment).
 * @returns In-review rows first, then draft rows; each batch keeps its own
 *   server-assigned order (ADR: in-review sorts ahead of draft).
 * @throws {ApiError} On HTTP or network error from any underlying call.
 */
export async function fetchReviewQueueRows(
  project: string | null,
  opts: PendingReviewOpts = {},
): Promise<ReviewQueueDocRow[]> {
  const [draftRows, inReviewList] = await Promise.all([
    apiGetPendingReview(project, opts),
    apiList(project, {
      status: "in-review",
      ...(opts.type !== undefined ? { type: opts.type } : {}),
      ...(opts.since !== undefined ? { since: opts.since } : {}),
    }),
  ]);

  const inReviewRows = await Promise.all(
    inReviewList.docs.map((summary) => toInReviewRow(project, summary.id)),
  );

  return [...inReviewRows, ...draftRows];
}
