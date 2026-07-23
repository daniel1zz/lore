/**
 * Tests for SPEC-067 D3 (mechanical grounding downgrade) + D4 (truncation-coverage
 * downgrade) inside `AIProviderService._finalizeAssessment` — exercised end-to-end via the
 * public `assessPlan` entry point with a scripted `InMemoryAIProvider` (no real AI calls,
 * mirrors `ai-provider-service-assess-grounding.test.ts`'s existing pattern for D4/SPEC-040).
 *
 * Spec-first expectations:
 *   - AC-067-4: an ungrounded absence-based dimension score emerges from finalization with
 *     that dimension's `confidence === "low"` and a stamped `confidence_reason`.
 *   - AC-067-5: >25% of a plan's tasks truncated in the judge prompt caps overall confidence
 *     at "low" with `degraded_by_truncation: true`; 100% truncation yields verdict
 *     "inconclusive" with no `overall_score` at all.
 *   - AC-067-6: a fully-grounded, untruncated judgment passes finalization unchanged — no
 *     downgrade side effects on the healthy path (regression).
 *
 * Task-truncation coverage is driven through the REAL production path (`buildAssessPromptV6`
 * → `truncateSection(task.content, budgets.max_task_chars)`), not a hand-built `judgment`
 * fixture — a small `max_task_chars` budget plus controlled task content lengths deterministically
 * puts exactly N of the plan's tasks over budget.
 *
 * @spec_ref AC-067-4, AC-067-5, AC-067-6, SPEC-067 D3, D4
 */

import { describe, it, expect } from "vitest";
import { AIProviderService } from "../../../src/service/ai-provider-service.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { InMemoryAIProvider } from "../../../src/ai/in-memory-provider.js";
import type { AIProvider, CreateDocInput, PlanBundle, Telemetry, TelemetryEvent } from "@lore/core";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const DEFAULT_BUDGETS = { max_plan_chars: 8000, max_spec_chars: 12000, max_task_chars: 4000, max_diff_chars: 24000 };
// reason: AC-067-5 — a small task budget lets a short "TRUNCATE ME " * N string reliably
// exceed it while a short "ok" content stays under it, without fighting the default 4000.
const SMALL_TASK_BUDGET = { ...DEFAULT_BUDGETS, max_task_chars: 20 };

function makeAssessService(provider: InMemoryAIProvider, budgets = DEFAULT_BUDGETS) {
  const telemetry: Telemetry = {
    record: (_event: TelemetryEvent) => {},
    emit: () => {},
    close: () => {},
  };
  const providers = new Map([[provider.name, provider]]) as unknown as ReadonlyMap<string, AIProvider>;
  return new AIProviderService(providers, provider.name, {}, telemetry, false, 8000, budgets);
}

/** Creates a plan with `taskContents.length` tasks, one per content string. */
async function makeBundleWithTasks(taskContents: string[]): Promise<PlanBundle> {
  const store = new InMemoryStore();
  const corpusService = new CorpusService(store);
  const planResult = await corpusService.create({
    type: "plan",
    title: "SPEC-067 Downgrade Test Plan",
    content: "Plan goals.",
  } as CreateDocInput);
  if (!planResult.ok) throw new Error("plan create failed");

  for (const [i, content] of taskContents.entries()) {
    const taskResult = await corpusService.create({
      type: "task",
      title: `Task ${i + 1}`,
      parent_id: planResult.value.id,
      content,
      extra: { plan_id: planResult.value.id },
    } as CreateDocInput);
    if (!taskResult.ok) throw new Error("task create failed");
  }

  const bundleResult = await corpusService.getPlanBundle(planResult.value.id);
  if (!bundleResult.ok) throw new Error("getPlanBundle failed");
  return bundleResult.value;
}

const OVER_BUDGET_CONTENT = "T".repeat(SMALL_TASK_BUDGET.max_task_chars + 10); // > 20 chars → truncated
const UNDER_BUDGET_CONTENT = "ok"; // <= 20 chars → not truncated

// ─── AC-067-4: ungrounded absence dimension → confidence forced to "low" ─────

describe("AC-067-4: ungrounded absence-based dimension score is mechanically downgraded", () => {
  it("AC-067-4: confidence is forced to 'low' with a stamped confidence_reason", async () => {
    const bundle = await makeBundleWithTasks([UNDER_BUDGET_CONTENT]);
    const judgeJson = JSON.stringify({
      verdict: "partially_met",
      overall_score: 50,
      ac_scores: [],
      gaps: [],
      recommendations: [],
      dimension_scores: {
        scope_fidelity: { score: 20, confidence: 0.2, based_on: "absence", reasoning: "cannot verify" },
      },
      // No unverifiable[] citing "scope_fidelity" — ungrounded.
    });
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: judgeJson });
    const service = makeAssessService(provider);

    const result = await service.assessPlan(bundle, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const entry = result.value.dimension_scores?.["scope_fidelity"];
    expect(entry).toBeDefined();
    expect(entry?.confidence).toBe("low");
    expect(entry?.confidence_reason).toBeDefined();
    expect(entry?.confidence_reason).toContain("scope_fidelity");
  });

  it("AC-067-4: the original numeric confidence is discarded, not merely annotated", async () => {
    const bundle = await makeBundleWithTasks([UNDER_BUDGET_CONTENT]);
    const judgeJson = JSON.stringify({
      verdict: "partially_met",
      overall_score: 50,
      ac_scores: [],
      gaps: [],
      recommendations: [],
      dimension_scores: {
        outcome: { score: 15, confidence: 0.9, based_on: "absence", reasoning: "no basis" },
      },
    });
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: judgeJson });
    const service = makeAssessService(provider);

    const result = await service.assessPlan(bundle, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // reason: 0.9 (the judge's self-reported float) must NOT survive — "low" fully replaces it.
    expect(result.value.dimension_scores?.["outcome"]?.confidence).toBe("low");
    expect(result.value.dimension_scores?.["outcome"]?.confidence).not.toBe(0.9);
  });

  it("AC-067-4: score/based_on/reasoning are preserved untouched — only confidence changes", async () => {
    const bundle = await makeBundleWithTasks([UNDER_BUDGET_CONTENT]);
    const judgeJson = JSON.stringify({
      verdict: "partially_met",
      overall_score: 50,
      ac_scores: [],
      gaps: [],
      recommendations: [],
      dimension_scores: {
        evidence_integrity: { score: 33, confidence: 0.4, based_on: "absence", reasoning: "cannot verify" },
      },
    });
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: judgeJson });
    const service = makeAssessService(provider);

    const result = await service.assessPlan(bundle, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entry = result.value.dimension_scores?.["evidence_integrity"];
    expect(entry?.score).toBe(33);
    expect(entry?.based_on).toBe("absence");
    expect(entry?.reasoning).toBe("cannot verify");
  });

  it("AC-067-4: a GROUNDED absence claim (cites the dimension in unverifiable[]) is left untouched", async () => {
    const bundle = await makeBundleWithTasks([UNDER_BUDGET_CONTENT]);
    const judgeJson = JSON.stringify({
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
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: judgeJson });
    const service = makeAssessService(provider);

    const result = await service.assessPlan(bundle, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entry = result.value.dimension_scores?.["scope_fidelity"];
    expect(entry?.confidence).toBe(0.2);
    expect(entry?.confidence_reason).toBeUndefined();
  });
});

// ─── AC-067-5: truncation-coverage caps confidence / forces inconclusive ─────

describe("AC-067-5: task-truncation coverage caps confidence and, at 100%, forces inconclusive", () => {
  it("AC-067-5: 5 of 16 tasks truncated (>25%) yields overall confidence low + degraded_by_truncation true", async () => {
    const contents = [
      ...Array.from({ length: 5 }, () => OVER_BUDGET_CONTENT),
      ...Array.from({ length: 11 }, () => UNDER_BUDGET_CONTENT),
    ];
    const bundle = await makeBundleWithTasks(contents);
    expect(bundle.tasks).toHaveLength(16);

    const judgeJson = JSON.stringify({
      verdict: "partially_met",
      overall_score: 60,
      ac_scores: [],
      gaps: [],
      recommendations: [],
    });
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: judgeJson });
    const service = makeAssessService(provider, SMALL_TASK_BUDGET);

    const result = await service.assessPlan(bundle, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const truncatedTaskEntries = result.value.judgment.truncated.filter((t) => t.startsWith("task:"));
    expect(truncatedTaskEntries).toHaveLength(5);
    expect(result.value.judgment.overall_confidence).toBe("low");
    expect(result.value.judgment.degraded_by_truncation).toBe(true);
    // reason: >25% is a confidence cap, NOT the 100% inconclusive case — verdict/overall_score
    // still come straight from the judge, untouched.
    expect(result.value.verdict).toBe("partially_met");
    expect(result.value.overall_score).toBe(60);
  });

  it("AC-067-5: exactly 25% truncated (boundary) does NOT trip the cap — strictly greater-than is required", async () => {
    // 4 of 16 = exactly 25%.
    const contents = [
      ...Array.from({ length: 4 }, () => OVER_BUDGET_CONTENT),
      ...Array.from({ length: 12 }, () => UNDER_BUDGET_CONTENT),
    ];
    const bundle = await makeBundleWithTasks(contents);
    const judgeJson = JSON.stringify({
      verdict: "met",
      overall_score: 85,
      ac_scores: [],
      gaps: [],
      recommendations: [],
    });
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: judgeJson });
    const service = makeAssessService(provider, SMALL_TASK_BUDGET);

    const result = await service.assessPlan(bundle, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.judgment.overall_confidence).toBeUndefined();
    expect(result.value.judgment.degraded_by_truncation).toBeUndefined();
  });

  it("AC-067-5: 100% truncation yields verdict 'inconclusive' with overall_score OMITTED entirely", async () => {
    const contents = Array.from({ length: 4 }, () => OVER_BUDGET_CONTENT);
    const bundle = await makeBundleWithTasks(contents);
    expect(bundle.tasks).toHaveLength(4);

    const judgeJson = JSON.stringify({
      verdict: "met",
      overall_score: 95,
      ac_scores: [],
      gaps: [],
      recommendations: [],
    });
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: judgeJson });
    const service = makeAssessService(provider, SMALL_TASK_BUDGET);

    const result = await service.assessPlan(bundle, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const truncatedTaskEntries = result.value.judgment.truncated.filter((t) => t.startsWith("task:"));
    expect(truncatedTaskEntries).toHaveLength(4);
    expect(result.value.verdict).toBe("inconclusive");
    expect("overall_score" in result.value).toBe(false);
    expect(result.value.judgment.overall_confidence).toBe("low");
    expect(result.value.judgment.degraded_by_truncation).toBe(true);
  });

  it("AC-067-5: a plan with zero tasks never trips the truncation cap (no divide-by-zero, no vacuous 100%)", async () => {
    const bundle = await makeBundleWithTasks([]);
    expect(bundle.tasks).toHaveLength(0);
    const judgeJson = JSON.stringify({
      verdict: "met",
      overall_score: 100,
      ac_scores: [],
      gaps: [],
      recommendations: [],
    });
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: judgeJson });
    const service = makeAssessService(provider, SMALL_TASK_BUDGET);

    const result = await service.assessPlan(bundle, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.verdict).toBe("met");
    expect(result.value.overall_score).toBe(100);
    expect(result.value.judgment.degraded_by_truncation).toBeUndefined();
  });
});

// ─── AC-067-6: healthy path — no downgrade side effects (regression) ────────

describe("AC-067-6: fully-grounded, untruncated judgment passes finalization unchanged", () => {
  it("AC-067-6: dimension_scores confidence values pass through exactly as the judge emitted them", async () => {
    const bundle = await makeBundleWithTasks([UNDER_BUDGET_CONTENT, UNDER_BUDGET_CONTENT]);
    const judgeJson = JSON.stringify({
      verdict: "met",
      overall_score: 92,
      ac_scores: [{ ac_id: "AC-1", score: 90, reasoning: "well covered", evidence_refs: [] }],
      gaps: [],
      recommendations: [],
      dimension_scores: {
        outcome: { score: 90, confidence: 0.85, based_on: "evidence", reasoning: "strong AC coverage" },
        evidence_integrity: { score: 88, confidence: 0.8, based_on: "evidence", reasoning: "attested evidence" },
      },
    });
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: judgeJson });
    const service = makeAssessService(provider);

    const result = await service.assessPlan(bundle, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.dimension_scores?.["outcome"]?.confidence).toBe(0.85);
    expect(result.value.dimension_scores?.["evidence_integrity"]?.confidence).toBe(0.8);
    expect(result.value.dimension_scores?.["outcome"]?.confidence_reason).toBeUndefined();
    expect(result.value.dimension_scores?.["evidence_integrity"]?.confidence_reason).toBeUndefined();
  });

  it("AC-067-6: verdict and overall_score come straight from the judge, unmodified", async () => {
    const bundle = await makeBundleWithTasks([UNDER_BUDGET_CONTENT]);
    const judgeJson = JSON.stringify({
      verdict: "met",
      overall_score: 92,
      ac_scores: [],
      gaps: [],
      recommendations: [],
    });
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: judgeJson });
    const service = makeAssessService(provider);

    const result = await service.assessPlan(bundle, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.verdict).toBe("met");
    expect(result.value.overall_score).toBe(92);
    expect("overall_score" in result.value).toBe(true);
  });

  it("AC-067-6: judgment carries no overall_confidence/degraded_by_truncation on the healthy path", async () => {
    const bundle = await makeBundleWithTasks([UNDER_BUDGET_CONTENT, UNDER_BUDGET_CONTENT, UNDER_BUDGET_CONTENT]);
    const judgeJson = JSON.stringify({
      verdict: "met",
      overall_score: 88,
      ac_scores: [],
      gaps: [],
      recommendations: [],
    });
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: judgeJson });
    const service = makeAssessService(provider);

    const result = await service.assessPlan(bundle, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.judgment.overall_confidence).toBeUndefined();
    expect(result.value.judgment.degraded_by_truncation).toBeUndefined();
    expect(result.value.judgment.truncated).toEqual([]);
  });

  it("AC-067-6: no rubric_warning is added when there is nothing to warn about (dimension_scores absent)", async () => {
    const bundle = await makeBundleWithTasks([UNDER_BUDGET_CONTENT]);
    const judgeJson = JSON.stringify({
      verdict: "not_met",
      overall_score: 20,
      ac_scores: [],
      gaps: ["missing feature X"],
      recommendations: ["implement X"],
    });
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: judgeJson });
    const service = makeAssessService(provider);

    const result = await service.assessPlan(bundle, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rubric_warning).toBeUndefined();
    expect(result.value.gaps).toEqual(["missing feature X"]);
    expect(result.value.recommendations).toEqual(["implement X"]);
  });
});
