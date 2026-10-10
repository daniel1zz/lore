// @vitest-environment jsdom
/**
 * BR-994 falsifier (AC-P0C-6, switcher half): a registered project that is not
 * usable stays in the project switcher, disabled, with a message naming the
 * problem. The existing ProjectSwitcher.test.tsx asserts only the `missing`
 * row; this file pins the `schema-skew` and `error` rows to their exact
 * diagnosis strings from the /api/projects payload.
 *
 * Test plan (six-dimension coverage):
 *   HAPPY — a mounted sibling stays enabled beside the unusable rows.
 *   NEGATIVE — a schema-skew and an error entry are never omitted and never
 *     clickable (aria-disabled="true"); clicking one does not navigate.
 *   BOUNDARY — each row shows its OWN diagnosis, never the other entry's.
 *   ERROR/STATE/REGRESSION — covered by the row-content assertions above.
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  useRouterState: (opts: { select: (state: { location: { pathname: string } }) => string }) =>
    opts.select({ location: { pathname: "/library" } }),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiGetProjects: vi.fn(), apiGetPendingReview: vi.fn() };
});

vi.mock("@/lib/project-storage", () => ({
  setLastViewedProject: vi.fn(),
}));

import { apiGetProjects, apiGetPendingReview } from "@/lib/api";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";

const SKEW_DIAGNOSIS = "corpus storage version 7 is newer than this lore supports (6)";
const ERROR_DIAGNOSIS = "mount failed: SQLITE_CANTOPEN unable to open database file";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(apiGetPendingReview).mockResolvedValue([]);
  vi.mocked(apiGetProjects).mockResolvedValue({
    projects: [
      { name: "acme", state: "mounted" },
      { name: "skewed", state: "schema-skew", diagnosis: SKEW_DIAGNOSIS },
      { name: "broken", state: "error", diagnosis: ERROR_DIAGNOSIS },
    ],
    instance: { port: 8787, registry_name: "test" },
  });
});

async function openSwitcher() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <ProjectSwitcher />
    </QueryClientProvider>,
  );
  await user.click(await screen.findByTestId("project-switcher-trigger"));
  return user;
}

describe("BR-994 unusable project rows", () => {
  it("a schema-skew entry renders an aria-disabled row whose text contains its exact diagnosis", async () => {
    await openSwitcher();
    const row = await screen.findByTestId("project-row-skewed");
    expect(row).toHaveAttribute("aria-disabled", "true");
    expect(row).toHaveTextContent("schema-skew");
    expect(row).toHaveTextContent(SKEW_DIAGNOSIS);
    expect(row).not.toHaveTextContent(ERROR_DIAGNOSIS);
  });

  it("an error entry renders an aria-disabled row whose text contains its exact diagnosis", async () => {
    await openSwitcher();
    const row = await screen.findByTestId("project-row-broken");
    expect(row).toHaveAttribute("aria-disabled", "true");
    expect(row).toHaveTextContent(ERROR_DIAGNOSIS);
    expect(row).not.toHaveTextContent(SKEW_DIAGNOSIS);
  });

  it("unusable rows never navigate when clicked, while the mounted sibling stays enabled", async () => {
    const user = await openSwitcher();
    await user.click(await screen.findByTestId("project-row-skewed"));
    await user.click(screen.getByTestId("project-row-broken"));
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByTestId("project-row-acme")).not.toHaveAttribute("aria-disabled", "true");
  });
});
