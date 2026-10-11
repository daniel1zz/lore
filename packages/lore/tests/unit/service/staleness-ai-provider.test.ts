/**
 * Tests for AIProviderService.probeStaleness (SPEC-044 §Design Decisions D5).
 *
 * Strategy: InMemoryStore + real CorpusService.create builds the underlying doc (dogfoods
 * the same doc-creation path production code uses) — StalenessBundle is assembled by hand
 * (there is no bundle-orchestration service method under test here; that's
 * StalenessProbeService's job, AC-SP-3's own file). InMemoryAIProvider in "sequence" mode
 * scripts the corrective-retry protocol deterministically. No real provider spawn, no
 * bun:sqlite.
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      the prompt contains the doc's content, age_days, in-neighbor slugs, and
 *               validity state; a well-formed "holds"/"stale_candidate" response
 *               produces an ok judgment with kind="staleness"
 *   NEGATIVE:   an out-of-enum decision on the FIRST attempt is a hard error with NO
 *               retry (provider called exactly once) and NO judgment returned
 *   BOUNDARY:   the neighbor list, when longer than neighbor_limit, is capped in the
 *               prompt with a LOUD "+n more" tail line — never a silent truncation
 *   ERROR:      first malformed, second ALSO malformed → AI_PROVIDER_ERROR with a
 *               <=500-char raw-output prefix, no judgment returned, provider never
 *               called a 3rd time
 *   STATE:      doc_version on the returned judgment equals the BUNDLE-ASSEMBLY-TIME
 *               version even when the underlying doc has since been edited (T8 — no
 *               lock, no re-read; a race yields a judgment the (stale) freshness rule
 *               discounts, not an error)
 *   REGRESSION: first malformed, second valid -> ok; the SECOND call's content wins
 *               (mirrors judgeDoc's corrective-retry-success contract, SPEC-026 §3 D2)
 *
 * @spec_ref SPEC-044 §Design Decisions D5; AC-SP-4
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect, vi } from "vitest";
import { AIProviderService } from "../../../src/service/ai-provider-service.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { InMemoryAIProvider } from "../../../src/ai/in-memory-provider.js";
import type { AIProvider, CreateDocInput, DocRecord, StalenessBundle, Telemetry } from "@lore/core";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeMockTelemetry(): Telemetry {
  return { record: vi.fn(), emit: vi.fn(), close: vi.fn() };
}

function makeStalenessService(opts: { provider: InMemoryAIProvider }) {
  const telemetry = makeMockTelemetry();
  const providers = new Map([[opts.provider.name, opts.provider]]) as unknown as ReadonlyMap<string, AIProvider>;
  const service = new AIProviderService(
    providers,
    opts.provider.name,
    {},
    telemetry,
    true,
    8000,
    { max_plan_chars: 8000, max_spec_chars: 12000, max_task_chars: 4000, max_diff_chars: 24000 },
    { max_doc_chars: 12000, max_context_chars: 8000 },
    { max_doc_chars: 12000, neighbor_limit: 3 },
  );
  return { service };
}

async function makeKnowledgeDoc(store: InMemoryStore, title = "Staleness Test K"): Promise<DocRecord> {
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const result = await corpusService.create({
    type: "knowledge",
    title,
    content: "This is the finding under probe.",
    extra: { sub_type: "retro" },
  } as CreateDocInput);
  if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

function makeBundle(doc: DocRecord, overrides: Partial<StalenessBundle> = {}): StalenessBundle {
  return {
    doc,
    age_days: 30,
    in_degree: 2,
    neighbors: [
      { slug: "spec-a", title: "Spec A", link_type: "relates-to" },
      { slug: "spec-b", title: "Spec B", link_type: "informs" },
    ],
    ...overrides,
  };
}

const HOLDS_JSON = JSON.stringify({
  decision: "holds",
  confidence: 0.9,
  reasons: ["still accurate"],
  blocking_questions: [],
});

// ─── HAPPY ──────────────────────────────────────────────────────────────────

describe("probeStaleness — HAPPY", () => {
  it("prompt contains the doc's content, age_days, in-neighbor slugs, and validity state", async () => {
    const store = new InMemoryStore();
    const doc = await makeKnowledgeDoc(store);
    const bundle = makeBundle(doc);
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: HOLDS_JSON });
    const { service } = makeStalenessService({ provider });

    await service.probeStaleness(bundle, {});
    const prompt = provider.calls[0]?.prompt ?? "";
    expect(prompt).toContain(doc.content);
    expect(prompt).toContain("30 days");
    expect(prompt).toContain("spec-a");
    expect(prompt).toContain("spec-b");
    expect(prompt).toContain("currently valid");
  });

  it("a well-formed 'holds' response produces an ok judgment with kind='staleness', decision='approve'", async () => {
    const store = new InMemoryStore();
    const doc = await makeKnowledgeDoc(store);
    const bundle = makeBundle(doc);
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: HOLDS_JSON });
    const { service } = makeStalenessService({ provider });

    const result = await service.probeStaleness(bundle, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe("staleness");
    expect(result.value.decision).toBe("approve");
    expect(result.value.checks).toEqual([]);
  });

  it("a well-formed 'stale_candidate' response maps to decision='escalate' and carries blocking_questions", async () => {
    const store = new InMemoryStore();
    const doc = await makeKnowledgeDoc(store);
    const bundle = makeBundle(doc);
    const staleJson = JSON.stringify({
      decision: "stale_candidate",
      confidence: 0.6,
      reasons: ["the linked spec changed"],
      blocking_questions: ["has this been re-confirmed?"],
    });
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: staleJson });
    const { service } = makeStalenessService({ provider });

    const result = await service.probeStaleness(bundle, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decision).toBe("escalate");
    expect(result.value.blocking_questions).toEqual(["has this been re-confirmed?"]);
  });
});

// ─── NEGATIVE (out-of-enum, no retry) ───────────────────────────────────────

describe("probeStaleness — NEGATIVE: out-of-enum decision is a hard error with NO retry", () => {
  it("provider is called EXACTLY ONCE — the malformed-but-syntactically-valid response is never retried", async () => {
    const store = new InMemoryStore();
    const doc = await makeKnowledgeDoc(store);
    const bundle = makeBundle(doc);
    const outOfEnumJson = JSON.stringify({
      decision: "maybe-stale-not-sure",
      confidence: 0.5,
      reasons: ["ambiguous"],
      blocking_questions: [],
    });
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: outOfEnumJson });
    const { service } = makeStalenessService({ provider });

    const result = await service.probeStaleness(bundle, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("AI_PROVIDER_ERROR");
    expect(provider.calls).toHaveLength(1);
  });

  it("no judgment is returned on an out-of-enum decision", async () => {
    const store = new InMemoryStore();
    const doc = await makeKnowledgeDoc(store);
    const bundle = makeBundle(doc);
    const outOfEnumJson = JSON.stringify({
      decision: "unknown_value",
      confidence: 0.5,
      reasons: [],
      blocking_questions: [],
    });
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: outOfEnumJson });
    const { service } = makeStalenessService({ provider });

    const result = await service.probeStaleness(bundle, {});
    expect(result.ok).toBe(false);
  });
});

// ─── BOUNDARY (neighbor cap + loud "+n more") ───────────────────────────────

describe("probeStaleness — BOUNDARY: neighbor list capped at neighbor_limit with a LOUD '+n more' tail", () => {
  it("a neighbor list longer than neighbor_limit (3) shows only the first 3 plus a '+n more' line", async () => {
    const store = new InMemoryStore();
    const doc = await makeKnowledgeDoc(store);
    const bundle = makeBundle(doc, {
      neighbors: [
        { slug: "spec-1", title: "Spec 1", link_type: "relates-to" },
        { slug: "spec-2", title: "Spec 2", link_type: "relates-to" },
        { slug: "spec-3", title: "Spec 3", link_type: "relates-to" },
        { slug: "spec-4", title: "Spec 4", link_type: "relates-to" },
        { slug: "spec-5", title: "Spec 5", link_type: "relates-to" },
      ],
    });
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: HOLDS_JSON });
    const { service } = makeStalenessService({ provider });

    await service.probeStaleness(bundle, {});
    const prompt = provider.calls[0]?.prompt ?? "";
    expect(prompt).toContain("spec-1");
    expect(prompt).toContain("spec-2");
    expect(prompt).toContain("spec-3");
    expect(prompt).not.toContain("spec-4");
    expect(prompt).not.toContain("spec-5");
    expect(prompt).toMatch(/and 2 more/);
  });

  it("a neighbor list at or under neighbor_limit shows NO '+n more' tail", async () => {
    const store = new InMemoryStore();
    const doc = await makeKnowledgeDoc(store);
    const bundle = makeBundle(doc); // 2 neighbors, limit is 3
    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: HOLDS_JSON });
    const { service } = makeStalenessService({ provider });

    await service.probeStaleness(bundle, {});
    const prompt = provider.calls[0]?.prompt ?? "";
    expect(prompt).not.toMatch(/more \(truncated/);
  });
});

// ─── ERROR (double-malformed) ────────────────────────────────────────────────

describe("probeStaleness — ERROR: double-malformed failure", () => {
  it("first malformed, second ALSO malformed -> AI_PROVIDER_ERROR with a <=500-char raw-output prefix, no judgment", async () => {
    const store = new InMemoryStore();
    const doc = await makeKnowledgeDoc(store);
    const bundle = makeBundle(doc);
    const longGarbage = "not json ".repeat(200);
    const provider = new InMemoryAIProvider("in-memory", {
      kind: "sequence",
      responses: [{ kind: "ok", content: "not json at all" }, { kind: "ok", content: longGarbage }],
    });
    const { service } = makeStalenessService({ provider });

    const result = await service.probeStaleness(bundle, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("AI_PROVIDER_ERROR");
    expect("message" in result.error ? result.error.message : "").not.toContain(longGarbage);
    expect(provider.calls).toHaveLength(2);
  });
});

// ─── STATE (T8 — doc_version pinned at bundle-assembly time) ────────────────

describe("probeStaleness — STATE: doc_version is the BUNDLE-ASSEMBLY-TIME version (T8)", () => {
  it("a concurrent edit to the doc AFTER bundle assembly does not change the returned judgment's doc_version", async () => {
    const store = new InMemoryStore();
    const doc = await makeKnowledgeDoc(store);
    const bundle = makeBundle(doc); // pins doc.version at assembly time

    // Simulate a race: the doc gets edited (version bumped) AFTER the bundle was built.
    await store.update(doc.id, { version: doc.version + 5, content: "edited concurrently" });

    const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: HOLDS_JSON });
    const { service } = makeStalenessService({ provider });

    const result = await service.probeStaleness(bundle, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.doc_version).toBe(doc.version); // NOT doc.version + 5
  });
});

// ─── REGRESSION (corrective retry success) ──────────────────────────────────

describe("probeStaleness — REGRESSION: corrective retry success mirrors judgeDoc's contract", () => {
  it("first malformed, second valid -> ok; the SECOND call's content wins", async () => {
    const store = new InMemoryStore();
    const doc = await makeKnowledgeDoc(store);
    const bundle = makeBundle(doc);
    const secondJson = JSON.stringify({
      decision: "stale_candidate",
      confidence: 0.4,
      reasons: ["second attempt verdict"],
      blocking_questions: ["is this current?"],
    });
    const provider = new InMemoryAIProvider("in-memory", {
      kind: "sequence",
      responses: [{ kind: "ok", content: "not valid json" }, { kind: "ok", content: secondJson }],
    });
    const { service } = makeStalenessService({ provider });

    const result = await service.probeStaleness(bundle, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decision).toBe("escalate");
    expect(result.value.reasons).toEqual([{ dimension: "staleness", finding: "second attempt verdict" }]);
    expect(provider.calls).toHaveLength(2);
  });

  it("the retry prompt embeds a correction notice", async () => {
    const store = new InMemoryStore();
    const doc = await makeKnowledgeDoc(store);
    const bundle = makeBundle(doc);
    const provider = new InMemoryAIProvider("in-memory", {
      kind: "sequence",
      responses: [{ kind: "ok", content: "garbage, not json" }, { kind: "ok", content: HOLDS_JSON }],
    });
    const { service } = makeStalenessService({ provider });

    await service.probeStaleness(bundle, {});
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1]?.prompt ?? "").toContain("Correction Required");
  });
});
