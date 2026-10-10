/**
 * task-getassesstemplatereproducibility-has-zero-production-callers — CONTROL #3.
 *
 * `assessPlan` now resolves `getAssessTemplateReproducibility(ASSESS_PROMPT_VERSION)`
 * right beside the pre-existing `getAssessTemplate(ASSESS_PROMPT_VERSION)` call, and
 * propagates a lookup failure as its OWN `err(...)` (mirrors the existing `templateResult`
 * early-return) — never silently defaulting `judgment.reproducible` to `false`/absent.
 * This branch is structurally unreachable in production (both lookups key off the exact
 * same `ASSESS_TEMPLATE_REGISTRY`, so if `getAssessTemplate` already succeeded moments
 * earlier, `getAssessTemplateReproducibility` for the identical version cannot fail) — the
 * only way to exercise it is to force the lookup itself to fail, which this file does via
 * a module mock over `getAssessTemplateReproducibility` ONLY (every other export,
 * including `getAssessTemplate` and `ASSESS_PROMPT_VERSION`, passes through untouched).
 *
 * Interceptor liveness control (CLAUDE.md "false oracles" — an oracle must prove its own
 * instrument is live, not just that an assertion happened to pass): the mocked error
 * message is a SENTINEL string no real registry lookup could ever produce
 * (`unregisteredAssessTemplateVersionError`'s real wording never contains this literal
 * marker) — its presence in the assertion is proof the mock actually intercepted the call,
 * not that the test coincidentally passed for an unrelated reason.
 *
 * Six-dimension coverage for this file:
 *   ERROR:      the mocked lookup failure propagates as assessPlan's own err(AI_PROVIDER_ERROR)
 *   NEGATIVE:   asserted BY VALUE (exact error code + a sentinel substring in the message),
 *               never merely "judgment.reproducible is not true"
 *   STATE:      the provider is NEVER invoked — the failure is caught before the judge call,
 *               same position as the pre-existing templateResult early-return
 *   REGRESSION: getAssessTemplate itself is untouched by the mock (still delegates to the
 *               real implementation) — proven by a passing HAPPY-path sibling test in the
 *               unmocked ai-provider-service-assess.test.ts suite; this file only isolates
 *               the ONE lookup under test
 *
 * @spec_ref task-getassesstemplatereproducibility-has-zero-production-callers
 */

import { describe, it, expect, vi } from "vitest";

const SENTINEL_MESSAGE = "MOCKED_UNREGISTERED_REPRODUCIBILITY_SENTINEL_7f3a9c";

// reason: mock ONLY getAssessTemplateReproducibility — every other export (including
// getAssessTemplate, ASSESS_PROMPT_VERSION, ASSESS_TEMPLATES) passes through to the real
// module via `...actual`, so this file exercises the real assessPlan control flow with a
// single forced failure at the one lookup under test.
vi.mock("../../../src/ai/assess-template.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/ai/assess-template.js")>();
  return {
    ...actual,
    getAssessTemplateReproducibility: (version: number) => ({
      ok: false as const,
      error: {
        code: "AI_PROVIDER_ERROR" as const,
        provider: "assess-template-registry",
        message: `${SENTINEL_MESSAGE} (version ${version})`,
      },
    }),
  };
});

// reason: static imports below the mock (not `await import(...)`) — vitest hoists vi.mock
// over these, and `bun run test:changed`'s reverse-dependency scan reads static imports
// only (see demotion-rule-ssot.test.ts's identical note).
import { AIProviderService } from "../../../src/service/ai-provider-service.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { InMemoryAIProvider } from "../../../src/ai/in-memory-provider.js";
import { ASSESS_PROMPT_VERSION } from "../../../src/ai/assess-template.js";
import type { Telemetry, TelemetryEvent, AiGenerationEvent, CreateDocInput, PlanBundle } from "@lore/core";

const DEFAULT_BUDGETS = { max_plan_chars: 8000, max_spec_chars: 12000, max_task_chars: 4000, max_diff_chars: 24000 };

function makeAssessService(provider: InMemoryAIProvider) {
  const telemetry: Telemetry = {
    record: vi.fn((_event: TelemetryEvent) => {}),
    emit: vi.fn((_event: AiGenerationEvent) => {}),
    close: vi.fn(),
  };
  const providers = new Map([[provider.name, provider]]) as unknown as ReadonlyMap<
    string,
    import("@lore/core").AIProvider
  >;
  return new AIProviderService(providers, provider.name, {}, telemetry, true, 8000, DEFAULT_BUDGETS);
}

async function makeBundle(store: InMemoryStore): Promise<PlanBundle> {
  const corpusService = new CorpusService(store);

  const prdResult = await corpusService.create({
    type: "prd",
    title: "Reproducible Unknown-Version Test PRD",
    content: "Root PRD.",
  } as CreateDocInput);
  if (!prdResult.ok) throw new Error("prd create failed");

  const specResult = await corpusService.create({
    type: "spec",
    title: "Reproducible Unknown-Version Test Spec",
    content: "## Acceptance Criteria\n\n**AC-X-1** Something must happen.\n",
  } as CreateDocInput);
  if (!specResult.ok) throw new Error("spec create failed");

  const planResult = await corpusService.create({
    type: "plan",
    title: "Reproducible Unknown-Version Test Plan",
    parent_id: specResult.value.id,
    content: "Plan goals.",
  } as CreateDocInput);
  if (!planResult.ok) throw new Error("plan create failed");

  const taskResult = await corpusService.create({
    type: "task",
    title: "Implement the thing",
    parent_id: planResult.value.id,
    content: "Task body.",
    extra: { plan_id: planResult.value.id },
  } as CreateDocInput);
  if (!taskResult.ok) throw new Error("task create failed");

  const bundleResult = await corpusService.getPlanBundle(planResult.value.id);
  if (!bundleResult.ok) throw new Error("getPlanBundle failed");
  return bundleResult.value;
}

const VALID_JSON = JSON.stringify({
  verdict: "met",
  overall_score: 90,
  ac_scores: [],
  gaps: [],
  recommendations: [],
});

describe("assessPlan — an unregistered getAssessTemplateReproducibility lookup propagates as assessPlan's OWN err (task-getassesstemplatereproducibility-has-zero-production-callers, CONTROL #3)", () => {
  it("returns err(AI_PROVIDER_ERROR) carrying the sentinel message — never silently defaulted into an absent/false judgment.reproducible", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_JSON });
    const service = makeAssessService(provider);

    const result = await service.assessPlan(bundle, { commitDerivationUnverifiable: false });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("AI_PROVIDER_ERROR");
    // Sentinel substring proves the MOCK actually intercepted the call — a passing
    // assertion without this substring would be indistinguishable from "the mock was
    // never consulted and assessPlan failed for some unrelated reason."
    expect("message" in result.error ? result.error.message : "").toContain(SENTINEL_MESSAGE);
    // reason: derived from the REAL (passed-through) ASSESS_PROMPT_VERSION rather than a
    // restated literal — this exact drift (a hardcoded "version 7" surviving a later bump
    // to 8) is what broke this assertion once already, per D1's re-key of the assess
    // template registry (spec-judgment-surfaces-must-verify-before-they-certify-machine).
    expect("message" in result.error ? result.error.message : "").toContain(`version ${ASSESS_PROMPT_VERSION}`);
  });

  it("the provider is never invoked — the failure is caught BEFORE the judge call, same position as the pre-existing templateResult check", async () => {
    const store = new InMemoryStore();
    const bundle = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_JSON });
    const service = makeAssessService(provider);

    await service.assessPlan(bundle, { commitDerivationUnverifiable: false });

    expect(provider.calls).toHaveLength(0);
  });
});
