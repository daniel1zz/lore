/**
 * lore migrate <action> — corpus migration commands.
 *
 * Actions:
 *   schema [--dry-run] The ONLY command that upgrades the corpus to the binary's schema (every other command refuses an
 *                      older corpus, exit 4). Per-migration transactions; one `migrate_schema` audit row (actor, working
 *                      copy, from, to, duration). `--dry-run` lists the pending migrations; a second run writes nothing.
 *                      Logic in `../migrate-schema.ts`.
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
 *   config-keys [--apply] Rename retired keys in .lore/config.yaml (BL-D3: plan-close `prd_sync` ->
 *                      `cited_rule_check`). Preview is the DEFAULT; `--apply` changes only the key text
 *                      (every other byte identical) and the output names the file; a second run changes
 *                      nothing. Never loads the config through the app (it repairs that file).
 *   memory-limits [--apply] Remove the retired `context.memory_files.adoption` setting from .lore/config.yaml
 *                      (memory-file limits are always enforced) and list the memory-file findings a person must fix.
 *                      Preview is the DEFAULT; `--apply` removes only that setting's line (every other byte identical);
 *                      a second run changes nothing. Never loads the config through the app (it repairs that file).
 *   audit-backfill [--apply] Retire the audit completeness cut-off (`audit.verify_since`): record every version
 *                      that predates the audit writers and has no audit entry as ONE hash-chained `audit-backfill`
 *                      entry marked reconstructed (naming the version, the reason and this run), then remove the
 *                      setting from .lore/config.yaml. Preview is the DEFAULT; a second `--apply` writes nothing.
 *                      Never loads the config through the app (it repairs that file).
 *   fragments --scope user|project [--apply] Rewrite old-format context-fragment frontmatter (audience / mode /
 *                      delivery) to `inject` (+ `agents`). `--scope` is required (exit 2 without it); `user` needs no
 *                      corpus, `project` needs a lore project root. Preview is the DEFAULT and prints one line per file
 *                      (`<path>: <old> -> <new>`, `unchanged`, `refused: <reason>`); `--apply` rewrites only frontmatter
 *                      lines with a per-file hash precondition. Exit 5 if any file changed concurrently, else 4 if any
 *                      was refused, else 0. Bypasses `loadLoreApp` (no corpus DB). Logic in
 *                      `../../../flows/migrate-fragments-flow.ts`. (spec-fragment-injection-timing, BR-1376)
 *   plan-outline-exempt [--apply] Remove the legacy outline-sync exemption (`extra.prd_sync_exempt`) from
 *                      every stored plan (BL-D2, BR-250). Preview is the DEFAULT; `--apply` writes one audit
 *                      row per plan carrying the removed value; a second `--apply` writes nothing. Thin
 *                      pipe over `PlanOutlineExemptMigrationService`.
 *   outline-sections [--apply] Remove the stored outline (`extra.outline`) from every PRD, now that the
 *                      outline command family is gone. Preview is the DEFAULT; `--apply` writes one version
 *                      and one audit row per PRD (the previous version and the row's `details.removed` keep
 *                      the outline); a second `--apply` writes nothing. Thin pipe over
 *                      `OutlineSectionsRetireMigrationService`.
 */

import { dirname } from "path";
import { defineLoreCommand, exitCli } from "../cli-exit.js";
import { loadLoreApp } from "../loader.js";
import { exitCode, findLoreDbPath, formatError, formatErrorFor } from "../utils.js";
import { resolveCorpus } from "../corpus-resolution.js";
import { migrateConfigKeys, migrateMemoryLimits } from "@lore/core/node";
import { listMemoryFileFindings } from "../memory-limits-migration.js";
import { runAuditBackfillMigration } from "../audit-backfill-migration.js";
import { resolveTrackedWriteRoot } from "../working-tree-root.js";
import { requirePhaseMigrationService } from "../phase-wiring.js";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";
import { runMigrateSchema } from "../migrate-schema.js";
import { findLoreProjectRoot, runFragmentsMigration } from "../migrate-fragments-wiring.js";

export default defineLoreCommand({
  meta: {
    name: "migrate",
    description: "Corpus migration: schema (upgrade the corpus), v1 import and one-off sweeps; see `lore migrate --help`",
  },
  args: {
    version: {
      type: "positional",
      description:
        "Migration action: schema | v1 | phases | spec-kind | tasks-to-phases | outline-sections | ordinals | spec-parents | plan-outline-exempt | config-keys | memory-limits | audit-backfill | fragments" + "\n" +
        "Fragments: `fragments --scope user|project [--apply]` (rewrite old audience/mode/delivery fragment frontmatter to `inject`; preview by default, `--apply` writes; exit 5 concurrent change, 4 refused file). " +
        "Corpus migration: `schema [--dry-run]` (the ONLY command that upgrades the corpus to this binary's schema; every other command refuses an older corpus with exit 4; one audit row per upgrade), `v1 --from <path>` (v1 import), `phases` (phase schema sweep), `spec-kind` (spec_kind mistype audit), `tasks-to-phases` (task→phase doc-type sweep), `ordinals` (SPEC-084 ordinal repair migration), `spec-parents` (clear every spec parent_id; preview by default, `--apply` writes, `--revert` restores), `plan-outline-exempt` (remove the legacy outline-sync exemption from every stored plan; preview by default, `--apply` writes), `outline-sections` (remove the stored outline from every PRD, archived in its previous version; preview by default, `--apply` writes), `config-keys` (rename retired keys in .lore/config.yaml; preview by default, `--apply` writes), `memory-limits` (remove the retired memory-file adoption setting and list the findings a person must fix; preview by default, `--apply` writes), or `audit-backfill` (record pre-writer versions as reconstructed audit entries and remove the retired audit cut-off; preview by default, `--apply` writes)",
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
    apply: {
      type: "boolean",
      description: "[ordinals, spec-parents, plan-outline-exempt, outline-sections, config-keys, memory-limits, audit-backfill, fragments] Execute the migration (default is dry-run/preview-only)",
    },
    scope: {
      type: "string",
      description: "[fragments only] Layer to migrate: user | project (required)",
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
  async run(context): Promise<number> {
    const { args } = context;
    const inv = invocationOf(context);
    if (args.version === "schema") {
      // reason: the ONE command that upgrades a corpus schema; it bypasses `loadLoreApp` (which refuses the older corpus).
      return runMigrateSchema(inv, { dryRun: args["dry-run"] === true, json: args.json === true });
    }
    if (args.version === "fragments") {
      // reason: bypasses `loadLoreApp` — fragments are plain files; the user layer needs no corpus at all.
      const scope = args.scope;
      if (scope !== "user" && scope !== "project") {
        inv.io.stderr.write("Error: `migrate fragments` requires --scope user|project.\n");
        return 2;
      }
      const projectRoot = findLoreProjectRoot(inv.cwd);
      if (scope === "project" && projectRoot === null) {
        inv.io.stderr.write("Error: `migrate fragments --scope project` needs a lore project root (no .lore/ found above the current directory).\n");
        return 4;
      }
      return runFragmentsMigration(inv, { scopes: [scope], projectRoot, apply: args.apply === true });
    }
    if (
      args.version !== "v1" &&
      args.version !== "phases" &&
      args.version !== "spec-kind" &&
      args.version !== "tasks-to-phases" &&
      args.version !== "outline-sections" &&
      args.version !== "ordinals" &&
      args.version !== "spec-parents" &&
      args.version !== "plan-outline-exempt" &&
      args.version !== "config-keys" &&
      args.version !== "memory-limits" &&
      args.version !== "audit-backfill"
    ) {
      inv.io.stderr.write(
        `Error: Unknown migration action '${args.version}'. Supported: v1, phases, spec-kind, tasks-to-phases, outline-sections, ordinals, spec-parents, plan-outline-exempt, config-keys, memory-limits, audit-backfill.\n`,
      );
      exitCli(2);
    }

    // ── audit-backfill action ─────────────────────────────────────────────
    // reason: like config-keys, deliberately does NOT go through `loadLoreApp`: every other command refuses the config
    // this action repairs (the retired `audit.verify_since`), so it resolves the corpus location only and opens the
    // store itself (`runAuditBackfillMigration`).
    if (args.version === "audit-backfill") {
      const dbPath = findLoreDbPath(inv.io, inv);
      const apply = args.apply === true;
      if (apply && resolveCorpus(inv.io, inv.cwd, inv.env)?.provenance !== "own") {
        const refusal = {
          code: "VALIDATION_ERROR" as const,
          field: "gate:corpus-write:foreign-provenance",
          message: "`migrate audit-backfill --apply` writes the audit trail and config of the checkout that owns the corpus; this checkout reaches it through another one. Run it there.",
        };
        inv.io.stderr.write(formatErrorFor(inv, refusal) + "\n");
        return exitCode(refusal);
      }
      const result = await runAuditBackfillMigration({ inv, dbPath, apply });
      if (!result.ok) {
        if (args.json) {
          printLine(inv.io.stdout, JSON.stringify({ ok: false, error: result.error }, null, 2));
        } else {
          inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
        }
        return exitCode(result.error);
      }
      const { file, found, configWritten, backfill } = result.value;
      const count = backfill.reconstructed.length;
      if (args.json) {
        printLine(
          inv.io.stdout,
          JSON.stringify(
            { ok: true, data: { applied: apply, file, found, config_written: configWritten, boundary: backfill.boundary, boundary_source: backfill.boundarySource, run: backfill.run, reconstructed: backfill.reconstructed } },
            null,
            2,
          ),
        );
        return 0;
      }
      printLine(inv.io.stdout, apply ? "Audit backfill complete" : "Audit backfill (preview)");
      printLine(inv.io.stdout, "─".repeat(40));
      printLine(
        inv.io.stdout,
        found
          ? `${file}: audit.verify_since (retired; its value is not read) ${configWritten ? "removed" : "would be removed"}`
          : `${file}: no audit.verify_since setting`,
      );
      printLine(
        inv.io.stdout,
        backfill.boundary === null
          ? `Boundary: none (${backfill.boundarySource}: the audit trail is empty, so no version can be shown to predate the audit writers).`
          : `Boundary: ${backfill.boundary} (${backfill.boundarySource}). The first entry that names a version: earlier entries cannot be joined to one. Versions recorded before it without an audit entry predate the audit writers.`,
      );
      printLine(
        inv.io.stdout,
        apply
          ? `${count} version(s) recorded as reconstructed (run ${backfill.run}).`
          : `${count} version(s) would be recorded as reconstructed.`,
      );
      if (!apply && (found || count > 0)) printLine(inv.io.stdout, "\nRe-run with --apply to execute.");
      return 0;
    }

    // ── config-keys action ────────────────────────────────────────────────
    // reason: deliberately does NOT go through `loadLoreApp` — that loads (and, for a retired key, refuses) the very
    // config file this action exists to repair. It resolves the corpus location only.
    if (args.version === "config-keys") {
      const dbPath = findLoreDbPath(inv.io, inv);
      // reason: a write into another checkout's config (a linked worktree reaching the main checkout through the
      // git-common-dir fallback) is refused, like every foreign-corpus write; run it from the checkout that owns the config.
      if (args.apply === true && resolveCorpus(inv.io, inv.cwd, inv.env)?.provenance !== "own") {
        const refusal = {
          code: "VALIDATION_ERROR" as const,
          field: "gate:corpus-write:foreign-provenance",
          message: "`migrate config-keys --apply` rewrites the config of the checkout that owns the corpus; this checkout reaches it through another one. Run it there.",
        };
        inv.io.stderr.write(formatErrorFor(inv, refusal) + "\n");
        return exitCode(refusal);
      }
      const result = migrateConfigKeys(dirname(dirname(dbPath)), args.apply === true);
      if (!result.ok) {
        if (args.json) {
          printLine(inv.io.stdout, JSON.stringify({ ok: false, error: result.error }, null, 2));
        } else {
          inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
        }
        return exitCode(result.error);
      }
      const report = result.value;
      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { applied: args.apply === true, ...report } }, null, 2));
        return 0;
      }
      printLine(inv.io.stdout, args.apply === true ? "Config key migration complete" : "Config key migration (preview)");
      printLine(inv.io.stdout, "─".repeat(40));
      printLine(inv.io.stdout, report.notice ?? `${report.file}: no retired keys`);
      if (report.renamed && !report.written) printLine(inv.io.stdout, "\nRe-run with --apply to execute.");
      return 0;
    }

    // ── memory-limits action ──────────────────────────────────────────────
    // reason: like config-keys, deliberately does NOT go through `loadLoreApp`: every other command refuses the config
    // this action repairs (the retired adoption setting), so it resolves the corpus location only.
    if (args.version === "memory-limits") {
      const dbPath = findLoreDbPath(inv.io, inv);
      if (args.apply === true && resolveCorpus(inv.io, inv.cwd, inv.env)?.provenance !== "own") {
        const refusal = {
          code: "VALIDATION_ERROR" as const,
          field: "gate:corpus-write:foreign-provenance",
          message: "`migrate memory-limits --apply` rewrites the config of the checkout that owns the corpus; this checkout reaches it through another one. Run it there.",
        };
        inv.io.stderr.write(formatErrorFor(inv, refusal) + "\n");
        return exitCode(refusal);
      }
      const projectDir = dirname(dirname(dbPath));
      const apply = args.apply === true;
      const result = migrateMemoryLimits(projectDir, apply);
      if (!result.ok) {
        if (args.json) {
          printLine(inv.io.stdout, JSON.stringify({ ok: false, error: result.error }, null, 2));
        } else {
          inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
        }
        return exitCode(result.error);
      }
      const report = result.value;
      const findings = listMemoryFileFindings(projectDir, report.text);
      if (!findings.ok) {
        inv.io.stderr.write(formatErrorFor(inv, findings.error) + "\n");
        return exitCode(findings.error);
      }
      if (args.json) {
        printLine(
          inv.io.stdout,
          JSON.stringify(
            { ok: true, data: { applied: apply, file: report.file, found: report.found, value: report.value ?? null, written: report.written, findings: findings.value } },
            null,
            2,
          ),
        );
        return 0;
      }
      printLine(inv.io.stdout, apply ? "Memory limits migration complete" : "Memory limits migration (preview)");
      printLine(inv.io.stdout, "─".repeat(40));
      printLine(
        inv.io.stdout,
        report.found
          ? `${report.file}: context.memory_files.adoption: ${String(report.value)} ${report.written ? "removed" : "would be removed"}`
          : `${report.file}: no adoption setting`,
      );
      for (const entry of findings.value) {
        printLine(inv.io.stdout, `${entry.path}: a person must fix ${entry.lines.length} finding(s):`);
        for (const line of entry.lines) printLine(inv.io.stdout, `  ${line}`);
      }
      if (report.found && !report.written) printLine(inv.io.stdout, "\nRe-run with --apply to execute.");
      return 0;
    }

    // ── plan-outline-exempt action ────────────────────────────────────────
    if (args.version === "plan-outline-exempt") {
      const { app } = loadLoreApp({ inv });
      try {
        const service = app.planOutlineExemptMigrationService;
        if (service === undefined) {
          inv.io.stderr.write("Internal error: PlanOutlineExemptMigrationService not wired on App\n");
          return 1;
        }
        const apply = args.apply === true;
        const result = apply ? await service.apply() : await service.preview();
        if (!result.ok) {
          if (args.json) {
            printLine(inv.io.stdout, JSON.stringify({ ok: false, error: result.error }, null, 2));
          } else {
            inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
          }
          return exitCode(result.error);
        }
        const report = result.value;
        const failed = report.errors.length > 0;
        if (args.json) {
          printLine(
            inv.io.stdout,
            JSON.stringify(
              { ok: !failed, data: { applied: apply, count: report.count, slugs: report.rows.map((r) => r.slug), errors: report.errors } },
              null,
              2,
            ),
          );
          return failed ? 4 : 0;
        }
        printLine(inv.io.stdout, apply ? "Plan outline-exempt migration complete" : "Plan outline-exempt migration (preview)");
        printLine(inv.io.stdout, "─".repeat(40));
        printLine(inv.io.stdout, `Plans ${apply ? "cleared" : "would clear"}: ${report.count}`);
        for (const row of report.rows) printLine(inv.io.stdout, `  ${row.slug}`);
        for (const e of report.errors) printLine(inv.io.stdout, `  error ${e}`);
        if (!apply) printLine(inv.io.stdout, "\nRe-run with --apply to execute.");
        return failed ? 4 : 0;
      } finally {
        app.close();
      }
    }

    // ── outline-sections action ───────────────────────────────────────────
    if (args.version === "outline-sections") {
      const { app } = loadLoreApp({ inv });
      try {
        const service = app.outlineSectionsRetireMigrationService;
        if (service === undefined) {
          inv.io.stderr.write("Internal error: OutlineSectionsRetireMigrationService not wired on App\n");
          return 1;
        }
        const apply = args.apply === true;
        const result = apply ? await service.apply() : await service.preview();
        if (!result.ok) {
          if (args.json) {
            printLine(inv.io.stdout, JSON.stringify({ ok: false, error: result.error }, null, 2));
          } else {
            inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
          }
          return exitCode(result.error);
        }
        const report = result.value;
        const failed = report.errors.length > 0;
        if (args.json) {
          printLine(
            inv.io.stdout,
            JSON.stringify(
              { ok: !failed, data: { applied: apply, count: report.count, slugs: report.rows.map((r) => r.slug), errors: report.errors } },
              null,
              2,
            ),
          );
          return failed ? 4 : 0;
        }
        printLine(inv.io.stdout, apply ? "Outline-sections migration complete" : "Outline-sections migration (preview)");
        printLine(inv.io.stdout, "─".repeat(40));
        printLine(inv.io.stdout, `PRDs ${apply ? "cleared" : "would clear"}: ${report.count}`);
        for (const row of report.rows) printLine(inv.io.stdout, `  ${row.slug}`);
        for (const e of report.errors) printLine(inv.io.stdout, `  error ${e}`);
        if (apply && report.count > 0) printLine(inv.io.stdout, "\nThe removed outline stays readable in each PRD's previous version (`lore log <prd>`, `lore diff <prd>`) and in the audit row (`details.removed`).");
        if (!apply) printLine(inv.io.stdout, "\nRe-run with --apply to execute.");
        return failed ? 4 : 0;
      } finally {
        app.close();
      }
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
          return 1;
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
          return exitCode(result.error);
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
          return failed ? 4 : 0;
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
        return failed ? 4 : 0;
      } finally {
        app.close();
      }
      return 0;
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
        return exitCode(projectDirResolved.error);
      }
      const projectDir = projectDirResolved.value;
      try {
        if (app.ordinalMigrationService === undefined) {
          inv.io.stderr.write("Internal error: OrdinalMigrationService not wired on App\n");
          return 1;
        }

        const result = await app.ordinalMigrationService.migrateOrdinals({ dryRun, projectDir });
        if (!result.ok) {
          if (args.json) {
            printLine(inv.io.stdout, JSON.stringify({ ok: false, error: result.error }, null, 2));
          } else {
            inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
          }
          return exitCode(result.error);
        }

        const report = result.value;
        if (args.json) {
          printLine(inv.io.stdout, JSON.stringify({ ok: true, data: report }, null, 2));
          return report.errors.length > 0 ? 4 : 0;
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
        return report.errors.length > 0 ? 4 : 0;
      } finally {
        app.close();
      }
      return 0;
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
          return exitCode(cause);
        }

        const report = result.value;
        if (args.json) {
          printLine(inv.io.stdout, JSON.stringify({ ok: true, data: report }, null, 2));
          return 0;
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
      return 0;
    }

    // ── phases action ─────────────────────────────────────────────────────
    if (args.version === "phases") {
      const dryRun = args["dry-run"] ?? false;
      const { app } = loadLoreApp({ inv });
      try {
        const result = await app.phaseService.migratePhases({ dryRun });

        if (!result.ok) {
          inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
          return exitCode(result.error);
        }

        const report = result.value;
        if (args.json) {
          printLine(inv.io.stdout, JSON.stringify({ ok: true, data: report }, null, 2));
          return 0;
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
      return 0;
    }

    // ── spec-kind action ──────────────────────────────────────────────────
    if (args.version === "spec-kind") {
      const dryRun = args["dry-run"] ?? false;
      const { app } = loadLoreApp({ inv });
      try {
        const result = await app.specKindService.migrateSpecKind({ dryRun });

        if (!result.ok) {
          inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
          return exitCode(result.error);
        }

        const report = result.value;
        if (args.json) {
          printLine(inv.io.stdout, JSON.stringify({ ok: true, data: report }, null, 2));
          return 0;
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
      return 0;
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
          return exitCode(analyzeResult.error);
        }

        const report = analyzeResult.value;
        if (args.json) {
          printLine(inv.io.stdout, JSON.stringify({ ok: true, data: report }, null, 2));
          return 0;
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

        return 0;
      }

      // Execute migration
      const executeResult = await app.migrationService.execute(args.from, {
        dryRun: false,
        skipSecretScan: args["skip-secret-scan"] ?? false,
        idStrategy: (args["id-strategy"] as "preserve" | "remap") ?? "remap",
      });

      if (!executeResult.ok) {
        inv.io.stderr.write(formatErrorFor(inv, executeResult.error) + "\n");
        return exitCode(executeResult.error);
      }

      const migResult = executeResult.value;
      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: true, data: migResult }, null, 2));
        return 0;
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
    return 0;
  },
});
