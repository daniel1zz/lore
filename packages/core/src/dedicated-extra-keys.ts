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
  ],
};
