/**
 * Tests for the SPEC-040 §T2 D1/D2 "facts computed once, judge cannot override" invariant
 * on AIProviderService.assessPlan.
 *
 * Strategy: build a real PlanBundle via InMemoryStore + CorpusService.getPlanBundle (same
 * bundle-assembly path production code uses), independently compute the EXPECTED
 * AssessmentFacts via the exact same pure function (`computeAssessmentFacts`) the service
 * itself calls — BEFORE ever invoking assessPlan — then script a judge response that
 * flatly contradicts those facts. If assessPlan's persisted `facts` matches our
 * independently-computed expectation despite the contradictory judge output, the facts are
 * proven creation-time-frozen, not judge-influenced.
 *
 * Spec-first expectation (SPEC-040 §T2 D1, D2): `result.value.facts` deep-equals the facts
 * computed from the full untruncated bundle BEFORE the prompt was built or the provider was
 * called — regardless of what the scripted judge JSON claims. `result.value.source_versions`
 * pins {doc_id, version} for the plan, the spec (when linked), and every task.
 *
 * @spec_ref AC-ADF-1
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { describe, it, expect } from "vitest";
import { AIProviderService } from "../../../src/service/ai-provider-service.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { InMemoryAIProvider } from "../../../src/ai/in-memory-provider.js";
import { buildAssessDiffMeta, extractDeclaredAcceptanceCriteria } from "../../../src/ai/assess-template.js";
import type { AIProvider, CreateDocInput, PlanBundle, Telemetry, TelemetryEvent } from "@lore/core";
import { computeAssessmentFacts } from "@lore/core";

const DEFAULT_BUDGETS = { max_plan_chars: 8000, max_spec_chars: 12000, max_task_chars: 4000, max_diff_chars: 24000 };

function makeAssessService(provider: InMemoryAIProvider) {
  const telemetry: Telemetry = {
    record: (_event: TelemetryEvent) => {},
    emit: () => {},
    close: () => {},
  };
  const providers = new Map([[provider.name, provider]]) as unknown as ReadonlyMap<string, AIProvider>;
  return new AIProviderService(providers, provider.name, {}, telemetry, false, 8000, DEFAULT_BUDGETS);
}

/**
 * Builds a PlanBundle with a spec declaring two structured ACs, a plan, and a task whose
 * evidence trail is DELIBERATELY incomplete (only AC-X-1 has a passing entry; AC-X-2 has
 * none at all) — so the "contradicting" scripted judge response (both ACs scored 100,
 * verdict "met") is provably false relative to the real facts.
 */
async function makeIncompleteEvidenceBundle(store: InMemoryStore): Promise<PlanBundle> {
  const corpusService = new CorpusService(store, new RecordLockService(store));

  const prdResult = await corpusService.create({
    type: "prd",
    title: "Facts Frozen Test PRD",
    content: "Root PRD for facts-frozen tests.",
  } as CreateDocInput);
  if (!prdResult.ok) throw new Error("prd create failed");

  const specResult = await corpusService.create({
    type: "spec",
    title: "Facts Frozen Test Spec",
    content: "Spec body (unused — structured ACs replace it).",
    extra: {
      acceptance_criteria: [
        {
          id: "AC-X-1",
          statement: "The widget renders without throwing.",
          verify: { mode: "script", oracle: "test", command: "bun test widget.test.ts" },
        },
        {
          id: "AC-X-2",
          statement: "The widget meets WCAG AA contrast requirements.",
          verify: { mode: "ai", rubric: "Check contrast ratios against WCAG AA thresholds." },
        },
      ],
    },
  } as CreateDocInput);
  if (!specResult.ok) throw new Error("spec create failed");

  const planResult = await corpusService.create({
    type: "plan",
    title: "Facts Frozen Test Plan",
    parent_id: specResult.value.id,
    content: "Plan goals for the facts-frozen widget feature.",
  } as CreateDocInput);
  if (!planResult.ok) throw new Error("plan create failed");

  const taskResult = await corpusService.create({
    type: "task",
    title: "Implement the widget",
    parent_id: planResult.value.id,
    content: "Task body describing the widget work.",
    extra: {
      plan_id: planResult.value.id,
      // Only AC-X-1 has evidence; AC-X-2 has none at all — a real gap the contradictory
      // judge response below will pretend doesn't exist.
      verification_evidence: [
        {
          oracle: "test",
          command: "bun test widget.test.ts",
          result: "pass",
          recorded_at: "2026-07-08T00:00:00.000Z",
          recorded_by: "carol",
          ac_ref: "AC-X-1",
        },
      ],
    },
  } as CreateDocInput);
  if (!taskResult.ok) throw new Error("task create failed");

  const bundleResult = await corpusService.getPlanBundle(planResult.value.id);
  if (!bundleResult.ok) throw new Error("getPlanBundle failed");
  return bundleResult.value;
}

describe("assessPlan — facts are creation-time-frozen, immune to a contradictory judge (AC-ADF-1, SPEC-040 D1/D2)", () => {
  it("persisted facts deep-equal the independently-computed facts, DESPITE a scripted judge response that claims full coverage on both ACs", async () => {
    const store = new InMemoryStore();
    const bundle = await makeIncompleteEvidenceBundle(store);

    // reason: compute the EXPECTED facts ourselves, BEFORE calling assessPlan at all —
    // the exact same pure function + inputs the service uses internally.
    const declaredCriteria = extractDeclaredAcceptanceCriteria(bundle.spec);
    const expectedFacts = computeAssessmentFacts(bundle, declaredCriteria, buildAssessDiffMeta(undefined));

    // Sanity: the fixture really is incomplete — AC-X-2 has zero coverage. If this fails,
    // the fixture itself is wrong and the "contradiction" below proves nothing.
    const acX2Coverage = expectedFacts.ac_coverage.find((c) => c.ac_id === "AC-X-2");
    expect(acX2Coverage?.pass).toBe(0);
    expect(acX2Coverage?.fail).toBe(0);

    // Scripted judge response FLATLY CONTRADICTS the real facts: both ACs scored 100,
    // verdict "met", zero gaps — despite AC-X-2 having no evidence whatsoever, and also
    // claims a "scope_fidelity" dimension score as "based_on": "evidence" (another
    // contradiction — this bundle's plan has no ac_scope at all, so there is no scope
    // evidence to speak of).
    const contradictoryJson = JSON.stringify({
      verdict: "met",
      overall_score: 100,
      ac_scores: [
        { ac_id: "AC-X-1", score: 100, reasoning: "Fully covered.", evidence_refs: [] },
        { ac_id: "AC-X-2", score: 100, reasoning: "Fully covered (false claim).", evidence_refs: [] },
      ],
      gaps: [],
      recommendations: [],
      dimension_scores: {
        scope_fidelity: { score: 100, confidence: 0.99, based_on: "evidence", reasoning: "Perfectly in scope." },
      },
    });
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: contradictoryJson });
    const service = makeAssessService(provider);

    const result = await service.assessPlan(bundle, { commitDerivationUnverifiable: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Core invariant: the persisted facts match what we computed BEFORE the judge ever ran
    // — the judge's contradictory claims had ZERO influence on this field.
    expect(result.value.facts).toEqual(expectedFacts);
    expect(result.value.facts).toBeDefined();
    if (result.value.facts === undefined) return;

    // The judge's own (false) ac_scores are still persisted as ac_scores (that's the
    // model's job) — but facts.ac_coverage, the DETERMINISTIC record, still shows the gap.
    expect(result.value.facts.ac_coverage.find((c) => c.ac_id === "AC-X-2")?.pass).toBe(0);
  });

  it("source_versions pins {doc_id, version} for the plan, the linked spec, and every task", async () => {
    const store = new InMemoryStore();
    const bundle = await makeIncompleteEvidenceBundle(store);
    const provider = new InMemoryAIProvider("in-memory", {
      kind: "ok",
      content: JSON.stringify({
        verdict: "met",
        overall_score: 90,
        ac_scores: [{ ac_id: "AC-X-1", score: 90, reasoning: "ok", evidence_refs: [] }],
        gaps: [],
        recommendations: [],
      }),
    });
    const service = makeAssessService(provider);

    const result = await service.assessPlan(bundle, { commitDerivationUnverifiable: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.source_versions).toContainEqual({ doc_id: bundle.plan.id, version: bundle.plan.version });
    expect(bundle.spec).toBeDefined();
    if (bundle.spec) {
      expect(result.value.source_versions).toContainEqual({ doc_id: bundle.spec.id, version: bundle.spec.version });
    }
    expect(bundle.tasks.length).toBeGreaterThan(0);
    for (const task of bundle.tasks) {
      expect(result.value.source_versions).toContainEqual({ doc_id: task.id, version: task.version });
    }
    // Exactly plan + spec + tasks, no more, no fewer entries.
    expect(result.value.source_versions).toHaveLength(1 + 1 + bundle.tasks.length);
  });
});
