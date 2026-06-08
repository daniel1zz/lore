/**
 * lore migrate v1 --from <path> — import DocMan v1 corpus.
 */

import { defineCommand } from "citty";
import { createApp } from "../../../app.js";
import { findLoreDb, exitCode, formatError } from "../utils.js";

export default defineCommand({
  meta: {
    name: "migrate",
    description: "Import a DocMan v1 corpus (lore migrate v1 --from <path>)",
  },
  args: {
    version: {
      type: "positional",
      description: "Migration source version (currently: v1)",
      required: true,
    },
    from: {
      type: "string",
      description: "Source directory path containing v1 markdown files",
      required: true,
    },
    "dry-run": {
      type: "boolean",
      description: "Analyse and report without writing to database",
    },
    "skip-secret-scan": {
      type: "boolean",
      description: "Skip secret detection before import",
    },
    "id-strategy": {
      type: "string",
      description: "ID strategy: preserve | remap (default: remap)",
      default: "remap",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  async run({ args }) {
    if (args.version !== "v1") {
      process.stderr.write(
        `Error: Unknown migration version '${args.version}'. Currently only 'v1' is supported.\n`,
      );
      process.exit(2);
    }

    if (!args.from) {
      process.stderr.write("Error: --from <path> is required.\n");
      process.exit(2);
    }

    const dryRun = args["dry-run"] ?? false;
    const dbPath = findLoreDb();
    const app = createApp(dbPath);

    try {
      if (dryRun) {
        // Analysis only
        const analyzeResult = app.migrationService.analyze(args.from);
        if (!analyzeResult.ok) {
          process.stderr.write(formatError(analyzeResult.error) + "\n");
          process.exit(exitCode(analyzeResult.error));
        }

        const report = analyzeResult.value;
        if (args.json) {
          console.log(JSON.stringify({ ok: true, data: report }, null, 2));
          return;
        }

        console.log("Migration Analysis (dry-run)");
        console.log("─".repeat(40));
        console.log(`Source:       ${report.source_path}`);
        console.log(`Total files:  ${report.total_files}`);
        console.log(`Parseable:    ${report.parseable}`);
        console.log(`Unparseable:  ${report.unparseable.length}`);
        console.log(`Corpus size:  ${report.estimated_corpus_size}`);

        if (report.type_mapping.length > 0) {
          console.log("\nType mapping:");
          for (const m of report.type_mapping) {
            console.log(`  ${m.v1Type.padEnd(16)} → ${m.v2Type.padEnd(12)} (${m.count} docs)`);
          }
        }

        const lm = report.link_mapping;
        console.log(`\nLinks: ${lm.total} total, ${lm.resolvable} resolvable, ${lm.broken} broken`);

        if (report.secret_warnings.length > 0) {
          console.log(`\n⚠  ${report.secret_warnings.length} potential secret(s) detected:`);
          for (const w of report.secret_warnings.slice(0, 10)) {
            console.log(`  ${w.file}:${w.line} — ${w.pattern}`);
            console.log(`    ${w.snippet}`);
          }
          if (report.secret_warnings.length > 10) {
            console.log(`  ... and ${report.secret_warnings.length - 10} more`);
          }
        }

        if (report.unparseable.length > 0) {
          console.log("\nUnparseable files:");
          for (const e of report.unparseable.slice(0, 10)) {
            console.log(`  ${e.file}: ${e.error}`);
          }
        }

        return;
      }

      // Execute migration
      const executeResult = await app.migrationService.execute(args.from, {
        dryRun: false,
        skipSecretScan: args["skip-secret-scan"] ?? false,
        idStrategy: (args["id-strategy"] as "preserve" | "remap") ?? "remap",
      });

      if (!executeResult.ok) {
        process.stderr.write(formatError(executeResult.error) + "\n");
        process.exit(exitCode(executeResult.error));
      }

      const migResult = executeResult.value;
      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: migResult }, null, 2));
        return;
      }

      console.log("Migration complete");
      console.log("─".repeat(40));
      console.log(`Imported:  ${migResult.imported}`);
      console.log(`Skipped:   ${migResult.skipped}`);
      console.log(`Errors:    ${migResult.errors.length}`);
      console.log(`Links created: ${migResult.link_resolution.created}`);
      console.log(`Links broken:  ${migResult.link_resolution.broken}`);

      if (migResult.warnings.length > 0) {
        console.log("\nWarnings:");
        for (const w of migResult.warnings) {
          console.log(`  ${w}`);
        }
      }
      if (migResult.errors.length > 0) {
        console.log("\nErrors:");
        for (const e of migResult.errors.slice(0, 10)) {
          console.log(`  ${e.file}: ${e.error}`);
        }
      }
    } finally {
      app.close();
    }
  },
});
