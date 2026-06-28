/**
 * AI provider registry — builds the runtime provider map from AiConfig.
 * Called once at createApp() time; the resulting map is immutable for the App lifetime.
 *
 * Public surface:
 *   - BUILT_IN_PROVIDER_CONFIGS — default provider configs (hard-coded; not user-editable)
 *   - buildProviderRegistry(config) → Result<{providers, active}, LoreError>
 *
 * Invariants:
 *   - Built-in "claude-cli" is always seeded; user entries in config.providers REPLACE whole records
 *     (no deep-merge — reason: avoids partial-override surprises; user owns the full entry or none)
 *   - Unknown config.provider name → STORE_ERROR (fail loud, AC-AI-11)
 *   - v1: all registered providers use ClaudeCliProvider (CLI-spawn); future SPECs add discriminator
 *   - Returns a ReadonlyMap — no mutation after construction
 *
 * Side-effect class: pure (no IO; ClaudeCliProvider construction is synchronous + side-effect-free)
 *
 * Source: SPEC-017 §3.5
 */

import { ok, err } from "@lore/core";
import type { AIProvider, AiConfig, AiProviderConfig, LoreError } from "@lore/core";
import type { Result } from "@lore/core";
import { ClaudeCliProvider } from "./claude-cli-provider.js";

// ─── Built-in Provider Defaults ───────────────────────────────────────────────

/**
 * Hard-coded default configs for built-in providers.
 * Users may override these via .lore/config.yaml → ai.providers.<name>.
 *
 * @invariant "claude-cli" MUST always be present here — it is the default active provider.
 */
const BUILT_IN_PROVIDER_CONFIGS: Record<string, AiProviderConfig> = {
  "claude-cli": {
    command: "claude",
    args: ["-p"],
    timeout_ms: 60_000,
  },
};

// ─── Registry Builder ─────────────────────────────────────────────────────────

/**
 * Build the immutable provider registry from the resolved AiConfig.
 *
 * Algorithm:
 *   1. Merge: built-in defaults first, then user entries REPLACE (not deep-merge) per key
 *   2. Construct a ClaudeCliProvider for each merged entry (v1: all providers are CLI-spawn)
 *   3. Validate that config.provider is a known key in the merged map
 *   4. Return ok({ providers: ReadonlyMap, active: string })
 *
 * On unknown active provider → STORE_ERROR (AC-AI-11). This surfaces via createApp() before
 * any command runs — no partial startup, no silently wrong provider.
 *
 * @param config - Resolved AiConfig (from AiConfigSchema.parse() — always has defaults filled)
 * @returns Result<{ providers, active }> where providers is immutable after return
 *
 * @example
 * const result = buildProviderRegistry(AiConfigSchema.parse({}));
 * // result.ok === true, result.value.active === "claude-cli"
 *
 * @example
 * const result = buildProviderRegistry(AiConfigSchema.parse({ provider: "unknown" }));
 * // result.ok === false, result.error.code === "STORE_ERROR"
 */
export function buildProviderRegistry(
  config: AiConfig,
): Result<{ providers: ReadonlyMap<string, AIProvider>; active: string }, LoreError> {
  // Merge: built-in defaults first, then user overrides replace whole entries (not deep-merge)
  // reason: whole-record replacement avoids surprising partial-override semantics where
  // a user entry with only `command:` inherits a different `timeout_ms` silently.
  const merged: Record<string, AiProviderConfig> = {
    ...BUILT_IN_PROVIDER_CONFIGS,
    ...config.providers,
  };

  // v1: all known provider entries use ClaudeCliProvider (CLI-spawning).
  // future SPEC will introduce a kind discriminator for HTTP providers.
  const providers = new Map<string, AIProvider>();
  for (const [name, cfg] of Object.entries(merged)) {
    providers.set(name, new ClaudeCliProvider(name, cfg));
  }

  // Validate that the requested active provider was registered
  if (!providers.has(config.provider)) {
    return err({
      code: "STORE_ERROR",
      message: `Unknown ai.provider '${config.provider}'. Known: ${[...providers.keys()].join(", ")}`,
    });
  }

  return ok({ providers: providers as ReadonlyMap<string, AIProvider>, active: config.provider });
}
