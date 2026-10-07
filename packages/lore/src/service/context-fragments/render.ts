/**
 * Outlet rendering for context fragments: joins selected fragment bodies into one
 * block and enforces the per-outlet hook character cap.
 * Spec: spec-context-fragments-config-driven-layered-rule-injection (D6, D13).
 *
 * Public surface: `renderOutlet`, `RenderedOutlet`, `FragmentBudgetError`, `RenderResult`.
 * Invariants:
 *   - text = bodies in the given order joined by "\n\n"; no prefix/suffix, no trim.
 *   - chars = text.length (the separator counts toward the cap).
 *   - hook outlets refuse text.length > cap (strictly greater: exactly-cap passes);
 *     claude-md outlets have no cap.
 * Side-effect class: pure.
 */
import {
  SESSION_FRAGMENT_CAP,
  SUBAGENT_FRAGMENT_CAP,
  type Fragment,
  type OutletId,
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

/**
 * Refusal when a hook outlet's block exceeds its cap.
 * reason: `BUDGET_EXCEEDED` is absent from the core `LoreError` union (packages/core/src/errors.ts
 * is another task's anchor), so this module carries its own typed error with the same
 * `{code, message}` shape the RED tests (render.test.ts, AC-CF-3) assert.
 */
export interface FragmentBudgetError {
  readonly code: "BUDGET_EXCEEDED";
  readonly outlet: OutletId;
  readonly cap: number;
  readonly chars: number;
  readonly perFragment: ReadonlyArray<{ readonly id: string; readonly chars: number }>;
  readonly message: string;
}

export type RenderResult =
  | { readonly ok: true; readonly value: RenderedOutlet }
  | { readonly ok: false; readonly error: FragmentBudgetError };

/** Cap for an outlet, or `null` when the outlet is uncapped (claude-md:*). */
function getOutletCap(outlet: OutletId): number | null {
  switch (outlet) {
    case "hook:session-start":
      return SESSION_FRAGMENT_CAP;
    case "hook:subagent-start":
      return SUBAGENT_FRAGMENT_CAP;
    case "claude-md:project":
    case "claude-md:user":
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
export function renderOutlet(fragments: readonly Fragment[], outlet: OutletId): RenderResult {
  const text = fragments.map((fragment) => fragment.body).join(FRAGMENT_SEPARATOR);
  const chars = text.length;
  const cap = getOutletCap(outlet);

  if (cap !== null && chars > cap) {
    const perFragment = fragments.map((fragment) => ({
      id: fragment.frontmatter.id,
      chars: fragment.body.length,
    }));
    const breakdown = perFragment.map((entry) => `${entry.id}=${entry.chars}`).join(", ");
    return {
      ok: false,
      error: {
        code: "BUDGET_EXCEEDED",
        outlet,
        cap,
        chars,
        perFragment,
        message: `BUDGET_EXCEEDED: ${outlet} block is ${chars} chars, cap is ${cap}. Fragments (id=chars): ${breakdown}`,
      },
    };
  }

  return {
    ok: true,
    value: { text, chars, fragmentIds: fragments.map((fragment) => fragment.frontmatter.id) },
  };
}
