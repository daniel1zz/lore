/**
 * lore unlink <from> <to> — remove links between two documents.
 */

import { defineLoreCommand } from "../cli-exit.js";

import { loadLoreApp } from "../loader.js";
import { exitCode, formatErrorFor, resolveActor } from "../utils.js";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";

export default defineLoreCommand({
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
  },
  async run(context): Promise<number> {
    const { args } = context;
    const inv = invocationOf(context);
    const { app } = loadLoreApp({ inv });
    try {
      const result = await app.corpusService.unlink(args.from, args.to, {
        by: resolveActor(inv),
      });

      if (!result.ok) {
        inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
        return exitCode(result.error);
      }

      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: true, data: null }));
      } else {
        printLine(inv.io.stdout, `Unlinked ${args.from} → ${args.to}`);
      }
    } finally {
      app.close();
    }
    return 0;
  },
});
