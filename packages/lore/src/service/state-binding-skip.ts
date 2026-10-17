/**
 * The audit-row vocabulary for a SKIPPED state-binding check (SPEC-143 AC-CT-8).
 *
 * Purpose: one definition of the row `lore verify` writes when a peer holds the oracle lock and the
 * stamp step therefore cannot certify a state, and of how `lore status` turns those rows into lines.
 * Public surface: {@link STATE_BINDING_SKIP_AUDIT_ACTION}, {@link buildStateBindingSkipAuditEntry},
 * {@link findUnresolvedStateBindingSkips}, {@link renderStateBindingSkipLine}.
 * Invariants: pure (no IO, no clock); a skip is "unresolved" until a LATER runner row for the same
 * task + AC carries a `state_stamp` (the row stays `unbound` until re-recorded).
 * Side-effect class: pure.
 */

import type { AuditEntry, EvidenceEntry } from "@lore/core";

/** Audit action stamped on every skipped state-binding check. */
export const STATE_BINDING_SKIP_AUDIT_ACTION = "state_binding_skipped";

/** `session_id` sentinel: a skip belongs to no interactive session (same rationale as `gate-skip`). */
const STATE_BINDING_SKIP_SESSION_ID = "state-binding-skip";

/** Facts a skip row carries beyond the doc it names. */
export interface StateBindingSkipFacts {
  readonly task_id: string;
  readonly ac_id: string;
  readonly holder_pid: number;
  readonly lock_path: string;
  readonly nowIso: string;
  readonly actor: string;
}

/** Builds the ONE audit row written per skipped AC. */
export function buildStateBindingSkipAuditEntry(facts: StateBindingSkipFacts): AuditEntry {
  return {
    timestamp: facts.nowIso,
    actor: facts.actor,
    session_id: STATE_BINDING_SKIP_SESSION_ID,
    action: STATE_BINDING_SKIP_AUDIT_ACTION,
    doc_id: facts.task_id,
    details: {
      ac_id: facts.ac_id,
      reason: "oracle_lock_held",
      holder_pid: facts.holder_pid,
      lock_path: facts.lock_path,
    },
  };
}

/** One skip still waiting for a stamped re-record. */
export interface UnresolvedStateBindingSkip {
  readonly task_id: string;
  readonly ac_id: string;
  readonly holder_pid: number | undefined;
  readonly skipped_at: string;
}

/**
 * Reduces skip audit rows to those not yet superseded by a later stamped runner row.
 *
 * @param skipRows - audit rows (any order); rows of another action or lacking `doc_id`/`ac_id` are ignored
 * @param evidenceFor - the task's recorded evidence by `doc_id` (empty when the task is unreadable)
 * @returns one entry per (task, AC), the newest skip, oldest first
 */
export function findUnresolvedStateBindingSkips(
  skipRows: readonly AuditEntry[],
  evidenceFor: (taskId: string) => readonly EvidenceEntry[],
): UnresolvedStateBindingSkip[] {
  const newest = new Map<string, UnresolvedStateBindingSkip>();
  for (const row of skipRows) {
    if (row.action !== STATE_BINDING_SKIP_AUDIT_ACTION || row.doc_id === undefined) continue;
    const acId = row.details?.["ac_id"];
    if (typeof acId !== "string") continue;
    const holder = row.details?.["holder_pid"];
    const key = `${row.doc_id}\u0000${acId}`;
    const prior = newest.get(key);
    if (prior !== undefined && prior.skipped_at >= row.timestamp) continue;
    newest.set(key, {
      task_id: row.doc_id,
      ac_id: acId,
      holder_pid: typeof holder === "number" ? holder : undefined,
      skipped_at: row.timestamp,
    });
  }
  return [...newest.values()]
    .filter(
      (skip) =>
        !evidenceFor(skip.task_id).some(
          (e) =>
            e.ac_ref === skip.ac_id &&
            e.attestation?.state_stamp !== undefined &&
            e.recorded_at > skip.skipped_at,
        ),
    )
    .sort((a, b) => a.skipped_at.localeCompare(b.skipped_at));
}

/**
 * The `lore status` line for the unresolved skips; `undefined` when there are none (a corpus with no
 * skip prints what it printed before). Contains the literal tokens `state-binding` and `SKIPPED`.
 */
export function renderStateBindingSkipLine(skips: readonly UnresolvedStateBindingSkip[]): string | undefined {
  if (skips.length === 0) return undefined;
  const named = skips.map((s) => `${s.task_id}/${s.ac_id}${s.holder_pid !== undefined ? ` (lock held by pid ${s.holder_pid})` : ""}`);
  return (
    `state-binding check SKIPPED for ${skips.length} AC run(s): ${named.join(", ")} — those rows are unbound ` +
    "until `lore verify` is re-run with the oracle lock free"
  );
}
