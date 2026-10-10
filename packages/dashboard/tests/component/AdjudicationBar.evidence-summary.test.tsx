// @vitest-environment jsdom
/**
 * BR-991 falsifier (AC-P0C-5): beside approve and reject, an in-review doc's
 * page shows an evidence summary — overall state ('none' when there is no
 * evidence), record count, runner-recorded count, pass count, fail count —
 * and the review queue offers approve and reject on a doc with zero evidence.
 *
 * Test plan (six-dimension coverage):
 *   HAPPY — a 3-record fixture (2 runner-recorded, 2 pass, 1 fail) renders
 *     exactly "3 evidence", "2 attested" (runner-recorded), "2 pass", "1 fail".
 *   NEGATIVE — a zero-evidence doc renders no pass/fail count chips.
 *   BOUNDARY — zero evidence renders overall state text "none" and "0 evidence".
 *   ERROR — n/a: pure render over a supplied projection (no fetch of its own).
 *   STATE — the review queue renders Approve and Reject for a zero-evidence
 *     in-review doc (evidence never gates adjudication).
 *   REGRESSION — zero evidence must never read as "pass".
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DocRecord, EvidencePanelProjection } from "@lore/core";

vi.mock("@/lib/api", () => ({
  apiGetJudgments: vi.fn(),
}));
vi.mock("@/lib/review-queue", () => ({
  fetchReviewQueueRows: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("../../src/api/mutations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/mutations")>();
  return { ...actual, apiApproveDoc: vi.fn(), apiRejectDoc: vi.fn() };
});

import { apiGetJudgments } from "@/lib/api";
import { fetchReviewQueueRows } from "@/lib/review-queue";
import { AdjudicationBar } from "../../src/components/AdjudicationBar";
import { TriageQueue } from "../../src/components/TriageQueue";

const mockedFetchQueue = vi.mocked(fetchReviewQueueRows);
const mockedGetJudgments = vi.mocked(apiGetJudgments);

function makeDoc(overrides: Partial<DocRecord> = {}): DocRecord {
  return {
    id: "01HTASK00000000000000000001",
    slug: "task-fixture",
    title: "Task Fixture",
    type: "task",
    role: "plan",
    status: "in-review",
    priority: "medium",
    content: "",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    created_by: "alice",
    parent_id: "01HPLAN0000000000000000001",
    tags: [],
    extra: {},
    version: 3,
    deleted_at: null,
    ...overrides,
  };
}

const ATTESTATION = { runner: "lore-cli", exit_code: 0, duration_ms: 100, timed_out: false } as const;

const zeroEvidencePanel: EvidencePanelProjection = { doc_type: "task", ac_refs: [], evidence: [] };

/** 3 records: 2 runner-recorded (carry `attestation`), 2 pass, 1 fail. */
const threeRecordPanel: EvidencePanelProjection = {
  doc_type: "task",
  ac_refs: [],
  evidence: [
    { oracle: "test", command: "bun test a", result: "pass", recorded_at: "2026-01-01T00:00:00.000Z", recorded_by: "alice", attestation: ATTESTATION },
    { oracle: "test", command: "bun test b", result: "pass", recorded_at: "2026-01-01T00:00:01.000Z", recorded_by: "alice", attestation: ATTESTATION },
    { oracle: "lint", command: "bun lint", result: "fail", recorded_at: "2026-01-01T00:00:02.000Z", recorded_by: "alice" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("BR-991 evidence summary", () => {
  it("a zero-evidence doc shows overall state text 'none' and record count '0' beside Approve and Reject", () => {
    render(<AdjudicationBar doc={makeDoc()} panel={zeroEvidencePanel} onMutated={vi.fn()} />);

    expect(screen.getByLabelText("Evidence summary")).toHaveTextContent("none");
    expect(screen.getByText("none")).toBeInTheDocument();
    expect(screen.getByText("0 evidence")).toBeInTheDocument();
    expect(screen.queryByText("pass")).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+ pass/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+ fail/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
  });

  it("a fixture of 3 records (2 runner-recorded, 2 pass, 1 fail) shows exactly 3 / 2 runner-recorded / 2 pass / 1 fail", () => {
    render(<AdjudicationBar doc={makeDoc()} panel={threeRecordPanel} onMutated={vi.fn()} />);

    expect(screen.getByText("3 evidence")).toBeInTheDocument();
    expect(screen.getByText("2 attested")).toBeInTheDocument();
    expect(screen.getByText("2 pass")).toBeInTheDocument();
    expect(screen.getByText("1 fail")).toBeInTheDocument();
    // overall state is fail-first, never 'none' once records exist
    expect(screen.queryByText("none")).not.toBeInTheDocument();
  });

  it("the review queue renders Approve and Reject buttons on a zero-evidence doc", async () => {
    // reason: the queue row carries no evidence at all — the rule says approve and
    // reject are still offered ("without evidence").
    mockedFetchQueue.mockResolvedValue([
      {
        id: "01HDOC00000000000000000031",
        type: "spec",
        title: "Zero Evidence Doc",
        status: "in-review",
        created_by: "alice",
        updated_at: "2026-07-01T00:00:00.000Z",
        version: 1,
      },
    ]);
    mockedGetJudgments.mockResolvedValue({ latest: null, history: [] });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <TriageQueue />
      </QueryClientProvider>,
    );

    await screen.findByText("Zero Evidence Doc");
    await userEvent.setup().click(screen.getByText("Review"));

    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
  });
});
