/**
 * RunService — persists and reads harness runs (spec run-identity-slice-1, D2 / D5; BR-1027, BR-1028, BR-1029).
 *
 * Public surface: {@link RunService.register} (derive id + parent, validate, insert first-wins, reopen an ended
 * run, return the STORED record), {@link RunService.show} (read one run, DOC_NOT_FOUND when unregistered) and
 * {@link RunService.end} (mark a run ended and end its claims, BR-1057), {@link RunService.tasks} (the tasks a
 * registered run ever claimed) and {@link RunService.claimedTasks} (the same read without the registry check).
 *
 * @invariant Side-effect class: stateful (store writes only). Holds a store and a clock, nothing else.
 * @invariant D5: the composition record is computed by the CALLER (the CLI command, from the existing
 *   fragment selection) and only validated + persisted here — RunService never calls the fragments flow.
 * @invariant First registration wins on every column (BR-1029): `register` on a known id returns the
 *   stored record unchanged, whatever hints (`parentRunId`, `branch`) the second call carried. The ONE thing a
 *   repeat registration changes is the end state: registering an ENDED run (a resumed helper) reopens it
 *   (spec-run-only-write-identity-and-run-end-claim-release D4, AC-ROI-6).
 * @invariant `end` of an unregistered run id is `ok({ outcome: "unknown-run" })` and writes nothing —
 *   SubagentStop also fires for internal agents that never registered. `end` always processes the run's
 *   claims, even for an already-ended run, so a retry after a partial failure finishes the job.
 * @invariant A run's parent is the one the caller supplied (`parentRunId`) or null ("unknown"); it is never
 *   guessed, so a helper started by another helper is not recorded as the main run's child (BR-1027, D24).
 */
import { basename } from "node:path";
import {
  deriveRunId,
  err,
  extractHeldClaim,
  extractFileAnchors,
  ok,
  runRecordSchema,
  type CompositionRecord,
  type DocId,
  type LoreError,
  type Result,
  type RunId,
  type RunRecord,
} from "@lore/core";
import type { RunProcessRecord, StoreInterface } from "../store/store-interface.js";
import { claimNamesWorktree, makeDirectoryResolver, type RealpathFn } from "./seat-claim-match.js";
import { resolveClaimWorktree, type WorktreeGitProbe } from "./worktree-cleanup.js";

export type RunStore = Pick<
  StoreInterface,
  | "insertRun"
  | "getRun"
  | "endRun"
  | "reopenRun"
  | "getRunEnd"
  | "recordRunProcess"
  | "listRunsByAgentRef"
  | "findMany"
  | "queryAudit"
  | "findByIds"
>;

/** Claude Code names a subagent worktree `agent-<agentId>` (spec-worktree-removal D1). */
const AGENT_WORKTREE_BASENAME = /^agent-([A-Za-z0-9]+)$/;

/** The owning agent run of a worktree (the most recently registered run of its agent). */
export interface OccupancyAgentRun {
  readonly id: string;
  readonly ended: boolean;
  /** `null` when the run has no parent run or the parent is not registered (not measured). */
  readonly parent_ended: boolean | null;
}

/** One non-terminal task claim recorded for the worktree. `run_ended: null` = no run id, or run not registered. */
export interface OccupancyOpenClaim {
  readonly task_slug: string;
  readonly run_id: string | null;
  readonly run_ended: boolean | null;
}

/** Result of {@link RunService.occupancy}; the `--json` `data` of `lore run occupancy`. */
export interface RunOccupancy {
  readonly worktree: string;
  readonly agent_run: OccupancyAgentRun | null;
  readonly open_claims: readonly OccupancyOpenClaim[];
  /** Some run of the owning agent is live, OR some open claim is not known to be ended (null counts as live). */
  readonly occupied: boolean;
}

export interface OccupancyInput {
  /** Directory of the worktree (need not exist: ENOENT falls back to `path.resolve`). */
  readonly worktree: string;
  /** The worktree's checked-out branch when measured; a claim recording the branch name matches it. */
  readonly branch?: string;
}

/** One claim handled by a run end — structurally `TaskWorkflowService.endRunClaims`'s outcome (services never cross-import). */
export interface RunEndClaimReport {
  readonly task_slug: string;
  readonly action: "released" | "orphaned_dirty";
  /** The measured worktree path, or `not-measured`. */
  readonly worktree: string;
}

/** Narrow port to the claim owner (`TaskWorkflowService.endRunClaims`), injected by `app.ts`. */
export interface RunClaimEnder {
  endRunClaims(runId: RunId, reason: string, now?: () => string): Promise<Result<RunEndClaimReport[], LoreError>>;
}

/** Result of {@link RunService.end}. */
export type RunEndResult =
  | { readonly outcome: "unknown-run" }
  | { readonly outcome: "ended" | "already-ended"; readonly claims: readonly RunEndClaimReport[] };

/** One task a run claimed: its CURRENT status and `file_anchors` (a released or archived task keeps its row). */
export interface RunClaimedTask {
  readonly slug: string;
  readonly status: string;
  readonly file_anchors: readonly string[];
}

/** The `--json` `data` of `lore run tasks`. */
export interface RunTasks {
  readonly run: string;
  readonly tasks: readonly RunClaimedTask[];
}

export interface RegisterRunInput {
  readonly harness: string;
  readonly sessionId: string;
  /** Present => subagent run; absent => main run. */
  readonly agentId?: string;
  /** Required with `agentId`, refused without it. */
  readonly agentType?: string;
  /** The parent run the harness supplied; absent => stored null (unknown). */
  readonly parentRunId?: string;
  readonly branch?: string;
  /** Computed by the caller from the existing fragment selection (D5). */
  readonly composition: CompositionRecord;
  /**
   * The OS process this registration runs in, MEASURED by the caller (pid + start time probed, worktree resolved;
   * AC-AU-5). Absent = nothing measured: the run stays/becomes a legacy run whose death is unprovable. Unlike the
   * identity columns, the newest registration's process wins (a resumed run lives in a new process).
   */
  readonly process?: RunProcessRecord;
}

function validationError(field: string, message: string, value?: unknown): LoreError {
  return { code: "VALIDATION_ERROR", field, message, ...(value !== undefined ? { value } : {}) };
}

/** The open claims naming a working copy, plus the claims whose recorded worktree could not be resolved. */
export interface OpenClaimsOfWorkingCopy {
  readonly tasks: readonly RunClaimedTask[];
  readonly not_measured: readonly string[];
}

export class RunService {
  constructor(
    private readonly store: RunStore,
    private readonly now: () => Date = () => new Date(),
    private readonly claims: RunClaimEnder | undefined,
    /** Required by {@link RunService.occupancy} only (the claim path comparison); wired by `app.ts`. */
    private readonly realpathPort: RealpathFn | undefined,
    /**
     * Absolute repository root (the corpus's project root, `app.ts` `repoRoot`). `git worktree list` is repo-wide, so
     * {@link RunService.openClaimsOfWorkingCopy} runs it HERE and never from the judged working copy, which is often
     * already removed (AU-T24: spawn ENOENT). Blank is refused at construction; there is no fallback.
     */
    private readonly repoRoot: string,
    /** Resolves a branch-name claim to its directory ({@link RunService.openClaimsOfWorkingCopy}); git runs only then. Wired by `app.ts` from the invocation's cwd. */
    private readonly worktreeProbe?: WorktreeGitProbe,
  ) {
    if (repoRoot.trim() === "") throw new RangeError("RunService requires a non-blank repoRoot (AU-T24)");
  }

  /**
   * Register a run, first registration wins.
   *
   * @returns ok(the stored record — the first registration's, on a repeat); VALIDATION_ERROR for an
   *   unknown harness, ids outside `[A-Za-z0-9._-]+`, an agent type without an agent id (or the reverse),
   *   or a malformed record.
   */
  async register(input: RegisterRunInput): Promise<Result<RunRecord, LoreError>> {
    if (input.agentId === undefined && input.agentType !== undefined) {
      /** @lore-site BR-1217 */
      return err(validationError("agent-type", "--agent-type requires --agent-id", input.agentType));
    }
    if (input.agentId !== undefined && (input.agentType === undefined || input.agentType === "")) {
      /** @lore-site BR-1217 */
      return err(validationError("agent-type", "a subagent run requires --agent-type", input.agentType));
    }

    let id: RunId;
    let parentRunId: RunId | null;
    try {
      id = deriveRunId(input.harness, {
        sessionId: input.sessionId,
        ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
      });
      // reason: BR-1027 — a run records the parent it was told, never a guess; none given -> null ("unknown").
      parentRunId = (input.parentRunId ?? null) as RunId | null;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      /** @lore-site BR-1217 */
      return err(validationError("harness", message, input.harness));
    }

    const candidate = {
      id,
      kind: input.agentId !== undefined ? "subagent" : "main",
      harness: input.harness,
      sessionRef: input.sessionId,
      agentRef: input.agentId ?? null,
      agentType: input.agentType ?? null,
      parentRunId,
      branch: input.branch ?? null,
      composition: input.composition,
      registeredAt: this.now().toISOString(),
    };
    const parsed = runRecordSchema.safeParse(candidate);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
      return err(validationError("run", `invalid run record: ${issues}`));
    }

    const inserted = await this.store.insertRun(parsed.data as RunRecord);
    if (!inserted.ok) return inserted;
    // reason: AC-ROI-6 — a resumed helper registers again; an ended run is reopened (no-op for an open one).
    const reopened = await this.store.reopenRun(id);
    if (!reopened.ok) return reopened;
    if (input.process !== undefined) {
      if ((input.process.pid === null) !== (input.process.startTime === null)) {
        return err(validationError("process", "a run process records its pid and start time together or not at all", input.process));
      }
      const recorded = await this.store.recordRunProcess(id, input.process);
      if (!recorded.ok) return recorded;
    }
    const stored = await this.store.getRun(id);
    if (!stored.ok) return stored;
    if (stored.value === null) {
      return err(validationError("run", `run ${id} was inserted but cannot be read back`, id));
    }
    return ok(stored.value);
  }

  /**
   * End a run: stamp `ended_at` / `end_reason` (first end wins), then release its clean claims and mark the
   * ones with uncommitted changes `orphaned_dirty` (BR-1057).
   *
   * @returns ok(`unknown-run`) for an unregistered id (nothing written); ok(`ended`/`already-ended` + the
   *   handled claims); VALIDATION_ERROR for a blank reason or a service built without a claim port.
   */
  async end(runId: string, reason: string): Promise<Result<RunEndResult, LoreError>> {
    if (runId === "") return err(validationError("run-id", "a run id is required", runId));
    /** @lore-site BR-1215 */
    if (reason.trim() === "") return err(validationError("reason", "--reason is required", reason));
    if (this.claims === undefined) {
      return err(validationError("claims", "RunService was built without a claim port; cannot end a run's claims"));
    }
    const ended = await this.store.endRun(runId as RunId, this.now().toISOString(), reason);
    if (!ended.ok) return ended;
    if (ended.value === "unknown-run") return ok({ outcome: "unknown-run" });
    const released = await this.claims.endRunClaims(runId as RunId, reason, () => this.now().toISOString());
    if (!released.ok) return released;
    return ok({ outcome: ended.value, claims: released.value });
  }

  /**
   * Who is working in a worktree, from the run registry and the task claims (read-only; writes nothing).
   * D1: a basename `agent-<agentId>` owns every run with that `agent_ref`; the run reported is the most recently
   * registered, and the worktree is occupied if ANY of them is live (neither it nor its parent run has an end).
   * D2: every non-terminal task whose `claim.worktree` names this worktree (branch or same directory) is listed;
   * a claim whose run has no end, or names no run, counts as occupied.
   *
   * @returns ok(RunOccupancy); VALIDATION_ERROR for a blank path or a service built without a realpath port;
   *   STORE_ERROR from the store or a non-ENOENT realpath failure.
   */
  async occupancy(input: OccupancyInput): Promise<Result<RunOccupancy, LoreError>> {
    /** @lore-site BR-1216 */
    if (input.worktree === "") return err(validationError("worktree", "a worktree path is required", input.worktree));
    if (this.realpathPort === undefined) {
      return err(validationError("realpath", "RunService was built without a realpath port; cannot compare worktrees"));
    }
    const tasks = await this.store.findMany({ type: "task" });
    if (!tasks.ok) return tasks;
    let resolvedDirectory: string;
    const claimsOfWorktree: { slug: string; runId: string | null }[] = [];
    try {
      const resolveDirectory = makeDirectoryResolver(this.realpathPort);
      resolvedDirectory = resolveDirectory(input.worktree);
      for (const task of tasks.value) {
        const claim = extractHeldClaim(task);
        if (claim === undefined) continue;
        if (!claimNamesWorktree(claim.worktree, { branch: input.branch, resolvedDirectory }, resolveDirectory)) continue;
        claimsOfWorktree.push({
          slug: task.slug,
          runId: typeof claim.harness_run === "string" && claim.harness_run !== "" ? claim.harness_run : null,
        });
      }
    } catch (cause) {
      return err({
        code: "STORE_ERROR",
        message: `occupancy: could not resolve a worktree path: ${cause instanceof Error ? cause.message : String(cause)}`,
        ...(cause instanceof Error ? { cause } : {}),
      });
    }
    claimsOfWorktree.sort((a, b) => a.slug.localeCompare(b.slug));

    const openClaims: OccupancyOpenClaim[] = [];
    for (const claim of claimsOfWorktree) {
      if (claim.runId === null) {
        openClaims.push({ task_slug: claim.slug, run_id: null, run_ended: null });
        continue;
      }
      const end = await this.store.getRunEnd(claim.runId as RunId);
      if (!end.ok) return end;
      openClaims.push({
        task_slug: claim.slug,
        run_id: claim.runId,
        run_ended: end.value === null ? null : end.value.endedAt !== null,
      });
    }

    const agentMatch = AGENT_WORKTREE_BASENAME.exec(basename(resolvedDirectory));
    let agentRun: OccupancyAgentRun | null = null;
    let agentLive = false;
    if (agentMatch !== null) {
      const runs = await this.store.listRunsByAgentRef(agentMatch[1] as string);
      if (!runs.ok) return runs;
      for (const [index, run] of runs.value.entries()) {
        const end = await this.store.getRunEnd(run.id);
        if (!end.ok) return end;
        const ended = end.value !== null && end.value.endedAt !== null;
        let parentEnded: boolean | null = null;
        if (run.parentRunId !== null) {
          const parentEnd = await this.store.getRunEnd(run.parentRunId);
          if (!parentEnd.ok) return parentEnd;
          parentEnded = parentEnd.value === null ? null : parentEnd.value.endedAt !== null;
        }
        if (!ended && parentEnded !== true) agentLive = true;
        if (index === 0) agentRun = { id: run.id, ended, parent_ended: parentEnded };
      }
    }

    return ok({
      worktree: resolvedDirectory,
      agent_run: agentRun,
      open_claims: openClaims,
      occupied: agentLive || openClaims.some((claim) => claim.run_ended !== true),
    });
  }

  /**
   * The tasks `runId` ever claimed, oldest claim first: every audit row with action `claim` whose
   * `details.harness_run` is the run (those rows survive release and archival, unlike `extra.claim`), then each
   * task's CURRENT `file_anchors` (spec session-trail, Run -> tasks, D9). No registry check: a run id that never
   * registered simply claimed nothing. Use {@link RunService.tasks} when an unknown id must be refused.
   *
   * @returns ok(tasks, possibly empty); STORE_ERROR from the store.
   */
  async claimedTasks(runId: string): Promise<Result<RunClaimedTask[], LoreError>> {
    const rows = await this.store.queryAudit({ action: "claim" });
    if (!rows.ok) return rows;
    // reason: queryAudit orders newest first; reversing gives claim order, and the Set keeps a re-claimed task once.
    const claimedIds = new Set<DocId>();
    for (const row of [...rows.value].reverse()) {
      if (row.doc_id !== undefined && row.details?.["harness_run"] === runId) claimedIds.add(row.doc_id);
    }
    if (claimedIds.size === 0) return ok([]);
    const docs = await this.store.findByIds([...claimedIds]);
    if (!docs.ok) return docs;
    const tasks: RunClaimedTask[] = [];
    for (const id of claimedIds) {
      const doc = docs.value.get(id);
      if (doc !== undefined) tasks.push({ slug: doc.slug, status: doc.status, file_anchors: extractFileAnchors(doc) });
    }
    return ok(tasks);
  }

  /**
   * Every OPEN claim (a non-archived, non-deprecated task still carrying `extra.claim`) whose recorded worktree is
   * the directory `workingCopy`, as the claimed task with its CURRENT `file_anchors`. The recorded value is a path
   * OR a branch name (lore's dispatch protocol records the branch): a path naming the copy matches directly, any
   * other value is resolved through {@link resolveClaimWorktree} (the one branch-to-directory resolver) and its
   * directory compared by realpath. An unresolved value never matches; a resolution that could not be measured
   * (`git worktree list` failed) is returned in `not_measured`, never dropped (AU-T23). Unlike
   * {@link RunService.claimedTasks} it needs no run id, so it sees a claim whose run has no end record yet.
   *
   * `git worktree list` runs from the repository root given at construction, never from `workingCopy` (AU-T24).
   *
   * @param workingCopy - absolute directory of the working copy (need not exist: ENOENT falls back to `path.resolve`).
   * @returns ok({tasks sorted by slug, not_measured}); VALIDATION_ERROR for a blank path or a service built without
   *   a realpath port; STORE_ERROR from the store or a non-ENOENT realpath failure.
   */
  async openClaimsOfWorkingCopy(workingCopy: string): Promise<Result<OpenClaimsOfWorkingCopy, LoreError>> {
    if (workingCopy === "") return err(validationError("working-copy", "a working copy path is required", workingCopy));
    if (this.realpathPort === undefined) {
      return err(validationError("realpath", "RunService was built without a realpath port; cannot compare worktrees"));
    }
    const tasks = await this.store.findMany({ type: "task" });
    if (!tasks.ok) return tasks;
    const open: RunClaimedTask[] = [];
    const notMeasured: string[] = [];
    try {
      const resolveDirectory = makeDirectoryResolver(this.realpathPort);
      const resolvedDirectory = resolveDirectory(workingCopy);
      for (const task of tasks.value) {
        const claim = extractHeldClaim(task);
        if (claim === undefined) continue;
        let matches = claimNamesWorktree(claim.worktree, { branch: undefined, resolvedDirectory }, resolveDirectory);
        if (!matches && claim.worktree !== undefined) {
          if (this.worktreeProbe === undefined) {
            notMeasured.push(`open claim of ${task.slug}: worktree ${claim.worktree} not resolved (no worktree probe wired)`);
            continue;
          }
          const resolution = resolveClaimWorktree(this.worktreeProbe, claim.worktree, this.repoRoot);
          if (resolution.kind === "resolved") matches = resolveDirectory(resolution.path) === resolvedDirectory;
          else if (resolution.kind === "not-measured") {
            notMeasured.push(`open claim of ${task.slug}: worktree ${claim.worktree} not resolved (${resolution.reason})`);
          }
        }
        if (matches) open.push({ slug: task.slug, status: task.status, file_anchors: extractFileAnchors(task) });
      }
    } catch (cause) {
      return err({
        code: "STORE_ERROR",
        message: `openClaimsOfWorkingCopy: could not resolve a worktree path: ${cause instanceof Error ? cause.message : String(cause)}`,
        ...(cause instanceof Error ? { cause } : {}),
      });
    }
    return ok({ tasks: open.sort((a, b) => a.slug.localeCompare(b.slug)), not_measured: notMeasured });
  }

  /**
   * {@link RunService.claimedTasks} for a REGISTERED run.
   *
   * @returns ok({run, tasks}); VALIDATION_ERROR naming the id when the run is not registered (exit 4, like
   *   BR-1038's refusal of an unknown id); STORE_ERROR from the store.
   */
  async tasks(runId: string): Promise<Result<RunTasks, LoreError>> {
    if (runId === "") return err(validationError("run-id", "a run id is required", runId));
    const known = await this.store.getRun(runId as RunId);
    if (!known.ok) return known;
    /** @lore-site BR-1150 */
    if (known.value === null) return err(validationError("run-id", `run ${runId} is not registered`, runId));
    const claimed = await this.claimedTasks(runId);
    if (!claimed.ok) return claimed;
    return ok({ run: runId, tasks: claimed.value });
  }

  /** The registered run, or DOC_NOT_FOUND naming the id. */
  async show(id: string): Promise<Result<RunRecord, LoreError>> {
    const found = await this.store.getRun(id as RunId);
    if (!found.ok) return found;
    if (found.value === null) return err({ code: "DOC_NOT_FOUND", id, rule: "BR-1038" });
    return ok(found.value);
  }
}
