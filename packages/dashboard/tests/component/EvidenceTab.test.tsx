// @vitest-environment jsdom
/**
 * Tests for EvidenceTab — DocDetail's Evidence tab dispatcher (SPEC-075 D7).
 * @spec_ref AC-075-1, AC-075-2, AC-075-3
 *
 * Test plan (six-dimension coverage):
 *   HAPPY:
 *     - dispatches a task projection to TaskEvidencePanel
 *     - dispatches a spec projection to SpecAcCoveragePanel
 *     - dispatches a plan projection to PlanAttestationPanel
 *   NEGATIVE:
 *     - a doc_type: "other" projection renders nothing (defensive completeness;
 *       DocDetail never actually mounts this component for that doc_type)
 *   BOUNDARY:
 *     - renders skeletons while the query is loading
 *   ERROR:
 *     - a rejected query renders a labeled error, never a crash
 *   STATE:
 *     - n/a (owns no interactive state itself; a thin dispatcher)
 *   REGRESSION:
 *     - fetches via the SAME evidencePanelQueryKey(doc.id) other consumers use
 *       (cache-sharing contract with AdjudicationBarSection)
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DocRecord, EvidencePanelProjection } from "@lore/core";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/api")>();
  return { ...actual, apiGetEvidencePanel: vi.fn() };
});

import { apiGetEvidencePanel, evidencePanelQueryKey } from "@/lib/api";
import { EvidenceTab } from "../../src/components/EvidenceTab";

const mockedApiGetEvidencePanel = vi.mocked(apiGetEvidencePanel);

function makeTaskDoc(overrides: Partial<DocRecord> = {}): DocRecord {
  return {
    id: "01HDOC0000000000000000001",
    slug: "task-fixture",
    title: "Task Fixture",
    type: "task",
    role: "plan",
    status: "draft",
    priority: "medium",
    content: "",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    created_by: "alice",
    parent_id: null,
    tags: [],
    extra: {},
    version: 1,
    deleted_at: null,
    ...overrides,
  };
}

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("EvidenceTab", () => {
  describe("happy path", () => {
    it("dispatches a task projection to TaskEvidencePanel", async () => {
      const projection: EvidencePanelProjection = { doc_type: "task", evidence: [], ac_refs: [] };
      mockedApiGetEvidencePanel.mockResolvedValue(projection);
      renderWithClient(<EvidenceTab doc={makeTaskDoc()} />);
      expect(await screen.findByText("No verification evidence recorded yet.")).toBeInTheDocument();
    });

    it("dispatches a spec projection to SpecAcCoveragePanel", async () => {
      const projection: EvidencePanelProjection = { doc_type: "spec", criteria: [], coverage: [], task_count: 0 };
      mockedApiGetEvidencePanel.mockResolvedValue(projection);
      renderWithClient(<EvidenceTab doc={makeTaskDoc({ type: "spec" })} />);
      expect(await screen.findByText("This spec has no declared acceptance criteria.")).toBeInTheDocument();
    });

    it("dispatches a plan projection to PlanAttestationPanel", async () => {
      const projection: EvidencePanelProjection = {
        doc_type: "plan",
        attestation: {
          total_evidence: 0,
          attested: 0,
          ratio: null,
          min_ratio: 0.5,
          claimed_ac_coverage: { exercised_acs: [], unattested_acs: [], meets_coverage: true },
          meets_floor: true,
          zero_attested_tasks: [],
        },
        tasks: [],
        // reason: task-meets-floor-renders-pass-while-the-declared-scope-conjunct
        // — PlanEvidencePanel's two new required fields. This test's tasks: []
        // early-returns PlanAttestationPanel before either is ever read, so any
        // resolved value is fine here — kept for type-completeness only.
        declared_scope_coverage: { declared_acs: [], unattested_acs: [], scope_undeclared: false, meets_coverage: true },
        declared_scope_verdict: { ok: true },
      };
      mockedApiGetEvidencePanel.mockResolvedValue(projection);
      renderWithClient(<EvidenceTab doc={makeTaskDoc({ type: "plan" })} />);
      expect(await screen.findByText("This plan has no task children yet.")).toBeInTheDocument();
    });
  });

  describe("negative", () => {
    it("renders nothing for a doc_type: other projection", async () => {
      mockedApiGetEvidencePanel.mockResolvedValue({ doc_type: "other" });
      const { container } = renderWithClient(<EvidenceTab doc={makeTaskDoc()} />);
      await vi.waitFor(() => expect(mockedApiGetEvidencePanel).toHaveBeenCalled());
      await vi.waitFor(() => expect(container.querySelector(".animate-pulse")).toBeNull());
      expect(container).toBeEmptyDOMElement();
    });
  });

  describe("boundary", () => {
    it("renders loading skeletons while the query is pending", () => {
      mockedApiGetEvidencePanel.mockReturnValue(new Promise(() => {})); // never resolves
      const { container } = renderWithClient(<EvidenceTab doc={makeTaskDoc()} />);
      expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    });
  });

  describe("error", () => {
    it("renders a labeled error on a rejected query, never a crash", async () => {
      mockedApiGetEvidencePanel.mockRejectedValue(new Error("boom"));
      renderWithClient(<EvidenceTab doc={makeTaskDoc()} />);
      expect(await screen.findByText("Failed to load evidence.")).toBeInTheDocument();
    });
  });

  describe("regression", () => {
    it("fetches with the shared evidencePanelQueryKey(doc.id)", async () => {
      mockedApiGetEvidencePanel.mockResolvedValue({ doc_type: "task", evidence: [], ac_refs: [] });
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={client}>
          <EvidenceTab doc={makeTaskDoc()} />
        </QueryClientProvider>,
      );
      await screen.findByText("No verification evidence recorded yet.");
      expect(client.getQueryData(evidencePanelQueryKey(null, "01HDOC0000000000000000001"))).toBeDefined();
    });
  });
});
