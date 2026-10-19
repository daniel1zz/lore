/**
 * `lore pending` decision surface — open autonomy decisions (escalations awaiting the human).
 *
 * Purpose: read the pending decisions through DecisionService and render them next to the pending documents.
 * Public surface: collectPendingDecisions, renderPendingDecisions, collectAuditItems, renderAuditItems.
 *   Each row also prints its `What:` summary and a `Details:` dashboard link (decision-detail-lines.ts, HR-T7).
 * Invariants:
 *   - Shows id, class, subject, score, factors and the recommended answer; there is no nonce anywhere in the
 *     data (it is generated per `lore decide` invocation and lives only on the controlling terminal).
 *   - A store read failure is returned as err — never rendered as "no open decisions".
 * Side-effect class: IO (opens a store handle on `dbPath`, closed before returning); rendering is pure.
 *
 * Source: spec-autonomy-phase-1-decision-function-human-channel-lore AC-AU-3 (`lore pending`).
 */
import type { LoreError, Result } from "@lore/core";
import type { AuditItem } from "../../service/autonomy-calibration-service.js";
import { DecisionService } from "../../service/decision-service.js";
import { createSubjectExistenceProbes } from "../../service/decision-subject-probes.js";
import type { PendingDecision } from "../../service/pending-decisions.js";
import { createRealSubjectProbePorts } from "../real-subject-probe-ports.js";
import { SQLiteStore } from "../../store/sqlite-store.js";
import { wrapStoreError } from "../../store/store-shared.js";
import { renderDecisionDetailLines, renderDetailsLine } from "./decision-detail-lines.js";
import { formatTable } from "./utils.js";

/**
 * Open escalations of the corpus DB at `dbPath`, ordered by id. Listing closes stale ones first (AU-T16): with
 * `repoRoot` the class-specific existence probes run (worktree / stash / process / run); without it only the
 * newer-version rule applies.
 */
export async function collectPendingDecisions(
  dbPath: string,
  env: Readonly<Record<string, string | undefined>>,
  repoRoot?: string,
): Promise<Result<PendingDecision[], LoreError>> {
  let store: SQLiteStore;
  try {
    store = new SQLiteStore(dbPath);
  } catch (cause) {
    return wrapStoreError(cause);
  }
  try {
    const subjectProbes = repoRoot === undefined ? undefined : createSubjectExistenceProbes(createRealSubjectProbePorts(repoRoot, store, env));
    return await new DecisionService({ store, executorRun: null, ...(subjectProbes !== undefined ? { subjectProbes } : {}) }).listPending();
  } finally {
    store.close();
  }
}

/** The sampling-floor audit queue (AC-AU-10) of the corpus DB at `dbPath`, ordered by decision id. */
export async function collectAuditItems(dbPath: string): Promise<Result<AuditItem[], LoreError>> {
  let store: SQLiteStore;
  try {
    store = new SQLiteStore(dbPath);
  } catch (cause) {
    return wrapStoreError(cause);
  }
  try {
    return await new DecisionService({ store, executorRun: null }).listAudit();
  } finally {
    store.close();
  }
}

function formatFactors(factors: Readonly<Record<string, number>>): string {
  return Object.entries(factors)
    .map(([name, value]) => `${name}=${value}`)
    .join(" ");
}

/** Indented What line plus the Details link of one row, under its `lore decide` command. */
function detailBlock(row: { readonly detail: string | null }, id: number, detailBase: string | null): string {
  const what = renderDecisionDetailLines(row)[0];
  return `    ${what}\n    ${renderDetailsLine(detailBase, id)}`;
}

/** The human block: a table plus the exact command to answer each decision. Empty string when there are none. */
export function renderPendingDecisions(decisions: readonly PendingDecision[], detailBase: string | null): string {
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
  const commands = decisions.map((d) => `  lore decide ${d.id} --accept|--reject   (human only: interactive terminal, no agent)\n${detailBlock(d, d.id, detailBase)}`).join("\n");
  return `\nOpen decisions (${decisions.length}):\n${table}\n${commands}`;
}

/**
 * The audit block: auto decisions sampled for non-blocking human review, listed SEPARATELY from the blocking
 * escalations above. The audited operation already ran. Empty string when the queue is empty.
 */
export function renderAuditItems(items: readonly AuditItem[], detailBase: string | null): string {
  if (items.length === 0) return "";
  const rows = items.map((i) => [String(i.id), i.class, `${i.subject_id} (${i.subject_version})`, `#${i.sequence}`, i.decided_at]);
  const table = formatTable(["ID", "Class", "Subject", "Sample", "Decided"], rows);
  const commands = items.map((i) => `  lore decide ${i.id} --accept|--reject   (audit: accept = the auto decision was right, reject = wrong; human only)\n${detailBlock(i, i.id, detailBase)}`).join("\n");
  return `\nAwaiting audit (${items.length}, non-blocking: these operations already ran):\n${table}\n${commands}`;
}
