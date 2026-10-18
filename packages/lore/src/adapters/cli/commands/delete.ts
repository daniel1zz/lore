/**
 * lore delete <id> --confirm — soft-delete a document.
 */

import { defineLoreCommand } from "../cli-exit.js";

import { loadLoreApp } from "../loader.js";
import { exitCode, formatErrorFor, resolveActor } from "../utils.js";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";

export default defineLoreCommand({
  meta: {
    name: "delete",
    description: "Soft-delete a document (recoverable for 30 days)",
  },
  args: {
    id: {
      type: "positional",
      description: "Document ID or slug",
      required: true,
    },
    confirm: {
      type: "boolean",
      description: "Confirm deletion (required)",
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
      const result = await app.corpusService.delete(args.id, args.confirm ?? false, {
        by: resolveActor(inv.io, undefined, inv.env, inv.cwd, inv.user),
      });

      if (!result.ok) {
        inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
        return exitCode(result.error);
      }

      const { id, recoverable_until } = result.value;
      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { id, recoverable_until } }, null, 2));
      } else {
        printLine(inv.io.stdout, `Deleted ${id}`);
        printLine(inv.io.stdout, `  Recoverable until: ${recoverable_until.slice(0, 10)}`);
      }
    } finally {
      app.close();
    }
    return 0;
  },
});
