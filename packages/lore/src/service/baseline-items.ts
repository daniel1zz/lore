/**
 * Module: baseline-items — the ONE accessor for a baseline node's APPROVED items, and the view of its pending ones.
 *
 * Purpose: BR-1340. A baseline node's items (each business rule, plus the node's own part: title, body, label,
 *   glossary, depends_on, commands) each have an approved version and at most one pending revision. `extra.rules`,
 *   `extra.label`, `extra.glossary`, `extra.depends_on` and `extra.commands` HOLD THE APPROVED VERSIONS; what is
 *   proposed lives in `extra.pending` (`baselinePendingSchema`). Every reader that decides something (coverage,
 *   citations, rule state, governing feeds, resume diffs, fidelity sampling, dependency and removal checks,
 *   exports) reads through this module, so a pending revision or a pending add never governs.
 *
 * Public surface: {@link approvedRulesOf}, {@link approvedRuleIdsOf}, {@link approvedLabelOf},
 *   {@link approvedGlossaryOf}, {@link approvedDependsOnOf}, {@link approvedCommandsOf},
 *   {@link pendingRevisionsOf}, {@link BaselineItemSource}, {@link PendingBaselineRevisions}.
 * Invariants:
 *   - Pure and total: a missing or malformed field reads as empty / `undefined`, never throws (the SQL triggers that
 *     keep `rule_registry` and `rule_depends` in step have the same tolerance).
 *   - Rule entries are returned as stored and unvalidated (`unknown`); each caller keeps its own per-field checks.
 *   - ⛔ Outside this module and the write path (`rule-service`, `rule-change-service`, `corpus-service`, the store's
 *     index derivation) nothing reads these keys of a baseline `extra` directly; `baseline-effective-reads.test.ts`
 *     scans for it (AC-BIA-6).
 * Side-effect class: pure.
 *
 * Source: spec-baseline-approval-is-per-item-an-edit-adds-a-pending (BR-1340).
 */

import { baselinePendingSchema, type PendingNodeRevision, type PendingRuleRevision } from "@lore/core";

/** Anything carrying a baseline doc's `extra`. */
export interface BaselineItemSource {
  readonly extra: Readonly<Record<string, unknown>>;
}

function arrayField(source: BaselineItemSource, key: string): readonly unknown[] {
  const raw = source.extra[key];
  return Array.isArray(raw) ? raw : [];
}

/** The approved version of every rule the node lists, in stored order (entries unvalidated). */
export function approvedRulesOf(source: BaselineItemSource): readonly unknown[] {
  return arrayField(source, "rules");
}

/** Ids of the approved rules (non-object entries and entries without a string id are skipped). */
export function approvedRuleIdsOf(source: BaselineItemSource): string[] {
  const ids: string[] = [];
  for (const rule of approvedRulesOf(source)) {
    if (typeof rule !== "object" || rule === null) continue;
    const id = (rule as { id?: unknown }).id;
    if (typeof id === "string") ids.push(id);
  }
  return ids;
}

/** The approved display label, or `undefined` when none is approved. */
export function approvedLabelOf(source: BaselineItemSource): string | undefined {
  const raw = source.extra["label"];
  return typeof raw === "string" ? raw : undefined;
}

/** The approved glossary entries (unvalidated). */
export function approvedGlossaryOf(source: BaselineItemSource): readonly unknown[] {
  return arrayField(source, "glossary");
}

/** The approved `depends_on` rule ids (string entries only). */
export function approvedDependsOnOf(source: BaselineItemSource): string[] {
  return arrayField(source, "depends_on").filter((entry): entry is string => typeof entry === "string");
}

/** The approved CLI command names the leaf answers for (string entries only). */
export function approvedCommandsOf(source: BaselineItemSource): string[] {
  return arrayField(source, "commands").filter((entry): entry is string => typeof entry === "string");
}

/** Pending revisions of a node: per rule id, plus at most one for the node's own part. */
export interface PendingBaselineRevisions {
  readonly rules: Readonly<Record<string, PendingRuleRevision>>;
  readonly node: PendingNodeRevision | undefined;
}

/**
 * The node's pending revisions. A malformed `extra.pending` reads as none: the write path validates it with
 * `baselineExtraSchema`, so a corrupt value cannot arrive through a verb.
 */
export function pendingRevisionsOf(source: BaselineItemSource): PendingBaselineRevisions {
  const parsed = baselinePendingSchema.safeParse(source.extra["pending"]);
  if (!parsed.success) return { rules: {}, node: undefined };
  return { rules: parsed.data.rules ?? {}, node: parsed.data.node };
}
