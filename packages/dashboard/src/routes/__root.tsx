/**
 * Root layout route — wraps all pages with the top navigation bar.
 * Purpose: persistent header with logo, search shortcut, and theme toggle.
 * Invariants: renders <Outlet /> for nested routes; no data fetching at root level.
 */

import { createRootRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SearchBar } from "@/components/SearchBar";
import { Badge } from "@/components/ui/badge";
import { apiGetStatus } from "@/lib/api";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout(): React.ReactElement {
  const navigate = useNavigate();
  const { data: status } = useQuery({
    queryKey: ["status"],
    queryFn: apiGetStatus,
    staleTime: 60 * 1000,
  });

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
              Docs
            </Link>
            <Link
              to="/tree"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              activeProps={{ className: "text-foreground font-medium" }}
            >
              Tree
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
