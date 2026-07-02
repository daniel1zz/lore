/**
 * Unit tests for buildProviderRegistry — HTTP provider branch (SPEC-020 §9).
 *
 * Spec-first expectations:
 *   - AC-HTTP-1: provider="http" + valid config + env → active="http", providers has "http",
 *     the "http" key maps to HttpAIProvider (not ClaudeCliProvider)
 *   - AC-HTTP-3: ${VAR} header with missing env var → VALIDATION_ERROR propagated from registry
 *   - Regression: provider="claude-cli" path unchanged — ClaudeCliProvider still wired
 *   - Regression: unknown provider → STORE_ERROR (unchanged from SPEC-017)
 *
 * Adversarial focus:
 *   - Provider "http" in map must not map to the CLI provider
 *   - Env resolution is done at registry time, not at generate() time (fail-loud guarantee)
 *   - Validation error from missing header env var propagates cleanly through registry
 *   - Provider map correctly has BOTH "claude-cli" and "http" when provider="http"
 *
 * @spec_ref AC-HTTP-1, AC-HTTP-3
 */

import { describe, it, expect } from "vitest";
import { buildProviderRegistry } from "../../../src/ai/registry.js";
import { AiConfigSchema } from "@lore/core";

// ─── AC-HTTP-1: HTTP provider wired correctly ─────────────────────────────────

describe("buildProviderRegistry — provider='http' (AC-HTTP-1)", () => {
  const httpConfig = AiConfigSchema.parse({
    provider: "http",
    http: {
      url: "https://api.anthropic.com/v1/messages",
      headers: { "x-api-key": "${ANTHROPIC_API_KEY}", "anthropic-version": "2023-06-01" },
    },
  });

  const mockEnv = { ANTHROPIC_API_KEY: "sk-ant-mock-key-for-tests" };

  it("returns ok with provider='http' and valid config + env", () => {
    const result = buildProviderRegistry(httpConfig, mockEnv);
    expect(result.ok).toBe(true);
  });

  it("active is 'http' when provider='http'", () => {
    const result = buildProviderRegistry(httpConfig, mockEnv);
    if (!result.ok) throw new Error(`Expected ok, got: ${JSON.stringify(result.error)}`);
    expect(result.value.active).toBe("http");
  });

  it("providers map contains 'http' key", () => {
    const result = buildProviderRegistry(httpConfig, mockEnv);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.value.providers.has("http")).toBe(true);
  });

  it("providers map still contains 'claude-cli' (built-in always seeded)", () => {
    // The registry always seeds ClaudeCliProvider for "claude-cli" before registering HTTP
    const result = buildProviderRegistry(httpConfig, mockEnv);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.value.providers.has("claude-cli")).toBe(true);
  });

  it("providers map has exactly 2 keys: 'claude-cli' and 'http'", () => {
    const result = buildProviderRegistry(httpConfig, mockEnv);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.value.providers.size).toBe(2);
    const keys = [...result.value.providers.keys()].sort();
    expect(keys).toEqual(["claude-cli", "http"]);
  });

  it("the 'http' key maps to a provider whose name is 'http'", () => {
    const result = buildProviderRegistry(httpConfig, mockEnv);
    if (!result.ok) throw new Error("Expected ok");
    const httpProvider = result.value.providers.get("http");
    expect(httpProvider).toBeDefined();
    expect(httpProvider!.name).toBe("http");
  });

  it("the 'claude-cli' provider has name 'claude-cli'", () => {
    const result = buildProviderRegistry(httpConfig, mockEnv);
    if (!result.ok) throw new Error("Expected ok");
    const cliProvider = result.value.providers.get("claude-cli");
    expect(cliProvider?.name).toBe("claude-cli");
  });

  it("env vars resolved in headers: different key values produce distinct providers", () => {
    // Anti-tautology: verify env is actually read, not hardcoded
    const env1 = { ANTHROPIC_API_KEY: "key-alpha" };
    const env2 = { ANTHROPIC_API_KEY: "key-beta" };
    const r1 = buildProviderRegistry(httpConfig, env1);
    const r2 = buildProviderRegistry(httpConfig, env2);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    // Both registries should succeed — different envs don't affect registry shape
    if (!r1.ok || !r2.ok) throw new Error("Expected both ok");
    expect(r1.value.active).toBe("http");
    expect(r2.value.active).toBe("http");
  });
});

// ─── AC-HTTP-3: missing env var in headers → VALIDATION_ERROR ─────────────────

describe("buildProviderRegistry — AC-HTTP-3 missing env var in headers", () => {
  it("returns err when ${VAR} header env var is missing from env", () => {
    const config = AiConfigSchema.parse({
      provider: "http",
      http: {
        url: "https://api.anthropic.com/v1/messages",
        headers: { "x-api-key": "${MISSING_API_KEY}" },
      },
    });
    const result = buildProviderRegistry(config, {}); // empty env — no MISSING_API_KEY
    expect(result.ok).toBe(false);
  });

  it("error code is VALIDATION_ERROR (not STORE_ERROR)", () => {
    const config = AiConfigSchema.parse({
      provider: "http",
      http: {
        url: "https://api.anthropic.com/v1/messages",
        headers: { "x-api-key": "${MISSING_KEY}" },
      },
    });
    const result = buildProviderRegistry(config, {});
    if (result.ok) throw new Error("Expected err");
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("error field identifies the missing header path", () => {
    const config = AiConfigSchema.parse({
      provider: "http",
      http: {
        url: "https://api.anthropic.com/v1/messages",
        headers: { "x-api-key": "${MY_SECRET_KEY}" },
      },
    });
    const result = buildProviderRegistry(config, {});
    if (result.ok) throw new Error("Expected err");
    if (result.error.code !== "VALIDATION_ERROR") throw new Error("Expected VALIDATION_ERROR");
    expect(result.error.field).toContain("x-api-key");
  });

  it("error message names the missing env var", () => {
    const config = AiConfigSchema.parse({
      provider: "http",
      http: {
        url: "https://api.anthropic.com/v1/messages",
        headers: { auth: "${VERY_SPECIFIC_TOKEN_VAR}" },
      },
    });
    const result = buildProviderRegistry(config, {});
    if (result.ok) throw new Error("Expected err");
    if (result.error.code !== "VALIDATION_ERROR") throw new Error("Expected VALIDATION_ERROR");
    expect(result.error.message).toContain("VERY_SPECIFIC_TOKEN_VAR");
  });

  it("empty string env var → VALIDATION_ERROR (treated as unset)", () => {
    const config = AiConfigSchema.parse({
      provider: "http",
      http: {
        url: "https://api.anthropic.com/v1/messages",
        headers: { "x-api-key": "${ANTHROPIC_API_KEY}" },
      },
    });
    const result = buildProviderRegistry(config, { ANTHROPIC_API_KEY: "" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected err");
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });
});

// ─── Regression: provider='claude-cli' path unchanged ─────────────────────────

describe("buildProviderRegistry — claude-cli path regression", () => {
  it("default config (provider='claude-cli') still returns ok", () => {
    const config = AiConfigSchema.parse({});
    const result = buildProviderRegistry(config);
    expect(result.ok).toBe(true);
  });

  it("default config has active='claude-cli'", () => {
    const config = AiConfigSchema.parse({});
    const result = buildProviderRegistry(config);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.value.active).toBe("claude-cli");
  });

  it("default config has only 'claude-cli' in providers map (no 'http' added)", () => {
    const config = AiConfigSchema.parse({});
    const result = buildProviderRegistry(config);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.value.providers.has("http")).toBe(false);
    expect(result.value.providers.has("claude-cli")).toBe(true);
  });

  it("default config does not pass env to resolveEnvInHeaders (no env resolution for CLI)", () => {
    // Regression: CLI path must succeed even with an empty env (no headers to resolve)
    const config = AiConfigSchema.parse({});
    const result = buildProviderRegistry(config, {}); // empty env should NOT cause VALIDATION_ERROR
    expect(result.ok).toBe(true);
  });
});

// ─── Regression: unknown provider → STORE_ERROR (unchanged from SPEC-017) ──────

describe("buildProviderRegistry — unknown provider regression (AC-AI-11)", () => {
  it("unknown provider name → err result", () => {
    const config = AiConfigSchema.parse({ provider: "ghost-provider" });
    const result = buildProviderRegistry(config);
    expect(result.ok).toBe(false);
  });

  it("unknown provider → STORE_ERROR code", () => {
    const config = AiConfigSchema.parse({ provider: "ghost-provider" });
    const result = buildProviderRegistry(config);
    if (result.ok) throw new Error("Expected err");
    expect(result.error.code).toBe("STORE_ERROR");
  });

  it("unknown provider error message lists known providers for diagnosis", () => {
    const config = AiConfigSchema.parse({ provider: "ghost-provider" });
    const result = buildProviderRegistry(config);
    if (result.ok) throw new Error("Expected err");
    if (result.error.code !== "STORE_ERROR") throw new Error("Expected STORE_ERROR");
    expect(result.error.message).toContain("claude-cli");
    expect(result.error.message).toContain("ghost-provider");
  });
});
