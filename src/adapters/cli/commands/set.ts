/**
 * lore set <id> — update specific fields on a document.
 */

import { defineCommand } from "citty";
import { createApp } from "../../../app.js";
import { findLoreDb, exitCode, formatError } from "../utils.js";
import type { DocStatus, Priority } from "../../../core/types.js";

export default defineCommand({
  meta: {
    name: "set",
    description: "Update specific fields on a document",
  },
  args: {
    id: {
      type: "positional",
      description: "Document ID or slug",
      required: true,
    },
    title: {
      type: "string",
      description: "New title",
    },
    status: {
      type: "string",
      description: "New status: draft | in-review | approved | active | archived | deprecated",
    },
    content: {
      type: "string",
      description: "New content (markdown)",
    },
    priority: {
      type: "string",
      description: "New priority: critical | high | medium | low",
    },
    tags: {
      type: "string",
      description: "Comma-separated tags (replaces existing)",
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
      const patch: Record<string, unknown> = {};
      if (args.title !== undefined) patch["title"] = args.title;
      if (args.status !== undefined) patch["status"] = args.status as DocStatus;
      if (args.content !== undefined) patch["content"] = args.content;
      if (args.priority !== undefined) patch["priority"] = args.priority as Priority;
      if (args.tags !== undefined) {
        patch["tags"] = args.tags.split(",").map((t: string) => t.trim()).filter(Boolean);
      }

      if (Object.keys(patch).length === 0) {
        process.stderr.write(
          "Error: At least one field flag is required (--title, --status, --content, --priority, --tags).\n",
        );
        process.exit(2);
      }

      const result = app.corpusService.set(args.id, patch);

      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exit(exitCode(result.error));
      }

      const doc = result.value;
      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: doc }, null, 2));
      } else {
        console.log(`Updated ${doc.slug} → v${doc.version}`);
      }
    } finally {
      app.close();
    }
  },
});
