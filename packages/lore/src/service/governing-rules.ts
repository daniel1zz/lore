/**
 * Module: governing-rules — which baseline rules govern a task, capped for the task-start feed.
 *
 * Purpose: pick the rules an agent must see when it starts a task (BL-15), within a token budget.
 * Public surface: {@link selectGoverningRules}, {@link GOVERNING_RULES_CAP}, {@link GoverningRules}.
 * Invariants:
 *   - Order: rules cited by the task's own spec first (`findRules({spec})` order), then rules reached
 *     through spec code anchors covering each task file anchor (`findRules({file})`, anchors in the
 *     given order). A rule appears once, at its first position.
 *   - Only rules a live baseline leaf lists are counted; a dangling cite is not a governing rule.
 *   - At most {@link GOVERNING_RULES_CAP} are returned; `overflow` is the exact count beyond the cap,
 *     never a silent drop.
 * Side-effect class: pure.
 * Source: spec-baseline-slice-2-completeness-census-per-branch-citation C6 (feed integration), BL-15.
 */

import { collectLeafRules, findRules } from "./rule-index-queries.js";
import type { RuleIndexData } from "./rule-index-queries.js";

/** Most rules the task-start feed lists; the rest are an overflow count. */
export const GOVERNING_RULES_CAP = 40;

export interface GoverningRule {
  readonly id: string;
  readonly statement: string;
}

export interface GoverningRules {
  /** At most {@link GOVERNING_RULES_CAP}, cited rules first. */
  readonly rules: readonly GoverningRule[];
  /** Governing rules beyond the cap (total - cap); `0` when everything is listed. */
  readonly overflow: number;
}

/**
 * @param specSlug - The task's governing spec slug, or `null` for a task with no spec ancestor.
 * @param fileAnchors - The task's file anchors (a `#Symbol` suffix is handled by `findRules`).
 * @returns `undefined` when no baseline rule governs the task (the feed then omits the section).
 */
export function selectGoverningRules(
  specSlug: string | null,
  fileAnchors: readonly string[],
  data: RuleIndexData,
): GoverningRules | undefined {
  const live = collectLeafRules(data.baseline);
  const ordered: string[] = [];
  const seen = new Set<string>();
  const take = (ids: readonly string[]): void => {
    for (const id of ids) {
      if (seen.has(id) || !live.has(id)) continue;
      seen.add(id);
      ordered.push(id);
    }
  };
  if (specSlug !== null) take(findRules({ spec: specSlug }, data));
  for (const file of fileAnchors) take(findRules({ file }, data));

  if (ordered.length === 0) return undefined;
  const rules = ordered.slice(0, GOVERNING_RULES_CAP).map((id) => ({
    id,
    statement: (live.get(id) as { statement: string }).statement,
  }));
  return { rules, overflow: ordered.length - rules.length };
}
