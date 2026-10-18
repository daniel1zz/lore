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
import { setExitCode } from "../run-scope.js";
import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatErrorFor } from "../utils.js";
import { invocationOf } from "../command-invocation.js";

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
  async run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    // Resolve fromDir at run() time (not module-load time) so cwd is correct (SPEC-018 §3.1)
    const fromDir = resolve(inv.cwd, args.from ?? DEFAULT_SPEC_DIR);
    const dryRun = args["dry-run"] ?? false;
    const jsonMode = args.json ?? false;

    const { app } = loadLoreApp({ inv });

    try {
      const syncResult = await app.syncDocsService.run({ fromDir, dryRun });

      if (!syncResult.ok) {
        if (jsonMode) {
          inv.io.stdout.write(JSON.stringify({ ok: false, error: syncResult.error }) + "\n");
        } else {
          inv.io.stderr.write(formatErrorFor(inv, syncResult.error) + "\n");
        }
        setExitCode(exitCode(syncResult.error));
        return;
      }

      const report = syncResult.value;

      if (jsonMode) {
        inv.io.stdout.write(JSON.stringify({ ok: true, data: report }, null, 2) + "\n");
        // Exit with 4 if there are per-file errors even in JSON mode (AC-SD-9/10)
        if (report.errors.length > 0) {
          setExitCode(4);
        }
        return;
      }

      // ── Human-readable report ───────────────────────────────────────────────
      const dirDisplay = args.from ?? DEFAULT_SPEC_DIR;
      inv.io.stdout.write(`Scanned ${dirDisplay} — ${report.scanned} files\n`);

      if (dryRun) {
        inv.io.stdout.write("(dry-run: no writes performed)\n");
      }

      if (report.created.length > 0) {
        const verb = dryRun ? "Would create" : "Created";
        inv.io.stdout.write(`✓ ${verb} ${report.created.length} new spec${report.created.length === 1 ? "" : "s"}:\n`);
        for (const entry of report.created) {
          const filename = entry.file.split("/").pop() ?? entry.file;
          inv.io.stdout.write(`    ${filename.padEnd(48)} → ${entry.slug}\n`);
        }
      } else {
        inv.io.stdout.write(`✓ Created 0 new specs\n`);
      }

      if (report.matched_clean.length > 0) {
        inv.io.stdout.write(`✓ ${report.matched_clean.length} spec${report.matched_clean.length === 1 ? "" : "s"} matched corpus (clean)\n`);
      }

      if (report.matched_drift.length > 0) {
        // reason: old hint used `--content "$(cat <file>)"` which has two bugs:
        //   (1) leading `---` in the file is treated by mri as an argv terminator → empty content.
        //   (2) cat includes YAML frontmatter, which lands verbatim in corpus body; on next
        //       sync-docs run the comparison strips frontmatter from file but compares against
        //       the full-content corpus body → perpetual drift.
        // New hint references `--content-file` (Bug A fix) and tells user about frontmatter caveat.
        inv.io.stdout.write(
          `⚠ ${report.matched_drift.length} spec${report.matched_drift.length === 1 ? "" : "s"} differ${report.matched_drift.length === 1 ? "s" : ""} from corpus body — corpus is SSOT; sync-docs does not auto-push.\n`,
        );
        inv.io.stdout.write(`  Files (corpus slug shown for \`lore set\` / \`lore get\`):\n`);
        for (const entry of report.matched_drift) {
          const filename = entry.file.split("/").pop() ?? entry.file;
          inv.io.stdout.write(`    ${filename}  →  ${entry.slug}\n`);
        }
        inv.io.stdout.write(
          `  To push file → corpus, manually strip the YAML frontmatter and run:\n` +
            `    lore set <slug> --content-file <stripped-file>\n`,
        );
      }

      if (report.errors.length > 0) {
        inv.io.stderr.write(`⚠ ${report.errors.length} error${report.errors.length === 1 ? "" : "s"}:\n`);
        for (const entry of report.errors) {
          const filename = entry.file.split("/").pop() ?? entry.file;
          inv.io.stderr.write(`    ${filename}: ${entry.error}\n`);
        }
        // Exit 4 for any per-file VALIDATION_ERROR (AC-SD-9, AC-SD-10)
        setExitCode(4);
        return;
      }
    } finally {
      app.close();
    }
  },
});
