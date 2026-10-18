/**
 * Typed access to the `Invocation` that `buildMain(inv)` delivers to every command's `run` as `context.inv`.
 *
 * Purpose: citty's `CommandContext` has no `inv` field (the delivery wrapper in `index.ts` adds it at runtime),
 * so a command body reads it through {@link invocationOf} instead of casting at every call site.
 * Public surface: {@link invocationOf}, {@link MissingInvocationError}.
 * Invariants:
 *   - Fail loud: a context without `inv` (a command run outside `buildMain`) throws {@link MissingInvocationError};
 *     there is NO fallback to `process.env` / `process.cwd()` — that would be the ambient read this delivery removes
 *     (spec-ambient-state-is-read-once-at-the-entry-owned-only-prune D4, rule AS-26).
 * Side-effect class: pure.
 */

import type { Invocation } from "@lore/core";

/** A command body asked for its Invocation but the context carried none. */
export class MissingInvocationError extends Error {
  constructor() {
    super("command context has no `inv`: run the command through buildMain(inv) (adapters/cli/index.ts)");
    this.name = "MissingInvocationError";
  }
}

/**
 * Read the delivered Invocation off a command context.
 *
 * @param context - the `run` argument citty passed (after `deliverInvocation` added `inv`)
 * @returns the immutable Invocation of this run
 * @throws {MissingInvocationError} when the context carries no `inv`
 * @example
 *   async run(context) { const inv = invocationOf(context); ... inv.cwd ... }
 */
export function invocationOf(context: object): Invocation {
  const inv = (context as { inv?: Invocation }).inv;
  if (inv === undefined) throw new MissingInvocationError();
  return inv;
}
