/**
 * lore search <query> — full-text search with FTS5.
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, formatTable } from "../utils.js";
import type { DocType } from "@lore/core";

export default defineCommand({
  meta: {
    name: "search",
    description: "Full-text search across documents",
  },
  args: {
    query: {
      type: "positional",
      description: "Search query",
      required: true,
    },
    type: {
      type: "string",
      description: "Filter by type",
    },
    limit: {
      type: "string",
      description: "Max results (default: 10)",
      default: "10",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  async run({ args }) {
    const { app } = loadLoreApp();
    try {
      const filters: Record<string, unknown> = {};
      if (args.type !== undefined) filters["type"] = args.type as DocType;

      const result = await app.corpusService.search(args.query, filters);

      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exitCode = exitCode(result.error);
        return;
      }

      const limit = parseInt(args.limit ?? "10", 10);
      const results = result.value.results.slice(0, limit);

      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: { results, total: results.length } }, null, 2));
        return;
      }

      if (results.length === 0) {
        console.log(`No results for "${args.query}".`);
        return;
      }

      const headers = ["ID", "Title", "Snippet", "Score"];
      const rows = results.map((r) => [
        r.id.slice(0, 10),
        r.title.slice(0, 30),
        (r.snippet ?? "").slice(0, 40),
        r.score.toFixed(2),
      ]);

      console.log(formatTable(headers, rows));
      console.log(`\n${results.length} result${results.length === 1 ? "" : "s"} for "${args.query}"`);
    } finally {
      app.close();
    }
  },
});
