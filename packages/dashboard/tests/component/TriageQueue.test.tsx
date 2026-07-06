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
 *     clicking "Adjudicate" reveals the note input + Approve/Reject buttons.
 *   REGRESSION — a non-empty `warnings` array on a successful approve fires
 *     toast.warning in addition to toast.success (SPEC-033 F1 calibration
 *     hook surfacing).
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

import { apiGetPendingReview, apiGetJudgments } from "@/lib/api";
import { apiApproveDoc, apiRejectDoc } from "../../src/api/mutations";
import { TriageQueue } from "../../src/components/TriageQueue";

const mockedGetPending = vi.mocked(apiGetPendingReview);
const mockedGetJudgments = vi.mocked(apiGetJudgments);
const mockedApprove = vi.mocked(apiApproveDoc);
const mockedReject = vi.mocked(apiRejectDoc);

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

      mockedGetPending.mockResolvedValue([freshEscalation, staleEscalation, approved]);
      mockedGetJudgments.mockImplementation(async (docId: string) => {
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
      mockedGetPending.mockResolvedValue([doc]);
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
      mockedGetPending.mockResolvedValue([doc]);
      mockedGetJudgments.mockResolvedValue({ latest: null, history: [] });

      const user = userEvent.setup();
      renderWithClient(<TriageQueue />);

      await screen.findByText("Some Doc");
      expect(screen.queryByLabelText(`Calibration note for ${doc.title}`)).not.toBeInTheDocument();

      await user.click(screen.getByText("Adjudicate"));

      expect(screen.getByLabelText(`Calibration note for ${doc.title}`)).toBeInTheDocument();
      expect(screen.getByText("Approve")).toBeInTheDocument();
      expect(screen.getByText("Reject")).toBeInTheDocument();
    });
  });

  describe("happy path: calibration note passes through", () => {
    it("calls apiApproveDoc with the trimmed calibration note", async () => {
      const doc = makePendingDoc({ id: "01HDOC00000000000000000001", title: "Some Doc" });
      mockedGetPending.mockResolvedValue([doc]);
      mockedGetJudgments.mockResolvedValue({ latest: null, history: [] });
      mockedApprove.mockResolvedValue({ doc: {} as never, warnings: [] });

      const user = userEvent.setup();
      renderWithClient(<TriageQueue />);

      await screen.findByText("Some Doc");
      await user.click(screen.getByText("Adjudicate"));
      await user.type(screen.getByLabelText(`Calibration note for ${doc.title}`), "  looks solid  ");
      await user.click(screen.getByText("Approve"));

      await waitFor(() => expect(mockedApprove).toHaveBeenCalledWith(doc.id, { calibrationNote: "looks solid" }));
    });

    it("omits calibrationNote entirely when the note is left blank", async () => {
      const doc = makePendingDoc({ id: "01HDOC00000000000000000001", title: "Some Doc" });
      mockedGetPending.mockResolvedValue([doc]);
      mockedGetJudgments.mockResolvedValue({ latest: null, history: [] });
      mockedReject.mockResolvedValue({ doc: {} as never, warnings: [] });

      const user = userEvent.setup();
      renderWithClient(<TriageQueue />);

      await screen.findByText("Some Doc");
      await user.click(screen.getByText("Adjudicate"));
      await user.click(screen.getByText("Reject"));

      await waitFor(() => expect(mockedReject).toHaveBeenCalledWith(doc.id, undefined, {}));
    });
  });

  describe("regression: warnings surface", () => {
    it("fires toast.warning in addition to toast.success when the response carries warnings", async () => {
      const doc = makePendingDoc({ id: "01HDOC00000000000000000001", title: "Some Doc" });
      mockedGetPending.mockResolvedValue([doc]);
      mockedGetJudgments.mockResolvedValue({ latest: null, history: [] });
      mockedApprove.mockResolvedValue({ doc: {} as never, warnings: ["Calibration write failed: disk full"] });

      const user = userEvent.setup();
      renderWithClient(<TriageQueue />);

      await screen.findByText("Some Doc");
      await user.click(screen.getByText("Adjudicate"));
      await user.click(screen.getByText("Approve"));

      await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Document approved"));
      expect(toastWarning).toHaveBeenCalledWith("Calibration write failed: disk full");
    });
  });

  describe("error", () => {
    it("surfaces a toast.error and keeps the adjudicate panel open when apiApproveDoc rejects", async () => {
      const doc = makePendingDoc({ id: "01HDOC00000000000000000001", title: "Some Doc" });
      mockedGetPending.mockResolvedValue([doc]);
      mockedGetJudgments.mockResolvedValue({ latest: null, history: [] });
      mockedApprove.mockRejectedValue(new Error("network down"));

      const user = userEvent.setup();
      renderWithClient(<TriageQueue />);

      await screen.findByText("Some Doc");
      await user.click(screen.getByText("Adjudicate"));
      await user.click(screen.getByText("Approve"));

      await waitFor(() => expect(toastError).toHaveBeenCalled());
      expect(screen.getByLabelText(`Calibration note for ${doc.title}`)).toBeInTheDocument();
    });
  });
});
