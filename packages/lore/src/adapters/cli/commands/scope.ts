/**
 * lore scope — manage a task's or phase's declared `extra.ac_scope`: the subset
 * of the governing spec's acceptance-criterion ids that doc CLAIMS
 * (spec-declared-scope-attestation-contract-task-owned-ac-scope §Contract
 * Details "Authoring surface").
 *
 * Subcommands:
 *   add  <target> <ac-id...>   Read-modify-write UNION — declare more ids (repeatable positional).
 *   rm   <target> <ac-id...>   Read-modify-write DIFFERENCE — un-declare ids.
 *   list <target>              Show the target's currently declared scope.
 *
 * `<target>` is resolved FIRST, then dispatched by its doc type — deliberately
 * the same resolve-then-dispatch shape `commands/anchor.ts` uses:
 *   - task  → `TaskWorkflowService.addAcScope`/`removeAcScope`
 *   - phase → `PhaseWorkflowService.addAcScope`/`removeAcScope`
 *   - any other type → `VALIDATION_ERROR`, exit 4, naming "task or phase".
 * Both service pairs delegate the merge to ONE shared pure computation
 * (`computeAcScopeEdit`, `@lore/core`), which is also the sole production call
 * site of the `assertScopeFreeze` evidence-freeze invariant — so the two tiers
 * cannot drift and the refusal literal is identical on both.
 *
 * Two contract points this command exists to make reachable:
 *   1. Un-declaring the LAST id stores `ac_scope: []` — an EMPTY ARRAY, never an
 *      absent key. Absent means nobody ever declared a scope; empty means an
 *      author declared this doc claims nothing, and `lore verify` refuses the
 *      two with DIFFERENT messages. `list --json` therefore reports
 *      `scope_declared` alongside `ac_scope` so a consumer can tell them apart.
 *   2. An id that already carries evidence (`verification_evidence[].ac_ref`)
 *      cannot be removed at all — exit 4 with the literal
 *      `cannot remove ac_scope id(s) with recorded evidence`.
 *
 * There is deliberately NO `lore set --ac-scope` (`set` replaces `extra`
 * wholesale, which would silently delete other services' owned state — the same
 * reason `file_anchors`/`claim`/`verification_evidence`/`validity` each have a
 * dedicated writer). The existing strict unknown-flag seam
 * (`strict-flags.ts`) is what refuses it, exit 2 — no bespoke check here.
 * Declare a scope at creation time with `lore create task --ac-scope <id>`
 * (repeatable).
 *
 * Actor identity: the invoking run, via utils.ts::resolveActor — this command takes no `--by`.
 *
 * Exit codes per SPEC-003 §5:
 *   0 = success
 *   3 = DOC_NOT_FOUND (target not found)
 *   4 = VALIDATION_ERROR (not a task/phase, blank id, >50-id cap, or an
 *       evidenced-id removal)
 *   5 = STALE_VERSION
 *
 * Source: spec-declared-scope-attestation-contract-task-owned-ac-scope
 *         §Contract Details, §Acceptance Criteria AC-VS-9, AC-VS-10, AC-VS-11;
 *         SPEC-056 §Design Decisions D4 (`assertScopeFreeze`)
 */

import type { Invocation } from "@lore/core";
import { setExitCode } from "../run-scope.js";
import { defineCommand } from "citty";
import type { DocRecord, LoreError, Result } from "@lore/core";
import { extractDeclaredAcScope } from "@lore/core";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, formatErrorFor, resolveActor } from "../utils.js";
import { invocationOf } from "../command-invocation.js";

/**
 * Reads every trailing positional argument beyond the `skip` leading ones
 * already bound to named `type: "positional"` args (citty maps exactly ONE
 * token per declared positional — `.shift()` off a COPY of `parsed._`, never
 * mutating `parsed._` itself). Used for `<ac-id...>`'s variadic collection,
 * since citty has no built-in "collect the rest" positional type.
 *
 * reason: byte-identical twin of `commands/anchor.ts`'s helper of the same
 * name. NOT hoisted into `utils.ts` by this task — `anchor.ts` is outside its
 * declared file anchors, and a shared helper only one of the two call sites
 * could be pointed at is worse than two documented copies. Hoist BOTH together
 * when a task owns both files.
 *
 * @param args - The citty-parsed args object (proxies through to `parsed._`).
 * @param skip - Number of leading positionals already bound to named args
 *   (1 here: `target` claims the first slot).
 */
function collectVariadicPositionals(args: Record<string, unknown>, skip: number): string[] {
  const all = (args as { _?: unknown[] })._ ?? [];
  return all.slice(skip).map(String);
}

/** Render a numbered list of declared AC ids, distinguishing absent from explicitly-empty. */
function renderScopeList(acScope: string[], declared: boolean): void {
  if (acScope.length === 0) {
    console.log(declared ? "  (scope declared EMPTY — claims no criterion)" : "  (no ac_scope declared)");
    return;
  }
  for (let i = 0; i < acScope.length; i++) {
    console.log(`  ${i + 1}. ${acScope[i]}`);
  }
}

/**
 * Resolves `idOrSlug` to a `DocRecord` — the shared FIRST step of
 * `add`/`rm`/`list`'s resolve-then-dispatch.
 */
async function resolveScopeTarget(
  app: ReturnType<typeof loadLoreApp>["app"],
  idOrSlug: string,
): Promise<Result<DocRecord, LoreError>> {
  const result = await app.corpusService.get(idOrSlug);
  if (!result.ok) return result;
  return { ok: true, value: result.value.doc };
}

/**
 * The `VALIDATION_ERROR` a target resolving to neither `task` nor `phase`
 * produces — routed through the normal `formatError`/`exitCode` pipeline
 * (exit 4) rather than a hand-rolled stderr line, for consistency with every
 * other error path here.
 */
function unsupportedTargetTypeError(docType: string): LoreError {
  return {
    code: "VALIDATION_ERROR",
    field: "type",
    message: `Expected a task or phase document; got type '${docType}' (a plan's own ac_scope is declared with \`lore set\`, not here)`,
    value: docType,
  };
}

/** The `PhaseWorkflowService`-not-wired guard, mirroring anchor.ts's DriftCheckService check. */
function phaseServiceMissingMessage(): string {
  return "Error: PhaseWorkflowService not wired on this App instance.\n";
}

/**
 * Runs one add/rm mutation against whichever tier `target` belongs to, and
 * renders the shared success output. Keeps `add` and `rm` from duplicating the
 * four-way (task|phase) × (text|json) rendering matrix.
 */
async function runScopeMutation(inv: Invocation, 
  app: ReturnType<typeof loadLoreApp>["app"],
  target: DocRecord,
  op: "add" | "rm",
  targetId: string,
  acIds: string[],
  by: string,
  json: boolean,
): Promise<void> {
  let result: Result<DocRecord, LoreError>;

  if (target.type === "task") {
    result =
      op === "add"
        ? await app.taskWorkflowService.addAcScope(targetId, acIds, { by, source: app.callerSurface })
        : await app.taskWorkflowService.removeAcScope(targetId, acIds, { by, source: app.callerSurface });
  } else if (target.type === "phase") {
    if (app.phaseWorkflowService === undefined) {
      process.stderr.write(phaseServiceMissingMessage());
      setExitCode(1);
      return;
    }
    result =
      op === "add"
        ? await app.phaseWorkflowService.addAcScope(targetId, acIds, { by, source: app.callerSurface })
        : await app.phaseWorkflowService.removeAcScope(targetId, acIds, { by, source: app.callerSurface });
  } else {
    const error = unsupportedTargetTypeError(target.type);
    process.stderr.write(formatErrorFor(inv, error) + "\n");
    setExitCode(exitCode(error));
    return;
  }

  if (!result.ok) {
    process.stderr.write(formatErrorFor(inv, result.error) + "\n");
    setExitCode(exitCode(result.error));
    return;
  }

  const doc = result.value;
  // Post-write read of the SAME record the service returned — `[]` here is a
  // real declared-empty scope, never a "field missing" fallback.
  const acScope = extractDeclaredAcScope(doc) ?? [];

  if (json) {
    console.log(JSON.stringify({ ok: true, data: { doc, ac_scope: acScope } }, null, 2));
    return;
  }

  const verb = op === "add" ? "Declared" : "Un-declared";
  console.log(`${verb} ${acIds.length} ac_scope id(s) on ${doc.slug} (v${doc.version})`);
  renderScopeList(acScope, true);
}

export default defineCommand({
  meta: {
    name: "scope",
    description: "Manage a task's or phase's declared ac_scope — the AC ids it claims (add / rm / list)",
  },
  subCommands: {
    add: defineCommand({
      meta: {
        name: "add",
        description: "Declare one or more acceptance-criterion ids on a task or phase (union with existing)",
      },
      args: {
        target: {
          type: "positional",
          description: "Task or phase document ID or slug",
          required: true,
        },
        "ac-id": {
          type: "positional",
          description: "[repeatable] Acceptance-criterion id declared on the governing spec, e.g. AC-VS-9",
          required: true,
        },
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
          const targetId = args.target as string;
          const acIds = collectVariadicPositionals(args, 1);

          const targetResult = await resolveScopeTarget(app, targetId);
          if (!targetResult.ok) {
            process.stderr.write(formatErrorFor(inv, targetResult.error) + "\n");
            setExitCode(exitCode(targetResult.error));
            return;
          }

          const by = resolveActor(undefined, inv.env, inv.cwd, inv.user);
          await runScopeMutation(inv, app, targetResult.value, "add", targetId, acIds, by, args.json === true);
        } finally {
          app.close();
        }
      },
    }),

    rm: defineCommand({
      meta: {
        name: "rm",
        description:
          "Un-declare one or more acceptance-criterion ids (refused for any id that already carries evidence; removing the last id leaves an EMPTY scope, not an absent one)",
      },
      args: {
        target: {
          type: "positional",
          description: "Task or phase document ID or slug",
          required: true,
        },
        "ac-id": {
          type: "positional",
          description: "[repeatable] Acceptance-criterion id to un-declare",
          required: true,
        },
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
          const targetId = args.target as string;
          const acIds = collectVariadicPositionals(args, 1);

          const targetResult = await resolveScopeTarget(app, targetId);
          if (!targetResult.ok) {
            process.stderr.write(formatErrorFor(inv, targetResult.error) + "\n");
            setExitCode(exitCode(targetResult.error));
            return;
          }

          const by = resolveActor(undefined, inv.env, inv.cwd, inv.user);
          await runScopeMutation(inv, app, targetResult.value, "rm", targetId, acIds, by, args.json === true);
        } finally {
          app.close();
        }
      },
    }),

    list: defineCommand({
      meta: { name: "list", description: "List a task's or phase's declared ac_scope" },
      args: {
        target: {
          type: "positional",
          description: "Task or phase document ID or slug",
          required: true,
        },
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
          const targetResult = await resolveScopeTarget(app, args.target as string);
          if (!targetResult.ok) {
            process.stderr.write(formatErrorFor(inv, targetResult.error) + "\n");
            setExitCode(exitCode(targetResult.error));
            return;
          }

          const doc = targetResult.value;
          if (doc.type !== "task" && doc.type !== "phase") {
            const error = unsupportedTargetTypeError(doc.type);
            process.stderr.write(formatErrorFor(inv, error) + "\n");
            setExitCode(exitCode(error));
            return;
          }

          const declaredScope = extractDeclaredAcScope(doc);
          const acScope = declaredScope ?? [];
          const scopeDeclared = declaredScope !== undefined;

          if (args.json) {
            console.log(
              JSON.stringify({ ok: true, data: { ac_scope: acScope, scope_declared: scopeDeclared } }, null, 2),
            );
            return;
          }

          console.log(`Declared ac_scope for ${doc.slug}:`);
          renderScopeList(acScope, scopeDeclared);
        } finally {
          app.close();
        }
      },
    }),
  },
});
