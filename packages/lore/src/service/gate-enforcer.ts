/**
 * GateEnforcer — service-layer enforcement of the five gate
 * checkpoints (`spec-create` / `spec-promote` / `plan-promote` / `task-claim` / `plan-close`).
 *
 * Retro follow-up item 8 ("[arch] defense-in-depth"): before this module, the four
 * checkpoints existed ONLY behind `lore gate <checkpoint>` — a separate CLI command an
 * agent/CI hook shells out to as a pre-flight check (`../adapters/cli/commands/gate.ts`,
 * wired into `.claude/settings.json` PreToolUse hooks). A caller going straight at
 * `CorpusService.create` / `ReviewService.approve` / `TaskWorkflowService.claim` — an
 * MCP tool, an HTTP dashboard route, or a test/script calling the service directly —
 * never invoked `lore gate` at all and therefore bypassed every checkpoint entirely.
 * `GateEnforcer` closes that gap by moving the "run a checkpoint's predicates, then
 * translate a blocked verdict into a `LoreError`" step INTO the service layer, so it
 * runs for every caller of the gated method, not only ones that happen to shell out to
 * `lore gate` first.
 *
 * This module adds ZERO new predicate logic. `enforce()` is a thin translation over
 * `checkpointRegistry` (`./checkpoint-registry.js`) — the SAME registry `lore gate`
 * dispatches through — and `resolveGateEnabled` (`@lore/core`) — the SAME per-checkpoint
 * config knob `lore gate` already honors (`workflow.gates.<checkpoint>.enabled`). There
 * is exactly one place a checkpoint's pass/fail decision is computed; this module only
 * decides what a service caller sees when that decision is "blocked".
 *
 * @invariant OPTIONAL constructor dependency on the three services that call it
 *   (`CorpusService`, `ReviewService`, `TaskWorkflowService`) — every pre-existing bare
 *   `new CorpusService(store)` / `new ReviewService(store)` /
 *   `new TaskWorkflowService(store, telemetry, config)` construction (the ~3700 unit
 *   tests across this codebase) omits the enforcer and is UNGATED, byte-identical to
 *   pre-this-change behavior. Only `app.ts`'s production composition root constructs a
 *   real `GateEnforcer` and wires it into all three services — mirrors the existing
 *   `Telemetry` / `claimTtlMinutes?` optional-DI shape those same three services already
 *   use for the identical "absent in bare tests, present in production" reason.
 * @invariant `enforce()`'s RETURN VALUE is a PURE function of `(this.config, checkpoint,
 *   ctx)` — no store access, no IO, no `bun:sqlite`, no wall-clock read EVER
 *   influences what it returns, and it stays fully SYNCHRONOUS (no new `await`). Resolving
 *   a candidate's parent-doc type, counting a spec's declared acceptance criteria, and
 *   walking a plan/task's ancestor-spec chain are all the CALLING service's
 *   responsibility (`CorpusService._createImpl`/`set`, `ReviewService.approve`,
 *   `TaskWorkflowService.claim`) — the exact same division of labor `gate.ts` already
 *   has between its own IO-performing `runXGate` functions and `checkpointRegistry`'s
 *   pure `check`/`feed` callbacks.
 * @invariant SPEC-080 G4 (gate-skip observability) is a deliberate, BOUNDED exception
 *   layered on top of the invariant above: when a checkpoint is disabled by config,
 *   `enforce()` additionally fires a BEST-EFFORT, FIRE-AND-FORGET `gate_skipped` audit
 *   write through the optional `recordGateSkip` constructor port (see `recordSkip()`
 *   below). The write is never awaited — `enforce()`'s own call sites (`CorpusService`,
 *   `ReviewService`, `TaskWorkflowService`, `PhaseWorkflowService` — none of them in
 *   this task's file anchors) keep calling it synchronously, unchanged — and its
 *   outcome (success, a rejected promise, or a synchronously-thrown error from a
 *   misbehaving port) can NEVER change what `enforce()` returns: a write failure
 *   degrades to a `process.stderr` warning only (D1, "observability never changes gate
 *   outcomes"). When `recordGateSkip` is `undefined` (every bare test construction —
 *   the ~3700 unit tests this class's OTHER invariant above already documents),
 *   `recordSkip()` returns immediately without reading the wall clock, `process.env`,
 *   or touching the port at all — `enforce()` stays byte-identical to pre-SPEC-080
 *   behavior for every one of those constructions.
 * @invariant The `LoreError` this returns is always `VALIDATION_ERROR` — the existing
 *   code every other cross-entity / business-rule rejection in this codebase already
 *   uses (see `CorpusService._createImpl`'s phase/spec_kind cross-entity checks). No new
 *   14th `LoreError` code was introduced; CLI's `utils.ts::exitCode` maps
 *   `VALIDATION_ERROR` to exit code 4 — the SAME exit code `lore gate`'s blocked path
 *   already returns for this class of failure.
 *
 * Design Decision — the `LORE_GATE_BYPASS=1` write-path boundary (task-lore-gate-
 * bypass-honored-by-lore-gate-subcommands-but). `LORE_GATE_BYPASS=1` short-circuits
 * ALL FIVE `lore gate <checkpoint>` subcommands (`../adapters/cli/commands/gate.ts`)
 * before this class ever runs, but — until this task — the identical env var was
 * silently IGNORED by `enforce()` itself, so a caller who exported it and then called
 * `CorpusService.create`/`set`, `ReviewService.approve`, or `TaskWorkflowService.claim`
 * (directly, via MCP, or via the HTTP dashboard) still got denied with no indication
 * the variable had any relevance there. Two candidate fixes were weighed:
 *   - Option A ("honor it here too, one variable one meaning") was REJECTED. Safely
 *     scoping it would require threading a caller-surface signal (SPEC-024's
 *     `cli`/`agent`/`mcp`/`http_cookie`/`http_token`) into `enforce()` and its
 *     constructor wiring in `app.ts` and every calling service — none of which are in
 *     this task's file anchors — and even fully wired, a bare env var governs an
 *     entire OS process: a long-lived `lore serve` cannot tell "bypass for the human
 *     who exported this for one debugging session" from "bypass for every concurrent
 *     `http_cookie`/`http_token`/MCP caller sharing this process's environment".
 *     Honoring it unscoped would silently disarm every remote write while a single
 *     local CLI invocation intended to bypass just its own one-off check — the exact
 *     blast-radius growth the task's own "Against" column warned about.
 *   - Option B ("keep write-path enforcement unconditional, make the boundary LOUD")
 *     was CHOSEN. `enforce()`'s checkpoint predicates still run unconditionally
 *     regardless of this env var (defense-in-depth, AC-4: byte-identical behavior with
 *     the variable unset) — but when it IS set (`"1"`) and the checkpoint denies, the
 *     returned `LoreError.message` now names the variable, states plainly that it does
 *     not apply to this call, and points at the ACTUAL supported write-path escape
 *     hatch (`workflow.gates.<checkpoint>.enabled: false`) — see
 *     {@link describeBypassBoundaryNote} and its one call site in `enforce()`. No
 *     `gate_skipped` audit row is written for this branch (AC-3) — the checkpoint was
 *     NOT skipped, it was evaluated and blocked; only a bypassed (config-disabled OR
 *     `lore gate`'s own env-bypass) checkpoint ever produces that row.
 * Net effect: no caller can set `LORE_GATE_BYPASS`, observe a write-path denial, and
 * come away unable to tell whether the variable applied there.
 *
 * Source: retro follow-up item 8; IoC vertical-slice tech-spec §4.1/§5.1/§11;
 *         task-lore-gate-bypass-honored-by-lore-gate-subcommands-but (Option B).
 */

import { discardWarnings, type WarnSink } from "./warn-sink.js";
import {
  err,
  ok,
  resolveGateEnabled,
  resolveAnchorOverlapGateEnabled,
  resolveActorIdentityGateEnabled,
  resolveAcQuantifiableGateEnabled,
  resolveOracleCoverageGateEnabled,
  resolveRequiresUatGateEnabled,
  resolveCitedRuleCheckGateEnabled,
  resolveVerificationProfile,
  resolveAttestationMinRatio,
  SCOPE_UNDECLARED_REASON,
  type AuditEntry,
  type LoreConfig,
  type LoreError,
  type Result,
  type SpecKind,
  type VerificationProfile,
} from "@lore/core";
import type { OsUser, PlanBundle } from "@lore/core";
import { resolveActorWithSource } from "@lore/core/node";
import {
  checkpointRegistry,
  describeAssessmentFreshnessNotApplicable,
  describeCitedRuleUnknowns,
  describeCheckpointVacuity,
  isCheckpointBlocked,
  planPromoteReachabilityAdvisory,
  selectFailures,
  type GateCheckpoint,
  type GateContext,
} from "./checkpoint-registry.js";
import {
  isNotApplicable,
  type ApplicablePredicateResult,
  type PredicateNotApplicable,
} from "./gate-predicates.js";
import type { TraceRecorder } from "./trace-recorder.js";

/**
 * Which escape hatch produced a `gate_skipped` audit entry (SPEC-080 G4 D2) —
 * `"config_disabled"` when `workflow.gates.<checkpoint>.enabled === false` short-
 * circuited `GateEnforcer.enforce()` (this module); `"env_bypass"` when
 * `LORE_GATE_BYPASS=1` short-circuited `../adapters/cli/commands/gate.ts` BEFORE it
 * ever reached this class (the CLI's own escape hatch). Both mechanisms share this
 * one entry shape (`buildGateSkipAuditEntry` below) so a `lore audit` reader never
 * has to reconcile two independently-drifting `details` shapes for "a gate was
 * skipped." `GateEnforcer` still never SKIPS a checkpoint because of
 * `LORE_GATE_BYPASS` (this module's Design Decision above, Option B) — it only
 * INSPECTS the var to annotate an already-blocked denial's message, so no THIRD
 * `GateSkipMechanism` member exists for that case; a write-path denial with the
 * variable set is not a skip, and produces no audit row of this shape at all.
 */
export type GateSkipMechanism = "config_disabled" | "env_bypass";

/**
 * Narrow injected port for writing a `gate_skipped` audit entry — bound to
 * `store.appendAuditEntry` in `app.ts` (SPEC-080 G4), same narrow-port shape as
 * `service/config-service.ts`'s `AppendConfigAuditEntry`. Kept as a bare function
 * type (not the whole `StoreInterface`) so `GateEnforcer` gains no new IO surface
 * beyond "append one audit row" — mirrors `GateDependencies.getPlanBundle`'s
 * identically-narrow shape one field up.
 */
export type RecordGateSkip = (entry: AuditEntry) => Promise<Result<void, LoreError>>;

/**
 * Fixed `session_id` sentinel for every `gate_skipped` audit row — a gate skip has
 * no owning doc/session identity to anchor to (the checkpoint may run before any
 * candidate doc exists, e.g. `spec-create`), so every row shares this sentinel
 * rather than inventing a per-call value that would carry no real grouping meaning
 * — same rationale as `config-service.ts`'s `CONFIG_AUDIT_SESSION_ID`.
 */
const GATE_SKIP_AUDIT_SESSION_ID = "gate-skip";

/** Audit action string stamped on every `gate_skipped` entry (SPEC-080 G4 D2). */
const GATE_SKIP_AUDIT_ACTION = "gate_skipped";

/**
 * Pure builder for a `gate_skipped` audit entry — the ONE shape both this module's
 * config-disabled skip and the CLI's `LORE_GATE_BYPASS=1` escape hatch
 * (`../adapters/cli/gate-bypass-audit.js`) produce, so `lore audit` never has to
 * reconcile two independently-authored `gate_skipped` shapes. Takes `nowIso`/`actor`
 * as plain parameters rather than reading the wall clock or resolving the actor
 * chain itself — this function stays pure and importable from a vitest-safe module
 * (the CLI bypass path is exercised by `tests/integration/cli/gate-bypass-audit.test.ts`,
 * which must never import `bun:sqlite`).
 *
 * @param checkpoint - Which checkpoint was skipped.
 * @param mechanism - Which escape hatch produced the skip.
 * @param nowIso - ISO 8601 timestamp, resolved by the caller (`new Date().toISOString()`).
 * @param actor - Resolved actor identity, e.g. `resolveActorWithSource(undefined,
 *   env, readOsUsername).actor` (the SAME chain `CorpusService`'s SPEC-079 G2 writes use).
 * @param target - The target doc's id/slug as the calling checkpoint's `GateContext`
 *   supplied it (`specIdOrSlug`/`targetIdOrSlug`), when one was available — absent
 *   for checkpoints gating a not-yet-created candidate (e.g. `spec-create`).
 * @returns A ready-to-append `AuditEntry` — `doc_id`/`details.target` both omitted
 *   (never a placeholder) when `target` is `undefined`.
 * @example
 * buildGateSkipAuditEntry("task-claim", "config_disabled", "2026-07-26T00:00:00Z", "alice", "task-x");
 *   // => { timestamp: "2026-07-26T00:00:00Z", actor: "alice", session_id: "gate-skip",
 *   //      action: "gate_skipped", doc_id: "task-x",
 *   //      details: { checkpoint: "task-claim", mechanism: "config_disabled", target: "task-x" } }
 */
export function buildGateSkipAuditEntry(
  checkpoint: GateCheckpoint,
  mechanism: GateSkipMechanism,
  nowIso: string,
  actor: string,
  target?: string,
): AuditEntry {
  return {
    timestamp: nowIso,
    actor,
    session_id: GATE_SKIP_AUDIT_SESSION_ID,
    action: GATE_SKIP_AUDIT_ACTION,
    ...(target !== undefined ? { doc_id: target } : {}),
    details: {
      checkpoint,
      mechanism,
      ...(target !== undefined ? { target } : {}),
    },
  };
}

/**
 * A typed classification for a gate advisory message (spec-plan-close-
 * predicates-measure-invariants-an-applicability §Design Decisions D2) — the
 * enforcer boundary's vocabulary for "this is worth surfacing but must NEVER
 * block". `"verify-reachability"` is `planPromoteReachabilityAdvisory`'s class
 * (surfaced via `ApproveResult.reachability_advisories`);
 * `"attestation-not-applicable"` tags a plan-close `attestationFloor`
 * not-applicable verdict (`reason: "no-evidence"`) AND `checkPlanClose`'s
 * Amendment A companion verdict for an unresolved `planClaimedAcCoverage`
 * (task-t8, §D3, `reason: "referent-absent"`). The former `"prd-sync-domain-doc"`
 * kind was retired with the domain-document-edit predicate (BR-984). Never widens
 * an EXISTING field's meaning — each kind lands on its own key/audit-detail value.
 *
 * `"attestation-not-applicable"` ALSO tags `attestationFloor`'s `reason:
 * "scope-undeclared"` verdict (spec-declared-scope-attestation-contract-task-
 * owned-ac-scope §Facts D4) — the same predicate reporting the same class of fact
 * ("this floor did not apply to this plan"), so it shares the kind rather than
 * inventing a third; the machine-readable `reason` on the audit row is what
 * distinguishes zero-evidence from undeclared-scope.
 */
export type GateAdvisoryKind = "verify-reachability" | "attestation-not-applicable";

/** One gate-produced advisory — see {@link GateAdvisoryKind} for the kind vocabulary. */
export interface GateAdvisory {
  readonly kind: GateAdvisoryKind;
  readonly message: string;
}

/**
 * The `PredicateNotApplicable.referent` sentinel `checkPlanClose`'s Amendment A
 * companion push (`checkpoint-registry.ts`, spec-plan-close-predicates-
 * measure-invariants-an-applicability §D3) writes when `ctx.planClaimedAcCoverage`
 * was never resolved by the caller — a FIXED literal, never a real doc slug.
 * This module's
 * file anchor is `gate-enforcer.ts` alone — it cannot import the producer's
 * own constant without widening that anchor into `checkpoint-registry.ts` (a
 * DIFFERENT task's file); `checkpoint-registry.ts`'s `checkPlanClose` is the
 * SSOT for this literal and this copy MUST be kept byte-identical to it.
 */
const PLAN_CLAIMED_AC_COVERAGE_REFERENT = "planClaimedAcCoverage";

/**
 * Maps a {@link PredicateNotApplicable} verdict to its {@link GateAdvisoryKind}.
 * `reason: "referent-absent"` is now produced ONLY by `checkPlanClose`'s Amendment A
 * companion push (`ctx.planClaimedAcCoverage` never resolved; `referent` is the fixed
 * sentinel {@link PLAN_CLAIMED_AC_COVERAGE_REFERENT}) — the former second producer
 * (the domain-doc predicate) was retired by BR-984 — so every `referent-absent` verdict is
 * an attestation concern; `referent` is still checked first so a future second producer
 * cannot be mislabelled silently. `reason: "no-evidence"` (attestationFloor's own
 * zero-evidence case) keeps its direct mapping.
 * Exhaustive `never`-checked default — a future third `NotApplicableReason`
 * fails typecheck here until this mapping is updated.
 */
function notApplicableAdvisoryKind(result: PredicateNotApplicable): GateAdvisoryKind {
  if (result.referent === PLAN_CLAIMED_AC_COVERAGE_REFERENT) return "attestation-not-applicable";
  if (result.reason === "referent-absent") return "attestation-not-applicable";
  if (result.reason === "no-evidence") return "attestation-not-applicable";
  // reason: RETAINED BUT CURRENTLY UNREACHED, deliberately. `attestationFloor`
  // stopped producing this verdict (task-plan-close-must-block-when-the-coverage-
  // conjunct-is-scope: an undeclared scope with evidence is now a DENIAL, not an
  // advisory), so no predicate feeds it today. It stays because
  // `SCOPE_UNDECLARED_REASON` remains a member of `NotApplicableReason` — the
  // `never` check below makes this mapping mandatory for as long as that is true,
  // and `@lore/core`'s `declaredScopeCoverageVerdict` still RETURNS that shape for
  // its non-gate consumers. Deleting the branch would not remove dead code, it
  // would break the build; deleting the union member is a `@lore/core` change with
  // its own blast radius. If a future predicate surfaces an undeclared scope as an
  // advisory again, this is already the correct kind for it.
  if (result.reason === SCOPE_UNDECLARED_REASON) return "attestation-not-applicable";
  const exhaustive: never = result.reason;
  throw new Error(`Internal error: unhandled NotApplicableReason "${String(exhaustive)}"`);
}

/** Audit `session_id` sentinel for every `gate_not_applicable` row — mirrors
 *  {@link GATE_SKIP_AUDIT_SESSION_ID}'s "own identity, not conflated with a
 *  different event class" rationale. */
const GATE_NOT_APPLICABLE_AUDIT_SESSION_ID = "gate-not-applicable";

/** Audit action string stamped on every not-applicable-predicate audit row
 *  (spec-plan-close-predicates-measure-invariants-an-applicability §Design
 *  Decisions D2) — a DISTINCT event class from `gate_skipped` (a config-disabled
 *  checkpoint never even ran its predicates; this fires from an ENABLED
 *  checkpoint whose predicate ran and found its referent absent). */
const GATE_NOT_APPLICABLE_AUDIT_ACTION = "gate_not_applicable";

/**
 * Pure builder for a `gate_not_applicable` audit entry — mirrors
 * {@link buildGateSkipAuditEntry}'s exact shape/rationale (SPEC-080 G4's
 * "observability never changes the outcome" precedent), naming the absent
 * referent and the advisory kind.
 *
 * @param checkpoint - Which checkpoint's predicate produced the verdict.
 * @param advisory - The typed advisory this not-applicable verdict maps to.
 * @param referent - The `PredicateNotApplicable.referent` naming the absent fact.
 * @param nowIso - ISO 8601 timestamp, resolved by the caller.
 * @param actor - Resolved actor identity.
 * @param target - The target doc's id/slug, when the calling checkpoint's
 *   `GateContext` supplied one — absent for a not-yet-created candidate.
 * @example
 * buildNotApplicableAuditEntry(
 *   "plan-close",
 *   { kind: "attestation-not-applicable", message: "..." },
 *   "spec-x",
 *   "2026-07-30T00:00:00.000Z",
 *   "alice",
 *   "plan-y",
 * );
 *   // => { timestamp: "2026-07-30T00:00:00.000Z", actor: "alice",
 *   //      session_id: "gate-not-applicable", action: "gate_not_applicable",
 *   //      doc_id: "plan-y",
 *   //      details: { checkpoint: "plan-close", kind: "attestation-not-applicable",
 *   //                 referent: "spec-x", target: "plan-y" } }
 */
export function buildNotApplicableAuditEntry(
  checkpoint: GateCheckpoint,
  advisory: GateAdvisory,
  referent: string,
  nowIso: string,
  actor: string,
  target?: string,
): AuditEntry {
  return {
    timestamp: nowIso,
    actor,
    session_id: GATE_NOT_APPLICABLE_AUDIT_SESSION_ID,
    action: GATE_NOT_APPLICABLE_AUDIT_ACTION,
    ...(target !== undefined ? { doc_id: target } : {}),
    details: {
      checkpoint,
      kind: advisory.kind,
      referent,
      ...(target !== undefined ? { target } : {}),
    },
  };
}

/** Audit `session_id` sentinel for every `gate_passed` row — mirrors
 *  {@link GATE_SKIP_AUDIT_SESSION_ID}'s "own identity, not conflated with a
 *  different event class" rationale. */
const GATE_PASSED_AUDIT_SESSION_ID = "gate-passed";

/**
 * Audit action string stamped on every passing-evaluation audit row
 * (task-derive-lore-feed-s-checkpoint-set-from-the-registry-make, AC-FR-8/D7) —
 * a DISTINCT event class from `gate_skipped` (the checkpoint's predicates never
 * ran at all) and `gate_not_applicable` (one PREDICATE within a checkpoint found
 * its referent absent — the checkpoint can still be genuinely blocked by a
 * DIFFERENT predicate on the same run). `gate_passed` fires exactly once per
 * `enforce()` call that reaches the `!isCheckpointBlocked(results)` branch —
 * whether every predicate measured a real pass, or every predicate was
 * not-applicable (a vacuous pass, `describeCheckpointVacuity`'s own concern) —
 * so a PASS is distinguishable from a checkpoint that never ran, at the ONE
 * surface (`lore audit <doc> --json`) AC-FR-8 requires it be queryable from.
 */
const GATE_PASSED_AUDIT_ACTION = "gate_passed";

/**
 * Pure builder for a `gate_passed` audit entry (AC-FR-8, D7 — emitted where the
 * VERDICT IS PRODUCED, the enforcer, never at each service call site so a
 * newly registered checkpoint is traced BY CONSTRUCTION, the same derivation
 * principle `isRegisteredCheckpoint` applies to feedability, checkpoint-
 * registry.ts). Mirrors {@link buildGateSkipAuditEntry}/
 * {@link buildNotApplicableAuditEntry}'s exact shape so `lore audit <doc>
 * --json` never has to reconcile a THIRD independently-shaped
 * gate-observability row.
 *
 * ⛔ `target`/`doc_id` here is `ctx.targetDocId` (the doc's REAL id), NEVER
 * `ctx.specIdOrSlug`/`ctx.targetIdOrSlug` (display-only, usually a slug) — see
 * `GateContext.targetDocId`'s own JSDoc (checkpoint-registry.ts) for why that
 * distinction is load-bearing for this row's queryability.
 *
 * @param checkpoint - Which checkpoint's predicates ran and did not block.
 * @param nowIso - ISO 8601 timestamp, resolved by the caller.
 * @param actor - Resolved actor identity.
 * @param target - The target doc's REAL id, when the calling checkpoint's
 *   `GateContext` supplied one via `targetDocId` — absent for a checkpoint
 *   evaluated with no resolvable target (e.g. a bare test fixture).
 * @example
 * buildGatePassedAuditEntry("spec-promote", "2026-08-10T00:00:00.000Z", "alice", "01ABC");
 *   // => { timestamp: "2026-08-10T00:00:00.000Z", actor: "alice",
 *   //      session_id: "gate-passed", action: "gate_passed", doc_id: "01ABC",
 *   //      details: { checkpoint: "spec-promote", verdict: "pass", target: "01ABC" } }
 */
export function buildGatePassedAuditEntry(
  checkpoint: GateCheckpoint,
  nowIso: string,
  actor: string,
  target?: string,
): AuditEntry {
  return {
    timestamp: nowIso,
    actor,
    session_id: GATE_PASSED_AUDIT_SESSION_ID,
    action: GATE_PASSED_AUDIT_ACTION,
    ...(target !== undefined ? { doc_id: target } : {}),
    details: {
      checkpoint,
      verdict: "pass",
      ...(target !== undefined ? { target } : {}),
    },
  };
}

/**
 * Formats an unknown thrown/rejected value as a human-readable one-line reason —
 * shared by this module's `recordSkip()` and the CLI's `LORE_GATE_BYPASS=1` bypass
 * path (`../adapters/cli/gate-bypass-audit.js`), both of which must degrade an
 * arbitrary caught value (an `Error`, a string, anything) to a stderr-printable
 * reason without ever throwing themselves.
 */
export function describeThrown(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Formats a `LoreError` as a human-readable one-line reason — `LoreError` is a
 * discriminated union and not every variant carries a `message` field (e.g.
 * `DOC_NOT_FOUND` only has `id`/`suggestions`), so this narrows the same way
 * `adapters/cli/loader.ts`'s existing `"message" in globalResult.error` check
 * already does, falling back to the bare `code` when no `message` is present.
 */
export function describeLoreError(error: LoreError): string {
  return "message" in error ? error.message : error.code;
}

/**
 * Env var name for the CLI-only `lore gate <checkpoint>` escape hatch
 * (`../adapters/cli/commands/gate.ts`, SPEC-080 D3). Named as its own constant
 * (rather than an inline string literal at every read site) so `grep
 * LORE_GATE_BYPASS_ENV_VAR` finds every place this module reasons about the
 * variable, matching this file's `GATE_SKIP_AUDIT_SESSION_ID`-style constant
 * convention above.
 */
const LORE_GATE_BYPASS_ENV_VAR = "LORE_GATE_BYPASS";

/**
 * Formats the Design-Decision-B boundary note (this module's header, "Design
 * Decision — the `LORE_GATE_BYPASS=1` write-path boundary") appended to a
 * BLOCKED `enforce()` denial's message when the CLI-only bypass variable is set
 * in the CALLING process's environment. This function never changes whether a
 * checkpoint blocks — `enforce()`'s ONE call site (below) invokes it only AFTER
 * `isCheckpointBlocked(results)` is already `true`, purely to enrich the
 * message text of a verdict already decided. Returns `""` (no note at all) when
 * the variable is unset or not exactly `"1"`, so a caller that never exported it
 * sees a byte-for-byte unchanged denial (AC-4 REGRESSION).
 *
 * @param checkpoint - The checkpoint that just denied — named in both the
 *   `lore gate <checkpoint>` reference and the `workflow.gates.<checkpoint>
 *   .enabled: false` config key the note points at, so a reader can copy the
 *   exact supported alternative without substituting a placeholder themselves.
 * @param env - The process environment to read the variable from — an explicit
 *   parameter (never a bare top-level `process.env` read inside this function)
 *   so it stays a pure function of its arguments, testable without mutating
 *   global state; `enforce()`'s own call site passes the environment injected at construction.
 * @returns The note text (leading `\n\n`, no trailing newline) or `""`.
 * @example
 * describeBypassBoundaryNote("spec-create", { LORE_GATE_BYPASS: "1" });
 *   // => "\n\nNote: LORE_GATE_BYPASS=1 is set, but it does not apply here — ..."
 * @example
 * describeBypassBoundaryNote("spec-create", {});
 *   // => ""
 */
export function describeBypassBoundaryNote(
  checkpoint: GateCheckpoint,
  env: Record<string, string | undefined>,
): string {
  if (env[LORE_GATE_BYPASS_ENV_VAR] !== "1") return "";
  return (
    `\n\nNote: ${LORE_GATE_BYPASS_ENV_VAR}=1 is set, but it does not apply here — ` +
    `it only short-circuits the \`lore gate ${checkpoint}\` pre-flight command (a ` +
    `diagnostic surface, ../adapters/cli/commands/gate.ts), never a write path like ` +
    `this one (CLI create/set, MCP, or the HTTP dashboard) — an env var on a long-lived ` +
    `\`lore serve\` process would otherwise disarm gates for every remote caller ` +
    `sharing that process's environment. To disable "${checkpoint}" for real writes ` +
    `instead, set \`workflow.gates.${checkpoint}.enabled: false\` in .lore/config.yaml.`
  );
}

/**
 * The gate-related constructor dependency bundle for `ReviewService` and
 * `TaskWorkflowService` — the two services that gate a checkpoint (`plan-promote` /
 * `task-claim`) needing an ancestor spec's data, not just the doc already in hand.
 * Bundled as ONE optional dependency (rather than two separate optional constructor
 * params) so a service can never end up in the illegal state of holding an
 * `enforcer` with no way to resolve the upstream-spec context it needs, or vice versa —
 * both are always wired together in `app.ts`, or neither is (bare test construction).
 * `CorpusService` does not need this bundle: `spec-create`/`spec-promote` only ever
 * inspect the candidate doc's own fields (parent type, spec_kind, content, its own
 * declared acceptance criteria) — no ancestor-spec walk — so it takes a bare
 * `GateEnforcer` instead.
 */
export interface GateDependencies {
  /** The enforcer to run a checkpoint's predicates through. */
  readonly enforcer: GateEnforcer;
  /**
   * Resolves `{plan, spec?, tasks[]}` for a plan (or, via a task's `parent_id`, its
   * plan) — production wiring is `corpusService.getPlanBundle.bind(corpusService)`
   * (`app.ts`), the SAME port `VerifyRunnerService` is already injected with. Never a
   * direct `CorpusService` import (services don't cross-import — service/CLAUDE.md).
   */
  readonly getPlanBundle: (planIdOrSlug: string) => Promise<Result<PlanBundle, LoreError>>;
}

/**
 * Service-layer gate checkpoint runner. See module header for the full rationale.
 */
/** The OS-user value of the port-less actor fallback: a gate row's actor is never guessed from the machine. */
const GATE_NO_OS_USER: OsUser = {
  ok: false,
  reason: "GateEnforcer has no resolveActorPort and its env names no session — wire `resolveActorPort` (app.ts does) to record gate rows",
};

export class GateEnforcer {
  /**
   * @param config - The project's resolved `LoreConfig`, or `undefined` when no
   *   `.lore/config.yaml` was loaded — forwarded verbatim to `resolveGateEnabled` on
   *   every `enforce()` call, exactly as `gate.ts`'s `isGateDisabledByConfig` already
   *   does. Not pre-resolved into per-checkpoint booleans at construction time: a
   *   single stored config reference lets one `GateEnforcer` instance serve all five
   *   checkpoints without re-deriving anything at construction.
   * @param recordGateSkip - OPTIONAL SPEC-080 G4 port for auditing a config-disabled
   *   skip, a not-applicable predicate verdict, AND (AC-FR-8/D7) a genuinely
   *   PASSING evaluation — one shared "append one audit row" port for all three
   *   gate-observability event classes, wired ONLY in `app.ts`'s production
   *   composition root (`store.appendAuditEntry.bind(store)`, the exact
   *   `RecordGateSkip` shape). Every pre-existing bare `new GateEnforcer(config)`
   *   construction (every unit test in this codebase) omits it, so `enforce()`'s
   *   config-disabled branch AND its passing-evaluation branch both stay a
   *   zero-IO synchronous return, byte-identical to pre-SPEC-080/pre-AC-FR-8
   *   behavior — see `recordSkip()`/`recordPass()`'s own doc comments.
   * @param traceRecorder - OPTIONAL SPEC-102 read/deny-instrumentation port — when
   *   present, a BLOCKED `enforce()` call fires a fire-and-forget `kind="gate_deny"`
   *   trace row (`layer: "service"`) via `TraceRecorder.recordGateDeny`. Absent (the
   *   default) → zero trace writes, byte-identical to pre-SPEC-102 behavior — same
   *   "absent in bare tests, present in production" shape as `recordGateSkip`.
   */
  constructor(
    private readonly config: LoreConfig | undefined,
    private readonly recordGateSkip?: RecordGateSkip,
    private readonly traceRecorder?: TraceRecorder,
    /**
     * Author of the gate's own audit/trace rows. `app.ts` passes the store's invocation-aware resolver so a gate
     * row carries the SAME name as the operation it gates; absent (bare tests) → the env chain.
     */
    private readonly resolveActorPort?: () => string,
    /**
     * The invocation environment: read for the `LORE_GATE_BYPASS` boundary note and the env tier of the
     * port-less actor fallback. `app.ts` passes its captured snapshot; omitted (bare tests) -> `{}`, i.e.
     * "no variable is set", which leaves a denial's text byte-identical (AC-4 REGRESSION) — a missing env
     * can only withhold an advisory note, never change a verdict.
     */
    private readonly env: Readonly<Record<string, string | undefined>> = {},
    /** Where the enforcer's advisories (a failed audit write, a vacuous checkpoint) go; absent (bare tests) -> not printed. */
    private readonly warnSink: WarnSink = discardWarnings,
  ) {}

  private resolveActor(): string {
    return this.resolveActorPort !== undefined
      ? this.resolveActorPort()
      : resolveActorWithSource(undefined, this.env, GATE_NO_OS_USER).actor;
  }

  /**
   * Runs `checkpoint`'s deterministic predicates (`checkpointRegistry[checkpoint].check`)
   * against `ctx` and translates a blocked verdict into a `VALIDATION_ERROR`.
   *
   * @param checkpoint - Which of the four registered checkpoints to enforce.
   * @param ctx - Pre-fetched `GateContext` — the caller has already done whatever IO
   *   (parent-doc lookup, AC count, ancestor-spec walk) the checkpoint's predicates need.
   * @returns `ok(undefined)` when `workflow.gates.<checkpoint>.enabled === false`
   *   (checkpoint disabled by config — the SAME knob `lore gate` honors) or every
   *   predicate passes; `err(VALIDATION_ERROR)` — `field: "gate:<checkpoint>"`,
   *   `value` the array of machine-readable failure reasons — when at least one fails.
   *   `LORE_GATE_BYPASS=1` (the CLI-only `lore gate` escape hatch) is NEVER consulted
   *   to decide pass/block here (Design Decision Option B, module header) — it only
   *   appends a boundary note to an already-blocked `message` when set
   *   ({@link describeBypassBoundaryNote}); with it unset, this method's behavior is
   *   byte-identical to before this task.
   * @example
   * enforcer.enforce("task-claim", { hasSpecParent: false });
   *   // => { ok: true, value: undefined } — vacuous pass, no spec-tier ancestor
   * enforcer.enforce("spec-promote", { acceptanceCriteriaCount: 0, specIdOrSlug: "spec-x" });
   *   // => { ok: false, error: { code: "VALIDATION_ERROR", field: "gate:spec-promote", ... } }
   */
  enforce(checkpoint: GateCheckpoint, ctx: GateContext): Result<void, LoreError> {
    if (!resolveGateEnabled(this.config, checkpoint)) {
      // reason: SPEC-080 G4 — fire-and-forget, best-effort audit trace of the skip.
      // NEVER awaited (this method must stay synchronous — see the SPEC-080 class
      // invariant above) and its outcome can never influence the `ok(undefined)`
      // returned on the very next line.
      this.recordSkip(checkpoint, ctx, "config_disabled");
      return ok(undefined);
    }

    const checkpointDef = checkpointRegistry[checkpoint];
    if (checkpointDef === undefined) {
      // reason: all five GateCheckpoint members are registered in checkpointRegistry
      // (checkpoint-registry.ts's second module invariant) — this can only fire if a
      // future edit removes an entry the registry currently guarantees. Mirrors
      // gate.ts::requireCheckpoint's identical "can't happen in production" shape;
      // fail loud with a thrown Error (a programmer-invariant violation, not a
      // caller-facing LoreError) rather than silently treating an unregistered
      // checkpoint as a pass.
      throw new Error(`Internal error: gate checkpoint "${checkpoint}" not registered`);
    }

    const results = checkpointDef.check(ctx);
    // reason: spec-plan-close-predicates-measure-invariants-an-applicability
    // §Design Decisions D1/D2 — a not-applicable verdict NEVER denies (see
    // `isCheckpointBlocked`'s own narrowing); it is ALWAYS surfaced as a
    // best-effort, never-blocking audit row so the vacuous pass is never
    // invisible to an auditor. Fired BEFORE the blocking decision below is even
    // computed — mirrors `recordSkip`'s "observability never changes the
    // outcome" contract exactly (a throwing/rejecting port degrades to one
    // stderr warning, never surfaces here).
    this.recordNotApplicable(checkpoint, ctx, results.filter(isNotApplicable));
    // reason: task-plan-close-must-block-when-the-coverage-conjunct-is-scope M2 —
    // a run whose every conjunct was inapplicable returns the SAME `ok` a measured
    // pass returns, and no channel said so (the audit row records each verdict
    // individually; nothing reported that they were ALL of them). Emitted on
    // stderr, alongside `warnAuditWriteFailure`'s channel, so `lore done` /
    // `lore set --status archived` shows it without altering stdout or the exit
    // code — an observation, never an outcome, exactly like `recordSkip`.
    this.warnVacuousCheckpoint(checkpoint, results);
    // reason: BL-D4 / BR-225 — the per-conjunct complement of the all-inapplicable notice above:
    // an unassessed plan whose other conditions measured would otherwise close with no mention
    // that assessment freshness was never checked. Never blocks (same channel, same contract).
    const freshnessLine = describeAssessmentFreshnessNotApplicable(checkpoint, ctx);
    if (freshnessLine !== null) this.warnSink(freshnessLine);
    // reason: BR-984 - a cited rule whose state was unknown (reportable reason) closes with a line, never silently.
    for (const unknownLine of describeCitedRuleUnknowns(checkpoint, ctx)) this.warnSink(unknownLine);
    if (!isCheckpointBlocked(results)) {
      // reason: AC-FR-8/D7 (task-derive-lore-feed-s-checkpoint-set-from-the-
      // registry-make) — the ONE thing that, before this task, left NO trace
      // anywhere for ANY checkpoint: a genuinely-reached, non-blocked
      // evaluation. `gate_skipped` already covers the config-disabled early
      // return above; `gate_not_applicable` already covers a not-applicable
      // predicate; a denial already writes both an audit row (via the
      // calling service) and a `gate_deny` trace event below. Fired here,
      // generically, for EVERY checkpoint — never a per-call-site addition,
      // which is exactly how `plan-close` became the only checkpoint with
      // ANY observability before this task.
      this.recordPass(checkpoint, ctx);
      return ok(undefined);
    }

    const failures = selectFailures(results);
    const reasons = failures.map((f) => f.reason);
    // reason: SPEC-042 §Design Decisions D5 (review U4) — a failure carrying an
    // explicit `field` sub-discriminator (e.g. task-claim's anchor-overlap
    // predicate) renders as `gate:<checkpoint>:<field>` instead of the base
    // `gate:<checkpoint>`, so a scripted caller can tell apart two different
    // failure classes on the SAME checkpoint (e.g. "release the sibling claim"
    // vs. "wait for spec approval") without parsing `message` prose. Absent on
    // every pre-SPEC-042 predicate — falls back to the original base field,
    // byte-identical to pre-SPEC-042 behavior.
    const fieldSuffix = failures.find((f) => f.field !== undefined)?.field;
    const field = fieldSuffix !== undefined ? `gate:${checkpoint}:${fieldSuffix}` : `gate:${checkpoint}`;
    // reason: SPEC-049 D1 — a service-layer denial previously carried ONLY the
    // machine discriminator (`Gate "task-claim" blocked: ANCHOR_OVERLAP`), while
    // the SAME state probed via `lore gate <checkpoint>` renders the full
    // feeding pack (conflicting task/holder/paths, a literal recovery command,
    // the rule-doc slice) — so MCP/HTTP/direct-service callers got a bare
    // discriminator with no recovery guidance, and only the PreToolUse-hook path
    // (which shells out to `lore gate` separately) got the real pack. `feed` is
    // the SAME pure callback `checkpointRegistry`/`lore gate` already calls —
    // reusing it here means a service-layer denial and a `lore gate` denial for
    // the identical `ctx` render byte-identical pack text, by construction, not
    // by convention. A trailing newline (spec-promote's `feed` ends with one) is
    // trimmed so the `\n\n`-separated pack block never grows a blank third line.
    const feedText = checkpointDef.feed(ctx, failures).replace(/\n+$/, "");
    // reason: task-lore-gate-bypass-honored-by-lore-gate-subcommands-but, Design
    // Decision Option B (this module's header) — the boundary note is appended ONLY
    // when the CLI-only `LORE_GATE_BYPASS=1` escape hatch is set in THIS process's
    // env, and ONLY on this already-blocked branch; it never influences whether the
    // checkpoint blocks, and stays "" (no message growth at all) when unset (AC-4).
    const bypassBoundaryNote = describeBypassBoundaryNote(checkpoint, this.env);
    // reason: SPEC-102 D7 — service-layer deny, layer="service" (disambiguates
    // from the hook-layer `lore gate` CLI deny path, which fires its own
    // `recordGateDeny(..., "hook")` call — the two layers see different
    // traffic and would otherwise double-count the SAME checkpoint). Fired
    // AFTER the blocked verdict is fully computed, never influencing it —
    // `traceRecorder` absent in every bare test construction (mirrors
    // `recordGateSkip`'s identical optional-DI shape one section up).
    if (this.traceRecorder !== undefined) {
      const actor = this.resolveActor();
      this.traceRecorder.recordGateDeny(actor, checkpoint, reasons, ctx.specIdOrSlug ?? ctx.targetIdOrSlug, "service");
    }
    return err({
      code: "VALIDATION_ERROR",
      field,
      message: `Gate "${checkpoint}" blocked: ${reasons.join(", ")}\n\n${feedText}${bypassBoundaryNote}`,
      value: reasons,
    });
  }

  /**
   * `plan-promote` EARLY-WARNING reachability advisory lines for `ctx`
   * (spec-verify-reachability-plan-promote-early-warning §Scope M1) — a SEPARATE
   * call from `enforce("plan-promote", ctx)`, never folded into it. Writer
   * (`checkpoint-registry.ts`'s `planPromoteReachabilityAdvisory`) existed with
   * unit coverage but ZERO production consumer before this method — a post-merge
   * live probe found `dist/lore approve <plan-under-prd>` printing nothing. This
   * is the wiring: `ReviewService.enforceApprovalGate` calls this ALONGSIDE
   * `enforce()`, never in place of it, so the two can never disagree (they share
   * the identical `ctx`) and this call can never influence `enforce()`'s verdict
   * (D1 — advisory NEVER changes the outcome, mirrors the SPEC-080 G4
   * `gate_skipped` audit trail this class already carries as a non-blocking
   * side channel).
   *
   * @param ctx - The SAME `GateContext` the caller built for
   *   `enforce("plan-promote", ctx)` — reads only `hasSpecParent`/
   *   `parentSpecScriptAcCount`/`targetIdOrSlug`, ignores every other field.
   * @returns `[]` when the plan is `lore verify`-reachable (nothing to warn
   *   about); a single-element array with the advisory text otherwise. Never
   *   consults `this.config`/`isEnabled` itself — a caller that wants "no
   *   checkpoint, no advisory" skips calling this at all when
   *   `isEnabled("plan-promote")` is `false` (mirrors `enforce()`'s own
   *   config-disabled early return never running `checkpointDef.check`).
   * @example
   * enforcer.planPromoteReachabilityAdvisories({ hasSpecParent: false });
   *   // => ["ADVISORY (does not block this promote): ..."]
   * @example
   * enforcer.planPromoteReachabilityAdvisories({ hasSpecParent: true, parentSpecScriptAcCount: 2 });
   *   // => []
   */
  planPromoteReachabilityAdvisories(ctx: GateContext): readonly string[] {
    const advisory = planPromoteReachabilityAdvisory(ctx);
    return advisory === null ? [] : [advisory];
  }

  /**
   * SPEC-080 G4 — best-effort, fire-and-forget `gate_skipped` audit write for a
   * config-disabled checkpoint skip. A no-op (zero IO, no wall-clock/`process.env`
   * read) when `recordGateSkip` was not wired at construction. Otherwise resolves
   * the current actor via the SAME `resolveActorWithSource` chain `CorpusService`'s
   * SPEC-079 G2 writes use, builds the entry via the shared pure
   * `buildGateSkipAuditEntry`, and fires the write via {@link fireAndForgetAudit} —
   * `enforce()` must stay synchronous (see the class's SPEC-080 module invariant).
   *
   * ⛔ AC-FR-8/D7 (task-derive-lore-feed-s-checkpoint-set-from-the-registry-make)
   * — reads `ctx.targetDocId` (the doc's REAL id), NEVER `ctx.specIdOrSlug`/
   * `ctx.targetIdOrSlug` (display-only, usually a slug). This method previously
   * read the display-only fields, which meant a `gate_skipped` row's `doc_id` was
   * usually a SLUG — silently unreachable via `lore audit <doc> --json` (which
   * resolves `<doc>` to the real id before filtering, exactly like
   * `gate_passed`'s own row would have been had `recordPass` made the identical
   * mistake; see `GateContext.targetDocId`'s own JSDoc, checkpoint-registry.ts).
   * `undefined` for `spec-create`'s pre-D7-callers-that-never-set-it case is now
   * unreachable — every `enforce()` call site threads `targetDocId`.
   *
   * @param checkpoint - Which checkpoint was skipped.
   * @param ctx - The `GateContext` the caller built for this `enforce()` call —
   *   read only for `targetDocId`, never for predicate state (the checkpoint's
   *   predicates never even ran on this branch).
   * @param mechanism - Always `"config_disabled"` from this class's one call site
   *   (`enforce()`'s early return) — parameterized rather than hardcoded so this
   *   method and `buildGateSkipAuditEntry` share one signature shape with the CLI
   *   bypass path's equivalent call, even though that path never runs through
   *   this instance method (see `../adapters/cli/gate-bypass-audit.js`).
   */
  private recordSkip(checkpoint: GateCheckpoint, ctx: GateContext, mechanism: GateSkipMechanism): void {
    const port = this.recordGateSkip;
    if (port === undefined) return;

    const nowIso = new Date().toISOString();
    const actor = this.resolveActor();
    const entry = buildGateSkipAuditEntry(checkpoint, mechanism, nowIso, actor, ctx.targetDocId);
    this.fireAndForgetAudit(port, entry, (reason) => this.warnAuditWriteFailure(checkpoint, "gate-skip", reason));
  }

  /**
   * AC-FR-8/D7 (task-derive-lore-feed-s-checkpoint-set-from-the-registry-make)
   * — best-effort, fire-and-forget `gate_passed` audit write for a checkpoint
   * that ran its predicates and did NOT block. A no-op (zero IO) when
   * `recordGateSkip` was not wired at construction — mirrors {@link recordSkip}'s
   * identical "absent in bare tests, present in production" shape (this port is
   * reused for all three gate-observability event classes: skip, not-applicable,
   * and now pass — there is no separate "record a pass" port to wire).
   *
   * ⛔ Reads `ctx.targetDocId` — the doc's REAL id — NEVER `ctx.specIdOrSlug`/
   * `ctx.targetIdOrSlug` (display-only, usually a slug; see
   * `GateContext.targetDocId`'s own JSDoc, checkpoint-registry.ts, for why using
   * the display string here would silently make this row unreachable via
   * `lore audit <doc> --json`, the exact surface AC-FR-8 requires).
   *
   * @param checkpoint - Which checkpoint's predicates ran and did not block.
   * @param ctx - The `GateContext` the caller built for this `enforce()` call —
   *   read only for `targetDocId`, never for predicate state (the predicates
   *   already ran; this call cannot change or re-derive their verdict).
   */
  private recordPass(checkpoint: GateCheckpoint, ctx: GateContext): void {
    const port = this.recordGateSkip;
    if (port === undefined) return;

    const nowIso = new Date().toISOString();
    const actor = this.resolveActor();
    const entry = buildGatePassedAuditEntry(checkpoint, nowIso, actor, ctx.targetDocId);
    this.fireAndForgetAudit(port, entry, (reason) => this.warnAuditWriteFailure(checkpoint, "gate-pass", reason));
  }

  /**
   * SPEC design decisions D2 (spec-plan-close-predicates-measure-invariants-an-
   * applicability) — best-effort, fire-and-forget `gate_not_applicable` audit
   * write, ONE row per `PredicateNotApplicable` verdict `enforce()`'s
   * `checkpointDef.check(ctx)` call produced. A no-op (zero IO) when
   * `recordGateSkip` was not wired at construction, OR `notApplicable` is empty
   * (the common case — only `plan-close`'s `citedRuleStateClean`/`attestationFloor`
   * can ever produce one today). Each verdict's `reason` maps to a
   * {@link GateAdvisoryKind} via `notApplicableAdvisoryKind`, naming the absent
   * `referent` on the audit row. Fires via the SAME {@link fireAndForgetAudit}
   * dance `recordSkip` uses — a throwing/rejecting `recordGateSkip` port can
   * NEVER alter `enforce()`'s returned `Result` (D1's "observability never
   * changes the outcome", extended to this new event class).
   *
   * ⛔ AC-FR-8/D7 — reads `ctx.targetDocId` (the doc's REAL id), NEVER
   * `ctx.specIdOrSlug`/`ctx.targetIdOrSlug` — see `recordSkip`'s identical note.
   *
   * @param checkpoint - Which checkpoint's predicate produced the verdict(s).
   * @param ctx - The `GateContext` the caller built for this `enforce()` call —
   *   read only for `targetDocId`.
   * @param notApplicable - The not-applicable subset of `checkpointDef.check(ctx)`'s
   *   result — `[]` is the common case (zero IO in that case).
   */
  private recordNotApplicable(
    checkpoint: GateCheckpoint,
    ctx: GateContext,
    notApplicable: readonly PredicateNotApplicable[],
  ): void {
    const port = this.recordGateSkip;
    if (port === undefined || notApplicable.length === 0) return;

    const target = ctx.targetDocId;
    const nowIso = new Date().toISOString();
    const actor = this.resolveActor();

    for (const result of notApplicable) {
      const advisory: GateAdvisory = {
        kind: notApplicableAdvisoryKind(result),
        message:
          // reason: "did not apply" rather than the earlier "referent is absent"
          // — spec-declared-scope-attestation-contract-task-owned-ac-scope §Facts
          // D4 added `scope-undeclared`, where the referent (the plan) very much
          // EXISTS and it is the CLAIM that was never declared. The machine-
          // readable `reason` is printed verbatim so the specific case stays
          // greppable; only the prose generalized.
          `ADVISORY (does not block "${checkpoint}"): a predicate did not apply — ` +
          `${result.referent} (reason: ${result.reason}).`,
      };
      const entry = buildNotApplicableAuditEntry(checkpoint, advisory, result.referent, nowIso, actor, target);
      this.fireAndForgetAudit(port, entry, (reason) => this.warnAuditWriteFailure(checkpoint, "gate-not-applicable", reason));
    }
  }

  /**
   * Fires `port(entry)` without awaiting it, degrading ANY failure mode — a
   * rejected promise, a resolved `Result.err`, or the port throwing
   * SYNCHRONOUSLY instead of returning a promise at all — to a single
   * `onFailure(reason)` call, and otherwise changing nothing (D1,
   * "observability never changes gate outcomes"). The ONE fire-and-forget dance
   * both `recordSkip` (`gate_skipped`) and `recordNotApplicable`
   * (`gate_not_applicable`) need, factored so it exists in exactly one place.
   * `port` is passed explicitly (never re-read from `this.recordGateSkip`) so
   * this method carries no implicit precondition on caller ordering.
   */
  private fireAndForgetAudit(port: RecordGateSkip, entry: AuditEntry, onFailure: (reason: string) => void): void {
    try {
      Promise.resolve(port(entry))
        .then((result) => {
          if (!result.ok) {
            onFailure(describeLoreError(result.error));
          }
        })
        .catch((error: unknown) => {
          onFailure(describeThrown(error));
        });
    } catch (error) {
      // reason: a port that throws SYNCHRONOUSLY (rather than returning a
      // rejected promise) never reaches the `.catch` above — caught here so a
      // misbehaving injected port can never propagate out of `enforce()`.
      onFailure(describeThrown(error));
    }
  }

  /**
   * Single stderr-warning formatter for a failed best-effort audit write
   * (SPEC-080 D1) — kept as one method so every failure branch across
   * `recordSkip()`, `recordNotApplicable()`, AND `recordPass()` (AC-FR-8/D7)
   * prints a consistently-shaped message, disambiguated by `auditKind` so a
   * reader can tell which event class failed to record.
   */
  private warnAuditWriteFailure(
    checkpoint: GateCheckpoint,
    auditKind: "gate-skip" | "gate-not-applicable" | "gate-pass",
    reason: string,
  ): void {
    this.warnSink(`${auditKind} audit not recorded for checkpoint "${checkpoint}": ${reason}`);
  }

  /**
   * Writes {@link describeCheckpointVacuity}'s notice to stderr when this run's
   * every conjunct was inapplicable (task-plan-close-must-block-when-the-
   * coverage-conjunct-is-scope, M2) — the operator-facing half of the signal
   * whose auditor-facing half is the `gate_not_applicable` row.
   *
   * stderr, never stdout, and never the returned `Result`: an all-inapplicable
   * run is still a PASS (a not-applicable verdict never denies — §D1), so this
   * must not perturb the exit code or any machine-parsed stdout payload. Same
   * channel and same "observability never changes the outcome" contract as
   * {@link warnAuditWriteFailure}, and unlike the audit row it needs no wired
   * port — a consumer that never configured `recordGateSkip` still sees it.
   *
   * @param checkpoint - The checkpoint just evaluated.
   * @param results - The FULL `check(ctx)` output; the emptiness/vacuity
   *   decision belongs to `describeCheckpointVacuity`, never to this method.
   */
  private warnVacuousCheckpoint(
    checkpoint: GateCheckpoint,
    results: readonly ApplicablePredicateResult[],
  ): void {
    const notice = describeCheckpointVacuity(checkpoint, results);
    if (notice === null) return;
    this.warnSink(notice);
  }

  /**
   * Whether `checkpoint` is enabled in config (the SAME `resolveGateEnabled` knob
   * `enforce()` consults internally). Exposed so a caller that must perform gate-context
   * IO (`getPlanBundle` for `plan-promote`/`task-claim`) can short-circuit BEFORE that IO
   * when the checkpoint is disabled — mirroring `gate.ts`'s
   * `isGateDisabledByConfig`-before-`runXGate` order, so a disabled gate stays
   * byte-identical to pre-`GateEnforcer` behavior even when the upstream-spec lookup
   * would itself fail (e.g. a soft-deleted parent plan). `enforce()` STILL re-checks
   * this internally (SSOT / the authority) — this is an early-out, not a replacement.
   *
   * @param checkpoint - Which of the four registered checkpoints to query.
   * @returns `false` when `workflow.gates.<checkpoint>.enabled === false`; `true`
   *   otherwise (checkpoint enabled or no config loaded — same default `resolveGateEnabled`
   *   already applies).
   * @example
   * enforcer.isEnabled("task-claim"); // => false when config sets it disabled
   */
  isEnabled(checkpoint: GateCheckpoint): boolean {
    return resolveGateEnabled(this.config, checkpoint);
  }

  /**
   * Whether `task-claim`'s anchor-overlap sub-predicate specifically is enabled
   * (`workflow.gates."task-claim".anchor_overlap.enabled`, SPEC-042 §Design
   * Decisions D6) — NARROWER than `isEnabled("task-claim")`, which governs the
   * WHOLE checkpoint (anchor-overlap AND upstream-approval together). A caller
   * building `GateContext.anchorOverlapEnabled` (`TaskWorkflowService.
   * enforceClaimGate`) consults this, not `isEnabled`.
   *
   * @returns `false` when the sub-key is explicitly disabled; `true` otherwise.
   * @example
   * enforcer.isTaskClaimAnchorOverlapEnabled(); // => false when config disables it
   */
  isTaskClaimAnchorOverlapEnabled(): boolean {
    return resolveAnchorOverlapGateEnabled(this.config);
  }

  /**
   * Whether `task-claim`'s claim-time actor-identity-collision guard
   * specifically is enabled (`workflow.gates."task-claim".actor_identity
   * .enabled`, spec claim-time-actor-identity-guard-zero-evidence-release-
   * advis AC-IDENTITY-ESCAPE) — NARROWER than `isEnabled("task-claim")`,
   * which governs the WHOLE checkpoint. A caller building `GateContext.
   * actorIdentityEnabled` (`TaskWorkflowService.enforceClaimGate`) consults
   * this, not `isEnabled`. Mirrors `isTaskClaimAnchorOverlapEnabled`'s shape.
   *
   * @returns `false` when the sub-key is explicitly disabled; `true` otherwise.
   * @example
   * enforcer.isTaskClaimActorIdentityEnabled(); // => false when config disables it
   */
  isTaskClaimActorIdentityEnabled(): boolean {
    return resolveActorIdentityGateEnabled(this.config);
  }

  /**
   * Whether `checkpoint`'s `acQuantifiable` sub-predicate specifically is enabled
   * (`workflow.gates.<checkpoint>.ac_quantifiable.enabled`, AC-Quantifiability Gate
   * spec §Design) — NARROWER than `isEnabled(checkpoint)`, which governs the WHOLE
   * checkpoint. A caller building `GateContext.acQuantifiableEnabled`
   * (`CorpusService._createImpl`/`set`, `ReviewService.enforceApprovalGate`)
   * consults this, not `isEnabled`. Mirrors `isTaskClaimAnchorOverlapEnabled`'s
   * shape, parameterized by checkpoint since this sub-predicate is wired on TWO
   * checkpoints (`spec-create` and `spec-promote`), unlike anchor-overlap's single
   * `task-claim` wiring.
   *
   * @param checkpoint - Which checkpoint's `ac_quantifiable` sub-knob to query.
   * @returns `false` when the sub-key is explicitly disabled; `true` otherwise.
   * @example
   * enforcer.isAcQuantifiableEnabled("spec-create"); // => false when config disables it
   */
  isAcQuantifiableEnabled(checkpoint: GateCheckpoint): boolean {
    return resolveAcQuantifiableGateEnabled(this.config, checkpoint);
  }

  /**
   * Whether `spec-promote`'s `oracleCoverage` sub-predicate specifically is
   * enabled (`workflow.gates."spec-promote".oracle_coverage.enabled`, SPEC-058
   * §Design Decisions D5) — NARROWER than `isEnabled("spec-promote")`, which
   * governs the WHOLE checkpoint. A caller building `GateContext.
   * oracleCoverageEnabled` (`CorpusService.set`, `ReviewService.
   * enforceApprovalGate`) consults this, not `isEnabled`. Hardcoded to
   * `"spec-promote"` — SPEC-058 wires this predicate on exactly one checkpoint
   * (§Design Decisions D2).
   *
   * @returns `false` when the sub-key is explicitly disabled; `true` otherwise.
   * @example
   * enforcer.isOracleCoverageEnabled(); // => false when config disables it
   */
  isOracleCoverageEnabled(): boolean {
    return resolveOracleCoverageGateEnabled(this.config);
  }

  /**
   * Whether `plan-promote`'s `requiresUat` sub-predicate specifically is
   * enabled (`workflow.gates."plan-promote".requires_uat.enabled`, SPEC-058
   * §Design Decisions D5) — NARROWER than `isEnabled("plan-promote")`, which
   * governs the WHOLE checkpoint. A caller building `GateContext.
   * requiresUatEnabled` (`ReviewService.enforceApprovalGate`) consults this,
   * not `isEnabled`.
   *
   * @returns `false` when the sub-key is explicitly disabled; `true` otherwise.
   * @example
   * enforcer.isRequiresUatEnabled(); // => false when config disables it
   */
  isRequiresUatEnabled(): boolean {
    return resolveRequiresUatGateEnabled(this.config);
  }

  /**
   * Whether `plan-close`'s `citedRuleStateClean` (BR-984) sub-predicate specifically is
   * enabled (`workflow.gates."plan-close".cited_rule_check.enabled`, SPEC-080 §C4) —
   * NARROWER than `isEnabled("plan-close")`, which governs the WHOLE
   * checkpoint. A caller building `GateContext.citedRuleCheckEnabled`
   * (`CorpusService.set`) consults this, not `isEnabled`.
   *
   * DELIBERATELY THE OPPOSITE DEFAULT of `isTaskClaimAnchorOverlapEnabled` /
   * `isAcQuantifiableEnabled` / `isOracleCoverageEnabled` / `isRequiresUatEnabled`
   * above — those all default ENABLED (an explicit `false` turns them off);
   * this one defaults DISABLED (an explicit `true` turns it on), per
   * `resolveCitedRuleCheckGateEnabled`'s own JSDoc.
   *
   * @returns `true` iff the sub-key is explicitly enabled; `false` otherwise.
   * @example
   * enforcer.isCitedRuleCheckEnabled(); // => false unless config explicitly enables it
   */
  isCitedRuleCheckEnabled(): boolean {
    return resolveCitedRuleCheckGateEnabled(this.config);
  }

  /**
   * Resolves `specKind`'s configured verification profile (SPEC-058) against
   * this enforcer's own `LoreConfig` — the single config-reading seam a caller
   * building `GateContext.verificationProfile` (`CorpusService.set`,
   * `ReviewService.enforceApprovalGate`) consults, mirroring `isEnabled`/
   * `isAcQuantifiableEnabled`'s "GateEnforcer owns the one config reference"
   * shape rather than each caller re-threading a raw `LoreConfig`.
   *
   * @param specKind - Which spec_kind's profile to resolve — for `spec-promote`
   *   the CANDIDATE spec's own kind; for `plan-promote` the plan's ANCESTOR
   *   spec's kind.
   * @returns The declared profile, or `null` when unconfigured for `specKind`
   *   (SPEC-058 §Design Decisions D1 vacuous-pass posture).
   * @example
   * enforcer.resolveVerificationProfile("design");
   *   // => { required_oracles: ["e2e"] } when configured, else null
   */
  resolveVerificationProfile(specKind: SpecKind): VerificationProfile | null {
    return resolveVerificationProfile(this.config, specKind);
  }

  /**
   * Resolves `plan-close`'s OPT-IN execution-time attestation-ratio conjunct
   * (`workflow.attestation.min_ratio`, spec-plan-close-predicates-measure-
   * invariants-an-applicability §D4, superseding SPEC-069 §Design Decisions D1's
   * always-on default) against this enforcer's own `LoreConfig` — the single
   * config-reading seam a caller building `GateContext.attestationMinRatio`
   * (`CorpusService.set`) consults, mirroring `resolveVerificationProfile`'s
   * "GateEnforcer owns the one config reference" shape.
   *
   * @returns The explicitly configured floor, or `null` when unconfigured — the
   *   ratio conjunct does not run at all in that case.
   * @example
   * enforcer.resolveAttestationMinRatio(); // => null by default, 0.3 when configured
   */
  resolveAttestationMinRatio(): number | null {
    return resolveAttestationMinRatio(this.config);
  }
}
