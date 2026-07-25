// @vitest-environment jsdom
/**
 * Tests for HistoryTab: version-log rendering, the existing per-version diff
 * modal (AC-DASH-WRITE-8), and the new per-version Restore affordance
 * (SPEC-027 AC-DH-7).
 *
 * Test plan (six-dimension coverage):
 *   HAPPY — renders one row per version log entry; clicking a version's
 *     "restore" button calls apiRestoreVersion(docId, version) and, on
 *     success, calls onRestored().
 *   NEGATIVE — a failed restore surfaces a toast and does not call onRestored.
 *   BOUNDARY — no history (0 or 1 version) renders the empty state and no
 *     restore buttons; the oldest entry has no "diff" button (no prior
 *     version to diff against) but still has a "restore" button.
 *   ERROR — apiGetVersionLog rejecting renders the "Failed to load" message.
 *   STATE — "restore" is disabled on every row while any restore is pending.
 *   REGRESSION — "restore" is not rendered at all when onRestored is omitted
 *     (mirrors DocDetail's onMutated-gated affordances; guards against
 *     accidentally always mounting a write action in read-only contexts).
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HistoryTab } from "../../src/components/HistoryTab";
import type { VersionLogEntry } from "../../src/lib/api";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/api")>();
  return {
    ...actual,
    apiGetVersionLog: vi.fn(),
    apiGetVersionDiff: vi.fn(),
  };
});

vi.mock("../../src/api/mutations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/mutations")>();
  return {
    ...actual,
    apiRestoreVersion: vi.fn(),
  };
});

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}));

import { apiGetVersionLog, apiGetVersionDiff } from "../../src/lib/api";
import { apiRestoreVersion, DashboardApiError } from "../../src/api/mutations";

const mockedApiGetVersionLog = vi.mocked(apiGetVersionLog);
const mockedApiGetVersionDiff = vi.mocked(apiGetVersionDiff);
const mockedApiRestoreVersion = vi.mocked(apiRestoreVersion);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const THREE_VERSIONS: VersionLogEntry[] = [
  { version: 3, action: "restore", created_at: "2024-03-01T00:00:00Z", created_by: "alice" },
  { version: 2, action: "update", created_at: "2024-02-01T00:00:00Z", created_by: "alice" },
  { version: 1, action: "create", created_at: "2024-01-01T00:00:00Z", created_by: "alice" },
];

function renderWithClient(ui: React.ReactElement) {
  // reason: retry:false — the ERROR-dimension test below rejects the version-log
  // fetch and asserts the failure message renders; TanStack Query's default retry
  // (3 attempts with backoff) would otherwise keep the query in a pending state
  // well past findByText's default 1000ms timeout.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  mockedApiGetVersionLog.mockReset();
  mockedApiGetVersionDiff.mockReset();
  mockedApiRestoreVersion.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
});

// ─── HAPPY ──────────────────────────────────────────────────────────────────

describe("HAPPY: version log rendering + restore", () => {
  it("renders one row per version log entry", async () => {
    mockedApiGetVersionLog.mockResolvedValueOnce(THREE_VERSIONS);

    renderWithClient(<HistoryTab docId="01JTEST" />);

    expect(await screen.findByText("v3")).toBeInTheDocument();
    expect(screen.getByText("v2")).toBeInTheDocument();
    expect(screen.getByText("v1")).toBeInTheDocument();
  });

  it("clicking restore on a version calls apiRestoreVersion(docId, version) and onRestored()", async () => {
    mockedApiGetVersionLog.mockResolvedValue(THREE_VERSIONS);
    mockedApiRestoreVersion.mockResolvedValueOnce({
      id: "01JTEST",
      slug: "prd-doc",
      title: "Doc",
      type: "prd",
      status: "draft",
      content: "restored content",
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-04-01T00:00:00Z",
      created_by: null,
      parent_id: null,
      tags: [],
      extra: {},
      version: 4,
    });
    const onRestored = vi.fn();
    const user = userEvent.setup();

    renderWithClient(<HistoryTab docId="01JTEST" onRestored={onRestored} />);
    await screen.findByText("v3");

    const restoreButtons = screen.getAllByRole("button", { name: "restore" });
    // Restore the oldest entry (v1) — its button is the last in DOM order.
    await user.click(restoreButtons[restoreButtons.length - 1]!);

    expect(mockedApiRestoreVersion).toHaveBeenCalledWith(null, "01JTEST", 1);
    await waitFor(() => expect(onRestored).toHaveBeenCalledTimes(1));
    expect(toastSuccess).toHaveBeenCalledWith("Restored to v1");
  });
});

// ─── NEGATIVE ───────────────────────────────────────────────────────────────

describe("NEGATIVE: restore fails", () => {
  it("surfaces a toast and does not call onRestored when apiRestoreVersion rejects", async () => {
    mockedApiGetVersionLog.mockResolvedValue(THREE_VERSIONS);
    mockedApiRestoreVersion.mockRejectedValueOnce(
      new DashboardApiError(404, "DOC_NOT_FOUND", "Version 1 not found"),
    );
    const onRestored = vi.fn();
    const user = userEvent.setup();

    renderWithClient(<HistoryTab docId="01JTEST" onRestored={onRestored} />);
    await screen.findByText("v3");

    const restoreButtons = screen.getAllByRole("button", { name: "restore" });
    await user.click(restoreButtons[0]!);

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Version 1 not found"));
    expect(onRestored).not.toHaveBeenCalled();
  });
});

// ─── BOUNDARY ───────────────────────────────────────────────────────────────

describe("BOUNDARY: empty and single-entry history", () => {
  it("renders the empty state and no restore buttons when there is no history", async () => {
    mockedApiGetVersionLog.mockResolvedValueOnce([]);

    renderWithClient(<HistoryTab docId="01JTEST" onRestored={() => {}} />);

    expect(await screen.findByText("No version history yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "restore" })).not.toBeInTheDocument();
  });

  it("the oldest entry has no diff button but still has a restore button", async () => {
    mockedApiGetVersionLog.mockResolvedValueOnce(THREE_VERSIONS);

    renderWithClient(<HistoryTab docId="01JTEST" onRestored={() => {}} />);
    await screen.findByText("v1");

    // v1 is the oldest — no prior version exists to diff against.
    const diffButtons = screen.getAllByRole("button", { name: "diff" });
    expect(diffButtons).toHaveLength(2); // v3->v2 and v2->v1 only, not v1-> (nothing)

    const restoreButtons = screen.getAllByRole("button", { name: "restore" });
    expect(restoreButtons).toHaveLength(3); // every entry gets a restore button, including v1
  });
});

// ─── ERROR ──────────────────────────────────────────────────────────────────

describe("ERROR: version log fetch fails", () => {
  it("renders the failure message when apiGetVersionLog rejects", async () => {
    mockedApiGetVersionLog.mockRejectedValueOnce(new Error("network down"));

    renderWithClient(<HistoryTab docId="01JTEST" />);

    expect(await screen.findByText("Failed to load version history.")).toBeInTheDocument();
  });
});

// ─── STATE ──────────────────────────────────────────────────────────────────

describe("STATE: restore buttons disabled while a restore is pending", () => {
  it("disables every restore button while one restore request is in flight", async () => {
    mockedApiGetVersionLog.mockResolvedValue(THREE_VERSIONS);
    let resolveRestore: (() => void) | undefined;
    mockedApiRestoreVersion.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRestore = () =>
          resolve({
            id: "01JTEST",
            slug: "prd-doc",
            title: "Doc",
            type: "prd",
            status: "draft",
            content: "c",
            created_at: "2024-01-01T00:00:00Z",
            updated_at: "2024-01-01T00:00:00Z",
            created_by: null,
            parent_id: null,
            tags: [],
            extra: {},
            version: 4,
          });
      }),
    );
    const user = userEvent.setup();

    renderWithClient(<HistoryTab docId="01JTEST" onRestored={() => {}} />);
    await screen.findByText("v3");

    const restoreButtons = screen.getAllByRole("button", { name: /restore/ });
    await user.click(restoreButtons[0]!);

    // All restore buttons (including the one clicked, now showing "restoring...") are disabled.
    for (const button of screen.getAllByRole("button", { name: /restor/ })) {
      expect(button).toBeDisabled();
    }

    resolveRestore?.();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "restore" })[0]).not.toBeDisabled());
  });
});

// ─── REGRESSION ─────────────────────────────────────────────────────────────

describe("REGRESSION: restore hidden when onRestored is omitted", () => {
  it("does not render any restore button in a read-only context (no onRestored)", async () => {
    mockedApiGetVersionLog.mockResolvedValueOnce(THREE_VERSIONS);

    renderWithClient(<HistoryTab docId="01JTEST" />);
    await screen.findByText("v3");

    expect(screen.queryByRole("button", { name: "restore" })).not.toBeInTheDocument();
    // Diff functionality (pre-existing) must remain unaffected by the restore gating.
    expect(screen.getAllByRole("button", { name: "diff" })).toHaveLength(2);
  });

  it("diff modal still opens and fetches the diff (pre-existing behavior untouched)", async () => {
    mockedApiGetVersionLog.mockResolvedValueOnce(THREE_VERSIONS);
    mockedApiGetVersionDiff.mockResolvedValueOnce({
      from_version: 2,
      to_version: 3,
      content_diff: "--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new",
    });
    const user = userEvent.setup();

    renderWithClient(<HistoryTab docId="01JTEST" />);
    await screen.findByText("v3");

    await user.click(screen.getAllByRole("button", { name: "diff" })[0]!);

    expect(await screen.findByRole("dialog", { name: /Diff from v2 to v3/ })).toBeInTheDocument();
    expect(mockedApiGetVersionDiff).toHaveBeenCalledWith(null, "01JTEST", { from: 2, to: 3 });
  });
});
