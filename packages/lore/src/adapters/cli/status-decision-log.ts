/**
 * `lore status` decision-log surface — chain verification result for the autonomy decision log.
 *
 * Purpose: one place that reads the decision log through DecisionService and renders its chain verdict, shared by
 * `lore status --check-decision-log` (exit 1 on a break) and the plain `lore status` line (report-only).
 * Public surface: collectDecisionLogStatus, renderDecisionLogLine, DECISION_LOG_BREAK_EXIT, DecisionLogStatus.
 * Invariants:
 *   - Verification is over the WHOLE chain; a break names the first broken row id and the reason.
 *   - An empty log is `clean` with `head: null` (nothing to verify is not a finding).
 *   - A store read failure is returned as err — never reported as "clean".
 * Side-effect class: IO (opens a store handle on `dbPath`, closed before returning).
 *
 * Source: spec-autonomy-phase-1-decision-function-human-channel-lore AC-AU-2 (3).
 */
import { ok, type LoreError, type Result } from "@lore/core";
import { DecisionService } from "../../service/decision-service.js";
import { SQLiteStore } from "../../store/sqlite-store.js";
import type { DecisionChainHead, DecisionChainVerifyResult } from "../../store/decision-log.js";
import { wrapStoreError } from "../../store/store-shared.js";

/** Exit code of `lore status --check-decision-log` when the chain is broken. */
export const DECISION_LOG_BREAK_EXIT = 1;

export interface DecisionLogStatus {
  readonly verify: DecisionChainVerifyResult;
  readonly head: DecisionChainHead | null;
}

/** Reads and verifies the decision log of the corpus DB at `dbPath`. */
export async function collectDecisionLogStatus(dbPath: string): Promise<Result<DecisionLogStatus, LoreError>> {
  let store: SQLiteStore;
  try {
    store = new SQLiteStore(dbPath);
  } catch (cause) {
    return wrapStoreError(cause);
  }
  try {
    const service = new DecisionService({ store, executorRun: null });
    const verify = await service.verifyChain();
    if (!verify.ok) return verify;
    const head = await service.chainHead();
    if (!head.ok) return head;
    return ok({ verify: verify.value, head: head.value });
  } finally {
    store.close();
  }
}

/** One human line; names the broken row on a break. */
export function renderDecisionLogLine(status: DecisionLogStatus): string {
  if (!status.verify.clean) {
    const { id, reason } = status.verify.break;
    return `Decision log: CHAIN BROKEN at row ${id} (${reason}); ${status.verify.checked} row(s) checked before the break`;
  }
  if (status.head === null) return "Decision log: empty";
  return `Decision log: chain intact (${status.verify.checked} record(s), head row ${status.head.head_id})`;
}
