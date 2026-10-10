/**
 * RED suite (TDD-Role: red, paired-impl task-skill-implement-core-profiles-gate-wiring-
 * threading-status) for SPEC-058 AC-V-3 — a NEW `requiresUat` predicate on the
 * `plan-promote` checkpoint (`gate-predicates.ts` + `checkpoint-registry.ts`, neither
 * of which declares it yet): a plan whose ancestor spec resolves to a `spec_kind`
 * whose configured verification profile declares `required_uat: true` must itself
 * declare `extra.requires_uat === true` before it may be promoted (approved).
 *
 * This is DISTINCT from — and composes with — SPEC-054's PRE-EXISTING `plan-close`
 * checkpoint (`uatP0Accepted`, already implemented): SPEC-058 gates that
 * `extra.requires_uat` is SET at promote time; SPEC-054 gates that an ACTUAL
 * P0-accepted UAT verdict exists at close (archive) time, reading the SAME flag. The
 * STATE scenario below exercises the full loop end-to-end, reusing this repo's own
 * `uat-service.test.ts` harness pattern for the plan-close half (already green,
 * unmodified by this suite).
 *
 * Field-discriminator contract this suite PINS for the implementer (mirrors
 * `AC_QUANTIFIABLE_FIELD` / `ANCHOR_OVERLAP_FIELD`'s existing kebab-case convention):
 * a blocked `requiresUat` predicate must carry `PredicateResult.field ===
 * "requires-uat"`, surfacing as `GateEnforcer`'s `gate:plan-promote:requires-uat`.
 *
 * Deterministic, zero-LLM — no AI provider anywhere on this path.
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / STATE / REGRESSION.
 *
 * Source: spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag
 *   §Acceptance Criteria AC-V-3, §Design Decisions D4; SPEC-054's
 *   uat-service.test.ts as structural precedent for the plan-close half.
 */

import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { LIVE_RULE_ID, seedLiveRule } from "../../helpers/live-rule-fixture.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { ReviewService } from "../../../src/service/review-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { UatService } from "../../../src/service/uat-service.js";
import { resolveDoc } from "../../../src/service/resolve.js";
import type { CreateDocInput, DocRecord, LoreConfig, UatVerdict } from "@lore/core";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** An e2e-bound, quantified script AC — satisfies both `upstreamHasAcceptanceCriteria`
 *  and (once wired) any `oracleCoverage` floor a "design" profile might also declare,
 *  so this suite's spec approvals never trip on SPEC-058's OTHER predicate. */
const DESIGN_SPEC_AC = {
  id: "AC-DESIGN-1",
  statement: "the checkout flow completes end-to-end within 30s",
  verify: { mode: "script" as const, oracle: "e2e" as const, command: "bun run e2e:checkout" },
  cites: [LIVE_RULE_ID],
};

const FEATURE_SPEC_AC = {
  id: "AC-FEATURE-1",
  statement: "the parser round-trips every fixture file",
  verify: { mode: "script" as const, oracle: "test" as const, command: "bun test parser.test.ts" },
  cites: [LIVE_RULE_ID],
};

const ACCEPT_VERDICT: UatVerdict = {
  verdict: "accept",
  tier_results: [{ tier: "P0", accepted: 3, rejected: 0, unverified: 0 }],
  requirement_coverage: { total: 3, covered: 3, uncovered_p0: [] },
  uiux: { blocker_count: 0, min_dimension_score: 4 },
  run_meta: { at: "2026-07-19T00:00:00.000Z", by: "agent:uat" },
};

/** design_kind profile requires BOTH an e2e oracle AND requires_uat — the SAME
 *  per-spec_kind profile object SPEC-058's Public Interface sketch shares between
 *  `oracleCoverage` and `requiresUat`. */
function configWithDesignRequiresUat(overrides?: Record<string, unknown>): LoreConfig {
  return {
    project: { name: "t", author: "t" },
    workflow: {
      verification_profiles: { design: { required_oracles: ["e2e"], required_uat: true } },
      ...overrides,
    },
  } as unknown as LoreConfig;
}

async function makeHarness(config?: LoreConfig) {
  const store = new InMemoryStore();
  await seedLiveRule(store);
  const enforcer = new GateEnforcer(config);
  const corpusService = new CorpusService(store, undefined, undefined, enforcer);
  const reviewService = new ReviewService(store, undefined, {
    enforcer,
    getPlanBundle: corpusService.getPlanBundle.bind(corpusService),
  });
  const uatService = new UatService({
    createUatDoc: corpusService.createUatDoc.bind(corpusService),
    resolveTarget: (idOrSlug: string) => resolveDoc(store, idOrSlug),
    addLink: store.addLink.bind(store),
    now: () => "2026-07-19T00:00:00.000Z",
  });
  return { store, corpusService, reviewService, uatService };
}

async function mustCreate(cs: CorpusService, input: CreateDocInput): Promise<DocRecord> {
  const result = await cs.create(input);
  if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

/** Creates a PRD, then a spec of `specKind` parented under it with `criteria`,
 *  then approves the spec (draft -> approved) — the plan-promote ancestor chain
 *  this suite's plans are parented under. Fails loud (throws) if the spec itself
 *  cannot be approved — a setup bug, not something any `it` here should tolerate. */
async function createApprovedSpec(
  cs: CorpusService,
  specKind: "design" | "feature",
  criteria: unknown[],
): Promise<{ prd: DocRecord; spec: DocRecord }> {
  const prd = await mustCreate(cs, { type: "prd", title: "Root PRD", content: "# PRD" } as CreateDocInput);
  const spec = await mustCreate(cs, {
    type: "spec",
    title: `${specKind} spec`,
    content: "## Overview\n\nBody.",
    extra: { spec_kind: specKind, acceptance_criteria: criteria },
  } as CreateDocInput);
  const approved = await cs.set(spec.id, { status: "approved" });
  if (!approved.ok) throw new Error(`spec approve failed (setup): ${JSON.stringify(approved.error)}`);
  return { prd, spec: approved.value };
}

async function createPlan(
  cs: CorpusService,
  parentId: string | undefined,
  extra: Record<string, unknown> = {},
): Promise<DocRecord> {
  const input: CreateDocInput = {
    type: "plan",
    title: "Test plan",
    content: "## Plan\n\nbody",
    ...(parentId !== undefined ? { parent_id: parentId } : {}),
    extra,
  };
  return mustCreate(cs, input);
}

/** Walks an ALREADY-APPROVED plan draft's approved -> active status — mirrors
 *  uat-service.test.ts's own walkToActive (the plan is already `approved` after
 *  `reviewService.approve`, so this only performs the second hop). */
async function walkToActive(cs: CorpusService, plan: DocRecord): Promise<void> {
  const r = await cs.set(plan.id, { status: "active" });
  if (!r.ok) throw new Error(`transition to active failed: ${JSON.stringify(r.error)}`);
}

// ─── AC-V-3: matched pair — blocks without requires_uat, passes with it ──────

describe("requiresUat — plan-promote matched pair (ReviewService.approve)", () => {
  // NEGATIVE
  it("blocks promoting a design-spec plan that does NOT declare extra.requires_uat", async () => {
    const { corpusService, reviewService } = await makeHarness(configWithDesignRequiresUat());
    const { spec } = await createApprovedSpec(corpusService, "design", [DESIGN_SPEC_AC]);
    const plan = await createPlan(corpusService, spec.id);

    const result = await reviewService.approve(plan.id);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
      expect((result.error as { field?: string }).field).toBe("gate:plan-promote:requires-uat");
      const message = (result.error as { message?: string }).message ?? "";
      expect(message).toContain("requires_uat");
      expect(message).toContain("lore set");
    }
  });

  // HAPPY (positive twin — same ancestor spec, plan DOES declare requires_uat)
  it("promotes the same design-spec plan once extra.requires_uat: true is declared", async () => {
    const { corpusService, reviewService } = await makeHarness(configWithDesignRequiresUat());
    const { spec } = await createApprovedSpec(corpusService, "design", [DESIGN_SPEC_AC]);
    const plan = await createPlan(corpusService, spec.id, { requires_uat: true });

    const result = await reviewService.approve(plan.id);
    expect(result.ok).toBe(true);
  });

  // BOUNDARY — requires_uat: false (explicit, not merely absent) is treated identically to absent
  it("treats extra.requires_uat: false the same as absent — still blocked", async () => {
    const { corpusService, reviewService } = await makeHarness(configWithDesignRequiresUat());
    const { spec } = await createApprovedSpec(corpusService, "design", [DESIGN_SPEC_AC]);
    const plan = await createPlan(corpusService, spec.id, { requires_uat: false });

    const result = await reviewService.approve(plan.id);
    expect(result.ok).toBe(false);
  });
});

// ─── AC-V-3: feature-spec plans are unaffected ───────────────────────────────

describe("requiresUat — NEGATIVE: unaffected scopes", () => {
  it("a feature-spec plan (no declared feature profile) promotes ok with no requires_uat declared", async () => {
    const { corpusService, reviewService } = await makeHarness(configWithDesignRequiresUat());
    const { spec } = await createApprovedSpec(corpusService, "feature", [FEATURE_SPEC_AC]);
    const plan = await createPlan(corpusService, spec.id);

    const result = await reviewService.approve(plan.id);
    expect(result.ok).toBe(true);
  });

  // BOUNDARY — a plan with NO spec-tier ancestor at all is untouched by this predicate,
  // exactly as the pre-existing upstreamApproved/upstreamHasAcceptanceCriteria pair is
  // (checkPlanPromote's `hasSpecParent === false` short-circuit, unchanged by SPEC-058).
  it("a plan with no spec ancestor at all (prd-parented) promotes ok with no requires_uat declared", async () => {
    const { corpusService, reviewService } = await makeHarness(configWithDesignRequiresUat());
    const prd = await mustCreate(corpusService, { type: "prd", title: "Root PRD", content: "# PRD" } as CreateDocInput);
    const plan = await createPlan(corpusService, prd.id);

    const result = await reviewService.approve(plan.id);
    expect(result.ok).toBe(true);
  });
});

// ─── AC-V-3: config escape ────────────────────────────────────────────────────

describe("requiresUat — config escape", () => {
  it("workflow.gates.'plan-promote'.requires_uat.enabled=false lets a plan without requires_uat promote", async () => {
    const config = configWithDesignRequiresUat({
      gates: { "plan-promote": { requires_uat: { enabled: false } } },
    });
    const { corpusService, reviewService } = await makeHarness(config);
    const { spec } = await createApprovedSpec(corpusService, "design", [DESIGN_SPEC_AC]);
    const plan = await createPlan(corpusService, spec.id);

    const result = await reviewService.approve(plan.id);
    expect(result.ok).toBe(true);
  });
});

// ─── AC-V-3: REGRESSION — pre-existing plan-promote predicates still fire ────

describe("requiresUat — REGRESSION: pre-existing plan-promote predicates unaffected", () => {
  it("a plan under an UNAPPROVED design spec is still blocked by upstreamApproved, regardless of requires_uat", async () => {
    const { corpusService, reviewService } = await makeHarness(configWithDesignRequiresUat());
    const prd = await mustCreate(corpusService, { type: "prd", title: "Root PRD", content: "# PRD" } as CreateDocInput);
    // Spec stays in DRAFT (never approved) — the pre-existing upstreamApproved predicate's job.
    const spec = await mustCreate(corpusService, {
      type: "spec",
      title: "unapproved design spec",
      content: "## Overview\n\nBody.",
      extra: { spec_kind: "design", acceptance_criteria: [DESIGN_SPEC_AC] },
    } as CreateDocInput);
    const plan = await createPlan(corpusService, spec.id, { requires_uat: true });

    const result = await reviewService.approve(plan.id);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // still the PRE-EXISTING base "gate:plan-promote" field (no requires-uat suffix) —
      // upstreamApproved fails before requires_uat is even relevant.
      expect((result.error as { field?: string }).field).toBe("gate:plan-promote");
    }
  });
});

// ─── AC-V-3: STATE — the D4 loop, promote-time flag through close-time verdict ──

describe("requiresUat — STATE: promote-time flag composes with SPEC-054's plan-close gate end-to-end", () => {
  it("a design-spec plan promotes (requires_uat declared), walks to active, then archives only after a P0-accepted UAT verdict is recorded", async () => {
    const { corpusService, reviewService, uatService } = await makeHarness(configWithDesignRequiresUat());
    const { spec } = await createApprovedSpec(corpusService, "design", [DESIGN_SPEC_AC]);
    const plan = await createPlan(corpusService, spec.id, { requires_uat: true });

    // 1. plan-promote (SPEC-058, new): satisfied because requires_uat is declared.
    const approved = await reviewService.approve(plan.id);
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;

    await walkToActive(corpusService, approved.value);

    // 2. plan-close (SPEC-054, pre-existing): archiving BEFORE any verdict is recorded
    // must still be blocked — the SAME `extra.requires_uat` flag now gates BOTH
    // checkpoints, and satisfying the promote-time one does not satisfy the close-time
    // one for free.
    const archivedTooEarly = await corpusService.set(plan.id, { status: "archived" });
    expect(archivedTooEarly.ok).toBe(false);
    if (!archivedTooEarly.ok) {
      expect((archivedTooEarly.error as { field?: string }).field).toBe("gate:plan-close:uat");
    }

    // 3. Record a P0-accepted verdict, THEN archive succeeds.
    const recorded = await uatService.record(plan.id, ACCEPT_VERDICT, { by: "agent:uat" });
    expect(recorded.ok).toBe(true);

    const archived = await corpusService.set(plan.id, { status: "archived" });
    expect(archived.ok).toBe(true);
    if (archived.ok) {
      expect(archived.value.status).toBe("archived");
    }
  });
});
