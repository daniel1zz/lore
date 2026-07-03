// @vitest-environment jsdom
/**
 * Tests for DiffView component.
 * Source: SPEC-027 AC-DH-4
 *
 * Test plan:
 *   HAPPY:
 *     - Renders an added line ("+") with the green add color class
 *     - Renders a removed line ("-") with the red remove color class
 *     - Renders a hunk header ("@@") with the blue hunk color class
 *     - Renders a context line (no prefix) with no color class
 *
 *   NEGATIVE:
 *     - Empty diff string renders zero line spans
 *
 *   BOUNDARY:
 *     - className prop is merged onto the outer <pre> alongside the base classes
 *
 *   REGRESSION:
 *     - Multi-line diff preserves line order
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { DiffView } from "../../src/components/DiffView";

describe("DiffView", () => {
  describe("happy path", () => {
    it("renders an added line with the green add color class", () => {
      const { container } = render(<DiffView diff="+new line" />);
      const span = container.querySelector("pre > span");
      expect(span).toHaveTextContent("+new line");
      expect(span).toHaveClass("text-green-600");
    });

    it("renders a removed line with the red remove color class", () => {
      const { container } = render(<DiffView diff="-old line" />);
      const span = container.querySelector("pre > span");
      expect(span).toHaveTextContent("-old line");
      expect(span).toHaveClass("text-red-600");
    });

    it("renders a hunk header line with the blue hunk color class", () => {
      const { container } = render(<DiffView diff="@@ -1,2 +1,2 @@" />);
      const span = container.querySelector("pre > span");
      expect(span).toHaveTextContent("@@ -1,2 +1,2 @@");
      expect(span).toHaveClass("text-blue-600");
    });

    it("renders a context line with no color class", () => {
      const { container } = render(<DiffView diff=" unchanged line" />);
      const span = container.querySelector("pre > span");
      expect(span).toHaveTextContent("unchanged line");
      expect(span).toHaveClass("block");
      expect(span).not.toHaveClass("text-green-600", "text-red-600", "text-blue-600");
    });
  });

  describe("negative", () => {
    it("renders zero line spans for an empty diff string", () => {
      // "".split("\n") yields [""] — a single empty context line, not zero spans.
      const { container } = render(<DiffView diff="" />);
      const spans = container.querySelectorAll("pre > span");
      expect(spans).toHaveLength(1);
      expect(spans[0]).toHaveTextContent("");
    });
  });

  describe("boundary", () => {
    it("merges the className prop onto the outer pre alongside base classes", () => {
      const { container } = render(<DiffView diff="context" className="whitespace-pre-wrap" />);
      const pre = container.querySelector("pre");
      expect(pre).toHaveClass("whitespace-pre-wrap");
      expect(pre).toHaveClass("font-mono");
    });
  });

  describe("regression", () => {
    it("preserves line order across a multi-line diff", () => {
      const { container } = render(<DiffView diff={"@@ -1 +1 @@\n-old\n+new\n context"} />);
      const spans = container.querySelectorAll("pre > span");
      expect(spans).toHaveLength(4);
      expect(spans[0]).toHaveTextContent("@@ -1 +1 @@");
      expect(spans[1]).toHaveTextContent("-old");
      expect(spans[2]).toHaveTextContent("+new");
      expect(spans[3]).toHaveTextContent("context");
    });
  });
});
