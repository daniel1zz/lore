/**
 * `lore pending` decision surface — open autonomy decisions (escalations awaiting the human).
 *
 * Purpose: read the pending decisions through DecisionService and render them next to the pending documents.
 * Public surface: collectPendingDecisions, renderPendingDecisions.
 * Invariants:
 *   - Shows id, class, subject, score, factors and the recommended answer; there is no nonce anywhere in the
 *     data (it is generated per `lore decide` invocation and lives only on the controlling terminal).
 *   - A store read failure is returned as err — never rendered as "no open decisions".
 * Side-effect class: IO (opens a store handle on `dbPath`, closed before returning); rendering is pure.
 *
 * Source: spec-autonomy-phase-1-decision-function-human-channel-lore AC-AU-3 (`lore pending`).
 */
import type { LoreError, Result } from "@lore/core";
import { DecisionService } from "../../service/decision-service.js";
import type { PendingDecision } from "../../service/pending-decisions.js";
import { SQLiteStore } from "../../store/sqlite-store.js";
import { wrapStoreError } from "../../store/store-shared.js";
import { formatTable } from "./utils.js";

/** Open escalations of the corpus DB at `dbPath`, ordered by id. */
export async function collectPendingDecisions(dbPath: string): Promise<Result<PendingDecision[], LoreError>> {
  let store: SQLiteStore;
  try {
    store = new SQLiteStore(dbPath);
  } catch (cause) {
    return wrapStoreError(cause);
  }
  try {
    return await new DecisionService({ store, executorRun: null }).listPending();
  } finally {
    store.close();
  }
}

function formatFactors(factors: Readonly<Record<string, number>>): string {
  return Object.entries(factors)
    .map(([name, value]) => `${name}=${value}`)
    .join(" ");
}

/** The human block: a table plus the exact command to answer each decision. Empty string when there are none. */
export function renderPendingDecisions(decisions: readonly PendingDecision[]): string {
  if (decisions.length === 0) return "";
  const rows = decisions.map((d) => [
    String(d.id),
    d.class,
    `${d.subject_id} (${d.subject_version})`,
    String(d.score),
    formatFactors(d.factors),
    `${d.recommended} — ${d.recommended_reason}`,
  ]);
  const table = formatTable(["ID", "Class", "Subject", "Score", "Factors", "Recommended"], rows);
  const commands = decisions.map((d) => `  lore decide ${d.id} --accept|--reject   (human only: interactive terminal, no agent)`).join("\n");
  return `\nOpen decisions (${decisions.length}):\n${table}\n${commands}`;
}
