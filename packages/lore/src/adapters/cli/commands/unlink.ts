/**
 * lore unlink <from> <to> — remove links between two documents.
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, resolveActor } from "../utils.js";

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
    by: {
      type: "string",
      description:
        "Actor identity to attribute this unlink to (SPEC-079 G2). Defaults to " +
        "$LORE_ACTOR env var, then session tier, then OS username.",
    },
  },
  async run({ args }) {
    const { app } = loadLoreApp();
    try {
      const result = await app.corpusService.unlink(args.from, args.to, {
        by: resolveActor(args.by),
      });

      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exitCode = exitCode(result.error);
        return;
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
