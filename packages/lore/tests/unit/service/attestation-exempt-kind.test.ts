/**
 * Unit tests for `attestationExemptKindSchema` (@lore/core, schemas.ts),
 * `attestationExemptKindValid` (gate-predicates.ts), and `checkPlanClose`'s
 * exemption-kind-taxonomy enforcement (checkpoint-registry.ts) —
 * spec-verify-reachability-plan-promote-early-warning §Scope M3 / §Design
 * Decisions D3.
 *
 * D3: a bare `extra.attestation_exempt: true` with no typed
 * `extra.attestation_exempt_kind` is exactly the silent-fallback shape this
 * repo bans — fail loud, no legacy default. `checkPlanClose` now denies an
 * exemption claim with a missing OR invalid kind (the exemption does NOT
 * satisfy the attestation floor in that case), while a non-exempt plan is
 * entirely unaffected by this predicate.
 *
 * Pure functions + constructed `GateContext` fixtures only — no store, no
 * IO — hence vitest.
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / STATE / REGRESSION.
 *
 * @spec_ref spec-verify-reachability-plan-promote-early-warning §Scope M3,
 *   §Acceptance Criteria AC-VRW-3
 */

import { describe, it, expect } from "vitest";
import { attestationExemptKindSchema } from "@lore/core";
import {
  attestationExemptKindValid,
  ATTESTATION_EXEMPT_KIND_FIELD,
  ATTESTATION_EXEMPT_KIND_INVALID_REASON,
} from "../../../src/service/gate-predicates.js";
import {
  checkpointRegistry,
  isCheckpointBlocked,
  selectFailures,
  type GateContext,
} from "../../../src/service/checkpoint-registry.js";

const planClose = checkpointRegistry["plan-close"];
if (planClose === undefined) {
  throw new Error("plan-close checkpoint not registered — test fixture assumption broken");
}

describe("attestationExemptKindSchema", () => {
  // HAPPY — all 4 enum members accepted.
  for (const member of ["red-tdd", "no-oracle", "pipeline-unreachable", "other"] as const) {
    it(`accepts the '${member}' member`, () => {
      expect(attestationExemptKindSchema.safeParse(member).success).toBe(true);
    });
  }

  // NEGATIVE — >= 2 invalid values rejected.
  it("rejects an unrecognized string", () => {
    expect(attestationExemptKindSchema.safeParse("bogus-kind").success).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(attestationExemptKindSchema.safeParse("").success).toBe(false);
  });

  // BOUNDARY
  it("rejects undefined", () => {
    expect(attestationExemptKindSchema.safeParse(undefined).success).toBe(false);
  });

  it("rejects a case-mismatched member (schema is exact-match, not case-insensitive)", () => {
    expect(attestationExemptKindSchema.safeParse("Red-TDD").success).toBe(false);
  });
});

describe("attestationExemptKindValid", () => {
  // HAPPY — exempt + valid kind.
  it("passes when exempt and kind is a valid member", () => {
    expect(attestationExemptKindValid(true, "red-tdd")).toEqual({ ok: true });
  });

  // NEGATIVE — exempt + missing kind.
  it("fails when exempt and kind is undefined", () => {
    expect(attestationExemptKindValid(true, undefined)).toEqual({
      ok: false,
      reason: ATTESTATION_EXEMPT_KIND_INVALID_REASON,
      field: ATTESTATION_EXEMPT_KIND_FIELD,
    });
  });

  // NEGATIVE — exempt + invalid kind.
  it("fails when exempt and kind is not a valid member", () => {
    expect(attestationExemptKindValid(true, "bogus")).toEqual({
      ok: false,
      reason: ATTESTATION_EXEMPT_KIND_INVALID_REASON,
      field: ATTESTATION_EXEMPT_KIND_FIELD,
    });
  });

  // BOUNDARY — not exempt at all: vacuous pass regardless of kind.
  it("passes when not exempt, even with an invalid kind present", () => {
    expect(attestationExemptKindValid(false, "bogus")).toEqual({ ok: true });
  });

  it("passes when not exempt and kind is undefined", () => {
    expect(attestationExemptKindValid(false, undefined)).toEqual({ ok: true });
  });
});

describe("checkPlanClose — 4-row exemption-kind outcome table", () => {
  function ctxWith(overrides: Partial<GateContext>): GateContext {
    return {
      targetIdOrSlug: "plan-x",
      attestationMinRatio: 0.5,
      // No task evidence at all — a vacuous PASS for `attestationFloor` itself
      // when it runs, isolating THIS predicate's own contribution to the verdict.
      planTasksAttestation: [],
      ...overrides,
    };
  }

  // Row 1 — exempt + valid kind → PASSES.
  it("row 1: exempt=true, kind='red-tdd' (valid) → checkPlanClose PASSES", () => {
    const ctx = ctxWith({ attestationExempt: true, attestationExemptKind: "red-tdd" });
    expect(isCheckpointBlocked(planClose.check(ctx))).toBe(false);
  });

  // Row 2 — exempt + missing kind → DENIED.
  it("row 2: exempt=true, kind=undefined (missing) → checkPlanClose DENIES", () => {
    const ctx = ctxWith({ attestationExempt: true });
    const results = planClose.check(ctx);
    expect(isCheckpointBlocked(results)).toBe(true);
    expect(selectFailures(results).some((f) => f.field === ATTESTATION_EXEMPT_KIND_FIELD)).toBe(true);
  });

  // Row 3 — exempt + invalid kind → DENIED.
  it("row 3: exempt=true, kind='not-a-real-kind' (invalid) → checkPlanClose DENIES", () => {
    const ctx = ctxWith({ attestationExempt: true, attestationExemptKind: "not-a-real-kind" });
    const results = planClose.check(ctx);
    expect(isCheckpointBlocked(results)).toBe(true);
    expect(selectFailures(results).some((f) => f.field === ATTESTATION_EXEMPT_KIND_FIELD)).toBe(true);
  });

  // Row 4 — non-exempt → UNAFFECTED by this predicate (attestationFloor alone decides).
  it("row 4: exempt=false → attestationExemptKindValid contributes no failure either way (non-exempt, no evidence, vacuous floor PASS)", () => {
    const ctx = ctxWith({ attestationExempt: false });
    const results = planClose.check(ctx);
    expect(selectFailures(results).some((f) => f.field === ATTESTATION_EXEMPT_KIND_FIELD)).toBe(false);
    // vacuous attestationFloor pass (no evidence at all) — overall PASS too.
    expect(isCheckpointBlocked(results)).toBe(false);
  });

  it("row 4 variant: exempt=false with evidence gaps still blocks via attestationFloor alone, never via the kind predicate", () => {
    const ctx = ctxWith({
      attestationExempt: false,
      planTasksAttestation: [{ slug: "task-1", title: "T1", evidenceCount: 2, attestedCount: 0 }],
    });
    const results = planClose.check(ctx);
    expect(isCheckpointBlocked(results)).toBe(true);
    expect(selectFailures(results).some((f) => f.field === ATTESTATION_EXEMPT_KIND_FIELD)).toBe(false);
    expect(selectFailures(results).some((f) => f.field === "attestation-floor")).toBe(true);
  });

  // REGRESSION — an exempt+valid-kind plan bypasses the floor even with
  // unattested evidence present (the pre-M3 exemption behavior, still intact).
  it("REGRESSION: exempt=true + valid kind bypasses the floor even with unattested evidence present", () => {
    const ctx = ctxWith({
      attestationExempt: true,
      attestationExemptKind: "no-oracle",
      planTasksAttestation: [{ slug: "task-1", title: "T1", evidenceCount: 2, attestedCount: 0 }],
    });
    expect(isCheckpointBlocked(planClose.check(ctx))).toBe(false);
  });
});
