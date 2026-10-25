/**
 * Integration tests for HttpAIProvider (SPEC-020 §9.3–§9.5).
 *
 * Uses vi.stubGlobal("fetch", ...) to intercept HTTP calls because vitest runs
 * in a Node environment where Bun.* globals are not available. The mock fetch
 * is authoritative since HttpAIProvider uses the standard global fetch() — no
 * other HTTP abstraction is involved.
 *
 * Spec-first expectations (from SPEC-020 ACs):
 *   - AC-HTTP-4:  POST body = {model, max_tokens, messages:[{role:"user",content}]}
 *   - AC-HTTP-5:  4xx/5xx → AI_PROVIDER_ERROR with status + truncated body
 *   - AC-HTTP-6:  timeout > timeout_ms → AI_PROVIDER_ERROR with "timeout" in message
 *   - AC-HTTP-7:  200 but invalid JSON → AI_PROVIDER_ERROR
 *   - AC-HTTP-8:  200 but content[0].text is empty/whitespace → AI_PROVIDER_ERROR "empty output"
 *   - AC-HTTP-TEL-1: usage field populated from response
 *   - D-004:      resolved API key value must NOT appear in any error message
 *   - AC-TIER-10 (SPEC-103, task-t4-give-modelawareprovider-its-real-implementor):
 *       HttpAIProvider.modelId equals the configured model and satisfies the
 *       ModelAwareProvider structural capability; an AIProviderService wired with a real
 *       HttpAIProvider stamps ai_provenance.model with that REAL model id, not the
 *       provider (registry) name.
 *
 * Adversarial focus:
 *   - Timeout: mock fetch respects AbortController signal to trigger the abort path
 *   - Body truncation: 2000-char body must be capped at 1024 in error message
 *   - Secret leak: sentinel key value must be absent from error messages
 *   - Schema mismatch: valid JSON but wrong shape → AI_PROVIDER_ERROR
 *   - Whitespace-only text: `"   "` must fail with "empty output" (not succeed)
 *   - Two different inputs → two different outputs (anti-hardcoded-return)
 *
 * Honest consequence (documented, not an oversight): on THIS repo's own corpus the active
 * AI provider is `claude-cli` (ClaudeCliProvider), which deliberately does NOT implement
 * ModelAwareProvider — it shells out to `claude -p` and cannot observe which model actually
 * served the call. So on this corpus, `ai_provenance` stays omitted from every generate()
 * call and SPEC-103's I1 provenance-collision check is genuinely N/A for claude-cli-generated
 * docs. HttpAIProvider is the only CURRENT implementor of the capability; the tests below
 * exercise it directly (real class, not a test double) to prove the capability is no longer
 * dead abstraction — they do not change what happens on this corpus today.
 *
 * @spec_ref AC-HTTP-4, AC-HTTP-5, AC-HTTP-6, AC-HTTP-7, AC-HTTP-8, AC-HTTP-TEL-1, spec-tiered-review-ledger-fast-track-judgment-required-promote#AC-TIER-10
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HttpAIProvider } from "../../../src/ai/http-provider.js";
import { AiHttpConfigSchema } from "@lore/core";
import type { AIProvider, Telemetry } from "@lore/core";
import { AIProviderService } from "../../../src/service/ai-provider-service.js";
import { GENERATE_PROMPT_VERSION } from "../../../src/ai/templates.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Minimal valid Anthropic Messages API response body. */
function makeValidAnthropicResponse(
  text: string = "# Generated document\n\nContent here.\n",
  opts: { input_tokens?: number; output_tokens?: number; stop_reason?: string } = {},
) {
  return {
    id: "msg_01TestMessageId",
    type: "message",
    role: "assistant",
    model: "claude-opus-4-8",
    content: [{ type: "text", text }],
    stop_reason: opts.stop_reason ?? "end_turn",
    usage: {
      input_tokens: opts.input_tokens ?? 25,
      output_tokens: opts.output_tokens ?? 180,
    },
  };
}

/** Make a mock fetch that returns a successful Anthropic response for the given text. */
function successFetch(text: string, opts?: { input_tokens?: number; output_tokens?: number; stop_reason?: string }) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(makeValidAnthropicResponse(text, opts)), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

/** Make a mock fetch that records the request body before returning a response. */
function capturingFetch(onBody: (body: unknown) => void, responseText = "# Output\n") {
  return vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.body) {
      onBody(JSON.parse(init.body as string));
    }
    return new Response(JSON.stringify(makeValidAnthropicResponse(responseText)), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

/** Make a mock fetch that simulates network abort (timeout) by watching the AbortSignal. */
function timeoutFetch() {
  return vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal as AbortSignal | undefined;
      if (signal) {
        signal.addEventListener("abort", () => {
          const err = new Error("The operation was aborted.");
          err.name = "AbortError";
          reject(err);
        });
      } else {
        // No signal — never resolves; test would time out (should not happen)
        void 0;
      }
    });
  });
}

/** Minimal valid GenerateInput. */
const baseInput = {
  prompt: "Write a PRD for a task manager app.",
  doc_type: "prd" as const,
  title: "Task Manager PRD",
};

/** Default provider config pointing at a fake URL. */
const defaultCfg = AiHttpConfigSchema.parse({ url: "https://api.test.invalid/v1/messages" });

// Install and tear down the fetch stub around each test
let fetchStub: ReturnType<typeof vi.fn> | null = null;

beforeEach(() => {
  fetchStub = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchStub = null;
});

// ─── Happy path (AC-HTTP-4, AC-HTTP-TEL-1) ───────────────────────────────────

describe("HttpAIProvider.generate — happy path (AC-HTTP-4, AC-HTTP-TEL-1)", () => {
  it("returns ok result with content from response content[0].text", async () => {
    const expectedText = "# Task Manager PRD\n\nHere is the document.\n";
    vi.stubGlobal("fetch", successFetch(expectedText));
    const provider = new HttpAIProvider("http", defaultCfg);
    const result = await provider.generate(baseInput);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.value.content).toBe(expectedText);
  });

  it("different response bodies produce different content values (anti-hardcoded)", async () => {
    // Anti-tautology: verify the implementation reads content from the response
    // Test 1: first response text
    vi.stubGlobal("fetch", successFetch("# First Document\n"));
    const provider = new HttpAIProvider("http", defaultCfg);
    const r1 = await provider.generate({ ...baseInput, prompt: "First prompt" });
    vi.unstubAllGlobals();

    // Test 2: second response text
    vi.stubGlobal("fetch", successFetch("# Second Document\n"));
    const r2 = await provider.generate({ ...baseInput, prompt: "Second prompt" });

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) throw new Error("Expected both ok");
    expect(r1.value.content).toBe("# First Document\n");
    expect(r2.value.content).toBe("# Second Document\n");
    expect(r1.value.content).not.toBe(r2.value.content);
  });

  it("POST body has correct model, max_tokens, and messages[0] with role='user'", async () => {
    let capturedBody: unknown = null;
    vi.stubGlobal("fetch", capturingFetch((body) => { capturedBody = body; }));

    const cfg = AiHttpConfigSchema.parse({
      url: "https://api.test.invalid/v1/messages",
      model: "claude-haiku-4",
      max_tokens: 2048,
    });
    const provider = new HttpAIProvider("http", cfg);
    await provider.generate({ prompt: "My specific prompt text", doc_type: "spec", title: "T" });

    expect(capturedBody).not.toBeNull();
    const body = capturedBody as Record<string, unknown>;
    expect(body["model"]).toBe("claude-haiku-4");
    expect(body["max_tokens"]).toBe(2048);
    const messages = body["messages"] as Array<{ role: string; content: string }>;
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.content).toBe("My specific prompt text");
  });

  it("POST body content is the exact prompt passed to generate()", async () => {
    // Anti-tautology: verify the prompt is wired through, not replaced with a fixed value
    let capturedBody: unknown = null;
    vi.stubGlobal("fetch", capturingFetch((body) => { capturedBody = body; }));

    const provider = new HttpAIProvider("http", defaultCfg);
    await provider.generate({ ...baseInput, prompt: "very specific unique prompt string 12345" });

    const body = capturedBody as Record<string, unknown>;
    const messages = body["messages"] as Array<{ content: string }>;
    expect(messages[0]?.content).toBe("very specific unique prompt string 12345");
  });

  it("usage field in GenerateOutput matches response usage tokens (AC-HTTP-TEL-1)", async () => {
    vi.stubGlobal("fetch", successFetch("# Content", { input_tokens: 42, output_tokens: 777 }));
    const provider = new HttpAIProvider("http", defaultCfg);
    const result = await provider.generate(baseInput);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.value.usage?.input_tokens).toBe(42);
    expect(result.value.usage?.output_tokens).toBe(777);
  });

  it("usage token values reflect actual response (anti-hardcoded via two calls)", async () => {
    vi.stubGlobal("fetch", successFetch("# Doc", { input_tokens: 10, output_tokens: 100 }));
    const p1 = new HttpAIProvider("http", defaultCfg);
    const r1 = await p1.generate(baseInput);
    vi.unstubAllGlobals();

    vi.stubGlobal("fetch", successFetch("# Doc", { input_tokens: 999, output_tokens: 4096 }));
    const p2 = new HttpAIProvider("http", defaultCfg);
    const r2 = await p2.generate(baseInput);

    if (!r1.ok || !r2.ok) throw new Error("Expected both ok");
    expect(r1.value.usage?.input_tokens).toBe(10);
    expect(r1.value.usage?.output_tokens).toBe(100);
    expect(r2.value.usage?.input_tokens).toBe(999);
    expect(r2.value.usage?.output_tokens).toBe(4096);
  });

  it("usage.stop_reason comes from top-level response stop_reason (not usage sub-object)", async () => {
    vi.stubGlobal("fetch", successFetch("# Content", { stop_reason: "max_tokens" }));
    const provider = new HttpAIProvider("http", defaultCfg);
    const result = await provider.generate(baseInput);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.value.usage?.stop_reason).toBe("max_tokens");
  });

  it("usage is absent in output when response has no usage field", async () => {
    const responseWithoutUsage = {
      id: "msg_nousage",
      type: "message",
      role: "assistant",
      model: "claude-opus-4-8",
      content: [{ type: "text", text: "# Content\n" }],
      stop_reason: "end_turn",
      // no usage field
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(responseWithoutUsage), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const provider = new HttpAIProvider("http", defaultCfg);
    const result = await provider.generate(baseInput);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.value.usage).toBeUndefined();
  });

  it("exit_code is 0 on success", async () => {
    vi.stubGlobal("fetch", successFetch("# Output\n"));
    const provider = new HttpAIProvider("http", defaultCfg);
    const result = await provider.generate(baseInput);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.value.exit_code).toBe(0);
  });

  it("provider_name in output matches the name passed to constructor", async () => {
    vi.stubGlobal("fetch", successFetch("# Output\n"));
    const provider = new HttpAIProvider("my-custom-http-provider", defaultCfg);
    const result = await provider.generate(baseInput);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.value.provider_name).toBe("my-custom-http-provider");
  });
});

// ─── HTTP error (AC-HTTP-5) ───────────────────────────────────────────────────

describe("HttpAIProvider.generate — HTTP 4xx/5xx errors (AC-HTTP-5)", () => {
  it("401 response → AI_PROVIDER_ERROR with code AI_PROVIDER_ERROR", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Unauthorized", { status: 401 })),
    );
    const provider = new HttpAIProvider("http", defaultCfg);
    const result = await provider.generate(baseInput);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected err");
    expect(result.error.code).toBe("AI_PROVIDER_ERROR");
  });

  it("401 response error message contains '401'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Unauthorized", { status: 401 })),
    );
    const provider = new HttpAIProvider("http", defaultCfg);
    const result = await provider.generate(baseInput);
    if (result.ok) throw new Error("Expected err");
    if (result.error.code !== "AI_PROVIDER_ERROR") throw new Error("Expected AI_PROVIDER_ERROR");
    expect(result.error.message).toContain("401");
  });

  it("401 response has exit_code -1", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Unauthorized", { status: 401 })),
    );
    const provider = new HttpAIProvider("http", defaultCfg);
    const result = await provider.generate(baseInput);
    if (result.ok) throw new Error("Expected err");
    if (result.error.code !== "AI_PROVIDER_ERROR") throw new Error("Expected AI_PROVIDER_ERROR");
    expect(result.error.exit_code).toBe(-1);
  });

  it("500 response → AI_PROVIDER_ERROR with '500' in message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Internal Server Error", { status: 500 })),
    );
    const provider = new HttpAIProvider("http", defaultCfg);
    const result = await provider.generate(baseInput);
    if (result.ok) throw new Error("Expected err");
    if (result.error.code !== "AI_PROVIDER_ERROR") throw new Error("Expected AI_PROVIDER_ERROR");
    expect(result.error.message).toContain("500");
  });

  it("403 error message contains '403', not '401' (status reflected accurately)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Forbidden", { status: 403 })),
    );
    const provider = new HttpAIProvider("http", defaultCfg);
    const result = await provider.generate(baseInput);
    if (result.ok) throw new Error("Expected err");
    if (result.error.code !== "AI_PROVIDER_ERROR") throw new Error("Expected AI_PROVIDER_ERROR");
    expect(result.error.message).toContain("403");
    expect(result.error.message).not.toContain("401");
  });

  it("HTTP error body truncated to 1024 chars in error message (AC-HTTP-5)", async () => {
    const longBody = "E".repeat(2000);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(longBody, { status: 429 })),
    );
    const provider = new HttpAIProvider("http", defaultCfg);
    const result = await provider.generate(baseInput);
    if (result.ok) throw new Error("Expected err");
    if (result.error.code !== "AI_PROVIDER_ERROR") throw new Error("Expected AI_PROVIDER_ERROR");
    // Count 'E' chars in the error message — must be exactly 1024, not 2000
    const eCount = (result.error.message.match(/E/g) ?? []).length;
    expect(eCount).toBe(1024);
  });

  it("D-004: resolved API key value does NOT appear in 401 error message", async () => {
    // Secret safety guard: sensitive header values must not leak into error messages
    const sentinelKey = "sk-ant-test-sentinel-key-that-must-not-leak";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Invalid API key", { status: 401 })),
    );
    // Headers are passed to HttpAIProvider already resolved (as buildProviderRegistry does)
    const cfg = AiHttpConfigSchema.parse({
      url: "https://api.test.invalid/v1/messages",
      headers: { "x-api-key": sentinelKey },
    });
    const provider = new HttpAIProvider("http", cfg);
    const result = await provider.generate(baseInput);
    if (result.ok) throw new Error("Expected err");
    if (result.error.code !== "AI_PROVIDER_ERROR") throw new Error("Expected AI_PROVIDER_ERROR");
    // Status appears (good for diagnosis)
    expect(result.error.message).toContain("401");
    // But the actual key value must NOT appear (D-004 secret policy)
    expect(result.error.message).not.toContain(sentinelKey);
  });
});

// ─── Invalid JSON body (AC-HTTP-7) ───────────────────────────────────────────

describe("HttpAIProvider.generate — invalid JSON response (AC-HTTP-7)", () => {
  it("200 response with non-JSON body → AI_PROVIDER_ERROR", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("not valid json at all {{{", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
      ),
    );
    const provider = new HttpAIProvider("http", defaultCfg);
    const result = await provider.generate(baseInput);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected err");
    expect(result.error.code).toBe("AI_PROVIDER_ERROR");
  });

  it("200 response with HTML body (gateway error rendered as HTML) → AI_PROVIDER_ERROR", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html><body>Error</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      ),
    );
    const provider = new HttpAIProvider("http", defaultCfg);
    const result = await provider.generate(baseInput);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected err");
    expect(result.error.code).toBe("AI_PROVIDER_ERROR");
  });

  it("200 response with valid JSON but wrong shape → AI_PROVIDER_ERROR", async () => {
    // Schema mismatch: valid JSON but not an Anthropic Messages response
    const wrongShape = { unexpected: "shape", foo: 123 };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(wrongShape), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const provider = new HttpAIProvider("http", defaultCfg);
    const result = await provider.generate(baseInput);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected err");
    expect(result.error.code).toBe("AI_PROVIDER_ERROR");
  });

  it("200 response with OpenAI-format body (wrong schema) → AI_PROVIDER_ERROR", async () => {
    // OpenAI format has choices[] instead of content[] — must be rejected by Zod schema
    const openAiShape = {
      id: "chatcmpl-abc",
      object: "chat.completion",
      choices: [{ message: { role: "assistant", content: "# Hello" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(openAiShape), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const provider = new HttpAIProvider("http", defaultCfg);
    const result = await provider.generate(baseInput);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected err");
    expect(result.error.code).toBe("AI_PROVIDER_ERROR");
  });

  it("200 response with empty content array → AI_PROVIDER_ERROR (schema min(1) violation)", async () => {
    // aiHttpResponseSchema requires content.min(1) — empty array fails validation
    const emptyContent = {
      id: "msg_empty",
      type: "message",
      role: "assistant",
      model: "claude-opus-4-8",
      content: [],
      stop_reason: "end_turn",
      usage: { input_tokens: 5, output_tokens: 0 },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(emptyContent), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const provider = new HttpAIProvider("http", defaultCfg);
    const result = await provider.generate(baseInput);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected err");
    expect(result.error.code).toBe("AI_PROVIDER_ERROR");
  });
});

// ─── Empty / whitespace content (AC-HTTP-8) ───────────────────────────────────

describe("HttpAIProvider.generate — empty/whitespace output (AC-HTTP-8)", () => {
  it("whitespace-only content[0].text → AI_PROVIDER_ERROR", async () => {
    vi.stubGlobal("fetch", successFetch("   "));
    const provider = new HttpAIProvider("http", defaultCfg);
    const result = await provider.generate(baseInput);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected err");
    expect(result.error.code).toBe("AI_PROVIDER_ERROR");
  });

  it("whitespace-only content error message contains 'empty output'", async () => {
    vi.stubGlobal("fetch", successFetch("  \n\t  "));
    const provider = new HttpAIProvider("http", defaultCfg);
    const result = await provider.generate(baseInput);
    if (result.ok) throw new Error("Expected err");
    if (result.error.code !== "AI_PROVIDER_ERROR") throw new Error("Expected AI_PROVIDER_ERROR");
    expect(result.error.message).toContain("empty output");
  });

  it("empty string content → AI_PROVIDER_ERROR with 'empty output'", async () => {
    vi.stubGlobal("fetch", successFetch(""));
    const provider = new HttpAIProvider("http", defaultCfg);
    const result = await provider.generate(baseInput);
    if (result.ok) throw new Error("Expected err");
    if (result.error.code !== "AI_PROVIDER_ERROR") throw new Error("Expected AI_PROVIDER_ERROR");
    expect(result.error.message).toContain("empty output");
  });

  it("single newline (whitespace-only) → AI_PROVIDER_ERROR", async () => {
    vi.stubGlobal("fetch", successFetch("\n"));
    const provider = new HttpAIProvider("http", defaultCfg);
    const result = await provider.generate(baseInput);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected err");
    expect(result.error.code).toBe("AI_PROVIDER_ERROR");
  });

  it("non-empty content (single meaningful char) does not trigger empty-output error", async () => {
    // Regression: a single 'x' character should NOT be treated as empty
    vi.stubGlobal("fetch", successFetch("x"));
    const provider = new HttpAIProvider("http", defaultCfg);
    const result = await provider.generate(baseInput);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.value.content).toBe("x");
  });
});

// ─── Network timeout (AC-HTTP-6) ─────────────────────────────────────────────

describe("HttpAIProvider.generate — network timeout (AC-HTTP-6)", () => {
  it("AbortError from fetch → AI_PROVIDER_ERROR with 'timeout' in message", async () => {
    // Simulate the AbortController timing out: fetch throws AbortError when signal fires
    vi.stubGlobal("fetch", timeoutFetch());
    const cfg = AiHttpConfigSchema.parse({
      url: "https://api.test.invalid/v1/messages",
      timeout_ms: 50, // Short timeout to trigger abort quickly
    });
    const provider = new HttpAIProvider("http", cfg);
    const result = await provider.generate(baseInput);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected err");
    expect(result.error.code).toBe("AI_PROVIDER_ERROR");
    if (result.error.code !== "AI_PROVIDER_ERROR") throw new Error("Expected AI_PROVIDER_ERROR");
    expect(result.error.message.toLowerCase()).toContain("timeout");
  }, 10_000);

  it("timeout error has exit_code -1", async () => {
    vi.stubGlobal("fetch", timeoutFetch());
    const cfg = AiHttpConfigSchema.parse({
      url: "https://api.test.invalid/v1/messages",
      timeout_ms: 50,
    });
    const provider = new HttpAIProvider("http", cfg);
    const result = await provider.generate(baseInput);
    if (result.ok) throw new Error("Expected err");
    if (result.error.code !== "AI_PROVIDER_ERROR") throw new Error("Expected AI_PROVIDER_ERROR");
    expect(result.error.exit_code).toBe(-1);
  }, 10_000);

  it("TimeoutError (alternate name) also detected as timeout", async () => {
    // HttpAIProvider checks error.name === "AbortError" || "TimeoutError"
    // Some environments throw "TimeoutError" instead of "AbortError"
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        const err = new Error("Request timed out");
        err.name = "TimeoutError";
        return Promise.reject(err);
      }),
    );
    const provider = new HttpAIProvider("http", defaultCfg);
    const result = await provider.generate(baseInput);
    if (result.ok) throw new Error("Expected err");
    if (result.error.code !== "AI_PROVIDER_ERROR") throw new Error("Expected AI_PROVIDER_ERROR");
    expect(result.error.message.toLowerCase()).toContain("timeout");
  });

  it("non-abort network error → AI_PROVIDER_ERROR but without 'timeout' in message", async () => {
    // Regression: a ECONNREFUSED should be AI_PROVIDER_ERROR but NOT 'timeout'
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        const err = new Error("connect ECONNREFUSED 127.0.0.1:9999");
        err.name = "Error"; // not AbortError
        return Promise.reject(err);
      }),
    );
    const provider = new HttpAIProvider("http", defaultCfg);
    const result = await provider.generate(baseInput);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected err");
    expect(result.error.code).toBe("AI_PROVIDER_ERROR");
    if (result.error.code !== "AI_PROVIDER_ERROR") throw new Error("Expected AI_PROVIDER_ERROR");
    // Should NOT classify as timeout
    expect(result.error.message.toLowerCase()).not.toContain("timeout");
  });
});

// ─── modelId — ModelAwareProvider capability (SPEC-103 AC-TIER-10) ───────────

describe("HttpAIProvider.modelId — ModelAwareProvider capability (spec-tiered-review-ledger-fast-track-judgment-required-promote#AC-TIER-10)", () => {
  it("modelId equals the configured model", () => {
    const cfg = AiHttpConfigSchema.parse({
      url: "https://api.test.invalid/v1/messages",
      model: "claude-haiku-4",
    });
    const provider = new HttpAIProvider("http", cfg);
    expect(provider.modelId).toBe("claude-haiku-4");
  });

  it("modelId falls back to AiHttpConfigSchema's default model when none is configured", () => {
    // defaultCfg was parsed with no `model` key — AiHttpConfigSchema defaults it to
    // "claude-opus-4-8" (packages/core/src/ai.ts). modelId must reflect the RESOLVED
    // config value, not silently omit or diverge from what the schema actually produced.
    const provider = new HttpAIProvider("http", defaultCfg);
    expect(provider.modelId).toBe(defaultCfg.model);
    expect(provider.modelId).toBe("claude-opus-4-8");
  });

  it("two providers built from different configs carry different modelId values (anti-hardcoded)", () => {
    const cfgA = AiHttpConfigSchema.parse({ url: "https://api.test.invalid/v1/messages", model: "model-a" });
    const cfgB = AiHttpConfigSchema.parse({ url: "https://api.test.invalid/v1/messages", model: "model-b" });
    const providerA = new HttpAIProvider("http", cfgA);
    const providerB = new HttpAIProvider("http", cfgB);
    expect(providerA.modelId).toBe("model-a");
    expect(providerB.modelId).toBe("model-b");
    expect(providerA.modelId).not.toBe(providerB.modelId);
  });

  it("satisfies the ModelAwareProvider structural shape: an own, non-empty string property", () => {
    const provider = new HttpAIProvider("http", defaultCfg);
    expect(Object.prototype.hasOwnProperty.call(provider, "modelId")).toBe(true);
    expect(typeof provider.modelId).toBe("string");
    expect(provider.modelId.length).toBeGreaterThan(0);
  });

  it("modelId is independent of the provider (registry) name", () => {
    const cfg = AiHttpConfigSchema.parse({
      url: "https://api.test.invalid/v1/messages",
      model: "claude-haiku-4",
    });
    const provider = new HttpAIProvider("my-registry-key", cfg);
    expect(provider.name).toBe("my-registry-key");
    expect(provider.modelId).toBe("claude-haiku-4");
    expect(provider.modelId).not.toBe(provider.name);
  });
});

// ─── AIProviderService wiring — ai_provenance.model is the REAL model id ─────
// (SPEC-103 AC-TIER-10, task-t4-give-modelawareprovider-its-real-implementor)
//
// The `-t ai_provenance` slice of this describe/it block set is what proves the capability
// introduced by task-t3-hardening is no longer dead abstraction: an AIProviderService wired
// with a REAL HttpAIProvider instance (not a test double) stamps ai_provenance.model with
// HttpAIProvider's actual configured model — never the provider (registry) name.

describe("HttpAIProvider wired into AIProviderService — ai_provenance.model (spec-tiered-review-ledger-fast-track-judgment-required-promote#AC-TIER-10)", () => {
  const assessBudgets = { max_diff_chars: 24000 };

  function makeTelemetry(): Telemetry {
    return { record: vi.fn(), emit: vi.fn(), close: vi.fn() };
  }

  it("generate() stamps ai_provenance.model with HttpAIProvider's real modelId, not its provider name", async () => {
    vi.stubGlobal("fetch", successFetch("# Generated via HTTP"));
    const cfg = AiHttpConfigSchema.parse({
      url: "https://api.test.invalid/v1/messages",
      model: "claude-haiku-4",
    });
    const provider = new HttpAIProvider("http", cfg);
    const providers: ReadonlyMap<string, AIProvider> = new Map([[provider.name, provider]]);
    const service = new AIProviderService(providers, provider.name, {}, makeTelemetry(), false, 8000, assessBudgets);

    const result = await service.generate({ doc_type: "prd", title: "A Title" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`generate failed: ${JSON.stringify(result.error)}`);

    expect(result.value.ai_provenance).toBeDefined();
    expect(result.value.ai_provenance?.provider).toBe("http");
    // The whole point of AC-TIER-10: model is the REAL modelId, distinct from provider name.
    expect(result.value.ai_provenance?.model).toBe("claude-haiku-4");
    expect(result.value.ai_provenance?.model).not.toBe(provider.name);
    expect(result.value.ai_provenance?.prompt_version).toBe(GENERATE_PROMPT_VERSION);
  });

  it("a differently-configured HttpAIProvider stamps a different ai_provenance.model (anti-hardcoded)", async () => {
    vi.stubGlobal("fetch", successFetch("# Generated via HTTP"));
    const cfg = AiHttpConfigSchema.parse({
      url: "https://api.test.invalid/v1/messages",
      model: "claude-opus-4-8",
    });
    const provider = new HttpAIProvider("http", cfg);
    const providers: ReadonlyMap<string, AIProvider> = new Map([[provider.name, provider]]);
    const service = new AIProviderService(providers, provider.name, {}, makeTelemetry(), false, 8000, assessBudgets);

    const result = await service.generate({ doc_type: "prd", title: "A Title" });
    if (!result.ok) throw new Error(`generate failed: ${JSON.stringify(result.error)}`);
    expect(result.value.ai_provenance?.model).toBe("claude-opus-4-8");
    expect(result.value.ai_provenance?.model).not.toBe("claude-haiku-4");
  });
});
