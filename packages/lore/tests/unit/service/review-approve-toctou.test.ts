/**
 * RED→GREEN suite for ASYNC2-002 (backend static-audit finding, medium severity) —
 * `ReviewService.approve`'s `plan-promote` gate is a cross-document TOCTOU: the
 * pre-write `enforceApprovalGate` call reads the plan's ANCESTOR spec (a DIFFERENT
 * row than the plan being approved), then the plan's own CAS write only guards
 * `expected_version` on the PLAN row. A concurrent edit to the ancestor spec landing
 * in the gap between the gate check and the CAS commit is invisible to that guard —
 * before the fix, `approve()` would commit the plan as "approved" despite the
 * ancestor spec having been un-approved (or its AC removed) in that exact window.
 *
 * Fix (review-service.ts): after the CAS write commits, `approve()` re-runs the
 * IDENTICAL `enforceApprovalGate` check against a FRESH ancestor-spec read (via the
 * SAME injected `getPlanBundle` port) — write-then-verify, mirroring BUG-011's
 * `TaskWorkflowService.claim()`/`rollbackClaim` precedent. A failure now self-rolls-
 * back the just-committed approval (CAS-guarded) and returns the SAME gate error a
 * pre-write rejection would have.
 *
 * Test technique: a thin `Proxy` around `InMemoryStore` intercepts ONLY the exact
 * `store.update(planId, {status: "approved", ...})` call `ReviewService.approve`
 * issues — the instant before that write lands, it independently revokes the
 * ancestor spec's approval via a raw `store.update` on the REAL underlying store
 * (simulating a second writer's concurrent `lore set <spec> --status draft` landing
 * in the gate-check-to-commit gap). `reviewService`'s `getPlanBundle` port is bound to
 * a `CorpusService` constructed over the SAME real (unwrapped) store, so it always
 * observes the CURRENT on-disk state — exactly the "fresh read" a real second writer
 * would produce. This exercises the real CAS-write code path (not a mocked gate
 * port), so it is unaffected by whether `approve()` re-checks 0, 1, or N times.
 *
 * Coverage dimensions: STATE (the race itself) / HAPPY (matched no-race pair) /
 * REGRESSION (existing review-service.test.ts approve/reject suite covers the
 * ungated, non-plan-promote paths — untouched by this fix, not re-asserted here).
 *
 * Source: ASYNC2-002 (dispatch bundle), task-workflow-service.ts's `claim()`/
 *   `rollbackClaim` (BUG-011) as the structural precedent.
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { LIVE_RULE_ID, seedLiveRule } from "../../helpers/live-rule-fixture.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { ReviewService } from "../../../src/service/review-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import type { ProvenanceWriteExtras, StoreInterface, UpdateOpts } from "../../../src/store/store-interface.js";
import type { AuditEntry, CreateDocInput, DocRecord, LoreError, Result, VersionRecord } from "@lore/core";
import { actedStore } from "../../live-invocation.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const AC = {
  id: "AC-1",
  statement: "the parser round-trips every fixture file",
  verify: { mode: "script" as const, oracle: "test" as const, command: "bun test parser.test.ts" },
  cites: [LIVE_RULE_ID],
};

async function mustCreate(cs: CorpusService, input: CreateDocInput): Promise<DocRecord> {
  const result = await cs.create(input);
  if (!result.ok) throw new Error(`create failed (test setup): ${JSON.stringify(result.error)}`);
  return result.value;
}

/**
 * Wraps `real` so that the FIRST `update(planId, {status: "approved", ...})` call
 * observed triggers a side-effect BEFORE delegating to the real store: it revokes
 * `specId`'s approval (status -> "draft") via a raw update on `real` itself. Every
 * other call (including subsequent calls matching the same shape) passes straight
 * through. This models a second writer's concurrent edit landing in the exact
 * gate-check-to-commit gap `ReviewService.approve`'s CAS write leaves open.
 */
function makeRacingStore(real: StoreInterface, planId: string, specId: string): StoreInterface {
  let armed = true;
  return new Proxy(real, {
    get(target, prop, receiver) {
      // reason: the approval commits through the write route's ONE `updateWithProvenance` transaction (AC-DCL-5), so
      // the racing writer lands in front of THAT call — the same gate-check-to-commit gap it always modelled.
      if (prop === "updateWithProvenance") {
        return async (
          id: string,
          patch: Partial<DocRecord>,
          opts: UpdateOpts | undefined,
          version: VersionRecord,
          audit: AuditEntry,
          extras?: ProvenanceWriteExtras,
        ): Promise<Result<DocRecord, LoreError>> => {
          if (armed && id === planId && patch.status === "approved") {
            armed = false;
            const specResult = await target.find(specId);
            if (specResult.ok && specResult.value !== null) {
              await target.update(
                specResult.value.id,
                { status: "draft" },
                { expected_version: specResult.value.version },
              );
            }
          }
          return target.updateWithProvenance(id, patch, opts, version, audit, extras);
        };
      }
      const value = Reflect.get(target, prop, receiver) as unknown;
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  }) as StoreInterface;
}

async function setupApprovedSpecAndDraftPlan(): Promise<{
  store: InMemoryStore;
  corpusService: CorpusService;
  enforcer: GateEnforcer;
  spec: DocRecord;
  plan: DocRecord;
}> {
  const store = actedStore(new InMemoryStore());
  await seedLiveRule(store);
  const enforcer = new GateEnforcer(undefined);
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)), undefined, undefined, enforcer);

  const prd = await mustCreate(corpusService, { type: "prd", title: "Root PRD", content: "# PRD" } as CreateDocInput);
  const specDraft = await mustCreate(corpusService, {
    type: "spec",
    title: "Feature spec",
    content: "## Overview\n\nBody.",
    extra: { spec_kind: "feature", acceptance_criteria: [AC] },
  } as CreateDocInput);
  const specApproved = await corpusService.set(specDraft.id, { status: "approved" });
  if (!specApproved.ok) throw new Error(`spec approve failed (setup): ${JSON.stringify(specApproved.error)}`);

  const plan = await mustCreate(corpusService, {
    type: "plan",
    title: "Implementation plan",
    parent_id: specApproved.value.id,
    content: "## Plan\n\nbody",
  } as CreateDocInput);

  return { store, corpusService, enforcer, spec: specApproved.value, plan };
}

// ─── STATE: the race itself ───────────────────────────────────────────────────

describe("ASYNC2-002 — ReviewService.approve plan-promote TOCTOU", () => {
  it("self-rolls-back a plan approval when the ancestor spec is un-approved between the gate check and the CAS write", async () => {
    const { store, corpusService, enforcer, spec, plan } = await setupApprovedSpecAndDraftPlan();

    const racingStore = makeRacingStore(store, plan.id, spec.id);
    const reviewService = new ReviewService(racingStore, new RecordLockService(racingStore, new GateEnforcer(undefined)), undefined, {
      enforcer,
      getPlanBundle: corpusService.getPlanBundle.bind(corpusService),
    });

    const result = await reviewService.approve(plan.id, { reviewer: "carol" });

    // The invalidated prerequisite must be caught — approve() must NOT report success.
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
      expect((result.error as { field?: string }).field).toBe("gate:plan-promote");
    }

    // The plan must be observably rolled back to its pre-approval status, NOT left
    // "approved" against the now-invalidated (un-approved) ancestor spec.
    const freshPlan = await store.find(plan.id);
    expect(freshPlan.ok).toBe(true);
    if (freshPlan.ok && freshPlan.value !== null) {
      expect(freshPlan.value.status).toBe("draft");
    }
  });

  it("records a rollback version+audit entry documenting the self-rollback", async () => {
    const { store, corpusService, enforcer, spec, plan } = await setupApprovedSpecAndDraftPlan();

    const racingStore = makeRacingStore(store, plan.id, spec.id);
    const reviewService = new ReviewService(racingStore, new RecordLockService(racingStore, new GateEnforcer(undefined)), undefined, {
      enforcer,
      getPlanBundle: corpusService.getPlanBundle.bind(corpusService),
    });

    await reviewService.approve(plan.id, { reviewer: "carol" });

    const versionsResult = await store.findVersions(plan.id);
    expect(versionsResult.ok).toBe(true);
    if (!versionsResult.ok) return;
    // version 1: plan creation (CorpusService.create); version 2: the
    // (later-reverted) approve; version 3: the self-rollback.
    const byVersion = [...versionsResult.value].sort((a, b) => a.version - b.version);
    expect(byVersion.map((v) => v.action)).toEqual(["create", "approve", "reject"]);

    const auditResult = await store.queryAudit({ doc_id: plan.id });
    expect(auditResult.ok).toBe(true);
    if (!auditResult.ok) return;
    const rollbackEntry = auditResult.value.find((a) => a.details?.["rollback"] === true);
    expect(rollbackEntry).toBeDefined();
    expect(rollbackEntry?.action).toBe("reject");
  });

  // ── HAPPY: matched no-race pair — byte-identical to pre-fix behavior ────────
  it("matched pair: the SAME setup with no concurrent edit approves normally (no rollback, no extra rows)", async () => {
    const { store, corpusService, enforcer, plan } = await setupApprovedSpecAndDraftPlan();

    const reviewService = new ReviewService(store, new RecordLockService(store, new GateEnforcer(undefined)), undefined, {
      enforcer,
      getPlanBundle: corpusService.getPlanBundle.bind(corpusService),
    });

    const result = await reviewService.approve(plan.id, { reviewer: "carol" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("approved");

    const versionsResult = await store.findVersions(plan.id);
    expect(versionsResult.ok).toBe(true);
    if (!versionsResult.ok) return;
    // version 1: plan creation; version 2: the approve — no rollback row.
    const byVersion = [...versionsResult.value].sort((a, b) => a.version - b.version);
    expect(byVersion.map((v) => v.action)).toEqual(["create", "approve"]);

    const auditResult = await store.queryAudit({ doc_id: plan.id });
    expect(auditResult.ok).toBe(true);
    if (!auditResult.ok) return;
    expect(auditResult.value.map((a) => a.action).sort()).toEqual(["approve", "create"]);
  });

  // ── REGRESSION: a spec approval is unaffected — no ancestor to race against ──
  it("REGRESSION: a spec's own approve() never invokes getPlanBundle (spec-promote reads only its own row)", async () => {
    const store = actedStore(new InMemoryStore());
    await seedLiveRule(store);
    const enforcer = new GateEnforcer(undefined);
    const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)), undefined, undefined, enforcer);

    const prd = await mustCreate(corpusService, { type: "prd", title: "Root PRD", content: "# PRD" } as CreateDocInput);
    const specDraft = await mustCreate(corpusService, {
      type: "spec",
      title: "Feature spec",
      content: "## Overview\n\nBody.",
      extra: { spec_kind: "feature", acceptance_criteria: [AC] },
    } as CreateDocInput);

    let getPlanBundleCalls = 0;
    const reviewService = new ReviewService(store, new RecordLockService(store, new GateEnforcer(undefined)), undefined, {
      enforcer,
      getPlanBundle: async (id: string) => {
        getPlanBundleCalls += 1;
        return corpusService.getPlanBundle(id);
      },
    });

    const result = await reviewService.approve(specDraft.id, { reviewer: "carol" });
    expect(result.ok).toBe(true);
    expect(getPlanBundleCalls).toBe(0);
  });
});
