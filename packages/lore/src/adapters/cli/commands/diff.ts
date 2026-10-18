/**
 * lore diff <doc-id> [v1 v2] — show diff between two versions of a document.
 */

import { defineLoreCommand } from "../cli-exit.js";

import { loadLoreApp } from "../loader.js";
import { exitCode, formatErrorFor, parsePositiveIntArg } from "../utils.js";
import type { DocId } from "@lore/core";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";

export default defineLoreCommand({
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
  async run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    const { app } = loadLoreApp({ inv });
    try {
      // BUG-007 audit: an unvalidated NaN --from/--to reaches the store's version
      // lookup and throws a bare bun:sqlite "datatype mismatch" — validate first.
      const opts: { from?: number; to?: number } = {};
      if (args.from !== undefined) {
        const fromResult = parsePositiveIntArg(args.from, "--from", { min: 1 });
        if (!fromResult.ok) {
          inv.io.stderr.write(fromResult.message + "\n");
          return 2;
        }
        opts.from = fromResult.value;
      }
      if (args.to !== undefined) {
        const toResult = parsePositiveIntArg(args.to, "--to", { min: 1 });
        if (!toResult.ok) {
          inv.io.stderr.write(toResult.message + "\n");
          return 2;
        }
        opts.to = toResult.value;
      }

      const result = await app.versionService.diff(args.id as DocId, opts);

      if (!result.ok) {
        inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
        return exitCode(result.error);
      }

      const diff = result.value;

      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: true, data: diff }, null, 2));
        return;
      }

      printLine(inv.io.stdout, `Diff ${args.id}: v${diff.from_version} → v${diff.to_version}`);

      if (diff.status_change) {
        printLine(inv.io.stdout, `Status: ${diff.status_change.from} → ${diff.status_change.to}`);
      }

      if (diff.frontmatter_changes.length > 0) {
        printLine(inv.io.stdout, "\nFrontmatter changes:");
        for (const fc of diff.frontmatter_changes) {
          printLine(inv.io.stdout, `  ${fc.field}: ${JSON.stringify(fc.old_value)} → ${JSON.stringify(fc.new_value)}`);
        }
      }

      if (diff.content_diff) {
        printLine(inv.io.stdout, "\nContent diff:");
        // Colorise added/removed lines if terminal supports it
        for (const line of diff.content_diff.split("\n")) {
          if (line.startsWith("+") && !line.startsWith("+++")) {
            inv.io.stdout.write("\x1b[32m" + line + "\x1b[0m\n");
          } else if (line.startsWith("-") && !line.startsWith("---")) {
            inv.io.stdout.write("\x1b[31m" + line + "\x1b[0m\n");
          } else {
            printLine(inv.io.stdout, line);
          }
        }
      } else {
        printLine(inv.io.stdout, "(no content changes)");
      }
    } finally {
      app.close();
    }
  },
});
