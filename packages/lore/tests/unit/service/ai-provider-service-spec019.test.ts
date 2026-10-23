/**
 * Tests for AIProviderService SPEC-019 methods:
 *   regenerateContent / refineContent / inferLinkType / refineMaxInputChars
 *
 * Strategy: inject InMemoryAIProvider + spy-mock Telemetry.
 * No real provider spawn, no bun:sqlite — pure unit tests with full control.
 *
 * Spec-first expectations (from SPEC-019 §9.1–§9.5):
 *
 *   regenerateContent (AC-SET-AI-1):
 *     - Returns ok(GenerateOutput) from provider
 *     - Uses BUILT_IN_TEMPLATES[doc.type] when no user override
 *     - Uses user template override when templates[doc.type] is set
 *     - Emits kind="regenerate" + target_doc_id=doc.id in telemetry
 *     - Provider failure → err(AI_PROVIDER_ERROR), still emits telemetry
 *
 *   refineContent (AC-SET-AI-2, §9.4):
 *     - Builds prompt from REFINE_TEMPLATE containing title + content + userPrompt
 *     - Emits kind="refine" + target_doc_id=doc.id in telemetry
 *     - Content > refineMaxInputChars → truncated in prompt
 *     - Content ≤ refineMaxInputChars → NOT truncated
 *     - Provider failure → err, emits telemetry
 *
 *   inferLinkType (AC-LINK-AI-1, AC-LINK-AI-2):
 *     - Provider returns valid type → ok({ linkType })
 *     - Provider returns uppercase+whitespace → normalized (trim+lower)
 *     - Provider returns invalid value → err(AI_PROVIDER_ERROR), telemetry emitted
 *     - Provider failure → err propagated, telemetry emitted
 *     - target_doc_id=from.id (not to.id) in all telemetry
 *
 *   refineMaxInputChars getter:
 *     - Returns the configured max chars (not hardcoded)
 *
 * Adversarial angles:
 *   - telemetry kind MUST be the method-specific value, not "create"
 *   - target_doc_id MUST be doc.id (not null) for regenerate/refine/infer
 *   - "banana" MUST yield err — linkTypeSchema validation is not skipped
 *   - Truncation boundary is exact (> limit → slice(0, limit); ≤ limit → untouched)
 *   - Provider error is never swallowed — result.ok must be false
 *
 * @spec_ref AC-SET-AI-1, AC-SET-AI-2, AC-LINK-AI-1, AC-LINK-AI-2, AC-AI-FAIL-1, AC-AI-TEL-1, SPEC-019 §9.1–§9.5
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AIProviderService } from "../../../src/service/ai-provider-service.js";
import { InMemoryAIProvider } from "../../../src/ai/in-memory-provider.js";
import { BUILT_IN_TEMPLATES } from "../../../src/ai/templates.js";
import type { Telemetry, TelemetryEvent, AiGenerationEvent, DocRecord } from "@lore/core";

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

/**
 * Build a service with the given overrides.
 * Defaults: in-memory ok-mode, telemetry enabled, no template overrides, 8000 max chars.
 */
function makeService({
  providerMode = { kind: "ok" as const, content: "# Stub\n" },
  templates = {} as Record<string, string>,
  aiTelemetryEnabled = true,
  providerName = "in-memory",
  refineMaxInputChars = 8000,
}: {
  providerMode?: { kind: "ok"; content: string } | { kind: "err"; error: { code: "AI_PROVIDER_ERROR"; message: string; provider?: string; exit_code?: number } };
  templates?: Record<string, string>;
  aiTelemetryEnabled?: boolean;
  providerName?: string;
  refineMaxInputChars?: number;
} = {}) {
  const provider = new InMemoryAIProvider(providerName, providerMode as never);
  const { telemetry, emitCalls } = makeMockTelemetry();
  const providers = new Map([[providerName, provider]]) as unknown as ReadonlyMap<string, import("@lore/core").AIProvider>;
  const service = new AIProviderService(
    providers,
    providerName,
    templates,
    telemetry,
    aiTelemetryEnabled,
    refineMaxInputChars,
    { max_diff_chars: 24000 }, // assessBudgets — SPEC-026 default
  );
  return { service, provider, telemetry, emitCalls };
}

/**
 * Build a minimal DocRecord for testing.
 * Only fields consumed by AIProviderService matter; others use sensible stubs.
 */
function makeDoc(overrides: Partial<DocRecord> = {}): DocRecord {
  return {
    id: "01HTEST000000000000000DOC1",
    slug: "prd-my-test-doc",
    type: "prd",
    role: "intent",
    title: "My Test PRD",
    status: "draft",
    priority: "medium",
    content: "## Overview\n\nThis is the document body.",
    parent_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    created_by: "test",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
    ...overrides,
  };
}

// ─── regenerateContent — HAPPY ────────────────────────────────────────────────

describe("AIProviderService.regenerateContent — HAPPY", () => {
  it("returns ok(GenerateOutput) with content from the provider", async () => {
    const { service } = makeService({ providerMode: { kind: "ok", content: "# Regenerated\n" } });
    const doc = makeDoc({ type: "prd", title: "Auth Module" });
    const result = await service.regenerateContent(doc);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.value.content).toBe("# Regenerated\n");
  });

  it("uses BUILT_IN_TEMPLATES[doc.type] when no user override — prd prompt contains PRD marker", async () => {
    const { service, provider } = makeService();
    const doc = makeDoc({ type: "prd", title: "My PRD" });
    await service.regenerateContent(doc);
    const prompt = provider.calls[0]?.prompt ?? "";
    // Built-in PRD template includes "Product Requirements Document"
    expect(prompt).toContain("Product Requirements Document");
    // Title must be interpolated
    expect(prompt).toContain("My PRD");
    // No raw placeholder markers remain
    expect(prompt).not.toContain("{{title}}");
  });

  it("different doc types produce different prompts (anti-hardcoded)", async () => {
    const { service, provider: p1 } = makeService();
    const { service: svc2, provider: p2 } = makeService();
    await service.regenerateContent(makeDoc({ type: "adr", title: "T" }));
    await svc2.regenerateContent(makeDoc({ type: "knowledge", title: "T" }));
    // ADR prompt must differ from knowledge prompt — guards against returning the same hardcoded string
    expect(p1.calls[0]?.prompt).not.toBe(p2.calls[0]?.prompt);
  });

  it("uses user template override for doc.type when set in templates", async () => {
    const { service, provider } = makeService({
      templates: { spec: "Custom SPEC template for {{title}}" },
    });
    const doc = makeDoc({ type: "spec", title: "Auth Spec" });
    await service.regenerateContent(doc);
    const prompt = provider.calls[0]?.prompt ?? "";
    expect(prompt).toBe("Custom SPEC template for Auth Spec");
    // Must NOT contain built-in spec template text
    expect(prompt).not.toContain("Acceptance Criteria");
  });

  it("user override for 'spec' does NOT affect 'prd' — built-in used for prd", async () => {
    const { service, provider } = makeService({
      templates: { spec: "Override spec {{title}}" },
    });
    const doc = makeDoc({ type: "prd", title: "My PRD" });
    await service.regenerateContent(doc);
    const prompt = provider.calls[0]?.prompt ?? "";
    expect(prompt).toContain("Product Requirements Document");
  });

  it("emits exactly one telemetry event on success", async () => {
    const { service, emitCalls } = makeService();
    await service.regenerateContent(makeDoc());
    expect(emitCalls).toHaveLength(1);
  });

  it("telemetry event has kind='regenerate' (not 'create')", async () => {
    const { service, emitCalls } = makeService();
    await service.regenerateContent(makeDoc());
    expect(emitCalls[0]?.kind).toBe("regenerate");
  });

  it("telemetry event has target_doc_id=doc.id", async () => {
    const docId = "01HTEST000000000000000ABC1";
    const { service, emitCalls } = makeService();
    await service.regenerateContent(makeDoc({ id: docId }));
    expect(emitCalls[0]?.target_doc_id).toBe(docId);
  });

  it("target_doc_id is NOT null — adversarial vs generate() which emits null", async () => {
    const { service, emitCalls } = makeService();
    await service.regenerateContent(makeDoc({ id: "01HTEST000000000000000CCC2" }));
    expect(emitCalls[0]?.target_doc_id).not.toBeNull();
  });

  it("telemetry event has exit_code=0 on success", async () => {
    const { service, emitCalls } = makeService();
    await service.regenerateContent(makeDoc());
    expect(emitCalls[0]?.exit_code).toBe(0);
  });
});

// ─── regenerateContent — ERROR ────────────────────────────────────────────────

describe("AIProviderService.regenerateContent — ERROR", () => {
  it("provider failure → returns err(AI_PROVIDER_ERROR) without throwing", async () => {
    const { service } = makeService({
      providerMode: { kind: "err", error: { code: "AI_PROVIDER_ERROR", message: "binary not found" } },
    });
    const result = await service.regenerateContent(makeDoc());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected err");
    expect(result.error.code).toBe("AI_PROVIDER_ERROR");
  });

  it("provider failure → still emits telemetry with kind='regenerate'", async () => {
    const { service, emitCalls } = makeService({
      providerMode: { kind: "err", error: { code: "AI_PROVIDER_ERROR", message: "fail", exit_code: 1 } },
    });
    await service.regenerateContent(makeDoc());
    expect(emitCalls).toHaveLength(1);
    expect(emitCalls[0]?.kind).toBe("regenerate");
  });

  it("provider failure → telemetry has error field set and output_chars=0", async () => {
    const { service, emitCalls } = makeService({
      providerMode: { kind: "err", error: { code: "AI_PROVIDER_ERROR", message: "spawn failed" } },
    });
    await service.regenerateContent(makeDoc());
    expect(emitCalls[0]?.error).toBeDefined();
    expect(emitCalls[0]?.output_chars).toBe(0);
  });

  it("provider failure → telemetry still has target_doc_id=doc.id", async () => {
    const docId = "01HTEST000000000000000ERR3";
    const { service, emitCalls } = makeService({
      providerMode: { kind: "err", error: { code: "AI_PROVIDER_ERROR", message: "fail" } },
    });
    await service.regenerateContent(makeDoc({ id: docId }));
    expect(emitCalls[0]?.target_doc_id).toBe(docId);
  });
});

// ─── refineContent — HAPPY ────────────────────────────────────────────────────

describe("AIProviderService.refineContent — HAPPY", () => {
  it("returns ok(GenerateOutput) from provider", async () => {
    const { service } = makeService({ providerMode: { kind: "ok", content: "# Refined output\n" } });
    const result = await service.refineContent(makeDoc({ content: "## Old content\n" }), "Make it shorter");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.value.content).toBe("# Refined output\n");
  });

  it("prompt contains the document title", async () => {
    const { service, provider } = makeService();
    const doc = makeDoc({ title: "My PRD Title", content: "Some content" });
    await service.refineContent(doc, "Improve clarity");
    const prompt = provider.calls[0]?.prompt ?? "";
    expect(prompt).toContain("My PRD Title");
  });

  it("prompt contains the existing document content", async () => {
    const { service, provider } = makeService();
    const doc = makeDoc({ content: "## Section One\nHere is the body.\n" });
    await service.refineContent(doc, "Summarize");
    const prompt = provider.calls[0]?.prompt ?? "";
    expect(prompt).toContain("Section One");
    expect(prompt).toContain("Here is the body.");
  });

  it("prompt contains the user-supplied refinement instruction", async () => {
    const { service, provider } = makeService();
    const instruction = "Add a section on error handling and rollback";
    await service.refineContent(makeDoc(), instruction);
    const prompt = provider.calls[0]?.prompt ?? "";
    expect(prompt).toContain(instruction);
  });

  it("emits exactly one telemetry event on success", async () => {
    const { service, emitCalls } = makeService();
    await service.refineContent(makeDoc(), "Fix");
    expect(emitCalls).toHaveLength(1);
  });

  it("telemetry event has kind='refine' (not 'create' or 'regenerate')", async () => {
    const { service, emitCalls } = makeService();
    await service.refineContent(makeDoc(), "Fix grammar");
    expect(emitCalls[0]?.kind).toBe("refine");
  });

  it("telemetry event has target_doc_id=doc.id", async () => {
    const docId = "01HTEST000000000000000DEF4";
    const { service, emitCalls } = makeService();
    await service.refineContent(makeDoc({ id: docId }), "Shorten");
    expect(emitCalls[0]?.target_doc_id).toBe(docId);
  });

  it("target_doc_id is NOT null — adversarial vs generate() which emits null", async () => {
    const { service, emitCalls } = makeService();
    await service.refineContent(makeDoc({ id: "01HTEST000000000000000GHI5" }), "Rewrite");
    expect(emitCalls[0]?.target_doc_id).not.toBeNull();
  });

  it("telemetry event has exit_code=0 on success", async () => {
    const { service, emitCalls } = makeService();
    await service.refineContent(makeDoc(), "Improve");
    expect(emitCalls[0]?.exit_code).toBe(0);
  });
});

// ─── refineContent — BOUNDARY (content truncation) ───────────────────────────

describe("AIProviderService.refineContent — BOUNDARY (content truncation at refineMaxInputChars)", () => {
  it("content exactly at limit is NOT truncated", async () => {
    const { service, provider } = makeService({ refineMaxInputChars: 100 });
    const exactContent = "A".repeat(100);
    const doc = makeDoc({ content: exactContent });
    await service.refineContent(doc, "Improve");
    const prompt = provider.calls[0]?.prompt ?? "";
    // Full 100-char string must appear in the prompt
    expect(prompt).toContain(exactContent);
  });

  it("content one char under limit (99) is NOT truncated", async () => {
    const { service, provider } = makeService({ refineMaxInputChars: 100 });
    const shortContent = "B".repeat(99);
    await service.refineContent(makeDoc({ content: shortContent }), "Improve");
    const prompt = provider.calls[0]?.prompt ?? "";
    expect(prompt).toContain(shortContent);
  });

  it("content one char over limit (101) is truncated to exactly 100 chars", async () => {
    const { service, provider } = makeService({ refineMaxInputChars: 100 });
    const fullContent = "C".repeat(101);
    await service.refineContent(makeDoc({ content: fullContent }), "Improve");
    const prompt = provider.calls[0]?.prompt ?? "";
    // Full 101-char content must NOT appear
    expect(prompt).not.toContain(fullContent);
    // Exactly the first 100 chars must appear
    expect(prompt).toContain("C".repeat(100));
  });

  it("content at default 8000-char limit is NOT truncated", async () => {
    const { service, provider } = makeService(); // refineMaxInputChars=8000
    const exactContent = "X".repeat(8000);
    await service.refineContent(makeDoc({ content: exactContent }), "Improve");
    const prompt = provider.calls[0]?.prompt ?? "";
    expect(prompt).toContain(exactContent);
  });

  it("content at 8001 chars IS truncated to 8000 with default limit", async () => {
    const { service, provider } = makeService(); // refineMaxInputChars=8000
    const longContent = "Y".repeat(8001);
    await service.refineContent(makeDoc({ content: longContent }), "Improve");
    const prompt = provider.calls[0]?.prompt ?? "";
    // Full 8001-char string must not appear
    expect(prompt).not.toContain(longContent);
    // First 8000 chars must appear
    expect(prompt).toContain("Y".repeat(8000));
  });
});

// ─── refineContent — ERROR ────────────────────────────────────────────────────

describe("AIProviderService.refineContent — ERROR", () => {
  it("provider failure → returns err without throwing", async () => {
    const { service } = makeService({
      providerMode: { kind: "err", error: { code: "AI_PROVIDER_ERROR", message: "timeout", exit_code: -1 } },
    });
    const result = await service.refineContent(makeDoc(), "Fix this");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected err");
    expect(result.error.code).toBe("AI_PROVIDER_ERROR");
  });

  it("provider failure → emits telemetry with kind='refine'", async () => {
    const { service, emitCalls } = makeService({
      providerMode: { kind: "err", error: { code: "AI_PROVIDER_ERROR", message: "fail" } },
    });
    await service.refineContent(makeDoc(), "Fix");
    expect(emitCalls).toHaveLength(1);
    expect(emitCalls[0]?.kind).toBe("refine");
  });

  it("provider failure → telemetry has output_chars=0 and error field set", async () => {
    const { service, emitCalls } = makeService({
      providerMode: { kind: "err", error: { code: "AI_PROVIDER_ERROR", message: "killed" } },
    });
    await service.refineContent(makeDoc(), "Fix");
    expect(emitCalls[0]?.output_chars).toBe(0);
    expect(emitCalls[0]?.error).toBeDefined();
  });
});

// ─── inferLinkType — HAPPY (AC-LINK-AI-1) ────────────────────────────────────

describe("AIProviderService.inferLinkType — HAPPY (AC-LINK-AI-1)", () => {
  it("provider returns 'relates-to' → ok({ linkType: 'relates-to' })", async () => {
    const { service } = makeService({ providerMode: { kind: "ok", content: "relates-to" } });
    const from = makeDoc({ id: "01HFROM00000000000000FROM1", type: "prd", title: "Source" });
    const to = makeDoc({ id: "01HTO000000000000000000TO1", type: "spec", title: "Target" });
    const result = await service.inferLinkType(from, to);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.value.linkType).toBe("relates-to");
  });

  it("accepts all six valid link types — 'parent'", async () => {
    const { service } = makeService({ providerMode: { kind: "ok", content: "parent" } });
    const result = await service.inferLinkType(makeDoc(), makeDoc());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.value.linkType).toBe("parent");
  });

  it("accepts all six valid link types — 'implements'", async () => {
    const { service } = makeService({ providerMode: { kind: "ok", content: "implements" } });
    const result = await service.inferLinkType(makeDoc(), makeDoc());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.value.linkType).toBe("implements");
  });

  it("accepts all six valid link types — 'supersedes'", async () => {
    const { service } = makeService({ providerMode: { kind: "ok", content: "supersedes" } });
    const result = await service.inferLinkType(makeDoc(), makeDoc());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.value.linkType).toBe("supersedes");
  });

  it("accepts all six valid link types — 'informs'", async () => {
    const { service } = makeService({ providerMode: { kind: "ok", content: "informs" } });
    const result = await service.inferLinkType(makeDoc(), makeDoc());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.value.linkType).toBe("informs");
  });

  it("accepts all six valid link types — 'blocks'", async () => {
    const { service } = makeService({ providerMode: { kind: "ok", content: "blocks" } });
    const result = await service.inferLinkType(makeDoc(), makeDoc());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.value.linkType).toBe("blocks");
  });

  it("provider returns 'PARENT\\n' (uppercase + newline) → normalized to 'parent'", async () => {
    const { service } = makeService({ providerMode: { kind: "ok", content: "PARENT\n" } });
    const result = await service.inferLinkType(makeDoc(), makeDoc());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.value.linkType).toBe("parent");
  });

  it("provider returns 'Relates-To  ' (mixed case + trailing spaces) → normalized to 'relates-to'", async () => {
    const { service } = makeService({ providerMode: { kind: "ok", content: "Relates-To  " } });
    const result = await service.inferLinkType(makeDoc(), makeDoc());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.value.linkType).toBe("relates-to");
  });

  it("emits exactly one telemetry event on success", async () => {
    const { service, emitCalls } = makeService({ providerMode: { kind: "ok", content: "informs" } });
    await service.inferLinkType(makeDoc(), makeDoc());
    expect(emitCalls).toHaveLength(1);
  });

  it("telemetry event has kind='infer' on success", async () => {
    const { service, emitCalls } = makeService({ providerMode: { kind: "ok", content: "blocks" } });
    await service.inferLinkType(makeDoc(), makeDoc());
    expect(emitCalls[0]?.kind).toBe("infer");
  });

  it("telemetry event has target_doc_id=from.id (NOT to.id)", async () => {
    const fromId = "01HFROM00000000000000FROM2";
    const toId = "01HTO000000000000000000TO2";
    const { service, emitCalls } = makeService({ providerMode: { kind: "ok", content: "informs" } });
    await service.inferLinkType(makeDoc({ id: fromId }), makeDoc({ id: toId }));
    expect(emitCalls[0]?.target_doc_id).toBe(fromId);
    expect(emitCalls[0]?.target_doc_id).not.toBe(toId);
  });

  it("telemetry exit_code=0 on success", async () => {
    const { service, emitCalls } = makeService({ providerMode: { kind: "ok", content: "parent" } });
    await service.inferLinkType(makeDoc(), makeDoc());
    expect(emitCalls[0]?.exit_code).toBe(0);
  });
});

// ─── inferLinkType — NEGATIVE (AC-LINK-AI-2) ─────────────────────────────────

describe("AIProviderService.inferLinkType — NEGATIVE (AC-LINK-AI-2: invalid AI response)", () => {
  it("provider returns 'banana' → err(AI_PROVIDER_ERROR), result.ok is false", async () => {
    const { service } = makeService({ providerMode: { kind: "ok", content: "banana" } });
    const result = await service.inferLinkType(makeDoc(), makeDoc());
    // CRITICAL: 'banana' is not a valid LinkType — must be rejected, not propagated
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected err — invalid link type must not be returned as ok");
    expect(result.error.code).toBe("AI_PROVIDER_ERROR");
  });

  it("provider returns empty/whitespace string → err(AI_PROVIDER_ERROR)", async () => {
    const { service } = makeService({ providerMode: { kind: "ok", content: "  \n  " } });
    const result = await service.inferLinkType(makeDoc(), makeDoc());
    expect(result.ok).toBe(false);
  });

  it("provider returns 'relates_to' (underscore) → err (only hyphen form is valid)", async () => {
    const { service } = makeService({ providerMode: { kind: "ok", content: "relates_to" } });
    const result = await service.inferLinkType(makeDoc(), makeDoc());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected err");
    expect(result.error.code).toBe("AI_PROVIDER_ERROR");
  });

  it("provider returns 'child' → err (not a valid link type)", async () => {
    const { service } = makeService({ providerMode: { kind: "ok", content: "child" } });
    const result = await service.inferLinkType(makeDoc(), makeDoc());
    expect(result.ok).toBe(false);
  });

  it("invalid response → emits telemetry with kind='infer' and error field set", async () => {
    const { service, emitCalls } = makeService({ providerMode: { kind: "ok", content: "banana" } });
    await service.inferLinkType(makeDoc(), makeDoc());
    expect(emitCalls).toHaveLength(1);
    expect(emitCalls[0]?.kind).toBe("infer");
    expect(emitCalls[0]?.error).toBeDefined();
  });

  it("invalid response → telemetry has target_doc_id=from.id", async () => {
    const fromId = "01HFROM00000000000000FROM3";
    const { service, emitCalls } = makeService({ providerMode: { kind: "ok", content: "invalid" } });
    await service.inferLinkType(makeDoc({ id: fromId }), makeDoc());
    expect(emitCalls[0]?.target_doc_id).toBe(fromId);
  });
});

// ─── inferLinkType — ERROR (AC-AI-FAIL-1: provider process failure) ───────────

describe("AIProviderService.inferLinkType — ERROR (AC-AI-FAIL-1: provider failure)", () => {
  it("provider process failure → err(AI_PROVIDER_ERROR) propagated", async () => {
    const { service } = makeService({
      providerMode: { kind: "err", error: { code: "AI_PROVIDER_ERROR", message: "spawn failed", exit_code: 1 } },
    });
    const result = await service.inferLinkType(makeDoc(), makeDoc());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected err");
    expect(result.error.code).toBe("AI_PROVIDER_ERROR");
  });

  it("provider failure → emits telemetry with kind='infer' (not swallowed)", async () => {
    const { service, emitCalls } = makeService({
      providerMode: { kind: "err", error: { code: "AI_PROVIDER_ERROR", message: "timeout", exit_code: -1 } },
    });
    await service.inferLinkType(makeDoc(), makeDoc());
    expect(emitCalls).toHaveLength(1);
    expect(emitCalls[0]?.kind).toBe("infer");
  });

  it("provider failure → telemetry exit_code matches provider exit code", async () => {
    const { service, emitCalls } = makeService({
      providerMode: { kind: "err", error: { code: "AI_PROVIDER_ERROR", message: "killed", exit_code: 1 } },
    });
    await service.inferLinkType(makeDoc(), makeDoc());
    expect(emitCalls[0]?.exit_code).toBe(1);
  });

  it("provider failure → telemetry has target_doc_id=from.id", async () => {
    const fromId = "01HFROM00000000000000FROM4";
    const { service, emitCalls } = makeService({
      providerMode: { kind: "err", error: { code: "AI_PROVIDER_ERROR", message: "fail" } },
    });
    await service.inferLinkType(makeDoc({ id: fromId }), makeDoc());
    expect(emitCalls[0]?.target_doc_id).toBe(fromId);
  });

  it("provider failure → telemetry has error field and output_chars=0", async () => {
    const { service, emitCalls } = makeService({
      providerMode: { kind: "err", error: { code: "AI_PROVIDER_ERROR", message: "fail" } },
    });
    await service.inferLinkType(makeDoc(), makeDoc());
    expect(emitCalls[0]?.error).toBeDefined();
    expect(emitCalls[0]?.output_chars).toBe(0);
  });
});

// ─── refineMaxInputChars getter ───────────────────────────────────────────────

describe("AIProviderService.refineMaxInputChars getter", () => {
  it("returns the configured value (8000 default)", () => {
    const { service } = makeService({ refineMaxInputChars: 8000 });
    expect(service.refineMaxInputChars).toBe(8000);
  });

  it("returns a custom configured value (adversarial: not hardcoded to 8000)", () => {
    const { service } = makeService({ refineMaxInputChars: 500 });
    expect(service.refineMaxInputChars).toBe(500);
  });

  it("different instances return their own configured values", () => {
    const { service: svc1 } = makeService({ refineMaxInputChars: 1000 });
    const { service: svc2 } = makeService({ refineMaxInputChars: 16000 });
    expect(svc1.refineMaxInputChars).toBe(1000);
    expect(svc2.refineMaxInputChars).toBe(16000);
  });
});

// ─── STATE: telemetry kind field isolation ─────────────────────────────────────

describe("STATE: telemetry kind field is method-specific", () => {
  it("generate() emits kind='create', regenerateContent() emits kind='regenerate'", async () => {
    const { service, emitCalls } = makeService();
    const doc = makeDoc({ type: "prd", title: "T" });
    await service.generate({ doc_type: "prd", title: "T" });
    await service.regenerateContent(doc);
    expect(emitCalls[0]?.kind).toBe("create");
    expect(emitCalls[1]?.kind).toBe("regenerate");
  });

  it("refineContent() emits kind='refine', never 'create' or 'regenerate'", async () => {
    const { service, emitCalls } = makeService();
    await service.refineContent(makeDoc(), "Fix");
    expect(emitCalls[0]?.kind).toBe("refine");
    expect(emitCalls[0]?.kind).not.toBe("create");
    expect(emitCalls[0]?.kind).not.toBe("regenerate");
  });

  it("inferLinkType() emits kind='infer', never 'create', 'regenerate', or 'refine'", async () => {
    const { service, emitCalls } = makeService({ providerMode: { kind: "ok", content: "blocks" } });
    await service.inferLinkType(makeDoc(), makeDoc());
    expect(emitCalls[0]?.kind).toBe("infer");
    expect(emitCalls[0]?.kind).not.toBe("create");
    expect(emitCalls[0]?.kind).not.toBe("regenerate");
    expect(emitCalls[0]?.kind).not.toBe("refine");
  });
});

// ─── REGRESSION: aiTelemetryEnabled=false silences SPEC-019 methods too ──────

describe("REGRESSION: aiTelemetryEnabled=false silences SPEC-019 methods", () => {
  it("regenerateContent emits nothing when aiTelemetryEnabled=false (success)", async () => {
    const { service, telemetry } = makeService({ aiTelemetryEnabled: false });
    await service.regenerateContent(makeDoc());
    expect(telemetry.emit).not.toHaveBeenCalled();
  });

  it("regenerateContent emits nothing when aiTelemetryEnabled=false (failure)", async () => {
    const { service, telemetry } = makeService({
      aiTelemetryEnabled: false,
      providerMode: { kind: "err", error: { code: "AI_PROVIDER_ERROR", message: "fail" } },
    });
    await service.regenerateContent(makeDoc());
    expect(telemetry.emit).not.toHaveBeenCalled();
  });

  it("refineContent emits nothing when aiTelemetryEnabled=false", async () => {
    const { service, telemetry } = makeService({ aiTelemetryEnabled: false });
    await service.refineContent(makeDoc(), "Fix");
    expect(telemetry.emit).not.toHaveBeenCalled();
  });

  it("inferLinkType emits nothing when aiTelemetryEnabled=false (success)", async () => {
    const { service, telemetry } = makeService({
      aiTelemetryEnabled: false,
      providerMode: { kind: "ok", content: "informs" },
    });
    await service.inferLinkType(makeDoc(), makeDoc());
    expect(telemetry.emit).not.toHaveBeenCalled();
  });

  it("inferLinkType emits nothing when aiTelemetryEnabled=false (invalid response)", async () => {
    const { service, telemetry } = makeService({
      aiTelemetryEnabled: false,
      providerMode: { kind: "ok", content: "banana" },
    });
    await service.inferLinkType(makeDoc(), makeDoc());
    expect(telemetry.emit).not.toHaveBeenCalled();
  });

  it("inferLinkType emits nothing when aiTelemetryEnabled=false (provider failure)", async () => {
    const { service, telemetry } = makeService({
      aiTelemetryEnabled: false,
      providerMode: { kind: "err", error: { code: "AI_PROVIDER_ERROR", message: "fail" } },
    });
    await service.inferLinkType(makeDoc(), makeDoc());
    expect(telemetry.emit).not.toHaveBeenCalled();
  });
});
