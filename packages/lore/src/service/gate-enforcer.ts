/**
 * GateEnforcer — service-layer enforcement of the four IoC vertical-slice gate
 * checkpoints (`spec-create` / `spec-promote` / `plan-promote` / `task-claim`).
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
 * @invariant `enforce()` is a PURE function of `(this.config, checkpoint, ctx)` — no
 *   store access, no IO, no `bun:sqlite`, no wall-clock reads. Resolving a candidate's
 *   parent-doc type, counting a spec's declared acceptance criteria, and walking a
 *   plan/task's ancestor-spec chain are all the CALLING service's responsibility
 *   (`CorpusService._createImpl`/`set`, `ReviewService.approve`,
 *   `TaskWorkflowService.claim`) — the exact same division of labor `gate.ts` already
 *   has between its own IO-performing `runXGate` functions and `checkpointRegistry`'s
 *   pure `check`/`feed` callbacks.
 * @invariant The `LoreError` this returns is always `VALIDATION_ERROR` — the existing
 *   code every other cross-entity / business-rule rejection in this codebase already
 *   uses (see `CorpusService._createImpl`'s phase/spec_kind cross-entity checks). No new
 *   14th `LoreError` code was introduced; CLI's `utils.ts::exitCode` maps
 *   `VALIDATION_ERROR` to exit code 4 — the SAME exit code `lore gate`'s blocked path
 *   already returns for this class of failure.
 *
 * Source: retro follow-up item 8; IoC vertical-slice tech-spec §4.1/§5.1/§11.
 */

import { err, ok, resolveGateEnabled, type LoreConfig, type LoreError, type Result } from "@lore/core";
import type { PlanBundle } from "@lore/core";
import {
  checkpointRegistry,
  isCheckpointBlocked,
  selectFailures,
  type GateCheckpoint,
  type GateContext,
} from "./checkpoint-registry.js";

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
   *   single stored config reference lets one `GateEnforcer` instance serve all four
   *   checkpoints without re-deriving anything at construction.
   */
  constructor(private readonly config: LoreConfig | undefined) {}

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
      return ok(undefined);
    }

    const checkpointDef = checkpointRegistry[checkpoint];
    if (checkpointDef === undefined) {
      // reason: all four GateCheckpoint members are registered in checkpointRegistry
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

    const reasons = selectFailures(results).map((f) => f.reason);
    return err({
      code: "VALIDATION_ERROR",
      field: `gate:${checkpoint}`,
      message: `Gate "${checkpoint}" blocked: ${reasons.join(", ")}`,
      value: reasons,
    });
  }
}
