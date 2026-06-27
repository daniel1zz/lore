/**
 * @spec_ref AC-CLI-001
 * Tests for CLI adapter utilities.
 * Covers formatError, exitCode, formatTable, formatTree, formatNavigation, relativeTime.
 */

import { describe, it, expect } from "vitest";
import {
  exitCode,
  formatError,
  formatTable,
  formatTree,
  formatNavigation,
  relativeTime,
} from "../../../src/adapters/cli/utils.js";
import type { LoreError } from "@lore/core";
import type { TreeNode } from "../../../src/service/corpus-service.js";

// ─── exitCode ──────────────────────────────────────────────────────────────

describe("exitCode", () => {
  it("returns 3 for DOC_NOT_FOUND", () => {
    const error: LoreError = { code: "DOC_NOT_FOUND", id: "abc" };
    expect(exitCode(error)).toBe(3);
  });

  it("returns 3 for SLUG_NOT_FOUND", () => {
    const error: LoreError = { code: "SLUG_NOT_FOUND", slug: "foo-bar" };
    expect(exitCode(error)).toBe(3);
  });

  it("returns 4 for VALIDATION_ERROR", () => {
    const error: LoreError = { code: "VALIDATION_ERROR", field: "title", message: "required" };
    expect(exitCode(error)).toBe(4);
  });

  it("returns 4 for PARENT_REQUIRED", () => {
    const error: LoreError = { code: "PARENT_REQUIRED", type: "spec" };
    expect(exitCode(error)).toBe(4);
  });

  it("returns 4 for INVALID_TRANSITION", () => {
    const error: LoreError = {
      code: "INVALID_TRANSITION",
      from: "approved",
      to: "draft",
      allowed: [],
    };
    expect(exitCode(error)).toBe(4);
  });

  it("returns 4 for DELETE_REQUIRES_CONFIRM", () => {
    const error: LoreError = { code: "DELETE_REQUIRES_CONFIRM", id: "abc" };
    expect(exitCode(error)).toBe(4);
  });

  it("returns 5 for STALE_VERSION", () => {
    const error: LoreError = { code: "STALE_VERSION", id: "abc", expected: 1, actual: 2 };
    expect(exitCode(error)).toBe(5);
  });

  it("returns 1 for STORE_ERROR", () => {
    const error: LoreError = { code: "STORE_ERROR", message: "disk full" };
    expect(exitCode(error)).toBe(1);
  });

  it("returns 4 for LINK_CYCLE", () => {
    const error: LoreError = { code: "LINK_CYCLE", path: ["A", "B", "A"] };
    expect(exitCode(error)).toBe(4);
  });

  it("returns 4 for DUPLICATE_SLUG", () => {
    const error: LoreError = { code: "DUPLICATE_SLUG", slug: "foo", existing_id: "bar" };
    expect(exitCode(error)).toBe(4);
  });

  it("returns 4 for DUPLICATE_LINK", () => {
    const error: LoreError = { code: "DUPLICATE_LINK", from: "A", to: "B", type: "relates-to" };
    expect(exitCode(error)).toBe(4);
  });

  it("returns 4 for SCHEMA_VIOLATION", () => {
    const error: LoreError = {
      code: "SCHEMA_VIOLATION",
      type: "task",
      missing: ["plan_id"],
    };
    expect(exitCode(error)).toBe(4);
  });
});

// ─── formatError ──────────────────────────────────────────────────────────

describe("formatError", () => {
  it("formats DOC_NOT_FOUND without suggestions", () => {
    const error: LoreError = { code: "DOC_NOT_FOUND", id: "SPEC-999" };
    const msg = formatError(error);
    expect(msg).toContain("SPEC-999");
    expect(msg).toContain("not found");
    expect(msg).toContain("lore list");
  });

  it("formats DOC_NOT_FOUND with suggestions", () => {
    const error: LoreError = {
      code: "DOC_NOT_FOUND",
      id: "SPEC-999",
      suggestions: ["spec-auth", "spec-billing"],
    };
    const msg = formatError(error);
    expect(msg).toContain("spec-auth");
    expect(msg).toContain("spec-billing");
  });

  it("formats STALE_VERSION", () => {
    const error: LoreError = { code: "STALE_VERSION", id: "abc", expected: 2, actual: 5 };
    const msg = formatError(error);
    expect(msg).toContain("abc");
    expect(msg).toContain("version 2");
    expect(msg).toContain("current is 5");
  });

  it("formats VALIDATION_ERROR with field name", () => {
    const error: LoreError = {
      code: "VALIDATION_ERROR",
      field: "title",
      message: "must not be empty",
    };
    const msg = formatError(error);
    expect(msg).toContain("title");
    expect(msg).toContain("must not be empty");
  });

  it("formats PARENT_REQUIRED", () => {
    const error: LoreError = { code: "PARENT_REQUIRED", type: "spec" };
    const msg = formatError(error);
    expect(msg).toContain("spec");
    expect(msg).toContain("parent");
  });

  it("formats LINK_CYCLE with path", () => {
    const error: LoreError = { code: "LINK_CYCLE", path: ["A", "B", "A"] };
    const msg = formatError(error);
    expect(msg).toContain("A");
    expect(msg).toContain("B");
    expect(msg).toContain("→");
  });

  it("formats INVALID_TRANSITION with allowed list", () => {
    const error: LoreError = {
      code: "INVALID_TRANSITION",
      from: "approved",
      to: "draft",
      allowed: ["archived"],
    };
    const msg = formatError(error);
    expect(msg).toContain("approved");
    expect(msg).toContain("draft");
    expect(msg).toContain("archived");
  });

  it("formats STORE_ERROR", () => {
    const error: LoreError = { code: "STORE_ERROR", message: "disk full" };
    const msg = formatError(error);
    expect(msg).toContain("disk full");
  });

  it("formats DELETE_REQUIRES_CONFIRM with doc id", () => {
    const error: LoreError = { code: "DELETE_REQUIRES_CONFIRM", id: "DOC123" };
    const msg = formatError(error);
    expect(msg).toContain("DOC123");
    expect(msg).toContain("--confirm");
  });

  it("formats DUPLICATE_SLUG with existing id", () => {
    const error: LoreError = { code: "DUPLICATE_SLUG", slug: "spec-auth", existing_id: "XYZ456" };
    const msg = formatError(error);
    expect(msg).toContain("spec-auth");
    expect(msg).toContain("XYZ456");
  });
});

// ─── formatTable ──────────────────────────────────────────────────────────

describe("formatTable", () => {
  it("renders headers and rows aligned", () => {
    const headers = ["ID", "Title", "Status"];
    const rows = [
      ["abc12345", "My Document", "draft"],
      ["xyz98765", "Another Doc", "approved"],
    ];
    const output = formatTable(headers, rows);
    const lines = output.split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines[0]).toContain("ID");
    expect(lines[0]).toContain("Title");
    expect(lines[0]).toContain("Status");
    expect(output).toContain("My Document");
    expect(output).toContain("Another Doc");
  });

  it("handles empty rows — header only", () => {
    const headers = ["ID", "Title"];
    const rows: string[][] = [];
    const output = formatTable(headers, rows);
    expect(output).toContain("ID");
    expect(output).toContain("Title");
  });

  it("pads short data cells to match header width", () => {
    const headers = ["LongHeaderName", "X"];
    const rows = [["a", "b"]];
    const output = formatTable(headers, rows);
    // Row value "a" must be padded to the width of "LongHeaderName" (14 chars)
    expect(output).toContain("a             "); // padded
  });
});

// ─── formatTree ──────────────────────────────────────────────────────────

describe("formatTree", () => {
  const makeNode = (id: string, title: string, children: TreeNode[] = []): TreeNode => ({
    doc: {
      id,
      slug: `type-${title.toLowerCase().replace(/\s/g, "-")}`,
      type: "prd",
      title,
      status: "draft",
      updated_at: new Date().toISOString(),
    },
    children,
  });

  it("renders a single leaf node", () => {
    const node = makeNode("ABC1234567890ABCD12345678", "Root Doc");
    const output = formatTree(node);
    expect(output).toContain("Root Doc");
    expect(output).toContain("draft");
  });

  it("renders immediate children with box-drawing connectors", () => {
    const root = makeNode("ROOT0000000000000000000001", "Root", [
      makeNode("CHILD000000000000000000001", "Child A"),
      makeNode("CHILD000000000000000000002", "Child B"),
    ]);
    const output = formatTree(root);
    expect(output).toContain("├──");
    expect(output).toContain("└──");
    expect(output).toContain("Child A");
    expect(output).toContain("Child B");
  });

  it("renders nested grandchildren", () => {
    const root = makeNode("ROOT0000000000000000000001", "Root", [
      makeNode("CHILD000000000000000000001", "Child A", [
        makeNode("GRAND000000000000000000001", "Grandchild"),
      ]),
      makeNode("CHILD000000000000000000002", "Child B"),
    ]);
    const output = formatTree(root);
    expect(output).toContain("Grandchild");
    // Child A has a sibling (Child B), so continuation bar │ must appear
    expect(output).toContain("│");
  });

  it("uses └── for the last child, ├── for others", () => {
    const root = makeNode("ROOT0000000000000000000001", "Root", [
      makeNode("CHILD000000000000000000001", "First"),
      makeNode("CHILD000000000000000000002", "Second"),
      makeNode("CHILD000000000000000000003", "Third"),
    ]);
    const output = formatTree(root);
    const lines = output.split("\n");
    const lastChildLine = lines.find((l) => l.includes("Third"));
    expect(lastChildLine).toContain("└──");
  });
});

// ─── formatNavigation ────────────────────────────────────────────────────

describe("formatNavigation", () => {
  const makeSummary = (id: string, title: string) => ({
    id,
    slug: "type-" + title.toLowerCase(),
    type: "spec" as const,
    title,
    status: "draft" as const,
    updated_at: new Date().toISOString(),
  });

  it("shows (none) for all fields when navigation is empty", () => {
    const nav = { parent: null, siblings: [], children: [], related: [] };
    const output = formatNavigation(nav);
    expect(output).toContain("(none)");
  });

  it("shows parent title when parent is present", () => {
    const parent = makeSummary("PARENT00000000000000000001", "Parent Doc");
    const nav = { parent, siblings: [], children: [], related: [] };
    const output = formatNavigation(nav);
    expect(output).toContain("Parent Doc");
  });

  it("shows siblings list", () => {
    const sibling = makeSummary("SIB00000000000000000000001", "Sibling Doc");
    const nav = { parent: null, siblings: [sibling], children: [], related: [] };
    const output = formatNavigation(nav);
    expect(output).toContain("Sibling Doc");
  });

  it("shows children list", () => {
    const child = makeSummary("CHILD000000000000000000001", "Child Doc");
    const nav = { parent: null, siblings: [], children: [child], related: [] };
    const output = formatNavigation(nav);
    expect(output).toContain("Child Doc");
  });

  it("shows related documents with their link type", () => {
    const related = {
      ...makeSummary("REL000000000000000000000001", "Related Doc"),
      link_type: "informs" as const,
    };
    const nav = { parent: null, siblings: [], children: [], related: [related] };
    const output = formatNavigation(nav);
    expect(output).toContain("Related Doc");
    expect(output).toContain("informs");
  });
});

// ─── relativeTime ─────────────────────────────────────────────────────────

describe("relativeTime", () => {
  it("formats sub-hour as minutes", () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(relativeTime(fiveMinutesAgo)).toBe("5m ago");
  });

  it("formats hours correctly", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    expect(relativeTime(twoHoursAgo)).toBe("2h ago");
  });

  it("formats days correctly", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(relativeTime(threeDaysAgo)).toBe("3d ago");
  });

  it("formats months for dates over 30 days ago", () => {
    const twoMonthsAgo = new Date(Date.now() - 65 * 24 * 60 * 60 * 1000).toISOString();
    expect(relativeTime(twoMonthsAgo)).toBe("2mo ago");
  });
});
