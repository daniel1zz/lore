/**
 * The body of `lore migrate close-tasks [--apply]` (AC-DCS2-13): the command-side binding of `CloseTaskMigrationService`.
 *
 * Purpose: print the preview or the result of the migration and bind the ONE plan close function (`runPlanClose`, the body of `lore
 *   plan close`) as the service's `ClosePlanPort`, capturing what that close prints so the migration can name a failure's cause.
 * Public surface: runCloseTasksMigration.
 * Invariants:
 *   - exit codes: 0 preview, or an apply in which every due plan close succeeded (also when there was nothing to do); 4 when a plan
 *     close failed (stderr names each plan and its cause, after every other plan was processed); a store error is its own exit code.
 *   - the preview never loads anything the apply needs (no AI, no lease): it only reads.
 * Side-effect class: IO (the App's reads and writes, and the plan close's git, judge and tracker work on `--apply`).
 */

import type { App } from "../../app.js";
import type { ClosePlanPort, CloseTaskMigrationReport, PlanCloseOutcome } from "../../service/close-task-migration-service.js";
import type { invocationOf } from "./command-invocation.js";
import { printLine } from "./output.js";
import { runPlanClose } from "./plan-close-run.js";
import { exitCode, formatErrorFor } from "./utils.js";
import type { loadLoreApp } from "./loader.js";

type Inv = ReturnType<typeof invocationOf>;

/** What {@link runCloseTasksMigration} needs: the loaded app, its database path and config, and the flags. */
export interface CloseTasksRunInput {
  readonly inv: Inv;
  readonly app: App;
  readonly dbPath: string;
  readonly config: ReturnType<typeof loadLoreApp>["config"];
  readonly apply: boolean;
  readonly json: boolean;
}

/** The plan close of the migration: `lore plan close` in this process, its output captured. */
function planCloser(input: CloseTasksRunInput): ClosePlanPort {
  return {
    async closePlan(planSlug: string): Promise<PlanCloseOutcome> {
      let out = "";
      let errText = "";
      const captured: Inv = { ...input.inv, io: { ...input.inv.io, stdout: { write: (text: string) => (out += text) }, stderr: { write: (text: string) => (errText += text) } } };
      const code = await runPlanClose({ inv: captured, app: input.app, dbPath: input.dbPath, config: input.config, planRef: planSlug, json: false });
      if (code === 0) return { closed: true, detail: out.trim() };
      return { closed: false, exitCode: code, cause: (errText.trim() || out.trim() || `lore plan close exited ${String(code)}`) };
    },
  };
}

function printReport(input: CloseTasksRunInput, report: CloseTaskMigrationReport): void {
  const stdout = input.inv.io.stdout;
  if (input.json) {
    printLine(
      stdout,
      JSON.stringify(
        {
          ok: !report.plans.some((plan) => plan.state === "failed"),
          data: {
            applied: report.applied,
            tasks: report.rows.map((row) => ({ slug: row.slug, status: row.status, plan: row.plan ?? null, claim_holder: row.claimHolder ?? null, claimed: row.claimed, evidence_rows: row.evidenceRows, blocks_edges: row.blocksEdges })),
            plans: report.plans,
            resolved: report.resolved,
          },
        },
        null,
        2,
      ),
    );
    return;
  }
  printLine(stdout, report.applied ? "Close-task migration complete" : "Close-task migration (preview)");
  printLine(stdout, "─".repeat(40));
  if (report.rows.length === 0 && report.plans.length === 0) {
    printLine(stdout, "Nothing to do: no non-terminal close task and no plan close is due.");
    return;
  }
  for (const row of report.rows) {
    const claim = row.claimed ? `${report.applied ? "claim released" : "would release the claim"}${row.claimHolder !== undefined ? ` of ${row.claimHolder}` : ""}` : "no claim";
    printLine(stdout, `${row.slug} [${row.status}] plan ${row.plan ?? "(none)"}: ${claim}; ${String(row.evidenceRows)} evidence row(s) ${report.applied ? "moved" : "would move"} to the plan log; ${String(row.blocksEdges)} blocks edge(s) ${report.applied ? "removed" : "would be removed"}; ${report.applied ? "deprecated" : "would be deprecated"}`);
  }
  for (const plan of report.plans) {
    const verb = plan.state === "would-close" ? "plan close would run" : plan.state === "closed" ? "plan closed" : plan.state === "failed" ? "plan close FAILED" : "plan close waits";
    printLine(stdout, `${plan.plan}: ${verb}: ${plan.detail}`);
  }
  if (!report.applied) printLine(stdout, "\nRe-run with --apply to execute.");
}

/**
 * Runs the migration against an already loaded app and returns its exit code; the caller closes the app.
 *
 * @param input - the app, the invocation and the flags
 */
export async function runCloseTasksMigration(input: CloseTasksRunInput): Promise<number> {
  const { inv, app } = input;
  const service = app.closeTaskMigrationService;
  if (service === undefined) {
    inv.io.stderr.write("Internal error: CloseTaskMigrationService not wired on App\n");
    return 1;
  }
  const result = input.apply ? await service.apply(planCloser(input)) : await service.preview();
  if (!result.ok) {
    if (input.json) printLine(inv.io.stdout, JSON.stringify({ ok: false, error: result.error }, null, 2));
    else inv.io.stderr.write(`${formatErrorFor(inv, result.error)}\n`);
    return exitCode(result.error);
  }
  printReport(input, result.value);
  const failed = result.value.plans.filter((plan) => plan.state === "failed");
  if (failed.length === 0) return 0;
  const lines = failed.map((plan) => `  - ${plan.plan} (exit ${String(plan.exitCode)}): ${plan.detail}`);
  inv.io.stderr.write(`close-task-plan-close-failed: ${String(failed.length)} plan close(s) failed after every other plan was processed; the plan(s) stay open:\n${lines.join("\n")}\n`);
  return 4;
}
