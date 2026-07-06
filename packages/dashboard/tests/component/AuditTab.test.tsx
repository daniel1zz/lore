// @vitest-environment jsdom
/**
 * @spec_ref SPEC-033 F3 §2, §3
 *
 * Tests for AuditTab — the document detail Audit tab rendering the
 * append-only audit trail (`GET /api/audit/:docId`), with AI-judge actors
 * decoded via `parseAuditActor` and linked to their full judgment.
 *
 * Spec expectations (written from the module's documented invariants,
 * before reading the implementation body):
 *   - An AI-authored entry (`actor` starting "ai:...") decodes to a
 *     `{provider}@{prompt_version}` judge-identity badge, not the raw string.
 *   - A human-authored entry renders the raw actor name verbatim.
 *   - When an entry's `details.judgment_ref` resolves against the doc's
 *     judgment history, a "View judgment" toggle appears and expands to show
 *     decision/confidence/blocking_questions.
 *   - A dangling judgment_ref (no matching judgment in history) renders the
 *     entry with no crash and no "View judgment" toggle.
 *   - An empty audit trail renders "No audit history yet." with no per-entry
 *     rows.
 *
 * Test plan (six-dimension coverage):
 *   HAPPY — an AI "judge" entry with a resolvable judgment_ref decodes to a
 *     judge badge and expands to reveal the judgment on click.
 *   NEGATIVE — n/a beyond BOUNDARY/ERROR below.
 *   BOUNDARY — empty audit trail renders the empty state, not a blank list or
 *     a crash.
 *   ERROR — apiGetAuditForDoc rejecting renders the failure message.
 *   STATE — a human-authored "approve" entry renders the raw actor name, no
 *     judge badge, no "View judgment" toggle even though other entries may
 *     have one.
 *   REGRESSION — a judgment_ref that doesn't resolve to any judgment in
 *     history (e.g. judgments still loading, or pruned) does not render a
 *     "View judgment" toggle and does not throw.
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AuditEntry, ReviewJudgment } from "@lore/core";
import type { JudgmentsResponse } from "../../src/lib/api";

vi.mock("@/lib/api", () => ({
  apiGetAuditForDoc: vi.fn(),
  apiGetJudgments: vi.fn(),
}));

import { apiGetAuditForDoc, apiGetJudgments } from "@/lib/api";
import { AuditTab } from "../../src/components/AuditTab";

const mockedGetAudit = vi.mocked(apiGetAuditForDoc);
const mockedGetJudgments = vi.mocked(apiGetJudgments);

function makeJudgment(overrides: Partial<ReviewJudgment> = {}): ReviewJudgment {
  return {
    id: "01HJUDGE0000000000000000001",
    doc_id: "01HDOC000000000000000000001",
    doc_version: 2,
    decision: "escalate",
    confidence: 0.4,
    reasons: [{ dimension: "completeness", finding: "Missing AC coverage." }],
    checks: [{ check: "schema", outcome: "pass" }],
    blocking_questions: ["What is the rollback plan?"],
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
  mockedGetAudit.mockReset();
  mockedGetJudgments.mockReset();
});

describe("AuditTab", () => {
  describe("happy path", () => {
    it("decodes an AI judge entry to a judge badge and expands to show the judgment on click", async () => {
      const judgment = makeJudgment();
      const entries: AuditEntry[] = [
        {
          timestamp: "2026-07-06T00:00:00.000Z",
          actor: "ai:claude-cli:claude-sonnet-5:v1",
          session_id: "judge-01HDOC000000000000000000001",
          action: "judge",
          doc_id: "01HDOC000000000000000000001",
          details: { judgment_ref: judgment.id, version: 2 },
        },
      ];
      mockedGetAudit.mockResolvedValue(entries);
      mockedGetJudgments.mockResolvedValue({ latest: judgment, history: [judgment] } satisfies JudgmentsResponse);

      const user = userEvent.setup();
      renderWithClient(<AuditTab docId="01HDOC000000000000000000001" />);

      expect(await screen.findByText("claude-cli@v1")).toBeInTheDocument();
      expect(screen.getByText("judge")).toBeInTheDocument();

      await user.click(screen.getByText("View judgment"));

      expect(screen.getByText(/escalate/)).toBeInTheDocument();
      expect(screen.getByText("What is the rollback plan?")).toBeInTheDocument();
    });
  });

  describe("boundary: empty audit trail", () => {
    it('renders "No audit history yet." with no per-entry rows', async () => {
      mockedGetAudit.mockResolvedValue([]);
      mockedGetJudgments.mockResolvedValue({ latest: null, history: [] });

      renderWithClient(<AuditTab docId="01HDOC000000000000000000001" />);

      expect(await screen.findByText("No audit history yet.")).toBeInTheDocument();
      expect(screen.queryAllByTestId("audit-entry")).toHaveLength(0);
    });
  });

  describe("error", () => {
    it("renders a failure message when apiGetAuditForDoc rejects", async () => {
      mockedGetAudit.mockRejectedValue(new Error("network down"));
      mockedGetJudgments.mockResolvedValue({ latest: null, history: [] });

      renderWithClient(<AuditTab docId="01HDOC000000000000000000001" />);

      expect(await screen.findByText("Failed to load audit trail.")).toBeInTheDocument();
    });
  });

  describe("state: human-authored entry", () => {
    it("renders the raw actor name with no judge badge and no View judgment toggle", async () => {
      const entries: AuditEntry[] = [
        {
          timestamp: "2026-07-06T00:00:00.000Z",
          actor: "alice",
          session_id: "review-01HDOC000000000000000000001",
          action: "approve",
          doc_id: "01HDOC000000000000000000001",
          details: { reviewer: "alice", from_status: "draft", to_status: "approved", version: 3 },
        },
      ];
      mockedGetAudit.mockResolvedValue(entries);
      mockedGetJudgments.mockResolvedValue({ latest: null, history: [] });

      renderWithClient(<AuditTab docId="01HDOC000000000000000000001" />);

      expect(await screen.findByText("alice")).toBeInTheDocument();
      expect(screen.queryByLabelText("AI judge identity")).not.toBeInTheDocument();
      expect(screen.queryByText("View judgment")).not.toBeInTheDocument();
    });
  });

  describe("regression: dangling judgment_ref", () => {
    it("does not render a View judgment toggle when the ref doesn't resolve to any judgment", async () => {
      const entries: AuditEntry[] = [
        {
          timestamp: "2026-07-06T00:00:00.000Z",
          actor: "ai:claude-cli:claude-sonnet-5:v1",
          session_id: "judge-01HDOC000000000000000000001",
          action: "judge",
          doc_id: "01HDOC000000000000000000001",
          details: { judgment_ref: "01HJUDGE_PRUNED_00000000001", version: 2 },
        },
      ];
      mockedGetAudit.mockResolvedValue(entries);
      mockedGetJudgments.mockResolvedValue({ latest: null, history: [] });

      renderWithClient(<AuditTab docId="01HDOC000000000000000000001" />);

      expect(await screen.findByText("claude-cli@v1")).toBeInTheDocument();
      expect(screen.queryByText("View judgment")).not.toBeInTheDocument();
    });
  });
});
