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
 */
import { resolve } from "node:path";
import { deriveRunId, err, ok, type LoreError, type Result, type RunId } from "@lore/core";
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
import type { ListedWorktree, WorktreeGitProbe } from "./worktree-cleanup.js";

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

export interface WorktreeRemovalDeps {
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
}

function miss<T>(reason: string): Measured<T> {
  return { ok: false, reason };
}

function isInside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith("/") ? parent : `${parent}/`);
}

export class WorktreeRemovalService implements WorktreeRemovalFactsPort {
  constructor(private readonly deps: WorktreeRemovalDeps) {}

  /** Facts for `lore done`'s cleanup (see {@link WorktreeRemovalFactsPort}). */
  async gatherRemovalFacts(path: string, callerSession: string | null): Promise<WorktreeRemovalFacts> {
    return (await this.inspect(path, callerSession)).facts;
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
      const inspection = await this.inspect(entry.path, opts.callerSession);
      const check = this.toCheck(inspection);
      const hint = this.runEndHint(check);
      if (opts.apply && check.verdict === "removable") {
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

  private removeInspected(inspection: Inspection): { removed: boolean; error?: string } {
    if (inspection.repoRoot === undefined) return { removed: false, error: "repository root not measured" };
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
