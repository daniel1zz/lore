/**
 * Project-scoped Execution route — `/p/:name/execution`.
 * Purpose: thin wrapper mirroring `routes/execution.tsx`'s `ExecutionRoute` —
 *   this file owns its OWN `Route.useSearch()`/`useNavigate({from:
 *   "/p/$name/execution"})` bindings (route-bound, cannot be shared across two
 *   different route ids) and renders the SAME `ExecutionPage` the top-level
 *   route renders, passing `project={name}` (`ExecutionPage` takes an
 *   explicit `project` prop rather than reading `useProjectParam()`
 *   internally — see its module doc comment).
 * Source: SPEC-078 T13 dispatch deliverable
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { executionSearchSchema } from "@/routes/execution";
import { ExecutionPage } from "@/components/ExecutionPage";

export const Route = createFileRoute("/p/$name/execution")({
  validateSearch: (search) => executionSearchSchema.parse(search),
  component: ProjectExecutionRoute,
});

function ProjectExecutionRoute(): React.ReactElement {
  const { name } = Route.useParams();
  const navigate = useNavigate({ from: "/p/$name/execution" });
  const { plan } = Route.useSearch();

  function handlePlanChange(planId: string): void {
    void navigate({ search: (prev) => ({ ...prev, plan: planId }) });
  }

  function handleNavigateToDoc(docId: string): void {
    void navigate({ to: "/p/$name/docs/$id", params: { name, id: docId } });
  }

  // reason: exactOptionalPropertyTypes forbids passing `undefined` for an
  // optional prop explicitly — conditional spread omits the key entirely
  // when the search param is absent (mirrors `routes/execution.tsx`'s
  // identical pattern).
  return (
    <ExecutionPage
      {...(plan !== undefined ? { planParam: plan } : {})}
      project={name}
      onPlanChange={handlePlanChange}
      onNavigateToDoc={handleNavigateToDoc}
    />
  );
}
