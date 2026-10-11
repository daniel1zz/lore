/**
 * The CLI process's invocation identity — resolved ONCE at the entry, read once by the loader
 * (spec-run-identity-slice-1 D1/D3; BR-1032, BR-1033).
 *
 * Purpose: carry the {@link InvocationIdentity} that `index.ts` resolved from argv/env to
 * `loadLoreApp()`, which hands it to `createApp` so the store is wrapped by `withVerifiedWriteContext`.
 * Citty command handlers call `loadLoreApp()` themselves, so the identity cannot travel as an argument.
 *
 * Public surface: {@link setInvocationIdentity}, {@link getInvocationIdentity}, {@link resolveCliInvocation}.
 *
 * Invariants:
 *   - Set at most once per process, only by the CLI entry. The MCP server and the HTTP adapter never set it,
 *     so their stores are not wrapped by this path (the MCP surface carries its own per-call identity).
 *   - {@link resolveCliInvocation} injects `detectWorktreeDerivedActor` so the working-copy name tier works
 *     (core cannot import it) and prints the `$LORE_ACTOR` deprecation line at most once per process.
 *
 * Side-effect class: stateful (module slot) + IO via the injected resolver (env, cwd probe, stderr).
 */

import type { InvocationIdentity } from "@lore/core";
import { resolveInvocationIdentity, type InvocationResolution } from "@lore/core/node";
import { detectWorktreeDerivedActor } from "./utils.js";

let current: InvocationIdentity | undefined;

/** Record the identity of this process's invocation. Throws if one was already recorded (resolve once). */
export function setInvocationIdentity(identity: InvocationIdentity): void {
  if (current !== undefined) throw new Error("invocation identity already set: it is resolved once per process");
  current = identity;
}

/**
 * Replace the recorded identity with its run-VERIFIED value (unregistered run -> `harnessRun` null). Called once,
 * by the store wrapper's `onVerified`, so {@link getInvocationIdentity} reads the verified identity from then on.
 */
export function replaceInvocationIdentity(verified: InvocationIdentity): void {
  if (current === undefined) throw new Error("no invocation identity to replace");
  current = verified;
}

/** The identity the CLI entry recorded (run verified once a write or claim/release has verified it), or `undefined` outside a CLI invocation (MCP, HTTP, tests). */
export function getInvocationIdentity(): InvocationIdentity | undefined {
  return current;
}

/**
 * Resolve the identity of the current CLI invocation from `argv` (process args after the program name) and the
 * environment, with the working-copy tier wired in. Returns argv with `--harness-run <id>` removed.
 *
 * @throws {RunIdentityArgumentError} on an empty or valueless `--by` / `--harness-run`.
 */
export function resolveCliInvocation(argv: readonly string[]): InvocationResolution {
  return resolveInvocationIdentity(argv, process.env, undefined, detectWorktreeDerivedActor);
}
