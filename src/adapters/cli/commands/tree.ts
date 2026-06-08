/**
 * lore tree [root-id] — display document hierarchy as a tree.
 */

import { defineCommand } from "citty";
import { createApp } from "../../../app.js";
import { findLoreDb, exitCode, formatError, formatTree } from "../utils.js";

export default defineCommand({
  meta: {
    name: "tree",
    description: "Display document hierarchy as a tree",
  },
  args: {
    root: {
      type: "positional",
      description: "Root document ID or slug (default: first PRD)",
      required: false,
    },
    depth: {
      type: "string",
      description: "Max expansion depth (default: 3)",
      default: "3",
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
      const depth = parseInt(args.depth ?? "3", 10);
      const result = await app.corpusService.tree(args.root, { depth });

      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exit(exitCode(result.error));
      }

      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: result.value }, null, 2));
        return;
      }

      console.log(formatTree(result.value));
    } finally {
      app.close();
    }
  },
});
