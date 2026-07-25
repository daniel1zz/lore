// @vitest-environment jsdom
/**
 * Tests for RootLayout's nav/header link builder (`routes/__root.tsx`).
 * @spec_ref task-multi-project-nav-links-drop-the-p-name-prefix-clicking
 *
 * Bug: every nav link (logo/Home/Library/Tree/Execution/Settings/Issues) and
 * the search-box submit hardcoded an unprefixed route ("/library", "/search",
 * …), so clicking any of them under a `/p/:name` context silently navigated
 * back to the default (registry-less) project. The fix routes every target
 * through `projectPath(project, …)` (`lib/project-api.ts`) — this suite
 * pins the resulting hrefs/navigate targets directly, not the helper in
 * isolation (that's `project-api.test.ts`'s job) — proving the wiring, not
 * just the primitive.
 *
 * `@tanstack/react-router` is fully mocked (mirrors `ProjectSwitcher.test.tsx`
 * / `use-route-telemetry.test.ts`'s established pattern): `useRouterState`
 * resolves from a controllable mock pathname, `Link` renders a plain `<a
 * href>` so hrefs are directly assertable, and `createRootRoute` is the
 * identity function so `Route.component` (not otherwise exported) is
 * reachable for `render()`.
 *
 * Test plan (six-dimension coverage):
 *   HAPPY — under `/p/guyin/...`, every nav href AND the logo carry the
 *     `/p/guyin` prefix.
 *   NEGATIVE — n/a beyond BOUNDARY/REGRESSION below.
 *   BOUNDARY — registry-less (no `/p/:name` segment) renders today's exact
 *     unprefixed hrefs, byte-identical (regression guard baked into the AC).
 *   ERROR — n/a (pure link-building, no fallible IO in this seam).
 *   STATE — n/a (hrefs are a pure function of the route pathname, not
 *     component-local state).
 *   REGRESSION — the search-box submit navigates to the project-scoped
 *     search route (`/p/guyin/search`) with the query preserved, not the
 *     hardcoded top-level "/search".
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const mockNavigate = vi.fn();
const mockPathname = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  useRouterState: (opts: { select: (state: { location: { pathname: string } }) => string }) =>
    opts.select({ location: { pathname: mockPathname() as string } }),
  // reason: identity passthrough so `Route.component` below resolves to the
  // real `RootLayout` function — mirrors how a real `createRootRoute` stores
  // its options, without needing the full router runtime.
  createRootRoute: <T,>(opts: T) => opts,
  // reason: `activeProps` is a real `Link` prop (active-route style override)
  // with no native DOM equivalent — dropped here rather than spread, or React
  // logs an "unrecognized DOM attribute" warning on every render.
  Link: ({
    to,
    children,
    activeProps: _activeProps,
    ...rest
  }: {
    to: string;
    children?: ReactNode;
    activeProps?: unknown;
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  Outlet: () => null,
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    apiGetStatus: vi.fn().mockResolvedValue({ total_docs: 0 }),
  };
});

// reason: ProjectSwitcher owns its own `GET /api/projects` fetch + full
// dropdown UI, entirely orthogonal to the nav-link-building bug this suite
// pins — stubbing it out (mirrors R-15 "renders null in registry-less mode")
// keeps this suite from re-mocking a second module's network surface.
vi.mock("@/components/ProjectSwitcher", () => ({
  ProjectSwitcher: () => null,
}));

vi.mock("@/lib/issue-reports-query", () => ({
  useIssueReportsQuery: () => ({ data: undefined }),
}));

vi.mock("@/lib/use-route-telemetry", () => ({
  useRouteTelemetry: () => {},
}));

import { Route } from "@/routes/__root";

const RootLayout = Route.component as () => React.ReactElement;

function renderRootLayout() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RootLayout />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

/** Reads the resolved href for a given nav link's accessible name. */
function navHref(name: string): string | null {
  return screen.getByRole("link", { name }).getAttribute("href");
}

describe("RootLayout nav (nav-prefix fix)", () => {
  describe("happy path — routed under /p/guyin", () => {
    beforeEach(() => {
      mockPathname.mockReturnValue("/p/guyin/library");
    });

    it("prefixes every nav link and the logo with /p/guyin", () => {
      renderRootLayout();

      expect(navHref("Lore")).toBe("/p/guyin");
      expect(navHref("Home")).toBe("/p/guyin");
      expect(navHref("Library")).toBe("/p/guyin/library");
      expect(navHref("Tree")).toBe("/p/guyin/tree");
      expect(navHref("Execution")).toBe("/p/guyin/execution");
      expect(navHref("Settings")).toBe("/p/guyin/settings");
      expect(navHref("Issues")).toBe("/p/guyin/issues");
    });
  });

  describe("boundary — registry-less (no /p/:name segment)", () => {
    beforeEach(() => {
      mockPathname.mockReturnValue("/library");
    });

    it("renders today's exact unprefixed hrefs (regression, byte-identical)", () => {
      renderRootLayout();

      expect(navHref("Lore")).toBe("/");
      expect(navHref("Home")).toBe("/");
      expect(navHref("Library")).toBe("/library");
      expect(navHref("Tree")).toBe("/tree");
      expect(navHref("Execution")).toBe("/execution");
      expect(navHref("Settings")).toBe("/settings");
      expect(navHref("Issues")).toBe("/issues");
    });
  });

  describe("regression — search box stays project-scoped", () => {
    it("navigates to /p/guyin/search with the query when routed under /p/guyin", async () => {
      mockPathname.mockReturnValue("/p/guyin/library");
      const user = userEvent.setup();
      renderRootLayout();

      await user.type(screen.getByLabelText("Search query"), "gate hooks");
      await user.click(screen.getByLabelText("Submit search"));

      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/p/guyin/search",
        search: { q: "gate hooks" },
      });
    });

    it("navigates to the unprefixed /search in registry-less mode (regression)", async () => {
      mockPathname.mockReturnValue("/library");
      const user = userEvent.setup();
      renderRootLayout();

      await user.type(screen.getByLabelText("Search query"), "gate hooks");
      await user.click(screen.getByLabelText("Submit search"));

      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/search",
        search: { q: "gate hooks" },
      });
    });
  });
});
