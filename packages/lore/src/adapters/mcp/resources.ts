/**
 * MCP resource registrations — lore://docs/{docId} and lore://schema.
 * Source: SPEC-008 §4
 */

import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { App } from "../../app.js";
import { CORPUS_SCHEMA_INFO } from "./schema-info.js";

export function registerResources(server: McpServer, app: App): void {
  const { corpusService } = app;

  // Dynamic resource: lore://docs/{docId}
  server.registerResource(
    "document",
    new ResourceTemplate("lore://docs/{docId}", {
      list: async () => {
        const result = await corpusService.list({});
        if (!result.ok) return { resources: [] };

        return {
          resources: result.value.docs.map((doc) => ({
            uri: `lore://docs/${doc.id}`,
            name: doc.title,
            description: `${doc.type} — ${doc.status}`,
            mimeType: "application/json",
          })),
        };
      },
    }),
    {
      title: "Lore Document",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const docId = variables["docId"];
      if (typeof docId !== "string") {
        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: "application/json",
              text: JSON.stringify({ error: "docId is required" }),
            },
          ],
        };
      }

      const result = await corpusService.get(docId);
      if (!result.ok) {
        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: "application/json",
              text: JSON.stringify({ error: result.error }),
            },
          ],
        };
      }

      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: "application/json",
            text: JSON.stringify(result.value, null, 2),
          },
        ],
      };
    },
  );

  // Static resource: lore://schema
  server.registerResource(
    "schema",
    "lore://schema",
    {
      title: "Corpus Schema",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.toString(),
          mimeType: "application/json",
          text: JSON.stringify(CORPUS_SCHEMA_INFO, null, 2),
        },
      ],
    }),
  );
}
