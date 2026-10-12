/**
 * Module: rule-changes — pure reads of a spec's rule change set (`extra.rule_changes`).
 *
 * Purpose: ONE place that answers "what does this spec propose / modify / retire?" and "which other spec already
 *   changes this rule?", shared by the citation gate (`ac-write-chokepoint.ts`), `RuleChangeService`,
 *   `RuleReadService` and the review judge input, so no service imports another.
 * Public surface: {@link ruleChangesOf}, {@link ownProposedRules}, {@link unlandedRuleChanges}, {@link isLanded},
 *   {@link findProposal}, {@link findOtherSpecChange}, {@link SpecRuleChange}.
 * Invariants:
 *   - Pure: no store, IO or clock. Every function takes already-loaded spec docs.
 *   - Lenient on READ: an entry that fails `ruleChangeSchema` is skipped (a corrupt row must not hide the valid
 *     ones, nor throw inside a gate); the dedicated writer validates strictly on WRITE.
 *   - A spec with status `deprecated` has abandoned its change set: its entries never block another spec and are
 *     not offered as a proposal. An entry carrying `applied_at` has LANDED (`lore rule apply`): it is history, not
 *     a pending claim, so it neither blocks another spec nor counts as a proposal (the tree now holds the rule).
 * Side-effect class: pure.
 * Source: spec-a-spec-carries-its-rule-changes-the-baseline-takes-them (Model, Edge cases).
 */

import { ruleChangeSchema, type DocRecord, type RuleChange } from "@lore/core";

/** One change set entry with the spec that owns it. */
export interface SpecRuleChange {
  readonly spec: DocRecord;
  readonly change: RuleChange;
}

/** The valid entries of `extra.rule_changes`, in stored order. `[]` when absent or not an array. */
export function ruleChangesOf(extra: Readonly<Record<string, unknown>>): RuleChange[] {
  const raw = extra["rule_changes"];
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[]).flatMap((entry) => {
    const parsed = ruleChangeSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

/** The `add` entries of a spec's change set: the ids it proposes, with the leaf slug each will land on. */
export function ownProposedRules(extra: Readonly<Record<string, unknown>>): Array<Extract<RuleChange, { op: "add" }>> {
  return ruleChangesOf(extra).flatMap((change) => (change.op === "add" ? [change] : []));
}

/** True once `lore rule apply` has written the entry into the tree. */
export function isLanded(change: RuleChange): boolean {
  return change.applied_at !== undefined;
}

/** The entries of a spec's change set that have not landed yet, in stored order. */
export function unlandedRuleChanges(extra: Readonly<Record<string, unknown>>): RuleChange[] {
  return ruleChangesOf(extra).filter((change) => !isLanded(change));
}

function isAbandoned(spec: DocRecord): boolean {
  return (spec.deleted_at ?? null) !== null || spec.status === "deprecated";
}

/**
 * The spec that proposes `ruleId` (an `add` entry), or `undefined`. First spec wins, in the order given.
 *
 * @example
 * findProposal("BR-2", specs); // { spec, change: { op: "add", id: "BR-2", ... } }
 */
export function findProposal(ruleId: string, specs: readonly DocRecord[]): SpecRuleChange | undefined {
  for (const spec of specs) {
    if (isAbandoned(spec)) continue;
    const change = ownProposedRules(spec.extra).find((c) => c.id === ruleId && !isLanded(c));
    if (change !== undefined) return { spec, change };
  }
  return undefined;
}

/**
 * Another spec's unlanded `modify` / `retire` of the live rule `ruleId`, or `undefined`. `exceptSpecId` is the
 * proposing spec itself: re-proposing its own change never conflicts with itself.
 */
export function findOtherSpecChange(
  ruleId: string,
  specs: readonly DocRecord[],
  exceptSpecId: string,
): SpecRuleChange | undefined {
  for (const spec of specs) {
    if ((spec.id as string) === exceptSpecId || isAbandoned(spec)) continue;
    const change = ruleChangesOf(spec.extra).find((c) => c.id === ruleId && c.op !== "add" && !isLanded(c));
    if (change !== undefined) return { spec, change };
  }
  return undefined;
}
