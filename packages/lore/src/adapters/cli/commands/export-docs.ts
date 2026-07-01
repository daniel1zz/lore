/**
 * lore export-docs — reverse-sync corpus docs to per-doc .md files.
 * Source: SPEC-021 §9.1
 *
 * Walks all corpus docs (or a filtered type), emits one .md file per doc under
 * docs/requirements/<type>/, and maintains .lore/export-index.json for stable
 * human-readable ID assignment across runs.
 *
 * Flags:
 *   --dry-run       Report what would happen; write nothing (AC-EXPORT-7)
 *   --type <type>   Export only one doc type, e.g. --type spec (AC-EXPORT-8)
 *   --force         (v1: rejected — v2 will overwrite drifted files) (AC-EXPORT-9)
 *   --json          Machine-readable ExportReport to stdout
 *
 * Exit codes (SPEC-003 §5):
 *   0 — success (including clean or drift-only results)
 *   2 — usage error (--force passed, invalid --type)
 *   4 — one or more per-doc errors
 *   6 — store/IO failure
 */

import { dirname } from "path";
import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError } from "../utils.js";
import type { DocType } from "@lore/core";
import { docTypeSchema } from "@lore/core";

/** Valid DocType values for --type validation. */
const VALID_TYPES = docTypeSchema.options;

export default defineCommand({
  meta: {
    name: "export-docs",
    description: "Reverse-sync corpus docs to per-doc .md files under docs/requirements/<type>/",
  },
  args: {
    "dry-run": {
      type: "boolean",
      description: "Report what would happen without writing any files",
    },
    type: {
      type: "string",
      description: `Restrict export to one doc type (${VALID_TYPES.join(" | ")})`,
    },
    force: {
      type: "boolean",
      description: "(v2, not yet implemented) Overwrite drifted files with corpus body",
    },
    json: {
      type: "boolean",
      description: "Output ExportReport as JSON to stdout",
    },
  },
  async run({ args }) {
    const dryRun = args["dry-run"] ?? false;
    const jsonMode = args.json ?? false;
    const typeArg = args.type;
    const forceArg = args.force ?? false;

    // Validate --force (v1 always rejects) early so we give a clean usage error.
    if (forceArg) {
      process.stderr.write(
        "Error: --force not yet implemented — v2 will overwrite corpus body over file.\n",
      );
      process.exitCode = 2;
      return;
    }

    // Validate --type if provided.
    let typeFilter: DocType | undefined;
    if (typeArg !== undefined) {
      const parsed = docTypeSchema.safeParse(typeArg);
      if (!parsed.success) {
        process.stderr.write(
          `Error: --type '${typeArg}' is not a valid doc type. Valid types: ${VALID_TYPES.join(", ")}\n`,
        );
        process.exitCode = 2;
        return;
      }
      typeFilter = parsed.data;
    }

    const { app, dbPath } = loadLoreApp();
    // Derive project root from the lore DB path: dbPath = <projectDir>/.lore/lore.db.
    // reason: all docs and the export-index live relative to the project root, not cwd.
    // This mirrors the convention used by MigrationService and loader.ts itself.
    const projectDir = dirname(dirname(dbPath));

    try {
      // reason: exactOptionalPropertyTypes=true forbids passing undefined for optional `type`.
      // Build the options object conditionally to avoid TS2379.
      const exportResult = await app.exportDocsService.exportDocs({
        projectDir,
        dryRun,
        // force is rejected above so always false here — omit to keep optional property clean.
        ...(typeFilter !== undefined ? { type: typeFilter } : {}),
      });

      if (!exportResult.ok) {
        if (jsonMode) {
          process.stdout.write(
            JSON.stringify({ ok: false, error: exportResult.error }) + "\n",
          );
        } else {
          process.stderr.write(formatError(exportResult.error) + "\n");
        }
        process.exitCode = exitCode(exportResult.error);
        return;
      }

      const report = exportResult.value;

      if (jsonMode) {
        process.stdout.write(JSON.stringify({ ok: true, data: report }, null, 2) + "\n");
        if (report.errors.length > 0) {
          process.exitCode = 4;
        }
        return;
      }

      // ── Human-readable report ─────────────────────────────────────────────
      if (dryRun) {
        process.stdout.write("(dry-run: no files written)\n");
      }

      const totalDocs =
        report.created.length +
        report.skipped_clean.length +
        report.drift.length +
        report.errors.length;

      process.stdout.write(`Corpus docs scanned: ${totalDocs}\n`);

      if (report.created.length > 0) {
        const verb = dryRun ? "Would create" : "Created";
        process.stdout.write(
          `✓ ${verb} ${report.created.length} file${report.created.length === 1 ? "" : "s"}:\n`,
        );
        for (const filePath of report.created) {
          const fileName = filePath.split("/").pop() ?? filePath;
          process.stdout.write(`    ${fileName}\n`);
        }
      } else {
        process.stdout.write(`✓ ${dryRun ? "Would create" : "Created"} 0 new files\n`);
      }

      if (report.skipped_clean.length > 0) {
        process.stdout.write(
          `✓ ${report.skipped_clean.length} file${report.skipped_clean.length === 1 ? "" : "s"} already match corpus (clean)\n`,
        );
      }

      if (report.drift.length > 0) {
        process.stdout.write(
          `⚠ ${report.drift.length} file${report.drift.length === 1 ? "" : "s"} differ from corpus body (drift — not overwritten):\n`,
        );
        for (const filePath of report.drift) {
          const fileName = filePath.split("/").pop() ?? filePath;
          process.stdout.write(`    ${fileName}\n`);
        }
        process.stdout.write(
          `  To push corpus → file, use --force (v2) or manually reconcile:\n` +
          `    lore get <slug>  # view corpus content\n`,
        );
      }

      if (report.errors.length > 0) {
        process.stderr.write(
          `⚠ ${report.errors.length} error${report.errors.length === 1 ? "" : "s"}:\n`,
        );
        for (const errMsg of report.errors) {
          process.stderr.write(`    ${errMsg}\n`);
        }
        process.exitCode = 4;
        return;
      }
    } finally {
      app.close();
    }
  },
});
