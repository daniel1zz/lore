/**
 * Pending route — full triage queue page.
 * Path: /pending
 * Purpose: the full, filterable, adjudicable triage queue that the home
 *   page's `PendingPanel` ("See all →" link) points at (SPEC-033 F3 §3).
 *   Thin route wrapper around `TriageQueue` — the same pattern as
 *   `docs.$id.tsx` wrapping `DocDetail`.
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { TriageQueue } from "@/components/TriageQueue";

export const Route = createFileRoute("/pending")({
  component: PendingPage,
});

function PendingPage(): React.ReactElement {
  const navigate = useNavigate();

  function handleNavigate(docId: string): void {
    void navigate({ to: "/docs/$id", params: { id: docId } });
  }

  return <TriageQueue onNavigate={handleNavigate} />;
}
