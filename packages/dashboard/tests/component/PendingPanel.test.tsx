// @vitest-environment jsdom
/**
 * @spec_ref SPEC-033 §2.2
 *
 * Tests for PendingPanel — home-page side panel showing the top pending-review
 * documents with their latest AI judgment badge.
 *
 * Spec expectations (written from the module's documented invariants, before
 * reading the implementation body):
 *   - Shows at most PENDING_PANEL_LIMIT (documented as 8) docs, in server
 *     queue order — no independent client-side re-sort.
 *   - Per-doc judgment fetches are bounded by that same limit (never fan out
 *     to every doc the server could return).
 *   - Loading, empty-queue, and fetch-error states each render a distinct
 *     labeled state — never a blank panel.
 *   - Clicking a listed document's title calls onNavigate with that doc's id.
 *
 * Test plan (six-dimension coverage):
 *   HAPPY — two pending docs with different judgments (approve + null) both
 *     render, each with the correct judgment badge text.
 *   NEGATIVE — n/a beyond the ERROR/BOUNDARY cases below.
 *   BOUNDARY — an empty pending queue renders "No documents pending review."
 *     and never calls apiGetJudgments; a queue of 10 docs still only renders
 *     8 rows and apiGetJudgments is called exactly 8 times (bounded fan-out).
 *   ERROR — apiGetPendingReview rejecting renders the failure message.
 *   STATE — loading state shows skeletons before data resolves; clicking a
 *     title calls onNavigate with that doc's id.
 *   REGRESSION — n/a (no known prior regression to pin here).
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PendingDocRow } from "../../src/lib/api";
import type { ReviewJudgment } from "@lore/core";

vi.mock("@/lib/api", () => ({
  apiGetPendingReview: vi.fn(),
  apiGetJudgments: vi.fn(),
}));

import { apiGetPendingReview, apiGetJudgments } from "@/lib/api";
import { PendingPanel } from "../../src/components/PendingPanel";

const mockedGetPending = vi.mocked(apiGetPendingReview);
const mockedGetJudgments = vi.mocked(apiGetJudgments);

function makePendingDoc(overrides: Partial<PendingDocRow> & { id: string }): PendingDocRow {
  return {
    type: "spec",
    title: "Untitled",
    status: "draft",
    created_by: "alice",
    updated_at: "2026-07-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function makeJudgment(overrides: Partial<ReviewJudgment> = {}): ReviewJudgment {
  return {
    id: "01HJUDGE0000000000000000001",
    doc_id: "01HDOC000000000000000000001",
    doc_version: 1,
    decision: "approve",
    confidence: 0.93,
    reasons: [{ dimension: "completeness", finding: "All ACs covered." }],
    checks: [{ check: "schema", outcome: "pass" }],
    blocking_questions: [],
    judge: { provider: "claude-cli", model: "claude-sonnet-5", prompt_version: "v1" },
    created_at: "2026-07-06T00:00:00.000Z",
    created_by: "ai:claude-cli:claude-sonnet-5:v1",
    ...overrides,
  };
}

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  mockedGetPending.mockReset();
  mockedGetJudgments.mockReset();
});

describe("PendingPanel", () => {
  describe("happy path", () => {
    it("renders two pending docs with their distinct judgment badges", async () => {
      const doc1 = makePendingDoc({ id: "01HDOC00000000000000000001", title: "Doc One", version: 2 });
      const doc2 = makePendingDoc({ id: "01HDOC00000000000000000002", title: "Doc Two", version: 5 });
      mockedGetPending.mockResolvedValue([doc1, doc2]);
      mockedGetJudgments.mockImplementation(async (docId: string) => {
        if (docId === doc1.id) return { latest: makeJudgment({ doc_version: 2, decision: "approve" }), history: [] };
        return { latest: null, history: [] };
      });

      renderWithClient(<PendingPanel />);

      expect(await screen.findByText("Doc One")).toBeInTheDocument();
      expect(screen.getByText("Doc Two")).toBeInTheDocument();
      expect(screen.getByText("approve 0.93")).toBeInTheDocument();
      expect(screen.getByText("unreviewed")).toBeInTheDocument();
    });
  });

  describe("boundary: empty queue", () => {
    it('renders "No documents pending review." and never calls apiGetJudgments', async () => {
      mockedGetPending.mockResolvedValue([]);

      renderWithClient(<PendingPanel />);

      expect(await screen.findByText("No documents pending review.")).toBeInTheDocument();
      expect(mockedGetJudgments).not.toHaveBeenCalled();
    });
  });

  describe("boundary: bounded fan-out at the panel limit", () => {
    it("renders at most 8 rows and calls apiGetJudgments exactly 8 times for a 10-doc queue", async () => {
      const docs = Array.from({ length: 10 }, (_, i) =>
        makePendingDoc({ id: `01HDOC0000000000000000${String(i).padStart(4, "0")}`, title: `Doc ${i}` }),
      );
      mockedGetPending.mockResolvedValue(docs);
      mockedGetJudgments.mockResolvedValue({ latest: null, history: [] });

      renderWithClient(<PendingPanel />);

      await screen.findByText("Doc 0");
      await waitFor(() => expect(mockedGetJudgments).toHaveBeenCalledTimes(8));

      expect(screen.queryByText("Doc 8")).not.toBeInTheDocument();
      expect(screen.queryByText("Doc 9")).not.toBeInTheDocument();
    });
  });

  describe("error", () => {
    it("renders a failure message when apiGetPendingReview rejects", async () => {
      mockedGetPending.mockRejectedValue(new Error("network down"));

      renderWithClient(<PendingPanel />);

      expect(await screen.findByText("Failed to load pending documents.")).toBeInTheDocument();
    });
  });

  describe("state", () => {
    it("shows loading skeletons before data resolves", async () => {
      let resolvePending!: (docs: PendingDocRow[]) => void;
      mockedGetPending.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvePending = resolve;
          }),
      );

      const { container } = renderWithClient(<PendingPanel />);

      expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);

      resolvePending([]);
      await screen.findByText("No documents pending review.");
    });

    it("calls onNavigate with the clicked document's id", async () => {
      const doc1 = makePendingDoc({ id: "01HDOC00000000000000000001", title: "Doc One" });
      mockedGetPending.mockResolvedValue([doc1]);
      mockedGetJudgments.mockResolvedValue({ latest: null, history: [] });
      const onNavigate = vi.fn();
      const user = userEvent.setup();

      renderWithClient(<PendingPanel onNavigate={onNavigate} />);

      const title = await screen.findByText("Doc One");
      await user.click(title);

      expect(onNavigate).toHaveBeenCalledWith("01HDOC00000000000000000001");
    });
  });
});
