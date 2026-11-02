/**
 * Verify an invocation identity's run against the corpus's run registry and, at the real program entry, against the
 * process ancestry — ONCE per identity, by the caller
 * (spec-every-write-is-made-by-a-known-party-an-attested-agent-run end state 3; BR-1351, BR-1032;
 * spec-a-lore-call-s-run-identity-is-injected-per-bash-call-and, D19).
 *
 * Purpose: an identity carries a run from the per-call `LORE_HARNESS_RUN` value or a human session file; the corpus is
 * the only authority on whether that run is registered, and the process table the only authority on whether THIS
 * process runs inside the run's harness. A run the registry does not know is REFUSED (VALIDATION_ERROR, exit 4,
 * naming `lore session start --human <name>` and `lore setup`), never downgraded to an unattested write and never
 * guessed. With a {@link RunAncestryProbe} an agent run is additionally refused for each cause of
 * `verifyRunAncestry` (ended run, no harness pid, harness not an ancestor, reused pid, unreadable process table),
 * each naming its own cause. Every consumer of the identity (the write-context wrapper that stamps rows, claim/release
 * deciding by run) uses the value this returns, so one operation never has two answers about its run.
 *
 * Public surface: {@link verifyInvocationIdentity}, {@link VerifiedIdentityStore}, {@link RunAncestryProbe}.
 * Side-effect class: IO (one registry read; with a probe, `ps` reads). Adapter-agnostic: CLI entry and the MCP adapter
 * both call it.
 */
import { err, ok, type InvocationIdentity, type LoreError, type Result } from "@lore/core";
import { refusalNamingHowToBecomeKnown, UnknownPartyError, verifyRunAncestry, type RunAncestryTable } from "@lore/core/node";
import type { StoreInterface } from "../store/store-interface.js";
import { reopenSubagentStoppedRun, SUBAGENT_STOP_END_REASON } from "./run-service.js";

/** The store capabilities the check needs (`listRunLifecycles` only when an ancestry probe is given). */
export type VerifiedIdentityStore = Pick<StoreInterface, "getRun" | "listRunLifecycles" | "reopenRunIfEndedFor">;

/** Where the ancestry walk starts and what it reads: production passes `process.pid` and the real process table. */
export interface RunAncestryProbe {
  readonly table: RunAncestryTable;
  readonly selfPid: number;
}

function unregisteredRunRefusal(run: string): LoreError {
  return new UnknownPartyError(
    refusalNamingHowToBecomeKnown(`Run ${run} is not a registered run in this corpus (register it with \`lore run register\`).`),
  ).loreError;
}

/**
 * @param store - Store the run registry lives in (the App-selected store, D-007).
 * @param identity - Identity as resolved by the entry (its run not yet verified).
 * @param ancestry - When given, an agent run (`claimedSource === "run"`) must also descend from its harness process.
 * @returns the same identity when it has no run (an unresolved identity is refused at its first write, not here:
 *   reads proceed) or its run is registered (and, with a probe, an ancestor of this process); VALIDATION_ERROR naming
 *   the cause when it is not; the store's own error when a lookup fails (no silent downgrade).
 */
export async function verifyInvocationIdentity(
  store: VerifiedIdentityStore,
  identity: InvocationIdentity,
  ancestry?: RunAncestryProbe,
): Promise<Result<InvocationIdentity, LoreError>> {
  const claimedRun = identity.harnessRun;
  if (claimedRun === null) return ok(identity);
  if (ancestry !== undefined && identity.claimedSource === "run") {
    const lifecycles = await store.listRunLifecycles();
    if (!lifecycles.ok) return err(lifecycles.error);
    const record = lifecycles.value.find((row) => row.id === claimedRun) ?? null;
    const verdict = await verifyRunAncestry({ run: claimedRun, record, table: ancestry.table, selfPid: ancestry.selfPid });
    if (verdict.ok) return ok(identity);
    if (verdict.cause === "run-ended" && verdict.endReason === SUBAGENT_STOP_END_REASON && record !== null && record.endedAt !== null) {
      // reason: #594 - the SubagentStop hook ends a helper at every stop, interim ones included. The helper's next call
      // from its own harness tree (same process and start time, judged by re-running the check on the row as if open)
      // reopens the run in ONE audited conditional write; a mismatch stays refused with the original verdict below.
      const asOpen = await verifyRunAncestry({
        run: claimedRun,
        record: { ...record, endedAt: null, endReason: null },
        table: ancestry.table,
        selfPid: ancestry.selfPid,
      });
      if (asOpen.ok) {
        const reopened = await reopenSubagentStoppedRun(store, {
          run: claimedRun,
          actor: identity.claimed ?? claimedRun,
          sessionId: identity.claimed ?? claimedRun,
          endedAt: record.endedAt,
          now: new Date(),
        });
        if (!reopened.ok) return err(reopened.error);
        // reason: ok(false) = a concurrent call reopened it first (or another end won): re-read, never assume.
        if (reopened.value) return ok(identity);
        const again = await store.listRunLifecycles();
        if (!again.ok) return err(again.error);
        const latest = again.value.find((row) => row.id === claimedRun) ?? null;
        if (latest !== null && latest.endedAt === null) return ok(identity);
      }
    }
    if (verdict.cause === "unknown-run") return err(unregisteredRunRefusal(claimedRun));
    return err(new UnknownPartyError(`Run ${claimedRun} is refused: ${verdict.error}.`).loreError);
  }
  const found = await store.getRun(claimedRun);
  if (!found.ok) return err(found.error);
  if (found.value !== null) return ok(identity);
  return err(unregisteredRunRefusal(claimedRun));
}
