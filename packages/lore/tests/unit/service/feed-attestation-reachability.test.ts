/**
 * Unit tests for `feedAttestationFloor`'s reachability branch (checkpoint-registry.ts)
 * — spec-verify-reachability-plan-promote-early-warning §Scope M2 / §Design
 * Decisions D2.
 *
 * `feedAttestationFloor` renders `plan-close`'s attestation-floor-failure
 * feeding pack. This spec makes it branch on the SAME `verifyReachability`
 * derivation `planPromoteReachabilityAdvisory` (plan-promote) consumes:
 *
 *   - REACHABLE branch: byte-identical to the PRE-CHANGE text (regression pin
 *     below — captured from the checkpoint-registry.ts state at git HEAD
 *     immediately before this spec's edits landed, by invoking the actual
 *     pre-change `feedAttestationFloor` against a fixed fixture ctx).
 *   - UNREACHABLE branch: the `Recovery: run \`lore verify ...\`` sentence is
 *     REPLACED by a precondition explanation + the two real options
 *     (reparent under a spec with script-mode ACs, or a typed exemption) —
 *     the string "Recovery: run" must not appear anywhere in the rendered
 *     text, and both options must be named.
 *
 * Constructed `GateContext` fixtures only — no store, no IO — hence vitest.
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / REGRESSION.
 *
 * @spec_ref spec-verify-reachability-plan-promote-early-warning §Scope M2,
 *   §Acceptance Criteria AC-VRW-2
 */

import { describe, it, expect } from "vitest";
import {
  checkpointRegistry,
  selectFailures,
  type GateContext,
} from "../../../src/service/checkpoint-registry.js";

const planClose = checkpointRegistry["plan-close"];
if (planClose === undefined) {
  throw new Error("plan-close checkpoint not registered — test fixture assumption broken");
}

/**
 * REGRESSION PIN (AC-VRW-2) — captured by invoking the UNMODIFIED (pre-this-
 * spec) `feedAttestationFloor` against this exact fixture ctx, BEFORE any
 * source edits landed. If the reachable branch ever legitimately needs to
 * change, re-capture this fixture the same way (from git HEAD) and update
 * this constant deliberately — do not "fix" a failing assertion by editing
 * it to match a drifted production string.
 *
 * RE-CAPTURED (spec-plan-close-predicates-measure-invariants-an-applicability
 * §D5, task T2, AC-PCI-9): the PREFIX before "Task(s) with self-reported-only
 * evidence..." changed — the base rule sentence now names the per-claimed-AC
 * coverage conjunct (§D3's new default teeth) instead of unconditionally
 * mentioning the ratio, and the ratio clause itself is a separate sentence
 * (rendered only when `min_ratio` is configured, which THIS fixture's
 * `attestationMinRatio: 0.5` still is). Every byte from
 * "Task(s) with self-reported-only evidence" through the end — INCLUDING the
 * `Recovery: run …` sentence this constant's name refers to — is UNCHANGED;
 * re-captured here by literally invoking the real (post-T2) `feedAttestationFloor`
 * against this exact fixture ctx, never hand-typed.
 */
const PRE_CHANGE_REACHABLE_TEXT =
  "[source: corpus (task verification_evidence), trust: team-authored]\n\nMissing:\n- ATTESTATION_FLOOR_NOT_MET\n\n## Rule\nRequired for plan-close: every task carrying verification_evidence must carry at least one runner-issued (attested) entry, and every claimed acceptance criterion (a declared script-mode AC with >= 1 evidence reference) must carry at least one runner-attested entry. The plan-wide attested ratio must be >= 0.5 (currently 0.40). Task(s) with self-reported-only evidence (zero runner-attested entries): task-1 — \"Task One\". Listed for DIAGNOSTIC purposes only — the exemption below is PLAN-level; do NOT write `extra.attestation_exempt` onto any of these tasks, this gate never reads it there. Recovery: run `lore verify plan-example` to record attested evidence against each task's declared script-mode acceptance criteria (declare one first via `lore ac add <spec> <id> --mode script ...` if none exists yet). If this plan genuinely has no oracle to attest against for some of its tasks — the canonical case is a RED/TDD task whose Expected state is a currently-failing, time-bound test (red before green: the evidence is real, attesting it would misrepresent an intentionally-red state as verified) — the exemption is declared on the PLAN ITSELF, never on a task: set `extra.attestation_exempt: true` plus a non-empty `extra.attestation_exempt_reason` on plan-example. `extra` REPLACES the whole field wholesale on `lore_set` (it does NOT merge) — first fetch the current extra via `lore get plan-example --json` (read `.extra`), merge `{\"attestation_exempt\": true, \"attestation_exempt_reason\": \"<why>\"}` into it while KEEPING every existing key (e.g. `phases`), then call the MCP `lore_set` tool with the FULL merged object as `extra` on plan-example. `lore set` (CLI) has no dedicated flag for this field yet.";

/** The exact fixture ctx the pin above was captured against. */
function baseFixtureCtx(overrides: Partial<GateContext>): GateContext {
  return {
    targetIdOrSlug: "plan-example",
    attestationMinRatio: 0.5,
    planTasksAttestation: [
      { slug: "task-1", title: "Task One", evidenceCount: 3, attestedCount: 0 },
      { slug: "task-2", title: "Task Two", evidenceCount: 2, attestedCount: 2 },
    ],
    ...overrides,
  };
}

const renderAttestationFloorFeed = (ctx: GateContext): string => {
  // reason: task-t1-applicability-verdict-in-the-predicate-s-own-type-both —
  // `checkPlanClose`'s check() can now also return a `PredicateNotApplicable`
  // member; `selectFailures` narrows those out (never a failure) the same way
  // it already narrows out `{ok: true}` passes, so this fixture's raw
  // `.filter((r) => !r.ok)` (which no longer compiles against the widened
  // `ApplicablePredicateResult[]` return type) is replaced with the shared,
  // notApplicable-aware helper rather than re-deriving the narrowing here.
  const failures = selectFailures(planClose.check(ctx));
  return planClose.feed(ctx, failures);
};

describe("feedAttestationFloor — reachability branch", () => {
  // REGRESSION — byte-identical pin.
  it("REGRESSION: the reachable branch is byte-identical to the pre-change text", () => {
    const ctx = baseFixtureCtx({ hasSpecParent: true, parentSpecScriptAcCount: 3 });
    expect(renderAttestationFloorFeed(ctx)).toBe(PRE_CHANGE_REACHABLE_TEXT);
  });

  it("HAPPY: the reachable branch still contains the lore verify recovery command", () => {
    const ctx = baseFixtureCtx({ hasSpecParent: true, parentSpecScriptAcCount: 1 });
    const text = renderAttestationFloorFeed(ctx);
    expect(text).toContain("Recovery: run `lore verify plan-example`");
  });

  // NEGATIVE — unreachable because no spec-tier ancestor.
  it("NEGATIVE: the unreachable branch (no spec ancestor) contains zero occurrences of 'Recovery: run'", () => {
    const ctx = baseFixtureCtx({ hasSpecParent: false });
    const text = renderAttestationFloorFeed(ctx);
    expect(text).not.toContain("Recovery: run");
  });

  // NEGATIVE — unreachable because the ancestor spec has zero script-mode ACs.
  it("NEGATIVE: the unreachable branch (zero script ACs) contains zero occurrences of 'Recovery: run'", () => {
    const ctx = baseFixtureCtx({ hasSpecParent: true, parentSpecScriptAcCount: 0 });
    const text = renderAttestationFloorFeed(ctx);
    expect(text).not.toContain("Recovery: run");
  });

  // BOUNDARY — the caller never resolved the new reachability fields at all
  // (ctx built before this spec landed) — must resolve deterministically
  // (unreachable) rather than throwing or silently defaulting to "reachable".
  it("BOUNDARY: a ctx that never populated hasSpecParent/parentSpecScriptAcCount renders the unreachable branch", () => {
    const ctx = baseFixtureCtx({});
    const text = renderAttestationFloorFeed(ctx);
    expect(text).not.toContain("Recovery: run");
  });

  // Both real options named in the unreachable branch.
  it("names both real options in the unreachable branch: parent under a spec with script ACs, or a typed exemption", () => {
    const ctx = baseFixtureCtx({ hasSpecParent: false });
    const text = renderAttestationFloorFeed(ctx);
    expect(text).toContain("script-mode acceptance criterion");
    expect(text).toContain("lore ac add <spec> <id> --mode script");
    expect(text).toContain("typed exemption");
    expect(text).toContain("attestation_exempt_kind");
  });

  // The unreachable branch keeps the existing exemption-mechanics text
  // (fetch-merge-set instructions, the PLAN-level-only caveat, RED/TDD
  // rationale) — nothing was silently dropped, only the impossible
  // `lore verify` recommendation was replaced.
  it("keeps the existing exemption-mechanics text in the unreachable branch", () => {
    const ctx = baseFixtureCtx({ hasSpecParent: false });
    const text = renderAttestationFloorFeed(ctx);
    expect(text).toContain("on the PLAN ITSELF, never on a task");
    expect(text).toContain("does NOT merge");
    expect(text).toContain("KEEPING every existing key");
    expect(text).toContain("RED/TDD");
    expect(text).toContain("do NOT write");
  });

  // The offending-task diagnostic listing is preserved identically in both
  // branches — only the recovery sentence differs.
  it("preserves the offending-task diagnostic listing in both branches", () => {
    const reachable = renderAttestationFloorFeed(
      baseFixtureCtx({ hasSpecParent: true, parentSpecScriptAcCount: 2 }),
    );
    const unreachable = renderAttestationFloorFeed(baseFixtureCtx({ hasSpecParent: false }));
    expect(reachable).toContain('task-1 — "Task One"');
    expect(unreachable).toContain('task-1 — "Task One"');
  });
});
