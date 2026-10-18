/**
 * RunReapService — `lore run reap [--apply]`: end the runs that died without ending, and reap only what an ENDED run
 * provably left behind (spec-autonomy-phase-1-decision-function-human-channel-lore AC-AU-5; ADR D4).
 *
 * Purpose: replace "an agent greps the process table and kills what looks stale" (the CT-3 incident: self-matching
 * pgrep loops kept an agent alive 16 h; an `npm pack` orphan lived 25 h inside a merged worktree) with ONE
 * lore-evaluated procedure whose every kill is a decide() verdict backed by an ownership proof.
 * Public surface: RunReapService.reap, ReapReport, ProcessReapEntry, RunEndEntry, LegacyRunsEntry, RunReapDeps.
 * Invariants:
 *   - ⛔ NEVER TOUCH A LIVE RUN'S PROCESS: a process whose ancestry (itself, its parents, up to init) reaches the
 *     recorded pid of any run that is live — no end recorded AND its pid alive with the recorded start time — is kept
 *     with action `kept-live-owner` and no signal is sent. A caller's own ancestry and descendants are never candidates.
 *   - R (recoverability) is `loss-free-by-proof` ONLY when: the owning run is ended AND its recorded pid is dead
 *     (absent, a zombie, or the same pid with a different start time) AND either
 *       (A) the process's ancestry reaches that run's recorded pid (start time equal), or
 *       (B) its PPID is 1, its start time lies in [registration floored to the second, end], NO OTHER run whose
 *           worktree contains the cwd has a lifetime overlapping that start time, and the start time re-read at
 *           kill time equals the one read at decision time (pid-reuse defence, checked in {@link terminate}).
 *     (C) (AU-T14, subagent runs) the ended run's recorded pid is still ALIVE because subagent runs record the SHARED
 *       main-session harness pid, so A/B can never apply; the process's cwd is inside a worktree whose EVERY recorded
 *       holder (deepest-root rule) is ended, and its start time lies in [registration floored, end] of an ended holder.
 *       Ancestry reaching that shared pid is NOT a live owner here (it reaches every subagent's tools); ancestry to any
 *       other live run's pid still is. A cwd in main's checkout (held by the live main run) never reaches C.
 *     Anything else is `irreversible-local` -> decide() escalates; nothing is signalled.
 *   - "Worktree contains the cwd" uses the DEEPEST known worktree root, so a linked worktree nested under a main
 *     checkout belongs to its own runs, not to every session of the checkout around it.
 *   - Start times are `ps lstart` (second precision, truncated), so the window's lower bound is floored to the second.
 *   - Escalation reasons are facts, never caller input (INV-2): this service passes MEASURED FACTS to decide(); the C
 *     factor is computed by DecisionService from the class's recorded outcomes (AC-AU-8), never supplied here.
 *   - Dry run (`apply: false`) writes nothing: it scores with DecisionService.preview() (same C, same thresholds) and
 *     records no decision row.
 *   - Kill procedure: SIGTERM; SIGKILL only if the SAME process (same start time) is still alive after the grace
 *     period; a final rescan lists survivors. ESRCH at any signal = `already-gone` (a concurrent reap won), not a failure.
 *   - A run with no end whose recorded pid is dead (start time checked) is ended through decide('run-end-stale') with
 *     reason `dead-pid`; legacy runs (no recorded pid) cannot be proven dead and escalate as ONE decision whose subject
 *     version is the hash of their ids (a repeat sweep with the same set adds no row); a run whose pid is alive is never ended.
 * Side-effect class: IO (process table + signals through the injected port; decision_log and run end through ports).
 *
 * Known limits (reported to the orchestrator): session heartbeat liveness (`lore session`) and task claims that name
 * no run are NOT consulted as live owners; only registered runs are. A Linux session whose orphans are re-parented
 * to a subreaper (not PID 1) is conservatively escalated, never reaped.
 */
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import {
  err,
  ok,
  type AutonomyFacts,
  type LoreError,
  type OperationClassRegistry,
  type Result,
} from "@lore/core";
import type { ProcessEntry, ProcessSnapshot, ProcessTablePort } from "../adapters/process-table-port.js";
import type { RunLifecycle, StoreInterface } from "../store/store-interface.js";
import type { DecisionService } from "./decision-service.js";
import type { RunEndResult } from "./run-service.js";

/** SIGKILL is sent only if the process is still alive this long after SIGTERM (spec AC-AU-5: 5 s). */
export const SIGKILL_GRACE_MS = 5000;
const POLL_MS = 100;
const POST_KILL_WAIT_MS = 2000;
const DEAD_PID_END_REASON = "dead-pid";
const LEGACY_SUBJECT_ID = "legacy-runs-without-recorded-pid";
const PROCESS_CLASS = "process-reap";
const STALE_RUN_CLASS = "run-end-stale";

export type RunReapStore = Pick<StoreInterface, "listRunLifecycles" | "queryAudit">;
/** Narrow port to `RunService.end` (services never cross-import). */
export interface RunEnder {
  end(runId: string, reason: string): Promise<Result<RunEndResult, LoreError>>;
}
export type RunReapDecisions = Pick<DecisionService, "decide" | "preview" | "effectiveVerdict" | "governed">;

export interface RunReapDeps {
  readonly store: RunReapStore;
  readonly runs: RunEnder;
  readonly decisions: RunReapDecisions;
  readonly processes: ProcessTablePort;
  /** Pid of the calling process; it and its parents/descendants are never candidates. Default `process.pid`. */
  readonly selfPid?: number;
  /** Resolves a recorded worktree path to its real path; a failure keeps the path as recorded. */
  readonly realpath?: (path: string) => string;
  readonly registry?: OperationClassRegistry;
  /** Test seam for the SIGKILL grace; production uses {@link SIGKILL_GRACE_MS}. */
  readonly killGraceMs?: number;
}

export type ProcessReapAction =
  | "would-reap"
  | "reaped"
  | "already-gone"
  | "kept-live-owner"
  | "escalated"
  | "pid-reused"
  | "denied"
  | "survived";

export interface ProcessReapEntry {
  readonly pid: number;
  readonly command: string;
  readonly cwd: string;
  readonly start_time: string | null;
  /** Ended runs whose worktree contains the cwd. */
  readonly owner_runs: readonly string[];
  readonly proof: "ancestry" | "orphan-in-lifetime" | "exclusive-worktree" | "none";
  readonly action: ProcessReapAction;
  readonly reasons: readonly string[];
  readonly signals: readonly ("SIGTERM" | "SIGKILL")[];
  readonly decision?: { readonly verdict: string; readonly score: number; readonly record_id?: number };
}

export type RunEndAction = "would-end" | "ended" | "kept-live" | "escalated" | "end-failed";

export interface RunEndEntry {
  readonly run_id: string;
  readonly action: RunEndAction;
  readonly reason: string;
  readonly decision?: { readonly verdict: string; readonly score: number; readonly record_id?: number };
}

/** The ONE decision covering every run with no recorded pid. */
export interface LegacyRunsEntry {
  readonly run_ids: readonly string[];
  readonly subject_version: string;
  readonly verdict: string;
  /** Appended on this sweep; absent when this exact set already had its decision. */
  readonly record_id?: number;
  readonly already_pending: boolean;
}

export interface ReapReport {
  readonly apply: boolean;
  readonly runs: readonly RunEndEntry[];
  readonly legacy: LegacyRunsEntry | null;
  readonly processes: readonly ProcessReapEntry[];
  /** Pids targeted by this sweep that were still alive after the final rescan (apply only). */
  readonly rescan_survivors: readonly number[];
}

type RunLiveness = "ended" | "live" | "dead-pid" | "legacy-no-pid";

interface RunView {
  readonly run: RunLifecycle;
  readonly liveness: RunLiveness;
  readonly roots: readonly string[];
}

function storeError(message: string): LoreError {
  return { code: "STORE_ERROR", message };
}

const floorToSecond = (iso: string): number => Math.floor(Date.parse(iso) / 1000) * 1000;

function contains(root: string, path: string): boolean {
  return path === root || path.startsWith(root.endsWith("/") ? root : `${root}/`);
}

export class RunReapService {
  /** The class table of the sweep in progress (set at the top of `reap`). */
  private sweepRegistry: OperationClassRegistry | undefined;

  constructor(private readonly deps: RunReapDeps) {}

  /**
   * Sweep once. With `apply: false` nothing is signalled, ended or recorded.
   *
   * @returns ok(report); err(STORE_ERROR) when the process table or the run registry cannot be measured, or a class
   *   has no prior confidence (nothing is touched in that case); err from a failed decision append.
   */
  async reap(options: { readonly apply: boolean }): Promise<Result<ReapReport, LoreError>> {
    // reason: the GOVERNED class table (AC-AU-9) unless a test injected one; held for this sweep so the dry-run
    // pure decide() calls and the recorded ones score against the same thresholds.
    if (this.deps.registry === undefined) {
      const governed = await this.deps.decisions.governed();
      if (!governed.ok) return governed;
      this.sweepRegistry = governed.value.registry;
    } else {
      this.sweepRegistry = this.deps.registry;
    }
    for (const classId of [PROCESS_CLASS, STALE_RUN_CLASS]) {
      const operationClass = Object.hasOwn(this.sweepRegistry, classId) ? this.sweepRegistry[classId] : undefined;
      if (operationClass === undefined || operationClass.tier !== "normal") {
        return err(storeError(`classes ${PROCESS_CLASS} / ${STALE_RUN_CLASS} must be normal-tier classes (C is calibrated from their outcomes)`));
      }
    }

    const measured = await this.measure();
    if (!measured.ok) return measured;
    let { snapshot, lifecycles } = measured.value;

    const runEnds = await this.endStaleRuns(options.apply, lifecycles, snapshot);
    if (!runEnds.ok) return runEnds;
    if (options.apply && runEnds.value.entries.some((entry) => entry.action === "ended")) {
      // reason: runs ended just now are ENDED for the process proof below (their orphans become provable in the
      // same sweep); re-read so the proof sees their recorded end time, not a stale view.
      const refreshed = await this.deps.store.listRunLifecycles();
      if (!refreshed.ok) return refreshed;
      lifecycles = refreshed.value;
    }

    const views = await this.buildRunViews(lifecycles, snapshot);
    if (!views.ok) return views;
    const processes = await this.reapProcesses(options.apply, views.value, snapshot);
    if (!processes.ok) return processes;
    return ok({
      apply: options.apply,
      runs: runEnds.value.entries,
      legacy: runEnds.value.legacy,
      processes: processes.value.entries,
      rescan_survivors: processes.value.survivors,
    });
  }

  private async measure(): Promise<Result<{ snapshot: ProcessSnapshot; lifecycles: RunLifecycle[] }, LoreError>> {
    const lifecycles = await this.deps.store.listRunLifecycles();
    if (!lifecycles.ok) return lifecycles;
    const snapshot = await this.deps.processes.snapshot();
    if (!snapshot.ok) return err(storeError(`process table not measurable, nothing touched: ${snapshot.reason}`));
    return ok({ snapshot: snapshot.value, lifecycles: lifecycles.value });
  }

  // ── Half 6: runs that died without ending ───────────────────────────────

  private async endStaleRuns(
    apply: boolean,
    lifecycles: readonly RunLifecycle[],
    snapshot: ProcessSnapshot,
  ): Promise<Result<{ entries: RunEndEntry[]; legacy: LegacyRunsEntry | null }, LoreError>> {
    const byPid = new Map(snapshot.entries.map((entry) => [entry.pid, entry] as const));
    const entries: RunEndEntry[] = [];
    const legacyIds: string[] = [];
    for (const run of lifecycles) {
      if (run.endedAt !== null) continue;
      if (run.process.pid === null || run.process.startTime === null) {
        legacyIds.push(run.id);
        continue;
      }
      if (isRecordedProcessAlive(run, byPid)) {
        entries.push({ run_id: run.id, action: "kept-live", reason: "recorded pid is alive with the recorded start time" });
        continue;
      }
      // Dead pid (absent, zombie, or reused by a different process). Facts are measured, never supplied.
      const facts: AutonomyFacts = { recoverability: "reversible", blast: "own-or-ended-run", evidence: "lore-evaluated" };
      const verdict = await this.verdictFor(apply, STALE_RUN_CLASS, { id: run.id, version: run.process.startTime }, facts);
      if (!verdict.ok) return verdict;
      if (verdict.value.verdict !== "auto") {
        entries.push({ run_id: run.id, action: "escalated", reason: DEAD_PID_END_REASON, decision: verdict.value });
        continue;
      }
      if (!apply) {
        entries.push({ run_id: run.id, action: "would-end", reason: DEAD_PID_END_REASON, decision: verdict.value });
        continue;
      }
      const ended = await this.deps.runs.end(run.id, DEAD_PID_END_REASON);
      entries.push({
        run_id: run.id,
        action: ended.ok ? "ended" : "end-failed",
        reason: ended.ok ? DEAD_PID_END_REASON : `${ended.error.code}: ${"message" in ended.error ? ended.error.message : ""}`,
        decision: verdict.value,
      });
    }
    const legacy = await this.decideLegacyRuns(apply, legacyIds.sort());
    if (!legacy.ok) return legacy;
    return ok({ entries, legacy: legacy.value });
  }

  /** All legacy runs in ONE decision; a human accept of it ends them (reason names the acceptance). */
  private async decideLegacyRuns(
    apply: boolean,
    runIds: readonly string[],
  ): Promise<Result<LegacyRunsEntry | null, LoreError>> {
    if (runIds.length === 0) return ok(null);
    const version = createHash("sha256").update(runIds.join("\n")).digest("hex").slice(0, 16);
    // reason: blast is deliberately OMITTED — a run with no recorded pid has no measurable owner, so B is unmeasured -> 0
    // (spec AC-AU-5 half 6); do not "complete" it to make the legacy runs end themselves.
    const facts: AutonomyFacts = { recoverability: "reversible", evidence: "lore-evaluated" };
    const subject = { id: LEGACY_SUBJECT_ID, version };
    if (!apply) {
      const verdict = await this.deps.decisions.preview(STALE_RUN_CLASS, LEGACY_SUBJECT_ID, facts);
      if (!verdict.ok) return verdict;
      return ok({ run_ids: runIds, subject_version: version, verdict: verdict.value.verdict, already_pending: false });
    }
    const existing = await this.deps.decisions.effectiveVerdict(STALE_RUN_CLASS, subject);
    if (!existing.ok) return existing;
    let effective = existing.value;
    let recordId: number | undefined;
    if (effective === null) {
      const outcome = await this.deps.decisions.decide(STALE_RUN_CLASS, subject, facts);
      if (!outcome.ok) return outcome;
      effective = outcome.value.effective;
      recordId = outcome.value.record_id;
    }
    if (effective.verdict === "auto" && effective.channel === "human-tty") {
      for (const runId of runIds) await this.deps.runs.end(runId, "legacy-no-pid-accepted");
    }
    return ok({
      run_ids: runIds,
      subject_version: version,
      verdict: effective.verdict,
      ...(recordId !== undefined ? { record_id: recordId } : {}),
      already_pending: recordId === undefined,
    });
  }

  // ── Half 1-5: processes inside ended runs' worktrees ────────────────────

  private async buildRunViews(
    lifecycles: readonly RunLifecycle[],
    snapshot: ProcessSnapshot,
  ): Promise<Result<RunView[], LoreError>> {
    const claims = await this.deps.store.queryAudit({ action: "claim" });
    if (!claims.ok) return claims;
    const claimRoots = new Map<string, Set<string>>();
    for (const row of claims.value) {
      const runId = row.details?.["harness_run"];
      const worktree = row.details?.["worktree"];
      if (typeof runId !== "string" || typeof worktree !== "string" || worktree.trim() === "") continue;
      const set = claimRoots.get(runId) ?? new Set<string>();
      set.add(worktree);
      claimRoots.set(runId, set);
    }
    const byPid = new Map(snapshot.entries.map((entry) => [entry.pid, entry] as const));
    const resolve = (path: string): string => {
      try {
        return (this.deps.realpath ?? realpathSync)(path);
      } catch {
        return path; // reason: a removed worktree no longer resolves; its recorded spelling still names the root
      }
    };
    return ok(
      lifecycles.map((run) => {
        const roots = new Set<string>();
        if (run.process.worktree !== null) roots.add(resolve(run.process.worktree));
        // reason: a claim records a branch name or an absolute path; only a path is a root a process can sit inside, and
        // resolving a bare branch name would read the process's working directory.
        for (const path of claimRoots.get(run.id) ?? []) if (isAbsolute(path)) roots.add(resolve(path));
        return { run, liveness: livenessOf(run, byPid), roots: [...roots] };
      }),
    );
  }

  private async reapProcesses(
    apply: boolean,
    views: readonly RunView[],
    snapshot: ProcessSnapshot,
  ): Promise<Result<{ entries: ProcessReapEntry[]; survivors: number[] }, LoreError>> {
    const byPid = new Map(snapshot.entries.map((entry) => [entry.pid, entry] as const));
    const selfPid = this.deps.selfPid ?? process.pid;
    const allRoots = [...new Set(views.flatMap((view) => view.roots))];
    const entries: ProcessReapEntry[] = [];
    const targets: { pid: number; start: string; index: number }[] = [];

    for (const candidate of [...snapshot.entries].sort((a, b) => a.pid - b.pid)) {
      const cwd = snapshot.cwdByPid.get(candidate.pid);
      if (cwd === undefined || candidate.pid <= 1 || candidate.zombie) continue;
      const ancestry = ancestryOf(candidate, byPid);
      if (ancestry.has(selfPid)) continue; // the caller and everything it spawned (ps, lsof) is never a candidate
      const owningRoot = allRoots.filter((root) => contains(root, cwd)).sort((a, b) => b.length - a.length)[0];
      if (owningRoot === undefined) continue;
      const holders = views.filter((view) => view.roots.includes(owningRoot));
      const endedHolders = holders.filter((view) => view.liveness === "ended");
      if (endedHolders.length === 0) continue; // inside only live or undecided runs' worktrees: not ours to judge

      const base = {
        pid: candidate.pid,
        command: candidate.command,
        cwd,
        start_time: candidate.startTime,
        owner_runs: endedHolders.map((view) => view.run.id),
      };

      // reason: AU-T14 — when the worktree is exclusively ended runs', a live run that merely shares an ended holder's
      // recorded pid (the main session's pid, recorded by every subagent) is not an owner of this cwd; do not remove.
      const exclusive = holders.length === endedHolders.length;
      const sharedPids = new Set(
        endedHolders.filter((view) => isRecordedProcessAlive(view.run, byPid)).map((view) => view.run.process.pid),
      );
      const liveOwner = views.find(
        (view) =>
          view.liveness === "live" &&
          view.run.process.pid !== null &&
          ancestry.has(view.run.process.pid) &&
          !(exclusive && sharedPids.has(view.run.process.pid)),
      );
      if (liveOwner !== undefined) {
        entries.push({
          ...base,
          proof: "none",
          action: "kept-live-owner",
          reasons: [`ancestry reaches live run ${liveOwner.run.id} (pid ${String(liveOwner.run.process.pid)}); never touched`],
          signals: [],
        });
        continue;
      }

      const classic = proveOwnership(candidate, ancestry, byPid, endedHolders, holders);
      const proof =
        classic.kind === "none" && exclusive ? proveExclusiveWorktree(candidate, byPid, endedHolders, classic) : classic;
      const facts: AutonomyFacts = {
        recoverability: proof.kind === "none" ? "irreversible-local" : "loss-free-by-proof",
        blast: proof.overlappingLiveRun ? "other-live-actor" : "own-or-ended-run",
        evidence: "lore-evaluated",
      };
      const subject = { id: `pid:${candidate.pid}`, version: candidate.startTime ?? "start-time-unmeasured" };
      const verdict = await this.verdictFor(apply, PROCESS_CLASS, subject, facts);
      if (!verdict.ok) return verdict;
      if (verdict.value.verdict !== "auto") {
        entries.push({
          ...base,
          proof: proof.kind,
          action: "escalated",
          reasons: proof.kind === "none" ? proof.reasons : [...proof.reasons, "decide() did not return auto"],
          signals: [],
          decision: verdict.value,
        });
        continue;
      }
      if (!apply || candidate.startTime === null) {
        entries.push({ ...base, proof: proof.kind, action: "would-reap", reasons: proof.reasons, signals: [], decision: verdict.value });
        continue;
      }
      targets.push({ pid: candidate.pid, start: candidate.startTime, index: entries.length });
      entries.push({ ...base, proof: proof.kind, action: "would-reap", reasons: proof.reasons, signals: [], decision: verdict.value });
    }

    const survivors: number[] = [];
    if (apply && targets.length > 0) {
      for (const target of targets) {
        const outcome = await this.terminate(target.pid, target.start);
        entries[target.index] = { ...(entries[target.index] as ProcessReapEntry), action: outcome.action, signals: outcome.signals };
      }
      const rescan = await this.deps.processes.snapshot();
      if (!rescan.ok) return err(storeError(`final rescan not measurable: ${rescan.reason}`));
      const after = new Map(rescan.value.entries.map((entry) => [entry.pid, entry] as const));
      for (const target of targets) {
        const still = after.get(target.pid);
        if (still !== undefined && !still.zombie && still.startTime === target.start) {
          survivors.push(target.pid);
          const previous = entries[target.index] as ProcessReapEntry;
          entries[target.index] = { ...previous, action: "survived", reasons: [...previous.reasons, "still alive after the final rescan"] };
        }
      }
    }
    return ok({ entries, survivors });
  }

  /**
   * SIGTERM, SIGKILL only if the SAME process is still alive after the grace, ESRCH = already-gone.
   * The start time is re-read right before each signal: a pid that now belongs to another process is never signalled.
   */
  private async terminate(
    pid: number,
    decidedStart: string,
  ): Promise<{ action: ProcessReapAction; signals: ("SIGTERM" | "SIGKILL")[] }> {
    const port = this.deps.processes;
    const signals: ("SIGTERM" | "SIGKILL")[] = [];
    const isSameAlive = async (): Promise<boolean> => {
      const now = await port.inspect(pid);
      return now !== null && !now.zombie && now.startTime === decidedStart;
    };
    const now = await port.inspect(pid);
    if (now === null || now.zombie) return { action: "already-gone", signals };
    if (now.startTime !== decidedStart) return { action: "pid-reused", signals };

    const first = await port.signal(pid, "SIGTERM");
    if (first === "gone") return { action: "already-gone", signals };
    if (first === "denied") return { action: "denied", signals };
    signals.push("SIGTERM");
    if (await this.waitUntilGone(isSameAlive, this.deps.killGraceMs ?? SIGKILL_GRACE_MS)) return { action: "reaped", signals };

    // Still alive after the grace: re-verify identity, then SIGKILL.
    const again = await port.inspect(pid);
    if (again === null || again.zombie) return { action: "reaped", signals };
    if (again.startTime !== decidedStart) return { action: "pid-reused", signals };
    const second = await port.signal(pid, "SIGKILL");
    if (second === "gone") return { action: "reaped", signals };
    if (second === "denied") return { action: "denied", signals };
    signals.push("SIGKILL");
    return (await this.waitUntilGone(isSameAlive, POST_KILL_WAIT_MS))
      ? { action: "reaped", signals }
      : { action: "survived", signals };
  }

  private async waitUntilGone(isAlive: () => Promise<boolean>, budgetMs: number): Promise<boolean> {
    for (let waited = 0; waited <= budgetMs; waited += POLL_MS) {
      if (!(await isAlive())) return true;
      await this.deps.processes.sleep(POLL_MS);
    }
    return !(await isAlive());
  }

  /** decide(): the service (recorded in decision_log) on apply, DecisionService.preview on a dry run (nothing recorded). */
  private async verdictFor(
    apply: boolean,
    classId: string,
    subject: { id: string; version: string },
    facts: AutonomyFacts,
  ): Promise<Result<{ verdict: string; score: number; record_id?: number }, LoreError>> {
    if (!apply) {
      const decision = await this.deps.decisions.preview(classId, subject.id, facts);
      if (!decision.ok) return decision;
      return ok({ verdict: decision.value.verdict, score: decision.value.score });
    }
    const outcome = await this.deps.decisions.decide(classId, subject, facts);
    if (!outcome.ok) return outcome;
    // reason: the EFFECTIVE verdict binds (a human-tty accept of an escalated version is auto; a worse earlier
    // machine record for the same version stays worse), not this call's raw score.
    return ok({ verdict: outcome.value.effective.verdict, score: outcome.value.decision.score, record_id: outcome.value.record_id });
  }
}

/** The run's recorded pid is the same process now: present, not a zombie, same start time. */
function isRecordedProcessAlive(run: RunLifecycle, byPid: ReadonlyMap<number, ProcessEntry>): boolean {
  if (run.process.pid === null || run.process.startTime === null) return false;
  const entry = byPid.get(run.process.pid);
  return entry !== undefined && !entry.zombie && entry.startTime === run.process.startTime;
}

function livenessOf(run: RunLifecycle, byPid: ReadonlyMap<number, ProcessEntry>): RunLiveness {
  if (run.endedAt !== null) return "ended";
  if (run.process.pid === null || run.process.startTime === null) return "legacy-no-pid";
  return isRecordedProcessAlive(run, byPid) ? "live" : "dead-pid";
}

/** The process and every parent up to init, by the table's ppid links (cycle-safe). */
function ancestryOf(start: ProcessEntry, byPid: ReadonlyMap<number, ProcessEntry>): Set<number> {
  const chain = new Set<number>([start.pid]);
  let current: ProcessEntry | undefined = start;
  while (current !== undefined && current.ppid > 0 && !chain.has(current.ppid)) {
    chain.add(current.ppid);
    current = byPid.get(current.ppid);
  }
  return chain;
}

type OwnershipProof =
  | { kind: "ancestry" | "orphan-in-lifetime" | "exclusive-worktree"; reasons: string[]; overlappingLiveRun: boolean }
  | { kind: "none"; reasons: string[]; overlappingLiveRun: boolean };

/** The proof table of AC-AU-5 over measured facts only. Pure. */
function proveOwnership(
  candidate: ProcessEntry,
  ancestry: ReadonlySet<number>,
  byPid: ReadonlyMap<number, ProcessEntry>,
  endedHolders: readonly RunView[],
  holders: readonly RunView[],
): OwnershipProof {
  const reasons: string[] = [];
  const deadEnded = endedHolders.filter((view) => view.run.process.pid !== null && !isRecordedProcessAlive(view.run, byPid));
  if (deadEnded.length === 0) {
    reasons.push("no owning ended run has a recorded pid proven dead");
    return { kind: "none", reasons, overlappingLiveRun: false };
  }

  for (const view of deadEnded) {
    const recorded = view.run.process;
    const ancestor = recorded.pid === null ? undefined : byPid.get(recorded.pid);
    if (recorded.pid !== null && ancestry.has(recorded.pid) && ancestor !== undefined && ancestor.startTime === recorded.startTime) {
      return { kind: "ancestry", reasons: [`ancestry reaches ended run ${view.run.id} (pid ${recorded.pid}, dead)`], overlappingLiveRun: false };
    }
  }

  if (candidate.ppid !== 1) {
    reasons.push(`ppid is ${candidate.ppid}, not 1, and ancestry does not reach a dead owner pid`);
    return { kind: "none", reasons, overlappingLiveRun: false };
  }
  if (candidate.startTime === null) {
    reasons.push("process start time is not measurable");
    return { kind: "none", reasons, overlappingLiveRun: false };
  }
  const start = Date.parse(candidate.startTime);
  let overlappingLiveRun = false;
  for (const view of deadEnded) {
    const lower = floorToSecond(view.run.registeredAt);
    const upper = view.run.endedAt === null ? Number.POSITIVE_INFINITY : Date.parse(view.run.endedAt);
    if (start < lower || start > upper) {
      reasons.push(`started ${candidate.startTime}, outside run ${view.run.id} lifetime [${view.run.registeredAt}, ${view.run.endedAt ?? "open"}]`);
      continue;
    }
    const overlapping = holders.filter(
      (other) =>
        other.run.id !== view.run.id &&
        start >= floorToSecond(other.run.registeredAt) &&
        (other.run.endedAt === null || start <= Date.parse(other.run.endedAt)),
    );
    if (overlapping.length > 0) {
      if (overlapping.some((other) => other.run.endedAt === null)) overlappingLiveRun = true;
      reasons.push(`run(s) ${overlapping.map((other) => other.run.id).join(", ")} also hold this worktree during the process start`);
      continue;
    }
    return {
      kind: "orphan-in-lifetime",
      reasons: [`orphan (ppid 1) started ${candidate.startTime} inside ended run ${view.run.id} lifetime; no overlapping run`],
      overlappingLiveRun: false,
    };
  }
  return { kind: "none", reasons, overlappingLiveRun };
}

/**
 * Proof C (AU-T14): the ended runs that hold this worktree exclusively recorded a pid that is still alive (the shared
 * main-session harness pid), so A and B cannot apply. Provable when the process started inside such a run's lifetime.
 * Pure; the caller has already established that every holder of the owning root is ended.
 *
 * @returns the proof, or `fallback` with the reasons why no sharing-pid ended holder's lifetime contains the start.
 */
function proveExclusiveWorktree(
  candidate: ProcessEntry,
  byPid: ReadonlyMap<number, ProcessEntry>,
  endedHolders: readonly RunView[],
  fallback: OwnershipProof,
): OwnershipProof {
  const sharing = endedHolders.filter((view) => view.run.process.pid !== null && isRecordedProcessAlive(view.run, byPid));
  if (sharing.length === 0) return fallback; // dead-pid holders stay under A/B only
  if (candidate.startTime === null) return { ...fallback, reasons: [...fallback.reasons, "process start time is not measurable"] };
  const start = Date.parse(candidate.startTime);
  const reasons = [...fallback.reasons];
  for (const view of sharing) {
    const lower = floorToSecond(view.run.registeredAt);
    const upper = view.run.endedAt === null ? Number.POSITIVE_INFINITY : Date.parse(view.run.endedAt);
    if (start < lower || start > upper) {
      reasons.push(`started ${candidate.startTime}, outside run ${view.run.id} lifetime [${view.run.registeredAt}, ${view.run.endedAt ?? "open"}]`);
      continue;
    }
    return {
      kind: "exclusive-worktree",
      reasons: [`inside the worktree held only by ended run ${view.run.id} (shared pid ${String(view.run.process.pid)} alive); started within its lifetime`],
      overlappingLiveRun: false,
    };
  }
  return { kind: "none", reasons, overlappingLiveRun: false };
}
