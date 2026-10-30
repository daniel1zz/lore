/**
 * Module: dedicated-extra-keys — the guard table of `extra` keys that may only be
 * written through a dedicated verb, never by a wholesale `lore set`.
 *
 * Public surface: {@link DEDICATED_EXTRA_KEYS}, {@link DedicatedExtraKey}.
 * Invariants: every registered key carries a non-empty `writer` hint naming the verb
 *   the refusal message should point the caller to.
 * Side-effect class: pure (constant data).
 *
 * Source: baseline slice 1 spec §C3 (service-layer guard consumes this table).
 */

import { EXECUTION_LOG_WRITER_TEXT } from "./execution-log.js";
import type { DocStatus, DocType } from "./types.js";

/** One guarded `extra` key and the verb(s) that legitimately write it. */
export interface DedicatedExtraKey {
  readonly key: string;
  /** Human-readable writer verb(s), quoted verbatim in the service-layer refusal. */
  readonly writer: string;
  /**
   * When set, the key is guarded only on docs whose `extra.sub_type` equals this value
   * (a knowledge doc's `uat` key is the verdict; other sub_types may use `uat` freely).
   */
  readonly subType?: string;
  /**
   * When set, `key` is a field INSIDE the object stored under `extra[within]` (a review's `traced_decisions` lives in
   * `extra.milestone_review`), and only that field is guarded: the rest of the object stays writable.
   */
  readonly within?: string;
  /**
   * When set, the key is NOT guarded while the doc's status equals this value (a task's `kind` may change on a draft,
   * and only there).
   */
  readonly unlessStatus?: DocStatus;
  /** Stable refusal name printed first in the refusal message (e.g. `kind-locked`); absent = the generic message. */
  readonly refusal?: string;
}

/**
 * Per-DocType extra keys a wholesale write must not touch. Absent DocType = no guard.
 *
 * @example
 * DEDICATED_EXTRA_KEYS.baseline?.find((e) => e.key === "rules")?.writer; // "lore rule add|set"
 */
export const DEDICATED_EXTRA_KEYS: Partial<Record<DocType, readonly DedicatedExtraKey[]>> = {
  baseline: [
    { key: "node", writer: "lore baseline add" },
    { key: "label", writer: "lore baseline set-label" },
    { key: "rules", writer: "lore rule add|set" },
    { key: "depends_on", writer: "lore baseline depends" },
    { key: "glossary", writer: "lore baseline glossary" },
    { key: "commands", writer: "lore baseline map --command" },
    { key: "pending", writer: "lore rule add|set, lore baseline set-label|depends|glossary|map --command" },
  ],
  spec: [{ key: "rule_changes", writer: "lore rule propose" }],
  // reason: AC-DCS1-4 (D28) — the kind is set at create and changed only by `lore set <task> --kind` while the task is a
  // draft; the contract is compiled by `lore approve` alone. `lore set` replaces `extra` wholesale, so both keys need the guard.
  task: [
    { key: "done_contract", writer: "lore approve", refusal: "done-contract-locked" },
    { key: "kind", writer: "lore set <task> --kind (a draft task only)", unlessStatus: "draft", refusal: "kind-locked" },
    // reason: AC-DCS2-14 (D28) — the execution log is appended by lore at the event it records and never edited by hand.
    { key: "execution_log", writer: EXECUTION_LOG_WRITER_TEXT, refusal: "execution-log-locked" },
  ],
  // reason: AC-DCS2-14 — a plan's log takes the evidence-moved entries of the drift check; the same writers-only guard applies.
  plan: [{ key: "execution_log", writer: EXECUTION_LOG_WRITER_TEXT, refusal: "execution-log-locked" }],
  // reason: DC2-8 — a recorded UAT verdict is writer-owned evidence; `lore set` replaces `extra`
  // wholesale, so without this entry a `lore_set` could flip `extra.uat.verdict` on every route.
  knowledge: [
    { key: "uat", writer: "lore uat record", subType: "uat" },
    // reason: BR-1482 — a weight table is the scale every scored decision is weighed on; only `lore weights set` writes it
    // (it checks the sum, the one-table-per-kind rule and, for an approved table, the decision citing a drill-down).
    { key: "weight_table", writer: "lore weights set", subType: "reference" },
    // reason: BR-1481 — an outcome link is evidence of an escaped defect; only `lore decision trace` appends one (idempotent,
    // compare-and-swap), and the re-check findings are the milestone assess's own measurement, never hand-written.
    { key: "traced_decisions", writer: "lore decision trace", subType: "milestone-review", within: "milestone_review" },
    { key: "decision_findings", writer: "lore assess", subType: "milestone-review", within: "milestone_review" },
  ],
};
