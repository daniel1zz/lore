/**
 * Unit suite for `buildPhaseStatusPayload`
 * (`packages/lore/src/flows/phase-status-flow.ts`, SPEC-056
 * task-skill-implement-cli-mcp-surfaces-checklist-ref-evidence).
 *
 * Exercises the pure orchestration function against FAKE `PhaseStatusFlowDeps`
 * (mirrors `phase-feed-flow.test.ts`'s "narrow deps, plain fakes, no real store"
 * precedent — no `InMemoryStore` needed) — `getPhase`/`getPlanBundle` are hand-built
 * closures returning canned `DocRecord`/`PlanBundle` values, so this suite proves the
 * SCORECARD ASSEMBLY (AC coverage aggregation, checklist blocking/satisfied counts,
 * exit-code mapping) without re-testing `computeAcCoverage`/`computePhaseCompletion`
 * themselves (already covered by `acceptance.test.ts`/`phase-completion.test.ts`).
 *
 * Six-dimension coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.
 *
 * Source: spec-spec-056-phase-execution-model-phase-doc-type-computed-comp
 *   §Design Decisions D3; task-skill-implement-cli-mcp-surfaces-checklist-ref-evidence
 */

import { describe, it, expect } from "vitest";
import { ok, err } from "@lore/core";
import type { DocRecord, LoreError, PlanBundle, Result } from "@lore/core";
import {
  buildPhaseStatusPayload,
  type PhaseStatusFlowDeps,
} from "../../../src/flows/phase-status-flow.js";

const NOW = "2026-07-19T10:00:00.000Z";

function fakeDoc(overrides: Partial<DocRecord> & { id: string; title: string; type: DocRecord["type"] }): DocRecord {
  return {
    slug: `doc-${overrides.id}`,
    role: "plan",
    status: "draft",
    priority: "medium",
    content: "body",
    parent_id: null,
    created_at: NOW,
    updated_at: NOW,
    created_by: "test",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
    ...overrides,
  };
}

function samplePlan(): DocRecord {
  return { ...fakeDoc({ id: "plan-1", title: "Implementation Plan", type: "plan" }), slug: "plan-implementation" };
}

function sampleSpec(): DocRecord {
  return {
    ...fakeDoc({ id: "spec-1", title: "Spec One", type: "spec" }),
    slug: "spec-one",
    status: "approved",
    extra: {
      acceptance_criteria: [
        {
          id: "AC-1",
          statement: "does the thing",
          verify: { mode: "script", oracle: "test", command: "bun test" },
        },
        {
          id: "AC-2",
          statement: "does another thing",
          verify: { mode: "script", oracle: "test", command: "bun test 2" },
        },
      ],
    },
  };
}

/** A phase doc carrying `ac_ref: "AC-1"` attested-pass evidence + a satisfied manual checklist item. */
function doneCasePhase(): DocRecord {
  return {
    ...fakeDoc({ id: "phase-1", title: "Backend slice", type: "phase" }),
    slug: "phase-backend-slice",
    parent_id: "plan-1",
    extra: {
      plan_id: "plan-1",
      ac_scope: ["AC-1"],
      checklist: [
        {
          id: "CHK-1",
          statement: "manual smoke test passes",
          bind: { kind: "manual" },
          checked: { by: "alice", at: NOW },
        },
      ],
      verification_evidence: [
        {
          oracle: "test",
          command: "bun test",
          result: "pass",
          recorded_at: NOW,
          recorded_by: "lore-cli",
          ac_ref: "AC-1",
          attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 10, timed_out: false },
        },
      ],
    },
  };
}

function makeDeps(overrides: Partial<PhaseStatusFlowDeps> = {}): PhaseStatusFlowDeps {
  return {
    getPhase: async () => ok(doneCasePhase()),
    getPlanBundle: async (): Promise<Result<PlanBundle, LoreError>> =>
      ok({ plan: samplePlan(), spec: sampleSpec(), tasks: [] }),
    claimTtlMinutes: 120,
    ...overrides,
  };
}

// ─── HAPPY ──────────────────────────────────────────────────────────────────

describe("buildPhaseStatusPayload — HAPPY", () => {
  it("renders a done scorecard: attested AC + satisfied checklist, exit_code 0", async () => {
    const result = await buildPhaseStatusPayload(makeDeps(), "phase-backend-slice", NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state).toBe("done");
    expect(result.value.ac_scope).toEqual({ total: 1, attested: 1, blocking: [] });
    expect(result.value.checklist).toMatchObject({ total: 1, satisfied: 1, blocking: [], dropped_named: [] });
    expect(result.value.checklist.manual_selfattested).toEqual(["CHK-1"]);
    expect(result.value.blocking).toEqual([]);
    expect(result.value.exit_code).toBe(0);
    expect(result.value.plan_slug).toBe("plan-implementation");
    expect(result.value.phase_slug).toBe("phase-backend-slice");
  });

  it("reports a fresh (non-stale) claim", async () => {
    const claim = { by: "agent:p1", at: NOW };
    const phase = { ...doneCasePhase(), extra: { ...doneCasePhase().extra, claim } };
    const result = await buildPhaseStatusPayload(
      makeDeps({ getPhase: async () => ok(phase) }),
      "phase-backend-slice",
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.claim).toEqual({ by: "agent:p1", at: NOW, stale: false });
  });
});

// ─── NEGATIVE ───────────────────────────────────────────────────────────────

describe("buildPhaseStatusPayload — NEGATIVE", () => {
  it("a script AC pass with NO attestation (self-reported only) does not satisfy ac_scope", async () => {
    const phase = doneCasePhase();
    (phase.extra["verification_evidence"] as unknown[])[0] = {
      oracle: "test",
      command: "bun test",
      result: "pass",
      recorded_at: NOW,
      recorded_by: "alice",
      ac_ref: "AC-1",
      // no attestation — self-reported
    };
    const result = await buildPhaseStatusPayload(
      makeDeps({ getPhase: async () => ok(phase) }),
      "phase-backend-slice",
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ac_scope).toEqual({ total: 1, attested: 0, blocking: ["AC-1"] });
    expect(result.value.state).not.toBe("done");
  });

  it("wrong doc type (not a phase) → VALIDATION_ERROR", async () => {
    const notPhase = { ...doneCasePhase(), type: "task" as DocRecord["type"] };
    const result = await buildPhaseStatusPayload(
      makeDeps({ getPhase: async () => ok(notPhase) }),
      "not-a-phase",
      NOW,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });
});

// ─── BOUNDARY ───────────────────────────────────────────────────────────────

describe("buildPhaseStatusPayload — BOUNDARY", () => {
  it("empty ac_scope + all-dropped checklist → vacuous, exit_code 2 (distinct from done)", async () => {
    const phase: DocRecord = {
      ...doneCasePhase(),
      extra: {
        plan_id: "plan-1",
        ac_scope: [],
        checklist: [
          {
            id: "CHK-1",
            statement: "obsolete check",
            bind: { kind: "manual" },
            dropped: { by: "alice", at: NOW, reason: "no longer relevant" },
          },
        ],
        verification_evidence: [],
      },
    };
    const result = await buildPhaseStatusPayload(
      makeDeps({ getPhase: async () => ok(phase) }),
      "phase-backend-slice",
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state).toBe("vacuous");
    expect(result.value.exit_code).toBe(2);
    expect(result.value.checklist.dropped_named).toEqual(["CHK-1"]);
  });

  it("not-done (pending, no claim) → exit_code 1", async () => {
    const phase: DocRecord = {
      ...doneCasePhase(),
      extra: {
        plan_id: "plan-1",
        ac_scope: ["AC-1", "AC-2"],
        checklist: [],
        verification_evidence: [
          {
            oracle: "test",
            command: "bun test",
            result: "pass",
            recorded_at: NOW,
            recorded_by: "lore-cli",
            ac_ref: "AC-1",
            attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 10, timed_out: false },
          },
        ],
      },
    };
    const result = await buildPhaseStatusPayload(
      makeDeps({ getPhase: async () => ok(phase) }),
      "phase-backend-slice",
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state).toBe("pending");
    expect(result.value.exit_code).toBe(1);
    expect(result.value.ac_scope.blocking).toEqual(["AC-2"]);
  });
});

// ─── ERROR ──────────────────────────────────────────────────────────────────

describe("buildPhaseStatusPayload — ERROR", () => {
  it("deps.getPhase failing is FATAL — propagated verbatim", async () => {
    const notFound: LoreError = { code: "DOC_NOT_FOUND", id: "phase-missing" };
    const result = await buildPhaseStatusPayload(
      makeDeps({ getPhase: async () => err(notFound) }),
      "phase-missing",
      NOW,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual(notFound);
  });

  it("a phase with no parent plan → VALIDATION_ERROR, no getPlanBundle call", async () => {
    const orphan = { ...doneCasePhase(), parent_id: null };
    let getPlanBundleCalled = false;
    const result = await buildPhaseStatusPayload(
      makeDeps({
        getPhase: async () => ok(orphan),
        getPlanBundle: async () => {
          getPlanBundleCalled = true;
          return ok({ plan: samplePlan(), tasks: [] });
        },
      }),
      "phase-backend-slice",
      NOW,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(getPlanBundleCalled).toBe(false);
  });

  it("deps.getPlanBundle failing is FATAL — propagated verbatim", async () => {
    const storeError: LoreError = { code: "STORE_ERROR", message: "boom" };
    const result = await buildPhaseStatusPayload(
      makeDeps({ getPlanBundle: async () => err(storeError) }),
      "phase-backend-slice",
      NOW,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual(storeError);
  });
});

// ─── STATE ──────────────────────────────────────────────────────────────────

describe("buildPhaseStatusPayload — STATE", () => {
  it("a stale claim (age > TTL) reports stale: true and does not force 'active'", async () => {
    const staleClaim = { by: "agent:p1", at: "2026-07-19T00:00:00.000Z" }; // 10h before NOW
    const phase = {
      ...doneCasePhase(),
      extra: {
        plan_id: "plan-1",
        ac_scope: ["AC-1"],
        checklist: [],
        verification_evidence: [],
        claim: staleClaim,
      },
    };
    const result = await buildPhaseStatusPayload(
      makeDeps({ getPhase: async () => ok(phase), claimTtlMinutes: 120 }),
      "phase-backend-slice",
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.claim).toEqual({ by: "agent:p1", at: staleClaim.at, stale: true });
    expect(result.value.state).toBe("pending");
  });

  it("no spec ancestor (plan-only bundle) → criteria=[], acScope entries never satisfied", async () => {
    const phase = doneCasePhase();
    const result = await buildPhaseStatusPayload(
      makeDeps({ getPlanBundle: async () => ok({ plan: samplePlan(), tasks: [] }) }),
      "phase-backend-slice",
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ac_scope).toEqual({ total: 1, attested: 0, blocking: ["AC-1"] });
    void phase;
  });
});

// ─── REGRESSION ─────────────────────────────────────────────────────────────

describe("buildPhaseStatusPayload — REGRESSION", () => {
  it("deterministic for identical deps+args — same output on repeated calls", async () => {
    const deps = makeDeps();
    const a = await buildPhaseStatusPayload(deps, "phase-backend-slice", NOW);
    const b = await buildPhaseStatusPayload(deps, "phase-backend-slice", NOW);
    expect(a).toEqual(b);
  });
});
