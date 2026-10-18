/**
 * Six-dimension tests for PhaseWorkflowService's evidence-triggered claim renewal
 * (SPEC-069 §Design Decisions D4/D5, F2 — parity with TaskWorkflowService, closes
 * window W3 on phase docs). Additive to phase-workflow-service.test.ts — kept as
 * its own file so this renewal-specific dimension stays isolated and easy to
 * locate; the pre-existing suite is exercised UNMODIFIED as a regression floor.
 *
 * Uses InMemoryStore — no file I/O, no SQLite. Phase docs are constructed via raw
 * `store.insert(...)` (mirrors phase-workflow-service.test.ts §4 — `type: "phase"`
 * is not wired into `schemas.ts`'s CreateDocInput validation).
 *
 * Dimension mapping:
 *   HAPPY:      same-holder evidence renews claim.at to the evidence's own
 *               recorded_at, in the SAME single CAS write (version delta === 1),
 *               audit details.claim_renewed === true
 *   NEGATIVE:   foreign-holder claim left byte-identical, no claim_renewed key
 *   BOUNDARY:   same-holder STALE claim (far past TTL) still renews on evidence
 *   ERROR:      STALE_VERSION sequential-CAS recipe (SPEC-025 §7) still rejects
 *               correctly with a same-holder claim in play — renewal never
 *               short-circuits the CAS guard, and a rejected write leaves
 *               extra.claim at its pre-call value (mirrors
 *               task-workflow-evidence-renewal.test.ts's identical recipe)
 *   STATE:      no claim held -> extra.claim stays absent after addEvidence
 *   REGRESSION: identical single-version-bump / foreign-holder-untouched
 *               assertions as TaskWorkflowService (parity requirement, D4)
 *
 * @spec_ref AC-069-5
 */

import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { PhaseWorkflowService } from "../../../src/service/phase-workflow-service.js";
import type { EvidenceInput } from "../../../src/service/task-workflow-service.js";
import { NoOpTelemetry } from "@lore/core";
import type { DocRecord, DocType, AuditEntry } from "@lore/core";
import { actedStore } from "../../live-invocation.js";

// ─── Fixtures (mirrors phase-workflow-service.test.ts's makeServices shape) ──

function makeServices(ttl = 120) {
  const store = actedStore(new InMemoryStore());
  const service = new PhaseWorkflowService(store, new NoOpTelemetry(), { claimTtlMinutes: ttl });
  return { store, service };
}

/** A minimal, valid, raw `phase` DocRecord — `type: "phase"` predates schemas.ts wiring. */
function makePhaseRecord(overrides: Partial<DocRecord> = {}): DocRecord {
  const base: DocRecord = {
    id: "01HPHASE00000000000000001",
    slug: "phase-one",
    type: "phase" as unknown as DocType,
    role: "plan",
    title: "Phase One",
    status: "draft",
    priority: "medium",
    content: "# Phase One",
    parent_id: "01HPLAN000000000000000000",
    created_at: "2026-07-19T00:00:00.000Z",
    updated_at: "2026-07-19T00:00:00.000Z",
    created_by: "system",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: { plan_id: "01HPLAN000000000000000000" },
  };
  return { ...base, ...overrides, extra: { ...base.extra, ...overrides.extra } };
}

/** A minimal, valid, raw `plan` DocRecord (parent of the phase fixtures). */
function makePlanRecord(overrides: Partial<DocRecord> = {}): DocRecord {
  const base: DocRecord = {
    id: "01HPLAN000000000000000000",
    slug: "plan-one",
    type: "plan",
    role: "plan",
    title: "Plan One",
    status: "approved",
    priority: "medium",
    content: "# Plan One",
    parent_id: null,
    created_at: "2026-07-19T00:00:00.000Z",
    updated_at: "2026-07-19T00:00:00.000Z",
    created_by: "system",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
  };
  return { ...base, ...overrides };
}

async function mustInsert(store: InMemoryStore, doc: DocRecord): Promise<DocRecord> {
  const result = await store.insert(doc);
  if (!result.ok) throw new Error(`insert failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

function evidence(overrides: Partial<EvidenceInput> = {}): EvidenceInput {
  return {
    oracle: "test",
    command: "bun test",
    result: "pass",
    recorded_by: "agent:p1",
    // reason: task-capture-source-is-optional-at-the-evidence-write-boundary —
    // now compile-time-required on EvidenceInput.
    capture_source: "self-report",
    ...overrides,
  };
}

// ─── HAPPY ────────────────────────────────────────────────────────────────────

describe("HAPPY — same-holder evidence renews the phase claim in one CAS write (AC-069-5)", () => {
  it("renews claim.at to the evidence's recorded_at, version delta === 1, audit details.claim_renewed === true", async () => {
    const { store, service } = makeServices();
    await mustInsert(store, makePlanRecord());
    await mustInsert(store, makePhaseRecord());

    const claimResult = await service.claim("phase-one", { by: "agent:p1" }, () => "2026-07-23T10:00:00.000Z");
    expect(claimResult.ok).toBe(true);
    if (!claimResult.ok) return;
    const versionBeforeEvidence = claimResult.value.version;

    const evidenceResult = await service.addEvidence(
      "phase-one",
      evidence(),
      () => "2026-07-23T11:00:00.000Z",
    );
    expect(evidenceResult.ok).toBe(true);
    if (!evidenceResult.ok) return;

    // Atomicity: evidence append + claim renewal is ONE write, not two.
    expect(evidenceResult.value.version).toBe(versionBeforeEvidence + 1);

    const claim = evidenceResult.value.extra["claim"] as Record<string, unknown>;
    const evidenceArr = evidenceResult.value.extra["verification_evidence"] as Array<Record<string, unknown>>;
    expect(claim.at).toBe("2026-07-23T11:00:00.000Z");
    expect(claim.by).toBe("agent:p1");
    expect(evidenceArr[0]?.["recorded_at"]).toBe(claim.at);

    const auditResult = await store.queryAudit({ doc_id: "01HPHASE00000000000000001", action: "evidence" });
    expect(auditResult.ok).toBe(true);
    if (!auditResult.ok) return;
    expect(auditResult.value).toHaveLength(1);
    const entry = auditResult.value[0] as AuditEntry;
    expect(entry.details?.["claim_renewed"]).toBe(true);
  });
});

// ─── NEGATIVE ─────────────────────────────────────────────────────────────────

describe("NEGATIVE — foreign-holder evidence leaves the phase claim untouched (AC-069-5)", () => {
  it("extra.claim stays byte-identical and audit details carry no claim_renewed key", async () => {
    const { store, service } = makeServices();
    await mustInsert(store, makePlanRecord());
    await mustInsert(store, makePhaseRecord());

    const claimResult = await service.claim("phase-one", { by: "agent:p1" }, () => "2026-07-23T10:00:00.000Z");
    expect(claimResult.ok).toBe(true);
    if (!claimResult.ok) return;
    const claimBefore = claimResult.value.extra["claim"];

    // "agent:p2" records evidence while "agent:p1" still holds the claim.
    const evidenceResult = await service.addEvidence(
      "phase-one",
      evidence({ recorded_by: "agent:p2" }),
      () => "2026-07-23T11:00:00.000Z",
    );
    expect(evidenceResult.ok).toBe(true);
    if (!evidenceResult.ok) return;
    expect(evidenceResult.value.extra["claim"]).toStrictEqual(claimBefore);

    const auditResult = await store.queryAudit({ doc_id: "01HPHASE00000000000000001", action: "evidence" });
    expect(auditResult.ok).toBe(true);
    if (!auditResult.ok) return;
    expect(auditResult.value).toHaveLength(1);
    const entry = auditResult.value[0] as AuditEntry;
    expect(entry.details?.["claim_renewed"]).toBeUndefined();
  });
});

// ─── BOUNDARY ─────────────────────────────────────────────────────────────────

describe("BOUNDARY — same-holder STALE phase claim still renews on evidence (AC-069-5, D5)", () => {
  it("a claim far past the TTL is still renewed when the SAME actor records evidence", async () => {
    const { store, service } = makeServices(120);
    await mustInsert(store, makePlanRecord());
    await mustInsert(store, makePhaseRecord());

    await service.claim("phase-one", { by: "agent:p1" }, () => "2026-01-01T00:00:00.000Z");

    // Far past any TTL — a foreign claimant would find this stale and claimable
    // without --steal, but the evidence recorder here IS the same holder.
    const evidenceResult = await service.addEvidence(
      "phase-one",
      evidence(),
      () => "2026-07-23T12:00:00.000Z",
    );
    expect(evidenceResult.ok).toBe(true);
    if (!evidenceResult.ok) return;
    const claim = evidenceResult.value.extra["claim"] as Record<string, unknown>;
    expect(claim.at).toBe("2026-07-23T12:00:00.000Z");
    expect(claim.by).toBe("agent:p1");
  });
});

// ─── STATE ────────────────────────────────────────────────────────────────────

describe("STATE — no claim held on the phase doc (AC-069-5)", () => {
  it("extra.claim stays absent after addEvidence, and audit details carry no claim_renewed key", async () => {
    const { store, service } = makeServices();
    await mustInsert(store, makePlanRecord());
    await mustInsert(store, makePhaseRecord());

    const evidenceResult = await service.addEvidence("phase-one", evidence());
    expect(evidenceResult.ok).toBe(true);
    if (!evidenceResult.ok) return;
    expect(evidenceResult.value.extra["claim"]).toBeUndefined();

    const auditResult = await store.queryAudit({ doc_id: "01HPHASE00000000000000001", action: "evidence" });
    expect(auditResult.ok).toBe(true);
    if (!auditResult.ok) return;
    const entry = auditResult.value[0] as AuditEntry;
    expect(entry.details?.["claim_renewed"]).toBeUndefined();
  });
});

// ─── ERROR — STALE_VERSION regression under the new renewal wiring ──────────

describe("ERROR — STALE_VERSION sequential-CAS recipe still rejects correctly with a same-holder phase claim in play (AC-069-5, REGRESSION)", () => {
  it("addEvidence surfaces STALE_VERSION and leaves extra.claim at its pre-call value when the write is rejected", async () => {
    const { store, service } = makeServices();
    await mustInsert(store, makePlanRecord());
    await mustInsert(store, makePhaseRecord());

    const claimResult = await service.claim("phase-one", { by: "agent:p1" }, () => "2026-07-23T10:00:00.000Z");
    expect(claimResult.ok).toBe(true);
    if (!claimResult.ok) return;
    const versionAfterClaim = claimResult.value.version;
    const claimBefore = claimResult.value.extra["claim"];

    let sideEffectApplied = false;
    // reason: `now()` fires AFTER resolvePhase() has captured phase.version (the CAS
    // expected_version) but BEFORE writePhaseExtra's store.update call — bumping the
    // doc's version here deterministically simulates a concurrent writer, per the
    // documented sequential-CAS recipe (SPEC-025 §7), mirroring
    // task-workflow-evidence-renewal.test.ts's identical recipe.
    const now = (): string => {
      if (!sideEffectApplied) {
        sideEffectApplied = true;
        void store.update(
          "01HPHASE00000000000000001",
          {
            extra: { plan_id: "01HPLAN000000000000000000", claim: claimBefore, injected_by_other_writer: true },
            version: versionAfterClaim + 1,
          },
          { expected_version: versionAfterClaim },
        );
      }
      return "2026-07-23T11:00:00.000Z";
    };

    // The SAME actor as the claim holder records evidence — renewClaimForEvidence
    // would produce a non-null renewal, but the CAS guard must still reject.
    const result = await service.addEvidence("phase-one", evidence(), now);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("STALE_VERSION");

    const docResult = await store.find("01HPHASE00000000000000001");
    expect(docResult.ok).toBe(true);
    if (!docResult.ok) return;
    expect(docResult.value?.extra["claim"]).toStrictEqual(claimBefore);
    expect(docResult.value?.extra["verification_evidence"]).toBeUndefined();
  });
});

// ─── REGRESSION — parity with TaskWorkflowService ────────────────────────────

describe("REGRESSION — phase renewal parity with TaskWorkflowService's own assertions (AC-069-5, D4)", () => {
  it("preserves branch/machine/worktree fields on the renewed phase claim", async () => {
    const { store, service } = makeServices();
    await mustInsert(store, makePlanRecord());
    await mustInsert(store, makePhaseRecord());

    await service.claim(
      "phase-one",
      { by: "agent:p1", branch: "feat/x", machine: "agents-mbp", worktree: "/repo/.worktrees/p1" },
      () => "2026-07-23T10:00:00.000Z",
    );

    const evidenceResult = await service.addEvidence(
      "phase-one",
      evidence(),
      () => "2026-07-23T11:00:00.000Z",
    );
    expect(evidenceResult.ok).toBe(true);
    if (!evidenceResult.ok) return;
    expect(evidenceResult.value.extra["claim"]).toMatchObject({
      by: "agent:p1",
      branch: "feat/x",
      machine: "agents-mbp",
      worktree: "/repo/.worktrees/p1",
    });
  });
});
