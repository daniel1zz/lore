// @vitest-environment jsdom
/**
 * @spec_ref SPEC-033 §2.4
 *
 * Tests for LoopPanel — feedback-loop observability panel: calibration
 * agreement stats table plus an audit-verify status chip.
 *
 * Spec expectations (written from the module's documented invariants, before
 * reading the implementation body):
 *   - n=0 calibration stats still render as a labeled empty-state row, never
 *     an omitted/blank table (explicit BOUNDARY invariant in the source header).
 *   - Populated stats render agreement_rate and wilson_lower_bound as
 *     percentages (computed, not hardcoded).
 *   - The audit-verify chip shows "clean" when `clean === true`, and
 *     "N misses"/"1 miss" (singular/plural) otherwise — loading/error states
 *     are visually distinct from both, never silently defaulting to either.
 *
 * Test plan (six-dimension coverage):
 *   HAPPY — two calibration rows with different doc_type/n/rates both render
 *     with correctly computed percentages (defeats a hardcoded-row stub).
 *   NEGATIVE — n/a beyond BOUNDARY/ERROR cases below.
 *   BOUNDARY — n=0 stats array renders "No calibration data recorded yet.";
 *     audit-verify with exactly 1 miss uses singular "1 miss" (not "1 misses").
 *   ERROR — calibration-stats fetch rejecting renders the failure message;
 *     audit-verify fetch rejecting renders "verify unknown" (not silently
 *     "clean").
 *   STATE — loading skeletons appear before either query resolves.
 *   REGRESSION — audit-verify chip renders "clean" only when clean===true,
 *     and "N misses" (plural) for N>1 — guards the singular/plural branch.
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AuditVerifyResponse, CalibrationStatsRow } from "../../src/lib/api";

vi.mock("@/lib/api", () => ({
  apiGetCalibrationStats: vi.fn(),
  apiGetAuditVerify: vi.fn(),
}));

import { apiGetCalibrationStats, apiGetAuditVerify } from "@/lib/api";
import { LoopPanel } from "../../src/components/LoopPanel";

const mockedStats = vi.mocked(apiGetCalibrationStats);
const mockedVerify = vi.mocked(apiGetAuditVerify);

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  mockedStats.mockReset();
  mockedVerify.mockReset();
});

describe("LoopPanel", () => {
  describe("happy path", () => {
    it("renders two calibration rows with correctly computed agreement/wilson percentages", async () => {
      const rows: CalibrationStatsRow[] = [
        { doc_type: "spec", prompt_version: "v1", n: 20, agreement_rate: 0.8, wilson_lower_bound: 0.65, window_limit: 100 },
        { doc_type: "prd", prompt_version: "v2", n: 5, agreement_rate: 0.4, wilson_lower_bound: 0.1, window_limit: 100 },
      ];
      mockedStats.mockResolvedValue(rows);
      mockedVerify.mockResolvedValue({ clean: true, misses: [], audited: 0, reconstructed: 0 });

      renderWithClient(<LoopPanel />);

      expect(await screen.findByText("spec")).toBeInTheDocument();
      expect(screen.getByText("prd")).toBeInTheDocument();
      expect(screen.getByText("80%")).toBeInTheDocument();
      expect(screen.getByText("65%")).toBeInTheDocument();
      expect(screen.getByText("40%")).toBeInTheDocument();
      expect(screen.getByText("10%")).toBeInTheDocument();
    });
  });

  describe("boundary: n=0 stats", () => {
    it('renders "No calibration data recorded yet." for an empty stats array', async () => {
      mockedStats.mockResolvedValue([]);
      mockedVerify.mockResolvedValue({ clean: true, misses: [], audited: 0, reconstructed: 0 });

      renderWithClient(<LoopPanel />);

      expect(await screen.findByText("No calibration data recorded yet.")).toBeInTheDocument();
    });
  });

  describe("audit-verify chip", () => {
    it('shows "clean" when clean is true', async () => {
      mockedStats.mockResolvedValue([]);
      mockedVerify.mockResolvedValue({ clean: true, misses: [], audited: 0, reconstructed: 0 });

      renderWithClient(<LoopPanel />);

      expect(await screen.findByText("clean")).toBeInTheDocument();
    });

    it('shows "3 misses" (plural) when clean is false with 3 misses', async () => {
      mockedStats.mockResolvedValue([]);
      const misses: AuditVerifyResponse["misses"] = [
        { doc_id: "d1", version: 1, action: "update", created_at: "2026-01-01T00:00:00.000Z" },
        { doc_id: "d2", version: 1, action: "update", created_at: "2026-01-01T00:00:00.000Z" },
        { doc_id: "d3", version: 1, action: "update", created_at: "2026-01-01T00:00:00.000Z" },
      ];
      mockedVerify.mockResolvedValue({ clean: false, misses, audited: 0, reconstructed: 0 });

      renderWithClient(<LoopPanel />);

      expect(await screen.findByText("3 misses")).toBeInTheDocument();
    });

    it('shows "1 miss" (singular, not "1 misses") when exactly one miss', async () => {
      mockedStats.mockResolvedValue([]);
      const misses: AuditVerifyResponse["misses"] = [
        { doc_id: "d1", version: 1, action: "update", created_at: "2026-01-01T00:00:00.000Z" },
      ];
      mockedVerify.mockResolvedValue({ clean: false, misses, audited: 0, reconstructed: 0 });

      renderWithClient(<LoopPanel />);

      expect(await screen.findByText("1 miss")).toBeInTheDocument();
      expect(screen.queryByText("1 misses")).not.toBeInTheDocument();
    });

    it('shows "verify unknown" (not "clean") when the audit-verify fetch rejects', async () => {
      mockedStats.mockResolvedValue([]);
      mockedVerify.mockRejectedValue(new Error("network down"));

      renderWithClient(<LoopPanel />);

      expect(await screen.findByText("verify unknown")).toBeInTheDocument();
      expect(screen.queryByText("clean")).not.toBeInTheDocument();
    });
  });

  describe("error: calibration stats fetch failure", () => {
    it("renders a failure message when apiGetCalibrationStats rejects", async () => {
      mockedStats.mockRejectedValue(new Error("network down"));
      mockedVerify.mockResolvedValue({ clean: true, misses: [], audited: 0, reconstructed: 0 });

      renderWithClient(<LoopPanel />);

      expect(await screen.findByText("Failed to load calibration stats.")).toBeInTheDocument();
    });
  });

  describe("state: loading", () => {
    it("shows a loading skeleton for calibration stats before the query resolves", async () => {
      let resolveStats!: (rows: CalibrationStatsRow[]) => void;
      mockedStats.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveStats = resolve;
          }),
      );
      mockedVerify.mockResolvedValue({ clean: true, misses: [], audited: 0, reconstructed: 0 });

      const { container } = renderWithClient(<LoopPanel />);

      expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);

      resolveStats([]);
      await screen.findByText("No calibration data recorded yet.");
    });

    it("shows a loading skeleton for the audit-verify chip before the query resolves", async () => {
      mockedStats.mockResolvedValue([]);
      let resolveVerify!: (r: AuditVerifyResponse) => void;
      mockedVerify.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveVerify = resolve;
          }),
      );

      const { container } = renderWithClient(<LoopPanel />);

      expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);

      resolveVerify({ clean: true, misses: [], audited: 0, reconstructed: 0 });
      await screen.findByText("clean");
    });
  });
});
