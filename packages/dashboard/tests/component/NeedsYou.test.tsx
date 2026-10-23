// @vitest-environment jsdom
/**
 * @spec_ref spec-human-review-surface-decisions-audit-items-and-pending D3 / AC-HR-4
 *
 * Tests for the read-only "Needs you" page and the decision detail page.
 * Real `lib/api.ts` runs against a stubbed global `fetch`, so the fetch spy also proves no request is
 * anything but GET. `lib/review-queue` is mocked (it has its own tests).
 *
 * Test plan (six-dimension coverage):
 *   HAPPY — two sections with exact counts; detail shows summary, before/after, on_accept, on_reject,
 *     every factor, recommendation, the two `lore decide` commands and the terminal sentence.
 *   NEGATIVE — a button click and every link-free control issues no non-GET request.
 *   BOUNDARY — empty section stays visible with count 0 and the exact empty text; a decision with no
 *     detail shows the label and no before/after.
 *   ERROR — one failing list shows an error line without a fake 0; 404 and 422 detail messages differ.
 *   STATE — Refresh refetches (GET only).
 *   REGRESSION — project-scoped mirror routes render the same components and scope their requests.
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockParams = vi.hoisted(() => ({ value: {} as Record<string, string> }));

vi.mock("@tanstack/react-router", () => ({
  // reason: identity-ish createFileRoute so `Route.component` and `Route.useParams` are reachable without a router.
  createFileRoute: () => (opts: object) => ({ ...opts, useParams: () => mockParams.value }),
  useRouterState: (opts: { select: (s: { location: { pathname: string } }) => string }) =>
    opts.select({ location: { pathname: "/needs-you" } }),
}));
vi.mock("@/lib/review-queue", () => ({ fetchReviewQueueRows: vi.fn() }));

import { fetchReviewQueueRows } from "@/lib/review-queue";
import type { DecisionReadView } from "@/lib/api";
import { NeedsYou } from "@/components/NeedsYou";
import { DecisionDetailPage } from "@/components/DecisionDetailPage";
import { Route as NeedsYouRoute } from "@/routes/needs-you";
import { Route as ProjectNeedsYouRoute } from "@/routes/p.$name.needs-you";
import { Route as DetailRoute } from "@/routes/needs-you_.decisions.$id";
import { Route as ProjectDetailRoute } from "@/routes/p.$name.needs-you_.decisions.$id";

type RouteWithComponent = { component: () => React.ReactElement };

const NO_DETAIL = "no detail recorded (decided before detail existed)";

function decision(over: Partial<DecisionReadView> = {}): DecisionReadView {
  return {
    id: 7,
    class: "governance-loosen",
    subject_id: "rule:max-retries",
    subject_version: "3",
    opened_at: "2026-10-01T00:00:00Z",
    score: 0.4,
    threshold: 0.8,
    factors: { blast_radius: 0.9, reversibility: 0.2 },
    reasons: ["score below threshold"],
    summary: "Allow agents to retry failed pushes up to 5 times",
    detail: {
      summary: "Allow agents to retry failed pushes up to 5 times",
      requested_by: "agent planner",
      change: { entry: "max-retries", before: "2 retries", after: "5 retries" },
      on_accept: "Agents may retry pushes five times.",
      on_reject: "Agents keep the limit of two retries.",
    },
    recommendation: { answer: "reject", reason: "Loosening a limit is hard to undo." },
    answer_commands: { accept: "lore decide 7 --accept", reject: "lore decide 7 --reject" },
    ...over,
  };
}

const BARE: DecisionReadView = decision({
  id: 12,
  summary: NO_DETAIL,
  detail: null,
  recommendation: null,
  answer_commands: { accept: "lore decide 12 --accept", reject: "lore decide 12 --reject" },
});

interface Routes {
  decisions?: DecisionReadView[] | "fail";
  one?: DecisionReadView | 404 | 422;
}

const fetchSpy = vi.fn();

function stubFetch(routes: Routes): void {
  fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    const json = (status: number, body: unknown): Response =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (url.endsWith("/api/decisions") || url.includes("/api/decisions?")) {
      return routes.decisions === "fail"
        ? json(500, { ok: false, error: { code: "X", message: "boom" } })
        : json(200, { ok: true, data: routes.decisions ?? [] });
    }
    if (/\/decisions\/[^/]+$/.test(url)) {
      if (routes.one === 404) return json(404, { ok: false, error: { code: "NOT_FOUND", message: "no" } });
      if (routes.one === 422) return json(422, { ok: false, error: { code: "VALIDATION_ERROR", message: "bad" } });
      return json(200, { ok: true, data: routes.one });
    }
    return json(404, { ok: false, error: { code: "NOT_FOUND", message: url } });
  });
}

function withClient(ui: React.ReactElement): React.ReactElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

function section(name: RegExp): HTMLElement {
  return screen.getByRole("region", { name });
}

function expectOnlyGets(): void {
  for (const call of fetchSpy.mock.calls) {
    const init = (call[1] ?? {}) as RequestInit;
    expect((init.method ?? "GET").toUpperCase()).toBe("GET");
  }
}

beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
  vi.mocked(fetchReviewQueueRows).mockReset();
  vi.mocked(fetchReviewQueueRows).mockResolvedValue([]);
  mockParams.value = {};
});
afterEach(() => vi.unstubAllGlobals());

describe("NeedsYou page", () => {
  it("HAPPY: two sections, each headed by its exact count, with rows linking to details; no audit section exists", async () => {
    stubFetch({ decisions: [decision()] });
    vi.mocked(fetchReviewQueueRows).mockResolvedValue([
      { id: "doc-1", type: "spec", title: "A draft spec", status: "draft", created_by: "me", updated_at: "x", version: 1 },
    ]);
    render(withClient(<NeedsYou />));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Open decisions (1)" })).toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: /Audit items/ })).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Documents awaiting review (1)" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Allow agents to retry/ })).toHaveAttribute(
      "href",
      "/needs-you/decisions/7",
    );
    expect(screen.getByRole("link", { name: /A draft spec/ })).toHaveAttribute("href", "/docs/doc-1");
  });

  it("BOUNDARY: an empty section stays visible with count 0 and the exact empty text", async () => {
    stubFetch({ decisions: [] });
    render(withClient(<NeedsYou />));

    const open = await screen.findByRole("region", { name: /Open decisions/ });
    await waitFor(() => expect(within(open).getByRole("heading", { name: "Open decisions (0)" })).toBeInTheDocument());
    expect(within(open).getByText("Nothing waiting for you here.")).toBeInTheDocument();
    await waitFor(() =>
      expect(within(section(/Documents awaiting review/)).getByText("Nothing waiting for you here.")).toBeInTheDocument(),
    );
  });

  it("ERROR: a failing list shows an error line, never a fake zero", async () => {
    stubFetch({ decisions: "fail" });
    render(withClient(<NeedsYou />));

    const decisions = section(/Open decisions/);
    expect(await within(decisions).findByRole("alert")).toHaveTextContent("Could not load this list");
    expect(within(decisions).queryByText("Nothing waiting for you here.")).not.toBeInTheDocument();
    expect(within(decisions).queryByRole("heading", { name: /\(0\)/ })).not.toBeInTheDocument();
  });

  it("NEGATIVE/STATE: clicking every button (Refresh) refetches with GET only", async () => {
    stubFetch({ decisions: [decision()] });
    render(withClient(<NeedsYou />));
    await screen.findByRole("heading", { name: "Open decisions (1)" });
    const before = fetchSpy.mock.calls.length;

    for (const button of screen.getAllByRole("button")) await userEvent.click(button);

    await waitFor(() => expect(fetchSpy.mock.calls.length).toBeGreaterThan(before));
    expect(fetchSpy).toHaveBeenCalled();
    expectOnlyGets();
  });

  it("REGRESSION: the project-scoped mirror renders the same page and scopes its reads", async () => {
    stubFetch({ decisions: [decision()] });
    mockParams.value = { name: "acme" };
    const Page = (ProjectNeedsYouRoute as unknown as RouteWithComponent).component;
    render(withClient(<Page />));

    expect(await screen.findByRole("heading", { name: "Open decisions (1)" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Documents awaiting review (0)" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Allow agents/ })).toHaveAttribute(
      "href",
      "/p/acme/needs-you/decisions/7",
    );
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain("/api/p/acme/");
    const Top = (NeedsYouRoute as unknown as RouteWithComponent).component;
    expect(Top).toBeTypeOf("function");
  });
});

describe("Decision detail page", () => {
  it("HAPPY: shows summary, before/after, on_accept, on_reject, every factor, recommendation and commands", async () => {
    stubFetch({ one: decision() });
    render(withClient(<DecisionDetailPage id="7" />));

    expect(await screen.findByText("Allow agents to retry failed pushes up to 5 times", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("2 retries")).toBeInTheDocument();
    expect(screen.getByText("5 retries")).toBeInTheDocument();
    expect(screen.getByText("Agents may retry pushes five times.")).toBeInTheDocument();
    expect(screen.getByText("Agents keep the limit of two retries.")).toBeInTheDocument();
    expect(screen.getByText("blast_radius: 0.9")).toBeInTheDocument();
    expect(screen.getByText("reversibility: 0.2")).toBeInTheDocument();
    expect(screen.getByText(/Loosening a limit is hard to undo/)).toBeInTheDocument();
    expect(screen.getByText("lore decide 7 --accept")).toBeInTheDocument();
    expect(screen.getByText("lore decide 7 --reject")).toBeInTheDocument();
    expect(screen.getByText(/Answering happens in your own terminal/)).toBeInTheDocument();
  });

  it("BOUNDARY: a decision with no detail shows the label, no recommendation and no before/after", async () => {
    stubFetch({ one: BARE });
    render(withClient(<DecisionDetailPage id="12" />));

    expect(await screen.findByText(NO_DETAIL)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Decision #12" })).toBeInTheDocument();
    expect(screen.queryByText("Recommendation")).not.toBeInTheDocument();
    expect(screen.queryByText("Before")).not.toBeInTheDocument();
    expect(screen.getByText("lore decide 12 --accept")).toBeInTheDocument();
    expect(screen.getByText("lore decide 12 --reject")).toBeInTheDocument();
  });

  it("ERROR: 404 and 422 give different plain messages", async () => {
    stubFetch({ one: 404 });
    const first = render(withClient(<DecisionDetailPage id="999" />));
    expect(await screen.findByRole("alert")).toHaveTextContent("No decision with that number exists.");
    first.unmount();

    stubFetch({ one: 422 });
    render(withClient(<DecisionDetailPage id="abc" />));
    expect(await screen.findByRole("alert")).toHaveTextContent("That is not a valid decision number.");
  });

  it("NEGATIVE: no non-GET request while clicking every button", async () => {
    stubFetch({ one: decision() });
    render(withClient(<DecisionDetailPage id="7" />));
    await screen.findByText("lore decide 7 --accept");
    for (const button of screen.queryAllByRole("button")) await userEvent.click(button);
    expect(fetchSpy).toHaveBeenCalled();
    expectOnlyGets();
  });

  it("REGRESSION: both detail routes render the same detail page (top-level and project-scoped)", async () => {
    stubFetch({ one: decision() });
    mockParams.value = { id: "7" };
    const Top = (DetailRoute as unknown as RouteWithComponent).component;
    const first = render(withClient(<Top />));
    expect(await screen.findByText("lore decide 7 --accept")).toBeInTheDocument();
    first.unmount();

    mockParams.value = { id: "7", name: "acme" };
    const Scoped = (ProjectDetailRoute as unknown as RouteWithComponent).component;
    render(withClient(<Scoped />));
    expect(await screen.findByText("lore decide 7 --reject")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Needs you" })).toHaveAttribute("href", "/p/acme/needs-you");
  });
});
