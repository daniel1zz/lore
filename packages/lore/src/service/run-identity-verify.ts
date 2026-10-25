/**
 * Verify an invocation identity's run against the corpus's run registry — ONCE per identity, by the caller
 * (spec-every-write-is-made-by-a-known-party-an-attested-agent-run end state 3; BR-1351, BR-1032).
 *
 * Purpose: an identity carries a run from the harness flag/argument or a human session file; the corpus is the only
 * authority on whether that run is registered. A run the registry does not know is REFUSED (VALIDATION_ERROR, exit 4,
 * naming `lore session start --human <name>` and `lore setup`), never downgraded to an unattested write and never
 * guessed. Every consumer of the identity (the write-context wrapper that stamps rows, claim/release deciding by
 * run) uses the value this returns, so one operation never has two answers about its run.
 *
 * Public surface: {@link verifyInvocationIdentity}, {@link VerifiedIdentityStore}.
 * Side-effect class: IO (one `getRun` read). Adapter-agnostic: CLI entry and the MCP adapter both call it.
 */
import { err, ok, type InvocationIdentity, type LoreError, type Result } from "@lore/core";
import { refusalNamingHowToBecomeKnown, UnknownPartyError } from "@lore/core/node";
import type { StoreInterface } from "../store/store-interface.js";

/** The one store capability the check needs. */
export type VerifiedIdentityStore = Pick<StoreInterface, "getRun">;

/**
 * @param store - Store the run registry lives in (the App-selected store, D-007).
 * @param identity - Identity as resolved by the entry (its run not yet verified).
 * @returns the same identity when it has no run (an unresolved identity is refused at its first write, not here:
 *   reads proceed) or its run is registered; VALIDATION_ERROR naming how to become a known party when the run is
 *   unregistered; the store's own error when the lookup fails (no silent downgrade).
 */
export async function verifyInvocationIdentity(
  store: VerifiedIdentityStore,
  identity: InvocationIdentity,
): Promise<Result<InvocationIdentity, LoreError>> {
  const claimedRun = identity.harnessRun;
  if (claimedRun === null) return ok(identity);
  const found = await store.getRun(claimedRun);
  if (!found.ok) return err(found.error);
  if (found.value !== null) return ok(identity);
  return err(
    new UnknownPartyError(
      refusalNamingHowToBecomeKnown(`Run ${claimedRun} is not a registered run in this corpus (register it with \`lore run register\`).`),
    ).loreError,
  );
}
