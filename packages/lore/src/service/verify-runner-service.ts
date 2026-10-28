/**
 * VerifyRunnerService — orchestrates `lore verify`: runs a plan's script-mode
 * acceptance criteria for real and records the outcome as runner-attested evidence
 * (SPEC-039 §2; §M2 trust-hardening; SPEC-061 attestation-completeness guard;
 * spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a §M6.2
 * discovery-refusal guard).
 *
 * Public surface:
 *   verifyPlan(planIdOrSlug, opts) → runs every (or a filtered subset of) script-mode
 *     AC declared on the plan's parent spec against the resolved target task
 *   verifyFalsifier(planIdOrSlug, acId, opts) → spec-falsifiability-reachability-
 *     a-feedable-checkpoint-an §D2/D3/D4's ATTESTED-RED runner: runs ONE
 *     declared AC's own UNMUTATED command inside a SCRATCH git worktree
 *     (never the working tree — see the "Attested-Red Falsifier Runner"
 *     section below), first materializing that worktree's dependencies
 *     (`materializeFalsifierDependencies`,
 *     `spec-a-falsifier-s-scratch-worktree-must-be-runnable-and` AC-SD-6) so
 *     `node_modules` is usable there, as a GREEN CONTROL (AC-FR-11) BEFORE applying anything;
 *     a nonzero/timed-out control records `result: "inconclusive"` with NO
 *     `attestation` and stops right there. Only once that control exits 0
 *     does it apply the AC's `verify.falsifier` mutation, run the AC's
 *     command again, and record a runner-issued `result: "expected-fail"`
 *     evidence row ONLY when the observed exit code equals the falsifier's
 *     declared value exactly. Wholly separate from the four-step pipeline
 *     below — no M2 approval gate, no completeness/freshness guards (those
 *     all reason about the CHECKED-IN tree, which this path never executes
 *     against).
 *
 * createFalsifierScratchWorktree / removeFalsifierScratchWorktree /
 * applyFalsifierMutation (plain exported functions, not class methods — see
 * their own JSDoc for why) are `verifyFalsifier`'s three real-IO primitives.
 *
 * Four-step pipeline, fully delegated (SPEC-039 §2), with an M2 pre-execution gate
 * inserted into step ③ and a SPEC-061 post-execution guard inserted into step ④:
 *   ① injected `getPlanBundle` — read orchestration (bound to
 *      `corpusService.getPlanBundle`, mirroring `resolveDeclaredAcIds`'s bind-in-app.ts
 *      precedent, SPEC-038 §7 D4)
 *   ② core `resolveTargetTask` (`@lore/core`, pure) — explicit `--task` override wins;
 *      otherwise the plan's sole fresh (non-stale) claim; 0 or >1 candidates fail loud
 *   ②.4 declared-scope selection + pre-flight refusal (`_selectDeclaredScopeCriteria`,
 *      pure; core `extractDeclaredAcScope` + `isAcInDeclaredScope`) — the resolved
 *      TASK's `extra.ac_scope` decides which declared criteria this run may touch:
 *      a default run selects `ac_scope ∩ declared criteria`, an out-of-scope `--ac`
 *      id refuses the WHOLE run, and an absent/empty/fully-dangling scope refuses
 *      too. Every refusal is `VALIDATION_ERROR` (exit 4, stderr) raised BEFORE any
 *      executor or `recordVerifiedEvidence` call — see that method's own table
 *   ②.5 M2 command-provenance approval gate (core `isApprovedVerifyCommand`, pure) —
 *      a command absent from the target task's evidence history is "new/changed" and
 *      requires explicit approval (interactive `opts.confirmUnapprovedCommand` or
 *      `opts.allowNewCommands`) before step ③ runs for that AC; disabled entirely via
 *      `config.requireCommandApproval: false`
 *   ③ injected `executor` — runs the spawn spec (bound to
 *      `verify-executor.ts::executeVerifySpawnSpec` in production), with a
 *      pre-resolved env map (`resolveVerifyEnv`, computed ONCE per run — SPEC-039 §M2)
 *   ③.3 discovery-refusal guard (core `findDiscoveryRefusal`, pure;
 *      spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a §M6.2) —
 *      for an `oracle: "test"` AC whose command exited NONZERO (and did not
 *      time out), checks whether the captured output is a test-runner
 *      DISCOVERY REFUSAL (found no matching test file — a zero-execution
 *      event) rather than a genuine assertion failure; every runner this
 *      repo uses returns the SAME exit code for both, so exit code alone
 *      cannot distinguish them. A match downgrades the about-to-be-recorded
 *      result from `"fail"` to `"inconclusive"` PLUS a `warnings` entry
 *      naming the matched runner and its verbatim refusal line (closes the
 *      defect where a mistyped/not-yet-existing test path minted a
 *      permanent, indistinguishable-from-a-real-red `"fail"`). No match
 *      leaves `verifyResult` exactly as `deriveVerifyResult` already
 *      computed it — every other oracle kind, and any exit-0 or timed-out
 *      run, skips this step entirely.
 *   ③.4 build-freshness precheck (core `commandReferencesCompiledBinary` /
 *      `judgeBinaryFreshness`, both pure) — for ANY AC (regardless of oracle kind)
 *      whose command exited 0 and whose command string spawns the compiled
 *      `dist/lore` binary, checks whether that binary is stale/missing relative to
 *      this repo's TypeScript sources; a non-"fresh" verdict downgrades the
 *      about-to-be-recorded result to `"inconclusive"` PLUS a `warnings` entry
 *      naming `bun run build` (closes false-oracle vector 4 — a spawn-based test
 *      exercising a binary that predates the session's source changes). A command
 *      not referencing the binary skips this step entirely (no fs access at all —
 *      `checkBinaryFreshness` is never invoked). Runs BEFORE step ③.5 so an
 *      already-downgraded result short-circuits that step's own `"pass"`-only guard.
 *   ③.5 SPEC-061 attestation-completeness guard (core `countExplicitPathArgs` /
 *      `parseExecutedUnits` / `judgeCompleteness`, all pure) — for an `oracle: "test"`
 *      AC whose command exited 0, judges whether the runner actually executed as many
 *      test files (and, when a `-t`/`--testNamePattern` case filter is present, test
 *      CASES) as the command explicitly declared; a zero/under-match downgrades the
 *      about-to-be-recorded result from `"pass"` to `"inconclusive"` (never silently
 *      stays `"pass"` — the AC-060-7 false-attestation incident this guard closes).
 *      Every other oracle kind, and any non-zero exit, skips this step entirely (no
 *      `completeness` computed, no field written — byte-identical to pre-SPEC-061).
 *   ④ injected `recordVerifiedEvidence` — the SOLE attestation injection point (bound
 *      to `taskWorkflowService.recordVerifiedEvidence`); the recorded attestation
 *      carries `first_seen: true` when step ②.5 found the command new/changed (M2
 *      command-provenance annotation), `completeness`/`executed_files` when step
 *      ③.5 ran (SPEC-061), ALWAYS `execution_root`/`execution_mode` (SPEC-063
 *      §Design Decisions D2/D3 — see `opts.executionRoot` below), and `head_sha` +
 *      `worktree_dirty` (baseline slice 1 §C5 — measured by {@link probeGitState} at
 *      the RESOLVED execution root BEFORE the command and again AFTER it, SPEC-143
 *      AC-CT-5; {@link decideStampOutcome} compares the two reads: HEAD moved ->
 *      `stamp_unbound_reason: "state_moved"` with NO `head_sha`; tree dirty at either
 *      read -> `"dirty_tree"`; otherwise `state_stamp`. Never the post read alone.
 *      All omitted when git cannot answer at either read). Step ③.4's
 *      `binary_freshness` verdict is surfaced on the in-memory `VerifyAcResult` and
 *      the run's `warnings` ONLY — it is NOT persisted onto `attestation` (the
 *      `evidenceEntrySchema.attestation` shape lives outside this task's anchors;
 *      the downgraded `result`/the warning text are the durable signal).
 *      This step also gives every runner-attested row its `ac_oracle_generation`
 *      stamp (spec-the-defect-channel-cannot-be-honestly-maintained-an §M5,
 *      AC-DC-8) — WITHOUT this service supplying it: the stamp is resolved from the
 *      referenced criterion inside `TaskWorkflowService.appendEvidenceEntry`, the
 *      shared chokepoint behind this port, for the self-reported and attested paths
 *      alike (see that method's `resolveAcOracleGeneration`). ⛔ Do not add a
 *      generation field to the object passed at step ④: both evidence input types
 *      structurally exclude it and the chokepoint refuses a raw candidate carrying
 *      it, deliberately — unlike `attestation`, a generation this runner declared
 *      would be a caller-supplied claim about a criterion it did not re-read.
 *
 * SPEC-063 execution-root correctness — `opts.executionRoot` (optional) is the
 * CLI adapter's pre-resolved `resolveVerifyExecutionRoot(...)` result (core, pure);
 * this service never probes git itself (stays free of git/process probing, per
 * the pre-existing invariant below). When omitted (MCP callers, which do no
 * worktree-aware resolution) this service falls back to `{root: config.repoRoot,
 * mode: "corpus_root"}` — byte-identical to pre-SPEC-063 behavior. Every AC's
 * command spawns from the resolved `root` (not unconditionally `config.repoRoot`
 * any more), and every recorded attestation carries `execution_root`/
 * `execution_mode` from the SAME resolution — closing the vector where a linked
 * git worktree's `lore verify` silently executed against the main checkout.
 *
 * Invariants:
 *   - Never imports `verify-executor.ts` (bun-only) — the executor is a constructor
 *     port, so this service (and its vitest suite) stays fully bun-independent
 *     (SPEC-039 §2 D3).
 *   - Never touches doc status, never auto-approves anything (SPEC-039 §1 — "runner
 *     不自动改任何 doc 状态、不 approve", PRD §14 R2 red line).
 *   - A launch-failure `err` from the executor ABORTS the entire run — no partial
 *     ambiguity. The error message names every AC id already recorded before the
 *     abort (SPEC-039 §4 D6 "fail-loud, 不留部分歧义"). A REJECTED command-provenance
 *     approval (M2) aborts the SAME way, with the same "already recorded" accounting
 *     — `err({code: "NEEDS_APPROVAL", ...})` instead of `STORE_ERROR`.
 *   - A `spec` whose status is not `approved`/`active` still runs in full — this is
 *     advisory (`result.warnings`), never a hard gate (SPEC-039 §3 "draft spec 的
 *     AC → 执行 + stderr 警告行(不硬闸)").
 *   - `ai`/`human`-mode criteria in the (declared-scope- and optionally
 *     `acIds`-filtered) selection are never executed — they are reported in
 *     `result.skipped`, never silently dropped.
 *   - The target task's declared `ac_scope` is the ONLY thing that widens a default
 *     run's write scope (step ②.4). This service never infers a scope from the
 *     spec's full criteria list, and never from the task's existing evidence — the
 *     latter is the circular "audited evidence defines its own audit scope" defect
 *     `adr-lore-verify-s-attested-evidence-scope-belongs-to-the-task` removes.
 *   - A run that would select ZERO criteria is a refusal, never an exit-0 no-op:
 *     an absent scope (with no `--ac`), an empty scope, and a scope matching no
 *     declared criterion all fail loud. A `skipped`-only outcome (an in-scope
 *     `ai`/`human` criterion) is NOT zero-selection and stays a success.
 *   - `resolveVerifyEnv` is called EXACTLY ONCE per `verifyPlan` invocation (env
 *     doesn't vary per-AC) — never re-derived inside the per-AC loop.
 *   - `opts.confirmUnapprovedCommand` is a PER-CALL option, not constructor DI — the
 *     CLI wires a TTY-aware prompt callback, MCP never supplies one (non-interactive
 *     by design); `createApp`/`app.ts` stays adapter-agnostic (SPEC-039 §M2).
 *   - `checkBinaryFreshness` (constructor arg 5, OPTIONAL) is the build-freshness
 *     port — a `() => BinaryFreshnessVerdict` thunk, computed AT MOST ONCE per
 *     `verifyPlan` call (cached the same way `resolveVerifyEnv`/`executionRoot` are
 *     resolved once and threaded down) and ONLY when at least one AC's command
 *     references the compiled binary. Omitting it (every pre-Part-A call site,
 *     incl. `app.ts`'s existing 4-arg construction) falls back to a private
 *     `node:fs`-based real check (`newestTsMtimeMs` scan of `packages/{lore,core}/src`
 *     vs `<repoRoot>/dist/lore`'s mtime, mirroring
 *     `tests/integration/helpers/assert-fresh-binary.ts`'s algorithm) — one of TWO
 *     places this class does direct filesystem IO itself (the other is the
 *     falsifier runner's scratch-worktree primitives below), both deliberately
 *     scoped to production use (every test in the MAIN `verifyPlan`/`verifyAdhocTask`
 *     suite injects a fake, per the `executor`/`getPlanBundle` precedent — the
 *     falsifier primitives are NOT injectable at all, by design, see the
 *     "Attested-Red Falsifier Runner" section below).
 *
 * Side-effect class: IO (delegates all IO to injected ports, EXCEPT (a) the default
 *   `checkBinaryFreshness` fallback described above, which does direct `node:fs`
 *   reads when no port is injected, and (b) `createFalsifierScratchWorktree` /
 *   `removeFalsifierScratchWorktree` / `applyFalsifierMutation`, which ALWAYS do
 *   real `git`/`node:fs` IO — never injectable, see their own JSDoc)
 *
 * Source: SPEC-039 §2 D2, D3, D4, D6, D9; §3; §4 AC-VRF-3; §M2 (trust-hardening: env
 *   allowlist + command-provenance approval + annotation); SPEC-061 §Scope D3;
 *   SPEC-063 §Design Decisions D2, D3; task "verify trust extensions"
 *   (build-freshness precheck + -t matched-case count guard), AC-061-9
 */

import { discardWarnings, type WarnSink } from "./warn-sink.js";
import { existsSync, readdirSync, statSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { CAPTURE_TAIL_CHARS, err, findMissingOracleFiles, ok, RUNNER_UNATTESTED_CAPTURE_SOURCE } from "@lore/core";
import type { AuditEntry, FileExistsPort, StateStamp, SupersededByRef } from "@lore/core";
import type {
  Result,
  LoreError,
  AcceptanceCriterion,
  AcFalsifier,
  DocId,
  DocRecord,
  PlanBundle,
} from "@lore/core";
import {
  specAcceptanceCriteriaSchema,
  resolveTargetTask,
  extractDeclaredAcScope,
  isAcInDeclaredScope,
  resolveRecordedGoverningSpec,
  isApprovedVerifyCommand,
  countExplicitPathArgs,
  parseExecutedUnits,
  judgeCompleteness,
  commandHasCaseFilter,
  commandReferencesCompiledBinary,
  judgeBinaryFreshness,
  findDiscoveryRefusal,
  tailChars,
  type AcVerifyMode,
  type CompletenessVerdict,
  type BinaryFreshnessVerdict,
  type VerifyExecutionRootResolution,
} from "@lore/core";
import {
  buildVerifySpawnSpec,
  deriveVerifyResult,
  resolveVerifyEnv,
  type ScriptAcceptanceCriterion,
  type VerifySpawnSpec,
  type VerifyExecutionResult,
} from "./verify-spawn.js";
import type { VerifiedEvidenceInput } from "./task-workflow-service.js";
import { buildStateBindingSkipAuditEntry } from "./state-binding-skip.js";
import { materializeFalsifierDependencies } from "./falsifier-dep-materialization.js";
import { createHash } from "node:crypto";
import { requireOverrideAuto, type OverrideDecisionPort } from "./override-decision.js";
import { writeScratchOwner, type ScratchRemovalPort } from "./worktree-cleanup.js";
import { FALSIFIER_EXIT_CODE_MAX, FALSIFIER_EXIT_CODE_MIN, isValidFalsifierExitCode } from "./ac-write-chokepoint.js";
// Probe + stamp decision live in ./git-state-stamp.js, shared with `lore evidence --capture`.
import { probeGitState, decideStampOutcome, type StampOutcome } from "./git-state-stamp.js";
export { probeGitState, decideStampOutcome };
export type { GitStateProbe, StampOutcome } from "./git-state-stamp.js";

/** Attested `exit_code` of an AC recorded without spawning anything because its oracle file is missing (AC-TG-6). */
const MISSING_ORACLE_FILE_EXIT_CODE = -1;

// ─── State-binding occupancy port (SPEC-143 AC-CT-8) ───────────────────────

/**
 * What the occupancy reader reports. Structurally identical to the adapter's `OccupancyProbe`
 * (`adapters/oracle-occupancy.ts`); declared here so this service imports no adapter.
 */
export type StateBindingOccupancy =
  | { readonly kind: "free" }
  | { readonly kind: "held"; readonly holder_pid: number; readonly lock_path: string }
  | { readonly kind: "unmeasured"; readonly reason: string };

/**
 * Optional port that arms the state-binding SKIP path. Omitted -> the check is ABSENT (the
 * control the AC-CT-8 exit-code comparison runs against). Wired in `app.ts` to the read-only
 * `probeOccupancy` reader and `store.appendAuditEntry`.
 */
export interface StateBindingOccupancyPort {
  /** Reads whether a peer holds the checkout-level oracle lock, for the checkout containing `executionRoot`. */
  readonly probe: (executionRoot: string) => StateBindingOccupancy;
  /** Appends the one audit row a skipped check writes. */
  readonly recordSkip: (entry: AuditEntry) => Promise<Result<void, LoreError>>;
}

// ─── Pinned refusal literals (declared-scope contract) ─────────────────────

/**
 * The repair command every scope refusal names. PINNED by
 * `spec-declared-scope-attestation-contract-task-owned-ac-scope` §"Exit codes
 * and pinned message literals" (AC-VS-3 matches this exact substring), so it is
 * a named constant: reword the surrounding sentence freely, change THIS string
 * and a declared AC goes red by construction.
 */
const SCOPE_WRITER_HINT = "lore scope add";

/**
 * The EMPTY-`ac_scope` refusal's pinned literal (AC-VS-5). Contractually ABSENT
 * from the absent-scope message: "empty" (an author declared this task claims
 * nothing) and "absent" (nobody ever declared a scope) are two states, and the
 * two refusals must be distinguishable by a fixed string, not by wording taste.
 */
const EMPTY_SCOPE_LITERAL = "declares no acceptance criterion";

// ─── Public Types ──────────────────────────────────────────────────────────

/** Options for {@link VerifyRunnerService.verifyPlan}. */
export interface VerifyPlanOpts {
  /** Restrict the run to these declared AC ids. Omitted = every declared AC on the spec. */
  acIds?: string[];
  /** `--task` override — wins over claim-based resolution regardless of claim state. */
  explicitTaskIdOrSlug?: string;
  /** Resolved actor identity, recorded as `recorded_by` on every evidence entry. */
  by: string;
  /** Caller-supplied current time (D10 time seam) — resolved ONCE per call. */
  nowIso: string;
  /**
   * Bypass the M2 command-provenance approval gate for this ENTIRE run — every
   * new/changed command executes without a prompt (CLI `--allow-new-commands`,
   * MCP `allow_new_commands`). `true` wins over `confirmUnapprovedCommand` (no
   * prompt fires even if a callback is also supplied). Ignored when
   * `config.requireCommandApproval` is `false` (the gate is off entirely).
   */
  allowNewCommands?: boolean;
  /**
   * Marks every row this run records as a milestone-review refresh row, so the next refresh REPLACES it instead of
   * growing the task's evidence log (spec-lean-governance Part D). Set only by `assess-stale-refresh.ts`.
   */
  milestoneRefresh?: boolean;
  /**
   * Interactive per-command confirmation hook (SPEC-039 §M2) — invoked ONLY when
   * an AC's command is new/changed AND `allowNewCommands` is not `true` AND the
   * gate is enabled. CLI-only: wired to a TTY prompt when `process.stdin.isTTY`
   * and not `--json`; MCP NEVER supplies this (non-interactive by design — an
   * unapproved command with no callback and no `allowNewCommands` is rejected
   * outright). Resolving `false` (or the promise resolving falsy) aborts the run
   * at that AC with `NEEDS_APPROVAL`.
   */
  confirmUnapprovedCommand?: (info: { ac_id: string; command: string }) => Promise<boolean>;
  /**
   * Pre-resolved execution root (SPEC-063 §Design Decisions D2) — the CLI
   * adapter's own `resolveVerifyExecutionRoot(...)` result (or its `--execution-root`
   * override composition), computed BEFORE calling `verifyPlan` since this
   * service never probes git/process state itself. Every AC's command spawns
   * from `executionRoot.root` (not unconditionally `config.repoRoot`), and
   * every recorded attestation carries `execution_root`/`execution_mode` from
   * this SAME value. Omitted (e.g. by MCP, which does no worktree-aware
   * resolution) falls back to `{root: config.repoRoot, mode: "corpus_root"}` —
   * byte-identical to pre-SPEC-063 behavior (REGRESSION, AC-063-3).
   */
  executionRoot?: VerifyExecutionRootResolution;
}

/** One executed script-mode AC's outcome. */
export interface VerifyAcResult {
  readonly ac_id: string;
  /**
   * `"inconclusive"` (SPEC-061 §Scope D3) is the attestation-completeness
   * guard's own verdict — set instead of `"pass"` when the command exited 0
   * but its declared test-file path arguments were not all matched by the
   * runner (zero-match or under-match). Never a caller assertion, same as
   * `"pass"`/`"fail"` — always derived by this service.
   */
  readonly result: "pass" | "fail" | "inconclusive";
  readonly exit_code: number;
  readonly duration_ms: number;
  readonly timed_out: boolean;
  /**
   * true iff this command was new/changed relative to the task's evidence history
   * at execution time (SPEC-039 §M2 command-provenance annotation) — mirrors
   * `EvidenceEntry.attestation.first_seen`. Omitted (never `false`) for a
   * previously-seen command.
   */
  readonly first_seen?: boolean;
  /**
   * Attestation-completeness verdict (SPEC-061 §Scope D3/D4) — present ONLY
   * for an `oracle: "test"` AC whose process exited 0 (the guard's own scope:
   * a nonzero exit is already a `"fail"`, completeness is irrelevant; every
   * other oracle kind is out of scope, SPEC-061 §Scope Out). Omitted for
   * every other AC.
   */
  readonly completeness?: CompletenessVerdict;
  /**
   * Count of test files the runner reported as actually executed (SPEC-061
   * §Scope D4) — present iff {@link completeness} is set AND a recognised
   * runner-summary line was parsed (absent when `completeness ===
   * "unknown_runner"`).
   */
  readonly executed_files?: number;
  /**
   * The command's own declared explicit test-file path-argument count
   * (SPEC-061 §Scope D1/D3) — present alongside {@link completeness}
   * whenever the guard ran, regardless of whether any files were parsed from
   * stdout; renders the "ran X of Y declared paths" CLI message even when
   * `executed_files` itself is absent (`unknown_runner`, X reads as unknown).
   */
  readonly declared_paths?: number;
  /**
   * Build-freshness verdict (Part A) — present ONLY when this AC's command
   * references the compiled `dist/lore` binary (`commandReferencesCompiledBinary`)
   * AND the process exited 0. `"stale"`/`"missing"` downgrade {@link result} to
   * `"inconclusive"` and add a `bun run build`-naming entry to the run's
   * `warnings`; `"fresh"` leaves {@link result} exactly as otherwise computed.
   * Omitted for every AC whose command does not reference the binary.
   */
  readonly binary_freshness?: BinaryFreshnessVerdict;
}

/** One declared AC that was NOT executed because its verify.mode isn't "script". */
export interface VerifySkippedAc {
  readonly ac_id: string;
  readonly mode: Exclude<AcVerifyMode, "script">;
}

/** One selected AC that was NOT executed because another spec's criterion supersedes it (D15). */
export interface VerifySupersededAc {
  readonly ac_id: string;
  readonly superseded_by: SupersededByRef;
}

/** Full outcome of one {@link VerifyRunnerService.verifyPlan} call. */
export interface VerifyPlanResult {
  /** The task every recorded evidence entry in `results` was attributed to. */
  readonly task: { id: DocId; slug: string };
  readonly results: VerifyAcResult[];
  readonly skipped: VerifySkippedAc[];
  /** Selected criteria superseded by another spec's criterion: nothing was run or recorded for them. */
  readonly superseded: VerifySupersededAc[];
  /** Advisory notes (e.g. "parent spec not approved") — never affects `results`. */
  readonly warnings: string[];
}

// ─── Attested-Red Falsifier Runner (spec-falsifiability-reachability-a-
//     feedable-checkpoint-an §D2/D3/D4) ─────────────────────────────────────
//
// Closes the structural gap named in the governing spec's G2: ordinary
// `lore verify` execution (`verifyPlan`/`verifyAdhocTask`, `_runVerification`
// above) runs an AC's command against the CHECKED-IN tree — producing a red
// there would require the tree to be temporarily BROKEN, which no attested
// evidence-recording path can ever do. `VerifyRunnerService.verifyFalsifier`
// (below the class-opening comment) is the SEPARATE entry point that can: it
// creates a SCRATCH git worktree (never the caller's working tree — D3),
// materializes that worktree's dependencies (`materializeFalsifierDependencies`,
// `spec-a-falsifier-s-scratch-worktree-must-be-runnable-and` AC-SD-6 — see
// `_runFalsifier`'s own "Step 3.5" below), then runs a GREEN CONTROL — the
// AC's own command, UNMUTATED, in that SAME (now-materialized) scratch
// worktree — BEFORE applying anything (AC-FR-11, closing the false-match
// vector measured 2026-08-21: a scratch worktree missing `node_modules`, an
// untracked test file, or a gitignored `dist/lore` binary exits nonzero on
// its OWN, with no mutation involved, and no exit code can tell that apart
// from a genuine assertion failure — the distinguishing signal only exists in
// whether the UNMUTATED command already fails). Materialization moves
// "missing node_modules" from an ALWAYS cause of that failure to a cause the
// green control can actually get past — it does NOT remove the other two
// documented causes (an untracked dependency file, a gitignored `dist/lore`),
// which stay exactly as able to fail the green control as before
// (`spec-a-falsifier-s-scratch-worktree-must-be-runnable-and` AC-SD-7 —
// "the green control is not disarmed", `falsifier-dep-materialization.test.ts`
// describe "green control still fires"). A nonzero/timed-out green control —
// OR one that fails to LAUNCH at all (e.g. ENOENT on the scratch worktree's
// own copy of the command) — records `result: "inconclusive"` with NO
// `attestation` block and aborts before the mutation is even attempted —
// this path never mints a proven red out of an unrunnable environment, and
// never lets that same "unrunnable" fact vanish into an unrecorded error
// just because the failure happened one step earlier (at spawn, not exit).
// Only once the green control exits 0 does this path apply the AC's own DECLARED `falsifier` mutation
// (D2), run the AC's command again in that same isolated copy, and record a
// runner-issued `result: "expected-fail"` evidence row (`capture_source:
// "runner"`) ONLY when the observed exit code equals the EXACT value the
// falsifier declares (D4 — never "non-zero"). A mismatch, a missing
// declaration, or a mutation-apply failure (stale `find` text, a nonexistent
// `path`) all refuse loud and record NOTHING — this path never mints a
// passing red.
//
// The three functions below are PLAIN EXPORTED functions (not private class
// methods, and NOT constructor-injected ports like `executor`/`getPlanBundle`)
// so `attested-red.test.ts` can drive each step directly and prove isolation
// even for a run that never reaches the class's own cleanup `finally` block
// (a genuine crash mid-run, AC-FR-3's RED case) — see each function's own
// JSDoc for why they are deliberately NOT mockable.

/**
 * Cap for the falsifier run's recorded `output_tail` — same `CAPTURE_TAIL_CHARS` budget
 * `verify-executor.ts`'s `OUTPUT_TAIL_MAX_CHARS` uses. Kept as its OWN local
 * constant here rather than imported: that one lives in the bun-only
 * executor module this class must never import (class-level Invariants).
 */
const FALSIFIER_OUTPUT_TAIL_MAX_CHARS = CAPTURE_TAIL_CHARS;

/**
 * A scratch git worktree created by {@link createFalsifierScratchWorktree} —
 * `worktreeDir` is where a falsifier's mutation is applied and the AC's
 * command is spawned from; `parentDir` is its throwaway container (both
 * removed together by {@link removeFalsifierScratchWorktree}).
 */
export interface FalsifierScratchWorktree {
  readonly worktreeDir: string;
  readonly parentDir: string;
}

/**
 * Result of one {@link VerifyRunnerService.verifyFalsifier} call.
 *
 * `result` discriminates the TWO recordable outcomes (AC-FR-11):
 *   - `"expected-fail"` — the green control (unmutated command) exited 0, the
 *     mutation was applied, and the mutated command's exit code matched the
 *     falsifier's declared value exactly. `exit_code` is the MUTATED command's
 *     observed exit code. Mirrors this type's pre-AC-FR-11 sole behavior.
 *   - `"inconclusive"` — the green control itself exited nonzero (or timed
 *     out) BEFORE any mutation was attempted. `exit_code` is the GREEN
 *     CONTROL's own observed exit code (never a mutated-command value, since
 *     no mutation ran). The recorded evidence row carries no `attestation`.
 * A third outcome — the falsifier's declared exit code not matching the
 * mutated command's actual one — is NOT representable here: it is a
 * declaration bug, refused loud via `err(VALIDATION_ERROR)`, never reaching
 * this success type (unchanged from pre-AC-FR-11 behavior).
 */
export interface FalsifierRunResult {
  readonly task: { id: DocId; slug: string };
  readonly ac_id: string;
  /** The falsifier's declared value (echoed back for the caller's own reporting; not necessarily observed when `result === "inconclusive"`). */
  readonly expected_exit_code: number;
  /** See this interface's own header — the mutated command's exit code for `"expected-fail"`, the green control's for `"inconclusive"`. */
  readonly exit_code: number;
  readonly output_tail: string;
  readonly result: "expected-fail" | "inconclusive";
}

/**
 * Options for {@link createFalsifierScratchWorktree} — the AC-JV-3 hook that
 * lets a resolved-worktree caller carry its uncommitted state into the
 * scratch copy.
 */
export interface CreateFalsifierScratchWorktreeOpts {
  /** REQUIRED — the OS temp directory the scratch parent is created under (`Invocation.paths.tmpDir`; AS-26: no ambient read here). */
  tmpDir: string;
  /**
   * `true` iff `repoRoot` is itself a git worktree whose UNCOMMITTED (tracked,
   * modified) changes the falsifier's command must observe (AC-JV-3 — a
   * falsifier run's execution root has been resolved to a linked worktree via
   * `resolveVerifyExecutionRoot`/SPEC-063, not the corpus root). `HEAD` names
   * a COMMIT, never the working tree or index, so branching off it alone can
   * never see a modification nobody has committed yet — this flag instead
   * snapshots `repoRoot`'s dirty state via `git stash create` (a PLUMBING
   * command that returns a throwaway commit object WITHOUT touching the
   * working tree, the index, or the stash ref list — unlike `git stash push`/
   * `save`, so `repoRoot` itself is never mutated) and branches the scratch
   * worktree off THAT commit instead. `git stash create` prints nothing on a
   * clean tree (nothing to stash) — that case falls back to `HEAD`, which is
   * already the correct (and only) state a clean worktree has.
   *
   * Omitted or `false` — every caller before AC-JV-3, and every
   * `mode: "corpus_root"` resolution (the ordinary main-checkout path) — is
   * BYTE IDENTICAL to this function's pre-AC-JV-3 behavior: `git worktree add
   * --detach <dir> HEAD`, never shelling out to `git stash` at all.
   */
  captureUncommitted?: boolean;
}

/**
 * Creates an isolated SCRATCH git worktree off `repoRoot`'s current `HEAD` —
 * or, when {@link CreateFalsifierScratchWorktreeOpts.captureUncommitted} is
 * `true`, off a `git stash create` snapshot of `repoRoot`'s own uncommitted
 * state (AC-JV-3; see that option's own JSDoc for why) — never the working
 * tree itself (D3 — "attested reds run in an isolated worktree, never the
 * working tree"). Real IO: shells `git worktree add --detach` (and, when
 * requested, `git stash create` first) via `execFileSync`. Deliberately NOT
 * injectable (unlike this class's `executor`/`getPlanBundle` constructor
 * ports) — the isolation guarantee AC-FR-3 exists to prove is exactly that
 * this is REAL, never a test double standing in for it; a fake port here
 * would let the whole mechanism ship untested against the one property that
 * matters.
 *
 * Resolved 2026-08-11 (AC-JV-3, spec-judgment-surfaces-must-verify-before-they-certify-machine
 * §D5): before this, `_runFalsifier` always passed `VerifyRunnerService.config.repoRoot` here
 * unconditionally — the MAIN checkout whenever the caller stood inside a linked git worktree
 * (SPEC-063's `findLoreDbPath` fallback, since a linked worktree carries no `.lore/` of its own)
 * — so a falsifier run from a worktree silently mutated and compiled the main checkout's code,
 * never the caller's own worktree branch or uncommitted changes. `_runFalsifier` now resolves the
 * execution root through `resolveVerifyExecutionRoot` (SPEC-063) first and passes ITS `root` here,
 * with `captureUncommitted: true` iff that resolution's `mode` is `"worktree"` — see
 * `falsifier-execution-root.bun.test.ts` for the oracle (positive half PLUS the mandatory
 * `config.repoRoot` reverse control).
 *
 * @param repoRoot - The git repository to branch a scratch worktree from
 *   (`_runFalsifier`'s resolved execution root — `VerifyRunnerService.config.repoRoot` when no
 *   worktree-aware resolution was supplied, a caller's linked worktree root otherwise).
 * @param opts - See {@link CreateFalsifierScratchWorktreeOpts}. `tmpDir` is required; without
 *   `captureUncommitted` the behavior is today's default `HEAD`-only one.
 * @returns The created worktree's paths, or `STORE_ERROR` when the scratch
 *   temp directory can't be created, the uncommitted-state snapshot itself fails (a
 *   non-git `repoRoot`, a missing `git` binary), or `git worktree add` itself fails (a
 *   non-git `repoRoot`, a missing `git` binary, an unclean `HEAD`, etc.) —
 *   the caller never proceeds to apply a mutation without a confirmed-real
 *   worktree.
 *
 * @example
 * const result = createFalsifierScratchWorktree("/path/to/repo", { tmpDir: "/tmp" });
 * // result.ok && result.value.worktreeDir → e.g. "/tmp/lore-attested-red-xxxx/wt"
 * @example
 * // AC-JV-3 — branches off a linked worktree's UNCOMMITTED state instead of its last commit.
 * const result = createFalsifierScratchWorktree("/path/to/worktree", { tmpDir: "/tmp", captureUncommitted: true });
 */
export function createFalsifierScratchWorktree(
  repoRoot: string,
  opts: CreateFalsifierScratchWorktreeOpts,
): Result<FalsifierScratchWorktree, LoreError> {
  let parentDir: string;
  try {
    parentDir = mkdtempSync(join(opts.tmpDir, "lore-attested-red-"));
  } catch (error) {
    return err({
      code: "STORE_ERROR",
      message: `attested-red runner could not create a scratch temp directory: ${error instanceof Error ? error.message : String(error)}`,
      rule: "BR-249",
    });
  }
  // AC-AU-11: the owner marker lets `lore worktree sweep --apply` prove this scratch's run ended (pid dead) if the
  // process dies before its `finally`. Written BEFORE `git worktree add` so no registered scratch lacks it.
  const owner = writeScratchOwner(parentDir, process.pid);
  if (!owner.ok) {
    try {
      rmSync(parentDir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup of an empty scratch dir */
    }
    return err({
      code: "STORE_ERROR",
      message: `attested-red runner could not write the scratch owner marker in "${parentDir}": ${owner.reason}`,
      rule: "BR-249",
    });
  }
  // reason: `git worktree add <path>` REQUIRES `<path>` to not already exist
  // — `mkdtempSync` already created `parentDir` itself, so the worktree
  // target is a NOT-YET-EXISTING child of it (`wt`), never `parentDir`
  // directly (git would refuse an existing, non-empty directory).
  const worktreeDir = join(parentDir, "wt");

  // AC-JV-3 — resolve which commit-ish to branch the scratch worktree from.
  // Default "HEAD" is BYTE IDENTICAL to pre-AC-JV-3 behavior; `captureUncommitted`
  // swaps it for a `git stash create` snapshot ONLY when the caller asked for one
  // (see this function's own JSDoc + `CreateFalsifierScratchWorktreeOpts`).
  let checkoutRef = "HEAD";
  if (opts.captureUncommitted === true) {
    try {
      const stashSha = execFileSync("git", ["stash", "create"], {
        cwd: repoRoot,
        stdio: ["ignore", "pipe", "pipe"],
      })
        .toString()
        .trim();
      // reason: empty stdout means "nothing to stash" (a clean worktree) — NOT
      // an error; `checkoutRef` stays "HEAD", the correct (and only) state a
      // clean worktree has. `git stash create` never mutates `repoRoot` either
      // way (see the JSDoc above for why it's safe to call unconditionally).
      if (stashSha.length > 0) {
        checkoutRef = stashSha;
      }
    } catch (error) {
      try {
        rmSync(parentDir, { recursive: true, force: true });
      } catch {
        /* best-effort cleanup of an empty scratch dir */
      }
      return err({
        code: "STORE_ERROR",
        message: `attested-red runner could not snapshot "${repoRoot}"'s uncommitted state via "git stash create": ${error instanceof Error ? error.message : String(error)}`,
        rule: "BR-249",
      });
    }
  }

  try {
    execFileSync("git", ["worktree", "add", "--detach", worktreeDir, checkoutRef], {
      cwd: repoRoot,
      stdio: "pipe",
    });
  } catch (error) {
    // reason: best-effort — `git worktree add` itself failed, so nothing is
    // checked out at `worktreeDir` yet; only the empty `parentDir` needs
    // cleanup. Swallowing THIS cleanup failure is safe: at worst it leaks an
    // empty temp directory, never the original repo's tree.
    try {
      rmSync(parentDir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup of an empty scratch dir */
    }
    return err({
      code: "STORE_ERROR",
      message: `attested-red runner could not create a scratch git worktree from "${repoRoot}": ${error instanceof Error ? error.message : String(error)}`,
      rule: "BR-249",
    });
  }
  return ok({ worktreeDir, parentDir });
}

/**
 * Removes a scratch worktree created by {@link createFalsifierScratchWorktree}.
 * BEST-EFFORT and never throws: a removal failure leaves an ORPHANED scratch
 * directory (wasted disk) but can NEVER retroactively corrupt the original
 * repo's tracked files or index — `git worktree add`/`remove` only ever
 * write under `.git/worktrees/<id>/` (administrative metadata disjoint from
 * the working tree `git status --porcelain` inspects) plus the scratch
 * directory itself, never `repoRoot`'s own checked-out files. AC-FR-3's
 * isolation guarantee holds independently of whether this cleanup ever runs
 * at all (a genuine crash between {@link applyFalsifierMutation} and this
 * call leaves the scratch worktree orphaned, never the original tree
 * touched — see that function's own JSDoc for where the mutation actually
 * lands).
 *
 * @param repoRoot - The SAME repo passed to {@link createFalsifierScratchWorktree}.
 * @param scratch - The handle that call returned.
 */
export function removeFalsifierScratchWorktree(
  repoRoot: string,
  scratch: FalsifierScratchWorktree,
): void {
  try {
    execFileSync("git", ["worktree", "remove", "--force", scratch.worktreeDir], {
      cwd: repoRoot,
      stdio: "pipe",
    });
  } catch {
    // reason: best-effort — see this function's own JSDoc for why a failure
    // here is a disk leak, never a working-tree correctness issue.
  }
  try {
    rmSync(scratch.parentDir, { recursive: true, force: true });
  } catch {
    /* best-effort — same reasoning as above */
  }
}

/**
 * Applies a DECLARED falsifier's mutation INSIDE `worktreeDir` — a literal
 * find/replace against the file at `worktreeDir/<falsifier.path>`. Never
 * reads or writes ANY path outside `worktreeDir` (D3's isolation guarantee:
 * the caller always passes a SCRATCH worktree's own directory here, never
 * the real working tree — this function has no way to reach the latter, it
 * takes NO `repoRoot` parameter at all, by construction).
 *
 * Refuses loud (never a silent no-op) when the declared `path` doesn't exist
 * in the worktree, or exists but no longer contains the declared `find` text
 * — both are declaration bugs (a stale falsifier whose target file changed
 * since it was authored), and recording a red anyway would misattribute the
 * mutation's actual effect.
 *
 * @param worktreeDir - A scratch worktree's own directory (`.worktreeDir`
 *   from {@link createFalsifierScratchWorktree}'s return value) — NEVER a
 *   repo's real working tree.
 * @param falsifier - The declared mutation (`AcceptanceCriterion.verify.falsifier`,
 *   `acFalsifierSchema` in `@lore/core`).
 * @returns `ok(undefined)` once the file is mutated on disk; `VALIDATION_ERROR`
 *   naming the missing path/text, or `STORE_ERROR` on a write failure.
 *
 * @example
 * applyFalsifierMutation("/tmp/lore-attested-red-xxxx/wt", {
 *   path: "src/target.txt",
 *   find: "MAGIC_MARKER",
 *   replace: "",
 *   expected_exit_code: 7,
 * });
 */
export function applyFalsifierMutation(
  worktreeDir: string,
  falsifier: AcFalsifier,
): Result<void, LoreError> {
  const targetPath = join(worktreeDir, falsifier.path);
  let content: string;
  try {
    content = readFileSync(targetPath, "utf8");
  } catch (error) {
    return err({
      code: "VALIDATION_ERROR",
      field: "falsifier.path",
      message: `declared falsifier path "${falsifier.path}" does not exist inside the scratch worktree: ${error instanceof Error ? error.message : String(error)}`,
      value: falsifier.path,
      rule: "BR-190",
    });
  }
  if (!content.includes(falsifier.find)) {
    return err({
      code: "VALIDATION_ERROR",
      field: "falsifier.find",
      message: `declared falsifier 'find' text was not found in "${falsifier.path}" — the declaration is stale (the file no longer contains it). Refused rather than silently applying nothing.`,
      value: falsifier.find,
      rule: "BR-190",
    });
  }
  const mutated = content.replace(falsifier.find, falsifier.replace);
  try {
    writeFileSync(targetPath, mutated, "utf8");
  } catch (error) {
    return err({
      code: "STORE_ERROR",
      message: `attested-red runner could not write the mutated file "${falsifier.path}": ${error instanceof Error ? error.message : String(error)}`,
      rule: "BR-249",
    });
  }
  return ok(undefined);
}

// ─── VerifyRunnerService ───────────────────────────────────────────────────

export class VerifyRunnerService {
  /**
   * @param getPlanBundle - Bound port resolving `{plan, spec?, tasks[]}`; production
   *   wiring is `corpusService.getPlanBundle.bind(corpusService)` (app.ts). This
   *   service never imports CorpusService directly (services don't cross-import).
   * @param recordVerifiedEvidence - Bound port appending runner-attested evidence;
   *   production wiring is `taskWorkflowService.recordVerifiedEvidence.bind(taskWorkflowService)`.
   *   This is the SOLE way `attestation` reaches storage (SPEC-039 §2 D2) — no other
   *   code path in this service touches evidence directly.
   * @param executor - Bound port running one spawn spec; production wiring is
   *   `verify-executor.ts::executeVerifySpawnSpec`. Injected (not imported) so this
   *   service and its tests never depend on the bun-only executor module (D3).
   * @param config - `{ repoRoot, defaultTimeoutMs, claimTtlMinutes, requireCommandApproval,
   *   envAllowlist, envPassthroughAll, processEnv }` — scalar config, not a behavioral
   *   port; `repoRoot` and `defaultTimeoutMs` feed `buildVerifySpawnSpec`,
   *   `claimTtlMinutes` feeds `resolveTargetTask`'s staleness check (same TTL
   *   TaskWorkflowService and CorpusService already resolve via `resolveClaimTtlMinutes`
   *   — one resolution path, not a second config read). SPEC-039 §M2 additions:
   *   `requireCommandApproval` gates step ②.5 (resolved via
   *   `resolveVerifyRequireCommandApproval(config)` in `@lore/core`);
   *   `envAllowlist`/`envPassthroughAll` (resolved via `resolveVerifyEnvConfig`) and
   *   `processEnv` (a captured `process.env` snapshot — `app.ts` composition time,
   *   mirroring how `repoRoot` is captured from `process.cwd()` there too) feed the
   *   ONE `resolveVerifyEnv` call made per `verifyPlan` invocation.
   * @param checkBinaryFreshness - OPTIONAL build-freshness port (Part A) — see the
   *   class-level Invariants entry. Omitted in every existing call site (`app.ts`'s
   *   4-arg construction stays valid); production code that DOES wire it would pass
   *   a thunk performing the real `stat()` calls. When omitted, this class falls
   *   back to its own private `node:fs`-based check computed against `config.repoRoot`.
   */
  constructor(
    private readonly getPlanBundle: (
      planIdOrSlug: string,
    ) => Promise<Result<PlanBundle, LoreError>>,
    private readonly recordVerifiedEvidence: (
      idOrSlug: string,
      entry: VerifiedEvidenceInput,
      nowIso: string,
    ) => Promise<Result<DocRecord, LoreError>>,
    private readonly executor: (
      spec: VerifySpawnSpec,
    ) => Promise<Result<VerifyExecutionResult, LoreError>>,
    private readonly config: {
      repoRoot: string;
      defaultTimeoutMs: number;
      claimTtlMinutes: number;
      /** SPEC-039 §M2 — command-provenance approval gate on/off. Default true upstream (config schema). */
      requireCommandApproval: boolean;
      /** SPEC-039 §M2 — additive env-var allowlist beyond the built-in default set. */
      envAllowlist: string[];
      /** SPEC-039 §M2 — escape hatch restoring full env passthrough (bypasses the allowlist). */
      envPassthroughAll: boolean;
      /** SPEC-039 §M2 — parent environment snapshot fed to `resolveVerifyEnv`. */
      processEnv: Readonly<Record<string, string | undefined>>;
      /** The OS temp directory falsifier scratch worktrees are created under (`Invocation.paths.tmpDir`). */
      tmpDir: string;
      /** Where the runner's advisories go (a kept falsifier scratch worktree); absent (bare tests) -> not printed. */
      warn?: WarnSink;
    },
    private readonly checkBinaryFreshness?: () => BinaryFreshnessVerdict,
    /** Existence probe behind the AC-TG-6 missing-oracle-file check; real `node:fs` by default, a fake in unit tests. */
    private readonly fileExists: FileExistsPort = existsSync,
    /**
     * SPEC-143 AC-CT-8 — when a peer holds the oracle lock the stamp step marks SKIPPED and
     * continues (never blocks, never changes the verify result). Omitted -> no occupancy check.
     */
    private readonly stateBindingOccupancy?: StateBindingOccupancyPort,
    /**
     * AC-AU-11 — removes the falsifier scratch worktree through decide(worktree-remove) (ignored-file rule included).
     * Omitted (bare unit constructions) -> the legacy unconditional {@link removeFalsifierScratchWorktree}; app.ts
     * wires `WorktreeRemovalService` in both composition roots.
     */
    private readonly scratchRemoval?: ScratchRemovalPort,
  ) {}

  /**
   * Wires the decide() seam of `--yes` / `allow_new_commands` for a command with no attested row on the task
   * (AC-AU-7). Set by the composition root; absent = the blanket approval of an unapproved command is refused loudly.
   */
  setOverrideDecisionPort(port: OverrideDecisionPort): this {
    this.overrideDecisions = port;
    return this;
  }

  private overrideDecisions: OverrideDecisionPort | undefined;

  /**
   * Recursively finds the newest `mtimeMs` among `.ts` files under `dir`
   * (returns `0` when `dir` doesn't exist or contains none) — the same
   * algorithm `tests/integration/helpers/assert-fresh-binary.ts::newestTsMtimeMs`
   * uses, duplicated here (not imported — that module lives under `tests/`,
   * not `src/`) per the task's "leave the helper and just share the pure
   * predicate" guidance.
   */
  private static _newestTsMtimeMsUnder(dir: string): number {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      let newest = 0;
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          const childNewest = VerifyRunnerService._newestTsMtimeMsUnder(fullPath);
          if (childNewest > newest) newest = childNewest;
        } else if (entry.isFile() && entry.name.endsWith(".ts")) {
          const mtimeMs = statSync(fullPath).mtimeMs;
          if (mtimeMs > newest) newest = mtimeMs;
        }
      }
      return newest;
    } catch {
      // reason: an unreadable/missing directory degrades to "no source files
      // found here" (0), never an exception — mirrors
      // assert-fresh-binary.ts's existsSync-guarded original, and keeps this
      // freshness check fail-open per the module's own invariant.
      return 0;
    }
  }

  /**
   * Default `checkBinaryFreshness` implementation — real `node:fs` reads
   * against `config.repoRoot`. Only ever called when the constructor received
   * no `checkBinaryFreshness` port AND at least one AC's command references
   * the compiled binary (`commandReferencesCompiledBinary`); every unit test
   * in this class's suite injects a fake port instead, so this method's own
   * filesystem access is exercised only in production.
   */
  private _computeRealBinaryFreshness(): BinaryFreshnessVerdict {
    const binPath = join(this.config.repoRoot, "dist", "lore");
    const binaryMtimeMs = existsSync(binPath) ? statSync(binPath).mtimeMs : null;
    const newestSourceMtimeMs = Math.max(
      VerifyRunnerService._newestTsMtimeMsUnder(join(this.config.repoRoot, "packages", "lore", "src")),
      VerifyRunnerService._newestTsMtimeMsUnder(join(this.config.repoRoot, "packages", "core", "src")),
    );
    return judgeBinaryFreshness({ binaryMtimeMs, newestSourceMtimeMs });
  }

  /**
   * Step ②.4 — the declared-scope pre-flight: decides WHICH declared criteria
   * this run may touch, or REFUSES the whole run before any command executes.
   * Pure over its arguments (no IO, no state) — the only reason it is a method
   * rather than a free function is that its four refusals are part of this
   * service's contract surface.
   *
   * Three-valued by construction, reading the task's declaration through
   * `extractDeclaredAcScope` (`@lore/core`, which preserves absent-vs-empty):
   *
   * | declared `ac_scope` | `--ac` absent                     | `--ac` present                                    |
   * |---|---|---|
   * | ABSENT (`undefined`) | REFUSE, naming `lore scope add`  | run exactly the named ids (D2's stated escape)     |
   * | EMPTY (`[]`)         | REFUSE (`declares no acceptance criterion`) | REFUSE, same message — an un-declaration claims nothing, with or without a flag |
   * | POPULATED            | run `scope ∩ declared criteria`  | REFUSE if any named id is outside the scope, else run the named ids |
   *
   * A POPULATED scope whose ids match NO declared criterion is also refused: a
   * run selecting zero criteria would attest nothing while exiting 0, which is
   * the vacuous-pass shape this whole contract exists to remove. This is the
   * READ-side refusal `acScopeArraySchema`'s invariant (`phase.ts`) delegates
   * here — cross-entity membership is deliberately unchecked at the writer.
   * A scope that matches SOME criteria is fine: an `ai`/`human`-mode criterion
   * in scope is legitimately claimed and simply lands in `result.skipped`.
   *
   * @param criteria - every criterion declared on the parent spec (already
   *   `specAcceptanceCriteriaSchema`-parsed, non-empty)
   * @param task - the resolved target task, the SOLE owner of the declaration
   * @param specSlug - parent spec slug, for the dangling-scope diagnostic only
   * @param acIds - `opts.acIds`, already validated to name only declared ids
   * @returns the criteria this run may execute/record, or a `VALIDATION_ERROR`
   *   (CLI exit 4, stderr) whose message carries the pinned literal for its case
   */
  private _selectDeclaredScopeCriteria(
    criteria: AcceptanceCriterion[],
    task: DocRecord,
    specSlug: string,
    acIds: string[] | undefined,
  ): Result<AcceptanceCriterion[], LoreError> {
    const declared = extractDeclaredAcScope(task);
    const selectNamed = (ids: string[]): AcceptanceCriterion[] => {
      const idSet = new Set(ids);
      return criteria.filter((c) => idSet.has(c.id));
    };

    if (declared === undefined) {
      if (acIds !== undefined) return ok(selectNamed(acIds));
      return err({
        code: "VALIDATION_ERROR",
        field: "ac_scope",
        message:
          `task "${task.slug}" has no declared ac_scope, so lore verify cannot know which ` +
          "acceptance criteria it claims — an unknown scope is never promoted to the spec's " +
          `full scope. Declare it with '${SCOPE_WRITER_HINT} ${task.slug} <AC-ID>' ` +
          "(repeatable), or name the criteria for this run explicitly with --ac <AC-ID>.",
        value: task.slug,
        rule: "BR-164",
      });
    }

    if (declared.length === 0) {
      return err({
        code: "VALIDATION_ERROR",
        field: "ac_scope",
        message:
          `task "${task.slug}" ${EMPTY_SCOPE_LITERAL} — its ac_scope is an EMPTY array, an ` +
          "explicit un-declaration (a different state from an absent field), so there is " +
          `nothing for lore verify to attest. Re-declare with '${SCOPE_WRITER_HINT} ` +
          `${task.slug} <AC-ID>' before verifying.`,
        value: task.slug,
        rule: "BR-165",
      });
    }

    if (acIds !== undefined) {
      const offending = acIds.filter((id) => !isAcInDeclaredScope(declared, id));
      if (offending.length > 0) {
        return err({
          code: "VALIDATION_ERROR",
          field: "acIds",
          message:
            `--ac named acceptance criterion id(s) outside task "${task.slug}"'s declared ` +
            `ac_scope: ${offending.join(", ")}. That task declares: ${declared.join(", ")}. ` +
            "lore verify never attests an AC the target task does not claim — widen the " +
            `declaration with '${SCOPE_WRITER_HINT} ${task.slug} ${offending.join(" ")}', or ` +
            "retarget the run with --task.",
          value: offending,
          rule: "BR-167",
        });
      }
      return ok(selectNamed(acIds));
    }

    const inScope = criteria.filter((c) => isAcInDeclaredScope(declared, c.id));
    if (inScope.length === 0) {
      return err({
        code: "VALIDATION_ERROR",
        field: "ac_scope",
        message:
          `task "${task.slug}"'s declared ac_scope matches none of the acceptance criteria ` +
          `on spec "${specSlug}" — scope ids: ${declared.join(", ")}. A run selecting zero ` +
          "criteria would attest nothing while exiting 0, so it is refused: fix the scope " +
          `('${SCOPE_WRITER_HINT}' / 'lore scope rm') or the spec's acceptance_criteria.`,
        value: declared,
        rule: "BR-166",
      });
    }
    return ok(inScope);
  }

  /**
   * Shared execution+recording tail (steps ③④) for BOTH `verifyPlan` (plan-owned
   * tasks, resolved via `getPlanBundle` + claim-based `resolveTargetTask`) and
   * {@link verifyAdhocTask} (SPEC-069 ad-hoc tasks — task-the-ad-hoc-task-channel-
   * has-no-attested-evidence-path-lore — resolved via an explicit task + a
   * searched-for governing spec). Extracted so the two entry points, which reach
   * `{task, spec, selectedCriteria}` through completely different resolution
   * paths, share IDENTICAL execution semantics: the M2 command-provenance
   * approval gate, the execution-root/env resolution, the build-freshness and
   * SPEC-061 completeness guards, and the sole `recordVerifiedEvidence`
   * attestation write. Neither caller may skip or reorder any of this — see the
   * class-level JSDoc's four-step pipeline. Behavior-preserving extraction: this
   * method's body is `verifyPlan`'s pre-existing step-③④ code, unchanged
   * (REGRESSION — `verify-runner-service.test.ts`'s pre-existing suite exercises
   * this exact logic through `verifyPlan` and passes unmodified).
   *
   * @param selectedCriteria - Already `_selectDeclaredScopeCriteria`-filtered
   *   criteria (both callers run that same pre-flight before reaching here).
   * @param task - The resolved target task evidence is recorded against.
   * @param spec - The resolved governing spec (consulted for the draft/active
   *   advisory only — no other field of it is read here).
   * @param opts - Same `VerifyPlanOpts` the public entry points receive.
   * @param recordAcRef - `true` for BOTH `verifyPlan` (plan-owned tasks) AND
   *   {@link verifyAdhocTask} (SPEC-069 ad-hoc tasks, AC-069-15,
   *   task-verifyadhoctask-stamps-ac-ref-on-its-runner-attested) — every
   *   runner-attested evidence entry this method writes carries `ac_ref` equal
   *   to the executed criterion's id. Kept as an explicit caller-supplied
   *   boolean (not hardcoded `true` inline) so this shared tail's contract is
   *   spelled out at both call sites, not assumed. HISTORICAL (measured
   *   2026-08-01, fixed by task-an-ad-hoc-task-s-attested-evidence-cannot-carry-
   *   ac-ref): `TaskWorkflowService.appendEvidenceEntry` (the shared
   *   implementation behind the injected `recordVerifiedEvidence` port) used to
   *   cross-validate any supplied `ac_ref` by calling
   *   `resolveDeclaredAcIds(task.parent_id)` UNCONDITIONALLY — which
   *   hard-requires `task.parent_id` to resolve to a `type: "plan"` document. An
   *   ad-hoc task's `parent_id` is the corpus root PRD, so that call refused
   *   `Expected a plan document; got type 'prd'` for EVERY ad-hoc task, one layer
   *   DEEPER than `VerifyRunnerService` itself — which is why `verifyAdhocTask`
   *   used to pass `recordAcRef: false` here. `appendEvidenceEntry` now BRANCHES
   *   on `task.extra.adhoc` — an ad-hoc task's `ac_ref` resolves via the injected
   *   `resolveAdhocGoverningAcIds` port (`CorpusService.resolveDeclaredAcIdsForAdhocTask`,
   *   which runs the SAME `resolveRecordedGoverningSpec` lookup this class's own
   *   `verifyAdhocTask` runs, `@lore/core`) instead of the plan-only walk — so
   *   supplying `ac_ref` from THIS method for an ad-hoc task now succeeds, and
   *   an undeclared criterion id is refused (AC-069-16 — no new bypass) exactly
   *   as the plan-owned path already was.
   */
  private async _runVerification(
    selectedCriteria: AcceptanceCriterion[],
    task: DocRecord,
    spec: DocRecord,
    opts: VerifyPlanOpts,
    recordAcRef: boolean,
  ): Promise<Result<VerifyPlanResult, LoreError>> {
    const scriptCriteria: ScriptAcceptanceCriterion[] = [];
    const skipped: VerifySkippedAc[] = [];
    // D15 — a criterion superseded by another spec's criterion is never run or recorded (BR-163); it is listed.
    const superseded: VerifySupersededAc[] = [];
    for (const criterion of selectedCriteria) {
      if (criterion.superseded_by !== undefined) {
        superseded.push({ ac_id: criterion.id, superseded_by: criterion.superseded_by });
      } else if (criterion.verify.mode === "script") {
        scriptCriteria.push(criterion as ScriptAcceptanceCriterion);
      } else {
        skipped.push({ ac_id: criterion.id, mode: criterion.verify.mode });
      }
    }

    const warnings: string[] = [];
    if (spec.status !== "approved" && spec.status !== "active") {
      warnings.push(
        `Spec "${spec.slug}" is not approved/active (status: ${spec.status}) — ` +
          `lore verify still ran (SPEC-039 §3: not a hard gate).`,
      );
    }

    // SPEC-063 §Design Decisions D2 — resolved EXACTLY ONCE per run (doesn't vary
    // per-AC, same "resolve once, thread down" shape resolvedEnv below uses).
    // `opts.executionRoot` is the CLI adapter's own pre-resolution (this service
    // never probes git); its absence (e.g. an MCP caller) falls back to the
    // pre-SPEC-063 constant — byte-identical for that caller (REGRESSION,
    // AC-063-3). A fallback-triggered `warning` (an anomalous/unresolved git
    // probe) is surfaced the same way the draft-spec advisory above is.
    const resolvedExecutionRoot = opts.executionRoot ?? {
      root: this.config.repoRoot,
      mode: "corpus_root" as const,
    };
    if (resolvedExecutionRoot.warning !== undefined) {
      warnings.push(resolvedExecutionRoot.warning);
    }

    // SPEC-039 §M2 — env resolved EXACTLY ONCE per run (doesn't vary per-AC).
    const resolvedEnv = resolveVerifyEnv(this.config.processEnv, {
      allowlist: this.config.envAllowlist,
      passthroughAll: this.config.envPassthroughAll,
    });

    // reason: AC-AU-7 — `--yes` / `allow_new_commands` is a blanket self-approval, so each command it would approve (no
    // attested row on this task, the SPEC-039 §M2 scope) is DECIDED first (class verify-new-command), BEFORE any
    // command runs or any evidence row is written: an escalation aborts the whole run with nothing recorded (exit 4,
    // pending decision named). Subject = task + AC, version = the command text, so a changed command is a new subject.
    if (this.config.requireCommandApproval && opts.allowNewCommands === true) {
      for (const criterion of scriptCriteria) {
        if (isApprovedVerifyCommand(task, criterion.verify.command)) continue;
        const decided = await requireOverrideAuto(this.overrideDecisions, {
          classId: "verify-new-command",
          subject: {
            id: `${task.slug}#${criterion.id}`,
            version: createHash("sha256").update(criterion.verify.command).digest("hex").slice(0, 16),
          },
          summary: `verify ${criterion.id} --yes on task ${task.slug} (command has no attested row on this task)`,
          change: { document: task.slug, ac_id: criterion.id, command: criterion.verify.command },
        });
        if (!decided.ok) return decided;
      }
    }

    // ③④ execute + record, one script-mode AC at a time
    const results: VerifyAcResult[] = [];
    const completedAcIds: string[] = [];
    // Part A — computed AT MOST ONCE per run (the binary's freshness doesn't vary
    // per-AC, same "resolve once, thread down" shape resolvedExecutionRoot/resolvedEnv
    // above use), and ONLY when some AC's command actually references the binary.
    let cachedBinaryFreshness: BinaryFreshnessVerdict | undefined;
    for (const criterion of scriptCriteria) {
      // ②.5 SPEC-039 §M2 — command-provenance approval gate. A command absent from
      // the task's evidence history is "new/changed"; `firstSeen` also feeds the
      // attestation annotation below REGARDLESS of whether the gate is enabled.
      const firstSeen = !isApprovedVerifyCommand(task, criterion.verify.command);
      if (this.config.requireCommandApproval && firstSeen && opts.allowNewCommands !== true) {
        const confirmed =
          opts.confirmUnapprovedCommand !== undefined
            ? await opts.confirmUnapprovedCommand({
                ac_id: criterion.id,
                command: criterion.verify.command,
              })
            : false;
        if (!confirmed) {
          // Fail-loud abort (SPEC-039 §4 D6 abort semantics, applied to the M2 gate)
          // — no partial ambiguity. Names every AC already recorded before the abort,
          // same accounting the launch-failure abort below uses.
          return err({
            code: "NEEDS_APPROVAL",
            message:
              `lore verify aborted at AC "${criterion.id}" — command is new/changed and was ` +
              `not approved. ${completedAcIds.length} AC(s) already recorded before the abort: ` +
              `${completedAcIds.length > 0 ? completedAcIds.join(", ") : "none"}. ` +
              "Pass --allow-new-commands to approve " +
              "automatically, or run interactively (TTY, no --json) to confirm.",
            command: criterion.verify.command,
            ac_id: criterion.id,
            rule: "BR-171",
          });
        }
      }

      // SPEC-063 §Design Decisions D2 — spawns from the RESOLVED execution root,
      // not unconditionally `this.config.repoRoot` (the pre-SPEC-063 corpus-root
      // constant that silently mis-executed against the main checkout when the
      // caller was actually standing inside a linked worktree).
      // reason: `acRef` is gated on the SAME `recordAcRef` flag the `ac_ref` evidence
      // field below is (spec-evidence-output-tail-integrity-a-self-reported-non-pass
      // §D4) — the runner should only prefer an AC-witnessing output_tail window when
      // the resulting row will actually carry that ac_ref, keeping the two in lockstep
      // rather than letting the tail witness an id the row itself doesn't declare.
      const spawnSpec = buildVerifySpawnSpec(criterion, {
        repoRoot: resolvedExecutionRoot.root,
        defaultTimeoutMs: this.config.defaultTimeoutMs,
        ...(resolvedEnv !== undefined ? { env: resolvedEnv } : {}),
        ...(recordAcRef ? { acRef: criterion.id } : {}),
      });

      // reason: spec-test-governance-guards-that-refuse-bad-tests-declared AC-TG-6 / baseline AS-17 — a command
      // that names a test file absent from every plausible root cannot be measured: no runner can attest a file
      // it never loaded. The AC is recorded `inconclusive` (not measured) with the missing path in its output;
      // NO process is spawned, so no exit code is invented — `exit_code: -1` marks "nothing ran" in the attestation.
      const missingOracleFiles = findMissingOracleFiles(criterion.verify.command, {
        cwd: resolvedExecutionRoot.root,
        corpusRoot: this.config.repoRoot,
        fileExists: this.fileExists,
      });
      // SPEC-143 AC-CT-5 — the PRE read of the stamp, taken immediately before the command
      // can run; the POST read is `gitState` below, immediately after it ran.
      // SPEC-143 AC-CT-8 — occupancy is read BEFORE the oracle runs: a peer holding the checkout-level
      // lock means no verdict about the state can be certified, and the step must not wait for it.
      const occupancy = this.stateBindingOccupancy?.probe(resolvedExecutionRoot.root);
      if (occupancy?.kind === "unmeasured") {
        warnings.push(
          `AC "${criterion.id}": oracle-lock occupancy could not be read (${occupancy.reason}) — the state-binding check ran as if the lock were free`,
        );
      }
      const preRunGitState = probeGitState(resolvedExecutionRoot.root);
      const execResult: Result<VerifyExecutionResult, LoreError> =
        missingOracleFiles.length > 0
          ? ok({
              exitCode: MISSING_ORACLE_FILE_EXIT_CODE,
              outputTail: `oracle file missing: ${missingOracleFiles.join(", ")} (no command was run; AC not measured)`,
              durationMs: 0,
              timedOut: false,
            })
          : await this.executor(spawnSpec);
      if (!execResult.ok) {
        // Fail-loud abort (SPEC-039 §4 D6) — no partial ambiguity. Names every AC
        // already recorded (with attested evidence) before this abort.
        const detail =
          "message" in execResult.error ? execResult.error.message : execResult.error.code;
        return err({
          code: "STORE_ERROR",
          message:
            `lore verify aborted at AC "${criterion.id}" — command failed to launch (${detail}). ` +
            `${completedAcIds.length} AC(s) already recorded before the abort: ` +
            `${completedAcIds.length > 0 ? completedAcIds.join(", ") : "none"}.`,
          rule: "BR-175",
        });
      }

      const { exitCode, outputTail, durationMs, timedOut } = execResult.value;
      let verifyResult: "pass" | "fail" | "inconclusive" = deriveVerifyResult(exitCode, timedOut);
      // Captured BEFORE either downgrade guard below may mutate `verifyResult` —
      // both Part A (freshness) and Part B/SPEC-061 (completeness) are
      // INDEPENDENT signals over the same "the process actually exited 0"
      // fact, so one downgrading `verifyResult` to "inconclusive" must never
      // suppress the other's own check (both are informative on the result;
      // see the combined-signal REGRESSION test in this file's sibling suite).
      const executedSuccessfully = verifyResult === "pass";
      if (missingOracleFiles.length > 0) {
        verifyResult = "inconclusive";
        warnings.push(
          `AC "${criterion.id}": oracle file missing: ${missingOracleFiles.join(", ")} — ` +
            "the command was not run and the AC is NOT MEASURED (an earlier attested pass no " +
            "longer counts). Repoint the command with `lore ac set --command` to an existing file.",
        );
      }

      // ③.3 spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a §M6.2
      // — discovery-refusal guard. A test-runner process that exits nonzero
      // because it found NO matching test file (never because anything it ran
      // FAILED) is a ZERO-EXECUTION event, not a genuine red — every runner
      // this repo uses returns the SAME exit code (1) for both cases, so exit
      // code alone cannot tell them apart (§M6.1's whole premise). Runs on the
      // branch that would otherwise ALREADY be "fail" from a plain nonzero
      // exit (excludes a timeout deliberately — a watchdog kill is a
      // categorically different signal than "found nothing", even if the
      // truncated tail happens to contain a matching phrase by coincidence)
      // AND ONLY for the "test" oracle family, mirroring the SAME scope the
      // completeness guard below uses. A match downgrades to "inconclusive"
      // (never silently stays "fail", and never "pass" — §Design D3) so a
      // mistyped/not-yet-written test path can no longer mint a permanent,
      // indistinguishable-from-a-real-red `fail` (the defect this task
      // fixes). No match (including every genuine assertion-failure tail,
      // which never carries one of these phrases — see
      // `findDiscoveryRefusal`'s own mutual-exclusion invariant) leaves
      // `verifyResult` exactly as `deriveVerifyResult` already computed it.
      if (!executedSuccessfully && !timedOut && missingOracleFiles.length === 0 && criterion.verify.oracle === "test") {
        const refusal = findDiscoveryRefusal(outputTail);
        if (refusal !== null) {
          verifyResult = "inconclusive";
          warnings.push(
            `AC "${criterion.id}": ${refusal.runner} reported a discovery refusal ` +
              `("${refusal.evidence}") — no test ran, so exit code ${exitCode} cannot be ` +
              "recorded as a fail. Fix the command's test path/filter and re-verify.",
          );
        }
      }

      // ③.4 build-freshness precheck (Part A, "verify trust extensions" task) —
      // applies to ANY oracle kind (not just "test") whose command spawns the
      // compiled binary; a command that doesn't reference it never even calls
      // the port.
      let binaryFreshness: BinaryFreshnessVerdict | undefined;
      if (executedSuccessfully && commandReferencesCompiledBinary(criterion.verify.command)) {
        if (cachedBinaryFreshness === undefined) {
          cachedBinaryFreshness = (
            this.checkBinaryFreshness ?? (() => this._computeRealBinaryFreshness())
          )();
        }
        binaryFreshness = cachedBinaryFreshness;
        if (binaryFreshness !== "fresh") {
          verifyResult = "inconclusive";
          warnings.push(
            `AC "${criterion.id}": dist/lore is ${binaryFreshness} — run 'bun run build' ` +
              "before trusting this attested result.",
          );
        }
      }

      // SPEC-061 §Scope D3 — attestation-completeness guard. Runs ONLY when
      // the process actually exited 0 (gated on `executedSuccessfully`,
      // computed BEFORE the ③.3 discovery-refusal check above could have
      // downgraded `verifyResult` — so a discovery refusal never reaches this
      // guard at all, never mind gets asked "how many files ran"). Also NOT
      // the possibly-already-downgraded `verifyResult` for the SAME reason
      // Part A's freshness check isn't, either — one downgrade must never
      // suppress a sibling's own independent check.
      //
      // HISTORICAL — this comment used to assert, unconditionally, "a nonzero
      // exit/timeout is already fail, completeness is irrelevant to it".
      // THAT assumption was itself the defect
      // spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a fixes
      // (§M6.2): a discovery refusal is a ZERO-EXECUTION nonzero exit for
      // which "how many files ran" is not merely irrelevant, it is
      // UNANSWERABLE — and it must never be recorded as the SAME "fail" a
      // genuine assertion failure earns. The corrected, narrower statement:
      // a nonzero exit/timeout that ③.3 did NOT recognise as a discovery
      // refusal is still "fail", and completeness is still irrelevant to
      // THAT (now correctly scoped) case.
      //
      // Scoped ONLY to the "test" oracle family (tsc/lint/build/e2e/other
      // have different zero-work-green modes and are explicitly OUT of this
      // guard's scope). A zero/under-match downgrades the recorded result to
      // "inconclusive" — NEVER "pass" — so a wrong test-path filter that
      // silently matched fewer files than declared can never masquerade as a
      // real attested pass again (the AC-060-7 incident this guard closes).
      // Part B extends this with a `-t`/`--testNamePattern` matched-CASE
      // check (`hasCaseFilter`) — a filterless command's `judgeCompleteness`
      // call is byte-identical to pre-Part-B.
      let completeness: CompletenessVerdict | undefined;
      let executedFiles: number | undefined;
      let declaredPaths: number | undefined;
      if (executedSuccessfully && criterion.verify.oracle === "test") {
        declaredPaths = countExplicitPathArgs(criterion.verify.command);
        const executedUnits = parseExecutedUnits(outputTail);
        completeness = judgeCompleteness({
          declaredPaths,
          executedUnits,
          hasCaseFilter: commandHasCaseFilter(criterion.verify.command),
        });
        if (executedUnits !== null) {
          executedFiles = executedUnits.files;
        }
        if (completeness === "zero_match" || completeness === "under_match") {
          verifyResult = "inconclusive";
        }
      }

      const postRunGitState = probeGitState(resolvedExecutionRoot.root);
      // reason: a SKIPPED check writes NO stamp and NO head_sha (the row stays `unbound` until re-recorded),
      // so the git reads are discarded when a peer held the lock — spec AC-CT-8; see StateBindingOccupancyPort.
      const stampOutcome: StampOutcome =
        occupancy?.kind === "held" ? {} : decideStampOutcome(preRunGitState, postRunGitState);
      const recordResult = await this.recordVerifiedEvidence(
        task.id,
        {
          oracle: criterion.verify.oracle,
          command: criterion.verify.command,
          result: verifyResult,
          recorded_by: opts.by,
          // reason: task-capture-source-is-optional-at-the-evidence-write-boundary
          // AC-3 — this service SPAWNS `criterion.verify.command` itself (step ③,
          // `executor`), so "runner" is the value this call site can actually PROVE,
          // not merely the value `appendEvidenceEntry` would force from `attestation`
          // being present a few lines below. Passing it explicitly documents the
          // caller's own provenance claim rather than leaning on that downstream
          // override, and satisfies `VerifiedEvidenceInput`'s compile-time-required
          // field either way.
          capture_source: "runner",
          // reason: see this method's `recordAcRef` param JSDoc — both call
          // sites (verifyPlan, verifyAdhocTask) now pass `true` (AC-069-15), so
          // every runner-attested entry carries `ac_ref` equal to the executed
          // criterion's id, cross-validated by `appendEvidenceEntry` through
          // either the plan-owned `parent_id` walk or (for an ad-hoc task) the
          // injected `resolveAdhocGoverningAcIds` port — an id it can't resolve
          // there is refused (AC-069-16), which this method surfaces verbatim
          // via the `recordResult.ok` check below (no bypass).
          ...(recordAcRef ? { ac_ref: criterion.id } : {}),
          ...(opts.milestoneRefresh === true ? { milestone_refresh: true as const } : {}),
          ...(outputTail !== "" ? { output_tail: outputTail } : {}),
          attestation: {
            runner: "lore-cli",
            exit_code: exitCode,
            duration_ms: durationMs,
            timed_out: timedOut,
            // SPEC-039 §M2 — command-provenance annotation, present-iff-true.
            ...(firstSeen ? { first_seen: true } : {}),
            // SPEC-061 §Scope D4 — present-iff-computed (see field JSDoc on
            // evidenceEntrySchema.attestation).
            ...(completeness !== undefined ? { completeness } : {}),
            ...(executedFiles !== undefined ? { executed_files: executedFiles } : {}),
            // SPEC-063 §Design Decisions D3 — ALWAYS present on evidence recorded
            // under this change (both "corpus_root" and "worktree" resolutions),
            // so the audit trail can distinguish "recorded before SPEC-063" (both
            // fields absent) from "this run used the corpus root" (present, mode
            // "corpus_root").
            execution_root: resolvedExecutionRoot.root,
            execution_mode: resolvedExecutionRoot.mode,
            // Baseline slice 1 §C5 + SPEC-143 AC-CT-5 — the git facts and the stamp verdict, decided
            // from the PRE and POST reads together (see `decideStampOutcome`); never the post read alone.
            ...stampOutcome,
          },
        },
        opts.nowIso,
      );
      if (!recordResult.ok) return recordResult;

      if (occupancy?.kind === "held" && this.stateBindingOccupancy !== undefined) {
        const skipResult = await this.stateBindingOccupancy.recordSkip(
          buildStateBindingSkipAuditEntry({
            task_id: task.id,
            ac_id: criterion.id,
            holder_pid: occupancy.holder_pid,
            lock_path: occupancy.lock_path,
            nowIso: opts.nowIso,
            actor: opts.by,
          }),
        );
        if (!skipResult.ok) return skipResult;
        warnings.push(
          `AC "${criterion.id}": state-binding check SKIPPED — oracle lock held by pid ${occupancy.holder_pid}; ` +
            "the evidence row is unbound until `lore verify` is re-run with the lock free",
        );
      }

      completedAcIds.push(criterion.id);
      results.push({
        ac_id: criterion.id,
        result: verifyResult,
        exit_code: exitCode,
        duration_ms: durationMs,
        timed_out: timedOut,
        ...(firstSeen ? { first_seen: true } : {}),
        ...(completeness !== undefined ? { completeness } : {}),
        ...(executedFiles !== undefined ? { executed_files: executedFiles } : {}),
        ...(declaredPaths !== undefined ? { declared_paths: declaredPaths } : {}),
        ...(binaryFreshness !== undefined ? { binary_freshness: binaryFreshness } : {}),
      });
    }

    return ok({ task: { id: task.id, slug: task.slug }, results, skipped, superseded, warnings });
  }

  /**
   * SPEC-069 ad-hoc-task runner path (task-the-ad-hoc-task-channel-has-no-
   * attested-evidence-path-lore) — `lore verify --task <adhoc-task>` with NO
   * PLAN positional. An ad-hoc task (`extra.adhoc === true`, SPEC-069 §Design
   * Decisions D2) has no `plan_id` and is parented to the corpus root PRD, so
   * `getPlanBundle` structurally cannot resolve a governing spec for it — this
   * method takes the ALREADY-RESOLVED task and the full candidate spec list as
   * plain data instead (both fetched by the CLI adapter via `app.corpusService`,
   * mirroring this class's existing "adapter resolves IO, service decides"
   * split for `getPlanBundle` itself — no NEW constructor port is needed).
   *
   * Governing-spec resolution: no structural plan/spec link exists for an ad-hoc
   * task, so it RECORDS its spec (`extra.governing_spec`, BR-1495) and this method
   * resolves through `resolveRecordedGoverningSpec` (`@lore/core`) — the lookup
   * `CorpusService.resolveDeclaredAcIdsForAdhocTask` shares. `AC-*` ids are unique
   * only WITHIN one spec, so there is no search by id. A deprecated spec and a
   * superseded criterion still resolve (BR-1494).
   *
   * Every step AFTER spec resolution (declared-scope selection, M2 approval
   * gate, execution, freshness/completeness guards, attested evidence write) is
   * the IDENTICAL shared tail `verifyPlan` uses ({@link _runVerification},
   * `recordAcRef: true` here — see that param's own JSDoc) — an ad-hoc task's
   * runner-attested evidence is now SHAPE-IDENTICAL to a plan-owned task's: it
   * carries a REAL `attestation.runner: "lore-cli"` / `exit_code` / `duration_ms`
   * from an ACTUAL executed command (never a synthesized marker) AND `ac_ref`
   * equal to the executed criterion's id (AC-069-15,
   * task-verifyadhoctask-stamps-ac-ref-on-its-runner-attested — the LAST
   * remaining shape difference between the two channels, now retired).
   *
   * HISTORICAL (measured 2026-08-01): `ac_ref` used to be that one remaining
   * difference, because `TaskWorkflowService.appendEvidenceEntry`'s cross-entity
   * validation for an ad-hoc task called `resolveDeclaredAcIds(task.parent_id)`
   * UNCONDITIONALLY — which hard-requires `task.parent_id` to resolve to a
   * `type: "plan"` document, structurally impossible for an ad-hoc task (its
   * parent is the root PRD). `task-an-ad-hoc-task-s-attested-evidence-cannot-
   * carry-ac-ref` fixed that: `appendEvidenceEntry` now resolves an ad-hoc
   * task's `ac_ref` via the injected `resolveAdhocGoverningAcIds` port →
   * `CorpusService.resolveDeclaredAcIdsForAdhocTask` → this SAME
   * `resolveRecordedGoverningSpec` lookup — so supplying `ac_ref` from this
   * method is cross-validated the same way a plan-owned task's is, and a
   * criterion id the resolved governing spec does not declare is still refused
   * (AC-069-16 — no new bypass): that refusal surfaces as a `recordVerifiedEvidence`
   * `Result` failure, which this method's shared `_runVerification` tail
   * propagates verbatim (same abort semantics as any other write failure —
   * never silently swallowed).
   *
   * @param task - The resolved target task (caller MUST have already resolved
   *   this by id/slug; this method does no id resolution of its own).
   * @param candidateSpecs - Every `spec`-typed doc in the corpus (caller-fetched,
   *   e.g. `corpusService.listFull({type: "spec"}).docs`) — filtered here down
   *   to the task's recorded governing spec.
   * @param opts - Same `VerifyPlanOpts` `verifyPlan` accepts.
   * @returns Same `VerifyPlanResult` contract as `verifyPlan`.
   * @throws (as `Result`) VALIDATION_ERROR — `task` is not type "task"; task is
   *   not ad-hoc (`extra.adhoc !== true`); ac_scope absent/empty; ac_scope
   *   matches zero or more than one candidate spec; unknown `--ac` id (SAME
   *   message shape `verifyPlan` uses); any of `_selectDeclaredScopeCriteria`'s
   *   four refusals — plus everything `_runVerification` can throw.
   */
  async verifyAdhocTask(
    task: DocRecord,
    candidateSpecs: DocRecord[],
    opts: VerifyPlanOpts,
  ): Promise<Result<VerifyPlanResult, LoreError>> {
    if (task.type !== "task") {
      return err({
        code: "VALIDATION_ERROR",
        field: "type",
        message:
          `Expected a task document for the ad-hoc verify path; got type '${task.type}'. ` +
          "The no-PLAN-positional invocation targets a SPEC-069 --adhoc TASK only.",
        value: task.type,
        rule: "BR-183",
      });
    }
    if (task.extra["adhoc"] !== true) {
      return err({
        code: "VALIDATION_ERROR",
        field: "adhoc",
        message:
          `task "${task.slug}" is not ad-hoc (extra.adhoc !== true) — the no-PLAN-positional ` +
          "lore verify path is reachable ONLY for a SPEC-069 --adhoc task. Pass the PLAN " +
          "positional (this task's plan_id) to verify a plan-owned task.",
        value: task.slug,
        rule: "BR-183",
      });
    }

    const declared = extractDeclaredAcScope(task);
    if (declared === undefined) {
      return err({
        code: "VALIDATION_ERROR",
        field: "ac_scope",
        message:
          `ad-hoc task "${task.slug}" has no declared ac_scope, so lore verify cannot resolve ` +
          "a governing spec for it (no plan/spec link exists for an --adhoc task, SPEC-069 " +
          `D2) — declare one with '${SCOPE_WRITER_HINT} ${task.slug} <AC-ID>' first.`,
        value: task.slug,
      });
    }
    if (declared.length === 0) {
      return err({
        code: "VALIDATION_ERROR",
        field: "ac_scope",
        message:
          `ad-hoc task "${task.slug}" ${EMPTY_SCOPE_LITERAL} — its ac_scope is an EMPTY array, ` +
          "so there is no declared AC id to resolve a governing spec from. Re-declare with " +
          `'${SCOPE_WRITER_HINT} ${task.slug} <AC-ID>' before verifying.`,
        value: task.slug,
      });
    }

    // Shared search (task-an-ad-hoc-task-s-attested-evidence-cannot-carry-ac-ref)
    // — SAME function `CorpusService.resolveDeclaredAcIdsForAdhocTask` calls, so
    // the two surfaces can never disagree about which spec governs this task.
    const resolveResult = resolveRecordedGoverningSpec(task, candidateSpecs, `ad-hoc task "${task.slug}"`);
    if (!resolveResult.ok) return resolveResult;
    const { spec, criteria } = resolveResult.value;

    // Mirrors verifyPlan's pre-existing unknown-acIds check (SAME field/message
    // shape) — a caller-named --ac id must be declared on the RESOLVED spec.
    if (opts.acIds !== undefined) {
      const declaredIds = new Set(criteria.map((c) => c.id));
      const unknown = opts.acIds.filter((id) => !declaredIds.has(id));
      if (unknown.length > 0) {
        return err({
          code: "VALIDATION_ERROR",
          field: "acIds",
          message: `unknown AC id(s) not declared on spec "${spec.slug}": ${unknown.join(", ")}`,
          value: unknown,
          rule: "BR-167",
        });
      }
    }

    const selectionResult = this._selectDeclaredScopeCriteria(criteria, task, spec.slug, opts.acIds);
    if (!selectionResult.ok) return selectionResult;

    // recordAcRef: true (AC-069-15) — see _runVerification's own param JSDoc
    // for the historical reason this used to be false and why supplying
    // ac_ref here is now cross-validated safely.
    return this._runVerification(selectionResult.value, task, spec, opts, true);
  }

  /**
   * Runs a plan's declared script-mode acceptance criteria for real and records
   * runner-attested evidence for each. See the class-level JSDoc for the four-step
   * pipeline and the module-level invariants (launch-failure abort semantics, the
   * draft-spec advisory, ai/human skip reporting).
   *
   * @param planIdOrSlug - Plan document ULID or slug
   * @param opts - `{ acIds?, explicitTaskIdOrSlug?, by, nowIso, allowNewCommands?,
   *   confirmUnapprovedCommand? }`
   * @returns `VerifyPlanResult` — every recorded AC outcome, every skipped
   *   non-script AC, and any advisory warnings
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (plan has no parent spec / spec has no
   *   structured acceptance_criteria / unknown acIds / target-task ambiguity / any
   *   of step ②.4's four declared-scope refusals — absent, empty, out-of-scope
   *   `--ac`, fully-dangling scope),
   *   STALE_VERSION (a concurrent writer raced an evidence write), STORE_ERROR
   *   (a script command failed to LAUNCH — the run aborts, no partial evidence
   *   ambiguity; the message lists every AC id already recorded before the abort),
   *   NEEDS_APPROVAL (SPEC-039 §M2 — a new/changed command was rejected by the
   *   command-provenance approval gate; same partial-completion accounting as the
   *   STORE_ERROR launch-failure abort)
   */
  async verifyPlan(
    planIdOrSlug: string,
    opts: VerifyPlanOpts,
  ): Promise<Result<VerifyPlanResult, LoreError>> {
    // ① bundle
    const bundleResult = await this.getPlanBundle(planIdOrSlug);
    if (!bundleResult.ok) return bundleResult;
    const { plan, spec, tasks } = bundleResult.value;

    if (spec === undefined) {
      return err({
        code: "VALIDATION_ERROR",
        field: "spec",
        message: `plan "${plan.slug}" has no parent spec — nothing to verify`,
        value: plan.id,
        rule: "BR-168",
      });
    }

    const criteriaParsed = specAcceptanceCriteriaSchema.safeParse(
      spec.extra["acceptance_criteria"],
    );
    if (!criteriaParsed.success || criteriaParsed.data.length === 0) {
      return err({
        code: "VALIDATION_ERROR",
        field: "acceptance_criteria",
        message: `spec "${spec.slug}" has no structured acceptance_criteria declared — nothing to verify`,
        value: spec.id,
        rule: "BR-168",
      });
    }

    // The pre-existing unknown-AC-id check stays HERE, ahead of target-task
    // resolution: an id no spec criterion declares is a caller error regardless
    // of which task the run would target (REGRESSION-pinned — the refusal names
    // field "acIds" and fires even for an ambiguous target).
    if (opts.acIds !== undefined) {
      const declaredIds = new Set(criteriaParsed.data.map((c) => c.id));
      const unknown = opts.acIds.filter((id) => !declaredIds.has(id));
      if (unknown.length > 0) {
        return err({
          code: "VALIDATION_ERROR",
          field: "acIds",
          message: `unknown AC id(s) not declared on spec "${spec.slug}": ${unknown.join(", ")}`,
          value: unknown,
          rule: "BR-167",
        });
      }
    }

    // ② resolve target task (core, pure)
    const targetResult = resolveTargetTask(tasks, {
      ...(opts.explicitTaskIdOrSlug !== undefined
        ? { explicitTaskIdOrSlug: opts.explicitTaskIdOrSlug }
        : {}),
      nowIso: opts.nowIso,
      ttlMinutes: this.config.claimTtlMinutes,
    });
    if (!targetResult.ok) return targetResult;
    const task = targetResult.value;

    // ②.4 declared-scope selection + pre-flight refusal — MUST run after ② (the
    // declaration lives on the resolved task) and BEFORE anything in step ③,
    // so a refusal leaves zero executions and zero recorded entries.
    const selectionResult = this._selectDeclaredScopeCriteria(
      criteriaParsed.data,
      task,
      spec.slug,
      opts.acIds,
    );
    if (!selectionResult.ok) return selectionResult;

    // recordAcRef: true — BYTE-IDENTICAL to pre-SPEC-069 behavior (REGRESSION).
    return this._runVerification(selectionResult.value, task, spec, opts, true);
  }

  /**
   * Attested-red runner (spec-falsifiability-reachability-a-feedable-
   * checkpoint-an §D2/D3/D4) — drives ONE declared AC's `verify.falsifier` to
   * a runner-attested `"expected-fail"`. See this file's "Attested-Red
   * Falsifier Runner" section header for the full mechanism; this method is
   * resolution orchestration only (mirrors `verifyPlan`'s steps ①② for
   * bundle/task resolution), delegating the mutate/spawn/compare/record
   * sequence to {@link _runFalsifier}:
   *   1. Resolve the plan bundle + target task (SAME steps `verifyPlan`
   *      uses — a falsifier run still records evidence against a real
   *      claimed task, never a synthetic one).
   *   2. Look up `acId` on the spec's declared criteria; refuse loud if it's
   *      missing, not script-mode, or carries no `falsifier` (D2 — never
   *      fabricate one; declaring a falsifier is the AC author's job).
   *
   * @param planIdOrSlug - Plan document ULID or slug (same resolution
   *   `verifyPlan` uses).
   * @param acId - The declared criterion id to falsify (its `verify.falsifier`
   *   must be present — see `lore ac add/set --falsifier-*`).
   * @param opts - `{ explicitTaskIdOrSlug?, by, nowIso, executionRoot? }`.
   *   Deliberately NOT the full `VerifyPlanOpts` — no M2 command-provenance gate
   *   applies here: a falsifier run executes a MUTATED tree every time, so "don't
   *   re-prompt for a command already seen" (M2's whole premise) doesn't hold.
   *   `executionRoot` IS accepted (AC-JV-3, spec-judgment-surfaces-must-verify-before-they-certify-machine
   *   §D5) — the SAME pre-resolved `resolveVerifyExecutionRoot(...)` result
   *   `VerifyPlanOpts.executionRoot` carries, threaded to {@link _runFalsifier} so
   *   the scratch worktree branches off the CALLER's resolved root (and, when that
   *   root is a linked worktree, off its uncommitted state — see
   *   {@link createFalsifierScratchWorktree}) rather than unconditionally
   *   `config.repoRoot`. Omitted (e.g. an MCP caller doing no worktree-aware
   *   resolution) falls back to `{root: config.repoRoot, mode: "corpus_root"}` —
   *   byte-identical to this method's pre-AC-JV-3 behavior (the REGRESSION half of
   *   AC-JV-3's own oracle).
   * @returns {@link FalsifierRunResult} — either a genuine, recorded attested
   *   red (`result: "expected-fail"`) or, when AC-FR-11's green control found
   *   the scratch environment itself unusable BEFORE any mutation was
   *   attempted — including when the green control's OWN spawn failed to
   *   LAUNCH at all, not merely exited nonzero — a recorded-but-unattested
   *   `result: "inconclusive"` outcome. Both are `ok(...)`, never an error —
   *   an unusable scratch environment is a legitimate, machine-determined
   *   outcome, not a launch failure that vanishes with no corpus trace.
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (no parent spec / no structured
   *   ACs / unknown acId / not script-mode / no declared falsifier / an exit
   *   code that doesn't match the falsifier's declared value / a stale
   *   mutation), STORE_ERROR (scratch worktree creation failed, OR the
   *   falsifier-MUTATED command's launch failed at step 6 — the UNMUTATED
   *   green control's own launch failure at step 4 is deliberately NOT in
   *   this list: it is recorded as `result: "inconclusive"` instead, per the
   *   MINOR fix above), STALE_VERSION (a concurrent evidence writer raced
   *   this run's `recordVerifiedEvidence` call)
   */
  async verifyFalsifier(
    planIdOrSlug: string,
    acId: string,
    opts: {
      explicitTaskIdOrSlug?: string;
      by: string;
      nowIso: string;
      executionRoot?: VerifyExecutionRootResolution;
    },
  ): Promise<Result<FalsifierRunResult, LoreError>> {
    // ① bundle — same port `verifyPlan` uses.
    const bundleResult = await this.getPlanBundle(planIdOrSlug);
    if (!bundleResult.ok) return bundleResult;
    const { plan, spec, tasks } = bundleResult.value;

    if (spec === undefined) {
      return err({
        code: "VALIDATION_ERROR",
        field: "spec",
        message: `plan "${plan.slug}" has no parent spec — nothing to falsify`,
        value: plan.id,
        rule: "BR-185",
      });
    }

    const criteriaParsed = specAcceptanceCriteriaSchema.safeParse(
      spec.extra["acceptance_criteria"],
    );
    if (!criteriaParsed.success || criteriaParsed.data.length === 0) {
      return err({
        code: "VALIDATION_ERROR",
        field: "acceptance_criteria",
        message: `spec "${spec.slug}" has no structured acceptance_criteria declared — nothing to falsify`,
        value: spec.id,
        rule: "BR-185",
      });
    }

    const criterion = criteriaParsed.data.find((c) => c.id === acId);
    if (criterion === undefined) {
      return err({
        code: "VALIDATION_ERROR",
        field: "acId",
        message: `unknown AC id "${acId}" — not declared on spec "${spec.slug}"`,
        value: acId,
        rule: "BR-185",
      });
    }
    if (criterion.verify.mode !== "script") {
      return err({
        code: "VALIDATION_ERROR",
        field: "verify.mode",
        message:
          `AC "${acId}" is not script-mode (verify.mode is "${criterion.verify.mode}") — ` +
          "an attested-red run requires a script command to mutate-and-run",
        value: criterion.verify.mode,
        rule: "BR-185",
      });
    }
    const falsifier = criterion.verify.falsifier;
    if (falsifier === undefined) {
      return err({
        code: "VALIDATION_ERROR",
        field: "verify.falsifier",
        message:
          `AC "${acId}" declares no falsifier — declare one first ('lore ac add/set ` +
          "<spec> <id> --falsifier-path <path> --falsifier-find <text> --falsifier-replace " +
          "<text> --falsifier-exit-code <n>') before running the attested-red path",
        value: acId,
        rule: "BR-248",
      });
    }

    // BR-1074 / spec-evidence-labels-and-reds-are-honest D5: a stored out-of-range expected exit code
    // (a 0 declared before BR-1076 existed) is refused BEFORE the scratch worktree, the green control or
    // any evidence write — the schema still parses it (D4), so this is the only run-time guard.
    if (!isValidFalsifierExitCode(falsifier.expected_exit_code)) {
      return err({
        code: "VALIDATION_ERROR",
        field: "verify.falsifier.expected_exit_code",
        message:
          `AC "${acId}" stores falsifier expected_exit_code ${JSON.stringify(falsifier.expected_exit_code)}, ` +
          `outside ${FALSIFIER_EXIT_CODE_MIN}..${FALSIFIER_EXIT_CODE_MAX} — nothing was run and no evidence was ` +
          `recorded. Correct it with: lore ac set ${spec.slug} ${acId} --correction "<reason>" ` +
          `--falsifier-exit-code <n> (repeat the other --falsifier-* flags)`,
        value: falsifier.expected_exit_code,
        rule: "BR-1074",
      });
    }

    // ② resolve target task — same core, pure `resolveTargetTask` `verifyPlan` uses.
    const targetResult = resolveTargetTask(tasks, {
      ...(opts.explicitTaskIdOrSlug !== undefined
        ? { explicitTaskIdOrSlug: opts.explicitTaskIdOrSlug }
        : {}),
      nowIso: opts.nowIso,
      ttlMinutes: this.config.claimTtlMinutes,
    });
    if (!targetResult.ok) return targetResult;
    const task = targetResult.value;

    // reason: `criterion.verify.mode !== "script"` was already checked above
    // (early-returned otherwise) — this cast documents that narrowing rather
    // than relying on TS to propagate it through the `criteriaParsed.data.find(...)`
    // call boundary into `_runFalsifier`'s parameter type.
    return this._runFalsifier(criterion as ScriptAcceptanceCriterion, falsifier, task, opts);
  }

  /**
   * The green-control/mutate/spawn/compare/record sequence behind
   * {@link verifyFalsifier} (steps 3-9 of that method's own class-level
   * walkthrough) — split out so `verifyFalsifier`'s bundle/criterion
   * resolution stays readable. Assumes ALL of that resolution already
   * succeeded (criterion is script-mode and carries `falsifier`, target task
   * resolved).
   *
   *   3. {@link createFalsifierScratchWorktree} off the resolved execution root
   *      (AC-JV-3 — `opts.executionRoot?.root ?? config.repoRoot`, WITH
   *      `captureUncommitted: true` iff that resolution's `mode` is `"worktree"`).
   *   3.5. `materializeFalsifierDependencies(scratch.worktreeDir, repoRoot)`
   *      (spec-a-falsifier-s-scratch-worktree-must-be-runnable-and AC-SD-6) —
   *      BEFORE step 4, so the green control measures the MATERIALIZED
   *      environment rather than the bare `git worktree add` copy (`node_modules`
   *      is gitignored, so no scratch worktree ever carries it otherwise). A
   *      materialization FAILURE (e.g. `repoRoot` has no installed
   *      `node_modules` of its own to source from at all — true of every
   *      throwaway fixture repo with no package-manager install step, never
   *      true of a real developer checkout) is NOT swallowed: it is captured
   *      as `materializeNote` and APPENDED (never substituted) onto whichever
   *      annotation step 4 or step 8 below ends up recording, then execution
   *      falls through to step 4 exactly as if materialization had never run
   *      — a bare scratch tree missing `node_modules` is ALREADY one of step
   *      4's own documented "environment unusable" causes, so this invents no
   *      new recorded outcome, only explains an existing one. AC-SD-7's own
   *      regression guard is the mirror image: a materialization SUCCESS must
   *      never widen what step 4 catches either (an untracked dependency file,
   *      a gitignored `dist/lore` — both stay out of this call's scope; see
   *      `falsifier-dep-materialization.test.ts`'s "green control still
   *      fires" describe).
   *   4. GREEN CONTROL (AC-FR-11) — spawn the AC's `verify.command` UNMUTATED
   *      in that SAME scratch worktree, via the SAME injected `executor` port
   *      and `buildVerifySpawnSpec` shape step 6 below also uses. Exit 0 (not
   *      timed out) means the environment is usable — fall through to step 5
   *      unchanged. A nonzero exit, a timeout, OR the spawn failing to LAUNCH
   *      at all (`executor` itself returning `err(...)`, e.g. ENOENT) all
   *      mean the SCRATCH ENVIRONMENT itself can't run this command at all
   *      (missing `node_modules`, an untracked file the command depends on,
   *      a gitignored `dist/lore`) — record `result: "inconclusive"` with NO
   *      `attestation` block (never "expected-fail") and RETURN, never
   *      reaching step 5. This is checked BEFORE the mutation exists
   *      anywhere, so a mutation-apply failure can never be confused with an
   *      unusable environment either. A LAUNCH failure records the SAME
   *      `inconclusive` shape as an exited-nonzero green control (they are
   *      the same class of "this environment cannot run the command" fact —
   *      neither vanishes into an unrecorded `STORE_ERROR`); its `exit_code`
   *      field is `-1` (no process ever exited to report one, mirroring the
   *      `timed_out: true` / `exit_code: -1` convention this codebase already
   *      uses for a not-really-an-exit-code observation).
   *   5. {@link applyFalsifierMutation} inside the scratch worktree — reached
   *      ONLY when step 4's green control exited 0.
   *   6. Spawn the AC's (now mutated) `verify.command` from the SCRATCH
   *      worktree (the SAME injected `executor` port and `buildVerifySpawnSpec`
   *      shape step 4 already used, with `repoRoot: scratch.worktreeDir`).
   *   7. Compare the observed exit code to `falsifier.expected_exit_code`
   *      EXACTLY (D4) — a mismatch refuses loud, recording NOTHING (never a
   *      passing red for a declaration that doesn't match reality).
   *   8. On a match, append a runner-composed annotation naming the AC id
   *      and the mutation to the REAL captured `output_tail` (never
   *      REPLACING it — "a token naming what failed" alongside the genuine
   *      command output, not instead of it) and record ONE
   *      `result: "expected-fail"` / `capture_source: "runner"` evidence row
   *      via the injected `recordVerifiedEvidence` port.
   *   9. {@link removeFalsifierScratchWorktree} in a `finally` — best-effort;
   *      see that function's own JSDoc for why its failure (or never running
   *      at all, on a genuine crash between step 4 and step 9) can't corrupt
   *      the original tree (D3 holds independently of whether this step
   *      ever runs).
   */
  private async _runFalsifier(
    criterion: ScriptAcceptanceCriterion,
    falsifier: AcFalsifier,
    task: DocRecord,
    opts: { by: string; nowIso: string; executionRoot?: VerifyExecutionRootResolution },
  ): Promise<Result<FalsifierRunResult, LoreError>> {
    // AC-JV-3 (spec-judgment-surfaces-must-verify-before-they-certify-machine §D5) —
    // resolved the SAME "opts value or fall back to config.repoRoot" shape
    // `_runVerification`'s own `resolvedExecutionRoot` uses. A caller that supplies
    // NO resolution (every pre-AC-JV-3 caller, and any MCP caller today) gets
    // `mode: "corpus_root"` here — BYTE IDENTICAL to this method's behavior before
    // this fix (the REGRESSION half of AC-JV-3's own oracle; see
    // `falsifier-execution-root.bun.test.ts`).
    const resolvedExecutionRoot: VerifyExecutionRootResolution =
      opts.executionRoot ?? { root: this.config.repoRoot, mode: "corpus_root" };
    const repoRoot = resolvedExecutionRoot.root;
    const createResult = createFalsifierScratchWorktree(repoRoot, {
      tmpDir: this.config.tmpDir,
      captureUncommitted: resolvedExecutionRoot.mode === "worktree",
    });
    if (!createResult.ok) return createResult;
    const scratch = createResult.value;

    try {
      // ─── Step 3.5 — MATERIALIZE DEPENDENCIES ────────────────────────────
      // (spec-a-falsifier-s-scratch-worktree-must-be-runnable-and AC-SD-6) —
      // BEFORE the green control (step 4), so that control measures the
      // MATERIALIZED environment, not the bare `git worktree add` copy:
      // `node_modules` is gitignored, so no scratch worktree ever carries it
      // otherwise, and every `oracle: test` AC's green control would fail for
      // that reason alone regardless of whether the AC itself is sound — the
      // exact gap `adr-a-falsifier-s-scratch-worktree-gets-dependencies-by-hybrid`
      // exists to close.
      //
      // A materialization FAILURE (e.g. `repoRoot` has no `node_modules` of
      // its own to source from at all — true of every throwaway fixture repo
      // with no package-manager install step, never true of a real developer
      // checkout) is NOT a silent fallback: this is not a `catch {}` that
      // swallows the error and pretends materialization ran. `materializeNote`
      // carries the failure forward in plain text and is APPENDED — never
      // substituted — onto whichever annotation this run ends up recording
      // below (step 4's `inconclusive` branch or step 8's `expected-fail`
      // one), so the failure is visible in the SAME evidence trail a reader
      // already checks. Execution then falls through to the green control
      // exactly as if materialization had never been attempted: a scratch
      // tree missing `node_modules` is ALREADY one of the green control's own
      // documented "environment unusable" causes (this class's own
      // "Attested-Red Falsifier Runner" section above), so this never mints a
      // NEW recorded outcome — it only explains an existing one.
      //
      // AC-SD-7's own regression guard is the mirror image: a materialization
      // SUCCESS must never widen what the green control catches — an
      // untracked dependency file (`git stash create` never carries one) and
      // a gitignored `dist/lore` both stay OUT of this call's scope, exactly
      // as able to fail the green control as before (see
      // `falsifier-dep-materialization.test.ts`'s "green control still
      // fires" describe).
      const materializeResult = materializeFalsifierDependencies(scratch.worktreeDir, repoRoot);
      const materializeNote = materializeResult.ok
        ? undefined
        : ` [attested-red] AC "${criterion.id}": dependency materialization was attempted and ` +
          `failed (${materializeResult.error.code}: ` +
          `${"message" in materializeResult.error ? materializeResult.error.message : materializeResult.error.code}) ` +
          "— proceeding with the scratch worktree exactly as `git worktree add`/`git stash create` left it.";

      // SPEC-039 §M2 — env resolved the SAME way `_runVerification` resolves
      // it for the ordinary green-path run (allowlist filter still applies
      // to a falsifier run's spawned command). Resolved ONCE, before the
      // green control, and reused for the mutated spawn below (step 6) — the
      // two spawns share every input except the mutation itself.
      const resolvedEnv = resolveVerifyEnv(this.config.processEnv, {
        allowlist: this.config.envAllowlist,
        passthroughAll: this.config.envPassthroughAll,
      });

      // ─── Step 4 — GREEN CONTROL (AC-FR-11) ──────────────────────────────
      // Same `buildVerifySpawnSpec` shape, same `repoRoot: scratch.worktreeDir`,
      // same injected `executor` port the mutated spawn (step 6) uses below —
      // this call is BEFORE `applyFalsifierMutation` runs, so it observes the
      // scratch worktree exactly as `git worktree add`/`git stash create`
      // (createFalsifierScratchWorktree) left it, unmutated.
      const greenSpawnSpec = buildVerifySpawnSpec(criterion, {
        repoRoot: scratch.worktreeDir,
        defaultTimeoutMs: this.config.defaultTimeoutMs,
        ...(resolvedEnv !== undefined ? { env: resolvedEnv } : {}),
        acRef: criterion.id,
      });
      const greenResult = await this.executor(greenSpawnSpec);
      // reason: a LAUNCH failure (`greenResult.ok === false`, e.g. ENOENT —
      // the scratch worktree's own copy of the command binary is missing)
      // is the SAME class of "this scratch environment cannot run the
      // command" fact as an exited-nonzero/timed-out green control below —
      // both mean the environment, not the mutation, is at fault, and both
      // MUST leave the identical `inconclusive` corpus trace. Before this
      // fix, a launch failure returned `err(STORE_ERROR)` here and recorded
      // NOTHING — the MINOR finding this branch closes (spec-falsifiability-
      // reachability-a-feedable-checkpoint-an, task-drive-the-falsify-cli-
      // branch-and-assert-the-persisted).
      const greenUsable = greenResult.ok && !greenResult.value.timedOut && greenResult.value.exitCode === 0;
      if (!greenUsable) {
        // reason: the scratch environment itself can't run this command at
        // all — no exit code distinguishes an exited-nonzero run from a
        // genuine assertion failure (this file's "Attested-Red Falsifier
        // Runner" header), and a launch failure is stronger evidence of the
        // same fact. This MUST be checked before any mutation exists
        // anywhere. Record `inconclusive` with NO `attestation` (never a
        // proven red minted out of an environment failure) and return
        // WITHOUT ever calling `applyFalsifierMutation` or spawning the
        // command a second time.
        const greenAnnotation =
          (greenResult.ok
            ? `[attested-red] AC "${criterion.id}": green control failed — the UNMUTATED ` +
              `command exited ${greenResult.value.exitCode}` +
              `${greenResult.value.timedOut ? " (timed out)" : ""} in the scratch worktree before ` +
              "any falsifier mutation was applied. The scratch environment itself is unusable " +
              "(e.g. missing node_modules, a command-referenced file that exists only untracked, " +
              "or a gitignored dist/lore binary) — recording inconclusive rather than proceeding " +
              "to mutate-and-compare, which could otherwise misattribute an environment failure " +
              "as a machine-proven red."
            : `[attested-red] AC "${criterion.id}": green control FAILED TO LAUNCH (` +
              `${"message" in greenResult.error ? greenResult.error.message : greenResult.error.code}) ` +
              "in the scratch worktree, before any falsifier mutation was applied. The scratch " +
              "environment itself is unusable (e.g. a gitignored dist/lore binary or an untracked " +
              "dependency missing from the scratch copy) — recording inconclusive rather than " +
              "aborting with no corpus trace, which could otherwise leave an unrunnable " +
              "environment indistinguishable from a run that was never attempted.") +
          // reason: step 3.5's own materialization-failure note (undefined on
          // success) — APPENDED, never substituted, so a materializer
          // failure is surfaced in the SAME evidence trail this row already
          // carries rather than vanishing silently (see step 3.5's own
          // comment above for why falling through here mints no NEW outcome).
          (materializeNote ?? "");
        // reason: `-1` — no process ever exited when the launch itself
        // failed, so there is no real exit code to report; mirrors this
        // codebase's existing `timed_out: true` / `exit_code: -1` convention
        // for a "not really an exit code" observation (see
        // `packages/core/src/task-workflow.test.ts`'s `baseEntry` fixture).
        const greenExitCode = greenResult.ok ? greenResult.value.exitCode : -1;
        const greenPriorOutputTail = greenResult.ok ? greenResult.value.outputTail : "";
        const greenCombinedOutputTail = tailChars(
          greenPriorOutputTail.length > 0
            ? `${greenPriorOutputTail}\n${greenAnnotation}`
            : greenAnnotation,
          FALSIFIER_OUTPUT_TAIL_MAX_CHARS,
        );
        const inconclusiveRecordResult = await this.recordVerifiedEvidence(
          task.id,
          {
            oracle: criterion.verify.oracle,
            command: criterion.verify.command,
            result: "inconclusive",
            recorded_by: opts.by,
            // reason: spec-evidence-labels-and-reds-are-honest D1 (#48) — lore spawned
            // this (so not "self-report") but the row carries no attestation (so not
            // "runner"); the honest third label, refused by the writers if paired with one.
            capture_source: RUNNER_UNATTESTED_CAPTURE_SOURCE,
            ac_ref: criterion.id,
            output_tail: greenCombinedOutputTail,
            // reason: NO `attestation` key at all (AC-FR-11) — this row proves
            // only that the green control ran (or tried to) and failed, never
            // that a mutation was applied and compared; `attestation` on an
            // "expected-fail" row promises exactly that stronger claim.
          },
          opts.nowIso,
        );
        if (!inconclusiveRecordResult.ok) return inconclusiveRecordResult;

        return ok({
          task: { id: task.id, slug: task.slug },
          ac_id: criterion.id,
          expected_exit_code: falsifier.expected_exit_code,
          exit_code: greenExitCode,
          output_tail: greenCombinedOutputTail,
          result: "inconclusive",
        });
      }

      // ─── Step 5 — apply the mutation (green control proved the
      //     environment usable) ───────────────────────────────────────────
      const mutateResult = applyFalsifierMutation(scratch.worktreeDir, falsifier);
      if (!mutateResult.ok) return mutateResult;

      // ─── Step 6 — spawn the MUTATED command ─────────────────────────────
      const spawnSpec = buildVerifySpawnSpec(criterion, {
        repoRoot: scratch.worktreeDir,
        defaultTimeoutMs: this.config.defaultTimeoutMs,
        ...(resolvedEnv !== undefined ? { env: resolvedEnv } : {}),
        acRef: criterion.id,
      });

      const execResult = await this.executor(spawnSpec);
      if (!execResult.ok) {
        const detail =
          "message" in execResult.error ? execResult.error.message : execResult.error.code;
        return err({
          code: "STORE_ERROR",
          message:
            `attested-red run for AC "${criterion.id}" aborted — falsifier command failed ` +
            `to launch (${detail}). No evidence recorded.`,
          rule: "BR-193",
        });
      }

      const { exitCode, outputTail, durationMs, timedOut } = execResult.value;
      const matched = !timedOut && exitCode === falsifier.expected_exit_code;
      // reason: D4 — "output MUST contain a token naming what failed",
      // guaranteed regardless of the mutated command's own wording. The
      // REAL captured stdout+stderr is preserved verbatim; this annotation
      // is APPENDED after it, never a replacement (step 7 of this method's
      // own JSDoc).
      const annotation =
        `[attested-red] AC "${criterion.id}": falsifier mutated "${falsifier.path}" — ` +
        `declared exit ${falsifier.expected_exit_code}, observed exit ${exitCode}` +
        `${timedOut ? " (timed out)" : ""}.` +
        // reason: step 3.5's own materialization-failure note (undefined on
        // success) — surfaced here too: a run can reach a genuine
        // "expected-fail" even when materialization itself failed, for a
        // command whose green control does not happen to need node_modules
        // (every pre-existing falsifier fixture in this repo). APPENDED,
        // never substituted — see step 3.5's own comment for the full
        // rationale.
        (materializeNote ?? "");
      const combinedOutputTail = tailChars(
        outputTail.length > 0 ? `${outputTail}\n${annotation}` : annotation,
        FALSIFIER_OUTPUT_TAIL_MAX_CHARS,
      );

      // reason: spec-evidence-labels-and-reds-are-honest D9 / BR-1075 (#53 ii) — a mutated run
      // that found no tests (discovery refusal) or ended 126/127 (command not runnable / not
      // found) proves nothing about the mutation, so it is NEVER an attested expected-fail,
      // even when the declared exit code equals the observed one. Checked BEFORE `matched`
      // so the declared code cannot launder it; a timeout is a different signal and excluded.
      const discoveryRefusal =
        !timedOut && criterion.verify.oracle === "test" ? findDiscoveryRefusal(outputTail) : null;
      const unrunnableExit = !timedOut && (exitCode === 126 || exitCode === 127);
      if (discoveryRefusal !== null || unrunnableExit) {
        const why =
          discoveryRefusal !== null
            ? `${discoveryRefusal.runner} reported a discovery refusal ("${discoveryRefusal.evidence}") — no test ran`
            : `the command ended with exit code ${exitCode} (not runnable / not found)`;
        const refusalTail = tailChars(
          `${combinedOutputTail}\n[attested-red] AC "${criterion.id}": ${why}; the mutated run ` +
            "proves nothing about the falsifier — recorded inconclusive (runner-unattested), " +
            "never an expected fail.",
          FALSIFIER_OUTPUT_TAIL_MAX_CHARS,
        );
        const inconclusiveResult = await this.recordVerifiedEvidence(
          task.id,
          {
            oracle: criterion.verify.oracle,
            command: criterion.verify.command,
            result: "inconclusive",
            recorded_by: opts.by,
            capture_source: RUNNER_UNATTESTED_CAPTURE_SOURCE,
            ac_ref: criterion.id,
            output_tail: refusalTail,
            // reason: NO `attestation` — an attested row would promise a proven red.
          },
          opts.nowIso,
        );
        if (!inconclusiveResult.ok) return inconclusiveResult;
        return ok({
          task: { id: task.id, slug: task.slug },
          ac_id: criterion.id,
          expected_exit_code: falsifier.expected_exit_code,
          exit_code: exitCode,
          output_tail: refusalTail,
          result: "inconclusive",
        });
      }

      if (!matched) {
        return err({
          code: "VALIDATION_ERROR",
          field: "falsifier.expected_exit_code",
          message:
            `AC "${criterion.id}"'s declared falsifier claims exit code ` +
            `${falsifier.expected_exit_code}, but the mutated command actually exited ` +
            `${exitCode}${timedOut ? " (timed out)" : ""} — the declaration does not match ` +
            "reality. Nothing recorded; fix the declared expected_exit_code (or the mutation) " +
            "and retry.",
          value: { declared: falsifier.expected_exit_code, observed: exitCode, timed_out: timedOut },
          rule: "BR-191",
        });
      }

      const recordResult = await this.recordVerifiedEvidence(
        task.id,
        {
          oracle: criterion.verify.oracle,
          command: criterion.verify.command,
          result: "expected-fail",
          recorded_by: opts.by,
          capture_source: "runner",
          ac_ref: criterion.id,
          output_tail: combinedOutputTail,
          attestation: {
            runner: "lore-cli",
            exit_code: exitCode,
            duration_ms: durationMs,
            timed_out: timedOut,
            // SPEC-063 §Design Decisions D2/D3 shape — a falsifier run's
            // execution root IS the scratch worktree, by construction.
            execution_root: scratch.worktreeDir,
            execution_mode: "worktree",
          },
        },
        opts.nowIso,
      );
      if (!recordResult.ok) return recordResult;

      return ok({
        task: { id: task.id, slug: task.slug },
        ac_id: criterion.id,
        expected_exit_code: falsifier.expected_exit_code,
        exit_code: exitCode,
        output_tail: combinedOutputTail,
        result: "expected-fail",
      });
    } finally {
      // D3 — best-effort; see removeFalsifierScratchWorktree's own JSDoc for
      // why the isolation guarantee never depends on this call succeeding
      // (or even running at all, on a genuine crash before this `finally`
      // itself gets to execute).
      if (this.scratchRemoval === undefined) {
        removeFalsifierScratchWorktree(repoRoot, scratch);
      } else {
        const removal = await this.scratchRemoval.removeScratchWorktree(repoRoot, scratch.worktreeDir);
        if (!removal.removed) {
          // reason: an escalated or failed removal keeps the scratch (never a silent leak): name it and why.
          (this.config.warn ?? discardWarnings)(`[attested-red] scratch worktree kept: ${scratch.worktreeDir}: ${removal.reason ?? "not removed"}`);
        }
      }
    }
  }
}
