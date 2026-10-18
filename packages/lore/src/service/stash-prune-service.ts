/**
 * StashPruneService — `lore stash prune`: make every stash recoverable, then let lore (never an agent) drop it.
 *
 * Purpose: list the repo's stashes with lore-measured facts and, on apply, archive each stash commit under
 * `refs/lore/archive/stash/<sha>`, ask decide("stash-drop") and drop ONLY that exact stash on an `auto` verdict.
 * Public surface: StashPruneService.{list, apply}, StashFacts, StashPruneEntry, StashPruneReport, GitRunner,
 *   parseStashBranch, ARCHIVE_REF_PREFIX.
 * Invariants:
 *   - Archive FIRST: a stash is dropped only after `git update-ref` wrote its archive ref AND the ref resolves to
 *     the very same commit sha. An archive failure aborts the whole apply (nothing further is dropped) and is
 *     returned as err(STORE_ERROR) — never swallowed, never turned into a "kept" row.
 *   - Factors come from facts lore measured in THIS call (INV-2): R = loss-free-by-proof only after the archive
 *     ref was verified; B from run attribution; E = lore-evaluated; C = computed by DecisionService
 *     from the class's recorded outcomes (AC-AU-8; no caller can supply a value).
 *   - Attribution (AU-T20): an owner is PROVEN, never inferred from an unrelated open claim. A stash on a
 *     `worktree-agent-<agentId>` branch belongs to that agent's runs (by agent_ref) and to open task claims that
 *     record that private branch (a claim whose run is not provably ended = live). Any other branch (main, a
 *     feature branch) belongs to the run whose lifetime (registered_at .. ended_at/open) contains the stash
 *     commit's creation time AND whose recorded worktree (migration-021) is the checkout where that branch is
 *     checked out (`git worktree list`). No such run (or no recorded worktree, or the branch is checked out
 *     nowhere) = no provable owner (B 0.9: the archive ref keeps it recoverable for any session). A store or git
 *     failure while measuring leaves B unmeasured (-> 0, escalate).
 *   - The drop re-resolves `stash@{n}` by sha immediately before dropping, so concurrent pushes/drops by other
 *     sessions cannot shift the index onto a different stash.
 *   - "Contained in main" (tracked diff blobs and the ^3 untracked tree blobs equal main's) is REPORTED, not a
 *     score input: the archive ref already makes the drop loss-free.
 * Side-effect class: IO (git subprocesses through the injected GitRunner, decision_log appends via DecisionService).
 *
 * Source: spec-autonomy-phase-1-decision-function-human-channel-lore AC-AU-4;
 *   adr-autonomy-is-decided-by-measured-facts-one-decision-function D4.
 */
import { realpathSync } from "node:fs";
import { err, ok, type AutonomyFacts, type LoreError, type Result } from "@lore/core";
import type { RunId } from "@lore/core";
import type { DecisionService } from "./decision-service.js";
import type { StoreInterface } from "../store/store-interface.js";

/** Class id in @lore/core's registry. */
const STASH_DROP_CLASS = "stash-drop";

/**
 * Decision subject version for a stash drop: the stash sha plus the attribution facts (owner run ids, each one's
 * ended state, overall state), canonically serialised. New facts (the owner run ended) start a new version so the
 * decision is re-made; unchanged facts keep the version so re-running prune cannot re-roll it (ADR D5, AC-AU-2).
 */
export function stashDecisionVersion(sha: string, attribution: StashAttribution): string {
  const ended = new Set(attribution.endedRuns ?? []);
  const runs = [...attribution.runs].sort().map((id) => `${id}=${ended.has(id) ? "ended" : "live"}`);
  return `${sha}|${attribution.state}|${runs.join(",")}`;
}

/** Where every stash commit is kept before lore drops it. */
export const ARCHIVE_REF_PREFIX = "refs/lore/archive/stash/";

/** Runs a git command in the repo and returns its raw outcome; never throws. */
export type GitRunner = (args: readonly string[], stdin?: string) => { readonly status: number; readonly stdout: string; readonly stderr: string };

export type StashRunState = "live" | "ended" | "no-provable-owner" | "unmeasured";

export interface StashAttribution {
  /** Branch named in the stash message, or null ("On (no branch)" / unparsable). */
  readonly branch: string | null;
  /** Run ids the branch maps to (agent runs by agent_ref, claim runs by harness_run). */
  readonly runs: readonly string[];
  /** Run ids whose end is recorded (a subset of `runs`); feeds the decision subject version. */
  readonly endedRuns?: readonly string[];
  readonly state: StashRunState;
  /** Human sentence naming why `state` was chosen. */
  readonly reason: string;
}

export interface StashContainment {
  /** Every tracked path the stash changed has main's blob (deleted paths are absent in main). */
  readonly tracked_in_main: boolean;
  /** The ^3 untracked tree is absent, or every file in it has main's blob. */
  readonly untracked_in_main: boolean;
  /** false when main could not be resolved: both flags are then false, not guessed. */
  readonly measured: boolean;
}

export interface StashFacts {
  readonly sha: string;
  readonly index: number;
  readonly message: string;
  readonly attribution: StashAttribution;
  readonly containment: StashContainment;
}

export type StashOutcome =
  | { readonly kind: "dropped"; readonly archive_ref: string; readonly score: number }
  | { readonly kind: "escalated"; readonly archive_ref: string; readonly score: number; readonly reasons: readonly string[] }
  | { readonly kind: "kept"; readonly archive_ref: string; readonly reasons: readonly string[] };

export interface StashPruneEntry {
  readonly facts: StashFacts;
  /** Absent on a dry run. */
  readonly outcome?: StashOutcome;
}

export interface StashPruneReport {
  readonly entries: readonly StashPruneEntry[];
  readonly applied: boolean;
  readonly counts: { readonly dropped: number; readonly kept: number; readonly escalated: number };
}

export interface StashPruneDeps {
  readonly git: GitRunner;
  readonly store: Pick<StoreInterface, "listRunsByAgentRef" | "getRunEnd" | "findMany" | "listRunLifecycles">;
  readonly decisions: DecisionService;
  /** Ref whose blobs "contained in main" is compared against. */
  readonly mainRef?: string;
}

const STASH_MESSAGE_BRANCH = /^(?:WIP on|On) ([^:]+):/;
const AGENT_BRANCH = /^worktree-agent-(.+)$/;
const NULL_SHA = /^0+$/;

/** The branch a stash message names ("On main: x", "WIP on feat: abc subject"), or null for "(no branch)"/unparsable. */
export function parseStashBranch(message: string): string | null {
  const match = STASH_MESSAGE_BRANCH.exec(message);
  const branch = match?.[1];
  if (branch === undefined || branch === "(no branch)") return null;
  return branch;
}

function storeError(message: string): LoreError {
  return { code: "STORE_ERROR", message };
}

export class StashPruneService {
  constructor(private readonly deps: StashPruneDeps) {}

  /** Every stash with its facts (read-only; no archive, no decision record). */
  async list(): Promise<Result<readonly StashFacts[], LoreError>> {
    const listed = this.deps.git(["stash", "list", "--format=%H%x00%gs"]);
    if (listed.status !== 0) return err(storeError(`git stash list failed: ${listed.stderr.trim()}`));
    const rows = listed.stdout.split("\n").filter((line) => line !== "");
    const mainBlobs = this.resolveMainRef();
    const facts: StashFacts[] = [];
    for (const [index, row] of rows.entries()) {
      const [sha = "", message = ""] = row.split("\0");
      const attribution = await this.attribute(parseStashBranch(message), sha);
      facts.push({ sha, index, message, attribution, containment: this.measureContainment(sha, mainBlobs) });
    }
    return ok(facts);
  }

  /**
   * Archive, decide and (on auto) drop each stash.
   *
   * @returns err(STORE_ERROR) when an archive write/verify or a drop fails (processing stops there; stashes already
   *   handled stay handled); err from DecisionService when a decision cannot be recorded (that stash is NOT dropped).
   */
  async apply(): Promise<Result<StashPruneReport, LoreError>> {
    const listed = await this.list();
    if (!listed.ok) return listed;
    const entries: StashPruneEntry[] = [];
    for (const facts of listed.value) {
      const archived = this.archive(facts.sha);
      if (!archived.ok) return archived;
      const outcome = await this.decideAndMaybeDrop(facts, archived.value);
      if (!outcome.ok) return outcome;
      entries.push({ facts, outcome: outcome.value });
    }
    const countOf = (kind: StashOutcome["kind"]) => entries.filter((e) => e.outcome?.kind === kind).length;
    return ok({ entries, applied: true, counts: { dropped: countOf("dropped"), kept: countOf("kept"), escalated: countOf("escalated") } });
  }

  /** Write `refs/lore/archive/stash/<sha>` and prove it resolves to the same commit. */
  private archive(sha: string): Result<string, LoreError> {
    const ref = `${ARCHIVE_REF_PREFIX}${sha}`;
    const written = this.deps.git(["update-ref", ref, sha]);
    if (written.status !== 0) return err(storeError(`archive write failed for stash ${sha} (${ref}): ${written.stderr.trim()}`));
    const resolved = this.deps.git(["rev-parse", "--verify", "-q", `${ref}^{commit}`]);
    if (resolved.status !== 0 || resolved.stdout.trim() !== sha) {
      return err(storeError(`archive ref ${ref} does not resolve to stash commit ${sha}; nothing dropped`));
    }
    return ok(ref);
  }

  private async decideAndMaybeDrop(facts: StashFacts, archiveRef: string): Promise<Result<StashOutcome, LoreError>> {
    const measured = await this.buildDecisionFacts(facts.attribution);
    if (!measured.ok) return measured;
    const decided = await this.deps.decisions.decide(STASH_DROP_CLASS, { id: facts.sha, version: stashDecisionVersion(facts.sha, facts.attribution) }, measured.value);
    if (!decided.ok) return decided;
    const { decision, effective } = decided.value;
    if (effective.verdict !== "auto") {
      const reasons = decision.reasons.length > 0 ? decision.reasons : [facts.attribution.reason];
      const named = [facts.attribution.reason, ...reasons.filter((r) => r !== facts.attribution.reason)];
      return ok(
        effective.verdict === "escalate"
          ? { kind: "escalated", archive_ref: archiveRef, score: decision.score, reasons: named }
          : { kind: "kept", archive_ref: archiveRef, reasons: named },
      );
    }
    const dropped = this.dropBySha(facts.sha);
    if (!dropped.ok) return dropped;
    return ok({ kind: "dropped", archive_ref: archiveRef, score: decision.score });
  }

  /** Facts decide() may use: only what lore measured above. C is NOT among them: DecisionService computes it (AC-AU-8). */
  private async buildDecisionFacts(attribution: StashAttribution): Promise<Result<AutonomyFacts, LoreError>> {
    const blast =
      attribution.state === "live"
        ? ("other-live-actor" as const)
        : attribution.state === "ended"
          ? ("own-or-ended-run" as const)
          : attribution.state === "no-provable-owner"
            ? ("unprovable-owner-made-recoverable" as const)
            : undefined;
    return ok({
      recoverability: "loss-free-by-proof",
      evidence: "lore-evaluated",
      ...(blast !== undefined ? { blast } : {}),
    });
  }

  /** Drop exactly the stash commit `sha`, re-resolving its current index first. */
  private dropBySha(sha: string): Result<void, LoreError> {
    const shas = this.deps.git(["stash", "list", "--format=%H"]);
    if (shas.status !== 0) return err(storeError(`git stash list failed before drop: ${shas.stderr.trim()}`));
    const index = shas.stdout.split("\n").indexOf(sha);
    if (index < 0) return ok(undefined); // another session already dropped it; the archive ref remains
    const ref = `stash@{${index}}`;
    const current = this.deps.git(["rev-parse", "--verify", "-q", ref]);
    if (current.status !== 0 || current.stdout.trim() !== sha) {
      return err(storeError(`stash stack changed while dropping ${sha}; nothing dropped, re-run lore stash prune --apply`));
    }
    const dropped = this.deps.git(["stash", "drop", "-q", ref]);
    if (dropped.status !== 0) return err(storeError(`git stash drop ${ref} failed: ${dropped.stderr.trim()}`));
    return ok(undefined);
  }

  private async attribute(branch: string | null, sha: string): Promise<StashAttribution> {
    if (branch === null) {
      return { branch, runs: [], state: "no-provable-owner", reason: "stash names no branch: no provable owner" };
    }
    if (AGENT_BRANCH.test(branch)) return this.attributeAgentBranch(branch);
    return this.attributeByLifetimeAndCheckout(branch, sha);
  }

  /**
   * A stash on a non-agent branch belongs to the run alive when it was made, in the checkout that has the branch.
   * reason: open task claims are deliberately NOT consulted here — a claim recording "main" says nothing about who
   * made a given stash on main (the AU-T20 false "live").
   */
  private async attributeByLifetimeAndCheckout(branch: string, sha: string): Promise<StashAttribution> {
    const createdAt = this.stashCreatedAtMs(sha);
    if (createdAt === null) return unmeasured(branch, `cannot read creation time of stash ${sha}`);
    const checkout = this.checkoutOfBranch(branch);
    if (!checkout.ok) return unmeasured(branch, checkout.error);
    if (checkout.value === null) {
      return { branch, runs: [], state: "no-provable-owner", reason: `branch ${branch} is checked out in no working copy: no provable owner` };
    }
    const lifecycles = await this.deps.store.listRunLifecycles();
    if (!lifecycles.ok) return unmeasured(branch, `cannot read runs: ${lifecycles.error.code}`);
    const owners = lifecycles.value.filter(
      (run) =>
        run.process.worktree !== null &&
        samePath(run.process.worktree, checkout.value as string) &&
        Date.parse(run.registeredAt) <= createdAt &&
        (run.endedAt === null || Date.parse(run.endedAt) >= createdAt),
    );
    if (owners.length === 0) {
      return { branch, runs: [], state: "no-provable-owner", reason: `no run in ${checkout.value} was alive when this stash was made: no provable owner` };
    }
    const runs = owners.map((run) => run.id as string);
    const endedRuns = owners.filter((run) => run.endedAt !== null).map((run) => run.id as string);
    const live = owners.filter((run) => run.endedAt === null).map((run) => run.id as string);
    if (live.length > 0) {
      return { branch, runs, endedRuns, state: "live", reason: `stash made in ${checkout.value} during live run ${live.join(", ")}` };
    }
    return { branch, runs, endedRuns, state: "ended", reason: `stash made in ${checkout.value} during ended run ${runs.join(", ")}` };
  }

  /** Stash commit creation time (ms since epoch), or null when git cannot say. */
  private stashCreatedAtMs(sha: string): number | null {
    const shown = this.deps.git(["show", "-s", "--format=%ct", sha]);
    if (shown.status !== 0) return null;
    const seconds = Number(shown.stdout.trim());
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
  }

  /** Path of the working copy that has `branch` checked out now (`git worktree list --porcelain`), null when none does. */
  private checkoutOfBranch(branch: string): { readonly ok: true; readonly value: string | null } | { readonly ok: false; readonly error: string } {
    const listed = this.deps.git(["worktree", "list", "--porcelain"]);
    if (listed.status !== 0) return { ok: false, error: `git worktree list failed: ${listed.stderr.trim()}` };
    for (const block of listed.stdout.split("\n\n")) {
      const lines = block.split("\n");
      const path = lines.find((l) => l.startsWith("worktree "))?.slice("worktree ".length);
      const checked = lines.find((l) => l.startsWith("branch "))?.slice("branch ".length);
      if (path !== undefined && checked === `refs/heads/${branch}`) return { ok: true, value: path };
    }
    return { ok: true, value: null };
  }

  private async attributeAgentBranch(branch: string): Promise<StashAttribution> {
    const runIds = new Map<string, boolean>(); // run id -> ended
    const agentId = AGENT_BRANCH.exec(branch)?.[1];
    if (agentId !== undefined) {
      const runs = await this.deps.store.listRunsByAgentRef(agentId);
      if (!runs.ok) return unmeasured(branch, `cannot read runs of agent ${agentId}: ${runs.error.code}`);
      for (const run of runs.value) {
        const end = await this.deps.store.getRunEnd(run.id);
        if (!end.ok) return unmeasured(branch, `cannot read end of run ${run.id}: ${end.error.code}`);
        runIds.set(run.id, end.value?.endedAt != null);
      }
    }
    const claimed = await this.claimRunsOnBranch(branch);
    if (!claimed.ok) return unmeasured(branch, claimed.error);
    let claimWithoutRun = false;
    for (const claimRun of claimed.value) {
      if (claimRun === null) {
        claimWithoutRun = true;
        continue;
      }
      if (runIds.has(claimRun)) continue;
      const end = await this.deps.store.getRunEnd(claimRun as RunId);
      if (!end.ok) return unmeasured(branch, `cannot read end of run ${claimRun}: ${end.error.code}`);
      runIds.set(claimRun, end.value?.endedAt != null);
    }
    const runs = [...runIds.keys()];
    const endedRuns = [...runIds.entries()].filter(([, ended]) => ended).map(([id]) => id);
    const live = [...runIds.entries()].filter(([, ended]) => !ended).map(([id]) => id);
    if (live.length > 0) {
      return { branch, runs, endedRuns, state: "live", reason: `branch ${branch} belongs to live run ${live.join(", ")}` };
    }
    if (claimWithoutRun) {
      return { branch, runs, endedRuns, state: "live", reason: `branch ${branch} has an open task claim with no run to prove it ended: treated as a live run` };
    }
    if (runs.length > 0) {
      return { branch, runs, endedRuns, state: "ended", reason: `branch ${branch} belongs to ended run ${runs.join(", ")}` };
    }
    return { branch, runs, state: "no-provable-owner", reason: `branch ${branch} maps to no run or claim: no provable owner` };
  }

  /** harness_run of every open task claim recording `branch` (null entry = a claim with no run). */
  private async claimRunsOnBranch(branch: string): Promise<{ readonly ok: true; readonly value: (string | null)[] } | { readonly ok: false; readonly error: string }> {
    const tasks = await this.deps.store.findMany({ type: "task" });
    if (!tasks.ok) return { ok: false, error: `cannot read task claims: ${tasks.error.code}` };
    const found: (string | null)[] = [];
    for (const task of tasks.value) {
      const claim = (task.extra as Record<string, unknown> | undefined)?.["claim"];
      if (claim === null || typeof claim !== "object") continue;
      const record = claim as Record<string, unknown>;
      if (record["worktree"] !== branch) continue;
      const run = record["harness_run"];
      found.push(typeof run === "string" && run !== "" ? run : null);
    }
    return { ok: true, value: found };
  }

  /** The tree of blob ids reachable from main, or null when main cannot be resolved. */
  private resolveMainRef(): string | null {
    const ref = this.deps.mainRef ?? "main";
    const resolved = this.deps.git(["rev-parse", "--verify", "-q", `${ref}^{commit}`]);
    return resolved.status === 0 ? ref : null;
  }

  private measureContainment(sha: string, mainRef: string | null): StashContainment {
    if (mainRef === null) return { tracked_in_main: false, untracked_in_main: false, measured: false };
    const tracked = this.trackedEntries(sha);
    const untracked = this.untrackedEntries(sha);
    if (tracked === null || untracked === null) return { tracked_in_main: false, untracked_in_main: false, measured: false };
    return {
      tracked_in_main: this.allInMain(mainRef, tracked),
      untracked_in_main: this.allInMain(mainRef, untracked),
      measured: true,
    };
  }

  /** (path, blob) of every path the stash changed vs its base; blob is null for a deletion. */
  private trackedEntries(sha: string): { path: string; blob: string | null }[] | null {
    const diff = this.deps.git(["diff-tree", "-r", "-z", "--no-renames", `${sha}^1`, sha]);
    if (diff.status !== 0) return null;
    const parts = diff.stdout.split("\0").filter((p) => p !== "");
    const entries: { path: string; blob: string | null }[] = [];
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const meta = (parts[i] ?? "").split(" "); // ":oldmode newmode oldsha newsha status"
      const newBlob = meta[3] ?? "";
      entries.push({ path: parts[i + 1] ?? "", blob: NULL_SHA.test(newBlob) ? null : newBlob });
    }
    return entries;
  }

  /** (path, blob) of the stash's untracked-files tree (`<sha>^3`); empty when the stash has none. */
  private untrackedEntries(sha: string): { path: string; blob: string | null }[] | null {
    const has = this.deps.git(["rev-parse", "--verify", "-q", `${sha}^3`]);
    if (has.status !== 0) return [];
    const tree = this.deps.git(["ls-tree", "-r", "-z", `${sha}^3`]);
    if (tree.status !== 0) return null;
    return tree.stdout
      .split("\0")
      .filter((r) => r !== "")
      .map((record) => {
        const [meta = "", path = ""] = record.split("\t"); // "<mode> blob <sha>\t<path>"
        return { path, blob: meta.split(" ")[2] ?? null };
      });
  }

  /** Blob equality against main: one `cat-file --batch-check` call for all paths. */
  private allInMain(mainRef: string, entries: readonly { path: string; blob: string | null }[]): boolean {
    if (entries.length === 0) return true;
    const checked = this.deps.git(["cat-file", "--batch-check"], entries.map((e) => `${mainRef}:${e.path}\n`).join(""));
    if (checked.status !== 0) return false;
    const lines = checked.stdout.split("\n");
    return entries.every((entry, i) => {
      const line = lines[i] ?? "";
      if (entry.blob === null) return line.endsWith(" missing");
      return line.startsWith(`${entry.blob} blob `);
    });
  }
}

/** Same directory, comparing resolved real paths when both exist (macOS /var vs /private/var). */
function samePath(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false; // reason: a recorded worktree that no longer exists cannot be proven equal to a live checkout
  }
}

function unmeasured(branch: string, why: string): StashAttribution {
  return { branch, runs: [], state: "unmeasured", reason: `ownership could not be measured (${why}): treated as unmeasured` };
}
