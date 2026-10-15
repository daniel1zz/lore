/**
 * LORE_CONTEXT_VARIABLES — the registry instance for the `{{lore:<name>}}` expander.
 *
 * Purpose: the single list of facts lore lets its own context text reference.
 * Public surface: `LORE_CONTEXT_VARIABLES`. Invariants: passes `validateRegistry`;
 * every `code` entry is fixed by the lore version, never by settings; the one `invocation`
 * entry (`claude_dir`) is supplied by `lore setup` and allowed at `setup:settings-hook` only.
 * Side effects: pure.
 *
 * @spec_ref spec-lore-owned-agent-context-is-generated-from-templates-and (D1, D5, D7)
 */

import { CAPTURE_TAIL_CHARS, LORE_AGENT_NAMES, OUTLET_IDS, type ContextVariable, type VariableOutlet } from "@lore/core";

import { LORE_MCP_TOOL_NAMES } from "../adapters/mcp/tool-names.js";

const ALL_OUTLETS: readonly VariableOutlet[] = [...OUTLET_IDS, "asset:install", "setup:settings-hook"];

export const LORE_CONTEXT_VARIABLES: readonly ContextVariable[] = [
  {
    name: "capture_tail_chars",
    source: "code",
    outlets: ALL_OUTLETS,
    describe: "Persisted evidence output_tail ceiling, in characters.",
    value: () => String(CAPTURE_TAIL_CHARS),
    // AC-CV-6: spellings that restate the ceiling by hand in lore-owned prose/code.
    literalPatterns: [/\b4000[- ]char/, /\bmax\(4000\)/, /\btailChars\([^)]*,\s*4000\)/, /=\s*4000;/],
  },
  {
    name: "mcp_tool_count",
    source: "code",
    outlets: ALL_OUTLETS,
    describe: "Number of `lore_*` tools the MCP adapter registers (length of LORE_MCP_TOOL_NAMES).",
    value: () => String(LORE_MCP_TOOL_NAMES.length),
    // AC-CV-8: spellings that restate the tool count by hand ("23 `lore_*` tools").
    literalPatterns: [/\b\d+ `?lore_\*`? tools/],
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
  {
    name: "claude_dir",
    source: "invocation",
    outlets: ["setup:settings-hook"],
    describe: "Absolute Claude Code config directory a settings-hook command points into (supplied by setup).",
  },
];
