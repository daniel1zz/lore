/**
 * lore delete <id> --confirm — soft-delete a document.
 */

import { defineCommand } from "citty";
import { createApp } from "../../../app.js";
import { findLoreDb, exitCode, formatError } from "../utils.js";

export default defineCommand({
  meta: {
    name: "delete",
    description: "Soft-delete a document (recoverable for 30 days)",
  },
  args: {
    id: {
      type: "positional",
      description: "Document ID or slug",
      required: true,
    },
    confirm: {
      type: "boolean",
      description: "Confirm deletion (required)",
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
      const result = app.corpusService.delete(args.id, args.confirm ?? false);

      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exit(exitCode(result.error));
      }

      const { id, recoverable_until } = result.value;
      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: { id, recoverable_until } }, null, 2));
      } else {
        console.log(`Deleted ${id}`);
        console.log(`  Recoverable until: ${recoverable_until.slice(0, 10)}`);
      }
    } finally {
      app.close();
    }
  },
});
