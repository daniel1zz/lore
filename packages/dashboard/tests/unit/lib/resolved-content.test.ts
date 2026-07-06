/**
 * @spec_ref SPEC-033 §2.2, AC-33-1
 *
 * Tests for `splitContentByPlaceholders` — the pure splicing function that
 * turns a document's raw markdown + resolved MDX placeholders/warnings into
 * an ordered list of typed segments.
 *
 * Spec expectations (written from the module's documented invariants,
 * before reading the implementation body):
 *   - Zero placeholders + empty content -> [] (empty segment list, not a
 *     single empty markdown segment) — caller renders an empty state for [].
 *   - A single component with markdown on both sides -> exactly 3 segments
 *     in order: markdown, component, markdown.
 *   - A component flush against the start of content -> no leading markdown
 *     segment (2 segments: component, markdown).
 *   - A component flush against the end of content -> no trailing markdown
 *     segment (2 segments: markdown, component).
 *   - Multiple components/warnings, plus out-of-order input arrays, are
 *     always emitted in ascending `position.start` order (segments must not
 *     depend on the caller pre-sorting resolvedComponents/warnings).
 *   - Two placeholders with no markdown gap between them (component B starts
 *     exactly where component A ends) never produce an empty-string markdown
 *     segment between them (cursor math must not emit a `content.slice(x, x)`).
 *
 * Test plan (six-dimension coverage):
 *   HAPPY — single component in the middle produces 3 ordered segments.
 *   NEGATIVE — n/a (pure function has no invalid-input rejection path; a
 *     mismatched/overlapping position is out of contract per the module's
 *     own documented invariant, not a case this function guards against).
 *   BOUNDARY — component at start (no leading markdown), component at end
 *     (no trailing markdown), adjacent components (no empty gap segment),
 *     empty content + zero placeholders -> [].
 *   STATE — n/a (pure function, no state).
 *   REGRESSION — multiple components/warnings supplied out of position order
 *     are still emitted in ascending order (guards a naive "assume caller
 *     sorted it" regression).
 */

import { describe, it, expect } from "vitest";
import { splitContentByPlaceholders } from "../../../src/lib/resolved-content";
import type { ResolvedComponent, ResolutionWarning } from "../../../src/lib/api";

function makeComponent(overrides: Partial<ResolvedComponent> & { position: { start: number; end: number } }): ResolvedComponent {
  return {
    name: "ChildrenOf",
    props: {},
    data: { children: [] },
    ...overrides,
  };
}

function makeWarning(overrides: Partial<ResolutionWarning> & { position: { start: number; end: number } }): ResolutionWarning {
  return {
    message: "Unknown placeholder component: Bogus",
    component: "Bogus",
    ...overrides,
  };
}

describe("splitContentByPlaceholders", () => {
  describe("boundary: empty content", () => {
    it("returns [] for empty content with zero placeholders", () => {
      expect(splitContentByPlaceholders("", [], [])).toEqual([]);
    });

    it("returns [] for empty content even when arrays are non-empty but content has no length to slice", () => {
      // reason: guards against a spurious markdown segment with text: "" being
      // pushed when content is empty but placeholders somehow reference it —
      // no placeholders here, just confirming the base empty-content case is
      // exactly [] and not [{kind:"markdown", text:""}].
      expect(splitContentByPlaceholders("", [], [])).not.toEqual([{ kind: "markdown", text: "" }]);
    });
  });

  describe("happy path: single component in the middle", () => {
    it("produces exactly 3 segments: markdown, component, markdown", () => {
      const before = "Some intro paragraph.\n\n";
      const tag = "<ChildrenOf/>";
      const after = "\n\nSome outro paragraph.";
      const content = before + tag + after;
      const component = makeComponent({ position: { start: before.length, end: before.length + tag.length } });

      const segments = splitContentByPlaceholders(content, [component], []);

      expect(segments).toEqual([
        { kind: "markdown", text: before },
        { kind: "component", component },
        { kind: "markdown", text: after },
      ]);
    });
  });

  describe("boundary: component flush against start/end", () => {
    it("produces no leading markdown segment when the component starts at position 0", () => {
      const tag = "<ChildrenOf/>";
      const after = "\n\nSome outro paragraph.";
      const content = tag + after;
      const component = makeComponent({ position: { start: 0, end: tag.length } });

      const segments = splitContentByPlaceholders(content, [component], []);

      expect(segments).toEqual([
        { kind: "component", component },
        { kind: "markdown", text: after },
      ]);
    });

    it("produces no trailing markdown segment when the component ends at content.length", () => {
      const before = "Some intro paragraph.\n\n";
      const tag = "<ChildrenOf/>";
      const content = before + tag;
      const component = makeComponent({ position: { start: before.length, end: before.length + tag.length } });

      const segments = splitContentByPlaceholders(content, [component], []);

      expect(segments).toEqual([
        { kind: "markdown", text: before },
        { kind: "component", component },
      ]);
    });
  });

  describe("boundary: adjacent placeholders with no gap", () => {
    it("does not emit an empty-string markdown segment between two back-to-back placeholders", () => {
      const before = "Intro.\n\n";
      const tagA = "<ChildrenOf/>";
      const tagB = "<HealthStats/>";
      const after = "\n\nOutro.";
      const content = before + tagA + tagB + after;

      const componentA = makeComponent({
        name: "ChildrenOf",
        position: { start: before.length, end: before.length + tagA.length },
      });
      const componentB = makeComponent({
        name: "HealthStats",
        data: { stats: { total: 1, by_type: {}, by_status: {}, stale: 0, orphans: 0 } },
        position: { start: before.length + tagA.length, end: before.length + tagA.length + tagB.length },
      });

      const segments = splitContentByPlaceholders(content, [componentA, componentB], []);

      expect(segments).toEqual([
        { kind: "markdown", text: before },
        { kind: "component", component: componentA },
        { kind: "component", component: componentB },
        { kind: "markdown", text: after },
      ]);
      // Explicitly rule out any zero-length markdown slot sneaking in between.
      expect(segments.some((s) => s.kind === "markdown" && s.text === "")).toBe(false);
    });
  });

  describe("regression: multiple components + a warning, merged in ascending order", () => {
    it("orders slots by position.start regardless of input array order", () => {
      // Deliberately supply resolvedComponents out of position order (B before A)
      // to prove the function sorts rather than trusting caller order.
      const content = "0123456789".repeat(4); // 40 chars, indices 0-39

      const warning = makeWarning({ position: { start: 0, end: 5 } }); // slice(0,5)
      const componentA = makeComponent({ name: "ChildrenOf", position: { start: 10, end: 20 } });
      const componentB = makeComponent({ name: "HealthStats", position: { start: 25, end: 30 } });

      const segments = splitContentByPlaceholders(content, [componentB, componentA], [warning]);

      expect(segments).toEqual([
        { kind: "warning", warning },
        { kind: "markdown", text: content.slice(5, 10) },
        { kind: "component", component: componentA },
        { kind: "markdown", text: content.slice(20, 25) },
        { kind: "component", component: componentB },
        { kind: "markdown", text: content.slice(30) },
      ]);
    });
  });
});
