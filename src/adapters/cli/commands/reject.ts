/**
 * lore reject <id> [--reason] — reject a draft document.
 */

import { defineCommand } from "citty";
import { createApp } from "../../../app.js";
import { findLoreDb, exitCode, formatError } from "../utils.js";
import type { DocId } from "../../../core/types.js";

export default defineCommand({
  meta: {
    name: "reject",
    description: "Reject a draft document (records reason in audit)",
  },
  args: {
    id: {
      type: "positional",
      description: "Document ID",
      required: true,
    },
    reason: {
      type: "string",
      description: "Rejection reason (stored in audit log)",
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
  async run({ args }) {
    const dbPath = findLoreDb();
    const app = createApp(dbPath);
    try {
      const opts: Record<string, unknown> = {};
      if (args.reviewer !== undefined) opts["reviewer"] = args.reviewer;
      if (args.reason !== undefined) opts["reason"] = args.reason;

      const result = await app.reviewService.reject(args.id as DocId, opts);

      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exit(exitCode(result.error));
      }

      const doc = result.value;
      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: doc }, null, 2));
      } else {
        console.log(`Rejected ${doc.slug} (status remains: ${doc.status})`);
        if (args.reason) console.log(`  Reason: ${args.reason}`);
      }
    } finally {
      app.close();
    }
  },
});
