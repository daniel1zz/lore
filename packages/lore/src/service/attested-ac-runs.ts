/**
 * Module: attested-ac-runs — the ONE attribution of runner-attested evidence to (spec, criterion).
 *
 * Purpose: both `RuleStateService` (is a cited rule backed by evidence?) and `landing-evidence.ts` (may a change
 *   set land?) ask "what is the latest runner-attested, conclusive run of criterion X of spec S?". This module is
 *   the single answer, so the two can never disagree about which run belongs to which criterion.
 * Public surface: {@link indexLatestAttestedRuns}, {@link isConclusiveAttested}, {@link attestedRunKey},
 *   {@link AttestedRunIndex}, {@link ConclusiveAttestedEntry}.
 * Invariants:
 *   - Pure: no store, IO or clock; takes already-loaded docs.
 *   - Only runner-attested (`attestation` present), conclusive (`pass` | `fail`) rows count; self-reported rows and
 *     `expected-fail` / `inconclusive` rows are ignored. The latest per (spec, criterion) wins (ties: later offer).
 *   - Evidence -> spec: a plan-member task resolves to its plan's parent spec (a lineage that names no known spec
 *     attributes nothing); an ad-hoc task that RECORDED its governing spec (`extra.governing_spec`, BR-1495)
 *     resolves to that spec, so two specs declaring the same criterion id never collide; a task with no plan
 *     lineage and no recorded spec attributes nothing (no lookup by criterion id, BR-1495): its rows are counted
 *     in `ambiguousAcRef`, the "unattributed plan-less rows" count the callers already surface.
 * Side-effect class: pure.
 * Source: rule-state-service.ts (BR-665 attribution rules, moved here unchanged); spec-a-spec-carries-its-rule-
 *   changes-the-baseline-takes-them (D2).
 */

import { extractEvidence, extractGoverningSpecRef, type DocRecord, type EvidenceEntry } from "@lore/core";

/** An attested row whose result is `pass` or `fail`. */
export type ConclusiveAttestedEntry = EvidenceEntry & { result: "pass" | "fail" };

/** The attribution: latest conclusive attested run per (spec, criterion), plus the rows that could not be placed. */
export interface AttestedRunIndex {
  /** Keyed by {@link attestedRunKey}. */
  readonly latest: ReadonlyMap<string, ConclusiveAttestedEntry>;
  /** Same keys as `latest`: the task whose evidence row is that latest run (to name it and its plan). */
  readonly originTasks: ReadonlyMap<string, DocRecord>;
  /** Plan-less rows with no recorded governing spec: counted, attributed to nothing (never guessed by criterion id). */
  readonly ambiguousAcRef: number;
}

/** True for a runner-attested row with a conclusive result. */
export function isConclusiveAttested(entry: EvidenceEntry): entry is ConclusiveAttestedEntry {
  return entry.attestation !== undefined && (entry.result === "pass" || entry.result === "fail");
}

/** Map key of one (spec, criterion) pair. */
export function attestedRunKey(specId: string, acId: string): string {
  return `${specId}\u0000${acId}`;
}

/**
 * @param specs - every spec with its declared criterion ids (`declaredAcIds`), needed for plan-less attribution
 * @param plans - every plan (its `parent_id` is the governing spec)
 * @param tasks - every task carrying `verification_evidence`
 * @example
 * const { latest } = indexLatestAttestedRuns({ specs: [{ id: "s1", acIds: ["AC-1"] }], plans, tasks });
 * latest.get(attestedRunKey("s1", "AC-1"))?.result; // "pass" | "fail" | undefined
 */
export function indexLatestAttestedRuns(input: {
  readonly specs: ReadonlyArray<{ readonly id: string; readonly acIds: readonly string[] }>;
  readonly plans: readonly DocRecord[];
  readonly tasks: readonly DocRecord[];
}): AttestedRunIndex {
  const specIds = new Set(input.specs.map((s) => s.id));
  const plansById = new Map(input.plans.map((p) => [p.id as string, p]));
  const latest = new Map<string, ConclusiveAttestedEntry>();
  const originTasks = new Map<string, DocRecord>();
  let ambiguousAcRef = 0;
  const offer = (specId: string, entry: ConclusiveAttestedEntry, task: DocRecord): void => {
    const key = attestedRunKey(specId, entry.ac_ref as string);
    const current = latest.get(key);
    if (current === undefined || entry.recorded_at >= current.recorded_at) {
      latest.set(key, entry);
      originTasks.set(key, task);
    }
  };
  for (const task of input.tasks) {
    const planId = task.extra["plan_id"];
    const hasLineage = typeof planId === "string";
    const lineageSpecId = hasLineage ? (plansById.get(planId)?.parent_id as string | null | undefined) ?? null : null;
    const recordedSpecId = hasLineage ? undefined : extractGoverningSpecRef(task);
    for (const entry of extractEvidence(task)) {
      if (entry.ac_ref === undefined || !isConclusiveAttested(entry)) continue;
      if (recordedSpecId !== undefined) {
        if (specIds.has(recordedSpecId)) offer(recordedSpecId, entry, task);
        continue;
      }
      if (hasLineage) {
        if (lineageSpecId !== null && specIds.has(lineageSpecId)) offer(lineageSpecId, entry, task);
        continue;
      }
      ambiguousAcRef += 1; // plan-less and no recorded spec: unattributed, never inferred from the id
    }
  }
  return { latest, originTasks, ambiguousAcRef };
}
