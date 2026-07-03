/**
 * DiffView — shared unified-diff renderer.
 * Purpose: render a unified-diff string as color-coded lines (add/remove/hunk/context),
 *   extracted from duplicated logic in HistoryTab's DiffModal and ConflictModal
 *   (AC-DH-4, SPEC-027).
 * Public surface: DiffView, DiffViewProps
 * Invariants:
 *   - Pure rendering only: this component owns no open/closed state. Callers that need
 *     a collapsible diff section (e.g. ConflictModal) keep that disclosure state
 *     themselves and simply choose whether to mount <DiffView/> at all — DiffView must
 *     stay a plain "text in, colored lines out" component so it never has to encode a
 *     caller's disclosure policy.
 *   - Line coloring: "+" prefix → green (also matches "+++" file header, same as prior
 *     behavior), "-" prefix → red (also matches "---" file header), "@@" prefix → blue
 *     (hunk header), anything else → default (context line).
 *   - `className` overrides/extends the outer <pre> so call sites can keep their own
 *     layout (whitespace wrapping, padding, max-height) without DiffView guessing it.
 * Side-effect class: pure
 * Source: SPEC-027 AC-DH-4
 */

import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DiffViewProps {
  /** Unified diff text (e.g. from a `diff` package `createPatch` call). One row per line. */
  diff: string;
  /** Extra classes merged onto the outer <pre> (layout differs per call site). */
  className?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Renders a unified diff string as one colored <span> per line.
 *
 * @example
 * <DiffView diff={data.content_diff} className="whitespace-pre-wrap" />
 */
export function DiffView({ diff, className }: DiffViewProps): React.ReactElement {
  return (
    <pre className={cn("text-xs font-mono leading-5", className)}>
      {diff.split("\n").map((line, i) => {
        let color = "";
        if (line.startsWith("+")) color = "text-green-600 dark:text-green-400";
        else if (line.startsWith("-")) color = "text-red-600 dark:text-red-400";
        else if (line.startsWith("@@")) color = "text-blue-600 dark:text-blue-400";
        return (
          <span key={i} className={cn("block", color)}>
            {line}
          </span>
        );
      })}
    </pre>
  );
}
