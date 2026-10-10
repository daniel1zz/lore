/**
 * Tests for the `task-claim` gate's anchor-overlap predicate (SPEC-042 §Design
 * Decisions D5) — both the PURE `checkpointRegistry["task-claim"]` decision
 * layer (check + feed, `checkpoint-registry.ts`/`gate-predicates.ts`) and the
 * SERVICE-LAYER wiring (`TaskWorkflowService.claim` → `enforceClaimGate` →
 * `GateEnforcer`), against an `InMemoryStore` — vitest, no `bun:sqlite`.
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      distinct-actor overlapping-anchor claim is blocked with the
 *               anchor-overlap discriminator + a conflict-detail feeding pack
 *               (AC-S3-2); an unconditional block on a plan with NO spec
 *               ancestor (AC-S3-3 regression)
 *   NEGATIVE:   n/a beyond the above blocked cases
 *   BOUNDARY:   either side anchor-less → pass; disjoint anchors → pass
 *   ERROR:      n/a — noAnchorOverlap has no ERROR path by design (D4)
 *   STATE:      stale foreign claim → pass; same-actor overlap in a PROVEN same
 *               session → pass, while the same pair with an UNMEASURED session is
 *               refused (task-two-concurrent-orchestrators-both-resolve-to-agent-main
 *               retired the bare same-`by` exemption); overlap in a DIFFERENT plan
 *               → pass; --steal does not bypass an anchor conflict;
 *               release-then-retry succeeds (AC-S3-11)
 *   REGRESSION: upstream-approval failure alone still reports the BASE
 *               `gate:task-claim` field (discriminator separation, AC-S3-3);
 *               a same-holder refresh keep-alive does not fragment the D1
 *               session-grouping key (AC-S3-11, D2 carry-forward feeding D1)
 *
 * @spec_ref SPEC-042 §Design Decisions D5; AC-S3-2, AC-S3-3, AC-S3-11
 */

import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { approveCitedSpec } from "../../helpers/live-rule-fixture.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import {
  checkpointRegistry,
  isCheckpointBlocked,
  selectFailures,
  buildAnchorGateContext,
  type GateContext,
} from "../../../src/service/checkpoint-registry.js";
import { ANCHOR_OVERLAP_FIELD, type SiblingClaimInfo } from "../../../src/service/gate-predicates.js";
import { deriveSessions } from "@lore/core";
import type { CreateDocInput, DocRecord, LoreConfig } from "@lore/core";

// ─── Fixtures ────────────────────────────────────────────────────────────────

async function mustCreate(cs: CorpusService, input: CreateDocInput): Promise<DocRecord> {
  const result = await cs.create(input);
  if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

function makeServices(config?: LoreConfig) {
  const store = new InMemoryStore();
  const corpusService = new CorpusService(store);
  const enforcer = new GateEnforcer(config);
  const taskWorkflowService = new TaskWorkflowService(
    store,
    undefined,
    { claimTtlMinutes: 120 },
    undefined,
    { enforcer, getPlanBundle: corpusService.getPlanBundle.bind(corpusService) },
  );
  return { store, corpusService, taskWorkflowService, enforcer };
}

/** A top-level plan (no parent at all) — hasSpecParent will resolve false. */
async function createTopLevelPlan(cs: CorpusService): Promise<string> {
  const plan = await mustCreate(cs, { type: "plan", title: "Top-Level Plan", content: "# Plan" } as CreateDocInput);
  return plan.id;
}

/** PRD → APPROVED spec → plan, so hasSpecParent resolves true with an approved ancestor. */
async function createApprovedAncestorPlan(cs: CorpusService, store: InMemoryStore): Promise<string> {
  const prd = await mustCreate(cs, { type: "prd", title: "PRD", content: "# PRD" } as CreateDocInput);
  const spec = await mustCreate(cs, {
    type: "spec",
    title: "Spec",
    content: "## Overview\nBody.",
  } as CreateDocInput);
  const approveResult = await approveCitedSpec(store, cs, spec.id);
  if (!approveResult.ok) throw new Error(`spec approve failed: ${JSON.stringify(approveResult.error)}`);
  const plan = await mustCreate(cs, {
    type: "plan",
    title: "Plan",
    parent_id: spec.id,
    content: "# Plan",
  } as CreateDocInput);
  return plan.id;
}

/** PRD → DRAFT (unapproved) spec → plan — upstreamApproved fails, anchors irrelevant. */
async function createUnapprovedAncestorPlan(cs: CorpusService): Promise<string> {
  const prd = await mustCreate(cs, { type: "prd", title: "PRD2", content: "# PRD" } as CreateDocInput);
  const spec = await mustCreate(cs, {
    type: "spec",
    title: "Unapproved Spec",
    content: "## Overview\nBody.",
  } as CreateDocInput);
  const plan = await mustCreate(cs, {
    type: "plan",
    title: "Plan Under Draft Spec",
    parent_id: spec.id,
    content: "# Plan",
  } as CreateDocInput);
  return plan.id;
}

async function createTask(
  cs: CorpusService,
  planId: string,
  title: string,
  anchors?: string[],
): Promise<string> {
  const task = await mustCreate(cs, {
    type: "task",
    title,
    parent_id: planId,
    content: `# ${title}`,
    extra: { plan_id: planId, ...(anchors !== undefined ? { file_anchors: anchors } : {}) },
  } as CreateDocInput);
  return task.id;
}

// ─── Pure checkpoint-registry["task-claim"] unit tests (check + feed) ─────────

describe("checkpointRegistry['task-claim'] — noAnchorOverlap (pure, SPEC-042 D5)", () => {
  const def = checkpointRegistry["task-claim"]!;

  const overlappingSibling: SiblingClaimInfo = {
    slug: "task-one",
    title: "Task One",
    by: "agent:t1",
    at: "2026-07-11T09:00:00.000Z",
    stale: false,
    anchors: ["src/a/"],
  };

  // HAPPY — AC-S3-2 primary distinct-actor scenario
  it("blocks a distinct-actor overlapping claim with field 'anchor-overlap' and a conflict-detail feeding pack", () => {
    const ctx: GateContext = {
      candidateBy: "agent:t2",
      candidateAnchors: ["src/a"],
      siblingClaims: [overlappingSibling],
      hasSpecParent: false,
    };
    const results = def.check(ctx);
    expect(isCheckpointBlocked(results)).toBe(true);
    const failures = selectFailures(results);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.field).toBe(ANCHOR_OVERLAP_FIELD);
    expect(failures[0]?.reason).toBe("ANCHOR_OVERLAP");

    // reason: task-t1-applicability-verdict-in-the-predicate-s-own-type-both —
    // see actor-identity-guard.bun.test.ts's identical fix for why this passes
    // `selectFailures(results)` rather than the raw (now widened) `results`.
    const feedText = def.feed(ctx, selectFailures(results));
    expect(feedText).toContain("task-one");
    expect(feedText).toContain("agent:t1");
    expect(feedText).toContain("src/a"); // overlapping path pair mentions both sides
    expect(feedText).toContain("lore release task-one --by agent:t1 --force");
    // pointers only — never task body/content text
    expect(feedText).not.toContain("# Task One");
    expect(feedText).not.toContain("Body.");
  });

  // BOUNDARY — either side anchor-less → pass
  it("candidate with no anchors → vacuous pass regardless of sibling claims", () => {
    const ctx: GateContext = {
      candidateBy: "agent:t2",
      candidateAnchors: [],
      siblingClaims: [overlappingSibling],
      hasSpecParent: false,
    };
    expect(isCheckpointBlocked(def.check(ctx))).toBe(false);
  });

  it("sibling with no anchors → vacuous pass", () => {
    const ctx: GateContext = {
      candidateBy: "agent:t2",
      candidateAnchors: ["src/a"],
      siblingClaims: [{ ...overlappingSibling, anchors: [] }],
      hasSpecParent: false,
    };
    expect(isCheckpointBlocked(def.check(ctx))).toBe(false);
  });

  // BOUNDARY — disjoint anchors → pass
  it("disjoint anchors (no segment overlap) → pass", () => {
    const ctx: GateContext = {
      candidateBy: "agent:t2",
      candidateAnchors: ["src/b"],
      siblingClaims: [overlappingSibling], // declares src/a/
      hasSpecParent: false,
    };
    expect(isCheckpointBlocked(def.check(ctx))).toBe(false);
  });

  // STATE — stale foreign claim → pass
  it("a STALE sibling claim never blocks, even with overlapping anchors", () => {
    const ctx: GateContext = {
      candidateBy: "agent:t2",
      candidateAnchors: ["src/a"],
      siblingClaims: [{ ...overlappingSibling, stale: true }],
      hasSpecParent: false,
    };
    expect(isCheckpointBlocked(def.check(ctx))).toBe(false);
  });

  // STATE — same-actor overlap in a PROVEN same session → pass.
  // reason: task-two-concurrent-orchestrators-both-resolve-to-agent-main retired
  // the bare same-`by` exemption — `by` is a proxy two concurrently-live sessions
  // legitimately share (this project mandates `LORE_ACTOR=agent:main-orchestrator`
  // for every main-checkout run), so the exemption now requires the CAPTURED
  // session instance on both sides. The original intent of this case ("one actor
  // working two tasks does not block itself") is preserved by supplying that fact;
  // the case immediately below pins what happens when it is absent, so this pair
  // cannot both pass under a blanket-permit OR a blanket-refuse regression.
  it("a sibling claim held by the SAME actor in the SAME measured session never blocks", () => {
    const ctx: GateContext = {
      candidateBy: "agent:t1",
      candidateSessionId: "3de02220",
      candidateAnchors: ["src/a"],
      siblingClaims: [{ ...overlappingSibling, session_id: "3de02220" }], // also by agent:t1
      hasSpecParent: false,
    };
    expect(isCheckpointBlocked(def.check(ctx))).toBe(false);
  });

  // STATE — same actor, session instance UNMEASURED (the legacy claim-record shape)
  // → refused with the explicit not-measured reason, never permitted.
  it("a sibling claim held by the SAME actor with NO recorded session is refused as not-measured", () => {
    const ctx: GateContext = {
      candidateBy: "agent:t1",
      candidateSessionId: "3de02220",
      candidateAnchors: ["src/a"],
      siblingClaims: [overlappingSibling], // same actor, no session_id recorded
      hasSpecParent: false,
    };
    const failures = selectFailures(def.check(ctx));
    expect(isCheckpointBlocked(def.check(ctx))).toBe(true);
    expect(failures[0]?.field).toBe(ANCHOR_OVERLAP_FIELD);
    expect(failures[0]?.reason).toBe("ANCHOR_OVERLAP_SESSION_UNMEASURED");
  });

  // REGRESSION — AC-S3-3: plan with NO spec ancestor + fresh foreign overlap → still blocked
  it("runs UNCONDITIONALLY when hasSpecParent is false — no short-circuit hole", () => {
    const ctx: GateContext = {
      candidateBy: "agent:t2",
      candidateAnchors: ["src/a"],
      siblingClaims: [overlappingSibling],
      hasSpecParent: false, // top-level/prd-parented plan — the common, previously-unprotected case
    };
    expect(isCheckpointBlocked(def.check(ctx))).toBe(true);
  });

  // REGRESSION — discriminator separation: upstream-approval failure ALONE still
  // reports the base "gate:task-claim" field (no anchor-overlap failure present).
  it("upstream-approval failure alone carries NO field (base 'gate:task-claim' applies)", () => {
    const ctx: GateContext = {
      candidateBy: "agent:t2",
      candidateAnchors: [], // no anchors declared — noAnchorOverlap vacuously passes
      siblingClaims: [],
      hasSpecParent: true,
      parentSpec: { type: "spec", status: "draft", extra: {}, deleted_at: null },
    };
    const results = def.check(ctx);
    expect(isCheckpointBlocked(results)).toBe(true);
    const failures = selectFailures(results);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.field).toBeUndefined();
  });

  // BOUNDARY — buildAnchorGateContext excludes the candidate task itself from siblingClaims
  it("buildAnchorGateContext filters the candidate task out of its own sibling set", () => {
    const candidate: DocRecord = {
      id: "01HCANDIDATE00000000000000",
      slug: "task-candidate",
      type: "task",
      role: "plan",
      title: "Candidate",
      status: "draft",
      priority: "medium",
      content: "",
      parent_id: "01HPLAN000000000000000000",
      created_at: "2026-07-11T00:00:00.000Z",
      updated_at: "2026-07-11T00:00:00.000Z",
      created_by: "system",
      version: 1,
      deleted_at: null,
      tags: [],
      extra: { plan_id: "01HPLAN000000000000000000", file_anchors: ["src/a"] },
    };
    const ctx = buildAnchorGateContext("agent:t2", candidate, [candidate], "2026-07-11T10:00:00.000Z", 120);
    expect(ctx.siblingClaims).toEqual([]);
    expect(ctx.candidateAnchors).toEqual(["src/a"]);
  });
});

// ─── Service-level integration: TaskWorkflowService.claim() through GateEnforcer ──

describe("TaskWorkflowService.claim — anchor-overlap gate wired end-to-end (SPEC-042 D5)", () => {
  // HAPPY / AC-S3-2 — distinct-actor overlapping claim end-to-end
  it("blocks a distinct-actor overlapping claim (top-level plan, no spec ancestor)", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createTopLevelPlan(corpusService);
    const taskOneId = await createTask(corpusService, planId, "Task One", ["src/a/"]);
    const taskTwoId = await createTask(corpusService, planId, "Task Two", ["src/a"]);

    const first = await taskWorkflowService.claim(taskOneId, { by: "agent:t1" });
    expect(first.ok).toBe(true);

    const second = await taskWorkflowService.claim(taskTwoId, { by: "agent:t2" });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe("VALIDATION_ERROR");
    expect((second.error as { field?: string }).field).toBe("gate:task-claim:anchor-overlap");
  });

  // STATE — overlap in a DIFFERENT plan → pass (scope is per-plan)
  it("an anchor overlap across DIFFERENT plans never blocks (corpus-wide scope was rejected by design)", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planAId = await createTopLevelPlan(corpusService);
    const planBId = await createTopLevelPlan(corpusService);
    const taskAId = await createTask(corpusService, planAId, "Plan A Task", ["src/a"]);
    const taskBId = await createTask(corpusService, planBId, "Plan B Task", ["src/a"]);

    const first = await taskWorkflowService.claim(taskAId, { by: "agent:t1" });
    expect(first.ok).toBe(true);

    const second = await taskWorkflowService.claim(taskBId, { by: "agent:t2" });
    expect(second.ok).toBe(true);
  });

  // REGRESSION — upstream-approval-only failure keeps the base field discriminator
  it("an unapproved-spec-ancestor failure with NO anchor conflict reports field 'gate:task-claim'", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createUnapprovedAncestorPlan(corpusService);
    const taskId = await createTask(corpusService, planId, "Solo Task"); // no anchors

    const result = await taskWorkflowService.claim(taskId, { by: "agent:t1" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect((result.error as { field?: string }).field).toBe("gate:task-claim");
  });

  // HAPPY — approved ancestor + no conflict → passes
  it("an approved ancestor spec with no anchor conflict succeeds", async () => {
    const { corpusService, taskWorkflowService, store } = makeServices();
    const planId = await createApprovedAncestorPlan(corpusService, store);
    const taskId = await createTask(corpusService, planId, "Solo Task", ["src/a"]);

    const result = await taskWorkflowService.claim(taskId, { by: "agent:t1" });
    expect(result.ok).toBe(true);
  });

  // STATE — D6: disabling ONLY the anchor_overlap sub-predicate lets the overlap through
  it("workflow.gates.'task-claim'.anchor_overlap.enabled=false disables ONLY the anchor predicate", async () => {
    const config = {
      project: { name: "x", author: "y" },
      workflow: {
        claim_ttl_minutes: 120,
        gates: { "task-claim": { anchor_overlap: { enabled: false } } },
      },
    } as unknown as LoreConfig;
    const { corpusService, taskWorkflowService } = makeServices(config);
    const planId = await createTopLevelPlan(corpusService);
    const taskOneId = await createTask(corpusService, planId, "Task One", ["src/a"]);
    const taskTwoId = await createTask(corpusService, planId, "Task Two", ["src/a"]);

    const first = await taskWorkflowService.claim(taskOneId, { by: "agent:t1" });
    expect(first.ok).toBe(true);

    const second = await taskWorkflowService.claim(taskTwoId, { by: "agent:t2" });
    expect(second.ok).toBe(true); // anchor_overlap disabled — overlap no longer blocks
  });

  // STATE — AC-S3-11: --steal does NOT bypass a sibling anchor conflict
  it("--steal on the candidate task does not bypass a sibling anchor conflict", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createTopLevelPlan(corpusService);
    const taskOneId = await createTask(corpusService, planId, "Task One", ["src/a/"]);
    const taskTwoId = await createTask(corpusService, planId, "Task Two", ["src/a"]);

    const first = await taskWorkflowService.claim(taskOneId, { by: "agent:t1" });
    expect(first.ok).toBe(true);

    const steal = await taskWorkflowService.claim(taskTwoId, { by: "agent:t2", steal: true });
    expect(steal.ok).toBe(false);
    if (steal.ok) return;
    expect((steal.error as { field?: string }).field).toBe("gate:task-claim:anchor-overlap");
  });

  // STATE — AC-S3-11: release the conflicting claim → the identical retry succeeds
  it("after releasing the conflicting sibling claim, the identical claim retry succeeds", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createTopLevelPlan(corpusService);
    const taskOneId = await createTask(corpusService, planId, "Task One", ["src/a/"]);
    const taskTwoId = await createTask(corpusService, planId, "Task Two", ["src/a"]);

    await taskWorkflowService.claim(taskOneId, { by: "agent:t1" });
    const blocked = await taskWorkflowService.claim(taskTwoId, { by: "agent:t2" });
    expect(blocked.ok).toBe(false);

    const release = await taskWorkflowService.release(taskOneId, { by: "agent:t1" });
    expect(release.ok).toBe(true);

    const retry = await taskWorkflowService.claim(taskTwoId, { by: "agent:t2" });
    expect(retry.ok).toBe(true);
  });

  // REGRESSION — AC-S3-11 / D2 carry-forward feeding D1: a refresh keep-alive (same
  // holder, no fields re-passed) does not change the session-grouping key — it stays
  // ONE session across the refresh, not fragmented into two.
  it("a same-holder refresh keep-alive does not fragment the derived session's grouping key", async () => {
    const { corpusService, taskWorkflowService, store } = makeServices();
    const planId = await createTopLevelPlan(corpusService);
    const taskId = await createTask(corpusService, planId, "Solo Task");

    const first = await taskWorkflowService.claim(
      taskId,
      { by: "agent:t1", machine: "hostA", worktree: "/w1", branch: "wt-a" },
      () => "2026-07-11T09:00:00.000Z",
    );
    expect(first.ok).toBe(true);

    const refresh = await taskWorkflowService.claim(
      taskId,
      { by: "agent:t1" }, // no fields re-passed
      () => "2026-07-11T09:30:00.000Z",
    );
    expect(refresh.ok).toBe(true);
    if (!refresh.ok) return;
    expect(refresh.value.extra["claim"]).toMatchObject({
      by: "agent:t1",
      machine: "hostA",
      worktree: "/w1",
      branch: "wt-a",
    });

    const taskResult = await store.find(taskId);
    if (!taskResult.ok || taskResult.value === null) throw new Error("task not found");
    const sessions = deriveSessions([taskResult.value], "2026-07-11T10:00:00.000Z", 120);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ by: "agent:t1", machine: "hostA", worktree: "/w1" });
  });
});
