/**
 * worktree-removal-test — THE single decision "may this worktree be removed now", pure over measured facts
 * (spec-one-worktree-removal-test-for-the-guard-lore-done-and-a, D1/D2/D5; baseline-remove-a-seat BR-1070 / BR-1079).
 *
 * Public surface: {@link decideWorktreeRemoval}; types {@link WorktreeRemovalFacts}, {@link WorktreeRemovalDecision},
 * {@link Measured}, {@link WorktreeRemovalFactsPort}.
 *
 * Consumers: `WorktreeRemovalService` (gathers the facts; backs `lore worktree check|sweep` and the git-safety hook) and
 * `worktree-cleanup.ts` (`lore done`). No other module may re-state any clause below.
 *
 * @invariant Side-effect class: pure. No clock, no fs, no process: the facts type carries NO time value (D5 — no reflog
 *   age, commit age or claim age exists to read), so an elapsed-time clause cannot be written here without changing the type.
 * @invariant Removable iff ALL clauses hold (D1): a linked worktree (never the main checkout); the caller is not inside it;
 *   clean; merged into the integration branch; not `git worktree lock`ed; owning agent run (and its parent) ended; no open
 *   claim whose run is live; no process other than the caller's own ancestry with its cwd inside; OWNED-OR-ABANDONED (the
 *   owning run's session is the caller's, or that session's main run has ended, or there is no owning run).
 * @invariant NO silent fallback: a clause whose fact could not be measured is never read as "holds". It yields
 *   `not-measured` unless another clause already proved `keep` (keep wins — the worktree is kept either way).
 * @invariant An unknown caller session (`null`) is never the owner (D2, same rule as the territory, BR-390).
 */

/** One measured fact, or the reason it could not be measured. */
export type Measured<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };

/** The agent run owning the worktree (most recently registered run of its agent) with its session's liveness. */
export interface OwnerFact {
  readonly run_id: string;
  /** The harness session the owning run belongs to (`RunRecord.sessionRef`). */
  readonly session: string;
  /** `session` equals the caller's session; always false for an unknown caller. */
  readonly mine: boolean;
  /** The session's main run has an end recorded. `null` = not measured (main run unregistered). */
  readonly session_ended: boolean | null;
}

/** An open task claim recorded for the worktree whose run is not known to be ended. */
export interface OpenClaimFact {
  readonly task_slug: string;
  readonly run_id: string | null;
}

/** A process other than the caller's own ancestry with its cwd inside the worktree. */
export interface ProcessInsideFact {
  readonly pid: number;
  readonly command: string;
}

/** Every fact the single test reads. Each is independently measurable; none is a time. */
export interface WorktreeRemovalFacts {
  /** `false` = the main checkout. */
  readonly linked: Measured<boolean>;
  /** The caller's working directory is the worktree or under it. */
  readonly callerInside: Measured<boolean>;
  /** Any tracked or untracked change. */
  readonly dirty: Measured<boolean>;
  /** The worktree HEAD has commits the integration branch does not. */
  readonly unmerged: Measured<boolean>;
  readonly locked: Measured<boolean>;
  /** The owning agent run is live (not ended, parent not ended) or some earlier run of the agent is. */
  readonly agentRunLive: Measured<boolean>;
  /** Open claims whose run is not known to be ended (a claim naming no run counts). */
  readonly openClaims: Measured<readonly OpenClaimFact[]>;
  readonly processesInside: Measured<readonly ProcessInsideFact[]>;
  /** `null` = no owning run (hand-made worktree). */
  readonly owner: Measured<OwnerFact | null>;
}

export type WorktreeRemovalVerdict = "removable" | "keep" | "not-measured";

/** Reason tokens for `keep` (fixed order below); `not-measured` entries are `<clause>-not-measured: <detail>`. */
export const KEEP_REASON_TOKENS = [
  "main-checkout",
  "caller-inside",
  "uncommitted-changes",
  "unmerged-commits",
  "locked",
  "run-not-ended",
  "open-claim",
  "process-inside",
  "foreign-live-session",
] as const;
export type KeepReasonToken = (typeof KEEP_REASON_TOKENS)[number];

export interface WorktreeRemovalDecision {
  readonly verdict: WorktreeRemovalVerdict;
  /** Every failing clause; empty iff `removable`. */
  readonly reasons: readonly string[];
}

function notMeasured(clause: string, reason: string): string {
  return `${clause}-not-measured: ${reason}`;
}

/**
 * The single removal test.
 *
 * @example
 * // own stopped agent, clean, merged -> removable regardless of how recent its last commit is
 * decideWorktreeRemoval(facts).verdict // "removable"
 */
export function decideWorktreeRemoval(facts: WorktreeRemovalFacts): WorktreeRemovalDecision {
  const keep: string[] = [];
  const unmeasured: string[] = [];

  if (!facts.linked.ok) unmeasured.push(notMeasured("linked", facts.linked.reason));
  else if (!facts.linked.value) keep.push("main-checkout");

  if (!facts.callerInside.ok) unmeasured.push(notMeasured("caller-inside", facts.callerInside.reason));
  else if (facts.callerInside.value) keep.push("caller-inside");

  if (!facts.dirty.ok) unmeasured.push(notMeasured("dirty", facts.dirty.reason));
  else if (facts.dirty.value) keep.push("uncommitted-changes");

  if (!facts.unmerged.ok) unmeasured.push(notMeasured("merged", facts.unmerged.reason));
  else if (facts.unmerged.value) keep.push("unmerged-commits");

  if (!facts.locked.ok) unmeasured.push(notMeasured("locked", facts.locked.reason));
  else if (facts.locked.value) keep.push("locked");

  if (!facts.agentRunLive.ok) unmeasured.push(notMeasured("run", facts.agentRunLive.reason));
  else if (facts.agentRunLive.value) keep.push("run-not-ended");

  if (!facts.openClaims.ok) unmeasured.push(notMeasured("claims", facts.openClaims.reason));
  else if (facts.openClaims.value.length > 0) keep.push("open-claim");

  if (!facts.processesInside.ok) unmeasured.push(notMeasured("processes", facts.processesInside.reason));
  else if (facts.processesInside.value.length > 0) keep.push("process-inside");

  if (!facts.owner.ok) unmeasured.push(notMeasured("owner", facts.owner.reason));
  else {
    const owner = facts.owner.value;
    if (owner !== null && !owner.mine) {
      if (owner.session_ended === null) unmeasured.push(notMeasured("owner-session", `main run of session ${owner.session} is not registered`));
      else if (!owner.session_ended) keep.push("foreign-live-session");
    }
  }

  if (keep.length > 0) return { verdict: "keep", reasons: [...keep, ...unmeasured] };
  if (unmeasured.length > 0) return { verdict: "not-measured", reasons: unmeasured };
  return { verdict: "removable", reasons: [] };
}

/**
 * Port: measures the facts for one worktree path. Implemented by `WorktreeRemovalService`; injected into
 * `worktree-cleanup.ts` so `lore done` does not import a service. NEVER throws — failure is a `Measured` miss.
 */
export interface WorktreeRemovalFactsPort {
  /** @param callerSession - the caller's harness session id (D2); `null` = unknown (never the owner). */
  gatherRemovalFacts(path: string, callerSession: string | null): Promise<WorktreeRemovalFacts>;
}
