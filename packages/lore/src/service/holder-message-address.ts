/**
 * Builds the `claim.harness_run -> main run's messaging address` lookup that `deriveSessions` joins into every
 * holder listing (BR-1363, BR-1360).
 *
 * Purpose: let a pure `@lore/core` derivation show WHERE another session can message a claim's holder without
 * reading the run registry itself.
 *
 * Public surface: {@link resolveMessageAddressByRun}.
 *
 * @invariant The join is by RUN ID only: claim.harness_run -> its run -> the MAIN run of that run's session
 *   (`deriveRunId(run.harness, { sessionId: run.sessionRef })`) -> that main run's `messageAddress`. It never
 *   follows `parentRunId` (the run-register hook registers a subagent WITHOUT `--parent`, so in production every
 *   subagent's parent is NULL), nor `claim.session_id`, nor a display name (plan invariant I3).
 * @invariant The lookup is total over the claims it is given: a claim without a run, a run the registry does not
 *   hold, or a main run with no recorded address maps to `null` ("none recorded"), never to a guess. A store
 *   failure is returned as the error, never swallowed to `null`.
 * Side-effect class: IO (read-only registry lookups through `StoreInterface.getRun`).
 */

import {
  deriveRunId,
  err,
  extractHeldClaim,
  ok,
  type DocRecord,
  type LoreError,
  type Result,
  type RunId,
  type RunRecord,
} from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";

/**
 * The main run of `run`'s session: the run itself for a main run, else the run derived from the same session.
 *
 * @param run - A registered run.
 * @returns The main run's id, or `null` when the run's harness is no longer a shipped integration (its session's
 *   main run cannot be named, so no address is measurable).
 */
function mainRunIdOf(run: RunRecord): RunId | null {
  if (run.kind === "main") return run.id;
  try {
    return deriveRunId(run.harness, { sessionId: run.sessionRef });
  } catch {
    // reason: a registered subagent of a harness the registry no longer ships has no derivable main run; the
    // truthful answer is "no address", and the listing must stay total rather than fail the whole read.
    return null;
  }
}

/**
 * Resolves the messaging address of the session behind every held claim in `docs`.
 *
 * @param store - Run registry source (`getRun`).
 * @param docs - Task docs whose HELD claims are listed.
 * @returns ok(Map from each held claim's `harness_run` to its session's main-run address, `null` = none recorded);
 *   err when a registry read fails.
 * @example
 * // M1 (main, uds:/one) holds A; its subagent run S1 holds B:
 * // => Map { "cc:M1" => "uds:/one", "cc:M1:agent" => "uds:/one" }
 */
export async function resolveMessageAddressByRun(
  store: StoreInterface,
  docs: readonly DocRecord[],
): Promise<Result<Map<string, string | null>, LoreError>> {
  const byRun = new Map<string, string | null>();
  const mainAddress = new Map<RunId, string | null>();

  const addressOfMain = async (id: RunId): Promise<Result<string | null, LoreError>> => {
    const known = mainAddress.get(id);
    if (known !== undefined) return ok(known);
    const main = await store.getRun(id);
    if (!main.ok) return err(main.error);
    const address = main.value?.messageAddress ?? null;
    mainAddress.set(id, address);
    return ok(address);
  };

  for (const doc of docs) {
    const run = extractHeldClaim(doc)?.harness_run;
    if (run == null || byRun.has(run)) continue;
    const record = await store.getRun(run as RunId);
    if (!record.ok) return err(record.error);
    if (record.value === null) {
      byRun.set(run, null);
      continue;
    }
    const mainId = mainRunIdOf(record.value);
    if (mainId === null) {
      byRun.set(run, null);
      continue;
    }
    const address = await addressOfMain(mainId);
    if (!address.ok) return address;
    byRun.set(run, address.value);
  }
  return ok(byRun);
}
