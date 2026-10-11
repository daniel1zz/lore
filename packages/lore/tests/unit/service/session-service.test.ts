/**
 * RED suite (TDD-Role: red, paired-impl task-skill-implement-core-seat-ts-seatservice-
 * realgitport) for `SessionService.bootstrap`'s SPEC-057 seat-signal extension. This is
 * a NEW file (no pre-existing `session-service.test.ts` was found in this codebase —
 * the resume_hint assertions this suite's FROZEN BASELINE section pins were previously
 * only covered by `session-bootstrap.test.ts`, which stays untouched). This file's path
 * matches SPEC-057's own declared AC-S-3 oracle command verbatim
 * (`bunx vitest run packages/lore/tests/unit/service/session-service.test.ts`).
 *
 * FROZEN BASELINE (byte-identical continuation, REGRESSION): `bootstrap(by, now)` called
 * with NO third `seat` argument must keep producing the exact pre-SPEC-057
 * corpus-global-newest `resume_hint` — this is the "seatPlanId absent -> corpus-global
 * (byte-identical)" contract `core/seat.ts::deriveResumeHint`'s own JSDoc promises.
 *
 * RED mechanism: `bootstrap`'s real (current) signature is `(by, now?)` — a literal
 * 2-arg TS call is all `tsc` accepts today. Calling it with a THIRD `seat` argument
 * would be a genuine `tsc` error (TS2554), which would violate this task's own AC-S-8
 * ("bun run typecheck exits 0"). Rather than a computed-specifier dynamic import (this
 * class already exists — only its method SIGNATURE is extending), this suite casts the
 * real, literally-imported `SessionService` instance's `bootstrap` method to a locally
 * declared extended-signature type before calling it with a `seat` argument. This
 * compiles clean under the LOCAL cast type today; at RUNTIME the REAL (current,
 * 2-arg) `bootstrap` implementation executes and silently ignores the extra argument
 * (plain JS — no throw), so every seat-scoped assertion below fails on VALUE mismatch
 * (the report it gets back is unscoped/corpus-global) rather than on a thrown error —
 * an equally legitimate RED failure mode for a signature-extension task, as opposed to
 * seat.test.ts / seat-service.test.ts's "module does not exist yet" mode.
 *
 * Source: spec-spec-057-two-tier-worktree-seat-model-lore-seat-verb-seat-a
 *   §Public Interface (`SessionService.bootstrap(by, now, seat?)`), §Design Decisions D3,
 *   §Acceptance Criteria AC-S-3.
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { SessionService } from "../../../src/service/session-service.js";
import { buildBootstrapInjection } from "@lore/core";
import type { BootstrapReport, CreateDocInput, DocRecord, LoreError, Result } from "@lore/core";

function makeSessionService(store: InMemoryStore) {
  const corpusService = new CorpusService(store, new RecordLockService(store));
  const sessionService = new SessionService(store, {
    claimTtlMinutes: 120,
    handoffTtlMinutes: 10080,
    createHandoffDoc: corpusService.createHandoffDoc.bind(corpusService),
  });
  return { corpusService, sessionService };
}

async function mustCreate(cs: CorpusService, input: CreateDocInput): Promise<DocRecord> {
  const result = await cs.create(input);
  if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

/** The SPEC-057-extended signature — see module header for why this cast, not a
 *  computed dynamic import, is the correct RED technique for THIS module. */
interface SeatSignal {
  branch: string;
  worktree: string;
}
type BootstrapWithSeat = (
  by: string,
  now?: () => string,
  seat?: SeatSignal,
) => Promise<Result<BootstrapReport & { seat_unresolved?: boolean }, LoreError>>;

function bootstrapWithSeat(sessionService: SessionService): BootstrapWithSeat {
  return sessionService.bootstrap.bind(sessionService) as unknown as BootstrapWithSeat;
}

/** Builds a two-plan corpus with handoffs at distinct times, so a seat-scoped resume
 *  hint (plan-a's own newest) is distinguishable from the corpus-global newest
 *  (plan-b's, which is chronologically later). Shared by every seat-scoping case below. */
async function buildTwoPlanCorpusWithHandoffs() {
  const store = new InMemoryStore();
  const { corpusService, sessionService } = makeSessionService(store);

  const planA = await mustCreate(corpusService, { type: "plan", title: "Plan A", content: "# A" } as CreateDocInput);
  const planB = await mustCreate(corpusService, { type: "plan", title: "Plan B", content: "# B" } as CreateDocInput);

  const oldHandoffA = await sessionService.writeHandoff({
    by: "alice",
    plan_ref: planA.slug,
    task_refs: [],
    modified_files: [],
    key_decisions: [],
    next_steps: ["continue A"],
  });
  if (!oldHandoffA.ok) throw new Error(JSON.stringify(oldHandoffA.error));

  const newHandoffA = await sessionService.writeHandoff({
    by: "alice",
    plan_ref: planA.slug,
    task_refs: [],
    modified_files: [],
    key_decisions: [],
    next_steps: ["continue A more"],
  });
  if (!newHandoffA.ok) throw new Error(JSON.stringify(newHandoffA.error));

  // planB's handoff is written LAST, so it is the corpus-global newest — the
  // differentiator every seat-scoped assertion below relies on.
  const handoffB = await sessionService.writeHandoff({
    by: "bob",
    plan_ref: planB.slug,
    task_refs: [],
    modified_files: [],
    key_decisions: [],
    next_steps: ["continue B"],
  });
  if (!handoffB.ok) throw new Error(JSON.stringify(handoffB.error));

  // reason: InMemoryStore's `created_at` is wall-clock (`new Date().toISOString()`),
  // whose millisecond resolution is coarser than three sequential awaits in a fast
  // test run — three handoffs written back-to-back can tie on the SAME millisecond
  // (observed empirically while authoring this fixture). Every assertion below
  // depends on a STRICT, unambiguous newest-handoff ordering, so pin `created_at`
  // explicitly via `store.update` (same technique session-bootstrap.test.ts's
  // multi-PRD STATE case already uses) rather than trusting real-clock spacing.
  const patchOldA = await store.update(oldHandoffA.value.id, { created_at: "2026-01-01T00:00:00.000Z" });
  if (!patchOldA.ok) throw new Error(JSON.stringify(patchOldA.error));
  const patchNewA = await store.update(newHandoffA.value.id, { created_at: "2026-01-10T00:00:00.000Z" });
  if (!patchNewA.ok) throw new Error(JSON.stringify(patchNewA.error));
  const patchB = await store.update(handoffB.value.id, { created_at: "2026-01-15T00:00:00.000Z" });
  if (!patchB.ok) throw new Error(JSON.stringify(patchB.error));

  return { store, corpusService, sessionService, planA, planB, newHandoffA: newHandoffA.value, handoffB: handoffB.value };
}

// ─── FROZEN BASELINE (REGRESSION — must stay byte-identical) ──────────────────

describe("SessionService.bootstrap — FROZEN BASELINE resume_hint (no seat arg, REGRESSION)", () => {
  it("with no seat argument, resume_hint is the corpus-global newest handoff — unchanged by SPEC-057", async () => {
    const { sessionService, planB, handoffB } = await buildTwoPlanCorpusWithHandoffs();

    const result = await sessionService.bootstrap("alice");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.resume_hint).toEqual({ plan_slug: planB.slug, handoff_slug: handoffB.slug });
  });

  it("an empty corpus with no seat argument still returns resume_hint: null", async () => {
    const store = new InMemoryStore();
    const { sessionService } = makeSessionService(store);
    const result = await sessionService.bootstrap("alice");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.resume_hint).toBeNull();
  });
});

// ─── Seat-scoped resume_hint (AC-S-3, RED) ─────────────────────────────────────

describe("SessionService.bootstrap — seat-scoped resume_hint (HAPPY, RED until seat param lands)", () => {
  it("a seat signal whose branch resolves to plan-a scopes resume_hint to plan-a's own newest handoff", async () => {
    const { sessionService, planA, newHandoffA } = await buildTwoPlanCorpusWithHandoffs();

    const result = await bootstrapWithSeat(sessionService)("alice", undefined, {
      branch: `plan/${planA.slug.replace(/^plan-/, "")}`,
      worktree: "/repo-seat-plan-a",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.resume_hint).toEqual({ plan_slug: planA.slug, handoff_slug: newHandoffA.slug });
  });

  it("task-worktree-under-seat: a seat signal whose worktree differs from the seat's own worktree path still scopes by branch alone (parent-seat resolution)", async () => {
    const { sessionService, planA, newHandoffA } = await buildTwoPlanCorpusWithHandoffs();

    // The hook/CLI layer resolves "which seat does this task worktree belong to"
    // via git-plumbing BEFORE calling bootstrap (core/seat.ts's
    // classifySessionLocation + parentSeatBranch, tested separately) — by the time
    // `seat` reaches SessionService, `branch` is ALREADY the resolved PARENT seat's
    // branch, even though `worktree` names a nested task worktree, not the seat's
    // own directory. bootstrap must resolve purely off `branch`.
    const result = await bootstrapWithSeat(sessionService)("alice", undefined, {
      branch: `plan/${planA.slug.replace(/^plan-/, "")}`,
      worktree: "/repo-seat-plan-a/.claude/worktrees/agent-task-under-seat",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.resume_hint).toEqual({ plan_slug: planA.slug, handoff_slug: newHandoffA.slug });
  });

  it("a seat-scoped plan with zero handoffs of its own returns resume_hint: null, never a corpus-global fallback", async () => {
    const store = new InMemoryStore();
    const { corpusService, sessionService } = makeSessionService(store);
    const emptyPlan = await mustCreate(corpusService, {
      type: "plan",
      title: "Handoff-less Plan",
      content: "# Empty",
    } as CreateDocInput);
    // A different plan DOES have a handoff, so a wrongly-unscoped implementation
    // would return it — the failure mode this case is designed to catch.
    const otherPlan = await mustCreate(corpusService, { type: "plan", title: "Other Plan", content: "# Other" } as CreateDocInput);
    const otherHandoff = await sessionService.writeHandoff({
      by: "carol",
      plan_ref: otherPlan.slug,
      task_refs: [],
      modified_files: [],
      key_decisions: [],
      next_steps: ["continue other"],
    });
    if (!otherHandoff.ok) throw new Error(JSON.stringify(otherHandoff.error));

    const result = await bootstrapWithSeat(sessionService)("alice", undefined, {
      branch: `plan/${emptyPlan.slug.replace(/^plan-/, "")}`,
      worktree: "/repo-seat-empty-plan",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.resume_hint).toBeNull();
  });
});

// ─── Detached / unresolvable seat branch (AC-S-3, RED) ─────────────────────────

describe("SessionService.bootstrap — unresolvable seat branch (ERROR/BOUNDARY, RED until seat param lands)", () => {
  it("a detached-HEAD synthetic branch label (not a plan/ pattern) falls back to corpus-global + seat_unresolved: true", async () => {
    const { sessionService, planB, handoffB } = await buildTwoPlanCorpusWithHandoffs();

    const result = await bootstrapWithSeat(sessionService)("alice", undefined, {
      branch: "worktree-abc1234",
      worktree: "/repo-detached",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.resume_hint).toEqual({ plan_slug: planB.slug, handoff_slug: handoffB.slug });
    expect(result.value.seat_unresolved).toBe(true);
  });

  it("a syntactically valid plan/ branch with no matching plan doc in the corpus also falls back with seat_unresolved: true", async () => {
    const { sessionService, planB, handoffB } = await buildTwoPlanCorpusWithHandoffs();

    const result = await bootstrapWithSeat(sessionService)("alice", undefined, {
      branch: "plan/nonexistent-slug-xyz",
      worktree: "/repo-seat-ghost",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.resume_hint).toEqual({ plan_slug: planB.slug, handoff_slug: handoffB.slug });
    expect(result.value.seat_unresolved).toBe(true);
  });
});

// ─── SPEC-080 service→projection seam: omitted-plan fixture (AC-080-2, STATE) ──
//
// `buildBootstrapInjection` (packages/core/src/session.ts) is a PURE projection
// downstream of `SessionService.bootstrap` — it caps `active_plans` for
// REPORTING but must never feed back into what the report itself derived
// (`active_sessions` is computed by `bootstrap` over EVERY active plan's
// tasks, before any injection cap applies). This fixture proves that by
// construction: 3 actionable plans (each with >=1 ready task), only the
// 3rd-newest-by-`last_activity_at` plan's task holds a fresh claim, and
// `maxActivePlans: 2` caps the projected `active_plans` to the 2 newest —
// dropping exactly the claim-holding plan from `payload.active_plans` while
// `payload.active_sessions` (untouched by the projection, per SPEC-080
// §Explicitly unchanged) still lists that claim's session.

describe("SessionService.bootstrap -> buildBootstrapInjection — omitted-plan fixture (STATE, AC-080-2)", () => {
  it("caps active_plans to maxActivePlans while active_sessions still lists the omitted plan's fresh claim", async () => {
    const store = new InMemoryStore();
    const { corpusService, sessionService } = makeSessionService(store);

    // Three actionable plans (each gets exactly one non-terminal task, which
    // is "ready" per evaluateReadiness regardless of claim state — same
    // technique the HAPPY fixture in session-bootstrap.test.ts uses).
    const planNewest = await mustCreate(corpusService, {
      type: "plan",
      title: "Plan Newest",
      content: "# Newest",
    } as CreateDocInput);
    const planMiddle = await mustCreate(corpusService, {
      type: "plan",
      title: "Plan Middle",
      content: "# Middle",
    } as CreateDocInput);
    const planOldest = await mustCreate(corpusService, {
      type: "plan",
      title: "Plan Oldest (claim holder)",
      content: "# Oldest",
    } as CreateDocInput);

    const taskNewest = await mustCreate(corpusService, {
      type: "task",
      title: "Ready Task Newest",
      parent_id: planNewest.id,
      content: "# T",
      extra: { plan_id: planNewest.id },
    } as CreateDocInput);
    const taskMiddle = await mustCreate(corpusService, {
      type: "task",
      title: "Ready Task Middle",
      parent_id: planMiddle.id,
      content: "# T",
      extra: { plan_id: planMiddle.id },
    } as CreateDocInput);
    const taskOldest = await mustCreate(corpusService, {
      type: "task",
      title: "Claimed Task Oldest",
      parent_id: planOldest.id,
      content: "# T",
      extra: { plan_id: planOldest.id },
    } as CreateDocInput);

    // Pin last_activity_at ordering explicitly via `updated_at`
    // (deriveLastActivityAt = max(updated_at) over a plan + its tasks) — same
    // explicit-timestamp-pinning technique buildTwoPlanCorpusWithHandoffs
    // above uses for created_at, needed because InMemoryStore's real-clock
    // timestamps are too coarse to guarantee a strict 3-way ordering across
    // sequential awaits in a fast test run.
    const NEWEST_AT = "2026-01-20T00:00:00.000Z";
    const MIDDLE_AT = "2026-01-15T00:00:00.000Z";
    const OLDEST_AT = "2026-01-10T00:00:00.000Z";

    const patchPlanNewest = await store.update(planNewest.id, { updated_at: NEWEST_AT });
    if (!patchPlanNewest.ok) throw new Error(JSON.stringify(patchPlanNewest.error));
    const patchTaskNewest = await store.update(taskNewest.id, { updated_at: NEWEST_AT });
    if (!patchTaskNewest.ok) throw new Error(JSON.stringify(patchTaskNewest.error));

    const patchPlanMiddle = await store.update(planMiddle.id, { updated_at: MIDDLE_AT });
    if (!patchPlanMiddle.ok) throw new Error(JSON.stringify(patchPlanMiddle.error));
    const patchTaskMiddle = await store.update(taskMiddle.id, { updated_at: MIDDLE_AT });
    if (!patchTaskMiddle.ok) throw new Error(JSON.stringify(patchTaskMiddle.error));

    const patchPlanOldest = await store.update(planOldest.id, { updated_at: OLDEST_AT });
    if (!patchPlanOldest.ok) throw new Error(JSON.stringify(patchPlanOldest.error));

    // The oldest (3rd-newest) plan's task holds the corpus's ONLY fresh
    // claim — `updated_at` stays pinned old for last_activity_at ordering
    // while `claim.at` is real "now" so the claim itself is not stale.
    const freshClaimAt = new Date().toISOString();
    const patchTaskOldest = await store.update(taskOldest.id, {
      updated_at: OLDEST_AT,
      extra: { plan_id: planOldest.id, claim: { by: "carol", at: freshClaimAt } },
    });
    if (!patchTaskOldest.ok) throw new Error(JSON.stringify(patchTaskOldest.error));

    const bootstrapResult = await sessionService.bootstrap("alice");
    expect(bootstrapResult.ok).toBe(true);
    if (!bootstrapResult.ok) return;
    const report = bootstrapResult.value;

    // Sanity on the report itself (pre-projection): all 3 plans actionable,
    // sorted newest-first, and active_sessions already carries the claim —
    // this is the "complete report" the projection must consume as-is.
    expect(report.active_plans).toHaveLength(3);
    expect(report.active_plans.map((p) => p.slug)).toEqual([planNewest.slug, planMiddle.slug, planOldest.slug]);
    expect(report.active_sessions.some((s) => s.task_slugs.includes(taskOldest.slug))).toBe(true);

    const { payload } = buildBootstrapInjection(report, {
      maxActivePlans: 2,
      maxHandoffs: 3,
      maxPendingSlugs: 3,
      charBudget: 8000,
    });

    // Projection caps active_plans to the 2 newest, dropping exactly the
    // claim-holding (3rd-newest) plan.
    expect(payload.active_plans).toHaveLength(2);
    expect(payload.active_plans.map((p) => p.slug)).toEqual([planNewest.slug, planMiddle.slug]);
    expect(payload.active_plans.some((p) => p.slug === planOldest.slug)).toBe(false);
    expect(payload.omitted.active_plans).toBe(1);

    // active_sessions is untouched by the projection (SPEC-080 §Explicitly
    // unchanged) — the omitted plan's claim/session is still fully present,
    // proving reporting caps never feed derivation.
    expect(payload.active_sessions).toEqual(report.active_sessions);
    expect(payload.active_sessions.some((s) => s.task_slugs.includes(taskOldest.slug))).toBe(true);
    const oldestSession = payload.active_sessions.find((s) => s.task_slugs.includes(taskOldest.slug));
    expect(oldestSession?.by).toBe("carol");
  });
});

// ─── SessionService.bootstrap — D3 derivation hygiene filter (AC-096-2) ────────
//
// spec-session-start-handoff-neutrality D3 — a handoff doc that is
// archived/deprecated, or invalidated per `extra.validity` (SPEC-043's
// `isInvalidated` SSOT predicate), must be excluded from BOTH
// `latest_handoffs` and `resume_hint` — the SAME single `handoffPairs`
// derivation site both fields build from, so archiving/invalidating a
// handoff is an effective cleanup action everywhere it surfaces.

describe("SessionService.bootstrap — D3 handoff derivation hygiene (archived/deprecated/invalidated exclusion, AC-096-2)", () => {
  it("NEGATIVE: an archived handoff doc is excluded from latest_handoffs and resume_hint", async () => {
    const store = new InMemoryStore();
    const { corpusService, sessionService } = makeSessionService(store);
    const plan = await mustCreate(corpusService, { type: "plan", title: "Plan Archived", content: "# P" } as CreateDocInput);
    const handoff = await sessionService.writeHandoff({
      by: "alice",
      plan_ref: plan.slug,
      task_refs: [],
      modified_files: [],
      key_decisions: [],
      next_steps: ["continue"],
    });
    if (!handoff.ok) throw new Error(JSON.stringify(handoff.error));

    const patched = await store.update(handoff.value.id, { status: "archived" });
    if (!patched.ok) throw new Error(JSON.stringify(patched.error));

    const result = await sessionService.bootstrap("alice");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.latest_handoffs).toEqual([]);
    expect(result.value.resume_hint).toBeNull();
  });

  it("NEGATIVE: a deprecated handoff doc is excluded from latest_handoffs and resume_hint", async () => {
    const store = new InMemoryStore();
    const { corpusService, sessionService } = makeSessionService(store);
    const plan = await mustCreate(corpusService, { type: "plan", title: "Plan Deprecated", content: "# P" } as CreateDocInput);
    const handoff = await sessionService.writeHandoff({
      by: "alice",
      plan_ref: plan.slug,
      task_refs: [],
      modified_files: [],
      key_decisions: [],
      next_steps: ["continue"],
    });
    if (!handoff.ok) throw new Error(JSON.stringify(handoff.error));

    const patched = await store.update(handoff.value.id, { status: "deprecated" });
    if (!patched.ok) throw new Error(JSON.stringify(patched.error));

    const result = await sessionService.bootstrap("alice");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.latest_handoffs).toEqual([]);
    expect(result.value.resume_hint).toBeNull();
  });

  it("NEGATIVE: a handoff doc invalidated via extra.validity.invalid_at is excluded from latest_handoffs and resume_hint", async () => {
    const store = new InMemoryStore();
    const { corpusService, sessionService } = makeSessionService(store);
    const plan = await mustCreate(corpusService, { type: "plan", title: "Plan Invalidated", content: "# P" } as CreateDocInput);
    const handoff = await sessionService.writeHandoff({
      by: "alice",
      plan_ref: plan.slug,
      task_refs: [],
      modified_files: [],
      key_decisions: [],
      next_steps: ["continue"],
    });
    if (!handoff.ok) throw new Error(JSON.stringify(handoff.error));

    // reason: `extra` is REPLACED wholesale by `store.update` (never merged) —
    // the existing handoff extra must be spread forward alongside the new
    // `validity` block, or `extractHandoffExtra` would stop recognizing this
    // doc as a handoff at all, making the D3 filter irrelevant to the outcome.
    const patched = await store.update(handoff.value.id, {
      extra: { ...handoff.value.extra, validity: { invalid_at: "2020-01-01T00:00:00.000Z" } },
    });
    if (!patched.ok) throw new Error(JSON.stringify(patched.error));

    const result = await sessionService.bootstrap("alice");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.latest_handoffs).toEqual([]);
    expect(result.value.resume_hint).toBeNull();
  });

  it("STATE: draft and approved handoffs are BOTH retained", async () => {
    const store = new InMemoryStore();
    const { corpusService, sessionService } = makeSessionService(store);
    const planDraft = await mustCreate(corpusService, { type: "plan", title: "Plan Draft Handoff", content: "# P" } as CreateDocInput);
    const planApproved = await mustCreate(corpusService, { type: "plan", title: "Plan Approved Handoff", content: "# P" } as CreateDocInput);

    const draftHandoff = await sessionService.writeHandoff({
      by: "alice",
      plan_ref: planDraft.slug,
      task_refs: [],
      modified_files: [],
      key_decisions: [],
      next_steps: ["continue draft"],
    });
    if (!draftHandoff.ok) throw new Error(JSON.stringify(draftHandoff.error));
    expect(draftHandoff.value.status).toBe("draft");

    const approvedHandoff = await sessionService.writeHandoff({
      by: "bob",
      plan_ref: planApproved.slug,
      task_refs: [],
      modified_files: [],
      key_decisions: [],
      next_steps: ["continue approved"],
    });
    if (!approvedHandoff.ok) throw new Error(JSON.stringify(approvedHandoff.error));
    const patched = await store.update(approvedHandoff.value.id, { status: "approved" });
    if (!patched.ok) throw new Error(JSON.stringify(patched.error));

    const result = await sessionService.bootstrap("alice");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const handoffSlugs = result.value.latest_handoffs.map((h) => h.handoff_slug);
    expect(handoffSlugs).toContain(draftHandoff.value.slug);
    expect(handoffSlugs).toContain(approvedHandoff.value.slug);
    expect(result.value.resume_hint).not.toBeNull();
  });

  it("BOUNDARY: an invalidated-then-undone handoff (extra.validity present, invalid_at absent) is retained", async () => {
    const store = new InMemoryStore();
    const { corpusService, sessionService } = makeSessionService(store);
    const plan = await mustCreate(corpusService, { type: "plan", title: "Plan Undone", content: "# P" } as CreateDocInput);
    const handoff = await sessionService.writeHandoff({
      by: "alice",
      plan_ref: plan.slug,
      task_refs: [],
      modified_files: [],
      key_decisions: [],
      next_steps: ["continue"],
    });
    if (!handoff.ok) throw new Error(JSON.stringify(handoff.error));

    // reason: ValidityService's `--undo` clears invalid_at/invalidated_by/reason
    // but KEEPS valid_at (module header, validity-service.ts D2) — this is that
    // post-undo shape, reproduced directly at the store layer.
    const patched = await store.update(handoff.value.id, {
      extra: { ...handoff.value.extra, validity: { valid_at: "2026-01-01T00:00:00.000Z" } },
    });
    if (!patched.ok) throw new Error(JSON.stringify(patched.error));

    const result = await sessionService.bootstrap("alice");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.latest_handoffs.map((h) => h.handoff_slug)).toContain(handoff.value.slug);
    expect(result.value.resume_hint).toEqual({ plan_slug: plan.slug, handoff_slug: handoff.value.slug });
  });

  it("REGRESSION: an archived/invalidated NON-handoff knowledge doc never participates in handoff derivation — a genuine handoff is unaffected", async () => {
    const store = new InMemoryStore();
    const { corpusService, sessionService } = makeSessionService(store);
    const plan = await mustCreate(corpusService, { type: "plan", title: "Plan With Genuine Handoff", content: "# P" } as CreateDocInput);
    const handoff = await sessionService.writeHandoff({
      by: "alice",
      plan_ref: plan.slug,
      task_refs: [],
      modified_files: [],
      key_decisions: [],
      next_steps: ["continue"],
    });
    if (!handoff.ok) throw new Error(JSON.stringify(handoff.error));

    // A plain (non-handoff) knowledge doc, archived AND invalidated — neither
    // condition should ever reach the handoff-derivation code path at all
    // (`extractHandoffExtra` already excludes it before D3's filter runs).
    const otherKnowledge = await mustCreate(corpusService, {
      type: "knowledge",
      title: "Unrelated reference doc",
      content: "# Unrelated",
      extra: { sub_type: "reference" },
    } as CreateDocInput);
    const archivedPatch = await store.update(otherKnowledge.id, {
      status: "archived",
      extra: { sub_type: "reference", validity: { invalid_at: "2020-01-01T00:00:00.000Z" } },
    });
    if (!archivedPatch.ok) throw new Error(JSON.stringify(archivedPatch.error));

    const result = await sessionService.bootstrap("alice");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.latest_handoffs.map((h) => h.handoff_slug)).toEqual([handoff.value.slug]);
    expect(result.value.resume_hint).toEqual({ plan_slug: plan.slug, handoff_slug: handoff.value.slug });
  });
});
