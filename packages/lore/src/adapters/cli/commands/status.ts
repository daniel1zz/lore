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
import { parseTreeBlueprint } from "@lore/core";

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
            process.exit(exitCode(fixR.error));
          }

          const checkR = await app.treeCheckService.checkTree(blueprint);
          if (!checkR.ok) {
            process.stderr.write(formatError(checkR.error) + "\n");
            process.exit(exitCode(checkR.error));
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

          process.exit(fixSucceeded ? 0 : 3);
        } else {
          // Check-only
          const checkR = await app.treeCheckService.checkTree(blueprint);
          if (!checkR.ok) {
            process.stderr.write(formatError(checkR.error) + "\n");
            process.exit(exitCode(checkR.error));
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

          process.exit(checkR.value.consistent ? 0 : 3);
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
        process.exit(exitCode(result.error));
      }

      const status = result.value;

      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: status }, null, 2));
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
    } finally {
      app.close();
    }
  },
});
