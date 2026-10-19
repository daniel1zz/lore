/**
 * lore invalidate <id-or-slug> — mark a knowledge/adr/task document invalid
 * (retract it, for a task), or undo a prior invalidation (--undo). Thin pipe
 * over `ValidityService.invalidate` (SPEC-043 §Design Decisions D2) — the SOLE
 * write path for `extra.validity`. `task` was added to the eligible-types set
 * by task-a-task-cannot-be-retracted-supersedes-emits-a-repair (Defect 2) —
 * a task's own `VALID_TRANSITIONS` graph has no `draft -> deprecated` edge, so
 * a wrong task caught while still `draft` had no retraction path visible to
 * `list`/`ready`/`search` at all before this.
 *
 * Exit codes: 0 = success; 3 = DOC_NOT_FOUND (target or --superseded-by doesn't
 * resolve); 4 = VALIDATION_ERROR (target type outside knowledge/adr/task, future
 * invalid_at, undo on a never-invalidated doc); 5 = STALE_VERSION.
 */

import { defineLoreCommand } from "../cli-exit.js";

import { loadLoreApp } from "../loader.js";
import { exitCode, formatErrorFor, resolveActor } from "../utils.js";
import type { InvalidateOpts } from "../../../service/validity-service.js";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";

export default defineLoreCommand({
  meta: {
    name: "invalidate",
    description: "Mark a knowledge/adr/task document invalid (retract it), or undo a prior invalidation",
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
    json: {
      type: "boolean",
      description: "Output as JSON",
    },
  },
  async run(context): Promise<number> {
    const { args } = context;
    const inv = invocationOf(context);
    const { app } = loadLoreApp({ inv });
    try {
      if (app.validityService === undefined) {
        inv.io.stderr.write("Error: ValidityService not wired on this App instance.\n");
        return 1;
      }

      const by = resolveActor(inv.io, undefined, inv.env, inv.cwd, inv.user);
      const opts: InvalidateOpts = { by };
      if (args["superseded-by"] !== undefined) opts.supersededBy = args["superseded-by"];
      if (args.reason !== undefined) opts.reason = args.reason;
      if (args.undo === true) opts.undo = true;

      const result = await app.validityService.invalidate(args.id, opts);

      if (!result.ok) {
        inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
        return exitCode(result.error);
      }

      const { doc, decision_status_unchanged, task_already_terminal, task_claim_holder } = result.value;

      if (args.json) {
        printLine(inv.io.stdout, 
          JSON.stringify(
            {
              ok: true,
              data: {
                doc,
                ...(decision_status_unchanged !== undefined ? { decision_status_unchanged } : {}),
                ...(task_already_terminal !== undefined ? { task_already_terminal } : {}),
                ...(task_claim_holder !== undefined ? { task_claim_holder } : {}),
              },
            },
            null,
            2,
          ),
        );
        return 0;
      }

      if (args.undo === true) {
        printLine(inv.io.stdout, `Undone invalidation for ${doc.slug}`);
        if (decision_status_unchanged !== undefined) {
          printLine(inv.io.stdout, 
            `  Note: decision_status remains "${decision_status_unchanged}" — --undo never auto-reverts it.`,
          );
        }
      } else {
        printLine(inv.io.stdout, `Invalidated ${doc.slug} (v${doc.version})`);
        // BOUNDARY advisories (AC6, task-a-task-cannot-be-retracted-
        // supersedes-emits-a-repair) — NAMED, non-blocking notes; the
        // retraction always applies regardless of either condition.
        if (task_already_terminal !== undefined) {
          printLine(inv.io.stdout, `  Note: this task was already "${task_already_terminal}" (terminal) before retraction.`);
        }
        if (task_claim_holder !== undefined) {
          printLine(inv.io.stdout, `  Note: this task carries a claim held by "${task_claim_holder}".`);
        }
      }
    } finally {
      app.close();
    }
    return 0;
  },
});
