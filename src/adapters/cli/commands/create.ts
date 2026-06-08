/**
 * lore create <type> — create a new document.
 */

import { defineCommand } from "citty";
import { createApp } from "../../../app.js";
import { findLoreDb, exitCode, formatError } from "../utils.js";
import type { DocType, Priority } from "../../../core/types.js";

const VALID_TYPES: DocType[] = ["prd", "spec", "adr", "plan", "knowledge", "task"];

export default defineCommand({
  meta: {
    name: "create",
    description: "Create a new document",
  },
  args: {
    type: {
      type: "positional",
      description: `Document type: ${VALID_TYPES.join(" | ")}`,
      required: true,
    },
    title: {
      type: "string",
      description: "Document title",
    },
    parent: {
      type: "string",
      description: "Parent document ID or slug",
    },
    content: {
      type: "string",
      description: "Document content (markdown)",
    },
    priority: {
      type: "string",
      description: "Priority: critical | high | medium | low",
      default: "medium",
    },
    tags: {
      type: "string",
      description: "Comma-separated tags",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  async run({ args }) {
    if (!VALID_TYPES.includes(args.type as DocType)) {
      process.stderr.write(
        `Error: Invalid type '${args.type}'. Valid types: ${VALID_TYPES.join(", ")}\n`,
      );
      process.exit(2);
    }

    if (!args.title) {
      process.stderr.write("Error: --title is required.\n");
      process.exit(2);
    }

    const dbPath = findLoreDb();
    const app = createApp(dbPath);
    try {
      const tags = args.tags
        ? args.tags.split(",").map((t: string) => t.trim()).filter(Boolean)
        : [];

      const result = await app.corpusService.create({
        type: args.type as DocType,
        title: args.title,
        ...(args.parent !== undefined ? { parent_id: args.parent } : {}),
        ...(args.content !== undefined ? { content: args.content } : {}),
        priority: (args.priority as Priority) ?? "medium",
        ...(tags.length > 0 ? { tags } : {}),
      });

      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exit(exitCode(result.error));
      }

      const doc = result.value;
      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: doc }, null, 2));
      } else {
        console.log(`Created ${doc.type} document`);
        console.log(`  ID:     ${doc.id}`);
        console.log(`  Slug:   ${doc.slug}`);
        console.log(`  Title:  ${doc.title}`);
        console.log(`  Status: ${doc.status} (v${doc.version})`);
        console.log(`\nRun \`lore get ${doc.slug}\` to view the document.`);
      }
    } finally {
      app.close();
    }
  },
});
