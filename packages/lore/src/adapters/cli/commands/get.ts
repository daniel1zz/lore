/**
 * lore get <id-or-slug> — display a document with navigation footer.
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, formatNavigation } from "../utils.js";

export default defineCommand({
  meta: {
    name: "get",
    description: "Get a document by ID or slug",
  },
  args: {
    id: {
      type: "positional",
      description: "Document ID or slug",
      required: true,
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
    raw: {
      type: "boolean",
      description: "Skip MDX resolution",
    },
  },
  async run({ args }) {
    const { app } = loadLoreApp();
    try {
      const result = await app.corpusService.get(args.id, { resolve_mdx: !args.raw });

      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exit(exitCode(result.error));
      }

      const { doc, navigation } = result.value;

      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: result.value }, null, 2));
        return;
      }

      // Human-readable display
      const divider = "─".repeat(60);
      console.log(`── ${doc.id.slice(0, 8)}… ${doc.title} ${divider.slice(0, 40)}`);
      console.log(
        `Type: ${doc.type} | Status: ${doc.status} | Priority: ${doc.priority} | v${doc.version}`,
      );
      console.log(
        `Created: ${doc.created_at.slice(0, 10)} by ${doc.created_by} | Updated: ${doc.updated_at.slice(0, 10)}`,
      );
      if (doc.tags.length > 0) {
        console.log(`Tags: ${doc.tags.join(", ")}`);
      }
      console.log("");
      console.log(doc.content || "(no content)");
      console.log("");
      console.log(formatNavigation(navigation));
    } finally {
      app.close();
    }
  },
});
