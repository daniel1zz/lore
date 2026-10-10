/**
 * Tests for AIProviderService.judgeDoc (SPEC-034 §2, §4).
 *
 * Strategy: InMemoryStore + real CorpusService.getReviewBundle assembles the ReviewBundle
 * (dogfoods the same bundle-building path production code uses, mirrors
 * ai-provider-service-assess.test.ts's approach for assessPlan) — InMemoryAIProvider in
 * "sequence" mode scripts the corrective-retry protocol deterministically. No real provider
 * spawn, no bun:sqlite.
 *
 * Spec-first expectations (SPEC-034 §4):
 *   - First response malformed, second valid → ok, second call's content wins
 *   - Both responses malformed → AI_PROVIDER_ERROR with a <=500-char raw-output prefix, no
 *     judgment returned, provider never called a 3rd time
 *   - A transport-level provider error does NOT trigger the corrective retry (exactly 1 call)
 *   - Telemetry emits exactly once on every terminal outcome, kind="review"
 *   - decision/confidence are present (as object keys) on success and ABSENT (not merely
 *     undefined) on every failure path
 *   - The returned judgment's `checks` field is ALWAYS the `checks` argument passed into
 *     judgeDoc verbatim — even when the model's own JSON response includes its own `checks`
 *     field (llmReviewOutputSchema allows but ignores it), the deterministic pre-checks win
 *   - judge.provider === judge.model === activeProviderName (documented limitation);
 *     judge.prompt_version === REVIEW_PROMPT_VERSION ("v2" since SPEC-053)
 *
 * Adversarial angles:
 *   - A hardcoded-return service (`return ok({..., checks: someFixedArray})`) would defeat a
 *     test that only checks `checks.length > 0`; the override test instead asserts
 *     result.value.checks deep-equals the EXACT input checks array (with a "fail" outcome an
 *     accidental-pass fixture would never produce) AND diverges from a checks field embedded
 *     in the mocked JSON response.
 *   - Telemetry-exactly-once is checked on BOTH the retry-success path (2 provider calls, 1
 *     emit) and double-malformed (2 provider calls, 1 emit) — a "1 emit per attempt" bug
 *     would silently double telemetry volume on exactly the retry path.
 *
 * @spec_ref SPEC-034 §2, §4
 */

import { describe, it, expect, vi } from "vitest";
import { AIProviderService } from "../../../src/service/ai-provider-service.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { InMemoryAIProvider } from "../../../src/ai/in-memory-provider.js";
import { runDeterministicChecks } from "@lore/core";
import type {
  AIProvider,
  AiGenerationEvent,
  CheckResult,
  CreateDocInput,
  ReviewBundle,
  Telemetry,
  TelemetryEvent,
} from "@lore/core";

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

function makeReviewService(opts: { provider: InMemoryAIProvider; aiTelemetryEnabled?: boolean }) {
  const { telemetry, emitCalls } = makeMockTelemetry();
  const providers = new Map([[opts.provider.name, opts.provider]]) as unknown as ReadonlyMap<
    string,
    AIProvider
  >;
  const service = new AIProviderService(
    providers,
    opts.provider.name,
    {},
    telemetry,
    opts.aiTelemetryEnabled ?? true,
    8000,
    { max_plan_chars: 8000, max_spec_chars: 12000, max_task_chars: 4000, max_diff_chars: 24000 },
  );
  return { service, telemetry, emitCalls };
}

const VALID_JSON = JSON.stringify({
  decision: "approve",
  confidence: 0.9,
  reasons: [{ dimension: "completeness", finding: "Looks good" }],
  blocking_questions: [],
});

/** Builds a real ReviewBundle via CorpusService.getReviewBundle — same path production uses. */
async function makeBundle(
  store: InMemoryStore,
  opts?: { type?: "prd" | "spec"; content?: string },
): Promise<{ bundle: ReviewBundle; checks: CheckResult[] }> {
  const corpusService = new CorpusService(store);

  const prdResult = await corpusService.create({
    type: "prd",
    title: "Review Test PRD",
    content: "Root PRD for review tests.",
  } as CreateDocInput);
  if (!prdResult.ok) throw new Error("prd create failed");

  if ((opts?.type ?? "spec") === "prd") {
    const bundleResult = await corpusService.getReviewBundle(prdResult.value.id);
    if (!bundleResult.ok) throw new Error("getReviewBundle failed");
    return { bundle: bundleResult.value, checks: runDeterministicChecks(bundleResult.value) };
  }

  const specResult = await corpusService.create({
    type: "spec",
    title: "Review Test Spec",
    content: opts?.content ?? "## Acceptance Criteria\n\nSomething must happen.\n",
  } as CreateDocInput);
  if (!specResult.ok) throw new Error("spec create failed");

  const bundleResult = await corpusService.getReviewBundle(specResult.value.id);
  if (!bundleResult.ok) throw new Error("getReviewBundle failed");
  return { bundle: bundleResult.value, checks: runDeterministicChecks(bundleResult.value) };
}

// ─── HAPPY: valid response, single attempt ───────────────────────────────────

describe("judgeDoc — HAPPY (single-attempt success)", () => {
  it("a well-formed judge response produces an ok judgment carrying the model's decision/confidence/reasons", async () => {
    const store = new InMemoryStore();
    const { bundle, checks } = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_JSON });
    const { service } = makeReviewService({ provider });

    const result = await service.judgeDoc(bundle, checks, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decision).toBe("approve");
    expect(result.value.confidence).toBe(0.9);
    expect(result.value.reasons).toEqual([{ dimension: "completeness", finding: "Looks good" }]);
    expect(result.value.blocking_questions).toEqual([]);
  });

  it("doc_id/doc_version are taken from the bundle's doc, not fabricated", async () => {
    const store = new InMemoryStore();
    const { bundle, checks } = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_JSON });
    const { service } = makeReviewService({ provider });

    const result = await service.judgeDoc(bundle, checks, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.doc_id).toBe(bundle.doc.id);
    expect(result.value.doc_version).toBe(bundle.doc.version);
  });

  it("judge identity: provider === model === activeProviderName, prompt_version === 'v3'", async () => {
    const store = new InMemoryStore();
    const { bundle, checks } = await makeBundle(store);
    const provider = new InMemoryAIProvider("my-custom-provider", { kind: "ok", content: VALID_JSON });
    const { service } = makeReviewService({ provider });

    const result = await service.judgeDoc(bundle, checks, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.judge).toEqual({
      provider: "my-custom-provider",
      model: "my-custom-provider",
      // reason: judgeDoc stamps the currently-active REVIEW_PROMPT_VERSION (v1 → v2 SPEC-053, v2 → v3 #126),
      // so a real judge run now records "v3".
      prompt_version: "v3",
    });
  });

  it("an escalate decision with blocking_questions round-trips intact", async () => {
    const store = new InMemoryStore();
    const { bundle, checks } = await makeBundle(store);
    const escalateJson = JSON.stringify({
      decision: "escalate",
      confidence: 0.4,
      reasons: [{ dimension: "consistency", finding: "Ambiguous scope" }],
      blocking_questions: ["Is AC-7 in scope?"],
    });
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: escalateJson });
    const { service } = makeReviewService({ provider });

    const result = await service.judgeDoc(bundle, checks, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decision).toBe("escalate");
    expect(result.value.blocking_questions).toEqual(["Is AC-7 in scope?"]);
  });
});

// ─── checks override behavior ────────────────────────────────────────────────

describe("judgeDoc — checks override (SPEC-034 §4: deterministic checks are authoritative)", () => {
  it("result.value.checks deep-equals the EXACT checks argument, ignoring a divergent 'checks' field in the model's own JSON", async () => {
    const store = new InMemoryStore();
    const { bundle } = await makeBundle(store);
    // Deliberately pass in checks with a FAIL outcome the mocked "happy" fixture would never
    // naturally produce, and have the model's own JSON claim something different — proves the
    // returned checks come from the argument, not from re-deriving/echoing the model's opinion.
    const inputChecks: CheckResult[] = [
      { check: "schema", outcome: "fail", detail: "deliberately wrong for this test" },
      { check: "parent_contract", outcome: "pass" },
      { check: "tree_position", outcome: "skipped", detail: "no lore.tree.yaml" },
      { check: "link_integrity", outcome: "pass" },
      { check: "evidence_completeness", outcome: "skipped", detail: "not a task doc" },
    ];
    const jsonWithOwnChecks = JSON.stringify({
      decision: "reject",
      confidence: 0.5,
      reasons: [{ dimension: "completeness", finding: "Model thinks something else entirely" }],
      checks: [{ check: "schema", outcome: "pass" }], // model's own opinion — must be discarded
      blocking_questions: [],
    });
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: jsonWithOwnChecks });
    const { service } = makeReviewService({ provider });

    const result = await service.judgeDoc(bundle, inputChecks, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.checks).toEqual(inputChecks);
    // Sanity: the override is REAL, not a coincidence — the model's own checks field differs.
    expect(result.value.checks).not.toEqual([{ check: "schema", outcome: "pass" }]);
  });
});

// ─── Corrective retry success ────────────────────────────────────────────────

describe("judgeDoc — corrective retry success", () => {
  it("first malformed, second valid → ok; the SECOND call's content wins", async () => {
    const store = new InMemoryStore();
    const { bundle, checks } = await makeBundle(store);
    const secondJson = JSON.stringify({
      decision: "reject",
      confidence: 0.3,
      reasons: [{ dimension: "completeness", finding: "Second attempt's verdict" }],
      blocking_questions: [],
    });
    const provider = new InMemoryAIProvider("in-memory", {
      kind: "sequence",
      responses: [{ kind: "ok", content: "not valid json at all" }, { kind: "ok", content: secondJson }],
    });
    const { service } = makeReviewService({ provider });

    const result = await service.judgeDoc(bundle, checks, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decision).toBe("reject");
    expect(result.value.reasons).toEqual([{ dimension: "completeness", finding: "Second attempt's verdict" }]);
    expect(provider.calls).toHaveLength(2);
  });

  it("the retry prompt embeds a correction notice plus the original prompt content", async () => {
    const store = new InMemoryStore();
    const { bundle, checks } = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", {
      kind: "sequence",
      responses: [{ kind: "ok", content: "garbage, not json" }, { kind: "ok", content: VALID_JSON }],
    });
    const { service } = makeReviewService({ provider });

    await service.judgeDoc(bundle, checks, {});
    expect(provider.calls).toHaveLength(2);
    const retryPrompt = provider.calls[1]?.prompt ?? "";
    expect(retryPrompt).toContain("Correction Required");
    expect(retryPrompt).toContain(bundle.doc.title);
  });

  it("exactly 2 provider calls happen on the retry path, not 1 or 3", async () => {
    const store = new InMemoryStore();
    const { bundle, checks } = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", {
      kind: "sequence",
      responses: [{ kind: "ok", content: "garbage" }, { kind: "ok", content: VALID_JSON }],
    });
    const { service } = makeReviewService({ provider });

    await service.judgeDoc(bundle, checks, {});
    expect(provider.calls).toHaveLength(2);
  });
});

// ─── Double-malformed failure ─────────────────────────────────────────────────

describe("judgeDoc — double-malformed failure", () => {
  it("both responses malformed → AI_PROVIDER_ERROR, no judgment returned", async () => {
    const store = new InMemoryStore();
    const { bundle, checks } = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", {
      kind: "sequence",
      responses: [{ kind: "ok", content: "still not json" }, { kind: "ok", content: "still not json, second try" }],
    });
    const { service } = makeReviewService({ provider });

    const result = await service.judgeDoc(bundle, checks, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("AI_PROVIDER_ERROR");
  });

  it("the provider is never called a 3rd time after two malformed responses", async () => {
    const store = new InMemoryStore();
    const { bundle, checks } = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", {
      kind: "sequence",
      responses: [{ kind: "ok", content: "garbage one" }, { kind: "ok", content: "garbage two" }],
    });
    const { service } = makeReviewService({ provider });

    await service.judgeDoc(bundle, checks, {});
    expect(provider.calls).toHaveLength(2);
  });

  it("error message's raw-output prefix is capped at 500 chars", async () => {
    const store = new InMemoryStore();
    const { bundle, checks } = await makeBundle(store);
    const longGarbage = "not json ".repeat(200); // 1800 chars, well over 500
    const provider = new InMemoryAIProvider("in-memory", {
      kind: "sequence",
      responses: [{ kind: "ok", content: "not json" }, { kind: "ok", content: longGarbage }],
    });
    const { service } = makeReviewService({ provider });

    const result = await service.judgeDoc(bundle, checks, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect("message" in result.error ? result.error.message : "").not.toContain(longGarbage);
  });

  it("a transport-level provider error does NOT trigger a corrective retry (exactly 1 call)", async () => {
    const store = new InMemoryStore();
    const { bundle, checks } = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", {
      kind: "err",
      error: { code: "AI_PROVIDER_ERROR", provider: "in-memory", message: "binary missing" },
    });
    const { service } = makeReviewService({ provider });

    const result = await service.judgeDoc(bundle, checks, {});
    expect(result.ok).toBe(false);
    expect(provider.calls).toHaveLength(1);
  });
});

// ─── Telemetry: exactly-once + kind="review" + decision/confidence presence ──

describe("judgeDoc — telemetry exactly-once, kind='review'", () => {
  it("single-attempt success: emit is called exactly once", async () => {
    const store = new InMemoryStore();
    const { bundle, checks } = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_JSON });
    const { service, emitCalls } = makeReviewService({ provider });

    await service.judgeDoc(bundle, checks, {});
    expect(emitCalls).toHaveLength(1);
    expect(emitCalls[0]?.kind).toBe("review");
  });

  it("retry-success path: emit is called exactly once, not once per attempt", async () => {
    const store = new InMemoryStore();
    const { bundle, checks } = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", {
      kind: "sequence",
      responses: [{ kind: "ok", content: "garbage" }, { kind: "ok", content: VALID_JSON }],
    });
    const { service, emitCalls } = makeReviewService({ provider });

    await service.judgeDoc(bundle, checks, {});
    expect(emitCalls).toHaveLength(1);
  });

  it("double-malformed failure: emit is called exactly once", async () => {
    const store = new InMemoryStore();
    const { bundle, checks } = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", {
      kind: "sequence",
      responses: [{ kind: "ok", content: "garbage" }, { kind: "ok", content: "still garbage" }],
    });
    const { service, emitCalls } = makeReviewService({ provider });

    await service.judgeDoc(bundle, checks, {});
    expect(emitCalls).toHaveLength(1);
  });

  it("transport-error failure: emit is called exactly once", async () => {
    const store = new InMemoryStore();
    const { bundle, checks } = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", {
      kind: "err",
      error: { code: "AI_PROVIDER_ERROR", provider: "in-memory", message: "binary missing" },
    });
    const { service, emitCalls } = makeReviewService({ provider });

    await service.judgeDoc(bundle, checks, {});
    expect(emitCalls).toHaveLength(1);
  });

  it("aiTelemetryEnabled=false silences emit entirely, even on the retry-success path", async () => {
    const store = new InMemoryStore();
    const { bundle, checks } = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", {
      kind: "sequence",
      responses: [{ kind: "ok", content: "garbage" }, { kind: "ok", content: VALID_JSON }],
    });
    const { service, telemetry } = makeReviewService({ provider, aiTelemetryEnabled: false });

    await service.judgeDoc(bundle, checks, {});
    expect(telemetry.emit).not.toHaveBeenCalled();
  });

  it("decision/confidence are PRESENT (as real object keys) on a successful judgment", async () => {
    const store = new InMemoryStore();
    const { bundle, checks } = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_JSON });
    const { service, emitCalls } = makeReviewService({ provider });

    await service.judgeDoc(bundle, checks, {});
    const event = emitCalls[0] as unknown as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(event, "decision")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(event, "confidence")).toBe(true);
    expect(event["decision"]).toBe("approve");
    expect(event["confidence"]).toBe(0.9);
  });

  it("decision/confidence are ABSENT (not present-but-undefined) on a double-malformed failure", async () => {
    const store = new InMemoryStore();
    const { bundle, checks } = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", {
      kind: "sequence",
      responses: [{ kind: "ok", content: "garbage" }, { kind: "ok", content: "still garbage" }],
    });
    const { service, emitCalls } = makeReviewService({ provider });

    await service.judgeDoc(bundle, checks, {});
    const event = emitCalls[0] as unknown as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(event, "decision")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(event, "confidence")).toBe(false);
  });

  it("decision/confidence are ABSENT on a transport-level provider error", async () => {
    const store = new InMemoryStore();
    const { bundle, checks } = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", {
      kind: "err",
      error: { code: "AI_PROVIDER_ERROR", provider: "in-memory", message: "binary missing" },
    });
    const { service, emitCalls } = makeReviewService({ provider });

    await service.judgeDoc(bundle, checks, {});
    const event = emitCalls[0] as unknown as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(event, "decision")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(event, "confidence")).toBe(false);
  });

  it("emitted event's target_doc_id and doc_type mirror the reviewed doc", async () => {
    const store = new InMemoryStore();
    const { bundle, checks } = await makeBundle(store);
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_JSON });
    const { service, emitCalls } = makeReviewService({ provider });

    await service.judgeDoc(bundle, checks, {});
    expect(emitCalls[0]?.target_doc_id).toBe(bundle.doc.id);
    expect(emitCalls[0]?.doc_type).toBe(bundle.doc.type);
  });
});
