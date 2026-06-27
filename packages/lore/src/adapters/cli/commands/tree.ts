/**
 * lore tree [root-id] — display document hierarchy as a tree.
 * With --orphans: list orphaned documents (parent_id=null AND type∉ROOT_TYPES,
 * or parent_id≠null but parent doesn't exist).
 *
 * Exit codes:
 *   Normal: 0 = success, non-zero on error
 *   --orphans: 0 = no orphans, 3 = orphans found
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, formatTree } from "../utils.js";
import type { TreeBlueprint } from "@lore/core";

/** Minimal blueprint used only to trigger orphan detection in TreeCheckService. */
const ORPHAN_DETECTION_BLUEPRINT: TreeBlueprint = {
  version: 1,
  root: { type: "prd", min: 0, max: null, children: [] },
};

export default defineCommand({
  meta: {
    name: "tree",
    description: "Display document hierarchy as a tree",
  },
  args: {
    root: {
      type: "positional",
      description: "Root document ID or slug (default: first PRD)",
      required: false,
    },
    depth: {
      type: "string",
      description: "Max expansion depth (default: 3)",
      default: "3",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
    orphans: {
      type: "boolean",
      description: "List orphan docs (parent_id=null and not root type, or dangling parent)",
    },
  },
  async run({ args }) {
    const { app } = loadLoreApp();

    try {
      // ── orphans branch ────────────────────────────────────────────────────
      if (args.orphans) {
        const checkR = await app.treeCheckService.checkTree(
          ORPHAN_DETECTION_BLUEPRINT,
        );
        if (!checkR.ok) {
          process.stderr.write(formatError(checkR.error) + "\n");
          process.exit(exitCode(checkR.error));
        }

        const orphanDrifts = checkR.value.drifts.filter(
          (d) => d.kind === "orphan" && d.actual !== undefined,
        );

        if (args.json) {
          console.log(
            JSON.stringify(
              {
                ok: true,
                data: {
                  orphans: orphanDrifts.map((d) => ({
                    id: d.actual!.id,
                    slug: d.actual!.slug,
                    type: d.actual!.type,
                    parent_id: d.actual!.parent_id,
                  })),
                },
              },
              null,
              2,
            ),
          );
        } else if (orphanDrifts.length === 0) {
          console.log("No orphan documents.");
        } else {
          console.log(`${orphanDrifts.length} orphan doc(s):`);
          for (const d of orphanDrifts) {
            console.log(
              `  - ${d.actual!.slug} (${d.actual!.type}, parent_id=${d.actual!.parent_id ?? "null"})`,
            );
          }
        }

        process.exit(orphanDrifts.length > 0 ? 3 : 0);
      }

      // ── normal tree branch ────────────────────────────────────────────────
      const depth = parseInt(args.depth ?? "3", 10);
      const result = await app.corpusService.tree(args.root, { depth });

      if (!result.ok) {
        // Special-case: no root argument + no PRDs in corpus → actionable message.
        if (
          !args.root &&
          result.error.code === "DOC_NOT_FOUND" &&
          result.error.id === "prd"
        ) {
          process.stderr.write(
            "No PRD documents found. Create a PRD first with `lore create prd --title <name>`.\n",
          );
          process.exit(3);
        }
        process.stderr.write(formatError(result.error) + "\n");
        process.exit(exitCode(result.error));
      }

      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: result.value }, null, 2));
        return;
      }

      console.log(formatTree(result.value));
    } finally {
      app.close();
    }
  },
});
