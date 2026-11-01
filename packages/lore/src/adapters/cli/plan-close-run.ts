/**
 * The body of `lore plan close <plan>` (AC-DCS2-12, AC-DCS2-20; BR-1507): the ONE close function behind a hand command.
 *
 * Purpose: close a plan whose tasks are all archived or deprecated — refuse one with an open task naming each, otherwise hold the plan's own
 *   lease and run verify, rule apply of every linked spec, the anchor check, the P0 UAT gate and the assess (the judge, the issue filing and
 *   the gated archive). The automatic trigger and the review batch run the same function (`PlanCloseService`).
 * Public surface: runPlanClose, PLAN_CLOSE_EXIT_BUSY.
 * Invariants:
 *   - Exit codes: 0 closed (also accepted with known defects) or already closed; 4 refused (open tasks, a step, or a failed or not-measured
 *     gate dimension: the plan stays open and the output names the gate); 75 `plan-close-busy` (a live process holds the plan lease);
 *     1 an infrastructure error.
 *   - No review lease: the plan lease alone serializes closes of ONE plan, so a close of another plan is never blocked by this one.
 * Side-effect class: IO (the App's reads and writes, git, the judge, the issue tracker).
 */

import { err, ok, type LoreError, type Result } from "@lore/core";
import type { App } from "../../app.js";
import type { BatchPlanRow } from "../../service/review-batch-service.js";
import { buildBatchRunPorts, createAssessFiling, createAssessWiring, createBatchRunner, createReviewTestSlots } from "./assess-batch-wiring.js";
import type { invocationOf } from "./command-invocation.js";
import { printLine } from "./output.js";
import { buildPlanCloseService } from "./plan-close-wiring.js";
import { buildReviewLeases } from "./review-batch-wiring.js";
import { classifyFeedbackUpstream } from "./report-issue-wiring.js";
import { exitCode, formatErrorFor, resolveActor } from "./utils.js";
import { isAssessAiBraked } from "../../ai/resolve-ai.js";
import type { loadLoreApp } from "./loader.js";

/** `plan-close-busy`: EX_TEMPFAIL, the same class the merge queue uses. */
export const PLAN_CLOSE_EXIT_BUSY = 75;

type Inv = ReturnType<typeof invocationOf>;

/** What {@link runPlanClose} needs: the loaded app, its database path and config, the invocation and the plan. */
export interface PlanCloseRunInput {
  readonly inv: Inv;
  readonly app: App;
  readonly dbPath: string;
  readonly config: ReturnType<typeof loadLoreApp>["config"];
  readonly planRef: string;
  readonly json: boolean;
}

function printOutcome(input: PlanCloseRunInput, data: Record<string, unknown>, text: string): void {
  if (input.json) printLine(input.inv.io.stdout, JSON.stringify({ ok: true, data }, null, 2));
  else printLine(input.inv.io.stdout, text);
}

/**
 * Runs `lore plan close` against an already loaded app and returns its exit code; the caller closes the app.
 *
 * @param input - the app, the invocation and the plan
 */
export async function runPlanClose(input: PlanCloseRunInput): Promise<number> {
  const { inv, app } = input;
  const actor = resolveActor(inv);
  const reviewService = app.milestoneReviewService;
  if (reviewService === undefined) {
    inv.io.stderr.write("Error: this composition has no milestone review service, so a plan cannot be assessed; nothing was changed\n");
    return 1;
  }
  if (isAssessAiBraked(app.resolveAiDefault(undefined))) {
    inv.io.stderr.write("Error: AI is required to close a plan (its assess) but is disabled for this surface by config.ai.default_per_surface; nothing was changed\n");
    return 2;
  }
  const classification = classifyFeedbackUpstream(input.config);
  if (classification.kind === "retired") {
    inv.io.stderr.write(`${formatErrorFor(inv, classification.error)}\n`);
    return exitCode(classification.error);
  }
  // reason: BR-1511 — the assess of the plan runs under that plan's keyed lease like every review; this process's keyed leases name its holder
  const leases = buildReviewLeases(app, `${actor}:plan-close:${String(process.pid)}`);
  if (leases === undefined) {
    inv.io.stderr.write("Error: this composition has no lease store, so review work cannot be leased; nothing was changed\n");
    return 1;
  }
  const wiring = createAssessWiring({ app, inv, actor, reviewService, slots: createReviewTestSlots(inv, leases, input.config) });
  const filing = createAssessFiling({ app, inv, actor, upstream: classification.kind === "unconfigured" ? undefined : classification.cfg, leases });
  const closeService = buildPlanCloseService({ app, inv, dbPath: input.dbPath, actor });
  if (!closeService.ok) {
    inv.io.stderr.write(`${formatErrorFor(inv, closeService.error)}\n`);
    return exitCode(closeService.error);
  }
  const ports = buildBatchRunPorts({ app, actor, wiring, filing, leases, mode: "direct" });
  const runner = createBatchRunner(app);
  const closed = await closeService.value.close<Result<BatchPlanRow, LoreError>>(input.planRef, async (plan) => {
    const run = await runner.runBatch([plan.slug], ports);
    if (!run.ok) return run;
    const row = run.value.rows[0];
    if (row?.held !== undefined) return err({ code: "STORE_ERROR", message: `the plan's review lease is held by ${row.held.holder} until ${row.held.expires_at}` });
    return row === undefined ? err({ code: "STORE_ERROR", message: "the assess returned no row for the plan" }) : ok(row);
  });
  if (!closed.ok) {
    inv.io.stderr.write(`${formatErrorFor(inv, closed.error)}\n`);
    return exitCode(closed.error);
  }
  const result = closed.value;
  switch (result.state) {
    case "busy":
      inv.io.stderr.write(
        `plan-close-busy: another close of ${result.plan} holds its plan lease (pid ${String(result.holder.pid)}, since ${result.holder.since}); nothing was changed, run again when it ends\n`,
      );
      return PLAN_CLOSE_EXIT_BUSY;
    case "already-closed":
      printOutcome(input, { state: "already-closed", plan: result.plan, status: result.status }, `Plan ${result.plan} is already ${result.status}; nothing to do.`);
      return 0;
    case "assessed": {
      if (!result.row.ok) {
        inv.io.stderr.write(`${formatErrorFor(inv, result.row.error)}\n`);
        return exitCode(result.row.error);
      }
      const row = result.row.value;
      const issues = row.issues.length > 0 ? `; issues ${row.issues.map((n) => `#${String(n)}`).join(", ")}` : "";
      const notes = result.notes.length > 0 ? ` (${result.notes.join("; ")})` : "";
      if (row.outcome === "accepted" || row.outcome === "accepted-with-known-defects") {
        printOutcome(input, { state: "closed", plan: result.plan, outcome: row.outcome, failed: row.failed, issues: row.issues, review: row.review }, `Closed ${result.plan}: ${row.detail}${issues}${notes}`);
        return 0;
      }
      inv.io.stderr.write(`plan-close: ${result.plan} stays open (${row.outcome}): ${row.detail}${issues}${notes}\n`);
      // reason: a gate dimension that failed or is not measured, an owner decision that is pending and a refused archive each leave the plan open: exit 4 names why; a stage that errored is 1
      return row.outcome === "error" && row.stage !== "close" ? 1 : 4;
    }
  }
}
