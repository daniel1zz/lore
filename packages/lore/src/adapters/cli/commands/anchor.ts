/**
 * lore anchor — manage a task's `file_anchors` or a spec's / knowledge doc's
 * `code_anchors`
 * (SPEC-042 §Design Decisions D3; extended by SPEC-045 §Design Decisions D6 to
 * dispatch by target doc type, and by M2 of
 * `spec-a-write-side-fact-with-no-read-side-address-counts-with-no` to admit a
 * `knowledge` target on the SPEC grammar).
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
 *   - spec OR knowledge → `DriftCheckService.addCodeAnchors`/`removeCodeAnchors`
 *     (incremental CAS RMW, `path[#Symbol]` grammar — SPEC-045 D1/D6). A knowledge
 *     doc uses the SPEC grammar, not the task one: a domain FACT asserts things about
 *     named symbols, and `--check-drift` is the oracle that falsifies it. The
 *     admitted set is `DriftCheckService.ANCHOR_SCANNED_DOC_TYPES` — the same set the
 *     scan reads, so nothing is writable-but-unscanned.
 *   - any other type → `VALIDATION_ERROR`, exit 4, naming every accepted type.
 *
 * All mutations are validated + normalized via the shared pure
 * `normalizeFileAnchors` (task target, `@lore/core`) or `parseCodeAnchor`/
 * `normalizeCodeAnchorEntries` (spec target, `@lore/core`) — never re-derived
 * here — and preserve every sibling `extra` key untouched (task: `extra.claim`/
 * `extra.verification_evidence`, AC-S3-5 regression; spec: `extra.spec_kind`/
 * `extra.acceptance_criteria`).
 *
 * Test-title anchors (issue #178): a spec/knowledge anchor on a `*.test.ts` file (incl.
 * `*.bun.test.ts`) may name a `describe`/`it`/`test` title instead of an exported
 * identifier — `tests/x.test.ts#"AC-1: widget renders (happy path)"`. The quoted form
 * cannot collide with the identifier form (an identifier never starts with `"`); a
 * title may contain spaces, colons, parentheses and `#`; `\"` and `\\` are the only
 * escapes. `--check-drift` resolves it when the exact title is a describe/it/test title
 * in the file (`symbol_missing` otherwise). A quoted title on a NON-test file is refused
 * (exit 4). Grammar owner: `@lore/core` `code-anchors.ts`.
 *
 * `add` on a TASK target additionally prints the non-resolving-anchor advisory to
 * stderr (task-a-mistyped-task-file-anchor-is-stored-and-consulted) — see
 * `emitFileAnchorAdvisory` below for the stderr/stdout split, why the FULL
 * resulting set is probed, and why `rm` is deliberately excluded. It is an
 * advisory: the exit code is untouched and the anchor is stored regardless.
 *
 * ⛔ That advisory is TASK-ONLY and stays task-only for a spec/knowledge target: it
 * consumes the FILE-anchor grammar, so `src/x.ts#Symbol` would be probed as a literal
 * path and reported non-resolving every single time — a guaranteed-false advisory. A
 * code anchor's non-resolution is reported by `lore status --check-drift` instead,
 * which is the entire point of declaring one. Both target families are alike in the
 * property that matters: a non-resolving anchor is NEVER a refusal, the exit code is
 * untouched, and the anchor is stored.
 *
 * There is deliberately NO `lore set --anchor` full-replace flag (D3 — a
 * wholesale-`extra` replace would silently delete other services' owned state);
 * use `lore anchor add`/`rm` for incremental changes, or pass every anchor to
 * `lore create task --anchor <path>` / `lore create spec --code-anchor
 * <path[#Symbol]>` (both repeatable) at creation time.
 *
 * Actor identity: the invoking run, via utils.ts::resolveActor — this command takes no `--by`. The identity is
 * meaningful only for a task target (spec
 * anchor writes are attributed to "system", mirroring `AcService`'s writes).
 *
 * Edit-time scope (task-skill-design-implementers-declare-out-of-anchor-files) — the two verbs the shipped
 * PreToolUse hook `pre-edit-anchor-gate.mjs` calls, so a helper's edit outside its claim's anchors is declared or
 * denied BEFORE it happens:
 *   scope   --worktree <dir> [--json]        The open claims recorded for a working copy, with anchors and holder run.
 *   declare <task> <path> --worktree <dir>   Add one out-of-anchor path to the claimed task unless another live
 *                                            claim overlaps it (the task-claim gate's overlap predicate); exit 4
 *                                            naming that claim and its task. A path already covered, or git-ignored
 *                                            in the working copy, writes nothing and exits 0.
 *
 * Exit codes per SPEC-003 §5:
 *   0 = success
 *   3 = DOC_NOT_FOUND (target not found)
 *   4 = VALIDATION_ERROR (unsupported target type, invalid anchor entry — bad path/grammar,
 *       cap exceeded, `#` on a task anchor, etc.)
 *   5 = STALE_VERSION
 *
 * Source: SPEC-042 §Design Decisions D3, §Acceptance Criteria AC-S3-5, AC-S3-7;
 *         SPEC-045 §Design Decisions D6, §Acceptance Criteria AC-DR-4
 */

import { defineLoreCommand } from "../cli-exit.js";

import type { DocRecord, DocType, LoreError, Result } from "@lore/core";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatErrorFor, resolveActor } from "../utils.js";
import { collectFileAnchorResolution, renderFileAnchorAdvisory } from "../../../service/anchor-resolution.js";
import { ANCHOR_SCANNED_DOC_TYPES } from "../../../service/drift-check-service.js";
import { buildFileAnchorProbeContext } from "../../real-fs-probe.js";
import { invocationOf } from "../command-invocation.js";
import { declareEditPath, readEditScope } from "../../../service/edit-scope.js";
import { buildEditScopeDeps, refreshScopeFilesOf, scopeCandidatesOf } from "../edit-scope-wiring.js";
import { printLine } from "../output.js";
import type { CliIo } from "../output.js";

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

/**
 * Writes the non-resolving-anchor advisory for a task's RESULTING declared
 * anchor set to stderr (task-a-mistyped-task-file-anchor-is-stored-and-consulted,
 * Required #1). Non-blocking: never touches `process.exitCode`, never returns a
 * value the caller branches on.
 *
 * stderr, not stdout, so `--json` stays a clean machine payload. Probes the FULL
 * resulting list rather than only the just-added entries: what the
 * `noAnchorOverlap` gate will consult is the whole set, and re-naming a
 * previously-declared broken anchor is the correct amount of noise for a command
 * that just changed that set.
 *
 * ⛔ Deliberately NOT wired into `anchor rm`: removal can only SHRINK the declared
 * set, and every surviving entry was already advised at its own write. Adding it
 * there would print an advisory about anchors the operator did not just touch.
 *
 * @param anchors - The task's resulting `extra.file_anchors` (already normalized).
 * @param subject - The task slug, rendered into the advisory header.
 * @param cwd - The invocation's working directory the anchors are probed against.
 */
function emitFileAnchorAdvisory(io: CliIo, anchors: string[], subject: string, cwd: string): void {
  if (anchors.length === 0) return;
  const report = collectFileAnchorResolution(anchors, buildFileAnchorProbeContext(cwd));
  for (const line of renderFileAnchorAdvisory(report, { subject })) {
    io.stderr.write(line + "\n");
  }
}

/** Render a numbered list of declared anchors. */
function renderAnchorList(io: CliIo, anchors: string[]): void {
  if (anchors.length === 0) {
    printLine(io.stdout, "  (no anchors declared)");
    return;
  }
  for (let i = 0; i < anchors.length; i++) {
    printLine(io.stdout, `  ${i + 1}. ${anchors[i]}`);
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
 * The accepted `<target>` doc types, in the order the refusal message names them —
 * `task` (file anchors, `TaskWorkflowService`) plus every type
 * `DriftCheckService` scans for code anchors. Derived from
 * `ANCHOR_SCANNED_DOC_TYPES` rather than restated, so admitting a new
 * anchor-declaring doc type in the service cannot leave this refusal naming a
 * shorter list than the dispatch below actually accepts.
 */
const ACCEPTED_TARGET_TYPES: readonly DocType[] = ["task", ...ANCHOR_SCANNED_DOC_TYPES];

/**
 * The `VALIDATION_ERROR` a target resolving to none of {@link ACCEPTED_TARGET_TYPES}
 * produces (D6) — routed through the normal `formatError`/`exitCode` pipeline
 * (exit 4) rather than a hand-rolled stderr line, for consistency with every
 * other error path in this command.
 */
function unsupportedTargetTypeError(docType: string): LoreError {
  const accepted = ACCEPTED_TARGET_TYPES.join(", ");
  return {
    code: "VALIDATION_ERROR",
    field: "type",
    message: `Expected one of these document types: ${accepted}; got type '${docType}'`,
    value: docType,
  };
}

/** `true` iff this target's anchors are `extra.code_anchors` owned by `DriftCheckService`. */
function isCodeAnchorTarget(docType: DocType): boolean {
  return ANCHOR_SCANNED_DOC_TYPES.includes(docType);
}

/** The CLI exit of an edit-scope refusal (a held path, no claim, an unmeasurable probe): VALIDATION_ERROR, exit 4. */
const EDIT_SCOPE_DENIED_EXIT = 4;

export default defineLoreCommand({
  meta: {
    name: "anchor",
    description: "Manage a task's file_anchors or a spec's / knowledge doc's code_anchors (add / rm / list)",
  },
  subCommands: {
    add: defineLoreCommand({
      meta: { name: "add", description: "Add one or more anchors to a task, spec, or knowledge doc (union with existing)" },
      args: {
        target: {
          type: "positional",
          description: "Task, spec, or knowledge document ID or slug",
          required: true,
        },
        path: {
          type: "positional",
          description:
            "[repeatable] Task: repo-relative POSIX path (trailing '/' = directory scope). Spec/knowledge: path[#Symbol] (SPEC-045), or path#\"test title\" on a *.test.ts file to anchor a describe/it/test title (\\\" and \\\\ are the only escapes).",
          required: true,
        },
        json: {
          type: "boolean",
          description: "Output result as JSON",
        },
      },
      async run(context): Promise<number> {
        const { args } = context;
        const inv = invocationOf(context);
        const { app } = loadLoreApp({ inv });
        try {
          const targetId = args.target as string;
          const paths = collectVariadicPositionals(args, 1);

          const targetResult = await resolveAnchorTarget(app, targetId);
          if (!targetResult.ok) {
            inv.io.stderr.write(formatErrorFor(inv, targetResult.error) + "\n");
            return exitCode(targetResult.error);
          }
          const target = targetResult.value;

          if (target.type === "task") {
            const by = resolveActor(inv.io, undefined, inv.env, inv.cwd, inv.user);
            const result = await app.taskWorkflowService.addAnchors(targetId, paths, {
              by,
              source: app.callerSurface,
            });

            if (!result.ok) {
              inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
              return exitCode(result.error);
            }

            const anchors = (result.value.extra["file_anchors"] as string[] | undefined) ?? [];
            await refreshScopeFilesOf(app, result.value.slug, await scopeCandidatesOf(app, result.value.slug, inv.cwd));
            emitFileAnchorAdvisory(inv.io, anchors, result.value.slug, inv.cwd);
            if (args.json) {
              printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { doc: result.value, anchors } }, null, 2));
              return 0;
            }

            printLine(inv.io.stdout, `Added ${paths.length} anchor(s) to ${result.value.slug} (v${result.value.version})`);
            renderAnchorList(inv.io, anchors);
          } else if (isCodeAnchorTarget(target.type)) {
            if (app.driftCheckService === undefined) {
              inv.io.stderr.write("Error: DriftCheckService not wired on this App instance.\n");
              return 1;
            }
            const result = await app.driftCheckService.addCodeAnchors(targetId, paths);

            if (!result.ok) {
              inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
              return exitCode(result.error);
            }

            const anchors = result.value;
            if (args.json) {
              printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { anchors } }, null, 2));
              return 0;
            }

            printLine(inv.io.stdout, `Added ${paths.length} anchor(s) to ${target.slug}`);
            renderAnchorList(inv.io, anchors);
          } else {
            const error = unsupportedTargetTypeError(target.type);
            inv.io.stderr.write(formatErrorFor(inv, error) + "\n");
            return exitCode(error);
          }
        } finally {
          app.close();
        }
        return 0;
      },
    }),

    rm: defineLoreCommand({
      meta: { name: "rm", description: "Remove one or more anchors from a task, spec, or knowledge doc" },
      args: {
        target: {
          type: "positional",
          description: "Task, spec, or knowledge document ID or slug",
          required: true,
        },
        path: {
          type: "positional",
          description: "[repeatable] Anchor entry to remove — task: path; spec/knowledge: path[#Symbol]",
          required: true,
        },
        json: {
          type: "boolean",
          description: "Output result as JSON",
        },
      },
      async run(context): Promise<number> {
        const { args } = context;
        const inv = invocationOf(context);
        const { app } = loadLoreApp({ inv });
        try {
          const targetId = args.target as string;
          const paths = collectVariadicPositionals(args, 1);

          const targetResult = await resolveAnchorTarget(app, targetId);
          if (!targetResult.ok) {
            inv.io.stderr.write(formatErrorFor(inv, targetResult.error) + "\n");
            return exitCode(targetResult.error);
          }
          const target = targetResult.value;

          if (target.type === "task") {
            const by = resolveActor(inv.io, undefined, inv.env, inv.cwd, inv.user);
            const result = await app.taskWorkflowService.removeAnchors(targetId, paths, {
              by,
              source: app.callerSurface,
            });

            if (!result.ok) {
              inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
              return exitCode(result.error);
            }

            const anchors = (result.value.extra["file_anchors"] as string[] | undefined) ?? [];
            await refreshScopeFilesOf(app, result.value.slug, await scopeCandidatesOf(app, result.value.slug, inv.cwd));
            if (args.json) {
              printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { doc: result.value, anchors } }, null, 2));
              return 0;
            }

            printLine(inv.io.stdout, `Removed ${paths.length} anchor(s) from ${result.value.slug} (v${result.value.version})`);
            renderAnchorList(inv.io, anchors);
          } else if (isCodeAnchorTarget(target.type)) {
            if (app.driftCheckService === undefined) {
              inv.io.stderr.write("Error: DriftCheckService not wired on this App instance.\n");
              return 1;
            }
            const result = await app.driftCheckService.removeCodeAnchors(targetId, paths);

            if (!result.ok) {
              inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
              return exitCode(result.error);
            }

            const anchors = result.value;
            if (args.json) {
              printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { anchors } }, null, 2));
              return 0;
            }

            printLine(inv.io.stdout, `Removed ${paths.length} anchor(s) from ${target.slug}`);
            renderAnchorList(inv.io, anchors);
          } else {
            const error = unsupportedTargetTypeError(target.type);
            inv.io.stderr.write(formatErrorFor(inv, error) + "\n");
            return exitCode(error);
          }
        } finally {
          app.close();
        }
        return 0;
      },
    }),

    scope: defineLoreCommand({
      meta: { name: "scope", description: "List the open task claims recorded for a working copy, with their anchors and holder run" },
      args: {
        worktree: { type: "string", description: "Working-copy directory the claims were recorded for", required: true },
        json: { type: "boolean", description: "Output result as JSON" },
      },
      async run(context): Promise<number> {
        const { args } = context;
        const inv = invocationOf(context);
        const { app } = loadLoreApp({ inv });
        try {
          const report = await readEditScope(buildEditScopeDeps(app), args.worktree as string);
          if (!report.ok) {
            inv.io.stderr.write(formatErrorFor(inv, report.error) + "\n");
            return exitCode(report.error);
          }
          if (args.json) {
            printLine(inv.io.stdout, JSON.stringify({ ok: true, data: report.value }, null, 2));
            return 0;
          }
          printLine(inv.io.stdout, `Open claims of ${report.value.working_copy}:`);
          for (const claim of report.value.claims) printLine(inv.io.stdout, `  ${claim.task} (run ${claim.holder_run ?? "-"}): ${claim.anchors.join(", ") || "(no anchors)"}`);
          for (const note of report.value.not_measured) printLine(inv.io.stdout, `  not measured: ${note}`);
        } finally {
          app.close();
        }
        return 0;
      },
    }),

    declare: defineLoreCommand({
      meta: {
        name: "declare",
        description: "Declare one out-of-anchor path on a claimed task unless another live claim holds it (edit-time scope)",
      },
      args: {
        target: { type: "positional", description: "The claimed task's ID or slug", required: true },
        path: { type: "positional", description: "Repo path (absolute, or relative to --worktree) the helper is about to edit", required: true },
        worktree: { type: "string", description: "Working-copy directory the task's claim was recorded for", required: true },
        json: { type: "boolean", description: "Output result as JSON" },
      },
      async run(context): Promise<number> {
        const { args } = context;
        const inv = invocationOf(context);
        const { app } = loadLoreApp({ inv });
        try {
          const by = resolveActor(inv.io, undefined, inv.env, inv.cwd, inv.user);
          const result = await declareEditPath(buildEditScopeDeps(app), {
            workingCopy: args.worktree as string,
            task: args.target as string,
            path: args.path as string,
            by,
            source: app.callerSurface,
          });
          if (!result.ok) {
            inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
            return exitCode(result.error);
          }
          const verdict = result.value;
          // reason: only a written anchor changes the scope file; the worktree is named by the caller, plus the cwd's.
          if (verdict.kind === "declared") {
            await refreshScopeFilesOf(app, verdict.task, await scopeCandidatesOf(app, verdict.task, inv.cwd, [args.worktree as string]));
          }
          if (args.json) printLine(inv.io.stdout, JSON.stringify({ ok: verdict.kind !== "denied", data: verdict }, null, 2));
          if (verdict.kind === "denied") {
            inv.io.stderr.write(`Refused (${verdict.reason}): ${verdict.message}\n`);
            return EDIT_SCOPE_DENIED_EXIT;
          }
          if (!args.json) {
            printLine(
              inv.io.stdout,
              verdict.kind === "declared"
                ? `Declared ${verdict.path} on ${verdict.task} (v${verdict.version})`
                : verdict.kind === "covered"
                  ? `${verdict.path} is already covered by ${verdict.task}`
                  : `${verdict.path} is git-ignored in the working copy; nothing declared`,
            );
          }
        } finally {
          app.close();
        }
        return 0;
      },
    }),

    list: defineLoreCommand({
      meta: { name: "list", description: "List a task's file_anchors or a spec's / knowledge doc's code_anchors" },
      args: {
        target: {
          type: "positional",
          description: "Task, spec, or knowledge document ID or slug",
          required: true,
        },
        json: {
          type: "boolean",
          description: "Output result as JSON",
        },
      },
      async run(context): Promise<number> {
        const { args } = context;
        const inv = invocationOf(context);
        const { app } = loadLoreApp({ inv });
        try {
          const targetResult = await resolveAnchorTarget(app, args.target as string);

          if (!targetResult.ok) {
            inv.io.stderr.write(formatErrorFor(inv, targetResult.error) + "\n");
            return exitCode(targetResult.error);
          }

          const doc = targetResult.value;
          let anchors: string[];
          if (doc.type === "task") {
            anchors = (doc.extra["file_anchors"] as string[] | undefined) ?? [];
          } else if (isCodeAnchorTarget(doc.type)) {
            anchors = (doc.extra["code_anchors"] as string[] | undefined) ?? [];
          } else {
            const error = unsupportedTargetTypeError(doc.type);
            inv.io.stderr.write(formatErrorFor(inv, error) + "\n");
            return exitCode(error);
          }

          if (args.json) {
            printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { anchors } }, null, 2));
            return 0;
          }

          printLine(inv.io.stdout, `${doc.type === "task" ? "File" : "Code"} anchors for ${doc.slug}:`);
          renderAnchorList(inv.io, anchors);
        } finally {
          app.close();
        }
        return 0;
      },
    }),
  },
});
