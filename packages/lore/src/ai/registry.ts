/**
 * AI provider registry — builds the runtime provider map from AiConfig.
 * Called once at createApp() time; the resulting map is immutable for the App lifetime.
 *
 * Public surface:
 *   - BUILT_IN_PROVIDER_CONFIGS — default CLI provider configs (hard-coded; not user-editable)
 *   - mergeProviderConfigs(userProviders) — pure built-in + user-override merge (replace-not-merge)
 *   - validateMergedProviderEntry(name, cfg) — pure per-entry command/args presence check (SPEC-067 D2)
 *   - buildProviderRegistry(config, env?) → Result<{providers, active}, LoreError>
 *
 * Invariants:
 *   - Built-in "claude-cli" is always seeded; user entries in config.providers REPLACE whole records
 *     (no deep-merge — reason: avoids partial-override surprises; user owns the full entry or none)
 *   - SPEC-067 D2: every merged CLI-provider entry MUST have a non-empty `command` and a present
 *     `args` array BEFORE any provider is constructed — a partial entry (e.g. only `timeout_ms`)
 *     fails loud with VALIDATION_ERROR naming the config key, not silently accepted and left to
 *     fail later at first generate() call. This is defense-in-depth: `AiProviderConfigSchema`
 *     already requires `command` for configs that flow through `AiConfigSchema.parse()`, but
 *     `buildProviderRegistry` accepts a plain `AiConfig` object and must not assume the caller
 *     always validated it that way.
 *   - When config.provider === "http", HttpAIProvider is constructed; ClaudeCliProvider is NOT loaded
 *   - env-var interpolation in ai.http.headers is resolved here (resolveEnvInHeaders) so that
 *     missing env vars fail loud at startup (AC-HTTP-3), not at first generate() call
 *   - Unknown config.provider name → STORE_ERROR (fail loud, AC-AI-11)
 *   - Returns a ReadonlyMap — no mutation after construction
 *   - env parameter defaults to process.env — pass a mock env in tests for isolation
 *
 * Side-effect class: pure (no IO; provider construction is synchronous + side-effect-free)
 *
 * Source: SPEC-017 §3.5, SPEC-020 §9 (HttpAIProvider wiring), SPEC-067 D1/D2
 */

import { ok, err } from "@lore/core";
import type { AIProvider, AiConfig, AiProviderConfig, LoreError } from "@lore/core";
import type { Result } from "@lore/core";
import { ClaudeCliProvider } from "./claude-cli-provider.js";
import { HttpAIProvider } from "./http-provider.js";
import { resolveEnvInHeaders } from "./env-resolve.js";

// ─── Built-in Provider Defaults ───────────────────────────────────────────────

/**
 * Hard-coded default configs for built-in providers.
 * Users may override these via .lore/config.yaml → ai.providers.<name>.
 *
 * @invariant "claude-cli" MUST always be present here — it is the default active provider.
 * @invariant timeout_ms 180_000 (SPEC-067 D1) — a real `lore assess` judge round measures
 *   ~73s under normal load; this literal is the actual value used at runtime (this object
 *   is NOT passed through AiProviderConfigSchema.parse(), so it must independently match
 *   the schema's own default — see ai.ts's AiProviderConfigSchema.timeout_ms).
 */
export const BUILT_IN_PROVIDER_CONFIGS: Record<string, AiProviderConfig> = {
  "claude-cli": {
    command: "claude",
    // --setting-sources project: skip user-global settings (hooks / CLAUDE.md / stop-review
    // chain) that would otherwise inject Claude Code session output into stdout, while keeping
    // keychain auth and project-local CLAUDE.md intact. See SPEC-017 §3.5.
    args: ["-p", "--setting-sources", "project"],
    timeout_ms: 180_000,
  },
};

// ─── Merge + Validation Helpers (SPEC-067 D2) ─────────────────────────────────

/**
 * Merge built-in provider configs with user overrides.
 * Replace-not-merge semantics (SPEC-017 §3.5, deliberate — see module header): a key present
 * in `userProviders` REPLACES the built-in entry of the same name wholesale, it does not
 * deep-merge fields. This is a pure, standalone extraction of the merge step so it is
 * independently unit-testable from the validation and provider-construction steps.
 *
 * @param userProviders - `config.providers` from a resolved AiConfig (may be `{}`)
 * @returns Merged map: every built-in key, overridden by any same-named user entry, plus any
 *   user-only provider names.
 *
 * @example
 * mergeProviderConfigs({ "claude-cli": { command: "x", args: [], timeout_ms: 300_000 } });
 * // → { "claude-cli": { command: "x", args: [], timeout_ms: 300_000 } }
 */
export function mergeProviderConfigs(
  userProviders: Record<string, AiProviderConfig>,
): Record<string, AiProviderConfig> {
  return { ...BUILT_IN_PROVIDER_CONFIGS, ...userProviders };
}

/**
 * Validate a single merged CLI-provider entry has everything ClaudeCliProvider needs to spawn:
 * a non-empty `command` and a present `args` array. Pure — no IO, never throws.
 *
 * @invariant This is defense-in-depth against a caller that bypassed `AiConfigSchema.parse()`
 *   (which already requires `command` for schema-validated configs) — `buildProviderRegistry`
 *   accepts a plain `AiConfig` object and must not assume it was schema-validated first.
 * @param name - The provider's registry key (e.g. "claude-cli") — echoed into the error.
 * @param cfg - The merged config entry to validate.
 * @returns `undefined` when valid; a `VALIDATION_ERROR` LoreError otherwise — naming the
 *   offending `ai.providers.<name>` key, stating the replace-not-merge rule, and echoing a
 *   complete pasteable minimal entry (command + args + timeout_ms).
 *
 * @example
 * validateMergedProviderEntry("claude-cli", { timeout_ms: 300_000 } as AiProviderConfig);
 * // → { code: "VALIDATION_ERROR", field: "ai.providers.claude-cli", message: "..." }
 */
export function validateMergedProviderEntry(
  name: string,
  cfg: AiProviderConfig,
): LoreError | undefined {
  const hasCommand = typeof cfg?.command === "string" && cfg.command.trim().length > 0;
  const hasArgs = Array.isArray(cfg?.args);
  if (hasCommand && hasArgs) {
    return undefined;
  }

  const exampleTimeout = typeof cfg?.timeout_ms === "number" ? cfg.timeout_ms : 180_000;
  return {
    code: "VALIDATION_ERROR",
    field: `ai.providers.${name}`,
    message:
      `ai.providers.${name} is missing "command" and/or "args". ` +
      `Entries under ai.providers.<name> REPLACE the built-in provider definition entirely ` +
      `(no deep-merge) — a partial entry like { timeout_ms: ... } loses command and args, ` +
      `so the provider cannot be built. Provide a complete entry, e.g.:\n` +
      `ai:\n  providers:\n    ${name}:\n      command: "claude"\n      args: ["-p"]\n      timeout_ms: ${exampleTimeout}`,
  };
}

// ─── Registry Builder ─────────────────────────────────────────────────────────

/**
 * Build the immutable provider registry from the resolved AiConfig.
 *
 * Algorithm:
 *   1. Merge CLI built-in defaults with user config.providers (user entries REPLACE whole records)
 *   2. Construct a ClaudeCliProvider for each merged CLI entry
 *   3. If config.provider === "http": resolve env-var headers (fail loud on missing var),
 *      then construct and register HttpAIProvider (AC-HTTP-1, AC-HTTP-3)
 *   4. Validate that config.provider is a known key in the merged map (AC-AI-11)
 *   5. Return ok({ providers: ReadonlyMap, active: string })
 *
 * On unknown active provider → STORE_ERROR (AC-AI-11). This surfaces via createApp() before
 * any command runs — no partial startup, no silently wrong provider.
 *
 * On missing/empty env var referenced in ai.http.headers → VALIDATION_ERROR (AC-HTTP-3).
 * This also surfaces at createApp() time via the same Result propagation path.
 *
 * @param config - Resolved AiConfig (from AiConfigSchema.parse() — always has defaults filled)
 * @param env - Environment map to resolve ${VAR} header references (default: process.env).
 *   Pass a mock object in tests to avoid reading real env vars.
 * @returns Result<{ providers, active }> where providers is immutable after return
 *
 * @example
 * const result = buildProviderRegistry(AiConfigSchema.parse({}));
 * // result.ok === true, result.value.active === "claude-cli"
 *
 * @example
 * const result = buildProviderRegistry(AiConfigSchema.parse({ provider: "unknown" }));
 * // result.ok === false, result.error.code === "STORE_ERROR"
 *
 * @example
 * // HTTP provider with env-var resolution
 * const result = buildProviderRegistry(
 *   AiConfigSchema.parse({
 *     provider: "http",
 *     http: { url: "https://api.anthropic.com/v1/messages", headers: { "x-api-key": "${ANTHROPIC_API_KEY}" } },
 *   }),
 *   { ANTHROPIC_API_KEY: "sk-ant-..." }, // mock env in tests
 * );
 * // result.ok === true, result.value.active === "http"
 */
export function buildProviderRegistry(
  config: AiConfig,
  env: NodeJS.ProcessEnv = process.env,
): Result<{ providers: ReadonlyMap<string, AIProvider>; active: string }, LoreError> {
  // Merge: built-in CLI defaults first, then user overrides replace whole entries (not deep-merge)
  // reason: whole-record replacement avoids surprising partial-override semantics where
  // a user entry with only `command:` would silently inherit a different `timeout_ms`.
  const merged = mergeProviderConfigs(config.providers);

  // SPEC-067 D2: validate every merged entry BEFORE constructing any provider — a partial
  // entry fails loud here, not later at first generate() call. Validating the whole map
  // up front (rather than inline in the construction loop below) guarantees no provider is
  // half-built when an error is returned.
  for (const [name, cfg] of Object.entries(merged)) {
    const validationError = validateMergedProviderEntry(name, cfg);
    if (validationError) {
      return err(validationError);
    }
  }

  const providers = new Map<string, AIProvider>();

  // Register all CLI providers (ClaudeCliProvider for each merged entry)
  for (const [name, cfg] of Object.entries(merged)) {
    providers.set(name, new ClaudeCliProvider(name, cfg));
  }

  // Register HTTP provider if the active provider is "http" (SPEC-020 AC-HTTP-1)
  // reason: HttpAIProvider is only constructed when explicitly requested — avoids loading
  // HTTP config or performing env-var resolution for users running claude-cli only.
  if (config.provider === "http") {
    // Belt-and-suspenders: AiConfigSchema.superRefine already rejects provider="http" without
    // http config at Zod parse time (AC-HTTP-2), but we guard here to satisfy TypeScript
    // narrowing and provide a clear error if the schema check is somehow bypassed.
    if (config.http === undefined) {
      return err({
        code: "VALIDATION_ERROR",
        field: "ai.http",
        message:
          "ai.http config is required when ai.provider is 'http'. " +
          "Add ai.http.url (and ai.http.headers with ${ENV_VAR} for auth) to your .lore/config.yaml.",
      });
    }

    // Resolve ${ENV_VAR} in headers at registry-build time (AC-HTTP-3)
    // reason: fail loud at startup so the user sees the missing-env error before any
    // document generation is attempted. resolveEnvInHeaders never reads process.env directly —
    // it receives the env map as a parameter for test isolation.
    const headersResult = resolveEnvInHeaders(config.http.headers, env);
    if (!headersResult.ok) {
      return headersResult;
    }

    providers.set(
      "http",
      new HttpAIProvider("http", {
        ...config.http,
        headers: headersResult.value,
      }),
    );
  }

  // Validate that the requested active provider was registered (AC-AI-11)
  if (!providers.has(config.provider)) {
    return err({
      code: "STORE_ERROR",
      message: `Unknown ai.provider '${config.provider}'. Known: ${[...providers.keys()].join(", ")}`,
    });
  }

  return ok({ providers: providers as ReadonlyMap<string, AIProvider>, active: config.provider });
}
