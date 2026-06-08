/**
 * lore diff <doc-id> [v1 v2] — show diff between two versions of a document.
 */

import { defineCommand } from "citty";
import { createApp } from "../../../app.js";
import { findLoreDb, exitCode, formatError } from "../utils.js";
import type { DocId } from "../../../core/types.js";

export default defineCommand({
  meta: {
    name: "diff",
    description: "Show diff between two versions of a document",
  },
  args: {
    id: {
      type: "positional",
      description: "Document ID",
      required: true,
    },
    from: {
      type: "string",
      description: "From version number (default: latest - 1)",
    },
    to: {
      type: "string",
      description: "To version number (default: latest)",
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
      const opts: { from?: number; to?: number } = {};
      if (args.from !== undefined) opts.from = parseInt(args.from, 10);
      if (args.to !== undefined) opts.to = parseInt(args.to, 10);

      const result = await app.versionService.diff(args.id as DocId, opts);

      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exit(exitCode(result.error));
      }

      const diff = result.value;

      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: diff }, null, 2));
        return;
      }

      console.log(`Diff ${args.id}: v${diff.from_version} → v${diff.to_version}`);

      if (diff.status_change) {
        console.log(`Status: ${diff.status_change.from} → ${diff.status_change.to}`);
      }

      if (diff.frontmatter_changes.length > 0) {
        console.log("\nFrontmatter changes:");
        for (const fc of diff.frontmatter_changes) {
          console.log(`  ${fc.field}: ${JSON.stringify(fc.old_value)} → ${JSON.stringify(fc.new_value)}`);
        }
      }

      if (diff.content_diff) {
        console.log("\nContent diff:");
        // Colorise added/removed lines if terminal supports it
        for (const line of diff.content_diff.split("\n")) {
          if (line.startsWith("+") && !line.startsWith("+++")) {
            process.stdout.write("\x1b[32m" + line + "\x1b[0m\n");
          } else if (line.startsWith("-") && !line.startsWith("---")) {
            process.stdout.write("\x1b[31m" + line + "\x1b[0m\n");
          } else {
            console.log(line);
          }
        }
      } else {
        console.log("(no content changes)");
      }
    } finally {
      app.close();
    }
  },
});
