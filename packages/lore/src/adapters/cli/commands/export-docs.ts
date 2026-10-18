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
 *   --force         Overwrite drifted files with the current corpus projection
 *                   (SPEC-021 Amendment A2 — supersedes the earlier "v2" deferral)
 *   --json          Machine-readable ExportReport to stdout
 *
 * Exit codes (SPEC-003 §5):
 *   0 — success (including clean, drift-only, or force-overwritten results)
 *   2 — usage error (invalid --type)
 *   4 — one or more per-doc errors
 *   6 — store/IO failure
 */

import { dirname } from "path";

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, formatErrorFor } from "../utils.js";
import { resolveTrackedWriteRoot } from "../working-tree-root.js";
import type { DocType } from "@lore/core";
import { docTypeSchema } from "@lore/core";
import { invocationOf } from "../command-invocation.js";

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
      description: "Overwrite drifted files with the current corpus projection",
    },
    json: {
      type: "boolean",
      description: "Output ExportReport as JSON to stdout",
    },
  },
  async run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    const dryRun = args["dry-run"] ?? false;
    const jsonMode = args.json ?? false;
    const typeArg = args.type;
    const forceArg = args.force ?? false;

    // Validate --type if provided.
    let typeFilter: DocType | undefined;
    if (typeArg !== undefined) {
      const parsed = docTypeSchema.safeParse(typeArg);
      if (!parsed.success) {
        inv.io.stderr.write(
          `Error: --type '${typeArg}' is not a valid doc type. Valid types: ${VALID_TYPES.join(", ")}\n`,
        );
        return 2;
      }
      typeFilter = parsed.data;
    }

    const { app, dbPath } = loadLoreApp({ inv });
    // Derive project root from the lore DB path: dbPath = <projectDir>/.lore/lore.db.
    // reason: all docs and the export-index live relative to the project root, not cwd.
    // This mirrors the convention used by MigrationService and loader.ts itself.
    // reason: INT-T5 — the corpus (DB) may be the shared checkout, but the mirror (.lore/export-index.json,
    // docs/requirements) is tracked and is written only into the invoking working tree.
    const projectDirResolved = resolveTrackedWriteRoot(inv.cwd, dirname(dirname(dbPath)));
    if (!projectDirResolved.ok) {
      app.close();
      inv.io.stderr.write(formatError(projectDirResolved.error) + "\n");
      return exitCode(projectDirResolved.error);
    }
    const projectDir = projectDirResolved.value;

    try {
      // reason: exactOptionalPropertyTypes=true forbids passing undefined for optional `type`.
      // Build the options object conditionally to avoid TS2379.
      const exportResult = await app.exportDocsService.exportDocs({
        projectDir,
        dryRun,
        force: forceArg,
        ...(typeFilter !== undefined ? { type: typeFilter } : {}),
      });

      if (!exportResult.ok) {
        if (jsonMode) {
          inv.io.stdout.write(
            JSON.stringify({ ok: false, error: exportResult.error }) + "\n",
          );
        } else {
          inv.io.stderr.write(formatErrorFor(inv, exportResult.error) + "\n");
        }
        return exitCode(exportResult.error);
      }

      const report = exportResult.value;

      if (jsonMode) {
        inv.io.stdout.write(JSON.stringify({ ok: true, data: report }, null, 2) + "\n");
        if (report.errors.length > 0) {
          return 4;
        }
        return;
      }

      // ── Human-readable report ─────────────────────────────────────────────
      if (dryRun) {
        inv.io.stdout.write("(dry-run: no files written)\n");
      }

      const totalDocs =
        report.created.length +
        report.skipped_clean.length +
        report.drift.length +
        report.overwritten.length +
        report.errors.length;

      inv.io.stdout.write(`Corpus docs scanned: ${totalDocs}\n`);

      if (report.created.length > 0) {
        const verb = dryRun ? "Would create" : "Created";
        inv.io.stdout.write(
          `✓ ${verb} ${report.created.length} file${report.created.length === 1 ? "" : "s"}:\n`,
        );
        for (const filePath of report.created) {
          const fileName = filePath.split("/").pop() ?? filePath;
          inv.io.stdout.write(`    ${fileName}\n`);
        }
      } else {
        inv.io.stdout.write(`✓ ${dryRun ? "Would create" : "Created"} 0 new files\n`);
      }

      if (report.skipped_clean.length > 0) {
        inv.io.stdout.write(
          `✓ ${report.skipped_clean.length} file${report.skipped_clean.length === 1 ? "" : "s"} already match corpus (clean)\n`,
        );
      }

      if (report.overwritten.length > 0) {
        const verb = dryRun ? "Would overwrite" : "Overwrote";
        inv.io.stdout.write(
          `⚠ ${verb} ${report.overwritten.length} drifted file${report.overwritten.length === 1 ? "" : "s"} (--force):\n`,
        );
        for (const filePath of report.overwritten) {
          const fileName = filePath.split("/").pop() ?? filePath;
          inv.io.stdout.write(`    ${fileName}\n`);
        }
      }

      if (report.drift.length > 0) {
        inv.io.stdout.write(
          `⚠ ${report.drift.length} file${report.drift.length === 1 ? "" : "s"} differ from the current corpus projection (drift — not overwritten):\n`,
        );
        for (const filePath of report.drift) {
          const fileName = filePath.split("/").pop() ?? filePath;
          inv.io.stdout.write(`    ${fileName}\n`);
        }
        inv.io.stdout.write(
          `  This file was either hand-edited, or (for docs with MDX placeholders) it is a\n` +
          `  stale projection now that referenced content changed elsewhere in the corpus.\n` +
          `  Re-run with --force to overwrite with the current corpus projection, or reconcile\n` +
          `  manually:\n` +
          `    lore get <slug>  # view corpus content\n`,
        );
      }

      if (report.repaired.length > 0) {
        inv.io.stdout.write(
          `⚠ ${report.repaired.length} export-index self-heal repair${report.repaired.length === 1 ? "" : "s"}:\n`,
        );
        for (const line of report.repaired) {
          inv.io.stdout.write(`    ${line}\n`);
        }
      }

      if (report.errors.length > 0) {
        inv.io.stderr.write(
          `⚠ ${report.errors.length} error${report.errors.length === 1 ? "" : "s"}:\n`,
        );
        for (const errMsg of report.errors) {
          inv.io.stderr.write(`    ${errMsg}\n`);
        }
        return 4;
      }
    } finally {
      app.close();
    }
  },
});
