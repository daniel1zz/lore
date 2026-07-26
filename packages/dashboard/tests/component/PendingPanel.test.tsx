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
 *     render; the approve row shows its judgment badge text, the null-judgment
 *     row renders NO judgment badge at all (see the title-priority addendum
 *     below — "unreviewed" was removed as pure noise).
 *   NEGATIVE — n/a beyond the ERROR/BOUNDARY cases below.
 *   BOUNDARY — an empty pending queue renders "No documents pending review."
 *     and never calls apiGetJudgments; a queue of 10 docs still only renders
 *     8 rows and apiGetJudgments is called exactly 8 times (bounded fan-out).
 *   ERROR — fetchReviewQueueRows rejecting renders the failure message.
 *   STATE — loading state shows skeletons before data resolves; clicking a
 *     title calls onNavigate with that doc's id.
 *   REGRESSION — n/a (no known prior regression to pin here).
 *
 * SPEC-036 addendum — `row.meta` badge (source: task dispatch contract,
 * "PendingDoc.meta 投影 + dashboard pending 徽章"). Written from the contract
 * BEFORE reading PendingPanel.tsx's body: "row.meta present -> render type badge +
 * meta badge; row.meta absent -> only the type badge." `formatTypeMetaLabel` itself
 * is independently unit-tested (tests/unit/lib/type-meta-label.test.ts); these tests
 * exercise PendingPanel's WIRING to it, not the label rules.
 *   HAPPY — two rows with distinct meta values (plan/phase_count, adr/decision_status)
 *     both render their derived label text, alongside their existing judgment badge.
 *   NEGATIVE — a row without `meta` renders only its type badge, no stray meta text,
 *     and does not crash; title is still clickable (onNavigate still fires).
 *   BOUNDARY — n/a beyond the two BOUNDARY blocks already covering panel fan-out limits
 *     (unrelated to meta); N/A here because meta rendering has no size/count boundary
 *     of its own distinct from the existing panel-limit boundary tests.
 *   ERROR — N/A: meta rendering is synchronous over already-fetched row data; the
 *     existing "error" describe block below covers this component's one async failure
 *     surface (fetchReviewQueueRows rejecting).
 *   STATE — n/a: the meta badge is static per fetched row, no interactive transition.
 *   REGRESSION — a meta-carrying row remains clickable and still calls onNavigate with
 *     the correct id (meta rendering doesn't swallow or shift the click target).
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReviewJudgment } from "@lore/core";

vi.mock("@/lib/api", () => ({
  apiGetJudgments: vi.fn(),
}));
vi.mock("@/lib/review-queue", () => ({
  fetchReviewQueueRows: vi.fn(),
}));

import { apiGetJudgments } from "@/lib/api";
import { fetchReviewQueueRows } from "@/lib/review-queue";
import type { ReviewQueueDocRow } from "@/lib/review-queue";
import { PendingPanel } from "../../src/components/PendingPanel";

const mockedFetchQueue = vi.mocked(fetchReviewQueueRows);
const mockedGetJudgments = vi.mocked(apiGetJudgments);

function makePendingDoc(overrides: Partial<ReviewQueueDocRow> & { id: string }): ReviewQueueDocRow {
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
  mockedFetchQueue.mockReset();
  mockedGetJudgments.mockReset();
});

describe("PendingPanel", () => {
  describe("happy path", () => {
    it("renders two pending docs with their distinct judgment badges", async () => {
      const doc1 = makePendingDoc({ id: "01HDOC00000000000000000001", title: "Doc One", version: 2 });
      const doc2 = makePendingDoc({ id: "01HDOC00000000000000000002", title: "Doc Two", version: 5 });
      mockedFetchQueue.mockResolvedValue([doc1, doc2]);
      mockedGetJudgments.mockImplementation(async (_project: string | null, docId: string) => {
        if (docId === doc1.id) return { latest: makeJudgment({ doc_version: 2, decision: "approve" }), history: [] };
        return { latest: null, history: [] };
      });

      renderWithClient(<PendingPanel />);

      expect(await screen.findByText("Doc One")).toBeInTheDocument();
      expect(screen.getByText("Doc Two")).toBeInTheDocument();
      expect(screen.getByText("approve 0.93")).toBeInTheDocument();
      // "Doc Two" has judgment === null — no badge renders for it at all
      // (title-priority follow-up: "unreviewed" is every unjudged row's
      // default and conveyed no differentiating information while eating
      // width the title needs more).
      expect(screen.queryByText("unreviewed")).not.toBeInTheDocument();
    });
  });

  describe("boundary: empty queue", () => {
    it('renders "No documents pending review." and never calls apiGetJudgments', async () => {
      mockedFetchQueue.mockResolvedValue([]);

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
      mockedFetchQueue.mockResolvedValue(docs);
      mockedGetJudgments.mockResolvedValue({ latest: null, history: [] });

      renderWithClient(<PendingPanel />);

      await screen.findByText("Doc 0");
      await waitFor(() => expect(mockedGetJudgments).toHaveBeenCalledTimes(8));

      expect(screen.queryByText("Doc 8")).not.toBeInTheDocument();
      expect(screen.queryByText("Doc 9")).not.toBeInTheDocument();
    });
  });

  describe("error", () => {
    it("renders a failure message when fetchReviewQueueRows rejects", async () => {
      mockedFetchQueue.mockRejectedValue(new Error("network down"));

      renderWithClient(<PendingPanel />);

      expect(await screen.findByText("Failed to load pending documents.")).toBeInTheDocument();
    });
  });

  describe("state", () => {
    it("shows loading skeletons before data resolves", async () => {
      let resolvePending!: (docs: ReviewQueueDocRow[]) => void;
      mockedFetchQueue.mockImplementation(
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
      mockedFetchQueue.mockResolvedValue([doc1]);
      mockedGetJudgments.mockResolvedValue({ latest: null, history: [] });
      const onNavigate = vi.fn();
      const user = userEvent.setup();

      renderWithClient(<PendingPanel onNavigate={onNavigate} />);

      const title = await screen.findByText("Doc One");
      await user.click(title);

      expect(onNavigate).toHaveBeenCalledWith("01HDOC00000000000000000001");
    });
  });

  describe("meta badge (SPEC-036)", () => {
    describe("happy path", () => {
      it("renders distinct meta labels for two differently-typed rows", async () => {
        const planDoc = makePendingDoc({
          id: "01HDOC00000000000000000001",
          type: "plan",
          title: "Plan Row",
          meta: { t: "plan", phase_count: 3 },
        });
        const adrDoc = makePendingDoc({
          id: "01HDOC00000000000000000002",
          type: "adr",
          title: "Adr Row",
          meta: { t: "adr", decision_status: "accepted" },
        });
        mockedFetchQueue.mockResolvedValue([planDoc, adrDoc]);
        mockedGetJudgments.mockResolvedValue({ latest: null, history: [] });

        renderWithClient(<PendingPanel />);

        await screen.findByText("Plan Row");
        expect(screen.getByText("3 phases")).toBeInTheDocument();
        expect(screen.getByText("Adr Row")).toBeInTheDocument();
        expect(screen.getByText("accepted")).toBeInTheDocument();
      });
    });

    describe("negative: meta absent", () => {
      it("renders only the type badge and title, without crashing, when meta is absent", async () => {
        const doc = makePendingDoc({
          id: "01HDOC00000000000000000001",
          type: "spec",
          title: "No Meta Row",
        });
        mockedFetchQueue.mockResolvedValue([doc]);
        mockedGetJudgments.mockResolvedValue({ latest: null, history: [] });

        renderWithClient(<PendingPanel />);

        await screen.findByText("No Meta Row");
        expect(screen.getByText("spec")).toBeInTheDocument();
        expect(screen.queryByText("feature")).not.toBeInTheDocument();
        expect(screen.queryByText("tech")).not.toBeInTheDocument();
      });
    });

    describe("regression: click target unaffected by meta rendering", () => {
      it("a meta-carrying row is still clickable and calls onNavigate with its id", async () => {
        const doc = makePendingDoc({
          id: "01HDOC00000000000000000001",
          type: "knowledge",
          title: "Meta Row",
          meta: { t: "knowledge", sub_type: "reference" },
        });
        mockedFetchQueue.mockResolvedValue([doc]);
        mockedGetJudgments.mockResolvedValue({ latest: null, history: [] });
        const onNavigate = vi.fn();
        const user = userEvent.setup();

        renderWithClient(<PendingPanel onNavigate={onNavigate} />);

        const title = await screen.findByText("Meta Row");
        expect(screen.getByText("reference")).toBeInTheDocument();
        await user.click(title);

        expect(onNavigate).toHaveBeenCalledWith("01HDOC00000000000000000001");
      });
    });
  });

  describe("ISSUE-001: row layout with a long title and a long claim-actor meta string", () => {
    it("renders the full title AND the full meta text in the DOM — CSS truncation must never drop data", async () => {
      const longTitle = "Retrofit the SSE overlay reconnect handshake for T2 event replay ordering guarantees";
      const doc = makePendingDoc({
        id: "01HDOC00000000000000000001",
        type: "task",
        title: longTitle,
        meta: {
          t: "task",
          claimed_by: "agent:worker-sse",
          evidence_pass: 3,
          evidence_fail: 0,
        },
      });
      mockedFetchQueue.mockResolvedValue([doc]);
      mockedGetJudgments.mockResolvedValue({ latest: null, history: [] });

      renderWithClient(<PendingPanel />);

      // The title's full (untruncated) text is present in the DOM — `truncate`
      // is CSS-only (overflow/ellipsis), never a data-dropping transform.
      const title = await screen.findByText(longTitle);
      expect(title).toBeInTheDocument();
      expect(title).toHaveAttribute("title", longTitle);

      // The meta badge's full claim+evidence text renders too — previously
      // this and the judgment badge visually overlapped ("...worker-ssunreviewed")
      // because neither had real width constraints; both must independently
      // be present, distinct DOM nodes.
      const metaText = "claimed:agent:worker-sse ✔3/✘0";
      const meta = screen.getByText(metaText);
      expect(meta).toBeInTheDocument();
      expect(meta).toHaveAttribute("title", metaText);

      // judgment === null here — no badge at all (title-priority follow-up).
      expect(screen.queryByText("unreviewed")).not.toBeInTheDocument();
      expect(screen.getByText("task")).toBeInTheDocument();
    });

    it("keeps the title as the primary, GUARANTEED-minimum-width element (min-w-[10ch] flex-1) and the meta badge as the harder-capped shrinkable one", async () => {
      const doc = makePendingDoc({
        id: "01HDOC00000000000000000002",
        type: "task",
        title: "Short Title",
        meta: { t: "task", claimed_by: "agent:worker-sse", evidence_pass: 0, evidence_fail: 0 },
      });
      mockedFetchQueue.mockResolvedValue([doc]);
      mockedGetJudgments.mockResolvedValue({ latest: null, history: [] });

      renderWithClient(<PendingPanel />);

      const title = await screen.findByText("Short Title");
      expect(title).toHaveClass("flex-1");
      // reason (title-priority follow-up): a bare `min-w-0` let the flexbox
      // shrink algorithm collapse the title to 1-2 characters under real
      // overflow, since `flex-1`'s 0% basis contributes zero weight to the
      // shrink-distribution pool — the OTHER (nonzero-basis) siblings kept
      // their natural size while title alone shrank toward 0. `min-w-[10ch]`
      // is a real CSS min-width floor the shrink algorithm cannot cross.
      expect(title).toHaveClass("min-w-[10ch]");
      expect(title).not.toHaveClass("min-w-0");
      expect(title).toHaveClass("truncate");

      const meta = screen.getByText("claimed:agent:worker-sse");
      expect(meta).toHaveClass("truncate");
      expect(meta).toHaveClass("min-w-0");
      // reason: capped tighter (40% -> 25%) so meta yields more room to the
      // title up front, since meta is the one flex sibling designed to
      // absorb overflow via its own shrink.
      expect(meta).toHaveClass("max-w-[25%]");
    });
  });

  describe("title-priority follow-up (post-merge browser verification, ISSUE-001 round 2)", () => {
    it("omits the judgment badge entirely when judgment is null, reclaiming width for the title", async () => {
      const doc = makePendingDoc({
        id: "01HDOC00000000000000000003",
        type: "knowledge",
        title: "Research — SSE fan-out capacity",
        meta: { t: "knowledge", sub_type: "research" },
      });
      mockedFetchQueue.mockResolvedValue([doc]);
      mockedGetJudgments.mockResolvedValue({ latest: null, history: [] });

      renderWithClient(<PendingPanel />);

      await screen.findByText("Research — SSE fan-out capacity");
      expect(screen.queryByText("unreviewed")).not.toBeInTheDocument();
      // The type + meta badges are untouched by this change — only the
      // judgment badge is conditionally omitted.
      expect(screen.getByText("knowledge")).toBeInTheDocument();
      expect(screen.getByText("research")).toBeInTheDocument();
    });

    it("still renders a REAL (non-null) judgment badge — only the null/'unreviewed' case is omitted", async () => {
      const doc = makePendingDoc({
        id: "01HDOC00000000000000000004",
        type: "spec",
        title: "Escalated Spec Row",
      });
      mockedFetchQueue.mockResolvedValue([doc]);
      mockedGetJudgments.mockResolvedValue({
        latest: makeJudgment({ decision: "escalate", blocking_questions: ["Is this in scope?"] }),
        history: [],
      });

      renderWithClient(<PendingPanel />);

      await screen.findByText("Escalated Spec Row");
      expect(screen.getByText("escalate +1Q")).toBeInTheDocument();
    });

    it("shows at least the ~10-character AC threshold of the seeded title even with a type badge, meta badge, and un-truncated container width all present", async () => {
      // Regression pin for the exact post-merge finding: the title text
      // itself is never shortened/altered by this component (only CSS
      // truncation applies visually) — this asserts the DOM node's full
      // text content starts with the AC's literal ≥10-char example.
      const doc = makePendingDoc({
        id: "01HDOC00000000000000000005",
        type: "knowledge",
        title: "Research — SSE fan-out capacity",
        meta: { t: "knowledge", sub_type: "research" },
      });
      mockedFetchQueue.mockResolvedValue([doc]);
      mockedGetJudgments.mockResolvedValue({ latest: null, history: [] });

      renderWithClient(<PendingPanel />);

      const title = await screen.findByText("Research — SSE fan-out capacity");
      expect(title.textContent?.startsWith("Research —")).toBe(true);
      expect((title.textContent ?? "").length).toBeGreaterThanOrEqual(10);
    });
  });

  describe("ISSUE-008: draft + in-review merged queue", () => {
    it("renders both an in-review row and a draft row, each with a distinguishing status label", async () => {
      const inReviewDoc = makePendingDoc({
        id: "01HDOC00000000000000000010",
        title: "In Review Row",
        status: "in-review",
      });
      const draftDoc = makePendingDoc({
        id: "01HDOC00000000000000000011",
        title: "Draft Row",
        status: "draft",
      });
      // reason: PendingPanel never independently re-sorts — the merge/order
      // decision belongs entirely to fetchReviewQueueRows (unit-tested in
      // tests/unit/lib/review-queue.test.ts). Mocking it here already
      // in-review-first proves the panel renders rows in EXACTLY the order
      // it receives them.
      mockedFetchQueue.mockResolvedValue([inReviewDoc, draftDoc]);
      mockedGetJudgments.mockResolvedValue({ latest: null, history: [] });

      renderWithClient(<PendingPanel />);

      await screen.findByText("In Review Row");
      await screen.findByText("Draft Row");
      expect(screen.getByText("in-review")).toBeInTheDocument();
      expect(screen.getByText("draft")).toBeInTheDocument();

      // Row order in the DOM matches the mocked (already-merged) order —
      // no independent client-side re-sort on top.
      const titles = screen.getAllByText(/Row$/).map((el) => el.textContent);
      expect(titles).toEqual(["In Review Row", "Draft Row"]);
    });

    it("passes fetchReviewQueueRows a project argument but no author/type/since opts by default (no behavior change for existing callers)", async () => {
      mockedFetchQueue.mockResolvedValue([]);

      renderWithClient(<PendingPanel />);

      await screen.findByText("No documents pending review.");
      expect(mockedFetchQueue).toHaveBeenCalledWith(null);
    });
  });
});
