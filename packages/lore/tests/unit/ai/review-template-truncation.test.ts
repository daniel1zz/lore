/**
 * Tests for the SPEC-040 §T2 D8 doc-body truncation notice in `review-template.ts`'s
 * `buildReviewPromptV1` (registered as `REVIEW_TEMPLATES[REVIEW_PROMPT_VERSION]`), and its
 * wiring into `AIProviderService.judgeDoc`'s persisted `NewReviewJudgment.truncated`.
 *
 * Spec-first expectations:
 *   - When the DOCUMENT BODY (not parent context) exceeds `budgets.max_doc_chars`, the
 *     prompt gains a "# Truncation Notice" section and `docTruncated` is `true`.
 *   - At the exact boundary (`content.length === max_doc_chars`), `truncateSection`'s
 *     documented `<=` no-op rule means NO truncation occurs — `docTruncated` is `false` and
 *     the notice section is absent.
 *   - `AIProviderService.judgeDoc` stamps `truncated: true` on the persisted judgment ONLY
 *     when `docTruncated` was true — and OMITS the key entirely (not `truncated: false`)
 *     otherwise, mirroring the additive-only convention documented on
 *     `reviewJudgmentBaseShape.truncated`.
 *
 * @spec_ref AC-ADF-8
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { describe, it, expect } from "vitest";
import { REVIEW_TEMPLATES, REVIEW_PROMPT_VERSION } from "../../../src/ai/review-template.js";
import { AIProviderService } from "../../../src/service/ai-provider-service.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { InMemoryAIProvider } from "../../../src/ai/in-memory-provider.js";
import { runDeterministicChecks } from "@lore/core";
import type { AIProvider, CreateDocInput, DocRecord, ReviewBundle, Telemetry, TelemetryEvent } from "@lore/core";

const BUDGETS = { max_doc_chars: 12000, max_context_chars: 8000 };

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

describe("buildReviewPromptV1 (REVIEW_TEMPLATES) — doc-body truncation notice (AC-ADF-8)", () => {
  it("NEGATIVE/BOUNDARY: a doc body over max_doc_chars sets docTruncated=true, adds the Truncation Notice section, and truncated includes 'doc'", () => {
    const bundle: ReviewBundle = {
      doc: makeDoc({ content: "x".repeat(36000) }),
      links: [],
    };
    const template = REVIEW_TEMPLATES[REVIEW_PROMPT_VERSION]!;
    const result = template(bundle, [], BUDGETS);

    expect(result.docTruncated).toBe(true);
    expect(result.prompt).toContain("# Truncation Notice");
    expect(result.truncated).toContain("doc");
  });

  it("BOUNDARY: a doc body EXACTLY at max_doc_chars is NOT truncated (truncateSection's documented <= no-op boundary)", () => {
    const bundle: ReviewBundle = {
      doc: makeDoc({ content: "y".repeat(12000) }),
      links: [],
    };
    const template = REVIEW_TEMPLATES[REVIEW_PROMPT_VERSION]!;
    const result = template(bundle, [], BUDGETS);

    expect(result.docTruncated).toBe(false);
    expect(result.prompt).not.toContain("# Truncation Notice");
    expect(result.truncated).not.toContain("doc");
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
  const corpusService = new CorpusService(store, new RecordLockService(store));
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

describe("AIProviderService.judgeDoc — persisted judgment.truncated mirrors docTruncated (AC-ADF-8)", () => {
  it("a 36000-char spec body: the returned NewReviewJudgment has truncated === true", async () => {
    const store = new InMemoryStore();
    const bundle = await makeReviewBundle(store, "z".repeat(36000));
    const checks = runDeterministicChecks(bundle);
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_REVIEW_JSON });
    const service = makeReviewService(provider);

    const result = await service.judgeDoc(bundle, checks, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.truncated).toBe(true);
  });

  it("a small spec body: the truncated key is ABSENT entirely (additive-only, never a stored false)", async () => {
    const store = new InMemoryStore();
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
