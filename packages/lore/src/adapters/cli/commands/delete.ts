/**
 * lore delete <id> --confirm — soft-delete a document.
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatErrorFor, resolveActor } from "../utils.js";
import { invocationOf } from "../command-invocation.js";

export default defineCommand({
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
  async run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    const { app } = loadLoreApp({ inv });
    try {
      const result = await app.corpusService.delete(args.id, args.confirm ?? false, {
        by: resolveActor(undefined, inv.env, inv.cwd, inv.user),
      });

      if (!result.ok) {
        process.stderr.write(formatErrorFor(inv, result.error) + "\n");
        process.exitCode = exitCode(result.error);
        return;
      }

      const { id, recoverable_until } = result.value;
      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: { id, recoverable_until } }, null, 2));
      } else {
        console.log(`Deleted ${id}`);
        console.log(`  Recoverable until: ${recoverable_until.slice(0, 10)}`);
      }
    } finally {
      app.close();
    }
  },
});
