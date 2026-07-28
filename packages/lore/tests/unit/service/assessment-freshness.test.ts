/**
 * Tests for SPEC-106 — the `assessmentFreshness` predicate on the EXISTING `plan-close`
 * checkpoint (SPEC-054/069's home, `checkpoint-registry.ts::checkPlanClose`): a plan's
 * → archived TRANSITION is DENIED when its newest linked assessment doc predates
 * `evidence`/`done` AUDIT-row activity on its own tasks (D2 — audit rows, never doc
 * `updated_at`) — unless the plan declares `extra.assessment_freshness_exempt: true`
 * plus a non-empty `extra.assessment_freshness_exempt_reason` (D4, mirrors
 * `attestation_exempt`'s flag+reason shape exactly). Vacuous pass when the plan has no
 * linked assessment at all, or no evidence/done task activity at all (D5).
 *
 * Also covers `CorpusService.getAssessmentFreshness` — the shared read `lore assess`'s
 * own non-blocking staleness advisory and this gate both consult (one computation,
 * never two).
 *
 * Deterministic, zero-LLM — no AI provider anywhere on this path. Mirrors
 * `attestation-floor.test.ts`'s harness shape (InMemoryStore + GateEnforcer +
 * CorpusService, real service-layer gating — no bare-predicate-only shortcuts) for the
 * plan-close integration suite, plus a direct pure-predicate suite (mirrors
 * `gate-predicates.test.ts`'s style) for the raw comparison logic.
 *
 * Every fixture plan below pre-declares a VALID `attestation_exempt` (SPEC-069) so the
 * pre-existing `attestationFloor` predicate never also fires alongside
 * `assessmentFreshness` in the isolation-focused suites — this keeps each AC's
 * assertion pinned to ONE failing predicate's `field`/message, not an ambiguous mix.
 * A dedicated REGRESSION suite at the bottom deliberately leaves attestation
 * unexempted to prove the two predicates compose correctly when both fail together.
 *
 * Six-dimension coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.
 *
 * Source: spec-assessment-freshness-plan-close-denies-a-stale-assessment
 *   §Acceptance Criteria AC-FRESH-1, AC-FRESH-2, AC-FRESH-3, AC-FRESH-5; §Design
 *   Decisions D1-D5.
 */

import { describe, it, expect } from "vitest";
import { ulid } from "ulidx";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import {
  assessmentFreshness,
  ASSESSMENT_STALE_REASON,
  ASSESSMENT_FRESHNESS_FIELD,
} from "../../../src/service/gate-predicates.js";
import { DOC_TYPE_ROLE_MAP } from "@lore/core";
import type { CreateDocInput, DocId, DocRecord, LoreConfig } from "@lore/core";

// ─── Pure predicate — direct unit tests (mirrors gate-predicates.test.ts's style) ──

describe("assessmentFreshness (pure predicate)", () => {
  // HAPPY — task activity landed strictly BEFORE the newest assessment.
  it("passes when the newest assessment postdates the newest task activity", () => {
    expect(
      assessmentFreshness("2026-07-28T12:23:00.000Z", "2026-07-28T11:52:00.000Z"),
    ).toEqual({ ok: true });
  });

  // NEGATIVE — task activity landed strictly AFTER the newest assessment.
  it("fails with ASSESSMENT_STALE/assessment-freshness when task activity postdates the assessment", () => {
    expect(
      assessmentFreshness("2026-07-28T11:52:00.000Z", "2026-07-28T12:23:00.000Z"),
    ).toEqual({ ok: false, reason: ASSESSMENT_STALE_REASON, field: ASSESSMENT_FRESHNESS_FIELD });
  });

  // BOUNDARY — exactly equal timestamps: NOT strictly after, so this must PASS.
  it("passes on an EXACTLY equal timestamp (strict > comparison, not >=)", () => {
    const t = "2026-07-28T12:00:00.000Z";
    expect(assessmentFreshness(t, t)).toEqual({ ok: true });
  });

  // BOUNDARY (D5, AC-FRESH-2) — vacuous pass from missing data, every combination.
  it("passes vacuously when either or both inputs are undefined — never invents a denial from missing data", () => {
    expect(assessmentFreshness(undefined, "2026-07-28T12:00:00.000Z")).toEqual({ ok: true });
    expect(assessmentFreshness("2026-07-28T12:00:00.000Z", undefined)).toEqual({ ok: true });
    expect(assessmentFreshness(undefined, undefined)).toEqual({ ok: true });
  });
});

// ─── Fixture helpers (mirrors attestation-floor.test.ts's harness shape) ──────

function makeHarness(config?: LoreConfig) {
  const store = new InMemoryStore();
  const enforcer = new GateEnforcer(config);
  const corpusService = new CorpusService(store, undefined, undefined, enforcer);
  const taskWorkflow = new TaskWorkflowService(store, undefined, { claimTtlMinutes: 120 });
  return { store, corpusService, taskWorkflow };
}

async function mustCreate(cs: CorpusService, input: CreateDocInput): Promise<DocRecord> {
  const result = await cs.create(input);
  if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

/**
 * A VALID attestation exemption (SPEC-069) — spread onto every fixture plan's `extra`
 * in the isolation-focused suites below so `attestationFloor` never ALSO fires
 * alongside `assessmentFreshness`, keeping each assertion pinned to one predicate.
 */
const ATTESTATION_EXEMPT_EXTRA = {
  attestation_exempt: true,
  attestation_exempt_reason: "isolating the assessment-freshness predicate under test",
  attestation_exempt_kind: "no-oracle",
};

/** Creates a plan, already promoted to `approved` (a valid single-hop → `archived` transition). */
async function makeApprovedPlan(
  cs: CorpusService,
  extra: Record<string, unknown> = {},
  isolateAttestation = true,
): Promise<DocRecord> {
  const created = await mustCreate(cs, {
    type: "plan",
    title: "Test plan",
    content: "## Plan\n\nbody",
    extra: { ...(isolateAttestation ? ATTESTATION_EXEMPT_EXTRA : {}), ...extra },
  } as CreateDocInput);
  const approved = await cs.set(created.id, { status: "approved" });
  if (!approved.ok) throw new Error(`plan approve failed (setup): ${JSON.stringify(approved.error)}`);
  return approved.value;
}

async function makeTask(cs: CorpusService, plan: DocRecord, title: string): Promise<DocRecord> {
  return mustCreate(cs, {
    type: "task",
    title,
    parent_id: plan.id,
    content: "## Task\n\nbody",
    extra: { plan_id: plan.id },
  } as CreateDocInput);
}

/**
 * Directly inserts a `knowledge` doc (sub_type="assessment") with an EXACT, caller-chosen
 * `created_at` — bypasses `lore assess`'s real AI-judge write path entirely (mirrors
 * `link-provenance.test.ts`'s `insertRawDoc` "bypass service, construct exact fixture"
 * precedent) so this suite can pin freshness timestamps deterministically rather than
 * relying on real-wall-clock ordering between two sequential creates. Linked to `plan`
 * via `informs`, exactly as `commands/assess.ts` does for a real run.
 */
async function insertAssessmentDoc(
  store: InMemoryStore,
  cs: CorpusService,
  plan: DocRecord,
  createdAt: string,
): Promise<DocRecord> {
  const id = ulid() as DocId;
  const doc: DocRecord = {
    id,
    slug: `knowledge-assessment-fixture-${id.slice(-6).toLowerCase()}`,
    type: "knowledge",
    role: DOC_TYPE_ROLE_MAP["knowledge"],
    title: "Assessment fixture",
    status: "approved",
    priority: "medium",
    content: "Assessment fixture body.",
    parent_id: plan.id,
    created_at: createdAt,
    updated_at: createdAt,
    created_by: "test",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {
      sub_type: "assessment",
      assessment: {
        scope: { type: "plan", id: plan.id },
        verdict: "met",
        overall_score: 88,
        ac_scores: [],
        gaps: [],
        recommendations: [],
        judgment: { provider: "claude-cli", prompt_version: 1, duration_ms: 3000, retried: false, truncated: [] },
      },
    },
  };
  const inserted = await store.insert(doc);
  if (!inserted.ok) throw new Error(`insertAssessmentDoc failed: ${JSON.stringify(inserted.error)}`);
  const linked = await cs.link(inserted.value.id, plan.id, "informs");
  if (!linked.ok) throw new Error(`assessment link failed: ${JSON.stringify(linked.error)}`);
  return inserted.value;
}

/** Appends one self-reported `pass` evidence entry at an EXACT, caller-chosen timestamp
 *  via the real `TaskWorkflowService.addEvidence` write path — genuinely produces an
 *  `action: "evidence"` AUDIT row (D2), not just an `extra.verification_evidence` array
 *  entry. */
async function recordEvidenceAt(
  tw: TaskWorkflowService,
  task: DocRecord,
  atIso: string,
): Promise<DocRecord> {
  const result = await tw.addEvidence(
    task.id,
    { oracle: "test", command: "bun test", result: "pass", recorded_by: "agent:t" },
    () => atIso,
  );
  if (!result.ok) throw new Error(`addEvidence failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

/** Reads back the plan's current version+status via a fresh `get` (helper used post-archive). */
async function archivePlan(cs: CorpusService, plan: DocRecord) {
  return cs.set(plan.id, { status: "archived" });
}

// ─── CorpusService.getAssessmentFreshness — STATE + ERROR ────────────────────

describe("CorpusService.getAssessmentFreshness", () => {
  it("STATE: resolves undefined/undefined with no assessment and no task activity, then updates as each fact appears", async () => {
    const { store, corpusService, taskWorkflow } = makeHarness();
    const plan = await makeApprovedPlan(corpusService);
    const task = await makeTask(corpusService, plan, "Freshness-state task");

    const initial = await corpusService.getAssessmentFreshness(plan.id);
    expect(initial.ok).toBe(true);
    if (initial.ok) {
      expect(initial.value.newestAssessmentAt).toBeUndefined();
      expect(initial.value.newestTaskActivityAt).toBeUndefined();
    }

    const assessment1 = await insertAssessmentDoc(store, corpusService, plan, "2026-07-28T10:00:00.000Z");
    const afterAssessment = await corpusService.getAssessmentFreshness(plan.id);
    expect(afterAssessment.ok).toBe(true);
    if (afterAssessment.ok) {
      expect(afterAssessment.value.newestAssessmentAt).toBe(assessment1.created_at);
      expect(afterAssessment.value.newestTaskActivityAt).toBeUndefined();
    }

    await recordEvidenceAt(taskWorkflow, task, "2026-07-28T11:00:00.000Z");
    const afterEvidence = await corpusService.getAssessmentFreshness(plan.id);
    expect(afterEvidence.ok).toBe(true);
    if (afterEvidence.ok) {
      expect(afterEvidence.value.newestAssessmentAt).toBe("2026-07-28T10:00:00.000Z");
      expect(afterEvidence.value.newestTaskActivityAt).toBe("2026-07-28T11:00:00.000Z");
    }

    const assessment2 = await insertAssessmentDoc(store, corpusService, plan, "2026-07-28T12:00:00.000Z");
    const afterSecondAssessment = await corpusService.getAssessmentFreshness(plan.id);
    expect(afterSecondAssessment.ok).toBe(true);
    if (afterSecondAssessment.ok) {
      // the NEWEST linked assessment wins, not the first-created one.
      expect(afterSecondAssessment.value.newestAssessmentAt).toBe(assessment2.created_at);
      expect(afterSecondAssessment.value.newestAssessmentAt).not.toBe(assessment1.created_at);
    }
  });

  // ERROR — an unresolvable plan reference propagates as a real error, not a silent facts object.
  it("ERROR: an unresolvable plan id/slug returns DOC_NOT_FOUND", async () => {
    const { corpusService } = makeHarness();
    const result = await corpusService.getAssessmentFreshness("plan-does-not-exist-at-all");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("DOC_NOT_FOUND");
    }
  });
});

// ─── AC-FRESH-1: stale assessment denies plan-close ──────────────────────────

describe("plan-close — AC-FRESH-1: a stale assessment denies archive", () => {
  it("AC-FRESH-1: denies when newest evidence audit timestamp is newer than the newest linked assessment; feeding pack names the exact lore assess re-run command", async () => {
    const { store, corpusService, taskWorkflow } = makeHarness();
    const plan = await makeApprovedPlan(corpusService);
    const task = await makeTask(corpusService, plan, "Task with post-assessment activity");
    await insertAssessmentDoc(store, corpusService, plan, "2026-07-28T11:52:00.000Z");
    await recordEvidenceAt(taskWorkflow, task, "2026-07-28T12:23:00.000Z");

    const result = await archivePlan(corpusService, plan);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
      expect((result.error as { field?: string }).field).toBe("gate:plan-close:assessment-freshness");
      const message = (result.error as { message?: string }).message ?? "";
      // The feeding pack names the EXACT re-run command, not a paraphrase.
      expect(message).toContain(`lore assess ${plan.slug}`);
      expect(message).toContain("2026-07-28T11:52:00.000Z");
      expect(message).toContain("2026-07-28T12:23:00.000Z");
    }
  });
});

// ─── AC-FRESH-2: a newer assessment unblocks; no assessment / no activity is vacuous ──

describe("plan-close — AC-FRESH-2: freshness restored, and vacuous-pass cases", () => {
  it("AC-FRESH-2: the same plan closes cleanly once a NEWER assessment exists", async () => {
    const { store, corpusService, taskWorkflow } = makeHarness();
    const plan = await makeApprovedPlan(corpusService);
    const task = await makeTask(corpusService, plan, "Task later re-assessed");
    await insertAssessmentDoc(store, corpusService, plan, "2026-07-28T11:00:00.000Z");
    await recordEvidenceAt(taskWorkflow, task, "2026-07-28T11:30:00.000Z");
    // A fresh assessment recorded AFTER the evidence — restores freshness.
    await insertAssessmentDoc(store, corpusService, plan, "2026-07-28T12:00:00.000Z");

    const result = await archivePlan(corpusService, plan);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("archived");
    }
  });

  it("AC-FRESH-2: a plan with NO assessment at all is unaffected by this predicate, regardless of task activity", async () => {
    const { corpusService, taskWorkflow } = makeHarness();
    const plan = await makeApprovedPlan(corpusService);
    const task = await makeTask(corpusService, plan, "Never assessed, but active");
    await recordEvidenceAt(taskWorkflow, task, "2026-07-28T12:00:00.000Z");

    const result = await archivePlan(corpusService, plan);

    expect(result.ok).toBe(true);
  });

  it("AC-FRESH-2 (D5): a plan WITH an assessment but ZERO task audit activity is a vacuous pass", async () => {
    const { store, corpusService } = makeHarness();
    const plan = await makeApprovedPlan(corpusService);
    await makeTask(corpusService, plan, "Never touched since creation");
    await insertAssessmentDoc(store, corpusService, plan, "2026-07-28T10:00:00.000Z");

    const result = await archivePlan(corpusService, plan);

    expect(result.ok).toBe(true);
  });

  it("AC-FRESH-2 (D5): a plan with zero tasks at all is a vacuous pass even with an assessment linked", async () => {
    const { store, corpusService } = makeHarness();
    const plan = await makeApprovedPlan(corpusService);
    await insertAssessmentDoc(store, corpusService, plan, "2026-07-28T10:00:00.000Z");

    const result = await archivePlan(corpusService, plan);

    expect(result.ok).toBe(true);
  });
});

// ─── AC-FRESH-3: cosmetic doc edits never trip the predicate — only audit activity does ──

describe("plan-close — AC-FRESH-3: cosmetic edits after an assessment do not trip the predicate", () => {
  it("AC-FRESH-3: an anchor add, a link write, and a status change after the assessment all leave the plan closeable — only evidence/done audit activity would trip it", async () => {
    const { store, corpusService } = makeHarness();
    const plan = await makeApprovedPlan(corpusService);
    const task = await makeTask(corpusService, plan, "Cosmetically-touched task");
    const otherDoc = await makeTask(corpusService, plan, "Unrelated sibling task");
    const assessment = await insertAssessmentDoc(store, corpusService, plan, "2026-07-28T10:00:00.000Z");

    // Cosmetic op 1: "anchor add" — an extra patch that bumps updated_at + writes a
    // plain "update" audit row (never "evidence"/"done").
    const anchorAdd = await corpusService.set(task.id, {
      extra: { ...task.extra, file_anchors: ["src/example.ts"] },
    });
    if (!anchorAdd.ok) throw new Error(`anchor-add setup failed: ${JSON.stringify(anchorAdd.error)}`);
    expect(anchorAdd.value.updated_at >= assessment.created_at).toBe(true);

    // Cosmetic op 2: "link write" — audited as action "link", never "evidence"/"done".
    const linkWrite = await corpusService.link(task.id, otherDoc.id, "relates-to");
    if (!linkWrite.ok) throw new Error(`link-write setup failed: ${JSON.stringify(linkWrite.error)}`);

    // Cosmetic op 3: "status change" — a legal draft->approved transition, audited as a
    // plain "update" action WITHOUT details.done === true.
    const statusChange = await corpusService.set(task.id, { status: "approved" });
    if (!statusChange.ok) throw new Error(`status-change setup failed: ${JSON.stringify(statusChange.error)}`);
    expect(statusChange.value.updated_at >= assessment.created_at).toBe(true);

    const result = await archivePlan(corpusService, plan);

    expect(result.ok).toBe(true);
  });
});

// ─── AC-FRESH-5: assessment_freshness_exempt mirrors attestation_exempt's flag+reason shape ──

describe("plan-close — AC-FRESH-5: assessment_freshness_exempt (flag + non-empty reason)", () => {
  it("AC-FRESH-5: exempt true WITH a non-empty reason short-circuits the predicate despite a stale assessment", async () => {
    const { store, corpusService, taskWorkflow } = makeHarness();
    const plan = await makeApprovedPlan(corpusService, {
      assessment_freshness_exempt: true,
      assessment_freshness_exempt_reason: "activity since the last assessment is immaterial to its outcome",
    });
    const task = await makeTask(corpusService, plan, "Stale but exempted task");
    await insertAssessmentDoc(store, corpusService, plan, "2026-07-28T11:00:00.000Z");
    await recordEvidenceAt(taskWorkflow, task, "2026-07-28T12:00:00.000Z");

    const result = await archivePlan(corpusService, plan);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("archived");
    }
  });

  it("AC-FRESH-5: exempt true WITHOUT a reason is NOT treated as exempt — still denied", async () => {
    const { store, corpusService, taskWorkflow } = makeHarness();
    const plan = await makeApprovedPlan(corpusService, {
      assessment_freshness_exempt: true,
    });
    const task = await makeTask(corpusService, plan, "Bare-flag stale task");
    await insertAssessmentDoc(store, corpusService, plan, "2026-07-28T11:00:00.000Z");
    await recordEvidenceAt(taskWorkflow, task, "2026-07-28T12:00:00.000Z");

    const result = await archivePlan(corpusService, plan);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.error as { field?: string }).field).toBe("gate:plan-close:assessment-freshness");
    }
  });

  // BOUNDARY — a whitespace-only reason fails the same "non-empty after trim" check
  // attestation_exempt_reason uses (D4's "mirrors EXACTLY" claim).
  it("AC-FRESH-5: exempt true with a whitespace-only reason is NOT treated as exempt — still denied", async () => {
    const { store, corpusService, taskWorkflow } = makeHarness();
    const plan = await makeApprovedPlan(corpusService, {
      assessment_freshness_exempt: true,
      assessment_freshness_exempt_reason: "   ",
    });
    const task = await makeTask(corpusService, plan, "Whitespace-reason stale task");
    await insertAssessmentDoc(store, corpusService, plan, "2026-07-28T11:00:00.000Z");
    await recordEvidenceAt(taskWorkflow, task, "2026-07-28T12:00:00.000Z");

    const result = await archivePlan(corpusService, plan);

    expect(result.ok).toBe(false);
  });
});

// ─── REGRESSION: composes correctly with the pre-existing attestation-floor predicate ──

describe("plan-close — REGRESSION: assessmentFreshness composes with attestationFloor's feeding pack", () => {
  it("a plan failing BOTH the attestation floor and assessment freshness names both recovery paths in one denial", async () => {
    const { store, corpusService, taskWorkflow } = makeHarness();
    // Deliberately NOT attestation-exempt this time — a self-reported-only evidence
    // entry trips attestationFloor too, alongside the stale assessment.
    const plan = await makeApprovedPlan(corpusService, {}, /* isolateAttestation */ false);
    const task = await makeTask(corpusService, plan, "Doubly-failing task");
    await insertAssessmentDoc(store, corpusService, plan, "2026-07-28T11:00:00.000Z");
    await recordEvidenceAt(taskWorkflow, task, "2026-07-28T12:00:00.000Z");

    const result = await archivePlan(corpusService, plan);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // attestationFloor is pushed BEFORE assessmentFreshness in checkPlanClose's
      // result order, so it wins the `field` discriminator (GateEnforcer.enforce's
      // "first failure with a defined field" rule) — REGRESSION-pinning that this
      // predicate's addition never displaces the pre-existing attestation-floor field.
      expect((result.error as { field?: string }).field).toBe("gate:plan-close:attestation-floor");
      const message = (result.error as { message?: string }).message ?? "";
      expect(message).toContain("lore verify");
      expect(message).toContain("stored assessment is now stale");
      expect(message).toContain(`lore assess ${plan.slug}`);
    }
  });
});
