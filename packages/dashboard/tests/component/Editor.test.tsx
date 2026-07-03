// @vitest-environment jsdom
/**
 * Tests for Editor component (CodeMirror 6 markdown editor + split preview).
 * Source: SPEC-022 §9.2, Q1 / SPEC-027 dispatch AC-DH-8.
 *
 * jsdom does not implement Range.getClientRects()/getBoundingClientRect(), which
 * CodeMirror's layout "measure" pass calls on every animation frame. Without a stub
 * this throws an uncaught TypeError from a queued requestAnimationFrame callback,
 * polluting the test run with "Unhandled Errors" even though assertions pass. The
 * stub is installed in this file's own beforeAll (not tests/setup.ts) — vitest gives
 * every test file its own jsdom environment instance under the default pool, so this
 * mutation cannot leak into DiffView.test.tsx / DocCard.test.tsx / etc.
 *
 * Test plan:
 *   HAPPY:
 *     - Renders the editor host (aria-label "Markdown editor") and, by default
 *       (splitView unset), the live preview pane.
 *     - Typing into the CodeMirror content-editable fires onChange with the
 *       up-to-date document text (not a stale/initial value).
 *   NEGATIVE:
 *     - Mounting with no edits never calls onChange (no spurious initial fire).
 *     - splitView={false} renders no "Preview" pane at all.
 *   BOUNDARY:
 *     - Re-rendering with the SAME initialValue (only an unrelated prop changes)
 *       does not tear down/recreate the CodeMirror view — the effect dependency
 *       array is `[initialValue]` only.
 *   ERROR:
 *     - Typing with no onChange prop supplied never throws (handleChange calls
 *       onChange optionally — `onChange?.(value)` — this locks in that contract
 *       rather than assuming it silently no-ops).
 *   STATE:
 *     - Changing `initialValue` across a rerender destroys the previous
 *       EditorView exactly once before mounting a new one (the documented
 *       memory-leak guard — "Editor mounts into a ref; unmounts cleanly via
 *       EditorView.destroy()").
 *     - The preview pane mirrors typed content (handleChange also updates
 *       `previewContent` state feeding <ReactMarkdown>).
 *   REGRESSION:
 *     - Three sequential initialValue changes destroy exactly three times
 *       (one destroy per change, not zero/duplicated) — guards the
 *       "tear down existing view before re-creating" invariant across repeats.
 */

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorView } from "codemirror";
import { Editor } from "../../src/components/Editor";

// ─── jsdom stubs for CodeMirror's measure pass ────────────────────────────────

beforeAll(() => {
  Range.prototype.getClientRects = function (): DOMRectList {
    return {
      length: 0,
      item: () => null,
      [Symbol.iterator]: function* () {},
    } as unknown as DOMRectList;
  };
  Range.prototype.getBoundingClientRect = function (): DOMRect {
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      toJSON() {},
    } as DOMRect;
  };
});

function getContentEditable(host: HTMLElement): HTMLElement {
  const el = host.querySelector(".cm-content");
  if (el === null) throw new Error("CodeMirror .cm-content not found");
  return el as HTMLElement;
}

describe("Editor", () => {
  describe("happy path", () => {
    it("renders the markdown editor host", () => {
      render(<Editor initialValue="# Hello" />);
      expect(screen.getByLabelText("Markdown editor")).toBeInTheDocument();
    });

    it("renders the preview pane by default (splitView unset)", () => {
      render(<Editor initialValue="# Hello" />);
      expect(screen.getByLabelText("Preview")).toBeInTheDocument();
    });

    it("fires onChange with the current document text when the user types", async () => {
      const onChange = vi.fn();
      const user = userEvent.setup();
      render(<Editor initialValue="hello" onChange={onChange} />);
      const host = screen.getByLabelText("Markdown editor");

      await user.click(getContentEditable(host));
      await user.keyboard("X");

      expect(onChange).toHaveBeenCalledWith("Xhello");
    });
  });

  describe("negative", () => {
    it("does not call onChange when nothing is edited after mount", () => {
      const onChange = vi.fn();
      render(<Editor initialValue="hello" onChange={onChange} />);
      expect(onChange).not.toHaveBeenCalled();
    });

    it("renders no Preview pane when splitView is false", () => {
      render(<Editor initialValue="# Hello" splitView={false} />);
      expect(screen.queryByLabelText("Preview")).not.toBeInTheDocument();
      expect(screen.getByLabelText("Markdown editor")).toBeInTheDocument();
    });
  });

  describe("boundary", () => {
    it("does not recreate the view when a rerender changes an unrelated prop but not initialValue", () => {
      const destroySpy = vi.spyOn(EditorView.prototype, "destroy");
      const { rerender } = render(<Editor initialValue="same" onChange={() => {}} />);
      destroySpy.mockClear();

      // Same initialValue, different onChange reference and className — the
      // effect dependency array is `[initialValue]` only, so this must NOT
      // tear down/recreate the CodeMirror instance.
      rerender(<Editor initialValue="same" onChange={() => {}} className="other" />);

      expect(destroySpy).not.toHaveBeenCalled();
      destroySpy.mockRestore();
    });
  });

  describe("error", () => {
    it("does not throw when typing with no onChange handler supplied", async () => {
      const user = userEvent.setup();
      render(<Editor initialValue="hello" />);
      const host = screen.getByLabelText("Markdown editor");

      await expect(
        (async () => {
          await user.click(getContentEditable(host));
          await user.keyboard("Z");
        })(),
      ).resolves.not.toThrow();
    });
  });

  describe("state", () => {
    it("destroys the previous EditorView exactly once when initialValue changes", () => {
      const destroySpy = vi.spyOn(EditorView.prototype, "destroy");
      const { rerender } = render(<Editor initialValue="v1" />);
      expect(destroySpy).not.toHaveBeenCalled();

      rerender(<Editor initialValue="v2" />);

      expect(destroySpy).toHaveBeenCalledTimes(1);
      destroySpy.mockRestore();
    });

    it("mirrors typed content into the preview pane", async () => {
      const user = userEvent.setup();
      render(<Editor initialValue="start" />);
      const host = screen.getByLabelText("Markdown editor");

      await user.click(getContentEditable(host));
      await user.keyboard("!");

      const preview = screen.getByLabelText("Preview");
      expect(preview).toHaveTextContent("!start");
    });
  });

  describe("regression", () => {
    it("destroys exactly once per initialValue change across three sequential changes", () => {
      const destroySpy = vi.spyOn(EditorView.prototype, "destroy");
      const { rerender } = render(<Editor initialValue="a" />);
      expect(destroySpy).toHaveBeenCalledTimes(0);

      rerender(<Editor initialValue="b" />);
      expect(destroySpy).toHaveBeenCalledTimes(1);

      rerender(<Editor initialValue="c" />);
      expect(destroySpy).toHaveBeenCalledTimes(2);

      rerender(<Editor initialValue="d" />);
      expect(destroySpy).toHaveBeenCalledTimes(3);

      destroySpy.mockRestore();
    });
  });
});
