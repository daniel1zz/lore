/**
 * Tests for the `task-claim` gate's claim-time actor-identity-collision guard
 * (spec claim-time-actor-identity-guard-zero-evidence-release-advis, AC-
 * IDENTITY-REJECT / AC-IDENTITY-ESCAPE) — both the PURE `actorIdentityGuard`
 * predicate (`gate-predicates.ts`) / `checkpointRegistry["task-claim"]`
 * decision layer (`checkpoint-registry.ts`) and the SERVICE-LAYER wiring
 * (`TaskWorkflowService.claim` → `enforceClaimGate` → `GateEnforcer`), against
 * an `InMemoryStore`.
 *
 * Runner: `bun test` (declared oracle file per the governing spec's AC verify
 * command) — no `bun:sqlite` dependency here (`InMemoryStore` only), but the
 * AC pins this exact file/runner, mirroring
 * `tests/unit/service/issue-report-cross-corpus.bun.test.ts`'s precedent of a
 * `bun.test.ts` file that uses `InMemoryStore` rather than a real SQLite DB.
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      an `os_default`-resolved candidate colliding with a fresh
 *               same-`by`/`os_default`/different-worktree sibling claim in the
 *               same plan is rejected with field `actor-identity` (pure) /
 *               `gate:task-claim:actor-identity` (service-layer), AC-IDENTITY-REJECT
 *   NEGATIVE:   distinct EXPLICIT identities (two different `--by`/`$LORE_ACTOR`
 *               agents) never trip it — mandatory collision-negative case;
 *               `identitySource` "env"/"session" also never trip it
 *   BOUNDARY:   solo agent/human holding multiple tasks from ONE worktree
 *               (same `by`, same `os_default` source, same worktree) never
 *               trips it; missing worktree/machine data on either side →
 *               conservative vacuous pass (no provable difference)
 *   ERROR:      n/a — actorIdentityGuard has no ERROR path by design (mirrors
 *               noAnchorOverlap's "no ERROR path")
 *   STATE:      a STALE sibling claim never blocks even with a matching `by`
 *               and a different worktree; a DIFFERENT `by` on the sibling
 *               never blocks; the `machine` dimension alone (worktree absent
 *               on both sides) can also trip the collision signature
 *   REGRESSION: workflow.gates."task-claim".actor_identity.enabled=false
 *               disables ONLY this predicate — anchor-overlap and upstream-
 *               approval outcomes stay byte-identical (AC-IDENTITY-ESCAPE,
 *               mandatory escape-hatch case); when BOTH anchor-overlap AND
 *               actor-identity fail, the anchor-overlap field wins (pre-
 *               existing `GateEnforcer.enforce` first-field-wins priority,
 *               unchanged by this predicate's addition)
 *
 * @spec_ref spec-claim-time-actor-identity-guard-zero-evidence-release-advis
 *   AC-IDENTITY-REJECT, AC-IDENTITY-ESCAPE
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { describe, it, expect } from "bun:test";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import {
  checkpointRegistry,
  isCheckpointBlocked,
  selectFailures,
  type GateContext,
} from "../../../src/service/checkpoint-registry.js";
import {
  actorIdentityGuard,
  ACTOR_IDENTITY_FIELD,
  ANCHOR_OVERLAP_FIELD,
  OS_DEFAULT_IDENTITY_SOURCE,
  type SiblingClaimInfo,
} from "../../../src/service/gate-predicates.js";
import type { CreateDocInput, DocRecord, LoreConfig } from "@lore/core";

// ─── Fixtures ────────────────────────────────────────────────────────────────

async function mustCreate(cs: CorpusService, input: CreateDocInput): Promise<DocRecord> {
  const result = await cs.create(input);
  if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

function makeServices(config?: LoreConfig) {
  const store = new InMemoryStore();
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
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

// ─── Pure actorIdentityGuard unit tests (gate-predicates.ts) ──────────────────

describe("actorIdentityGuard (pure)", () => {
  const osDefaultSibling: SiblingClaimInfo = {
    slug: "task-one",
    title: "Task One",
    by: "daniel",
    at: "2026-07-27T09:00:00.000Z",
    stale: false,
    anchors: [],
    worktree: "/repo/.worktrees/t1",
  };

  // HAPPY — AC-IDENTITY-REJECT primary collision scenario
  it("blocks an os_default candidate colliding with a fresh same-by sibling from a DIFFERENT worktree", () => {
    const result = actorIdentityGuard(
      "daniel",
      OS_DEFAULT_IDENTITY_SOURCE,
      "/repo/.worktrees/t2",
      undefined,
      [osDefaultSibling],
    );
    expect(result).toEqual({ ok: false, reason: "ACTOR_IDENTITY_COLLISION", field: ACTOR_IDENTITY_FIELD });
  });

  // STATE — the `machine` dimension alone can also trip it (worktree absent on both sides)
  it("blocks on a DIFFERENT machine when worktree is absent on both sides", () => {
    const sibling: SiblingClaimInfo = {
      slug: osDefaultSibling.slug,
      title: osDefaultSibling.title,
      by: osDefaultSibling.by,
      at: osDefaultSibling.at,
      stale: osDefaultSibling.stale,
      anchors: osDefaultSibling.anchors,
      machine: "host-a",
    };
    const result = actorIdentityGuard("daniel", OS_DEFAULT_IDENTITY_SOURCE, undefined, "host-b", [sibling]);
    expect(result).toEqual({ ok: false, reason: "ACTOR_IDENTITY_COLLISION", field: ACTOR_IDENTITY_FIELD });
  });

  // NEGATIVE — mandatory collision-negative case: distinct EXPLICIT identities never trip it
  it("never trips when the candidate's identity source is 'explicit', even with an identical by + different worktree", () => {
    const result = actorIdentityGuard("daniel", "explicit", "/repo/.worktrees/t2", undefined, [osDefaultSibling]);
    expect(result).toEqual({ ok: true });
  });

  it("never trips when the candidate's identity source is 'env' ($LORE_ACTOR)", () => {
    const result = actorIdentityGuard("daniel", "env", "/repo/.worktrees/t2", undefined, [osDefaultSibling]);
    expect(result).toEqual({ ok: true });
  });

  it("never trips when the candidate's identity source is the SPEC-071 'session' tier", () => {
    const result = actorIdentityGuard(
      "agent:session-3de02220",
      "session",
      "/repo/.worktrees/t2",
      undefined,
      [{ ...osDefaultSibling, by: "agent:session-3de02220" }],
    );
    expect(result).toEqual({ ok: true });
  });

  it("never trips when identitySource is undefined (caller never resolved/threaded one)", () => {
    const result = actorIdentityGuard("daniel", undefined, "/repo/.worktrees/t2", undefined, [osDefaultSibling]);
    expect(result).toEqual({ ok: true });
  });

  // BOUNDARY — solo human/agent holding multiple tasks from ONE worktree never trips it
  it("same by + same worktree (solo session holding multiple tasks) never trips it", () => {
    const result = actorIdentityGuard(
      "daniel",
      OS_DEFAULT_IDENTITY_SOURCE,
      "/repo/.worktrees/t1",
      undefined,
      [osDefaultSibling], // also worktree /repo/.worktrees/t1
    );
    expect(result).toEqual({ ok: true });
  });

  // BOUNDARY — conservative: no comparable data on either dimension → vacuous pass
  it("no worktree/machine data on either side → conservative vacuous pass (no provable difference)", () => {
    const sibling: SiblingClaimInfo = {
      slug: osDefaultSibling.slug,
      title: osDefaultSibling.title,
      by: osDefaultSibling.by,
      at: osDefaultSibling.at,
      stale: osDefaultSibling.stale,
      anchors: osDefaultSibling.anchors,
    };
    const result = actorIdentityGuard("daniel", OS_DEFAULT_IDENTITY_SOURCE, undefined, undefined, [sibling]);
    expect(result).toEqual({ ok: true });
  });

  // STATE — a STALE sibling never blocks, even with a matching by + different worktree
  it("a STALE sibling claim never blocks, even with a matching by and different worktree", () => {
    const result = actorIdentityGuard(
      "daniel",
      OS_DEFAULT_IDENTITY_SOURCE,
      "/repo/.worktrees/t2",
      undefined,
      [{ ...osDefaultSibling, stale: true }],
    );
    expect(result).toEqual({ ok: true });
  });

  // STATE — a sibling with a DIFFERENT by never blocks
  it("a sibling held by a DIFFERENT by never blocks", () => {
    const result = actorIdentityGuard(
      "daniel",
      OS_DEFAULT_IDENTITY_SOURCE,
      "/repo/.worktrees/t2",
      undefined,
      [{ ...osDefaultSibling, by: "someone-else" }],
    );
    expect(result).toEqual({ ok: true });
  });

  it("no siblings at all → pass", () => {
    const result = actorIdentityGuard("daniel", OS_DEFAULT_IDENTITY_SOURCE, "/repo/.worktrees/t2", undefined, []);
    expect(result).toEqual({ ok: true });
  });
});

// ─── Pure checkpointRegistry["task-claim"] wiring tests ───────────────────────

describe("checkpointRegistry['task-claim'] — actorIdentityGuard wiring (pure)", () => {
  const def = checkpointRegistry["task-claim"]!;

  const osDefaultSibling: SiblingClaimInfo = {
    slug: "task-one",
    title: "Task One",
    by: "daniel",
    at: "2026-07-27T09:00:00.000Z",
    stale: false,
    anchors: [],
    worktree: "/repo/.worktrees/t1",
  };

  it("check() reports an actor-identity failure with field 'actor-identity' when isolated (no anchor overlap)", () => {
    const ctx: GateContext = {
      candidateBy: "daniel",
      candidateAnchors: [],
      candidateIdentitySource: OS_DEFAULT_IDENTITY_SOURCE,
      candidateWorktree: "/repo/.worktrees/t2",
      siblingClaims: [osDefaultSibling],
      hasSpecParent: false,
    };
    const results = def.check(ctx);
    expect(isCheckpointBlocked(results)).toBe(true);
    const failures = selectFailures(results);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.field).toBe(ACTOR_IDENTITY_FIELD);

    // reason: task-t1-applicability-verdict-in-the-predicate-s-own-type-both —
    // `check()`'s static return type widened to `ApplicablePredicateResult[]`
    // (shared across every checkpoint); `task-claim` itself never produces a
    // not-applicable member, so `selectFailures` (already imported/used above)
    // narrows this back to `feed`'s expected `PredicateResult[]` shape —
    // semantically identical to passing the raw array, since `feed` already
    // re-filters on `!f.ok` internally.
    const feedText = def.feed(ctx, selectFailures(results));
    expect(feedText).toContain("task-one");
    expect(feedText).toContain("daniel");
    expect(feedText).toContain("lore setup");
  });

  // REGRESSION — when BOTH anchor-overlap AND actor-identity fail (on TWO DIFFERENT
  // siblings — the two predicates are mutually exclusive on the SAME sibling by
  // construction: noAnchorOverlap skips a same-`by` sibling, actorIdentityGuard
  // requires one), anchor-overlap's field wins (checkTaskClaim pushes anchor-overlap
  // first; GateEnforcer.enforce's pre-existing "first failure carrying a field wins"
  // priority is unchanged).
  it("when both anchor-overlap and actor-identity fail (on different siblings), the anchor-overlap field wins", () => {
    const anchorOverlapSibling: SiblingClaimInfo = {
      slug: "task-anchor",
      title: "Task Anchor",
      by: "agent:other",
      at: "2026-07-27T09:00:00.000Z",
      stale: false,
      anchors: ["src/a"],
    };
    const identityCollisionSibling: SiblingClaimInfo = { ...osDefaultSibling };
    const ctx: GateContext = {
      candidateBy: "daniel",
      candidateAnchors: ["src/a"],
      candidateIdentitySource: OS_DEFAULT_IDENTITY_SOURCE,
      candidateWorktree: "/repo/.worktrees/t2",
      siblingClaims: [anchorOverlapSibling, identityCollisionSibling],
      hasSpecParent: false,
    };
    const results = def.check(ctx);
    expect(isCheckpointBlocked(results)).toBe(true);
    const failures = selectFailures(results);
    expect(failures.length).toBeGreaterThanOrEqual(2);
    expect(failures.find((f) => f.field !== undefined)?.field).toBe(ANCHOR_OVERLAP_FIELD);
  });

  // AC-IDENTITY-ESCAPE (pure layer) — actorIdentityEnabled: false skips the predicate entirely
  it("actorIdentityEnabled: false skips the predicate, leaving anchor-overlap untouched", () => {
    const ctx: GateContext = {
      candidateBy: "daniel",
      candidateAnchors: [], // isolate: no anchor conflict
      candidateIdentitySource: OS_DEFAULT_IDENTITY_SOURCE,
      candidateWorktree: "/repo/.worktrees/t2",
      siblingClaims: [osDefaultSibling],
      hasSpecParent: false,
      actorIdentityEnabled: false,
    };
    expect(isCheckpointBlocked(def.check(ctx))).toBe(false);
  });
});

// ─── Service-level integration: TaskWorkflowService.claim() through GateEnforcer ──

describe("TaskWorkflowService.claim — actor-identity gate wired end-to-end (AC-IDENTITY-REJECT)", () => {
  // HAPPY — AC-IDENTITY-REJECT primary scenario, service layer
  it("rejects an os_default collision with field 'gate:task-claim:actor-identity'", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createTopLevelPlan(corpusService);
    const taskOneId = await createTask(corpusService, planId, "Task One"); // no anchors — isolates actor-identity
    const taskTwoId = await createTask(corpusService, planId, "Task Two");

    const first = await taskWorkflowService.claim(taskOneId, {
      by: "daniel",
      identitySource: "os-fallback",
      worktree: "/repo/.worktrees/t1",
    });
    expect(first.ok).toBe(true);

    const second = await taskWorkflowService.claim(taskTwoId, {
      by: "daniel",
      identitySource: "os-fallback",
      worktree: "/repo/.worktrees/t2",
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe("VALIDATION_ERROR");
    expect((second.error as { field?: string }).field).toBe("gate:task-claim:actor-identity");
  });

  // NEGATIVE — mandatory collision-negative case: two DIFFERENT explicit actors never trip it
  it("two DIFFERENT explicit actors (--by / $LORE_ACTOR) from different worktrees never trip it", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createTopLevelPlan(corpusService);
    const taskOneId = await createTask(corpusService, planId, "Task One");
    const taskTwoId = await createTask(corpusService, planId, "Task Two");

    const first = await taskWorkflowService.claim(taskOneId, {
      by: "agent:t1",
      identitySource: "explicit",
      worktree: "/repo/.worktrees/t1",
    });
    expect(first.ok).toBe(true);

    const second = await taskWorkflowService.claim(taskTwoId, {
      by: "agent:t2",
      identitySource: "explicit",
      worktree: "/repo/.worktrees/t2",
    });
    expect(second.ok).toBe(true);
  });

  // NEGATIVE — the SAME explicit by from a different worktree also never trips it
  // (identitySource is "explicit", not os_default — the guard is source-gated, not by-gated)
  it("the SAME explicit by from a different worktree never trips it either", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createTopLevelPlan(corpusService);
    const taskOneId = await createTask(corpusService, planId, "Task One");
    const taskTwoId = await createTask(corpusService, planId, "Task Two");

    const first = await taskWorkflowService.claim(taskOneId, {
      by: "agent:shared",
      identitySource: "explicit",
      worktree: "/repo/.worktrees/t1",
    });
    expect(first.ok).toBe(true);

    const second = await taskWorkflowService.claim(taskTwoId, {
      by: "agent:shared",
      identitySource: "explicit",
      worktree: "/repo/.worktrees/t2",
    });
    expect(second.ok).toBe(true);
  });

  // BOUNDARY — solo session holding multiple tasks in ONE worktree never trips it
  it("solo os_default session holding multiple tasks in ONE worktree never trips it", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createTopLevelPlan(corpusService);
    const taskOneId = await createTask(corpusService, planId, "Task One");
    const taskTwoId = await createTask(corpusService, planId, "Task Two");

    const first = await taskWorkflowService.claim(taskOneId, {
      by: "daniel",
      identitySource: "os-fallback",
      worktree: "/repo/.worktrees/solo",
    });
    expect(first.ok).toBe(true);

    const second = await taskWorkflowService.claim(taskTwoId, {
      by: "daniel",
      identitySource: "os-fallback",
      worktree: "/repo/.worktrees/solo",
    });
    expect(second.ok).toBe(true);
  });

  // STATE — a STALE holder's os_default claim never blocks a colliding fresh claim
  it("a STALE os_default sibling claim never blocks, even with a matching by and different worktree", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createTopLevelPlan(corpusService);
    const taskOneId = await createTask(corpusService, planId, "Task One");
    const taskTwoId = await createTask(corpusService, planId, "Task Two");

    // claim_ttl_minutes is 120 in makeServices() — 200 minutes later is stale.
    const first = await taskWorkflowService.claim(
      taskOneId,
      { by: "daniel", identitySource: "os-fallback", worktree: "/repo/.worktrees/t1" },
      () => "2026-07-27T09:00:00.000Z",
    );
    expect(first.ok).toBe(true);

    const second = await taskWorkflowService.claim(
      taskTwoId,
      { by: "daniel", identitySource: "os-fallback", worktree: "/repo/.worktrees/t2" },
      () => "2026-07-27T12:30:00.000Z", // 210 minutes later — task one's claim is stale
    );
    expect(second.ok).toBe(true);
  });

  // REGRESSION — mandatory escape-hatch case: config disables ONLY actor-identity,
  // anchor-overlap and upstream-approval stay byte-identical (AC-IDENTITY-ESCAPE)
  it("workflow.gates.'task-claim'.actor_identity.enabled=false disables ONLY the actor-identity predicate", async () => {
    const config = {
      project: { name: "x", author: "y" },
      workflow: {
        claim_ttl_minutes: 120,
        gates: { "task-claim": { actor_identity: { enabled: false } } },
      },
    } as unknown as LoreConfig;
    const { corpusService, taskWorkflowService } = makeServices(config);
    const planId = await createTopLevelPlan(corpusService);
    const taskOneId = await createTask(corpusService, planId, "Task One");
    const taskTwoId = await createTask(corpusService, planId, "Task Two");

    const first = await taskWorkflowService.claim(taskOneId, {
      by: "daniel",
      identitySource: "os-fallback",
      worktree: "/repo/.worktrees/t1",
    });
    expect(first.ok).toBe(true);

    // Same collision signature as the HAPPY case above — but the predicate is
    // disabled, so this now SUCCEEDS instead of being rejected.
    const second = await taskWorkflowService.claim(taskTwoId, {
      by: "daniel",
      identitySource: "os-fallback",
      worktree: "/repo/.worktrees/t2",
    });
    expect(second.ok).toBe(true);
  });

  // REGRESSION — with actor_identity disabled, anchor-overlap STILL blocks a
  // genuinely overlapping-anchor claim (untouched by the escape hatch).
  it("with actor_identity disabled, anchor-overlap gating is UNAFFECTED (still blocks)", async () => {
    const config = {
      project: { name: "x", author: "y" },
      workflow: {
        claim_ttl_minutes: 120,
        gates: { "task-claim": { actor_identity: { enabled: false } } },
      },
    } as unknown as LoreConfig;
    const { corpusService, taskWorkflowService } = makeServices(config);
    const planId = await createTopLevelPlan(corpusService);
    const taskOneId = await createTask(corpusService, planId, "Task One", ["src/a/"]);
    const taskTwoId = await createTask(corpusService, planId, "Task Two", ["src/a"]);

    const first = await taskWorkflowService.claim(taskOneId, { by: "agent:t1", identitySource: "explicit" });
    expect(first.ok).toBe(true);

    const second = await taskWorkflowService.claim(taskTwoId, { by: "agent:t2", identitySource: "explicit" });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect((second.error as { field?: string }).field).toBe("gate:task-claim:anchor-overlap");
  });

  // REGRESSION — a caller that never threads identitySource at all (legacy ClaimOpts
  // shape, e.g. a hand-built test fixture, or PhaseWorkflowService) never trips it —
  // undefined behaves identically to any non-os-fallback source.
  it("a claim() call that never passes identitySource at all never trips the predicate", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createTopLevelPlan(corpusService);
    const taskOneId = await createTask(corpusService, planId, "Task One");
    const taskTwoId = await createTask(corpusService, planId, "Task Two");

    const first = await taskWorkflowService.claim(taskOneId, { by: "daniel", worktree: "/repo/.worktrees/t1" });
    expect(first.ok).toBe(true);

    const second = await taskWorkflowService.claim(taskTwoId, { by: "daniel", worktree: "/repo/.worktrees/t2" });
    expect(second.ok).toBe(true);
  });
});
