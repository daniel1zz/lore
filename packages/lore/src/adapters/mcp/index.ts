/**
 * MCP Server Adapter — entry point for `lore --mcp-server`.
 * Wires McpServer to the application services and starts stdio transport.
 * Source: SPEC-008
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { App } from "../../app.js";
import type { LoreConfig } from "@lore/core";
import { registerTools } from "./tools.js";
import { registerResources } from "./resources.js";

/**
 * Start the MCP server in stdio mode.
 * Blocks until the transport closes.
 *
 * @param app - The wired composition root.
 * @param getConfig - SPEC-070 F6 (staleness fix): a config GETTER, invoked once
 *   PER `lore_feed` "task-start" call rather than a snapshot closed over at
 *   server start — an MCP server is long-lived, so a `LoreConfig` value captured
 *   once at `startMcpServer` time would never observe a `.lore/config.yaml` edit
 *   made after the server started (the CLI never has this problem — each
 *   invocation is a fresh process). Forwarded straight through to
 *   `registerTools`, which calls it inside the "task-start" branch itself
 *   (`resolveTaskStartBudgets(getConfig?.())`). Additive/optional — an omitted
 *   `getConfig` preserves the pre-fix `DEFAULT_TASK_START_BUDGETS` fallback
 *   (REGRESSION-safe).
 */
export async function startMcpServer(app: App, getConfig?: () => LoreConfig | undefined): Promise<void> {
  // reason: SPEC-024 §9.2 — MCP surface MUST use in-process flag, not env var.
  // The timing problem: if we tried to read a LORE_SURFACE env var, the MCP adapter
  // and the tool handlers share one process, so there is no reliable moment to set
  // the env var before the handlers read it. Setting the in-process flag here (before
  // registerTools) guarantees all tool handlers see callerSurface="mcp" at call time.
  app.callerSurface = "mcp";

  const server = new McpServer({
    name: "lore",
    version: "0.1.0",
  });

  registerTools(server, app, getConfig);
  registerResources(server, app);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
