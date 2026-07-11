/**
 * lore invalidate <id-or-slug> — mark a knowledge/adr document invalid, or undo a
 * prior invalidation (--undo). Thin pipe over `ValidityService.invalidate` (SPEC-043
 * §Design Decisions D2) — the SOLE write path for `extra.validity`.
 *
 * Exit codes: 0 = success; 3 = DOC_NOT_FOUND (target or --superseded-by doesn't
 * resolve); 4 = VALIDATION_ERROR (non-knowledge/adr target, future invalid_at, undo on
 * a never-invalidated doc); 5 = STALE_VERSION.
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, resolveActor } from "../utils.js";
import type { InvalidateOpts } from "../../../service/validity-service.js";

export default defineCommand({
  meta: {
    name: "invalidate",
    description: "Mark a knowledge/adr document invalid, or undo a prior invalidation",
  },
  args: {
    id: {
      type: "positional",
      description: "Document ID or slug",
      required: true,
    },
    "superseded-by": {
      type: "string",
      description: "ID or slug of the successor document (resolved + persisted as its ULID)",
    },
    reason: {
      type: "string",
      description: "Free-text reason (max 500 chars)",
    },
    undo: {
      type: "boolean",
      description: "Undo a prior invalidation (clears invalid_at/invalidated_by/reason)",
    },
    by: {
      type: "string",
      description: "Actor identity; defaults to $LORE_ACTOR env var, then OS username",
    },
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  async run({ args }) {
    const { app } = loadLoreApp();
    try {
      if (app.validityService === undefined) {
        process.stderr.write("Error: ValidityService not wired on this App instance.\n");
        process.exitCode = 1;
        return;
      }

      const by = resolveActor(args.by);
      const opts: InvalidateOpts = { by };
      if (args["superseded-by"] !== undefined) opts.supersededBy = args["superseded-by"];
      if (args.reason !== undefined) opts.reason = args.reason;
      if (args.undo === true) opts.undo = true;

      const result = await app.validityService.invalidate(args.id, opts);

      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exitCode = exitCode(result.error);
        return;
      }

      const { doc, decision_status_unchanged } = result.value;

      if (args.json) {
        console.log(
          JSON.stringify(
            {
              ok: true,
              data: {
                doc,
                ...(decision_status_unchanged !== undefined ? { decision_status_unchanged } : {}),
              },
            },
            null,
            2,
          ),
        );
        return;
      }

      if (args.undo === true) {
        console.log(`Undone invalidation for ${doc.slug}`);
        if (decision_status_unchanged !== undefined) {
          console.log(
            `  Note: decision_status remains "${decision_status_unchanged}" — --undo never auto-reverts it.`,
          );
        }
      } else {
        console.log(`Invalidated ${doc.slug} (v${doc.version})`);
      }
    } finally {
      app.close();
    }
  },
});
