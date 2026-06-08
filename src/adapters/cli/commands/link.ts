/**
 * lore link <from> <to> [--type] — create a link between two documents.
 */

import { defineCommand } from "citty";
import { createApp } from "../../../app.js";
import { findLoreDb, exitCode, formatError } from "../utils.js";
import type { LinkType } from "../../../core/types.js";

const VALID_LINK_TYPES: LinkType[] = [
  "parent",
  "implements",
  "informs",
  "supersedes",
  "relates-to",
  "blocks",
];

export default defineCommand({
  meta: {
    name: "link",
    description: "Create a link between two documents",
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
    type: {
      type: "string",
      description: `Link type: ${VALID_LINK_TYPES.join(" | ")} (default: relates-to)`,
      default: "relates-to",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  async run({ args }) {
    const linkType = (args.type ?? "relates-to") as LinkType;

    if (!VALID_LINK_TYPES.includes(linkType)) {
      process.stderr.write(
        `Error: Invalid link type '${linkType}'. Valid types: ${VALID_LINK_TYPES.join(", ")}\n`,
      );
      process.exit(2);
    }

    const dbPath = findLoreDb();
    const app = createApp(dbPath);
    try {
      const result = await app.corpusService.link(args.from, args.to, linkType);

      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exit(exitCode(result.error));
      }

      const link = result.value;
      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: link }, null, 2));
      } else {
        console.log(`Linked ${link.from_id.slice(0, 8)}… → ${link.to_id.slice(0, 8)}… (${link.link_type})`);
      }
    } finally {
      app.close();
    }
  },
});
