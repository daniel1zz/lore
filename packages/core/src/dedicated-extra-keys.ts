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

import type { DocType } from "./types.js";

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
    { key: "site_map", writer: "lore baseline map" },
    { key: "commands", writer: "lore baseline map --command" },
    { key: "pending", writer: "lore rule add|set, lore baseline set-label|depends|glossary|map --command" },
  ],
  spec: [{ key: "rule_changes", writer: "lore rule propose" }],
  // reason: DC2-8 — a recorded UAT verdict is writer-owned evidence; `lore set` replaces `extra`
  // wholesale, so without this entry a `lore_set` could flip `extra.uat.verdict` on every route.
  knowledge: [{ key: "uat", writer: "lore uat record", subType: "uat" }],
};
