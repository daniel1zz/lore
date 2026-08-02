/**
 * Tests for spec-lore-assess-project-evidence-rows-instead-of-embedding-the D3/D4 —
 * `AIProviderService._finalizeAssessment` SUPPRESSES (not merely warns about) every
 * `dimension_scores` entry `findUngroundedAbsenceDimensions` flags: the entry is REMOVED
 * from the persisted `dimension_scores`, and a corresponding `unverifiable[]` entry naming
 * the dimension is added in its place. Exercised end-to-end via the public `assessPlan`
 * entry point with a scripted `InMemoryAIProvider` (no real AI calls), mirroring the
 * existing pattern in `assessment-finalize-downgrade.test.ts` /
 * `ai-provider-service-assess-grounding.test.ts`.
 *
 * Spec-first expectations:
 *   - AC-AEP-5: an ungrounded absence-based dimension_scores entry is removed, with a
 *     corresponding unverifiable[] entry naming it added in its place.
 *   - AC-AEP-6: CONTROL — a based_on='evidence' entry is never suppressed, and a
 *     based_on='absence' entry that IS grounded (cites the dimension in unverifiable[]) is
 *     never suppressed either. Suppression is scoped to exactly the entries
 *     `findUngroundedAbsenceDimensions` flags.
 *   - AC-AEP-7: CONTROL for D4 — suppression consumes `findUngroundedAbsenceDimensions`'
 *     verdict rather than re-deriving a match. Proven with a case where the function's
 *     real (case-insensitive substring) rule and a naive equality check DISAGREE: a
 *     truncated task-section entry ("task:<slug>") CONTAINS the dimension key as a
 *     substring without being EQUAL to it. The real rule grounds the claim (kept); a naive
 *     equality re-implementation would wrongly flag it ungrounded (suppressed).
 *   - AC-AEP-8: REGRESSION — the existing SPEC-067 D4 100%-task-truncation branch
 *     (verdict forced to "inconclusive", overall_score omitted, overall_confidence
 *     downgraded to "low") still fires correctly when suppression ALSO runs in the same
 *     call, and suppression never corrupts `gaps`/`recommendations` (`deriveLegacyFindings`
 *     projection) — no contradictory "no gaps found" summary when a real gap exists.
 *   - AC-AEP-11: task-t6 — a suppressed dimension's matching `typed_gaps[]` entries are
 *     ALSO removed (not just the `dimension_scores` row), and the legacy `gaps[]`
 *     projection `deriveLegacyFindings` derives from `typed_gaps` no longer carries the
 *     suppressed gap's text — closing the "still publishes, twice" bug measured on
 *     `knowledge-assessment-implementation-evidence-output-tail`.
 *   - AC-AEP-12: CONTROL for AC-AEP-11 — a GROUNDED absence dimension keeps BOTH its
 *     `dimension_scores` row and its `typed_gaps` entry; a `based_on='evidence'`
 *     dimension's `typed_gaps` entry is never touched; and emptying `typed_gaps` entirely
 *     via suppression does not corrupt `verdict` into a false "clean" reading.
 *
 * Task-truncation coverage (AC-AEP-7/8) is driven through the REAL production path
 * (`buildAssessPromptV6`/`buildAssessPrompt` → `truncateSection(task.content,
 * budgets.max_task_chars)`), not a hand-built `judgment` fixture — a small `max_task_chars`
 * budget plus controlled task content lengths deterministically puts a task over budget.
 *
 * @spec_ref AC-AEP-5, AC-AEP-6, AC-AEP-7, AC-AEP-8, AC-AEP-11, AC-AEP-12
 */

import { describe, it, expect } from "vitest";
import { AIProviderService } from "../../../src/service/ai-provider-service.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { InMemoryAIProvider } from "../../../src/ai/in-memory-provider.js";
import type { AIProvider, CreateDocInput, PlanBundle, Telemetry, TelemetryEvent } from "@lore/core";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const DEFAULT_BUDGETS = { max_plan_chars: 8000, max_spec_chars: 12000, max_task_chars: 4000, max_diff_chars: 24000 };
// reason: a small task budget lets a short "T"-repeated string reliably exceed it while a
// short "ok" content stays under it, without fighting the default 4000 (mirrors
// assessment-finalize-downgrade.test.ts's SMALL_TASK_BUDGET).
const SMALL_TASK_BUDGET = { ...DEFAULT_BUDGETS, max_task_chars: 20 };

const OVER_BUDGET_CONTENT = "T".repeat(SMALL_TASK_BUDGET.max_task_chars + 10); // > 20 chars → truncated
const UNDER_BUDGET_CONTENT = "ok"; // <= 20 chars → not truncated

function makeAssessService(provider: InMemoryAIProvider, budgets = DEFAULT_BUDGETS) {
  const telemetry: Telemetry = {
    record: (_event: TelemetryEvent) => {},
    emit: () => {},
    close: () => {},
  };
  const providers = new Map([[provider.name, provider]]) as unknown as ReadonlyMap<string, AIProvider>;
  return new AIProviderService(providers, provider.name, {}, telemetry, false, 8000, budgets);
}

/** Creates a plan with one task per `{title, content}` entry, in order. */
async function makeBundleWithTasks(tasks: { title: string; content: string }[]): Promise<PlanBundle> {
  const store = new InMemoryStore();
  const corpusService = new CorpusService(store);
  const planResult = await corpusService.create({
    type: "plan",
    title: "Absence Suppression Test Plan",
    content: "Plan goals.",
  } as CreateDocInput);
  if (!planResult.ok) throw new Error("plan create failed");

  for (const { title, content } of tasks) {
    const taskResult = await corpusService.create({
      type: "task",
      title,
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

// ─── AC-AEP-5: ungrounded absence entry → removed + unverifiable[] added ─────

describe("AC-AEP-5: an ungrounded absence-based dimension_scores entry is removed, with a corresponding unverifiable[] entry added", () => {
  it("AC-AEP-5: the entry is removed from dimension_scores and unverifiable[] gains an entry naming the dimension", async () => {
    const bundle = await makeBundleWithTasks([{ title: "Task One", content: UNDER_BUDGET_CONTENT }]);
    const judgeJson = JSON.stringify({
      verdict: "partially_met",
      overall_score: 50,
      ac_scores: [],
      gaps: [],
      recommendations: [],
      dimension_scores: {
        scope_fidelity: { score: 20, confidence: 0.2, based_on: "absence", reasoning: "cannot verify" },
      },
      // No unverifiable[] citing "scope_fidelity" and no truncated[] mentioning it → ungrounded.
    });
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: judgeJson });
    const service = makeAssessService(provider);

    const result = await service.assessPlan(bundle, { commitDerivationUnverifiable: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.dimension_scores?.["scope_fidelity"]).toBeUndefined();
    const unverifiable = result.value.unverifiable ?? [];
    expect(unverifiable.some((u) => u.material.toLowerCase().includes("scope_fidelity"))).toBe(true);
  });

  it("AC-AEP-5 BOUNDARY: when every dimension_scores entry is suppressed, dimension_scores is OMITTED entirely rather than persisted as an empty object", async () => {
    const bundle = await makeBundleWithTasks([{ title: "Task One", content: UNDER_BUDGET_CONTENT }]);
    const judgeJson = JSON.stringify({
      verdict: "partially_met",
      overall_score: 50,
      ac_scores: [],
      gaps: [],
      recommendations: [],
      dimension_scores: {
        outcome: { score: 10, confidence: 0.1, based_on: "absence", reasoning: "no basis" },
      },
    });
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: judgeJson });
    const service = makeAssessService(provider);

    const result = await service.assessPlan(bundle, { commitDerivationUnverifiable: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.dimension_scores).toBeUndefined();
    expect("dimension_scores" in result.value).toBe(false);
  });
});

// ─── AC-AEP-6: CONTROL — suppression scoped to ungrounded absence only ───────

describe("AC-AEP-6: CONTROL — suppression is scoped to the ungrounded absence intersection only", () => {
  it("AC-AEP-6: a based_on='evidence' entry is never suppressed", async () => {
    const bundle = await makeBundleWithTasks([{ title: "Task One", content: UNDER_BUDGET_CONTENT }]);
    const judgeJson = JSON.stringify({
      verdict: "met",
      overall_score: 90,
      ac_scores: [],
      gaps: [],
      recommendations: [],
      dimension_scores: {
        outcome: { score: 90, confidence: 0.9, based_on: "evidence", reasoning: "well supported" },
      },
    });
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: judgeJson });
    const service = makeAssessService(provider);

    const result = await service.assessPlan(bundle, { commitDerivationUnverifiable: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.dimension_scores?.["outcome"]).toBeDefined();
    expect(result.value.dimension_scores?.["outcome"]?.score).toBe(90);
    expect(result.value.dimension_scores?.["outcome"]?.confidence).toBe(0.9);
  });

  it("AC-AEP-6: an absence entry GROUNDED via a matching unverifiable[] citation is never suppressed", async () => {
    const bundle = await makeBundleWithTasks([{ title: "Task One", content: UNDER_BUDGET_CONTENT }]);
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

    const result = await service.assessPlan(bundle, { commitDerivationUnverifiable: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.dimension_scores?.["scope_fidelity"]).toBeDefined();
    expect(result.value.dimension_scores?.["scope_fidelity"]?.confidence).toBe(0.2);
    // reason: the original citation is preserved verbatim — no duplicate suppression
    // entry is appended for an already-grounded absence claim.
    expect(result.value.unverifiable).toHaveLength(1);
    expect(result.value.unverifiable?.[0]?.material).toBe("scope_fidelity evidence");
  });

  it("AC-AEP-6 NEGATIVE: no dimension_scores at all is a no-op — assessPlan still succeeds with no unverifiable[] added", async () => {
    const bundle = await makeBundleWithTasks([{ title: "Task One", content: UNDER_BUDGET_CONTENT }]);
    const judgeJson = JSON.stringify({
      verdict: "met",
      overall_score: 88,
      ac_scores: [],
      gaps: [],
      recommendations: [],
    });
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: judgeJson });
    const service = makeAssessService(provider);

    const result = await service.assessPlan(bundle, { commitDerivationUnverifiable: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.dimension_scores).toBeUndefined();
    expect(result.value.unverifiable).toBeUndefined();
  });
});

// ─── AC-AEP-7: CONTROL for D4 — real substring rule, never a naive re-derivation ─

describe("AC-AEP-7: CONTROL for D4 — suppression follows findUngroundedAbsenceDimensions' substring rule, not a naive equality re-derivation", () => {
  it("AC-AEP-7: a truncated task-slug entry CONTAINS the dimension key as a substring without being EQUAL to it — the real rule grounds it (kept); a naive equality re-implementation would wrongly suppress it", async () => {
    // reason: task.slug is derived from this title; "Scoped" kebab-cases into "scoped",
    // which contains "scope" as a substring without being equal to it — exactly the
    // disagreement AC-AEP-7 needs between the real (substring) rule and a naive equality
    // check on the full "task:<slug>" truncated[] entry.
    const bundle = await makeBundleWithTasks([{ title: "Scoped Content Task", content: OVER_BUDGET_CONTENT }]);
    const judgeJson = JSON.stringify({
      verdict: "partially_met",
      overall_score: 40,
      ac_scores: [],
      gaps: [],
      recommendations: [],
      dimension_scores: {
        scope: { score: 30, confidence: 0.3, based_on: "absence", reasoning: "cannot verify" },
      },
      // No unverifiable[] citing "scope" — the ONLY possible grounding is the truncated[]
      // substring match this test exercises.
    });
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: judgeJson });
    const service = makeAssessService(provider, SMALL_TASK_BUDGET);

    const result = await service.assessPlan(bundle, { commitDerivationUnverifiable: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Sanity: confirm the scenario really produced the disagreement condition — a
    // truncated[] entry that textually DIFFERS from the bare dimension key but CONTAINS
    // it as a substring.
    const truncatedEntry = result.value.judgment.truncated.find((t) => t.startsWith("task:"));
    expect(truncatedEntry).toBeDefined();
    expect(truncatedEntry).not.toBe("scope");
    expect(truncatedEntry!.toLowerCase().includes("scope")).toBe(true);
    // The naive equality rule would find NO exact match and thus wrongly flag "scope" as
    // ungrounded (suppressed) — proving the two rules actually disagree on this input.
    expect(result.value.judgment.truncated.some((t) => t === "scope")).toBe(false);

    // The REAL substring-based detector (findUngroundedAbsenceDimensions, consumed
    // unmodified by suppression) grounds "scope" via this match → the entry survives.
    expect(result.value.dimension_scores?.["scope"]).toBeDefined();
    expect(result.value.dimension_scores?.["scope"]?.score).toBe(30);
    // Consequently no unverifiable[] entry was fabricated for it either.
    expect(result.value.unverifiable?.some((u) => u.material.toLowerCase().includes("scope"))).toBeFalsy();
  });
});

// ─── AC-AEP-8: REGRESSION — 100% truncation branch + gaps/recommendations coherence ─

describe("AC-AEP-8: REGRESSION — the 100%-task-truncation branch still forces inconclusive/omits overall_score, and suppression never corrupts gaps/recommendations", () => {
  it("AC-AEP-8: 100% truncation forces verdict='inconclusive', omits overall_score, and downgrades overall_confidence — even while a dimension_scores entry is suppressed in the same call", async () => {
    const bundle = await makeBundleWithTasks([{ title: "Fully Truncated Task", content: OVER_BUDGET_CONTENT }]);
    const judgeJson = JSON.stringify({
      verdict: "met",
      overall_score: 95,
      ac_scores: [],
      gaps: [],
      recommendations: [],
      dimension_scores: {
        scope_fidelity: { score: 20, confidence: 0.2, based_on: "absence", reasoning: "cannot verify" },
      },
      typed_gaps: [{ dimension: "outcome", severity: "major", statement: "AC-9 has no evidence." }],
      typed_recommendations: [
        { target: "plan", action: "Add a task for AC-9.", rationale: "No task currently covers it." },
      ],
    });
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: judgeJson });
    const service = makeAssessService(provider, SMALL_TASK_BUDGET);

    const result = await service.assessPlan(bundle, { commitDerivationUnverifiable: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Existing SPEC-067 D4 100%-truncation branch — unaffected by suppression running
    // in the same call.
    const truncatedTaskEntries = result.value.judgment.truncated.filter((t) => t.startsWith("task:"));
    expect(truncatedTaskEntries).toHaveLength(1);
    expect(result.value.verdict).toBe("inconclusive");
    expect("overall_score" in result.value).toBe(false);
    expect(result.value.judgment.overall_confidence).toBe("low");
    expect(result.value.judgment.degraded_by_truncation).toBe(true);

    // Suppression still ran and composed correctly alongside the branch above.
    expect(result.value.dimension_scores?.["scope_fidelity"]).toBeUndefined();
    expect(result.value.unverifiable?.some((u) => u.material.toLowerCase().includes("scope_fidelity"))).toBe(true);

    // Regression surface: gaps/recommendations still come from deriveLegacyFindings's
    // projection, coherent and non-empty — suppression touches dimension_scores/
    // unverifiable ONLY, never gaps/recommendations/typed_gaps. A contradictory "(none)"/
    // "no gaps found" summary alongside a real, surviving gap would be exactly the
    // incoherent degradation this AC guards against.
    expect(result.value.gaps).toEqual(["AC-9 has no evidence."]);
    expect(result.value.recommendations).toEqual(["Add a task for AC-9."]);
    expect(result.value.gaps.length).toBeGreaterThan(0);
  });

  it("AC-AEP-8 STATE: without suppression in play, the healthy (non-degraded) branch is unaffected — verdict/overall_score come straight from the judge", async () => {
    const bundle = await makeBundleWithTasks([{ title: "Task One", content: UNDER_BUDGET_CONTENT }]);
    const judgeJson = JSON.stringify({
      verdict: "met",
      overall_score: 92,
      ac_scores: [],
      gaps: ["missing feature X"],
      recommendations: ["implement X"],
      dimension_scores: {
        outcome: { score: 90, confidence: 0.85, based_on: "evidence", reasoning: "strong coverage" },
      },
    });
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: judgeJson });
    const service = makeAssessService(provider);

    const result = await service.assessPlan(bundle, { commitDerivationUnverifiable: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.verdict).toBe("met");
    expect(result.value.overall_score).toBe(92);
    expect(result.value.judgment.overall_confidence).toBeUndefined();
    expect(result.value.judgment.degraded_by_truncation).toBeUndefined();
    expect(result.value.gaps).toEqual(["missing feature X"]);
    expect(result.value.recommendations).toEqual(["implement X"]);
    expect(result.value.dimension_scores?.["outcome"]).toBeDefined();
  });
});

// ─── AC-AEP-11: suppression extends to typed_gaps[] and the legacy gaps[] projection ─

describe("AC-AEP-11: a suppressed dimension's matching typed_gaps entries are also removed, and legacy gaps[] no longer carries the suppressed gap's text", () => {
  it("AC-AEP-11: the typed_gaps entry keyed to the ungrounded dimension is removed, an unrelated dimension's typed_gaps entry survives, and gaps[] no longer contains the suppressed statement", async () => {
    const bundle = await makeBundleWithTasks([{ title: "Task One", content: UNDER_BUDGET_CONTENT }]);
    const judgeJson = JSON.stringify({
      verdict: "partially_met",
      overall_score: 50,
      ac_scores: [],
      gaps: [],
      recommendations: [],
      dimension_scores: {
        scope_fidelity: { score: 20, confidence: 0.2, based_on: "absence", reasoning: "cannot verify" },
        outcome: { score: 80, confidence: 0.8, based_on: "evidence", reasoning: "solid" },
      },
      // No unverifiable[] citing "scope_fidelity" and no truncated[] mentioning it →
      // ungrounded, same fixture shape as AC-AEP-5.
      typed_gaps: [
        {
          dimension: "scope_fidelity",
          severity: "major",
          statement: "diff_available=false. The plan pins exact anchors and cannot be inspected.",
        },
        { dimension: "outcome", severity: "minor", statement: "AC-9 partially covered." },
      ],
    });
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: judgeJson });
    const service = makeAssessService(provider);

    const result = await service.assessPlan(bundle, { commitDerivationUnverifiable: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The dimension_scores row is suppressed — existing T4 mechanism, unaffected.
    expect(result.value.dimension_scores?.["scope_fidelity"]).toBeUndefined();

    // T6: the matching typed_gaps entry must ALSO be removed — not merely the score row —
    // else the finding still publishes via typed_gaps even though dimension_scores says
    // it was suppressed.
    const survivingDimensions = (result.value.typed_gaps ?? []).map((gap) => gap.dimension);
    expect(survivingDimensions).not.toContain("scope_fidelity");
    // An unrelated (evidence-based, non-suppressed) dimension's typed_gaps entry is
    // completely untouched.
    expect(survivingDimensions).toContain("outcome");
    expect(result.value.typed_gaps).toHaveLength(1);

    // The legacy gaps[] projection (deriveLegacyFindings over typed_gaps) must not carry
    // the suppressed gap's text either — this is the "still publishes, twice" bug T6
    // exists to close.
    expect(result.value.gaps.some((g) => g.includes("cannot be inspected"))).toBe(false);
    expect(result.value.gaps).toEqual(["AC-9 partially covered."]);

    // The unverifiable[] entry's own claim ("suppressed... rather than published as a
    // finding") is now actually true: the material is not published anywhere.
    const unverifiable = result.value.unverifiable ?? [];
    expect(unverifiable.some((u) => u.material.toLowerCase().includes("scope_fidelity"))).toBe(true);
  });
});

// ─── AC-AEP-12: CONTROL — grounded/evidence dimensions untouched; no false "clean" reading ─

describe("AC-AEP-12: CONTROL — a grounded absence dimension keeps both rows, evidence dimensions are untouched, and an emptied typed_gaps never implies a clean verdict", () => {
  it("AC-AEP-12: a GROUNDED absence dimension keeps BOTH its dimension_scores row AND its typed_gaps entry", async () => {
    const bundle = await makeBundleWithTasks([{ title: "Task One", content: UNDER_BUDGET_CONTENT }]);
    const judgeJson = JSON.stringify({
      verdict: "partially_met",
      overall_score: 60,
      ac_scores: [],
      gaps: [],
      recommendations: [],
      dimension_scores: {
        scope_fidelity: { score: 20, confidence: 0.2, based_on: "absence", reasoning: "cannot verify" },
      },
      unverifiable: [{ material: "scope_fidelity evidence", reason: "the diff was not provided" }],
      typed_gaps: [{ dimension: "scope_fidelity", severity: "major", statement: "Scope drift suspected." }],
    });
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: judgeJson });
    const service = makeAssessService(provider);

    const result = await service.assessPlan(bundle, { commitDerivationUnverifiable: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.dimension_scores?.["scope_fidelity"]).toBeDefined();
    expect((result.value.typed_gaps ?? []).map((gap) => gap.dimension)).toContain("scope_fidelity");
    expect(result.value.gaps).toEqual(["Scope drift suspected."]);
  });

  it("AC-AEP-12: a based_on='evidence' dimension's typed_gaps entry is never touched", async () => {
    const bundle = await makeBundleWithTasks([{ title: "Task One", content: UNDER_BUDGET_CONTENT }]);
    const judgeJson = JSON.stringify({
      verdict: "met",
      overall_score: 90,
      ac_scores: [],
      gaps: [],
      recommendations: [],
      dimension_scores: {
        outcome: { score: 90, confidence: 0.9, based_on: "evidence", reasoning: "well supported" },
      },
      typed_gaps: [{ dimension: "outcome", severity: "minor", statement: "Small polish item." }],
    });
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: judgeJson });
    const service = makeAssessService(provider);

    const result = await service.assessPlan(bundle, { commitDerivationUnverifiable: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.dimension_scores?.["outcome"]).toBeDefined();
    expect((result.value.typed_gaps ?? []).map((gap) => gap.dimension)).toContain("outcome");
    expect(result.value.gaps).toEqual(["Small polish item."]);
  });

  it("AC-AEP-12 REGRESSION: suppression emptying typed_gaps entirely does not corrupt verdict into a false clean reading", async () => {
    const bundle = await makeBundleWithTasks([{ title: "Task One", content: UNDER_BUDGET_CONTENT }]);
    const judgeJson = JSON.stringify({
      verdict: "partially_met",
      overall_score: 40,
      ac_scores: [],
      gaps: [],
      recommendations: [],
      dimension_scores: {
        scope_fidelity: { score: 20, confidence: 0.2, based_on: "absence", reasoning: "cannot verify" },
      },
      // The ONLY typed gap is on the dimension that gets suppressed — after T6's fix,
      // typed_gaps/gaps both become empty in this response.
      typed_gaps: [
        { dimension: "scope_fidelity", severity: "major", statement: "Only gap, on the suppressed dimension." },
      ],
    });
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: judgeJson });
    const service = makeAssessService(provider);

    const result = await service.assessPlan(bundle, { commitDerivationUnverifiable: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // typed_gaps/gaps are correctly emptied by suppression...
    expect(result.value.typed_gaps).toEqual([]);
    expect(result.value.gaps).toEqual([]);

    // ...but the verdict is NOT rewritten to "met" (or otherwise silently upgraded) as a
    // side effect of the gaps list becoming empty — the judge's own (unresolved) verdict
    // passes through untouched, and an unverifiable[] entry stays present recording that
    // something could not be judged. An empty gaps[] here means "the one gap we had was
    // ungrounded and suppressed", never "nothing wrong was found".
    expect(result.value.verdict).toBe("partially_met");
    expect(result.value.unverifiable?.some((u) => u.material.toLowerCase().includes("scope_fidelity"))).toBe(true);
  });
});
