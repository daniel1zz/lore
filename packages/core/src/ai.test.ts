/**
 * Tests for @lore/core AI schemas — AiConfigSchema, AiProviderConfigSchema,
 * GenerateInputSchema, aiGenerationEventSchema, and LoreConfigSchema ai field.
 *
 * Spec-first test order: we assert what the SPEC says must happen before reading
 * any implementation. Tautological tests are avoided by testing both the success
 * and rejection sides of every schema constraint.
 *
 * @spec_ref AC-AI-9, AC-AI-12, AC-AI-20, SPEC-017 §3.3, §3.10
 */

import { describe, it, expect } from "vitest";
import {
  AiConfigSchema,
  AiProviderConfigSchema,
  GenerateInputSchema,
} from "./ai.js";
import { LoreConfigSchema } from "./config.js";
import { aiGenerationEventSchema } from "./telemetry.js";

// ─── AiConfigSchema defaults (AC-AI-9) ──────────────────────────────────────

describe("AiConfigSchema defaults (AC-AI-9)", () => {
  it("empty object produces provider='claude-cli'", () => {
    const result = AiConfigSchema.parse({});
    expect(result.provider).toBe("claude-cli");
  });

  it("empty object produces empty providers map", () => {
    const result = AiConfigSchema.parse({});
    expect(result.providers).toEqual({});
  });

  it("empty object produces empty templates map", () => {
    const result = AiConfigSchema.parse({});
    expect(result.templates).toEqual({});
  });

  it("empty object produces telemetry=true", () => {
    const result = AiConfigSchema.parse({});
    expect(result.telemetry).toBe(true);
  });

  it("partial config with only telemetry:false still gets other defaults", () => {
    const result = AiConfigSchema.parse({ telemetry: false });
    expect(result.provider).toBe("claude-cli");
    expect(result.providers).toEqual({});
    expect(result.templates).toEqual({});
    expect(result.telemetry).toBe(false);
  });

  it("LoreConfigSchema.parse with no ai field yields ai=undefined (ai is optional)", () => {
    const result = LoreConfigSchema.parse({
      project: { name: "test", author: "tester" },
    });
    expect(result.ai).toBeUndefined();
  });

  it("LoreConfigSchema.parse with ai:{} yields parsed AiConfig with defaults", () => {
    const result = LoreConfigSchema.parse({
      project: { name: "test", author: "tester" },
      ai: {},
    });
    expect(result.ai).toBeDefined();
    expect(result.ai!.provider).toBe("claude-cli");
    expect(result.ai!.telemetry).toBe(true);
  });
});

// ─── AiConfigSchema strict rejection (AC-AI-12) ─────────────────────────────

describe("AiConfigSchema strict rejection (AC-AI-12)", () => {
  it("rejects typo key 'provder' instead of 'provider'", () => {
    expect(() => AiConfigSchema.parse({ provder: "claude-cli" })).toThrow();
  });

  it("rejects unknown key 'model'", () => {
    expect(() => AiConfigSchema.parse({ model: "gpt-4" })).toThrow();
  });

  it("rejects 'provider' as empty string (min length 1)", () => {
    expect(() => AiConfigSchema.parse({ provider: "" })).toThrow();
  });
});

// ─── AiProviderConfigSchema strict rejection (AC-AI-12) ─────────────────────

describe("AiProviderConfigSchema strict rejection (AC-AI-12)", () => {
  it("rejects typo key 'comand' instead of 'command'", () => {
    expect(() => AiProviderConfigSchema.parse({ comand: "x" })).toThrow();
  });

  it("rejects empty command string", () => {
    expect(() => AiProviderConfigSchema.parse({ command: "" })).toThrow();
  });

  it("rejects non-positive timeout_ms", () => {
    expect(() =>
      AiProviderConfigSchema.parse({ command: "claude", timeout_ms: 0 }),
    ).toThrow();
  });

  it("fills defaults for args and timeout_ms when only command is given", () => {
    const result = AiProviderConfigSchema.parse({ command: "my-tool" });
    expect(result.args).toEqual([]);
    expect(result.timeout_ms).toBe(60_000);
  });

  it("rejects negative timeout_ms", () => {
    expect(() =>
      AiProviderConfigSchema.parse({ command: "claude", timeout_ms: -1 }),
    ).toThrow();
  });
});

// ─── GenerateInputSchema ─────────────────────────────────────────────────────

describe("GenerateInputSchema", () => {
  it("accepts a complete valid payload", () => {
    const result = GenerateInputSchema.parse({
      prompt: "Generate a PRD for auth",
      doc_type: "prd",
      title: "Auth Module",
      parent_title: "Platform PRD",
    });
    expect(result.prompt).toBe("Generate a PRD for auth");
    expect(result.doc_type).toBe("prd");
    expect(result.title).toBe("Auth Module");
    expect(result.parent_title).toBe("Platform PRD");
  });

  it("accepts payload without optional parent_title", () => {
    const result = GenerateInputSchema.parse({
      prompt: "Generate a spec",
      doc_type: "spec",
      title: "My Spec",
    });
    expect(result.parent_title).toBeUndefined();
  });

  it("rejects empty prompt (min(1) constraint)", () => {
    expect(() =>
      GenerateInputSchema.parse({
        prompt: "",
        doc_type: "prd",
        title: "X",
      }),
    ).toThrow();
  });

  it("rejects empty title (min(1) constraint)", () => {
    expect(() =>
      GenerateInputSchema.parse({
        prompt: "Generate something",
        doc_type: "prd",
        title: "",
      }),
    ).toThrow();
  });

  it("rejects invalid doc_type", () => {
    expect(() =>
      GenerateInputSchema.parse({
        prompt: "Generate something",
        doc_type: "invalid-type",
        title: "X",
      }),
    ).toThrow();
  });

  it("rejects unknown extra key (strict)", () => {
    expect(() =>
      GenerateInputSchema.parse({
        prompt: "Generate",
        doc_type: "prd",
        title: "X",
        unknown_field: "oops",
      }),
    ).toThrow();
  });

  it("accepts all valid DocType values", () => {
    for (const type of ["prd", "spec", "adr", "plan", "knowledge", "task"] as const) {
      expect(() =>
        GenerateInputSchema.parse({ prompt: "gen", doc_type: type, title: "T" }),
      ).not.toThrow();
    }
  });
});

// ─── aiGenerationEventSchema (AC-AI-20) ─────────────────────────────────────

describe("aiGenerationEventSchema (AC-AI-20)", () => {
  const validEvent = {
    event: "ai.generation" as const,
    ts: new Date().toISOString(),
    provider: "claude-cli",
    doc_type: "prd" as const,
    template_source: "built-in" as const,
    duration_ms: 3200,
    output_chars: 512,
    exit_code: 0,
  };

  it("accepts a complete valid event", () => {
    expect(() => aiGenerationEventSchema.parse(validEvent)).not.toThrow();
    const parsed = aiGenerationEventSchema.parse(validEvent);
    expect(parsed.event).toBe("ai.generation");
    expect(parsed.exit_code).toBe(0);
    expect(parsed.output_chars).toBe(512);
  });

  it("accepts template_source='user-override'", () => {
    const event = { ...validEvent, template_source: "user-override" as const };
    expect(() => aiGenerationEventSchema.parse(event)).not.toThrow();
    expect(aiGenerationEventSchema.parse(event).template_source).toBe("user-override");
  });

  it("accepts optional error field when present", () => {
    const event = { ...validEvent, error: "provider exited 1" };
    const parsed = aiGenerationEventSchema.parse(event);
    expect(parsed.error).toBe("provider exited 1");
  });

  it("accepts event without optional error field", () => {
    const parsed = aiGenerationEventSchema.parse(validEvent);
    expect(parsed.error).toBeUndefined();
  });

  it("rejects output_chars when negative (nonnegative constraint)", () => {
    expect(() =>
      aiGenerationEventSchema.parse({ ...validEvent, output_chars: -1 }),
    ).toThrow();
  });

  it("rejects non-integer output_chars (int constraint)", () => {
    expect(() =>
      aiGenerationEventSchema.parse({ ...validEvent, output_chars: 1.5 }),
    ).toThrow();
  });

  it("rejects negative duration_ms (nonnegative constraint)", () => {
    expect(() =>
      aiGenerationEventSchema.parse({ ...validEvent, duration_ms: -1 }),
    ).toThrow();
  });

  it("rejects unknown top-level key (strict)", () => {
    expect(() =>
      aiGenerationEventSchema.parse({ ...validEvent, extra_field: "oops" }),
    ).toThrow();
  });

  it("rejects invalid template_source value", () => {
    expect(() =>
      aiGenerationEventSchema.parse({ ...validEvent, template_source: "custom" }),
    ).toThrow();
  });

  it("rejects non-datetime ts format", () => {
    expect(() =>
      aiGenerationEventSchema.parse({ ...validEvent, ts: "not-a-datetime" }),
    ).toThrow();
  });

  it("accepts non-zero exit_code (failure scenario)", () => {
    const event = { ...validEvent, exit_code: 1, output_chars: 0, error: "failed" };
    const parsed = aiGenerationEventSchema.parse(event);
    expect(parsed.exit_code).toBe(1);
  });
});
