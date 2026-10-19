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
 *     attributes nothing); a task with no plan lineage resolves a row's `ac_ref` only when exactly ONE spec declares
 *     that criterion id, otherwise the row is counted in `ambiguousAcRef` and attributed to nothing.
 * Side-effect class: pure.
 * Source: rule-state-service.ts (BR-665 attribution rules, moved here unchanged); spec-a-spec-carries-its-rule-
 *   changes-the-baseline-takes-them (D2).
 */

import { extractEvidence, type DocRecord, type EvidenceEntry } from "@lore/core";

/** An attested row whose result is `pass` or `fail`. */
export type ConclusiveAttestedEntry = EvidenceEntry & { result: "pass" | "fail" };

/** The attribution: latest conclusive attested run per (spec, criterion), plus the rows that could not be placed. */
export interface AttestedRunIndex {
  /** Keyed by {@link attestedRunKey}. */
  readonly latest: ReadonlyMap<string, ConclusiveAttestedEntry>;
  /** Same keys as `latest`: the task whose evidence row is that latest run (to name it and its plan). */
  readonly originTasks: ReadonlyMap<string, DocRecord>;
  /** Plan-less rows whose `ac_ref` is declared by more than one spec: counted, attributed to nothing. */
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
  const specsByAcId = new Map<string, string[]>();
  for (const spec of input.specs) {
    for (const acId of spec.acIds) specsByAcId.set(acId, [...(specsByAcId.get(acId) ?? []), spec.id]);
  }
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
    for (const entry of extractEvidence(task)) {
      if (entry.ac_ref === undefined || !isConclusiveAttested(entry)) continue;
      if (hasLineage) {
        if (lineageSpecId !== null && specIds.has(lineageSpecId)) offer(lineageSpecId, entry, task);
        continue;
      }
      const owners = specsByAcId.get(entry.ac_ref) ?? [];
      if (owners.length > 1) ambiguousAcRef += 1;
      else if (owners.length === 1) offer(owners[0] as string, entry, task);
    }
  }
  return { latest, originTasks, ambiguousAcRef };
}
