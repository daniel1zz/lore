/**
 * Unit tests for splitFrontmatter() in @lore/core/frontmatter.
 *
 * Spec-first design: expected values are derived from the module's own JSDoc
 * header contract (two DISTINCT closing-delimiter dialects — "loose" is
 * MigrationService's original `indexOf("\n---")` algorithm with trim() on both
 * sides; "strict" is ExportDocsService's original `/^---\n[\s\S]*?\n---\n/`
 * regex algorithm with NO trimming) BEFORE reading the implementation body.
 *
 * This module is the byte-identical-preservation contract for a refactor
 * extracting duplicated delimiter-splitting logic out of migration-service.ts
 * and export-docs-service.ts — tests assert what each dialect is DOCUMENTED to
 * do, not a convenient simplification of it.
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / REGRESSION
 *
 * @spec_ref AC-FRONTMATTER-SPLIT — frontmatter.ts module header (loose/strict dialects)
 */

import { describe, it, expect } from "vitest";
import { splitFrontmatter } from "./frontmatter.js";

// ─── HAPPY ──────────────────────────────────────────────────────────────────

describe("HAPPY — loose mode basic split", () => {
  it("splits a simple frontmatter block and trims both sides", () => {
    const result = splitFrontmatter("---\nid: x\n---\nbody", "loose");
    expect(result).toEqual({ ok: true, frontmatter: "id: x", body: "body" });
  });
});

describe("HAPPY — strict mode basic split", () => {
  it("splits a simple frontmatter block (well-formed input, no whitespace to trim)", () => {
    const result = splitFrontmatter("---\nid: x\n---\nbody", "strict");
    expect(result).toEqual({ ok: true, frontmatter: "id: x", body: "body" });
  });
});

describe("HAPPY — trim divergence between loose and strict", () => {
  const input = "---\n  id: x  \n---\n  body  ";

  it("strict mode does NOT trim frontmatter or body — internal whitespace preserved verbatim", () => {
    const result = splitFrontmatter(input, "strict");
    expect(result).toEqual({ ok: true, frontmatter: "  id: x  ", body: "  body  " });
  });

  it("loose mode DOES trim frontmatter and body", () => {
    const result = splitFrontmatter(input, "loose");
    expect(result).toEqual({ ok: true, frontmatter: "id: x", body: "body" });
  });

  it("the two dialects diverge on the identical input — strict output != loose output", () => {
    const strictResult = splitFrontmatter(input, "strict");
    const looseResult = splitFrontmatter(input, "loose");
    expect(strictResult).not.toEqual(looseResult);
  });
});

// ─── NEGATIVE ───────────────────────────────────────────────────────────────

describe("NEGATIVE — no leading '---' rejected by both modes", () => {
  it("loose mode rejects text with no leading '---'", () => {
    const result = splitFrontmatter("no frontmatter here", "loose");
    expect(result).toEqual({
      ok: false,
      error: "No YAML frontmatter found (must start with ---)",
    });
  });

  it("strict mode rejects text with no leading '---'", () => {
    const result = splitFrontmatter("no frontmatter here", "strict");
    expect(result).toEqual({
      ok: false,
      error: "No YAML frontmatter found (must start with ---)",
    });
  });

  it("loose mode rejects a fully empty string", () => {
    const result = splitFrontmatter("", "loose");
    expect(result).toEqual({
      ok: false,
      error: "No YAML frontmatter found (must start with ---)",
    });
  });

  it("strict mode rejects a fully empty string", () => {
    const result = splitFrontmatter("", "strict");
    expect(result).toEqual({
      ok: false,
      error: "No YAML frontmatter found (must start with ---)",
    });
  });
});

// ─── BOUNDARY: loose mode ───────────────────────────────────────────────────

describe("BOUNDARY — loose mode", () => {
  it("empty frontmatter block yields frontmatter ''", () => {
    const result = splitFrontmatter("---\n---\nbody", "loose");
    expect(result).toEqual({ ok: true, frontmatter: "", body: "body" });
  });

  it("unclosed block (no closing '---' anywhere) yields the unclosed error", () => {
    const result = splitFrontmatter("---\nkey: value", "loose");
    expect(result).toEqual({
      ok: false,
      error: "Unclosed YAML frontmatter (missing closing ---)",
    });
  });

  it("closing '---' at EOF with no trailing newline still succeeds, body is ''", () => {
    const result = splitFrontmatter("---\nkey: val\n---", "loose");
    expect(result).toEqual({ ok: true, frontmatter: "key: val", body: "" });
  });

  it("CRLF input is parsed successfully — trim() strips the stray \\r", () => {
    const result = splitFrontmatter("---\r\nkey: value\r\n---\r\nbody", "loose");
    expect(result).toEqual({ ok: true, frontmatter: "key: value", body: "body" });
  });
});

// ─── BOUNDARY: strict mode ──────────────────────────────────────────────────

describe("BOUNDARY — strict mode", () => {
  it("opening delimiter not immediately followed by newline (four dashes) is rejected as 'no frontmatter'", () => {
    // Strict-mode-specific rejection: loose mode would NOT reject this shape
    // (loose only checks text.startsWith("---"), which four dashes also satisfies).
    const result = splitFrontmatter("----\nkey\n---\n", "strict");
    expect(result).toEqual({
      ok: false,
      error: "No YAML frontmatter found (must start with ---)",
    });
  });

  it("loose mode would NOT reject the same four-dash input at the opening-delimiter stage", () => {
    // Documents the divergence asserted above: loose only requires startsWith("---").
    const result = splitFrontmatter("----\nkey\n---\n", "loose");
    expect(result.ok).toBe(true);
  });

  it("unclosed block (no full '\\n---\\n' anywhere) yields the unclosed error", () => {
    const result = splitFrontmatter("---\nkey: value", "strict");
    expect(result).toEqual({
      ok: false,
      error: "Unclosed YAML frontmatter (missing closing ---)",
    });
  });

  it("closing '---' at EOF with NO trailing newline FAILS in strict mode (documented divergence from loose)", () => {
    const result = splitFrontmatter("---\nkey: val\n---", "strict");
    expect(result).toEqual({
      ok: false,
      error: "Unclosed YAML frontmatter (missing closing ---)",
    });
  });

  it("the identical EOF-no-trailing-newline input SUCCEEDS in loose mode — cross-mode divergence", () => {
    const input = "---\nkey: val\n---";
    const strictResult = splitFrontmatter(input, "strict");
    const looseResult = splitFrontmatter(input, "loose");
    expect(strictResult.ok).toBe(false);
    expect(looseResult.ok).toBe(true);
  });

  it("well-formed closing with trailing newline succeeds", () => {
    const result = splitFrontmatter("---\nkey: val\n---\n", "strict");
    expect(result).toEqual({ ok: true, frontmatter: "key: val", body: "" });
  });
});
