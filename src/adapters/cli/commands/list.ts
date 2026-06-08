/**
 * lore list — list documents with optional filters.
 */

import { defineCommand } from "citty";
import { createApp } from "../../../app.js";
import { findLoreDb, exitCode, formatError, formatTable, relativeTime } from "../utils.js";
import type { DocType, DocStatus } from "../../../core/types.js";

export default defineCommand({
  meta: {
    name: "list",
    description: "List documents with optional filters",
  },
  args: {
    type: {
      type: "string",
      description: "Filter by type: prd | spec | adr | plan | knowledge | task",
    },
    status: {
      type: "string",
      description: "Filter by status: draft | in-review | approved | active | archived | deprecated",
    },
    author: {
      type: "string",
      description: "Filter by author (created_by)",
    },
    since: {
      type: "string",
      description: "ISO 8601 date — only docs updated at or after this time",
    },
    tag: {
      type: "string",
      description: "Filter by tag",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  async run({ args }) {
    const dbPath = findLoreDb();
    const app = createApp(dbPath);
    try {
      const filters: Record<string, unknown> = {};
      if (args.type !== undefined) filters["type"] = args.type as DocType;
      if (args.status !== undefined) filters["status"] = args.status as DocStatus;
      if (args.author !== undefined) filters["created_by"] = args.author;
      if (args.since !== undefined) filters["since"] = args.since;
      if (args.tag !== undefined) filters["tags"] = [args.tag];

      const result = await app.corpusService.list(filters);

      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exit(exitCode(result.error));
      }

      const { docs, total } = result.value;

      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: { docs, total } }, null, 2));
        return;
      }

      if (total === 0) {
        console.log("No documents found.");
        return;
      }

      const headers = ["ID", "Type", "Title", "Status", "Updated"];
      const rows = docs.map((d) => [
        d.id.slice(0, 10),
        d.type,
        d.title.slice(0, 35),
        d.status,
        relativeTime(d.updated_at),
      ]);

      console.log(formatTable(headers, rows));

      const filterDesc = Object.entries(filters)
        .map(([k, v]) => `--${k} ${Array.isArray(v) ? v.join(",") : String(v)}`)
        .join(" ");
      console.log(`\n${total} document${total === 1 ? "" : "s"}${filterDesc ? ` (filter: ${filterDesc})` : ""}`);
    } finally {
      app.close();
    }
  },
});
