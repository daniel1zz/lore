/**
 * lore init — create .lore/ directory, config.yaml, and SQLite DB.
 */

import { defineCommand } from "citty";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { createApp } from "../../../app.js";
// reason: saveConfig writes .lore/config.yaml via Node fs — only reachable via
// the @lore/core/node subpath (browser-safety split, packages/core/src/CLAUDE.md).
import { saveConfig } from "@lore/core/node";
import { formatError } from "../utils.js";

export default defineCommand({
  meta: {
    name: "init",
    description: "Initialise a new Lore project in the current directory",
  },
  args: {
    name: {
      type: "string",
      description: "Project name (default: directory name)",
    },
    author: {
      type: "string",
      description: "Default author identity",
      default: "owner",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  run({ args }) {
    const cwd = process.cwd();
    const loreDir = join(cwd, ".lore");

    if (existsSync(loreDir)) {
      const msg = "Lore project already initialised in this directory.";
      if (args.json) {
        console.log(JSON.stringify({ ok: false, error: msg }));
      } else {
        process.stderr.write(`Error: ${msg}\n`);
      }
      process.exit(1);
    }

    mkdirSync(loreDir, { recursive: true });

    // Write .gitignore
    writeFileSync(
      join(loreDir, ".gitignore"),
      "lore.db\nlore.db-wal\nlore.db-shm\n",
    );

    // Determine project name
    const projectName = args.name ?? cwd.split("/").filter(Boolean).pop() ?? "lore";

    // Write config.yaml via SSOT saveConfig (no hand-assembled yaml)
    const saveResult = saveConfig(cwd, { project: { name: projectName, author: args.author } });
    if (!saveResult.ok) {
      const msg = `Failed to write config: ${formatError(saveResult.error)}`;
      if (args.json) {
        console.log(JSON.stringify({ ok: false, error: msg }));
      } else {
        process.stderr.write(`Error: ${msg}\n`);
      }
      process.exit(1);
    }

    // Initialise the SQLite DB (SQLiteStore constructor runs migrations)
    const dbPath = join(loreDir, "lore.db");
    const app = createApp(dbPath);
    app.close();

    if (args.json) {
      console.log(
        JSON.stringify({
          ok: true,
          data: { path: loreDir, project: projectName, author: args.author },
        }),
      );
    } else {
      console.log(`Initialised Lore project "${projectName}"`);
      console.log(`  Database: ${join(loreDir, "lore.db")}`);
      console.log(`  Config:   ${join(loreDir, "config.yaml")}`);
      console.log("");
      console.log("Run `lore create prd --title \"My Project\"` to add your first document.");
    }
  },
});
