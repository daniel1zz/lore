/**
 * Module: working-state — the single list of machine-written ("working state")
 * `extra` keys per DocType, the content-vs-working-state classifier, and the
 * audit `state_change` delta builder.
 *
 * Purpose: a write that changes only working state keeps `docs.version` moving
 * but adds no `versions` snapshot; its delta is recorded in the audit row.
 * Public surface: `WORKING_STATE_KEYS`, `isContentChange`, `buildStateChange`,
 * `StateChange`, `ContentComparableRow`.
 * Invariants: IMPORTS NOTHING but types (the @lore/core barrel must stay
 * browser-safe); pure and total (no IO, no clock, never throws); a key absent
 * from the list is CONTENT (an incomplete list costs a snapshot, never lost
 * history).
 * Side-effect class: pure.
 * Spec: spec-history-records-content-a-working-state-only-write-adds-no
 * (Scope 1-3); ADR adr-a-history-entry-records-content-working-state-is-recorded D1-D3.
 */

import type { DocType } from "./types.js";

/**
 * Working-state `extra` keys per DocType. `Record<DocType, ...>` makes a new
 * DocType fail compilation until it is classified here.
 *
 * reason: task/phase `file_anchors`, task/plan `issues` and spec
 * `allow_missing_path_declarations` are deliberately ABSENT — they are content
 * judged in review (spec Scope 1).
 */
export const WORKING_STATE_KEYS: Record<DocType, readonly string[]> = {
  task: ["claim", "verification_evidence", "red_first", "landing", "landing_history", "commit_range", "assignee", "milestone_findings"],
  phase: ["claim", "verification_evidence", "checklist", "track", "migrated_from", "migrated_to"],
  plan: ["progress", "known_defects", "integration_branch"],
  spec: ["code_anchors"],
  knowledge: ["code_anchors"],
  prd: ["outline_budget"],
  adr: [],
  baseline: [],
  template: [],
};

/** Structural view of a `docs` row: any column plus `extra`. */
export interface ContentComparableRow {
  readonly extra: Readonly<Record<string, unknown>>;
  readonly [column: string]: unknown;
}

/** Audit `details.state_change` payload (spec Scope 3). */
export interface StateChange {
  /** Changed working-state keys, in key-list order. */
  readonly keys: readonly string[];
  /** New value of each key that was replaced or newly set. */
  readonly values: Readonly<Record<string, unknown>>;
  /** Old value of each key that was replaced or deleted (absent when the key is new). */
  readonly previous: Readonly<Record<string, unknown>>;
  /** Only the added entries of each key whose old array is a prefix of its new array. */
  readonly appended: Readonly<Record<string, readonly unknown[]>>;
  /** Names of keys that were deleted. */
  readonly removed: readonly string[];
}

/** Columns that never make a write a content write. */
function isIgnoredColumn(column: string): boolean {
  return column === "version" || column === "updated_at" || column === "extra" || column.startsWith("fts_");
}

/**
 * Deep equality; object key order ignored, array order significant. A key
 * holding `undefined` equals an absent key (JSON storage drops it).
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return Number.isNaN(a) && Number.isNaN(b);
  }
  const aIsArray = Array.isArray(a);
  if (aIsArray !== Array.isArray(b)) return false;
  if (aIsArray) {
    const left = a as unknown[];
    const right = b as unknown[];
    return left.length === right.length && left.every((item, index) => deepEqual(item, right[index]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (!deepEqual(left[key], right[key])) return false;
  }
  return true;
}

/**
 * True iff a write from `before` to `after` changes content: any `docs` column
 * other than `version`, `updated_at` and `fts_*` differs, or `extra` minus the
 * type's working-state keys is not deep-equal. Unknown extra keys are content.
 *
 * @param type - DocType of the row (selects the working-state key list)
 * @param before - the stored row
 * @param after - the row about to be written
 */
export function isContentChange(type: DocType, before: ContentComparableRow, after: ContentComparableRow): boolean {
  const columns = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const column of columns) {
    if (isIgnoredColumn(column)) continue;
    if (!deepEqual(before[column], after[column])) return true;
  }
  const workingState = new Set(WORKING_STATE_KEYS[type]);
  const extraKeys = new Set([...Object.keys(before.extra), ...Object.keys(after.extra)]);
  for (const key of extraKeys) {
    if (workingState.has(key)) continue;
    if (!deepEqual(before.extra[key], after.extra[key])) return true;
  }
  return false;
}

function isArrayPrefix(prefix: readonly unknown[], whole: readonly unknown[]): boolean {
  return prefix.length < whole.length && prefix.every((item, index) => deepEqual(item, whole[index]));
}

/**
 * Builds the audit `state_change` delta between two `extra` objects, looking
 * only at the type's working-state keys. Nothing changed yields `keys: []`.
 *
 * @param type - DocType of the row
 * @param beforeExtra - stored `extra`
 * @param afterExtra - new `extra`
 */
export function buildStateChange(
  type: DocType,
  beforeExtra: Readonly<Record<string, unknown>>,
  afterExtra: Readonly<Record<string, unknown>>,
): StateChange {
  const keys: string[] = [];
  const values: Record<string, unknown> = {};
  const previous: Record<string, unknown> = {};
  const appended: Record<string, readonly unknown[]> = {};
  const removed: string[] = [];
  for (const key of WORKING_STATE_KEYS[type]) {
    const hadBefore = beforeExtra[key] !== undefined;
    const hasAfter = afterExtra[key] !== undefined;
    const oldValue = beforeExtra[key];
    const newValue = afterExtra[key];
    if (!hadBefore && !hasAfter) continue;
    if (hadBefore && hasAfter && deepEqual(oldValue, newValue)) continue;
    keys.push(key);
    if (!hasAfter) {
      removed.push(key);
      previous[key] = oldValue;
    } else if (hadBefore && Array.isArray(oldValue) && Array.isArray(newValue) && isArrayPrefix(oldValue, newValue)) {
      appended[key] = newValue.slice(oldValue.length);
    } else {
      values[key] = newValue;
      if (hadBefore) previous[key] = oldValue;
    }
  }
  return { keys, values, previous, appended, removed };
}
