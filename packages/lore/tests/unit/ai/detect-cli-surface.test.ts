/**
 * Tests for SPEC-024 surface detection logic.
 *
 * detectCliSurface() is an internal function in loader.ts (not exported).
 * This test file validates its SPEC-24 intent by testing the downstream effect:
 * the surface that would be selected per env var drives the AI default.
 *
 * SPEC-024 §9.1 — surface classification:
 *   "cli"   — no agent env vars set (human in terminal)
 *   "agent" — CLAUDECODE=1, OR CI=true, OR LORE_AI_DEFAULT=off
 *
 * The test validates through resolveAiDefault() which is called with the
 * surface that detectCliSurface() returns:
 *   - "cli" surface → AI on by default (cli_flag)
 *   - "agent" surface → AI off by default (env)
 *   - When agent explicitly opts in (ai: true) → AI on (explicit_arg)
 *
 * Adversarial angles:
 *   - Agent surface with no explicit must return ai=false (not ai=true)
 *   - CLI surface with no explicit must return ai=true (not ai=false)
 *   - Explicit opt-in from agent surface must still work (explicit_arg wins)
 *   - Source must be "env" not "cli_flag" for agent surfaces
 *
 * @spec_ref AC-NOAI-1 AC-NOAI-2 AC-NOAI-6
 */

import { describe, it, expect } from "vitest";
import { resolveAiDefault } from "../../../src/ai/resolve-ai.js";

// ─── HAPPY — env-var surface detection via resolveAiDefault ──────────────────

describe("Surface detection — CLI surface (no agent env vars)", () => {
  it("CLI surface returns ai=true by default (human terminal baseline)", () => {
    // When CLAUDECODE, CI, LORE_AI_DEFAULT=off are all absent, surface = "cli"
    // This replicates what detectCliSurface() would return without agent env vars
    const result = resolveAiDefault(undefined, "cli", undefined);
    expect(result.ai).toBe(true);
    expect(result.source).toBe("cli_flag");
  });

  it("CLI surface source is 'cli_flag' (not 'env' — env signals agent context)", () => {
    const result = resolveAiDefault(undefined, "cli", undefined);
    // adversarial: if "env" is returned for cli, surface detection is broken
    expect(result.source).not.toBe("env");
    expect(result.source).toBe("cli_flag");
  });
});

describe("Surface detection — Agent surface (CLAUDECODE=1 / CI=true / LORE_AI_DEFAULT=off)", () => {
  it("Agent surface returns ai=false by default (suppress claude-on-claude nesting)", () => {
    // When CLAUDECODE=1 or CI=true, surface = "agent"
    // resolveAiDefault with "agent" surface should return false per spec
    const result = resolveAiDefault(undefined, "agent", undefined);
    expect(result.ai).toBe(false);
    expect(result.source).toBe("env");
  });

  it("Agent surface source is 'env' (not 'cli_flag' — distinguishes from human default)", () => {
    const result = resolveAiDefault(undefined, "agent", undefined);
    // adversarial: if "cli_flag" is returned, agent env detection is broken
    expect(result.source).not.toBe("cli_flag");
    expect(result.source).toBe("env");
  });

  it("Agent can explicitly opt in to AI (explicit_arg wins over surface default)", () => {
    // SPEC-024 AC-NOAI-5: agent passes --ai → AI should run even from agent surface
    const result = resolveAiDefault(true, "agent", undefined);
    expect(result.ai).toBe(true);
    expect(result.source).toBe("explicit_arg");
  });

  it("Agent explicit opt-in overrides config too (explicit_arg is tier 1)", () => {
    // Even if config says agent:false, explicit=true wins
    const result = resolveAiDefault(true, "agent", { agent: false });
    expect(result.ai).toBe(true);
    expect(result.source).toBe("explicit_arg");
  });
});

// ─── BOUNDARY — CLI vs agent surface produce opposite AI defaults ─────────────

describe("Surface detection — CLI vs Agent surface contrast", () => {
  it("cli and agent surfaces produce opposite ai defaults without explicit arg", () => {
    const cliDefault = resolveAiDefault(undefined, "cli", undefined);
    const agentDefault = resolveAiDefault(undefined, "agent", undefined);
    // The fundamental SPEC-024 invariant: these must differ
    expect(cliDefault.ai).toBe(true);
    expect(agentDefault.ai).toBe(false);
    expect(cliDefault.ai).not.toBe(agentDefault.ai);
  });

  it("explicit=false from cli mirrors agent default (both produce ai=false)", () => {
    // Verify that --no-ai from CLI matches the agent baseline
    const cliWithNoAi = resolveAiDefault(false, "cli", undefined);
    const agentDefault = resolveAiDefault(undefined, "agent", undefined);
    expect(cliWithNoAi.ai).toBe(false);
    expect(agentDefault.ai).toBe(false);
    // But sources MUST differ to preserve auditability
    expect(cliWithNoAi.source).toBe("explicit_arg");
    expect(agentDefault.source).toBe("env");
  });
});

// ─── ERROR — verify no fallback to ai=true when agent surface is detected ────

describe("Surface detection — no silent fallback to ai=true for agent", () => {
  it("agent surface without explicit MUST NOT return ai=true (no silent re-enable)", () => {
    // This is the core bug SPEC-024 was written to prevent:
    // if surface detection fails and falls back to cli, ai=true would leak through
    const result = resolveAiDefault(undefined, "agent", undefined);
    // Fail loudly if the surface is treated as cli
    expect(result.ai).toBe(false);
  });

  it("http_token surface without explicit MUST NOT return ai=true (API keys are agent-issued)", () => {
    const result = resolveAiDefault(undefined, "http_token", undefined);
    expect(result.ai).toBe(false);
  });
});
