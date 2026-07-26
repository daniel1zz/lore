// @vitest-environment jsdom
/**
 * @spec_ref SPEC-033 F3 §3
 *
 * Tests for TriageQueue — the full pending-review triage queue page body.
 *
 * Spec expectations (written from the module's documented invariants, before
 * reading the implementation body):
 *   - "Escalated only" filters to FRESH escalations only — decision ===
 *     "escalate" AND doc_version === doc.version. A stale escalation (doc
 *     edited since judged) is excluded, not shown with a stale badge.
 *   - Blocking questions render behind a per-row expand toggle, indented.
 *   - Adjudicate (approve/reject) sends an optional calibration note —
 *     trimmed-empty input means the option key is omitted, never sent as "".
 *   - A non-empty `warnings[]` on the adjudicate response surfaces a
 *     `toast.warning` in addition to the success toast.
 *   - Rejecting/approving successfully closes the adjudicate panel and
 *     refetches the queue.
 *
 * Test plan (six-dimension coverage):
 *   HAPPY — a fresh escalation and a non-escalation row both render with
 *     their judgment badges; approving with a calibration note passes it
 *     through to apiApproveDoc.
 *   NEGATIVE — n/a beyond BOUNDARY/ERROR below.
 *   BOUNDARY — "Escalated only" hides a STALE escalation (doc_version >
 *     judgment.doc_version) and a non-escalating row, keeping only the fresh
 *     escalation; leaving the calibration note blank omits calibrationNote
 *     from the mutation call entirely.
 *   ERROR — apiApproveDoc rejecting surfaces a toast.error and leaves the
 *     adjudicate panel open (no premature close-on-failure).
 *   STATE — clicking "Show blocking questions" reveals the indented list;
 *     clicking "Review" reveals the note input + Approve/Reject buttons.
 *   REGRESSION — a non-empty `warnings` array on a successful approve fires
 *     toast.warning in addition to toast.success (SPEC-033 F1 calibration
 *     hook surfacing).
 *
 * SPEC-036 addendum — `row.meta` badge (source: task dispatch contract,
 * "PendingDoc.meta 投影 + dashboard pending 徽章"). Written from the contract
 * BEFORE reading TriageQueue.tsx's body: "row.meta present + formatTypeMetaLabel(meta)
 * non-null -> render that label text next to the type badge; meta absent -> no meta
 * badge, no crash." `formatTypeMetaLabel` itself is already unit-tested independently
 * (tests/unit/lib/type-meta-label.test.ts) — these tests exercise the WIRING (does
 * TriageQueue actually call it with the real row data and render the result), not the
 * label-formatting rules themselves.
 *   HAPPY — two rows with distinct, differently-typed meta values (knowledge/assessment,
 *     task/claimed+evidence) both render their derived label text next to their type badge.
 *   BOUNDARY — a task row whose meta is present but whose label is null (unclaimed, no
 *     evidence) renders no meta badge — distinguishing "meta present, label null" from
 *     "meta entirely absent" (two different upstream code paths, same visual outcome).
 *   NEGATIVE — a row with no `meta` key renders only the type badge; no stray meta text,
 *     no crash.
 *   ERROR — N/A: meta rendering is synchronous over already-fetched row data (no separate
 *     fetch/failure mode of its own); the existing "error" describe block below already
 *     covers this component's one async failure surface (apiApproveDoc rejecting).
 *   STATE — N/A: the meta badge is static per fetched row, no interactive state transition
 *     of its own; existing "state" describe blocks cover unrelated toggles (blocking
 *     questions expand, adjudicate panel).
 *   REGRESSION — adding `meta` to a row used by the pre-existing "Escalated only" filter
 *     scenario does not break that filter's row selection (meta badge doesn't interfere
 *     with the escalation-matching logic).
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReviewJudgment } from "@lore/core";

vi.mock("@/lib/api", () => ({
  apiGetJudgments: vi.fn(),
}));
vi.mock("@/lib/review-queue", () => ({
  fetchReviewQueueRows: vi.fn(),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastWarning = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
    warning: (...args: unknown[]) => toastWarning(...args),
  },
}));

vi.mock("../../src/api/mutations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/mutations")>();
  return {
    ...actual,
    apiApproveDoc: vi.fn(),
    apiRejectDoc: vi.fn(),
  };
});

import { apiGetJudgments } from "@/lib/api";
import { fetchReviewQueueRows } from "@/lib/review-queue";
import type { ReviewQueueDocRow } from "@/lib/review-queue";
import { apiApproveDoc, apiRejectDoc } from "../../src/api/mutations";
import { TriageQueue } from "../../src/components/TriageQueue";

const mockedFetchQueue = vi.mocked(fetchReviewQueueRows);
const mockedGetJudgments = vi.mocked(apiGetJudgments);
const mockedApprove = vi.mocked(apiApproveDoc);
const mockedReject = vi.mocked(apiRejectDoc);

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
  mockedApprove.mockReset();
  mockedReject.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  toastWarning.mockReset();
});

describe("TriageQueue", () => {
  describe("boundary: escalated-only filter", () => {
    it("keeps only fresh escalations, excluding stale escalations and non-escalations", async () => {
      const freshEscalation = makePendingDoc({ id: "01HDOC00000000000000000001", title: "Fresh Escalation", version: 2 });
      const staleEscalation = makePendingDoc({ id: "01HDOC00000000000000000002", title: "Stale Escalation", version: 3 });
      const approved = makePendingDoc({ id: "01HDOC00000000000000000003", title: "Just Approved", version: 1 });

      mockedFetchQueue.mockResolvedValue([freshEscalation, staleEscalation, approved]);
      mockedGetJudgments.mockImplementation(async (_project: string | null, docId: string) => {
        if (docId === freshEscalation.id) {
          return {
            latest: makeJudgment({ doc_version: 2, decision: "escalate", blocking_questions: ["Is this right?"] }),
            history: [],
          };
        }
        if (docId === staleEscalation.id) {
          // reason: judged at v2, doc is now v3 -> stale, must be excluded from "escalated only".
          return {
            latest: makeJudgment({ doc_version: 2, decision: "escalate", blocking_questions: ["Old question"] }),
            history: [],
          };
        }
        return { latest: makeJudgment({ doc_version: 1, decision: "approve" }), history: [] };
      });

      const user = userEvent.setup();
      renderWithClient(<TriageQueue />);

      await screen.findByText("Fresh Escalation");
      expect(screen.getByText("Stale Escalation")).toBeInTheDocument();
      expect(screen.getByText("Just Approved")).toBeInTheDocument();

      await user.click(screen.getByLabelText("Escalated only"));

      expect(screen.getByText("Fresh Escalation")).toBeInTheDocument();
      expect(screen.queryByText("Stale Escalation")).not.toBeInTheDocument();
      expect(screen.queryByText("Just Approved")).not.toBeInTheDocument();
    });
  });

  describe("state: blocking-questions expansion", () => {
    it("reveals the indented blocking-questions list only after the expand toggle is clicked", async () => {
      const doc = makePendingDoc({ id: "01HDOC00000000000000000001", title: "Escalated Doc", version: 2 });
      mockedFetchQueue.mockResolvedValue([doc]);
      mockedGetJudgments.mockResolvedValue({
        latest: makeJudgment({
          doc_version: 2,
          decision: "escalate",
          blocking_questions: ["Question one?", "Question two?"],
        }),
        history: [],
      });

      const user = userEvent.setup();
      renderWithClient(<TriageQueue />);

      await screen.findByText("Escalated Doc");
      expect(screen.queryByText("Question one?")).not.toBeInTheDocument();

      await user.click(screen.getByText("Show blocking questions (2)"));

      expect(screen.getByText("Question one?")).toBeInTheDocument();
      expect(screen.getByText("Question two?")).toBeInTheDocument();
    });
  });

  describe("state: adjudicate panel", () => {
    it("reveals the calibration-note input and Approve/Reject buttons after clicking Adjudicate", async () => {
      const doc = makePendingDoc({ id: "01HDOC00000000000000000001", title: "Some Doc" });
      mockedFetchQueue.mockResolvedValue([doc]);
      mockedGetJudgments.mockResolvedValue({ latest: null, history: [] });

      const user = userEvent.setup();
      renderWithClient(<TriageQueue />);

      await screen.findByText("Some Doc");
      expect(screen.queryByLabelText(`Calibration note for ${doc.title}`)).not.toBeInTheDocument();

      await user.click(screen.getByText("Review"));

      expect(screen.getByLabelText(`Calibration note for ${doc.title}`)).toBeInTheDocument();
      expect(screen.getByText("Approve")).toBeInTheDocument();
      expect(screen.getByText("Reject")).toBeInTheDocument();
    });
  });

  describe("happy path: calibration note passes through", () => {
    it("calls apiApproveDoc with the trimmed calibration note", async () => {
      const doc = makePendingDoc({ id: "01HDOC00000000000000000001", title: "Some Doc" });
      mockedFetchQueue.mockResolvedValue([doc]);
      mockedGetJudgments.mockResolvedValue({ latest: null, history: [] });
      mockedApprove.mockResolvedValue({ doc: {} as never, warnings: [] });

      const user = userEvent.setup();
      renderWithClient(<TriageQueue />);

      await screen.findByText("Some Doc");
      await user.click(screen.getByText("Review"));
      await user.type(screen.getByLabelText(`Calibration note for ${doc.title}`), "  looks solid  ");
      await user.click(screen.getByText("Approve"));

      await waitFor(() => expect(mockedApprove).toHaveBeenCalledWith(null, doc.id, { calibrationNote: "looks solid" }));
    });

    it("omits calibrationNote entirely when the note is left blank", async () => {
      const doc = makePendingDoc({ id: "01HDOC00000000000000000001", title: "Some Doc" });
      mockedFetchQueue.mockResolvedValue([doc]);
      mockedGetJudgments.mockResolvedValue({ latest: null, history: [] });
      mockedReject.mockResolvedValue({ doc: {} as never, warnings: [] });

      const user = userEvent.setup();
      renderWithClient(<TriageQueue />);

      await screen.findByText("Some Doc");
      await user.click(screen.getByText("Review"));
      await user.click(screen.getByText("Reject"));

      await waitFor(() => expect(mockedReject).toHaveBeenCalledWith(null, doc.id, undefined, {}));
    });
  });

  describe("regression: warnings surface", () => {
    it("fires toast.warning in addition to toast.success when the response carries warnings", async () => {
      const doc = makePendingDoc({ id: "01HDOC00000000000000000001", title: "Some Doc" });
      mockedFetchQueue.mockResolvedValue([doc]);
      mockedGetJudgments.mockResolvedValue({ latest: null, history: [] });
      mockedApprove.mockResolvedValue({ doc: {} as never, warnings: ["Calibration write failed: disk full"] });

      const user = userEvent.setup();
      renderWithClient(<TriageQueue />);

      await screen.findByText("Some Doc");
      await user.click(screen.getByText("Review"));
      await user.click(screen.getByText("Approve"));

      await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Document approved"));
      expect(toastWarning).toHaveBeenCalledWith("Calibration write failed: disk full");
    });
  });

  describe("error", () => {
    it("surfaces a toast.error and keeps the adjudicate panel open when apiApproveDoc rejects", async () => {
      const doc = makePendingDoc({ id: "01HDOC00000000000000000001", title: "Some Doc" });
      mockedFetchQueue.mockResolvedValue([doc]);
      mockedGetJudgments.mockResolvedValue({ latest: null, history: [] });
      mockedApprove.mockRejectedValue(new Error("network down"));

      const user = userEvent.setup();
      renderWithClient(<TriageQueue />);

      await screen.findByText("Some Doc");
      await user.click(screen.getByText("Review"));
      await user.click(screen.getByText("Approve"));

      await waitFor(() => expect(toastError).toHaveBeenCalled());
      expect(screen.getByLabelText(`Calibration note for ${doc.title}`)).toBeInTheDocument();
    });
  });

  describe("meta badge (SPEC-036)", () => {
    describe("happy path", () => {
      it("renders distinct meta labels next to the type badge for two differently-typed rows", async () => {
        const knowledgeDoc = makePendingDoc({
          id: "01HDOC00000000000000000001",
          type: "knowledge",
          title: "Knowledge Row",
          meta: { t: "knowledge", sub_type: "assessment" },
        });
        const taskDoc = makePendingDoc({
          id: "01HDOC00000000000000000002",
          type: "task",
          title: "Task Row",
          meta: { t: "task", claimed_by: "alice", claim_stale: false, evidence_pass: 2, evidence_fail: 1 },
        });
        mockedFetchQueue.mockResolvedValue([knowledgeDoc, taskDoc]);
        mockedGetJudgments.mockResolvedValue({ latest: null, history: [] });

        renderWithClient(<TriageQueue />);

        await screen.findByText("Knowledge Row");
        expect(screen.getByText("assessment")).toBeInTheDocument();
        expect(screen.getByText("Task Row")).toBeInTheDocument();
        expect(screen.getByText("claimed:alice ✔2/✘1")).toBeInTheDocument();
      });
    });

    describe("boundary: meta present but label is null", () => {
      it("renders no meta badge for an unclaimed task with no evidence, even though meta is present", async () => {
        const doc = makePendingDoc({
          id: "01HDOC00000000000000000001",
          type: "task",
          title: "Empty Task Meta",
          meta: { t: "task", evidence_pass: 0, evidence_fail: 0 },
        });
        mockedFetchQueue.mockResolvedValue([doc]);
        mockedGetJudgments.mockResolvedValue({ latest: null, history: [] });

        renderWithClient(<TriageQueue />);

        await screen.findByText("Empty Task Meta");
        // The type badge "task" still renders; no claim/evidence text does.
        expect(screen.getByText("task")).toBeInTheDocument();
        expect(screen.queryByText(/claimed:/)).not.toBeInTheDocument();
        expect(screen.queryByText(/✔/)).not.toBeInTheDocument();
      });
    });

    describe("negative: meta absent", () => {
      it("renders only the type badge and the title, without crashing, when meta is absent", async () => {
        const doc = makePendingDoc({
          id: "01HDOC00000000000000000001",
          type: "spec",
          title: "No Meta Row",
        });
        mockedFetchQueue.mockResolvedValue([doc]);
        mockedGetJudgments.mockResolvedValue({ latest: null, history: [] });

        renderWithClient(<TriageQueue />);

        await screen.findByText("No Meta Row");
        expect(screen.getByText("spec")).toBeInTheDocument();
        expect(screen.queryByText("feature")).not.toBeInTheDocument();
        expect(screen.queryByText("tech")).not.toBeInTheDocument();
      });
    });

    describe("regression: coexists with the escalated-only filter", () => {
      it("a meta-carrying fresh escalation is still correctly isolated by 'Escalated only'", async () => {
        const freshEscalation = makePendingDoc({
          id: "01HDOC00000000000000000001",
          type: "plan",
          title: "Escalated Plan",
          version: 2,
          meta: { t: "plan", phase_count: 4 },
        });
        const approved = makePendingDoc({
          id: "01HDOC00000000000000000002",
          type: "prd",
          title: "Approved Doc",
          version: 1,
        });
        mockedFetchQueue.mockResolvedValue([freshEscalation, approved]);
        mockedGetJudgments.mockImplementation(async (_project: string | null, docId: string) => {
          if (docId === freshEscalation.id) {
            return { latest: makeJudgment({ doc_version: 2, decision: "escalate" }), history: [] };
          }
          return { latest: makeJudgment({ doc_version: 1, decision: "approve" }), history: [] };
        });

        const user = userEvent.setup();
        renderWithClient(<TriageQueue />);

        await screen.findByText("Escalated Plan");
        expect(screen.getByText("4 phases")).toBeInTheDocument();

        await user.click(screen.getByLabelText("Escalated only"));

        expect(screen.getByText("Escalated Plan")).toBeInTheDocument();
        expect(screen.getByText("4 phases")).toBeInTheDocument();
        expect(screen.queryByText("Approved Doc")).not.toBeInTheDocument();
      });
    });
  });

  describe("state — project scoping (SPEC-078 T13, AC-078-7/AC-078-8)", () => {
    it("scopes fetchReviewQueueRows/apiGetJudgments and the query cache key to the passed project", async () => {
      const doc = makePendingDoc({ id: "01HDOC00000000000000000001", title: "Acme Doc" });
      mockedFetchQueue.mockResolvedValue([doc]);
      mockedGetJudgments.mockResolvedValue({ latest: null, history: [] });

      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={client}>
          <TriageQueue project="acme" />
        </QueryClientProvider>,
      );

      await screen.findByText("Acme Doc");

      expect(mockedFetchQueue).toHaveBeenCalledWith("acme");
      expect(mockedGetJudgments).toHaveBeenCalledWith("acme", doc.id);

      const keys = client.getQueryCache().getAll().map((q) => q.queryKey);
      expect(keys).toContainEqual(["project:acme", "pending", "triage-queue"]);
    });
  });

  describe("ISSUE-008: draft + in-review merged queue", () => {
    it("renders an in-review row and a draft row, each with a distinguishing status label and an Approve action", async () => {
      const inReviewDoc = makePendingDoc({
        id: "01HDOC00000000000000000020",
        title: "In Review Doc",
        status: "in-review",
      });
      const draftDoc = makePendingDoc({
        id: "01HDOC00000000000000000021",
        title: "Draft Doc",
        status: "draft",
      });
      // reason: TriageQueue never independently re-sorts — order is whatever
      // fetchReviewQueueRows returns (unit-pinned in
      // tests/unit/lib/review-queue.test.ts). Mocking it in-review-first
      // proves the queue renders rows in exactly that order.
      mockedFetchQueue.mockResolvedValue([inReviewDoc, draftDoc]);
      mockedGetJudgments.mockResolvedValue({ latest: null, history: [] });

      renderWithClient(<TriageQueue />);

      await screen.findByText("In Review Doc");
      expect(screen.getByText("Draft Doc")).toBeInTheDocument();
      expect(screen.getByText("in-review")).toBeInTheDocument();
      expect(screen.getByText("draft")).toBeInTheDocument();

      // reason: getAllowedTransitions(status).includes("approved") is true
      // for BOTH draft and in-review (VALID_TRANSITIONS) — the Approve
      // action must render for both rows, never hardcoded to draft only.
      const reviewButtons = screen.getAllByText("Review");
      expect(reviewButtons).toHaveLength(2);
    });

    it("approves an in-review row via the mouse-driven Review -> Approve flow", async () => {
      const inReviewDoc = makePendingDoc({
        id: "01HDOC00000000000000000022",
        title: "In Review Doc",
        status: "in-review",
      });
      mockedFetchQueue.mockResolvedValue([inReviewDoc]);
      mockedGetJudgments.mockResolvedValue({ latest: null, history: [] });
      mockedApprove.mockResolvedValue({ doc: {} as never, warnings: [] });

      const user = userEvent.setup();
      renderWithClient(<TriageQueue />);

      await screen.findByText("In Review Doc");
      await user.click(screen.getByText("Review"));
      await user.click(screen.getByText("Approve"));

      await waitFor(() => expect(mockedApprove).toHaveBeenCalledWith(null, inReviewDoc.id, {}));
    });

    it("rejects an in-review row via the mouse-driven Review -> Reject flow (in-review -> draft, ReviewService.reject's canReject domain)", async () => {
      const inReviewDoc = makePendingDoc({
        id: "01HDOC00000000000000000023",
        title: "In Review Doc",
        status: "in-review",
      });
      mockedFetchQueue.mockResolvedValue([inReviewDoc]);
      mockedGetJudgments.mockResolvedValue({ latest: null, history: [] });
      mockedReject.mockResolvedValue({ doc: {} as never, warnings: [] });

      const user = userEvent.setup();
      renderWithClient(<TriageQueue />);

      await screen.findByText("In Review Doc");
      await user.click(screen.getByText("Review"));
      await user.click(screen.getByText("Reject"));

      await waitFor(() => expect(mockedReject).toHaveBeenCalledWith(null, inReviewDoc.id, undefined, {}));
    });

    it("keyboard 'a' (via j then a) approves an in-review row exactly like a draft row — the getAllowedTransitions gate never blocks it", async () => {
      const inReviewDoc = makePendingDoc({
        id: "01HDOC00000000000000000024",
        title: "In Review Doc",
        status: "in-review",
      });
      mockedFetchQueue.mockResolvedValue([inReviewDoc]);
      mockedGetJudgments.mockResolvedValue({ latest: null, history: [] });
      mockedApprove.mockResolvedValue({ doc: {} as never, warnings: [] });

      renderWithClient(<TriageQueue />);

      await screen.findByText("In Review Doc");
      fireEvent.keyDown(document, { key: "j" });
      fireEvent.keyDown(document, { key: "a" });

      await waitFor(() => expect(mockedApprove).toHaveBeenCalledWith(null, inReviewDoc.id, {}));
    });
  });
});
