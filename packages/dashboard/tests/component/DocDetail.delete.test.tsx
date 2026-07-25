// @vitest-environment jsdom
/**
 * Tests for the SPEC-027 AC-DH-6 soft-delete UI: DocDetail renders a Delete
 * button that opens an explicit confirmation dialog before firing the DELETE
 * request, and calls `onDeleted` (never `onMutated`) on success so the caller
 * navigates away from a document that no longer exists.
 *
 * Test plan (six-dimension coverage):
 *   HAPPY — clicking Delete then confirming calls apiDeleteDoc(doc.id) and
 *     invokes onDeleted().
 *   NEGATIVE — clicking Cancel in the dialog does not call apiDeleteDoc and
 *     closes the dialog.
 *   BOUNDARY — the Delete button is not rendered when onDeleted is omitted
 *     (read-only / no-mutation-callback context, mirrors onMutated gating).
 *   ERROR — a failed apiDeleteDoc surfaces a toast and does NOT call
 *     onDeleted; the confirmation dialog stays open so the user can retry.
 *   STATE — the Delete button is hidden while editing and reappears after
 *     Cancel.
 *   REGRESSION — clicking Delete alone (without confirming) must not call
 *     apiDeleteDoc — guards against a regression to direct-click deletion.
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DocDetail } from "../../src/components/DocDetail";
import type { DocWithNavigation } from "../../src/lib/api";
import type { DocRecord } from "@lore/core";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// reason: keep the real DashboardApiError class (DocDetail's catch block uses
// `instanceof`) while replacing the network-calling apiDeleteDoc with a spy.
vi.mock("../../src/api/mutations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/mutations")>();
  return {
    ...actual,
    apiDeleteDoc: vi.fn(),
  };
});

// reason: DocDetail imports the real CodeMirror-backed Editor; these tests never
// enter edit mode's content path, but Editor still mounts if isEditing is toggled
// (STATE dimension test below) — stub it the same way the write-path tests do.
vi.mock("../../src/components/Editor", () => ({
  Editor: ({
    initialValue,
    onChange,
  }: {
    initialValue: string;
    onChange?: (value: string) => void;
  }): React.ReactElement => (
    <textarea aria-label="Markdown editor" defaultValue={initialValue} onChange={(e) => onChange?.(e.target.value)} />
  ),
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}));

import { apiDeleteDoc, DashboardApiError } from "../../src/api/mutations";

const mockedApiDeleteDoc = vi.mocked(apiDeleteDoc);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeDoc(overrides: Partial<DocRecord> = {}): DocRecord {
  return {
    id: "01HTEST00000000000000000001",
    slug: "prd-doc-a",
    title: "Deletable Document",
    type: "prd",
    status: "active",
    content: "Original content",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-06-01T00:00:00Z",
    created_by: null,
    parent_id: null,
    tags: [],
    extra: {},
    version: 3,
    ...overrides,
  };
}

function makeDocWithNav(doc: DocRecord): DocWithNavigation {
  return {
    doc,
    navigation: { parent: null, ancestors: [], siblings: [], children: [], related: [] },
  };
}

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient();
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  mockedApiDeleteDoc.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
});

// ─── HAPPY ──────────────────────────────────────────────────────────────────

describe("HAPPY: confirmed delete", () => {
  it("calls apiDeleteDoc(doc.id) and onDeleted() after confirming in the dialog", async () => {
    const doc = makeDocWithNav(makeDoc());
    mockedApiDeleteDoc.mockResolvedValueOnce({ id: doc.doc.id, recoverable_until: "2024-07-01T00:00:00Z" });
    const onDeleted = vi.fn();
    const user = userEvent.setup();

    renderWithClient(<DocDetail docWithNav={doc} onMutated={() => {}} onDeleted={onDeleted} />);

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Delete \(recoverable\)/ }));

    expect(mockedApiDeleteDoc).toHaveBeenCalledWith(null, doc.doc.id);
    expect(onDeleted).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("closes the confirmation dialog after a successful delete", async () => {
    const doc = makeDocWithNav(makeDoc());
    mockedApiDeleteDoc.mockResolvedValueOnce({ id: doc.doc.id, recoverable_until: "2024-07-01T00:00:00Z" });
    const user = userEvent.setup();

    renderWithClient(<DocDetail docWithNav={doc} onMutated={() => {}} onDeleted={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: /Delete \(recoverable\)/ }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});

// ─── NEGATIVE ───────────────────────────────────────────────────────────────

describe("NEGATIVE: cancelling the confirmation dialog", () => {
  it("does not call apiDeleteDoc and closes the dialog on Cancel", async () => {
    const doc = makeDocWithNav(makeDoc());
    const onDeleted = vi.fn();
    const user = userEvent.setup();

    renderWithClient(<DocDetail docWithNav={doc} onMutated={() => {}} onDeleted={onDeleted} />);

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mockedApiDeleteDoc).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});

// ─── BOUNDARY ───────────────────────────────────────────────────────────────

describe("BOUNDARY: onDeleted omitted", () => {
  it("does not render a Delete button when onDeleted is not provided", () => {
    const doc = makeDocWithNav(makeDoc());

    renderWithClient(<DocDetail docWithNav={doc} />);

    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });
});

// ─── ERROR ──────────────────────────────────────────────────────────────────

describe("ERROR: apiDeleteDoc rejects", () => {
  it("surfaces a toast, keeps the dialog open, and does not call onDeleted", async () => {
    const doc = makeDocWithNav(makeDoc());
    mockedApiDeleteDoc.mockRejectedValueOnce(new DashboardApiError(404, "DOC_NOT_FOUND", "Document not found"));
    const onDeleted = vi.fn();
    const user = userEvent.setup();

    renderWithClient(<DocDetail docWithNav={doc} onMutated={() => {}} onDeleted={onDeleted} />);

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: /Delete \(recoverable\)/ }));

    expect(toastError).toHaveBeenCalledWith("Document not found");
    expect(onDeleted).not.toHaveBeenCalled();
    // reason: on failure the user may still want to retry or cancel — the
    // dialog must not silently disappear along with the failed request.
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });
});

// ─── STATE ──────────────────────────────────────────────────────────────────

describe("STATE: Delete button visibility while editing", () => {
  it("hides the Delete button while editing and shows it again after Cancel", async () => {
    const doc = makeDocWithNav(makeDoc());
    const user = userEvent.setup();

    renderWithClient(<DocDetail docWithNav={doc} onMutated={() => {}} onDeleted={() => {}} />);

    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });
});

// ─── REGRESSION ─────────────────────────────────────────────────────────────

describe("REGRESSION: Delete requires explicit confirmation", () => {
  it("clicking Delete alone (without confirming) never calls apiDeleteDoc", async () => {
    const doc = makeDocWithNav(makeDoc());
    const user = userEvent.setup();

    renderWithClient(<DocDetail docWithNav={doc} onMutated={() => {}} onDeleted={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(mockedApiDeleteDoc).not.toHaveBeenCalled();
  });
});
