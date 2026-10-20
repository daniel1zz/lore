/**
 * lore undelete <id> — restore a soft-deleted document within its recovery window.
 *
 * Public surface: the default `lore undelete` command. Side-effect class: IO (one corpus write).
 * Invariants: the ONLY verb besides the read-only history verbs that addresses a deleted doc;
 *   inside the window it writes version N+1 (action `undelete`), after it exits 4.
 */

import { defineLoreCommand } from "../cli-exit.js";

import { loadLoreApp } from "../loader.js";
import { exitCode, formatErrorFor, resolveActor } from "../utils.js";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";

export default defineLoreCommand({
  meta: {
    name: "undelete",
    description: "Restore a soft-deleted document within its 30-day recovery window",
  },
  args: {
    id: {
      type: "positional",
      description: "Document ID or slug of the deleted document",
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
      const result = await app.corpusService.undelete(args.id, {
        by: resolveActor(inv),
      });

      if (!result.ok) {
        inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
        return exitCode(result.error);
      }

      const { id, slug, version } = result.value;
      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { id, slug, version } }, null, 2));
      } else {
        printLine(inv.io.stdout, `Restored ${slug} (${id}) as version ${version}`);
      }
    } finally {
      app.close();
    }
    return 0;
  },
});
