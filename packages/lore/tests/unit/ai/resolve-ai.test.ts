/**
 * Tests for resolveAiDefault() and BUILT_IN_AI_DEFAULTS.
 *
 * Spec-first expected behaviours (SPEC-024 §9.3):
 *   - Precedence: explicit_arg > config > built-in (env / cli_flag)
 *   - Human surfaces (cli, http_cookie): built-in = true, source = "cli_flag"
 *   - Agent surfaces (agent, mcp, http_token): built-in = false, source = "env"
 *   - When explicit is provided it ALWAYS wins, even against opposing config
 *   - When config entry exists for the surface it wins over built-in
 *   - When config entry is absent for a surface, falls through to built-in
 *
 * Adversarial angles:
 *   - Verify "env" source is returned for agent/mcp/http_token (not "cli_flag" or "config")
 *   - Verify "cli_flag" source for cli/http_cookie (not "env")
 *   - Partial config must not bleed into surfaces it doesn't declare
 *   - explicit=false must override a built-in true (and vice-versa)
 *   - BUILT_IN_AI_DEFAULTS must have exactly the five canonical surfaces
 *
 * @spec_ref AC-NOAI-1 AC-NOAI-2 AC-NOAI-3
 */

import { describe, it, expect } from "vitest";
import { resolveAiDefault, BUILT_IN_AI_DEFAULTS } from "../../../src/ai/resolve-ai.js";
import type { CallerSurface, AiDefaultSource } from "@lore/core";

// ─── BUILT_IN_AI_DEFAULTS ─────────────────────────────────────────────────────

describe("BUILT_IN_AI_DEFAULTS", () => {
  it("cli is true (human surface — AI on by default)", () => {
    expect(BUILT_IN_AI_DEFAULTS.cli).toBe(true);
  });

  it("agent is false (AI-invoked CLI — skip claude-on-claude nesting)", () => {
    expect(BUILT_IN_AI_DEFAULTS.agent).toBe(false);
  });

  it("mcp is false (MCP callers are always AI agents)", () => {
    expect(BUILT_IN_AI_DEFAULTS.mcp).toBe(false);
  });

  it("http_cookie is true (human browser session — dashboard)", () => {
    expect(BUILT_IN_AI_DEFAULTS.http_cookie).toBe(true);
  });

  it("http_token is false (agent-issued API token)", () => {
    expect(BUILT_IN_AI_DEFAULTS.http_token).toBe(false);
  });

  it("covers exactly the five canonical CallerSurface values", () => {
    const surfaces: CallerSurface[] = ["cli", "agent", "mcp", "http_cookie", "http_token"];
    for (const s of surfaces) {
      expect(BUILT_IN_AI_DEFAULTS[s]).toBeDefined();
    }
    expect(Object.keys(BUILT_IN_AI_DEFAULTS)).toHaveLength(5);
  });
});

// ─── HAPPY — explicit_arg tier wins over everything ───────────────────────────

describe("resolveAiDefault — explicit_arg tier", () => {
  it("explicit=true on agent surface returns {ai:true, source:'explicit_arg'}", () => {
    const result = resolveAiDefault(true, "agent", undefined);
    const expected: { ai: boolean; source: AiDefaultSource } = { ai: true, source: "explicit_arg" };
    expect(result).toEqual(expected);
  });

  it("explicit=false on cli surface returns {ai:false, source:'explicit_arg'}", () => {
    const result = resolveAiDefault(false, "cli", undefined);
    expect(result).toEqual({ ai: false, source: "explicit_arg" });
  });

  it("explicit=true beats opposing config (mcp with config mcp:false)", () => {
    const result = resolveAiDefault(true, "mcp", { mcp: false });
    expect(result).toEqual({ ai: true, source: "explicit_arg" });
  });

  it("explicit=false beats opposing config (cli with config cli:true)", () => {
    const result = resolveAiDefault(false, "cli", { cli: true });
    expect(result).toEqual({ ai: false, source: "explicit_arg" });
  });

  it("explicit=true beats built-in false for http_token surface", () => {
    // http_token built-in is false; explicit=true must still win
    const result = resolveAiDefault(true, "http_token", undefined);
    expect(result).toEqual({ ai: true, source: "explicit_arg" });
  });

  it("explicit=false beats built-in true for cli surface", () => {
    // cli built-in is true; explicit=false must still win
    const result = resolveAiDefault(false, "cli", undefined);
    expect(result).toEqual({ ai: false, source: "explicit_arg" });
  });

  it("explicit=false beats built-in true for http_cookie surface", () => {
    const result = resolveAiDefault(false, "http_cookie", undefined);
    expect(result).toEqual({ ai: false, source: "explicit_arg" });
  });
});

// ─── HAPPY — config tier (no explicit arg) ───────────────────────────────────

describe("resolveAiDefault — config tier", () => {
  it("config.cli:false overrides built-in true for cli surface", () => {
    const result = resolveAiDefault(undefined, "cli", { cli: false });
    const expected: { ai: boolean; source: AiDefaultSource } = { ai: false, source: "config" };
    expect(result).toEqual(expected);
  });

  it("config.agent:true overrides built-in false for agent surface", () => {
    const result = resolveAiDefault(undefined, "agent", { agent: true });
    expect(result).toEqual({ ai: true, source: "config" });
  });

  it("config.mcp:true overrides built-in false for mcp surface", () => {
    const result = resolveAiDefault(undefined, "mcp", { mcp: true });
    expect(result).toEqual({ ai: true, source: "config" });
  });

  it("config.http_token:true overrides built-in false for http_token surface", () => {
    const result = resolveAiDefault(undefined, "http_token", { http_token: true });
    expect(result).toEqual({ ai: true, source: "config" });
  });

  it("config.http_cookie:false overrides built-in true for http_cookie surface", () => {
    const result = resolveAiDefault(undefined, "http_cookie", { http_cookie: false });
    expect(result).toEqual({ ai: false, source: "config" });
  });
});

// ─── HAPPY — built-in tier (source name correctness) ─────────────────────────

describe("resolveAiDefault — built-in tier source names", () => {
  it("cli with no explicit/config returns source='cli_flag' (not 'env')", () => {
    const result = resolveAiDefault(undefined, "cli", undefined);
    expect(result.ai).toBe(true);
    expect(result.source).toBe("cli_flag");
    // adversarial: must NOT return "env" for a human-facing surface
    expect(result.source).not.toBe("env");
  });

  it("http_cookie with no explicit/config returns source='cli_flag' (not 'env')", () => {
    const result = resolveAiDefault(undefined, "http_cookie", undefined);
    expect(result.ai).toBe(true);
    expect(result.source).toBe("cli_flag");
    expect(result.source).not.toBe("env");
  });

  it("agent with no explicit/config returns source='env' (not 'cli_flag')", () => {
    const result = resolveAiDefault(undefined, "agent", undefined);
    expect(result.ai).toBe(false);
    expect(result.source).toBe("env");
    // adversarial: must NOT return "cli_flag" for an agent surface
    expect(result.source).not.toBe("cli_flag");
  });

  it("mcp with no explicit/config returns source='env' (not 'cli_flag')", () => {
    const result = resolveAiDefault(undefined, "mcp", undefined);
    expect(result.ai).toBe(false);
    expect(result.source).toBe("env");
    expect(result.source).not.toBe("cli_flag");
  });

  it("http_token with no explicit/config returns source='env' (not 'cli_flag')", () => {
    const result = resolveAiDefault(undefined, "http_token", undefined);
    expect(result.ai).toBe(false);
    expect(result.source).toBe("env");
    expect(result.source).not.toBe("cli_flag");
  });
});

// ─── BOUNDARY — partial config (only some surfaces declared) ─────────────────

describe("resolveAiDefault — partial config boundary cases", () => {
  it("cli falls back to built-in when config only has agent key", () => {
    // config declares agent but not cli → cli should use built-in (true, "cli_flag")
    const result = resolveAiDefault(undefined, "cli", { agent: false });
    expect(result).toEqual({ ai: true, source: "cli_flag" });
  });

  it("mcp falls back to built-in when config only has cli key", () => {
    const result = resolveAiDefault(undefined, "mcp", { cli: true });
    expect(result).toEqual({ ai: false, source: "env" });
  });

  it("agent falls back to built-in when config is empty object", () => {
    const result = resolveAiDefault(undefined, "agent", {});
    expect(result).toEqual({ ai: false, source: "env" });
  });

  it("http_cookie falls back to built-in when config only has http_token key", () => {
    const result = resolveAiDefault(undefined, "http_cookie", { http_token: true });
    expect(result).toEqual({ ai: true, source: "cli_flag" });
  });
});

// ─── STATE — invariants across all surfaces ──────────────────────────────────

describe("resolveAiDefault — state / invariants", () => {
  it("always returns a non-null object with ai (boolean) and source fields", () => {
    const surfaces: CallerSurface[] = ["cli", "agent", "mcp", "http_cookie", "http_token"];
    for (const surface of surfaces) {
      const result = resolveAiDefault(undefined, surface, undefined);
      expect(typeof result.ai).toBe("boolean");
      expect(typeof result.source).toBe("string");
      expect(result.source).toMatch(/^(explicit_arg|config|env|cli_flag)$/);
    }
  });

  it("function is pure — calling twice with same args yields identical result", () => {
    const a = resolveAiDefault(undefined, "cli", { cli: false });
    const b = resolveAiDefault(undefined, "cli", { cli: false });
    expect(a).toEqual(b);
  });

  it("config source is used even when config value matches built-in", () => {
    // cli built-in is true; config cli:true still returns source="config" not "cli_flag"
    const result = resolveAiDefault(undefined, "cli", { cli: true });
    expect(result).toEqual({ ai: true, source: "config" });
  });

  it("never returns source='explicit_arg' when explicit is undefined", () => {
    const surfaces: CallerSurface[] = ["cli", "agent", "mcp", "http_cookie", "http_token"];
    for (const surface of surfaces) {
      const result = resolveAiDefault(undefined, surface, undefined);
      expect(result.source).not.toBe("explicit_arg");
    }
  });

  it("never returns source='config' when configDefaults is undefined", () => {
    const surfaces: CallerSurface[] = ["cli", "agent", "mcp", "http_cookie", "http_token"];
    for (const surface of surfaces) {
      const result = resolveAiDefault(undefined, surface, undefined);
      expect(result.source).not.toBe("config");
    }
  });
});

// ─── REGRESSION — distinct inputs produce distinct outputs (anti-hardcoded stub) ──

describe("resolveAiDefault — regression (different inputs, different outputs)", () => {
  it("cli vs agent without explicit produce different ai values", () => {
    const cliResult = resolveAiDefault(undefined, "cli", undefined);
    const agentResult = resolveAiDefault(undefined, "agent", undefined);
    // SPEC-024: cli is on, agent is off — they MUST differ
    expect(cliResult.ai).not.toBe(agentResult.ai);
  });

  it("explicit=true vs explicit=false produce different ai values on same surface", () => {
    const trueResult = resolveAiDefault(true, "mcp", undefined);
    const falseResult = resolveAiDefault(false, "mcp", undefined);
    expect(trueResult.ai).not.toBe(falseResult.ai);
  });

  it("config override vs no config produce different sources for agent surface", () => {
    const withConfig = resolveAiDefault(undefined, "agent", { agent: true });
    const withoutConfig = resolveAiDefault(undefined, "agent", undefined);
    expect(withConfig.source).toBe("config");
    expect(withoutConfig.source).toBe("env");
  });

  it("http_cookie vs http_token without explicit produce different ai values", () => {
    const cookieResult = resolveAiDefault(undefined, "http_cookie", undefined);
    const tokenResult = resolveAiDefault(undefined, "http_token", undefined);
    // http_cookie = true (human browser), http_token = false (agent token)
    expect(cookieResult.ai).toBe(true);
    expect(tokenResult.ai).toBe(false);
    expect(cookieResult.ai).not.toBe(tokenResult.ai);
  });
});
