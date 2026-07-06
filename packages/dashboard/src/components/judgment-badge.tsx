/**
 * JudgmentBadge — renders a document's latest AI review judgment as a compact
 * status badge, matching the `lore pending` CLI semantics (SPEC-034 §4) so the
 * dashboard's triage surfaces read identically to the terminal.
 * Purpose: single shared badge component consumed by F2's home-page pending
 *   panel and F3's full triage queue page — one rendering rule, two call sites.
 * Public surface: JudgmentBadge, JudgmentBadgeProps
 * Invariants:
 *   - `judgment === null` → "unreviewed" (outline variant, neutral).
 *   - `decision === "escalate"` → "escalate +NQ" (N = blocking_questions.length),
 *     destructive variant (needs human attention) unless stale.
 *   - `decision === "approve" | "reject"` → "{decision} {confidence.toFixed(2)}",
 *     default variant for approve, secondary for reject, unless stale.
 *   - `judgment.doc_version < docVersion` → " (stale)" suffix appended AND an
 *     outline variant override (the doc changed since the judgment was
 *     recorded, so the verdict may no longer hold) — mirrors CLI
 *     `formatJudgmentBadge`'s `(stale)` suffix
 *     (packages/lore/src/adapters/cli/utils.ts).
 * Side-effect class: pure
 * Source: SPEC-033 §2.2/§2.3; mirrors packages/lore/src/adapters/cli/utils.ts::formatJudgmentBadge
 *
 * @example
 * <JudgmentBadge judgment={null} docVersion={1} />                    // "unreviewed"
 * <JudgmentBadge judgment={approveJudgment} docVersion={2} />         // "approve 0.93"
 * <JudgmentBadge judgment={escalateJudgment} docVersion={2} />        // "escalate +2Q"
 */

import { Badge } from "@/components/ui/badge";
import type { ReviewJudgment } from "@lore/core";

export interface JudgmentBadgeProps {
  /** The document's latest review judgment, or `null` if never reviewed. */
  judgment: ReviewJudgment | null;
  /** The document's CURRENT version — compared against `judgment.doc_version` for staleness. */
  docVersion: number;
}

type BadgeVariant = "default" | "secondary" | "outline" | "destructive";

/** Format the judgment's label text (decision + confidence, or escalate + question count). */
function formatJudgmentLabel(judgment: ReviewJudgment): string {
  if (judgment.decision === "escalate") {
    return `escalate +${judgment.blocking_questions.length}Q`;
  }
  return `${judgment.decision} ${judgment.confidence.toFixed(2)}`;
}

/** Pick the badge color variant for a judgment, overridden to neutral when stale. */
function judgmentVariant(judgment: ReviewJudgment, isStale: boolean): BadgeVariant {
  if (isStale) return "outline";
  if (judgment.decision === "escalate") return "destructive";
  if (judgment.decision === "approve") return "default";
  return "secondary"; // reject
}

/**
 * Compact AI-judgment badge. Read-only — no adjudication affordance here
 * (that lives in F3's triage queue / doc detail Audit tab).
 */
export function JudgmentBadge({ judgment, docVersion }: JudgmentBadgeProps): React.ReactElement {
  if (judgment === null) {
    return (
      <Badge variant="outline" className="text-xs">
        unreviewed
      </Badge>
    );
  }

  const isStale = judgment.doc_version < docVersion;
  const label = formatJudgmentLabel(judgment) + (isStale ? " (stale)" : "");

  // reason: exactOptionalPropertyTypes forbids passing `title={undefined}` explicitly —
  // React's HTMLAttributes declares `title?: string`, not `string | undefined`. Conditional
  // spread omits the prop entirely when not stale, matching the codebase's established pattern
  // (e.g. DocDetail.tsx onTransition/onLinkAdd gating).
  return (
    <Badge
      variant={judgmentVariant(judgment, isStale)}
      className="text-xs"
      {...(isStale
        ? { title: `Judged at v${judgment.doc_version}; document is now v${docVersion}` }
        : {})}
    >
      {label}
    </Badge>
  );
}
