/**
 * Binds `PlanCloseService` — the one close function — to the real App (AC-DCS2-11, AC-DCS2-12, AC-DCS2-20; BR-1379, BR-1507).
 *
 * Purpose: the CLI-side wiring every entry of a plan close shares: `lore plan close`, and the review batch that the last archive of a
 *   plan starts (`closeFlowOf` wraps each plan the batch assesses in the same close function).
 * Public surface: buildPlanCloseService, closeFlowOf, rowOfCloseResult, resolveGitCommonDir.
 * Invariants:
 *   - The plan lease is a file under the git common dir (never a ticket of the landing queue); its holder is identified by pid plus
 *     process start time, read from the same process-table port the queue and run reaping use.
 *   - The rule apply covers EVERY spec the plan is parented to or implements, through the one `RuleChangeService`.
 *   - A refusal of a close step is a batch row `kept-open` naming the cause (exit 0 of the batch); an infrastructure error is an `error`
 *     row. A busy plan lease and an already closed plan are `skipped` rows: the holder, or the finished close, owns the plan.
 * Side-effect class: IO (git, the process table, files under the git common dir, App reads and writes).
 */

import { spawnSync } from "node:child_process";
import { dirname, resolve as resolvePath } from "node:path";
import { err, ok, type DocRecord, type LoreError, type Result } from "@lore/core";
import type { App } from "../../app.js";
import { PlanCloseLease } from "../../service/plan-close-lease.js";
import { PLAN_CLOSE_REFUSALS, PlanCloseService, type PlanCloseResult } from "../../service/plan-close-service.js";
import type { BatchPlanRow, BatchRunPorts } from "../../service/review-batch-service.js";
import { buildRealFsProbe } from "../real-fs-probe.js";
import { createRealProcessTablePort } from "../process-table-port.js";
import type { invocationOf } from "./command-invocation.js";

type Inv = ReturnType<typeof invocationOf>;

/** The absolute git common dir of the repository holding `projectRoot`. */
export function resolveGitCommonDir(projectRoot: string, env: Readonly<Record<string, string | undefined>>): Result<string, LoreError> {
  const run = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: projectRoot, encoding: "utf8", env: { ...env } });
  if (run.status !== 0 || run.stdout.trim() === "") {
    return err({ code: "STORE_ERROR", message: `cannot locate the git common dir of ${projectRoot} for the plan lease: ${(run.stderr ?? "").trim()}` });
  }
  return ok(run.stdout.trim());
}

/** What {@link buildPlanCloseService} binds. */
export interface PlanCloseWiringInput {
  readonly app: App;
  readonly inv: Inv;
  /** The corpus database path (`loadLoreApp`'s `dbPath`); the project root is two levels above it. */
  readonly dbPath: string;
  /** The acting identity of the close's writes. */
  readonly actor: string;
  /**
   * An extra verification step before the assess; `undefined` = none. The batch no longer attests at each landing (main's BR-1379:
   * criteria run once at the assessed commit inside the assess), so the callers pass none.
   */
  readonly verify?: ((planSlug: string) => Promise<Result<unknown, LoreError>>) | undefined;
}

/**
 * Builds the close function over the real App.
 *
 * @returns the service, or the error when the git common dir (the lease's home) cannot be located
 */
export function buildPlanCloseService(input: PlanCloseWiringInput): Result<PlanCloseService, LoreError> {
  const { app, inv, dbPath, actor, verify } = input;
  const projectRoot = dirname(dirname(resolvePath(dbPath)));
  const commonDir = resolveGitCommonDir(projectRoot, inv.env);
  if (!commonDir.ok) return commonDir;
  const processes = createRealProcessTablePort({ env: inv.env, cwd: inv.cwd });
  const ruleChanges = app.ruleChangeService;
  const drift = app.driftCheckService;
  const linkedSpecs = async (plan: DocRecord): Promise<Result<readonly DocRecord[], LoreError>> => {
    const bundle = await app.corpusService.getPlanBundle(plan.id);
    if (!bundle.ok) return bundle;
    const specs = new Map<string, DocRecord>();
    if (bundle.value.spec !== undefined) specs.set(bundle.value.spec.id, bundle.value.spec);
    const read = await app.corpusService.get(plan.id);
    if (!read.ok) return read;
    for (const related of read.value.navigation.related) {
      if (related.link_type !== "implements" || related.type !== "spec" || specs.has(related.id)) continue;
      const spec = await app.corpusService.get(related.id);
      if (!spec.ok) return spec;
      specs.set(spec.value.doc.id, spec.value.doc);
    }
    return ok([...specs.values()]);
  };
  return ok(
    new PlanCloseService({
      leases: new PlanCloseLease({ commonDir: commonDir.value, pid: process.pid, inspect: (pid) => processes.inspect(pid) }),
      getPlanBundle: (ref) => app.corpusService.getPlanBundle(ref),
      linkedSpecs,
      verifyPlan: async (plan) => (verify === undefined ? ok(undefined) : verify(plan.slug)),
      applySpec: async (spec) => {
        if (ruleChanges === undefined) return err({ code: "STORE_ERROR", message: "this composition has no rule change service, so the rule changes of a spec cannot be applied" });
        return ruleChanges.apply(spec.slug, { by: actor });
      },
      checkAnchors: async (specs) => {
        if (drift === undefined) return err({ code: "STORE_ERROR", message: "this composition has no drift-check service, so the code anchors of the specs cannot be checked" });
        const checked = await drift.checkDrift(buildRealFsProbe(projectRoot));
        if (!checked.ok) return checked;
        const slugs = new Set(specs.map((spec) => spec.slug));
        return ok(checked.value.drifts.filter((row) => slugs.has(row.doc_slug)).map((row) => `${row.doc_slug}: ${row.anchor} (${row.kind}${row.detail !== undefined ? `: ${row.detail}` : ""})`));
      },
      latestUat: (plan) => app.corpusService.getLatestUatVerdict(plan.id),
    }),
  );
}

/** A batch row of a plan the close did not assess. */
function rowOf(plan: string, outcome: BatchPlanRow["outcome"], detail: string): BatchPlanRow {
  return { plan, outcome, reviewed: false, failed: [], issues: [], detail };
}

/**
 * Turns the result of one close into the batch row of the plan (the batch exits 0 for every row that is not an `error`).
 *
 * @param plan - the plan the close was for (as the batch named it)
 */
export function rowOfCloseResult(plan: string, result: Result<PlanCloseResult<BatchPlanRow>, LoreError>): BatchPlanRow {
  if (!result.ok) {
    const message = "message" in result.error && typeof result.error.message === "string" ? result.error.message : result.error.code;
    const refused = result.error.code === "VALIDATION_ERROR" && (PLAN_CLOSE_REFUSALS as readonly string[]).includes(result.error.field);
    return refused ? rowOf(plan, "kept-open", `close refused, the plan stays open: ${message}`) : rowOf(plan, "error", `close: ${message}`);
  }
  const closed = result.value;
  switch (closed.state) {
    case "busy":
      return rowOf(closed.plan, "skipped", `another close holds the plan lease (pid ${String(closed.holder.pid)} since ${closed.holder.since}); the plan is left to the holder`);
    case "already-closed":
      return rowOf(closed.plan, "skipped", `already ${closed.status}`);
    case "assessed":
      return closed.notes.length === 0 ? closed.row : { ...closed.row, detail: `${closed.row.detail}; ${closed.notes.join("; ")}` };
  }
}

/**
 * The `closeFlow` port of the review batch: each plan the batch assesses goes through the one close function.
 *
 * @param service - from {@link buildPlanCloseService}
 */
export function closeFlowOf(service: PlanCloseService): NonNullable<BatchRunPorts["closeFlow"]> {
  return async (ref, assess) => rowOfCloseResult(ref, await service.close<BatchPlanRow>(ref, () => assess()));
}
