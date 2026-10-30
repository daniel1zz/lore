/**
 * lore plan — plan-level writers.
 *
 * Subcommands:
 *   integration-branch <plan> <branch>
 *       Declare the feature branch the plan lands through (`extra.integration_branch`): a `blocks` edge is
 *       READY-met when the blocker landed there, while `lore done` still requires main.
 *
 * Accepts `--json`. Thin pipe over `PlanIntegrationBranchService` — zero business logic here (read-merge-write,
 * validation and audit shape live in the service), the same split `commands/ac.ts` uses over `AcService`.
 *
 * The plan-close exemptions (`exempt-attestation`, `exempt-assessment-freshness`) no longer exist: plan close
 * requires only a passing current milestone review (`lore assess`, BR-1372).
 *
 * Actor identity: the invoking run, via the SHARED `utils.ts::resolveActor` (no `--by` flag).
 *
 * Exit codes per SPEC-003 §5 (via utils.ts::exitCode): 0 success; 3 DOC_NOT_FOUND; 4 VALIDATION_ERROR (target is
 * not a plan, odd branch name); 5 STALE_VERSION.
 *
 * @invariant The `loadLoreApp` import is DYNAMIC and performed INSIDE `run()`: `loader.ts` pulls `bun:sqlite`, which
 *   vitest cannot resolve, so a static import would make this command untestable under vitest. Do NOT "harmonize"
 *   it back to a static import.
 */

import { defineLoreCommand } from "../cli-exit.js";

import { exitCode, formatErrorFor, resolveActor } from "../utils.js";
import type { PlanIntegrationBranchService } from "../../../service/plan-integration-branch-service.js";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";

/**
 * `App.planIntegrationBranchService` is typed optional only to keep pre-existing hand-built App test stubs
 * compiling — the identical guard `commands/ac.ts` uses. `loadLoreApp()` always returns a fully-wired App.
 */
function requirePlanIntegrationBranchService(app: {
  planIntegrationBranchService?: PlanIntegrationBranchService;
}): PlanIntegrationBranchService {
  const service = app.planIntegrationBranchService;
  if (service === undefined) {
    throw new Error("planIntegrationBranchService is not wired on this App instance");
  }
  return service;
}

export default defineLoreCommand({
  meta: {
    name: "plan",
    description: "Plan-level writers (integration branch)",
  },
  subCommands: {
    "integration-branch": defineLoreCommand({
      meta: {
        name: "integration-branch",
        description: "Declare the integration branch a plan lands through (blocks edges are ready-met on it)",
      },
      args: {
        plan: { type: "positional" as const, description: "Plan document ID or slug", required: true },
        branch: { type: "positional" as const, description: "Integration branch name", required: true },
        json: { type: "boolean" as const, description: "Output result as JSON" },
      },
      async run(context): Promise<number> {
        const { args } = context;
        const inv = invocationOf(context);
        const { loadLoreApp } = await import("../loader.js");
        const { app } = loadLoreApp({ inv });
        try {
          const by = resolveActor(inv);
          const result = await requirePlanIntegrationBranchService(app).setIntegrationBranch(args.plan as string, {
            branch: args.branch as string,
            by,
          });
          if (!result.ok) {
            if (args.json) printLine(inv.io.stdout, JSON.stringify({ ok: false, error: result.error }, null, 2));
            else inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
            return exitCode(result.error);
          }
          if (args.json) {
            printLine(inv.io.stdout, JSON.stringify({ ok: true, data: result.value }, null, 2));
            return 0;
          }
          printLine(inv.io.stdout, `Plan ${args.plan as string} integration branch: ${result.value.branch}`);
          printLine(inv.io.stdout, `  declared by ${result.value.by} at ${result.value.at}`);
          if (result.value.branch_state === "created") printLine(inv.io.stdout, `  created branch ${result.value.branch} at the tip of main`);
          if (result.value.branch_state === "reused") printLine(inv.io.stdout, `  branch ${result.value.branch} already exists at the tip of main; reused`);
        } finally {
          app.close();
        }
        return 0;
      },
    }),
  },
});
