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
 *   - StampCurrency / StampVerdict / readStampVerdict — the ONE derivation of a row's stamp verdict
 *   - tallyStampReadings(...)          — the stamp-verdict distribution counts (through readStampVerdict)
 *   - RadiusMeasurement / readStampedRadius / classifyEvidenceRadii — the RADIUS axis of a stamped
 *                                        row (AC-CT-9: the floor reads stamp FIRST, radius only when stamped)
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

/**
 * The RADIUS axis — whether a peer commit landed inside the verdict's blast radius, or whether
 * that comparison could not be made at all. (Moved here from `gate-predicates.ts`, which
 * re-exports it, so the pure floor derivation in `evidence-panel.ts` and the service-layer
 * projection share ONE declaration.)
 *
 * ⛔ NEVER `boolean | "unmeasured"`: a consumer reading the sentinel in a boolean position gets
 * `truthy`/`falsy` instead of a type error and reports an unmeasured radius as a measured one
 * (SPEC-143 C3). "Not measured" and "measured, and nothing changed" have OPPOSITE safe defaults.
 */
export type RadiusMeasurement =
  | { readonly status: "measured"; readonly changed: boolean }
  | { readonly status: "unmeasured" };

/** The three readings a STAMPED row can take once its radius is read (AC-CT-9 (c)). */
export type StampedRadiusVerdict = "bound" | "stale" | "radius_unmeasured";

/**
 * The single derivation of `bound` / `stale` / `radius_unmeasured` from a stamped row's radius.
 * {@link readStampVerdict}'s `stamped` arm calls
 * this, so the distribution and the floor cannot disagree about which stamped rows are stale.
 *
 * @example
 * readStampedRadius({ status: "measured", changed: true }); // => "stale"
 * readStampedRadius({ status: "unmeasured" }); // => "radius_unmeasured" — accepted by the floor
 */
export function readStampedRadius(radius: RadiusMeasurement): StampedRadiusVerdict {
  if (radius.status === "unmeasured") return "radius_unmeasured";
  return radius.changed ? "stale" : "bound";
}

/**
 * The STAMP axis of a verdict's currency — whether the row is bound to a named
 * state at all, and when it is not, which side of the immutable arming cutoff
 * (the corpus's `state-binding-armed` audit row; `@lore/core`'s `stamp-binding.ts`) it was written on.
 *
 * - `"stamped"` — the row carries a `StateStamp`. Whether that binding is still
 *   CURRENT is the RADIUS axis's question, never this one's.
 * - `"unbound"` — no stamp, `recordedAuditId` above the armed audit id. Satisfies NO floor:
 *   after arming, a stamp-less row is a verdict about an unnamed state
 *   (SPEC-143 G3, `adr-a-record-with-no-state-stamp-is-acceptable-but-never-green`).
 * - `"legacy_unbound"` — no stamp, `recordedAuditId` at or below the armed audit id (or the corpus is unarmed). ACCEPTED by
 *   every floor that accepts it today, which is precisely what makes arming
 *   non-retro-invalidating (SPEC-143 N2).
 *
 * ⛔ THREE values, never a boolean: "unstamped before arming" and "unstamped
 * after arming" carry OPPOSITE gate consequences, so collapsing them either
 * retro-fails the entire back-catalogue or grandfathers every future row. Same
 * argument as {@link SessionComparison} above, one axis over.
 */
export type StampClass = StampAxisClass;

/**
 * The two-axis currency of one verdict-bearing row: what `stampCurrency` (the
 * SPEC-143 AC-CT-3 / AC-CT-4 predicate, landing in this module) returns and what
 * {@link readStampVerdict} projects onto a single reading.
 *
 * ⛔ TWO ORTHOGONAL AXES, never one collapsed enum (SPEC-143 R9 corrected
 * exactly this defect). A four-valued enum is the PARTIALLY-expanded product of
 * these axes and is missing one cell — stamp present, radius unmeasurable — and
 * every existing name is a FALSE verdict for that cell: `bound` claims
 * "compared, unchanged", `stale` claims "changed", `unbound` contradicts
 * ADR-034's own "carrying no stamp" definition. Keeping the enum and bolting on
 * a side field only relocates the falsehood from the type into consumer
 * discipline, which SPEC-143 G1 forbids.
 *
 * `reason`/`field` mirror {@link PredicateResult}'s machine-readable failure
 * sub-discriminators, so a floor renders WHY a row is refused from the value it
 * already has instead of re-deriving it.
 */
export interface StampCurrency {
  readonly stamp: StampClass;
  readonly radius: RadiusMeasurement;
  readonly reason?: string;
  readonly field?: string;
}

/**
 * The five mutually-exclusive terminal readings of the (stamp × radius) product
 * — and the buckets SPEC-143 AC-CT-9's stamp-verdict distribution counts, with
 * `radius_unmeasured` carrying its own count rather than being folded into a
 * neighbour.
 */
export type StampVerdict = "bound" | "stale" | "radius_unmeasured" | "unbound" | "legacy_unbound";

/**
 * Projects a two-axis {@link StampCurrency} onto its one terminal reading — the
 * SINGLE place `bound` / `stale` / `radius_unmeasured` are derived. Those three
 * are never stored (SPEC-143 C2); storing them would let a persisted reading
 * disagree with the axes it was computed from.
 *
 * TOTAL over the 3x3 product, pure, and side-effect free (module invariant: no
 * store, no IO, no clock).
 *
 * AXIS PRECEDENCE is load-bearing, not incidental: the STAMP axis is read FIRST,
 * so `unbound` + `unmeasured` still reads `unbound` (a refusal) while `stamped`
 * + `unmeasured` reads `radius_unmeasured` (which the floor accepts). Reading
 * the radius first would let an unmeasurable radius launder a post-arming
 * stamp-less row into an accepted reading — AC-CT-9's precedence control exists
 * for exactly that inversion, and the reason the RED oracle asserts every radius
 * arm gives the SAME reading for both unbound classes.
 *
 * @param currency - both axes, ALREADY resolved by the caller (the shape
 *   {@link assessmentFreshness} proved: the caller pre-resolves, the predicate
 *   does no IO).
 * @returns exactly one of the five {@link StampVerdict} readings.
 * @example
 * readStampVerdict({ stamp: "stamped", radius: { status: "measured", changed: false } }); // => "bound"
 * @example
 * readStampVerdict({ stamp: "stamped", radius: { status: "measured", changed: true } }); // => "stale"
 * @example
 * readStampVerdict({ stamp: "stamped", radius: { status: "unmeasured" } }); // => "radius_unmeasured"
 * @example
 * readStampVerdict({ stamp: "unbound", radius: { status: "unmeasured" } }); // => "unbound" — stamp axis first
 * @example
 * readStampVerdict({ stamp: "legacy_unbound", radius: { status: "measured", changed: true } });
 *   // => "legacy_unbound" — the radius never leaks into a stamp-axis reading
 */
export function readStampVerdict(currency: StampCurrency): StampVerdict {
  switch (currency.stamp) {
    case "unbound":
      return "unbound";
    case "legacy_unbound":
      return "legacy_unbound";
    case "stamped":
      // reason: the stamp axis is read FIRST (above); the radius only decides among stamped rows, through
      // the ONE derivation the floor's tally shares (`readStampedRadius`, @lore/core).
      return readStampedRadius(currency.radius);
    default: {
      // Exhaustiveness gate — a FOURTH `StampClass` member fails `tsc` on this
      // line, never silently projects onto an existing reading. SPEC-143
      // AC-CT-9(c) pins the diagnostic to THIS function's own line range, so
      // relocating the check out of `readStampVerdict` reddens that oracle.
      const _exhaustive: never = currency.stamp;
      return _exhaustive;
    }
  }
}

/**
 * Pairs one stamp-axis reading with its already-measured radius into a {@link StampCurrency}, carrying the
 * `unbound` reason. The ONE place a {@link StampAxisReading} becomes a currency (the floor tally and the
 * distribution both go through it, then through {@link readStampVerdict}).
 *
 * @example
 * stampCurrencyOf({ stamp: "unbound", reason: "no_stamp" }, { status: "unmeasured" });
 * // => { stamp: "unbound", radius: { status: "unmeasured" }, reason: "no_stamp" }
 */
export function stampCurrencyOf(reading: StampAxisReading, radius: RadiusMeasurement): StampCurrency {
  return reading.stamp === "unbound"
    ? { stamp: reading.stamp, radius, reason: reading.reason }
    : { stamp: reading.stamp, radius };
}

/**
 * The reason a row's stamp verdict is `unbound`, or `undefined` when the row is anything else (or not attested). Routes the
 * reading through {@link readStampVerdict} (the stamp axis is read first, so the radius never changes the answer and an
 * `unmeasured` placeholder is exact), so a consumer asks "is this row unbound, and why" without re-deriving the verdict.
 *
 * @param reading - one entry of {@link classifyEvidenceStamps} (`null` = not attested)
 * @returns the unbound reason, or `undefined` when the verdict is not `unbound`
 * @example
 * unboundReasonOfReading({ stamp: "unbound", reason: "no_stamp" }); // => "no_stamp"
 * @example
 * unboundReasonOfReading({ stamp: "stamped" }); // => undefined
 * @example
 * unboundReasonOfReading(null); // => undefined
 */
export function unboundReasonOfReading(reading: StampAxisReading | null | undefined): string | undefined {
  if (reading === null || reading === undefined) return undefined;
  const currency = stampCurrencyOf(reading, { status: "unmeasured" });
  return readStampVerdict(currency) === "unbound" ? currency.reason : undefined;
}

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
  /**
   * Per doc id, the radius measurement of each evidence row, index-aligned with the doc's
   * evidence log (the reader measures STAMPED rows only; other slots are `unmeasured`).
   * Absent key / absent map = the radius was not measured, which {@link classifyEvidenceRadii}
   * reads as `unmeasured` — accepted by the floor, never "unchanged" (AC-CT-9 (a)).
   */
  readonly radiusByDoc?: ReadonlyMap<string, readonly RadiusMeasurement[]>;
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

/**
 * Every evidence row's radius measurement, index-aligned with `evidence`; a row with no recorded
 * measurement reads `unmeasured`.
 */
export function classifyEvidenceRadii(
  docId: string,
  evidence: readonly EvidenceEntry[],
  binding: StampBindingContext,
): RadiusMeasurement[] {
  const measured = binding.radiusByDoc?.get(docId);
  return evidence.map((_, index) => measured?.[index] ?? { status: "unmeasured" });
}

/** The stamp-verdict distribution over the stamp axis: counts per class, `unbound` split by reason. */
export interface StampReadingTally {
  /** Every stamped row; `bound + stale + radius_unmeasured === stamped`. */
  readonly stamped: number;
  /** Stamped, radius measured, nothing inside it changed since the recorded HEAD. */
  readonly bound: number;
  /** Stamped, and a commit since the recorded HEAD touched the blast radius. REFUSED by the floor. */
  readonly stale: number;
  /** Stamped, radius not measurable. ACCEPTED by the floor (AC-CT-9 (a)), counted on its own. */
  readonly radius_unmeasured: number;
  readonly legacy_unbound: number;
  readonly unbound: number;
  /** Sums to `unbound` (AC-CT-9: every unbound row carries exactly one reason). */
  readonly unbound_reasons: Readonly<Record<UnboundReason, number>>;
}

/**
 * Counts readings into a {@link StampReadingTally}; `null` (not attested) entries are skipped.
 * `radii` is index-aligned with `readings` and read ONLY for stamped rows (stamp axis first);
 * omitted, every stamped row is `radius_unmeasured`.
 */
export function tallyStampReadings(
  readings: readonly (StampAxisReading | null)[],
  radii?: readonly RadiusMeasurement[],
): StampReadingTally {
  let bound = 0;
  let stale = 0;
  let radiusUnmeasured = 0;
  let legacy = 0;
  let unbound = 0;
  const reasons: Record<UnboundReason, number> = {
    dirty_tree: 0,
    state_moved: 0,
    audit_id_unresolved: 0,
    no_stamp: 0,
  };
  for (const [index, reading] of readings.entries()) {
    if (reading === null) continue;
    const currency = stampCurrencyOf(reading, radii?.[index] ?? { status: "unmeasured" });
    // reason: the verdict is read ONLY through `readStampVerdict` (SPEC-143 AC-CT-10); this tally never
    // switches on the raw stamp class.
    const verdict = readStampVerdict(currency);
    switch (verdict) {
      case "bound":
        bound += 1;
        break;
      case "stale":
        stale += 1;
        break;
      case "radius_unmeasured":
        radiusUnmeasured += 1;
        break;
      case "legacy_unbound":
        legacy += 1;
        break;
      case "unbound":
        unbound += 1;
        reasons[unboundReasonOf(currency)] += 1;
        break;
      default: {
        const _exhaustive: never = verdict;
        return _exhaustive;
      }
    }
  }
  return {
    stamped: bound + stale + radiusUnmeasured,
    bound,
    stale,
    radius_unmeasured: radiusUnmeasured,
    legacy_unbound: legacy,
    unbound,
    unbound_reasons: reasons,
  };
}

/** The `unbound` reason a currency carries; an `unbound` currency without a known reason is a bug, so fail loud. */
function unboundReasonOf(currency: StampCurrency): UnboundReason {
  const reason = currency.reason;
  if (reason !== undefined && (UNBOUND_REASONS as readonly string[]).includes(reason)) {
    return reason as UnboundReason;
  }
  throw new Error(`unbound stamp currency carries no recognised reason: ${String(reason)}`);
}
