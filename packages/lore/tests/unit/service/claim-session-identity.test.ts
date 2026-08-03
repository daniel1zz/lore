/**
 * Tests for the CLAIM-TIME SESSION IDENTITY fact — task-two-concurrent-orchestrators-
 * both-resolve-to-agent-main. Two concurrently-live sessions in ONE checkout that both
 * resolve to the same actor string (`agent:main-orchestrator`, exactly what this repo's
 * own standing discipline instructs operators to export) used to collapse into ONE
 * derived session, so `noAnchorOverlap` saw same-actor and PERMITTED the overlap it
 * exists to refuse.
 *
 * The fix separates the two facts: actor identity ("who") stays `claim.by`; session
 * instance ("which run") becomes `claim.session_id`, captured at claim time beside
 * `machine`/`worktree` and never merged into actor resolution.
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      two claims, identical `by`/`machine`, DIFFERENT session ids derive TWO
 *               sessions — with the CONTROL (identical session id → ONE session) in the
 *               SAME test, so a matcher that silently matches nothing cannot pass;
 *               the gate REFUSES a same-`by` different-session anchor overlap, with the
 *               same-session CONTROL proving it is not a blanket refuse
 *   NEGATIVE:   an ABSENT session id on either side (candidate, sibling, or both — the
 *               legacy claim record shape) is NOT-MEASURED: the gate refuses and SAYS
 *               SO via its own distinct reason, never a permit
 *   BOUNDARY:   candidate declares no anchors → vacuous pass even across sessions;
 *               disjoint anchors → pass; a STALE differing-session sibling → pass;
 *               an unset / whitespace-only session id env var is "no session", not an error
 *   ERROR:      a session id that sanitizes to the empty string fails LOUD
 *               (VALIDATION_ERROR) rather than silently degrading to "not measured"
 *   STATE:      end-to-end through TaskWorkflowService — two service instances over ONE
 *               store, each with its own session env (the real two-orchestrator
 *               topology): the second claim is REFUSED; the control (same env) is
 *               permitted; the persisted claim record carries `session_id`; a
 *               same-holder refresh never CARRIES FORWARD a session id
 *   REGRESSION: a legacy claim record with no `session_id` still parses and still
 *               groups; a FOREIGN-actor overlap still fails with the original
 *               `ANCHOR_OVERLAP` reason; the anchor-overlap feeding pack still names the
 *               conflicting sibling for the new same-actor/different-session case
 *               (it used to skip every same-`by` sibling and print
 *               "no specific conflicting sibling could be identified")
 *
 * @spec_ref SPEC-042 §Design Decisions D1, D5 (sessions are DERIVED, never stored;
 *   the anchor mutex is CROSS-SESSION mutual exclusion);
 *   task-two-concurrent-orchestrators-both-resolve-to-agent-main §Required fix 1-4,
 *   §Proxy / Silence / Opt-in;
 *   adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the (Q1/Q2/Q3).
 */

import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import {
  TaskWorkflowService,
  resolveClaimSessionId,
} from "../../../src/service/task-workflow-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import {
  checkpointRegistry,
  isCheckpointBlocked,
  selectFailures,
  type GateContext,
} from "../../../src/service/checkpoint-registry.js";
import {
  ANCHOR_OVERLAP_FIELD,
  ANCHOR_OVERLAP_REASON,
  ANCHOR_OVERLAP_SESSION_UNMEASURED_REASON,
  compareClaimSessions,
  findAnchorOverlapConflict,
  noAnchorOverlap,
  type SiblingClaimInfo,
} from "../../../src/service/gate-predicates.js";
import { deriveSessions, taskClaimSchema } from "@lore/core";
import type { CreateDocInput, DocRecord } from "@lore/core";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ORCHESTRATOR = "agent:main-orchestrator";
const SESSION_A = "3de02220";
const SESSION_B = "7ab19c04";
const NOW = "2026-08-03T10:00:00.000Z";

/**
 * A task doc carrying a raw `extra.claim` — deliberately built as a plain object
 * (never through `claim()`) so the session-id field can be varied independently of
 * the capture path, including the LEGACY shape that omits it entirely.
 */
function taskWithClaim(
  slug: string,
  claim: Record<string, unknown>,
  anchors: string[] = [],
): DocRecord {
  return {
    id: slug,
    slug,
    type: "task",
    title: slug,
    content: "",
    status: "draft",
    priority: "medium",
    version: 1,
    created_at: NOW,
    updated_at: NOW,
    created_by: "test",
    deleted_at: null,
    parent_id: null,
    extra: { plan_id: "plan-x", claim, ...(anchors.length > 0 ? { file_anchors: anchors } : {}) },
  } as unknown as DocRecord;
}

function sibling(overrides: Partial<SiblingClaimInfo> = {}): SiblingClaimInfo {
  return {
    slug: "task-sibling",
    title: "Sibling",
    by: ORCHESTRATOR,
    at: NOW,
    stale: false,
    anchors: ["packages/core/src/session.ts"],
    ...overrides,
  };
}

async function mustCreate(cs: CorpusService, input: CreateDocInput): Promise<DocRecord> {
  const result = await cs.create(input);
  if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

/**
 * One store, N services — each service instance stands in for one live session,
 * carrying its OWN `processEnv` exactly the way `app.ts` hands the real
 * `process.env` to the single production instance.
 */
function makeStoreAndCorpus() {
  const store = new InMemoryStore();
  const corpusService = new CorpusService(store);
  return { store, corpusService };
}

function makeSessionService(
  store: InMemoryStore,
  corpusService: CorpusService,
  env: Record<string, string | undefined>,
): TaskWorkflowService {
  const enforcer = new GateEnforcer(undefined);
  return new TaskWorkflowService(
    store,
    undefined,
    { claimTtlMinutes: 120 },
    undefined,
    { enforcer, getPlanBundle: corpusService.getPlanBundle.bind(corpusService) },
    undefined,
    env,
  );
}

async function createPlanAndTasks(
  corpusService: CorpusService,
  anchorsPerTask: string[][],
): Promise<{ planId: string; taskIds: string[] }> {
  const plan = await mustCreate(corpusService, {
    type: "plan",
    title: "Session Split Plan",
    content: "# Plan",
  } as CreateDocInput);
  const taskIds: string[] = [];
  for (const [index, anchors] of anchorsPerTask.entries()) {
    const task = await mustCreate(corpusService, {
      type: "task",
      title: `Session Split Task ${index + 1}`,
      parent_id: plan.id,
      content: "# Task",
      extra: { plan_id: plan.id, file_anchors: anchors },
    } as CreateDocInput);
    taskIds.push(task.id);
  }
  return { planId: plan.id, taskIds };
}

// ─── deriveSessions: the grouping key carries the session fact (required fix 2) ──

describe("deriveSessions — session instance is part of the grouping key (SPEC-042 D1)", () => {
  // HAPPY + its own CONTROL in ONE test (task §Oracle: "Both assertions in one test,
  // so a matcher that silently matches nothing cannot pass").
  it("HAPPY: same `by`, same `machine`, absent `worktree`, DIFFERENT session ids → TWO sessions; identical session ids → ONE", () => {
    const differing = deriveSessions(
      [
        taskWithClaim("task-a", { by: ORCHESTRATOR, at: NOW, machine: "mbp", session_id: SESSION_A }),
        taskWithClaim("task-b", { by: ORCHESTRATOR, at: NOW, machine: "mbp", session_id: SESSION_B }),
      ],
      NOW,
      120,
    );
    expect(differing).toHaveLength(2);
    expect(differing.map((s) => s.session_id).sort()).toEqual([SESSION_A, SESSION_B].sort());
    expect(new Set(differing.map((s) => s.by))).toEqual(new Set([ORCHESTRATOR]));

    const identical = deriveSessions(
      [
        taskWithClaim("task-a", { by: ORCHESTRATOR, at: NOW, machine: "mbp", session_id: SESSION_A }),
        taskWithClaim("task-b", { by: ORCHESTRATOR, at: NOW, machine: "mbp", session_id: SESSION_A }),
      ],
      NOW,
      120,
    );
    expect(identical).toHaveLength(1);
    expect(identical[0]?.session_id).toBe(SESSION_A);
    expect(identical[0]?.task_slugs).toEqual(["task-a", "task-b"]);
  });

  // REGRESSION — legacy claim records (no session_id at all) still group, and the
  // absent field is REPORTED as absent rather than fabricated.
  it("REGRESSION: two legacy session-id-less claims by one actor still group into ONE row, with no session_id key", () => {
    const sessions = deriveSessions(
      [
        taskWithClaim("task-a", { by: ORCHESTRATOR, at: NOW, machine: "mbp" }),
        taskWithClaim("task-b", { by: ORCHESTRATOR, at: NOW, machine: "mbp" }),
      ],
      NOW,
      120,
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).not.toHaveProperty("session_id");
  });

  // BOUNDARY — a session id is an INDEPENDENT dimension: it must not erase the
  // pre-existing worktree/machine discrimination.
  it("BOUNDARY: identical session id but DIFFERENT worktree still derives two sessions", () => {
    const sessions = deriveSessions(
      [
        taskWithClaim("task-a", { by: ORCHESTRATOR, at: NOW, worktree: "/w1", session_id: SESSION_A }),
        taskWithClaim("task-b", { by: ORCHESTRATOR, at: NOW, worktree: "/w2", session_id: SESSION_A }),
      ],
      NOW,
      120,
    );
    expect(sessions).toHaveLength(2);
  });

  // BOUNDARY — one measured, one not: absence is a distinct key, never a wildcard
  // that merges into a measured group.
  it("BOUNDARY: one claim with a session id and one without never merge into a single session", () => {
    const sessions = deriveSessions(
      [
        taskWithClaim("task-a", { by: ORCHESTRATOR, at: NOW, session_id: SESSION_A }),
        taskWithClaim("task-b", { by: ORCHESTRATOR, at: NOW }),
      ],
      NOW,
      120,
    );
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((s) => s.session_id === undefined)).toHaveLength(1);
  });
});

// ─── compareClaimSessions: the three-valued comparison (required fix 3 + 4) ─────

describe("compareClaimSessions — absence is NOT-MEASURED, never same-session", () => {
  it("HAPPY: identical ids → same-session; differing ids → different-session", () => {
    expect(compareClaimSessions(SESSION_A, SESSION_A)).toBe("same-session");
    expect(compareClaimSessions(SESSION_A, SESSION_B)).toBe("different-session");
  });

  it("NEGATIVE: an absent id on EITHER side (or both) → not-measured", () => {
    expect(compareClaimSessions(undefined, SESSION_B)).toBe("not-measured");
    expect(compareClaimSessions(SESSION_A, undefined)).toBe("not-measured");
    expect(compareClaimSessions(undefined, undefined)).toBe("not-measured");
  });
});

// ─── noAnchorOverlap: same `by`, different session = FOREIGN (required fix 3) ────

describe("noAnchorOverlap — cross-SESSION mutual exclusion, not cross-actor", () => {
  const candidateAnchors = ["packages/core/src/session.ts"];

  // HAPPY + CONTROL in one test — a blanket-refuse regression cannot pass as green.
  it("HAPPY: same `by`, DIFFERENT session id → refused with ANCHOR_OVERLAP; SAME session id → permitted", () => {
    const refused = noAnchorOverlap(
      ORCHESTRATOR,
      candidateAnchors,
      [sibling({ session_id: SESSION_B })],
      SESSION_A,
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.reason).toBe(ANCHOR_OVERLAP_REASON);
      expect(refused.field).toBe(ANCHOR_OVERLAP_FIELD);
    }

    const permitted = noAnchorOverlap(
      ORCHESTRATOR,
      candidateAnchors,
      [sibling({ session_id: SESSION_A })],
      SESSION_A,
    );
    expect(permitted.ok).toBe(true);
  });

  // NEGATIVE — the Silence answer: not-measured must REFUSE and must say which
  // failure it is, with a reason distinct from a measured conflict.
  it("NEGATIVE: an absent session id (candidate / sibling / both) refuses with the distinct not-measured reason", () => {
    const cases: Array<[string | undefined, string | undefined]> = [
      [undefined, SESSION_B],
      [SESSION_A, undefined],
      [undefined, undefined],
    ];
    for (const [candidateSession, siblingSession] of cases) {
      const result = noAnchorOverlap(
        ORCHESTRATOR,
        candidateAnchors,
        [sibling(siblingSession !== undefined ? { session_id: siblingSession } : {})],
        candidateSession,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe(ANCHOR_OVERLAP_SESSION_UNMEASURED_REASON);
        expect(result.field).toBe(ANCHOR_OVERLAP_FIELD);
      }
    }
  });

  it("REGRESSION: a FOREIGN actor overlap still fails with the original ANCHOR_OVERLAP reason, whatever the session ids", () => {
    const result = noAnchorOverlap(
      "agent:someone-else",
      candidateAnchors,
      [sibling({ session_id: SESSION_A })],
      SESSION_A,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe(ANCHOR_OVERLAP_REASON);
  });

  it("BOUNDARY: no candidate anchors → vacuous pass even across sessions; disjoint anchors → pass; stale sibling → pass", () => {
    expect(noAnchorOverlap(ORCHESTRATOR, [], [sibling({ session_id: SESSION_B })], SESSION_A).ok).toBe(
      true,
    );
    expect(
      noAnchorOverlap(ORCHESTRATOR, ["packages/lore/src/x.ts"], [sibling({ session_id: SESSION_B })], SESSION_A).ok,
    ).toBe(true);
    expect(
      noAnchorOverlap(ORCHESTRATOR, candidateAnchors, [sibling({ session_id: SESSION_B, stale: true })], SESSION_A).ok,
    ).toBe(true);
    expect(
      noAnchorOverlap(ORCHESTRATOR, candidateAnchors, [sibling({ session_id: SESSION_B, anchors: [] })], SESSION_A).ok,
    ).toBe(true);
  });

  // The predicate and the feeding-pack renderer must share ONE offending-sibling
  // finder — the renderer used to re-implement the skip rules and would have printed
  // "no specific conflicting sibling could be identified" for every new case.
  it("STATE: findAnchorOverlapConflict classifies each conflict kind and always names the sibling", () => {
    const foreignActor = findAnchorOverlapConflict(
      "agent:other",
      candidateAnchors,
      [sibling({ session_id: SESSION_A })],
      SESSION_A,
    );
    expect(foreignActor?.kind).toBe("foreign-actor");
    expect(foreignActor?.sibling.slug).toBe("task-sibling");
    expect(foreignActor?.pairs.length).toBeGreaterThan(0);

    expect(
      findAnchorOverlapConflict(ORCHESTRATOR, candidateAnchors, [sibling({ session_id: SESSION_B })], SESSION_A)?.kind,
    ).toBe("foreign-session");
    expect(findAnchorOverlapConflict(ORCHESTRATOR, candidateAnchors, [sibling()], SESSION_A)?.kind).toBe(
      "session-not-measured",
    );
    expect(
      findAnchorOverlapConflict(ORCHESTRATOR, candidateAnchors, [sibling({ session_id: SESSION_A })], SESSION_A),
    ).toBeUndefined();
  });
});

// ─── The gate SAYS SO: registry check + feeding pack ────────────────────────────

describe("checkpointRegistry['task-claim'] — the session verdict reaches the gate output", () => {
  const def = checkpointRegistry["task-claim"]!;

  it("HAPPY: ctx.candidateSessionId feeds the predicate — differing sessions block, identical sessions pass", () => {
    const blocked: GateContext = {
      candidateBy: ORCHESTRATOR,
      candidateSessionId: SESSION_A,
      candidateAnchors: ["packages/core/src/session.ts"],
      siblingClaims: [sibling({ session_id: SESSION_B })],
      hasSpecParent: false,
    };
    expect(isCheckpointBlocked(def.check(blocked))).toBe(true);

    const passing: GateContext = { ...blocked, siblingClaims: [sibling({ session_id: SESSION_A })] };
    expect(isCheckpointBlocked(def.check(passing))).toBe(false);
  });

  it("NEGATIVE: the not-measured refusal's feeding pack carries its own reason token AND names the sibling", () => {
    const ctx: GateContext = {
      candidateBy: ORCHESTRATOR,
      candidateAnchors: ["packages/core/src/session.ts"],
      siblingClaims: [sibling()],
      hasSpecParent: false,
    };
    const results = def.check(ctx);
    expect(isCheckpointBlocked(results)).toBe(true);
    const pack = def.feed(ctx, selectFailures(results));
    expect(pack).toContain(ANCHOR_OVERLAP_SESSION_UNMEASURED_REASON);
    expect(pack).toContain("task-sibling");
  });

  it("REGRESSION: the different-session refusal's feeding pack names the sibling instead of the old 'no specific conflicting sibling' text", () => {
    const ctx: GateContext = {
      candidateBy: ORCHESTRATOR,
      candidateSessionId: SESSION_A,
      candidateAnchors: ["packages/core/src/session.ts"],
      siblingClaims: [sibling({ session_id: SESSION_B })],
      hasSpecParent: false,
    };
    const pack = def.feed(ctx, selectFailures(def.check(ctx)));
    expect(pack).toContain("task-sibling");
    expect(pack).not.toContain("no specific conflicting sibling");
  });
});

// ─── resolveClaimSessionId: capture, absence, and the loud failure ──────────────

describe("resolveClaimSessionId — the capture seam (required fix 1)", () => {
  it("HAPPY: reads CLAUDE_CODE_SESSION_ID, falling back to CLAUDE_SESSION_ID, as a sanitized prefix", () => {
    const primary = resolveClaimSessionId({ CLAUDE_CODE_SESSION_ID: "3DE02220-5d69-4b5a-ac23" });
    expect(primary.ok).toBe(true);
    if (primary.ok) expect(primary.value).toBe("3de02220");

    const secondary = resolveClaimSessionId({ CLAUDE_SESSION_ID: "7AB19C04-aaaa" });
    expect(secondary.ok).toBe(true);
    if (secondary.ok) expect(secondary.value).toBe("7ab19c04");

    const precedence = resolveClaimSessionId({
      CLAUDE_CODE_SESSION_ID: "3de02220-x",
      CLAUDE_SESSION_ID: "7ab19c04-x",
    });
    expect(precedence.ok).toBe(true);
    if (precedence.ok) expect(precedence.value).toBe("3de02220");
  });

  it("BOUNDARY: unset / empty / whitespace-only is 'no session' (undefined), not an error", () => {
    for (const env of [{}, { CLAUDE_CODE_SESSION_ID: "" }, { CLAUDE_SESSION_ID: "   " }]) {
      const result = resolveClaimSessionId(env);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBeUndefined();
    }
  });

  it("ERROR: a session id that sanitizes to the empty string fails LOUD instead of degrading to not-measured", () => {
    const result = resolveClaimSessionId({ CLAUDE_CODE_SESSION_ID: "!!!" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
      expect((result.error as { field?: string }).field).toBe("claim.session_id");
    }
  });
});

// ─── The claim record: schema + carry-forward ───────────────────────────────────

describe("taskClaimSchema.session_id — an additive, never-inherited captured fact", () => {
  it("HAPPY: a claim carrying session_id round-trips; REGRESSION: a legacy claim without it still parses", () => {
    const withSession = taskClaimSchema.safeParse({
      by: ORCHESTRATOR,
      at: NOW,
      machine: "mbp",
      session_id: SESSION_A,
    });
    expect(withSession.success).toBe(true);
    if (withSession.success) expect(withSession.data.session_id).toBe(SESSION_A);

    const legacy = taskClaimSchema.safeParse({ by: ORCHESTRATOR, at: NOW, machine: "mbp" });
    expect(legacy.success).toBe(true);
    if (legacy.success) expect(legacy.data.session_id).toBeUndefined();
  });
});

// ─── End-to-end through TaskWorkflowService (the observed topology) ─────────────

describe("TaskWorkflowService.claim — two sessions, one actor, one checkout", () => {
  it("STATE: the persisted claim record carries the captured session_id (no flag, no opt-in)", async () => {
    const { store, corpusService } = makeStoreAndCorpus();
    const service = makeSessionService(store, corpusService, {
      CLAUDE_CODE_SESSION_ID: "3de02220-5d69",
    });
    const { taskIds } = await createPlanAndTasks(corpusService, [["packages/core/src/session.ts"]]);

    const claimed = await service.claim(taskIds[0]!, { by: ORCHESTRATOR });
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;
    expect(claimed.value.extra["claim"]).toMatchObject({ by: ORCHESTRATOR, session_id: "3de02220" });
  });

  it("STATE: the SECOND orchestrator's overlapping claim is REFUSED; the same-session control is PERMITTED", async () => {
    const { store, corpusService } = makeStoreAndCorpus();
    const anchors = ["packages/core/src/session.ts"];
    const { taskIds } = await createPlanAndTasks(corpusService, [anchors, anchors]);

    const sessionOne = makeSessionService(store, corpusService, { CLAUDE_CODE_SESSION_ID: SESSION_A });
    const sessionTwo = makeSessionService(store, corpusService, { CLAUDE_CODE_SESSION_ID: SESSION_B });

    const first = await sessionOne.claim(taskIds[0]!, { by: ORCHESTRATOR });
    expect(first.ok).toBe(true);

    const foreignSession = await sessionTwo.claim(taskIds[1]!, { by: ORCHESTRATOR });
    expect(foreignSession.ok).toBe(false);
    if (!foreignSession.ok) {
      expect(foreignSession.error.code).toBe("VALIDATION_ERROR");
      expect((foreignSession.error as { field?: string }).field).toBe("gate:task-claim:anchor-overlap");
    }

    // CONTROL — the SAME session claiming both overlapping tasks is still permitted,
    // so the refusal above is session-scoped and not a blanket refuse.
    const sameSession = await sessionOne.claim(taskIds[1]!, { by: ORCHESTRATOR });
    expect(sameSession.ok).toBe(true);
  });

  it("NEGATIVE: a session-less claim colliding with a measured one is refused as not-measured, never permitted", async () => {
    const { store, corpusService } = makeStoreAndCorpus();
    const anchors = ["packages/core/src/session.ts"];
    const { taskIds } = await createPlanAndTasks(corpusService, [anchors, anchors]);

    const measured = makeSessionService(store, corpusService, { CLAUDE_CODE_SESSION_ID: SESSION_A });
    const unmeasured = makeSessionService(store, corpusService, {});

    expect((await measured.claim(taskIds[0]!, { by: ORCHESTRATOR })).ok).toBe(true);

    const result = await unmeasured.claim(taskIds[1]!, { by: ORCHESTRATOR });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.error as { field?: string }).field).toBe("gate:task-claim:anchor-overlap");
      expect(JSON.stringify(result.error)).toContain(ANCHOR_OVERLAP_SESSION_UNMEASURED_REASON);
    }
  });

  it("STATE: a same-holder refresh from a session with NO session id does not INHERIT the previous session's id", async () => {
    const { store, corpusService } = makeStoreAndCorpus();
    const { taskIds } = await createPlanAndTasks(corpusService, [["packages/core/src/session.ts"]]);

    const measured = makeSessionService(store, corpusService, { CLAUDE_CODE_SESSION_ID: SESSION_A });
    const unmeasured = makeSessionService(store, corpusService, {});

    const first = await measured.claim(taskIds[0]!, { by: ORCHESTRATOR });
    expect(first.ok).toBe(true);

    const refreshed = await unmeasured.claim(taskIds[0]!, { by: ORCHESTRATOR });
    expect(refreshed.ok).toBe(true);
    if (!refreshed.ok) return;
    expect(refreshed.value.extra["claim"]).not.toHaveProperty("session_id");
    // machine/worktree carry-forward semantics are UNCHANGED — only the session
    // instance is non-inheritable (inheriting it would fabricate same-session evidence).
    expect(refreshed.value.extra["claim"]).toMatchObject({ by: ORCHESTRATOR });
  });

  it("ERROR: an unusable session id refuses the claim loud and writes nothing", async () => {
    const { store, corpusService } = makeStoreAndCorpus();
    const { taskIds } = await createPlanAndTasks(corpusService, [["packages/core/src/session.ts"]]);
    const broken = makeSessionService(store, corpusService, { CLAUDE_CODE_SESSION_ID: "!!!" });

    const result = await broken.claim(taskIds[0]!, { by: ORCHESTRATOR });
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as { field?: string }).field).toBe("claim.session_id");

    const doc = await store.find(taskIds[0]!);
    if (!doc.ok || doc.value === null) throw new Error("task not found");
    expect(doc.value.extra["claim"]).toBeUndefined();
  });

  it("STATE: ready() reports the two-session collapse honestly — two sessions AND an anchor conflict", async () => {
    const { store, corpusService } = makeStoreAndCorpus();
    const anchors = ["packages/core/src/session.ts"];
    const { planId, taskIds } = await createPlanAndTasks(corpusService, [anchors, anchors]);

    const sessionOne = makeSessionService(store, corpusService, { CLAUDE_CODE_SESSION_ID: SESSION_A });
    expect((await sessionOne.claim(taskIds[0]!, { by: ORCHESTRATOR })).ok).toBe(true);

    // The second claim is refused by the gate, so write the colliding claim directly —
    // this is also EXACTLY the legacy/foreign-session state `ready()` must report on.
    const second = await store.find(taskIds[1]!);
    if (!second.ok || second.value === null) throw new Error("task two not found");
    const updated = await store.update(
      second.value.id,
      {
        extra: {
          ...second.value.extra,
          claim: { by: ORCHESTRATOR, at: new Date().toISOString(), session_id: SESSION_B },
        },
      },
      { expected_version: second.value.version },
    );
    expect(updated.ok).toBe(true);

    const report = await sessionOne.ready(planId);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.sessions).toHaveLength(2);
    expect(report.value.anchor_conflicts.length).toBeGreaterThan(0);
  });
});
