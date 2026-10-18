/**
 * lore eval — run evaluation scenarios against the current corpus.
 *
 * Subcommands:
 *   lore eval migration --from <dir> [--skip-secret-scan] [--json]
 *   lore eval tree [--json]
 *   lore eval links [--json]
 *   lore eval types [--json]
 *   lore eval fts [--json]
 *   lore eval placeholders [--json]
 *
 * Exit codes:
 *   0 — scenario ran and passed (result.passed=true)
 *   1 — scenario ran but failed (result.passed=false) or internal error
 *   2 — bad arguments
 *
 * Source: SPEC-013 §3
 */

import { defineCommand } from "citty";
import { exitCli, setExitCode } from "../run-scope.js";
import { loadLoreApp } from "../loader.js";
import {
  runMigrationCoverage,
  runTreeConsistency,
  runLinkIntegrity,
  runTypeDistribution,
  runFtsRecall,
  runPlaceholderParse,
} from "../../../eval/index.js";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";

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
  async run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    if (!args.from) {
      inv.io.stderr.write("Error: --from <dir> is required.\n");
      exitCli(2);
    }

    const { app } = loadLoreApp({ inv });

    try {
      const result = await runMigrationCoverage(args.from, app);

      if (args.json) {
        // CLI surface — console.log is intentional output here
        printLine(inv.io.stdout, JSON.stringify({ ok: result.passed, data: result }, null, 2)); // CLI surface
        setExitCode(result.passed ? 0 : 1);
        return;
      }

      // Human-readable output
      printLine(inv.io.stdout, "Eval: migration-coverage"); // CLI surface
      printLine(inv.io.stdout, "─".repeat(40)); // CLI surface
      printLine(inv.io.stdout, `Source:          ${result.source_dir}`); // CLI surface
      printLine(inv.io.stdout, `Expected:        ${result.expected_files}`); // CLI surface
      printLine(inv.io.stdout, `Imported:        ${result.imported}`); // CLI surface
      printLine(inv.io.stdout, `Already existed: ${result.already_existed}`); // CLI surface
      printLine(inv.io.stdout, `Links created:   ${result.links_created}`); // CLI surface
      printLine(inv.io.stdout, `Links broken:    ${result.links_broken}`); // CLI surface
      printLine(inv.io.stdout, `Duration:        ${result.duration_ms}ms`); // CLI surface

      if (Object.keys(result.type_distribution).length > 0) {
        printLine(inv.io.stdout, "\nType distribution:"); // CLI surface
        for (const [type, count] of Object.entries(result.type_distribution)) {
          printLine(inv.io.stdout, `  ${type.padEnd(16)} ${count}`); // CLI surface
        }
      }

      printLine(inv.io.stdout, `\nResult:        ${result.passed ? "PASSED" : "FAILED"}`); // CLI surface
      setExitCode(result.passed ? 0 : 1);
      return;
    } finally {
      app.close();
    }
  },
});

// ─── tree subcommand ──────────────────────────────────────────────────────────

const treeCommand = defineCommand({
  meta: {
    name: "tree",
    description: "Eval tree-consistency: checks for orphan docs, cycles, and invalid parent types",
  },
  args: {
    json: {
      type: "boolean",
      description: "Output result as JSON",
    },
  },
  async run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    const { app } = loadLoreApp({ inv });

    try {
      const result = await runTreeConsistency(app);

      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: result.passed, data: result }, null, 2)); // CLI surface
        setExitCode(result.passed ? 0 : 1);
        return;
      }

      // Human-readable output
      printLine(inv.io.stdout, "Eval: tree-consistency"); // CLI surface
      printLine(inv.io.stdout, "─".repeat(40)); // CLI surface
      printLine(inv.io.stdout, `Total docs:           ${result.total_docs}`); // CLI surface
      printLine(inv.io.stdout, `Orphans:              ${result.orphans}`); // CLI surface
      printLine(inv.io.stdout, `Cycles:               ${result.cycles}`); // CLI surface
      printLine(inv.io.stdout, `Invalid parent types: ${result.invalid_parent_types}`); // CLI surface
      printLine(inv.io.stdout, `Duration:             ${result.duration_ms}ms`); // CLI surface

      if (!result.passed) {
        if (result.details.orphan_ids.length > 0) {
          printLine(inv.io.stdout, "\nOrphan doc IDs (up to 10):"); // CLI surface
          for (const id of result.details.orphan_ids) {
            printLine(inv.io.stdout, `  ${id}`); // CLI surface
          }
        }

        if (result.details.cycle_paths.length > 0) {
          printLine(inv.io.stdout, "\nCycle paths (up to 10):"); // CLI surface
          for (const path of result.details.cycle_paths) {
            printLine(inv.io.stdout, `  ${path.join(" → ")}`); // CLI surface
          }
        }

        if (result.details.invalid_pairs.length > 0) {
          printLine(inv.io.stdout, "\nInvalid parent type pairs:"); // CLI surface
          for (const pair of result.details.invalid_pairs) {
            printLine(inv.io.stdout, `  ${pair.child_type}(${pair.child_id}) under ${pair.parent_type}(${pair.parent_id})`); // CLI surface
          }
        }
      }

      printLine(inv.io.stdout, `\nResult: ${result.passed ? "PASSED" : "FAILED"}`); // CLI surface
      setExitCode(result.passed ? 0 : 1);
      return;
    } finally {
      app.close();
    }
  },
});

// ─── links subcommand ─────────────────────────────────────────────────────────

const linksCommand = defineCommand({
  meta: {
    name: "links",
    description: "Eval link-integrity: checks for dangling, deleted-target, and self-loop links",
  },
  args: {
    json: {
      type: "boolean",
      description: "Output result as JSON",
    },
  },
  async run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    const { app } = loadLoreApp({ inv });

    try {
      const result = await runLinkIntegrity(app);

      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: result.passed, data: result }, null, 2)); // CLI surface
        setExitCode(result.passed ? 0 : 1);
        return;
      }

      // Human-readable output
      printLine(inv.io.stdout, "Eval: link-integrity"); // CLI surface
      printLine(inv.io.stdout, "─".repeat(40)); // CLI surface
      printLine(inv.io.stdout, `Total links:     ${result.total_links}`); // CLI surface
      printLine(inv.io.stdout, `Dangling:        ${result.dangling}`); // CLI surface
      printLine(inv.io.stdout, `To deleted:      ${result.to_deleted}`); // CLI surface
      printLine(inv.io.stdout, `Self-loops:      ${result.self_loops}`); // CLI surface
      printLine(inv.io.stdout, `Duration:        ${result.duration_ms}ms`); // CLI surface

      if (!result.passed) {
        if (result.details.dangling_links.length > 0) {
          printLine(inv.io.stdout, "\nDangling links (up to 10):"); // CLI surface
          for (const link of result.details.dangling_links) {
            printLine(inv.io.stdout, `  ${link.from_id} --[${link.type}]--> ${link.to_id}`); // CLI surface
          }
        }

        if (result.details.deleted_target_links.length > 0) {
          printLine(inv.io.stdout, "\nLinks to deleted docs (up to 10):"); // CLI surface
          for (const link of result.details.deleted_target_links) {
            printLine(inv.io.stdout, `  ${link.from_id} --[${link.type}]--> ${link.to_id} (deleted)`); // CLI surface
          }
        }

        if (result.details.self_loop_links.length > 0) {
          printLine(inv.io.stdout, "\nSelf-loop links (up to 10):"); // CLI surface
          for (const link of result.details.self_loop_links) {
            printLine(inv.io.stdout, `  ${link.from_id} --[${link.type}]--> itself`); // CLI surface
          }
        }
      }

      printLine(inv.io.stdout, `\nResult: ${result.passed ? "PASSED" : "FAILED"}`); // CLI surface
      setExitCode(result.passed ? 0 : 1);
      return;
    } finally {
      app.close();
    }
  },
});

// ─── types subcommand ─────────────────────────────────────────────────────────

const typesCommand = defineCommand({
  meta: {
    name: "types",
    description: "Eval type-distribution: checks doc type counts against configurable thresholds",
  },
  args: {
    json: {
      type: "boolean",
      description: "Output result as JSON",
    },
  },
  async run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    const { app } = loadLoreApp({ inv });

    try {
      // MVP: always runs with default thresholds.
      // reason: --config <yaml> flag for custom thresholds is deferred to future work (SPEC-013 §7).
      // The scenario function accepts custom input for programmatic use (tests, SDK).
      const result = await runTypeDistribution(app);

      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: result.passed, data: result }, null, 2)); // CLI surface
        setExitCode(result.passed ? 0 : 1);
        return;
      }

      // Human-readable output
      printLine(inv.io.stdout, "Eval: type-distribution"); // CLI surface
      printLine(inv.io.stdout, "─".repeat(40)); // CLI surface
      printLine(inv.io.stdout, "Distribution:"); // CLI surface
      for (const [type, count] of Object.entries(result.distribution)) {
        printLine(inv.io.stdout, `  ${type.padEnd(16)} ${count}`); // CLI surface
      }
      printLine(inv.io.stdout, `Duration:        ${result.duration_ms}ms`); // CLI surface

      if (result.violations.length > 0) {
        printLine(inv.io.stdout, "\nViolations:"); // CLI surface
        for (const v of result.violations) {
          const bounds = [
            v.min !== undefined ? `min=${v.min}` : null,
            v.max !== undefined ? `max=${v.max}` : null,
          ].filter(Boolean).join(", ");
          printLine(inv.io.stdout, `  ${v.type}: actual=${v.actual} (${bounds}) [${v.reason}]`); // CLI surface
        }
      }

      printLine(inv.io.stdout, `\nResult: ${result.passed ? "PASSED" : "FAILED"}`); // CLI surface
      setExitCode(result.passed ? 0 : 1);
      return;
    } finally {
      app.close();
    }
  },
});

// ─── fts subcommand ───────────────────────────────────────────────────────────

const ftsCommand = defineCommand({
  meta: {
    name: "fts",
    description: "Eval fts-recall: avg recall@K of FTS search against curated query/expected-slug fixtures",
  },
  args: {
    json: {
      type: "boolean",
      description: "Output result as JSON",
    },
  },
  async run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    const { app } = loadLoreApp({ inv });

    try {
      // MVP: always runs with default queries and threshold.
      // reason: --queries / --threshold flags deferred to future work (mirrors --config deferral in typesCommand).
      const result = await runFtsRecall(undefined, app);

      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: result.passed, data: result }, null, 2)); // CLI surface
        setExitCode(result.passed ? 0 : 1);
        return;
      }

      // Human-readable output
      printLine(inv.io.stdout, "Eval: fts-recall"); // CLI surface
      printLine(inv.io.stdout, "─".repeat(40)); // CLI surface
      printLine(inv.io.stdout, `Queries:         ${result.total_queries}`); // CLI surface
      printLine(inv.io.stdout, `Avg recall:      ${result.avg_recall.toFixed(3)}`); // CLI surface
      printLine(inv.io.stdout, `Threshold:       ${result.pass_threshold}`); // CLI surface
      printLine(inv.io.stdout, `Duration:        ${result.duration_ms}ms`); // CLI surface

      printLine(inv.io.stdout, "\nPer-query recall:"); // CLI surface
      for (const q of result.per_query) {
        const flags = [
          q.failed ? " [SEARCH FAILED]" : "",
          q.degenerate ? " [no expected slugs in corpus]" : "",
        ].join("");
        printLine(inv.io.stdout, `  "${q.query}" → recall=${q.recall.toFixed(2)} hits=${q.hits}/${q.resolved_expected_count}${flags}`); // CLI surface
      }

      printLine(inv.io.stdout, `\nResult: ${result.passed ? "PASSED" : "FAILED"}`); // CLI surface
      setExitCode(result.passed ? 0 : 1);
      return;
    } finally {
      app.close();
    }
  },
});

// ─── placeholders subcommand ──────────────────────────────────────────────────

const placeholdersCommand = defineCommand({
  meta: {
    name: "placeholders",
    description: "Eval placeholder-parse: all detected MDX placeholders resolve (no unknown components, no resolution errors)",
  },
  args: {
    json: {
      type: "boolean",
      description: "Output result as JSON",
    },
  },
  async run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    const { app } = loadLoreApp({ inv });

    try {
      const result = await runPlaceholderParse(app);

      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: result.passed, data: result }, null, 2)); // CLI surface
        setExitCode(result.passed ? 0 : 1);
        return;
      }

      // Human-readable output
      printLine(inv.io.stdout, "Eval: placeholder-parse"); // CLI surface
      printLine(inv.io.stdout, "─".repeat(40)); // CLI surface
      printLine(inv.io.stdout, `Docs scanned:         ${result.total_docs_scanned}`); // CLI surface
      printLine(inv.io.stdout, `Docs w/ placeholders: ${result.docs_with_placeholders}`); // CLI surface
      printLine(inv.io.stdout, `Placeholders found:   ${result.total_placeholders_found}`); // CLI surface
      printLine(inv.io.stdout, `Resolved:             ${result.resolved_total}`); // CLI surface
      printLine(inv.io.stdout, `Unknown warnings:     ${result.unknown_warnings}`); // CLI surface
      printLine(inv.io.stdout, `Resolution errors:    ${result.resolution_errors}`); // CLI surface
      printLine(inv.io.stdout, `Duration:             ${result.duration_ms}ms`); // CLI surface

      if (result.details.unknown_components.length > 0) {
        printLine(inv.io.stdout, "\nUnknown components (up to 10):"); // CLI surface
        for (const u of result.details.unknown_components) {
          printLine(inv.io.stdout, `  doc=${u.doc_id} <${u.component} />`); // CLI surface
        }
      }

      if (result.details.resolution_error_docs.length > 0) {
        printLine(inv.io.stdout, "\nResolution errors (up to 10):"); // CLI surface
        for (const e of result.details.resolution_error_docs) {
          printLine(inv.io.stdout, `  doc=${e.doc_id} [${e.error_code}] ${e.message}`); // CLI surface
        }
      }

      printLine(inv.io.stdout, `\nResult: ${result.passed ? "PASSED" : "FAILED"}`); // CLI surface
      setExitCode(result.passed ? 0 : 1);
      return;
    } finally {
      app.close();
    }
  },
});

// ─── eval parent command ──────────────────────────────────────────────────────

/**
 * Top-level eval command — routes to scenario subcommands.
 * Scenarios: migration (§3.1), tree (§3.2), links (§3.3), types (§3.4), fts (§3.5), placeholders (§3.6).
 * Source: SPEC-013 §3
 */
export default defineCommand({
  meta: {
    name: "eval",
    description: "Run evaluation scenarios against the corpus (SPEC-013)",
  },
  subCommands: {
    migration: migrationCommand,
    tree: treeCommand,
    links: linksCommand,
    types: typesCommand,
    fts: ftsCommand,
    placeholders: placeholdersCommand,
  },
});
