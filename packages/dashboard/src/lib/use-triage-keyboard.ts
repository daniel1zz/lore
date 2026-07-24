/**
 * useTriageKeyboard — keyboard-driven triage loop for a queue surface
 * (SPEC-075 R-9, PRD §21). j/k move the selection, a/x adjudicate the
 * selected row, e expands its blocking-question/judgment detail, o opens
 * its detail page — all suppressed while focus is inside an editable
 * element, so typing a calibration note or editing a document never
 * triggers a triage action.
 * Public surface: useTriageKeyboard, UseTriageKeyboardOptions,
 *   UseTriageKeyboardResult, isEditableTarget (exported for direct testing
 *   of the suppression predicate — AC-075-6)
 * Invariants:
 *   - Selection index is component-local `useState` (D5, documented
 *     exception to the "all client state is server/URL state" invariant —
 *     row selection is ephemeral UI focus, not data worth persisting across
 *     reload, mirroring the editor-draft-ephemera precedent).
 *   - Suppression predicate matches
 *     `input, textarea, [contenteditable="true"], .cm-editor` — the EXACT
 *     selector list SPEC-075's task packet specifies; a keydown whose
 *     `event.target` is or is inside one of these elements is a no-op for
 *     every one of the five shortcuts (not just some), so typing "e" into
 *     the calibration-note input, for instance, never expands a row.
 *   - j/k clamp at the list ends (no wraparound) — pressing k at row 0 or j
 *     at the last row is a no-op-on-the-edge, not an error and not a jump
 *     to the opposite end.
 *   - a/x/e/o are no-ops when nothing is selected (`selectedId === null`) —
 *     they never guess a default row.
 *   - `itemIds` changing (e.g. a filter toggled) does not itself clear the
 *     selection; if the previously selected id is no longer present, the
 *     NEXT j/k press re-anchors from the start of the new list (index -1
 *     `indexOf` miss → next index 0) rather than throwing.
 * Side-effect class: IO (`document`-level keydown listener)
 * Source: SPEC-075 §Module Boundary D7, R-9, AC-075-5, AC-075-6
 *
 * @example
 * const { selectedId } = useTriageKeyboard({
 *   itemIds: rows.map((r) => r.doc.id),
 *   onApprove: (id) => void handleAdjudicate(id, "approve"),
 *   onReject: (id) => openAdjudicate(id),
 *   onExpand: (id) => setExpandedQuestionsId((prev) => (prev === id ? null : id)),
 *   onOpen: (id) => onNavigate?.(id),
 * });
 */

import { useCallback, useEffect, useState } from "react";

/** The exact editable-element selector this hook's suppression rule matches (AC-075-6). */
const EDITABLE_SELECTOR = 'input, textarea, [contenteditable="true"], .cm-editor';

/**
 * True when `target` is, or is nested inside, an editable element — the
 * suppression predicate every one of this hook's five shortcuts checks
 * before acting.
 *
 * @example
 * isEditableTarget(document.querySelector("input")); // => true
 * isEditableTarget(document.body); // => false
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(EDITABLE_SELECTOR) !== null;
}

export interface UseTriageKeyboardOptions {
  /** Ordered list of row ids the j/k loop navigates over (e.g. `rows.map(r => r.doc.id)`). */
  itemIds: string[];
  /** `a` — approve the selected row. */
  onApprove?: (id: string) => void;
  /** `x` — reject the selected row (with-reason flow; the caller decides what that means). */
  onReject?: (id: string) => void;
  /** `e` — expand the selected row's blocking-question/judgment detail. */
  onExpand?: (id: string) => void;
  /** `o` — open the selected row's detail page. */
  onOpen?: (id: string) => void;
  /** Disables the whole loop (e.g. the queue surface isn't the active view). Default `true`. */
  enabled?: boolean;
}

export interface UseTriageKeyboardResult {
  /** The currently selected row id, or `null` before any selection. */
  selectedId: string | null;
  /** Imperative override (e.g. clearing selection when the underlying data disappears). */
  setSelectedId: (id: string | null) => void;
}

/**
 * @example
 * useTriageKeyboard({ itemIds, onApprove, onReject, onExpand, onOpen });
 */
export function useTriageKeyboard(options: UseTriageKeyboardOptions): UseTriageKeyboardResult {
  const { itemIds, onApprove, onReject, onExpand, onOpen, enabled = true } = options;
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled || itemIds.length === 0) return;
      if (isEditableTarget(event.target)) return;

      switch (event.key) {
        case "j": {
          const currentIndex = selectedId !== null ? itemIds.indexOf(selectedId) : -1;
          const nextIndex = Math.min(currentIndex + 1, itemIds.length - 1);
          setSelectedId(itemIds[nextIndex] ?? null);
          event.preventDefault();
          break;
        }
        case "k": {
          const currentIndex = selectedId !== null ? itemIds.indexOf(selectedId) : 0;
          const prevIndex = Math.max(currentIndex - 1, 0);
          setSelectedId(itemIds[prevIndex] ?? null);
          event.preventDefault();
          break;
        }
        case "a":
          if (selectedId !== null) onApprove?.(selectedId);
          break;
        case "x":
          if (selectedId !== null) onReject?.(selectedId);
          break;
        case "e":
          if (selectedId !== null) onExpand?.(selectedId);
          break;
        case "o":
          if (selectedId !== null) onOpen?.(selectedId);
          break;
        default:
          break;
      }
    },
    [enabled, itemIds, selectedId, onApprove, onReject, onExpand, onOpen],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return { selectedId, setSelectedId };
}
