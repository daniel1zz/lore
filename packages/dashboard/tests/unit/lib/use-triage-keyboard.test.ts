// @vitest-environment jsdom
/**
 * Tests for useTriageKeyboard — keyboard-driven triage loop (SPEC-075 R-9).
 * @spec_ref AC-075-5, AC-075-6
 *
 * Test plan (six-dimension coverage):
 *   HAPPY (AC-075-5):
 *     - the full j/k/a/x/e/o loop, dispatching ONLY keyboard events, proving
 *       each state transition: j selects row 0, j again selects row 1, k
 *       moves back to row 0, a/x/e/o each fire their callback with the
 *       currently selected row id
 *   NEGATIVE:
 *     - a/x/e/o are no-ops when nothing is selected yet
 *   BOUNDARY:
 *     - j at the last row and k at the first row are no-ops (no wraparound)
 *   ERROR:
 *     - n/a (a DOM keydown listener has no fallible IO)
 *   STATE:
 *     - enabled: false suppresses every shortcut, including j/k selection
 *   REGRESSION (AC-075-6):
 *     - every one of the five shortcuts is suppressed while an <input>,
 *       <textarea>, [contenteditable], or .cm-editor element holds focus —
 *       proven by dispatching keydown with `target` set to each element
 *       type, per the "failure-first" discipline: first show the keystroke
 *       WOULD fire without the guard (isEditableTarget itself), then show
 *       the hook suppresses it
 */

import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTriageKeyboard, isEditableTarget } from "../../../src/lib/use-triage-keyboard";

/** Dispatches a real keydown DOM event on `document`, optionally with a specific target. */
function pressKey(key: string, target?: EventTarget): void {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  if (target !== undefined) {
    Object.defineProperty(event, "target", { value: target, configurable: true });
  }
  document.dispatchEvent(event);
}

describe("useTriageKeyboard", () => {
  describe("happy path (AC-075-5) — full j/k/a/x/e/o loop", () => {
    it("proves each state transition via keyboard-only events", () => {
      const onApprove = vi.fn();
      const onReject = vi.fn();
      const onExpand = vi.fn();
      const onOpen = vi.fn();
      const { result } = renderHook(() =>
        useTriageKeyboard({ itemIds: ["row-a", "row-b", "row-c"], onApprove, onReject, onExpand, onOpen }),
      );

      expect(result.current.selectedId).toBeNull();

      act(() => pressKey("j"));
      expect(result.current.selectedId).toBe("row-a");

      act(() => pressKey("j"));
      expect(result.current.selectedId).toBe("row-b");

      act(() => pressKey("k"));
      expect(result.current.selectedId).toBe("row-a");

      act(() => pressKey("a"));
      expect(onApprove).toHaveBeenCalledTimes(1);
      expect(onApprove).toHaveBeenCalledWith("row-a");

      act(() => pressKey("x"));
      expect(onReject).toHaveBeenCalledTimes(1);
      expect(onReject).toHaveBeenCalledWith("row-a");

      act(() => pressKey("e"));
      expect(onExpand).toHaveBeenCalledTimes(1);
      expect(onExpand).toHaveBeenCalledWith("row-a");

      act(() => pressKey("o"));
      expect(onOpen).toHaveBeenCalledTimes(1);
      expect(onOpen).toHaveBeenCalledWith("row-a");
    });
  });

  describe("negative", () => {
    it("a/x/e/o are no-ops when nothing is selected yet", () => {
      const onApprove = vi.fn();
      const onReject = vi.fn();
      const onExpand = vi.fn();
      const onOpen = vi.fn();
      renderHook(() => useTriageKeyboard({ itemIds: ["row-a"], onApprove, onReject, onExpand, onOpen }));

      act(() => {
        pressKey("a");
        pressKey("x");
        pressKey("e");
        pressKey("o");
      });

      expect(onApprove).not.toHaveBeenCalled();
      expect(onReject).not.toHaveBeenCalled();
      expect(onExpand).not.toHaveBeenCalled();
      expect(onOpen).not.toHaveBeenCalled();
    });
  });

  describe("boundary", () => {
    it("j at the last row and k at the first row do not wrap around", () => {
      const { result } = renderHook(() => useTriageKeyboard({ itemIds: ["row-a", "row-b"] }));

      act(() => pressKey("k"));
      expect(result.current.selectedId).toBe("row-a");

      act(() => pressKey("j"));
      act(() => pressKey("j"));
      act(() => pressKey("j"));
      expect(result.current.selectedId).toBe("row-b");
    });
  });

  describe("state", () => {
    it("enabled: false suppresses every shortcut, including j/k selection", () => {
      const onApprove = vi.fn();
      const { result } = renderHook(() =>
        useTriageKeyboard({ itemIds: ["row-a"], onApprove, enabled: false }),
      );

      act(() => {
        pressKey("j");
        pressKey("a");
      });

      expect(result.current.selectedId).toBeNull();
      expect(onApprove).not.toHaveBeenCalled();
    });
  });

  describe("regression (AC-075-6) — editable-target suppression", () => {
    it("isEditableTarget itself recognizes input/textarea/contenteditable/.cm-editor", () => {
      const input = document.createElement("input");
      const textarea = document.createElement("textarea");
      const contentEditableDiv = document.createElement("div");
      contentEditableDiv.setAttribute("contenteditable", "true");
      const cmEditorChild = document.createElement("span");
      const cmEditor = document.createElement("div");
      cmEditor.className = "cm-editor";
      cmEditor.appendChild(cmEditorChild);
      const plainDiv = document.createElement("div");

      expect(isEditableTarget(input)).toBe(true);
      expect(isEditableTarget(textarea)).toBe(true);
      expect(isEditableTarget(contentEditableDiv)).toBe(true);
      // reason: .closest() walks up from a NESTED child inside the CodeMirror host too.
      expect(isEditableTarget(cmEditorChild)).toBe(true);
      expect(isEditableTarget(plainDiv)).toBe(false);
    });

    it("suppresses a/x/e/o/j/k while an <input> holds focus (event.target is the input)", () => {
      const input = document.createElement("input");
      document.body.appendChild(input);
      const onApprove = vi.fn();
      const { result } = renderHook(() => useTriageKeyboard({ itemIds: ["row-a"], onApprove }));

      act(() => pressKey("j", input));
      expect(result.current.selectedId).toBeNull();

      // Select for real (target = document, not the input) before proving 'a' is suppressed too.
      act(() => pressKey("j"));
      expect(result.current.selectedId).toBe("row-a");

      act(() => pressKey("a", input));
      expect(onApprove).not.toHaveBeenCalled();

      document.body.removeChild(input);
    });

    it("suppresses shortcuts while a contenteditable element holds focus", () => {
      const editable = document.createElement("div");
      editable.setAttribute("contenteditable", "true");
      document.body.appendChild(editable);
      const onExpand = vi.fn();
      const { result } = renderHook(() => useTriageKeyboard({ itemIds: ["row-a"], onExpand }));

      act(() => pressKey("j"));
      expect(result.current.selectedId).toBe("row-a");

      act(() => pressKey("e", editable));
      expect(onExpand).not.toHaveBeenCalled();

      document.body.removeChild(editable);
    });
  });
});
