/**
 * Outlet rendering for context fragments: joins selected fragment bodies into one
 * block and enforces the per-outlet hook character cap.
 * Spec: spec-context-fragments-config-driven-layered-rule-injection (D6, D13).
 *
 * Public surface: `renderOutlet`, `RenderedOutlet`, `BudgetExceededError`. Failure is the shared `BUDGET_EXCEEDED` LoreError (errors.ts).
 * Invariants:
 *   - text = bodies in the given order joined by "\n\n"; no prefix/suffix, no trim.
 *   - chars = text.length (the separator counts toward the cap).
 *   - hook outlets refuse text.length > cap (strictly greater: exactly-cap passes);
 *     rules:* and skills:* outlets have no render cap (each rules file is
 *     budget-checked per file by the flow instead, D15; skill files are uncapped, BR-1064).
 * Side-effect class: pure.
 */
import {
  SUBAGENT_FRAGMENT_CAP,
  USER_PROMPT_FRAGMENT_CAP,
  err,
  ok,
  type Fragment,
  type LoreError,
  type OutletId,
  type Result,
} from "@lore/core";

/** Separator between fragment bodies; counted in `chars`. */
const FRAGMENT_SEPARATOR = "\n\n";

/** Successful render of one outlet. */
export interface RenderedOutlet {
  readonly text: string;
  /** Always `text.length`. */
  readonly chars: number;
  /** Fragment ids in render order. */
  readonly fragmentIds: readonly string[];
}

/** The only error {@link renderOutlet} returns; narrowed so callers can read its fields (still a member of `LoreError`). */
export type BudgetExceededError = Extract<LoreError, { code: "BUDGET_EXCEEDED" }>;

/** Cap for an outlet, or `null` when the outlet is uncapped (rules:*). */
function getOutletCap(outlet: OutletId): number | null {
  switch (outlet) {
    case "hook:subagent-start":
      return SUBAGENT_FRAGMENT_CAP;
    case "hook:user-prompt":
      return USER_PROMPT_FRAGMENT_CAP;
    case "rules:project":
    case "rules:user":
    case "skills:project":
    case "skills:user":
      return null;
    default: {
      const unreachable: never = outlet;
      throw new Error(`unhandled outlet: ${String(unreachable)}`);
    }
  }
}

/**
 * Render already-selected fragments for one outlet.
 *
 * @param fragments Selected fragments, already in final order.
 * @param outlet Target outlet; decides whether a cap applies.
 * @returns `ok` with the joined block, or `BUDGET_EXCEEDED` naming every fragment id and its body length.
 */
export function renderOutlet(fragments: readonly Fragment[], outlet: OutletId): Result<RenderedOutlet, BudgetExceededError> {
  const text = fragments.map((fragment) => fragment.body).join(FRAGMENT_SEPARATOR);
  const chars = text.length;
  const cap = getOutletCap(outlet);

  if (cap !== null && chars > cap) {
    const perFragment = fragments.map((fragment) => ({
      id: fragment.frontmatter.id,
      chars: fragment.body.length,
    }));
    const breakdown = perFragment.map((entry) => `${entry.id}=${entry.chars}`).join(", ");
    return err({
      code: "BUDGET_EXCEEDED",
      outlet,
      cap,
      chars,
      perFragment,
      message: `BUDGET_EXCEEDED: ${outlet} block is ${chars} chars, cap is ${cap}. Fragments (id=chars): ${breakdown}`,
    });
  }

  return ok({ text, chars, fragmentIds: fragments.map((fragment) => fragment.frontmatter.id) });
}
