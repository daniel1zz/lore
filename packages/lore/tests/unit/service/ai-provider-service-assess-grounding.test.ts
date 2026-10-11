/**
 * Tests for the D4 grounding cross-check (SPEC-040 §T2 D4) — `computeGroundingWarnings`
 * (pure, exported from ai-provider-service.ts) and its wiring into
 * AIProviderService.assessPlan's `rubric_warning`.
 *
 * Spec-first expectation: a `dimension_scores` entry claiming `based_on: "absence"` MUST
 * cite the missing material — either via a matching `unverifiable[].material` entry or a
 * matching `judgment.truncated[]` section name (case-insensitive substring match on the
 * dimension key). An absence claim with neither is "ungrounded" and produces a warning
 * string. This check is NEVER fatal — assessPlan still returns `ok` even when ungrounded.
 *
 * @spec_ref AC-ADF-4
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { describe, it, expect } from "vitest";
import {
  AIProviderService,
  computeGroundingWarnings,
} from "../../../src/service/ai-provider-service.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { InMemoryAIProvider } from "../../../src/ai/in-memory-provider.js";
import type { AIProvider, CreateDocInput, LlmAssessmentOutput, PlanBundle, Telemetry, TelemetryEvent } from "@lore/core";

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
  const corpusService = new CorpusService(store, new RecordLockService(store));
  const planResult = await corpusService.create({
    type: "plan",
    title: "Grounding Test Plan",
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

const BASE_OUTPUT: LlmAssessmentOutput = {
  verdict: "met",
  overall_score: 90,
  ac_scores: [],
  gaps: [],
  recommendations: [],
};

// ─── (a) Unit-level: computeGroundingWarnings ────────────────────────────────

describe("computeGroundingWarnings — pure unit tests (AC-ADF-4)", () => {
  it("HAPPY: an absence-based score grounded via a matching unverifiable[].material entry produces no warning", () => {
    const output: LlmAssessmentOutput = {
      ...BASE_OUTPUT,
      dimension_scores: {
        scope_fidelity: { score: 40, confidence: 0.5, based_on: "absence", reasoning: "no data" },
      },
      unverifiable: [{ material: "scope_fidelity evidence not found", reason: "missing doc" }],
    };
    expect(computeGroundingWarnings(output, [])).toEqual([]);
  });

  it("HAPPY: an absence-based score grounded via a matching truncated[] section name produces no warning", () => {
    const output: LlmAssessmentOutput = {
      ...BASE_OUTPUT,
      dimension_scores: {
        outcome: { score: 30, confidence: 0.4, based_on: "absence", reasoning: "cut off" },
      },
    };
    expect(computeGroundingWarnings(output, ["diff:outcome-report.md"])).toEqual([]);
  });

  it("NEGATIVE: an absence-based score with no matching unverifiable[] or truncated[] entry produces an ungrounded warning naming the dimension", () => {
    const output: LlmAssessmentOutput = {
      ...BASE_OUTPUT,
      dimension_scores: {
        evidence_integrity: { score: 20, confidence: 0.3, based_on: "absence", reasoning: "no basis given" },
      },
    };
    const warnings = computeGroundingWarnings(output, ["plan", "spec"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Dimension "evidence_integrity"');
    expect(warnings[0]).toContain('based_on="absence"');
    expect(warnings[0]).toContain("ungrounded");
  });

  it("BOUNDARY: no dimension_scores at all returns [] (not an error, not a crash)", () => {
    expect(computeGroundingWarnings(BASE_OUTPUT, [])).toEqual([]);
  });

  it("BOUNDARY: based_on='evidence' entries are never flagged, regardless of unverifiable/truncated content", () => {
    const output: LlmAssessmentOutput = {
      ...BASE_OUTPUT,
      dimension_scores: {
        outcome: { score: 90, confidence: 0.9, based_on: "evidence", reasoning: "well supported" },
      },
    };
    // Deliberately empty unverifiable/truncated — an "evidence"-based score has nothing to
    // ground and must never be flagged, unlike the "absence" case above.
    expect(computeGroundingWarnings(output, [])).toEqual([]);
  });
});

// ─── (b) Integration-level: assessPlan → rubric_warning ──────────────────────

describe("assessPlan — ungrounded absence claims surface in rubric_warning, never fatal (AC-ADF-4)", () => {
  it("an ungrounded absence-based dimension score: assessPlan still succeeds and rubric_warning names the dimension", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundle(store);
    const ungroundedJson = JSON.stringify({
      verdict: "partially_met",
      overall_score: 50,
      ac_scores: [],
      gaps: [],
      recommendations: [],
      dimension_scores: {
        scope_fidelity: { score: 20, confidence: 0.2, based_on: "absence", reasoning: "cannot verify" },
      },
    });
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: ungroundedJson });
    const service = makeAssessService(provider);

    const result = await service.assessPlan(bundle, { commitDerivationUnverifiable: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rubric_warning).toBeDefined();
    expect(result.value.rubric_warning?.some((w) => w.includes('"scope_fidelity"') && w.includes("ungrounded"))).toBe(true);
  });

  it("a GROUNDED absence claim (cites the dimension in unverifiable[]) produces no matching rubric_warning entry", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundle(store);
    const groundedJson = JSON.stringify({
      verdict: "partially_met",
      overall_score: 50,
      ac_scores: [],
      gaps: [],
      recommendations: [],
      dimension_scores: {
        scope_fidelity: { score: 20, confidence: 0.2, based_on: "absence", reasoning: "cannot verify" },
      },
      unverifiable: [{ material: "scope_fidelity evidence", reason: "the diff was not provided" }],
    });
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: groundedJson });
    const service = makeAssessService(provider);

    const result = await service.assessPlan(bundle, { commitDerivationUnverifiable: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const warnings = result.value.rubric_warning ?? [];
    expect(warnings.some((w) => w.includes('"scope_fidelity"') && w.includes("ungrounded"))).toBe(false);
  });
});
