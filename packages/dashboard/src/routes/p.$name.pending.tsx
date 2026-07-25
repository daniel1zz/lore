/**
 * Project-scoped Pending route — `/p/:name/pending`.
 * Purpose: thin wrapper mirroring `routes/pending.tsx`'s `PendingPage` —
 *   renders the SAME `TriageQueue` the top-level route renders, passing
 *   `project={name}` (`TriageQueue` takes an explicit `project` prop rather
 *   than reading `useProjectParam()` internally — see its module doc
 *   comment).
 * Source: SPEC-078 T13 dispatch deliverable
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { TriageQueue } from "@/components/TriageQueue";

export const Route = createFileRoute("/p/$name/pending")({
  component: ProjectPendingPage,
});

function ProjectPendingPage(): React.ReactElement {
  const { name } = Route.useParams();
  const navigate = useNavigate({ from: "/p/$name/pending" });

  function handleNavigate(docId: string): void {
    void navigate({ to: "/p/$name/docs/$id", params: { name, id: docId } });
  }

  return <TriageQueue project={name} onNavigate={handleNavigate} />;
}
