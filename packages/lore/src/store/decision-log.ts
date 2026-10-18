/**
 * Decision log — row shapes, hash chain and effective-verdict rules for the autonomy decision log.
 *
 * Purpose: the ONE home of what a decision record is, how it is chained, how a broken chain is found and
 * which verdict is effective for a (class, subject, version).
 * Public surface: DecisionLogRow, DecisionRecordInput, DecisionChannel, DecisionVerdict, DECISION_GENESIS_HASH,
 *   computeDecisionEntryHash, verifyDecisionChain, effectiveDecisionVerdict, decisionChainHead.
 * Invariants:
 *   - The hash covers the exact stored text of every column (JSON columns as stored, never re-serialised) plus
 *     prev_hash, as a fixed-order JSON array — column order is a frozen contract once rows exist.
 *   - `entry_hash` is computed store-side only, inside the transaction that reads the chain head; callers
 *     (DecisionRecordInput) cannot supply hashes.
 *   - Effective verdict: the latest `human-tty` record wins (auto = accept, refuse = reject); otherwise the WORST
 *     over `machine` records (refuse > escalate > auto). `agent-asserted` records never take part.
 *   - `superseded` (migration 023, AU-T16) rows are CLOSING MARKERS of a pending decision whose subject is gone or was
 *     re-decided on a newer version. They are not decisions: effectiveDecisionVerdict ignores them, and anything that
 *     counts, calibrates or SAMPLES auto decisions (AU-T8 outcome calibration, 1-in-10 sampling) must select
 *     `verdict = 'auto'` and therefore never sees them. Only service/pending-decisions.ts reads them. A new
 *     `subject_version` is a new subject: records of another version are never consulted.
 * Side-effect class: pure (node:crypto hashing only). Not in @lore/core's browser-safe barrel on purpose.
 *
 * Source: spec-autonomy-phase-1-decision-function-human-channel-lore AC-AU-2;
 *   adr-autonomy-is-decided-by-measured-facts-one-decision-function D5.
 */
import { createHash } from "node:crypto";

/** `superseded` (migration 023) is a CLOSING record, not a decision: see the invariants above. */
export type DecisionVerdict = "auto" | "escalate" | "refuse" | "superseded";
/** `human-tty` is produced only by the human channel (AU-T3); `agent-asserted` never takes precedence. */
export type DecisionChannel = "machine" | "human-tty" | "agent-asserted";

/** What a writer supplies; JSON columns arrive already serialised (see service/decision-service.ts). */
export interface DecisionRecordInput {
  readonly ts: string;
  readonly class: string;
  readonly subject_id: string;
  readonly subject_version: string;
  readonly facts: string;
  readonly factors: string;
  readonly score: number;
  readonly threshold: number | null;
  readonly verdict: DecisionVerdict;
  readonly reasons: string;
  readonly executor_run: string | null;
  readonly channel: DecisionChannel;
}

/** A stored row: the input plus its position and chain hashes. */
export interface DecisionLogRow extends DecisionRecordInput {
  readonly id: number;
  readonly prev_hash: string;
  readonly entry_hash: string;
}

/** `prev_hash` of the first row ever written. */
export const DECISION_GENESIS_HASH = "";

/** sha256 over the fixed-order payload of `input` chained to `prevHash`. */
export function computeDecisionEntryHash(input: DecisionRecordInput, prevHash: string): string {
  const payload = JSON.stringify([
    input.ts,
    input.class,
    input.subject_id,
    input.subject_version,
    input.facts,
    input.factors,
    input.score,
    input.threshold,
    input.verdict,
    input.reasons,
    input.executor_run,
    input.channel,
    prevHash,
  ]);
  return createHash("sha256").update(payload).digest("hex");
}

export type DecisionChainBreakReason = "hash_mismatch" | "prev_link_mismatch";

export type DecisionChainVerifyResult =
  | { readonly clean: true; readonly checked: number }
  | {
      readonly clean: false;
      readonly checked: number;
      /** First broken row in id ASC order. */
      readonly break: { readonly id: number; readonly reason: DecisionChainBreakReason };
    };

/**
 * Walks the whole chain in id ASC order. A row whose recomputed hash differs from its stored `entry_hash` was
 * edited (`hash_mismatch`); a row whose `prev_hash` is not the previous row's `entry_hash` follows a deleted,
 * reordered or inserted row (`prev_link_mismatch`). Reports the FIRST break.
 */
export function verifyDecisionChain(rows: readonly DecisionLogRow[]): DecisionChainVerifyResult {
  let prev = DECISION_GENESIS_HASH;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as DecisionLogRow;
    if (row.prev_hash !== prev) return { clean: false, checked: i + 1, break: { id: row.id, reason: "prev_link_mismatch" } };
    if (computeDecisionEntryHash(row, row.prev_hash) !== row.entry_hash) {
      return { clean: false, checked: i + 1, break: { id: row.id, reason: "hash_mismatch" } };
    }
    prev = row.entry_hash;
  }
  return { clean: true, checked: rows.length };
}

export interface DecisionChainHead {
  readonly head_id: number;
  readonly head_hash: string;
  readonly count: number;
}

/** Head of the chain, or null for an empty log. */
export function decisionChainHead(rows: readonly DecisionLogRow[]): DecisionChainHead | null {
  const last = rows[rows.length - 1];
  return last === undefined ? null : { head_id: last.id, head_hash: last.entry_hash, count: rows.length };
}

/** The verdicts that are decisions (everything but the closing marker). */
export type DecidedVerdict = Exclude<DecisionVerdict, "superseded">;

export interface EffectiveDecisionVerdict {
  readonly verdict: DecidedVerdict;
  readonly channel: "machine" | "human-tty";
  /** id of the record that decided it: the latest human-tty row, or the worst machine row (latest among ties). */
  readonly record_id: number;
}

const SEVERITY: Readonly<Record<DecidedVerdict, number>> = { auto: 0, escalate: 1, refuse: 2 };

/**
 * Effective verdict for one (class, subject_id, subject_version) over `rows` (any superset; other keys ignored).
 * Returns null when no human-tty or machine record exists for the key.
 */
export function effectiveDecisionVerdict(
  rows: readonly DecisionLogRow[],
  key: { readonly class: string; readonly subject_id: string; readonly subject_version: string },
): EffectiveDecisionVerdict | null {
  // reason: `superseded` rows are closing markers, not decisions - they never take part in the effective verdict.
  const mine = rows.filter(
    (r) =>
      r.class === key.class &&
      r.subject_id === key.subject_id &&
      r.subject_version === key.subject_version &&
      r.verdict !== "superseded",
  );
  const human = mine.filter((r) => r.channel === "human-tty").sort((a, b) => b.id - a.id)[0];
  if (human !== undefined) return { verdict: human.verdict as DecidedVerdict, channel: "human-tty", record_id: human.id };
  let worst: DecisionLogRow | undefined;
  for (const r of mine) {
    if (r.channel !== "machine") continue;
    if (worst === undefined || SEVERITY[r.verdict as DecidedVerdict] >= SEVERITY[worst.verdict as DecidedVerdict]) worst = r;
  }
  return worst === undefined ? null : { verdict: worst.verdict as DecidedVerdict, channel: "machine", record_id: worst.id };
}
