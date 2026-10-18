/**
 * lore unlink <from> <to> — remove links between two documents.
 */

import { defineCommand } from "citty";
import { setExitCode } from "../run-scope.js";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatErrorFor, resolveActor } from "../utils.js";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";

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
  },
  async run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    const { app } = loadLoreApp({ inv });
    try {
      const result = await app.corpusService.unlink(args.from, args.to, {
        by: resolveActor(inv.io, undefined, inv.env, inv.cwd, inv.user),
      });

      if (!result.ok) {
        inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
        setExitCode(exitCode(result.error));
        return;
      }

      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: true, data: null }));
      } else {
        printLine(inv.io.stdout, `Unlinked ${args.from} → ${args.to}`);
      }
    } finally {
      app.close();
    }
  },
});
