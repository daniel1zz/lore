/**
 * Unit tests for the pure "active feeding" content-assembly functions
 * (`buildFeedingPack` / `renderFeedingPack`) that back `lore gate spec-create`'s
 * minimal-slice AI feedback (IoC vertical-slice tech-spec §4.1/§11). Pure functions
 * only — no store, no IO — hence vitest, not `.bun.test`.
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / ERROR / REGRESSION.
 * STATE is intentionally absent — these are pure functions with no persisted or
 * mutable state to transition (mirrors gate-predicates.test.ts's documented rationale).
 */

import { describe, it, expect } from "vitest";
import {
  buildFeedingPack,
  renderFeedingPack,
  DEFAULT_FEEDING_MAX_CHARS,
} from "../../../src/service/gate-feeding.js";

describe("buildFeedingPack", () => {
  // HAPPY
  it("assembles a pack with rule + parent slices under maxChars unchanged", () => {
    const pack = buildFeedingPack({
      ruleSource: "knowledge-write-spec-rules",
      ruleMarkdown: "## Rule\nSpecs must declare spec_kind.",
      parentMarkdown: "## Parent\nA PRD body.",
      missing: ["PARENT_REQUIRED"],
    });
    expect(pack).toEqual({
      source: "knowledge-write-spec-rules",
      trust: "team-authored",
      ruleSlice: "## Rule\nSpecs must declare spec_kind.",
      parentSlice: "## Parent\nA PRD body.",
      missing: ["PARENT_REQUIRED"],
    });
  });

  // NEGATIVE
  it("omits parentSlice entirely when parentMarkdown is not supplied", () => {
    const pack = buildFeedingPack({
      ruleSource: "knowledge-write-spec-rules",
      ruleMarkdown: "## Rule\nshort",
      missing: [],
    });
    expect(pack.parentSlice).toBeUndefined();
    expect("parentSlice" in pack).toBe(false);
  });

  // NEGATIVE — empty parentMarkdown is a PROVIDED empty slice, not "no parent slice"
  it("keeps parentSlice as an empty string when parentMarkdown is explicitly empty", () => {
    const pack = buildFeedingPack({
      ruleSource: "knowledge-write-spec-rules",
      ruleMarkdown: "## Rule\nshort",
      parentMarkdown: "",
      missing: [],
    });
    expect(pack.parentSlice).toBe("");
  });

  // HAPPY — missing list passed through unchanged (order + content preserved)
  it("passes the missing list through unchanged", () => {
    const missing = ["PARENT_REQUIRED", "INVALID_SPEC_KIND", "MISSING_SKELETON"];
    const pack = buildFeedingPack({
      ruleSource: "knowledge-write-spec-rules",
      ruleMarkdown: "x",
      missing,
    });
    expect(pack.missing).toEqual(missing);
    // Defensive copy — mutating the input array must not mutate the pack.
    missing.push("EXTRA");
    expect(pack.missing).toEqual(["PARENT_REQUIRED", "INVALID_SPEC_KIND", "MISSING_SKELETON"]);
  });

  // BOUNDARY — long tail is truncated, budget respected, beginning preserved
  it("truncates ruleMarkdown over maxChars, keeps the beginning, drops the tail", () => {
    const head = "## Write-spec rules\nEvery spec MUST declare a legal parent.";
    const tailMarker = "ONLY_IN_TAIL_MARKER";
    const ruleMarkdown = head + "x".repeat(2000) + tailMarker;

    const pack = buildFeedingPack({
      ruleSource: "knowledge-write-spec-rules",
      ruleMarkdown,
      missing: [],
      maxChars: 100,
    });

    expect(pack.ruleSlice.length).toBeLessThanOrEqual(100);
    expect(pack.ruleSlice.startsWith(head.slice(0, 40))).toBe(true);
    expect(pack.ruleSlice.includes(tailMarker)).toBe(false);
  });

  // BOUNDARY — exact maxChars length is NOT truncated
  it("does not truncate when markdown.length === maxChars exactly", () => {
    const markdown = "y".repeat(50);
    const pack = buildFeedingPack({
      ruleSource: "src",
      ruleMarkdown: markdown,
      missing: [],
      maxChars: 50,
    });
    expect(pack.ruleSlice).toBe(markdown);
  });

  // BOUNDARY — one character over maxChars IS truncated
  it("truncates when markdown.length === maxChars + 1", () => {
    const markdown = "y".repeat(51);
    const pack = buildFeedingPack({
      ruleSource: "src",
      ruleMarkdown: markdown,
      missing: [],
      maxChars: 50,
    });
    expect(pack.ruleSlice.length).toBeLessThanOrEqual(50);
    expect(pack.ruleSlice).not.toBe(markdown);
  });

  // BOUNDARY — very small maxChars (smaller than the truncation suffix) never overflows budget
  it("never exceeds maxChars even when maxChars is smaller than the truncation suffix", () => {
    const pack = buildFeedingPack({
      ruleSource: "src",
      ruleMarkdown: "a".repeat(100),
      missing: [],
      maxChars: 3,
    });
    expect(pack.ruleSlice.length).toBeLessThanOrEqual(3);
  });

  // HAPPY — default maxChars applies when omitted
  it("applies DEFAULT_FEEDING_MAX_CHARS (800) when maxChars is omitted", () => {
    const markdown = "z".repeat(DEFAULT_FEEDING_MAX_CHARS + 500);
    const pack = buildFeedingPack({
      ruleSource: "src",
      ruleMarkdown: markdown,
      missing: [],
    });
    expect(pack.ruleSlice.length).toBeLessThanOrEqual(DEFAULT_FEEDING_MAX_CHARS);
  });

  // ERROR — empty markdown input does not throw, yields empty slice
  it("handles empty ruleMarkdown without throwing", () => {
    expect(() =>
      buildFeedingPack({ ruleSource: "src", ruleMarkdown: "", missing: [] }),
    ).not.toThrow();
    const pack = buildFeedingPack({ ruleSource: "src", ruleMarkdown: "", missing: [] });
    expect(pack.ruleSlice).toBe("");
  });

  // REGRESSION — trust is always "team-authored" (single tier, per module invariant)
  it("always sets trust to team-authored", () => {
    const pack = buildFeedingPack({ ruleSource: "src", ruleMarkdown: "x", missing: [] });
    expect(pack.trust).toBe("team-authored");
  });
});

describe("renderFeedingPack", () => {
  // HAPPY
  it("renders a source/trust provenance header as the first line", () => {
    const text = renderFeedingPack({
      source: "knowledge-write-spec-rules",
      trust: "team-authored",
      ruleSlice: "## Rule\nbody",
      missing: [],
    });
    const firstLine = text.split("\n")[0];
    expect(firstLine).toBe("[source: knowledge-write-spec-rules, trust: team-authored]");
  });

  // HAPPY
  it("includes every missing reason as a bullet", () => {
    const text = renderFeedingPack({
      source: "src",
      trust: "team-authored",
      ruleSlice: "body",
      missing: ["PARENT_REQUIRED", "INVALID_SPEC_KIND"],
    });
    expect(text).toContain("- PARENT_REQUIRED");
    expect(text).toContain("- INVALID_SPEC_KIND");
  });

  // NEGATIVE — no missing section rendered when missing is empty
  it("omits the Missing section when missing is empty", () => {
    const text = renderFeedingPack({
      source: "src",
      trust: "team-authored",
      ruleSlice: "body",
      missing: [],
    });
    expect(text).not.toContain("Missing:");
  });

  // HAPPY — parent slice rendered when present
  it("renders the parent slice section when parentSlice is present", () => {
    const text = renderFeedingPack({
      source: "src",
      trust: "team-authored",
      ruleSlice: "rule body",
      parentSlice: "parent body",
      missing: [],
    });
    expect(text).toContain("parent body");
  });

  // NEGATIVE — no parent section rendered when parentSlice is absent
  it("omits the parent slice section when parentSlice is absent", () => {
    const text = renderFeedingPack({
      source: "src",
      trust: "team-authored",
      ruleSlice: "rule body",
      missing: [],
    });
    expect(text).not.toContain("## Parent");
  });

  // BOUNDARY / REGRESSION — full pipeline: build then render never leaks a truncated tail marker
  it("never leaks a tail marker discarded by truncation, end to end", () => {
    const tailMarker = "SECRET_TAIL_ONLY";
    const ruleMarkdown = "## Rule\nHead text." + "x".repeat(5000) + tailMarker;
    const pack = buildFeedingPack({
      ruleSource: "src",
      ruleMarkdown,
      missing: ["MISSING_SKELETON"],
      maxChars: 200,
    });
    const text = renderFeedingPack(pack);
    expect(text).not.toContain(tailMarker);
    expect(text).toContain("[source: src, trust: team-authored]");
    expect(text).toContain("- MISSING_SKELETON");
  });

  // ERROR — render does not throw on a pack with all-empty slices
  it("does not throw on empty ruleSlice / no parentSlice / no missing", () => {
    expect(() =>
      renderFeedingPack({ source: "src", trust: "team-authored", ruleSlice: "", missing: [] }),
    ).not.toThrow();
  });
});
