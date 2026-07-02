/**
 * Tests for AIProviderService (SPEC-017 §3.6).
 *
 * Strategy: inject InMemoryAIProvider and a mock Telemetry object.
 * No real provider spawn, no bun:sqlite — pure unit test with full control.
 *
 * Spec-first expectations (from SPEC-017 §3.6 §5.3 §5.6):
 *   - generate() dispatches to the active provider with rendered template
 *   - Telemetry emitted once on success: exit_code=0, output_chars>0
 *   - User template override → telemetry tagged template_source="user-override"
 *   - parent_title passed → provider input includes it (AC-AI-4 service-slice)
 *   - Provider error → Result.err propagated, telemetry emits with error field
 *   - AC-AI-21: aiTelemetryEnabled=false → emit NEVER called (success or failure)
 *   - activeProviderName getter returns active name
 *
 * Adversarial angles:
 *   - emit must be called ZERO times when aiTelemetryEnabled=false (not 1 time)
 *   - emit called EXACTLY once (not twice) on success
 *   - Provider error must NOT be swallowed — result.ok must be false
 *   - template_source tag must reflect the actual path (built-in vs override)
 *   - output_chars must match actual content length (not hardcoded)
 *
 * @spec_ref AC-AI-4, AC-AI-10, AC-AI-20, AC-AI-21, SPEC-017 §3.6
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AIProviderService } from "../../../src/service/ai-provider-service.js";
import { InMemoryAIProvider } from "../../../src/ai/in-memory-provider.js";
import { BUILT_IN_TEMPLATES } from "../../../src/ai/templates.js";
import type { Telemetry, TelemetryEvent } from "@lore/core";
import type { AiGenerationEvent } from "@lore/core";

// ─── Test helpers ─────────────────────────────────────────────────────────────

/**
 * Create a spy-instrumented Telemetry mock.
 * Track .emit() calls to verify telemetry behaviour without file IO.
 */
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
 * Defaults: in-memory ok-mode provider, telemetry enabled, no template overrides.
 */
function makeService({
  providerMode = { kind: "ok" as const, content: "# Generated\n" },
  templates = {} as Partial<Record<string, string>>,
  aiTelemetryEnabled = true,
  providerName = "in-memory",
}: {
  providerMode?: { kind: "ok"; content: string } | { kind: "err"; error: { code: "AI_PROVIDER_ERROR"; message: string; provider?: string; exit_code?: number } };
  templates?: Partial<Record<string, string>>;
  aiTelemetryEnabled?: boolean;
  providerName?: string;
} = {}) {
  const provider = new InMemoryAIProvider(providerName, providerMode as never);
  const { telemetry, emitCalls } = makeMockTelemetry();
  const providers = new Map([[providerName, provider]]) as unknown as ReadonlyMap<string, import("@lore/core").AIProvider>;
  const service = new AIProviderService(
    providers,
    providerName,
    templates as never,
    telemetry,
    aiTelemetryEnabled,
    8000, // refineMaxInputChars — SPEC-019 default (tests don't exercise truncation)
  );
  return { service, provider, telemetry, emitCalls };
}

// ─── Happy path ───────────────────────────────────────────────────────────────

describe("AIProviderService.generate — happy path", () => {
  it("returns ok with content from the provider", async () => {
    const { service } = makeService({ providerMode: { kind: "ok", content: "# Doc\n" } });
    const result = await service.generate({ doc_type: "prd", title: "My PRD" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.value.content).toBe("# Doc\n");
  });

  it("provider.generate() is called with correct doc_type and title", async () => {
    const { service, provider } = makeService();
    await service.generate({ doc_type: "prd", title: "Notification Center" });
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.doc_type).toBe("prd");
    expect(provider.calls[0]?.title).toBe("Notification Center");
  });

  it("provider receives the rendered built-in prd template with title substituted", async () => {
    const { service, provider } = makeService();
    await service.generate({ doc_type: "prd", title: "Auth Module" });
    // The prompt should contain the title (from renderTemplate)
    const sentPrompt = provider.calls[0]?.prompt ?? "";
    expect(sentPrompt).toContain("Auth Module");
    // The prompt should NOT contain the raw template placeholder
    expect(sentPrompt).not.toContain("{{title}}");
  });

  it("different doc_types produce different rendered prompts", async () => {
    const { service, provider } = makeService();
    await service.generate({ doc_type: "prd", title: "T" });
    await service.generate({ doc_type: "adr", title: "T" });
    const prdPrompt = provider.calls[0]?.prompt ?? "";
    const adrPrompt = provider.calls[1]?.prompt ?? "";
    // Built-in templates are different for each type
    expect(prdPrompt).not.toBe(adrPrompt);
  });
});

// ─── Telemetry on success (AC-AI-20) ─────────────────────────────────────────

describe("AIProviderService.generate — telemetry on success (AC-AI-20)", () => {
  it("emits exactly one ai.generation event on success", async () => {
    const { service, emitCalls } = makeService({ providerMode: { kind: "ok", content: "# OK\n" } });
    await service.generate({ doc_type: "prd", title: "X" });
    expect(emitCalls).toHaveLength(1);
  });

  it("emitted event has event='ai.generation'", async () => {
    const { service, emitCalls } = makeService();
    await service.generate({ doc_type: "prd", title: "X" });
    expect(emitCalls[0]?.event).toBe("ai.generation");
  });

  it("emitted event has exit_code=0 on success", async () => {
    const { service, emitCalls } = makeService();
    await service.generate({ doc_type: "prd", title: "X" });
    expect(emitCalls[0]?.exit_code).toBe(0);
  });

  it("emitted event has output_chars matching content length (not hardcoded)", async () => {
    const content = "# Hello World\nSome content here\n";
    const { service, emitCalls } = makeService({ providerMode: { kind: "ok", content } });
    await service.generate({ doc_type: "knowledge", title: "X" });
    expect(emitCalls[0]?.output_chars).toBe(content.length);
  });

  it("emitted event has template_source='built-in' when no user template", async () => {
    const { service, emitCalls } = makeService({ templates: {} });
    await service.generate({ doc_type: "prd", title: "X" });
    expect(emitCalls[0]?.template_source).toBe("built-in");
  });

  it("emitted event has doc_type matching the requested type", async () => {
    const { service, emitCalls } = makeService();
    await service.generate({ doc_type: "adr", title: "X" });
    expect(emitCalls[0]?.doc_type).toBe("adr");
  });
});

// ─── User template override (AC-AI-10) ───────────────────────────────────────

describe("AIProviderService.generate — user template override (AC-AI-10)", () => {
  it("uses user template when one is set for the doc_type", async () => {
    const { service, provider } = makeService({
      templates: { prd: "Custom template for {{title}}" },
    });
    await service.generate({ doc_type: "prd", title: "My PRD" });
    const prompt = provider.calls[0]?.prompt ?? "";
    // Should use the user template, not the built-in PRD template
    expect(prompt).toBe("Custom template for My PRD");
    // Should NOT contain built-in template text
    expect(prompt).not.toContain("Problem, Users, Goals");
  });

  it("telemetry tagged template_source='user-override' when override is used", async () => {
    const { service, emitCalls } = makeService({
      templates: { prd: "Override: {{title}}" },
    });
    await service.generate({ doc_type: "prd", title: "X" });
    expect(emitCalls[0]?.template_source).toBe("user-override");
  });

  it("user override for prd does NOT affect adr (uses built-in for adr)", async () => {
    const { service, provider } = makeService({
      templates: { prd: "PRD Override {{title}}" },
    });
    await service.generate({ doc_type: "adr", title: "T" });
    // ADR should use built-in template
    const prompt = provider.calls[0]?.prompt ?? "";
    expect(prompt).toContain("Architecture Decision Record");
  });
});

// ─── parent_title propagation (AC-AI-4 service-slice) ────────────────────────

describe("AIProviderService.generate — parent_title propagation (AC-AI-4)", () => {
  it("parent_title is included in provider input when provided", async () => {
    const { service, provider } = makeService();
    await service.generate({
      doc_type: "spec",
      title: "Auth Flow",
      parent_title: "Security PRD",
    });
    expect(provider.calls[0]?.parent_title).toBe("Security PRD");
  });

  it("parent_title is interpolated into the spec template (conditional block)", async () => {
    const { service, provider } = makeService();
    await service.generate({
      doc_type: "spec",
      title: "Auth Flow",
      parent_title: "Security PRD",
    });
    const prompt = provider.calls[0]?.prompt ?? "";
    // Built-in spec template has {{#parent_title}}...{{parent_title}}...{{/parent_title}}
    expect(prompt).toContain("Security PRD");
    // Conditional markers should be replaced, not literal
    expect(prompt).not.toContain("{{#parent_title}}");
  });

  it("parent_title absent → provider input has no parent_title field", async () => {
    const { service, provider } = makeService();
    await service.generate({ doc_type: "spec", title: "Auth Flow" });
    expect(provider.calls[0]?.parent_title).toBeUndefined();
  });
});

// ─── Provider error propagation (AC-AI-15) ───────────────────────────────────

describe("AIProviderService.generate — provider error propagation", () => {
  it("propagates provider error as Result.err (not throw)", async () => {
    const { service } = makeService({
      providerMode: {
        kind: "err",
        error: { code: "AI_PROVIDER_ERROR", message: "binary missing" },
      },
    });
    const result = await service.generate({ doc_type: "prd", title: "X" });
    expect(result.ok).toBe(false);
  });

  it("error result has code AI_PROVIDER_ERROR", async () => {
    const { service } = makeService({
      providerMode: {
        kind: "err",
        error: { code: "AI_PROVIDER_ERROR", message: "exited 1" },
      },
    });
    const result = await service.generate({ doc_type: "prd", title: "X" });
    if (result.ok) throw new Error("Expected err");
    expect(result.error.code).toBe("AI_PROVIDER_ERROR");
  });

  it("telemetry emits with exit_code!=0 on provider failure", async () => {
    const { service, emitCalls } = makeService({
      providerMode: {
        kind: "err",
        error: { code: "AI_PROVIDER_ERROR", message: "exited 1", exit_code: 1 },
      },
    });
    await service.generate({ doc_type: "prd", title: "X" });
    expect(emitCalls).toHaveLength(1);
    expect(emitCalls[0]?.exit_code).not.toBe(0);
  });

  it("telemetry emits with error field on provider failure", async () => {
    const { service, emitCalls } = makeService({
      providerMode: {
        kind: "err",
        error: { code: "AI_PROVIDER_ERROR", message: "Provider failed hard" },
      },
    });
    await service.generate({ doc_type: "prd", title: "X" });
    expect(emitCalls[0]?.error).toBeDefined();
    expect(typeof emitCalls[0]?.error).toBe("string");
  });

  it("telemetry emits output_chars=0 when provider returns empty output error", async () => {
    const { service, emitCalls } = makeService({
      providerMode: {
        kind: "err",
        error: { code: "AI_PROVIDER_ERROR", message: "empty output" },
      },
    });
    await service.generate({ doc_type: "prd", title: "X" });
    expect(emitCalls[0]?.output_chars).toBe(0);
  });
});

// ─── AC-AI-21: aiTelemetryEnabled=false silences all emit calls ─────────────

describe("AIProviderService.generate — AC-AI-21 telemetry kill switch", () => {
  it("emit is NEVER called when aiTelemetryEnabled=false (success path)", async () => {
    const { service, telemetry } = makeService({ aiTelemetryEnabled: false });
    await service.generate({ doc_type: "prd", title: "X" });
    expect(telemetry.emit).not.toHaveBeenCalled();
  });

  it("emit is NEVER called when aiTelemetryEnabled=false (failure path)", async () => {
    const { service, telemetry } = makeService({
      aiTelemetryEnabled: false,
      providerMode: {
        kind: "err",
        error: { code: "AI_PROVIDER_ERROR", message: "fail" },
      },
    });
    await service.generate({ doc_type: "prd", title: "X" });
    expect(telemetry.emit).not.toHaveBeenCalled();
  });

  it("aiTelemetryEnabled=true still calls emit (control: confirms the false test is meaningful)", async () => {
    const { service, telemetry } = makeService({ aiTelemetryEnabled: true });
    await service.generate({ doc_type: "prd", title: "X" });
    expect(telemetry.emit).toHaveBeenCalledOnce();
  });
});

// ─── activeProviderName getter ────────────────────────────────────────────────

describe("AIProviderService.activeProviderName", () => {
  it("returns the active provider name", () => {
    const { service } = makeService({ providerName: "my-provider" });
    expect(service.activeProviderName).toBe("my-provider");
  });

  it("different provider names are correctly reflected", () => {
    const { service: svc1 } = makeService({ providerName: "alpha" });
    const { service: svc2 } = makeService({ providerName: "beta" });
    expect(svc1.activeProviderName).toBe("alpha");
    expect(svc2.activeProviderName).toBe("beta");
  });
});
