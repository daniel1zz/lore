/**
 * The store-reading half of SPEC-143 AC-CT-3's stamp axis: resolves the corpus's arming
 * cutoff and each evidence-bearing doc's evidence audit ids into the plain
 * {@link StampBindingContext} the pure classifier (`@lore/core`'s `stamp-binding.ts`) consumes.
 *
 * Public surface:
 *   - readArmingRev(store)                  — the `state-binding-armed` audit row's id, or `undefined` (unarmed)
 *   - loadStampBindingContext(store, docs)  — the context for a set of task/phase docs
 *   - readRecordedCorpusRev(store)          — `MAX(audit.id)` for the evidence write chokepoints
 *   - measureRadiusByDoc(docs, diff)        — the RADIUS axis of every STAMPED row (AC-CT-9), via
 *                                             `blastRadiusChanged` over the injected diff port
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
  extractFileAnchors,
  ok,
  STATE_BINDING_ARMED_ACTION,
  type DocRecord,
  type LoreError,
  type RadiusMeasurement,
  type Result,
  type StampBindingContext,
} from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { blastRadiusChanged } from "./gate-predicates.js";

/** The one question the radius axis asks of the VCS (`SpawnGitPort` and the lazy app-wired port both answer it). */
export interface RadiusDiffPort {
  changedSince(sha: string, paths: string[]): Result<boolean, LoreError>;
}

/**
 * Measures the radius of every STAMPED attested row of `docs`: `diff --quiet <stamp.head_sha> HEAD --
 * <radius>` where the radius is the row's own command's test-file targets UNION the task's `file_anchors`
 * (`blastRadiusChanged`, SPEC-143 AC-CT-4). Unstamped rows and self-reports are not measured (their slot reads
 * `unmeasured`; the floor reads the stamp axis first and never looks at it). Identical (head, command, anchors)
 * questions are asked of the port once per call.
 */
export function measureRadiusByDoc(
  docs: readonly DocRecord[],
  diff: RadiusDiffPort,
): ReadonlyMap<string, readonly RadiusMeasurement[]> {
  const memo = new Map<string, RadiusMeasurement>();
  const byDoc = new Map<string, readonly RadiusMeasurement[]>();
  for (const doc of docs) {
    const evidence = extractEvidence(doc);
    if (evidence.length === 0) continue;
    const anchors = extractFileAnchors(doc);
    byDoc.set(
      doc.id,
      evidence.map((entry): RadiusMeasurement => {
        const stamp = entry.attestation?.state_stamp;
        if (stamp === undefined) return { status: "unmeasured" };
        const key = `${stamp.head_sha}\0${entry.command}\0${anchors.join("\n")}`;
        const cached = memo.get(key);
        if (cached !== undefined) return cached;
        const measured = blastRadiusChanged(
          { command: entry.command, fileAnchors: anchors, recordedHead: stamp.head_sha },
          diff,
        );
        memo.set(key, measured);
        return measured;
      }),
    );
  }
  return byDoc;
}

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
 * corpus reads no per-doc audit rows at all. With `diff`, the radius axis of every stamped row is measured
 * too ({@link measureRadiusByDoc}).
 */
export async function loadStampBindingContext(
  store: StoreInterface,
  docs: readonly DocRecord[],
  diff?: RadiusDiffPort,
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
  // reason: AC-CT-9 — the radius axis is measured only when a diff port was handed in; without one every
  // stamped row reads `radius_unmeasured`, which the floor ACCEPTS (never "unchanged", never a refusal).
  return ok({
    armingRev: armingRev.value,
    evidenceAuditIdsByDoc,
    ...(diff !== undefined ? { radiusByDoc: measureRadiusByDoc(docs, diff) } : {}),
  });
}

/**
 * The `recorded_corpus_rev` an evidence row written NOW carries: `MAX(audit.id)` (0 for an empty
 * audit table). Server-side only — no evidence input type carries the field.
 */
export async function readRecordedCorpusRev(store: StoreInterface): Promise<Result<number, LoreError>> {
  return store.getAuditHeadId();
}
