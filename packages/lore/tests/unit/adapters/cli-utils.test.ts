/**
 * @spec_ref AC-CLI-001 SPEC-051
 * Tests for CLI adapter utilities.
 * Covers formatError, exitCode, formatTable, formatTree, formatNavigation,
 * relativeTime, resolveActorAlias (SPEC-051 D2).
 */

import { describe, it, expect } from "vitest";
import {
  exitCode,
  formatError,
  formatTable,
  formatTree,
  formatNavigation,
  parsePositiveIntArg,
  relativeTime,
  resolveActorAlias,
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

  // ─── AI_PROVIDER_ERROR — surface-correct hint (SPEC-029 AC-AR-5) ────────────

  describe("AI_PROVIDER_ERROR — --no-ai hint gating (SPEC-029 AC-AR-5)", () => {
    const aiErrorMessage = "AI judge response could not be parsed as valid assessment JSON.";
    const aiError: LoreError = {
      code: "AI_PROVIDER_ERROR",
      provider: "claude-cli",
      message: aiErrorMessage,
    };

    it("REGRESSION: default call (no opts) still suggests --no-ai (create/set/link callers)", () => {
      const msg = formatError(aiError);
      expect(msg).toContain("--no-ai");
    });

    it("REGRESSION: passing opts explicitly with aiHasNoFallback omitted behaves identically to no opts at all", () => {
      const msg = formatError(aiError, {});
      expect(msg).toContain("--no-ai");
    });

    it("with { aiHasNoFallback: true }, the output does NOT contain '--no-ai' anywhere", () => {
      const msg = formatError(aiError, { aiHasNoFallback: true });
      expect(msg).not.toContain("--no-ai");
    });

    it("with { aiHasNoFallback: true }, the output contains assess-specific recovery guidance instead", () => {
      const msg = formatError(aiError, { aiHasNoFallback: true });
      // Pinned against the actual wording in utils.ts: retry guidance, provider config check,
      // and a pointer to the raw output already embedded in the message.
      expect(msg).toContain("no non-AI fallback");
      expect(msg).toContain("Retry the command");
      expect(msg.toLowerCase()).toContain("ai.provider");
    });

    it("the underlying error message and provider name are still present regardless of aiHasNoFallback", () => {
      const withFallback = formatError(aiError, { aiHasNoFallback: true });
      const withoutFallback = formatError(aiError);
      expect(withFallback).toContain("claude-cli");
      expect(withFallback).toContain(aiErrorMessage);
      expect(withoutFallback).toContain("claude-cli");
      expect(withoutFallback).toContain(aiErrorMessage);
    });
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
      tags: [],
      priority: "medium",
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
    tags: [],
    priority: "medium" as const,
  });

  it("shows (none) for all fields when navigation is empty", () => {
    const nav = { parent: null, ancestors: [], siblings: [], children: [], related: [] };
    const output = formatNavigation(nav);
    expect(output).toContain("(none)");
  });

  it("shows parent title when parent is present", () => {
    const parent = makeSummary("PARENT00000000000000000001", "Parent Doc");
    const nav = { parent, ancestors: [], siblings: [], children: [], related: [] };
    const output = formatNavigation(nav);
    expect(output).toContain("Parent Doc");
  });

  it("shows siblings list", () => {
    const sibling = makeSummary("SIB00000000000000000000001", "Sibling Doc");
    const nav = { parent: null, ancestors: [], siblings: [sibling], children: [], related: [] };
    const output = formatNavigation(nav);
    expect(output).toContain("Sibling Doc");
  });

  it("shows children list", () => {
    const child = makeSummary("CHILD000000000000000000001", "Child Doc");
    const nav = { parent: null, ancestors: [], siblings: [], children: [child], related: [] };
    const output = formatNavigation(nav);
    expect(output).toContain("Child Doc");
  });

  it("shows related documents with their link type", () => {
    const related = {
      ...makeSummary("REL000000000000000000000001", "Related Doc"),
      link_type: "informs" as const,
    };
    const nav = { parent: null, ancestors: [], siblings: [], children: [], related: [related] };
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

// ─── resolveActorAlias (SPEC-051 D2) ────────────────────────────────────────

describe("resolveActorAlias", () => {
  it("HAPPY: --by only resolves to that value", () => {
    expect(resolveActorAlias("daniel", undefined)).toEqual({ ok: true, value: "daniel" });
  });

  it("HAPPY: --reviewer only resolves to that value", () => {
    expect(resolveActorAlias(undefined, "daniel")).toEqual({ ok: true, value: "daniel" });
  });

  it("HAPPY: matching values on both flags is not a conflict", () => {
    expect(resolveActorAlias("daniel", "daniel")).toEqual({ ok: true, value: "daniel" });
  });

  it("BOUNDARY: neither flag passed resolves to undefined (falls through to resolveActor)", () => {
    expect(resolveActorAlias(undefined, undefined)).toEqual({ ok: true, value: undefined });
  });

  it("ERROR: conflicting values on both flags fails with a descriptive error", () => {
    const result = resolveActorAlias("daniel", "alice");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("--by and --reviewer");
      expect(result.error).toContain("daniel");
      expect(result.error).toContain("alice");
    }
  });
});

// ─── parsePositiveIntArg (BUG-006/007/008/012 audit) ────────────────────────

describe("parsePositiveIntArg", () => {
  describe("HAPPY", () => {
    it("parses a plain positive integer string", () => {
      expect(parsePositiveIntArg("10", "--limit")).toEqual({ ok: true, value: 10 });
    });

    it("parses a value with surrounding whitespace", () => {
      expect(parsePositiveIntArg("  7  ", "--limit")).toEqual({ ok: true, value: 7 });
    });
  });

  describe("NEGATIVE — non-numeric input (BUG-006/007/008 root cause: parseInt('abc') → NaN)", () => {
    it("rejects a non-numeric string", () => {
      const result = parsePositiveIntArg("abc", "--limit");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toContain("--limit");
        expect(result.message).toContain("integer");
        expect(result.message).toContain("abc");
      }
    });

    it("rejects an empty string", () => {
      const result = parsePositiveIntArg("", "--depth");
      expect(result.ok).toBe(false);
    });

    it("rejects a fractional string instead of silently truncating (parseInt('3.5') → 3)", () => {
      const result = parsePositiveIntArg("3.5", "--limit");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toContain("3.5");
      }
    });

    it("rejects a value with trailing garbage that parseInt would silently accept", () => {
      // reason: parseInt("10abc", 10) === 10 — the exact silent-coercion class this
      // helper exists to close off (parseInt stops at the first non-digit character).
      const result = parsePositiveIntArg("10abc", "--limit");
      expect(result.ok).toBe(false);
    });
  });

  describe("BOUNDARY", () => {
    it("accepts exactly the min value (default min:1)", () => {
      expect(parsePositiveIntArg("1", "--limit")).toEqual({ ok: true, value: 1 });
    });

    it("rejects zero when min:1 (default)", () => {
      const result = parsePositiveIntArg("0", "--limit");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toContain(">= 1");
      }
    });

    it("accepts zero when min:0 is explicitly passed (e.g. --offset)", () => {
      expect(parsePositiveIntArg("0", "--offset", { min: 0 })).toEqual({ ok: true, value: 0 });
    });

    it("rejects -1 when min:0 (BUG-012 root cause: a negative limit silently drops tail entries via .slice(0, -1))", () => {
      const result = parsePositiveIntArg("-1", "--offset", { min: 0 });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toContain(">= 0");
      }
    });

    it("rejects a negative value even when it parses as a valid integer", () => {
      const result = parsePositiveIntArg("-5", "--limit");
      expect(result.ok).toBe(false);
    });

    it("rejects a value beyond Number.isSafeInteger range", () => {
      // 2^53 is the first unsafe integer.
      const result = parsePositiveIntArg("9007199254740993", "--limit");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toContain("out of range");
      }
    });
  });

  describe("ERROR — message content is actionable", () => {
    it("names the offending flag in every failure message", () => {
      const result = parsePositiveIntArg("abc", "--min-age-days");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toMatch(/--min-age-days/);
      }
    });
  });
});
