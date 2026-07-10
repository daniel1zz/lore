/**
 * Tests for AIProviderService.assessPlan's typed-field validation (SPEC-040 §T2 D2, D3) —
 * the v6 output schema's new optional fields (`dimension_scores`, `typed_gaps`,
 * `typed_recommendations`, `unverifiable`) are still Zod-validated even though they're
 * optional: a syntactically-valid JSON payload whose TYPED fields violate their own schema
 * constraints (out-of-range score, invalid enum member) must be treated exactly like any
 * other schema-invalid response — one corrective retry, then AI_PROVIDER_ERROR, no document
 * created.
 *
 * Spec-first expectation: this is NOT a new retry axis — it's the SAME
 * `llmAssessmentOutputSchema.safeParse` failure path assessPlan already has for malformed
 * legacy fields (verdict/overall_score/ac_scores). A test that only proved "obviously broken
 * JSON" fails would NOT catch a regression where `dimension_scores`/`typed_gaps` validation
 * was accidentally skipped (e.g. an implementation that Zod-parses only the legacy shape and
 * discards the rest unchecked, silently persisting an out-of-range score).
 *
 * @spec_ref AC-ADF-3
 */

import { describe, it, expect } from "vitest";
import { AIProviderService } from "../../../src/service/ai-provider-service.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { InMemoryAIProvider } from "../../../src/ai/in-memory-provider.js";
import type { AIProvider, CreateDocInput, PlanBundle, Telemetry, TelemetryEvent } from "@lore/core";

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

async function makeBundle(store: InMemoryStore): Promise<PlanBundle> {
  const corpusService = new CorpusService(store);

  const planResult = await corpusService.create({
    type: "plan",
    title: "Typed Field Validation Plan",
    content: "Plan goals.",
  } as CreateDocInput);
  if (!planResult.ok) throw new Error("plan create failed");

  const taskResult = await corpusService.create({
    type: "task",
    title: "Some task",
    parent_id: planResult.value.id,
    content: "task body",
    extra: { plan_id: planResult.value.id },
  } as CreateDocInput);
  if (!taskResult.ok) throw new Error("task create failed");

  const bundleResult = await corpusService.getPlanBundle(planResult.value.id);
  if (!bundleResult.ok) throw new Error("getPlanBundle failed");
  return bundleResult.value;
}

// A syntactically valid response whose legacy fields are fine but dimension_scores.outcome.score
// is 150 — out of the 0-100 range llmAssessmentOutputSchema's dimensionScoreEntrySchema enforces.
const OUT_OF_RANGE_SCORE_JSON = JSON.stringify({
  verdict: "met",
  overall_score: 90,
  ac_scores: [],
  gaps: [],
  recommendations: [],
  dimension_scores: {
    outcome: { score: 150, confidence: 0.8, based_on: "evidence", reasoning: "ok" },
  },
});

// A second, independently-malformed typed field: typed_gaps[0].severity is "catastrophic",
// not a member of TYPED_FINDING_SEVERITIES ("blocker" | "major" | "minor").
const INVALID_SEVERITY_ENUM_JSON = JSON.stringify({
  verdict: "partially_met",
  overall_score: 60,
  ac_scores: [],
  gaps: [],
  recommendations: [],
  typed_gaps: [{ dimension: "outcome", severity: "catastrophic", statement: "x" }],
});

describe("assessPlan — typed-field schema violations are treated as malformed JSON, not silently accepted (AC-ADF-3)", () => {
  it("two syntactically-valid-but-typed-field-invalid responses in a row → AI_PROVIDER_ERROR after exactly one corrective retry, no document created", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundle(store);

    const beforeResult = await store.findMany({});
    if (!beforeResult.ok) throw new Error("findMany failed");
    const beforeCount = beforeResult.value.length;

    const provider = new InMemoryAIProvider("in-memory", {
      kind: "sequence",
      responses: [
        { kind: "ok", content: OUT_OF_RANGE_SCORE_JSON },
        { kind: "ok", content: INVALID_SEVERITY_ENUM_JSON },
      ],
    });
    const service = makeAssessService(provider);

    const result = await service.assessPlan(bundle, {});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("AI_PROVIDER_ERROR");

    // Exactly one corrective retry — not zero (which would mean the first response was
    // silently accepted as valid) and not more than two (which would mean a second retry
    // was spent, violating SPEC-026 §3 D2's single-axis retry budget).
    expect(provider.calls).toHaveLength(2);

    const afterResult = await store.findMany({});
    if (!afterResult.ok) throw new Error("findMany failed");
    expect(afterResult.value.length).toBe(beforeCount);
  });

  it("the out-of-range dimension score alone (first attempt) triggers the corrective retry — proves the typed field is actually validated, not just skimmed for legacy fields", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundle(store);

    // Second attempt is well-formed so we can observe that a retry DID happen because of
    // the first (typed-field-invalid) response, isolating the typed-field check from any
    // legacy-field malformation.
    const validJson = JSON.stringify({
      verdict: "met",
      overall_score: 90,
      ac_scores: [],
      gaps: [],
      recommendations: [],
    });
    const provider = new InMemoryAIProvider("in-memory", {
      kind: "sequence",
      responses: [{ kind: "ok", content: OUT_OF_RANGE_SCORE_JSON }, { kind: "ok", content: validJson }],
    });
    const service = makeAssessService(provider);

    const result = await service.assessPlan(bundle, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.judgment.retried).toBe(true);
    expect(provider.calls).toHaveLength(2);
  });
});
