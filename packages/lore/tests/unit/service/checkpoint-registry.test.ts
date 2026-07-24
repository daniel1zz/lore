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
    // noAnchorOverlap STILL runs (SPEC-042 D5 — this checkpoint no longer
    // short-circuits BOTH predicates on hasSpecParent:false, only the
    // upstream one; with no candidateAnchors/siblingClaims supplied here,
    // noAnchorOverlap vacuously passes, so the overall result is still an
    // unblocked pass — just no longer a literal empty array).
    it("check() runs noAnchorOverlap unconditionally even when hasSpecParent is false (SPEC-042 D5)", () => {
      const results = checkpoint.check({ hasSpecParent: false });
      expect(isCheckpointBlocked(results)).toBe(false);
      expect(results).toEqual([{ ok: true }]);
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
