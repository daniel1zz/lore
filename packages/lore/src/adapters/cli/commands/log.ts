/**
 * lore log [<doc-id>] — version history for a document or recent audit entries.
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, formatTable } from "../utils.js";
import type { DocId } from "../../../core/types.js";

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
      const limit = parseInt(args.limit ?? "20", 10);
      const result = await app.versionService.log(args.id as DocId, { limit });

      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exit(exitCode(result.error));
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
