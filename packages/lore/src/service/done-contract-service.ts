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
  anchorsOverlap,
  err,
  extractCreatesAnchors,
  formatTaskKindRequiredMessage,
  isTaskKind,
  isTestFileAnchor,
  ok,
  readClaimRecord,
  resolveRecordedGoverningSpec,
  specAcceptanceCriteriaSchema,
  withExecutionLogEntries,
  type AcceptanceCriterion,
  type DocRecord,
  type DoneContract,
  type DoneContractOracle,
  type ExecutionLogEntry,
  type LoreError,
  type Result,
  type TaskKind,
} from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { type DocWritePort } from "./corpus-service.js";
import { resolvePlanGoverningSpecs } from "./plan-governing-specs.js";
import { definitionOfDone } from "./task-workflow-service.js";
import {
  compileDoneContract,
  contractAlreadyStored,
  liveScriptCriteriaOf,
  redWaiverNotCode,
  uncompilableCausesOf,
  type DoneContractBase,
  type DoneContractCompileInput,
  type DoneContractConfigCommands,
  type UncompilableCause,
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
  /**
   * Compile at this commit instead of the tip of the base branch (BR-1549): the migration of a task that already landed compiles it
   * at its landing commit, so the anchored files and falsifier literals are read where the work landed. Absent for an approval.
   */
  readonly compileAt?: string;
}

/** The port `ReviewService` calls for a task approval. */
export interface ApproveContractPort {
  compileForApprove(task: DocRecord, opts: ApproveContractOpts): Promise<Result<DoneContract, LoreError>>;
}

/**
 * The union of the oracles a contract already added and the `additions` just derived: each id once, the existing ones first.
 * Never removes an entry (AC-DCS1-11: the oracle set only grows).
 *
 * @example
 * mergeAddedOracles([{ id: "test:a.test.ts" }], [{ id: "test:a.test.ts" }, { id: "test:b.test.ts" }]).map((o) => o.id)
 * // => ["test:a.test.ts", "test:b.test.ts"]
 */
export function mergeAddedOracles(existing: readonly DoneContractOracle[], additions: readonly DoneContractOracle[]): DoneContractOracle[] {
  const merged: DoneContractOracle[] = [...existing];
  for (const oracle of additions) if (!merged.some((known) => known.id === oracle.id)) merged.push(oracle);
  return merged;
}

/** `contract` with `additions` merged into its added oracles; every other field is untouched. */
export function withAddedOracles(contract: DoneContract, additions: readonly DoneContractOracle[]): DoneContract {
  return {
    ...contract,
    added_oracles: mergeAddedOracles(contract.added_oracles, additions),
  };
}

/** What the recompile of `lore start` found: the contract it compiled, or the causes that stop it. */
export interface DriftRecompile {
  /** Every falsifier path of the task's live script criteria (the files the drift diff covers besides the anchors). */
  readonly falsifierPaths: readonly string[];
  /** Empty when the contract compiled. */
  readonly causes: readonly UncompilableCause[];
  readonly contract: DoneContract | undefined;
}

/**
 * The stored contract with the recompiled one applied: the old oracles are all kept (an id the recompile no longer lists stays; an id
 * both list takes the recompiled command), the new oracles are appended, `added_oracles` and the kind stay as stored.
 * The oracle set never shrinks (D28, D30).
 *
 * @param stored - the contract the task holds
 * @param fresh - the recompiled contract
 */
export function mergeRecompiledContract(stored: DoneContract, fresh: DoneContract): DoneContract {
  const oracles: DoneContractOracle[] = stored.oracles.map((old) => fresh.oracles.find((candidate) => candidate.id === old.id) ?? old);
  for (const added of fresh.oracles) if (!oracles.some((known) => known.id === added.id)) oracles.push(added);
  return { ...fresh, kind: stored.kind, oracles, added_oracles: stored.added_oracles };
}

/** One field or oracle that differs between two contracts. */
export interface ContractChange {
  readonly field: string;
  readonly old: unknown;
  readonly new: unknown;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * What differs between the stored contract and the merged recompile, with old and new values; `compiled_at_commit` alone is not a
 * change (a base that moved without touching the contract changes nothing). Empty when the two are the same.
 *
 * @param stored - the stored contract
 * @param next - the merged recompiled contract
 */
export function describeContractChanges(stored: DoneContract, next: DoneContract): ContractChange[] {
  const changes: ContractChange[] = [];
  const a = stored as unknown as Record<string, unknown>;
  const b = next as unknown as Record<string, unknown>;
  for (const field of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (field === "compiled_at_commit" || field === "oracles") continue;
    if (canonical(a[field]) !== canonical(b[field])) changes.push({ field, old: a[field], new: b[field] });
  }
  for (const oracle of next.oracles) {
    const old = stored.oracles.find((candidate) => candidate.id === oracle.id);
    if (old === undefined) changes.push({ field: `oracles.${oracle.id}`, old: null, new: oracle });
    else if (canonical(old) !== canonical(oracle)) changes.push({ field: `oracles.${oracle.id}`, old, new: oracle });
  }
  return changes;
}

/**
 * The `drift` entry for a stored change: `old` and `new` are typed maps of the changed contract fields, `detail` the human line.
 *
 * @param at - the write time
 * @param stored - the contract before
 * @param next - the contract after
 * @param changes - {@link describeContractChanges} of the two (non-empty)
 */
export function driftLogEntry(at: string, stored: DoneContract, next: DoneContract, changes: readonly ContractChange[]): ExecutionLogEntry {
  return {
    kind: "drift",
    at,
    detail: `contract recompiled at start, ${stored.compiled_at_commit.slice(0, 12)} to ${next.compiled_at_commit.slice(0, 12)}: ${changes.map((change) => change.field).join(", ")}`,
    old: Object.fromEntries(changes.map((change) => [change.field, change.old])),
    new: Object.fromEntries(changes.map((change) => [change.field, change.new])),
  };
}

/** What {@link deriveWriteSetAdditions} reads. */
export interface WriteSetAdditionsInput {
  /** The claim's write set: the declared entries (file, `dir/`, `path#Symbol`), else the task's approved anchors. */
  readonly writeSet: readonly string[];
  /** The repo-relative files the claim's branch changed since its start commit (added, copied, modified, renamed). */
  readonly changedFiles: readonly string[];
  /** The contract the oracles are added to. */
  readonly contract: DoneContract;
  /** `workflow.done_contract.test_file`, a command template containing `{file}`. */
  readonly testFileTemplate: string;
}

/**
 * The oracles a claim's write set adds to the contract: each test file that lies in the write set (a file entry, or a file under
 * a directory entry), that the branch changed, and that the contract does not already run becomes `test:<path>` running the
 * file unfiltered through the same template the contract's own test oracles use. A test file declared but not changed adds
 * nothing; a changed file outside the write set adds nothing. Pure.
 *
 * @example
 * deriveWriteSetAdditions({ writeSet: ["tests/"], changedFiles: ["tests/a.test.ts", "src/a.ts"], contract, testFileTemplate: "run {file}" })
 * // => [{ id: "test:tests/a.test.ts", command: "run tests/a.test.ts" }]  (when the contract does not run it already)
 */
export function deriveWriteSetAdditions(input: WriteSetAdditionsInput): DoneContractOracle[] {
  const known = new Set([...input.contract.oracles, ...input.contract.added_oracles].map((oracle) => oracle.id));
  const additions: DoneContractOracle[] = [];
  for (const file of input.changedFiles) {
    if (!isTestFileAnchor(file)) continue;
    const id = `test:${file}`;
    if (known.has(id) || additions.some((added) => added.id === id)) continue;
    if (!anchorsOverlap([file], [...input.writeSet]).overlaps) continue;
    additions.push({ id, command: input.testFileTemplate.split("{file}").join(file) });
  }
  return additions;
}

/**
 * The `anchor-absent` causes of a task's test-file anchors (BR-1547, BR-1487 as amended): each anchored test file that does not
 * exist at the compile commit and that the task did not declare with `--creates`. Pure; the caller reads the files.
 *
 * @param testFiles - the task's anchored test files (the ones that become test oracles)
 * @param creates - the files declared with `--creates` (`extra.creates_anchors`)
 * @param existsAtBase - whether a path exists at the compile commit
 * @example
 * // a test file absent at the base tip and not declared with --creates yields one cause, code "anchor-absent"
 */
export function anchorAbsentCauses(testFiles: readonly string[], creates: readonly string[], existsAtBase: (path: string) => boolean): UncompilableCause[] {
  const causes: UncompilableCause[] = [];
  for (const file of testFiles) {
    if (creates.includes(file) || existsAtBase(file)) continue;
    causes.push({
      code: "anchor-absent",
      message: `the test file ${file} is anchored but absent at the base tip and not declared as created; remove the anchor (\`lore anchor rm\`), or declare it with \`lore anchor add <task> ${file} --creates\` when this task creates it.`,
    });
  }
  return causes;
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
    private readonly writer?: DocWritePort,
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

    const gathered = await this.gather(task, kind, opts.redWaiverReason, true, opts.compileAt);
    if (!gathered.ok) return gathered;
    return compileDoneContract(gathered.value.input);
  }

  /**
   * Recompiles the contract of a task that already holds one, for the drift check of `lore start` (AC-DCS2-16): the SAME gather and
   * the SAME pure compile as approve, with the stored kind and red waiver. Reads only; stores nothing.
   *
   * @param task - the approved task
   * @param stored - the contract it holds
   * @returns the recompiled contract (and the falsifier paths) or the causes that stop it; an error only when the inputs cannot be read
   */
  async recompileForStart(task: DocRecord, stored: DoneContract): Promise<Result<DriftRecompile, LoreError>> {
    const gathered = await this.gather(task, stored.kind, stored.red_required ? undefined : stored.red_waiver_reason, false);
    if (!gathered.ok) return gathered;
    const compiled = compileDoneContract(gathered.value.input);
    const falsifierPaths = [...gathered.value.input.falsifierFiles.keys()];
    if (compiled.ok) return ok({ falsifierPaths, causes: [], contract: compiled.value });
    const causes = uncompilableCausesOf(compiled.error);
    // reason: any other compile error is not a cause to list; it is a fault and surfaces as itself.
    if (causes === undefined) return compiled;
    return ok({ falsifierPaths, causes, contract: undefined });
  }

  /**
   * Applies a successful recompile to the stored contract (AC-DCS2-16): merges it (every old oracle kept, `added_oracles` preserved)
   * and, only when the result differs from the stored contract, stores it together with a `drift` log entry holding the old and new
   * values in ONE write. A recompile that changes nothing writes nothing.
   *
   * @param task - the task as read before the recompile (its version guards the write)
   * @param stored - the contract the task holds
   * @param fresh - the recompiled contract
   * @param nowIso - the write time
   * @returns whether anything was stored, or the write error (a lost version race is reported, never retried over a changed contract)
   */
  async applyRecompile(task: DocRecord, stored: DoneContract, fresh: DoneContract, nowIso: string): Promise<Result<{ readonly stored: boolean }, LoreError>> {
    const next = mergeRecompiledContract(stored, fresh);
    const changes = describeContractChanges(stored, next);
    if (changes.length === 0) return ok({ stored: false });
    const written = await this.storeDrift(task, next, driftLogEntry(nowIso, stored, next, changes), nowIso);
    return written.ok ? ok({ stored: true }) : written;
  }

  private async storeDrift(task: DocRecord, next: DoneContract, entry: ExecutionLogEntry, nowIso: string): Promise<Result<DocRecord, LoreError>> {
    if (this.writer === undefined) return err({ code: "VALIDATION_ERROR", field: "writer", message: "DoneContractService has no write route: a drifted contract cannot be stored", value: null });
    let extra: Record<string, unknown>;
    try {
      extra = { ...withExecutionLogEntries(task.extra, [entry]), done_contract: next };
    } catch (cause) {
      return err({ code: "VALIDATION_ERROR", field: "execution_log", message: `The execution log of "${task.slug}" does not parse: ${cause instanceof Error ? cause.message : String(cause)}`, value: task.extra["execution_log"] });
    }
    const written = await this.writer.writeDoc({
      doc: task,
      patch: { extra },
      action: "update",
      changeSummary: "done contract recompiled at start (drift)",
      auditAction: "update",
      auditDetails: { operation: "start-drift", execution_log: "drift" },
      auditSessionId: `start-drift-${task.id}`,
      lock: "none",
      now: nowIso,
      foreignIntent: readClaimRecord(task)?.worktree !== undefined,
    });
    return written.ok ? ok(written.value.doc) : written;
  }

  /** Every input of the compile, read once (the plan, the criteria, the base tip, the falsifier files). */
  private async gather(task: DocRecord, kind: TaskKind, redWaiverReason: string | undefined, checkAnchors: boolean, compileAt?: string): Promise<Result<{ input: DoneContractCompileInput }, LoreError>> {
    const plan = await this.resolvePlan(task);
    if (!plan.ok) return plan;
    const criteria = await this.resolveCriteria(task, plan.value);
    if (!criteria.ok) return criteria;

    const integrationBranch = plan.value === null ? undefined : plan.value.extra["integration_branch"];
    const declared = kind === "code" && typeof integrationBranch === "string" && integrationBranch !== "";
    const branch = declared ? (integrationBranch as string) : MAIN_BRANCH;
    const tip = compileAt ?? this.git.branchTip(branch);
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

    // reason: only a compile that STORES a contract refuses an absent anchor; the recompile of `lore start` judges a contract that
    // is already stored and must not turn a created-since test file into a cause (BR-1547).
    const anchorCauses = !checkAnchors || kind !== "code"
      ? []
      : anchorAbsentCauses(definitionOfDone(task, criteria.value).unfiltered_pass_files, extractCreatesAnchors(task), (path) =>
          readCommit !== undefined && this.git.fileAt(readCommit, path) !== undefined);

    return ok({ input: { task, kind, redWaiverReason, criteria: criteria.value, config: this.config, base, falsifierFiles, anchorCauses } });
  }

  /**
   * Whether `task`'s ac_scope holds a live script-mode criterion: the one fact the migration infers a kind from (AC-DCS1-22).
   * Reads the same criteria the compile reads.
   *
   * @param task - the task whose scope is read
   */
  async hasLiveScriptAc(task: DocRecord): Promise<Result<boolean, LoreError>> {
    const plan = await this.resolvePlan(task);
    if (!plan.ok) return plan;
    const criteria = await this.resolveCriteria(task, plan.value);
    if (!criteria.ok) return criteria;
    return ok(liveScriptCriteriaOf(task, criteria.value).length > 0);
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
      const governing = await resolvePlanGoverningSpecs(this.store, plan);
      if (!governing.ok) return governing;
      specs.push(...governing.value);
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
