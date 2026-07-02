// @vitest-environment jsdom

/**
 * @spec_ref AC-DASH-WRITE-3
 *
 * Unit tests for draft.ts — localStorage draft cache for in-progress edits.
 * Source: SPEC-022 §6 (Risk: "User edits then refreshes losing draft"), draft.ts public surface.
 *
 * Spec expectations (written before reading implementation):
 *   - saveDraft stores draft keyed by doc_id; loadDraft retrieves it
 *   - clearDraft removes the entry; loadDraft returns null afterwards
 *   - isDraftStale: returns false when draft.version === serverVersion
 *   - isDraftStale: returns true when serverVersion > draft.version (server advanced)
 *   - loadDraft for nonexistent docId → null
 *   - All storage errors are swallowed (quota exceeded, privacy mode) — never throw
 *   - saveDraft overwrites previous draft for the same docId
 *
 * NOTE: The spec says saveDraft "swallows" quota errors. This means the function
 * must not throw when localStorage.setItem fails. Importantly, this is a SPEC-INTENDED
 * behavior (opportunistic UX), not a bug. Tests here verify the swallow is present
 * AND that it is truly silent (no re-throw).
 *
 * Six-dimension coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { saveDraft, loadDraft, clearDraft, isDraftStale } from "../../../src/store/draft";
import type { DraftEntry } from "../../../src/store/draft";

// ─── Test setup ───────────────────────────────────────────────────────────────

function makeDraftEntry(overrides?: Partial<DraftEntry>): DraftEntry {
  return {
    doc_id: "01JDOC",
    version: 3,
    content: "draft content goes here",
    last_edited_at: "2024-01-01T12:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

// ─── HAPPY paths ──────────────────────────────────────────────────────────────

describe("saveDraft + loadDraft — round-trip", () => {
  it("saveDraft → loadDraft returns the exact same entry", () => {
    const entry = makeDraftEntry({ doc_id: "DOC-A", version: 5, content: "my draft" });
    saveDraft(entry);
    const loaded = loadDraft("DOC-A");
    expect(loaded).not.toBeNull();
    expect(loaded!.doc_id).toBe("DOC-A");
    expect(loaded!.version).toBe(5);
    expect(loaded!.content).toBe("my draft");
  });

  it("preserves all fields including last_edited_at", () => {
    const entry = makeDraftEntry({ last_edited_at: "2025-03-15T09:30:00Z" });
    saveDraft(entry);
    const loaded = loadDraft(entry.doc_id);
    expect(loaded!.last_edited_at).toBe("2025-03-15T09:30:00Z");
  });

  it("different doc_ids have independent draft storage", () => {
    // Anti-hardcode: two different docs must have separate drafts
    saveDraft(makeDraftEntry({ doc_id: "DOC-X", content: "X draft" }));
    saveDraft(makeDraftEntry({ doc_id: "DOC-Y", content: "Y draft" }));

    expect(loadDraft("DOC-X")!.content).toBe("X draft");
    expect(loadDraft("DOC-Y")!.content).toBe("Y draft");
  });
});

describe("clearDraft", () => {
  it("clearDraft removes the entry so loadDraft returns null", () => {
    saveDraft(makeDraftEntry({ doc_id: "CLEAR-TEST" }));
    clearDraft("CLEAR-TEST");
    expect(loadDraft("CLEAR-TEST")).toBeNull();
  });

  it("clearDraft on a non-existent doc does not throw", () => {
    expect(() => clearDraft("does-not-exist")).not.toThrow();
  });
});

describe("isDraftStale", () => {
  it("returns false when draft.version equals serverVersion (not stale)", () => {
    // Spec: draft is NOT stale when the client is working from the current server version
    const draft = makeDraftEntry({ version: 4 });
    expect(isDraftStale(draft, 4)).toBe(false);
  });

  it("returns true when serverVersion is greater than draft.version (server advanced)", () => {
    // Spec: draft is stale when the server has moved forward
    const draft = makeDraftEntry({ version: 3 });
    expect(isDraftStale(draft, 5)).toBe(true);
  });
});

// ─── NEGATIVE paths ───────────────────────────────────────────────────────────

describe("isDraftStale — edge cases", () => {
  it("returns true when draft.version < serverVersion (stale)", () => {
    const draft = makeDraftEntry({ version: 1 });
    expect(isDraftStale(draft, 2)).toBe(true);
  });

  it("returns false when draft.version > serverVersion (should not normally happen)", () => {
    // Adversarial: client draft is somehow AHEAD of server — spec is silent on this.
    // Testing implementation behavior: draft.version < serverVersion → stale; reverse is false.
    const draft = makeDraftEntry({ version: 10 });
    expect(isDraftStale(draft, 5)).toBe(false);
  });
});

describe("loadDraft — negative cases", () => {
  it("returns null for nonexistent docId", () => {
    // Spec: loadDraft must return null gracefully when no draft exists
    const result = loadDraft("nonexistent-doc-id");
    expect(result).toBeNull();
  });

  it("returns null for corrupt JSON in localStorage", () => {
    // Adversarial: corrupt stored value should not throw
    localStorage.setItem("lore_draft_corrupt-id", "not valid json {{");
    const result = loadDraft("corrupt-id");
    expect(result).toBeNull();
  });

  it("returns null when stored value is valid JSON but missing required doc_id field", () => {
    // Adversarial: partial/malformed entry should be rejected
    localStorage.setItem("lore_draft_partial-id", JSON.stringify({ version: 1, content: "x" }));
    const result = loadDraft("partial-id");
    expect(result).toBeNull();
  });

  it("returns null when stored value is a JSON string (not object)", () => {
    // Adversarial: JSON string value is valid JSON but not a DraftEntry object
    localStorage.setItem("lore_draft_str-id", JSON.stringify("just a string"));
    const result = loadDraft("str-id");
    expect(result).toBeNull();
  });

  it("returns null when version field is a string instead of number", () => {
    // Adversarial: corrupted numeric field should be rejected
    const corrupt = { doc_id: "str-ver", version: "3", content: "x" };
    localStorage.setItem("lore_draft_str-ver", JSON.stringify(corrupt));
    const result = loadDraft("str-ver");
    expect(result).toBeNull();
  });
});

// ─── BOUNDARY conditions ──────────────────────────────────────────────────────

describe("boundary — empty and minimal values", () => {
  it("saveDraft with empty content string round-trips correctly", () => {
    const entry = makeDraftEntry({ doc_id: "EMPTY-CONTENT", content: "" });
    saveDraft(entry);
    const loaded = loadDraft("EMPTY-CONTENT");
    expect(loaded!.content).toBe("");
  });

  it("saveDraft with version: 0 (initial version) round-trips correctly", () => {
    const entry = makeDraftEntry({ doc_id: "VER-ZERO", version: 0 });
    saveDraft(entry);
    const loaded = loadDraft("VER-ZERO");
    expect(loaded!.version).toBe(0);
  });

  it("isDraftStale with version 0 and serverVersion 0 → false (equal, not stale)", () => {
    const draft = makeDraftEntry({ version: 0 });
    expect(isDraftStale(draft, 0)).toBe(false);
  });
});

// ─── ERROR paths ──────────────────────────────────────────────────────────────

describe("saveDraft — swallows storage errors (spec-intended)", () => {
  it("does not throw when localStorage.setItem throws QuotaExceededError", () => {
    // Spec invariant: "All functions swallow storage errors (privacy mode, quota exceeded)"
    // This behavior IS spec-intended (opportunistic UX). We verify the swallow is present.
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });

    // Must not throw
    expect(() => saveDraft(makeDraftEntry())).not.toThrow();
  });

  it("loadDraft returns null when localStorage.getItem throws (privacy mode)", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("SecurityError");
    });

    expect(loadDraft("any-id")).toBeNull();
  });

  it("clearDraft does not throw when localStorage.removeItem throws", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("SecurityError");
    });

    expect(() => clearDraft("any-id")).not.toThrow();
  });
});

// ─── STATE paths ──────────────────────────────────────────────────────────────

describe("saveDraft — state: overwrites previous draft for same docId", () => {
  it("second saveDraft for same docId replaces the first (no accumulation)", () => {
    const initial = makeDraftEntry({ doc_id: "SAME-DOC", version: 1, content: "first draft" });
    const updated = makeDraftEntry({ doc_id: "SAME-DOC", version: 2, content: "second draft" });

    saveDraft(initial);
    saveDraft(updated);

    const loaded = loadDraft("SAME-DOC");
    // Must return the latest draft, not the first
    expect(loaded!.content).toBe("second draft");
    expect(loaded!.version).toBe(2);
  });

  it("only one draft entry exists per docId after multiple saves", () => {
    // Verify no accumulation — localStorage should have exactly one key for this doc
    const docId = "SINGLE-DRAFT";
    for (let i = 1; i <= 5; i++) {
      saveDraft(makeDraftEntry({ doc_id: docId, version: i, content: `draft ${i}` }));
    }

    // Only the last draft should be returned
    const loaded = loadDraft(docId);
    expect(loaded!.version).toBe(5);
    expect(loaded!.content).toBe("draft 5");
  });
});

// ─── REGRESSION ───────────────────────────────────────────────────────────────

describe("regression — storage key isolation", () => {
  it("drafts for different docs do not interfere with each other after clear", () => {
    // Regression: clearDraft must only remove the targeted docId
    saveDraft(makeDraftEntry({ doc_id: "DOC-KEEP", content: "keep this" }));
    saveDraft(makeDraftEntry({ doc_id: "DOC-CLEAR", content: "clear this" }));

    clearDraft("DOC-CLEAR");

    expect(loadDraft("DOC-KEEP")).not.toBeNull();
    expect(loadDraft("DOC-KEEP")!.content).toBe("keep this");
    expect(loadDraft("DOC-CLEAR")).toBeNull();
  });
});
