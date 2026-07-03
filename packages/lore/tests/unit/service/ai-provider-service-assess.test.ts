/**
 * Tests for AIProviderService.assessPlan (SPEC-026 §3 D1, D2; §4 AC-ASSESS-1..7).
 *
 * Strategy: InMemoryStore + real CorpusService.getPlanBundle assembles the PlanBundle
 * (dogfoods the same bundle-building path production code uses) — InMemoryAIProvider in
 * "sequence" mode (SPEC-026 D9) scripts the corrective-retry protocol deterministically.
 * No real provider spawn, no bun:sqlite.
 *
 * Spec-first expectations (SPEC-026 §3 D2, D7; §4 AC-ASSESS-3, AC-ASSESS-4, AC-ASSESS-7; §7):
 *   - First response malformed, second valid → ok, judgment.retried = true (AC-ASSESS-3)
 *   - Both responses malformed → AI_PROVIDER_ERROR with a <=500-char raw-output prefix,
 *     and — because assessPlan never touches the store itself — the store's doc count is
 *     provably unchanged after a double-malformed run (AC-ASSESS-4)
 *   - A transport-level provider error (not a parse failure) does NOT trigger the corrective
 *     retry — only one provider.generate() call is made
 *   - Telemetry emits exactly once on both the retry-success path and the double-malformed
 *     failure path (not once per attempt)
 *   - The rendered prompt carries the plan bundle's evidence trail (oracle/command/result
 *     markers), spec ACs, and task titles — captured via provider.calls[0].prompt
 *   - Sections exceeding their configured char budget appear in judgment.truncated (AC-ASSESS-7)
 *
 * Adversarial angles:
 *   - retried must be exactly true only when a corrective round-trip actually happened —
 *     not true by default, not true on transport errors
 *   - emit must be called ONCE (not twice) even though two provider.generate() calls happen
 *     on the retry path — a "1 emit per attempt" bug would silently double telemetry volume
 *   - double-malformed must NOT create any document — this is asserted by proving assessPlan
 *     itself never calls store.insert (doc count identical pre/post)
 *   - truncated[] must name the actual over-budget section, not a hardcoded list
 *
 * @spec_ref AC-ASSESS-2, AC-ASSESS-3, AC-ASSESS-4, AC-ASSESS-7
 */

import { describe, it, expect, vi } from "vitest";
import { AIProviderService } from "../../../src/service/ai-provider-service.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { InMemoryAIProvider } from "../../../src/ai/in-memory-provider.js";
import type { Telemetry, TelemetryEvent, AiGenerationEvent, CreateDocInput, PlanBundle } from "@lore/core";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeMockTelemetry() {
  const emitCalls: AiGenerationEvent[] = [];
  const telemetry: Telemetry = {
    record: vi.fn((_event: TelemetryEvent) => {}),
    emit: vi.fn((event: AiGenerationEvent) => {
      emitCalls.push(event);
    }),
    close: vi.fn(),
  };
  return { telemetry, emitCalls };
}

const DEFAULT_BUDGETS = { max_plan_chars: 8000, max_spec_chars: 12000, max_task_chars: 4000, max_diff_chars: 24000 };

function makeAssessService(opts: {
  provider: InMemoryAIProvider;
  aiTelemetryEnabled?: boolean;
  budgets?: typeof DEFAULT_BUDGETS;
}) {
  const { telemetry, emitCalls } = makeMockTelemetry();
  const providers = new Map([[opts.provider.name, opts.provider]]) as unknown as ReadonlyMap<
    string,
    import("@lore/core").AIProvider
  >;
  const service = new AIProviderService(
    providers,
    opts.provider.name,
    {},
    telemetry,
    opts.aiTelemetryEnabled ?? true,
    8000,
    opts.budgets ?? DEFAULT_BUDGETS,
  );
  return { service, telemetry, emitCalls };
}

const VALID_JSON = JSON.stringify({
  verdict: "met",
  overall_score: 90,
  ac_scores: [{ ac_id: "AC-ASSESS-1", score: 90, reasoning: "Looks good", evidence_refs: [] }],
  gaps: [],
  recommendations: [],
});

/** Builds a real PlanBundle via CorpusService.getPlanBundle — same path production uses. */
async function makeBundle(store: InMemoryStore): Promise<PlanBundle> {
  const corpusService = new CorpusService(store);

  const prdResult = await corpusService.create({
    type: "prd",
    title: "Assess Test PRD",
    content: "Root PRD for assess tests.",
  } as CreateDocInput);
  if (!prdResult.ok) throw new Error("prd create failed");

  const specResult = await corpusService.create({
    type: "spec",
    title: "Assess Test Spec",
    parent_id: prdResult.value.id,
    content: "## Acceptance Criteria\n\n**AC-ASSESS-1** Something must happen.\n",
  } as CreateDocInput);
  if (!specResult.ok) throw new Error("spec create failed");

  const planResult = await corpusService.create({
    type: "plan",
    title: "Assess Test Plan",
    parent_id: specResult.value.id,
    content: "Plan goals and phases.",
  } as CreateDocInput);
  if (!planResult.ok) throw new Error("plan create failed");

  const taskResult = await corpusService.create({
    type: "task",
    title: "Implement the thing",
    parent_id: planResult.value.id,
    content: "Task body describing the work.",
    extra: {
      plan_id: planResult.value.id,
      verification_evidence: [
        {
          oracle: "tsc",
          command: "bun run typecheck",
          result: "pass",
          recorded_at: "2026-07-01T00:00:00.000Z",
          recorded_by: "alice",
        },
      ],
    },
  } as CreateDocInput);
  if (!taskResult.ok) throw new Error("task create failed");

  const bundleResult = await corpusService.getPlanBundle(planResult.value.id);
  if (!bundleResult.ok) throw new Error("getPlanBundle failed");
  return bundleResult.value;
}

// ─── AC-ASSESS-3: corrective retry success ────────────────────────────────────

describe("assessPlan — corrective retry success (AC-ASSESS-3, D9)", () => {
  it("first malformed, second valid → ok with judgment.retried = true", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", {
      kind: "sequence",
      responses: [{ kind: "ok", content: "not valid json at all" }, { kind: "ok", content: VALID_JSON }],
    });
    const { service } = makeAssessService({ provider });

    const result = await service.assessPlan(bundle, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.judgment.retried).toBe(true);
  });

  it("a same-attempt success (no malformed first response) has judgment.retried = false, not true by default", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_JSON });
    const { service } = makeAssessService({ provider });

    const result = await service.assessPlan(bundle, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.judgment.retried).toBe(false);
  });

  it("the retry prompt embeds the original prompt content plus a correction notice", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", {
      kind: "sequence",
      responses: [{ kind: "ok", content: "garbage, not json" }, { kind: "ok", content: VALID_JSON }],
    });
    const { service } = makeAssessService({ provider });

    await service.assessPlan(bundle, {});
    expect(provider.calls).toHaveLength(2);
    const retryPrompt = provider.calls[1]?.prompt ?? "";
    expect(retryPrompt).toContain("Correction Required");
    // Original materials must still be present in the retry prompt (not a bare error message).
    expect(retryPrompt).toContain(bundle.plan.title);
  });

  it("exactly 2 provider calls happen on the retry path, not 1 or 3", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", {
      kind: "sequence",
      responses: [{ kind: "ok", content: "garbage" }, { kind: "ok", content: VALID_JSON }],
    });
    const { service } = makeAssessService({ provider });

    await service.assessPlan(bundle, {});
    expect(provider.calls).toHaveLength(2);
  });
});

// ─── AC-ASSESS-4: double-malformed failure, no doc side effects ──────────────

describe("assessPlan — double-malformed failure (AC-ASSESS-4)", () => {
  it("both responses malformed → AI_PROVIDER_ERROR", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", {
      kind: "sequence",
      responses: [{ kind: "ok", content: "still not json" }, { kind: "ok", content: "still not json, second try" }],
    });
    const { service } = makeAssessService({ provider });

    const result = await service.assessPlan(bundle, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("AI_PROVIDER_ERROR");
  });

  it("error message's raw-output prefix is capped at 500 chars", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundle(store);
    const longGarbage = "not json ".repeat(200); // 1800 chars, well over 500
    const provider = new InMemoryAIProvider("in-memory", {
      kind: "sequence",
      responses: [{ kind: "ok", content: "not json" }, { kind: "ok", content: longGarbage }],
    });
    const { service } = makeAssessService({ provider });

    const result = await service.assessPlan(bundle, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // message = fixed prefix text + up to 500 chars of raw output — the raw slice
    // itself must not exceed 500 chars, so it cannot contain the full 1800-char string.
    expect("message" in result.error ? result.error.message : "").not.toContain(longGarbage);
  });

  it("assessPlan never calls store.insert — double-malformed leaves the store's doc count unchanged", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundle(store);
    const beforeResult = await store.findMany({});
    if (!beforeResult.ok) throw new Error("findMany failed");
    const beforeCount = beforeResult.value.length;

    const provider = new InMemoryAIProvider("in-memory", {
      kind: "sequence",
      responses: [{ kind: "ok", content: "garbage one" }, { kind: "ok", content: "garbage two" }],
    });
    const { service } = makeAssessService({ provider });
    await service.assessPlan(bundle, {});

    const afterResult = await store.findMany({});
    if (!afterResult.ok) throw new Error("findMany failed");
    expect(afterResult.value.length).toBe(beforeCount);
  });

  it("a transport-level provider error (not a parse failure) does NOT trigger a corrective retry", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", {
      kind: "err",
      error: { code: "AI_PROVIDER_ERROR", provider: "in-memory", message: "binary missing" },
    });
    const { service } = makeAssessService({ provider });

    const result = await service.assessPlan(bundle, {});
    expect(result.ok).toBe(false);
    // Only ONE call — a transport error is not a "malformed JSON" retry trigger.
    expect(provider.calls).toHaveLength(1);
  });
});

// ─── Telemetry exactly-once (SPEC-026 §3 D10) ────────────────────────────────

describe("assessPlan — telemetry exactly-once on every terminal outcome (D10)", () => {
  it("success via retry: emit is called exactly once, not once per attempt", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", {
      kind: "sequence",
      responses: [{ kind: "ok", content: "garbage" }, { kind: "ok", content: VALID_JSON }],
    });
    const { service, emitCalls } = makeAssessService({ provider });

    await service.assessPlan(bundle, {});
    expect(emitCalls).toHaveLength(1);
  });

  it("double-malformed failure: emit is called exactly once, not zero and not twice", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", {
      kind: "sequence",
      responses: [{ kind: "ok", content: "garbage" }, { kind: "ok", content: "still garbage" }],
    });
    const { service, emitCalls } = makeAssessService({ provider });

    await service.assessPlan(bundle, {});
    expect(emitCalls).toHaveLength(1);
  });

  it("single-attempt success: emit is called exactly once", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_JSON });
    const { service, emitCalls } = makeAssessService({ provider });

    await service.assessPlan(bundle, {});
    expect(emitCalls).toHaveLength(1);
  });

  it("emitted event's kind is 'assess' (not mistakenly tagged as create/regenerate)", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_JSON });
    const { service, emitCalls } = makeAssessService({ provider });

    await service.assessPlan(bundle, {});
    expect(emitCalls[0]?.kind).toBe("assess");
  });

  it("aiTelemetryEnabled=false silences emit entirely, even on the retry-success path", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", {
      kind: "sequence",
      responses: [{ kind: "ok", content: "garbage" }, { kind: "ok", content: VALID_JSON }],
    });
    const { service, telemetry } = makeAssessService({ provider, aiTelemetryEnabled: false });

    await service.assessPlan(bundle, {});
    expect(telemetry.emit).not.toHaveBeenCalled();
  });
});

// ─── AC-ASSESS-2: prompt carries plan/spec/task evidence materials ──────────

describe("assessPlan — prompt content carries the plan bundle's materials (AC-ASSESS-2)", () => {
  it("prompt contains the plan title and content", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_JSON });
    const { service } = makeAssessService({ provider });

    await service.assessPlan(bundle, {});
    const prompt = provider.calls[0]?.prompt ?? "";
    expect(prompt).toContain(bundle.plan.title);
    expect(prompt).toContain("Plan goals and phases.");
  });

  it("prompt contains the linked spec's AC section verbatim", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_JSON });
    const { service } = makeAssessService({ provider });

    await service.assessPlan(bundle, {});
    const prompt = provider.calls[0]?.prompt ?? "";
    expect(prompt).toContain("AC-ASSESS-1");
    expect(prompt).toContain("Something must happen.");
  });

  it("prompt contains the task's evidence trail: oracle, command, and result markers", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_JSON });
    const { service } = makeAssessService({ provider });

    await service.assessPlan(bundle, {});
    const prompt = provider.calls[0]?.prompt ?? "";
    expect(prompt).toContain("oracle=tsc");
    expect(prompt).toContain('command="bun run typecheck"');
    expect(prompt).toContain("result=pass");
    expect(prompt).toContain("recorder=alice");
  });

  it("prompt contains the task's title", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_JSON });
    const { service } = makeAssessService({ provider });

    await service.assessPlan(bundle, {});
    const prompt = provider.calls[0]?.prompt ?? "";
    expect(prompt).toContain("Implement the thing");
  });

  it("diffText, when provided, appears in the prompt", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_JSON });
    const { service } = makeAssessService({ provider });

    await service.assessPlan(bundle, { diffText: "diff --git a/foo.ts b/foo.ts\n+added line\n" });
    const prompt = provider.calls[0]?.prompt ?? "";
    expect(prompt).toContain("added line");
  });

  it("a task with NO evidence renders '(no evidence recorded)', not a crash or blank section", async () => {
    const store = new InMemoryStore();
    const corpusService = new CorpusService(store);
    const planResult = await corpusService.create({ type: "plan", title: "No-Evidence Plan", content: "x" } as CreateDocInput);
    if (!planResult.ok) throw new Error("plan create failed");
    const taskResult = await corpusService.create({
      type: "task",
      title: "Task Without Evidence",
      parent_id: planResult.value.id,
      content: "y",
      extra: { plan_id: planResult.value.id },
    } as CreateDocInput);
    if (!taskResult.ok) throw new Error("task create failed");
    const bundleResult = await corpusService.getPlanBundle(planResult.value.id);
    if (!bundleResult.ok) throw new Error("getPlanBundle failed");

    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_JSON });
    const { service } = makeAssessService({ provider });
    await service.assessPlan(bundleResult.value, {});
    const prompt = provider.calls[0]?.prompt ?? "";
    expect(prompt).toContain("(no evidence recorded)");
  });
});

// ─── AC-ASSESS-7: budget truncation ──────────────────────────────────────────

describe("assessPlan — budget truncation is recorded in judgment.truncated (AC-ASSESS-7)", () => {
  it("a plan content over budget is truncated and 'plan' appears in judgment.truncated", async () => {
    const store = new InMemoryStore();
    const corpusService = new CorpusService(store);
    const longContent = "x".repeat(500);
    const planResult = await corpusService.create({ type: "plan", title: "Long Plan", content: longContent } as CreateDocInput);
    if (!planResult.ok) throw new Error("plan create failed");
    const taskResult = await corpusService.create({
      type: "task",
      title: "Some Task",
      parent_id: planResult.value.id,
      content: "task body",
      extra: { plan_id: planResult.value.id },
    } as CreateDocInput);
    if (!taskResult.ok) throw new Error("task create failed");
    const bundleResult = await corpusService.getPlanBundle(planResult.value.id);
    if (!bundleResult.ok) throw new Error("getPlanBundle failed");

    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_JSON });
    const { service } = makeAssessService({
      provider,
      budgets: { max_plan_chars: 50, max_spec_chars: 12000, max_task_chars: 4000, max_diff_chars: 24000 },
    });

    const result = await service.assessPlan(bundleResult.value, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.judgment.truncated).toContain("plan");
  });

  it("when nothing exceeds budget, judgment.truncated is an empty array, not omitted or null", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_JSON });
    const { service } = makeAssessService({ provider });

    const result = await service.assessPlan(bundle, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.judgment.truncated).toEqual([]);
  });

  it("a task content over its own (smaller) budget is truncated and named 'task:<slug>', distinct from the plan budget", async () => {
    const store = new InMemoryStore();
    const corpusService = new CorpusService(store);
    const planResult = await corpusService.create({ type: "plan", title: "Task Budget Plan", content: "short plan" } as CreateDocInput);
    if (!planResult.ok) throw new Error("plan create failed");
    const longTaskContent = "y".repeat(200);
    const taskResult = await corpusService.create({
      type: "task",
      title: "Long Task",
      parent_id: planResult.value.id,
      content: longTaskContent,
      extra: { plan_id: planResult.value.id },
    } as CreateDocInput);
    if (!taskResult.ok) throw new Error("task create failed");
    const bundleResult = await corpusService.getPlanBundle(planResult.value.id);
    if (!bundleResult.ok) throw new Error("getPlanBundle failed");

    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_JSON });
    const { service } = makeAssessService({
      provider,
      budgets: { max_plan_chars: 8000, max_spec_chars: 12000, max_task_chars: 20, max_diff_chars: 24000 },
    });

    const result = await service.assessPlan(bundleResult.value, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.judgment.truncated.some((s) => s.startsWith("task:"))).toBe(true);
    // Plan content is short (well under 8000) — it must NOT appear in truncated.
    expect(result.value.judgment.truncated).not.toContain("plan");
  });
});

// ─── SPEC-028 AC-AE-3 / AC-AE-4: diff-section truncation uses truncateDiffByFile ────
//
// Chosen at the service layer (not the CLI bun-test layer) per SPEC-028 task dispatch:
// InMemoryAIProvider + a real assessPlan() call exercises the exact same
// buildAssessPrompt → truncateDiffByFile wiring the CLI uses, without the overhead of a
// real SQLite DB + subprocess spawn — faster and just as end-to-end for what matters here
// (does `judgment.truncated` carry "diff:<path>" markers, not the old bare "diff" string).

describe("assessPlan — diff-section truncation is file-boundary-aware (SPEC-028 AC-AE-3, AC-AE-4)", () => {
  const srcDiffChunk = `diff --git a/src/foo.ts b/src/foo.ts\nindex 1..2 100644\n--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1,1 +1,1 @@\n${"+".repeat(50)}`;
  const docsDiffChunk = `diff --git a/docs/readme.md b/docs/readme.md\nindex 1..2 100644\n--- a/docs/readme.md\n+++ b/docs/readme.md\n@@ -1,1 +1,1 @@\n${"+".repeat(50)}`;

  it("an oversized diff records 'diff:<path>' entries for each dropped file, NOT the old bare 'diff' marker (AC-AE-3)", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundle(store);
    const diffText = `${srcDiffChunk}\n${docsDiffChunk}`;
    // Budget fits the src/ chunk alone (higher priority) but not the docs chunk too.
    const budgets = { ...DEFAULT_BUDGETS, max_diff_chars: srcDiffChunk.length + 10 };
    expect(diffText.length).toBeGreaterThan(budgets.max_diff_chars); // sanity: must actually truncate

    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_JSON });
    const { service } = makeAssessService({ provider, budgets });

    const result = await service.assessPlan(bundle, { diffText });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.judgment.truncated).toContain("diff:docs/readme.md");
    // The old opaque single "diff" marker must NOT appear — SPEC-028 replaced it with
    // per-file "diff:<path>" entries.
    expect(result.value.judgment.truncated).not.toContain("diff");

    // The src/ file (higher priority) must have survived into the actual prompt sent.
    const prompt = provider.calls[0]?.prompt ?? "";
    expect(prompt).toContain("src/foo.ts");
  });

  it("a diff within budget produces zero 'diff:*' entries in judgment.truncated (AC-AE-4 no-op)", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundle(store);
    // Well within the default 24000-char max_diff_chars budget.
    const diffText = "diff --git a/foo.ts b/foo.ts\n+added line\n";
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_JSON });
    const { service } = makeAssessService({ provider });

    const result = await service.assessPlan(bundle, { diffText });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.judgment.truncated.some((s) => s.startsWith("diff:"))).toBe(false);
    expect(result.value.judgment.truncated).toEqual([]);
  });
});
