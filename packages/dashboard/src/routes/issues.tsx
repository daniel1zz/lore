/**
 * Issues route — full triage list page for incoming issue reports.
 * Path: /issues
 * Purpose: thin route wrapper around `IssuesList` (SPEC-074), the same
 *   pattern as `pending.tsx` wrapping `TriageQueue` and `docs.$id.tsx`
 *   wrapping `DocDetail`.
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { IssuesList } from "@/components/IssuesList";

export const Route = createFileRoute("/issues")({
  component: IssuesPage,
});

function IssuesPage(): React.ReactElement {
  const navigate = useNavigate();

  function handleNavigate(reportId: string): void {
    void navigate({ to: "/issues/$id", params: { id: reportId } });
  }

  return <IssuesList onNavigate={handleNavigate} />;
}
