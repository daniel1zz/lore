/**
 * D9 (BR-268, spec-defect-clusters-round-2-part-b-review-pending-queue-corpus): the document under review is
 * never cut by `review-template.ts`, and `AIProviderService.judgeDoc` never stamps a judgment `truncated`.
 * (Formerly the SPEC-040 D8 doc-body truncation notice tests, AC-ADF-8; the notice now exists only for the parent.)
 *
 * @spec_ref AC-ADF-8
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect } from "vitest";
import { REVIEW_TEMPLATES, REVIEW_PROMPT_VERSION } from "../../../src/ai/review-template.js";
import { AIProviderService } from "../../../src/service/ai-provider-service.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { InMemoryAIProvider } from "../../../src/ai/in-memory-provider.js";
import { runDeterministicChecks } from "@lore/core";
import type { AIProvider, CreateDocInput, DocRecord, ReviewBundle, Telemetry, TelemetryEvent } from "@lore/core";
import { actedStore } from "../../live-invocation.js";

const BUDGETS = { max_context_chars: 8000 };

function makeDoc(overrides: Partial<DocRecord>): DocRecord {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FAV" as DocRecord["id"],
    slug: "spec-truncation-test" as DocRecord["slug"],
    type: "spec",
    role: "spec",
    title: "Truncation Test Spec",
    status: "draft",
    priority: "medium",
    content: "short content",
    parent_id: null,
    created_at: "2026-07-10T00:00:00.000Z",
    updated_at: "2026-07-10T00:00:00.000Z",
    created_by: "tester",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
    ...overrides,
  } as DocRecord;
}

// ─── Pure template-level tests ────────────────────────────────────────────────

describe("buildReviewPromptV1 (REVIEW_TEMPLATES) — the document under review is never cut (BR-268, D9)", () => {
  it("a 36000-char doc body is rendered whole: last line present, no notice, no 'doc' cut", () => {
    const content = "x".repeat(36000) + "\nLAST-LINE-MARKER";
    const bundle: ReviewBundle = { doc: makeDoc({ content }), links: [] };
    const result = REVIEW_TEMPLATES[REVIEW_PROMPT_VERSION]!(bundle, [], BUDGETS);

    expect(result.prompt).toContain(content);
    expect(result.prompt).not.toContain("# Truncation Notice");
    expect(result.truncated).not.toContain("doc");
    expect(result.cuts).toEqual([]);
  });

  it("BOUNDARY: a body of exactly 12000 chars (the old budget) is also whole", () => {
    const content = "y".repeat(12000);
    const bundle: ReviewBundle = { doc: makeDoc({ content }), links: [] };
    const result = REVIEW_TEMPLATES[REVIEW_PROMPT_VERSION]!(bundle, [], BUDGETS);

    expect(result.prompt).toContain(content);
    expect(result.truncated).toEqual([]);
  });
});

// ─── Integration-level: through AIProviderService.judgeDoc ──────────────────

function makeReviewService(provider: InMemoryAIProvider) {
  const telemetry: Telemetry = {
    record: (_event: TelemetryEvent) => {},
    emit: () => {},
    close: () => {},
  };
  const providers = new Map([[provider.name, provider]]) as unknown as ReadonlyMap<string, AIProvider>;
  return new AIProviderService(providers, provider.name, {}, telemetry, false, 8000, {
    max_plan_chars: 8000,
    max_spec_chars: 12000,
    max_task_chars: 4000,
    max_diff_chars: 24000,
  });
}

const VALID_REVIEW_JSON = JSON.stringify({
  decision: "approve",
  confidence: 0.9,
  reasons: [{ dimension: "completeness", finding: "Looks good" }],
  blocking_questions: [],
});

async function makeReviewBundle(store: InMemoryStore, content: string) {
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const prdResult = await corpusService.create({
    type: "prd",
    title: "Review Truncation Test PRD",
    content: "Root PRD.",
  } as CreateDocInput);
  if (!prdResult.ok) throw new Error("prd create failed");

  const specResult = await corpusService.create({
    type: "spec",
    title: "Review Truncation Test Spec",
    content,
  } as CreateDocInput);
  if (!specResult.ok) throw new Error("spec create failed");

  const bundleResult = await corpusService.getReviewBundle(specResult.value.id);
  if (!bundleResult.ok) throw new Error("getReviewBundle failed");
  return bundleResult.value;
}

describe("AIProviderService.judgeDoc — never stamps judgment.truncated (D9)", () => {
  it("a 36000-char spec body: the judgment has NO truncated key and the provider saw the whole body", async () => {
    const store = actedStore(new InMemoryStore());
    const body = "z".repeat(36000) + "\nLAST-LINE-MARKER";
    const bundle = await makeReviewBundle(store, body);
    const checks = runDeterministicChecks(bundle);
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_REVIEW_JSON });
    const service = makeReviewService(provider);

    const result = await service.judgeDoc(bundle, checks, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect("truncated" in result.value).toBe(false);
    expect(provider.calls[0]!.prompt).toContain("LAST-LINE-MARKER");
  });

  it("a small spec body: the truncated key is ABSENT entirely (additive-only, never a stored false)", async () => {
    const store = actedStore(new InMemoryStore());
    const bundle = await makeReviewBundle(store, "Small spec body, well under budget.");
    const checks = runDeterministicChecks(bundle);
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_REVIEW_JSON });
    const service = makeReviewService(provider);

    const result = await service.judgeDoc(bundle, checks, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect("truncated" in result.value).toBe(false);
    expect(result.value.truncated).toBeUndefined();
  });
});
