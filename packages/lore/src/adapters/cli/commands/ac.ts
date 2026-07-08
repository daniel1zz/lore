/**
 * lore ac — manage structured acceptance criteria on a spec document.
 *
 * Subcommands:
 *   add  <spec> <id> --statement <s> --mode <script|ai|human>
 *          script: --oracle <tsc|test|lint|build|e2e|other> --command <cmd>
 *          ai:     --rubric <text>
 *          human:  --note <text>  (optional)
 *   list <spec> [--json]           List declared criteria (+ per-AC coverage when
 *                                   the spec has a child plan; dangling ac_ref ids).
 *   rm   <spec> <id> [--force]     Remove a criterion (exit 4 if evidence still
 *                                   references it, unless --force).
 *
 * All subcommands accept --json for machine-readable output (SPEC-003 §4).
 * Exit codes per SPEC-003 §5 (via utils.ts::exitCode):
 *   0 = success
 *   3 = DOC_NOT_FOUND (spec not found)
 *   4 = VALIDATION_ERROR (malformed criterion, duplicate id, 50-entry cap, unknown
 *       id on rm, evidence blocking rm without --force)
 *   5 = STALE_VERSION
 *
 * Source: SPEC-038 §4, §6 AC-ACODE-7
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError } from "../utils.js";
import type { AcceptanceCriterion } from "@lore/core";
import type { AcService, AcListResult } from "../../../service/ac-service.js";
import type { App } from "../../../app.js";

/**
 * `App.acService` is typed optional only to keep pre-existing hand-built App test
 * stubs (outside this task's file anchors) compiling — see its JSDoc in app.ts.
 * `loadLoreApp()` (this adapter's only App source) always returns a fully-wired
 * App from `createApp`, so this assertion never actually fires in the CLI.
 */
function requireAcService(app: App): AcService {
  if (app.acService === undefined) {
    throw new Error("Internal error: AcService not wired on App");
  }
  return app.acService;
}

export default defineCommand({
  meta: {
    name: "ac",
    description: "Manage structured acceptance criteria on a spec (add / list / rm)",
  },
  subCommands: {
    add: defineCommand({
      meta: { name: "add", description: "Append a new acceptance criterion to a spec" },
      args: {
        spec: {
          type: "positional",
          description: "Spec document ID or slug",
          required: true,
        },
        id: {
          type: "positional",
          description: "Criterion id, e.g. AC-FEATURE-1",
          required: true,
        },
        statement: {
          type: "string",
          description: "What the criterion asserts",
          required: true,
        },
        mode: {
          type: "string",
          description: "Verify mode: script | ai | human",
          required: true,
        },
        oracle: {
          type: "string",
          description: "script mode only: tsc | test | lint | build | e2e | other",
        },
        command: {
          type: "string",
          description: "script mode only: exact command to run",
        },
        rubric: {
          type: "string",
          description: "ai mode only: judging rubric text",
        },
        note: {
          type: "string",
          description: "human mode only: optional free-text note",
        },
        json: {
          type: "boolean",
          description: "Output result as JSON",
        },
      },
      async run({ args }) {
        const { app } = loadLoreApp();
        try {
          const criterion = buildCriterionCandidate(args);
          const result = await requireAcService(app).addCriterion(args.spec as string, criterion);

          if (!result.ok) {
            process.stderr.write(formatError(result.error) + "\n");
            process.exitCode = exitCode(result.error);
            return;
          }

          if (args.json) {
            console.log(JSON.stringify({ ok: true, data: { criteria: result.value } }, null, 2));
            return;
          }

          console.log(`Added acceptance criterion "${args.id as string}" to spec ${args.spec as string}`);
          renderCriteriaList({ criteria: result.value, coverage: null, dangling: [] });
        } finally {
          app.close();
        }
      },
    }),

    list: defineCommand({
      meta: { name: "list", description: "List declared acceptance criteria for a spec" },
      args: {
        spec: {
          type: "positional",
          description: "Spec document ID or slug",
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
          const result = await requireAcService(app).listCriteria(args.spec as string);

          if (!result.ok) {
            process.stderr.write(formatError(result.error) + "\n");
            process.exitCode = exitCode(result.error);
            return;
          }

          if (args.json) {
            console.log(JSON.stringify({ ok: true, data: result.value }, null, 2));
            return;
          }

          if (result.value.criteria.length === 0) {
            console.log("No acceptance criteria declared on this spec.");
            return;
          }

          renderCriteriaList(result.value);
        } finally {
          app.close();
        }
      },
    }),

    rm: defineCommand({
      meta: {
        name: "rm",
        description: "Remove a declared acceptance criterion (fails if evidence still references it)",
      },
      args: {
        spec: {
          type: "positional",
          description: "Spec document ID or slug",
          required: true,
        },
        id: {
          type: "positional",
          description: "Criterion id to remove",
          required: true,
        },
        force: {
          type: "boolean",
          description: "Remove even when evidence still references this id (existing ac_ref becomes dangling)",
        },
        json: {
          type: "boolean",
          description: "Output result as JSON",
        },
      },
      async run({ args }) {
        const { app } = loadLoreApp();
        try {
          const result = await requireAcService(app).removeCriterion(args.spec as string, args.id as string, {
            force: args.force === true,
          });

          if (!result.ok) {
            process.stderr.write(formatError(result.error) + "\n");
            process.exitCode = exitCode(result.error);
            return;
          }

          if (args.json) {
            console.log(JSON.stringify({ ok: true, data: { criteria: result.value } }, null, 2));
            return;
          }

          console.log(`Removed acceptance criterion "${args.id as string}" from spec ${args.spec as string}`);
          if (result.value.length > 0) {
            renderCriteriaList({ criteria: result.value, coverage: null, dangling: [] });
          } else {
            console.log("No acceptance criteria remaining.");
          }
        } finally {
          app.close();
        }
      },
    }),
  },
});

// ─── Input Assembly ──────────────────────────────────────────────────────────

/**
 * Assemble a candidate criterion object from raw CLI args — deliberately untyped
 * (`unknown` at the AcService boundary): schema validation (`acceptanceCriterionSchema`
 * via `specAcceptanceCriteriaSchema`) is the single source of truth for whether the
 * mode-specific fields (oracle+command / rubric / note) are actually present and
 * well-formed. This function only shapes the object; it does not validate it.
 */
function buildCriterionCandidate(args: Record<string, unknown>): unknown {
  const mode = args.mode as string;
  let verify: Record<string, unknown>;
  if (mode === "script") {
    verify = {
      mode: "script",
      ...(typeof args.oracle === "string" ? { oracle: args.oracle } : {}),
      ...(typeof args.command === "string" ? { command: args.command } : {}),
    };
  } else if (mode === "ai") {
    verify = {
      mode: "ai",
      ...(typeof args.rubric === "string" ? { rubric: args.rubric } : {}),
    };
  } else if (mode === "human") {
    verify = {
      mode: "human",
      ...(typeof args.note === "string" ? { note: args.note } : {}),
    };
  } else {
    // reason: an unrecognized mode string fails schema validation's discriminated
    // union (no matching branch) — surfaces as VALIDATION_ERROR from addCriterion,
    // not a CLI-side pre-check. Passed through verbatim so the error message names
    // the actual bad value.
    verify = { mode };
  }

  return {
    id: args.id as string,
    statement: args.statement as string,
    verify,
  };
}

// ─── Output Helpers ──────────────────────────────────────────────────────────

/**
 * Render a numbered list of acceptance criteria to stdout, with a coverage badge
 * prefix when `coverage` is present (✔ all-pass, ✘ any-fail, · no evidence yet) and
 * a trailing "dangling" note when evidence references undeclared ids.
 */
function renderCriteriaList(result: AcListResult): void {
  for (const criterion of result.criteria) {
    const badge = result.coverage !== null ? `${coverageBadge(result.coverage, criterion.id)} ` : "";
    console.log(`  ${badge}${criterion.id} — ${criterion.statement} [${describeVerify(criterion.verify)}]`);
  }
  if (result.dangling.length > 0) {
    console.log(
      `\nDangling ac_ref (evidence references ids no longer declared): ${result.dangling.join(", ")}`,
    );
  }
}

function describeVerify(verify: AcceptanceCriterion["verify"]): string {
  switch (verify.mode) {
    case "script":
      return `script:${verify.oracle} — ${verify.command}`;
    case "ai":
      return `ai — ${verify.rubric}`;
    case "human":
      return verify.note !== undefined ? `human — ${verify.note}` : "human";
  }
}

function coverageBadge(coverage: AcListResult["coverage"], acId: string): string {
  const fact = coverage?.find((f) => f.ac_id === acId);
  if (fact === undefined) return "·";
  if (fact.fail > 0) return `✘(${fact.pass}/${fact.fail})`;
  if (fact.pass > 0) return `✔(${fact.pass}/${fact.fail})`;
  return "·";
}
