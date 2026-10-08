/**
 * Module: index-rows — pure derivation of the migration-014 index rows from documents.
 *
 * Purpose: ONE statement (in TypeScript) of what `ac_cites`, `rule_depends` and the registry's
 *   `lifecycle`/`version` MUST contain for a given set of docs. Three consumers share it so they
 *   can never disagree: `InMemoryStore` (serves the indexes as a computed view), the TS-side
 *   registry writers of SQLite/Turso (`allocateRuleAndUpdateLeaf` / `moveRule`), and
 *   `computeBaselineStatus` (compares these derived rows with the stored index tables to report
 *   `index_mismatch`). The SQL in `migrations/migration-014.ts` (backfill + `docs_idx_*` triggers)
 *   is the same derivation expressed for the database; a divergence is exactly what the
 *   `index_mismatch` count exists to expose.
 *
 * Public surface: {@link deriveAcCites}, {@link deriveRuleDepends}, {@link listedRuleLifecycle},
 *   {@link isRuleLifecycle}.
 * Invariants:
 *   - Only live (`deleted_at == null`) docs of type `spec` (cites) / `baseline` (depends) contribute.
 *   - Malformed shapes (non-array, non-object element, non-string id) are skipped, never thrown on
 *     — the same tolerance the SQL triggers have (a throw there would block every doc write).
 *   - Output is de-duplicated and sorted, so two derivations compare with plain equality.
 * Side-effect class: pure.
 *
 * Source: spec-baseline-slice-2-completeness-census-per-branch-citation §C5.
 */

import { RULE_LIFECYCLES, type DocRecord, type RuleLifecycle } from "@lore/core";
import type { AcCiteRow, RuleDependsRow } from "./store-interface.js";

/** True when `value` is one of the three rule lifecycles. */
export function isRuleLifecycle(value: unknown): value is RuleLifecycle {
  return typeof value === "string" && (RULE_LIFECYCLES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The lifecycle `extra.rules` lists for `ruleId`, or `undefined` when the rule is absent or lists
 * no valid lifecycle. Callers choose their own fallback (the store writers use `"live"`, the
 * status check treats `undefined` as "nothing to compare").
 *
 * @example
 * listedRuleLifecycle({ rules: [{ id: "BR-1", lifecycle: "retired" }] }, "BR-1"); // "retired"
 */
export function listedRuleLifecycle(extra: Record<string, unknown>, ruleId: string): RuleLifecycle | undefined {
  const rules = extra["rules"];
  if (!Array.isArray(rules)) return undefined;
  for (const rule of rules as unknown[]) {
    if (isRecord(rule) && rule["id"] === ruleId && isRuleLifecycle(rule["lifecycle"])) return rule["lifecycle"];
  }
  return undefined;
}

/** Sorted, de-duplicated rows — the canonical comparison form. */
function canonicalRows<T>(rows: T[], keyOf: (row: T) => string[]): T[] {
  const byKey = new Map<string, T>();
  for (const row of rows) byKey.set(keyOf(row).join("\u0000"), row);
  return [...byKey.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, row]) => row);
}

/** `ac_cites` rows the live specs among `docs` must have: one per (spec, criterion id, cited rule id). */
export function deriveAcCites(docs: readonly DocRecord[]): AcCiteRow[] {
  const rows: AcCiteRow[] = [];
  for (const doc of docs) {
    if (doc.type !== "spec" || (doc.deleted_at ?? null) !== null) continue;
    const criteria = doc.extra["acceptance_criteria"];
    if (!Array.isArray(criteria)) continue;
    for (const criterion of criteria as unknown[]) {
      if (!isRecord(criterion) || typeof criterion["id"] !== "string" || !Array.isArray(criterion["cites"])) continue;
      for (const cited of criterion["cites"] as unknown[]) {
        if (typeof cited === "string") rows.push({ doc_id: doc.id, ac_id: criterion["id"], rule_id: cited });
      }
    }
  }
  return canonicalRows(rows, (r) => [r.doc_id, r.ac_id, r.rule_id]);
}

/** `rule_depends` rows the live baseline docs among `docs` must have (their `extra.depends_on`). */
export function deriveRuleDepends(docs: readonly DocRecord[]): RuleDependsRow[] {
  const rows: RuleDependsRow[] = [];
  for (const doc of docs) {
    if (doc.type !== "baseline" || (doc.deleted_at ?? null) !== null) continue;
    const depends = doc.extra["depends_on"];
    if (!Array.isArray(depends)) continue;
    for (const ruleId of depends as unknown[]) {
      if (typeof ruleId === "string") rows.push({ leaf_id: doc.id, rule_id: ruleId });
    }
  }
  return canonicalRows(rows, (r) => [r.leaf_id, r.rule_id]);
}

/** Canonical form of stored rows, for comparison with the derived ones. */
export function canonicalAcCites(rows: AcCiteRow[]): AcCiteRow[] {
  return canonicalRows(rows, (r) => [r.doc_id, r.ac_id, r.rule_id]);
}

/** Canonical form of stored rows, for comparison with the derived ones. */
export function canonicalRuleDepends(rows: RuleDependsRow[]): RuleDependsRow[] {
  return canonicalRows(rows, (r) => [r.leaf_id, r.rule_id]);
}
