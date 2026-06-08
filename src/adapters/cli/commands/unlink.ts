/**
 * lore unlink <from> <to> — remove links between two documents.
 */

import { defineCommand } from "citty";
import { createApp } from "../../../app.js";
import { findLoreDb, exitCode, formatError } from "../utils.js";

export default defineCommand({
  meta: {
    name: "unlink",
    description: "Remove link(s) between two documents",
  },
  args: {
    from: {
      type: "positional",
      description: "Source document ID or slug",
      required: true,
    },
    to: {
      type: "positional",
      description: "Target document ID or slug",
      required: true,
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  run({ args }) {
    const dbPath = findLoreDb();
    const app = createApp(dbPath);
    try {
      const result = app.corpusService.unlink(args.from, args.to);

      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exit(exitCode(result.error));
      }

      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: null }));
      } else {
        console.log(`Unlinked ${args.from} → ${args.to}`);
      }
    } finally {
      app.close();
    }
  },
});
