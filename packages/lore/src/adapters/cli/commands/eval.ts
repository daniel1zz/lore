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
import { loadLoreApp } from "../loader.js";
import {
  runMigrationCoverage,
  runTreeConsistency,
  runLinkIntegrity,
  runTypeDistribution,
  runFtsRecall,
  runPlaceholderParse,
} from "../../../eval/index.js";

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
  async run({ args }) {
    if (!args.from) {
      process.stderr.write("Error: --from <dir> is required.\n");
      process.exit(2);
    }

    const { app } = loadLoreApp();

    try {
      const result = await runMigrationCoverage(args.from, app);

      if (args.json) {
        // CLI surface — console.log is intentional output here
        console.log(JSON.stringify({ ok: result.passed, data: result }, null, 2)); // CLI surface
        process.exit(result.passed ? 0 : 1);
      }

      // Human-readable output
      console.log("Eval: migration-coverage"); // CLI surface
      console.log("─".repeat(40)); // CLI surface
      console.log(`Source:          ${result.source_dir}`); // CLI surface
      console.log(`Expected:        ${result.expected_files}`); // CLI surface
      console.log(`Imported:        ${result.imported}`); // CLI surface
      console.log(`Already existed: ${result.already_existed}`); // CLI surface
      console.log(`Links created:   ${result.links_created}`); // CLI surface
      console.log(`Links broken:    ${result.links_broken}`); // CLI surface
      console.log(`Duration:        ${result.duration_ms}ms`); // CLI surface

      if (Object.keys(result.type_distribution).length > 0) {
        console.log("\nType distribution:"); // CLI surface
        for (const [type, count] of Object.entries(result.type_distribution)) {
          console.log(`  ${type.padEnd(16)} ${count}`); // CLI surface
        }
      }

      console.log(`\nResult:        ${result.passed ? "PASSED" : "FAILED"}`); // CLI surface
      process.exit(result.passed ? 0 : 1);
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
  async run({ args }) {
    const { app } = loadLoreApp();

    try {
      const result = await runTreeConsistency(app);

      if (args.json) {
        console.log(JSON.stringify({ ok: result.passed, data: result }, null, 2)); // CLI surface
        process.exit(result.passed ? 0 : 1);
      }

      // Human-readable output
      console.log("Eval: tree-consistency"); // CLI surface
      console.log("─".repeat(40)); // CLI surface
      console.log(`Total docs:           ${result.total_docs}`); // CLI surface
      console.log(`Orphans:              ${result.orphans}`); // CLI surface
      console.log(`Cycles:               ${result.cycles}`); // CLI surface
      console.log(`Invalid parent types: ${result.invalid_parent_types}`); // CLI surface
      console.log(`Duration:             ${result.duration_ms}ms`); // CLI surface

      if (!result.passed) {
        if (result.details.orphan_ids.length > 0) {
          console.log("\nOrphan doc IDs (up to 10):"); // CLI surface
          for (const id of result.details.orphan_ids) {
            console.log(`  ${id}`); // CLI surface
          }
        }

        if (result.details.cycle_paths.length > 0) {
          console.log("\nCycle paths (up to 10):"); // CLI surface
          for (const path of result.details.cycle_paths) {
            console.log(`  ${path.join(" → ")}`); // CLI surface
          }
        }

        if (result.details.invalid_pairs.length > 0) {
          console.log("\nInvalid parent type pairs:"); // CLI surface
          for (const pair of result.details.invalid_pairs) {
            console.log(`  ${pair.child_type}(${pair.child_id}) under ${pair.parent_type}(${pair.parent_id})`); // CLI surface
          }
        }
      }

      console.log(`\nResult: ${result.passed ? "PASSED" : "FAILED"}`); // CLI surface
      process.exit(result.passed ? 0 : 1);
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
  async run({ args }) {
    const { app } = loadLoreApp();

    try {
      const result = await runLinkIntegrity(app);

      if (args.json) {
        console.log(JSON.stringify({ ok: result.passed, data: result }, null, 2)); // CLI surface
        process.exit(result.passed ? 0 : 1);
      }

      // Human-readable output
      console.log("Eval: link-integrity"); // CLI surface
      console.log("─".repeat(40)); // CLI surface
      console.log(`Total links:     ${result.total_links}`); // CLI surface
      console.log(`Dangling:        ${result.dangling}`); // CLI surface
      console.log(`To deleted:      ${result.to_deleted}`); // CLI surface
      console.log(`Self-loops:      ${result.self_loops}`); // CLI surface
      console.log(`Duration:        ${result.duration_ms}ms`); // CLI surface

      if (!result.passed) {
        if (result.details.dangling_links.length > 0) {
          console.log("\nDangling links (up to 10):"); // CLI surface
          for (const link of result.details.dangling_links) {
            console.log(`  ${link.from_id} --[${link.type}]--> ${link.to_id}`); // CLI surface
          }
        }

        if (result.details.deleted_target_links.length > 0) {
          console.log("\nLinks to deleted docs (up to 10):"); // CLI surface
          for (const link of result.details.deleted_target_links) {
            console.log(`  ${link.from_id} --[${link.type}]--> ${link.to_id} (deleted)`); // CLI surface
          }
        }

        if (result.details.self_loop_links.length > 0) {
          console.log("\nSelf-loop links (up to 10):"); // CLI surface
          for (const link of result.details.self_loop_links) {
            console.log(`  ${link.from_id} --[${link.type}]--> itself`); // CLI surface
          }
        }
      }

      console.log(`\nResult: ${result.passed ? "PASSED" : "FAILED"}`); // CLI surface
      process.exit(result.passed ? 0 : 1);
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
  async run({ args }) {
    const { app } = loadLoreApp();

    try {
      // MVP: always runs with default thresholds.
      // reason: --config <yaml> flag for custom thresholds is deferred to future work (SPEC-013 §7).
      // The scenario function accepts custom input for programmatic use (tests, SDK).
      const result = await runTypeDistribution(app);

      if (args.json) {
        console.log(JSON.stringify({ ok: result.passed, data: result }, null, 2)); // CLI surface
        process.exit(result.passed ? 0 : 1);
      }

      // Human-readable output
      console.log("Eval: type-distribution"); // CLI surface
      console.log("─".repeat(40)); // CLI surface
      console.log("Distribution:"); // CLI surface
      for (const [type, count] of Object.entries(result.distribution)) {
        console.log(`  ${type.padEnd(16)} ${count}`); // CLI surface
      }
      console.log(`Duration:        ${result.duration_ms}ms`); // CLI surface

      if (result.violations.length > 0) {
        console.log("\nViolations:"); // CLI surface
        for (const v of result.violations) {
          const bounds = [
            v.min !== undefined ? `min=${v.min}` : null,
            v.max !== undefined ? `max=${v.max}` : null,
          ].filter(Boolean).join(", ");
          console.log(`  ${v.type}: actual=${v.actual} (${bounds}) [${v.reason}]`); // CLI surface
        }
      }

      console.log(`\nResult: ${result.passed ? "PASSED" : "FAILED"}`); // CLI surface
      process.exit(result.passed ? 0 : 1);
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
  async run({ args }) {
    const { app } = loadLoreApp();

    try {
      // MVP: always runs with default queries and threshold.
      // reason: --queries / --threshold flags deferred to future work (mirrors --config deferral in typesCommand).
      const result = await runFtsRecall(undefined, app);

      if (args.json) {
        console.log(JSON.stringify({ ok: result.passed, data: result }, null, 2)); // CLI surface
        process.exit(result.passed ? 0 : 1);
      }

      // Human-readable output
      console.log("Eval: fts-recall"); // CLI surface
      console.log("─".repeat(40)); // CLI surface
      console.log(`Queries:         ${result.total_queries}`); // CLI surface
      console.log(`Avg recall:      ${result.avg_recall.toFixed(3)}`); // CLI surface
      console.log(`Threshold:       ${result.pass_threshold}`); // CLI surface
      console.log(`Duration:        ${result.duration_ms}ms`); // CLI surface

      console.log("\nPer-query recall:"); // CLI surface
      for (const q of result.per_query) {
        const flags = [
          q.failed ? " [SEARCH FAILED]" : "",
          q.degenerate ? " [no expected slugs in corpus]" : "",
        ].join("");
        console.log(`  "${q.query}" → recall=${q.recall.toFixed(2)} hits=${q.hits}/${q.resolved_expected_count}${flags}`); // CLI surface
      }

      console.log(`\nResult: ${result.passed ? "PASSED" : "FAILED"}`); // CLI surface
      process.exit(result.passed ? 0 : 1);
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
  async run({ args }) {
    const { app } = loadLoreApp();

    try {
      const result = await runPlaceholderParse(app);

      if (args.json) {
        console.log(JSON.stringify({ ok: result.passed, data: result }, null, 2)); // CLI surface
        process.exit(result.passed ? 0 : 1);
      }

      // Human-readable output
      console.log("Eval: placeholder-parse"); // CLI surface
      console.log("─".repeat(40)); // CLI surface
      console.log(`Docs scanned:         ${result.total_docs_scanned}`); // CLI surface
      console.log(`Docs w/ placeholders: ${result.docs_with_placeholders}`); // CLI surface
      console.log(`Placeholders found:   ${result.total_placeholders_found}`); // CLI surface
      console.log(`Resolved:             ${result.resolved_total}`); // CLI surface
      console.log(`Unknown warnings:     ${result.unknown_warnings}`); // CLI surface
      console.log(`Resolution errors:    ${result.resolution_errors}`); // CLI surface
      console.log(`Duration:             ${result.duration_ms}ms`); // CLI surface

      if (result.details.unknown_components.length > 0) {
        console.log("\nUnknown components (up to 10):"); // CLI surface
        for (const u of result.details.unknown_components) {
          console.log(`  doc=${u.doc_id} <${u.component} />`); // CLI surface
        }
      }

      if (result.details.resolution_error_docs.length > 0) {
        console.log("\nResolution errors (up to 10):"); // CLI surface
        for (const e of result.details.resolution_error_docs) {
          console.log(`  doc=${e.doc_id} [${e.error_code}] ${e.message}`); // CLI surface
        }
      }

      console.log(`\nResult: ${result.passed ? "PASSED" : "FAILED"}`); // CLI surface
      process.exit(result.passed ? 0 : 1);
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
