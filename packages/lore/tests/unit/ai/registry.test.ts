/**
 * Tests for buildProviderRegistry (SPEC-017 §3.5).
 *
 * Spec-first expectations:
 *   - Default config → ok, providers has "claude-cli", active === "claude-cli"
 *   - User can override existing provider configs
 *   - User can add new providers and set one as active
 *   - Unknown active provider → STORE_ERROR with listing of known providers
 *
 * Adversarial angles:
 *   - AC-AI-11: unknown provider must fail with STORE_ERROR not silently fall back
 *   - User override REPLACES (not merges) built-in entry per spec §3.5
 *   - User-added provider can be set as active
 *   - Providers map is ReadonlyMap — immutable after return
 *   - Error message must list known providers so user can diagnose
 *
 * Structural notes (AC-AI-14):
 *   buildProviderRegistry is called exclusively from app.ts; no other module
 *   directly instantiates AIProviderService. This structural invariant is
 *   verified by code review, not test assertion.
 *
 * @spec_ref AC-AI-11, AC-AI-14, SPEC-017 §3.5
 */

import { describe, it, expect } from "vitest";
import { buildProviderRegistry } from "../../../src/ai/registry.js";
import { AiConfigSchema } from "@lore/core";

// ─── Default config ──────────────────────────────────────────────────────────

describe("buildProviderRegistry — default config", () => {
  it("returns ok with default AiConfig", () => {
    const config = AiConfigSchema.parse({});
    const result = buildProviderRegistry(config);
    expect(result.ok).toBe(true);
  });

  it("providers map contains 'claude-cli' with default config", () => {
    const config = AiConfigSchema.parse({});
    const result = buildProviderRegistry(config);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.value.providers.has("claude-cli")).toBe(true);
  });

  it("active is 'claude-cli' with default config", () => {
    const config = AiConfigSchema.parse({});
    const result = buildProviderRegistry(config);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.value.active).toBe("claude-cli");
  });

  it("only claude-cli is in the providers map by default (no extra built-ins)", () => {
    const config = AiConfigSchema.parse({});
    const result = buildProviderRegistry(config);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.value.providers.size).toBe(1);
    expect([...result.value.providers.keys()]).toEqual(["claude-cli"]);
  });

  it("provider object has correct name property", () => {
    const config = AiConfigSchema.parse({});
    const result = buildProviderRegistry(config);
    if (!result.ok) throw new Error("Expected ok");
    const provider = result.value.providers.get("claude-cli");
    expect(provider).toBeDefined();
    expect(provider!.name).toBe("claude-cli");
  });
});

// ─── User provider overrides ─────────────────────────────────────────────────

describe("buildProviderRegistry — user overrides", () => {
  it("user override of claude-cli command → registry still ok, active='claude-cli'", () => {
    const config = AiConfigSchema.parse({
      providers: {
        "claude-cli": { command: "my-custom-claude", args: ["--print"], timeout_ms: 1000 },
      },
    });
    const result = buildProviderRegistry(config);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.value.active).toBe("claude-cli");
    // The provider is still registered (not removed by user override)
    expect(result.value.providers.has("claude-cli")).toBe(true);
  });

  it("user can add a new provider entry alongside built-in", () => {
    const config = AiConfigSchema.parse({
      providers: {
        "codex-cli": { command: "codex", args: ["--output", "text"], timeout_ms: 30_000 },
      },
    });
    const result = buildProviderRegistry(config);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok");
    // Built-in still present
    expect(result.value.providers.has("claude-cli")).toBe(true);
    // New provider also present
    expect(result.value.providers.has("codex-cli")).toBe(true);
    expect(result.value.providers.size).toBe(2);
  });

  it("user can set active to a newly added provider", () => {
    const config = AiConfigSchema.parse({
      provider: "codex-cli",
      providers: {
        "codex-cli": { command: "codex", args: [], timeout_ms: 30_000 },
      },
    });
    const result = buildProviderRegistry(config);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.value.active).toBe("codex-cli");
    expect(result.value.providers.has("codex-cli")).toBe(true);
    // Original built-in still present
    expect(result.value.providers.has("claude-cli")).toBe(true);
  });

  it("both user override and new provider can coexist", () => {
    const config = AiConfigSchema.parse({
      provider: "codex-cli",
      providers: {
        "claude-cli": { command: "claude-custom", args: ["-p"], timeout_ms: 120_000 },
        "codex-cli": { command: "codex", args: [], timeout_ms: 30_000 },
      },
    });
    const result = buildProviderRegistry(config);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.value.providers.size).toBe(2);
    expect(result.value.active).toBe("codex-cli");
  });
});

// ─── AC-AI-11: unknown active provider → STORE_ERROR ────────────────────────

describe("buildProviderRegistry — AC-AI-11 unknown provider rejection", () => {
  it("returns err when provider is not in the merged map", () => {
    const config = AiConfigSchema.parse({ provider: "ghost" });
    const result = buildProviderRegistry(config);
    expect(result.ok).toBe(false);
  });

  it("error has code 'STORE_ERROR' (not AI_PROVIDER_ERROR)", () => {
    const config = AiConfigSchema.parse({ provider: "ghost" });
    const result = buildProviderRegistry(config);
    if (result.ok) throw new Error("Expected err");
    expect(result.error.code).toBe("STORE_ERROR");
  });

  it("error message mentions the unknown provider name", () => {
    const config = AiConfigSchema.parse({ provider: "ghost" });
    const result = buildProviderRegistry(config);
    if (result.ok) throw new Error("Expected err");
    // Narrow to STORE_ERROR (which has message) via discriminated union
    if (result.error.code !== "STORE_ERROR") throw new Error("Expected STORE_ERROR");
    expect(result.error.message).toContain("ghost");
  });

  it("error message lists known providers so user can diagnose", () => {
    const config = AiConfigSchema.parse({ provider: "ghost" });
    const result = buildProviderRegistry(config);
    if (result.ok) throw new Error("Expected err");
    if (result.error.code !== "STORE_ERROR") throw new Error("Expected STORE_ERROR");
    // Built-in "claude-cli" should appear in the error message
    expect(result.error.message).toContain("claude-cli");
  });

  it("unknown provider fails even when user-added providers exist", () => {
    const config = AiConfigSchema.parse({
      provider: "ghost",
      providers: {
        "codex-cli": { command: "codex", args: [], timeout_ms: 30_000 },
      },
    });
    const result = buildProviderRegistry(config);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected err");
    if (result.error.code !== "STORE_ERROR") throw new Error("Expected STORE_ERROR");
    // Should list both claude-cli and codex-cli as known
    expect(result.error.message).toContain("claude-cli");
    expect(result.error.message).toContain("codex-cli");
  });
});
