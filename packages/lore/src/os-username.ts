/**
 * The OS account name of the running process — the os-fallback tier of actor resolution.
 *
 * Purpose: ONE visible, ledger-counted place where lore code outside the entry asks the OS who the user is, so the
 * os-fallback tier of `resolveActorWithSource` (a lazy thunk, never an eager value) has a source that does not
 * require the process to be read at five different call sites.
 * Public surface: {@link readOsUsername}.
 * Invariants:
 *   - Lazy by contract: callers pass the FUNCTION to `resolveActorWithSource`; `os.userInfo()` throws on a uid
 *     with no passwd entry, so it must stay unreached unless the os-fallback tier is actually taken.
 *   - Counted by `check:ambient-reads` (spec D5, rule AS-26): this file's ledger entry is the whole cost of
 *     the read, and it shrinks when the Invocation carries the name (IV-7/8). It is deliberately NOT in
 *     `@lore/core/node`'s `invocation-node.ts`, whose allowlist would hide it from the check.
 * Side-effect class: IO (OS user database read).
 */

import { userInfo } from "node:os";

/**
 * @returns the OS username of the current uid
 * @throws when the OS has no passwd entry for the current uid (`os.userInfo` semantics)
 */
export function readOsUsername(): string {
  return userInfo().username;
}
