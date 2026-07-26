/**
 * Root layout route — wraps all pages with the top navigation bar.
 * Purpose: persistent header with logo, search shortcut, and theme toggle.
 * Invariants: renders <Outlet /> for nested routes; no data fetching at root level
 *   beyond the SPEC-075 route-view telemetry ping (`useRouteTelemetry`, R-10) — a
 *   fire-and-forget side effect, not a render-blocking fetch.
 */

import { createRootRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SearchBar } from "@/components/SearchBar";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";
import { Badge } from "@/components/ui/badge";
import { apiGetStatus } from "@/lib/api";
import { queryKeys, useProjectParam, projectPath } from "@/lib/project-api";
import { useIssueReportsQuery } from "@/lib/issue-reports-query";
import { useRouteTelemetry } from "@/lib/use-route-telemetry";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout(): React.ReactElement {
  const navigate = useNavigate();
  // reason: SPEC-075 R-10 — mounted once at the root so EVERY client-side
  // navigation (home/library/tree/settings/issues/a doc detail page) records one
  // route-view telemetry ping. Fire-and-forget (see apiPostRouteView's doc
  // comment) — never blocks or errors this layout's render.
  useRouteTelemetry();
  const project = useProjectParam();
  const { data: status } = useQuery({
    queryKey: queryKeys.scope(project, ["status"]),
    queryFn: () => apiGetStatus(project),
    staleTime: 60 * 1000,
  });
  // reason: SPEC-074 — the nav badge polls the SAME issue-reports projection
  // the Issues page renders (one endpoint, no second count route); always
  // mounted (root layout) so an approve/reject invalidation on the detail
  // view has a live subscriber even when the Issues page itself isn't open.
  const { data: issueReports } = useIssueReportsQuery();
  const openIssueCount = issueReports?.open_count ?? 0;

  function handleSearch(query: string): void {
    // reason: nav-prefix fix — the search box is a navigation action like any
    // nav link, so it goes through the same `projectPath` seam (see the
    // Link `to` props below) instead of hardcoding the unprefixed "/search".
    void navigate({ to: projectPath(project, "/search"), search: { q: query } });
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
        {/* reason: ISSUE-010 — at narrow viewports (375px) the logo + 5 nav
            links + search box + docs-count badge + theme toggle together
            exceed the viewport width; without any wrap/scroll affordance the
            overflow spilled onto the document (horizontal body scroll) while
            "Issues" clipped mid-word with no way to reach it. The logo stays
            pinned (always the one guaranteed way back to Home); everything
            else shares ONE horizontally-scrollable region instead of
            wrapping into a taller, layout-shifting multi-row header — nothing
            is hidden or truncated, it is reachable by scroll (mouse wheel,
            touch swipe, or focus-driven scrollIntoView when tabbing). */}
        <div className="container flex h-14 items-center gap-4 px-4 mx-auto max-w-7xl overflow-x-auto">
          <Link
            to={projectPath(project, "/")}
            className="flex shrink-0 items-center gap-2 font-semibold"
          >
            <span className="text-lg">Lore</span>
          </Link>

          <nav className="flex shrink-0 items-center gap-2 ml-4">
            <Link
              to={projectPath(project, "/")}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              activeProps={{ className: "text-foreground font-medium" }}
            >
              Home
            </Link>
            {/* reason: SPEC-033 repurposed "/" as the resolved living PRD; the old
                doc-browsing + create UX moved to /library (see routes/library.tsx).
                reason: nav-prefix fix — every `to` below routes through
                `projectPath(project, …)` (`lib/project-api.ts`) so a click under
                `/p/:name` stays scoped to that project instead of silently
                switching back to the default (registry-less) project. */}
            <Link
              to={projectPath(project, "/library")}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              activeProps={{ className: "text-foreground font-medium" }}
            >
              Library
            </Link>
            <Link
              to={projectPath(project, "/tree")}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              activeProps={{ className: "text-foreground font-medium" }}
            >
              Tree
            </Link>
            {/* reason: SPEC-077 S1 — the dashboard execution read surface (ready/
                blocked tasks, sessions, anchor conflicts, phase progress). */}
            <Link
              to={projectPath(project, "/execution")}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              activeProps={{ className: "text-foreground font-medium" }}
            >
              Execution
            </Link>
            {/* reason: SPEC-064 T4 — the Settings route is the UI for the SPEC-062
                config write backend (team + machine scope config editing). */}
            <Link
              to={projectPath(project, "/settings")}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              activeProps={{ className: "text-foreground font-medium" }}
            >
              Settings
            </Link>
            {/* reason: SPEC-074 — badge hidden at 0 open reports (AC-074-4). */}
            <Link
              to={projectPath(project, "/issues")}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              activeProps={{ className: "text-foreground font-medium" }}
            >
              Issues
              {openIssueCount > 0 && (
                <Badge
                  variant="destructive"
                  className="text-xs px-1.5 py-0"
                  aria-label={`${openIssueCount} open issue reports`}
                >
                  {openIssueCount}
                </Badge>
              )}
            </Link>
          </nav>

          <div className="flex-1 shrink-0 max-w-sm ml-auto">
            <SearchBar onSearch={handleSearch} placeholder="Search corpus…" />
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {status !== undefined && (
              <Badge variant="outline" className="text-xs" aria-label={`${status.total_docs} documents`}>
                {status.total_docs} docs
              </Badge>
            )}
            {/* reason: SPEC-078 T10 — renders null in registry-less mode (byte-identical, R-15). */}
            <ProjectSwitcher />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
