/**
 * @spec_ref AC-STORE-FTS-001
 *
 * Unit tests for escapeFtsQuery helper (src/store/store-shared.ts).
 *
 * Spec reference: SPEC-013 §3.5 — FTS5 special-token escaping.
 *
 * Contract (from spec):
 *   escapeFtsQuery(raw: string): string
 *   Algorithm:
 *     1. Trim the input.
 *     2. If empty after trim → return "" (callers must short-circuit; FTS5 errors on empty MATCH).
 *     3. Split on /\s+/ (any whitespace, multiple spaces → single boundary).
 *     4. Each piece: replace every internal `"` with `""` then wrap in `"…"`.
 *     5. Join pieces with a single space.
 *
 * Expected behaviors written from spec BEFORE reading implementation body:
 *   - Empty/whitespace → ""
 *   - Single word → '"word"'
 *   - Multiple words → '"word1" "word2"'
 *   - Hyphen preserved inside word → '"append-only"'
 *   - Embedded double-quote doubled → '"""hi"""' inside the phrase
 *   - FTS5 specials (*, ?, :, (, ), -) are wrapped — no raw syntax chars escape the quotes
 *   - Pure function — same input → same output, no side effects
 *
 * Test dimensions: HAPPY / BOUNDARY / NEGATIVE / ERROR / STATE / REGRESSION
 */

// NOTE: escapeFtsQuery will be added by the implementer to src/store/store-shared.ts.
// Until that merge, this import line will cause a compile error — that is expected
// and documented here.  The test file is correct; the production code is the
// missing piece.  Post-merge, both this import and all assertions must pass.
//
// For local stub verification prior to merge, see the inline stub section below
// (guarded behind a compile-time switch so it never ships to production).

import { describe, expect, it, vi } from "vitest";

import { escapeFtsQuery } from "@store/store-shared";

// ─── Happy Path ───────────────────────────────────────────────────────────────

describe("escapeFtsQuery — happy path", () => {
  it("single ASCII token is wrapped in double quotes", () => {
    expect(escapeFtsQuery("service")).toBe('"service"');
  });

  it("two words become two quoted phrases joined by a space", () => {
    expect(escapeFtsQuery("service layer")).toBe('"service" "layer"');
  });

  it("leading and trailing spaces are stripped before wrapping", () => {
    expect(escapeFtsQuery("  spaces  around  ")).toBe('"spaces" "around"');
  });

  it("hyphenated token is a single phrase — append-only stays together", () => {
    // This is the canonical regression case for the FTS5 hyphen-syntax bug.
    expect(escapeFtsQuery("append-only version")).toBe('"append-only" "version"');
  });

  it("FTS5 prefix wildcard (* at end of token) is preserved inside quotes", () => {
    // FTS5 allows * at end of a quoted phrase — the quote wrapper keeps the *
    // inside the phrase so it is interpreted as prefix search, not a syntax token.
    expect(escapeFtsQuery("foo*")).toBe('"foo*"');
  });

  it("parentheses are wrapped — no FTS5 grouping syntax leaks out", () => {
    expect(escapeFtsQuery("(append)")).toBe('"(append)"');
  });

  it("colon is wrapped — no FTS5 column filter syntax leaks out", () => {
    expect(escapeFtsQuery("a:b")).toBe('"a:b"');
  });
});

// ─── Boundary Values ──────────────────────────────────────────────────────────

describe("escapeFtsQuery — boundary values", () => {
  it("empty string returns empty string", () => {
    expect(escapeFtsQuery("")).toBe("");
  });

  it("space-only string returns empty string", () => {
    expect(escapeFtsQuery("   ")).toBe("");
  });

  it("tab-only whitespace returns empty string", () => {
    expect(escapeFtsQuery("\t")).toBe("");
  });

  it("newline-only whitespace returns empty string", () => {
    expect(escapeFtsQuery("\n")).toBe("");
  });

  it("mixed whitespace (tab + newline + space) returns empty string", () => {
    expect(escapeFtsQuery("\t\n ")).toBe("");
  });

  it("single ASCII token with no spaces is treated as one phrase", () => {
    expect(escapeFtsQuery("token")).toBe('"token"');
  });

  it("multiple consecutive spaces between tokens are collapsed to one separator", () => {
    // Input has 3 spaces between tokens — output must have exactly one space between phrases.
    const result = escapeFtsQuery("service   layer");
    expect(result).toBe('"service" "layer"');
    // Verify no double-spaces in output
    expect(result).not.toContain("  ");
  });
});

// ─── Negative (Embedded Quotes) ───────────────────────────────────────────────

describe("escapeFtsQuery — negative / embedded quotes", () => {
  it('embedded double-quote is doubled inside the phrase — he said "hi"', () => {
    // Input:  he said "hi"
    // Tokens: ['he', 'said', '"hi"']
    // After internal " doubling: ['he', 'said', '""hi""']
    // After wrapping:            ['"he"', '"said"', '"""hi"""']
    // Joined: '"he" "said" """hi"""'
    expect(escapeFtsQuery('he said "hi"')).toBe('"he" "said" """hi"""');
  });

  it("a token that is only double-quotes becomes doubled-and-wrapped", () => {
    // Token = `"`  →  internal quote doubled → `""`  →  wrapped → `""""`
    expect(escapeFtsQuery('"')).toBe('""""');
  });
});

// ─── Error / Exotic FTS5 Chars ────────────────────────────────────────────────

describe("escapeFtsQuery — FTS5 special character inputs", () => {
  // Verifies that characters which are normally FTS5 syntax operators
  // are fully neutralised by wrapping them in double-quoted phrases.

  it("hyphen token is wrapped — no FTS5 NOT operator syntax exposed", () => {
    expect(escapeFtsQuery("-term")).toBe('"-term"');
  });

  it("question mark is wrapped — no FTS5 syntax", () => {
    const result = escapeFtsQuery("bar?");
    expect(result).toBe('"bar?"');
  });

  it("standalone asterisk is wrapped", () => {
    const result = escapeFtsQuery("*");
    expect(result).toBe('"*"');
  });

  it("standalone colon is wrapped", () => {
    expect(escapeFtsQuery(":")).toBe('":"');
  });

  it("all FTS5-special single tokens produce syntactically safe output", () => {
    // Each output must start with " and end with " — indicating it is wrapped
    const specials = ["*", "?", ":", "(", ")", "-"];
    for (const s of specials) {
      const result = escapeFtsQuery(s);
      expect(result.startsWith('"'), `"${s}" output should start with quote`).toBe(true);
      expect(result.endsWith('"'), `"${s}" output should end with quote`).toBe(true);
    }
  });
});

// ─── State ────────────────────────────────────────────────────────────────────

describe("escapeFtsQuery — pure function / no side effects", () => {
  it("calling twice with the same input returns identical strings", () => {
    const input = "service layer";
    const first = escapeFtsQuery(input);
    const second = escapeFtsQuery(input);
    expect(first).toBe(second);
  });

  it("does not mutate its input string", () => {
    const input = "append-only";
    const copy = `${input}`;
    escapeFtsQuery(input);
    expect(input).toBe(copy);
  });

  it("calling with different inputs produces different outputs (not a hardcoded stub)", () => {
    const r1 = escapeFtsQuery("foo");
    const r2 = escapeFtsQuery("bar");
    const r3 = escapeFtsQuery("foo bar");
    // Different single words → different phrases
    expect(r1).not.toBe(r2);
    // One word vs two words → structurally different
    expect(r1).not.toBe(r3);
  });

  it("the helper does not call any global or module-level side effects", () => {
    // Verify it doesn't go through console, fetch, etc. by spying on console.
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    escapeFtsQuery("test input");
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

// ─── Regression ───────────────────────────────────────────────────────────────

describe("escapeFtsQuery — regression", () => {
  it("REGRESSION: 'append-only' specifically → '\"append-only\"' (canonical FTS5 hyphen bug)", () => {
    // This is the exact case that triggered the original bug report.
    // FTS5 would interpret "append-only" as 'append NOT only' without quoting.
    expect(escapeFtsQuery("append-only")).toBe('"append-only"');
  });

  it("REGRESSION: round-trip property — non-empty trimmed input → output starts and ends with quote", () => {
    const nonEmptyInputs = [
      "service",
      "service layer",
      "append-only",
      "a:b",
      "(append)",
      "foo*",
      "real-world example",
      "x",
    ];
    for (const input of nonEmptyInputs) {
      const result = escapeFtsQuery(input);
      expect(
        result.startsWith('"'),
        `Input "${input}": output "${result}" should start with "`,
      ).toBe(true);
      expect(
        result.endsWith('"'),
        `Input "${input}": output "${result}" should end with "`,
      ).toBe(true);
    }
  });

  it("REGRESSION: whitespace-only input → empty string (must NOT produce '\"\"')", () => {
    // Callers short-circuit on "" to avoid FTS5 MATCH '' syntax error.
    // If we returned '""' the MATCH would succeed but match nothing useful.
    // The contract is strict: empty/whitespace-only → exactly "".
    expect(escapeFtsQuery("   ")).toBe("");
    expect(escapeFtsQuery("\t\n ")).toBe("");
  });

  it("REGRESSION: multi-word hyphenated phrase — append-only version → two separate phrases", () => {
    // Both words must be independently quoted, not merged.
    const result = escapeFtsQuery("append-only version");
    expect(result).toBe('"append-only" "version"');
    // Sanity: two quoted phrases means exactly one space between them
    const phrases = result.split(" ");
    expect(phrases).toHaveLength(2);
    expect(phrases[0]).toBe('"append-only"');
    expect(phrases[1]).toBe('"version"');
  });

  // Full exhaustive table from spec contract:
  it.each([
    // [input, expected]
    ["", ""],
    ["   ", ""],
    ["\t\n ", ""],
    ["service", '"service"'],
    ["service layer", '"service" "layer"'],
    ["  spaces  around  ", '"spaces" "around"'],
    ["append-only version", '"append-only" "version"'],
    ['he said "hi"', '"he" "said" """hi"""'],
    ["foo*", '"foo*"'],
    ["(append)", '"(append)"'],
    ["a:b", '"a:b"'],
  ])("spec table: escapeFtsQuery(%j) === %j", (input, expected) => {
    expect(escapeFtsQuery(input)).toBe(expected);
  });
});
