/**
 * `lore status` autonomy-threshold surface — integrity of the governed threshold record.
 *
 * Purpose: one place that reads the record through DecisionService and renders its integrity verdict, shared by
 * `lore status --check-autonomy-thresholds` (exit 1 on a break) and the plain `lore status` (names the break, exit 1).
 * Public surface: collectAutonomyThresholdStatus, renderAutonomyThresholdLine, AUTONOMY_THRESHOLD_BREAK_EXIT.
 * Invariants:
 *   - Read-only: never seeds. An unseeded corpus is reported as such, exit 0 (nothing governed, nothing tampered).
 *   - `confirmed` (a human accepted the mismatched content) is exit 0 but is still printed, never hidden.
 *   - A store read failure is returned as err — never reported as intact.
 * Side-effect class: IO (opens a store handle on `dbPath`, closed before returning).
 *
 * Source: spec-autonomy-phase-1-decision-function-human-channel-lore AC-AU-9 (2).
 */
import type { LoreError, Result } from "@lore/core";
import { DecisionService } from "../../service/decision-service.js";
import type { ThresholdIntegrity } from "../../service/autonomy-threshold-service.js";
import { SQLiteStore } from "../../store/sqlite-store.js";
import { wrapStoreError } from "../../store/store-shared.js";

/** Exit code when the record fails its integrity check and no human confirmed it. */
export const AUTONOMY_THRESHOLD_BREAK_EXIT = 1;

/** Reads the integrity verdict of the corpus DB at `dbPath`. */
export async function collectAutonomyThresholdStatus(dbPath: string): Promise<Result<ThresholdIntegrity, LoreError>> {
  let store: SQLiteStore;
  try {
    store = new SQLiteStore(dbPath);
  } catch (cause) {
    return wrapStoreError(cause);
  }
  try {
    const governed = await new DecisionService({ store, executorRun: null }).governed();
    return governed.ok ? { ok: true, value: governed.value.integrity } : governed;
  } finally {
    store.close();
  }
}

/** One human line; names the integrity break (and what restores trust) when there is one. */
export function renderAutonomyThresholdLine(integrity: ThresholdIntegrity): string {
  switch (integrity.state) {
    case "unseeded":
      return "Autonomy thresholds: not yet recorded (code seed in force)";
    case "intact":
      return `Autonomy thresholds: intact (write record ${integrity.write_record_id})`;
    case "confirmed":
      return `Autonomy thresholds: edited outside lore, CONFIRMED by the human (decision record ${integrity.record_id})`;
    case "broken":
      return `Autonomy thresholds: INTEGRITY BREAK (threshold-integrity: ${integrity.reason}) — ${integrity.detail}. Every class escalates until the human accepts the threshold-integrity decision (lore pending, then lore decide <id> --accept).`;
  }
}

/** Whether `integrity` must fail the command. */
export function isAutonomyThresholdBreak(integrity: ThresholdIntegrity): boolean {
  return integrity.state === "broken";
}
