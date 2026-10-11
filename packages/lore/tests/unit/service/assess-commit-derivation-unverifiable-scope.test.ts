/**
 * Tests for task-lore-assess-derives-a-plan-s-commits-by-grepping-task AC #3 — a
 * DETERMINISTIC, service-layer floor that forbids `scope_fidelity` from ever being
 * PUBLISHED as a scored dimension when the plan's diff/commit-set derivation landed in the
 * `"unverifiable_convention_mismatch"` state (assess-commit-derivation.ts). Enforced via a
 * new `assessPlan(bundle, { commitDerivationUnverifiable: true })` opt — NEVER by editing
 * the prompt template (`../ai/assess-template.ts` is out of this task's scope; a sibling
 * task owns it), and NEVER merely a warning: the entry is REMOVED from the persisted
 * record, exactly as `suppressUngroundedAbsenceFindings` (T6, spec-lore-assess-project-
 * evidence-rows-instead-of-embedding-the) already does for judge-self-reported ungrounded
 * absence claims — this is the SAME shape of floor, but ground-truth-driven (the CLI/MCP
 * call site already KNOWS the derivation could not be verified; the judge is never
 * consulted or trusted to self-report that fact).
 *
 * Mirrors the existing pattern in assess-absence-suppression.test.ts (scripted
 * InMemoryAIProvider, no real AI calls, no bun:sqlite — plain vitest).
 *
 * Spec-first expectations (task's own Oracle / ADR three-question review section):
 *   - AC #3: absence-based scoring of scope_fidelity is FORBIDDEN in that state — the
 *     dimension is not scored at all, and the persisted record says so in those words
 *     ("not scored").
 *   - AC #4: the forced-unverifiable outcome is a DISTINCT, assert-by-value state, never
 *     conflated with the pre-existing T6 grounding-based suppression.
 *
 * ⛔ `commitDerivationUnverifiable` is now a REQUIRED field on `assessPlan`'s `opts`
 * (task-the-mcp-assess-adapter-still-calls-derivecommitsetforplan mechanizes the ADR's Q3
 * "Opt-in" closure) — there is no longer a compiling call site that OMITS it. The CONTROL
 * case below, previously exercised by omitting the field entirely, is now exercised by
 * passing it explicitly as `false` — the exact value omission used to default to, so the
 * asserted BEHAVIOR is unchanged even though the TypeScript shape that expresses it is not.
 *
 * Six-dimension coverage:
 *   HAPPY:      the judge scores scope_fidelity absence-based DESPITE the flag — it is
 *               forcibly removed and an explicit "not scored" unverifiable[] entry is
 *               added, regardless of what the judge itself cited.
 *   CONTROL:    the SAME judge response with the flag explicitly `false` keeps the existing
 *               (pre-existing) grounding-based behavior unchanged (no new suppression) —
 *               proves this is an ADDITIVE floor, not a behavior change to the default path.
 *   BOUNDARY:   the judge scores scope_fidelity EVIDENCE-based (not absence) while the
 *               flag is set — still forcibly removed (the state itself, not the judge's
 *               `based_on` label, is what disqualifies the dimension: no diff exists to
 *               ground ANY scope_fidelity claim in this state).
 *   NEGATIVE:   the judge emits no scope_fidelity dimension at all while the flag is set —
 *               a pure no-op, no unverifiable[] entry fabricated for a dimension that was
 *               never scored in the first place.
 *   STATE:      the matching typed_gaps[] entry (dimension: "scope_fidelity") is ALSO
 *               removed when the flag forces suppression, and the legacy gaps[]
 *               projection derived from typed_gaps no longer carries its text — mirrors
 *               T6's typed_gaps-join precedent exactly.
 *   REGRESSION: an unrelated dimension's score/typed_gaps entry is completely untouched,
 *               and the T6 grounding-based suppression still fires independently for that
 *               OTHER dimension in the SAME call (both mechanisms compose correctly).
 *
 * @spec_ref task-lore-assess-derives-a-plan-s-commits-by-grepping-task
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
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

async function makeBundleWithOneTask(): Promise<PlanBundle> {
  const store = new InMemoryStore();
  const corpusService = new CorpusService(store, new RecordLockService(store));
  const planResult = await corpusService.create({
    type: "plan",
    title: "Commit Derivation Unverifiable Test Plan",
    content: "Plan goals.",
  } as CreateDocInput);
  if (!planResult.ok) throw new Error("plan create failed");

  const taskResult = await corpusService.create({
    type: "task",
    title: "Only Task",
    parent_id: planResult.value.id,
    content: "ok",
    extra: { plan_id: planResult.value.id },
  } as CreateDocInput);
  if (!taskResult.ok) throw new Error("task create failed");

  const bundleResult = await corpusService.getPlanBundle(planResult.value.id);
  if (!bundleResult.ok) throw new Error("getPlanBundle failed");
  return bundleResult.value;
}

// ─── HAPPY: absence-based scope_fidelity is forcibly removed when the flag is set ───

describe("commitDerivationUnverifiable: HAPPY — an absence-based scope_fidelity score is forcibly removed with a 'not scored' unverifiable[] entry", () => {
  it("removes dimension_scores.scope_fidelity and adds an unverifiable[] entry containing the literal words 'not scored', regardless of the judge's own citations", async () => {
    const bundle = await makeBundleWithOneTask();
    const judgeJson = JSON.stringify({
      verdict: "partially_met",
      overall_score: 50,
      ac_scores: [],
      gaps: [],
      recommendations: [],
      dimension_scores: {
        scope_fidelity: { score: 20, confidence: 0.2, based_on: "absence", reasoning: "cannot verify" },
      },
    });
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: judgeJson });
    const service = makeAssessService(provider);

    const result = await service.assessPlan(bundle, { commitDerivationUnverifiable: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.dimension_scores?.["scope_fidelity"]).toBeUndefined();
    const unverifiable = result.value.unverifiable ?? [];
    const scopeEntry = unverifiable.find((u) => u.material.toLowerCase().includes("scope_fidelity"));
    expect(scopeEntry).toBeDefined();
    // AC #3: "the dimension is not scored at all" — literal words, asserted by value.
    expect(scopeEntry?.reason.toLowerCase()).toContain("not scored");
  });
});

// ─── CONTROL: flag explicitly false leaves the pre-existing (T6) behavior unchanged ─

describe("commitDerivationUnverifiable: CONTROL — the flag explicitly false never triggers this floor; T6's own grounding rule still governs", () => {
  it("with the flag explicitly false, an ungrounded absence-based scope_fidelity score is STILL suppressed by the pre-existing T6 rule (unrelated mechanism, same net removal) but with T6's own reason text, not this floor's", async () => {
    const bundle = await makeBundleWithOneTask();
    const judgeJson = JSON.stringify({
      verdict: "partially_met",
      overall_score: 50,
      ac_scores: [],
      gaps: [],
      recommendations: [],
      dimension_scores: {
        scope_fidelity: { score: 20, confidence: 0.2, based_on: "absence", reasoning: "cannot verify" },
      },
    });
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: judgeJson });
    const service = makeAssessService(provider);

    const result = await service.assessPlan(bundle, { commitDerivationUnverifiable: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.dimension_scores?.["scope_fidelity"]).toBeUndefined();
    const scopeEntry = (result.value.unverifiable ?? []).find((u) => u.material.toLowerCase().includes("scope_fidelity"));
    expect(scopeEntry).toBeDefined();
    // T6's own reason text (ungrounded-absence heuristic) — NOT this floor's "not scored"
    // wording, proving the two mechanisms are independent, not merged into one.
    expect(scopeEntry?.reason.toLowerCase()).toContain("ungrounded");
    expect(scopeEntry?.reason.toLowerCase()).not.toContain("not scored");
  });

  it("with the flag explicitly false, a GROUNDED absence-based scope_fidelity score survives untouched (this floor never fires)", async () => {
    const bundle = await makeBundleWithOneTask();
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
    expect(result.value.dimension_scores?.["scope_fidelity"]?.score).toBe(20);
    expect(result.value.unverifiable).toHaveLength(1);
  });
});

// ─── BOUNDARY: the state itself disqualifies the dimension, not the judge's based_on label ─

describe("commitDerivationUnverifiable: BOUNDARY — an EVIDENCE-based scope_fidelity score is still forcibly removed (the state, not based_on, disqualifies it)", () => {
  it("removes an evidence-based scope_fidelity score too — no diff exists in this state to ground ANY scope_fidelity claim", async () => {
    const bundle = await makeBundleWithOneTask();
    const judgeJson = JSON.stringify({
      verdict: "met",
      overall_score: 90,
      ac_scores: [],
      gaps: [],
      recommendations: [],
      dimension_scores: {
        scope_fidelity: { score: 85, confidence: 0.85, based_on: "evidence", reasoning: "looks fine" },
      },
    });
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: judgeJson });
    const service = makeAssessService(provider);

    const result = await service.assessPlan(bundle, { commitDerivationUnverifiable: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.dimension_scores?.["scope_fidelity"]).toBeUndefined();
    expect(result.value.unverifiable?.some((u) => u.material.toLowerCase().includes("scope_fidelity"))).toBe(true);
  });
});

// ─── NEGATIVE: no scope_fidelity emitted at all — pure no-op ────────────────────────

describe("commitDerivationUnverifiable: NEGATIVE — no scope_fidelity dimension emitted at all is a no-op", () => {
  it("adds no unverifiable[] entry when the judge never scored scope_fidelity in the first place", async () => {
    const bundle = await makeBundleWithOneTask();
    const judgeJson = JSON.stringify({
      verdict: "met",
      overall_score: 90,
      ac_scores: [],
      gaps: [],
      recommendations: [],
      dimension_scores: {
        outcome: { score: 90, confidence: 0.9, based_on: "evidence", reasoning: "solid" },
      },
    });
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: judgeJson });
    const service = makeAssessService(provider);

    const result = await service.assessPlan(bundle, { commitDerivationUnverifiable: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.dimension_scores?.["outcome"]).toBeDefined();
    expect(result.value.unverifiable).toBeUndefined();
  });
});

// ─── STATE: typed_gaps[] and the legacy gaps[] projection are also cleared ──────────

describe("commitDerivationUnverifiable: STATE — the matching typed_gaps[] entry is also removed, and legacy gaps[] no longer carries its text", () => {
  it("removes the scope_fidelity typed_gaps entry and its legacy gaps[] projection, while an unrelated dimension's typed_gaps entry survives untouched", async () => {
    const bundle = await makeBundleWithOneTask();
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

    const result = await service.assessPlan(bundle, { commitDerivationUnverifiable: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const survivingDimensions = (result.value.typed_gaps ?? []).map((gap) => gap.dimension);
    expect(survivingDimensions).not.toContain("scope_fidelity");
    expect(survivingDimensions).toContain("outcome");
    expect(result.value.typed_gaps).toHaveLength(1);

    // task-t6 precedent: the legacy gaps[] projection must not carry the removed
    // statement's text either — a "still publishes, twice" regression.
    expect(result.value.gaps.some((g) => g.includes("cannot be inspected"))).toBe(false);
    expect(result.value.gaps).toEqual(["AC-9 partially covered."]);
  });
});

// ─── REGRESSION: the two suppression mechanisms compose without interfering ────────

describe("commitDerivationUnverifiable: REGRESSION — composes correctly alongside T6's independent grounding-based suppression on a different dimension in the same call", () => {
  it("this floor removes scope_fidelity (forced) while T6's grounding rule independently removes an ungrounded absence-based outcome score in the SAME call", async () => {
    const bundle = await makeBundleWithOneTask();
    const judgeJson = JSON.stringify({
      verdict: "partially_met",
      overall_score: 40,
      ac_scores: [],
      gaps: [],
      recommendations: [],
      dimension_scores: {
        scope_fidelity: { score: 20, confidence: 0.2, based_on: "absence", reasoning: "cannot verify" },
        outcome: { score: 10, confidence: 0.1, based_on: "absence", reasoning: "no basis" },
      },
    });
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: judgeJson });
    const service = makeAssessService(provider);

    const result = await service.assessPlan(bundle, { commitDerivationUnverifiable: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Both dimensions removed — by two DIFFERENT, independent mechanisms.
    expect(result.value.dimension_scores).toBeUndefined();
    const unverifiable = result.value.unverifiable ?? [];
    const scopeEntry = unverifiable.find((u) => u.material.toLowerCase().includes("scope_fidelity"));
    const outcomeEntry = unverifiable.find((u) => u.material.toLowerCase().includes("outcome"));
    expect(scopeEntry?.reason.toLowerCase()).toContain("not scored");
    expect(outcomeEntry?.reason.toLowerCase()).toContain("ungrounded");
  });
});
