/**
 * EvidenceTab — DocDetail's "Evidence" tab: a THIN discriminant dispatcher
 * over `EvidencePanelProjection` (SPEC-075 §Module Boundary D7).
 * Purpose: fetch a doc's evidence-panel projection and hand it to the ONE
 *   panel subcomponent that matches its `doc_type` — no rendering logic of
 *   its own (mirrors `AuditTab`/`HistoryTab`'s self-contained "fetch on mount
 *   via `useQuery`, docId prop only" convention, SPEC-033 F3).
 * Public surface: EvidenceTab, EvidenceTabProps
 * Invariants:
 *   - Owns its own `useQuery` (keyed via the shared `evidencePanelQueryKey`
 *     helper, `lib/api.ts`) — DocDetail mounts this tab conditionally
 *     (`doc.type` in `{task, spec, plan}`, mirroring the server's own
 *     doc_type→branch switch in `VerificationProjectionService`), so a
 *     `doc_type: "other"` projection is never actually fetched by this
 *     component in production; the `"other"` branch below still renders
 *     nothing rather than crashing, for defensive completeness of the
 *     exhaustive `switch`.
 *   - Loading / error states mirror `AuditTab`'s labeled-skeleton /
 *     labeled-error convention — never a blank tab body.
 *   - No local coverage/attestation math — every number rendered downstream
 *     came from `@lore/core` via the server projection (AC-075-10).
 * Side-effect class: IO (fetch via useQuery)
 * Source: SPEC-075 §Module Boundary D2/D7, AC-075-1, AC-075-2, AC-075-3
 *
 * @example
 * <EvidenceTab doc={doc} />
 */

import { useQuery } from "@tanstack/react-query";
import type { DocRecord } from "@lore/core";
import { apiGetEvidencePanel, evidencePanelQueryKey } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { TaskEvidencePanel } from "@/components/evidence/TaskEvidencePanel";
import { SpecAcCoveragePanel } from "@/components/evidence/SpecAcCoveragePanel";
import { PlanAttestationPanel } from "@/components/evidence/PlanAttestationPanel";

export interface EvidenceTabProps {
  /** The full task/spec/plan `DocRecord` (`GET /api/docs/:id`). */
  doc: DocRecord;
  /** Active project, or `null`/absent for registry-less mode (SPEC-078 T10). */
  project?: string | null;
}

/**
 * @example
 * <EvidenceTab doc={doc} />
 */
export function EvidenceTab({ doc, project = null }: EvidenceTabProps): React.ReactElement {
  const { data, isLoading, error } = useQuery({
    queryKey: evidencePanelQueryKey(project, doc.id),
    queryFn: () => apiGetEvidencePanel(project, doc.id),
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-14 rounded" />
        ))}
      </div>
    );
  }

  if (error !== null && error !== undefined) {
    return <p className="text-sm text-destructive">Failed to load evidence.</p>;
  }

  if (data === undefined) return <></>;

  // reason: THIN dispatcher (SPEC-075 D7) — each branch hands the matching
  // union member straight to its 1:1 panel subcomponent, no rendering here.
  switch (data.doc_type) {
    case "task":
      return <TaskEvidencePanel panel={data} />;
    case "spec":
      return <SpecAcCoveragePanel panel={data} />;
    case "plan":
      return <PlanAttestationPanel panel={data} />;
    case "other":
      return <></>;
  }
}
