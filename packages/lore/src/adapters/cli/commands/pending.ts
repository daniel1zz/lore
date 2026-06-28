/**
 * lore pending — list documents in draft status awaiting review.
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, formatTable, relativeTime } from "../utils.js";
import type { DocType } from "@lore/core";

export default defineCommand({
  meta: {
    name: "pending",
    description: "List documents in draft status (pending review)",
  },
  args: {
    author: {
      type: "string",
      description: "Filter by author",
    },
    type: {
      type: "string",
      description: "Filter by document type",
    },
    since: {
      type: "string",
      description: "ISO 8601 date — only docs updated at or after this time",
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
      if (args.author !== undefined) filters["author"] = args.author;
      if (args.type !== undefined) filters["type"] = args.type as DocType;
      if (args.since !== undefined) filters["since"] = args.since;

      const result = await app.reviewService.pending(filters);

      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exitCode = exitCode(result.error);
        return;
      }

      const docs = result.value;

      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: { docs, total: docs.length } }, null, 2));
        return;
      }

      if (docs.length === 0) {
        console.log("No pending documents.");
        return;
      }

      const headers = ["ID", "Type", "Title", "Author", "Updated", "Ver"];
      const rows = docs.map((d) => [
        d.id.slice(0, 10),
        d.type,
        d.title.slice(0, 32),
        d.created_by,
        relativeTime(d.updated_at),
        String(d.version),
      ]);

      console.log(formatTable(headers, rows));
      console.log(`\n${docs.length} pending document${docs.length === 1 ? "" : "s"}`);
    } finally {
      app.close();
    }
  },
});
