/**
 * Tests for SPEC-067 D4 (truncation-coverage downgrade) inside
 * `AIProviderService._finalizeAssessment` — exercised end-to-end via the public
 * `assessPlan` entry point with a scripted `InMemoryAIProvider` (no real AI calls, mirrors
 * `ai-provider-service-assess-grounding.test.ts`'s existing pattern for D4/SPEC-040).
 *
 * ⛔ SUPERSEDED (2026-08-01): SPEC-067 D3's confidence-downgrade-only mechanism
 * (`applyGroundingConfidenceDowngrade`) is REMOVED by
 * spec-lore-assess-project-evidence-rows-instead-of-embedding-the D3/D4
 * (task-t4-suppress-ungrounded-absence-findings-instead-of-merely) — a downgrade that
 * leaves the ungrounded finding in the permanent record was measured shipping false
 * findings anyway. An ungrounded absence-based dimension score is now REMOVED from
 * `dimension_scores` entirely (not merely confidence-downgraded), with a corresponding
 * `unverifiable[]` entry naming the dimension added in its place. The three former
 * "AC-067-4" sub-tests below are retitled `REGRESSION (superseded)` and updated to assert
 * the new removal behavior; SPEC-067's own AC-067-4 statement ("emerges from finalization
 * with confidence low") is now stale and needs a follow-up update/invalidation at the
 * governance layer — new suppression coverage (AC-AEP-5/6/7/8) lives in
 * `assess-absence-suppression.test.ts`.
 *
 * Spec-first expectations (current):
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
 * @spec_ref AC-067-5, AC-067-6, SPEC-067 D4; superseded: AC-067-4, SPEC-067 D3
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

describe("REGRESSION (superseded AC-067-4): ungrounded absence-based dimension score is now SUPPRESSED, not merely downgraded", () => {
  it("REGRESSION (superseded AC-067-4): the entry is REMOVED from dimension_scores and an unverifiable[] entry naming it is added", async () => {
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

    // reason: task-t4-suppress-ungrounded-absence-findings-instead-of-merely D3 — the
    // old downgrade-and-keep behavior (confidence forced to "low", entry survives) is
    // superseded: the entry is removed entirely rather than merely re-confidenced.
    expect(result.value.dimension_scores?.["scope_fidelity"]).toBeUndefined();
    const unverifiable = result.value.unverifiable ?? [];
    expect(unverifiable.some((u) => u.material.toLowerCase().includes("scope_fidelity"))).toBe(true);
  });

  it("REGRESSION (superseded AC-067-4): the entry is removed, not merely re-confidenced — the original numeric confidence never survives because nothing of the entry does", async () => {
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
    // reason: 0.9 (the judge's self-reported float) does not survive — but neither does
    // any other part of the entry; it is removed wholesale, not merely re-confidenced.
    expect(result.value.dimension_scores?.["outcome"]).toBeUndefined();
    const unverifiable = result.value.unverifiable ?? [];
    expect(unverifiable.some((u) => u.material.toLowerCase().includes("outcome"))).toBe(true);
  });

  it("REGRESSION (superseded AC-067-4): score/based_on/reasoning no longer survive either — the whole entry is removed, not partially edited", async () => {
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
    expect(entry).toBeUndefined();
    const unverifiable = result.value.unverifiable ?? [];
    expect(unverifiable.some((u) => u.material.toLowerCase().includes("evidence_integrity"))).toBe(true);
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
