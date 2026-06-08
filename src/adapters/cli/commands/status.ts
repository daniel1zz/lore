/**
 * lore status — corpus stats and health check.
 */

import { defineCommand } from "citty";
import { createApp } from "../../../app.js";
import { findLoreDb, exitCode, formatError } from "../utils.js";

export default defineCommand({
  meta: {
    name: "status",
    description: "Corpus statistics and health check",
  },
  args: {
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  run({ args }) {
    const dbPath = findLoreDb();
    const app = createApp(dbPath);
    try {
      const result = app.corpusService.status();

      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exit(exitCode(result.error));
      }

      const status = result.value;

      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: status }, null, 2));
        return;
      }

      console.log("Corpus Status");
      console.log("─".repeat(40));
      console.log(`Total documents:  ${status.total_docs}`);
      console.log(`Last updated:     ${status.last_updated.slice(0, 19).replace("T", " ")}`);
      if (status.db_size_bytes > 0) {
        const kb = (status.db_size_bytes / 1024).toFixed(1);
        console.log(`Database size:    ${kb} KB`);
      }

      if (Object.keys(status.by_type).length > 0) {
        console.log("\nBy type:");
        for (const [type, count] of Object.entries(status.by_type)) {
          console.log(`  ${type.padEnd(12)} ${count}`);
        }
      }

      if (Object.keys(status.by_status).length > 0) {
        console.log("\nBy status:");
        for (const [s, count] of Object.entries(status.by_status)) {
          console.log(`  ${s.padEnd(12)} ${count}`);
        }
      }
    } finally {
      app.close();
    }
  },
});
