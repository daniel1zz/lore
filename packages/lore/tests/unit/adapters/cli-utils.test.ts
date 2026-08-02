/**
 * @spec_ref AC-CLI-001 SPEC-051
 * Tests for CLI adapter utilities.
 * Covers formatError, exitCode, formatTable, formatTree, formatNavigation,
 * relativeTime, resolveActorAlias (SPEC-051 D2), formatShortId
 * (task-short-id-rendering-truncates-ulids-to-8-chars-a-1024ms).
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { userInfo } from "os";
import { mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  exitCode,
  formatError,
  formatShortId,
  formatTable,
  formatTree,
  formatNavigation,
  parsePositiveIntArg,
  relativeTime,
  resolveActor,
  resolveActorAlias,
  resolveActorWithSource,
  resetActorFallbackWarningForTests,
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

// ─── formatShortId (task-short-id-rendering-truncates-ulids-to-8-chars-a-1024ms) ──

describe("formatShortId", () => {
  // A real-shape 26-char Crockford-base32 ULID (matches the task's own
  // measured example, `01KYYDXH4SBSHGHAXNPKEY9SMB`).
  const REAL_ULID = "01KYYDXH4SBSHGHAXNPKEY9SMB";

  describe("HAPPY", () => {
    it("renders head(8) + … + tail(5) for a full-length ULID", () => {
      expect(formatShortId(REAL_ULID)).toBe("01KYYDXH…Y9SMB");
    });

    it("the rendered form is well-formed: exactly 8 head chars, the … separator, exactly 5 tail chars", () => {
      const rendered = formatShortId(REAL_ULID);
      const match = /^(.{8})…(.{5})$/.exec(rendered);
      expect(match).not.toBeNull();
      expect(match?.[1]).toBe(REAL_ULID.slice(0, 8));
      expect(match?.[2]).toBe(REAL_ULID.slice(-5));
    });

    it("two DIFFERENT full-length ids sharing the SAME 8-char timestamp prefix (the 1024ms-window bug) render DIFFERENT short ids", () => {
      // Same first 8 chars (same 1024ms window under the OLD .slice(0,8) bug) —
      // this is the measured incident pair from the task doc, tail differs.
      const idA = "01KYYDXH4SBSHGHAXNPKEY9SMB";
      const idB = "01KYYDXHBF3GXDSDJ22Q2ZYWKJ";
      expect(idA.slice(0, 8)).toBe(idB.slice(0, 8)); // pre-condition: old bug's collision case
      expect(formatShortId(idA)).not.toBe(formatShortId(idB));
    });
  });

  describe("BOUNDARY", () => {
    it("an empty string renders as an empty string (no throw)", () => {
      expect(formatShortId("")).toBe("");
    });

    it("a 6-char id (shorter than head+tail width) renders WHOLE, no … separator", () => {
      expect(formatShortId("abcdef")).toBe("abcdef");
    });

    it("a 13-char id (exactly head+tail width) renders WHOLE, no … separator", () => {
      const exactWidth = "0123456789ABC"; // 13 chars = headLen(8) + tailLen(5)
      expect(formatShortId(exactWidth)).toBe(exactWidth);
    });

    it("a 14-char id (one over head+tail width) DOES render head+tail", () => {
      const oneOver = "0123456789ABCD"; // 14 chars
      expect(formatShortId(oneOver)).toBe("01234567…9ABCD");
    });

    it("never throws across a range of malformed lengths, including 0", () => {
      for (const len of [0, 1, 5, 8, 12, 13, 14, 20, 26]) {
        const id = "X".repeat(len);
        expect(() => formatShortId(id)).not.toThrow();
      }
    });
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

  // ── formatShortId wiring (task-short-id-rendering-truncates-ulids-to-8-chars-a-1024ms) ──

  it("HAPPY: renders the root label's id via formatShortId's head+tail form", () => {
    const node = makeNode("01KYYDXH4SBSHGHAXNPKEY9SMB", "Root Doc");
    const output = formatTree(node);
    expect(output).toContain(formatShortId("01KYYDXH4SBSHGHAXNPKEY9SMB"));
    expect(output).toContain("01KYYDXH…Y9SMB");
  });

  it("HAPPY: renders a CHILD's id via formatShortId's head+tail form (formatTreeChildren site)", () => {
    const root = makeNode("ROOT0000000000000000000001ZZ", "Root", [
      makeNode("01KYYDXHBF3GXDSDJ22Q2ZYWKJ", "Child A"),
    ]);
    const output = formatTree(root);
    expect(output).toContain("01KYYDXH…ZYWKJ");
  });

  it("REGRESSION (AC1 unit-level): two docs sharing the OLD 8-char-collision timestamp prefix render DIFFERENT short ids as root vs child", () => {
    // Pre-condition: both ids share the identical first 8 chars — the exact
    // same-1024ms-window shape the old `.slice(0, 8)` rendering collapsed to
    // one identical printed id.
    const idA = "01KYYDXH4SBSHGHAXNPKEY9SMB";
    const idB = "01KYYDXHBF3GXDSDJ22Q2ZYWKJ";
    expect(idA.slice(0, 8)).toBe(idB.slice(0, 8));

    const root = makeNode(idA, "Doc A", [makeNode(idB, "Doc B")]);
    const output = formatTree(root);
    const lines = output.split("\n");
    const rootShort = lines[0]?.split(" ")[0];
    const childLine = lines.find((l) => l.includes("Doc B"));
    const childShort = childLine?.trim().split(" ")[1]; // after the "└── " connector
    expect(rootShort).toBeDefined();
    expect(childShort).toBeDefined();
    expect(rootShort).not.toBe(childShort);
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

  // ── formatShortId wiring (task-short-id-rendering-truncates-ulids-to-8-chars-a-1024ms) ──

  it("HAPPY: Parent/Siblings/Children/Related all render via formatShortId's head+tail form", () => {
    const REAL_ULID = "01KYYDXH4SBSHGHAXNPKEY9SMB";
    const expected = formatShortId(REAL_ULID);
    const parent = makeSummary(REAL_ULID, "Parent Doc");
    const sibling = makeSummary(REAL_ULID, "Sibling Doc");
    const child = makeSummary(REAL_ULID, "Child Doc");
    const related = { ...makeSummary(REAL_ULID, "Related Doc"), link_type: "informs" as const };
    const nav = { parent, ancestors: [], siblings: [sibling], children: [child], related: [related] };
    const output = formatNavigation(nav);
    // 4 occurrences: Parent, Siblings, Children, Related lines.
    const occurrences = output.split(expected).length - 1;
    expect(occurrences).toBe(4);
    expect(output).toContain("01KYYDXH…Y9SMB");
  });

  it("REGRESSION (AC1 unit-level): two docs sharing the OLD 8-char-collision timestamp prefix render DIFFERENT short ids as parent vs sibling", () => {
    const idA = "01KYYDXH4SBSHGHAXNPKEY9SMB";
    const idB = "01KYYDXHBF3GXDSDJ22Q2ZYWKJ";
    expect(idA.slice(0, 8)).toBe(idB.slice(0, 8)); // pre-condition: old bug's collision case

    const parent = makeSummary(idA, "Parent Doc");
    const sibling = makeSummary(idB, "Sibling Doc");
    const nav = { parent, ancestors: [], siblings: [sibling], children: [], related: [] };
    const output = formatNavigation(nav);

    const lines = output.split("\n");
    const parentLine = lines.find((l) => l.startsWith("Parent:"));
    const siblingLine = lines.find((l) => l.startsWith("Siblings:"));
    expect(parentLine).toContain(formatShortId(idA));
    expect(siblingLine).toContain(formatShortId(idB));
    expect(formatShortId(idA)).not.toBe(formatShortId(idB));
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

// ─── resolveActorWithSource + resolveActor OS-fallback advisory (retro
// `knowledge-session-process-review-2026-07-22-spec-062-064-continu`,
// AC-AUDIT-ACTOR-1) ─────────────────────────────────────────────────────────

/**
 * SPEC-104 makes `resolveActorWithSource`'s (and, via
 * `resolveActorWithIdentitySource`, `resolveActor`'s) default `cwd` load-
 * bearing: an ambient cwd sitting inside a linked git worktree — this repo's
 * OWN standard subagent-dispatch pattern — now correctly resolves
 * `agent:<branch>` (`worktree-derived`) instead of falling through to the
 * OS-fallback tier these os-fallback assertions expect. Every os-fallback
 * case below pins cwd to a fixture with a real `.git` DIRECTORY (a "main
 * checkout" shape, per `detectWorktreeDerivedActor`'s own contract, which
 * treats a `.git` directory as "not a linked worktree") — never relies on
 * the ambient test-process cwd (`knowledge-spec-104-fallout-changed-tests-ts-porcelain-path-bug`).
 */
function makeNonWorktreeCwdFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "lore-cli-utils-non-worktree-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "cli-utils-fixture@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "CLI Utils Fixture"], { cwd: dir });
  return dir;
}

describe("resolveActorWithSource", () => {
  const OS_USERNAME = userInfo().username;
  const ORIGINAL_LORE_ACTOR = process.env["LORE_ACTOR"];
  const ORIGINAL_CLAUDE_CODE_SESSION_ID = process.env["CLAUDE_CODE_SESSION_ID"];
  const ORIGINAL_CLAUDE_SESSION_ID = process.env["CLAUDE_SESSION_ID"];
  let nonWorktreeCwd: string;

  beforeAll(() => {
    nonWorktreeCwd = makeNonWorktreeCwdFixture();
  });

  afterAll(() => {
    rmSync(nonWorktreeCwd, { recursive: true, force: true });
  });

  // Ambient Claude Code shells export CLAUDE_CODE_SESSION_ID, which the SPEC-069
  // session tier resolves ahead of os-fallback — clear both session vars before
  // every test in THIS describe block (scoped, not file-level) so the os-fallback
  // cases below still exercise os-fallback, then restore whatever the ambient
  // shell actually had so other describe blocks in this file are unaffected.
  beforeEach(() => {
    delete process.env["CLAUDE_CODE_SESSION_ID"];
    delete process.env["CLAUDE_SESSION_ID"];
  });

  afterEach(() => {
    if (ORIGINAL_LORE_ACTOR === undefined) {
      delete process.env["LORE_ACTOR"];
    } else {
      process.env["LORE_ACTOR"] = ORIGINAL_LORE_ACTOR;
    }
    if (ORIGINAL_CLAUDE_CODE_SESSION_ID === undefined) {
      delete process.env["CLAUDE_CODE_SESSION_ID"];
    } else {
      process.env["CLAUDE_CODE_SESSION_ID"] = ORIGINAL_CLAUDE_CODE_SESSION_ID;
    }
    if (ORIGINAL_CLAUDE_SESSION_ID === undefined) {
      delete process.env["CLAUDE_SESSION_ID"];
    } else {
      process.env["CLAUDE_SESSION_ID"] = ORIGINAL_CLAUDE_SESSION_ID;
    }
  });

  describe("HAPPY", () => {
    it("returns {source: explicit} when --by is passed", () => {
      delete process.env["LORE_ACTOR"];
      expect(resolveActorWithSource("alice")).toEqual({ actor: "alice", source: "explicit" });
    });

    it("returns {source: env} when $LORE_ACTOR is set and --by is not passed", () => {
      process.env["LORE_ACTOR"] = "agent:bob";
      expect(resolveActorWithSource(undefined)).toEqual({ actor: "agent:bob", source: "env" });
    });

    it("returns {source: os-fallback, actor: OS username} when neither is provided", () => {
      delete process.env["LORE_ACTOR"];
      expect(resolveActorWithSource(undefined, undefined, nonWorktreeCwd)).toEqual({
        actor: OS_USERNAME,
        source: "os-fallback",
      });
    });
  });

  describe("BOUNDARY", () => {
    it("treats a whitespace-only --by as absent, falling through to env", () => {
      process.env["LORE_ACTOR"] = "agent:carol";
      expect(resolveActorWithSource("   ")).toEqual({ actor: "agent:carol", source: "env" });
    });

    it("treats a whitespace-only $LORE_ACTOR as absent, falling through to OS username", () => {
      process.env["LORE_ACTOR"] = "   ";
      expect(resolveActorWithSource(undefined, undefined, nonWorktreeCwd)).toEqual({
        actor: OS_USERNAME,
        source: "os-fallback",
      });
    });
  });

  describe("STATE — $LORE_ACTOR set/unset within the test", () => {
    it("prefers explicit --by even when $LORE_ACTOR is also set", () => {
      process.env["LORE_ACTOR"] = "agent:dave";
      expect(resolveActorWithSource("erin")).toEqual({ actor: "erin", source: "explicit" });
    });

    it("falls back to OS username once $LORE_ACTOR is deleted mid-test", () => {
      process.env["LORE_ACTOR"] = "agent:frank";
      expect(resolveActorWithSource(undefined).source).toBe("env");
      delete process.env["LORE_ACTOR"];
      expect(resolveActorWithSource(undefined, undefined, nonWorktreeCwd)).toEqual({
        actor: OS_USERNAME,
        source: "os-fallback",
      });
    });
  });

  describe("REGRESSION — resolveActor's returned string matches resolveActorWithSource(...).actor", () => {
    it("explicit --by", () => {
      delete process.env["LORE_ACTOR"];
      resetActorFallbackWarningForTests();
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      expect(resolveActor("grace")).toBe(resolveActorWithSource("grace").actor);
      stderrSpy.mockRestore();
    });

    it("$LORE_ACTOR env", () => {
      process.env["LORE_ACTOR"] = "agent:heidi";
      resetActorFallbackWarningForTests();
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      expect(resolveActor(undefined)).toBe(resolveActorWithSource(undefined).actor);
      stderrSpy.mockRestore();
    });

    it("OS-username fallback", () => {
      delete process.env["LORE_ACTOR"];
      resetActorFallbackWarningForTests();
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      expect(resolveActor(undefined)).toBe(resolveActorWithSource(undefined).actor);
      stderrSpy.mockRestore();
    });
  });
});

function spyOnStderrWrite() {
  return vi.spyOn(process.stderr, "write").mockImplementation(() => true);
}

describe("resolveActor — OS-fallback advisory side effect (AC-AUDIT-ACTOR-1)", () => {
  const ORIGINAL_LORE_ACTOR = process.env["LORE_ACTOR"];
  const ORIGINAL_CLAUDE_CODE_SESSION_ID = process.env["CLAUDE_CODE_SESSION_ID"];
  const ORIGINAL_CLAUDE_SESSION_ID = process.env["CLAUDE_SESSION_ID"];
  let stderrSpy: ReturnType<typeof spyOnStderrWrite>;
  // `resolveActor` (unlike `resolveActorWithSource`) has no `cwd` parameter —
  // it always reads `process.cwd()` via `resolveActorWithIdentitySource`'s
  // default. Every os-fallback assertion in this block needs the SAME
  // non-worktree-cwd guarantee `makeNonWorktreeCwdFixture` gives
  // `resolveActorWithSource` above, so this describe chdir's the real
  // process cwd into that fixture for its duration (restored in `afterEach`,
  // mirroring `actor-worktree-derivation.bun.test.ts`'s own
  // chdir/restore-in-afterEach pattern for its `claim` command test).
  let nonWorktreeCwd: string;
  let originalCwd: string;

  beforeAll(() => {
    nonWorktreeCwd = makeNonWorktreeCwdFixture();
  });

  afterAll(() => {
    rmSync(nonWorktreeCwd, { recursive: true, force: true });
  });

  beforeEach(() => {
    originalCwd = process.cwd();
    process.chdir(nonWorktreeCwd);
    resetActorFallbackWarningForTests();
    stderrSpy = spyOnStderrWrite();
    // Ambient Claude Code shells export CLAUDE_CODE_SESSION_ID, which the SPEC-069
    // session tier resolves ahead of os-fallback — clear both session vars before
    // every test in THIS describe block (scoped, not file-level) so the
    // os-fallback cases below still exercise os-fallback.
    delete process.env["CLAUDE_CODE_SESSION_ID"];
    delete process.env["CLAUDE_SESSION_ID"];
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    process.chdir(originalCwd);
    if (ORIGINAL_LORE_ACTOR === undefined) {
      delete process.env["LORE_ACTOR"];
    } else {
      process.env["LORE_ACTOR"] = ORIGINAL_LORE_ACTOR;
    }
    if (ORIGINAL_CLAUDE_CODE_SESSION_ID === undefined) {
      delete process.env["CLAUDE_CODE_SESSION_ID"];
    } else {
      process.env["CLAUDE_CODE_SESSION_ID"] = ORIGINAL_CLAUDE_CODE_SESSION_ID;
    }
    if (ORIGINAL_CLAUDE_SESSION_ID === undefined) {
      delete process.env["CLAUDE_SESSION_ID"];
    } else {
      process.env["CLAUDE_SESSION_ID"] = ORIGINAL_CLAUDE_SESSION_ID;
    }
  });

  // ── Precise-signal proof: these two cases are the load-bearing ones. A
  // naive "always warn unless the value has an agent:/ai: prefix" implementation
  // passes every other case in this file but FAILS both of these — a human
  // passing --by daniel or exporting LORE_ACTOR=daniel made a deliberate,
  // traceable choice and must get ZERO advisory lines. (Verified red-before-green:
  // temporarily swapping resolveActor for that naive rule turned both cases
  // below red — 2 failing / rest passing — before reverting to the
  // fallback-only signal implemented here.)
  it("PRECISE SIGNAL: an explicit --by human-looking name emits 0 stderr lines", () => {
    delete process.env["LORE_ACTOR"];
    const actor = resolveActor("daniel");
    expect(actor).toBe("daniel");
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("PRECISE SIGNAL: a human-looking $LORE_ACTOR emits 0 stderr lines", () => {
    process.env["LORE_ACTOR"] = "daniel";
    const actor = resolveActor(undefined);
    expect(actor).toBe("daniel");
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("OS-fallback (no --by, no $LORE_ACTOR) emits exactly 1 stderr line matching /OS username/", () => {
    delete process.env["LORE_ACTOR"];
    const actor = resolveActor(undefined);
    expect(actor).toBe(userInfo().username);
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const [firstCallArg] = stderrSpy.mock.calls[0] as [string];
    expect(firstCallArg).toMatch(/OS username/);
  });

  it("once-per-process guard: a SECOND OS-fallback call in the same process writes 0 additional lines", () => {
    delete process.env["LORE_ACTOR"];
    resolveActor(undefined);
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    stderrSpy.mockClear();
    resolveActor(undefined);
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("the guard resets when resetActorFallbackWarningForTests() is called (test-only escape)", () => {
    delete process.env["LORE_ACTOR"];
    resolveActor(undefined);
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    stderrSpy.mockClear();
    resetActorFallbackWarningForTests();
    resolveActor(undefined);
    expect(stderrSpy).toHaveBeenCalledTimes(1);
  });

  it("explicit --by still returns the unchanged actor value alongside 0 advisory lines", () => {
    process.env["LORE_ACTOR"] = "agent:ignored-because-explicit-wins";
    expect(resolveActor("alice")).toBe("alice");
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});
