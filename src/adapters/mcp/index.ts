/**
 * MCP Server Adapter — entry point for `lore --mcp-server`.
 * Wires McpServer to the application services and starts stdio transport.
 * Source: SPEC-008
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { App } from "../../app.js";
import { registerTools } from "./tools.js";
import { registerResources } from "./resources.js";

/**
 * Start the MCP server in stdio mode.
 * Blocks until the transport closes.
 */
export async function startMcpServer(app: App): Promise<void> {
  const server = new McpServer({
    name: "lore",
    version: "0.1.0",
  });

  registerTools(server, app);
  registerResources(server, app);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
