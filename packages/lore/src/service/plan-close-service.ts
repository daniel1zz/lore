/**
 * PlanCloseService — the ONE close function of a plan (AC-DCS2-11, AC-DCS2-12, AC-DCS2-20; ledger D41; BR-1379, BR-1507).
 *
 * Purpose: `lore plan close`, the trigger of the last archive (through the detached review batch) and the review batch itself all call
 * {@link PlanCloseService.close}; there is no second path. It refuses a plan with an open task, takes the plan's OWN lease (never a ticket
 * of the landing queue, so a long assess never holds up a landing and a landing never holds up a close), then runs, in order: the
 * verification of the plan, rule apply of EVERY spec the plan is parented to or implements, the code anchor check of those specs, the P0
 * UAT gate, and the assess step it is handed (the judge, the issue filing and the gated archive).
 * Public surface: {@link PlanCloseService}, {@link PlanCloseDeps}, {@link PlanCloseResult}, {@link PlanCloseRefusalName},
 *   {@link PLAN_CLOSE_REFUSALS}.
 * Invariants:
 *   - A plan with any task that is not archived or deprecated is refused with `plan-open-tasks`, naming each task and its status; nothing
 *     is written (the check is made once, under the plan lease, on the plan as it is then). A deprecated task is not open.
 *   - The close is idempotent: a plan that is already archived (also when the first close finished while this one waited for the lease)
 *     answers `already-closed`, never an error and never a second assess.
 *   - A second close of a plan whose lease a live process holds answers `busy` naming the holder, and does nothing.
 *   - A step that refuses (verify, apply, anchors, UAT gate) leaves the plan OPEN naming the cause; the refusal is an error value and the
 *     lease is released. The assess step decides the AC-AF-6 outcome (gate failure keeps the plan open, non-gate failures close it with
 *     known defects); this service never reads a verdict.
 *   - A plan with no spec skips the rule apply and says so in `notes`.
 * Side-effect class: IO through injected ports (services never import each other; the CLI adapter binds the real ones).
 */

import { err, ok, type DocRecord, type LoreError, type PlanBundle, type Result } from "@lore/core";
import { PLAN_MEMBER_TERMINAL_STATUSES } from "../store/plan-progress.js";
import { planLeaseKey, type PlanCloseHolder, type PlanCloseLeasePort } from "./plan-close-lease.js";

/** The names of the refusals of a plan close; each is the `field` of a `VALIDATION_ERROR` (exit 4) and the first word of its message. */
export const PLAN_CLOSE_REFUSALS = ["plan-open-tasks", "plan-verify-failed", "plan-apply-failed", "plan-anchor-drift", "plan-uat-gate"] as const;

/** One of {@link PLAN_CLOSE_REFUSALS}. */
export type PlanCloseRefusalName = (typeof PLAN_CLOSE_REFUSALS)[number];

/** The ports the close composes; `app.ts` / the command bind them. */
export interface PlanCloseDeps {
  /** The plan's own lease. */
  readonly leases: PlanCloseLeasePort;
  readonly getPlanBundle: (planRef: string) => Promise<Result<PlanBundle, LoreError>>;
  /** Every spec the plan is parented to or implements. */
  readonly linkedSpecs: (plan: DocRecord) => Promise<Result<readonly DocRecord[], LoreError>>;
  /** The verification of the plan's landed criteria (attests them at their landing commits); an error leaves the plan open. */
  readonly verifyPlan: (plan: DocRecord) => Promise<Result<unknown, LoreError>>;
  /** `lore rule apply` of one spec (a spec with no change set is a no-op); an error leaves the plan open naming it. */
  readonly applySpec: (spec: DocRecord) => Promise<Result<unknown, LoreError>>;
  /** The code anchor check of the given specs: one description per drifted anchor, empty when none drifted. */
  readonly checkAnchors: (specs: readonly DocRecord[]) => Promise<Result<readonly string[], LoreError>>;
  /** The plan's latest linked UAT verdict (the same read the plan-close checkpoint makes). */
  readonly latestUat: (plan: DocRecord) => Promise<Result<{ readonly present: boolean; readonly p0Accepted: boolean; readonly uncoveredP0: readonly string[] }, LoreError>>;
}

/** What one close did. `Row` is whatever the handed assess step returns (the batch row). */
export type PlanCloseResult<Row> =
  | { readonly state: "busy"; readonly plan: string; readonly holder: PlanCloseHolder }
  | { readonly state: "already-closed"; readonly plan: string; readonly status: DocRecord["status"] }
  | { readonly state: "assessed"; readonly plan: string; readonly row: Row; readonly notes: readonly string[] };

/** Thrown inside one close by a step that refuses; {@link PlanCloseService.close} turns it into the error value. Never leaves this file. */
class PlanCloseStepRefused extends Error {
  constructor(readonly error: LoreError) {
    super("plan close step refused");
    this.name = "PlanCloseStepRefused";
  }
}

function refusal(name: PlanCloseRefusalName, message: string, detail?: unknown): LoreError {
  return { code: "VALIDATION_ERROR", field: name, message: `${name}: ${message}`, value: { refusal: name, ...(detail !== undefined ? { detail } : {}) }, rule: "BR-1507" };
}

function errorText(error: LoreError): string {
  return "message" in error && typeof error.message === "string" ? error.message : error.code;
}

/** The refusal of a plan with open tasks: every open task and its status, one per line. */
function openTasks(open: readonly DocRecord[]): LoreError {
  const lines = open.map((task) => `  - ${task.slug} (${task.status})`);
  return refusal(
    "plan-open-tasks",
    `the plan has ${open.length} open task(s), so it cannot close; each must be archived or deprecated first:\n${lines.join("\n")}`,
    open.map((task) => ({ task: task.slug, status: task.status })),
  );
}

/** The open tasks of a plan: every task that is neither archived nor deprecated. */
function openTasksOf(tasks: readonly DocRecord[]): DocRecord[] {
  return tasks.filter((task) => !PLAN_MEMBER_TERMINAL_STATUSES.has(task.status));
}

export class PlanCloseService {
  constructor(private readonly deps: PlanCloseDeps) {}

  /**
   * Closes `planRef` (see the module header).
   *
   * @param planRef - the plan's id or slug
   * @param assess - the judge, the issue filing and the gated archive of the plan; called last, only when every earlier step passed and the
   *   plan lease is held, and never for a plan that is already closed
   * @returns `assessed` with the assess step's own row, `already-closed`, `busy` (a live holder), or the refusal naming the open tasks or
   *   the step that left the plan open
   */
  async close<Row>(planRef: string, assess: (plan: DocRecord) => Promise<Row>): Promise<Result<PlanCloseResult<Row>, LoreError>> {
    return await new PlanCloseRun(this.deps).execute(planRef, assess);
  }
}

/** One close of one plan: it holds the notes the steps leave, so a service instance can serve any number of closes. */
class PlanCloseRun {
  private readonly leases: PlanCloseLeasePort;
  private readonly notes: string[] = [];

  constructor(private readonly deps: PlanCloseDeps) {
    this.leases = deps.leases;
  }

  async execute<Row>(planRef: string, assess: (plan: DocRecord) => Promise<Row>): Promise<Result<PlanCloseResult<Row>, LoreError>> {
    const first = await this.deps.getPlanBundle(planRef);
    if (!first.ok) return first;
    const terminal = this.terminalStatusOf(first.value.plan);
    if (terminal !== undefined) return ok({ state: "already-closed", plan: first.value.plan.slug, status: terminal });

    const plan = first.value.plan;
    const lease = await this.leases.acquire(planLeaseKey(plan));
    if (!lease.ok) return lease;
    if (lease.value.state === "busy") return ok({ state: "busy", plan: plan.slug, holder: lease.value.holder });
    try {
      return await this.runLocked(planRef, assess);
    } catch (cause) {
      if (cause instanceof PlanCloseStepRefused) return err(cause.error);
      throw cause;
    } finally {
      lease.value.release();
    }
  }

  /** The steps that run under the plan lease, on the plan as it is NOW (not as it was when the lease was asked for). */
  private async runLocked<Row>(planRef: string, assess: (plan: DocRecord) => Promise<Row>): Promise<Result<PlanCloseResult<Row>, LoreError>> {
    // reason: a close that waited for the lease sees the finished close of the plan it waited for (idempotent, no second assess)
    const fresh = await this.deps.getPlanBundle(planRef);
    if (!fresh.ok) return fresh;
    const plan = fresh.value.plan;
    const closedMeanwhile = this.terminalStatusOf(plan);
    if (closedMeanwhile !== undefined) return ok({ state: "already-closed", plan: plan.slug, status: closedMeanwhile });
    // reason: the open-task check is made HERE, under the lease, on the plan as it is now: it is the one authoritative check (no second copy
    // before the lease to disagree with it), and a refusal writes nothing
    const open = openTasksOf(fresh.value.tasks);
    if (open.length > 0) return err(openTasks(open));
    await this.verifyOrRefuse(plan);
    await this.applySpecs(plan);
    await this.checkAnchorsOrRefuse(plan);
    await this.requireUatGate(plan);
    const row = await assess(plan);
    return ok({ state: "assessed", plan: plan.slug, row, notes: this.notes });
  }

  private terminalStatusOf(plan: DocRecord): DocRecord["status"] | undefined {
    return plan.status === "archived" || plan.status === "deprecated" ? plan.status : undefined;
  }

  /** The verification of the plan's landed criteria; an error leaves the plan open. */
  private async verifyOrRefuse(plan: DocRecord): Promise<void> {
    const verified = await this.deps.verifyPlan(plan);
    if (!verified.ok) throw new PlanCloseStepRefused(refusal("plan-verify-failed", `the verification of ${plan.slug} failed, so it stays open: ${errorText(verified.error)}`));
  }

  /** Rule apply of EVERY spec the plan is parented to or implements; a refusal leaves the plan open naming the spec and its criteria. */
  private async applySpecs(plan: DocRecord): Promise<void> {
    const specs = await this.deps.linkedSpecs(plan);
    if (!specs.ok) throw new PlanCloseStepRefused(specs.error);
    if (specs.value.length === 0) {
      this.notes.push(`${plan.slug} has no spec: rule apply skipped`);
      return;
    }
    for (const spec of specs.value) {
      const applied = await this.deps.applySpec(spec);
      if (!applied.ok) {
        throw new PlanCloseStepRefused(refusal("plan-apply-failed", `rule apply of ${spec.slug} failed, so ${plan.slug} stays open: ${errorText(applied.error)}`, spec.slug));
      }
    }
  }

  /** The code anchor check of the plan's specs; any drifted anchor leaves the plan open naming it. */
  private async checkAnchorsOrRefuse(plan: DocRecord): Promise<void> {
    const specs = await this.deps.linkedSpecs(plan);
    if (!specs.ok) throw new PlanCloseStepRefused(specs.error);
    const drifted = await this.deps.checkAnchors(specs.value);
    if (!drifted.ok) throw new PlanCloseStepRefused(drifted.error);
    if (drifted.value.length > 0) {
      throw new PlanCloseStepRefused(refusal("plan-anchor-drift", `${drifted.value.length} code anchor(s) of the specs of ${plan.slug} no longer resolve, so it stays open:\n${drifted.value.map((line) => `  - ${line}`).join("\n")}`, drifted.value));
    }
  }

  /** The P0 UAT gate (SPEC-054): a plan that opted in (`requires_uat`) closes only on a P0-accepted verdict. */
  private async requireUatGate(plan: DocRecord): Promise<void> {
    if (plan.extra["requires_uat"] !== true) return;
    const uat = await this.deps.latestUat(plan);
    if (!uat.ok) throw new PlanCloseStepRefused(uat.error);
    if (!uat.value.present) {
      throw new PlanCloseStepRefused(refusal("plan-uat-gate", `the P0 UAT gate is not met: ${plan.slug} requires a UAT verdict and none is recorded. Record one with \`lore uat record ${plan.slug} --json-file <file>\``));
    }
    if (!uat.value.p0Accepted) {
      const uncovered = uat.value.uncoveredP0.length > 0 ? ` (uncovered P0 requirements: ${uat.value.uncoveredP0.join(", ")})` : "";
      throw new PlanCloseStepRefused(refusal("plan-uat-gate", `the P0 UAT gate is not met: the latest UAT verdict of ${plan.slug} is not P0-accepted${uncovered}. Record a new verdict with \`lore uat record ${plan.slug} --json-file <file>\``));
    }
  }
}
