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
 * Source: retro follow-up item 8; IoC vertical-slice tech-spec §4.1/§5.1/§11.
 */

import {
  err,
  ok,
  resolveGateEnabled,
  resolveAnchorOverlapGateEnabled,
  resolveActorIdentityGateEnabled,
  resolveAcQuantifiableGateEnabled,
  resolveOracleCoverageGateEnabled,
  resolveRequiresUatGateEnabled,
  resolvePrdSyncGateEnabled,
  resolveVerificationProfile,
  resolveAttestationMinRatio,
  type AuditEntry,
  type LoreConfig,
  type LoreError,
  type Result,
  type SpecKind,
  type VerificationProfile,
} from "@lore/core";
import type { PlanBundle } from "@lore/core";
import { resolveActorWithSource } from "@lore/core/node";
import {
  checkpointRegistry,
  isCheckpointBlocked,
  planPromoteReachabilityAdvisory,
  selectFailures,
  type GateCheckpoint,
  type GateContext,
} from "./checkpoint-registry.js";

/**
 * Which escape hatch produced a `gate_skipped` audit entry (SPEC-080 G4 D2) —
 * `"config_disabled"` when `workflow.gates.<checkpoint>.enabled === false` short-
 * circuited `GateEnforcer.enforce()` (this module); `"env_bypass"` when
 * `LORE_GATE_BYPASS=1` short-circuited `../adapters/cli/commands/gate.ts` BEFORE it
 * ever reached this class (the CLI's own escape hatch — `GateEnforcer` never honors
 * `LORE_GATE_BYPASS` itself, see this module's header). Both mechanisms share this
 * one entry shape (`buildGateSkipAuditEntry` below) so a `lore audit` reader never
 * has to reconcile two independently-drifting `details` shapes for "a gate was
 * skipped."
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
 *   process.env).actor` (the SAME chain `CorpusService`'s SPEC-079 G2 writes use).
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
export class GateEnforcer {
  /**
   * @param config - The project's resolved `LoreConfig`, or `undefined` when no
   *   `.lore/config.yaml` was loaded — forwarded verbatim to `resolveGateEnabled` on
   *   every `enforce()` call, exactly as `gate.ts`'s `isGateDisabledByConfig` already
   *   does. Not pre-resolved into per-checkpoint booleans at construction time: a
   *   single stored config reference lets one `GateEnforcer` instance serve all five
   *   checkpoints without re-deriving anything at construction.
   * @param recordGateSkip - OPTIONAL SPEC-080 G4 port for auditing a config-disabled
   *   skip — wired ONLY in `app.ts`'s production composition root
   *   (`store.appendAuditEntry.bind(store)`, the exact `RecordGateSkip` shape).
   *   Every pre-existing bare `new GateEnforcer(config)` construction (every unit
   *   test in this codebase) omits it, so `enforce()`'s config-disabled branch stays
   *   a zero-IO synchronous early return, byte-identical to pre-SPEC-080 behavior —
   *   see `recordSkip()`'s own doc comment and this class's SPEC-080 module invariant.
   */
  constructor(
    private readonly config: LoreConfig | undefined,
    private readonly recordGateSkip?: RecordGateSkip,
  ) {}

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
    if (!isCheckpointBlocked(results)) {
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
    return err({
      code: "VALIDATION_ERROR",
      field,
      message: `Gate "${checkpoint}" blocked: ${reasons.join(", ")}\n\n${feedText}`,
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
   * the target doc id/slug the calling checkpoint's `ctx` has in hand
   * (`specIdOrSlug` for `spec-promote`, `targetIdOrSlug` for `plan-promote`/
   * `task-claim`/`phase-claim`/`plan-close` — `undefined` for `spec-create`, which
   * gates a not-yet-created candidate with no id of its own yet) and the current
   * actor via the SAME `resolveActorWithSource` chain `CorpusService`'s SPEC-079 G2
   * writes use, builds the entry via the shared pure `buildGateSkipAuditEntry`, and
   * fires the write WITHOUT awaiting it — `enforce()` must stay synchronous (see
   * the class's SPEC-080 module invariant). Any failure — a rejected promise, a
   * `Result.err`, or the port throwing synchronously instead of returning a
   * promise at all — degrades to one `process.stderr` warning line and otherwise
   * changes nothing: the skip this call is auditing has ALREADY succeeded by the
   * time this method runs (D1, "observability never changes gate outcomes").
   *
   * @param checkpoint - Which checkpoint was skipped.
   * @param ctx - The `GateContext` the caller built for this `enforce()` call —
   *   read only for its optional target-id fields, never for predicate state
   *   (the checkpoint's predicates never even ran on this branch).
   * @param mechanism - Always `"config_disabled"` from this class's one call site
   *   (`enforce()`'s early return) — parameterized rather than hardcoded so this
   *   method and `buildGateSkipAuditEntry` share one signature shape with the CLI
   *   bypass path's equivalent call, even though that path never runs through
   *   this instance method (see `../adapters/cli/gate-bypass-audit.js`).
   */
  private recordSkip(checkpoint: GateCheckpoint, ctx: GateContext, mechanism: GateSkipMechanism): void {
    if (this.recordGateSkip === undefined) return;

    const target = ctx.specIdOrSlug ?? ctx.targetIdOrSlug;
    const nowIso = new Date().toISOString();
    const actor = resolveActorWithSource(undefined, process.env).actor;
    const entry = buildGateSkipAuditEntry(checkpoint, mechanism, nowIso, actor, target);

    try {
      Promise.resolve(this.recordGateSkip(entry))
        .then((result) => {
          if (!result.ok) {
            this.warnGateSkipAuditFailure(checkpoint, describeLoreError(result.error));
          }
        })
        .catch((error: unknown) => {
          this.warnGateSkipAuditFailure(checkpoint, describeThrown(error));
        });
    } catch (error) {
      // reason: a port that throws SYNCHRONOUSLY (rather than returning a
      // rejected promise) never reaches the `.catch` above — caught here so a
      // misbehaving injected port can never propagate out of `enforce()`.
      this.warnGateSkipAuditFailure(checkpoint, describeThrown(error));
    }
  }

  /**
   * Single stderr-warning formatter for a failed gate-skip audit write (SPEC-080
   * D1) — kept as one method so every failure branch in `recordSkip()` (rejected
   * promise, `Result.err`, synchronous throw) prints the identical message shape.
   */
  private warnGateSkipAuditFailure(checkpoint: GateCheckpoint, reason: string): void {
    process.stderr.write(
      `gate-skip audit not recorded for checkpoint "${checkpoint}": ${reason}\n`,
    );
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
   * Whether `plan-close`'s `prdOutlineSynced` sub-predicate specifically is
   * enabled (`workflow.gates."plan-close".prd_sync.enabled`, SPEC-080 §C4) —
   * NARROWER than `isEnabled("plan-close")`, which governs the WHOLE
   * checkpoint. A caller building `GateContext.prdSyncEnabled`
   * (`CorpusService.set`) consults this, not `isEnabled`.
   *
   * DELIBERATELY THE OPPOSITE DEFAULT of `isTaskClaimAnchorOverlapEnabled` /
   * `isAcQuantifiableEnabled` / `isOracleCoverageEnabled` / `isRequiresUatEnabled`
   * above — those all default ENABLED (an explicit `false` turns them off);
   * this one defaults DISABLED (an explicit `true` turns it on), per
   * `resolvePrdSyncGateEnabled`'s own JSDoc.
   *
   * @returns `true` iff the sub-key is explicitly enabled; `false` otherwise.
   * @example
   * enforcer.isPrdSyncEnabled(); // => false unless config explicitly enables it
   */
  isPrdSyncEnabled(): boolean {
    return resolvePrdSyncGateEnabled(this.config);
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
   * Resolves `plan-close`'s execution-time attestation-floor ratio
   * (`workflow.attestation.min_ratio`, SPEC-069 §Design Decisions D1) against
   * this enforcer's own `LoreConfig` — the single config-reading seam a caller
   * building `GateContext.attestationMinRatio` (`CorpusService.set`) consults,
   * mirroring `resolveVerificationProfile`'s "GateEnforcer owns the one config
   * reference" shape.
   *
   * @returns The configured floor, or the schema default (0.5) when
   *   unconfigured.
   * @example
   * enforcer.resolveAttestationMinRatio(); // => 0.5 by default, 0.3 when configured
   */
  resolveAttestationMinRatio(): number {
    return resolveAttestationMinRatio(this.config);
  }
}
