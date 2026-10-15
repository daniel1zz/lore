/**
 * LORE_CONTEXT_VARIABLES — the registry instance for the `{{lore:<name>}}` expander.
 *
 * Purpose: the single list of facts lore lets its own context text reference.
 * Public surface: `LORE_CONTEXT_VARIABLES`. Invariants: passes `validateRegistry`;
 * every entry here is a `code` variable (fixed by the lore version, never by settings).
 * Side effects: pure.
 *
 * @spec_ref spec-lore-owned-agent-context-is-generated-from-templates-and (D1, D5)
 */

import { CAPTURE_TAIL_CHARS, LORE_AGENT_NAMES, OUTLET_IDS, type ContextVariable, type VariableOutlet } from "@lore/core";

const ALL_OUTLETS: readonly VariableOutlet[] = [...OUTLET_IDS, "asset:install", "setup:settings-hook"];

export const LORE_CONTEXT_VARIABLES: readonly ContextVariable[] = [
  {
    name: "capture_tail_chars",
    source: "code",
    outlets: ALL_OUTLETS,
    describe: "Persisted evidence output_tail ceiling, in characters.",
    value: () => String(CAPTURE_TAIL_CHARS),
  },
  {
    name: "implementer_agent",
    source: "code",
    outlets: ALL_OUTLETS,
    describe: "Installed name of the lore implementer agent.",
    value: () => LORE_AGENT_NAMES.implementer,
  },
  {
    name: "reader_agent",
    source: "code",
    outlets: ALL_OUTLETS,
    describe: "Installed name of the lore reader agent.",
    value: () => LORE_AGENT_NAMES.reader,
  },
];
