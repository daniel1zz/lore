/**
 * lore restore <doc-id> <version> — restore a document to a previous version.
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError } from "../utils.js";
import type { DocId } from "../../../core/types.js";

export default defineCommand({
  meta: {
    name: "restore",
    description: "Restore a document to a previous version (creates new version)",
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
  async run({ args }) {
    const versionNum = parseInt(args.version, 10);
    if (isNaN(versionNum) || versionNum < 1) {
      process.stderr.write("Error: version must be a positive integer.\n");
      process.exit(2);
    }

    const { app } = loadLoreApp();
    try {
      const result = await app.versionService.restore(args.id as DocId, versionNum);

      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exit(exitCode(result.error));
      }

      const doc = result.value;
      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: doc }, null, 2));
      } else {
        console.log(`Restored ${doc.slug} from v${versionNum} → new version v${doc.version}`);
      }
    } finally {
      app.close();
    }
  },
});
