/**
 * WorktreeRemovalService — measures the facts behind THE worktree-removal test and applies it
 * (spec-one-worktree-removal-test-for-the-guard-lore-done-and-a D1-D5; BR-1070, BR-1079).
 *
 * Public surface: {@link WorktreeRemovalService.check} (`lore worktree check`, the git-safety hook),
 * {@link WorktreeRemovalService.sweep} (`lore worktree sweep [--apply]`), {@link WorktreeRemovalService.gatherRemovalFacts}
 * (the {@link WorktreeRemovalFactsPort} `lore done`'s cleanup consumes).
 *
 * @invariant Side-effect class: IO via injected ports only (git probe, process scan, run occupancy, run store reads);
 *   writes nothing to the store. `sweep --apply` runs plain `git worktree remove` + `git branch -d` through the probe —
 *   never `--force`, never `-D` — so git itself refuses a dirty/locked worktree or an unmerged branch even if a fact lied.
 * @invariant The DECISION is `decideWorktreeRemoval` (worktree-removal-test.ts), the only place a clause lives. This
 *   module measures and applies; it never re-states a clause. No clock is read anywhere here (D5).
 * @invariant Services never cross-import: run occupancy arrives as the {@link RunOccupancyPort} (structurally
 *   `RunService.occupancy`), run/session liveness as a narrow store pick.
 * @invariant No method throws; every measurement failure is a `Measured` miss (-> `not-measured`, never `removable`).
 * @invariant AC-AU-11: AFTER the removal test says removable, every removal this module performs or gates
 *   ({@link WorktreeRemovalService.gateRemoval}, `sweep --apply`, {@link WorktreeRemovalService.removeScratchWorktree})
 *   calls decide(`worktree-remove`) through the {@link RemovalDecisionPort}. R is `loss-free-by-proof` only when
 *   `git status --ignored --porcelain` lists no ignored path outside the regenerable set, else `irreversible-local`
 *   (-> escalate, paths named). The factors are measured here; C is the class prior from the registry (AU-T8 replaces
 *   it); no caller supplies a factor.
 * @invariant A `lore-attested-red-*` falsifier scratch worktree is dirty by construction, so for IT the removal test's
 *   dirty / unmerged / run / claim / owner clauses are replaced by ownership proof: the creating pid (owner marker) is
 *   dead, or there is no marker (made before the marker existed). Locked, caller-inside, process-inside still hold.
 */
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { deriveRunId, err, ok, OPERATION_CLASS_REGISTRY, type LoreError, type Result, type RunId } from "@lore/core";
import type { ProcessScanPort } from "../adapters/real-process-scan-port.js";
import type { StoreInterface } from "../store/store-interface.js";
import {
  decideWorktreeRemoval,
  type Measured,
  type OpenClaimFact,
  type OwnerFact,
  type ProcessInsideFact,
  type WorktreeRemovalFacts,
  type WorktreeRemovalFactsPort,
  type WorktreeRemovalVerdict,
} from "./worktree-removal-test.js";
import {
  ignoredPathsOutsideRegenerableSet,
  isFalsifierScratchPath,
  type ListedWorktree,
  type ScratchRemovalPort,
  type WorktreeGitProbe,
  type WorktreeRemovalGate,
  type WorktreeRemovalGatePort,
} from "./worktree-cleanup.js";

/** Structurally `RunOccupancy` (run-service.ts) — the `lore run occupancy --json` data. */
export interface OccupancyData {
  readonly worktree: string;
  readonly agent_run: { readonly id: string; readonly ended: boolean; readonly parent_ended: boolean | null } | null;
  readonly open_claims: readonly {
    readonly task_slug: string;
    readonly run_id: string | null;
    readonly run_ended: boolean | null;
  }[];
  readonly occupied: boolean;
}

/** Structurally `RunService.occupancy`. */
export interface RunOccupancyPort {
  occupancy(input: { worktree: string; branch?: string }): Promise<Result<OccupancyData, LoreError>>;
}

/** Run + run-end reads the owner-session lookup needs. */
export type WorktreeRemovalRunStore = Pick<StoreInterface, "getRun" | "getRunEnd">;

/** Structurally `DecisionService.decide` — the only autonomy surface this module consumes (no cross-service import). */
export interface RemovalDecisionPort {
  decide(
    classId: string,
    subject: { readonly id: string; readonly version: string },
    facts: unknown,
  ): Promise<
    Result<
      {
        readonly decision: { readonly verdict: string; readonly reasons: readonly string[] };
        readonly record_id: number;
        readonly effective: { readonly verdict: string };
      },
      LoreError
    >
  >;
}

export interface WorktreeRemovalDeps {
  readonly decisions: RemovalDecisionPort;
  readonly probe: WorktreeGitProbe;
  readonly processScan: ProcessScanPort;
  readonly occupancy: RunOccupancyPort;
  readonly runs: WorktreeRemovalRunStore;
}

/** The `data` of `lore worktree check --json`. */
export interface WorktreeCheck {
  readonly path: string;
  readonly verdict: WorktreeRemovalVerdict;
  readonly reasons: readonly string[];
  readonly owner: { readonly run_id: string; readonly session: string; readonly mine: boolean; readonly session_ended: boolean | null } | null;
  readonly occupancy: OccupancyData | null;
  readonly processes: readonly ProcessInsideFact[];
}

/** One `lore worktree sweep --json` row: the check plus what `--apply` did. */
export interface WorktreeSweepEntry extends WorktreeCheck {
  readonly removed?: boolean;
  /** `--apply` kept a removable worktree because decide(worktree-remove) did not say auto (AC-AU-11). */
  readonly escalated?: { readonly ignored_paths: readonly string[]; readonly record_id?: number };
  readonly hint?: string;
  /** `--apply` removal failure detail (the worktree was kept). */
  readonly error?: string;
}

/** Everything measured about one worktree: the decision's facts plus what check/sweep report and removal needs. */
interface Inspection {
  readonly facts: WorktreeRemovalFacts;
  readonly path: string;
  readonly repoRoot: string | undefined;
  readonly branch: string | undefined;
  readonly owner: OwnerFact | null;
  readonly occupancy: OccupancyData | null;
  readonly processes: readonly ProcessInsideFact[];
  /** A falsifier scratch worktree (facts already carry the scratch ownership proof). */
  readonly scratch: boolean;
}

const WORKTREE_REMOVE_CLASS = "worktree-remove";

/** C until AU-T8 measures it: the class prior from the registry; absent -> omitted -> decide() scores C as 0 (fail closed). */
const WORKTREE_REMOVE_PRIOR_CONFIDENCE: number | undefined = (() => {
  const operationClass = OPERATION_CLASS_REGISTRY[WORKTREE_REMOVE_CLASS];
  return operationClass !== undefined && operationClass.tier === "normal" ? operationClass.priorConfidence : undefined;
})();

function miss<T>(reason: string): Measured<T> {
  return { ok: false, reason };
}

function isInside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith("/") ? parent : `${parent}/`);
}

export class WorktreeRemovalService implements WorktreeRemovalFactsPort, WorktreeRemovalGatePort, ScratchRemovalPort {
  constructor(private readonly deps: WorktreeRemovalDeps) {}

  /** Facts for `lore done`'s cleanup (see {@link WorktreeRemovalFactsPort}). */
  async gatherRemovalFacts(path: string, callerSession: string | null): Promise<WorktreeRemovalFacts> {
    return (await this.inspect(path, callerSession)).facts;
  }

  /**
   * AC-AU-11: the decide(worktree-remove) gate, for a worktree the removal test already called removable.
   * Never throws; anything but an effective `auto` is `allowed: false` with a printable reason.
   */
  async gateRemoval(path: string): Promise<WorktreeRemovalGate> {
    return this.decideRemoval(resolve(path));
  }

  /**
   * Removes a falsifier scratch worktree (`verify --falsify`'s `finally`) through decide(worktree-remove).
   * A path that is not the `wt` dir of a `lore-attested-red-*` temp dir is refused; an escalated decision keeps it.
   */
  async removeScratchWorktree(repoRoot: string, worktreeDir: string): Promise<{ removed: boolean; reason?: string }> {
    const path = resolve(worktreeDir);
    if (!isFalsifierScratchPath(path)) return { removed: false, reason: `${path} is not a falsifier scratch worktree path` };
    const gate = await this.decideRemoval(path);
    if (!gate.allowed) return { removed: false, reason: gate.reason };
    const removed = this.deps.probe.removeScratchWorktree(repoRoot, path);
    return removed.ok ? { removed: true } : { removed: false, reason: `remove-failed: ${removed.reason}` };
  }

  private async decideRemoval(path: string): Promise<WorktreeRemovalGate> {
    const { probe } = this.deps;
    const ignored = probe.ignoredPaths(path);
    const outside = ignored.ok ? ignoredPathsOutsideRegenerableSet(ignored.value) : [];
    const head = probe.headSha(path);
    // reason: the version carries the ignored-outside list, so removing the offending file produces a NEW subject and the
    // worktree can become auto — while the SAME listing can never be re-scored upward (AC-AU-2 worst-of per version).
    const fingerprint = createHash("sha256").update(ignored.ok ? outside.join("\n") : "ignored-not-measured").digest("hex").slice(0, 12);
    const version = `${head.ok ? head.value : "head-not-measured"}:${fingerprint}`;
    const facts = {
      ...(ignored.ok ? { recoverability: outside.length === 0 ? "loss-free-by-proof" : "irreversible-local" } : {}),
      // reason: the removal test (owned-or-abandoned, no live run/claim/process) already established the blast radius.
      blast: "own-or-ended-run",
      evidence: "lore-evaluated",
      ...(WORKTREE_REMOVE_PRIOR_CONFIDENCE !== undefined ? { confidence: WORKTREE_REMOVE_PRIOR_CONFIDENCE } : {}),
    };
    const outcome = await this.deps.decisions.decide(WORKTREE_REMOVE_CLASS, { id: path, version }, facts);
    if (!outcome.ok) {
      return { allowed: false, reason: `removal not decided (nothing removed): ${outcome.error.code}`, ignored_paths: outside };
    }
    if (outcome.value.effective.verdict === "auto") return { allowed: true, record_id: outcome.value.record_id };
    const record = `decision record ${String(outcome.value.record_id)}`;
    const reason =
      outside.length > 0
        ? `ignored data outside the regenerable set: ${outside.join(", ")} (${outcome.value.effective.verdict}, ${record})`
        : !ignored.ok
          ? `ignored paths not measured: ${ignored.reason} (${outcome.value.effective.verdict}, ${record})`
          : `removal decision ${outcome.value.effective.verdict} (${record})`;
    return { allowed: false, reason, ignored_paths: outside, record_id: outcome.value.record_id };
  }

  /**
   * May `path` be removed now?
   *
   * @param callerSession - the caller's harness session id (`null` = unknown, never the owner)
   */
  async check(path: string, callerSession: string | null): Promise<WorktreeCheck> {
    return this.toCheck(await this.inspect(path, callerSession));
  }

  /**
   * Checks every linked worktree of the repository `cwd` belongs to; with `apply`, removes exactly the removable ones
   * (plain `git worktree remove`, then `git branch -d`; a failure keeps the worktree and is reported on its row).
   *
   * @returns STORE_ERROR-free: `err(VALIDATION_ERROR)` only when `cwd` is not inside a git repository.
   */
  async sweep(opts: { apply: boolean; callerSession: string | null; cwd: string }): Promise<Result<WorktreeSweepEntry[], LoreError>> {
    const listed = this.deps.probe.listWorktrees(opts.cwd);
    if (!listed.ok) {
      return err({ code: "VALIDATION_ERROR", field: "cwd", message: `lore worktree sweep must run inside a git repository: ${listed.reason}`, value: opts.cwd });
    }
    const rows: WorktreeSweepEntry[] = [];
    for (const entry of listed.value.slice(1)) {
      const inspection = isFalsifierScratchPath(resolve(entry.path))
        ? this.asScratchInspection(await this.inspect(entry.path, opts.callerSession))
        : await this.inspect(entry.path, opts.callerSession);
      const check = this.toCheck(inspection);
      const hint = this.runEndHint(check);
      if (opts.apply && check.verdict === "removable") {
        const gate = await this.decideRemoval(inspection.path);
        if (!gate.allowed) {
          rows.push({
            ...check,
            verdict: "keep",
            reasons: [gate.reason],
            escalated: { ignored_paths: gate.ignored_paths, ...(gate.record_id !== undefined ? { record_id: gate.record_id } : {}) },
          });
          continue;
        }
        const outcome = this.removeInspected(inspection);
        rows.push({ ...check, ...outcome, ...(hint !== undefined ? { hint } : {}) });
      } else {
        rows.push({ ...check, ...(hint !== undefined ? { hint } : {}) });
      }
    }
    return ok(rows);
  }

  private toCheck(inspection: Inspection): WorktreeCheck {
    const decision = decideWorktreeRemoval(inspection.facts);
    return {
      path: inspection.path,
      verdict: decision.verdict,
      reasons: decision.reasons,
      owner: inspection.owner,
      occupancy: inspection.occupancy,
      processes: inspection.processes,
    };
  }

  /** D4: a worktree kept ONLY because its owning run has no end, with no open task claim naming it. */
  private runEndHint(check: WorktreeCheck): string | undefined {
    if (check.verdict !== "keep" || check.reasons.length !== 1 || check.reasons[0] !== "run-not-ended") return undefined;
    const runId = check.occupancy?.agent_run?.id;
    if (runId === undefined) return undefined;
    return `run ${runId} has no end recorded and no open task claim names this worktree; if its agent is gone: lore run end ${runId} --reason "<why>"`;
  }

  /**
   * Replaces the clauses a scratch worktree cannot satisfy by construction (its mutation makes it dirty; it has no
   * branch, claim or agent run) with the scratch ownership proof: the creating pid is dead, or no marker exists.
   * An unreadable marker stays a miss (-> not-measured). Unmeasured inspections are returned untouched.
   */
  private asScratchInspection(inspection: Inspection): Inspection {
    if (inspection.repoRoot === undefined) return inspection;
    const { probe } = this.deps;
    const marker = probe.scratchOwner(inspection.path);
    const agentRunLive: Measured<boolean> = marker.ok
      ? { ok: true, value: marker.value !== null && probe.isPidAlive(marker.value.pid) }
      : miss(marker.reason);
    return {
      ...inspection,
      scratch: true,
      facts: {
        ...inspection.facts,
        dirty: { ok: true, value: false },
        unmerged: { ok: true, value: false },
        agentRunLive,
        openClaims: { ok: true, value: [] },
        owner: { ok: true, value: null },
      },
    };
  }

  private removeInspected(inspection: Inspection): { removed: boolean; error?: string } {
    if (inspection.repoRoot === undefined) return { removed: false, error: "repository root not measured" };
    if (inspection.scratch) {
      const scratchRemoved = this.deps.probe.removeScratchWorktree(inspection.repoRoot, inspection.path);
      return scratchRemoved.ok ? { removed: true } : { removed: false, error: `remove-failed: ${scratchRemoved.reason}` };
    }
    const removed = this.deps.probe.removeWorktree(inspection.repoRoot, inspection.path);
    if (!removed.ok) return { removed: false, error: `remove-failed: ${removed.reason}` };
    if (inspection.branch === undefined) return { removed: true };
    const branchDeleted = this.deps.probe.deleteBranch(inspection.repoRoot, inspection.branch);
    return branchDeleted.ok ? { removed: true } : { removed: true, error: `branch ${inspection.branch} kept: ${branchDeleted.reason}` };
  }

  private async inspect(rawPath: string, callerSession: string | null): Promise<Inspection> {
    const { probe } = this.deps;
    const path = resolve(rawPath);
    const unmeasured = (reason: string): Inspection => ({
      facts: {
        linked: miss(reason),
        callerInside: miss(reason),
        dirty: miss(reason),
        unmerged: miss(reason),
        locked: miss(reason),
        agentRunLive: miss(reason),
        openClaims: miss(reason),
        processesInside: miss(reason),
        owner: miss(reason),
      },
      path,
      repoRoot: undefined,
      branch: undefined,
      owner: null,
      occupancy: null,
      processes: [],
      scratch: false,
    });
    if (!probe.pathExists(path)) return unmeasured("path does not exist");

    const real = probe.realPath(path);
    const listed = probe.listWorktrees(path);
    if (!listed.ok) return unmeasured(`git worktree list failed: ${listed.reason}`);
    const index = listed.value.findIndex((entry) => probe.realPath(entry.path) === real);
    if (index < 0) return unmeasured("not a worktree of its repository");
    const entry = listed.value[index] as ListedWorktree;
    const repoRoot = (listed.value[0] as ListedWorktree).path;

    const linked: Measured<boolean> = { ok: true, value: index > 0 };
    const callerInside: Measured<boolean> = { ok: true, value: isInside(probe.realPath(probe.currentWorkingDirectory()), real) };
    const dirty = probe.isDirty(path);
    const locked: Measured<boolean> = { ok: true, value: entry.locked };
    const unmerged = this.measureUnmerged(path);

    const occupancyResult = await this.deps.occupancy.occupancy({ worktree: path, ...(entry.branch !== undefined ? { branch: entry.branch } : {}) });
    let agentRunLive: Measured<boolean>;
    let openClaims: Measured<readonly OpenClaimFact[]>;
    let owner: Measured<OwnerFact | null>;
    let occupancy: OccupancyData | null = null;
    if (!occupancyResult.ok) {
      const reason = `run occupancy failed: ${occupancyResult.error.code}`;
      agentRunLive = miss(reason);
      openClaims = miss(reason);
      owner = miss(reason);
    } else {
      occupancy = occupancyResult.value;
      const blocking = occupancy.open_claims.filter((claim) => claim.run_ended !== true);
      const run = occupancy.agent_run;
      const ownRunLive = run !== null && !run.ended && run.parent_ended !== true;
      // reason: `occupied` with neither a live owning run nor a blocking claim means an EARLIER run of the same agent
      // is live (RunService.occupancy D1) — still "run not ended".
      agentRunLive = { ok: true, value: ownRunLive || (occupancy.occupied && blocking.length === 0) };
      openClaims = { ok: true, value: blocking.map((claim) => ({ task_slug: claim.task_slug, run_id: claim.run_id })) };
      owner = await this.measureOwner(run === null ? null : run.id, callerSession);
    }

    const roots = [...new Set([path, real])];
    const scan = this.deps.processScan.processesInside(roots);
    const processes = scan.ok ? scan.value : [];

    return {
      facts: { linked, callerInside, dirty, unmerged, locked, agentRunLive, openClaims, processesInside: scan, owner },
      path,
      repoRoot,
      branch: entry.branch,
      owner: owner.ok ? owner.value : null,
      occupancy,
      processes,
      scratch: false,
    };
  }

  private measureUnmerged(path: string): Measured<boolean> {
    const base = this.deps.probe.integrationBranch(path);
    if (!base.ok) return miss(`integration branch not found: ${base.reason}`);
    const ahead = this.deps.probe.countCommits(path, `${base.value}..HEAD`);
    return ahead.ok ? { ok: true, value: ahead.value > 0 } : miss(`merged-into-${base.value} check failed: ${ahead.reason}`);
  }

  private async measureOwner(runId: string | null, callerSession: string | null): Promise<Measured<OwnerFact | null>> {
    if (runId === null) return { ok: true, value: null };
    const run = await this.deps.runs.getRun(runId as RunId);
    if (!run.ok) return miss(`run read failed: ${run.error.code}`);
    if (run.value === null) return miss(`owning run ${runId} is not registered`);
    const session = run.value.sessionRef;
    let sessionEnded: boolean | null = null;
    try {
      const mainRunId = deriveRunId(run.value.harness, { sessionId: session });
      const end = await this.deps.runs.getRunEnd(mainRunId);
      if (!end.ok) return miss(`session run read failed: ${end.error.code}`);
      sessionEnded = end.value === null ? null : end.value.endedAt !== null;
    } catch (cause) {
      return miss(`session main run id not derivable: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    return { ok: true, value: { run_id: runId, session, mine: callerSession !== null && callerSession === session, session_ended: sessionEnded } };
  }
}
