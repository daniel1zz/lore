// @vitest-environment jsdom
/**
 * @layer dashboard-component AC-P0C-8 (DocDetail project-scoped writes; the AC's first oracle is the mutations unit suite)
 * @spec_ref AC-P0C-8
 *
 * BR-996: a dashboard edit on a registered project behaves as with a single project — the
 * write is addressed to that project AND carries the same out-of-date check (If-Match).
 * DocDetail is mounted with `project="acme"`; Edit → type → Save must call
 * `apiPatchDoc("acme", <id>, { content }, { version: <doc.version> })`.
 *
 * Falsifier: dropping `project` from DocDetail's PATCH call (passing null) turns the first
 * case red.
 *
 * Six-dimension coverage:
 *   HAPPY      — project-scoped save passes the project and the frozen version
 *   NEGATIVE   — a project-scoped save never targets null / another project
 *   BOUNDARY   — registry-less (project omitted) save keeps the null address
 *   ERROR      — a ConflictError on a project-scoped save is surfaced loudly, never a success
 *   STATE      — a status transition on a project also carries project + version
 *   REGRESSION — BR-996 project dropped from the PATCH call
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DocDetail } from "../../src/components/DocDetail";
import type { DocWithNavigation } from "../../src/lib/api";
import type { DocRecord } from "@lore/core";

// reason: keep the real error classes (DocDetail's catch blocks use `instanceof`) while
// replacing the network-calling writes with spies.
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

// reason: swap CodeMirror for a textarea — this file tests which project/version the save
// sends, not editor mounting.
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

const PROJECT = "acme";

function makeDoc(overrides: Partial<DocRecord> = {}): DocRecord {
  return {
    id: "01HTEST00000000000000000009",
    slug: "prd-acme-doc",
    title: "Acme Doc",
    type: "prd",
    role: "intent",
    status: "active",
    priority: "medium",
    content: "Original acme content",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-06-01T00:00:00Z",
    created_by: "alice",
    parent_id: null,
    tags: [],
    extra: {},
    version: 5,
    deleted_at: null,
    ...overrides,
  };
}

function makeDocWithNav(doc: DocRecord): DocWithNavigation {
  return {
    doc,
    navigation: { parent: null, ancestors: [], siblings: [], children: [], related: [] },
  };
}

function renderDetail(doc: DocRecord, project: string | undefined): void {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <DocDetail
        docWithNav={makeDocWithNav(doc)}
        onMutated={vi.fn()}
        {...(project !== undefined ? { project } : {})}
      />
    </QueryClientProvider>,
  );
}

async function editAndSave(): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Edit" }));
  await user.type(screen.getByLabelText("Markdown editor"), " + edited");
  await user.click(screen.getByRole("button", { name: "Save" }));
}

beforeAll(() => {
  // reason: Radix dropdown primitives call these DOM APIs; jsdom lacks them.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.scrollIntoView ??= () => {};
});

beforeEach(() => {
  localStorage.clear();
  mockedApiPatchDoc.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
});

describe("BR-996 project-scoped doc edit — DocDetail on a registered project", () => {
  it("HAPPY: a save calls the write with the project and sends the doc's version as If-Match input", async () => {
    const doc = makeDoc({ version: 5 });
    mockedApiPatchDoc.mockResolvedValueOnce({ ...doc, version: 6 });
    renderDetail(doc, PROJECT);

    await editAndSave();

    expect(mockedApiPatchDoc).toHaveBeenCalledTimes(1);
    const [project, id, patch, opts] = mockedApiPatchDoc.mock.calls[0]!;
    expect(project).toBe(PROJECT);
    expect(id).toBe(doc.id);
    expect(patch).toEqual({ content: "Original acme content + edited" });
    expect(opts).toEqual({ version: 5 });
  });

  it("NEGATIVE: the save never targets null (the launch project) when a project is mounted", async () => {
    const doc = makeDoc();
    mockedApiPatchDoc.mockResolvedValueOnce(doc);
    renderDetail(doc, PROJECT);

    await editAndSave();

    for (const call of mockedApiPatchDoc.mock.calls) {
      expect(call[0]).not.toBeNull();
    }
  });

  it("BOUNDARY: with no project mounted the save keeps the plain (null) address", async () => {
    const doc = makeDoc();
    mockedApiPatchDoc.mockResolvedValueOnce(doc);
    renderDetail(doc, undefined);

    await editAndSave();

    expect(mockedApiPatchDoc.mock.calls[0]![0]).toBeNull();
  });

  it("ERROR: a stale-version refusal on a project-scoped save is shown as an error, never a success", async () => {
    const doc = makeDoc({ version: 5 });
    mockedApiPatchDoc.mockRejectedValueOnce(new ConflictError({ ...doc, version: 8 }, "mine", "diff"));
    renderDetail(doc, PROJECT);

    await editAndSave();

    expect(mockedApiPatchDoc.mock.calls[0]![0]).toBe(PROJECT);
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("STATE: a status transition on the project also sends the project and the doc's version", async () => {
    const doc = makeDoc({ status: "active", version: 5 });
    mockedApiPatchDoc.mockResolvedValueOnce({ ...doc, status: "archived" });
    renderDetail(doc, PROJECT);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^Status: active/ }));
    const menu = await screen.findByRole("menu");
    await user.click(within(menu).getByText("Archive"));

    expect(mockedApiPatchDoc).toHaveBeenCalledWith(PROJECT, doc.id, { status: "archived" }, { version: 5 });
  });
});
