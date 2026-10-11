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

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { describe, it, expect, vi } from "vitest";
import { AIProviderService } from "../../../src/service/ai-provider-service.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { InMemoryAIProvider } from "../../../src/ai/in-memory-provider.js";
import { ASSESS_PROMPT_VERSION, buildAssessPrompt, buildAssessRetryPrompt } from "../../../src/ai/assess-template.js";
import type { Telemetry, TelemetryEvent, AiGenerationEvent, CreateDocInput, PlanBundle } from "@lore/core";
import { renderAssessmentContent } from "@lore/core";

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
  const corpusService = new CorpusService(store, new RecordLockService(store));

  const prdResult = await corpusService.create({
    type: "prd",
    title: "Assess Test PRD",
    content: "Root PRD for assess tests.",
  } as CreateDocInput);
  if (!prdResult.ok) throw new Error("prd create failed");

  const specResult = await corpusService.create({
    type: "spec",
    title: "Assess Test Spec",
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

/**
 * Builds a PlanBundle whose linked spec declares SPEC-038 structured `extra.acceptance_criteria`
 * (two criteria: one script-mode, one ai-mode) — the fixture for every structured-AC test below.
 * Mirrors makeBundle's construction path (real CorpusService + InMemoryStore) but adds the
 * `extra.acceptance_criteria` array on the spec's CreateDocInput.
 */
async function makeStructuredAcBundle(store: InMemoryStore): Promise<PlanBundle> {
  const corpusService = new CorpusService(store, new RecordLockService(store));

  const prdResult = await corpusService.create({
    type: "prd",
    title: "Structured AC Test PRD",
    content: "Root PRD for structured-AC assess tests.",
  } as CreateDocInput);
  if (!prdResult.ok) throw new Error("prd create failed");

  const specResult = await corpusService.create({
    type: "spec",
    title: "Structured AC Test Spec",
    content: "Spec body prose (unused when structured ACs are declared — the table replaces it).",
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
    title: "Structured AC Test Plan",
    parent_id: specResult.value.id,
    content: "Plan goals for the structured-AC widget feature.",
  } as CreateDocInput);
  if (!planResult.ok) throw new Error("plan create failed");

  const taskResult = await corpusService.create({
    type: "task",
    title: "Implement the widget",
    parent_id: planResult.value.id,
    content: "Task body describing the widget work.",
    extra: {
      plan_id: planResult.value.id,
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

/**
 * Builds a PlanBundle whose structured ACs carry a MIX of runner-attested and
 * self-reported evidence (SPEC-039 §2 D8, AC-VRF-9) — the fixture for the attested-
 * annotation prompt tests below. AC-X-1 gets two `pass` entries (one attestation-bearing
 * "lore-cli" runner record, one plain self-report — deliberately zero fail entries so the
 * rendered cell matches the spec's own worked example verbatim: "2 pass (1 attested), 0
 * fail"); AC-X-2 gets a single self-reported pass with no attestation at all, so the same
 * table also exercises the "no annotation when attested count is zero" branch — this is
 * the "attested/unattested mix" the task calls for, in one bundle.
 */
async function makeAttestedStructuredAcBundle(store: InMemoryStore): Promise<PlanBundle> {
  const corpusService = new CorpusService(store, new RecordLockService(store));

  const prdResult = await corpusService.create({
    type: "prd",
    title: "Attested Coverage Test PRD",
    content: "Root PRD for attested-coverage assess tests.",
  } as CreateDocInput);
  if (!prdResult.ok) throw new Error("prd create failed");

  const specResult = await corpusService.create({
    type: "spec",
    title: "Attested Coverage Test Spec",
    content: "Spec body prose (unused — structured ACs replace it).",
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
    title: "Attested Coverage Test Plan",
    parent_id: specResult.value.id,
    content: "Plan goals for the attested-coverage widget feature.",
  } as CreateDocInput);
  if (!planResult.ok) throw new Error("plan create failed");

  const taskResult = await corpusService.create({
    type: "task",
    title: "Implement the widget",
    parent_id: planResult.value.id,
    content: "Task body describing the widget work.",
    extra: {
      plan_id: planResult.value.id,
      verification_evidence: [
        // AC-X-1: runner-attested pass (via `lore verify`, SPEC-039)
        {
          oracle: "test",
          command: "bun test widget.test.ts",
          result: "pass",
          recorded_at: "2026-07-08T00:00:00.000Z",
          recorded_by: "lore-cli",
          ac_ref: "AC-X-1",
          attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 420, timed_out: false },
        },
        // AC-X-1: self-reported pass (no attestation) — same criterion, mixed evidence
        {
          oracle: "test",
          command: "bun test widget.test.ts",
          result: "pass",
          recorded_at: "2026-07-08T00:05:00.000Z",
          recorded_by: "carol",
          ac_ref: "AC-X-1",
        },
        // AC-X-2: self-reported pass only — zero attested, proves the annotation is
        // conditional per-AC, not a table-wide flag
        {
          oracle: "other",
          command: "manual contrast check",
          result: "pass",
          recorded_at: "2026-07-08T00:10:00.000Z",
          recorded_by: "carol",
          ac_ref: "AC-X-2",
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

    const result = await service.assessPlan(bundle, { commitDerivationUnverifiable: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.judgment.retried).toBe(true);
  });

  it("a same-attempt success (no malformed first response) has judgment.retried = false, not true by default", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_JSON });
    const { service } = makeAssessService({ provider });

    const result = await service.assessPlan(bundle, { commitDerivationUnverifiable: false });
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

    await service.assessPlan(bundle, { commitDerivationUnverifiable: false });
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

    await service.assessPlan(bundle, { commitDerivationUnverifiable: false });
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

    const result = await service.assessPlan(bundle, { commitDerivationUnverifiable: false });
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

    const result = await service.assessPlan(bundle, { commitDerivationUnverifiable: false });
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
    await service.assessPlan(bundle, { commitDerivationUnverifiable: false });

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

    const result = await service.assessPlan(bundle, { commitDerivationUnverifiable: false });
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

    await service.assessPlan(bundle, { commitDerivationUnverifiable: false });
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

    await service.assessPlan(bundle, { commitDerivationUnverifiable: false });
    expect(emitCalls).toHaveLength(1);
  });

  it("single-attempt success: emit is called exactly once", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_JSON });
    const { service, emitCalls } = makeAssessService({ provider });

    await service.assessPlan(bundle, { commitDerivationUnverifiable: false });
    expect(emitCalls).toHaveLength(1);
  });

  it("emitted event's kind is 'assess' (not mistakenly tagged as create/regenerate)", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_JSON });
    const { service, emitCalls } = makeAssessService({ provider });

    await service.assessPlan(bundle, { commitDerivationUnverifiable: false });
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

    await service.assessPlan(bundle, { commitDerivationUnverifiable: false });
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

    await service.assessPlan(bundle, { commitDerivationUnverifiable: false });
    const prompt = provider.calls[0]?.prompt ?? "";
    expect(prompt).toContain(bundle.plan.title);
    expect(prompt).toContain("Plan goals and phases.");
  });

  it("prompt contains the linked spec's AC section verbatim", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_JSON });
    const { service } = makeAssessService({ provider });

    await service.assessPlan(bundle, { commitDerivationUnverifiable: false });
    const prompt = provider.calls[0]?.prompt ?? "";
    expect(prompt).toContain("AC-ASSESS-1");
    expect(prompt).toContain("Something must happen.");
  });

  it("prompt contains the task's evidence trail: oracle, command, and result markers", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_JSON });
    const { service } = makeAssessService({ provider });

    await service.assessPlan(bundle, { commitDerivationUnverifiable: false });
    const prompt = provider.calls[0]?.prompt ?? "";
    expect(prompt).toContain("oracle=tsc");
    expect(prompt).toContain('command="bun run typecheck"');
    expect(prompt).toContain("result=pass");
    // reason: SPEC-lore-assess-project-evidence-rows... D1 retired the `recorder=` field —
    // the row projection is now (oracle, ac_ref, result, command, tail_bytes); this fixture's
    // evidence entry has neither ac_ref nor output_tail, so both render their "absent" form.
    expect(prompt).toContain("ac_ref=(none)");
    expect(prompt).toContain("tail_bytes=0");
  });

  it("prompt contains the task's title", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_JSON });
    const { service } = makeAssessService({ provider });

    await service.assessPlan(bundle, { commitDerivationUnverifiable: false });
    const prompt = provider.calls[0]?.prompt ?? "";
    expect(prompt).toContain("Implement the thing");
  });

  it("diffText, when provided, appears in the prompt", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_JSON });
    const { service } = makeAssessService({ provider });

    await service.assessPlan(bundle, { diffText: "diff --git a/foo.ts b/foo.ts\n+added line\n", commitDerivationUnverifiable: false });
    const prompt = provider.calls[0]?.prompt ?? "";
    expect(prompt).toContain("added line");
  });

  it("a task with NO evidence renders '(no evidence recorded)', not a crash or blank section", async () => {
    const store = new InMemoryStore();
    const corpusService = new CorpusService(store, new RecordLockService(store));
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
    await service.assessPlan(bundleResult.value, { commitDerivationUnverifiable: false });
    const prompt = provider.calls[0]?.prompt ?? "";
    expect(prompt).toContain("(no evidence recorded)");
  });
});

// ─── AC-ASSESS-7: budget truncation ──────────────────────────────────────────

describe("assessPlan — budget truncation is recorded in judgment.truncated (AC-ASSESS-7)", () => {
  it("a plan content over budget is truncated and 'plan' appears in judgment.truncated", async () => {
    const store = new InMemoryStore();
    const corpusService = new CorpusService(store, new RecordLockService(store));
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

    const result = await service.assessPlan(bundleResult.value, { commitDerivationUnverifiable: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.judgment.truncated).toContain("plan");
  });

  it("when nothing exceeds budget, judgment.truncated is an empty array, not omitted or null", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_JSON });
    const { service } = makeAssessService({ provider });

    const result = await service.assessPlan(bundle, { commitDerivationUnverifiable: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.judgment.truncated).toEqual([]);
  });

  it("a task content over its own (smaller) budget is truncated and named 'task:<slug>', distinct from the plan budget", async () => {
    const store = new InMemoryStore();
    const corpusService = new CorpusService(store, new RecordLockService(store));
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

    const result = await service.assessPlan(bundleResult.value, { commitDerivationUnverifiable: false });
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

    const result = await service.assessPlan(bundle, { diffText, commitDerivationUnverifiable: false });
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

    const result = await service.assessPlan(bundle, { diffText, commitDerivationUnverifiable: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.judgment.truncated.some((s) => s.startsWith("diff:"))).toBe(false);
    expect(result.value.judgment.truncated).toEqual([]);
  });
});

// ─── bugfix F3: diff-omission truncation manifest ────────────────────────────
//
// Root cause (knowledge-assess-diff-truncation-systematically-hides-tests-from): the judge
// could not distinguish "file doesn't exist" from "file cut for budget" — omitted diff
// files simply vanished from the prompt, so the judge reported gaps for tests that DO
// exist but sorted into the dropped set. Fix: buildAssessPrompt now appends a "Truncation
// Manifest" section (grouped production/test/other) built from the SAME
// `diffResult.omittedFiles` array that already feeds `judgment.truncated[]` — single
// source, no second bookkeeping (spec ACs 3 + item 3 of the task).

describe("buildAssessPrompt — diff-omission truncation manifest (bugfix F3)", () => {
  const srcChunk =
    `diff --git a/packages/lore/src/foo.ts b/packages/lore/src/foo.ts\nindex 1..2 100644\n` +
    `--- a/packages/lore/src/foo.ts\n+++ b/packages/lore/src/foo.ts\n@@ -1,1 +1,1 @@\n${"+".repeat(50)}`;
  const testChunk =
    `diff --git a/packages/lore/tests/unit/foo.test.ts b/packages/lore/tests/unit/foo.test.ts\n` +
    `index 1..2 100644\n--- a/packages/lore/tests/unit/foo.test.ts\n+++ b/packages/lore/tests/unit/foo.test.ts\n` +
    `@@ -1,1 +1,1 @@\n${"+".repeat(50)}`;
  const otherChunk =
    `diff --git a/docs/readme.md b/docs/readme.md\nindex 1..2 100644\n--- a/docs/readme.md\n` +
    `+++ b/docs/readme.md\n@@ -1,1 +1,1 @@\n${"+".repeat(50)}`;

  it("an over-budget diff's prompt carries the manifest with every dropped file, grouped, plus the do-not-penalize instruction", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundle(store);
    const diffText = `${srcChunk}\n${testChunk}\n${otherChunk}`;
    // Budget fits only the highest-priority (source) chunk — test + other chunks are dropped.
    const budgets = { ...DEFAULT_BUDGETS, max_diff_chars: srcChunk.length + 10 };
    expect(diffText.length).toBeGreaterThan(budgets.max_diff_chars); // sanity: must actually truncate

    const { prompt, truncated } = buildAssessPrompt(bundle, diffText, budgets);

    expect(prompt).toContain("# Truncation Manifest");
    expect(prompt).toContain("Test files omitted (1):");
    expect(prompt).toContain("packages/lore/tests/unit/foo.test.ts");
    expect(prompt).toContain("Other files omitted (1):");
    expect(prompt).toContain("docs/readme.md");
    expect(prompt).toContain("Do NOT report them as missing");
    expect(prompt.toLowerCase()).toContain("not absent");

    // Same data source as truncated[] — every manifest entry has a matching diff:<path> marker.
    expect(truncated).toContain("diff:packages/lore/tests/unit/foo.test.ts");
    expect(truncated).toContain("diff:docs/readme.md");
    // The kept (source) file must NOT appear as omitted anywhere.
    expect(prompt).not.toMatch(/Production files omitted.*foo\.ts/s);
    expect(truncated).not.toContain("diff:packages/lore/src/foo.ts");
  });

  it("a within-budget diff's prompt carries NO manifest section at all", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundle(store);
    const diffText = "diff --git a/foo.ts b/foo.ts\n+added line\n"; // well under default 24000 budget

    const { prompt, truncated } = buildAssessPrompt(bundle, diffText, DEFAULT_BUDGETS);

    expect(prompt).not.toContain("# Truncation Manifest");
    expect(truncated).toEqual([]);
  });

  it("regression: judgment.truncated still records per-file diff:<path> markers unchanged by the manifest addition (SPEC-028 AC-AE-3)", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundle(store);
    const diffText = `${srcChunk}\n${testChunk}\n${otherChunk}`;
    const budgets = { ...DEFAULT_BUDGETS, max_diff_chars: srcChunk.length + 10 };

    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_JSON });
    const { service } = makeAssessService({ provider, budgets });

    const result = await service.assessPlan(bundle, { diffText, commitDerivationUnverifiable: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.judgment.truncated).toContain("diff:packages/lore/tests/unit/foo.test.ts");
    expect(result.value.judgment.truncated).toContain("diff:docs/readme.md");
    expect(result.value.judgment.truncated).not.toContain("diff"); // old bare marker never reappears
  });
});

// ─── SPEC-029 AC-AR-1: both judge prompts state the 300-char reasoning limit ──

describe("buildAssessPrompt / buildAssessRetryPrompt — reasoning-limit statement (SPEC-029 AC-AR-1)", () => {
  it("the base judge prompt states the 300-char reasoning limit AND that overflow gets clipped", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundle(store);
    const { prompt } = buildAssessPrompt(bundle, undefined, DEFAULT_BUDGETS);
    expect(prompt).toContain("300 characters");
    expect(prompt.toLowerCase()).toContain("clip");
  });

  it("the corrective-retry prompt (built end-to-end from a real base prompt) ALSO states the limit — proves 'both prompts' holds, not just the retry-prompt docstring", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundle(store);
    const { prompt: basePrompt } = buildAssessPrompt(bundle, undefined, DEFAULT_BUDGETS);
    const retryPrompt = buildAssessRetryPrompt(basePrompt, "Unexpected token at position 0");

    expect(retryPrompt).toContain("300 characters");
    expect(retryPrompt.toLowerCase()).toContain("clip");
  });
});

// ─── SPEC-029 AC-AR-2 / AC-AR-6: verbose-but-valid never burns the retry budget ─

describe("assessPlan — overlong-but-valid reasoning is clipped without a corrective retry (SPEC-029 AC-AR-2, AC-AR-6)", () => {
  it("a first response with an overlong ac_scores[0].reasoning succeeds in ONE provider call, clips the field, and records reasoning_clipped", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundle(store);

    const overlongReasoning = "This AC is fully evidenced by the task's verification log. ".repeat(7); // > 300 chars
    expect(overlongReasoning.length).toBeGreaterThan(300); // sanity: fixture is actually overlong

    const overlongJson = JSON.stringify({
      verdict: "met",
      overall_score: 90,
      ac_scores: [{ ac_id: "AC-ASSESS-1", score: 90, reasoning: overlongReasoning, evidence_refs: [] }],
      gaps: [],
      recommendations: [],
    });

    const provider = new InMemoryAIProvider("in-memory", {
      kind: "sequence",
      responses: [{ kind: "ok", content: overlongJson }],
    });
    const { service } = makeAssessService({ provider });

    const result = await service.assessPlan(bundle, { commitDerivationUnverifiable: false });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Core AC-AR-2 guarantee: no retry was spent on a verbose-but-otherwise-valid judgment.
    expect(result.value.judgment.retried).toBe(false);
    expect(provider.calls).toHaveLength(1);

    // The reasoning field itself was clipped to fit the schema's .max(300).
    expect(result.value.ac_scores[0]!.reasoning.length).toBeLessThanOrEqual(300);

    // AC-AR-3: the clip is recorded observably, not silent.
    expect(result.value.judgment.reasoning_clipped).toContain("AC-ASSESS-1");
  });

  it("when nothing needed clipping, judgment.reasoning_clipped is OMITTED entirely (not present-but-empty)", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_JSON });
    const { service } = makeAssessService({ provider });

    const result = await service.assessPlan(bundle, { commitDerivationUnverifiable: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Must check key PRESENCE, not just `.length === 0` — an implementation that sets
    // `reasoning_clipped: []` instead of omitting the key entirely would pass a naive
    // `.length` check but violates the additive-only "omitted when empty" contract (AC-AR-3).
    expect(Object.prototype.hasOwnProperty.call(result.value.judgment, "reasoning_clipped")).toBe(false);
  });

  it("the rendered content (as it will be persisted to the knowledge doc) includes the clipped-reasoning line — closes SPEC-030 AC-HJ-7 / round-3 AC-AR-3 rendering gap", async () => {
    // Spec-first: renderAssessmentContent (packages/core/src/assessment.ts) is documented to
    // render a "- Reasoning clipped for: <ac ids>" line when judgment.reasoning_clipped is
    // present and non-empty (SPEC-029 AC-AR-3). That claim was previously only exercised
    // against a hand-crafted AssessmentResult literal — never against a REAL computed
    // result from assessPlan(). This test closes that gap by feeding the actual returned
    // result.value through the actual rendering function used at persist time
    // (packages/lore/src/adapters/cli/commands/assess.ts:232 — `content: renderAssessmentContent(result)`).
    const store = new InMemoryStore();
    const bundle = await makeBundle(store);

    const overlongReasoning = "This AC is fully evidenced by the task's verification log. ".repeat(7); // > 300 chars
    expect(overlongReasoning.length).toBeGreaterThan(300); // sanity: fixture is actually overlong

    const overlongJson = JSON.stringify({
      verdict: "met",
      overall_score: 90,
      ac_scores: [{ ac_id: "AC-ASSESS-1", score: 90, reasoning: overlongReasoning, evidence_refs: [] }],
      gaps: [],
      recommendations: [],
    });

    const provider = new InMemoryAIProvider("in-memory", {
      kind: "sequence",
      responses: [{ kind: "ok", content: overlongJson }],
    });
    const { service } = makeAssessService({ provider });

    const result = await service.assessPlan(bundle, { commitDerivationUnverifiable: false });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Sanity: the computed result really does carry reasoning_clipped (mirrors the
    // sibling test above) before we assert on its rendering.
    expect(result.value.judgment.reasoning_clipped).toContain("AC-ASSESS-1");

    const content = renderAssessmentContent(result.value);

    expect(content).toContain("Reasoning clipped for:");
    expect(content).toContain("AC-ASSESS-1");
  });

  it("regression: when nothing was clipped, the rendered content does NOT contain 'Reasoning clipped' — proves the end-to-end path doesn't spuriously render the line", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_JSON });
    const { service } = makeAssessService({ provider });

    const result = await service.assessPlan(bundle, { commitDerivationUnverifiable: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(Object.prototype.hasOwnProperty.call(result.value.judgment, "reasoning_clipped")).toBe(false);

    const content = renderAssessmentContent(result.value);

    expect(content).not.toContain("Reasoning clipped");
  });
});

// ─── SPEC-038 §5: structured acceptance criteria in the assess judge prompt ──

describe("buildAssessPrompt — structured acceptance criteria table (SPEC-038 AC-ACODE-4)", () => {
  it("a spec with declared extra.acceptance_criteria renders the structured table with both AC ids and a closed ac_id instruction", async () => {
    const store = new InMemoryStore();
    const bundle = await makeStructuredAcBundle(store);

    const result = buildAssessPrompt(bundle, undefined, DEFAULT_BUDGETS);

    expect(result.prompt).toContain("## Spec Acceptance Criteria (structured)");
    expect(result.prompt).toContain("AC-X-1");
    expect(result.prompt).toContain("AC-X-2");
    expect(result.prompt).toContain("ac_id MUST be one of:");
    expect(result.prompt).toContain("script-mode ACs:");
    expect(result.declaredAcIds).toEqual(["AC-X-1", "AC-X-2"]);
  });

  // reason: SPEC-040 §T2 D6 bumped the ACTIVE registry version to 6 (buildAssessPromptV6),
  // SPEC-lore-assess-project-evidence-rows-instead-of-embedding-the T5 re-bumped it to 7
  // (buildAssessPromptV7, frozen pre-projection rendering kept reproducible at slot 6), and
  // D1 (spec-judgment-surfaces-must-verify-before-they-certify-machine) re-bumped it again
  // to 8 (buildAssessPromptV8, slot 7 kept output-frozen) — buildAssessPrompt itself is
  // still frozen provenance-only as the registry's `5` entry, so this reconciled assertion
  // pins THAT (ASSESS_TEMPLATES[5] === buildAssessPrompt) rather than the now-stale
  // "ASSESS_PROMPT_VERSION is 5" claim. See ai/assess-template-registry.test.ts and
  // ai/assess-prompt-version-freeze.test.ts for the full registry-dispatch coverage.
  it("ASSESS_PROMPT_VERSION is 8 (the active registry entry, D1); buildAssessPrompt itself stays pinned as ASSESS_TEMPLATES[5] (SPEC-040 §T2 D6)", async () => {
    const { ASSESS_TEMPLATES } = await import("../../../src/ai/assess-template.js");
    expect(ASSESS_PROMPT_VERSION).toBe(8);
    expect(ASSESS_TEMPLATES[5]).toBe(buildAssessPrompt);
  });

  it("a full assessPlan() call against the structured-AC bundle carries prompt_version 8 (the active registry version, D1) in the persisted judgment", async () => {
    const store = new InMemoryStore();
    const bundle = await makeStructuredAcBundle(store);
    const scriptedJson = JSON.stringify({
      verdict: "met",
      overall_score: 90,
      ac_scores: [
        { ac_id: "AC-X-1", score: 90, reasoning: "Covered by passing test evidence.", evidence_refs: [] },
        { ac_id: "AC-X-2", score: 85, reasoning: "Contrast checked manually.", evidence_refs: [] },
      ],
      gaps: [],
      recommendations: [],
    });
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: scriptedJson });
    const { service } = makeAssessService({ provider });

    const result = await service.assessPlan(bundle, { commitDerivationUnverifiable: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.judgment.prompt_version).toBe(ASSESS_PROMPT_VERSION);
  });
});

describe("buildAssessPrompt — attested coverage annotation (SPEC-039 §2 D8, AC-VRF-9)", () => {
  it("a structured AC table with a mix of attested and self-reported evidence annotates only the attested side, per criterion", async () => {
    const store = new InMemoryStore();
    const bundle = await makeAttestedStructuredAcBundle(store);

    const result = buildAssessPrompt(bundle, undefined, DEFAULT_BUDGETS);

    // AC-X-1: 2 pass total, 1 of them runner-attested, 0 fail — matches the spec's own
    // worked example verbatim ("2 pass (1 attested), 0 fail").
    expect(result.prompt).toContain("2 pass (1 attested), 0 fail");
    // AC-X-2: 1 self-reported pass, zero attested — no parenthetical annotation at all.
    expect(result.prompt).toContain("1 pass, 0 fail");
    // The unattested cell must not itself contain the word "attested" anywhere near it —
    // guards against a bug that always appends "(0 attested)" instead of omitting it.
    expect(result.prompt).not.toContain("(0 attested)");
  });

  it("a criterion with zero evidence still renders the bare '0 pass, 0 fail' cell, no annotation", async () => {
    const store = new InMemoryStore();
    const bundle = await makeStructuredAcBundle(store);
    // makeStructuredAcBundle's AC-X-2 has no evidence referencing it at all.
    const result = buildAssessPrompt(bundle, undefined, DEFAULT_BUDGETS);

    expect(result.prompt).toContain("0 pass, 0 fail");
  });
});

describe("assessPlan — ac_id containment against declared structured criteria (SPEC-038 AC-ACODE-5)", () => {
  it("a judge response whose ac_scores[].ac_id are all within the declared set succeeds (ok)", async () => {
    const store = new InMemoryStore();
    const bundle = await makeStructuredAcBundle(store);
    const scriptedJson = JSON.stringify({
      verdict: "met",
      overall_score: 90,
      ac_scores: [
        { ac_id: "AC-X-1", score: 90, reasoning: "Covered by passing test evidence.", evidence_refs: [] },
        { ac_id: "AC-X-2", score: 85, reasoning: "Contrast checked manually.", evidence_refs: [] },
      ],
      gaps: [],
      recommendations: [],
    });
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: scriptedJson });
    const { service } = makeAssessService({ provider });

    const result = await service.assessPlan(bundle, { commitDerivationUnverifiable: false });
    expect(result.ok).toBe(true);
  });

  it("a judge response with an ac_id NOT in the declared set fails with VALIDATION_ERROR naming the offending id", async () => {
    const store = new InMemoryStore();
    const bundle = await makeStructuredAcBundle(store);
    const scriptedJson = JSON.stringify({
      verdict: "met",
      overall_score: 90,
      ac_scores: [{ ac_id: "AC-BOGUS-1", score: 90, reasoning: "Invented id.", evidence_refs: [] }],
      gaps: [],
      recommendations: [],
    });
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: scriptedJson });
    const { service, emitCalls } = makeAssessService({ provider });

    const result = await service.assessPlan(bundle, { commitDerivationUnverifiable: false });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect("message" in result.error ? result.error.message : "").toContain("AC-BOGUS-1");

    // The containment failure must not consume the corrective retry — only one provider call.
    expect(provider.calls).toHaveLength(1);
    // Telemetry still emits exactly once on this terminal branch, same as every other outcome.
    expect(emitCalls).toHaveLength(1);
  });

  it("a containment failure creates no store side effect — doc count is unchanged before/after", async () => {
    const store = new InMemoryStore();
    const bundle = await makeStructuredAcBundle(store);
    const beforeResult = await store.findMany({});
    if (!beforeResult.ok) throw new Error("findMany failed");
    const beforeCount = beforeResult.value.length;

    const scriptedJson = JSON.stringify({
      verdict: "met",
      overall_score: 90,
      ac_scores: [{ ac_id: "AC-BOGUS-1", score: 90, reasoning: "Invented id.", evidence_refs: [] }],
      gaps: [],
      recommendations: [],
    });
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: scriptedJson });
    const { service } = makeAssessService({ provider });
    await service.assessPlan(bundle, { commitDerivationUnverifiable: false });

    const afterResult = await store.findMany({});
    if (!afterResult.ok) throw new Error("findMany failed");
    expect(afterResult.value.length).toBe(beforeCount);
  });
});

describe("buildAssessPrompt — legacy verbatim path is byte-identical for specs with no structured ACs (REGRESSION)", () => {
  it("the plain-prose makeBundle fixture renders the verbatim heading, the open-ended ac_id instruction, and an empty declaredAcIds", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundle(store);

    const result = buildAssessPrompt(bundle, undefined, DEFAULT_BUDGETS);

    expect(result.prompt).toContain("## Spec Acceptance Criteria (verbatim)");
    expect(result.prompt).not.toContain("## Spec Acceptance Criteria (structured)");
    expect(result.prompt).not.toContain("ac_id MUST be one of:");
    expect(result.prompt).toContain(
      "Use the exact AC identifiers found in the spec's Acceptance Criteria section above for ac_id.",
    );
    expect(result.declaredAcIds).toEqual([]);
  });

  it("a full assessPlan() call against the legacy (no structured ACs) bundle also carries prompt_version 8 (the active registry version, D1) end-to-end", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_JSON });
    const { service } = makeAssessService({ provider });

    const result = await service.assessPlan(bundle, { commitDerivationUnverifiable: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.judgment.prompt_version).toBe(ASSESS_PROMPT_VERSION);
  });
});

describe("buildAssessPrompt — structured AC table truncation (BOUNDARY, SPEC-038)", () => {
  it("a structured-AC spec section over a tiny max_spec_chars budget is truncated and 'spec' appears in truncated[]", async () => {
    const store = new InMemoryStore();
    const bundle = await makeStructuredAcBundle(store);
    const tightBudgets = { ...DEFAULT_BUDGETS, max_spec_chars: 50 };

    const fullResult = buildAssessPrompt(bundle, undefined, DEFAULT_BUDGETS);
    const truncatedResult = buildAssessPrompt(bundle, undefined, tightBudgets);

    expect(truncatedResult.truncated).toContain("spec");
    // Sanity: truncation actually shrank the rendered spec section vs. the untruncated prompt.
    expect(truncatedResult.prompt.length).toBeLessThan(fullResult.prompt.length);
    // The table is still headed "(structured)" even when truncated — only its body is cut.
    expect(truncatedResult.prompt).toContain("## Spec Acceptance Criteria (structured)");
  });
});

// ─── hotfix: assess diff-range scope guard (task-assess-diff-range-scope-mismatch-warning) ───
//
// Mechanizes the discipline behind three real incidents (2026-07-21 main~8..main;
// 2026-07-22 SPEC-062/SPEC-064 re-runs): a too-wide `lore assess --diff` range silently
// converts unrelated work into false scope_fidelity gaps. assessPlan computes a
// non-blocking `scope_warning` — a deterministic FACTS comparison (diff files ∩ the
// plan's declared task file_anchors), never an LLM judgment — that fires only when
// STRICTLY fewer than half the diff's files intersect, and only when at least one task
// in the plan declares anchors at all.

/**
 * Builds a real PlanBundle (same construction path as `makeBundle`) whose single child
 * task declares `extra.file_anchors` (or none at all, when `anchors` is `undefined`).
 */
async function makeBundleWithTaskAnchors(store: InMemoryStore, anchors: string[] | undefined): Promise<PlanBundle> {
  const corpusService = new CorpusService(store, new RecordLockService(store));

  const prdResult = await corpusService.create({
    type: "prd",
    title: "Scope Guard Test PRD",
    content: "Root PRD for scope-guard tests.",
  } as CreateDocInput);
  if (!prdResult.ok) throw new Error("prd create failed");

  const specResult = await corpusService.create({
    type: "spec",
    title: "Scope Guard Test Spec",
    content: "## Acceptance Criteria\n\n**AC-SG-1** Something must happen.\n",
  } as CreateDocInput);
  if (!specResult.ok) throw new Error("spec create failed");

  const planResult = await corpusService.create({
    type: "plan",
    title: "Scope Guard Test Plan",
    parent_id: specResult.value.id,
    content: "Plan goals for scope-guard tests.",
  } as CreateDocInput);
  if (!planResult.ok) throw new Error("plan create failed");

  const taskResult = await corpusService.create({
    type: "task",
    title: "Do the scoped work",
    parent_id: planResult.value.id,
    content: "Task body describing the scoped work.",
    extra: {
      plan_id: planResult.value.id,
      ...(anchors !== undefined ? { file_anchors: anchors } : {}),
    },
  } as CreateDocInput);
  if (!taskResult.ok) throw new Error("task create failed");

  const bundleResult = await corpusService.getPlanBundle(planResult.value.id);
  if (!bundleResult.ok) throw new Error("getPlanBundle failed");
  return bundleResult.value;
}

/** Builds a minimal-but-valid unified diff touching exactly the given file paths. */
function diffTouching(paths: string[]): string {
  return paths
    .map((p) => `diff --git a/${p} b/${p}\nindex 1..2 100644\n--- a/${p}\n+++ b/${p}\n@@ -1,1 +1,1 @@\n+x\n`)
    .join("");
}

describe("assessPlan — diff-range scope-mismatch warning (task-assess-diff-range-scope-mismatch-warning)", () => {
  it("HAPPY: a diff whose files all fall under the plan's task anchors → no warning", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundleWithTaskAnchors(store, ["src/a.ts", "src/b.ts"]);
    const diffText = diffTouching(["src/a.ts", "src/b.ts"]);
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_JSON });
    const { service } = makeAssessService({ provider });

    const result = await service.assessPlan(bundle, { diffText, commitDerivationUnverifiable: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.scope_warning).toBeUndefined();
  });

  it("NEGATIVE/STATE: a diff dominated by files OUTSIDE the task anchors (< half intersect) → exactly one warning naming the counts", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundleWithTaskAnchors(store, ["src/a.ts"]);
    // 1 of 3 files intersects — strictly fewer than half.
    const diffText = diffTouching(["src/a.ts", "docs/readme.md", "packages/dashboard/x.tsx"]);
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_JSON });
    const { service } = makeAssessService({ provider });

    const result = await service.assessPlan(bundle, { diffText, commitDerivationUnverifiable: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.scope_warning).toBeDefined();
    expect(result.value.scope_warning?.diff_file_count).toBe(3);
    expect(result.value.scope_warning?.intersecting_count).toBe(1);
    expect(result.value.scope_warning?.message).toContain("3 files");
    // reason: task-computescopemismatchwarning-cannot-distinguish-a-too-wide reworded the
    // message to name what was found (in-scope count) rather than assert an unestablished
    // cause ("the range may be too wide") — this pins the NEW wording, not the old one.
    expect(result.value.scope_warning?.message).toContain("only 1 are this plan's declared task anchors or a recognized test of one");
    expect(result.value.scope_warning?.message).not.toContain("may be too wide");
  });

  it("HAPPY (production path, task-computescopemismatchwarning-cannot-distinguish-a-too-wide): a diff whose non-anchor files are all recognized co-located test siblings → no warning through the REAL assessPlan call", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundleWithTaskAnchors(store, ["src/a.ts"]);
    // Only "src/a.ts" is a declared anchor; the other two files are its co-located test
    // siblings under THIS repo's own test-file convention (`deriveRepoTestedSourcePath`,
    // ai-provider-service.ts) — a source file plus its two mandated test runners, exactly
    // the pattern that used to false-positive (measured: 17/4 and 8/2 intersecting). A green
    // unit test on `computeScopeMismatchWarning` alone does NOT prove this convention is
    // actually wired at the real call site — this test drives the production `assessPlan()`
    // path end to end.
    const diffText = diffTouching(["src/a.ts", "src/a.test.ts", "src/a.bun.test.ts"]);
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_JSON });
    const { service } = makeAssessService({ provider });

    const result = await service.assessPlan(bundle, { diffText, commitDerivationUnverifiable: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.scope_warning).toBeUndefined();
  });

  it("BOUNDARY: a plan with zero task anchors → check skipped entirely, no warning even though 0 files intersect", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundleWithTaskAnchors(store, undefined); // no file_anchors declared at all
    const diffText = diffTouching(["docs/readme.md", "packages/dashboard/x.tsx"]);
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_JSON });
    const { service } = makeAssessService({ provider });

    const result = await service.assessPlan(bundle, { diffText, commitDerivationUnverifiable: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.scope_warning).toBeUndefined();
  });

  it("BOUNDARY: exactly half of the diff's files intersect → NOT a mismatch (a naive 'warn when any file is outside' rule would wrongly fire here)", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundleWithTaskAnchors(store, ["src/a.ts"]);
    // 1 of 2 files intersects — exactly half, must NOT warn.
    const diffText = diffTouching(["src/a.ts", "docs/readme.md"]);
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_JSON });
    const { service } = makeAssessService({ provider });

    const result = await service.assessPlan(bundle, { diffText, commitDerivationUnverifiable: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.scope_warning).toBeUndefined();
  });

  it("REGRESSION: verdict/overall_score/ac_scores/persistence-relevant fields are identical whether or not the warning fires", async () => {
    const storeA = new InMemoryStore();
    const bundleNoWarning = await makeBundleWithTaskAnchors(storeA, ["src/a.ts"]);
    const storeB = new InMemoryStore();
    const bundleWithWarning = await makeBundleWithTaskAnchors(storeB, ["src/a.ts"]);

    const providerA = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_JSON });
    const { service: serviceA } = makeAssessService({ provider: providerA });
    const resultNoWarning = await serviceA.assessPlan(bundleNoWarning, { diffText: diffTouching(["src/a.ts"]), commitDerivationUnverifiable: false });

    const providerB = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_JSON });
    const { service: serviceB } = makeAssessService({ provider: providerB });
    const resultWithWarning = await serviceB.assessPlan(bundleWithWarning, {
      diffText: diffTouching(["src/a.ts", "docs/x.md", "docs/y.md"]),
      commitDerivationUnverifiable: false,
    });

    expect(resultNoWarning.ok).toBe(true);
    expect(resultWithWarning.ok).toBe(true);
    if (!resultNoWarning.ok || !resultWithWarning.ok) return;
    expect(resultNoWarning.value.scope_warning).toBeUndefined();
    expect(resultWithWarning.value.scope_warning).toBeDefined();
    // Same judge output (VALID_JSON) on both runs → verdict/score/ac_scores are identical
    // regardless of whether the advisory warning fired (never blocks, never changes them).
    expect(resultNoWarning.value.verdict).toBe(resultWithWarning.value.verdict);
    expect(resultNoWarning.value.overall_score).toBe(resultWithWarning.value.overall_score);
    expect(resultNoWarning.value.ac_scores).toEqual(resultWithWarning.value.ac_scores);
  });
});
