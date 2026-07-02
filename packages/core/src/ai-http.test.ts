/**
 * Unit tests for SPEC-020 schemas in @lore/core:
 *   aiHttpContentBlockSchema, aiHttpResponseSchema, AiHttpConfigSchema,
 *   AiConfigSchema HTTP superRefine, aiGenerationEventSchema.usage
 *
 * Spec-first: expectations are derived from SPEC-020 ACs and invariants,
 * NOT from reading implementation first.
 *
 * Adversarial focus:
 *   - .strict() on both response schemas must reject unknown fields
 *   - Rejection paths tested for every structural constraint
 *   - aiGenerationEventSchema.usage: backward-compat absence AND rejection of
 *     invalid (negative, fractional) token values
 *
 * @spec_ref AC-HTTP-2, AC-HTTP-CORE-1, AC-HTTP-TEL-1
 */

import { describe, it, expect } from "vitest";
import {
  aiHttpContentBlockSchema,
  aiHttpResponseSchema,
  AiHttpConfigSchema,
  AiConfigSchema,
  aiGenerationEventSchema,
} from "@lore/core";

// ─── aiHttpContentBlockSchema ─────────────────────────────────────────────────

describe("aiHttpContentBlockSchema — AC-HTTP-CORE-1", () => {
  it("accepts a valid text content block", () => {
    const block = { type: "text", text: "Hello world" };
    expect(() => aiHttpContentBlockSchema.parse(block)).not.toThrow();
  });

  it("accepts text block with empty string text (provider validates emptiness, schema does not)", () => {
    // Schema does not enforce non-empty text — that is the provider's job (AC-HTTP-8).
    const block = { type: "text", text: "" };
    expect(() => aiHttpContentBlockSchema.parse(block)).not.toThrow();
  });

  it("rejects non-text type 'image' (strict literal enforcement)", () => {
    const block = { type: "image", text: "data:image/png;base64,..." };
    expect(() => aiHttpContentBlockSchema.parse(block)).toThrow();
  });

  it("rejects non-text type 'tool_use' (strict literal enforcement)", () => {
    const block = { type: "tool_use", id: "t1", name: "calculator", input: {} };
    expect(() => aiHttpContentBlockSchema.parse(block)).toThrow();
  });

  it("rejects block with missing 'type' field", () => {
    const block = { text: "Hello" };
    expect(() => aiHttpContentBlockSchema.parse(block)).toThrow();
  });

  it("rejects block with missing 'text' field", () => {
    const block = { type: "text" };
    expect(() => aiHttpContentBlockSchema.parse(block)).toThrow();
  });

  it("rejects extra unknown field via .strict()", () => {
    // .strict() must reject any unknown field — prevents silent acceptance of
    // Anthropic API fields that could be mistakenly forwarded to consumers.
    const block = { type: "text", text: "Hello", cache_control: { type: "ephemeral" } };
    expect(() => aiHttpContentBlockSchema.parse(block)).toThrow();
  });

  it("parsed result has exactly type and text fields", () => {
    const block = { type: "text" as const, text: "Content here" };
    const result = aiHttpContentBlockSchema.parse(block);
    expect(result.type).toBe("text");
    expect(result.text).toBe("Content here");
    expect(Object.keys(result)).toHaveLength(2);
  });
});

// ─── aiHttpResponseSchema ─────────────────────────────────────────────────────

describe("aiHttpResponseSchema — AC-HTTP-CORE-1", () => {
  const validResponse = {
    id: "msg_01XFDUDYJgAACzvnptvVoYEL",
    type: "message",
    role: "assistant",
    model: "claude-opus-4-8",
    content: [{ type: "text", text: "# Generated content\n" }],
    stop_reason: "end_turn",
    usage: { input_tokens: 15, output_tokens: 342 },
  };

  it("accepts a valid Anthropic Messages response", () => {
    expect(() => aiHttpResponseSchema.parse(validResponse)).not.toThrow();
  });

  it("accepts response with usage absent (optional field)", () => {
    const { usage: _usage, ...withoutUsage } = validResponse;
    expect(() => aiHttpResponseSchema.parse(withoutUsage)).not.toThrow();
  });

  it("accepts response with stop_reason absent (optional field)", () => {
    const { stop_reason: _sr, ...withoutSr } = validResponse;
    expect(() => aiHttpResponseSchema.parse(withoutSr)).not.toThrow();
  });

  it("accepts response with multiple content blocks", () => {
    const multi = {
      ...validResponse,
      content: [
        { type: "text", text: "First block" },
        { type: "text", text: "Second block" },
      ],
    };
    expect(() => aiHttpResponseSchema.parse(multi)).not.toThrow();
  });

  it("rejects response with missing 'content' field", () => {
    const { content: _content, ...noContent } = validResponse;
    expect(() => aiHttpResponseSchema.parse(noContent)).toThrow();
  });

  it("rejects response with empty content array (min(1) constraint)", () => {
    // AC-HTTP-CORE-1 invariant: content must have at least one element
    const emptyContent = { ...validResponse, content: [] };
    expect(() => aiHttpResponseSchema.parse(emptyContent)).toThrow();
  });

  it("rejects response with wrong type value (must be literal 'message')", () => {
    const wrongType = { ...validResponse, type: "completion" };
    expect(() => aiHttpResponseSchema.parse(wrongType)).toThrow();
  });

  it("rejects response with wrong role value (must be literal 'assistant')", () => {
    const wrongRole = { ...validResponse, role: "user" };
    expect(() => aiHttpResponseSchema.parse(wrongRole)).toThrow();
  });

  it("rejects response with extra unknown top-level field via .strict()", () => {
    // .strict() must reject unknown fields — prevents silent acceptance of
    // new Anthropic API fields that could mask schema evolution.
    const extraField = { ...validResponse, stop_sequence: null };
    expect(() => aiHttpResponseSchema.parse(extraField)).toThrow();
  });

  it("rejects response with missing 'id' field", () => {
    const { id: _id, ...noId } = validResponse;
    expect(() => aiHttpResponseSchema.parse(noId)).toThrow();
  });

  it("rejects response with missing 'model' field", () => {
    const { model: _model, ...noModel } = validResponse;
    expect(() => aiHttpResponseSchema.parse(noModel)).toThrow();
  });

  it("rejects response where usage has negative input_tokens (nonnegative constraint)", () => {
    const negativeUsage = {
      ...validResponse,
      usage: { input_tokens: -1, output_tokens: 100 },
    };
    expect(() => aiHttpResponseSchema.parse(negativeUsage)).toThrow();
  });

  it("rejects response where usage has fractional output_tokens (int constraint)", () => {
    const fractionalUsage = {
      ...validResponse,
      usage: { input_tokens: 10, output_tokens: 1.5 },
    };
    expect(() => aiHttpResponseSchema.parse(fractionalUsage)).toThrow();
  });

  it("parses content[0].text verbatim", () => {
    const result = aiHttpResponseSchema.parse(validResponse);
    expect(result.content[0]?.text).toBe("# Generated content\n");
  });

  it("parses usage token counts from the response", () => {
    const result = aiHttpResponseSchema.parse(validResponse);
    expect(result.usage?.input_tokens).toBe(15);
    expect(result.usage?.output_tokens).toBe(342);
  });
});

// ─── AiHttpConfigSchema ───────────────────────────────────────────────────────

describe("AiHttpConfigSchema — AC-HTTP-2", () => {
  it("rejects empty object (url is required)", () => {
    // AC-HTTP-2: missing ai.http.url → Zod rejection at config parse
    expect(() => AiHttpConfigSchema.parse({})).toThrow();
  });

  it("rejects relative url (url must be absolute HTTP/HTTPS)", () => {
    expect(() => AiHttpConfigSchema.parse({ url: "/v1/messages" })).toThrow();
  });

  it("rejects non-URL string as url value", () => {
    expect(() => AiHttpConfigSchema.parse({ url: "not-a-url" })).toThrow();
  });

  it("accepts valid HTTPS URL", () => {
    expect(() =>
      AiHttpConfigSchema.parse({ url: "https://api.anthropic.com/v1/messages" }),
    ).not.toThrow();
  });

  it("accepts valid HTTP URL (e.g. localhost for dev/testing)", () => {
    expect(() =>
      AiHttpConfigSchema.parse({ url: "http://127.0.0.1:4000/v1/messages" }),
    ).not.toThrow();
  });

  it("defaults model to 'claude-opus-4-8' when absent", () => {
    const cfg = AiHttpConfigSchema.parse({ url: "https://api.anthropic.com/v1/messages" });
    expect(cfg.model).toBe("claude-opus-4-8");
  });

  it("defaults timeout_ms to 60000 when absent", () => {
    const cfg = AiHttpConfigSchema.parse({ url: "https://api.anthropic.com/v1/messages" });
    expect(cfg.timeout_ms).toBe(60_000);
  });

  it("defaults max_tokens to 4096 when absent", () => {
    const cfg = AiHttpConfigSchema.parse({ url: "https://api.anthropic.com/v1/messages" });
    expect(cfg.max_tokens).toBe(4096);
  });

  it("defaults headers to empty object when absent", () => {
    const cfg = AiHttpConfigSchema.parse({ url: "https://api.anthropic.com/v1/messages" });
    expect(cfg.headers).toEqual({});
  });

  it("accepts custom model value", () => {
    const cfg = AiHttpConfigSchema.parse({
      url: "https://api.anthropic.com/v1/messages",
      model: "claude-haiku-4",
    });
    expect(cfg.model).toBe("claude-haiku-4");
  });

  it("accepts headers map and preserves all entries verbatim", () => {
    const cfg = AiHttpConfigSchema.parse({
      url: "https://api.anthropic.com/v1/messages",
      headers: {
        "x-api-key": "${ANTHROPIC_API_KEY}",
        "anthropic-version": "2023-06-01",
      },
    });
    expect(cfg.headers["x-api-key"]).toBe("${ANTHROPIC_API_KEY}");
    expect(cfg.headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("rejects extra unknown field via .strict()", () => {
    expect(() =>
      AiHttpConfigSchema.parse({
        url: "https://api.anthropic.com/v1/messages",
        wire_format: "openai",
      }),
    ).toThrow();
  });

  it("rejects zero timeout_ms (must be positive)", () => {
    expect(() =>
      AiHttpConfigSchema.parse({ url: "https://api.anthropic.com/v1/messages", timeout_ms: 0 }),
    ).toThrow();
  });

  it("rejects zero max_tokens (must be positive)", () => {
    expect(() =>
      AiHttpConfigSchema.parse({ url: "https://api.anthropic.com/v1/messages", max_tokens: 0 }),
    ).toThrow();
  });
});

// ─── AiConfigSchema superRefine — provider="http" cross-field validation ──────

describe("AiConfigSchema — provider='http' superRefine (AC-HTTP-2)", () => {
  it("throws ZodError when provider='http' but ai.http block is absent", () => {
    // AC-HTTP-2: missing ai.http config when provider='http' must be rejected at config parse
    expect(() => AiConfigSchema.parse({ provider: "http" })).toThrow();
  });

  it("error path includes 'http' when http block is missing", () => {
    let caught: unknown;
    try {
      AiConfigSchema.parse({ provider: "http" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    const error = caught as { issues?: Array<{ path: unknown[] }> };
    const hasHttpPath = error.issues?.some((iss) => iss.path.includes("http")) ?? false;
    expect(hasHttpPath).toBe(true);
  });

  it("passes when provider='http' and ai.http.url is provided", () => {
    expect(() =>
      AiConfigSchema.parse({
        provider: "http",
        http: { url: "https://api.anthropic.com/v1/messages" },
      }),
    ).not.toThrow();
  });

  it("provider='claude-cli' without http block is valid (regression — default path unchanged)", () => {
    // Default config must remain valid — http is optional for non-http providers
    expect(() => AiConfigSchema.parse({ provider: "claude-cli" })).not.toThrow();
  });

  it("empty AiConfig parses without throwing (regression — defaults work)", () => {
    expect(() => AiConfigSchema.parse({})).not.toThrow();
  });

  it("empty AiConfig gives provider='claude-cli' and no http block", () => {
    const cfg = AiConfigSchema.parse({});
    expect(cfg.provider).toBe("claude-cli");
    expect(cfg.http).toBeUndefined();
  });
});

// ─── aiGenerationEventSchema.usage — AC-HTTP-TEL-1 ───────────────────────────

describe("aiGenerationEventSchema — usage field (AC-HTTP-TEL-1)", () => {
  const validBaseEvent = {
    event: "ai.generation" as const,
    ts: new Date().toISOString(),
    provider: "http",
    doc_type: "prd" as const,
    template_source: "built-in" as const,
    duration_ms: 3200,
    output_chars: 512,
    exit_code: 0,
  };

  it("accepts event with usage field populated", () => {
    const event = { ...validBaseEvent, usage: { input_tokens: 10, output_tokens: 342 } };
    expect(() => aiGenerationEventSchema.parse(event)).not.toThrow();
  });

  it("accepts event with usage.stop_reason populated", () => {
    const event = {
      ...validBaseEvent,
      usage: { input_tokens: 10, output_tokens: 342, stop_reason: "end_turn" },
    };
    expect(() => aiGenerationEventSchema.parse(event)).not.toThrow();
  });

  it("accepts event WITHOUT usage field for backward compatibility", () => {
    // ClaudeCliProvider does not populate usage; pre-SPEC-020 events must still parse
    expect(() => aiGenerationEventSchema.parse(validBaseEvent)).not.toThrow();
  });

  it("usage token values are preserved verbatim across two different inputs", () => {
    // Anti-tautology: verify parsing reflects actual values, not a fixed stub
    const event1 = { ...validBaseEvent, usage: { input_tokens: 10, output_tokens: 100 } };
    const event2 = { ...validBaseEvent, usage: { input_tokens: 999, output_tokens: 4096 } };
    const p1 = aiGenerationEventSchema.parse(event1);
    const p2 = aiGenerationEventSchema.parse(event2);
    expect(p1.usage?.input_tokens).toBe(10);
    expect(p1.usage?.output_tokens).toBe(100);
    expect(p2.usage?.input_tokens).toBe(999);
    expect(p2.usage?.output_tokens).toBe(4096);
  });

  it("rejects negative input_tokens in usage (nonnegative constraint)", () => {
    const event = { ...validBaseEvent, usage: { input_tokens: -1, output_tokens: 100 } };
    expect(() => aiGenerationEventSchema.parse(event)).toThrow();
  });

  it("rejects negative output_tokens in usage (nonnegative constraint)", () => {
    const event = { ...validBaseEvent, usage: { input_tokens: 10, output_tokens: -5 } };
    expect(() => aiGenerationEventSchema.parse(event)).toThrow();
  });

  it("rejects fractional input_tokens in usage (int constraint)", () => {
    const event = { ...validBaseEvent, usage: { input_tokens: 1.5, output_tokens: 100 } };
    expect(() => aiGenerationEventSchema.parse(event)).toThrow();
  });

  it("rejects extra field at top level (strict mode)", () => {
    const event = { ...validBaseEvent, undocumented_field: "oops" };
    expect(() => aiGenerationEventSchema.parse(event)).toThrow();
  });
});
