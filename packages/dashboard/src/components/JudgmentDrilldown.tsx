/**
 * JudgmentDrilldown — expandable detail panel for a review judgment,
 * mounted alongside `JudgmentBadge` (SPEC-075 R-9, PRD §21).
 * Purpose: `JudgmentBadge` renders a compact one-line verdict; this
 *   component gives a reviewer the qualitative data behind that verdict —
 *   `reasons[]` (dimension + finding), mechanical `checks[]`, the full
 *   `blocking_questions[]` list, and which judge/prompt produced it — without
 *   inventing a second badge or re-deriving the staleness/label rule
 *   `JudgmentBadge` already owns.
 * Public surface: JudgmentDrilldown, JudgmentDrilldownProps
 * Invariants:
 *   - `judgment === null` → renders `null` (no affordance, no error) — the
 *     existing "unreviewed" `JudgmentBadge` state is untouched and this
 *     component adds nothing next to it.
 *   - A STALE judgment (`judgment.doc_version < docVersion`, the SAME test
 *     `JudgmentBadge` runs) still renders its full drilldown — staleness is
 *     communicated by the (unchanged) badge's `(stale)` suffix, not by
 *     withholding detail here. This component does not need `docVersion` at
 *     all: it only ever renders the judgment's OWN recorded fields.
 *   - Expand/collapse state is local (`useState`) — this is a single
 *     stateless detail toggle, not multi-row list state (contrast
 *     `AuditTab`'s `expandedEntryIndex`, which disambiguates MULTIPLE rows
 *     sharing one judgment_ref); a caller rendering one drilldown per row
 *     (e.g. `TriageQueue`) gets independent per-row state for free because
 *     each row mounts its own `JudgmentDrilldown` instance.
 * Side-effect class: pure
 * Source: SPEC-075 §Module Boundary D7, R-9, AC-075-7
 *
 * @example
 * <JudgmentDrilldown judgment={row.judgment} />
 */

import { useState } from "react";
import type { ReviewJudgment } from "@lore/core";

export interface JudgmentDrilldownProps {
  /** The doc's latest review judgment, or `null` if never reviewed. */
  judgment: ReviewJudgment | null;
}

/**
 * @example
 * <JudgmentDrilldown judgment={judgment} />
 */
export function JudgmentDrilldown({ judgment }: JudgmentDrilldownProps): React.ReactElement | null {
  const [expanded, setExpanded] = useState(false);

  if (judgment === null) return null;

  return (
    <div aria-label="Judgment detail">
      <button
        type="button"
        className="text-xs text-primary hover:underline"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        {expanded ? "Hide judgment detail" : "Show judgment detail"}
      </button>

      {expanded && (
        <div className="text-xs text-muted-foreground mt-1 space-y-1.5" aria-label="Judgment detail body">
          <p>
            Decision: <span className="font-medium text-foreground">{judgment.decision}</span>
          </p>
          <p>
            Confidence: <span className="font-medium text-foreground">{judgment.confidence.toFixed(2)}</span>
          </p>

          {judgment.reasons.length > 0 && (
            <div>
              <p className="font-medium text-foreground">Reasons</p>
              <ul className="list-disc list-inside space-y-0.5">
                {judgment.reasons.map((reason, i) => (
                  <li key={i}>
                    <span className="font-medium">{reason.dimension}</span>: {reason.finding}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {judgment.checks !== undefined && judgment.checks.length > 0 && (
            <div>
              <p className="font-medium text-foreground">Checks</p>
              <ul className="list-disc list-inside space-y-0.5">
                {judgment.checks.map((check, i) => (
                  <li key={i}>
                    {check.check}: {check.outcome}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {judgment.blocking_questions.length > 0 && (
            <div>
              <p className="font-medium text-foreground">Blocking questions</p>
              <ul className="list-disc list-inside space-y-0.5">
                {judgment.blocking_questions.map((question, i) => (
                  <li key={i}>{question}</li>
                ))}
              </ul>
            </div>
          )}

          <p>Judge prompt version: {judgment.judge.prompt_version}</p>
        </div>
      )}
    </div>
  );
}
