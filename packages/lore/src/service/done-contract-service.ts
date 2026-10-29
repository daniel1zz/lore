/**
 * Module: done-contract-service — gathers the inputs of a task's done contract and compiles it at approve.
 *
 * Purpose: the approve hook (`ApproveContractPort`, called by `ReviewService.approve` for a task, after the transition and
 *   override checks and before the write) and the ONLY producer of the value stored at `extra.done_contract`. The migration
 *   (AC-DCS1-23) is the one other compile path; no other writer compiles a contract.
 * Public surface: {@link DoneContractService}, {@link DoneContractGitPort}, {@link ApproveContractPort}, {@link ApproveContractOpts}.
 * Invariants:
 *   - reads only: the service writes nothing; `ReviewService.approve` stores the returned contract in the same write that moves
 *     the task to approved, so a refusal writes nothing (I3).
 *   - the compile itself is the pure `compileDoneContract`; this class only gathers (plan, specs, config, the tip of the base
 *     branch, the falsifier files at that commit) through the store and the git port.
 *   - a task that already holds a contract is refused (`done-contract-already-stored`), never recompiled.
 * Side-effect class: store reads + git reads through the port.
 *
 * Source: spec-done-contract-compiled-at-approve-task-kinds-write-sets (AC-DCS1-1, AC-DCS1-2, AC-DCS1-5).
 */

import {
  err,
  formatTaskKindRequiredMessage,
  isTaskKind,
  ok,
  resolveRecordedGoverningSpec,
  specAcceptanceCriteriaSchema,
  type AcceptanceCriterion,
  type DocRecord,
  type DoneContract,
  type LoreError,
  type Result,
} from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import {
  compileDoneContract,
  contractAlreadyStored,
  liveScriptCriteriaOf,
  redWaiverNotCode,
  type DoneContractBase,
  type DoneContractConfigCommands,
} from "./done-contract-compile.js";

/** The branch every contract falls back to when the plan declares no integration branch, and the one check and corpus tasks use. */
const MAIN_BRANCH = "main";

/** The git reads a compile needs; the real one shells `git` in the repository root. */
export interface DoneContractGitPort {
  /** Tip commit of the local branch, or `undefined` when the branch does not exist. */
  branchTip(branch: string): string | undefined;
  /** Content of `path` at `commit`, or `undefined` when the file is absent there. */
  fileAt(commit: string, path: string): string | undefined;
}

/** What `ReviewService.approve` passes the hook. */
export interface ApproveContractOpts {
  /** The reason of `--red-waiver`, trimmed and non-blank; `undefined` when not waived. */
  readonly redWaiverReason?: string;
}

/** The port `ReviewService` calls for a task approval. */
export interface ApproveContractPort {
  compileForApprove(task: DocRecord, opts: ApproveContractOpts): Promise<Result<DoneContract, LoreError>>;
}

export class DoneContractService implements ApproveContractPort {
  /**
   * @param store - the corpus store (plans, specs, links are read from it)
   * @param config - the `workflow.done_contract` commands of the project config (any may be absent: a code task then refuses)
   * @param git - the git reads of the repository the corpus lives in
   */
  constructor(
    private readonly store: StoreInterface,
    private readonly config: DoneContractConfigCommands,
    private readonly git: DoneContractGitPort,
  ) {}

  /**
   * Compiles the contract of `task` for its approval.
   *
   * @param task - the draft task being approved
   * @param opts - the red waiver, if any
   * @returns the contract to store, or a refusal (`done-contract-uncompilable` naming every cause, `red-waiver-not-code`, a missing kind)
   */
  async compileForApprove(task: DocRecord, opts: ApproveContractOpts): Promise<Result<DoneContract, LoreError>> {
    const contractExists = task.extra["done_contract"] !== undefined;
    if (contractExists) return err(contractAlreadyStored(task));

    const kind = task.extra["kind"];
    if (!isTaskKind(kind)) {
      return err({
        code: "VALIDATION_ERROR",
        field: "kind",
        message: `${formatTaskKindRequiredMessage(kind, "kind")} Set it with \`lore set ${task.slug} --kind <kind>\` and approve again.`,
        value: kind,
      });
    }
    if (opts.redWaiverReason !== undefined && kind !== "code") return err(redWaiverNotCode(task.slug, `a ${kind} task`));

    const plan = await this.resolvePlan(task);
    if (!plan.ok) return plan;
    const criteria = await this.resolveCriteria(task, plan.value);
    if (!criteria.ok) return criteria;

    const integrationBranch = plan.value === null ? undefined : plan.value.extra["integration_branch"];
    const declared = kind === "code" && typeof integrationBranch === "string" && integrationBranch !== "";
    const branch = declared ? (integrationBranch as string) : MAIN_BRANCH;
    const tip = this.git.branchTip(branch);
    // reason: with the base branch absent the compile still checks the falsifier literals (it must name every cause at once),
    // reading them at main, the one branch every repository has.
    const readCommit = tip ?? this.git.branchTip(MAIN_BRANCH);
    const base: DoneContractBase = { branch, declaredByPlan: declared, tip, readCommit };

    const falsifierFiles = new Map<string, string | undefined>();
    for (const criterion of liveScriptCriteriaOf(task, criteria.value)) {
      if (criterion.verify.mode !== "script" || criterion.verify.falsifier === undefined) continue;
      const { path } = criterion.verify.falsifier;
      falsifierFiles.set(path, readCommit === undefined ? undefined : this.git.fileAt(readCommit, path));
    }

    return compileDoneContract({
      task,
      kind,
      redWaiverReason: opts.redWaiverReason,
      criteria: criteria.value,
      config: this.config,
      base,
      falsifierFiles,
    });
  }

  /** The plan the task belongs to (`extra.plan_id`, else the parent when it is a plan); `null` for an ad-hoc task. */
  private async resolvePlan(task: DocRecord): Promise<Result<DocRecord | null, LoreError>> {
    const declared = task.extra["plan_id"];
    const planId = typeof declared === "string" && declared !== "" ? declared : task.parent_id;
    if (planId === null || planId === undefined) return ok(null);
    const found = await this.store.find(planId as DocRecord["id"]);
    if (!found.ok) return found;
    return ok(found.value !== null && found.value.type === "plan" ? found.value : null);
  }

  /**
   * Every criterion of every spec the plan is parented to or implements (the plan's parent first, then the specs it
   * `implements`, in link order); a criterion id declared twice keeps its first declaration. An ad-hoc task has no plan:
   * its recorded governing spec stands in (an unresolvable one leaves the criteria empty, so every scope id is unresolved).
   */
  private async resolveCriteria(task: DocRecord, plan: DocRecord | null): Promise<Result<AcceptanceCriterion[], LoreError>> {
    const specs: DocRecord[] = [];
    if (plan === null) {
      const all = await this.store.findMany({ type: "spec" });
      if (!all.ok) return all;
      const recorded = resolveRecordedGoverningSpec(task, all.value, `task "${task.slug}"`);
      if (recorded.ok) specs.push(recorded.value.spec);
    } else {
      if (plan.parent_id !== null) {
        const parent = await this.store.find(plan.parent_id);
        if (!parent.ok) return parent;
        if (parent.value !== null && parent.value.type === "spec") specs.push(parent.value);
      }
      const links = await this.store.findLinks(plan.id, "out");
      if (!links.ok) return links;
      for (const link of links.value) {
        if (link.link_type !== "implements") continue;
        const target = await this.store.find(link.to_id);
        if (!target.ok) return target;
        if (target.value !== null && target.value.type === "spec" && !specs.some((spec) => spec.id === target.value?.id)) specs.push(target.value);
      }
    }
    const criteria: AcceptanceCriterion[] = [];
    for (const spec of specs) {
      const parsed = specAcceptanceCriteriaSchema.safeParse(spec.extra["acceptance_criteria"]);
      if (!parsed.success) continue;
      for (const criterion of parsed.data) if (!criteria.some((known) => known.id === criterion.id)) criteria.push(criterion);
    }
    return ok(criteria);
  }
}
