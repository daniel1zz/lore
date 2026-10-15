/**
 * LORE_MCP_TOOL_NAMES — the single list of every `lore_*` tool the MCP adapter registers.
 *
 * Purpose: one source for the MCP tool set, so the registered variable `mcp_tool_count`
 * (and the shipped lore skill that states it) never relies on a hand-typed number (issue #209).
 * Public surface: `LORE_MCP_TOOL_NAMES`, `LoreMcpToolName`, `McpToolRegistryDriftError`,
 * `assertRegisteredToolsMatchNames`. Invariants: names are unique; `tools.ts` registers a tool
 * only under a name in this list (compile-time via `LoreMcpToolName`) and asserts at the end of
 * registration that the registered set equals this list (runtime, fail loud).
 * Side effects: pure leaf — no bun:sqlite, no server import.
 *
 * @spec_ref spec-lore-owned-agent-context-is-generated-from-templates-and (D8, D9)
 */

export const LORE_MCP_TOOL_NAMES = [
  "lore_anchor_set",
  "lore_approve",
  "lore_assess",
  "lore_audit",
  "lore_baseline_add",
  "lore_baseline_depends",
  "lore_baseline_glossary_add",
  "lore_baseline_glossary_rm",
  "lore_baseline_set_label",
  "lore_batch",
  "lore_bootstrap",
  "lore_claim",
  "lore_context_bundle",
  "lore_create",
  "lore_delete",
  "lore_diff",
  "lore_evidence_add",
  "lore_feed",
  "lore_get",
  "lore_handoff",
  "lore_invalidate",
  "lore_link",
  "lore_list",
  "lore_log",
  "lore_pending",
  "lore_phase_status",
  "lore_ready",
  "lore_release",
  "lore_reopen",
  "lore_report_issue",
  "lore_requirement_add",
  "lore_review",
  "lore_rule_add",
  "lore_rule_find",
  "lore_rule_impact",
  "lore_rule_set",
  "lore_rule_show",
  "lore_schema",
  "lore_search",
  "lore_set",
  "lore_staleness_probe",
  "lore_status",
  "lore_tree",
  "lore_uat_record",
  "lore_verify",
] as const;

export type LoreMcpToolName = (typeof LORE_MCP_TOOL_NAMES)[number];

/** Thrown when the tools registered on a server differ from {@link LORE_MCP_TOOL_NAMES}. */
export class McpToolRegistryDriftError extends Error {
  readonly context: { readonly missing: readonly string[]; readonly unlisted: readonly string[] };

  constructor(missing: readonly string[], unlisted: readonly string[]) {
    super(
      `MCP tool registry drift: listed but not registered [${missing.join(", ")}]; registered but not listed [${unlisted.join(", ")}]`,
    );
    this.name = "McpToolRegistryDriftError";
    this.context = { missing, unlisted };
  }
}

/**
 * Assert the registered tool names equal {@link LORE_MCP_TOOL_NAMES} exactly.
 *
 * @param registered - names actually registered on the server.
 * @throws McpToolRegistryDriftError when the sets differ.
 */
export function assertRegisteredToolsMatchNames(registered: ReadonlySet<string>): void {
  const listed = new Set<string>(LORE_MCP_TOOL_NAMES);
  const missing = LORE_MCP_TOOL_NAMES.filter((n) => !registered.has(n));
  const unlisted = [...registered].filter((n) => !listed.has(n));
  if (missing.length > 0 || unlisted.length > 0) throw new McpToolRegistryDriftError(missing, unlisted);
}
