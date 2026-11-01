/**
 * IntegrateService — `lore integrate <branch>`: the one path by which a branch lands on main.
 *
 * Purpose: merge a branch onto the CURRENT main inside the session's own detached integration worktree, run the
 * project's post-merge floor on the merged tree, then advance `refs/heads/main` with a compare-and-swap
 * (`git update-ref refs/heads/main <new> <base>`). Git's own ref lock + old-value check refuses a lost race, so no
 * exclusivity is needed (adr-main-advances-only-by-lore-integrate-per-session, Option A; experiments E4, E8).
 * Landing record: after the CAS moved main, `deps.landings.record` writes `extra.landing` ({branch, branch_head,
 *   main_before, main_after, landing_commit}) on every task whose claim recorded the branch, so a task's commit range
 *   is a fact of its landing and a later re-claim cannot replace it (task-commit-range.ts). Never fails the landing.
 * Own-diff judgment (spec-a-branch-s-own-diff-is-judged-at-integrate-the-turn-end): before the integration worktree exists,
 *   `deps.ownDiff.judge(branch, tip)` judges the branch's own change (`git diff <merge-base(main, tip)> <tip>`) against its
 *   tasks and the other live claims; a refusal is `err(VALIDATION_ERROR, field "own-diff")`, exit 4, naming BR-1346/1347/1348,
 *   with nothing touched. A pass hands `outside_anchors` (own-change paths no task of the branch anchors) to the landing record.
 * Landing bookkeeping (spec-landing-does-the-bookkeeping-claims-start-from-main-parked), after main moved and the landing
 *   is recorded, never un-landing main and never failing the call: `deps.anchors.follow` rewrites the spec and knowledge
 *   anchors of the files the branch renamed (BR-1355), then `deps.completion.complete` runs the done walk for every task
 *   of the branch (BR-1356); each refusal is printed with its floor id and the command that satisfies it.
 * Public surface: IntegrateService.integrate, LandingRecorder, AnchorFollower, LandingCompleter, TaskCompletion, OwnDiffJudge, IntegrateOutcome, integrateExitCode, IntegrateRequest,
 *   IntegrateDeps, IntegrateGit, FloorRunner, CorpusSnapshotter, INTEGRATE_EXIT_BUSY, INTEGRATE_MARKER_ENV,
 *   integrationWorktreePath, SchemaMigration, runSchemaMigration, describeSchemaMigration.
 * Invariants:
 *   - Main moves ONLY by the CAS of an attempt whose merge passed the floor; every other outcome leaves main
 *     untouched and the integration worktree reset to the main it saw (nothing half-done: a conflict aborts the merge
 *     and resets, a failing floor resets, a lost race resets).
 *   - Landings are serialized FIFO in the repository's merge queue (integrate-queue.ts, AC-DCS2-5): the call takes a ticket,
 *     awaits its turn, then makes ONE attempt on the main that is now current, so the oracles run on the exact tree that becomes main
 *     and nothing retries. The compare-and-swap stays only as an assertion: a main that is not where the merge started
 *     (an update the hook should have refused) is outcome `main_moved` (exit 4, naming both commits, no retry). A wait past
 *     `workflow.integrate.queue_wait_seconds` is outcome `queue_timeout` (exit 75).
 *   - Re-running after a crash past the CAS is a no-op: `merge-base --is-ancestor <tip> main` is checked at the start
 *     of the attempt (`already_integrated`), and clears the branch's stale entry of the retired loss ledger (history only).
 *   - The floor command is project config with NO default: absent -> err(VALIDATION_ERROR) before anything is touched.
 *   - The CAS runs with `LORE_INTEGRATE=1` in its environment: the marker a reference-transaction hook (INT-T2)
 *     uses to tell this verb's update of main from any other.
 *   - The integration worktree holds nothing that is not in refs (it is detached, reset on every attempt), so a
 *     crash before the CAS leaves no state that matters; the next call resets it.
 *   - Conflicts are NEVER resolved here: outcome `conflict` names the paths (exit 4); the session resolves in its own
 *     worktree and re-runs.
 *   - One run at a time per integration worktree: after the worktree exists and before any merge or snapshot the run
 *     takes the worktree's lease (IntegrationLease: an OS lock tied to the process, so a killed run frees it with no
 *     cleanup). A second run of the same session gets outcome `busy` (exit 75) naming the holder's pid, branch and start.
 *     The lease is taken BEFORE the queue ticket, so a second run in one worktree is refused at once instead of queueing behind itself.
 *   - Everything that reads main or the remote (fetch, tip resolution, the own-diff judgment, the oracle selection) runs after the
 *     turn begins, so it judges the main this landing will merge onto.
 * Side-effect class: IO (git subprocesses through the injected IntegrateGit, the floor through FloorRunner, the loss
 *   ledger's files, creation of one worktree directory, the lease).
 *
 * Before anything moves (after the request's own fields are validated, before the first git side effect: the
 * remote-tracking fetch, the integration worktree and every merge):
 *   - the main-ref guard must be in force (spec-no-working-copy-can-check-out-main-the-main-ref-guard, BR-1343): the
 *     `reference-transaction` hook in the ACTIVE hooks directory (`git rev-parse --git-path hooks`, so `core.hooksPath`
 *     is honoured) is byte-identical to the shipped asset (sha256 against EMBEDDED_ASSETS_MANIFEST) and executable, and
 *     git is >= 2.46 (read through `deps.readGitVersion`, default `git --version`). Otherwise
 *     `err(VALIDATION_ERROR, field "main-ref-guard")`, exit 4, naming `lore setup --project` or the version. This
 *     replaces the old per-run scan for worktrees on main and the shared-checkout detach: the hook makes a checkout of
 *     main impossible, so there is nothing left to scan or detach;
 * Then a remote-tracking argument (`origin/main`: its first segment names a configured remote) is fetched and is merged
 * with fast-forward allowed, so inbound commits land as the remote's own commits when main has not diverged.
 * The reference-transaction hook ships as assets/project/reference-transaction and is installed by `lore setup
 * --project` (which also detaches every working copy that has main checked out); it recognises INTEGRATE_MARKER_ENV on
 * the CAS, and the marker is set ONLY on that CAS `update-ref`.
 *
 * The floor's corpus (INT-T12): just before the floor runs, `deps.corpus.take` writes a consistent snapshot (VACUUM INTO)
 * of the shared corpus into `<integration worktree>/.lore/`; `remove` deletes it right after the floor. One line
 * `integrate: floor runs against a corpus snapshot taken <iso ts>` is logged per attempt. Since 5f0259a1 NO command
 * upgrades a corpus implicitly (an older corpus is refused, exit 4; only `lore migrate schema` upgrades), so the snapshot
 * is never migrated by merely opening it. Two explicit steps run the project's `workflow.integrate.migrate_command` (the
 * BRANCH binary's `lore migrate schema`, `--json` appended; see `runSchemaMigration`):
 *   - `IntegrateService.landOn`, right after `corpus.take` and before the floor, runs it in the integration worktree, so it
 *     migrates the SNAPSHOT (cwd owns `.lore/lore.db`) and never the live corpus. A failure ends the attempt as outcome
 *     `snapshot_migrate_failed` (exit 1): the snapshot is removed, the worktree reset, main untouched, the output names the
 *     snapshot directory and carries the migrate output;
 *   - `IntegrateService.migrateLiveCorpus`, after the CAS, the landing record, the shared-view refresh and the
 *     post-refresh rebuild (so the binary it runs is main's), runs the same command once in the shared checkout under the
 *     integration lease and reports `schema: <from> -> <to>` or `schema: already current`. Only when the view was
 *     `refreshed` and the rebuild did not fail (otherwise the binary is not main's: `skipped`, naming the command to rerun).
 *     A failure is outcome field `schema.state = failed` (exit 1): it names the corpus and the exact command to rerun,
 *     and never un-lands main. `already_integrated` runs it too (idempotent), so a re-run after a failed migrate repairs.
 * Unset `migrate_command` = both steps are skipped and reported as such, never silently.
 *
 * After the shared view is `refreshed` (INT-T11), `workflow.integrate.post_refresh_command` (this repo: `bun run
 * build`) runs in the shared checkout so its build artifacts (dist/lore, which ~/.local/bin/lore links to) match main.
 * Decision, (a) project config command in the view vs (b) install the floor's artifact from the integration worktree:
 * (a) chosen. The floor here is `check:floor` (checks, not a build) so (b) would still need a second build, and it would
 * need a per-project "which artifacts, copied where" key plus knowledge of the build's layout; (a) is one command the
 * project already owns, builds exactly once per landing (the floor does not build the shipped binary), and a build
 * writes only untracked/ignored output. Tracked changes left by the build are measured (`git status --untracked-files=no`)
 * and reported, never reverted. Outcome `rebuild`: rebuilt | rebuild_failed <exit> | skipped <reason> (key unset, or the
 * view was not `refreshed`); a failed rebuild is reported only: main has already moved and is never un-landed.
 *
 * Source: spec-main-advances-only-through-lore-integrate-per-session AC-INT-1, AC-INT-2, BR-1245, BR-1246.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { err, ok, prefixRunExport, type LoreError, type Result, type RunId } from "@lore/core";
import { z } from "zod";
import type { IntegrateLossLedger } from "./integrate-loss-ledger.js";
import { IntegrateQueueTimeoutError, IntegrateQueueUnreadableError, type IntegrateQueuePort, type QueueHolder } from "./integrate-queue.js";
import type { AttemptRecord, IntegrateAttemptLedger } from "./integrate-attempt-ledger.js";
import type { BoundProseRow, OwnDiffRename, OwnDiffVerdict } from "./own-diff-judgment.js";
import type { LandingFact, LandingRequest } from "./task-commit-range.js";
import { decideStampOutcome, probeGitState } from "./git-state-stamp.js";
import type { LandingOracles, LandingTask, OracleOutcome, OracleProof, OracleSettings } from "./integrate-oracle-service.js";
import { EMBEDDED_ASSETS_MANIFEST } from "../generated/assets-manifest.js";
import { GIT_UPGRADE_HINT, MIN_GIT_FOR_MAIN_REF_HOOK, parseGitVersion } from "../flows/setup-project-flow.js";

/** Exit code of the "busy, try later" class (U9): a queue timeout and a second run in one integration worktree. EX_TEMPFAIL, no verdict on the work. */
export const INTEGRATE_EXIT_BUSY = 75;

/** The environment marker present on the CAS (and only on it); the main-ref hook of INT-T2 keys on it. */
export const INTEGRATE_MARKER_ENV = "LORE_INTEGRATE";

/** The branch integrations land on. */
const TARGET_REF = "refs/heads/main";
const TARGET_NAME = "main";
/** The guard hook: its filename in the hooks directory, and its path in the embedded asset manifest. */
const MAIN_REF_HOOK_NAME = "reference-transaction";
const MAIN_REF_HOOK_ASSET_PATH = "project/reference-transaction";

/** How much of a failing floor's output the outcome carries: sized so the failed steps' re-printed blocks (run-chain prints them last, up to 2500 chars each) always fit. */
export const FLOOR_TAIL_CHARS = 12000;

/** Raw outcome of one git call; never thrown. */
export interface GitOutcome {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs `git <args>` in `cwd` (with `env` merged over the process environment); never throws. */
export type IntegrateGit = (cwd: string, args: readonly string[], env?: Readonly<Record<string, string>>) => GitOutcome;

/** One floor step's wall time, from the run-chain machine-readable timings (never parsed from prose). */
export interface FloorStepTiming {
  readonly step: string;
  readonly exit: number;
  readonly ms: number;
}

/** Name of the single step a floor is recorded as when its command emitted no per-step timings (a custom floor_command). */
export const FLOOR_UNTIMED_STEP = "floor (no per-step timings emitted)";

/**
 * Runs the floor shell command in `cwd`; `output` is stdout+stderr merged. Never throws. `steps` are the per-step
 * timings the floor command emitted (scripts/run-chain.ts via LORE_FLOOR_TIMINGS_FILE); absent = the command emitted none.
 */
export type FloorRunner = (command: string, cwd: string) => { readonly status: number; readonly output: string; readonly steps?: readonly FloorStepTiming[] };

/**
 * Gives the integration worktree a private copy of the shared corpus for the floor (INT-T12) and takes it away again.
 * `take` returns the ISO instant of the snapshot; `remove` deletes it. Neither ever writes the shared corpus.
 */
export interface CorpusSnapshotter {
  readonly take: (integrationWorktree: string) => Result<{ readonly takenAt: string }, LoreError>;
  readonly remove: (integrationWorktree: string) => Result<void, LoreError>;
}

/** Who holds an integration worktree's lease: written by the holder once it owns the lock, read by a refused second run. */
export interface LeaseHolder {
  readonly pid: number;
  readonly branch: string;
  /** ISO-8601 instant the holder started. */
  readonly started_at: string;
}

/** `held` = this run owns the lease until `release()`; `busy` = another live run does (`holder` names it; `undefined` = it had not recorded itself yet). */
export type LeaseGrant =
  | { readonly kind: "held"; readonly release: () => void }
  | { readonly kind: "busy"; readonly holder: LeaseHolder | undefined };

/**
 * The exclusive lease one integration worktree has while a run uses it. The implementation MUST be an OS-level lock
 * tied to the process (released by the kernel when the process dies, however it dies): a crashed run needs no cleanup.
 * `lockDir` is a directory belonging to that worktree; `acquire` never blocks.
 */
export interface IntegrationLease {
  readonly acquire: (lockDir: string, holder: LeaseHolder) => Result<LeaseGrant, LoreError>;
}

/**
 * Records a landing on every task whose claim (current or historical) recorded the landed branch. Resolves to the slugs
 * written. Wired by the CLI to `TaskWorkflowService.recordLanding` (the corpus write route); a failure never un-lands main.
 */
export interface LandingRecorder {
  readonly record: (landing: LandingRequest) => Promise<Result<readonly string[], LoreError>>;
}

/**
 * Rewrites the code anchors of spec and knowledge docs that name a file the landed branch renamed (BR-1355). Resolves
 * to the slugs of the documents rewritten. Wired by the CLI to `DriftCheckService.followMovedFiles`; a failure never
 * un-lands main.
 */
export interface AnchorFollower {
  readonly follow: (moves: readonly OwnDiffRename[], landing: { readonly branch: string; readonly landing_commit: string }) => Promise<Result<readonly string[], LoreError>>;
}

/** What the done walk did for one task of a landed branch: archived, or refused (with the floor that refused, when it was one). */
export type TaskCompletion =
  | { readonly task: string; readonly outcome: "archived" }
  | { readonly task: string; readonly outcome: "refused"; readonly floor?: string; readonly message: string };

/**
 * Runs the done walk for each of `tasks` (BR-1356). Wired by the CLI to `TaskWorkflowService.done`; one completion per
 * task, in order; a refusal is a value, never a throw, and never touches main.
 */
export interface LandingCompleter {
  readonly complete: (tasks: readonly string[]) => Promise<readonly TaskCompletion[]>;
}

/**
 * Starts the post-landing review batch (BR-1379, AC-PCR-3, BR-1532). Wired by the CLI to `ReviewTriggerService.start`: it computes
 * the trigger set from stored plan progress and, when non-empty, takes the machine's `batch:<machine>` lease atomically and
 * spawns ONE detached batch holding it on the child's behalf, returning at once (`started`); when another live holder has
 * the lease it starts nothing (`covered`: that batch re-reads the trigger set after it releases, so it picks the landing's
 * plans up). A failure is a WARNING line, never a failed landing; the landing carries no review time.
 */
export interface ReviewBatchStarter {
  readonly start: () => Promise<Result<ReviewBatchStartOutcome, LoreError>>;
}

/** What {@link ReviewBatchStarter.start} did. */
export interface ReviewBatchStartOutcome {
  readonly state: "empty" | "started" | "covered";
  readonly triggered?: number;
  readonly pid?: number | undefined;
  /** The batch lease key (`batch:<machine>`), on `started` and `covered`. */
  readonly key?: string;
  /** True when the key is the shared `batch:unknown` (this process has no machine identity, BR-1514). */
  readonly machineUnknown?: boolean;
  /** Who holds the key, on `covered`. */
  readonly holder?: string;
}

/**
 * The one line `lore integrate` prints for the post-landing review batch: `started` names the plan count and pid, `covered`
 * says the running batch (and its lease key and holder) will pick the landing's plans up, an unknown machine identity names the
 * shared `batch:unknown` key (BR-1514, BR-1532).
 */
export function describeBatchStart(outcome: ReviewBatchStartOutcome): string {
  if (outcome.state === "empty") return "integrate: review batch: no plan needs review";
  const unknown = outcome.machineUnknown === true ? `; machine identity unreadable, so the lease key is the shared ${outcome.key ?? "batch:unknown"}` : "";
  if (outcome.state === "covered") {
    return `integrate: review batch: the running batch (${outcome.key ?? "batch"} held by ${outcome.holder ?? "another process"}) covers this landing; it re-reads the trigger set when it finishes and will review ${String(outcome.triggered)} plan(s)${unknown}`;
  }
  return `integrate: review batch started for ${String(outcome.triggered)} plan(s)${outcome.pid !== undefined ? ` (pid ${String(outcome.pid)})` : ""}; the landing does not wait for it${unknown}`;
}

/** Judges a branch's own change before it lands (BR-1346, BR-1347, BR-1348, BR-1355); `OwnDiffJudgment` implements it. Reads, never writes. */
export interface OwnDiffJudge {
  readonly judge: (branch: string, tip: string) => Promise<Result<OwnDiffVerdict, LoreError>>;
}

/** What the own-diff judgment hands the landing: the footprint to record and the renames anchors must follow. */
interface JudgedChange {
  readonly footprint: Pick<LandingFact, "outside_anchors">;
  readonly renames: readonly OwnDiffRename[];
}

/** One output line per changed file with bound prose: `integrate: prose bound to <path>: <document[:line]> (<reference>), ...`. */
function renderBoundProseLines(rows: readonly BoundProseRow[]): string[] {
  return rows.map((row) => {
    const bindings = row.bindings.map((b) => `${b.line === undefined ? b.document : `${b.document}:${b.line}`} (${b.reference})`);
    return `integrate: prose bound to ${row.path}: ${bindings.join(", ")}`;
  });
}

export interface IntegrateDeps {
  readonly git: IntegrateGit;
  /** One run at a time per integration worktree: a second run for the same session is refused (outcome `busy`, exit 75). */
  readonly lease: IntegrationLease;
  /** The running process's pid, recorded as the lease holder (default `process.pid`). */
  readonly pid?: number;
  /** Landing records (`extra.landing` on the branch's tasks). Absent in a bare construction: nothing is recorded. */
  readonly landings?: LandingRecorder;
  /** Anchors follow renamed files after the landing (BR-1355). Absent in a bare construction: none are rewritten. */
  readonly anchors?: AnchorFollower;
  /** The done walk after the landing (BR-1356). Absent in a bare construction: no task is archived by the landing. */
  readonly completion?: LandingCompleter;
  /** Starts the detached review batch after a landing (BR-1379). Absent in a bare construction: no batch is started. */
  readonly reviewBatch?: ReviewBatchStarter;
  /** The own-diff judgment run before the floor. Absent in a bare construction: the branch is not judged. */
  readonly ownDiff?: OwnDiffJudge;
  /**
   * Selects the landing tasks, runs the union of their contract oracles on the merged tree before main moves, and records the rows
   * after (AC-DCS2-1 to AC-DCS2-4). Absent in a bare construction: no oracle runs and no row is recorded. When present, the request
   * must carry {@link IntegrateRequest.oracleSettings}.
   */
  readonly oracles?: LandingOracles;
  /** Floor corpus: the floor reads a snapshot of the shared corpus inside the integration worktree, never the live one. */
  readonly corpus: CorpusSnapshotter;
  readonly runFloor: FloorRunner;
  /** The retired loss ledger: read-only history; a landed branch's old entry is cleared, nothing new is written (AC-DCS2-5). */
  readonly ledger: IntegrateLossLedger;
  /** The FIFO merge queue every landing takes its turn in (AC-DCS2-5). */
  readonly queue: IntegrateQueuePort;
  /** Per-attempt phase durations, kept per branch and NOT cleared on landing (see integrate-attempt-ledger.ts). */
  readonly attempts: IntegrateAttemptLedger;
  /**
   * The installed git's `git --version` line (default: `git --version` run through `deps.git` in `projectRoot`);
   * injected so a test can report an old git without a second git on the machine.
   */
  readonly readGitVersion?: () => string;
  /** Wall clock in epoch milliseconds (default `Date.now`); injected so tests assert exact durations. */
  readonly clock?: () => number;
  /** The main checkout's root: the repo whose refs main lives in (git commands run here). */
  readonly projectRoot: string;
  /**
   * The oldest commit of `ref`'s first-parent history that contains `commit` (the merge that brought it in), `undefined` when none:
   * the adapters' `findFirstParentCommitContaining`, injected. Used only for a branch found ALREADY in main (D44). Absent in a bare
   * construction: landing such a branch is then refused, never guessed.
   */
  readonly firstParentContaining?: (commit: string, ref: string) => Result<string | undefined, LoreError>;
  /** Directory under which integration worktrees are created (`<main checkout>/.claude/worktrees`). */
  readonly worktreesRoot: string;
  /** Progress lines (attempts, lost races); the CLI wires stdout. */
  readonly log: (line: string) => void;
}

export interface IntegrateRequest {
  /** The branch (or any rev) to integrate, as typed. */
  readonly branch: string;
  /** The caller's session id: names the integration worktree. */
  readonly sessionId: string;
  /** `workflow.integrate.floor_command`; `undefined` = not configured. */
  readonly floorCommand: string | undefined;
  /** `workflow.integrate.post_refresh_command`; `undefined` = not configured (the rebuild is reported skipped). */
  readonly postRefreshCommand?: string | undefined;
  /** `workflow.integrate.migrate_command`: the branch binary's `lore migrate schema` (see the file header); `undefined` = not configured (both migrate steps are reported skipped). */
  readonly migrateCommand?: string | undefined;
  /**
   * The CALLER's attested run: the party the migrate child of both migrate steps runs as (the run is exported as LORE_HARNESS_RUN
   * to `migrate_command`), so its `migrate_schema` audit row names the caller and the child is not refused as a run-less
   * write. Required whenever `migrateCommand` is set; absent (or not a plain run id) then = integrate is refused before
   * anything moves.
   */
  readonly harnessRun?: string | undefined;
  /** Merge commit message; default `merge(<branch>): <tip subject>`. */
  readonly message?: string;
  /**
   * The integrate-time oracle settings of the CURRENT config (install command, per-oracle timeout, floor-covered ids) and who the rows
   * are recorded for. Required whenever the service was built with `oracles`; absent then = refused before anything moves (never a default).
   */
  readonly oracleSettings?: OracleSettings;
}

/**
 * Result of one `lore migrate schema` run (the integrate steps of the file header): `migrated` (from -> to), `current`
 * (already at `version`), `failed` (exit status + output tail, the `corpus` it was run against and the exact `command`
 * to rerun), `skipped` (`reason`).
 */
export type SchemaMigration =
  | { readonly state: "migrated"; readonly from: number; readonly to: number }
  | { readonly state: "current"; readonly version: number }
  | { readonly state: "failed"; readonly exit_status: number; readonly output_tail: string; readonly corpus: string; readonly command: string }
  | { readonly state: "skipped"; readonly reason: string };

/** The `--json` report of `lore migrate schema` (src/adapters/cli/migrate-schema.ts): the only fields read. */
const MigrateSchemaReportSchema = z.object({ ok: z.literal(true), data: z.object({ upgraded: z.boolean(), from: z.number().int(), to: z.number().int() }) });

/**
 * What happened to the shared checkout's read-only view of main after main moved (INT-T6): `refreshed` = it now sits at
 * main; `kept_dirty` = git refused because an uncommitted edit of `paths` would be overwritten, nothing was touched;
 * `not_measured` = the view was not eligible or git failed for another reason (`reason` says which), nothing was touched.
 */
export type SharedViewRefresh =
  | { readonly state: "refreshed" }
  | { readonly state: "kept_dirty"; readonly paths: readonly string[] }
  | { readonly state: "not_measured"; readonly reason: string };

/**
 * What happened to the shared checkout's build artifacts (INT-T11): `rebuilt` (with `tracked_changes` when the build
 * left tracked files modified), `rebuild_failed` (the command's exit status; main stays landed), or `skipped` (`reason`).
 */
export type SharedViewRebuild =
  | { readonly state: "rebuilt"; readonly tracked_changes?: readonly string[] }
  | { readonly state: "rebuild_failed"; readonly exit_status: number; readonly output_tail: string }
  | { readonly state: "skipped"; readonly reason: string };

export type IntegrateOutcome =
  | { readonly kind: "landed"; readonly branch: string; readonly sha: string; readonly base: string; readonly worktree: string; readonly shared_view: SharedViewRefresh; readonly rebuild: SharedViewRebuild; readonly schema: SchemaMigration }
  | { readonly kind: "already_integrated"; readonly branch: string; readonly main: string; readonly shared_view: SharedViewRefresh; readonly rebuild: SharedViewRebuild; readonly schema: SchemaMigration }
  | { readonly kind: "snapshot_migrate_failed"; readonly branch: string; readonly snapshot: string; readonly exit_status: number; readonly output_tail: string; readonly command: string }
  | { readonly kind: "floor_failed"; readonly branch: string; readonly exit_status: number; readonly output_tail: string }
  | { readonly kind: "conflict"; readonly branch: string; readonly paths: readonly string[] }
  | { readonly kind: "busy"; readonly branch: string; readonly worktree: string; readonly holder: LeaseHolder | undefined }
  /** `integrate-queue-timeout` (U9, exit 75): the queue head did not finish within `workflow.integrate.queue_wait_seconds`. */
  | { readonly kind: "queue_timeout"; readonly branch: string; readonly holder: QueueHolder | undefined; readonly waited_seconds: number; readonly limit_seconds: number }
  /** `integrate-main-moved` (U8/U9, exit 4): main is not where the merge started; main moves only through integrate, so this is a bypassed guard. */
  | { readonly kind: "main_moved"; readonly branch: string; readonly expected: string; readonly actual: string; readonly moved_by: readonly string[] };

/** Process exit code of an outcome: 0 landed / already integrated, 1 floor failed, 4 conflict or main moved, 75 busy or queue timeout. */
export function integrateExitCode(outcome: IntegrateOutcome): number {
  switch (outcome.kind) {
    case "landed":
    case "already_integrated":
      // a failed live migrate leaves main landed but the corpus behind: loud (exit 1), and the re-run is an idempotent repair
      return outcome.schema.state === "failed" ? 1 : 0;
    case "floor_failed":
    case "snapshot_migrate_failed":
      return 1;
    case "conflict":
    case "main_moved":
      return 4;
    case "queue_timeout":
    case "busy":
      return INTEGRATE_EXIT_BUSY;
    default: {
      const unreachable: never = outcome;
      return unreachable;
    }
  }
}

/**
 * Deterministic integration-worktree path of one session: `<worktreesRoot>/integrate-<session id>`, the id reduced to
 * `[A-Za-z0-9_-]` (full length kept, so two sessions never share a tree).
 */
export function integrationWorktreePath(worktreesRoot: string, sessionId: string): string {
  return join(worktreesRoot, `integrate-${sessionId.replace(/[^A-Za-z0-9_-]/g, "-")}`);
}

function gitFailure(what: string, outcome: GitOutcome): LoreError {
  return { code: "STORE_ERROR", message: `integrate: ${what} failed (git exit ${outcome.status}): ${(outcome.stderr || outcome.stdout).trim()}` };
}

function short(sha: string): string {
  return sha.slice(0, 12);
}

/** The phase line printed (and recorded) per attempt: `-` marks a phase the attempt never reached. */
export function renderAttemptPhases(record: AttemptRecord): string {
  const ms = (v: number | null): string => (v === null ? "-" : `${v}ms`);
  const floor =
    record.floor === null ? "-" : `${record.floor.total_ms}ms (${record.floor.steps.map((st) => `${st.step} ${st.ms}ms`).join(", ")})`;
  return (
    `integrate: attempt ${record.attempt} phases: merge ${record.merge_ms}ms | corpus-snapshot ${ms(record.corpus_snapshot_ms)} | ` +
    `floor ${floor} | cas ${ms(record.cas_ms)} | total ${record.total_ms}ms -> ${record.outcome}`
  );
}

export class IntegrateService {
  constructor(private readonly deps: IntegrateDeps) {}

  /** The settings of the one call this instance serves (set by `integrate`, read by `recordOracleRows`); an instance is single-use per command. */
  private oracleSettings: OracleSettings | undefined;

  /**
   * Lands `request.branch` on main, or reports exactly why it did not. While another run of the same session is live
   * the outcome is `busy` (exit 75, naming the holder), decided before any merge or snapshot.
   *
   * @returns ok(outcome) for every defined outcome (landed, already integrated, floor failed, conflict, lost races —
   *   map with {@link integrateExitCode}); err for a refused request (missing floor key, unknown branch, empty session)
   *   or a git/filesystem failure.
   */
  async integrate(request: IntegrateRequest): Promise<Result<IntegrateOutcome, LoreError>> {
    const { git, projectRoot, ledger, log } = this.deps;
    const clock = this.deps.clock ?? Date.now;
    if (request.sessionId.trim() === "") {
      return err({ code: "VALIDATION_ERROR", field: "session", message: "lore integrate needs the caller's session id: pass --session <id> or set CLAUDE_CODE_SESSION_ID", rule: "BR-1272" });
    }
    if (request.floorCommand === undefined || request.floorCommand.trim() === "") {
      return err({
        code: "VALIDATION_ERROR",
        field: "workflow.integrate.floor_command",
        message:
          "workflow.integrate.floor_command is not set in .lore/config.yaml (or the file failed to parse): lore integrate will not advance main on a tree whose floor was never named",
        rule: "BR-1272",
      });
    }
    if (this.deps.oracles !== undefined && request.oracleSettings === undefined) {
      return err({
        code: "VALIDATION_ERROR",
        field: "oracleSettings",
        message: "lore integrate was built to run the landing's contract oracles but the request carries no oracle settings (install command, timeout, floor_covers): nothing was integrated",
      });
    }
    this.oracleSettings = request.oracleSettings;
    const migrating = request.migrateCommand !== undefined && request.migrateCommand.trim() !== "";
    if (migrating && !isChildRunId(request.harnessRun)) {
      // reason: the migrate child is a write made by the caller's party; with no attested run to hand it, it would be refused
      // mid-integration (after the snapshot). Refused here instead, before any git side effect, with nothing changed.
      return err({
        code: "VALIDATION_ERROR",
        field: "identity",
        message:
          "lore integrate runs workflow.integrate.migrate_command as the caller's party, and this invocation has no attested agent run " +
          "(or its run id is not a plain run id) to hand it: nothing was integrated. Run it from an agent run the integration registered (`lore setup`).",
      });
    }
    // reason: first of every git side effect. BR-1273 refuses "before anything moves, with nothing changed", and a fetch
    // moves refs/remotes/*; the guard check only reads, so a refused run leaves every ref as it found it.
    const guarded = this.requireMainRefGuard();
    if (!guarded.ok) return guarded;
    // reason: read-only refusals stay ahead of every side effect (the worktree, the lease, the ticket): remotes that cannot be listed, and a
    // local branch that does not exist. A remote-tracking argument is resolved only after the fetch, inside the turn.
    const remote = this.remoteOf(request.branch);
    if (!remote.ok) return remote;
    if (remote.value === undefined) {
      const known = this.resolveCommit(request.branch);
      if (!known.ok) return known;
    }

    const worktree = this.ensureWorktree(request.sessionId);
    if (!worktree.ok) return worktree;
    const wt = worktree.value;

    // one run at a time per integration worktree: a second run would re-take the corpus snapshot under the first floor.
    // reason: taken BEFORE the queue ticket, so a second run of one session is refused at once instead of queueing behind itself.
    const gitDir = git(wt, ["rev-parse", "--path-format=absolute", "--git-dir"]);
    if (gitDir.status !== 0) return err(gitFailure("locating the git dir of the integration worktree", gitDir));
    const granted = this.deps.lease.acquire(gitDir.stdout.trim(), { pid: this.deps.pid ?? process.pid, branch: request.branch, started_at: new Date(clock()).toISOString() });
    if (!granted.ok) return granted;
    if (granted.value.kind === "busy") return ok({ kind: "busy", branch: request.branch, worktree: wt, holder: granted.value.holder });
    try {
      return await this.landInTurn(request, request.floorCommand, wt);
    } finally {
      /** @lore-site BR-1312 */
      granted.value.release();
    }
  }

  /**
   * Takes a ticket in the merge queue, waits for the turn, then lands. Everything that reads main or the remote runs inside the
   * turn: the fetch, the tip, the own-diff judgment (BR-1346..1348: before any merge or snapshot, a refusal leaves main and every
   * tree unchanged) and the one attempt.
   */
  private async landInTurn(request: IntegrateRequest, floorCommand: string, wt: string): Promise<Result<IntegrateOutcome, LoreError>> {
    const ticket = await this.queue.take({ session: request.sessionId, branch: request.branch }).catch((cause: unknown) => cause as Error);
    if (ticket instanceof Error) return this.queueFailure(request.branch, ticket);
    try {
      try {
        await this.queue.waitForTurn(ticket);
      } catch (cause) {
        return this.queueFailure(request.branch, cause);
      }
      const fetched = this.fetchRemoteTracking(request.branch);
      if (!fetched.ok) return fetched;
      const tipResult = this.resolveCommit(request.branch);
      if (!tipResult.ok) return tipResult;
      const tip = tipResult.value;
      const footprint = await this.judgeOwnDiff(request.branch, tip);
      if (!footprint.ok) return footprint;
      return await this.landOn(request, floorCommand, tip, wt, footprint.value);
    } finally {
      this.deps.queue.release(ticket);
    }
  }

  /** The queue's two failures as values: a timeout is outcome `queue_timeout` (exit 75); an unreadable queue is a loud error. */
  private queueFailure(branch: string, cause: unknown): Result<IntegrateOutcome, LoreError> {
    if (cause instanceof IntegrateQueueTimeoutError) {
      return ok({ kind: "queue_timeout", branch, holder: cause.holder, waited_seconds: cause.waitedSeconds, limit_seconds: cause.limitSeconds });
    }
    if (cause instanceof IntegrateQueueUnreadableError) return err({ code: "STORE_ERROR", message: cause.message });
    throw cause;
  }

  private get queue(): IntegrateQueuePort {
    return this.deps.queue;
  }

  /** The one attempt, run while this process holds the integration worktree's lease AND the head of the merge queue. */
  private async landOn(
    request: IntegrateRequest,
    floorCommand: string,
    tip: string,
    wt: string,
    judged: JudgedChange,
  ): Promise<Result<IntegrateOutcome, LoreError>> {
    const footprint = judged.footprint;
    const { git, projectRoot, ledger, log } = this.deps;
    const clock = this.deps.clock ?? Date.now;
    const remoteOfBranch = this.remoteOf(request.branch);
    if (!remoteOfBranch.ok) return remoteOfBranch;
    const fromRemote = remoteOfBranch.value !== undefined;
    const message = request.message ?? this.defaultMessage(request.branch, tip);
    const oraclePort = this.deps.oracles;
    const settings = this.oracleSettings;
    // reason: the turn is ours (landInTurn awaited it), so main is where this landing will merge onto and nothing but a bypassed guard moves it.
    const base = this.resolveCommit(TARGET_REF);
    if (!base.ok) return base;
    const alreadyInMain = git(projectRoot, ["merge-base", "--is-ancestor", tip, base.value]).status === 0;
    // reason: D44 — a branch already in main is placed on main's history first: the commit that brought it in and its first parent are
    // the landing's range, and "main before the landing" for the selection below is that first parent, never main's tip.
    const placed = alreadyInMain ? this.placeLandingOnMain(tip) : undefined;
    if (placed !== undefined && !placed.ok) return await this.placementRefusal(request.branch, tip, base.value, placed.error);
    const mainBeforeLanding = placed === undefined ? base.value : placed.value.main_before;
    // reason: ONE selection rule per landing (AC-DCS2-1), read before any attempt: it depends on refs and claims, not on the merge.
    let selection: readonly LandingTask[] = [];
    if (oraclePort !== undefined) {
      const selected = await oraclePort.select(request.branch, tip, mainBeforeLanding);
      if (!selected.ok) return selected;
      selection = selected.value;
      if (selection.length === 0) log(`integrate: the landing of ${request.branch} names no task whose oracles integrate runs`);
    }
    // reason: with the oracle port wired the landing is recorded on exactly the selected tasks (a task whose work tip the branch does not
    // contain, a draft, a check and a corpus task are not landed by this branch).
    const onlySelected = oraclePort === undefined ? {} : { only: selection.map((task) => task.slug) };

    if (placed !== undefined && placed.ok) {
      // reason: AC-DCS2-1 — a branch already in main has no merge to prove: the union runs once on main's tip T, the rows bind to T, and
      // only the tasks whose rows were recorded in THIS run are walked to done (an older hand-recorded row never archives one).
      let proven: OracleProof | undefined;
      if (oraclePort !== undefined && settings !== undefined && selection.length > 0) {
        const onTip = this.resetWorktree(wt, base.value);
        if (!onTip.ok) return onTip;
        const run = await oraclePort.prove({ branch: request.branch, tip, tasks: selection, worktree: wt, commit: base.value, base: base.value, floor: undefined, settings, runCommand: this.deps.runFloor, log, clock, nowIso: new Date(clock()).toISOString() });
        if (!run.ok) return run;
        proven = run.value;
        // reason: D44 — the rows ran on T (head_sha) but belong to the landing that brought the branch in (recorded_at_landing).
        await this.recordOracleRows(proven.tasks, base.value, proven.outcomes, placed.value.landing_commit);
      }
      // reason: BR-1336 — an already-integrated branch still records a landing on every selected task that holds none for this head
      // (the recorder skips tasks that already carry one). Main did not move by this call, so main_after is main's tip.
      // reason: D44 (AC-DCS2-2, BR-1496, BR-1508) — the landing is the commit that really brought the branch into main (the earliest
      // first-parent commit containing the tip) and its range starts at that commit's first parent, never main's tip: the milestone
      // review attributes ranges and regressions by landing_commit. The oracle rows stay bound to T, the tip they ran on.
      const landedAt = placed.value.landing_commit;
      const claimants = await this.recordLanding({ branch: request.branch, branch_head: tip, main_before: placed.value.main_before, main_after: base.value, landing_commit: landedAt, ...onlySelected });
      const provenSlugs = new Set((proven?.tasks ?? []).map((task) => task.slug));
      const walked = oraclePort === undefined ? claimants : claimants.filter((slug) => provenSlugs.has(slug));
      // reason: the shared checkout moves to main BEFORE the done walk, so the walk's `git branch -d` finds the branch merged into HEAD.
      const view = this.refreshSharedView();
      await this.completeLanding(walked, [], { branch: request.branch, landing_commit: landedAt });
      const cleared = ledger.clear(request.branch);
      if (!cleared.ok) return cleared;
      const rebuild = this.rebuildSharedView(view, request.postRefreshCommand);
      return ok({ kind: "already_integrated", branch: request.branch, main: base.value, shared_view: view, rebuild, schema: this.migrateLiveCorpus(view, rebuild, request.migrateCommand, request.harnessRun) });
    }
    log(`integrate: ${request.branch} on ${short(base.value)}`);
    const attemptStart = clock();
    const startedAt = new Date(attemptStart).toISOString();
    const finish = (phases: Pick<AttemptRecord, "outcome" | "merge_ms" | "corpus_snapshot_ms" | "floor" | "cas_ms">): void =>
      this.recordAttempt(request.branch, { attempt: 1, base: base.value, started_at: startedAt, total_ms: clock() - attemptStart, ...phases });

    const reset = this.resetWorktree(wt, base.value);
    if (!reset.ok) return reset;
    // an upstream ref may fast-forward (the remote's commits land as they are); a local branch always gets its own merge commit
    const mergeStart = clock();
    const merged = git(wt, ["merge", fromRemote ? "--ff" : "--no-ff", "-m", message, tip], { GIT_MERGE_AUTOEDIT: "no" });
    const mergeMs = clock() - mergeStart;
    if (merged.status !== 0) {
      const conflicted = this.afterFailedMerge(request.branch, wt, base.value, merged);
      if (conflicted.ok) finish({ outcome: "conflict", merge_ms: mergeMs, corpus_snapshot_ms: null, floor: null, cas_ms: null });
      return conflicted;
    }

    this.logPhase("merge", mergeMs);
    // reason: AC-DCS2-3 — the floor's own state reading (before its corpus snapshot exists, after it is gone) stamps the rows of the
    // oracle ids `floor_covers` names, so such a row certifies the same clean merged tree an oracle run of its own would.
    const floorBefore = oraclePort !== undefined ? probeGitState(wt) : undefined;
    const snapshotStart = clock();
    const snapshot = this.deps.corpus.take(wt);
    const snapshotMs = clock() - snapshotStart;
    if (!snapshot.ok) return snapshot;
    log(`integrate: floor runs against a corpus snapshot taken ${snapshot.value.takenAt}`);
    if (request.migrateCommand !== undefined && request.migrateCommand.trim() !== "") {
      // reason: since 5f0259a1 opening an older corpus refuses; the branch binary must upgrade the SNAPSHOT explicitly (cwd = the
      // integration worktree, whose own .lore/lore.db is the snapshot) before the floor opens it. Never run against the live corpus.
      const snapshotDir = join(wt, ".lore");
      const migrated = runSchemaMigration(this.deps.runFloor, request.migrateCommand, wt, snapshotDir, request.harnessRun);
      if (migrated.state === "failed") {
        const dropped = this.deps.corpus.remove(wt);
        if (!dropped.ok) return dropped;
        const back = this.resetWorktree(wt, base.value);
        if (!back.ok) return back;
        finish({ outcome: "snapshot_migrate_failed", merge_ms: mergeMs, corpus_snapshot_ms: snapshotMs, floor: null, cas_ms: null });
        return ok({ kind: "snapshot_migrate_failed", branch: request.branch, snapshot: snapshotDir, exit_status: migrated.exit_status, output_tail: migrated.output_tail, command: migrated.command });
      }
      log(`integrate: snapshot ${describeSchemaMigration(migrated)}`);
    } else {
      log("integrate: snapshot migrate skipped (workflow.integrate.migrate_command is not set)");
    }
    const floorStart = clock();
    /** @lore-site BR-1275 */
    const floor = this.deps.runFloor(floorCommand, wt);
    const floorTotalMs = clock() - floorStart;
    const floorTimings = {
      total_ms: floorTotalMs,
      steps: floor.steps !== undefined && floor.steps.length > 0 ? floor.steps.map((st) => ({ step: st.step, exit: st.exit, ms: st.ms })) : [{ step: FLOOR_UNTIMED_STEP, exit: floor.status, ms: floorTotalMs }],
    };
    // the snapshot is removed whatever the floor said: it is never written back and never outlives its run
    const dropped = this.deps.corpus.remove(wt);
    if (!dropped.ok) return dropped;
    this.logPhase("floor", floorTotalMs);
    const floorAfter = oraclePort !== undefined ? probeGitState(wt) : undefined;
    if (floor.status !== 0) {
      const back = this.resetWorktree(wt, base.value);
      if (!back.ok) return back;
      finish({ outcome: "floor_failed", merge_ms: mergeMs, corpus_snapshot_ms: snapshotMs, floor: floorTimings, cas_ms: null });
      return ok({ kind: "floor_failed", branch: request.branch, exit_status: floor.status, output_tail: floor.output.slice(-FLOOR_TAIL_CHARS) });
    }

    const head = git(wt, ["rev-parse", "HEAD"]);
    if (head.status !== 0) return err(gitFailure("rev-parse HEAD in the integration worktree", head));
    const merge = head.stdout.trim();
    // reason: AC-DCS2-2 — the oracles run on the exact tree that becomes main, after the floor and BEFORE main moves: a refusal here
    // leaves main, the integration worktree (reset to the main it saw) and every task untouched.
    let proof: OracleProof | undefined;
    if (oraclePort !== undefined && settings !== undefined && selection.length > 0) {
      const run = await oraclePort.prove({
        branch: request.branch,
        tip,
        tasks: selection,
        worktree: wt,
        commit: merge,
        base: base.value,
        floor: { durationMs: floorTotalMs, stamp: decideStampOutcome(floorBefore, floorAfter) },
        settings,
        runCommand: this.deps.runFloor,
        log,
        clock,
        nowIso: new Date(clock()).toISOString(),
      });
      if (!run.ok) {
        const back = this.resetWorktree(wt, base.value);
        if (!back.ok) return back;
        finish({ outcome: "oracle_failed", merge_ms: mergeMs, corpus_snapshot_ms: snapshotMs, floor: floorTimings, cas_ms: null });
        return run;
      }
      proof = run.value;
    }
    const tasks: readonly LandingTask[] = proof === undefined ? [] : proof.tasks;
    const outcomes: readonly OracleOutcome[] = proof === undefined ? [] : proof.outcomes;
    // reason: the compare-and-swap is an ASSERTION now (U8/U9): serialization means nothing but a bypassed guard can have moved main.
    const casStart = clock();
    const swapped = git(projectRoot, ["update-ref", TARGET_REF, merge, base.value], { [INTEGRATE_MARKER_ENV]: "1" });
    const casMs = clock() - casStart;
    if (swapped.status === 0) {
      finish({ outcome: "landed", merge_ms: mergeMs, corpus_snapshot_ms: snapshotMs, floor: floorTimings, cas_ms: casMs });
      await this.recordOracleRows(tasks, merge, outcomes);
      const claimants = await this.recordLanding({ branch: request.branch, branch_head: tip, main_before: base.value, main_after: merge, landing_commit: merge, ...footprint, ...onlySelected });
      // reason: the shared checkout moves to main BEFORE the done walk, so the walk's `git branch -d` finds the branch merged into HEAD.
      const view = this.refreshSharedView();
      await this.completeLanding(claimants, judged.renames, { branch: request.branch, landing_commit: merge });
      const cleared = ledger.clear(request.branch);
      if (!cleared.ok) return cleared;
      const rebuild = this.rebuildSharedView(view, request.postRefreshCommand);
      const schema = this.migrateLiveCorpus(view, rebuild, request.migrateCommand, request.harnessRun);
      // reason: BR-1379 — last step, after the rebuild and the schema migration, so the detached batch runs main's binary
      // against the migrated corpus. It only reads progress and spawns; the landing never waits for a review.
      await this.startReviewBatch();
      return ok({ kind: "landed", branch: request.branch, sha: merge, base: base.value, worktree: wt, shared_view: view, rebuild, schema });
    }

    const now = this.resolveCommit(TARGET_REF);
    if (!now.ok) return now;
    if (now.value === base.value) return err(gitFailure(`advancing ${TARGET_NAME} (main did not move, so this is not a moved main)`, swapped));
    finish({ outcome: "main_moved", merge_ms: mergeMs, corpus_snapshot_ms: snapshotMs, floor: floorTimings, cas_ms: casMs });
    const back = this.resetWorktree(wt, now.value);
    if (!back.ok) return back;
    return ok({ kind: "main_moved", branch: request.branch, expected: base.value, actual: now.value, moved_by: this.describeMoves(base.value, now.value) });
  }

  /**
   * Judges the branch's own change (BR-1346, BR-1347, BR-1348) before anything is touched. Skipped, with an empty
   * footprint, when no judgment is wired (a bare construction, like `landings`) or the tip is already on main (nothing
   * to land: the re-run only records landings).
   *
   * @returns the landed footprint to record, or the refusal (VALIDATION_ERROR on field `own-diff`, exit 4).
   */
  private async judgeOwnDiff(branch: string, tip: string): Promise<Result<JudgedChange, LoreError>> {
    const judgment = this.deps.ownDiff;
    if (judgment === undefined) return ok({ footprint: {}, renames: [] });
    const main = this.resolveCommit(TARGET_REF);
    if (!main.ok) return main;
    const onMain = this.deps.git(this.deps.projectRoot, ["merge-base", "--is-ancestor", tip, main.value]);
    if (onMain.status === 0) return ok({ footprint: {}, renames: [] });
    if (onMain.status !== 1) return err(gitFailure(`is ${short(tip)} on ${TARGET_NAME}`, onMain));
    const verdict = await judgment.judge(branch, tip);
    if (!verdict.ok) return verdict;
    for (const line of renderBoundProseLines(verdict.value.bound_prose)) this.deps.log(line);
    return ok({ footprint: { outside_anchors: [...verdict.value.outside_anchors] }, renames: verdict.value.renames });
  }

  /** Prints one phase duration: `phase <name> <seconds>s` (AC-DCS2-3). */
  private logPhase(name: string, ms: number): void {
    this.deps.log(`phase ${name} ${(ms / 1000).toFixed(3)}s`);
  }

  /**
   * Records the rows of the proven oracles on `tasks`, bound to `commit` (the commit that became main, or main's tip for an
   * already-integrated branch), through the oracle port. Never fails the integration (main has already moved): a task whose rows could
   * not be written is a WARNING line from the port, so the missing evidence is visible and `lore done` refuses it by its floor.
   */
  private async recordOracleRows(tasks: readonly LandingTask[], commit: string, outcomes: readonly OracleOutcome[], landingCommit: string = commit): Promise<void> {
    const port = this.deps.oracles;
    const settings = this.oracleSettings;
    if (port === undefined || settings === undefined || outcomes.length === 0) return;
    const clock = this.deps.clock ?? Date.now;
    const started = clock();
    await port.record({ tasks, commit, landingCommit, outcomes, by: settings.by, nowIso: new Date(started).toISOString(), log: this.deps.log });
    this.logPhase("recording", clock() - started);
  }

  /**
   * Records the landing on the branch's tasks. Never fails the integration (main has already moved): a task that
   * could not be written is logged loudly, so the missing record is visible; `lore done` refuses that task as
   * `not-landed` until `lore integrate` is run again on the branch (BR-1336).
   */
  private async recordLanding(landing: LandingRequest): Promise<readonly string[]> {
    const recorder = this.deps.landings;
    if (recorder === undefined) return [];
    const written = await recorder.record(landing);
    if (!written.ok) {
      this.deps.log(`integrate: WARNING: the landing of ${landing.branch} was not recorded on its tasks: ${written.error.code}${"message" in written.error ? ` ${written.error.message}` : ""}`);
      return [];
    }
    this.deps.log(`integrate: landing of ${landing.branch} recorded on ${written.value.length === 0 ? "no task (none claimed this branch)" : written.value.join(", ")}`);
    return written.value;
  }

  /**
   * The bookkeeping that follows a recorded landing, in this order, never un-landing main and never failing the call
   * (main has already moved): (1) BR-1355 anchors follow the renamed files; (2) BR-1356 the done walk for every task of
   * the branch. A refused task is printed with the floor that refused and the command its refusal names; a failure to
   * run a step is a loud WARNING line.
   */
  private async completeLanding(
    tasks: readonly string[],
    moves: readonly OwnDiffRename[],
    landing: { readonly branch: string; readonly landing_commit: string },
  ): Promise<void> {
    const { anchors, completion, log } = this.deps;
    if (anchors !== undefined && moves.length > 0) {
      const followed = await anchors.follow(moves, landing);
      if (!followed.ok) {
        log(`integrate: WARNING: anchors did not follow the files ${landing.branch} moved: ${followed.error.code}${"message" in followed.error ? ` ${followed.error.message}` : ""}`);
      } else {
        log(`integrate: anchors followed ${moves.map((m) => `${m.from} -> ${m.to}`).join(", ")} on ${followed.value.length === 0 ? "no document" : followed.value.join(", ")}`);
      }
    }
    if (completion === undefined || tasks.length === 0) return;
    const walkStart = (this.deps.clock ?? Date.now)();
    const completions = await completion.complete(tasks);
    this.logPhase("done-walk", (this.deps.clock ?? Date.now)() - walkStart);
    for (const done of completions) {
      if (done.outcome === "archived") {
        log(`integrate: ${done.task} archived by the landing (every done floor is met)`);
        continue;
      }
      log(`integrate: ${done.task} stays unarchived${done.floor !== undefined ? ` [floor: ${done.floor}]` : ""}; main stays landed. ${done.message}`);
    }
  }

  /**
   * After a landing: computes the review trigger set and starts one detached batch when it is non-empty and no batch holds
   * this machine's batch lease; otherwise says the running batch covers it (BR-1379, BR-1532). Never fails the integration and never waits: the outcome is one line.
   */
  private async startReviewBatch(): Promise<void> {
    const starter = this.deps.reviewBatch;
    if (starter === undefined) return;
    const started = await starter.start();
    if (!started.ok) {
      this.deps.log(`integrate: WARNING: the review batch was not started: ${started.error.code}${"message" in started.error ? ` ${started.error.message}` : ""}`);
      return;
    }
    this.deps.log(describeBatchStart(started.value));
  }

  /**
   * Persists one attempt's phase record and prints its phase line. Never fails the integration (main may already have
   * moved): a record that cannot be written is logged loudly, not swallowed.
   */
  private recordAttempt(branch: string, record: AttemptRecord): void {
    this.deps.log(renderAttemptPhases(record));
    const written = this.deps.attempts.recordAttempt(branch, record);
    if (!written.ok) this.deps.log(`integrate: WARNING: attempt ${record.attempt} phase durations were not recorded: ${written.error.code}${"message" in written.error ? ` ${written.error.message}` : ""}`);
  }

  /**
   * The configured remote named by the first path segment of `rev` (`origin/main` -> `origin`), else `ok(undefined)`;
   * err when `git remote` cannot list remotes (a remote-tracking argument must never be guessed local).
   */
  private remoteOf(rev: string): Result<string | undefined, LoreError> {
    const slash = rev.indexOf("/");
    if (slash <= 0) return ok(undefined);
    const candidate = rev.slice(0, slash);
    /** @lore-site BR-1277 */
    const remotes = this.deps.git(this.deps.projectRoot, ["remote"]);
    /** @lore-site BR-1290 */
    if (remotes.status !== 0) return err(gitFailure("git remote", remotes));
    return ok(remotes.stdout.split("\n").map((r) => r.trim()).includes(candidate) ? candidate : undefined);
  }

  /** Fetches the remote of a remote-tracking argument so the rev resolves to the remote's current tip. */
  private fetchRemoteTracking(rev: string): Result<void, LoreError> {
    const found = this.remoteOf(rev);
    if (!found.ok) return found;
    const remote = found.value;
    if (remote === undefined) return ok(undefined);
    this.deps.log(`integrate: fetching ${remote}`);
    /** @lore-site BR-1277 */
    const out = this.deps.git(this.deps.projectRoot, ["fetch", "-q", remote]);
    return out.status === 0 ? ok(undefined) : err(gitFailure(`git fetch ${remote}`, out));
  }

  /**
   * Refuses to run unless the main-ref guard is in force: git >= 2.46 and the shipped `reference-transaction` hook,
   * byte for byte and executable, in the active hooks directory. Reads only; nothing is changed on refusal.
   */
  private requireMainRefGuard(): Result<void, LoreError> {
    const { git, projectRoot } = this.deps;
    const refuse = (message: string, value?: string): Result<void, LoreError> =>
      err({ code: "VALIDATION_ERROR", field: "main-ref-guard", message: `integrate: ${message} Nothing was changed`, ...(value === undefined ? {} : { value }) });
    const { major, minor } = MIN_GIT_FOR_MAIN_REF_HOOK;
    const versionLine = this.deps.readGitVersion !== undefined ? this.deps.readGitVersion() : git(projectRoot, ["--version"]).stdout;
    const version = parseGitVersion(versionLine);
    if (version === undefined) {
      return refuse(`cannot read the git version (got ${JSON.stringify(versionLine.trim())}), so the main-ref guard cannot be proven to work; it needs git >= ${major}.${minor}. ${GIT_UPGRADE_HINT}`);
    }
    if (version.major < major || (version.major === major && version.minor < minor)) {
      return refuse(`${version.raw} is older than git ${major}.${minor}, the first git that reports 'git checkout main' to the reference-transaction hook. ${GIT_UPGRADE_HINT} Then run 'lore setup --project'.`, version.raw);
    }
    const located = git(projectRoot, ["rev-parse", "--path-format=absolute", "--git-path", "hooks"]);
    if (located.status !== 0) return err(gitFailure("locating the hooks directory", located));
    const installed = join(located.stdout.trim(), MAIN_REF_HOOK_NAME);
    if (!existsSync(installed)) return refuse(`the main-ref guard is not installed: ${installed} does not exist. Run 'lore setup --project' to install it.`, installed);
    const expected = EMBEDDED_ASSETS_MANIFEST.entries.find((e) => e.path === MAIN_REF_HOOK_ASSET_PATH);
    if (expected === undefined) return err({ code: "STORE_ERROR", message: `integrate: the embedded asset manifest has no ${MAIN_REF_HOOK_ASSET_PATH} (a build defect)` });
    const actual = createHash("sha256").update(readFileSync(installed)).digest("hex");
    if (actual !== expected.sha256) {
      return refuse(`the main-ref guard at ${installed} differs from the one this lore ships (sha256 ${actual.slice(0, 12)} vs ${expected.sha256.slice(0, 12)}). Run 'lore setup --project' to refresh it.`, installed);
    }
    if ((statSync(installed).mode & 0o111) === 0) return refuse(`the main-ref guard at ${installed} is not executable, so git skips it. Run 'lore setup --project' to repair it.`, installed);
    return ok(undefined);
  }

  /**
   * Moves the shared checkout's detached view to the current main with `git checkout --detach main` — never forced, so
   * git itself refuses (and loses nothing) when an uncommitted edit would be overwritten (ADR E5/E5b). Never fails the
   * integration: main already moved, so every non-refresh is reported, not thrown.
   */
  private refreshSharedView(): SharedViewRefresh {
    const { git, projectRoot } = this.deps;
    const gitDir = git(projectRoot, ["rev-parse", "--path-format=absolute", "--absolute-git-dir"]);
    const commonDir = git(projectRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    if (gitDir.status !== 0 || commonDir.status !== 0) {
      return { state: "not_measured", reason: `could not locate the git dir of ${projectRoot}: ${(gitDir.stderr || commonDir.stderr).trim()}` };
    }
    if (realpathSync(gitDir.stdout.trim()) !== realpathSync(commonDir.stdout.trim())) {
      return { state: "not_measured", reason: `${projectRoot} is a linked worktree, not the shared checkout` };
    }
    const branch = git(projectRoot, ["symbolic-ref", "-q", "HEAD"]);
    if (branch.status === 0) {
      return { state: "not_measured", reason: `the shared checkout is on ${branch.stdout.trim()}, not a detached view of ${TARGET_NAME}` };
    }
    const inProgress = this.operationInProgress(projectRoot);
    if (inProgress !== undefined) return { state: "not_measured", reason: `the shared checkout has a ${inProgress} in progress` };
    const moved = git(projectRoot, ["checkout", "-q", "--detach", TARGET_NAME]);
    if (moved.status === 0) return { state: "refreshed" };
    const text = `${moved.stderr}${moved.stdout}`;
    if (!text.includes("would be overwritten")) {
      return { state: "not_measured", reason: `git checkout --detach ${TARGET_NAME} exited ${moved.status}: ${text.trim()}` };
    }
    // git lists each blocking path on its own tab-indented line
    const paths = text.split("\n").filter((l) => l.startsWith("\t")).map((l) => l.trim());
    return { state: "kept_dirty", paths };
  }

  /**
   * Upgrades the LIVE corpus once, after the landing's refresh and rebuild, by running `migrate_command` in the shared
   * checkout (which owns the corpus). Never fails the integration and never un-lands main: every non-migration is
   * reported (`skipped` with its reason, `failed` with the corpus and the exact command to rerun). Runs only when the
   * binary the command resolves is main's: the view was `refreshed` and the rebuild did not fail.
   */
  private migrateLiveCorpus(view: SharedViewRefresh, rebuild: SharedViewRebuild, command: string | undefined, harnessRun: string | undefined): SchemaMigration {
    if (command === undefined || command.trim() === "") return { state: "skipped", reason: "workflow.integrate.migrate_command is not set" };
    const { projectRoot, runFloor, log } = this.deps;
    if (view.state !== "refreshed") return { state: "skipped", reason: `the shared checkout view is ${view.state}, so its binary is not main's; run \`${command}\` in ${projectRoot} once it is` };
    if (rebuild.state === "rebuild_failed") return { state: "skipped", reason: `the shared checkout rebuild failed, so its binary is not main's; rebuild, then run \`${command}\` in ${projectRoot}` };
    log(`integrate: migrating the live corpus in ${projectRoot}: ${command}`);
    return runSchemaMigration(runFloor, command, projectRoot, join(projectRoot, ".lore"), harnessRun);
  }

  /**
   * Runs the project's post-refresh command in the shared checkout when its view is `refreshed`. Never fails the
   * integration: every non-rebuild is reported. A build that leaves tracked changes is reported with the paths.
   */
  private rebuildSharedView(view: SharedViewRefresh, command: string | undefined): SharedViewRebuild {
    if (command === undefined || command.trim() === "") return { state: "skipped", reason: "workflow.integrate.post_refresh_command is not set" };
    if (view.state !== "refreshed") return { state: "skipped", reason: `the shared checkout view is ${view.state}, not refreshed` };
    const { projectRoot, runFloor, git, log } = this.deps;
    log(`integrate: rebuilding the shared checkout ${projectRoot}: ${command}`);
    const ran = runFloor(command, projectRoot);
    if (ran.status !== 0) return { state: "rebuild_failed", exit_status: ran.status, output_tail: ran.output.slice(-FLOOR_TAIL_CHARS) };
    const status = git(projectRoot, ["status", "--porcelain=v1", "--untracked-files=no"]);
    const tracked = status.status === 0 ? status.stdout.split("\n").filter((l) => l.trim() !== "").map((l) => l.slice(3)) : [];
    return tracked.length === 0 ? { state: "rebuilt" } : { state: "rebuilt", tracked_changes: tracked };
  }

  /** The multi-step operation a checkout is in the middle of (it blocks a detach), or `undefined`. */
  private operationInProgress(checkout: string): "merge" | "rebase" | "cherry-pick" | "revert" | undefined {
    const states: ReadonlyArray<readonly [string, "merge" | "rebase" | "cherry-pick" | "revert"]> = [
      ["MERGE_HEAD", "merge"],
      ["rebase-merge", "rebase"],
      ["rebase-apply", "rebase"],
      ["CHERRY_PICK_HEAD", "cherry-pick"],
      ["REVERT_HEAD", "revert"],
    ];
    for (const [name, label] of states) {
      /** @lore-site BR-1273 */
      const located = this.deps.git(checkout, ["rev-parse", "--path-format=absolute", "--git-path", name]);
      if (located.status === 0 && existsSync(located.stdout.trim())) return label;
    }
    return undefined;
  }

  /**
   * Where a branch already in main landed (D44): the earliest commit of main's first-parent history that contains `tip` (the tip itself
   * when it lies on that history, a fast-forward) and that commit's first parent. A tip that cannot be placed is an error, never a guess.
   */
  private placeLandingOnMain(tip: string): Result<{ readonly landing_commit: string; readonly main_before: string }, LoreError> {
    const { git, projectRoot, firstParentContaining } = this.deps;
    const chain = git(projectRoot, ["rev-list", "--first-parent", TARGET_REF]);
    if (chain.status !== 0) return err(gitFailure(`reading the first-parent history of ${TARGET_NAME}`, chain));
    let landingCommit: string | undefined;
    if (chain.stdout.split("\n").includes(tip)) landingCommit = tip;
    else {
      if (firstParentContaining === undefined) return err({ code: "STORE_ERROR", message: `integrate: no first-parent placement is wired, so where ${short(tip)} entered ${TARGET_NAME} cannot be measured` });
      const found = firstParentContaining(tip, TARGET_REF);
      if (!found.ok) return found;
      landingCommit = found.value;
    }
    if (landingCommit === undefined) return err({ code: "STORE_ERROR", message: `integrate: no first-parent commit of ${TARGET_NAME} contains ${short(tip)}` });
    const parent = git(projectRoot, ["rev-parse", "--verify", "-q", `${landingCommit}^1`]);
    if (parent.status !== 0 || parent.stdout.trim() === "") {
      return err({ code: "STORE_ERROR", message: `integrate: the landing commit ${short(landingCommit)} of ${short(tip)} has no first parent, so its range start cannot be measured` });
    }
    return ok({ landing_commit: landingCommit, main_before: parent.stdout.trim() });
  }

  /** A placement failure, naming every task the landing would have judged (those claimed on the branch) so nothing is skipped silently. */
  private async placementRefusal(branch: string, tip: string, main: string, cause: LoreError): Promise<Result<never, LoreError>> {
    const named: string[] = [];
    if (this.deps.oracles !== undefined) {
      const claimed = await this.deps.oracles.select(branch, tip, main);
      if (claimed.ok) named.push(...claimed.value.map((task) => task.slug));
    }
    const reason = "message" in cause && typeof cause.message === "string" ? cause.message : cause.code;
    const tasks = named.length === 0 ? "" : `; tasks whose landing range has no measurable start: ${named.join(", ")}`;
    return err({ code: "STORE_ERROR", message: `${reason}${tasks}` });
  }

  /** `rev` as a full commit sha, or a refusal naming the rev. */
  private resolveCommit(rev: string): Result<string, LoreError> {
    /** @lore-site BR-1272 */
    const out = this.deps.git(this.deps.projectRoot, ["rev-parse", "--verify", "-q", `${rev}^{commit}`]);
    if (out.status !== 0 || out.stdout.trim() === "") {
      return err({ code: "VALIDATION_ERROR", field: "branch", message: `integrate: ${rev} does not name a commit in this repository`, value: rev, rule: "BR-1272" });
    }
    return ok(out.stdout.trim());
  }

  private defaultMessage(branch: string, tip: string): string {
    const subject = this.deps.git(this.deps.projectRoot, ["log", "-1", "--format=%s", tip]).stdout.trim();
    return subject === "" ? `merge(${branch})` : `merge(${branch}): ${subject}`;
  }

  /** Creates the session's detached integration worktree on first use, reuses it afterwards. */
  private ensureWorktree(sessionId: string): Result<string, LoreError> {
    const { git, projectRoot, worktreesRoot } = this.deps;
    const path = integrationWorktreePath(worktreesRoot, sessionId);
    const registered = git(projectRoot, ["worktree", "list", "--porcelain"]);
    if (registered.status !== 0) return err(gitFailure("git worktree list", registered));
    const known = registered.stdout.split("\n").filter((l) => l.startsWith("worktree ")).map((l) => l.slice("worktree ".length));
    const onDisk = existsSync(path);
    const canonical = onDisk ? realpathSync(path) : path;
    if (onDisk) {
      if (known.some((k) => k === path || k === canonical)) return ok(path);
      return err({ code: "STORE_ERROR", message: `integrate: ${path} exists but is not a worktree of this repository; remove it or use another session id`, rule: "BR-1278" });
    }
    // registered-but-deleted (a cleaned-up directory): drop the stale registration before adding again
    if (known.includes(path)) git(projectRoot, ["worktree", "prune"]);
    const base = this.resolveCommit(TARGET_REF);
    if (!base.ok) return base;
    const added = git(projectRoot, ["worktree", "add", "-q", "--detach", path, base.value]);
    if (added.status !== 0) return err(gitFailure(`creating the integration worktree ${path}`, added));
    return ok(path);
  }

  /** Aborts any merge in progress and puts the worktree on `rev` with a clean tracked tree. */
  private resetWorktree(wt: string, rev: string): Result<void, LoreError> {
    this.deps.git(wt, ["merge", "--abort"]); // no merge in progress is the normal case: its failure is expected, not an error
    const out = this.deps.git(wt, ["checkout", "-q", "-f", "--detach", rev]);
    return out.status === 0 ? ok(undefined) : err(gitFailure(`resetting the integration worktree to ${short(rev)}`, out));
  }

  /** A merge that exited non-zero: unmerged paths mean a conflict (abort + reset, exit 4); anything else is an error. */
  private afterFailedMerge(branch: string, wt: string, base: string, merged: GitOutcome): Result<IntegrateOutcome, LoreError> {
    /** @lore-site BR-1246 */
    const unmerged = this.deps.git(wt, ["diff", "--name-only", "--diff-filter=U"]);
    const paths = unmerged.stdout.split("\n").map((p) => p.trim()).filter((p) => p !== "");
    const reset = this.resetWorktree(wt, base);
    if (!reset.ok) return reset;
    if (paths.length === 0) return err(gitFailure(`merging ${branch}`, merged));
    return ok({ kind: "conflict", branch, paths });
  }

  /** `<sha12> <subject>` of each first-parent commit that took main from `base` to `now`. */
  private describeMoves(base: string, now: string): string[] {
    /** @lore-site BR-1245 */
    const out = this.deps.git(this.deps.projectRoot, ["log", "--first-parent", "--format=%H %s", `${base}..${now}`]);
    const lines = out.stdout.split("\n").map((l) => l.trim()).filter((l) => l !== "");
    if (out.status !== 0 || lines.length === 0) return [`${short(now)} (main is not a descendant of ${short(base)})`];
    return lines.reverse().map((l) => `${short(l.slice(0, 40))}${l.slice(40)}`);
  }
}

/**
 * Runs `<command> --json` with LORE_HARNESS_RUN=<run> exported in its shell, in `cwd`, through the injected runner and reads the report. The child is a write
 * made by the caller's party, so it carries the caller's attested run (see {@link IntegrateRequest.harnessRun}); a run that is
 * not a plain run id is `failed` without spawning anything. A non-zero exit, or an exit 0
 * whose output carries no readable `--json` report (a migrate whose result cannot be named must not read as success),
 * is `failed`.
 *
 * @param runner - the injected shell runner (the floor runner)
 * @param command - `workflow.integrate.migrate_command`, the full `lore migrate schema` command line
 * @param cwd - the directory whose corpus is migrated (the integration worktree for the snapshot, the shared checkout for the live corpus)
 * @param corpus - the `.lore/` directory the run is expected to touch, named in a failure
 * @param harnessRun - the caller's attested run, exported as LORE_HARNESS_RUN for the child
 */
export function runSchemaMigration(runner: FloorRunner, command: string, cwd: string, corpus: string, harnessRun: string | undefined): SchemaMigration {
  if (!isChildRunId(harnessRun)) {
    return { state: "failed", exit_status: 0, output_tail: "the migrate child has no attested caller run to run as; nothing was spawned", corpus, command: `${command} --json` };
  }
  // reason: the run travels in the migrate shell's environment (an export line), never argv (AC-RV-11)
  const full = prefixRunExport(`${command} --json`, harnessRun as RunId);
  const ran = runner(full, cwd);
  const tail = ran.output.slice(-FLOOR_TAIL_CHARS);
  if (ran.status !== 0) return { state: "failed", exit_status: ran.status, output_tail: tail, corpus, command: full };
  const block = /\{\s*"ok"[\s\S]*\}\s*$/.exec(ran.output);
  let report: z.infer<typeof MigrateSchemaReportSchema> | undefined;
  try {
    const parsed = block === null ? undefined : MigrateSchemaReportSchema.safeParse(JSON.parse(block[0]));
    report = parsed?.success === true ? parsed.data : undefined;
  } catch {
    report = undefined; // reason: unreadable output is returned as a failed migration below, never swallowed
  }
  if (report === undefined) return { state: "failed", exit_status: 0, output_tail: `exited 0 but printed no readable --json report:\n${tail}`, corpus, command: full };
  return report.data.upgraded ? { state: "migrated", from: report.data.from, to: report.data.to } : { state: "current", version: report.data.to };
}

/** A run id safe to put on a shell command line: the registry's `cc:<session>[:<agent>]` / `human:<hash>` shapes, never a free string. */
function isChildRunId(run: string | undefined): run is string {
  return run !== undefined && /^[A-Za-z0-9][A-Za-z0-9:._-]*$/.test(run);
}

/** One line for a migration result: `schema: <from> -> <to>`, `schema: already current`, or the skip/failure in words. */
export function describeSchemaMigration(migration: SchemaMigration): string {
  switch (migration.state) {
    case "migrated":
      return `schema: ${migration.from} -> ${migration.to}`;
    case "current":
      return "schema: already current";
    case "skipped":
      return `schema: skipped (${migration.reason})`;
    case "failed":
      return `schema: migrate failed (exit ${migration.exit_status}) on ${migration.corpus}`;
  }
}
