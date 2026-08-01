// @vitest-environment jsdom
/**
 * Tests for AdjudicationBar — same-screen adjudication context for an
 * in-review doc (SPEC-075 R-8).
 * @spec_ref AC-075-4 (client half — the Playwright e2e suite covers the
 *   full server round-trip + calibration-record field-by-field assertion)
 *
 * Test plan (six-dimension coverage):
 *   HAPPY:
 *     - renders evidence-summary chips derived from summarizeForAdjudicationBar
 *     - Approve calls apiApproveDoc with the doc id and an optional calibration note
 *     - Reject calls apiRejectDoc with the doc id, undefined reason, and the note
 *   NEGATIVE:
 *     - renders null (nothing) for a doc whose status is NOT "in-review"
 *   BOUNDARY:
 *     - an empty/whitespace-only note is sent as NO calibrationNote (never "")
 *   ERROR:
 *     - a DashboardApiError from apiApproveDoc surfaces a toast.error, never a
 *       silent failure
 *   STATE:
 *     - onMutated absent hides the note/approve/reject controls entirely
 *       (read-only context) but still renders the chip summary
 *   REGRESSION:
 *     - a fail-count > 0 renders the destructive "fail" status chip
 *
 * Plan declared-scope conjunct chip (task-adjudicationbar-s-compact-status-
 * chip-still-derives-from — the compact chip used to derive its status from
 * `meets_floor` ALONE, so it disagreed with `PlanAttestationPanel`'s badge on
 * a scope-undeclared plan):
 *   HAPPY (this was the exact disagreement, now fixed):
 *     - a scope-undeclared plan panel (ratio conjunct alone passing) renders
 *       the neutral-outline "scope undeclared" chip, never the passing chip
 *   CONTROL (AC #3):
 *     - a plan that genuinely meets both conjuncts still renders the passing
 *       "pass" chip on the compact bar (not turned unconditionally negative)
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DocRecord, EvidencePanelProjection } from "@lore/core";

vi.mock("../../src/api/mutations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/mutations")>();
  return {
    ...actual,
    apiApproveDoc: vi.fn(),
    apiRejectDoc: vi.fn(),
  };
});

const toastError = vi.fn();
const toastSuccess = vi.fn();
const toastWarning = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
    warning: (...args: unknown[]) => toastWarning(...args),
  },
}));

import { apiApproveDoc, apiRejectDoc, DashboardApiError } from "../../src/api/mutations";
import { AdjudicationBar } from "../../src/components/AdjudicationBar";

const mockedApprove = vi.mocked(apiApproveDoc);
const mockedReject = vi.mocked(apiRejectDoc);

function makeDoc(overrides: Partial<DocRecord> = {}): DocRecord {
  return {
    id: "01HTASK00000000000000000001",
    slug: "task-fixture",
    title: "Task Fixture",
    type: "task",
    status: "in-review",
    priority: "medium",
    content: "",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    created_by: null,
    parent_id: "01HPLAN0000000000000000001",
    tags: [],
    extra: {},
    version: 3,
    ...overrides,
  };
}

const taskPanelWithFail: EvidencePanelProjection = {
  doc_type: "task",
  ac_refs: [],
  evidence: [
    { oracle: "test", command: "bun test", result: "fail", recorded_at: "2026-01-01T00:00:00.000Z", recorded_by: "alice" },
  ],
};

const otherPanel: EvidencePanelProjection = { doc_type: "other" };

/**
 * A non-vacuous plan panel (`total_evidence > 0`) whose RATIO conjunct alone
 * passes but whose declared-scope conjunct is UNRESOLVED — the EXACT fixture
 * shape `PlanAttestationPanel.test.tsx`'s "external oracle" test uses, which
 * renders that panel's badge as "scope undeclared". This is the fixture that
 * used to make the compact chip disagree with the panel
 * (task-adjudicationbar-s-compact-status-chip-still-derives-from).
 */
const planPanelScopeUndeclared: EvidencePanelProjection = {
  doc_type: "plan",
  attestation: {
    total_evidence: 4,
    attested: 2,
    ratio: 0.5,
    min_ratio: 0.5,
    claimed_ac_coverage: { exercised_acs: [], unattested_acs: [], meets_coverage: true },
    meets_floor: true,
    zero_attested_tasks: [],
  },
  tasks: [],
  declared_scope_coverage: { declared_acs: [], unattested_acs: [], scope_undeclared: true, meets_coverage: true },
  declared_scope_verdict: { notApplicable: true, reason: "scope-undeclared", referent: "plan-x" },
};

/** Pairs with {@link planPanelScopeUndeclared} — the CONTROL fixture: a plan
 *  that genuinely resolves BOTH conjuncts to a pass. */
const planPanelMeetsFloor: EvidencePanelProjection = {
  ...planPanelScopeUndeclared,
  declared_scope_coverage: { declared_acs: ["AC-1"], unattested_acs: [], scope_undeclared: false, meets_coverage: true },
  declared_scope_verdict: { ok: true },
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("AdjudicationBar", () => {
  describe("happy path", () => {
    it("renders evidence-summary chips derived from the panel", () => {
      render(<AdjudicationBar doc={makeDoc()} panel={taskPanelWithFail} onMutated={vi.fn()} />);
      expect(screen.getByText("fail")).toBeInTheDocument();
      expect(screen.getByText("1 evidence")).toBeInTheDocument();
      expect(screen.getByText("1 fail")).toBeInTheDocument();
    });

    it("Approve calls apiApproveDoc with the doc id and an optional calibration note", async () => {
      mockedApprove.mockResolvedValue({ doc: makeDoc({ status: "approved" }), warnings: [] });
      const user = userEvent.setup();
      render(<AdjudicationBar doc={makeDoc()} panel={otherPanel} onMutated={vi.fn()} />);

      await user.type(screen.getByLabelText("Calibration note for Task Fixture"), "Looks correct");
      await user.click(screen.getByRole("button", { name: "Approve" }));

      expect(mockedApprove).toHaveBeenCalledWith(null, "01HTASK00000000000000000001", { calibrationNote: "Looks correct" });
      expect(toastSuccess).toHaveBeenCalledWith("Document approved");
    });

    it("Reject calls apiRejectDoc with the doc id, undefined reason, and the note", async () => {
      mockedReject.mockResolvedValue({ doc: makeDoc({ status: "draft" }), warnings: [] });
      const user = userEvent.setup();
      render(<AdjudicationBar doc={makeDoc()} panel={otherPanel} onMutated={vi.fn()} />);

      await user.type(screen.getByLabelText("Calibration note for Task Fixture"), "Missed AC-3");
      await user.click(screen.getByRole("button", { name: "Reject" }));

      expect(mockedReject).toHaveBeenCalledWith(null, "01HTASK00000000000000000001", undefined, { calibrationNote: "Missed AC-3" });
      expect(toastSuccess).toHaveBeenCalledWith("Document rejected");
    });
  });

  describe("negative", () => {
    it("renders nothing for a doc whose status is not in-review", () => {
      const { container } = render(<AdjudicationBar doc={makeDoc({ status: "draft" })} panel={otherPanel} onMutated={vi.fn()} />);
      expect(container).toBeEmptyDOMElement();
    });
  });

  describe("boundary", () => {
    it("sends no calibrationNote when the note is empty/whitespace-only", async () => {
      mockedApprove.mockResolvedValue({ doc: makeDoc({ status: "approved" }), warnings: [] });
      const user = userEvent.setup();
      render(<AdjudicationBar doc={makeDoc()} panel={otherPanel} onMutated={vi.fn()} />);

      await user.type(screen.getByLabelText("Calibration note for Task Fixture"), "   ");
      await user.click(screen.getByRole("button", { name: "Approve" }));

      expect(mockedApprove).toHaveBeenCalledWith(null, "01HTASK00000000000000000001", {});
    });
  });

  describe("error", () => {
    it("surfaces a toast.error on a DashboardApiError from apiApproveDoc", async () => {
      mockedApprove.mockRejectedValue(new DashboardApiError(500, "STORE_ERROR", "boom"));
      const user = userEvent.setup();
      render(<AdjudicationBar doc={makeDoc()} panel={otherPanel} onMutated={vi.fn()} />);

      await user.click(screen.getByRole("button", { name: "Approve" }));

      expect(toastError).toHaveBeenCalledWith("boom");
      expect(toastSuccess).not.toHaveBeenCalled();
    });
  });

  describe("state", () => {
    it("hides note/approve/reject controls (but keeps the chip summary) when onMutated is absent", () => {
      render(<AdjudicationBar doc={makeDoc()} panel={taskPanelWithFail} />);
      expect(screen.getByText("fail")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
    });
  });

  describe("regression", () => {
    it("renders the destructive 'fail' status chip when fail_count > 0", () => {
      render(<AdjudicationBar doc={makeDoc()} panel={taskPanelWithFail} onMutated={vi.fn()} />);
      const statusChip = screen.getByText("fail");
      expect(statusChip.className).toMatch(/destructive/);
    });
  });

  describe("project identity label (SPEC-078 T10 R-13, AC-078-7 component-test half)", () => {
    it("renders the active project's name adjacent to the approve/reject controls", () => {
      render(<AdjudicationBar doc={makeDoc()} panel={taskPanelWithFail} project="acme" onMutated={vi.fn()} />);

      const label = screen.getByTestId("project-identity-label");
      expect(label).toHaveTextContent("acme");
      // reason: "adjacent to the controls" — same DOM container as Approve/Reject,
      // not merely present somewhere on the page.
      const approveButton = screen.getByRole("button", { name: "Approve" });
      expect(label.parentElement).toBe(approveButton.parentElement);
    });

    it("renders nothing (registry-less mode) when project is absent", () => {
      render(<AdjudicationBar doc={makeDoc()} panel={taskPanelWithFail} onMutated={vi.fn()} />);
      expect(screen.queryByTestId("project-identity-label")).not.toBeInTheDocument();
    });

    it("threads project into apiApproveDoc/apiRejectDoc so a write lands in the SELECTED project", async () => {
      mockedApprove.mockResolvedValue({ doc: makeDoc({ status: "approved" }), warnings: [] });
      const user = userEvent.setup();
      render(<AdjudicationBar doc={makeDoc()} panel={otherPanel} project="acme" onMutated={vi.fn()} />);

      await user.click(screen.getByRole("button", { name: "Approve" }));

      expect(mockedApprove).toHaveBeenCalledWith("acme", "01HTASK00000000000000000001", {});
    });
  });

  describe("plan declared-scope conjunct chip (task-adjudicationbar-s-compact-status-chip-still-derives-from)", () => {
    it("HAPPY (this was the exact disagreement, now fixed): renders the neutral 'scope undeclared' chip, never a passing chip, for a plan whose declared scope is undeclared", () => {
      render(<AdjudicationBar doc={makeDoc({ type: "plan" })} panel={planPanelScopeUndeclared} onMutated={vi.fn()} />);

      const chip = screen.getByText("scope undeclared");
      expect(chip).toBeInTheDocument();
      // reason: outline variant renders neither the destructive nor secondary
      // classes — the same neutral styling PlanAttestationPanel's "scope
      // undeclared" badge uses, distinguishing it from a real pass/fail chip.
      expect(chip.className).not.toMatch(/destructive/);
      expect(chip.className).not.toMatch(/bg-secondary/);
      expect(screen.queryByText("pass")).not.toBeInTheDocument();
      expect(screen.queryByText("fail")).not.toBeInTheDocument();
    });

    it("CONTROL (AC #3, guards against an unconditionally-negative chip): renders the passing 'pass' chip for a plan that genuinely meets both conjuncts", () => {
      render(<AdjudicationBar doc={makeDoc({ type: "plan" })} panel={planPanelMeetsFloor} onMutated={vi.fn()} />);

      const chip = screen.getByText("pass");
      expect(chip).toBeInTheDocument();
      expect(chip.className).toMatch(/bg-secondary/);
      expect(screen.queryByText("scope undeclared")).not.toBeInTheDocument();
    });
  });
});
