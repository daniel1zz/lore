/**
 * lore migrate <action> — corpus migration commands.
 *
 * Actions:
 *   v1 --from <path>   Import a DocMan v1 corpus.
 *   phases [--dry-run] Promote legacy singular plan.extra.phase → extra.legacy_phase
 *                      across all plan rows in a single sweep. Idempotent. (SPEC-023 §4 AC-PHASE-10)
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError } from "../utils.js";

export default defineCommand({
  meta: {
    name: "migrate",
    description: "Corpus migration: `v1 --from <path>` (v1 import) or `phases` (phase schema sweep)",
  },
  args: {
    version: {
      type: "positional",
      description: "Migration action: v1 | phases",
      required: true,
    },
    from: {
      type: "string",
      description: "[v1 only] Source directory path containing v1 markdown files",
    },
    "dry-run": {
      type: "boolean",
      description: "Analyse and report without writing to database",
    },
    "skip-secret-scan": {
      type: "boolean",
      description: "[v1 only] Skip secret detection before import",
    },
    "id-strategy": {
      type: "string",
      description: "[v1 only] ID strategy: preserve | remap (default: remap)",
      default: "remap",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  async run({ args }) {
    if (args.version !== "v1" && args.version !== "phases") {
      process.stderr.write(
        `Error: Unknown migration action '${args.version}'. Supported: v1, phases.\n`,
      );
      process.exit(2);
    }

    // ── phases action ─────────────────────────────────────────────────────
    if (args.version === "phases") {
      const dryRun = args["dry-run"] ?? false;
      const { app } = loadLoreApp();
      try {
        const result = await app.phaseService.migratePhases({ dryRun });

        if (!result.ok) {
          process.stderr.write(formatError(result.error) + "\n");
          process.exitCode = exitCode(result.error);
          return;
        }

        const report = result.value;
        if (args.json) {
          console.log(JSON.stringify({ ok: true, data: report }, null, 2));
          return;
        }

        const label = dryRun ? "Phase migration (dry-run)" : "Phase migration complete";
        console.log(label);
        console.log("─".repeat(40));
        console.log(`Plans touched:  ${report.touched}`);
        console.log(`Plans skipped:  ${report.skipped}`);
        if (dryRun) {
          console.log("\nRe-run without --dry-run to apply changes.");
        }
      } finally {
        app.close();
      }
      return;
    }

    // ── v1 action ─────────────────────────────────────────────────────────
    if (!args.from) {
      process.stderr.write("Error: --from <path> is required for `migrate v1`.\n");
      process.exit(2);
    }

    const dryRun = args["dry-run"] ?? false;
    const { app } = loadLoreApp();

    try {
      if (dryRun) {
        // Analysis only
        const analyzeResult = app.migrationService.analyze(args.from);
        if (!analyzeResult.ok) {
          process.stderr.write(formatError(analyzeResult.error) + "\n");
          process.exitCode = exitCode(analyzeResult.error);
          return;
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
        process.exitCode = exitCode(executeResult.error);
        return;
      }

      const migResult = executeResult.value;
      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: migResult }, null, 2));
        return;
      }

      console.log("Migration complete");
      console.log("─".repeat(40));
      console.log(`Imported:        ${migResult.imported}`);
      console.log(`Already existed: ${migResult.already_existed}`);
      console.log(`Errors:          ${migResult.errors.length}`);
      console.log(`Links created:   ${migResult.link_resolution.created}`);
      console.log(`Links broken:    ${migResult.link_resolution.broken}`);

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
