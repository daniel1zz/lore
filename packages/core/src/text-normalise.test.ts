/**
 * Unit tests for canonicaliseBody() in @lore/core/text-normalise.
 *
 * Spec-first design: expected values are derived from the SPEC-021 §4 contract,
 * NOT from reading the implementation output. Tests must catch regressions such
 * as using trimEnd() instead of trim(), or forgetting CRLF normalisation.
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / REGRESSION
 *
 * @spec_ref SPEC-021 §4 "CRITICAL — whitespace parity"
 */

import { describe, it, expect } from "vitest";
import { canonicaliseBody } from "./text-normalise.js";

// ─── HAPPY: CRLF → LF conversion ─────────────────────────────────────────────

describe("HAPPY — CRLF to LF conversion", () => {
  it("converts single CRLF to LF and ensures trailing newline", () => {
    // Spec: CRLF→LF is step 1; result must end with exactly one newline
    expect(canonicaliseBody("foo\r\nbar")).toBe("foo\nbar\n");
  });

  it("converts multiple CRLFs throughout the string", () => {
    expect(canonicaliseBody("line1\r\nline2\r\nline3\r\n")).toBe("line1\nline2\nline3\n");
  });

  it("handles mixed CRLF and LF (Windows file opened on Unix)", () => {
    expect(canonicaliseBody("foo\r\nbar\nbaz\r\n")).toBe("foo\nbar\nbaz\n");
  });
});

// ─── HAPPY: Trailing whitespace and newline normalisation ─────────────────────

describe("HAPPY — trailing whitespace and newline normalisation", () => {
  it("string without newline gets exactly one trailing newline appended", () => {
    expect(canonicaliseBody("foo")).toBe("foo\n");
  });

  it("already-normalised string with single trailing newline is unchanged", () => {
    expect(canonicaliseBody("foo\n")).toBe("foo\n");
  });

  it("multiple trailing newlines collapse to exactly one", () => {
    // trim() removes all trailing whitespace including extra newlines
    expect(canonicaliseBody("foo\n\n\n")).toBe("foo\n");
  });

  it("trailing spaces before the newline are removed", () => {
    expect(canonicaliseBody("foo   ")).toBe("foo\n");
    expect(canonicaliseBody("foo   \n")).toBe("foo\n");
  });
});

// ─── HAPPY: Leading whitespace trimming ──────────────────────────────────────

describe("HAPPY — leading whitespace trimming", () => {
  it("leading spaces are removed", () => {
    // Spec: trim() not trimEnd() — roundtrip parity with sync-docs which strips leading WS
    expect(canonicaliseBody("   foo")).toBe("foo\n");
  });

  it("leading newlines are removed", () => {
    expect(canonicaliseBody("\n\nfoo")).toBe("foo\n");
  });

  it("leading CRLF sequences are removed (after CRLF→LF conversion)", () => {
    expect(canonicaliseBody("\r\n\r\nfoo")).toBe("foo\n");
  });

  it("leading tabs are removed", () => {
    expect(canonicaliseBody("\t\tfoo")).toBe("foo\n");
  });
});

// ─── NEGATIVE: Adversarial — catches trimEnd() instead of trim() ──────────────

describe("NEGATIVE — full trim() required, not just trimEnd()", () => {
  it("both leading AND trailing whitespace removed — adversarial for trimEnd-only", () => {
    // If implementation used trimEnd() instead of trim():
    //   "  foo  " → trimEnd → "  foo" + "\n" = "  foo\n"  ← WRONG
    // Correct with trim():
    //   "  foo  " → trim → "foo" + "\n" = "foo\n"       ← RIGHT
    expect(canonicaliseBody("  foo  ")).toBe("foo\n");
  });

  it("leading whitespace preserved by trimEnd() would cause roundtrip mismatch", () => {
    // sync-docs strips leading whitespace from file body via trimStart().
    // If canonicaliseBody does NOT strip leading WS, the corpus and file sides diverge.
    const withLeadingWS = "   # Spec\n\nBody content.";
    const withoutLeadingWS = "# Spec\n\nBody content.\n";
    expect(canonicaliseBody(withLeadingWS)).toBe(withoutLeadingWS);
  });
});

// ─── BOUNDARY: Empty and whitespace-only strings ──────────────────────────────

describe("BOUNDARY — empty and whitespace-only inputs", () => {
  it("empty string produces exactly one newline (not empty string)", () => {
    // Empty: trim → "", + "\n" = "\n"
    // Must NOT produce "" or "\n\n"
    expect(canonicaliseBody("")).toBe("\n");
  });

  it("whitespace-only string produces exactly one newline", () => {
    expect(canonicaliseBody("   ")).toBe("\n");
  });

  it("newlines-only string produces exactly one newline", () => {
    expect(canonicaliseBody("\n\n\n")).toBe("\n");
  });

  it("CRLF-only string produces exactly one newline", () => {
    // "\r\n\r\n" → CRLF→LF → "\n\n" → trim → "" + "\n" = "\n"
    expect(canonicaliseBody("\r\n\r\n")).toBe("\n");
  });

  it("single space produces exactly one newline", () => {
    expect(canonicaliseBody(" ")).toBe("\n");
  });
});

// ─── BOUNDARY: Internal newlines are preserved ───────────────────────────────

describe("BOUNDARY — internal structure preserved", () => {
  it("internal newlines between lines are not removed", () => {
    expect(canonicaliseBody("line1\nline2")).toBe("line1\nline2\n");
  });

  it("blank lines within content are preserved", () => {
    const body = "para1\n\npara2\n\npara3\n";
    expect(canonicaliseBody(body)).toBe("para1\n\npara2\n\npara3\n");
  });

  it("a body with exactly one trailing newline is unchanged", () => {
    expect(canonicaliseBody("content\n")).toBe("content\n");
  });
});

// ─── REGRESSION: Idempotency — canonicaliseBody(canonicaliseBody(s)) === canonicaliseBody(s) ──

describe("REGRESSION — idempotency invariant (SPEC-021 §4)", () => {
  it("applying canonicaliseBody twice gives the same result as once", () => {
    const testInputs = [
      "foo\r\n\r\nbar\r\n",
      "  leading spaces\n",
      "trailing spaces   \n",
      "\n\n\n",
      "",
      "normal body\n",
      "foo",
      "line1\nline2\nline3",
      "\t\tfoo\t\t",
      "mixed\r\nline endings\n",
    ];

    for (const input of testInputs) {
      const once = canonicaliseBody(input);
      const twice = canonicaliseBody(once);
      expect(twice).toBe(once);
    }
  });

  it("idempotency holds for a multi-line Markdown document", () => {
    const body = "# Heading\r\n\r\nParagraph 1.\r\n\r\nParagraph 2.\r\n";
    const once = canonicaliseBody(body);
    const twice = canonicaliseBody(once);
    expect(twice).toBe(once);
    // Verify the canonical form: LF only, single trailing newline
    expect(once).not.toContain("\r");
    expect(once.endsWith("\n")).toBe(true);
    expect(once.endsWith("\n\n")).toBe(false);
  });
});
