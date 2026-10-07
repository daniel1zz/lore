/**
 * baseline-rule-ids — pure helpers over the rule ids a baseline tree carries versus the
 * rule registry that allocates them.
 *
 * Purpose: one place that answers "which rule ids exist?" and "which ids sit on a leaf
 *   without a registry row?" for `RuleService.setDependsOn`, the `CorpusService.create`
 *   guard and C7's `--check-baseline`.
 * Public surface: {@link collectKnownRuleIds}, {@link findUnregisteredRuleIds},
 *   {@link UnregisteredRule}.
 * Invariants: pure (no IO); store-less shared infrastructure, so both `CorpusService` and
 *   `RuleService` may import it without a cross-service edge.
 * Side-effect class: pure.
 * Source: spec-baseline-slice-1-rules-with-permanent-ids-ac-citations §C2/§C3 (AC-BLS1-1).
 */

import type { DocRecord } from "@lore/core";
import type { RuleRegistryRow } from "../store/store-interface.js";

/** A rule id carried by a leaf that the registry never allocated. */
export interface UnregisteredRule {
  readonly ruleId: string;
  readonly leafId: string;
}

/** Rule ids stored on a baseline doc's `extra.rules` (ids only; shape is validated elsewhere). */
function ruleIdsOf(doc: DocRecord): string[] {
  const raw = doc.extra["rules"];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => (typeof r === "object" && r !== null && typeof (r as { id?: unknown }).id === "string" ? [(r as { id: string }).id] : []));
}

/** Every rule id that exists anywhere: allocated in the registry OR carried by a leaf. */
export function collectKnownRuleIds(leaves: readonly DocRecord[], registry: readonly RuleRegistryRow[]): Set<string> {
  return new Set([...registry.map((row) => row.id), ...leaves.flatMap(ruleIdsOf)]);
}

/**
 * Rule ids found on a leaf with no registry row — the integrity breach AC-BLS1-1 forbids
 * (an id the allocator never issued can collide with a later allocation). Loud by design:
 * callers report every entry, they never filter. Order: input leaf order, then rule order.
 *
 * @example
 * findUnregisteredRuleIds(leaves, await store.listRuleRegistry()); // [{ ruleId: "BR-2", leafId }]
 */
export function findUnregisteredRuleIds(
  leaves: readonly DocRecord[],
  registry: readonly RuleRegistryRow[],
): UnregisteredRule[] {
  const registered = new Set(registry.map((row) => row.id));
  return leaves.flatMap((leaf) =>
    ruleIdsOf(leaf).filter((ruleId) => !registered.has(ruleId)).map((ruleId) => ({ ruleId, leafId: leaf.id })),
  );
}
