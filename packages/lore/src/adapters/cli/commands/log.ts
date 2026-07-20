/**
 * lore log [<doc-id>] — version history for a document or recent audit entries.
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, formatTable, parsePositiveIntArg } from "../utils.js";
import type { DocId } from "@lore/core";

export default defineCommand({
  meta: {
    name: "log",
    description: "Show version history for a document",
  },
  args: {
    id: {
      type: "positional",
      description: "Document ID",
      required: true,
    },
    limit: {
      type: "string",
      description: "Max entries to show (default: 20)",
      default: "20",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  async run({ args }) {
    const { app } = loadLoreApp();
    try {
      // BUG-007 audit: an unvalidated NaN --limit reaches the store's `LIMIT ?`
      // bind and throws a bare bun:sqlite "datatype mismatch" — validate first.
      const limitResult = parsePositiveIntArg(args.limit ?? "20", "--limit", { min: 1 });
      if (!limitResult.ok) {
        process.stderr.write(limitResult.message + "\n");
        process.exitCode = 2;
        return;
      }
      const result = await app.versionService.log(args.id as DocId, { limit: limitResult.value });

      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exitCode = exitCode(result.error);
        return;
      }

      const entries = result.value;

      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: { entries, total: entries.length } }, null, 2));
        return;
      }

      if (entries.length === 0) {
        console.log(`No version history for ${args.id}.`);
        return;
      }

      const headers = ["Version", "Action", "Author", "Timestamp", "Summary"];
      const rows = entries.map((e) => [
        `v${e.version}`,
        e.action,
        e.created_by,
        e.created_at.slice(0, 19).replace("T", " "),
        (e.change_summary ?? "").slice(0, 30),
      ]);

      console.log(`Version history for ${args.id}:`);
      console.log(formatTable(headers, rows));
    } finally {
      app.close();
    }
  },
});
