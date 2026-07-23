/**
 * Tests for SPEC-067 D1 (timeout floor) + D2 (partial-provider fail-loud at registry build).
 *
 * Spec-first expectations:
 *   - AC-067-1: built-in claude-cli config resolves timeout_ms to 180000 when no config
 *     override exists (schema default AND the registry's own built-in literal).
 *   - AC-067-2: a partial provider entry (timeout_ms only, no command/args) fails registry
 *     build with VALIDATION_ERROR naming the config key and echoing a complete example entry.
 *   - AC-067-3: a complete provider override builds successfully with the configured timeout
 *     value flowing through to the merged config used to construct the provider.
 *
 * Adversarial angles:
 *   - Partial entry must fail loud at buildProviderRegistry, not silently accepted and
 *     deferred to first generate() call (the exact regression SPEC-067 fixes).
 *   - buildProviderRegistry accepts a plain AiConfig object, not guaranteed to have flowed
 *     through AiConfigSchema.parse() first — validateMergedProviderEntry is defense-in-depth,
 *     tested directly with hand-built (schema-bypassing) objects.
 *   - Explicit config timeout_ms still wins over the 180000 schema default (AC-067-1's
 *     "when no config override exists" qualifier).
 *   - Healthy multi-provider config (built-in + user addition) still builds ok — no
 *     regression on the existing registry.test.ts coverage.
 *
 * @spec_ref AC-067-1, AC-067-2, AC-067-3, SPEC-067 D1/D2
 */

import { describe, it, expect } from "vitest";
import {
  buildProviderRegistry,
  mergeProviderConfigs,
  validateMergedProviderEntry,
  BUILT_IN_PROVIDER_CONFIGS,
} from "../../../src/ai/registry.js";
import { AiConfigSchema, AiProviderConfigSchema } from "@lore/core";
import type { AiProviderConfig } from "@lore/core";

// ─── AC-067-1: timeout floor 180000 ───────────────────────────────────────────

describe("AC-067-1: built-in claude-cli timeout_ms floor", () => {
  it("AC-067-1: AiProviderConfigSchema default timeout_ms is 180000", () => {
    const cfg = AiProviderConfigSchema.parse({ command: "claude", args: ["-p"] });
    expect(cfg.timeout_ms).toBe(180_000);
  });

  it("AC-067-1: BUILT_IN_PROVIDER_CONFIGS.claude-cli.timeout_ms is 180000", () => {
    expect(BUILT_IN_PROVIDER_CONFIGS["claude-cli"]?.timeout_ms).toBe(180_000);
  });

  it("AC-067-1: buildProviderRegistry with no config override merges timeout_ms 180000", () => {
    const config = AiConfigSchema.parse({});
    const merged = mergeProviderConfigs(config.providers);
    expect(merged["claude-cli"]?.timeout_ms).toBe(180_000);

    const result = buildProviderRegistry(config);
    expect(result.ok).toBe(true);
  });

  it("AC-067-1: explicit config override still wins over the 180000 schema default", () => {
    const config = AiConfigSchema.parse({
      providers: {
        "claude-cli": { command: "claude", args: ["-p"], timeout_ms: 42_000 },
      },
    });
    const merged = mergeProviderConfigs(config.providers);
    expect(merged["claude-cli"]?.timeout_ms).toBe(42_000);
  });
});

// ─── AC-067-2: partial-provider fail-loud at registry build ─────────────────

describe("AC-067-2: partial provider entry fails registry build", () => {
  it("AC-067-2: validateMergedProviderEntry rejects a timeout_ms-only entry (no command/args)", () => {
    const partial = { timeout_ms: 300_000 } as unknown as AiProviderConfig;
    const error = validateMergedProviderEntry("claude-cli", partial);
    expect(error).toBeDefined();
    expect(error?.code).toBe("VALIDATION_ERROR");
  });

  it("AC-067-2: error message names the offending config key", () => {
    const partial = { timeout_ms: 300_000 } as unknown as AiProviderConfig;
    const error = validateMergedProviderEntry("claude-cli", partial);
    if (error === undefined) throw new Error("Expected a validation error");
    if (error.code !== "VALIDATION_ERROR") throw new Error("Expected VALIDATION_ERROR");
    expect(error.field).toBe("ai.providers.claude-cli");
    expect(error.message).toContain("ai.providers.claude-cli");
  });

  it("AC-067-2: error message explains replace-not-merge semantics", () => {
    const partial = { timeout_ms: 300_000 } as unknown as AiProviderConfig;
    const error = validateMergedProviderEntry("claude-cli", partial);
    if (error === undefined || error.code !== "VALIDATION_ERROR") {
      throw new Error("Expected VALIDATION_ERROR");
    }
    expect(error.message.toLowerCase()).toContain("replace");
  });

  it("AC-067-2: error message contains a complete pasteable example entry (command+args+timeout_ms)", () => {
    const partial = { timeout_ms: 300_000 } as unknown as AiProviderConfig;
    const error = validateMergedProviderEntry("claude-cli", partial);
    if (error === undefined || error.code !== "VALIDATION_ERROR") {
      throw new Error("Expected VALIDATION_ERROR");
    }
    expect(error.message).toContain("command");
    expect(error.message).toContain("args");
    expect(error.message).toContain("timeout_ms");
    // The example echoes the caller's own timeout_ms value where available.
    expect(error.message).toContain("300000");
  });

  it("AC-067-2: buildProviderRegistry itself fails loud on a schema-bypassing partial entry", () => {
    const config = AiConfigSchema.parse({});
    // Simulate a partial entry that bypassed AiConfigSchema.parse() (e.g. constructed
    // directly rather than loaded from YAML) — buildProviderRegistry must not trust that
    // its caller always validated through the schema first (defense-in-depth, per module
    // header). Cast bypasses TypeScript's compile-time AiProviderConfig shape check only;
    // at runtime this is exactly what a malformed config object looks like.
    const configWithPartialProvider = {
      ...config,
      providers: { "claude-cli": { timeout_ms: 300_000 } },
    } as unknown as Parameters<typeof buildProviderRegistry>[0];

    const result = buildProviderRegistry(configWithPartialProvider);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected err");
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") throw new Error("Expected VALIDATION_ERROR");
    expect(result.error.field).toBe("ai.providers.claude-cli");
  });

  it("AC-067-2: no provider is constructed when validation fails (providers map absent from err result)", () => {
    const config = AiConfigSchema.parse({});
    const configWithPartialProvider = {
      ...config,
      providers: { "claude-cli": { timeout_ms: 300_000 } },
    } as unknown as Parameters<typeof buildProviderRegistry>[0];

    const result = buildProviderRegistry(configWithPartialProvider);
    expect(result.ok).toBe(false);
    // A failing Result carries no `value` — nothing was constructed to leak.
    expect((result as { value?: unknown }).value).toBeUndefined();
  });
});

// ─── AC-067-3: complete override builds with effective configured timeout ───

describe("AC-067-3: complete provider override builds with effective timeout", () => {
  it("AC-067-3: validateMergedProviderEntry accepts a complete entry", () => {
    const complete: AiProviderConfig = { command: "claude", args: ["-p"], timeout_ms: 300_000 };
    const error = validateMergedProviderEntry("claude-cli", complete);
    expect(error).toBeUndefined();
  });

  it("AC-067-3: buildProviderRegistry succeeds with a complete override entry", () => {
    const config = AiConfigSchema.parse({
      providers: {
        "claude-cli": { command: "claude", args: ["-p"], timeout_ms: 300_000 },
      },
    });
    const result = buildProviderRegistry(config);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.value.providers.has("claude-cli")).toBe(true);
  });

  it("AC-067-3: the merged config used to construct the provider carries the configured timeout_ms", () => {
    const config = AiConfigSchema.parse({
      providers: {
        "claude-cli": { command: "claude", args: ["-p"], timeout_ms: 300_000 },
      },
    });
    // mergeProviderConfigs is the exact function buildProviderRegistry calls before
    // constructing ClaudeCliProvider — this is the effective config the provider receives.
    const merged = mergeProviderConfigs(config.providers);
    expect(merged["claude-cli"]?.timeout_ms).toBe(300_000);

    const result = buildProviderRegistry(config);
    expect(result.ok).toBe(true);
  });

  it("AC-067-3: a healthy multi-provider config (built-in + user addition) still builds ok (no regression)", () => {
    const config = AiConfigSchema.parse({
      providers: {
        "codex-cli": { command: "codex", args: ["--output", "text"], timeout_ms: 30_000 },
      },
    });
    const result = buildProviderRegistry(config);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.value.providers.size).toBe(2);
    expect(result.value.providers.has("claude-cli")).toBe(true);
    expect(result.value.providers.has("codex-cli")).toBe(true);
  });
});
