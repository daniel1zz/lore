/**
 * lore anchor — manage a task's declared `file_anchors` (SPEC-042 §Design
 * Decisions D3).
 *
 * Subcommands:
 *   add  <task> <path...>   Read-modify-write UNION — append anchors (repeatable positional).
 *   rm   <task> <path...>   Read-modify-write DIFFERENCE — remove anchors.
 *   list <task>             List the task's currently declared file_anchors.
 *
 * All mutations are validated + normalized via the shared pure
 * `normalizeFileAnchors` (`@lore/core`) — never re-derived here — and preserve
 * `extra.claim`/`extra.verification_evidence` untouched (AC-S3-5 regression;
 * `TaskWorkflowService.addAnchors`/`removeAnchors` are read-modify-write).
 *
 * There is deliberately NO `lore set --anchor` full-replace flag (D3 — a
 * wholesale-`extra` replace would silently delete claim/evidence state); use
 * `lore anchor add`/`rm` for incremental changes, or pass every anchor to
 * `lore create task --anchor <path>` (repeatable) at creation time.
 *
 * Actor resolution (--by flag > $LORE_ACTOR env var > OS username) — see
 * utils.ts::resolveActor.
 *
 * Exit codes per SPEC-003 §5:
 *   0 = success
 *   3 = DOC_NOT_FOUND (task not found)
 *   4 = VALIDATION_ERROR (not a task, invalid anchor entry — bad path, cap exceeded, etc.)
 *   5 = STALE_VERSION
 *
 * Source: SPEC-042 §Design Decisions D3; §Acceptance Criteria AC-S3-5, AC-S3-7
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, resolveActor } from "../utils.js";

/**
 * Reads every trailing positional argument beyond the `skip` leading ones
 * already bound to named `type: "positional"` args (citty maps exactly ONE
 * token per declared positional — `.shift()` off a COPY of `parsed._`, never
 * mutating `parsed._` itself — so the full original positional list,
 * including every value beyond the first, is still readable via `args._`).
 * Used for `<path...>`'s variadic collection since citty has no built-in
 * "collect the rest" positional type.
 *
 * @param args - The citty-parsed args object (proxies through to `parsed._`).
 * @param skip - Number of leading positionals already bound to named args
 *   (e.g. 1 for `<task> <path...>`, where `task` claims the first slot).
 */
function collectVariadicPositionals(args: Record<string, unknown>, skip: number): string[] {
  const all = (args as { _?: unknown[] })._ ?? [];
  return all.slice(skip).map(String);
}

/** Render a numbered list of declared anchors. */
function renderAnchorList(anchors: string[]): void {
  if (anchors.length === 0) {
    console.log("  (no anchors declared)");
    return;
  }
  for (let i = 0; i < anchors.length; i++) {
    console.log(`  ${i + 1}. ${anchors[i]}`);
  }
}

export default defineCommand({
  meta: {
    name: "anchor",
    description: "Manage a task's declared file_anchors (add / rm / list)",
  },
  subCommands: {
    add: defineCommand({
      meta: { name: "add", description: "Add one or more anchors to a task (union with existing)" },
      args: {
        task: {
          type: "positional",
          description: "Task document ID or slug",
          required: true,
        },
        path: {
          type: "positional",
          description: "[repeatable] Repo-relative POSIX path (trailing '/' = directory scope)",
          required: true,
        },
        by: {
          type: "string",
          description: "Actor identity; defaults to $LORE_ACTOR env var, then OS username",
        },
        json: {
          type: "boolean",
          description: "Output result as JSON",
        },
      },
      async run({ args }) {
        const { app } = loadLoreApp();
        try {
          const by = resolveActor(typeof args.by === "string" ? args.by : undefined);
          const paths = collectVariadicPositionals(args, 1);
          const result = await app.taskWorkflowService.addAnchors(args.task as string, paths, {
            by,
            source: app.callerSurface,
          });

          if (!result.ok) {
            process.stderr.write(formatError(result.error) + "\n");
            process.exitCode = exitCode(result.error);
            return;
          }

          const anchors = (result.value.extra["file_anchors"] as string[] | undefined) ?? [];
          if (args.json) {
            console.log(JSON.stringify({ ok: true, data: { doc: result.value, anchors } }, null, 2));
            return;
          }

          console.log(`Added ${paths.length} anchor(s) to ${result.value.slug} (v${result.value.version})`);
          renderAnchorList(anchors);
        } finally {
          app.close();
        }
      },
    }),

    rm: defineCommand({
      meta: { name: "rm", description: "Remove one or more anchors from a task" },
      args: {
        task: {
          type: "positional",
          description: "Task document ID or slug",
          required: true,
        },
        path: {
          type: "positional",
          description: "[repeatable] Repo-relative POSIX path to remove",
          required: true,
        },
        by: {
          type: "string",
          description: "Actor identity; defaults to $LORE_ACTOR env var, then OS username",
        },
        json: {
          type: "boolean",
          description: "Output result as JSON",
        },
      },
      async run({ args }) {
        const { app } = loadLoreApp();
        try {
          const by = resolveActor(typeof args.by === "string" ? args.by : undefined);
          const paths = collectVariadicPositionals(args, 1);
          const result = await app.taskWorkflowService.removeAnchors(args.task as string, paths, {
            by,
            source: app.callerSurface,
          });

          if (!result.ok) {
            process.stderr.write(formatError(result.error) + "\n");
            process.exitCode = exitCode(result.error);
            return;
          }

          const anchors = (result.value.extra["file_anchors"] as string[] | undefined) ?? [];
          if (args.json) {
            console.log(JSON.stringify({ ok: true, data: { doc: result.value, anchors } }, null, 2));
            return;
          }

          console.log(`Removed ${paths.length} anchor(s) from ${result.value.slug} (v${result.value.version})`);
          renderAnchorList(anchors);
        } finally {
          app.close();
        }
      },
    }),

    list: defineCommand({
      meta: { name: "list", description: "List a task's declared file_anchors" },
      args: {
        task: {
          type: "positional",
          description: "Task document ID or slug",
          required: true,
        },
        json: {
          type: "boolean",
          description: "Output result as JSON",
        },
      },
      async run({ args }) {
        const { app } = loadLoreApp();
        try {
          const result = await app.corpusService.get(args.task as string);

          if (!result.ok) {
            process.stderr.write(formatError(result.error) + "\n");
            process.exitCode = exitCode(result.error);
            return;
          }

          const doc = result.value.doc;
          if (doc.type !== "task") {
            process.stderr.write(`Error: Expected a task document; got type '${doc.type}'\n`);
            process.exitCode = 4;
            return;
          }

          const anchors = (doc.extra["file_anchors"] as string[] | undefined) ?? [];
          if (args.json) {
            console.log(JSON.stringify({ ok: true, data: { anchors } }, null, 2));
            return;
          }

          console.log(`File anchors for ${doc.slug}:`);
          renderAnchorList(anchors);
        } finally {
          app.close();
        }
      },
    }),
  },
});
