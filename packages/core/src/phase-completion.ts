/**
 * Phase completion derivation (SPEC-056 §Public Interface, §Design Decisions
 * D3) — 100% computed, never stored. Pure, browser-safe module: no IO, no
 * Date.now() calls (callers pass `now` explicitly).
 *
 * Public surface:
 *   - PhaseCompletionState / PhaseCompletion — the derived completion shape.
 *   - computePhaseCompletion(input) — the single derivation entry point.
 *
 * Invariants:
 *   - No IO, no wall-clock reads — `now` is always caller-supplied (mirrors
 *     `task-workflow.ts`'s `nowIso` time-seam convention, D10).
 *   - Never mutates its inputs.
 *   - `state: "vacuous"` is DISTINCT from `"done"` — a phase with an empty
 *     `acScope` AND an entirely-dropped-or-empty `checklist` has declared
 *     nothing to complete, so it can never claim to be `"done"` (SPEC-056
 *     §Public Interface CONTRACT NOTE, the anti-vacuous-completion guard).
 *   - An `acScope` id is satisfied iff its {@link AcCoverageFact}
 *     `attested_pass > 0` — a self-reported-only pass (`pass > 0 &&
 *     attested_pass === 0`) does NOT satisfy a phase-level contract AC
 *     (SPEC-039's attested/self-reported distinction is load-bearing here).
 *   - A checklist item is satisfied iff `dropped` is set (excluded from
 *     `blocking`, named in `dropped_named`) OR (`bind.kind === "manual"` AND
 *     `checked` is set) OR (`bind.kind === "script"` AND `result === "pass"`).
 *   - `claim`/`claimTtlMinutes` staleness reuses {@link isClaimStale}
 *     (`task-workflow.ts`) verbatim — never re-derived here — so the strict
 *     `>` staleness boundary stays a single definition site.
 *
 * Side-effect class: pure
 *
 * Source: spec-spec-056-phase-execution-model-phase-doc-type-computed-comp
 *   §Public Interface, §Design Decisions D3; §Acceptance Criteria AC-P-1.
 */

import { ok, err } from "./errors.js";
import type { Result, LoreError } from "./errors.js";
import type { AcCoverageFact } from "./acceptance.js";
import { isClaimStale } from "./task-workflow.js";
import type { TaskClaim } from "./task-workflow.js";
import type { ChecklistItem } from "./phase.js";

// ─── AC Id Grammar ──────────────────────────────────────────────────────────

/**
 * The same `AC-<SEGMENT>(-<SEGMENT>)*` grammar `acceptance.ts`'s
 * `acceptanceCriterionSchema.id` enforces. Duplicated here (not imported/
 * re-exported) rather than hoisted into a shared constant in `acceptance.ts`
 * — that file is outside this task's declared write-scope anchors
 * (`phase.ts` / `phase-completion.ts` / `schemas.ts`); this is a deliberate,
 * documented exception to the "single definition site" convention, not an
 * oversight.
 */
const AC_ID_PATTERN = /^AC-[A-Z0-9]+(-[A-Z0-9]+)*$/;

// ─── Public Types ───────────────────────────────────────────────────────────

/** The four derived completion states for a phase (SPEC-056 §Public Interface). */
export type PhaseCompletionState = "pending" | "active" | "done" | "vacuous";

/** The derived completion shape {@link computePhaseCompletion} returns. */
export interface PhaseCompletion {
  state: PhaseCompletionState;
  /** Unsatisfied acScope ids, followed by unsatisfied non-dropped checklist ids. */
  blocking: string[];
  /** Ids of every dropped checklist item (any bind kind). */
  dropped_named: string[];
  /** Ids of manual checklist items that ARE checked (never script items). */
  manual_selfattested: string[];
}

/** Input bundle for {@link computePhaseCompletion}. */
export interface PhaseCompletionInput {
  /** The phase's declared contract-projection AC ids (`phase.extra.ac_scope`). */
  acScope: string[];
  /** Pre-joined AC coverage facts (caller's job — see module header). */
  coverage: AcCoverageFact[];
  /** The phase's declared checklist items (`phase.extra.checklist`). */
  checklist: ChecklistItem[];
  /** The phase's current claim lease, if any. */
  claim: TaskClaim | undefined;
  /** Claim TTL in minutes — forwarded to {@link isClaimStale}. */
  claimTtlMinutes: number;
  /** Caller-supplied current time (time seam — never Date.now() here). */
  now: Date;
}

// ─── Derivation ─────────────────────────────────────────────────────────────

/**
 * Computes a phase's completion state and supporting detail, purely from its
 * declared scope/checklist/claim — never reaching into a store or evidence
 * directly (both `coverage` and checklist `result`/`checked` are pre-joined
 * by the caller, mirroring the division of labor SPEC-056's own Public
 * Interface sketch states for `coverage`).
 *
 * State precedence (evaluated in this order):
 *   1. `"vacuous"` — `acScope` is empty AND every checklist item (if any) is
 *      dropped. Distinct from `"done"` even when nothing blocks.
 *   2. `"done"` — not vacuous, and every acScope id is satisfied and every
 *      non-dropped checklist item is satisfied (`blocking` is empty).
 *   3. `"active"` — not done/vacuous, and `claim` is present and NOT stale.
 *   4. `"pending"` — not done/vacuous, and (`claim` is undefined OR stale).
 *
 * @param input - See {@link PhaseCompletionInput}.
 * @returns `ok(PhaseCompletion)` on valid input; `err(VALIDATION_ERROR)` when
 *   `acScope` carries a malformed AC id (empty string, or not matching the
 *   `AC-<SEGMENT>(-<SEGMENT>)*` grammar) or `claimTtlMinutes` is negative.
 *   Never throws.
 *
 * @example
 * computePhaseCompletion({
 *   acScope: ["AC-1"],
 *   coverage: [{ ac_id: "AC-1", mode: "script", pass: 1, fail: 0, refs: [], attested_pass: 1, attested_fail: 0 }],
 *   checklist: [],
 *   claim: undefined,
 *   claimTtlMinutes: 120,
 *   now: new Date("2026-07-19T09:30:00.000Z"),
 * });
 * // => ok({ state: "done", blocking: [], dropped_named: [], manual_selfattested: [] })
 */
export function computePhaseCompletion(
  input: PhaseCompletionInput,
): Result<PhaseCompletion, LoreError> {
  const { acScope, coverage, checklist, claim, claimTtlMinutes, now } = input;

  for (const acId of acScope) {
    if (!AC_ID_PATTERN.test(acId)) {
      return err({
        code: "VALIDATION_ERROR",
        field: "acScope",
        message: `acScope entries must match AC id grammar AC-<SEGMENT>(-<SEGMENT>)*, got "${acId}"`,
        value: acId,
      });
    }
  }

  if (claimTtlMinutes < 0) {
    return err({
      code: "VALIDATION_ERROR",
      field: "claimTtlMinutes",
      message: `claimTtlMinutes must not be negative, got ${claimTtlMinutes}`,
      value: claimTtlMinutes,
    });
  }

  const coverageByAcId = new Map(coverage.map((fact) => [fact.ac_id, fact]));
  const acScopeBlocking = acScope.filter((acId) => {
    const fact = coverageByAcId.get(acId);
    return fact === undefined || fact.attested_pass <= 0;
  });

  const droppedNamed: string[] = [];
  const manualSelfattested: string[] = [];
  const checklistBlocking: string[] = [];

  for (const item of checklist) {
    if (item.dropped !== undefined) {
      droppedNamed.push(item.id);
      continue;
    }

    const isManualChecked = item.bind.kind === "manual" && item.checked !== undefined;
    const isScriptPassed = item.bind.kind === "script" && item.result === "pass";

    if (isManualChecked) {
      manualSelfattested.push(item.id);
    }

    if (!isManualChecked && !isScriptPassed) {
      checklistBlocking.push(item.id);
    }
  }

  const blocking = [...acScopeBlocking, ...checklistBlocking];

  const vacuous =
    acScope.length === 0 && checklist.every((item) => item.dropped !== undefined);
  const done = !vacuous && blocking.length === 0;

  let state: PhaseCompletionState;
  if (vacuous) {
    state = "vacuous";
  } else if (done) {
    state = "done";
  } else if (claim !== undefined && !isClaimStale(claim, now.toISOString(), claimTtlMinutes)) {
    state = "active";
  } else {
    state = "pending";
  }

  return ok({
    state,
    blocking,
    dropped_named: droppedNamed,
    manual_selfattested: manualSelfattested,
  });
}
