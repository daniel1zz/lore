// @vitest-environment jsdom
/**
 * Regression tests for three SPEC-027 dashboard write-path bugs (AC-DH-1/2/3):
 *
 *   AC-DH-1 — DocDetail was mounted without a per-document `key` in
 *     routes/docs.$id.tsx. A TanStack Query cache hit while navigating between
 *     documents (staleTime 5min) resolves synchronously and reuses the same
 *     component instance, so an in-progress (unsaved) edit for doc A leaks
 *     into doc B's edit session.
 *
 *   AC-DH-2 — handleTransition's generic branch called
 *     apiPatchDoc(doc.id, { status }) without { version }, so
 *     checkConcurrency on the server unconditionally allowed the write —
 *     concurrent status transitions from two tabs silently clobbered
 *     each other.
 *
 *   AC-DH-3 — handleSave and the Cancel button called clearDraft() without
 *     clearTimeout(draftSaveTimerRef.current). A debounced draft-autosave
 *     scheduled just before either action fires up to 1s later and rewrites
 *     localStorage with abandoned/already-saved content, which then reads
 *     back as "fresh" (draft.version === doc.version) on next mount.
 *
 * Test plan:
 *   STATE (AC-DH-1):
 *     - Editing state does not leak from doc A into doc B when the parent
 *       remounts DocDetail with a fresh `key={doc.id}` (mirrors routes/docs.$id.tsx).
 *   REGRESSION (AC-DH-1, bug demonstration):
 *     - Without a per-document key, the same edit state DOES leak — confirms
 *       the test harness actually exercises the mechanism the fix relies on.
 *   STATE (AC-DH-2):
 *     - A non-conflicting status transition sends If-Match with doc.version.
 *   ERROR (AC-DH-2):
 *     - A 409 conflict during a status transition surfaces a loud error (never
 *       a silent success toast) and triggers a cache refresh instead of
 *       silently applying the stale write.
 *   STATE (AC-DH-3, Cancel path):
 *     - Cancelling an edit, then advancing fake timers past the debounce
 *       window, leaves no resurrected draft in localStorage.
 *   STATE (AC-DH-3, Save path):
 *     - Saving an edit, then advancing fake timers past the debounce window,
 *       leaves no resurrected draft in localStorage.
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, within, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DocDetail } from "../../src/components/DocDetail";
import { loadDraft } from "../../src/store/draft";
import type { DocWithNavigation } from "../../src/lib/api";
import type { DocRecord } from "@lore/core";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// reason: keep the real ConflictError/DashboardApiError classes (DocDetail's catch
// blocks use `instanceof`) while replacing the network-calling functions with spies.
vi.mock("../../src/api/mutations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/mutations")>();
  return {
    ...actual,
    apiPatchDoc: vi.fn(),
    apiApproveDoc: vi.fn(),
    apiRejectDoc: vi.fn(),
    apiCreateLink: vi.fn(),
    apiDeleteLink: vi.fn(),
  };
});

// reason: replace the real CodeMirror-backed Editor with a plain textarea — these
// tests exercise DocDetail's save/cancel/draft-timer logic, not CodeMirror mounting.
vi.mock("../../src/components/Editor", () => ({
  Editor: ({
    initialValue,
    onChange,
  }: {
    initialValue: string;
    onChange?: (value: string) => void;
  }): React.ReactElement => (
    <textarea
      aria-label="Markdown editor"
      defaultValue={initialValue}
      onChange={(e) => onChange?.(e.target.value)}
    />
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

import { apiPatchDoc, ConflictError } from "../../src/api/mutations";

const mockedApiPatchDoc = vi.mocked(apiPatchDoc);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeDoc(overrides: Partial<DocRecord> = {}): DocRecord {
  return {
    id: "01HTEST00000000000000000001",
    slug: "prd-doc-a",
    title: "Document A",
    type: "prd",
    status: "active",
    content: "Original content A",
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

const docA = makeDocWithNav(makeDoc());
const docB = makeDocWithNav(
  makeDoc({
    id: "01HTEST00000000000000000002",
    slug: "prd-doc-b",
    title: "Document B",
    content: "Original content B",
    version: 1,
  }),
);

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient();
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

// ─── Polyfills for Radix DropdownMenu under jsdom ─────────────────────────────

beforeAll(() => {
  // reason: Radix's dropdown-menu primitive calls these DOM APIs during
  // open/close; jsdom doesn't implement them, and their absence throws
  // rather than no-ops. Declared once per file to keep StatusPill interactions
  // testable without touching shared tests/setup.ts (outside this task's anchors).
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.scrollIntoView ??= () => {};
});

beforeEach(() => {
  localStorage.clear();
  mockedApiPatchDoc.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── AC-DH-1 — cross-document edit-state leak ─────────────────────────────────

describe("AC-DH-1: edit state isolation across document navigation", () => {
  /** Harness mirrors routes/docs.$id.tsx: DocDetail keyed by the current doc's id. */
  function KeyedHarness(): React.ReactElement {
    const [current, setCurrent] = useState(docA);
    return (
      <>
        <button type="button" onClick={() => setCurrent(docB)}>
          navigate to B
        </button>
        <DocDetail key={current.doc.id} docWithNav={current} onMutated={() => {}} />
      </>
    );
  }

  /** Harness WITHOUT a key — reproduces the pre-fix bug for comparison. */
  function UnkeyedHarness(): React.ReactElement {
    const [current, setCurrent] = useState(docA);
    return (
      <>
        <button type="button" onClick={() => setCurrent(docB)}>
          navigate to B
        </button>
        <DocDetail docWithNav={current} onMutated={() => {}} />
      </>
    );
  }

  it("resets edit mode when navigating to a different document (with key)", async () => {
    const user = userEvent.setup();
    renderWithClient(<KeyedHarness />);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();

    // Type an unsaved edit into doc A's editor.
    await user.type(screen.getByLabelText("Markdown editor"), " — unsaved edit for A");

    // Simulate a cache-hit navigation to doc B.
    await user.click(screen.getByRole("button", { name: "navigate to B" }));

    // Doc B must render in read (not edit) mode with its own content — no
    // leaked "Save"/"Cancel" buttons and no trace of A's unsaved text.
    expect(screen.getByRole("heading", { level: 1, name: "Document B" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByText(/unsaved edit for A/)).not.toBeInTheDocument();
  });

  it("regression: WITHOUT a key, edit mode leaks into the next document", async () => {
    const user = userEvent.setup();
    renderWithClient(<UnkeyedHarness />);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "navigate to B" }));

    // Bug reproduction: the component instance survives, so isEditing (and the
    // stale editorSeed/editContent for doc A) carries over onto doc B.
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });
});

// ─── AC-DH-2 — status transition concurrency ──────────────────────────────────

describe("AC-DH-2: status transitions pass If-Match and never silently clobber", () => {
  async function openTransitionMenuAndClick(optionName: string): Promise<void> {
    const user = userEvent.setup();
    // StatusPill renders the current status as an accessible button labelled
    // "Status: <label>. Click to change".
    await user.click(screen.getByRole("button", { name: /^Status: active/ }));
    const menu = await screen.findByRole("menu");
    await user.click(within(menu).getByText(optionName));
  }

  it("sends the doc's version on a successful generic transition (not a silent write)", async () => {
    const doc = makeDoc({ status: "active", version: 7 });
    mockedApiPatchDoc.mockResolvedValueOnce({ ...doc, status: "archived" });

    renderWithClient(<DocDetail docWithNav={makeDocWithNav(doc)} onMutated={vi.fn()} />);

    await openTransitionMenuAndClick("Archive");

    expect(mockedApiPatchDoc).toHaveBeenCalledWith(
      doc.id,
      { status: "archived" },
      { version: 7 },
    );
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining("archived"));
    expect(toastError).not.toHaveBeenCalled();
  });

  it("surfaces a loud error and refreshes (never a silent overwrite) on 409", async () => {
    const doc = makeDoc({ status: "active", version: 7 });
    const onMutated = vi.fn();
    const serverDoc = { ...doc, version: 9, status: "deprecated" as const };
    mockedApiPatchDoc.mockRejectedValueOnce(
      new ConflictError(serverDoc, JSON.stringify({ status: "archived" }), ""),
    );

    renderWithClient(<DocDetail docWithNav={makeDocWithNav(doc)} onMutated={onMutated} />);

    await openTransitionMenuAndClick("Archive");

    // Must not report success — the write was rejected by the server.
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError.mock.calls[0]?.[0]).toEqual(expect.stringContaining("v9"));
    // The cache-refresh callback must still run so the UI can pick up the
    // real current state instead of being stuck showing a stale transition target.
    expect(onMutated).toHaveBeenCalledTimes(1);
  });
});

// ─── AC-DH-3 — draft timer leak after Cancel / Save ───────────────────────────

describe("AC-DH-3: debounced draft-autosave timer is cancelled on Cancel and Save", () => {
  // reason: userEvent's internal delay-between-events scheduling deadlocks when
  // combined with vi.useFakeTimers() (both fight over the timer queue). These
  // two tests instead use real-timer userEvent for entering edit mode / clicking
  // Cancel|Save, then switch to fireEvent (synchronous, no internal timers) for
  // the keystroke that schedules the debounce, and only enable fake timers to
  // deterministically fast-forward past DRAFT_SAVE_DEBOUNCE_MS afterwards.

  it("does not resurrect a draft after Cancel once the debounce window elapses", async () => {
    const user = userEvent.setup();
    const doc = makeDoc({ version: 3 });

    renderWithClient(<DocDetail docWithNav={makeDocWithNav(doc)} onMutated={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Edit" }));

    vi.useFakeTimers();
    // Schedule the 1s draft-autosave debounce (handleEditorChange fires it).
    act(() => {
      fireEvent.change(screen.getByLabelText("Markdown editor"), {
        target: { value: "unsaved edit" },
      });
    });

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });

    // Advance well past DRAFT_SAVE_DEBOUNCE_MS (1000ms). If Cancel failed to
    // clear the timer, this is exactly when the abandoned edit would be
    // written back to localStorage.
    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(loadDraft(doc.id)).toBeNull();
  });

  it("does not resurrect a stale draft after Save once the debounce window elapses", async () => {
    const user = userEvent.setup();
    const doc = makeDoc({ version: 3 });
    mockedApiPatchDoc.mockResolvedValueOnce({ ...doc, content: "x" });

    renderWithClient(<DocDetail docWithNav={makeDocWithNav(doc)} onMutated={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Edit" }));

    vi.useFakeTimers();
    // Schedule the 1s draft-autosave debounce, then Save before it fires.
    act(() => {
      fireEvent.change(screen.getByLabelText("Markdown editor"), {
        target: { value: "x" },
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      // Flush the mocked apiPatchDoc promise resolution under fake timers.
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(loadDraft(doc.id)).toBeNull();
  });
});

// ─── ASYNC2D-001 — If-Match version freeze survives a mid-edit refetch ────────

describe("ASYNC2D-001: If-Match version is frozen at edit-session start, not read live from props", () => {
  /**
   * Harness that lets a test simulate what TanStack Query's default
   * refetchOnWindowFocus/refetchOnReconnect does: the parent re-renders
   * DocDetail with a fresh `doc.version` in props WITHOUT remounting it
   * (no key change — same as docs.$id.tsx's single query-driven prop).
   */
  function RefetchHarness({ initial }: { initial: DocWithNavigation }): React.ReactElement {
    const [current, setCurrent] = useState(initial);
    return (
      <>
        <button
          type="button"
          onClick={() =>
            setCurrent((prev) => ({
              ...prev,
              doc: { ...prev.doc, version: prev.doc.version + 1 },
            }))
          }
        >
          simulate background refetch
        </button>
        <DocDetail docWithNav={current} onMutated={() => {}} />
      </>
    );
  }

  it("sends the version captured at Edit click, not a version refetched mid-edit-session", async () => {
    const user = userEvent.setup();
    const doc = makeDoc({ version: 5 });
    mockedApiPatchDoc.mockResolvedValueOnce({ ...doc, content: "edited more", version: 6 });

    renderWithClient(<RefetchHarness initial={makeDocWithNav(doc)} />);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.type(screen.getByLabelText("Markdown editor"), " more");

    // A background refetch (e.g. window focus after staleTime) lands while
    // the edit session is still open — doc.version advances to 6 in props,
    // but the editor's local content does not change to match it.
    await user.click(screen.getByRole("button", { name: "simulate background refetch" }));

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(mockedApiPatchDoc).toHaveBeenCalledWith(
      doc.id,
      { content: expect.stringContaining("more") },
      { version: 5 },
    );
  });

  it("surfaces the ConflictModal (409) instead of silently overwriting when the frozen base genuinely trails the server", async () => {
    const user = userEvent.setup();
    const doc = makeDoc({ version: 5 });
    const serverDoc = { ...doc, version: 6, content: "someone else's edit" };
    mockedApiPatchDoc.mockRejectedValueOnce(
      new ConflictError(serverDoc, JSON.stringify({ content: "edited" }), ""),
    );

    renderWithClient(<RefetchHarness initial={makeDocWithNav(doc)} />);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.type(screen.getByLabelText("Markdown editor"), " more");
    await user.click(screen.getByRole("button", { name: "simulate background refetch" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    // Must never report success — a real conflict exists and must be surfaced.
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(await screen.findByRole("dialog", { name: "Edit conflict" })).toBeInTheDocument();
  });

  it("regression: a status transition outside an edit session still uses the live server version (freeze must not go global)", async () => {
    const user = userEvent.setup();
    const doc = makeDoc({ status: "active", version: 5 });
    mockedApiPatchDoc.mockResolvedValueOnce({ ...doc, status: "archived", version: 7 });

    renderWithClient(<RefetchHarness initial={makeDocWithNav(doc)} />);

    // No Edit click at all — bump the version the way a live (non-editing)
    // refetch would, then issue a transition; it must carry the FRESH
    // version, proving the freeze only pins during an actual edit session.
    await user.click(screen.getByRole("button", { name: "simulate background refetch" }));

    await user.click(screen.getByRole("button", { name: /^Status: active/ }));
    const menu = await screen.findByRole("menu");
    await user.click(within(menu).getByText("Archive"));

    expect(mockedApiPatchDoc).toHaveBeenCalledWith(doc.id, { status: "archived" }, { version: 6 });
  });
});
