/**
 * Home route — the resolved living PRD (PRD-001 §13.5, SPEC-033 §2.2).
 * Path: /
 * Purpose: renders the corpus's single PRD document with its MDX placeholders
 *   resolved to typed React (ChildrenOf/RecentDecisions/ActivePlans/HealthStats/
 *   etc., via `ResolvedPrdBody` — never spliced markdown-as-HTML), plus side
 *   panels surfacing the feedback loop (pending review, active plans,
 *   calibration + audit-verify). Replaces the old hardcoded doc-list home
 *   (SPEC-015); that list+create UX moved to `/library` — no functionality
 *   was dropped, just relocated off the PRD-projection surface SPEC-033 claims.
 * Invariants:
 *   - The PRD is located via `apiTree()`'s default root — the server defaults
 *     to the corpus's one PRD doc when no `root` id is given (same mechanism
 *     `/tree` uses). A corpus with zero PRD docs surfaces a labeled empty
 *     state, never a crash.
 *   - Body renders via `<ResolvedPrdBody>`, which never dangerouslySetInnerHTML.
 * Side-effect class: IO (fetch via TanStack Query)
 * Source: PRD-001 §13.5, SPEC-033 §2.2/§2.4
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { apiTree, apiGetDoc } from "@/lib/api";
import { queryKeys } from "@/lib/project-api";
import { ResolvedPrdBody } from "@/components/ResolvedPrdBody";
import { PendingPanel } from "@/components/PendingPanel";
import { ActivePlansPanel } from "@/components/ActivePlansPanel";
import { LoopPanel } from "@/components/LoopPanel";
import { IssueReportsCard } from "@/components/IssueReportsCard";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage(): React.ReactElement {
  const navigate = useNavigate();

  const {
    data: root,
    isLoading: isTreeLoading,
    error: treeError,
  } = useQuery({
    queryKey: queryKeys.scope(null, ["tree"]),
    queryFn: () => apiTree(),
  });

  const prdId = root?.doc.id;

  const {
    data: prd,
    isLoading: isPrdLoading,
    error: prdError,
  } = useQuery({
    queryKey: queryKeys.scope(null, ["docs", prdId, "resolved"]),
    // reason: `enabled` gates this query on prdId being defined; the non-null
    // assertion below is safe because TanStack Query never invokes queryFn
    // while `enabled` is false.
    queryFn: () => apiGetDoc(prdId as string, { resolveMdx: true }),
    enabled: prdId !== undefined,
  });

  function handleNavigate(idOrSlug: string): void {
    void navigate({ to: "/docs/$id", params: { id: idOrSlug } });
  }

  const isLoading = isTreeLoading || (prdId !== undefined && isPrdLoading);
  const error = treeError ?? prdError;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4 min-w-0">
        <header>
          <h1 className="text-2xl font-bold">{prd?.doc.title ?? "Project Overview"}</h1>
          <p className="text-sm text-muted-foreground mt-1">Living PRD — the resolved project context</p>
        </header>

        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-6 rounded" style={{ width: `${90 - i * 6}%` }} />
            ))}
          </div>
        )}

        {error !== null && !isLoading && (
          <div className="rounded-md border border-destructive/50 p-4">
            <p className="text-sm text-destructive">
              {root === undefined
                ? "No PRD document exists yet in this corpus."
                : "Failed to load the project PRD. Please try again."}
            </p>
          </div>
        )}

        {prd !== undefined && (
          <ResolvedPrdBody
            content={prd.doc.content}
            resolvedComponents={prd.resolvedMdx?.resolvedComponents ?? []}
            warnings={prd.resolvedMdx?.warnings ?? []}
            onNavigate={handleNavigate}
          />
        )}
      </div>

      <aside className="space-y-4">
        <IssueReportsCard onNavigate={() => void navigate({ to: "/issues" })} />
        <PendingPanel onNavigate={handleNavigate} />
        <ActivePlansPanel onNavigate={handleNavigate} />
        <LoopPanel />
      </aside>
    </div>
  );
}
