/**
 * STATE/lifecycle tests for AC-scope staleness (SPEC-040 §T2 D1/D5) — a plan's
 * `extra.ac_scope` can outlive the spec criterion it once pointed at: editing a spec to
 * drop a previously-declared AC id does NOT retroactively invalidate any plan that already
 * scoped itself to that id (write-time validation only, no re-validation on the SPEC side).
 * `computeAssessmentFacts`'s `scope.dangling` is the DERIVED, read-time detection of this
 * drift — a comparison, never a mutation of the plan's own `ac_scope`.
 *
 * Spec-first expectations:
 *   1. A spec declaring AC-X-1 + AC-X-2 and a plan scoped to both is valid at creation time.
 *   2. Dropping AC-X-2 from the spec's `extra.acceptance_criteria` via `set()` SUCCEEDS —
 *      spec-side extra validation has no cross-check against any plan's `ac_scope`.
 *   3. Re-reading the plan bundle afterward and computing facts shows `scope.dangling ===
 *      ["AC-X-2"]`, `scope.declared_ids === ["AC-X-1"]` (AC-X-2 gone from the spec), and
 *      `scope.scoped_ids === ["AC-X-1", "AC-X-2"]` (the plan's OWN ac_scope is untouched).
 *   4. `buildAssessPromptV6`'s Facts section renders the literal substring "(declared in
 *      plan scope but no longer on spec)" together with "AC-X-2".
 *   5. BOUNDARY: when ac_scope exactly matches the current declared set (no drop happened),
 *      dangling is [] and no AC table row is annotated "(out of scope for this plan)".
 *   6. A full assessPlan() run threading an ungrounded absence-based dimension score
 *      composes correctly alongside staleness facts — both D1 and D4 signals show up
 *      without interfering with each other.
 *
 * @spec_ref AC-ADF-11
 */

import { describe, it, expect } from "vitest";
import { AIProviderService } from "../../../src/service/ai-provider-service.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { AcService } from "../../../src/service/ac-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { InMemoryAIProvider } from "../../../src/ai/in-memory-provider.js";
import { buildAssessPromptV6, extractDeclaredAcceptanceCriteria } from "../../../src/ai/assess-template.js";
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

const TWO_CRITERIA = [
  { id: "AC-X-1", statement: "The widget renders without throwing.", verify: { mode: "human" } },
  { id: "AC-X-2", statement: "The widget meets WCAG AA contrast requirements.", verify: { mode: "human" } },
];

const ONE_CRITERION = [
  { id: "AC-X-1", statement: "The widget renders without throwing.", verify: { mode: "human" } },
];

/** Sets up PRD → spec (two declared ACs) → plan (ac_scope = both) → PlanBundle. */
async function makeStaleScopeFixture(store: InMemoryStore) {
  const corpusService = new CorpusService(store);

  const prdResult = await corpusService.create({
    type: "prd",
    title: "Staleness Test PRD",
    content: "Root PRD for staleness tests.",
  } as CreateDocInput);
  if (!prdResult.ok) throw new Error("prd create failed");

  const specResult = await corpusService.create({
    type: "spec",
    title: "Staleness Test Spec",
    parent_id: prdResult.value.id,
    content: "Spec body.",
    extra: { acceptance_criteria: TWO_CRITERIA },
  } as CreateDocInput);
  if (!specResult.ok) throw new Error("spec create failed");

  const planResult = await corpusService.create({
    type: "plan",
    title: "Staleness Test Plan",
    parent_id: specResult.value.id,
    content: "Plan body.",
    extra: { ac_scope: ["AC-X-1", "AC-X-2"] },
  } as CreateDocInput);
  if (!planResult.ok) throw new Error("plan create failed");

  return { corpusService, prdId: prdResult.value.id, specId: specResult.value.id, planId: planResult.value.id };
}

describe("plan.extra.ac_scope staleness — dropping a declared AC from the spec does not invalidate an already-scoped plan (AC-ADF-11)", () => {
  it("HAPPY/STATE: creating a plan scoped to both currently-declared criteria succeeds", async () => {
    const store = new InMemoryStore();
    const { corpusService, planId } = await makeStaleScopeFixture(store);
    const docResult = await corpusService.get(planId);
    expect(docResult.ok).toBe(true);
  });

  it("STATE: dropping AC-X-2 from the spec's extra.acceptance_criteria via set() SUCCEEDS — no cross-check against any plan's ac_scope", async () => {
    const store = new InMemoryStore();
    const { corpusService, specId } = await makeStaleScopeFixture(store);

    const setResult = await new AcService(store).removeCriterion(specId, "AC-X-2");
    expect(setResult.ok).toBe(true);
  });

  it("STATE: after the drop, computeAssessmentFacts derives dangling=['AC-X-2'], declared_ids=['AC-X-1'], scoped_ids unchanged", async () => {
    const store = new InMemoryStore();
    const { corpusService, specId, planId } = await makeStaleScopeFixture(store);

    const setResult = await new AcService(store).removeCriterion(specId, "AC-X-2");
    expect(setResult.ok).toBe(true);

    const bundleResult = await corpusService.getPlanBundle(planId);
    expect(bundleResult.ok).toBe(true);
    if (!bundleResult.ok) return;
    const bundle: PlanBundle = bundleResult.value;

    const declaredCriteria = extractDeclaredAcceptanceCriteria(bundle.spec);
    const facts = computeAssessmentFacts(bundle, declaredCriteria, undefined);

    expect(facts.scope).toBeDefined();
    expect(facts.scope?.dangling).toEqual(["AC-X-2"]);
    expect(facts.scope?.declared_ids).toEqual(["AC-X-1"]);
    // The plan's OWN ac_scope is untouched by the spec edit — dangling is a DERIVED
    // comparison, never a mutation of the plan's stored ac_scope.
    expect(facts.scope?.scoped_ids).toEqual(["AC-X-1", "AC-X-2"]);
  });

  it("STATE: buildAssessPromptV6's Facts section names AC-X-2 alongside the literal dangling-annotation phrase", async () => {
    const store = new InMemoryStore();
    const { corpusService, specId, planId } = await makeStaleScopeFixture(store);

    const setResult = await new AcService(store).removeCriterion(specId, "AC-X-2");
    expect(setResult.ok).toBe(true);

    const bundleResult = await corpusService.getPlanBundle(planId);
    if (!bundleResult.ok) throw new Error("getPlanBundle failed");

    const { prompt } = buildAssessPromptV6(bundleResult.value, undefined, DEFAULT_BUDGETS);

    expect(prompt).toContain("(declared in plan scope but no longer on spec)");
    // The dangling line names AC-X-2 specifically.
    const danglingLine = prompt.split("\n").find((line) => line.includes("Dangling ids"));
    expect(danglingLine).toBeDefined();
    expect(danglingLine).toContain("AC-X-2");
  });

  it("BOUNDARY: when ac_scope exactly matches the currently-declared set (no drop), dangling is [] and no AC table row is marked out of scope", async () => {
    const store = new InMemoryStore();
    const corpusService = new CorpusService(store);

    const prdResult = await corpusService.create({
      type: "prd",
      title: "No-Drift PRD",
      content: "Root PRD.",
    } as CreateDocInput);
    if (!prdResult.ok) throw new Error("prd create failed");

    const specResult = await corpusService.create({
      type: "spec",
      title: "No-Drift Spec",
      parent_id: prdResult.value.id,
      content: "Spec body.",
      extra: { acceptance_criteria: TWO_CRITERIA },
    } as CreateDocInput);
    if (!specResult.ok) throw new Error("spec create failed");

    const planResult = await corpusService.create({
      type: "plan",
      title: "No-Drift Plan",
      parent_id: specResult.value.id,
      content: "Plan body.",
      extra: { ac_scope: ["AC-X-1", "AC-X-2"] },
    } as CreateDocInput);
    if (!planResult.ok) throw new Error("plan create failed");

    const bundleResult = await corpusService.getPlanBundle(planResult.value.id);
    if (!bundleResult.ok) throw new Error("getPlanBundle failed");
    const bundle = bundleResult.value;

    const declaredCriteria = extractDeclaredAcceptanceCriteria(bundle.spec);
    const facts = computeAssessmentFacts(bundle, declaredCriteria, undefined);
    expect(facts.scope?.dangling).toEqual([]);

    const { prompt } = buildAssessPromptV6(bundle, undefined, DEFAULT_BUDGETS, facts);
    // reason: buildAssessPromptV6's output-instruction ALSO emits a static explanatory
    // sentence containing this same literal phrase whenever the plan declares ANY
    // extra.ac_scope at all (scopedIds !== undefined) — regardless of whether any table row
    // actually ends up annotated. That sentence describes the annotation CONVENTION, not a
    // per-row fact, so a whole-prompt substring check would false-fail here even though the
    // AC table itself (the actual per-criterion signal) correctly has zero annotated rows.
    // Assert against the table rows specifically — the precise claim the boundary case is
    // about — rather than the whole prompt text.
    const tableRows = prompt.split("\n").filter((line) => line.startsWith("| AC-"));
    expect(tableRows.length).toBeGreaterThan(0);
    for (const row of tableRows) {
      expect(row).not.toContain("(out of scope for this plan)");
    }
  });

  it("REGRESSION/STATE: a full assessPlan() run composes staleness facts and D4 grounding warnings in one call without interfering", async () => {
    const store = new InMemoryStore();
    const { corpusService, specId, planId } = await makeStaleScopeFixture(store);

    const setResult = await new AcService(store).removeCriterion(specId, "AC-X-2");
    expect(setResult.ok).toBe(true);

    const bundleResult = await corpusService.getPlanBundle(planId);
    if (!bundleResult.ok) throw new Error("getPlanBundle failed");
    const bundle = bundleResult.value;

    // Scripted judge response includes an ungrounded absence-based dimension_scores entry
    // (D4 signal) — same technique as the grounding test file.
    const scriptedJson = JSON.stringify({
      verdict: "partially_met",
      overall_score: 50,
      ac_scores: [{ ac_id: "AC-X-1", score: 60, reasoning: "Some evidence.", evidence_refs: [] }],
      gaps: [],
      recommendations: [],
      dimension_scores: {
        scope_fidelity: { score: 20, confidence: 0.2, based_on: "absence", reasoning: "cannot verify" },
      },
    });
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: scriptedJson });
    const service = makeAssessService(provider);

    const result = await service.assessPlan(bundle, { commitDerivationUnverifiable: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // D1 staleness signal is present and correct.
    expect(result.value.facts?.scope?.dangling).toEqual(["AC-X-2"]);

    // D4 grounding warning is also present, unaffected by the staleness computation.
    expect(result.value.rubric_warning?.some((w) => w.includes('"scope_fidelity"') && w.includes("ungrounded"))).toBe(true);
  });
});
