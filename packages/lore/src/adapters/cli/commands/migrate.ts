/**
 * lore migrate <action> — corpus migration commands.
 *
 * Actions:
 *   v1 --from <path>   Import a DocMan v1 corpus.
 *   phases [--dry-run] Promote legacy singular plan.extra.phase → extra.legacy_phase
 *                      across all plan rows in a single sweep. Idempotent. (SPEC-023 §4 AC-PHASE-10)
 *   spec-kind [--dry-run] Heuristically flag `spec` docs whose title/content suggests
 *                      tech/design but still carry the defaulted "feature" spec_kind.
 *                      No AI — pure regex signal, reported transparently. Idempotent. (SPEC-032 §3.4)
 *   tasks-to-phases [--dry-run] One-shot sweep converting every plan's `task` docs into
 *                      `phase` docs (grouped by extra.phase / extra.legacy_phase / one-per-task
 *                      fallback), merging evidence/claims/anchors. Idempotent — a second run
 *                      performs zero new writes. Thin pipe over `PhaseMigrationService.migrateTasks`.
 *                      (SPEC-056 §Design Decisions D6/D6a, AC-P-5)
 *   prd-to-outline --prd <id-or-slug> [--section <key> (repeatable)] [--dry-run]
 *                      Relocates one or more `## `-level-2 sections of a root PRD's body into
 *                      dedicated `domain-overview` child specs, verbatim. Idempotent — a section
 *                      already migrated (or already fully covered by a pre-existing, invariant-
 *                      passing child doc) performs zero writes on re-run. `--dry-run` computes the
 *                      full per-section verdict report with zero writes. Thin pipe over
 *                      `OutlineMigrationService.migrateSection`, looped once per `--section`.
 *                      (SPEC-080 §Migration Plan Phase 1, AC-080-7)
 *   ordinals [--apply] One-shot SPEC-084 repair migration: backfills the store-allocated
 *                      `ordinal` column for every spec/adr doc from its title-declared number
 *                      (created_at priority, collisions get next-free), strips the now-redundant
 *                      number prefix from titles, and reconciles `.lore/export-index.json`'s
 *                      `human_id` field to match. Dry-run is the DEFAULT (no `--apply` needed to
 *                      preview); `--apply` executes. Idempotent — a second `--apply` run performs
 *                      zero writes. Thin pipe over `OrdinalMigrationService.migrateOrdinals`.
 *                      (SPEC-084 §One-shot repair migration, AC-084-4)
 *   spec-parents [--apply | --revert] Clear every spec's parent_id (BR-1009). Preview is the DEFAULT
 *                      (lists count + slugs, writes nothing); `--apply` writes one `migrate_spec_parent`
 *                      audit entry per spec (no version row, no status change); `--revert` restores each
 *                      parent from those entries. Both idempotent. Thin pipe over
 *                      `SpecParentMigrationService`. (AC-BLS3B-7)
 */

import { dirname } from "path";
import { exitCli, setExitCode } from "../run-scope.js";
import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, formatErrorFor } from "../utils.js";
import { resolveTrackedWriteRoot } from "../working-tree-root.js";
import { requirePhaseMigrationService } from "../phase-wiring.js";
import type { SectionMigrationVerdict } from "../../../service/outline-migration-service.js";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";

export default defineCommand({
  meta: {
    name: "migrate",
    description:
      "Corpus migration: `v1 --from <path>` (v1 import), `phases` (phase schema sweep), `spec-kind` (spec_kind mistype audit), `tasks-to-phases` (task→phase doc-type sweep), `prd-to-outline` (per-section PRD→outline domain relocation), `ordinals` (SPEC-084 ordinal repair migration), or `spec-parents` (clear every spec parent_id; preview by default, `--apply` writes, `--revert` restores)",
  },
  args: {
    version: {
      type: "positional",
      description: "Migration action: v1 | phases | spec-kind | tasks-to-phases | prd-to-outline | ordinals | spec-parents",
      required: true,
    },
    from: {
      type: "string",
      description: "[v1 only] Source directory path containing v1 markdown files",
    },
    prd: {
      type: "string",
      description: "[prd-to-outline only] The root PRD's id or slug",
    },
    section: {
      type: "string",
      description: "[prd-to-outline only] Section key to migrate (repeatable; omit to migrate every domain section found in the PRD body)",
    },
    "dry-run": {
      type: "boolean",
      description: "Analyse and report without writing to database",
    },
    apply: {
      type: "boolean",
      description: "[ordinals, spec-parents] Execute the migration (default is dry-run/preview-only)",
    },
    revert: {
      type: "boolean",
      description: "[spec-parents only] Restore every spec parent_id from its migrate_spec_parent audit entry",
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
  async run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    if (
      args.version !== "v1" &&
      args.version !== "phases" &&
      args.version !== "spec-kind" &&
      args.version !== "tasks-to-phases" &&
      args.version !== "prd-to-outline" &&
      args.version !== "ordinals" &&
      args.version !== "spec-parents"
    ) {
      inv.io.stderr.write(
        `Error: Unknown migration action '${args.version}'. Supported: v1, phases, spec-kind, tasks-to-phases, prd-to-outline, ordinals, spec-parents.\n`,
      );
      exitCli(2);
    }

    // ── spec-parents action ───────────────────────────────────────────────
    if (args.version === "spec-parents") {
      if (args.apply === true && args.revert === true) {
        inv.io.stderr.write("Error: --apply and --revert are mutually exclusive for `migrate spec-parents`.\n");
        exitCli(2);
      }
      const { app } = loadLoreApp({ inv });
      try {
        const service = app.specParentMigrationService;
        if (service === undefined) {
          inv.io.stderr.write("Internal error: SpecParentMigrationService not wired on App\n");
          setExitCode(1);
          return;
        }
        const mode = args.revert === true ? "revert" : args.apply === true ? "apply" : "preview";
        const result =
          mode === "revert" ? await service.revert() : mode === "apply" ? await service.apply() : await service.preview();
        if (!result.ok) {
          if (args.json) {
            printLine(inv.io.stdout, JSON.stringify({ ok: false, error: result.error }, null, 2));
          } else {
            inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
          }
          setExitCode(exitCode(result.error));
          return;
        }
        const report = result.value;
        const failed = report.errors.length > 0;
        if (args.json) {
          printLine(inv.io.stdout, 
            JSON.stringify(
              {
                ok: !failed,
                data: {
                  applied: mode === "apply",
                  reverted: mode === "revert",
                  count: report.count,
                  slugs: report.rows.map((r) => r.slug),
                  skipped: report.skipped,
                  errors: report.errors,
                },
              },
              null,
              2,
            ),
          );
          setExitCode(failed ? 4 : 0);
          return;
        }
        const label =
          mode === "revert" ? "Spec-parent revert complete" : mode === "apply" ? "Spec-parent migration complete" : "Spec-parent migration (preview)";
        printLine(inv.io.stdout, label);
        printLine(inv.io.stdout, "─".repeat(40));
        const noun = mode === "revert" ? "restored" : mode === "apply" ? "cleared" : "would clear";
        printLine(inv.io.stdout, `Specs ${noun}: ${report.count}`);
        for (const row of report.rows) printLine(inv.io.stdout, `  ${row.slug}`);
        for (const skip of report.skipped) printLine(inv.io.stdout, `  skipped ${skip.slug}: ${skip.reason}`);
        for (const e of report.errors) printLine(inv.io.stdout, `  error ${e}`);
        if (mode === "preview") printLine(inv.io.stdout, "\nRe-run with --apply to execute, --revert to undo a previous apply.");
        setExitCode(failed ? 4 : 0);
      } finally {
        app.close();
      }
      return;
    }

    // ── ordinals action ───────────────────────────────────────────────────
    if (args.version === "ordinals") {
      const dryRun = !(args.apply ?? false);
      const { app, dbPath } = loadLoreApp({ inv });
      // reason: export-index.json lives at <projectDir>/.lore/export-index.json —
      // same derivation ExportDocsService's own CLI command uses (dbPath = <projectDir>/.lore/lore.db).
      // reason: INT-T5 — export-index.json is tracked; write it in the invoking working tree, not the corpus checkout.
      const projectDirResolved = resolveTrackedWriteRoot(inv.cwd, dirname(dirname(dbPath)));
      if (!projectDirResolved.ok) {
        app.close();
        inv.io.stderr.write(formatError(projectDirResolved.error) + "\n");
        setExitCode(exitCode(projectDirResolved.error));
        return;
      }
      const projectDir = projectDirResolved.value;
      try {
        if (app.ordinalMigrationService === undefined) {
          inv.io.stderr.write("Internal error: OrdinalMigrationService not wired on App\n");
          setExitCode(1);
          return;
        }

        const result = await app.ordinalMigrationService.migrateOrdinals({ dryRun, projectDir });
        if (!result.ok) {
          if (args.json) {
            printLine(inv.io.stdout, JSON.stringify({ ok: false, error: result.error }, null, 2));
          } else {
            inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
          }
          setExitCode(exitCode(result.error));
          return;
        }

        const report = result.value;
        if (args.json) {
          printLine(inv.io.stdout, JSON.stringify({ ok: true, data: report }, null, 2));
          setExitCode(report.errors.length > 0 ? 4 : 0);
          return;
        }

        const label = dryRun ? "Ordinal migration (dry-run)" : "Ordinal migration complete";
        printLine(inv.io.stdout, label);
        printLine(inv.io.stdout, "─".repeat(40));
        printLine(inv.io.stdout, `Numbered docs:        ${report.numbered_doc_count}`);
        printLine(inv.io.stdout, `Bijective:            ${report.bijective ? "yes" : "NO — see errors below"}`);
        printLine(inv.io.stdout, `Writes performed:     ${report.writes_performed}`);

        if (report.reassignments.length > 0) {
          printLine(inv.io.stdout, "\nOrdinal assignments (old → new):");
          for (const r of report.reassignments) {
            const oldLabel = r.old_display ?? "(no declared number)";
            const marker = r.changed ? "CHANGED" : "kept";
            printLine(inv.io.stdout, `  [${marker}] ${r.doc_id}  ${oldLabel} → ${r.new_display}  "${r.title}"`);
          }
        }

        if (report.title_strips.length > 0) {
          printLine(inv.io.stdout, "\nTitle prefix strips:");
          for (const t of report.title_strips) {
            printLine(inv.io.stdout, `  ${t.doc_id}  "${t.old_title}" → "${t.new_title}" (status: ${t.status_before})`);
          }
        }

        if (report.export_index_reconciles.length > 0) {
          printLine(inv.io.stdout, "\nExport-index human_id reconciles (file renames NOT executed — review and apply):");
          for (const e of report.export_index_reconciles) {
            printLine(inv.io.stdout, `  ${e.doc_id}  ${e.old_human_id} → ${e.new_human_id}`);
            printLine(inv.io.stdout, `    ${e.rename_command}`);
          }
        }

        if (report.errors.length > 0) {
          printLine(inv.io.stdout, "\nErrors:");
          for (const e of report.errors) {
            printLine(inv.io.stdout, `  ${e}`);
          }
        }

        if (dryRun) {
          printLine(inv.io.stdout, "\nRe-run with --apply to execute.");
        }
        setExitCode(report.errors.length > 0 ? 4 : 0);
      } finally {
        app.close();
      }
      return;
    }

    // ── prd-to-outline action ─────────────────────────────────────────────
    if (args.version === "prd-to-outline") {
      if (!args.prd) {
        inv.io.stderr.write("Error: --prd <id-or-slug> is required for `migrate prd-to-outline`.\n");
        exitCli(2);
      }

      const dryRun = args["dry-run"] ?? false;
      const { app } = loadLoreApp({ inv });
      try {
        if (app.outlineMigrationService === undefined) {
          inv.io.stderr.write("Internal error: OutlineMigrationService not wired on App\n");
          setExitCode(1);
          return;
        }
        const service = app.outlineMigrationService;

        const prdResult = await app.corpusService.get(args.prd);
        if (!prdResult.ok) {
          inv.io.stderr.write(formatErrorFor(inv, prdResult.error) + "\n");
          setExitCode(exitCode(prdResult.error));
          return;
        }
        const prd = prdResult.value.doc;

        // A section key may be declared 0, 1, or N times (citty collapses
        // repeated `--section` occurrences into a string array; a single
        // occurrence stays a bare string).
        const requestedSections =
          args.section === undefined ? [] : Array.isArray(args.section) ? args.section : [args.section];

        if (requestedSections.length === 0) {
          inv.io.stderr.write(
            "Error: at least one --section <key> is required for `migrate prd-to-outline` (no auto-discovery — declare which sections to migrate).\n",
          );
          exitCli(2);
        }

        const verdicts: SectionMigrationVerdict[] = [];
        let refused: { section: string; code: string; message: string; failed_invariants: string[] } | undefined;

        for (const section of requestedSections) {
          const result = await service.migrateSection(prd.id, section, { dryRun });
          if (!result.ok) {
            refused = {
              section: result.error.section,
              code: result.error.code,
              message: result.error.message,
              failed_invariants: result.error.failed_invariants,
            };
            break;
          }
          verdicts.push(result.value);
        }

        if (args.json) {
          printLine(inv.io.stdout, JSON.stringify({ ok: refused === undefined, data: { verdicts, refused } }, null, 2));
          setExitCode(refused === undefined ? 0 : 4);
          return;
        }

        const label = dryRun ? "PRD→outline migration (dry-run)" : "PRD→outline migration";
        printLine(inv.io.stdout, `${label} — ${prd.slug}`);
        printLine(inv.io.stdout, "─".repeat(40));
        for (const verdict of verdicts) {
          const statusLabel = verdict.already_migrated ? "already migrated" : verdict.passed ? "migrated" : "FAILED";
          printLine(inv.io.stdout, `[${statusLabel}] ${verdict.section} (writes: ${verdict.writes_performed})`);
          if (verdict.failed_invariants.length > 0) {
            printLine(inv.io.stdout, `  failed invariants: ${verdict.failed_invariants.join(", ")}`);
          }
        }
        if (refused !== undefined) {
          printLine(inv.io.stdout, `\nRefused on section '${refused.section}': ${refused.code} — ${refused.message}`);
          if (refused.failed_invariants.length > 0) {
            printLine(inv.io.stdout, `  failed invariants: ${refused.failed_invariants.join(", ")}`);
          }
        }
        if (dryRun && refused === undefined) {
          printLine(inv.io.stdout, "\nRe-run without --dry-run to apply changes.");
        }
        setExitCode(refused === undefined ? 0 : 4);
      } finally {
        app.close();
      }
      return;
    }

    // ── tasks-to-phases action ────────────────────────────────────────────
    if (args.version === "tasks-to-phases") {
      const dryRun = args["dry-run"] ?? false;
      const { app } = loadLoreApp({ inv });
      try {
        const service = requirePhaseMigrationService(app);
        const result = await service.migrateTasks({ dryRun });

        if (!result.ok) {
          // BUG-009 fix: a mid-run store failure now carries BOTH the underlying
          // cause AND the progress already committed before it — printing only
          // the cause (as before) left an operator with zero visibility into
          // whether ANY work landed, or whether it's safe to just re-run
          // (migrateTasks IS idempotent — see phase-migration-service.ts's own
          // module header invariants #1/#2).
          const { cause, partial } = result.error;
          inv.io.stderr.write(formatErrorFor(inv, cause) + "\n");
          inv.io.stderr.write(
            `${partial.phases_created} phases created / ${partial.tasks_archived} tasks archived / ` +
              `${partial.evidence_merged} evidence merged before failure — safe to re-run (idempotent)\n`,
          );
          setExitCode(exitCode(cause));
          return;
        }

        const report = result.value;
        if (args.json) {
          printLine(inv.io.stdout, JSON.stringify({ ok: true, data: report }, null, 2));
          return;
        }

        const label = dryRun ? "Task→phase migration (dry-run)" : "Task→phase migration complete";
        printLine(inv.io.stdout, label);
        printLine(inv.io.stdout, "─".repeat(40));
        printLine(inv.io.stdout, `Phases created:  ${report.phases_created}`);
        printLine(inv.io.stdout, `Tasks archived:  ${report.tasks_archived}`);
        printLine(inv.io.stdout, `Evidence merged: ${report.evidence_merged}`);

        if (report.warnings.length > 0) {
          printLine(inv.io.stdout, "\nWarnings:");
          for (const w of report.warnings) {
            printLine(inv.io.stdout, `  ${w}`);
          }
        }
        if (dryRun) {
          printLine(inv.io.stdout, "\nRe-run without --dry-run to apply changes.");
        }
      } finally {
        app.close();
      }
      return;
    }

    // ── phases action ─────────────────────────────────────────────────────
    if (args.version === "phases") {
      const dryRun = args["dry-run"] ?? false;
      const { app } = loadLoreApp({ inv });
      try {
        const result = await app.phaseService.migratePhases({ dryRun });

        if (!result.ok) {
          inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
          setExitCode(exitCode(result.error));
          return;
        }

        const report = result.value;
        if (args.json) {
          printLine(inv.io.stdout, JSON.stringify({ ok: true, data: report }, null, 2));
          return;
        }

        const label = dryRun ? "Phase migration (dry-run)" : "Phase migration complete";
        printLine(inv.io.stdout, label);
        printLine(inv.io.stdout, "─".repeat(40));
        printLine(inv.io.stdout, `Plans touched:  ${report.touched}`);
        printLine(inv.io.stdout, `Plans skipped:  ${report.skipped}`);
        if (dryRun) {
          printLine(inv.io.stdout, "\nRe-run without --dry-run to apply changes.");
        }
      } finally {
        app.close();
      }
      return;
    }

    // ── spec-kind action ──────────────────────────────────────────────────
    if (args.version === "spec-kind") {
      const dryRun = args["dry-run"] ?? false;
      const { app } = loadLoreApp({ inv });
      try {
        const result = await app.specKindService.migrateSpecKind({ dryRun });

        if (!result.ok) {
          inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
          setExitCode(exitCode(result.error));
          return;
        }

        const report = result.value;
        if (args.json) {
          printLine(inv.io.stdout, JSON.stringify({ ok: true, data: report }, null, 2));
          return;
        }

        const label = dryRun ? "Spec-kind audit (dry-run)" : "Spec-kind audit complete";
        printLine(inv.io.stdout, label);
        printLine(inv.io.stdout, "─".repeat(40));
        printLine(inv.io.stdout, `Specs touched:  ${report.touched}`);
        printLine(inv.io.stdout, `Specs skipped:  ${report.skipped}`);

        if (report.candidates.length > 0) {
          printLine(inv.io.stdout, "\nCandidates:");
          for (const c of report.candidates) {
            printLine(inv.io.stdout, `  ${c.slug}  "${c.title}"`);
            printLine(inv.io.stdout, `    ${c.from} → ${c.to}  (signal: "${c.signal}" in ${c.matchedIn})`);
          }
        }
        if (dryRun) {
          printLine(inv.io.stdout, "\nRe-run without --dry-run to apply changes.");
        }
      } finally {
        app.close();
      }
      return;
    }

    // ── v1 action ─────────────────────────────────────────────────────────
    if (!args.from) {
      inv.io.stderr.write("Error: --from <path> is required for `migrate v1`.\n");
      exitCli(2);
    }

    const dryRun = args["dry-run"] ?? false;
    const { app } = loadLoreApp({ inv });

    try {
      if (dryRun) {
        // Analysis only
        const analyzeResult = app.migrationService.analyze(args.from);
        if (!analyzeResult.ok) {
          inv.io.stderr.write(formatErrorFor(inv, analyzeResult.error) + "\n");
          setExitCode(exitCode(analyzeResult.error));
          return;
        }

        const report = analyzeResult.value;
        if (args.json) {
          printLine(inv.io.stdout, JSON.stringify({ ok: true, data: report }, null, 2));
          return;
        }

        printLine(inv.io.stdout, "Migration Analysis (dry-run)");
        printLine(inv.io.stdout, "─".repeat(40));
        printLine(inv.io.stdout, `Source:       ${report.source_path}`);
        printLine(inv.io.stdout, `Total files:  ${report.total_files}`);
        printLine(inv.io.stdout, `Parseable:    ${report.parseable}`);
        printLine(inv.io.stdout, `Unparseable:  ${report.unparseable.length}`);
        printLine(inv.io.stdout, `Corpus size:  ${report.estimated_corpus_size}`);

        if (report.type_mapping.length > 0) {
          printLine(inv.io.stdout, "\nType mapping:");
          for (const m of report.type_mapping) {
            printLine(inv.io.stdout, `  ${m.v1Type.padEnd(16)} → ${m.v2Type.padEnd(12)} (${m.count} docs)`);
          }
        }

        const lm = report.link_mapping;
        printLine(inv.io.stdout, `\nLinks: ${lm.total} total, ${lm.resolvable} resolvable, ${lm.broken} broken`);

        if (report.secret_warnings.length > 0) {
          printLine(inv.io.stdout, `\n⚠  ${report.secret_warnings.length} potential secret(s) detected:`);
          for (const w of report.secret_warnings.slice(0, 10)) {
            printLine(inv.io.stdout, `  ${w.file}:${w.line} — ${w.pattern}`);
            printLine(inv.io.stdout, `    ${w.snippet}`);
          }
          if (report.secret_warnings.length > 10) {
            printLine(inv.io.stdout, `  ... and ${report.secret_warnings.length - 10} more`);
          }
        }

        if (report.unparseable.length > 0) {
          printLine(inv.io.stdout, "\nUnparseable files:");
          for (const e of report.unparseable.slice(0, 10)) {
            printLine(inv.io.stdout, `  ${e.file}: ${e.error}`);
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
        inv.io.stderr.write(formatErrorFor(inv, executeResult.error) + "\n");
        setExitCode(exitCode(executeResult.error));
        return;
      }

      const migResult = executeResult.value;
      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: true, data: migResult }, null, 2));
        return;
      }

      printLine(inv.io.stdout, "Migration complete");
      printLine(inv.io.stdout, "─".repeat(40));
      printLine(inv.io.stdout, `Imported:        ${migResult.imported}`);
      printLine(inv.io.stdout, `Already existed: ${migResult.already_existed}`);
      printLine(inv.io.stdout, `Errors:          ${migResult.errors.length}`);
      printLine(inv.io.stdout, `Links created:   ${migResult.link_resolution.created}`);
      printLine(inv.io.stdout, `Links broken:    ${migResult.link_resolution.broken}`);

      if (migResult.warnings.length > 0) {
        printLine(inv.io.stdout, "\nWarnings:");
        for (const w of migResult.warnings) {
          printLine(inv.io.stdout, `  ${w}`);
        }
      }
      if (migResult.errors.length > 0) {
        printLine(inv.io.stdout, "\nErrors:");
        for (const e of migResult.errors.slice(0, 10)) {
          printLine(inv.io.stdout, `  ${e.file}: ${e.error}`);
        }
      }
    } finally {
      app.close();
    }
  },
});
