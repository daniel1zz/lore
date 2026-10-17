/**
 * The STAMP axis of an evidence row's currency, classified against a per-corpus
 * arming cutoff (SPEC-143 AC-CT-3, G3, R13).
 *
 * Public surface:
 *   - STATE_BINDING_ARMED_ACTION       — the `audit.action` of the one arming row
 *   - UNBOUND_REASONS / UnboundReason  — the four reasons an `unbound` row carries
 *   - StampAxisReading                 — `stamped | legacy_unbound | unbound(reason)`
 *   - classifyStampAxis(input)         — one row's reading (pure)
 *   - resolveRecordedAuditIds(...)     — each row's audit id: server-written
 *                                        `recorded_corpus_rev`, else the evidence-audit join
 *   - StampBindingContext              — the resolved facts a corpus read hands the pure side
 *   - classifyEvidenceStamps(...)      — a doc's whole evidence log -> readings (null = not attested)
 *   - tallyStampReadings(...)          — the stamp-verdict distribution counts
 *
 * Invariants:
 *   - ⛔ The cutoff is the id of the `state-binding-armed` audit row, never a
 *     shipped literal (R13: a literal never arms a consumer corpus). A corpus with
 *     no such row is UNARMED and nothing in it is ever `unbound`.
 *   - ⛔ An absent audit id is `unbound`/`audit_id_unresolved`, never defaulted to
 *     0 (which would retro-refuse the back-catalogue) nor to "current".
 *   - Only ATTESTED rows (an `attestation` object) have a reading; a self-report is
 *     not a stamp-axis subject, so it maps to `null`, never to a class.
 *
 * Side-effect class: pure (no IO, no clock, no store).
 *
 * Source: spec-corpus-truthfulness-a-verdict-must-carry-the-state-it AC-CT-3 / G3 / R13.
 */

import type { EvidenceEntry, StampUnboundReason } from "./task-workflow.js";

/** `audit.action` of the single per-corpus arming row (SPEC-143 C1, R13). */
export const STATE_BINDING_ARMED_ACTION = "state-binding-armed";

/**
 * Every reason an `unbound` reading carries (SPEC-143 AC-CT-9). `dirty_tree` and
 * `state_moved` are runner-issued (`StampUnboundReason`); `audit_id_unresolved` and
 * `no_stamp` are classifier-issued.
 */
export const UNBOUND_REASONS = ["dirty_tree", "state_moved", "audit_id_unresolved", "no_stamp"] as const;

/** One member of {@link UNBOUND_REASONS}. */
export type UnboundReason = (typeof UNBOUND_REASONS)[number];

/** The three values of the stamp axis (SPEC-143 AC-CT-9). */
export type StampAxisClass = "stamped" | "unbound" | "legacy_unbound";

/**
 * One row's stamp-axis reading. A discriminated union so `unbound` cannot exist
 * without its reason, and the other two cannot carry one.
 */
export type StampAxisReading =
  | { readonly stamp: "stamped" }
  | { readonly stamp: "legacy_unbound" }
  | { readonly stamp: "unbound"; readonly reason: UnboundReason };

/** Input to {@link classifyStampAxis}. */
export interface StampAxisInput {
  /** The corpus's arming audit id, or `undefined` when the corpus is UNARMED. */
  readonly armingRev: number | undefined;
  /** `true` iff the row's attestation carries a `state_stamp`. */
  readonly hasStamp: boolean;
  /** The runner's own demotion reason (`attestation.stamp_unbound_reason`), when it wrote one. */
  readonly runnerReason: StampUnboundReason | undefined;
  /** The row's resolved audit id (see {@link resolveRecordedAuditIds}); `undefined` = unresolvable. */
  readonly recordedAuditId: number | undefined;
}

/**
 * Classifies one attested row on the stamp axis.
 *
 * Order matters and is the contract:
 *   1. a stamp present is `stamped` (what the stamp is currently worth is the radius axis's question);
 *   2. an UNARMED corpus has no `unbound` at all, so every stamp-less row is `legacy_unbound`;
 *   3. armed, no audit id -> `unbound`/`audit_id_unresolved` (never a guess);
 *   4. armed, audit id at or below the arming id -> `legacy_unbound` (accepted, nothing retro-fails);
 *   5. armed, audit id above it -> `unbound`, reason = the runner's own (`dirty_tree`/`state_moved`) else `no_stamp`.
 *
 * @example
 * classifyStampAxis({ armingRev: 100, hasStamp: false, runnerReason: undefined, recordedAuditId: 101 });
 * // => { stamp: "unbound", reason: "no_stamp" }
 * @example
 * classifyStampAxis({ armingRev: 100, hasStamp: false, runnerReason: undefined, recordedAuditId: 100 });
 * // => { stamp: "legacy_unbound" }
 * @example
 * classifyStampAxis({ armingRev: undefined, hasStamp: false, runnerReason: undefined, recordedAuditId: 5 });
 * // => { stamp: "legacy_unbound" } — unarmed
 */
export function classifyStampAxis(input: StampAxisInput): StampAxisReading {
  if (input.hasStamp) return { stamp: "stamped" };
  if (input.armingRev === undefined) return { stamp: "legacy_unbound" };
  if (input.recordedAuditId === undefined) return { stamp: "unbound", reason: "audit_id_unresolved" };
  if (input.recordedAuditId <= input.armingRev) return { stamp: "legacy_unbound" };
  return { stamp: "unbound", reason: input.runnerReason ?? "no_stamp" };
}

/**
 * Resolved corpus facts the pure classifier needs, produced by one store read
 * (`service/stamp-binding-reader.ts`). `armingRev === undefined` means the corpus is unarmed.
 */
export interface StampBindingContext {
  readonly armingRev: number | undefined;
  /**
   * Per doc id, the ids of that doc's `action: "evidence"` audit rows in ASCENDING order — the
   * `(doc_id, details.version)` join. Absent key = the doc has no evidence audit row.
   */
  readonly evidenceAuditIdsByDoc: ReadonlyMap<string, readonly number[]>;
}

/**
 * Resolves each evidence row's audit id: the server-written `recorded_corpus_rev` (the
 * `MAX(audit.id)` when the row was written, so the row's own audit entry took the next id),
 * else the doc's evidence audit rows matched POSITIONALLY from the tail (evidence is append-only
 * and every evidence write adds exactly one audit row, so the Nth row is the Nth audit row;
 * tail alignment keeps the newest rows resolvable when the oldest pre-date the audit table).
 * `undefined` where neither source answers — never a default.
 */
export function resolveRecordedAuditIds(
  evidence: readonly EvidenceEntry[],
  evidenceAuditIdsAsc: readonly number[],
): (number | undefined)[] {
  const offset = evidence.length - evidenceAuditIdsAsc.length;
  return evidence.map((entry, index) => {
    if (entry.recorded_corpus_rev !== undefined) return entry.recorded_corpus_rev + 1;
    return evidenceAuditIdsAsc[index - offset];
  });
}

/**
 * Classifies every row of one doc's evidence log. `null` marks a row with no attestation (a
 * self-report has no stamp-axis reading); the array is index-aligned with `evidence`.
 */
export function classifyEvidenceStamps(
  docId: string,
  evidence: readonly EvidenceEntry[],
  binding: StampBindingContext,
): (StampAxisReading | null)[] {
  const auditIds = resolveRecordedAuditIds(evidence, binding.evidenceAuditIdsByDoc.get(docId) ?? []);
  return evidence.map((entry, index) => {
    const attestation = entry.attestation;
    if (attestation === undefined) return null;
    return classifyStampAxis({
      armingRev: binding.armingRev,
      hasStamp: attestation.state_stamp !== undefined,
      runnerReason: attestation.stamp_unbound_reason,
      recordedAuditId: auditIds[index],
    });
  });
}

/** The stamp-verdict distribution over the stamp axis: counts per class, `unbound` split by reason. */
export interface StampReadingTally {
  readonly stamped: number;
  readonly legacy_unbound: number;
  readonly unbound: number;
  /** Sums to `unbound` (AC-CT-9: every unbound row carries exactly one reason). */
  readonly unbound_reasons: Readonly<Record<UnboundReason, number>>;
}

/** Counts readings into a {@link StampReadingTally}; `null` (not attested) entries are skipped. */
export function tallyStampReadings(readings: readonly (StampAxisReading | null)[]): StampReadingTally {
  let stamped = 0;
  let legacy = 0;
  let unbound = 0;
  const reasons: Record<UnboundReason, number> = {
    dirty_tree: 0,
    state_moved: 0,
    audit_id_unresolved: 0,
    no_stamp: 0,
  };
  for (const reading of readings) {
    if (reading === null) continue;
    switch (reading.stamp) {
      case "stamped":
        stamped += 1;
        break;
      case "legacy_unbound":
        legacy += 1;
        break;
      case "unbound":
        unbound += 1;
        reasons[reading.reason] += 1;
        break;
      default: {
        const _exhaustive: never = reading;
        return _exhaustive;
      }
    }
  }
  return { stamped, legacy_unbound: legacy, unbound, unbound_reasons: reasons };
}
