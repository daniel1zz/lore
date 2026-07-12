/**
 * lore anchor — manage a task's `file_anchors` or a spec's `code_anchors`
 * (SPEC-042 §Design Decisions D3; extended by SPEC-045 §Design Decisions D6 to
 * dispatch by target doc type).
 *
 * Subcommands:
 *   add  <target> <path...>   Read-modify-write UNION — append anchors (repeatable positional).
 *   rm   <target> <path...>   Read-modify-write DIFFERENCE — remove anchors.
 *   list <target>             List the target's currently declared anchors.
 *
 * `<target>` is resolved FIRST, then dispatched by its doc type (SPEC-045 D6):
 *   - task → `TaskWorkflowService.addAnchors`/`removeAnchors` (byte-identical to
 *     pre-SPEC-045 behavior — a REGRESSION oracle, `path` entries containing `#`
 *     are rejected loud at the service seam, naming the spec code-anchor grammar).
 *   - spec → `DriftCheckService.addCodeAnchors`/`removeCodeAnchors` (incremental
 *     CAS RMW, `path[#Symbol]` grammar — SPEC-045 D1/D6).
 *   - any other type → `VALIDATION_ERROR`, exit 4, naming "task or spec".
 *
 * All mutations are validated + normalized via the shared pure
 * `normalizeFileAnchors` (task target, `@lore/core`) or `parseCodeAnchor`/
 * `normalizeCodeAnchorEntries` (spec target, `@lore/core`) — never re-derived
 * here — and preserve every sibling `extra` key untouched (task: `extra.claim`/
 * `extra.verification_evidence`, AC-S3-5 regression; spec: `extra.spec_kind`/
 * `extra.acceptance_criteria`).
 *
 * There is deliberately NO `lore set --anchor` full-replace flag (D3 — a
 * wholesale-`extra` replace would silently delete other services' owned state);
 * use `lore anchor add`/`rm` for incremental changes, or pass every anchor to
 * `lore create task --anchor <path>` / `lore create spec --code-anchor
 * <path[#Symbol]>` (both repeatable) at creation time.
 *
 * Actor resolution (--by flag > $LORE_ACTOR env var > OS username) — see
 * utils.ts::resolveActor. `--by` is meaningful only for a task target (spec
 * anchor writes are attributed to "system", mirroring `AcService`'s writes).
 *
 * Exit codes per SPEC-003 §5:
 *   0 = success
 *   3 = DOC_NOT_FOUND (target not found)
 *   4 = VALIDATION_ERROR (not a task/spec, invalid anchor entry — bad path/grammar,
 *       cap exceeded, `#` on a task anchor, etc.)
 *   5 = STALE_VERSION
 *
 * Source: SPEC-042 §Design Decisions D3, §Acceptance Criteria AC-S3-5, AC-S3-7;
 *         SPEC-045 §Design Decisions D6, §Acceptance Criteria AC-DR-4
 */

import { defineCommand } from "citty";
import type { DocRecord, LoreError, Result } from "@lore/core";
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
 *   (e.g. 1 for `<target> <path...>`, where `target` claims the first slot).
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

/**
 * Resolves `idOrSlug` to a `DocRecord` — the shared FIRST step of `add`/`rm`/
 * `list`'s resolve-then-dispatch (SPEC-045 D6).
 */
async function resolveAnchorTarget(
  app: ReturnType<typeof loadLoreApp>["app"],
  idOrSlug: string,
): Promise<Result<DocRecord, LoreError>> {
  const result = await app.corpusService.get(idOrSlug);
  if (!result.ok) return result;
  return { ok: true, value: result.value.doc };
}

/**
 * The `VALIDATION_ERROR` a target resolving to neither `task` nor `spec`
 * produces (D6) — routed through the normal `formatError`/`exitCode` pipeline
 * (exit 4) rather than a hand-rolled stderr line, for consistency with every
 * other error path in this command.
 */
function unsupportedTargetTypeError(docType: string): LoreError {
  return {
    code: "VALIDATION_ERROR",
    field: "type",
    message: `Expected a task or spec document; got type '${docType}'`,
    value: docType,
  };
}

export default defineCommand({
  meta: {
    name: "anchor",
    description: "Manage a task's file_anchors or a spec's code_anchors (add / rm / list)",
  },
  subCommands: {
    add: defineCommand({
      meta: { name: "add", description: "Add one or more anchors to a task or spec (union with existing)" },
      args: {
        target: {
          type: "positional",
          description: "Task or spec document ID or slug",
          required: true,
        },
        path: {
          type: "positional",
          description:
            "[repeatable] Task: repo-relative POSIX path (trailing '/' = directory scope). Spec: path[#Symbol] (SPEC-045).",
          required: true,
        },
        by: {
          type: "string",
          description: "[task target only] Actor identity; defaults to $LORE_ACTOR env var, then OS username",
        },
        json: {
          type: "boolean",
          description: "Output result as JSON",
        },
      },
      async run({ args }) {
        const { app } = loadLoreApp();
        try {
          const targetId = args.target as string;
          const paths = collectVariadicPositionals(args, 1);

          const targetResult = await resolveAnchorTarget(app, targetId);
          if (!targetResult.ok) {
            process.stderr.write(formatError(targetResult.error) + "\n");
            process.exitCode = exitCode(targetResult.error);
            return;
          }
          const target = targetResult.value;

          if (target.type === "task") {
            const by = resolveActor(typeof args.by === "string" ? args.by : undefined);
            const result = await app.taskWorkflowService.addAnchors(targetId, paths, {
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
          } else if (target.type === "spec") {
            if (app.driftCheckService === undefined) {
              process.stderr.write("Error: DriftCheckService not wired on this App instance.\n");
              process.exitCode = 1;
              return;
            }
            const result = await app.driftCheckService.addCodeAnchors(targetId, paths);

            if (!result.ok) {
              process.stderr.write(formatError(result.error) + "\n");
              process.exitCode = exitCode(result.error);
              return;
            }

            const anchors = result.value;
            if (args.json) {
              console.log(JSON.stringify({ ok: true, data: { anchors } }, null, 2));
              return;
            }

            console.log(`Added ${paths.length} anchor(s) to ${target.slug}`);
            renderAnchorList(anchors);
          } else {
            const error = unsupportedTargetTypeError(target.type);
            process.stderr.write(formatError(error) + "\n");
            process.exitCode = exitCode(error);
          }
        } finally {
          app.close();
        }
      },
    }),

    rm: defineCommand({
      meta: { name: "rm", description: "Remove one or more anchors from a task or spec" },
      args: {
        target: {
          type: "positional",
          description: "Task or spec document ID or slug",
          required: true,
        },
        path: {
          type: "positional",
          description: "[repeatable] Anchor entry to remove — task: path; spec: path[#Symbol]",
          required: true,
        },
        by: {
          type: "string",
          description: "[task target only] Actor identity; defaults to $LORE_ACTOR env var, then OS username",
        },
        json: {
          type: "boolean",
          description: "Output result as JSON",
        },
      },
      async run({ args }) {
        const { app } = loadLoreApp();
        try {
          const targetId = args.target as string;
          const paths = collectVariadicPositionals(args, 1);

          const targetResult = await resolveAnchorTarget(app, targetId);
          if (!targetResult.ok) {
            process.stderr.write(formatError(targetResult.error) + "\n");
            process.exitCode = exitCode(targetResult.error);
            return;
          }
          const target = targetResult.value;

          if (target.type === "task") {
            const by = resolveActor(typeof args.by === "string" ? args.by : undefined);
            const result = await app.taskWorkflowService.removeAnchors(targetId, paths, {
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
          } else if (target.type === "spec") {
            if (app.driftCheckService === undefined) {
              process.stderr.write("Error: DriftCheckService not wired on this App instance.\n");
              process.exitCode = 1;
              return;
            }
            const result = await app.driftCheckService.removeCodeAnchors(targetId, paths);

            if (!result.ok) {
              process.stderr.write(formatError(result.error) + "\n");
              process.exitCode = exitCode(result.error);
              return;
            }

            const anchors = result.value;
            if (args.json) {
              console.log(JSON.stringify({ ok: true, data: { anchors } }, null, 2));
              return;
            }

            console.log(`Removed ${paths.length} anchor(s) from ${target.slug}`);
            renderAnchorList(anchors);
          } else {
            const error = unsupportedTargetTypeError(target.type);
            process.stderr.write(formatError(error) + "\n");
            process.exitCode = exitCode(error);
          }
        } finally {
          app.close();
        }
      },
    }),

    list: defineCommand({
      meta: { name: "list", description: "List a task's file_anchors or a spec's code_anchors" },
      args: {
        target: {
          type: "positional",
          description: "Task or spec document ID or slug",
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
          const targetResult = await resolveAnchorTarget(app, args.target as string);

          if (!targetResult.ok) {
            process.stderr.write(formatError(targetResult.error) + "\n");
            process.exitCode = exitCode(targetResult.error);
            return;
          }

          const doc = targetResult.value;
          let anchors: string[];
          if (doc.type === "task") {
            anchors = (doc.extra["file_anchors"] as string[] | undefined) ?? [];
          } else if (doc.type === "spec") {
            anchors = (doc.extra["code_anchors"] as string[] | undefined) ?? [];
          } else {
            const error = unsupportedTargetTypeError(doc.type);
            process.stderr.write(formatError(error) + "\n");
            process.exitCode = exitCode(error);
            return;
          }

          if (args.json) {
            console.log(JSON.stringify({ ok: true, data: { anchors } }, null, 2));
            return;
          }

          console.log(`${doc.type === "task" ? "File" : "Code"} anchors for ${doc.slug}:`);
          renderAnchorList(anchors);
        } finally {
          app.close();
        }
      },
    }),
  },
});
