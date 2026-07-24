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
import { Badge } from "@/components/ui/badge";
import { apiGetStatus } from "@/lib/api";
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
  const { data: status } = useQuery({
    queryKey: ["status"],
    queryFn: apiGetStatus,
    staleTime: 60 * 1000,
  });
  // reason: SPEC-074 — the nav badge polls the SAME issue-reports projection
  // the Issues page renders (one endpoint, no second count route); always
  // mounted (root layout) so an approve/reject invalidation on the detail
  // view has a live subscriber even when the Issues page itself isn't open.
  const { data: issueReports } = useIssueReportsQuery();
  const openIssueCount = issueReports?.open_count ?? 0;

  function handleSearch(query: string): void {
    void navigate({ to: "/search", search: { q: query } });
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
        <div className="container flex h-14 items-center gap-4 px-4 mx-auto max-w-7xl">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <span className="text-lg">Lore</span>
          </Link>

          <nav className="flex items-center gap-2 ml-4">
            <Link
              to="/"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              activeProps={{ className: "text-foreground font-medium" }}
            >
              Home
            </Link>
            {/* reason: SPEC-033 repurposed "/" as the resolved living PRD; the old
                doc-browsing + create UX moved to /library (see routes/library.tsx). */}
            <Link
              to="/library"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              activeProps={{ className: "text-foreground font-medium" }}
            >
              Library
            </Link>
            <Link
              to="/tree"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              activeProps={{ className: "text-foreground font-medium" }}
            >
              Tree
            </Link>
            {/* reason: SPEC-064 T4 — the Settings route is the UI for the SPEC-062
                config write backend (team + machine scope config editing). */}
            <Link
              to="/settings"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              activeProps={{ className: "text-foreground font-medium" }}
            >
              Settings
            </Link>
            {/* reason: SPEC-074 — badge hidden at 0 open reports (AC-074-4). */}
            <Link
              to="/issues"
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

          <div className="flex-1 max-w-sm ml-auto">
            <SearchBar onSearch={handleSearch} placeholder="Search corpus…" />
          </div>

          <div className="flex items-center gap-2">
            {status !== undefined && (
              <Badge variant="outline" className="text-xs" aria-label={`${status.total_docs} documents`}>
                {status.total_docs} docs
              </Badge>
            )}
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
