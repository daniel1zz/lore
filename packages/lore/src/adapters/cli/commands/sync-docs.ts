/**
 * lore sync-docs — backfill new spec files into corpus.
 * Source: SPEC-018 §3.5
 *
 * Scans a directory of *.md spec files, creates missing corpus rows,
 * reports drift (body difference) without auto-applying.
 *
 * Flags:
 *   --from <path>  Override the scan directory (default: docs/requirements/spec/)
 *   --dry-run      Report what would happen; make no writes
 *   --json         Machine-readable SyncReport to stdout
 *
 * Exit codes (SPEC-003 §5):
 *   0 — success (including clean or drift-only results)
 *   4 — one or more per-file VALIDATION_ERROR (AC-SD-9, AC-SD-10)
 */

import { resolve } from "path";
import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError } from "../utils.js";

const DEFAULT_SPEC_DIR = "docs/requirements/spec";

export default defineCommand({
  meta: {
    name: "sync-docs",
    description: "Backfill new spec files from disk into the Lore corpus",
  },
  args: {
    from: {
      type: "string",
      description: `Source directory to scan for *.md spec files (default: ${DEFAULT_SPEC_DIR})`,
    },
    "dry-run": {
      type: "boolean",
      description: "Report what would happen without writing to corpus",
    },
    json: {
      type: "boolean",
      description: "Output SyncReport as JSON to stdout",
    },
  },
  async run({ args }) {
    // Resolve fromDir at run() time (not module-load time) so cwd is correct (SPEC-018 §3.1)
    const fromDir = resolve(process.cwd(), args.from ?? DEFAULT_SPEC_DIR);
    const dryRun = args["dry-run"] ?? false;
    const jsonMode = args.json ?? false;

    const { app } = loadLoreApp();

    try {
      const syncResult = await app.syncDocsService.run({ fromDir, dryRun });

      if (!syncResult.ok) {
        if (jsonMode) {
          process.stdout.write(JSON.stringify({ ok: false, error: syncResult.error }) + "\n");
        } else {
          process.stderr.write(formatError(syncResult.error) + "\n");
        }
        process.exit(exitCode(syncResult.error));
      }

      const report = syncResult.value;

      if (jsonMode) {
        process.stdout.write(JSON.stringify({ ok: true, data: report }, null, 2) + "\n");
        // Exit with 4 if there are per-file errors even in JSON mode (AC-SD-9/10)
        if (report.errors.length > 0) {
          process.exit(4);
        }
        return;
      }

      // ── Human-readable report ───────────────────────────────────────────────
      const dirDisplay = args.from ?? DEFAULT_SPEC_DIR;
      process.stdout.write(`Scanned ${dirDisplay} — ${report.scanned} files\n`);

      if (dryRun) {
        process.stdout.write("(dry-run: no writes performed)\n");
      }

      if (report.created.length > 0) {
        const verb = dryRun ? "Would create" : "Created";
        process.stdout.write(`✓ ${verb} ${report.created.length} new spec${report.created.length === 1 ? "" : "s"}:\n`);
        for (const entry of report.created) {
          const filename = entry.file.split("/").pop() ?? entry.file;
          process.stdout.write(`    ${filename.padEnd(48)} → ${entry.slug}\n`);
        }
      } else {
        process.stdout.write(`✓ Created 0 new specs\n`);
      }

      if (report.matched_clean.length > 0) {
        process.stdout.write(`✓ ${report.matched_clean.length} spec${report.matched_clean.length === 1 ? "" : "s"} matched corpus (clean)\n`);
      }

      if (report.matched_drift.length > 0) {
        process.stdout.write(
          `⚠ ${report.matched_drift.length} spec${report.matched_drift.length === 1 ? "" : "s"} differ${report.matched_drift.length === 1 ? "s" : ""} from corpus body (use \`lore set <slug> --content "$(cat <file>)"\` to push):\n`,
        );
        for (const entry of report.matched_drift) {
          const filename = entry.file.split("/").pop() ?? entry.file;
          process.stdout.write(`    ${filename}\n`);
        }
      }

      if (report.errors.length > 0) {
        process.stderr.write(`⚠ ${report.errors.length} error${report.errors.length === 1 ? "" : "s"}:\n`);
        for (const entry of report.errors) {
          const filename = entry.file.split("/").pop() ?? entry.file;
          process.stderr.write(`    ${filename}: ${entry.error}\n`);
        }
        // Exit 4 for any per-file VALIDATION_ERROR (AC-SD-9, AC-SD-10)
        process.exit(4);
      }
    } finally {
      app.close();
    }
  },
});
