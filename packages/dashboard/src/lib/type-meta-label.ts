/**
 * Type meta label — renders one {@link DocTypeMeta} variant into its display
 * TEXT for the "one meta row per type" presentation (SPEC-036 §1 D3). Single
 * derivation point for the label string — `DocCard` and `DocDetail` both call
 * this, then wrap the result in their own badge/layout, so the two surfaces
 * never hand-roll the projection two different ways.
 *
 * Public surface: formatTypeMetaLabel, isNotablePriority, metaBadgeVariant
 * Invariants:
 *   - task: renders NOTHING claim-related when `claimed_by` is absent, and
 *     omits the whole label (returns `null`) when there is neither a claim
 *     nor any evidence — mirrors `formatWorkflowBadge`'s "empty when neither
 *     present" rule (packages/lore/src/adapters/cli/utils.ts). Evidence is
 *     rendered as exact pass/fail totals (`DocTypeMeta.task` carries counts,
 *     not "last result") — a different FORMAT from the CLI's
 *     last-result-plus-total badge, not a different RULE about when to show
 *     something at all.
 *   - Never throws — `formatTypeMetaLabel` is a total function over the
 *     `DocTypeMeta` union (exhaustive switch, no default fallthrough needed).
 *   - `formatTypeMetaLabel` itself stays a pure TEXT deriver (untouched by
 *     SPEC-037) — the destructive-variant "danger color" decision for a
 *     failing task lives in the sibling `metaBadgeVariant` fn so callers
 *     compose `<Badge variant={metaBadgeVariant(meta)}>{formatTypeMetaLabel(meta)}</Badge>`
 *     instead of re-deriving the evidence_fail>0 check at each of the three
 *     call sites (DocCard, DocDetail header, plan-detail task rows).
 * Side-effect class: pure
 * Source: SPEC-036 §1 D3, AC-36-8; SPEC-037 §1 D3/D4, AC-37-6
 *
 * @example
 * formatTypeMetaLabel({ t: "task", claimed_by: "alice", claim_stale: true, evidence_pass: 2, evidence_fail: 1 })
 * // => "claimed:alice (stale) ✔2/✘1"
 * formatTypeMetaLabel({ t: "task", evidence_pass: 0, evidence_fail: 0 })
 * // => null (unclaimed, no evidence — nothing to show)
 */

import type { DocTypeMeta, Priority } from "@lore/core";

/**
 * Renders a {@link DocTypeMeta} variant's display label, or `null` when the
 * type has nothing to show (task with no claim and no evidence).
 */
export function formatTypeMetaLabel(meta: DocTypeMeta): string | null {
  switch (meta.t) {
    case "spec":
      return meta.kind;
    case "adr":
      return meta.decision_status;
    case "knowledge":
      return meta.sub_type;
    case "plan":
      return `${meta.phase_count} phase${meta.phase_count === 1 ? "" : "s"}`;
    case "task": {
      const parts: string[] = [];
      if (meta.claimed_by !== undefined) {
        parts.push(`claimed:${meta.claimed_by}${meta.claim_stale === true ? " (stale)" : ""}`);
      }
      if (meta.evidence_pass > 0 || meta.evidence_fail > 0) {
        parts.push(`✔${meta.evidence_pass}/✘${meta.evidence_fail}`);
      }
      return parts.length > 0 ? parts.join(" ") : null;
    }
  }
}

/**
 * Priority noise-budget gate (SPEC-036 §1 D3) — only `critical`/`high` are
 * notable enough to render a badge; `medium`/`low` are the norm and must not
 * shout.
 */
export function isNotablePriority(priority: Priority): boolean {
  return priority === "critical" || priority === "high";
}

/**
 * The Badge `variant` to render a type-meta label with — "danger color" fix
 * (SPEC-037 AC-37-6). Only a task with at least one failing oracle result
 * (`evidence_fail > 0`) escalates to `"destructive"`; every other type/state
 * renders the pre-037 neutral `"outline"`. Single derivation point consumed
 * by `DocCard`, `DocDetail`'s header, and plan-detail task rows so the three
 * surfaces never hand-roll the "when is this red" rule independently.
 *
 * @example
 * metaBadgeVariant({ t: "task", evidence_pass: 0, evidence_fail: 2 }) // => "destructive"
 * metaBadgeVariant({ t: "task", evidence_pass: 3, evidence_fail: 0 }) // => "outline"
 * metaBadgeVariant({ t: "plan", phase_count: 2 })                    // => "outline"
 */
export function metaBadgeVariant(meta: DocTypeMeta): "outline" | "destructive" {
  return meta.t === "task" && meta.evidence_fail > 0 ? "destructive" : "outline";
}
