// @vitest-environment jsdom
/**
 * @spec_ref SPEC-078 D5, D7, T10 dispatch deliverable 2
 *
 * Tests for ProjectSwitcher — the global-nav project dropdown driven by
 * `GET /api/projects` (D7 mount-registry projection).
 *
 * Spec expectations (written from the component's documented invariants,
 * before re-reading the implementation body):
 *   - Renders nothing while loading, on a 404 ("registry absent"), and when
 *     the registry resolves empty — all three are the SAME silent
 *     registry-less degrade (R-15 byte-identical chrome).
 *   - A non-404 error (network/500/malformed) renders a VISIBLE, disabled,
 *     named error trigger — never silently folded into "no switcher".
 *   - Every registry entry always renders a row; a non-mounted entry
 *     (missing/schema-skew/error) renders DISABLED with its diagnosis
 *     string visible — never omitted from the list.
 *   - Selecting a mounted project writes localStorage then navigates to
 *     that project's home.
 *
 * Test plan (six-dimension coverage):
 *   HAPPY — a healthy registry with 2 mounted projects renders both as
 *     clickable rows; clicking one writes localStorage + navigates.
 *   NEGATIVE — n/a beyond BOUNDARY/ERROR below.
 *   BOUNDARY — empty registry renders nothing; loading state renders nothing.
 *   ERROR — a non-404 error renders a visible, named, disabled trigger
 *     (never silently hidden like the absent-registry case).
 *   STATE — a `missing`/`schema-skew`/`error` entry renders disabled with
 *     its diagnosis text, alongside a healthy mounted sibling (AC-078-7
 *     component-test half: "problem entry renders as explicit error state,
 *     never omitted").
 *   REGRESSION — a 404 ("registry absent") degrades silently, distinct from
 *     every other error status (the isRegistryAbsent classification boundary).
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockNavigate = vi.fn();
const mockUseRouterState = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  // reason: useProjectParam() (project-api.ts) reads the router's live pathname
  // via useRouterState — every fixture below has no "/p/" prefix, so the
  // resolved active project is always null.
  useRouterState: (opts: { select: (state: { location: { pathname: string } }) => string }) =>
    opts.select({ location: { pathname: mockUseRouterState() as string } }),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    apiGetProjects: vi.fn(),
    apiGetPendingReview: vi.fn(),
  };
});

const mockSetLastViewedProject = vi.fn();
vi.mock("@/lib/project-storage", () => ({
  setLastViewedProject: (...args: unknown[]) => mockSetLastViewedProject(...args),
}));

import { apiGetProjects, apiGetPendingReview, ApiError } from "@/lib/api";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";

const mockedApiGetProjects = vi.mocked(apiGetProjects);
const mockedApiGetPendingReview = vi.mocked(apiGetPendingReview);

function renderSwitcher() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProjectSwitcher />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseRouterState.mockReturnValue("/library");
  mockedApiGetPendingReview.mockResolvedValue([]);
});

describe("ProjectSwitcher (SPEC-078 T10)", () => {
  describe("happy path", () => {
    it("renders every mounted project as a clickable row", async () => {
      mockedApiGetProjects.mockResolvedValue({
        projects: [
          { name: "acme", state: "mounted" },
          { name: "beta", state: "mounted" },
        ],
        instance: { port: 8787, registry_name: "test" },
      });

      renderSwitcher();

      await userEvent.setup().click(await screen.findByTestId("project-switcher-trigger"));

      expect(await screen.findByTestId("project-row-acme")).toBeInTheDocument();
      expect(screen.getByTestId("project-row-beta")).toBeInTheDocument();
    });

    it("clicking a mounted project writes localStorage then navigates to its home", async () => {
      mockedApiGetProjects.mockResolvedValue({
        projects: [{ name: "acme", state: "mounted" }],
        instance: { port: 8787, registry_name: "test" },
      });
      const user = userEvent.setup();

      renderSwitcher();
      await user.click(await screen.findByTestId("project-switcher-trigger"));
      await user.click(await screen.findByTestId("project-row-acme"));

      expect(mockSetLastViewedProject).toHaveBeenCalledWith("acme");
      expect(mockNavigate).toHaveBeenCalledWith({ to: "/p/$name", params: { name: "acme" } });
    });
  });

  describe("boundary", () => {
    it("renders nothing while the registry query is loading", () => {
      mockedApiGetProjects.mockImplementation(() => new Promise(() => {}));
      const { container } = renderSwitcher();
      expect(container).toBeEmptyDOMElement();
    });

    it("renders nothing when the registry resolves empty (same degrade as absent)", async () => {
      mockedApiGetProjects.mockResolvedValue({
        projects: [],
        instance: { port: 8787, registry_name: "test" },
      });
      const { container } = renderSwitcher();
      await waitFor(() => expect(mockedApiGetProjects).toHaveBeenCalled());
      expect(container).toBeEmptyDOMElement();
    });
  });

  describe("error", () => {
    it("renders a visible, named, disabled error trigger on a non-404 failure — never silently hidden", async () => {
      mockedApiGetProjects.mockRejectedValue(new ApiError(500, "STORE_ERROR", "registry read failed"));

      renderSwitcher();

      const errorTrigger = await screen.findByTestId("project-switcher-error");
      expect(errorTrigger).toBeInTheDocument();
      expect(errorTrigger).toBeDisabled();
      expect(errorTrigger).toHaveAccessibleName(expect.stringContaining("registry read failed"));
    });
  });

  describe("state — problem entry rendering (AC-078-7 component-test half)", () => {
    it("renders a missing/schema-skew/error entry as an explicit disabled row with its diagnosis, never omitted", async () => {
      mockedApiGetProjects.mockResolvedValue({
        projects: [
          { name: "acme", state: "mounted" },
          { name: "gone", state: "missing", diagnosis: "corpus path no longer exists on disk" },
        ],
        instance: { port: 8787, registry_name: "test" },
      });
      const user = userEvent.setup();

      renderSwitcher();
      await user.click(await screen.findByTestId("project-switcher-trigger"));

      const problemRow = await screen.findByTestId("project-row-gone");
      expect(problemRow).toBeInTheDocument();
      expect(problemRow).toHaveTextContent("missing");
      expect(problemRow).toHaveTextContent("corpus path no longer exists on disk");
      // reason: a disabled DropdownMenuItem still exposes `data-disabled` (Radix),
      // not the native `disabled` attribute — assert via aria state instead.
      expect(problemRow).toHaveAttribute("aria-disabled", "true");

      // The healthy sibling row must still render alongside the problem entry.
      expect(screen.getByTestId("project-row-acme")).toBeInTheDocument();
    });
  });

  describe("regression", () => {
    it("a 404 (registry absent) degrades silently — distinct from a real error", async () => {
      mockedApiGetProjects.mockRejectedValue(new ApiError(404, "NOT_FOUND", "no route"));

      const { container } = renderSwitcher();
      await waitFor(() => expect(mockedApiGetProjects).toHaveBeenCalled());

      expect(container).toBeEmptyDOMElement();
      expect(screen.queryByTestId("project-switcher-error")).not.toBeInTheDocument();
    });
  });
});
