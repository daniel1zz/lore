/**
 * Tests for @lore/core spec-kind-audit.ts — TECH_SIGNAL_PATTERN,
 * DESIGN_SIGNAL_PATTERN, detectSpecKindSignal. Pure regex module, no IO.
 *
 * Spec-first: assertions come from the JSDoc invariants documented at the top
 * of spec-kind-audit.ts (SPEC-032 §3.4) — title always wins over content;
 * when both signals fire in the SAME field, tech wins (checked first); null
 * when neither pattern fires anywhere.
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      title-only tech match, title-only design match, content-only
 *               tech match, content-only design match
 *   NEGATIVE:   neither pattern fires anywhere → null
 *   BOUNDARY:   title wins over content (opposite kinds in each field); tech
 *               wins over design within the SAME field; case-insensitivity;
 *               word-boundary correctness (no accidental substring matches)
 *   ERROR:      n/a — pure function, no error paths, never throws (asserted
 *               implicitly: all calls below complete without throwing)
 *   STATE:      n/a — pure, no persisted state
 *   REGRESSION: two different (title, content) pairs must not collapse to
 *               the same output (defeats a hardcoded-return stub)
 *
 * @spec_ref SPEC-032 §3.4
 */

import { describe, it, expect } from "vitest";
import {
  detectSpecKindSignal,
  TECH_SIGNAL_PATTERN,
  DESIGN_SIGNAL_PATTERN,
} from "./spec-kind-audit.js";

// ─── HAPPY ───────────────────────────────────────────────────────────────────

describe("detectSpecKindSignal — HAPPY", () => {
  it("title-only tech signal ('architecture') → kind=tech, matchedIn=title", () => {
    const result = detectSpecKindSignal("Corpus Architecture Overview", "Nothing relevant here.");

    expect(result).not.toBeNull();
    expect(result?.kind).toBe("tech");
    expect(result?.matchedIn).toBe("title");
  });

  it("title-only design signal ('dashboard') → kind=design, matchedIn=title", () => {
    const result = detectSpecKindSignal("Dashboard Redesign", "Nothing relevant here.");

    expect(result).not.toBeNull();
    expect(result?.kind).toBe("design");
    expect(result?.matchedIn).toBe("title");
  });

  it("content-only tech signal ('storage') → kind=tech, matchedIn=content (title has no signal)", () => {
    const result = detectSpecKindSignal(
      "Untitled Doc",
      "This describes the new storage layer for the corpus.",
    );

    expect(result).not.toBeNull();
    expect(result?.kind).toBe("tech");
    expect(result?.matchedIn).toBe("content");
  });

  it("content-only design signal ('prototype') → kind=design, matchedIn=content (title has no signal)", () => {
    const result = detectSpecKindSignal(
      "Untitled Doc",
      "We built an interactive prototype for user testing.",
    );

    expect(result).not.toBeNull();
    expect(result?.kind).toBe("design");
    expect(result?.matchedIn).toBe("content");
  });

  it("different inputs produce different outputs (defeats a hardcoded-return stub)", () => {
    const techResult = detectSpecKindSignal("Storage Migration Plan", "");
    const designResult = detectSpecKindSignal("Component Library Prototype", "");

    expect(techResult?.kind).toBe("tech");
    expect(designResult?.kind).toBe("design");
    expect(techResult?.kind).not.toBe(designResult?.kind);
  });
});

// ─── NEGATIVE ────────────────────────────────────────────────────────────────

describe("detectSpecKindSignal — NEGATIVE", () => {
  it("neither pattern fires anywhere in title or content → null", () => {
    const result = detectSpecKindSignal(
      "Quarterly Roadmap Review",
      "This document covers upcoming feature priorities and timelines.",
    );

    expect(result).toBeNull();
  });

  it("empty title and empty content → null", () => {
    const result = detectSpecKindSignal("", "");

    expect(result).toBeNull();
  });
});

// ─── BOUNDARY ────────────────────────────────────────────────────────────────

describe("detectSpecKindSignal — BOUNDARY", () => {
  it("title match wins even when content has a signal for the OTHER kind", () => {
    // title: tech signal ("architecture"); content: design signal ("dashboard ui")
    const result = detectSpecKindSignal(
      "Corpus Architecture Notes",
      "This powers the dashboard ui for end users.",
    );

    expect(result).not.toBeNull();
    expect(result?.kind).toBe("tech");
    expect(result?.matchedIn).toBe("title");
    expect(result?.signal.toLowerCase()).toBe("architecture");
  });

  it("title match wins the other direction too — design in title, tech in content", () => {
    const result = detectSpecKindSignal(
      "Dashboard Visual Redesign",
      "Backed by a new storage migration.",
    );

    expect(result).not.toBeNull();
    expect(result?.kind).toBe("design");
    expect(result?.matchedIn).toBe("title");
  });

  it("both tech and design signals fire in the SAME title → tech wins (deterministic tie-break)", () => {
    // "architecture" (tech) and "dashboard" (design) both present in title.
    const result = detectSpecKindSignal("Dashboard Architecture Plan", "irrelevant");

    expect(result).not.toBeNull();
    expect(result?.kind).toBe("tech");
    expect(result?.matchedIn).toBe("title");
  });

  it("both tech and design signals fire in the SAME content (title has nothing) → tech wins", () => {
    const result = detectSpecKindSignal(
      "Untitled Doc",
      "This dashboard component relies on a new schema migration.",
    );

    expect(result).not.toBeNull();
    expect(result?.kind).toBe("tech");
    expect(result?.matchedIn).toBe("content");
  });

  it("word-boundary: 'migrationservice' (no space) does not match the 'migration' signal", () => {
    // If \b boundaries are respected, "migration" embedded inside a longer
    // unrelated identifier must NOT fire — this defeats a naive .includes()-style match.
    const result = detectSpecKindSignal("The migrationservice module", "Some unrelated body text.");

    expect(result).toBeNull();
  });

  it("word-boundary: 'prototypical' does not match the 'prototype' signal", () => {
    const result = detectSpecKindSignal(
      "A prototypical example",
      "Some unrelated body text with no other signals.",
    );

    expect(result).toBeNull();
  });

  it("case-insensitivity: 'ARCHITECTURE' (all caps) still matches as tech", () => {
    const result = detectSpecKindSignal("SYSTEM ARCHITECTURE OVERVIEW", "");

    expect(result).not.toBeNull();
    expect(result?.kind).toBe("tech");
  });

  it("case-insensitivity: 'Dashboard' (mixed case) still matches as design", () => {
    const result = detectSpecKindSignal("New Dashboard Layout", "");

    expect(result).not.toBeNull();
    expect(result?.kind).toBe("design");
  });
});

// ─── Exported regex constants ───────────────────────────────────────────────

describe("TECH_SIGNAL_PATTERN / DESIGN_SIGNAL_PATTERN", () => {
  it("TECH_SIGNAL_PATTERN is case-insensitive", () => {
    expect(TECH_SIGNAL_PATTERN.flags).toContain("i");
  });

  it("DESIGN_SIGNAL_PATTERN is case-insensitive", () => {
    expect(DESIGN_SIGNAL_PATTERN.flags).toContain("i");
  });

  it("TECH_SIGNAL_PATTERN does not match a substring embedded in an unrelated word", () => {
    expect(TECH_SIGNAL_PATTERN.test("migrationservice")).toBe(false);
  });

  it("TECH_SIGNAL_PATTERN matches 'migration' as a standalone word", () => {
    expect(TECH_SIGNAL_PATTERN.test("a database migration plan")).toBe(true);
  });

  it("DESIGN_SIGNAL_PATTERN does not match a substring embedded in an unrelated word", () => {
    expect(DESIGN_SIGNAL_PATTERN.test("prototypical")).toBe(false);
  });

  it("DESIGN_SIGNAL_PATTERN matches 'ui' as a standalone word (not inside e.g. 'build')", () => {
    expect(DESIGN_SIGNAL_PATTERN.test("build")).toBe(false);
    expect(DESIGN_SIGNAL_PATTERN.test("the new ui layer")).toBe(true);
  });
});
