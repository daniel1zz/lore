/**
 * Pure AI default resolution — SPEC-024 §9.3.
 *
 * Public surface:
 *   - BUILT_IN_AI_DEFAULTS — immutable per-surface defaults
 *   - resolveAiDefault(explicit, surface, configDefaults?) → {ai, source}
 *   - isAssessAiBraked(resolved) → boolean (SPEC-026 D5)
 *
 * Invariants:
 *   - Pure function: no IO, no side effects
 *   - Always returns a non-null {ai, source} pair
 *   - Precedence: explicit_arg > config > env/cli_flag (built-in)
 *
 * Side-effect class: pure
 *
 * Source: SPEC-024 §9.3, SPEC-026 §3 D5
 */

import type { CallerSurface, AiDefaultSource } from "@lore/core";
import type { AiDefaultPerSurface } from "@lore/core";

// ─── Built-in Per-Surface Defaults ───────────────────────────────────────────

/**
 * Immutable built-in AI defaults per caller surface.
 * Human-facing surfaces (cli, http_cookie) default AI on.
 * Agent/automation surfaces (agent, mcp, http_token) default AI off.
 *
 * Source: SPEC-024 §9.3 builtIn map
 */
export const BUILT_IN_AI_DEFAULTS: Readonly<Record<CallerSurface, boolean>> = {
  cli: true,
  agent: false,
  mcp: false,
  http_cookie: true,
  http_token: false,
} as const;

// ─── resolveAiDefault ─────────────────────────────────────────────────────────

/**
 * Resolve whether AI generation should run for a given call, and identify
 * the source of that decision for telemetry.
 *
 * Precedence (highest to lowest):
 *   1. explicit_arg — caller passed --ai / --no-ai (or ai: true/false in MCP args)
 *   2. config       — ai.default_per_surface[surface] set in config.yaml
 *   3. built-in     — BUILT_IN_AI_DEFAULTS[surface]
 *      - "cli_flag" for human surfaces (cli, http_cookie) — AI on by default
 *      - "env"      for agent surfaces (agent, mcp, http_token) — AI off by default
 *
 * @param explicit - Explicit caller opt-in/out. undefined = use surface default.
 * @param surface  - Caller surface determined by the adapter at startup.
 * @param configDefaults - Optional per-surface overrides from ai.default_per_surface.
 * @returns {ai, source} — whether AI should run and why.
 *
 * @example
 * resolveAiDefault(undefined, "cli", undefined)
 * // → {ai: true, source: "cli_flag"}  — human CLI, no override
 *
 * @example
 * resolveAiDefault(undefined, "agent", undefined)
 * // → {ai: false, source: "env"}  — CLAUDECODE=1 classified as agent
 *
 * @example
 * resolveAiDefault(true, "agent", undefined)
 * // → {ai: true, source: "explicit_arg"}  — agent explicitly passed --ai
 *
 * @example
 * resolveAiDefault(undefined, "cli", { cli: false })
 * // → {ai: false, source: "config"}  — config override
 *
 * Source: SPEC-024 §9.3
 */
export function resolveAiDefault(
  explicit: boolean | undefined,
  surface: CallerSurface,
  configDefaults?: AiDefaultPerSurface,
): { ai: boolean; source: AiDefaultSource } {
  // Tier 1: explicit caller argument overrides everything
  if (explicit !== undefined) {
    return { ai: explicit, source: "explicit_arg" };
  }

  // Tier 2: config.ai.default_per_surface[surface] when set
  const fromConfig = configDefaults?.[surface];
  if (fromConfig !== undefined) {
    return { ai: fromConfig, source: "config" };
  }

  // Tier 3: built-in defaults
  const builtIn = BUILT_IN_AI_DEFAULTS[surface];
  // reason: source naming reflects the decision mechanism (SPEC-024 §9.3):
  // - human surfaces (cli, http_cookie) default AI on — the "cli_flag" source signals
  //   that the absence of --no-ai is what left AI enabled (it's always been the default).
  // - agent surfaces (agent, mcp, http_token) default AI off — the "env" source signals
  //   that env-var-based surface classification (CLAUDECODE=1, CI, LORE_AI_DEFAULT) drove
  //   the decision. MCP/HTTP token surfaces are classified agent-like.
  const source: AiDefaultSource =
    surface === "cli" || surface === "http_cookie" ? "cli_flag" : "env";
  return { ai: builtIn, source };
}

// ─── isAssessAiBraked (SPEC-026 D5) ──────────────────────────────────────────

/**
 * Determine whether `lore assess` is config-braked for the current surface.
 *
 * Unlike every other AI mutation (`create --ai`, `set --regenerate`/`--refine`), `assess`
 * has no non-AI mode — the command name IS the AI intent (SPEC-026 §3 D5). This means the
 * built-in per-surface false default (agent/mcp/http_token — see {@link BUILT_IN_AI_DEFAULTS})
 * must NOT block assess; only an EXPLICIT `ai.default_per_surface.<surface> = false` config
 * override should require the caller to pass `--ai` / `ai: true`.
 *
 * Callers pass the result of `resolveAiDefault(undefined, surface, configDefaults)` — the
 * "config" source discriminator is exactly the signal that a config override (not a
 * built-in) drove the false decision, so no extra config plumbing is needed here.
 *
 * @param resolved - Result of `resolveAiDefault(undefined, surface, configDefaults)`
 * @returns true iff assess should require an explicit AI opt-in for this call
 *
 * @example
 * isAssessAiBraked(resolveAiDefault(undefined, "mcp", undefined))
 * // → false — mcp's built-in default (off) does not brake assess
 *
 * @example
 * isAssessAiBraked(resolveAiDefault(undefined, "mcp", { mcp: false }))
 * // → true — explicit config override braked
 */
export function isAssessAiBraked(resolved: { ai: boolean; source: AiDefaultSource }): boolean {
  return resolved.source === "config" && !resolved.ai;
}
