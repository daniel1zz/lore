/**
 * Unit tests for the gate checkpoint registry (`checkpoint-registry.ts`) — the pure
 * decision layer `lore gate` dispatches through (IoC vertical-slice tech-spec §5.1).
 * Pure functions only — no store, no IO, no bun:sqlite — hence vitest, not `.bun.test`.
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / ERROR / REGRESSION.
 * STATE is intentionally absent — these are pure functions with no persisted or
 * mutable state to transition (mirrors gate-predicates.test.ts's documented rationale).
 *
 * @spec_ref TECH-SPEC "Corpus-governed spec-production loop — IoC vertical slice" §4.1 §5.1 §11
 */

import { describe, it, expect } from "vitest";
import {
  checkpointRegistry,
  isCheckpointBlocked,
  selectFailures,
  buildUpstreamSpecContext,
  isNonPlanParentError,
  type GateContext,
} from "../../../src/service/checkpoint-registry.js";
import { verifyReachability } from "../../../src/service/gate-predicates.js";
import type { DocRecord, LoreError } from "@lore/core";

describe("checkpointRegistry", () => {
  // HAPPY — registry shape: all four GateCheckpoint members are now populated
  // (plan-promote / task-claim joined spec-create / spec-promote — the two
  // commit-time cross-tier gates).
  it("has entries for spec-create, spec-promote, plan-promote, and task-claim", () => {
    expect(checkpointRegistry["spec-create"]).toBeDefined();
    expect(checkpointRegistry["spec-promote"]).toBeDefined();
    expect(checkpointRegistry["plan-promote"]).toBeDefined();
    expect(checkpointRegistry["task-claim"]).toBeDefined();
    expect(checkpointRegistry["spec-create"]?.id).toBe("spec-create");
    expect(checkpointRegistry["spec-promote"]?.id).toBe("spec-promote");
    expect(checkpointRegistry["plan-promote"]?.id).toBe("plan-promote");
    expect(checkpointRegistry["task-claim"]?.id).toBe("task-claim");
  });

  describe("spec-create checkpoint", () => {
    const checkpoint = checkpointRegistry["spec-create"]!;

    // HAPPY
    it("check() returns an array of PredicateResult for a fully valid candidate", () => {
      const ctx: GateContext = { parentType: "prd", specKind: "tech", content: "## Overview\nx" };
      const results = checkpoint.check(ctx);
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(typeof r.ok).toBe("boolean");
      }
      expect(isCheckpointBlocked(results)).toBe(false);
    });

    // NEGATIVE
    it("check() reports a failure when parent is missing", () => {
      const ctx: GateContext = { parentType: null, specKind: "tech", content: "## Overview\nx" };
      const results = checkpoint.check(ctx);
      expect(isCheckpointBlocked(results)).toBe(true);
      const failures = selectFailures(results);
      expect(failures.some((f) => f.reason === "PARENT_REQUIRED")).toBe(true);
    });

    // NEGATIVE
    it("check() reports a failure for an invalid parent type", () => {
      const ctx: GateContext = { parentType: "task", specKind: "tech", content: "## Overview\nx" };
      const results = checkpoint.check(ctx);
      expect(selectFailures(results).some((f) => f.reason === "INVALID_PARENT_TYPE")).toBe(true);
    });

    // NEGATIVE
    it("check() reports a failure for an invalid spec_kind", () => {
      const ctx: GateContext = { parentType: "prd", specKind: "bogus", content: "## Overview\nx" };
      const results = checkpoint.check(ctx);
      expect(selectFailures(results).some((f) => f.reason === "INVALID_SPEC_KIND")).toBe(true);
    });

    // NEGATIVE
    it("check() reports a failure when content has no skeleton heading", () => {
      const ctx: GateContext = { parentType: "prd", specKind: "tech", content: "no heading" };
      const results = checkpoint.check(ctx);
      expect(selectFailures(results).some((f) => f.reason === "MISSING_SKELETON")).toBe(true);
    });

    // BOUNDARY — specKind undefined must not block (defaults to "feature" at create time)
    it("check() passes when specKind is undefined", () => {
      const ctx: GateContext = { parentType: "prd", content: "## Overview\nx" };
      const results = checkpoint.check(ctx);
      expect(isCheckpointBlocked(results)).toBe(false);
    });

    // ERROR / BOUNDARY — content omitted entirely defaults to "" (no skeleton)
    it("check() treats an omitted content field as empty (fails MISSING_SKELETON)", () => {
      const ctx: GateContext = { parentType: "prd", specKind: "tech" };
      const results = checkpoint.check(ctx);
      expect(selectFailures(results).some((f) => f.reason === "MISSING_SKELETON")).toBe(true);
    });

    // HAPPY — verdict purity: same input in, same output out
    it("check() is a pure function of GateContext (same input, same output, repeated calls)", () => {
      const ctx: GateContext = { parentType: "task", specKind: "bogus", content: "no heading" };
      const first = checkpoint.check(ctx);
      const second = checkpoint.check(ctx);
      expect(second).toEqual(first);
      // Re-running yet again must not mutate or drift.
      expect(checkpoint.check(ctx)).toEqual(first);
    });

    // HAPPY — feed() renders the feeding-pack text, sourced from ctx
    it("feed() renders a feeding-pack block carrying the rule source, missing reasons, and slices", () => {
      const ctx: GateContext = { parentType: null, specKind: "tech", content: "no heading" };
      const results = checkpoint.check(ctx);
      const failures = selectFailures(results);
      const feedCtx: GateContext = {
        ...ctx,
        ruleSource: "knowledge-write-spec-rules",
        ruleMarkdown: "## Rule\nEvery spec needs a legal parent.",
      };
      const text = checkpoint.feed(feedCtx, failures);
      expect(text).toContain("[source: knowledge-write-spec-rules, trust: team-authored]");
      expect(text).toContain("- PARENT_REQUIRED");
      expect(text).toContain("- MISSING_SKELETON");
      expect(text).toContain("Every spec needs a legal parent.");
    });

    // NEGATIVE — feed() includes the parent slice only when parentMarkdown is supplied
    it("feed() omits the parent section when parentMarkdown is absent from ctx", () => {
      const ctx: GateContext = { parentType: null, specKind: "tech", content: "no heading" };
      const results = checkpoint.check(ctx);
      const text = checkpoint.feed(
        { ...ctx, ruleSource: "src", ruleMarkdown: "rule body" },
        selectFailures(results),
      );
      expect(text).not.toContain("## Parent");
    });
  });

  describe("spec-promote checkpoint", () => {
    const checkpoint = checkpointRegistry["spec-promote"]!;

    // HAPPY
    it("check() passes when at least one acceptance criterion is declared", () => {
      const ctx: GateContext = { acceptanceCriteriaCount: 1, specIdOrSlug: "spec-x" };
      const results = checkpoint.check(ctx);
      expect(isCheckpointBlocked(results)).toBe(false);
    });

    // BOUNDARY — the exact "1" threshold
    it("check() passes at the exact boundary of 1 declared criterion", () => {
      const results = checkpoint.check({ acceptanceCriteriaCount: 1 });
      expect(isCheckpointBlocked(results)).toBe(false);
    });

    // NEGATIVE
    it("check() fails when zero acceptance criteria are declared", () => {
      const ctx: GateContext = { acceptanceCriteriaCount: 0, specIdOrSlug: "spec-x" };
      const results = checkpoint.check(ctx);
      expect(isCheckpointBlocked(results)).toBe(true);
    });

    // BOUNDARY — count omitted entirely defaults to 0 (fails, same as explicit 0)
    it("check() treats an omitted acceptanceCriteriaCount as 0 (fails)", () => {
      const results = checkpoint.check({ specIdOrSlug: "spec-x" });
      expect(isCheckpointBlocked(results)).toBe(true);
    });

    // HAPPY — verdict purity
    it("check() is a pure function of GateContext", () => {
      const ctx: GateContext = { acceptanceCriteriaCount: 0, specIdOrSlug: "spec-x" };
      expect(checkpoint.check(ctx)).toEqual(checkpoint.check(ctx));
    });

    // HAPPY — feed() renders the exact error message shape spec-promote used pre-registry
    it("feed() renders the no-acceptance-criteria error message with the spec id/slug", () => {
      const ctx: GateContext = { acceptanceCriteriaCount: 0, specIdOrSlug: "spec-x" };
      const results = checkpoint.check(ctx);
      const text = checkpoint.feed(ctx, selectFailures(results));
      expect(text).toContain('spec "spec-x"');
      expect(text).toContain("no structured acceptance criteria");
      expect(text).toContain("lore ac add");
    });

    // task-spec-promote-base-1-ac-rule-is-spec-kind-agnostic-spec-080 — profile-aware
    // AC floor wired end-to-end through the checkpoint (not just the bare predicate).

    // HAPPY — a spec_kind whose profile waives the floor (min_acs: 0) promotes AC-less
    it("check() passes with zero declared ACs when ctx.verificationProfile.min_acs is 0", () => {
      const ctx: GateContext = {
        acceptanceCriteriaCount: 0,
        specIdOrSlug: "spec-domain",
        specKind: "domain-overview",
        verificationProfile: { min_acs: 0 },
      };
      const results = checkpoint.check(ctx);
      expect(isCheckpointBlocked(results)).toBe(false);
    });

    // NEGATIVE — a spec_kind with NO min_acs knob (profile present for oracle
    // coverage only) still requires >= 1, byte-compatible with pre-existing behavior
    it("check() still fails with zero ACs when the profile declares no min_acs", () => {
      const ctx: GateContext = {
        acceptanceCriteriaCount: 0,
        specIdOrSlug: "spec-design",
        specKind: "design",
        verificationProfile: { required_oracles: ["e2e"] },
      };
      const results = checkpoint.check(ctx);
      expect(isCheckpointBlocked(results)).toBe(true);
    });

    // BOUNDARY — a configured min_acs of 2 is exactly met
    it("check() passes at the exact boundary of a configured min_acs of 2", () => {
      const ctx: GateContext = {
        acceptanceCriteriaCount: 2,
        specIdOrSlug: "spec-x",
        verificationProfile: { min_acs: 2 },
      };
      expect(isCheckpointBlocked(checkpoint.check(ctx))).toBe(false);
    });

    // BOUNDARY — one short of a configured min_acs of 2 fails
    it("check() fails one short of a configured min_acs of 2", () => {
      const ctx: GateContext = {
        acceptanceCriteriaCount: 1,
        specIdOrSlug: "spec-x",
        verificationProfile: { min_acs: 2 },
      };
      expect(isCheckpointBlocked(checkpoint.check(ctx))).toBe(true);
    });

    // REGRESSION — feature/tech/design kinds (no min_acs declared) keep the exact
    // pre-existing ">= 1" behavior byte-compatible when NO verificationProfile is
    // resolved at all (the pre-SPEC-058-profile-aware-floor shape every existing
    // caller without a configured profile still exercises).
    it("REGRESSION: check() with no verificationProfile in ctx behaves exactly as before (>= 1)", () => {
      expect(isCheckpointBlocked(checkpoint.check({ acceptanceCriteriaCount: 0 }))).toBe(true);
      expect(isCheckpointBlocked(checkpoint.check({ acceptanceCriteriaCount: 1 }))).toBe(false);
    });

    // HAPPY — feed() names the RESOLVED floor and kind (AC4), not a hardcoded "1"
    it("feed() names the resolved floor and spec_kind for a below-floor design spec", () => {
      const ctx: GateContext = {
        acceptanceCriteriaCount: 0,
        specIdOrSlug: "spec-design",
        specKind: "design",
        verificationProfile: { required_oracles: ["e2e"], min_acs: 2 },
      };
      const results = checkpoint.check(ctx);
      const text = checkpoint.feed(ctx, selectFailures(results));
      expect(text).toContain("needs >= 2");
      expect(text).toContain('spec_kind "design"');
    });

    // BOUNDARY — feed() falls back to "unknown" for the kind when ctx.specKind is
    // absent, never fabricating a kind the caller never supplied
    it("feed() names spec_kind \"unknown\" when ctx.specKind was never populated", () => {
      const ctx: GateContext = { acceptanceCriteriaCount: 0, specIdOrSlug: "spec-x" };
      const results = checkpoint.check(ctx);
      const text = checkpoint.feed(ctx, selectFailures(results));
      expect(text).toContain("needs >= 1");
      expect(text).toContain('spec_kind "unknown"');
    });
  });

  describe("plan-promote checkpoint", () => {
    const checkpoint = checkpointRegistry["plan-promote"]!;
    const approvedSpecWithAc: GateContext = {
      hasSpecParent: true,
      parentSpec: {
        type: "spec",
        status: "approved",
        extra: { acceptance_criteria: [{ id: "AC-1", statement: "x", verify: { mode: "human" } }] },
        deleted_at: null,
      },
      parentSpecPointer: { slug: "spec-x", title: "Spec X", status: "approved" },
    };

    // HAPPY
    it("check() passes when the ancestor spec is approved and has ≥1 declared AC", () => {
      const results = checkpoint.check(approvedSpecWithAc);
      expect(isCheckpointBlocked(results)).toBe(false);
    });

    // BOUNDARY — no spec-tier ancestor at all ⇒ vacuous pass (module invariant)
    it("check() returns [] (vacuous pass) when hasSpecParent is false", () => {
      const results = checkpoint.check({ hasSpecParent: false });
      expect(results).toEqual([]);
      expect(isCheckpointBlocked(results)).toBe(false);
    });

    // BOUNDARY — hasSpecParent omitted entirely defaults to the same vacuous-pass path
    it("check() returns [] (vacuous pass) when hasSpecParent is omitted", () => {
      const results = checkpoint.check({});
      expect(results).toEqual([]);
    });

    // NEGATIVE
    it("check() fails with UPSTREAM_NOT_APPROVED when the ancestor spec is draft", () => {
      const ctx: GateContext = {
        ...approvedSpecWithAc,
        parentSpec: { ...approvedSpecWithAc.parentSpec!, status: "draft" },
      };
      const failures = selectFailures(checkpoint.check(ctx));
      expect(failures.some((f) => f.reason === "UPSTREAM_NOT_APPROVED")).toBe(true);
    });

    // NEGATIVE (adversarial-review FIX 3) — a soft-deleted ancestor spec blocks EVEN
    // THOUGH it's approved with ≥1 declared AC (softDelete never touches status).
    it("check() fails with UPSTREAM_DELETED when the approved+AC ancestor spec is soft-deleted", () => {
      const ctx: GateContext = {
        ...approvedSpecWithAc,
        parentSpec: {
          ...approvedSpecWithAc.parentSpec!,
          deleted_at: "2026-07-09T00:00:00.000Z",
        },
      };
      const failures = selectFailures(checkpoint.check(ctx));
      expect(failures.some((f) => f.reason === "UPSTREAM_DELETED")).toBe(true);
    });

    // NEGATIVE
    it("check() fails with UPSTREAM_NO_AC when the approved ancestor spec has zero declared AC", () => {
      const ctx: GateContext = {
        ...approvedSpecWithAc,
        parentSpec: { type: "spec", status: "approved", extra: {}, deleted_at: null },
      };
      const failures = selectFailures(checkpoint.check(ctx));
      expect(failures.some((f) => f.reason === "UPSTREAM_NO_AC")).toBe(true);
    });

    // HAPPY — verdict purity
    it("check() is a pure function of GateContext", () => {
      const ctx: GateContext = { ...approvedSpecWithAc, parentSpec: { ...approvedSpecWithAc.parentSpec!, status: "draft" } };
      expect(checkpoint.check(ctx)).toEqual(checkpoint.check(ctx));
    });

    // HAPPY — feed() renders a pointers-not-dump feeding pack
    it("feed() renders the ancestor spec pointer, missing reasons, and a provenance header", () => {
      const ctx: GateContext = {
        ...approvedSpecWithAc,
        parentSpec: { ...approvedSpecWithAc.parentSpec!, status: "draft" },
      };
      const results = checkpoint.check(ctx);
      const text = checkpoint.feed(ctx, selectFailures(results));
      expect(text).toContain("[source: corpus spec-x, trust: team-authored]");
      expect(text).toContain("- UPSTREAM_NOT_APPROVED");
      expect(text).toContain("spec-x");
      expect(text).toContain("Spec X");
      expect(text.toLowerCase()).toContain("approved");
    });
  });

  describe("task-claim checkpoint", () => {
    const checkpoint = checkpointRegistry["task-claim"]!;
    const approvedSpec: GateContext = {
      hasSpecParent: true,
      parentSpec: { type: "spec", status: "approved", extra: {}, deleted_at: null },
      parentSpecPointer: { slug: "spec-y", title: "Spec Y", status: "approved" },
    };

    // HAPPY
    it("check() passes when the ancestor spec is approved (AC count irrelevant to this gate)", () => {
      const results = checkpoint.check(approvedSpec);
      expect(isCheckpointBlocked(results)).toBe(false);
    });

    // BOUNDARY — no spec-tier ancestor ⇒ upstreamApproved is skipped, but
    // noAnchorOverlap AND actorIdentityGuard (spec claim-time-actor-identity-
    // guard-zero-evidence-release-advis, AC-IDENTITY-REJECT) STILL run
    // (SPEC-042 D5 — this checkpoint no longer short-circuits any of the
    // three predicates on hasSpecParent:false, only the upstream one; with no
    // candidateAnchors/siblingClaims/candidateIdentitySource supplied here,
    // both vacuously pass, so the overall result is still an unblocked pass —
    // just no longer a literal empty array).
    it("check() runs noAnchorOverlap and actorIdentityGuard unconditionally even when hasSpecParent is false (SPEC-042 D5)", () => {
      const results = checkpoint.check({ hasSpecParent: false });
      expect(isCheckpointBlocked(results)).toBe(false);
      expect(results).toEqual([{ ok: true }, { ok: true }]);
    });

    // REGRESSION (SPEC-042 D5, AC-S3-3) — the hole two adversarial-review lenses
    // independently flagged: a plan with NO spec ancestor whose sibling task holds
    // a fresh, foreign, anchor-overlapping claim must STILL be blocked.
    it("check() BLOCKS on an anchor overlap even when hasSpecParent is false", () => {
      const ctx: GateContext = {
        hasSpecParent: false,
        candidateBy: "agent:t2",
        candidateAnchors: ["src/a"],
        siblingClaims: [
          { slug: "task-1", title: "T1", by: "agent:t1", at: "T0", stale: false, anchors: ["src/a/"] },
        ],
      };
      const results = checkpoint.check(ctx);
      expect(isCheckpointBlocked(results)).toBe(true);
      const failures = selectFailures(results);
      expect(failures).toHaveLength(1);
      expect(failures[0]?.field).toBe("anchor-overlap");
    });

    // NEGATIVE
    it("check() fails with UPSTREAM_NOT_APPROVED when the ancestor spec is in-review", () => {
      const ctx: GateContext = { ...approvedSpec, parentSpec: { ...approvedSpec.parentSpec!, status: "in-review" } };
      const failures = selectFailures(checkpoint.check(ctx));
      expect(failures).toEqual([{ ok: false, reason: "UPSTREAM_NOT_APPROVED" }]);
    });

    // NEGATIVE (adversarial-review FIX 3) — soft-deleted approved ancestor spec blocks.
    it("check() fails with UPSTREAM_DELETED when the approved ancestor spec is soft-deleted", () => {
      const ctx: GateContext = {
        ...approvedSpec,
        parentSpec: { ...approvedSpec.parentSpec!, deleted_at: "2026-07-09T00:00:00.000Z" },
      };
      const failures = selectFailures(checkpoint.check(ctx));
      expect(failures).toEqual([{ ok: false, reason: "UPSTREAM_DELETED" }]);
    });

    // HAPPY — feed() renders a pointers-not-dump feeding pack, distinct requirement sentence
    it("feed() renders the ancestor spec pointer and a task-claim-specific requirement", () => {
      const ctx: GateContext = { ...approvedSpec, parentSpec: { ...approvedSpec.parentSpec!, status: "draft" } };
      const results = checkpoint.check(ctx);
      const text = checkpoint.feed(ctx, selectFailures(results));
      expect(text).toContain("[source: corpus spec-y, trust: team-authored]");
      expect(text).toContain("- UPSTREAM_NOT_APPROVED");
      expect(text).toContain("task-claim");
    });
  });

  // REGRESSION — the aggregate "block iff any {ok:false}" rule, exercised generically
  // across both registered checkpoints so it can never drift between them.
  describe("isCheckpointBlocked (aggregate rule)", () => {
    it("is false for an empty result array (vacuously not blocked)", () => {
      expect(isCheckpointBlocked([])).toBe(false);
    });

    it("is false when every result passed", () => {
      expect(isCheckpointBlocked([{ ok: true }, { ok: true }])).toBe(false);
    });

    it("is true when at least one result failed, regardless of position", () => {
      expect(isCheckpointBlocked([{ ok: false, reason: "X" }, { ok: true }])).toBe(true);
      expect(isCheckpointBlocked([{ ok: true }, { ok: false, reason: "X" }])).toBe(true);
    });

    it("is true when every result failed", () => {
      expect(
        isCheckpointBlocked([
          { ok: false, reason: "A" },
          { ok: false, reason: "B" },
        ]),
      ).toBe(true);
    });
  });

  describe("selectFailures", () => {
    it("returns only the failing entries, preserving order", () => {
      const results = [
        { ok: true as const },
        { ok: false as const, reason: "A" },
        { ok: true as const },
        { ok: false as const, reason: "B" },
      ];
      expect(selectFailures(results)).toEqual([
        { ok: false, reason: "A" },
        { ok: false, reason: "B" },
      ]);
    });

    it("returns an empty array when nothing failed", () => {
      expect(selectFailures([{ ok: true }, { ok: true }])).toEqual([]);
    });
  });

  // STATE dimension: N/A. All exported functions are pure functions of their
  // arguments — no persisted state, no store, no lifecycle transition to exercise.
  // Exempt per ~/.claude/skills/test/ (pure-function modules carry no STATE dimension).

  // buildUpstreamSpecContext — relocated (retro follow-up item 8, defense-in-depth)
  // from the CLI adapter's former local gate.ts::buildUpstreamSpecContext so both
  // `lore gate plan-promote`/`task-claim` AND the service-layer GateEnforcer build
  // the identical ctx shape from the identical resolved-spec input. Direct unit
  // coverage was previously only indirect (via gate.ts's CLI integration tests) —
  // now exercised directly at its new SSOT location.
  describe("buildUpstreamSpecContext", () => {
    // HAPPY
    it("returns hasSpecParent=false for an undefined spec (no spec-tier ancestor)", () => {
      expect(buildUpstreamSpecContext(undefined)).toEqual({ hasSpecParent: false });
    });

    // HAPPY
    it("returns hasSpecParent=true + parentSpec + parentSpecPointer for a resolved spec", () => {
      const spec = {
        id: "01ABCDEFGHJKMNPQRSTVWXYZ00",
        slug: "spec-example",
        title: "Example Spec",
        type: "spec",
        status: "approved",
        extra: { acceptance_criteria: [] },
        deleted_at: null,
      } as unknown as DocRecord;

      expect(buildUpstreamSpecContext(spec)).toEqual({
        hasSpecParent: true,
        parentSpec: {
          type: "spec",
          status: "approved",
          extra: { acceptance_criteria: [] },
          deleted_at: null,
        },
        parentSpecPointer: { slug: "spec-example", title: "Example Spec", status: "approved" },
      });
    });

    // REGRESSION — soft-deleted upstream spec must still be reported hasSpecParent:true
    // (a WITHDRAWN ancestor, never the vacuous "no spec tier" case; `upstreamApproved`'s
    // own predicate — not this ctx builder — decides UPSTREAM_DELETED disqualifies it).
    it("threads a non-null deleted_at through parentSpec even though status still reads approved", () => {
      const spec = {
        id: "01ABCDEFGHJKMNPQRSTVWXYZ00",
        slug: "spec-deleted",
        title: "Soft-Deleted Spec",
        type: "spec",
        status: "approved",
        extra: {},
        deleted_at: "2026-07-09T00:00:00.000Z",
      } as unknown as DocRecord;

      const ctx = buildUpstreamSpecContext(spec);
      expect(ctx.hasSpecParent).toBe(true);
      expect(ctx.parentSpec?.deleted_at).toBe("2026-07-09T00:00:00.000Z");
    });
  });

  // ─── isNonPlanParentError (SPEC-069 ad-hoc gap fix) ─────────────────────────
  describe("isNonPlanParentError", () => {
    // HAPPY — the exact shape `CorpusService.getPlanBundle` returns for a
    // resolved-but-not-plan parent (e.g. an ad-hoc task's root-PRD parent).
    it("is true for the exact {VALIDATION_ERROR, field: 'type'} shape getPlanBundle returns for a non-plan parent", () => {
      const error: LoreError = {
        code: "VALIDATION_ERROR",
        field: "type",
        message: "Expected a plan document; got type 'prd'",
        value: "prd",
      };
      expect(isNonPlanParentError(error)).toBe(true);
    });

    // NEGATIVE — every OTHER getPlanBundle failure shape must NOT be mistaken
    // for the structural non-plan-parent case (these must still propagate as
    // hard failures, unchanged).
    it("is false for DOC_NOT_FOUND (an unresolvable or soft-deleted parent)", () => {
      const error: LoreError = { code: "DOC_NOT_FOUND", id: "01ABCDEFGHJKMNPQRSTVWXYZ00" };
      expect(isNonPlanParentError(error)).toBe(false);
    });

    it("is false for a STORE_ERROR", () => {
      const error: LoreError = { code: "STORE_ERROR", message: "disk full" };
      expect(isNonPlanParentError(error)).toBe(false);
    });

    // BOUNDARY — a VALIDATION_ERROR on a DIFFERENT field must not be confused
    // with the specific "wrong doc type" shape.
    it("is false for a VALIDATION_ERROR on a different field", () => {
      const error: LoreError = {
        code: "VALIDATION_ERROR",
        field: "plan.extra.ac_scope",
        message: "declares a schema-invalid ac_scope",
        value: {},
      };
      expect(isNonPlanParentError(error)).toBe(false);
    });
  });
});

/**
 * RED/TDD scenarios for spec-plan-closure-must-be-loud-terminality-divergence-
 * silent §Design Decisions DD-4(b) — AC-CLOSURE-5.
 *
 * Ground truth (live 2026-07-28 incident): a plan whose `parent_id` WAS an
 * approved tech spec declaring script-mode ACs was told by the plan-close deny
 * pack that it "has no spec-tier ancestor at all" — a DEFINITE claim rendered
 * from a field (`GateContext.hasSpecParent`) the real caller never populated at
 * all. `verifyReachability(planParentType, ...)` today maps ANY
 * `planParentType !== "spec"` — including `undefined` ("caller told me
 * nothing") — onto the SAME `why: "parent-not-spec"` a caller-resolved,
 * genuinely-non-spec parent (e.g. `"prd"`) also produces. Absence of evidence
 * must never render as evidence of absence.
 *
 * `describeReachabilityWhy` (the sole place the "no spec-tier ancestor" /
 * "zero script-mode acceptance criteria" prose is written) is module-private
 * to checkpoint-registry.ts — exercised here indirectly through the exported
 * `checkpointRegistry["plan-close"].feed()` path (`feedAttestationFloor`), the
 * SAME live call site DD-4(b) targets, mirroring
 * `feed-attestation-reachability.test.ts`'s established fixture shape.
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / STATE.
 *
 * @spec_ref spec-plan-closure-must-be-loud-terminality-divergence-silent
 *   §Design Decisions DD-4(b), §Acceptance Criteria AC-CLOSURE-5
 */
describe("reachability unknown vs known-false (verifyReachability / describeReachabilityWhy)", () => {
  // HAPPY — the caller never supplied a parent type at all (`undefined`) must
  // resolve to an UNKNOWN outcome, distinct from the definite "parent-not-spec"
  // claim — this is the exact gap DD-4(b) closes.
  it("HAPPY: verifyReachability(undefined, ...) reports an unknown outcome, not parent-not-spec", () => {
    const result = verifyReachability(undefined, undefined);
    expect(result.why).not.toBe("parent-not-spec");
    expect(result.reachable).toBe(false);
  });

  // NEGATIVE — a caller-RESOLVED, genuinely non-spec parent type is a true
  // negative and must keep reporting parent-not-spec; the fix must not blur
  // "known false" into "unknown".
  it("NEGATIVE: verifyReachability('prd', 0) still reports parent-not-spec (true negative preserved)", () => {
    expect(verifyReachability("prd", 0)).toEqual({ reachable: false, why: "parent-not-spec" });
  });

  // BOUNDARY — a resolved spec parent with zero declared script-mode ACs is
  // unchanged by this fix.
  it("BOUNDARY: verifyReachability('spec', 0) still reports no-script-acs unchanged", () => {
    expect(verifyReachability("spec", 0)).toEqual({ reachable: false, why: "no-script-acs" });
  });

  // STATE — the live incident shape: a plan-close ctx that never populated
  // `hasSpecParent`/`parentSpecScriptAcCount` at all (exactly what
  // `CorpusService.set`'s real plan-close call site does today, pre-fix) must
  // render NEITHER definite reachability claim in the feeding pack.
  it("STATE: plan-close feed for an unknown-reachability ctx renders neither definite reachability claim", () => {
    const planClose = checkpointRegistry["plan-close"];
    if (planClose === undefined) {
      throw new Error("plan-close checkpoint not registered — test fixture assumption broken");
    }
    const ctx: GateContext = {
      targetIdOrSlug: "plan-example",
      attestationMinRatio: 0.5,
      planTasksAttestation: [{ slug: "task-1", title: "Task One", evidenceCount: 3, attestedCount: 0 }],
      // hasSpecParent / parentSpecScriptAcCount deliberately OMITTED — mirrors
      // the live bug: plan-close's real caller never populates these today.
    };
    const failures = planClose.check(ctx).filter((r) => !r.ok);
    const text = planClose.feed(ctx, failures);
    expect(text).not.toContain("no spec-tier ancestor");
    expect(text).not.toContain("zero script-mode");
  });
});
