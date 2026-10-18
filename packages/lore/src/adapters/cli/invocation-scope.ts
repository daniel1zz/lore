/**
 * TRANSITIONAL bridge that lets code without a command context (`loadLoreApp`, the bypass audit, the
 * human-channel ports) see the Invocation the running command was handed.
 *
 * Purpose: ~190 command bodies call `loadLoreApp()` with no argument; until IV-6..IV-8 migrate them to pass
 * `ctx.inv`, the delivery wrapper (`index.ts::deliverInvocation`) opens this scope around each command's `run`
 * so the run identity still reaches the store wrapper without a module variable.
 * Public surface: {@link runWithinInvocation}, {@link invocationInScope}.
 * Invariants:
 *   - Scoped per async call tree (AsyncLocalStorage), opened ONLY by `deliverInvocation`; there is no setter
 *     and no way to change the value of an open scope, so two in-process runs can never see each other's.
 *   - The scoped value is the immutable entry Invocation. A later-verified identity is NOT written back:
 *     it is the store's fact (`ensureVerifiedIdentity(store)`), not a slot here.
 *   - Outside any scope (MCP, HTTP, tests calling `loadLoreApp` directly) {@link invocationInScope} is
 *     `undefined`, so those surfaces build an unwrapped store exactly as before.
 *   - ⛔ Do not add readers. New code takes `inv` as a parameter; this file is deleted when the last
 *     argument-less `loadLoreApp()` is migrated.
 * Side-effect class: stateful (async-context storage), no IO.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { Invocation } from "@lore/core";

const scope = new AsyncLocalStorage<Invocation>();

/** Run `fn` with `inv` visible to {@link invocationInScope} for the whole async call tree of `fn`. */
export function runWithinInvocation<T>(inv: Invocation, fn: () => T): T {
  return scope.run(inv, fn);
}

/** The Invocation of the command currently running, or `undefined` outside a CLI command. */
export function invocationInScope(): Invocation | undefined {
  return scope.getStore();
}
