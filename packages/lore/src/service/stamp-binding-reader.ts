/**
 * The store-reading half of SPEC-143 AC-CT-3's stamp axis: resolves the corpus's arming
 * cutoff and each evidence-bearing doc's evidence audit ids into the plain
 * {@link StampBindingContext} the pure classifier (`@lore/core`'s `stamp-binding.ts`) consumes.
 *
 * Public surface:
 *   - readArmingRev(store)                  — the `state-binding-armed` audit row's id, or `undefined` (unarmed)
 *   - loadStampBindingContext(store, docs)  — the context for a set of task/phase docs
 *   - readRecordedCorpusRev(store)          — `MAX(audit.id)` for the evidence write chokepoints
 *
 * Invariants:
 *   - ⛔ The cutoff is the LOWEST-id `state-binding-armed` row: a later row (a forged or
 *     duplicate arming) can never move the cutoff forward and so can never un-refuse a row.
 *   - An UNARMED corpus performs NO per-doc audit reads (nothing in it can be `unbound`).
 *   - A store failure is returned, never swallowed into "unarmed" — an unreadable audit table
 *     must not silently turn the floor off.
 *
 * Side-effect class: IO (read-only; store-shared helper, not a stateful service — composed by
 * every service that already holds a `StoreInterface`).
 *
 * Source: spec-corpus-truthfulness-a-verdict-must-carry-the-state-it AC-CT-3 / C1 / C2 (R13).
 */

import {
  extractEvidence,
  ok,
  STATE_BINDING_ARMED_ACTION,
  type DocRecord,
  type LoreError,
  type Result,
  type StampBindingContext,
} from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";

/**
 * The corpus's arming cutoff: the id of its first `state-binding-armed` audit row, or
 * `undefined` when the corpus was never armed.
 */
export async function readArmingRev(store: StoreInterface): Promise<Result<number | undefined, LoreError>> {
  const rows = await store.listAuditRowsByAction(STATE_BINDING_ARMED_ACTION);
  if (!rows.ok) return rows;
  return ok(rows.value[0]?.id);
}

/**
 * Builds the {@link StampBindingContext} for `docs`. Docs with no evidence are skipped; an unarmed
 * corpus reads no per-doc audit rows at all.
 */
export async function loadStampBindingContext(
  store: StoreInterface,
  docs: readonly DocRecord[],
): Promise<Result<StampBindingContext, LoreError>> {
  const armingRev = await readArmingRev(store);
  if (!armingRev.ok) return armingRev;
  const evidenceAuditIdsByDoc = new Map<string, readonly number[]>();
  if (armingRev.value !== undefined) {
    for (const doc of docs) {
      if (extractEvidence(doc).length === 0) continue;
      const rows = await store.listAuditRowsByAction("evidence", doc.id);
      if (!rows.ok) return rows;
      evidenceAuditIdsByDoc.set(
        doc.id,
        rows.value.map((row) => row.id),
      );
    }
  }
  return ok({ armingRev: armingRev.value, evidenceAuditIdsByDoc });
}

/**
 * The `recorded_corpus_rev` an evidence row written NOW carries: `MAX(audit.id)` (0 for an empty
 * audit table). Server-side only — no evidence input type carries the field.
 */
export async function readRecordedCorpusRev(store: StoreInterface): Promise<Result<number, LoreError>> {
  return store.getAuditHeadId();
}
