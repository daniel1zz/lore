/**
 * Unit tests for the SPEC-037 §2 snippet-highlight-sentinel contract in
 * @lore/core/types.
 *
 * These constants are the SSOT consumed by SQLiteStore, TursoStore,
 * InMemoryStore, and (out of this task's scope) the dashboard's
 * SearchResultCard. A typo in the literal control-char values would silently
 * desync the store layer from the render layer, so the exact byte values are
 * asserted here rather than trusted to "looks right."
 *
 * Coverage dimensions: HAPPY / BOUNDARY / REGRESSION
 *
 * @spec_ref SPEC-037 §2 "SearchHit" contract
 */

import { describe, it, expect } from "vitest";
import {
  SNIPPET_MARK_CLOSE,
  SNIPPET_MARK_OPEN,
  type SearchHit,
} from "./types.js";

describe("HAPPY — SNIPPET_MARK_OPEN / SNIPPET_MARK_CLOSE", () => {
  it("are the exact C0 control-char sentinels specified by SPEC-037 §2", () => {
    expect(SNIPPET_MARK_OPEN).toBe("");
    expect(SNIPPET_MARK_CLOSE).toBe("");
  });

  it("are distinct from each other", () => {
    expect(SNIPPET_MARK_OPEN).not.toBe(SNIPPET_MARK_CLOSE);
  });
});

describe("BOUNDARY — sentinels cannot collide with literal markdown syntax", () => {
  it("are not the literal '[' / ']' characters they replace", () => {
    expect(SNIPPET_MARK_OPEN).not.toBe("[");
    expect(SNIPPET_MARK_CLOSE).not.toBe("]");
  });

  it("never appear inside ordinary authored text (control chars are unprintable)", () => {
    const authoredLine = "See [figure 3] for details — 100% typical markdown.";
    expect(authoredLine.includes(SNIPPET_MARK_OPEN)).toBe(false);
    expect(authoredLine.includes(SNIPPET_MARK_CLOSE)).toBe(false);
  });
});

describe("REGRESSION — SearchHit shape carries type/status (SPEC-037 §2)", () => {
  it("compiles a SearchHit literal with the extended fields", () => {
    // Type-level regression: fails to compile (not fails at runtime) if
    // `type`/`status` are ever removed from the SearchHit interface.
    const hit: SearchHit = {
      id: "01HTESTDOCID00000000000001",
      slug: "spec-example",
      title: "Example",
      snippet: `before ${SNIPPET_MARK_OPEN}match${SNIPPET_MARK_CLOSE} after`,
      score: 1.5,
      type: "spec",
      status: "approved",
      created_at: "2026-07-01T00:00:00.000Z",
    };
    expect(hit.type).toBe("spec");
    expect(hit.status).toBe("approved");
  });
});
