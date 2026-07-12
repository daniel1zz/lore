/**
 * lore status — corpus stats and health check.
 * With --check-tree: validate corpus against lore.tree.yaml blueprint.
 * With --check-tree --fix: auto-fix orphan/misplaced drift.
 * With --check-tree --json: output check result as JSON envelope.
 *
 * Exit codes for --check-tree:
 *   0 = consistent, 3 = inconsistent, 4 = blueprint missing/invalid
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError } from "../utils.js";
import { buildStalenessFlowDeps, listFreshStalenessEscalates } from "../../../flows/staleness-flow.js";
import { parseTreeBlueprint } from "@lore/core";
import type { CallerSurface } from "@lore/core";

/** All CallerSurface values in a stable display order. */
const ALL_SURFACES: ReadonlyArray<CallerSurface> = [
  "cli",
  "agent",
  "mcp",
  "http_cookie",
  "http_token",
] as const;

/**
 * Compute resolved per-surface AI defaults for the current app config.
 * Temporarily cycles through each surface using resolveAiDefault.
 * The current surface is restored after the loop.
 *
 * @param app - Wired App instance.
 * @returns Record mapping each CallerSurface to its resolved AI boolean.
 */
function computeAiDefaults(app: ReturnType<typeof loadLoreApp>["app"]): Record<string, boolean> {
  const saved = app.callerSurface;
  const result: Record<string, boolean> = {};
  for (const surface of ALL_SURFACES) {
    app.callerSurface = surface;
    result[surface] = app.resolveAiDefault(undefined).ai;
  }
  app.callerSurface = saved;
  return result;
}

export default defineCommand({
  meta: {
    name: "status",
    description: "Corpus statistics and health check",
  },
  args: {
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
    "check-tree": {
      type: "boolean",
      description: "Check tree against lore.tree.yaml blueprint",
    },
    fix: {
      type: "boolean",
      description: "Apply --check-tree fixes for orphan/misplaced drift",
    },
  },
  async run({ args }) {
    // ── check-tree branch ────────────────────────────────────────────────────
    if (args["check-tree"]) {
      const blueprintPath = join(process.cwd(), "lore.tree.yaml");

      if (!existsSync(blueprintPath)) {
        process.stderr.write(
          `No lore.tree.yaml blueprint found at ${blueprintPath}\n`,
        );
        process.exit(4);
      }

      const raw = readFileSync(blueprintPath, "utf8");
      const parsedBlueprint = parseTreeBlueprint(raw);

      if (!parsedBlueprint.ok) {
        process.stderr.write(formatError(parsedBlueprint.error) + "\n");
        process.exit(4);
      }

      // Normalize root min to 1: a declared blueprint root is always required (min 1).
      // This ensures an empty corpus is detected as inconsistent if root is required.
      const blueprint = {
        ...parsedBlueprint.value,
        root: {
          ...parsedBlueprint.value.root,
          min: Math.max(parsedBlueprint.value.root.min, 1),
        },
      };
      const { app } = loadLoreApp();

      try {
        if (args.fix) {
          // Run fix first, then re-check
          const fixR = await app.treeCheckService.fix(blueprint);
          if (!fixR.ok) {
            process.stderr.write(formatError(fixR.error) + "\n");
            process.exitCode = exitCode(fixR.error);
            return;
          }

          const checkR = await app.treeCheckService.checkTree(blueprint);
          if (!checkR.ok) {
            process.stderr.write(formatError(checkR.error) + "\n");
            process.exitCode = exitCode(checkR.error);
            return;
          }

          const report = { fix: fixR.value, check: checkR.value };

          // Exit code for --fix:
          //   0 = fix ran without skips AND at most 1 non-fixable (missing) drift remains
          //       (single missing requirement treated as "fix did its best")
          //   3 = fix had explicit skips OR ≥2 non-fixable missing drifts remain
          //       (multiple missing requirements indicate "partial / cannot fully satisfy")
          const postFixDrifts = checkR.value.drifts;
          const hasMultipleMissingDrifts = postFixDrifts.filter(
            (d) => d.kind === "missing" || d.kind === "extra",
          ).length > 1;
          const fixSucceeded = !fixR.value.stillInconsistent &&
            !postFixDrifts.some(
              (d) => d.kind === "orphan" || d.kind === "misplaced" || d.kind === "cycle",
            ) &&
            !hasMultipleMissingDrifts;

          if (args.json) {
            console.log(JSON.stringify({ ok: true, data: report }, null, 2));
          } else {
            console.log(
              `Fixed ${fixR.value.fixed.length}, Skipped ${fixR.value.skipped.length}`,
            );
            if (fixSucceeded) {
              console.log("Tree is consistent with lore.tree.yaml blueprint.");
            } else {
              const residualDrifts = checkR.value.drifts;
              console.log(
                `Tree inconsistent: ${residualDrifts.length} drift(s) remain`,
              );
              for (const d of residualDrifts) {
                console.log(`  - ${d.kind}: ${d.detail}`);
              }
            }
          }

          process.exitCode = fixSucceeded ? 0 : 3;
          return;
        } else {
          // Check-only
          const checkR = await app.treeCheckService.checkTree(blueprint);
          if (!checkR.ok) {
            process.stderr.write(formatError(checkR.error) + "\n");
            process.exitCode = exitCode(checkR.error);
            return;
          }

          if (args.json) {
            console.log(
              JSON.stringify({ ok: true, data: checkR.value }, null, 2),
            );
          } else if (checkR.value.consistent) {
            console.log("Tree is consistent with lore.tree.yaml blueprint.");
          } else {
            console.log(
              `Tree inconsistent: ${checkR.value.drifts.length} drift(s)`,
            );
            for (const d of checkR.value.drifts) {
              console.log(`  - ${d.kind}: ${d.detail}`);
            }
          }

          process.exitCode = checkR.value.consistent ? 0 : 3;
          return;
        }
      } finally {
        app.close();
      }
    }

    // ── normal status branch ─────────────────────────────────────────────────
    const { app } = loadLoreApp();
    try {
      const result = await app.corpusService.status();

      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exitCode = exitCode(result.error);
        return;
      }

      const status = result.value;
      // SPEC-024 AC-NOAI-10: resolved per-surface AI defaults.
      const aiDefaults = computeAiDefaults(app);

      // SPEC-044 §Design Decisions D14 — open_stale_candidates, computed by the SAME
      // query `lore review --staleness --list` uses (one derivation site,
      // `flows/staleness-flow.ts::listFreshStalenessEscalates` — mirrors SPEC-043's
      // computeArmedGates precedent).
      const staleListResult = await listFreshStalenessEscalates(buildStalenessFlowDeps(app));
      if (!staleListResult.ok) {
        process.stderr.write(formatError(staleListResult.error) + "\n");
        process.exitCode = exitCode(staleListResult.error);
        return;
      }
      const openStaleCandidates = staleListResult.value.length;

      if (args.json) {
        console.log(
          JSON.stringify(
            { ok: true, data: { ...status, ai_defaults: aiDefaults, open_stale_candidates: openStaleCandidates } },
            null,
            2,
          ),
        );
        return;
      }

      console.log("Corpus Status");
      console.log("─".repeat(40));
      console.log(`Total documents:  ${status.total_docs}`);
      console.log(
        `Last updated:     ${status.last_updated.slice(0, 19).replace("T", " ")}`,
      );
      if (status.db_size_bytes > 0) {
        const kb = (status.db_size_bytes / 1024).toFixed(1);
        console.log(`Database size:    ${kb} KB`);
      }

      if (Object.keys(status.by_type).length > 0) {
        console.log("\nBy type:");
        for (const [type, count] of Object.entries(status.by_type)) {
          console.log(`  ${type.padEnd(12)} ${count}`);
        }
      }

      if (Object.keys(status.by_status).length > 0) {
        console.log("\nBy status:");
        for (const [s, count] of Object.entries(status.by_status)) {
          console.log(`  ${s.padEnd(12)} ${count}`);
        }
      }

      // SPEC-044 §Design Decisions D14 — text line only when count > 0 (never a silent
      // zero-line noise addition to every `lore status` invocation).
      if (openStaleCandidates > 0) {
        console.log(
          `\nOpen stale candidates: ${openStaleCandidates} (run \`lore review --staleness --list\` to see them)`,
        );
      }

      // SPEC-043 D8 — invalidated-feeding-source warning (computed via the SAME
      // armed-gate helper SessionService.bootstrap uses; see CorpusService.status).
      if (status.invalidated_feeding_source_warnings.length > 0) {
        console.log("\n⚠ Invalidated feeding sources:");
        for (const warning of status.invalidated_feeding_source_warnings) {
          console.log(`  - ${warning}`);
        }
      }

      // SPEC-024 AC-NOAI-10: show resolved per-surface AI defaults
      console.log("\nAI defaults (per surface):");
      for (const [surface, aiOn] of Object.entries(aiDefaults)) {
        const current = surface === app.callerSurface ? " ← current" : "";
        console.log(`  ${surface.padEnd(14)} ${aiOn ? "on" : "off"}${current}`);
      }
      console.log("  (override via --ai / --no-ai, or LORE_AI_DEFAULT=off, or ai.default_per_surface in config)");
    } finally {
      app.close();
    }
  },
});
