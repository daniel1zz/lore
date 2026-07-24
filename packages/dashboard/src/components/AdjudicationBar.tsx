/**
 * AdjudicationBar — same-screen adjudication context for an in-review doc
 * (SPEC-075 R-8, PRD §21 F1). Renders a compact evidence-summary chip row
 * (`summarizeForAdjudicationBar`, `@lore/core`) alongside approve/reject
 * controls with an optional calibration note, mounted in `DocDetail`'s
 * header region — zero extra navigation from the evidence summary to the
 * adjudication action (the R-8 layout-spike requirement this component
 * exists to satisfy).
 * Public surface: AdjudicationBar, AdjudicationBarProps
 * Invariants:
 *   - Renders `null` for any doc whose `status !== "in-review"` — this bar
 *     is adjudication-context-specific, not a general-purpose evidence
 *     summary (that's `EvidenceTab`'s job for every doc_type/status).
 *   - Chips come from `summarizeForAdjudicationBar(panel)` (`@lore/core`) —
 *     the SAME fail-first status derivation `EvidenceTab`'s panels are built
 *     from; this component computes no coverage/attestation math itself
 *     (AC-075-10-adjacent discipline, even though this file isn't the
 *     projection-service the AC's grep oracle targets).
 *   - Approve/reject reuse `apiApproveDoc`/`apiRejectDoc` (SPEC-033 F1) with
 *     an optional `calibrationNote` — the EXACT write semantics and
 *     warnings-toast handling `TriageQueue.tsx`'s inline adjudicate block
 *     already established; no new write path is invented here.
 *   - The note/approve/reject controls render ONLY when `onMutated` is
 *     supplied (mirrors `LinksPanel`/`HistoryTab`'s existing "write
 *     affordances gated on a cache-invalidation callback" convention across
 *     `DocDetail` — read-only/unit-test contexts still see the chip summary).
 * Side-effect class: IO (apiApproveDoc/apiRejectDoc, toast)
 * Source: SPEC-075 §Module Boundary D7, R-8, AC-075-4
 *
 * @example
 * <AdjudicationBar doc={doc} panel={panel} onMutated={() => queryClient.invalidateQueries(...)} />
 */

import { useState } from "react";
import { toast } from "sonner";
import type { DocRecord, EvidencePanelProjection } from "@lore/core";
import { summarizeForAdjudicationBar } from "@lore/core";
import { Badge } from "@/components/ui/badge";
import { apiApproveDoc, apiRejectDoc, DashboardApiError } from "@/api/mutations";

export interface AdjudicationBarProps {
  /** The full `DocRecord` (`GET /api/docs/:id`) — gates rendering on `status === "in-review"`. */
  doc: DocRecord;
  /** This doc's evidence-panel projection (`GET /api/evidence-panel/:idOrSlug`). */
  panel: EvidencePanelProjection;
  /**
   * Called after a successful approve/reject. Caller (`DocDetail`) should
   * invalidate this doc's query cache. Omitted → the note/approve/reject
   * controls are not rendered (read-only context), matching `LinksPanel`/
   * `HistoryTab`'s established gating convention.
   */
  onMutated?: () => void;
}

/** Badge color for the compact fail-first status chip. */
function statusVariant(status: "pass" | "fail" | "none"): "secondary" | "destructive" | "outline" {
  if (status === "fail") return "destructive";
  if (status === "pass") return "secondary";
  return "outline";
}

/**
 * @example
 * <AdjudicationBar doc={doc} panel={panel} onMutated={refresh} />
 */
export function AdjudicationBar({ doc, panel, onMutated }: AdjudicationBarProps): React.ReactElement | null {
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (doc.status !== "in-review") return null;

  const summary = summarizeForAdjudicationBar(panel);

  async function handleAdjudicate(action: "approve" | "reject"): Promise<void> {
    setIsSubmitting(true);
    try {
      const trimmedNote = note.trim();
      const opts = trimmedNote.length > 0 ? { calibrationNote: trimmedNote } : {};
      const result =
        action === "approve" ? await apiApproveDoc(doc.id, opts) : await apiRejectDoc(doc.id, undefined, opts);

      toast.success(action === "approve" ? "Document approved" : "Document rejected");
      if (result.warnings.length > 0) {
        toast.warning(result.warnings.join("; "));
      }

      setNote("");
      onMutated?.();
    } catch (err) {
      const message = err instanceof DashboardApiError ? err.message : "Adjudication failed";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div aria-label="Adjudication" className="rounded-lg border p-3 space-y-2 bg-muted/30">
      <div className="flex items-center gap-1.5 flex-wrap" aria-label="Evidence summary">
        <Badge variant={statusVariant(summary.status)} className="text-xs">
          {summary.status}
        </Badge>
        <Badge variant="outline" className="text-xs">
          {summary.evidence_count} evidence
        </Badge>
        <Badge variant="outline" className="text-xs">
          {summary.attested_count} attested
        </Badge>
        {summary.pass_count > 0 && (
          <Badge variant="secondary" className="text-xs">
            {summary.pass_count} pass
          </Badge>
        )}
        {summary.fail_count > 0 && (
          <Badge variant="destructive" className="text-xs">
            {summary.fail_count} fail
          </Badge>
        )}
      </div>

      {onMutated !== undefined && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            className="flex-1 text-xs px-2 py-1 border rounded bg-background"
            placeholder="Calibration note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label={`Calibration note for ${doc.title}`}
            disabled={isSubmitting}
          />
          <button
            type="button"
            className="text-xs px-2 py-1 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
            onClick={() => void handleAdjudicate("approve")}
            disabled={isSubmitting}
          >
            {isSubmitting ? "…" : "Approve"}
          </button>
          <button
            type="button"
            className="text-xs px-2 py-1 border border-destructive text-destructive rounded hover:bg-destructive/10 disabled:opacity-50"
            onClick={() => void handleAdjudicate("reject")}
            disabled={isSubmitting}
          >
            {isSubmitting ? "…" : "Reject"}
          </button>
        </div>
      )}
    </div>
  );
}
