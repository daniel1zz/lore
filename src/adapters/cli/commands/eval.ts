/**
 * lore eval — run evaluation scenarios against the current corpus.
 *
 * Subcommands:
 *   lore eval migration --from <dir> [--skip-secret-scan] [--json]
 *
 * Exit codes:
 *   0 — scenario ran and passed (result.passed=true)
 *   1 — scenario ran but failed (result.passed=false) or internal error
 *   2 — bad arguments
 */

import { defineCommand } from "citty";
import { createApp } from "../../../app.js";
import { findLoreDb } from "../utils.js";
import { runMigrationCoverage } from "../../../eval/index.js";

// ─── migration subcommand ─────────────────────────────────────────────────────

const migrationCommand = defineCommand({
  meta: {
    name: "migration",
    description: "Eval migration coverage: imports <dir> and checks imported===expected && links_broken===0",
  },
  args: {
    from: {
      type: "string",
      description: "Source directory containing v1 markdown files",
      required: true,
    },
    "skip-secret-scan": {
      type: "boolean",
      description: "Skip secret detection during migration (default: false)",
    },
    json: {
      type: "boolean",
      description: "Output result as JSON",
    },
  },
  async run({ args }) {
    if (!args.from) {
      process.stderr.write("Error: --from <dir> is required.\n");
      process.exit(2);
    }

    const dbPath = findLoreDb();
    const app = createApp(dbPath);

    try {
      const result = await runMigrationCoverage(args.from, app);

      if (args.json) {
        // CLI surface — console.log is intentional output here
        console.log(JSON.stringify({ ok: result.passed, data: result }, null, 2)); // CLI surface
        process.exit(result.passed ? 0 : 1);
      }

      // Human-readable output
      console.log("Eval: migration-coverage"); // CLI surface
      console.log("─".repeat(40)); // CLI surface
      console.log(`Source:        ${result.source_dir}`); // CLI surface
      console.log(`Expected:      ${result.expected_files}`); // CLI surface
      console.log(`Imported:      ${result.imported}`); // CLI surface
      console.log(`Links created: ${result.links_created}`); // CLI surface
      console.log(`Links broken:  ${result.links_broken}`); // CLI surface
      console.log(`Duration:      ${result.duration_ms}ms`); // CLI surface

      if (Object.keys(result.type_distribution).length > 0) {
        console.log("\nType distribution:"); // CLI surface
        for (const [type, count] of Object.entries(result.type_distribution)) {
          console.log(`  ${type.padEnd(16)} ${count}`); // CLI surface
        }
      }

      console.log(`\nResult:        ${result.passed ? "PASSED" : "FAILED"}`); // CLI surface
      process.exit(result.passed ? 0 : 1);
    } finally {
      app.close();
    }
  },
});

// ─── eval parent command ──────────────────────────────────────────────────────

/**
 * Top-level eval command — routes to scenario subcommands.
 * Currently only "migration" is available; future scenarios are listed in SPEC-013.
 */
export default defineCommand({
  meta: {
    name: "eval",
    description: "Run evaluation scenarios against the corpus (SPEC-013)",
  },
  subCommands: {
    migration: migrationCommand,
  },
});
