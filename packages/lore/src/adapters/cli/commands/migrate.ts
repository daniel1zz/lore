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
 */

import { dirname } from "path";
import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError } from "../utils.js";
import { requirePhaseMigrationService } from "../phase-wiring.js";
import type { SectionMigrationVerdict } from "../../../service/outline-migration-service.js";

export default defineCommand({
  meta: {
    name: "migrate",
    description:
      "Corpus migration: `v1 --from <path>` (v1 import), `phases` (phase schema sweep), `spec-kind` (spec_kind mistype audit), `tasks-to-phases` (task→phase doc-type sweep), `prd-to-outline` (per-section PRD→outline domain relocation), or `ordinals` (SPEC-084 ordinal repair migration)",
  },
  args: {
    version: {
      type: "positional",
      description: "Migration action: v1 | phases | spec-kind | tasks-to-phases | prd-to-outline | ordinals",
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
      description: "[ordinals only] Execute the migration (default is dry-run/preview-only)",
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
    if (
      args.version !== "v1" &&
      args.version !== "phases" &&
      args.version !== "spec-kind" &&
      args.version !== "tasks-to-phases" &&
      args.version !== "prd-to-outline" &&
      args.version !== "ordinals"
    ) {
      process.stderr.write(
        `Error: Unknown migration action '${args.version}'. Supported: v1, phases, spec-kind, tasks-to-phases, prd-to-outline, ordinals.\n`,
      );
      process.exit(2);
    }

    // ── ordinals action ───────────────────────────────────────────────────
    if (args.version === "ordinals") {
      const dryRun = !(args.apply ?? false);
      const { app, dbPath } = loadLoreApp();
      // reason: export-index.json lives at <projectDir>/.lore/export-index.json —
      // same derivation ExportDocsService's own CLI command uses (dbPath = <projectDir>/.lore/lore.db).
      const projectDir = dirname(dirname(dbPath));
      try {
        if (app.ordinalMigrationService === undefined) {
          process.stderr.write("Internal error: OrdinalMigrationService not wired on App\n");
          process.exitCode = 1;
          return;
        }

        const result = await app.ordinalMigrationService.migrateOrdinals({ dryRun, projectDir });
        if (!result.ok) {
          if (args.json) {
            console.log(JSON.stringify({ ok: false, error: result.error }, null, 2));
          } else {
            process.stderr.write(formatError(result.error) + "\n");
          }
          process.exitCode = exitCode(result.error);
          return;
        }

        const report = result.value;
        if (args.json) {
          console.log(JSON.stringify({ ok: true, data: report }, null, 2));
          process.exitCode = report.errors.length > 0 ? 4 : 0;
          return;
        }

        const label = dryRun ? "Ordinal migration (dry-run)" : "Ordinal migration complete";
        console.log(label);
        console.log("─".repeat(40));
        console.log(`Numbered docs:        ${report.numbered_doc_count}`);
        console.log(`Bijective:            ${report.bijective ? "yes" : "NO — see errors below"}`);
        console.log(`Writes performed:     ${report.writes_performed}`);

        if (report.reassignments.length > 0) {
          console.log("\nOrdinal assignments (old → new):");
          for (const r of report.reassignments) {
            const oldLabel = r.old_display ?? "(no declared number)";
            const marker = r.changed ? "CHANGED" : "kept";
            console.log(`  [${marker}] ${r.doc_id}  ${oldLabel} → ${r.new_display}  "${r.title}"`);
          }
        }

        if (report.title_strips.length > 0) {
          console.log("\nTitle prefix strips:");
          for (const t of report.title_strips) {
            console.log(`  ${t.doc_id}  "${t.old_title}" → "${t.new_title}" (status: ${t.status_before})`);
          }
        }

        if (report.export_index_reconciles.length > 0) {
          console.log("\nExport-index human_id reconciles (file renames NOT executed — review and apply):");
          for (const e of report.export_index_reconciles) {
            console.log(`  ${e.doc_id}  ${e.old_human_id} → ${e.new_human_id}`);
            console.log(`    ${e.rename_command}`);
          }
        }

        if (report.errors.length > 0) {
          console.log("\nErrors:");
          for (const e of report.errors) {
            console.log(`  ${e}`);
          }
        }

        if (dryRun) {
          console.log("\nRe-run with --apply to execute.");
        }
        process.exitCode = report.errors.length > 0 ? 4 : 0;
      } finally {
        app.close();
      }
      return;
    }

    // ── prd-to-outline action ─────────────────────────────────────────────
    if (args.version === "prd-to-outline") {
      if (!args.prd) {
        process.stderr.write("Error: --prd <id-or-slug> is required for `migrate prd-to-outline`.\n");
        process.exit(2);
      }

      const dryRun = args["dry-run"] ?? false;
      const { app } = loadLoreApp();
      try {
        if (app.outlineMigrationService === undefined) {
          process.stderr.write("Internal error: OutlineMigrationService not wired on App\n");
          process.exitCode = 1;
          return;
        }
        const service = app.outlineMigrationService;

        const prdResult = await app.corpusService.get(args.prd);
        if (!prdResult.ok) {
          process.stderr.write(formatError(prdResult.error) + "\n");
          process.exitCode = exitCode(prdResult.error);
          return;
        }
        const prd = prdResult.value.doc;

        // A section key may be declared 0, 1, or N times (citty collapses
        // repeated `--section` occurrences into a string array; a single
        // occurrence stays a bare string).
        const requestedSections =
          args.section === undefined ? [] : Array.isArray(args.section) ? args.section : [args.section];

        if (requestedSections.length === 0) {
          process.stderr.write(
            "Error: at least one --section <key> is required for `migrate prd-to-outline` (no auto-discovery — declare which sections to migrate).\n",
          );
          process.exit(2);
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
          console.log(JSON.stringify({ ok: refused === undefined, data: { verdicts, refused } }, null, 2));
          process.exitCode = refused === undefined ? 0 : 4;
          return;
        }

        const label = dryRun ? "PRD→outline migration (dry-run)" : "PRD→outline migration";
        console.log(`${label} — ${prd.slug}`);
        console.log("─".repeat(40));
        for (const verdict of verdicts) {
          const statusLabel = verdict.already_migrated ? "already migrated" : verdict.passed ? "migrated" : "FAILED";
          console.log(`[${statusLabel}] ${verdict.section} (writes: ${verdict.writes_performed})`);
          if (verdict.failed_invariants.length > 0) {
            console.log(`  failed invariants: ${verdict.failed_invariants.join(", ")}`);
          }
        }
        if (refused !== undefined) {
          console.log(`\nRefused on section '${refused.section}': ${refused.code} — ${refused.message}`);
          if (refused.failed_invariants.length > 0) {
            console.log(`  failed invariants: ${refused.failed_invariants.join(", ")}`);
          }
        }
        if (dryRun && refused === undefined) {
          console.log("\nRe-run without --dry-run to apply changes.");
        }
        process.exitCode = refused === undefined ? 0 : 4;
      } finally {
        app.close();
      }
      return;
    }

    // ── tasks-to-phases action ────────────────────────────────────────────
    if (args.version === "tasks-to-phases") {
      const dryRun = args["dry-run"] ?? false;
      const { app } = loadLoreApp();
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
          process.stderr.write(formatError(cause) + "\n");
          process.stderr.write(
            `${partial.phases_created} phases created / ${partial.tasks_archived} tasks archived / ` +
              `${partial.evidence_merged} evidence merged before failure — safe to re-run (idempotent)\n`,
          );
          process.exitCode = exitCode(cause);
          return;
        }

        const report = result.value;
        if (args.json) {
          console.log(JSON.stringify({ ok: true, data: report }, null, 2));
          return;
        }

        const label = dryRun ? "Task→phase migration (dry-run)" : "Task→phase migration complete";
        console.log(label);
        console.log("─".repeat(40));
        console.log(`Phases created:  ${report.phases_created}`);
        console.log(`Tasks archived:  ${report.tasks_archived}`);
        console.log(`Evidence merged: ${report.evidence_merged}`);

        if (report.warnings.length > 0) {
          console.log("\nWarnings:");
          for (const w of report.warnings) {
            console.log(`  ${w}`);
          }
        }
        if (dryRun) {
          console.log("\nRe-run without --dry-run to apply changes.");
        }
      } finally {
        app.close();
      }
      return;
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

    // ── spec-kind action ──────────────────────────────────────────────────
    if (args.version === "spec-kind") {
      const dryRun = args["dry-run"] ?? false;
      const { app } = loadLoreApp();
      try {
        const result = await app.specKindService.migrateSpecKind({ dryRun });

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

        const label = dryRun ? "Spec-kind audit (dry-run)" : "Spec-kind audit complete";
        console.log(label);
        console.log("─".repeat(40));
        console.log(`Specs touched:  ${report.touched}`);
        console.log(`Specs skipped:  ${report.skipped}`);

        if (report.candidates.length > 0) {
          console.log("\nCandidates:");
          for (const c of report.candidates) {
            console.log(`  ${c.slug}  "${c.title}"`);
            console.log(`    ${c.from} → ${c.to}  (signal: "${c.signal}" in ${c.matchedIn})`);
          }
        }
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
