/**
 * Verify an invocation identity's run against the corpus's run registry — ONCE per identity, by the caller
 * (spec-run-identity-slice-1 D7; BR-1035).
 *
 * Purpose: an identity carries a claimed `harnessRun` from the harness flag/argument; the corpus is the only
 * authority on whether that run is registered. An unregistered id is downgraded to unattested (`harnessRun`
 * null, name and source kept) with ONE warning naming the id — never refused, never guessed. Every consumer of
 * the identity (the write-context wrapper that stamps rows, claim/release deciding by run) MUST use the value
 * this returns, so one operation never has two answers about its run.
 *
 * Public surface: {@link verifyInvocationIdentity}, {@link VerifiedIdentityStore}.
 * Side-effect class: IO (one `getRun` read) + the injected `warn` sink. Adapter-agnostic: CLI entry and the
 * MCP adapter both call it; neither owns it.
 */
import { err, ok, type InvocationIdentity, type LoreError, type Result } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";

/** The one store capability the check needs. */
export type VerifiedIdentityStore = Pick<StoreInterface, "getRun">;

/**
 * @param store - Store the run registry lives in (the App-selected store, D-007).
 * @param identity - Identity as resolved from flag/argument/env (run not yet verified).
 * @param warn - Sink for the single unregistered-run warning.
 * @returns the identity with `harnessRun` kept when registered (or absent), set to null when unregistered;
 *   the store's own error when the lookup fails (no silent downgrade).
 */
export async function verifyInvocationIdentity(
  store: VerifiedIdentityStore,
  identity: InvocationIdentity,
  warn: (line: string) => void,
): Promise<Result<InvocationIdentity, LoreError>> {
  const claimedRun = identity.harnessRun;
  if (claimedRun === null) return ok(identity);
  const found = await store.getRun(claimedRun);
  if (!found.ok) return err(found.error);
  if (found.value !== null) return ok(identity);
  warn(
    `warning: --harness-run ${claimedRun} is not a registered run; this write is recorded unattested (register it with \`lore run register\`)`,
  );
  return ok({ ...identity, harnessRun: null });
}
