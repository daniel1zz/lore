/**
 * lore outline — read-only after slice 3a (BR-985). The structured PRD outline and the plan-close
 * sync exemption are superseded by the baseline tree: `set`, `rm` and `exempt` are RETIRED and refuse
 * with outcome code 4 (VALIDATION_ERROR) naming the baseline action that replaces them; `list` still
 * prints whatever entries are already stored. Thin pipe over `PrdOutlineService.outlineList` — zero
 * business logic here.
 *
 * Subcommands:
 *   list   <prd> [--json]   List stored outline entries in declaration order (works as before).
 *   set | rm | exempt       Retired: exit 4, nothing written, stderr (or the `--json` error envelope)
 *                           names `lore baseline add`. The retired check runs FIRST, before any
 *                           argument-completeness check, so a bare `outline exempt <plan>` is also 4.
 *
 * Exit codes per SPEC-003 §5 (via utils.ts::exitCode): 0 = list success, 3 = DOC_NOT_FOUND,
 * 4 = VALIDATION_ERROR (every retired write; not a prd target on `list`).
 *
 * The retired verbs keep their flag declarations (all optional) only so the SPEC-051 strict-flag seam
 * does not turn an old invocation into an unrelated usage error (exit 2) before the refusal runs.
 *
 * Source: spec-baseline-slice-3a-architecture-tree-baseline-root (Design "Outline"), BR-985;
 * adapters/cli/CLAUDE.md thin-adapter invariant
 */

import type { Invocation } from "@lore/core";
import { setExitCode } from "../run-scope.js";
import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, formatErrorFor } from "../utils.js";
import type { LoreError, OutlineEntry } from "@lore/core";
import type { PrdOutlineService } from "../../../service/prd-outline-service.js";
import type { App } from "../../../app.js";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";
import type { CliIo } from "../output.js";

/**
 * `App.prdOutlineService` is typed optional only to keep pre-existing
 * hand-built App test stubs (outside this task's file anchors) compiling —
 * see `AcService`'s identical guard in `commands/ac.ts`. `loadLoreApp()`
 * (this adapter's only App source) always returns a fully-wired App from
 * `createApp`, so this assertion never actually fires in the CLI.
 */
function requireOutlineService(app: App): PrdOutlineService {
  if (app.prdOutlineService === undefined) {
    throw new Error("Internal error: PrdOutlineService not wired on App");
  }
  return app.prdOutlineService;
}

/**
 * The refusal every retired outline write returns (BR-985): names the baseline action that replaces
 * the outline, so the operator is never left at a dead end.
 */
function retiredOutlineWrite(verb: string): LoreError {
  return {
    code: "VALIDATION_ERROR",
    field: "outline",
    message:
      `The outline write "${verb}" is retired: the outline is superseded by the baseline tree. ` +
      `Record the same knowledge as baseline structure with \`lore baseline add\` ` +
      `(rules, branches and glossary; see its --help). \`lore outline list\` still reads existing entries.`,
  };
}

/** Prints the refusal (text or `--json` envelope) and sets exit code 4. Writes nothing. */
function refuseRetiredWrite(inv: Invocation, verb: string, json: unknown): void {
  const error = retiredOutlineWrite(verb);
  if (json === true) printLine(inv.io.stdout, JSON.stringify({ ok: false, error }, null, 2));
  else inv.io.stderr.write(formatErrorFor(inv, error) + "\n");
  setExitCode(exitCode(error));
}

export default defineCommand({
  meta: {
    name: "outline",
    description: "List a PRD's stored outline entries (writes are retired — see `lore baseline add`)",
  },
  subCommands: {
    set: defineCommand({
      meta: { name: "set", description: "RETIRED (BR-985): refused with exit 4; use `lore baseline add`" },
      args: {
        "prd": { type: "positional", description: "(retired — ignored)" },
        "section": { type: "string", description: "(retired — ignored)" },
        "title": { type: "string", description: "(retired — ignored)" },
        "tier": { type: "string", description: "(retired — ignored)" },
        "direction": { type: "string", description: "(retired — ignored)" },
        "decision-pointer": { type: "string", description: "(retired — ignored)" },
        "constraint": { type: "string", description: "(retired — ignored)" },
        "link": { type: "string", description: "(retired — ignored)" },
        json: {
          type: "boolean",
          description: "Output result as JSON",
        },
      },
      run(context) {
        const { args } = context;
        refuseRetiredWrite(invocationOf(context), "set", args.json);
      },
    }),

    list: defineCommand({
      meta: { name: "list", description: "List a PRD's declared outline entries" },
      args: {
        prd: {
          type: "positional",
          description: "PRD document ID or slug",
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
          const result = await requireOutlineService(app).outlineList(args.prd as string);

          if (!result.ok) {
            if (args.json) printLine(inv.io.stdout, JSON.stringify({ ok: false, error: result.error }, null, 2));
            else inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
            setExitCode(exitCode(result.error));
            return;
          }

          if (args.json) {
            printLine(inv.io.stdout, JSON.stringify({ ok: true, data: result.value }, null, 2));
            return;
          }

          if (result.value.length === 0) {
            printLine(inv.io.stdout, "No outline entries declared on this PRD.");
            return;
          }

          renderOutlineList(inv.io, result.value);
        } finally {
          app.close();
        }
      },
    }),

    rm: defineCommand({
      meta: { name: "rm", description: "RETIRED (BR-985): refused with exit 4; use `lore baseline add`" },
      args: {
        "prd": { type: "positional", description: "(retired — ignored)" },
        "section": { type: "positional", description: "(retired — ignored)" },
        json: {
          type: "boolean",
          description: "Output result as JSON",
        },
      },
      run(context) {
        const { args } = context;
        refuseRetiredWrite(invocationOf(context), "rm", args.json);
      },
    }),

    exempt: defineCommand({
      meta: { name: "exempt", description: "RETIRED (BR-985): refused with exit 4; use `lore baseline add`" },
      args: {
        "plan": { type: "positional", description: "(retired — ignored)" },
        "reason": { type: "string", description: "(retired — ignored)" },
        json: {
          type: "boolean",
          description: "Output result as JSON",
        },
      },
      run(context) {
        const { args } = context;
        refuseRetiredWrite(invocationOf(context), "exempt", args.json);
      },
    }),
  },
});

// ─── Output Helpers ──────────────────────────────────────────────────────────

function renderOutlineList(io: CliIo, entries: OutlineEntry[]): void {
  for (const entry of entries) {
    printLine(io.stdout, `  ${entry.section} — ${entry.title} [${entry.tier}]`);
  }
}
