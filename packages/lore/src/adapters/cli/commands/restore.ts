/**
 * lore restore <doc-id> <version> — restore a document to a previous version.
 */

import { defineCommand } from "citty";
import { exitCli, setExitCode } from "../run-scope.js";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatErrorFor } from "../utils.js";
import type { DocId } from "@lore/core";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";

export default defineCommand({
  meta: {
    name: "restore",
    description:
      "Restore a document to a previous version (creates new version). " +
      "Never restores the document's slug — a slug is a stable address, not " +
      "restorable content (SPEC-072 D4); the doc keeps its CURRENT slug " +
      "regardless of what the target version's snapshot carried.",
  },
  args: {
    id: {
      type: "positional",
      description: "Document ID",
      required: true,
    },
    version: {
      type: "positional",
      description: "Version number to restore from",
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
    const versionNum = parseInt(args.version, 10);
    if (isNaN(versionNum) || versionNum < 1) {
      inv.io.stderr.write("Error: version must be a positive integer.\n");
      exitCli(2);
    }

    const { app } = loadLoreApp({ inv });
    try {
      const result = await app.versionService.restore(args.id as DocId, versionNum);

      if (!result.ok) {
        inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
        setExitCode(exitCode(result.error));
        return;
      }

      const doc = result.value;
      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: true, data: doc }, null, 2));
      } else {
        printLine(inv.io.stdout, `Restored ${doc.slug} from v${versionNum} → new version v${doc.version}`);
      }
    } finally {
      app.close();
    }
  },
});
