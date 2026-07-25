/**
 * TriageQueue — full triage queue page body for the pending-review dashboard
 * route (SPEC-033 F3 §3). The home page's `PendingPanel` is a capped,
 * read-only preview of this same queue (`GET /api/review/pending` +
 * `apiGetJudgments`) — this component is the full, filterable, adjudicable
 * view it links out to ("See all →").
 * Purpose: give a human reviewer everything needed to triage a pending doc
 *   in one place — its latest AI judgment, an escalated-only filter to
 *   surface only documents genuinely blocked on a human, the blocking
 *   questions behind an escalation, and inline approve/reject with an
 *   optional calibration note (SPEC-033 F1's `calibration_note` hand-off to
 *   the implicit calibration hook on approve/reject).
 * Public surface: TriageQueue, TriageQueueProps
 * Invariants:
 *   - "Escalated only" filters to FRESH escalations only — `judgment.decision
 *     === "escalate" AND judgment.doc_version === doc.version` — a stale
 *     escalation (doc edited since judged) is no longer a trustworthy signal
 *     that the doc is still blocked, so it's excluded rather than shown with
 *     a "(stale)" badge that would clutter a filtered view meant to be a
 *     to-do list.
 *   - Blocking-questions expansion and the adjudicate (approve/reject) panel
 *     are independent per-row toggles — expanding blocking questions doesn't
 *     open the adjudicate panel and vice versa.
 *   - The calibration-note field is optional; approve/reject fire with
 *     `calibrationNote` omitted entirely (never `""`) when the field is left
 *     blank, matching `apiApproveDoc`/`apiRejectDoc`'s
 *     `exactOptionalPropertyTypes`-driven contract.
 *   - A non-empty `warnings[]` on the adjudicate response surfaces as a
 *     `toast.warning` IN ADDITION TO the success toast — the write itself
 *     already succeeded (see `AdjudicateDocResult`'s documented invariant in
 *     `api/mutations.ts`), so a warning is never treated as a failure.
 *   - On success, invalidates this component's own query key AND the home
 *     page's `["home", "pending-panel"]` key so both surfaces reflect the
 *     approve/reject immediately.
 *   - If-Match / ConflictModal concurrency handling is NOT wired here —
 *     `apiApproveDoc`/`apiRejectDoc` never send `If-Match` (see their JSDoc
 *     in `api/mutations.ts`); a 409 from either surfaces as a generic error
 *     toast via `DashboardApiError`, matching how `DocDetail.handleTransition`
 *     already treats a status-transition conflict it can't map onto a diff.
 *   - SPEC-075 R-9: `useTriageKeyboard` drives j/k row selection (visually a
 *     `ring-2 ring-primary` outline on the selected row), `a` approves the
 *     selected row IMMEDIATELY with no note (the fast path — a reviewer who
 *     wants to add a calibration note still uses the mouse "Review" flow),
 *     `x` OPENS the selected row's adjudicate panel rather than rejecting
 *     outright (a destructive action always gets the chance to type a
 *     reason first — "reject-with-reason", never a silent keystroke
 *     rejection), `e` toggles the SAME `expandedQuestionsId` state the
 *     mouse-driven "Show blocking questions" button already used, and `o`
 *     navigates to the selected row's detail page. Disabled entirely while
 *     any adjudicate panel is open (`enabled: adjudicatingId === null`) so
 *     typing "e"/"a"/"x"/"o" into the doc-title flow never double-fires
 *     while a reviewer's mid-adjudication (the calibration-note `<input>`
 *     itself is separately covered by the hook's own editable-target
 *     suppression, AC-075-6).
 *   - `JudgmentDrilldown` renders alongside `JudgmentBadge` per row — an
 *     independent, click-driven expand/collapse for the judgment's
 *     decision/confidence/reasons/checks/prompt_version, distinct from the
 *     keyboard-driven blocking-questions-only expand above.
 * Side-effect class: IO (fetch via TanStack Query, toast)
 * Source: SPEC-033 F3 §3; SPEC-075 §Module Boundary D7, R-9
 */

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGetPendingReview, apiGetJudgments } from "@/lib/api";
import type { PendingDocRow } from "@/lib/api";
import type { ReviewJudgment } from "@lore/core";
import { JudgmentBadge } from "@/components/judgment-badge";
import { JudgmentDrilldown } from "@/components/JudgmentDrilldown";
import { formatTypeMetaLabel, metaBadgeVariant } from "@/lib/type-meta-label";
import { apiApproveDoc, apiRejectDoc, DashboardApiError } from "@/api/mutations";
import { useTriageKeyboard } from "@/lib/use-triage-keyboard";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { queryKeys } from "@/lib/project-api";

export const TRIAGE_QUEUE_KEY = queryKeys.scope(null, ["pending", "triage-queue"]);

export interface TriageQueueProps {
  /** Called when a listed document's title is clicked. */
  onNavigate?: (docId: string) => void;
}

interface TriageRow {
  doc: PendingDocRow;
  judgment: ReviewJudgment | null;
}

async function fetchTriageQueue(): Promise<TriageRow[]> {
  const docs = await apiGetPendingReview();
  const judgments = await Promise.all(docs.map((doc) => apiGetJudgments(doc.id)));
  return docs.map((doc, index) => ({ doc, judgment: judgments[index]?.latest ?? null }));
}

/** A judgment counts as a fresh escalation only when it was judged against the doc's CURRENT version. */
function isFreshEscalation(row: TriageRow): boolean {
  return (
    row.judgment !== null &&
    row.judgment.decision === "escalate" &&
    row.judgment.doc_version === row.doc.version
  );
}

/**
 * Full triage queue: every pending-review doc, its latest judgment, an
 * escalated-only filter, blocking-question expansion, and inline
 * approve/reject with an optional calibration note.
 *
 * @example
 * <TriageQueue onNavigate={(id) => navigate({ to: '/docs/$id', params: { id } })} />
 */
export function TriageQueue({ onNavigate }: TriageQueueProps): React.ReactElement {
  const queryClient = useQueryClient();
  const [escalatedOnly, setEscalatedOnly] = useState(false);
  const [expandedQuestionsId, setExpandedQuestionsId] = useState<string | null>(null);
  const [adjudicatingId, setAdjudicatingId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: TRIAGE_QUEUE_KEY,
    queryFn: fetchTriageQueue,
  });

  const rows = useMemo(() => {
    if (data === undefined) return [];
    return escalatedOnly ? data.filter(isFreshEscalation) : data;
  }, [data, escalatedOnly]);

  const rowIds = useMemo(() => rows.map((row) => row.doc.id), [rows]);

  // reason: SPEC-075 R-9 — see the module doc comment for the full a/x/e/o mapping.
  // Disabled while an adjudicate panel is open so the keyboard loop never fights
  // with in-progress mouse-driven adjudication.
  const { selectedId } = useTriageKeyboard({
    itemIds: rowIds,
    enabled: adjudicatingId === null,
    onApprove: (docId) => void handleAdjudicate(docId, "approve"),
    onReject: (docId) => openAdjudicate(docId),
    onExpand: (docId) => setExpandedQuestionsId((prev) => (prev === docId ? null : docId)),
    onOpen: (docId) => onNavigate?.(docId),
  });

  function openAdjudicate(docId: string): void {
    setAdjudicatingId(docId);
    setNoteDraft("");
  }

  function closeAdjudicate(): void {
    setAdjudicatingId(null);
    setNoteDraft("");
  }

  async function handleAdjudicate(docId: string, action: "approve" | "reject"): Promise<void> {
    setSubmittingId(docId);
    try {
      const trimmedNote = noteDraft.trim();
      const opts = trimmedNote.length > 0 ? { calibrationNote: trimmedNote } : {};
      const result =
        action === "approve" ? await apiApproveDoc(docId, opts) : await apiRejectDoc(docId, undefined, opts);

      toast.success(action === "approve" ? "Document approved" : "Document rejected");
      if (result.warnings.length > 0) {
        toast.warning(result.warnings.join("; "));
      }

      closeAdjudicate();
      await queryClient.invalidateQueries({ queryKey: TRIAGE_QUEUE_KEY });
      await queryClient.invalidateQueries({ queryKey: queryKeys.scope(null, ["home", "pending-panel"]) });
    } catch (err) {
      const message = err instanceof DashboardApiError ? err.message : "Adjudication failed";
      toast.error(message);
    } finally {
      setSubmittingId(null);
    }
  }

  return (
    <section aria-label="Triage queue" className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Triage Queue</h1>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={escalatedOnly}
            onChange={(e) => setEscalatedOnly(e.target.checked)}
          />
          Escalated only
        </label>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded" />
          ))}
        </div>
      )}

      {error !== null && !isLoading && (
        <p className="text-sm text-destructive">Failed to load the triage queue.</p>
      )}

      {data !== undefined && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {escalatedOnly ? "No escalated documents." : "No documents pending review."}
        </p>
      )}

      {rows.length > 0 && (
        <div className="space-y-2">
          {rows.map(({ doc, judgment }) => {
            const questionsExpanded = expandedQuestionsId === doc.id;
            const isAdjudicating = adjudicatingId === doc.id;
            const isSubmitting = submittingId === doc.id;
            const blockingQuestions = judgment?.blocking_questions ?? [];
            const metaLabel = doc.meta !== undefined ? formatTypeMetaLabel(doc.meta) : null;

            return (
              <div
                key={doc.id}
                className={cn(
                  "rounded-lg border p-3 space-y-2",
                  selectedId === doc.id && "ring-2 ring-primary",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge variant="outline" className="text-xs shrink-0">
                      {doc.type}
                    </Badge>
                    {metaLabel !== null && (
                      <Badge
                        variant={doc.meta !== undefined ? metaBadgeVariant(doc.meta) : "outline"}
                        className="text-xs shrink-0"
                      >
                        {metaLabel}
                      </Badge>
                    )}
                    <button
                      type="button"
                      className="text-left text-sm font-medium text-primary hover:underline truncate"
                      onClick={() => onNavigate?.(doc.id)}
                    >
                      {doc.title}
                    </button>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <JudgmentBadge judgment={judgment} docVersion={doc.version} />
                    <button
                      type="button"
                      className="text-xs px-2 py-1 border rounded hover:bg-muted"
                      onClick={() => (isAdjudicating ? closeAdjudicate() : openAdjudicate(doc.id))}
                    >
                      {isAdjudicating ? "Cancel" : "Review"}
                    </button>
                  </div>
                </div>

                <JudgmentDrilldown judgment={judgment} />

                {blockingQuestions.length > 0 && (
                  <div>
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline"
                      onClick={() => setExpandedQuestionsId(questionsExpanded ? null : doc.id)}
                    >
                      {questionsExpanded
                        ? "Hide blocking questions"
                        : `Show blocking questions (${blockingQuestions.length})`}
                    </button>
                    {questionsExpanded && (
                      <ul className="list-disc list-inside pl-2 mt-1 space-y-0.5 text-xs text-muted-foreground">
                        {blockingQuestions.map((question, i) => (
                          <li key={i}>{question}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {isAdjudicating && (
                  <div className="flex items-center gap-2 pt-1 border-t">
                    <input
                      type="text"
                      className="flex-1 text-xs px-2 py-1 border rounded bg-background"
                      placeholder="Why approve/reject? (optional — helps calibrate the AI reviewer)"
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      aria-label={`Calibration note for ${doc.title}`}
                      disabled={isSubmitting}
                    />
                    <button
                      type="button"
                      className="text-xs px-2 py-1 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
                      onClick={() => void handleAdjudicate(doc.id, "approve")}
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? "…" : "Approve"}
                    </button>
                    <button
                      type="button"
                      className="text-xs px-2 py-1 border border-destructive text-destructive rounded hover:bg-destructive/10 disabled:opacity-50"
                      onClick={() => void handleAdjudicate(doc.id, "reject")}
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? "…" : "Reject"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
