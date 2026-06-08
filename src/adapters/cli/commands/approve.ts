/**
 * lore approve <id> — approve a draft document.
 */

import { defineCommand } from "citty";
import { createApp } from "../../../app.js";
import { findLoreDb, exitCode, formatError } from "../utils.js";
import type { DocId } from "../../../core/types.js";

export default defineCommand({
  meta: {
    name: "approve",
    description: "Approve a draft document (transition draft → approved)",
  },
  args: {
    id: {
      type: "positional",
      description: "Document ID",
      required: true,
    },
    reviewer: {
      type: "string",
      description: "Reviewer identity",
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
      const opts: Record<string, unknown> = {};
      if (args.reviewer !== undefined) opts["reviewer"] = args.reviewer;

      const result = app.reviewService.approve(args.id as DocId, opts);

      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exit(exitCode(result.error));
      }

      const doc = result.value;
      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: doc }, null, 2));
      } else {
        console.log(`Approved ${doc.slug} → status: approved (v${doc.version})`);
      }
    } finally {
      app.close();
    }
  },
});
