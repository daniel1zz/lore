/**
 * Claim-time SESSION INSTANCE capture on the PHASE channel —
 * task-phaseworkflowservice-claim-captures-no-session-id-so-every.
 *
 * `task-two-concurrent-orchestrators-both-resolve-to-agent-main` narrowed
 * `noAnchorOverlap`'s same-`by` exemption to "same `by` AND the same CAPTURED
 * session instance", and implemented the capture in `TaskWorkflowService.claim`
 * ONLY. `checkpointRegistry["phase-claim"]` reuses that predicate VERBATIM, so
 * every same-actor overlapping PHASE claim landed in the fail-safe
 * `ANCHOR_OVERLAP_SESSION_UNMEASURED` refusal — permanently, because nothing on
 * that path could ever supply the field (a reader without a writer, failing loud
 * instead of silent).
 *
 * This file pins the WRITER: `PhaseWorkflowService.claim` captures `session_id`
 * from its INJECTED env through the SAME exported `resolveClaimSessionId` seam
 * the task path uses (never a second capture path, never a re-implementation of
 * `@lore/core::sessionIdDiscriminator`'s sanitize rule), with NO flag and NO
 * `ClaimOpts` field — the field is captured, never passed.
 *
 * ⛔ Every service here is constructed with an EXPLICIT `processEnv`. The
 * constructor default stays `{}` (mirroring `TaskWorkflowService`) precisely so a
 * unit verdict never depends on whether the test process happens to run under a
 * Claude Code session — a machine-dependent oracle is worse than no oracle. The
 * production wiring (`adapters/cli/phase-wiring.ts` passing `process.env`) is
 * therefore a SEPARATE, distribution-level oracle:
 * `tests/integration/phase-claim-session-parity.bun.test.ts`.
 *
 * Six-dimension coverage:
 *   HAPPY:      a phase claim persists `extra.claim.session_id` = the sanitized
 *               8-char discriminator of $CLAUDE_CODE_SESSION_ID
 *   STATE:      two anchor-overlapping phases claimed by ONE actor in ONE measured
 *               session — the second is EXEMPTED (the defect's headline case), and
 *               the persisted second claim still carries the session id
 *   NEGATIVE:   same actor, DIFFERENT measured sessions → refused as FOREIGN
 *               (`ANCHOR_OVERLAP`), so the STATE case above is not satisfiable by a
 *               blanket same-`by` exemption; a FOREIGN actor overlap still refuses
 *   ERROR:      a session env var present but sanitizing to empty fails LOUD
 *               (`VALIDATION_ERROR`, field `claim.session_id`) and writes NOTHING
 *   BOUNDARY:   unset / whitespace-only env is "no session" (never an error);
 *               $CLAUDE_SESSION_ID is honored as the fallback variable name
 *   REGRESSION: an ABSENT session id on either side still refuses with
 *               `ANCHOR_OVERLAP_SESSION_UNMEASURED` (the fail-safe survives the
 *               fix); a LEGACY sibling claim with no `session_id` never reads as
 *               "same session"; a same-holder refresh never INHERITS a session id
 *               from the previous claim record
 *
 * @spec_ref task-phaseworkflowservice-claim-captures-no-session-id-so-every
 *   §Required fix 1-4, §Acceptance criteria AC-1..AC-7;
 *   task-two-concurrent-orchestrators-both-resolve-to-agent-main §Required fix 1;
 *   SPEC-042 §Design Decisions D1/D5; SPEC-056 D2/D7.
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { PhaseWorkflowService } from "../../../src/service/phase-workflow-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import type { GateDependencies } from "../../../src/service/gate-enforcer.js";
import {
  ANCHOR_OVERLAP_REASON,
  ANCHOR_OVERLAP_SESSION_UNMEASURED_REASON,
} from "../../../src/service/gate-predicates.js";
import type { DocRecord, DocType, TaskClaim } from "@lore/core";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ACTOR = "agent:main-orchestrator";
const PLAN_ID = "01HPLANSESSCAP000000000001";
const SESSION_A_RAW = "3DE02220-5d69-4b5a-ac23-d66e14c0261b";
const SESSION_A_ID = "3de02220";
const SESSION_B_RAW = "7ab19c04-second-live-session";
const SESSION_B_ID = "7ab19c04";
const SHARED_ANCHOR = "packages/core/src/session.ts";

function makePlanRecord(): DocRecord {
  return {
    id: PLAN_ID,
    slug: "plan-session-capture",
    type: "plan",
    role: "plan",
    title: "Plan Session Capture",
    status: "approved",
    priority: "medium",
    content: "# Plan",
    parent_id: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    created_by: "system",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
  };
}

/**
 * A `phase` doc inserted straight into the store — same recipe
 * `claim-anchor-toctou.test.ts` uses, so anchors/claims can be seeded
 * independently of the capture path under test (including the LEGACY claim shape
 * that omits `session_id` entirely).
 */
function makePhaseRecord(overrides: Partial<DocRecord> = {}): DocRecord {
  const base: DocRecord = {
    id: "01HPHASESESSCAP00000000001",
    slug: "phase-alpha",
    type: "phase" as unknown as DocType,
    role: "plan",
    title: "Phase Alpha",
    status: "draft",
    priority: "medium",
    content: "# Phase Alpha",
    parent_id: PLAN_ID,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    created_by: "system",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
  };
  return { ...base, ...overrides, extra: { ...base.extra, ...overrides.extra } };
}

async function mustInsert(store: InMemoryStore, doc: DocRecord): Promise<DocRecord> {
  const result = await store.insert(doc);
  if (!result.ok) throw new Error(`insert failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

/**
 * One store, N services — each service instance stands in for ONE live session,
 * carrying its OWN injected env exactly the way `phase-wiring.ts` hands the real
 * `process.env` to the single production instance.
 */
function makeStore() {
  const store = new InMemoryStore();
  const corpusService = new CorpusService(store, new RecordLockService(store));
  return { store, corpusService };
}

function makeSessionService(
  store: InMemoryStore,
  corpusService: CorpusService,
  env: Record<string, string | undefined>,
): PhaseWorkflowService {
  const gate: GateDependencies = {
    enforcer: new GateEnforcer(undefined),
    getPlanBundle: corpusService.getPlanBundle.bind(corpusService),
  };
  return new PhaseWorkflowService(store, undefined, { claimTtlMinutes: 120 }, undefined, gate, env);
}

/** Two overlapping-anchor phases under one plan, plus a wired store/corpus pair. */
async function seedOverlappingPhases(anchors: string[] = [SHARED_ANCHOR]) {
  const { store, corpusService } = makeStore();
  await mustInsert(store, makePlanRecord());
  const phaseOne = await mustInsert(store, makePhaseRecord({ extra: { file_anchors: anchors } }));
  const phaseTwo = await mustInsert(
    store,
    makePhaseRecord({
      id: "01HPHASESESSCAP00000000002",
      slug: "phase-beta",
      title: "Phase Beta",
      extra: { file_anchors: anchors },
    }),
  );
  return { store, corpusService, phaseOne, phaseTwo };
}

async function readClaim(store: InMemoryStore, id: string): Promise<TaskClaim | undefined> {
  const found = await store.find(id);
  if (!found.ok || found.value === null) throw new Error(`doc ${id} not found`);
  return found.value.extra["claim"] as TaskClaim | undefined;
}

async function readVersion(store: InMemoryStore, id: string): Promise<number> {
  const found = await store.find(id);
  if (!found.ok || found.value === null) throw new Error(`doc ${id} not found`);
  return found.value.version;
}

// ─── HAPPY ───────────────────────────────────────────────────────────────────

describe("PhaseWorkflowService.claim — session instance capture (AC-1)", () => {
  it("HAPPY: the persisted phase claim carries the sanitized session discriminator", async () => {
    const { store, corpusService, phaseOne } = await seedOverlappingPhases();
    const service = makeSessionService(store, corpusService, { CLAUDE_CODE_SESSION_ID: SESSION_A_RAW });

    const claimed = await service.claim(phaseOne.slug, { by: ACTOR });
    expect(claimed.ok).toBe(true);

    const claim = await readClaim(store, phaseOne.id);
    expect(claim?.by).toBe(ACTOR);
    expect(claim?.session_id).toBe(SESSION_A_ID);
  });

  it("BOUNDARY: $CLAUDE_SESSION_ID is honored when $CLAUDE_CODE_SESSION_ID is unset", async () => {
    const { store, corpusService, phaseOne } = await seedOverlappingPhases();
    const service = makeSessionService(store, corpusService, { CLAUDE_SESSION_ID: SESSION_B_RAW });

    const claimed = await service.claim(phaseOne.slug, { by: ACTOR });
    expect(claimed.ok).toBe(true);
    expect((await readClaim(store, phaseOne.id))?.session_id).toBe(SESSION_B_ID);
  });

  it("BOUNDARY: an unset / whitespace-only session env is 'no session', never an error", async () => {
    const { store, corpusService, phaseOne, phaseTwo } = await seedOverlappingPhases();

    const unset = makeSessionService(store, corpusService, {});
    const claimedUnset = await unset.claim(phaseOne.slug, { by: ACTOR });
    expect(claimedUnset.ok).toBe(true);
    expect((await readClaim(store, phaseOne.id))?.session_id).toBeUndefined();

    const blank = makeSessionService(store, corpusService, { CLAUDE_CODE_SESSION_ID: "   " });
    // A DIFFERENT actor keeps this second claim out of the anchor-overlap path —
    // this case is about the capture's treatment of a blank env, not the mutex.
    const claimedBlank = await blank.claim(phaseTwo.slug, { by: "agent:someone-else", steal: true });
    expect(claimedBlank.ok).toBe(false);
    if (claimedBlank.ok) return;
    // Refused by the anchor mutex (a foreign actor), NOT by a capture error —
    // the assertion that matters is the error is not a `claim.session_id` one.
    expect((claimedBlank.error as { field?: string }).field).not.toBe("claim.session_id");
  });
});

// ─── STATE: the headline case this task exists to fix ────────────────────────

describe("PhaseWorkflowService.claim — same-actor, same-session anchor overlap (AC-1/AC-3)", () => {
  it("STATE: ONE actor in ONE measured session may hold TWO anchor-overlapping phases", async () => {
    const { store, corpusService, phaseOne, phaseTwo } = await seedOverlappingPhases();
    const service = makeSessionService(store, corpusService, { CLAUDE_CODE_SESSION_ID: SESSION_A_RAW });

    const first = await service.claim(phaseOne.slug, { by: ACTOR });
    expect(first.ok).toBe(true);

    const second = await service.claim(phaseTwo.slug, { by: ACTOR });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    // Both claims live, both carrying the SAME captured session instance — the
    // exemption is granted on the FACT, never on the `by` proxy.
    expect((await readClaim(store, phaseOne.id))?.session_id).toBe(SESSION_A_ID);
    expect((await readClaim(store, phaseTwo.id))?.session_id).toBe(SESSION_A_ID);
  });
});

// ─── NEGATIVE controls ───────────────────────────────────────────────────────

describe("PhaseWorkflowService.claim — cross-session and foreign-actor refusals (AC-2)", () => {
  it("NEGATIVE: same actor, DIFFERENT measured session → refused as FOREIGN, not exempted", async () => {
    const { store, corpusService, phaseOne, phaseTwo } = await seedOverlappingPhases();
    const sessionA = makeSessionService(store, corpusService, { CLAUDE_CODE_SESSION_ID: SESSION_A_RAW });
    const sessionB = makeSessionService(store, corpusService, { CLAUDE_CODE_SESSION_ID: SESSION_B_RAW });

    expect((await sessionA.claim(phaseOne.slug, { by: ACTOR })).ok).toBe(true);

    const second = await sessionB.claim(phaseTwo.slug, { by: ACTOR });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect((second.error as { field?: string }).field).toBe("gate:phase-claim:anchor-overlap");
    expect(JSON.stringify(second.error)).toContain(ANCHOR_OVERLAP_REASON);
    expect(JSON.stringify(second.error)).not.toContain(ANCHOR_OVERLAP_SESSION_UNMEASURED_REASON);
    // Nothing persisted for the refused claim (the post-write re-check self-rolls-back).
    expect(await readClaim(store, phaseTwo.id)).toBeUndefined();
  });

  it("NEGATIVE: a FOREIGN actor overlap in a measured session still refuses with ANCHOR_OVERLAP", async () => {
    const { store, corpusService, phaseOne, phaseTwo } = await seedOverlappingPhases();
    const service = makeSessionService(store, corpusService, { CLAUDE_CODE_SESSION_ID: SESSION_A_RAW });

    expect((await service.claim(phaseOne.slug, { by: ACTOR })).ok).toBe(true);

    const foreign = await service.claim(phaseTwo.slug, { by: "agent:other" });
    expect(foreign.ok).toBe(false);
    if (foreign.ok) return;
    expect(JSON.stringify(foreign.error)).toContain(ANCHOR_OVERLAP_REASON);
  });

  it("BOUNDARY: DISJOINT anchors are never a conflict, even across sessions", async () => {
    const { store, corpusService } = makeStore();
    await mustInsert(store, makePlanRecord());
    const phaseOne = await mustInsert(store, makePhaseRecord({ extra: { file_anchors: ["src/a.ts"] } }));
    const phaseTwo = await mustInsert(
      store,
      makePhaseRecord({
        id: "01HPHASESESSCAP00000000002",
        slug: "phase-beta",
        title: "Phase Beta",
        extra: { file_anchors: ["src/b.ts"] },
      }),
    );

    const sessionA = makeSessionService(store, corpusService, { CLAUDE_CODE_SESSION_ID: SESSION_A_RAW });
    const sessionB = makeSessionService(store, corpusService, { CLAUDE_CODE_SESSION_ID: SESSION_B_RAW });
    expect((await sessionA.claim(phaseOne.slug, { by: ACTOR })).ok).toBe(true);
    expect((await sessionB.claim(phaseTwo.slug, { by: ACTOR })).ok).toBe(true);
  });
});

// ─── REGRESSION: the fail-safe must survive the fix ──────────────────────────

describe("PhaseWorkflowService.claim — the not-measured fail-safe survives (AC-3/AC-5)", () => {
  it("REGRESSION: NO session env on either side still refuses with ANCHOR_OVERLAP_SESSION_UNMEASURED", async () => {
    const { store, corpusService, phaseOne, phaseTwo } = await seedOverlappingPhases();
    const service = makeSessionService(store, corpusService, {});

    expect((await service.claim(phaseOne.slug, { by: ACTOR })).ok).toBe(true);
    expect((await readClaim(store, phaseOne.id))?.session_id).toBeUndefined();

    const second = await service.claim(phaseTwo.slug, { by: ACTOR });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect((second.error as { field?: string }).field).toBe("gate:phase-claim:anchor-overlap");
    expect(JSON.stringify(second.error)).toContain(ANCHOR_OVERLAP_SESSION_UNMEASURED_REASON);
  });

  it("REGRESSION: a LEGACY sibling claim with no session_id never reads as 'same session'", async () => {
    const { store, corpusService } = makeStore();
    await mustInsert(store, makePlanRecord());
    // A pre-capture claim record: `by` + `at` only, exactly the shape on disk in
    // every corpus written before session capture existed.
    const legacyHolder = await mustInsert(
      store,
      makePhaseRecord({
        extra: {
          file_anchors: [SHARED_ANCHOR],
          claim: { by: ACTOR, at: new Date().toISOString() },
        },
      }),
    );
    const candidate = await mustInsert(
      store,
      makePhaseRecord({
        id: "01HPHASESESSCAP00000000002",
        slug: "phase-beta",
        title: "Phase Beta",
        extra: { file_anchors: [SHARED_ANCHOR] },
      }),
    );

    const service = makeSessionService(store, corpusService, { CLAUDE_CODE_SESSION_ID: SESSION_A_RAW });
    const result = await service.claim(candidate.slug, { by: ACTOR });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.error)).toContain(ANCHOR_OVERLAP_SESSION_UNMEASURED_REASON);
    // The legacy record itself parses fine and is left untouched.
    expect((await readClaim(store, legacyHolder.id))?.by).toBe(ACTOR);
  });

  it("REGRESSION: a same-holder refresh never INHERITS a session id from the previous claim", async () => {
    const { store, corpusService, phaseOne } = await seedOverlappingPhases();
    const measured = makeSessionService(store, corpusService, { CLAUDE_CODE_SESSION_ID: SESSION_A_RAW });
    expect((await measured.claim(phaseOne.slug, { by: ACTOR })).ok).toBe(true);
    expect((await readClaim(store, phaseOne.id))?.session_id).toBe(SESSION_A_ID);

    // The SAME actor refreshes from a session-less environment: the refreshed
    // record must report "not measured", never carry the earlier session forward
    // (which would fabricate same-session evidence).
    const unmeasured = makeSessionService(store, corpusService, {});
    const refreshed = await unmeasured.claim(phaseOne.slug, { by: ACTOR });
    expect(refreshed.ok).toBe(true);
    expect((await readClaim(store, phaseOne.id))?.session_id).toBeUndefined();
  });
});

// ─── ERROR: an unusable session id fails loud and writes nothing ─────────────

describe("PhaseWorkflowService.claim — unusable session id (AC-6)", () => {
  it("ERROR: a session env sanitizing to empty fails loud and persists NOTHING", async () => {
    const { store, corpusService, phaseOne } = await seedOverlappingPhases();
    const versionBefore = await readVersion(store, phaseOne.id);
    const service = makeSessionService(store, corpusService, { CLAUDE_CODE_SESSION_ID: "!!!" });

    const result = await service.claim(phaseOne.slug, { by: ACTOR });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect((result.error as { field?: string }).field).toBe("claim.session_id");

    // No claim, no version bump — the refusal is pre-write.
    expect(await readClaim(store, phaseOne.id)).toBeUndefined();
    expect(await readVersion(store, phaseOne.id)).toBe(versionBefore);
  });

  it("ERROR: the unusable-session refusal precedes doc resolution (a missing phase still fails on the env)", async () => {
    const { store, corpusService } = makeStore();
    await mustInsert(store, makePlanRecord());
    const service = makeSessionService(store, corpusService, { CLAUDE_CODE_SESSION_ID: "###" });

    const result = await service.claim("phase-does-not-exist", { by: ACTOR });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect((result.error as { field?: string }).field).toBe("claim.session_id");
  });
});
