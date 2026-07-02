/**
 * Env-var interpolation helper for HTTP AI provider headers.
 * Resolves `${ENV_VAR}` references in a headers map against a supplied env object.
 * Called by buildProviderRegistry at createApp() time (not at request time) to enforce
 * AC-HTTP-3: missing or empty env vars fail loud at startup, never at request time.
 *
 * Public surface:
 *   - resolveEnvInHeaders(headers, env) → Result<Record<string,string>, LoreError>
 *
 * Invariants:
 *   - Only values that match the EXACT pattern `^\$\{[A-Z_][A-Z0-9_]*\}$` are substituted;
 *     partial matches (e.g. "prefix_${VAR}") are treated as literal strings
 *   - Literal values (not matching the pattern) pass through unchanged
 *   - An empty resolved env var is treated as unset → VALIDATION_ERROR
 *   - The env var NAME (e.g. "ANTHROPIC_API_KEY") appears in the error field path and message;
 *     the actual token VALUE never appears in errors, logs, or telemetry (D-004)
 *
 * Side-effect class: pure (reads the supplied env map; no IO, no process.env direct access)
 *
 * Source: SPEC-020 §2.1, §8 Q3, §9.2 (D-004 — env-var NAME in config, never plaintext)
 */

import { ok, err } from "@lore/core";
import type { LoreError, Result } from "@lore/core";

// ─── Env-Var Pattern ──────────────────────────────────────────────────────────

/**
 * Regex that matches a header value which is entirely an env-var reference.
 * Pattern: `^\$\{([A-Z_][A-Z0-9_]*)\}$`
 * Capturing group 1: the variable name (e.g. "ANTHROPIC_API_KEY").
 *
 * @invariant Only full-value matches are substituted — "prefix_${VAR}" is NOT matched.
 * @invariant Variable names must start with a letter or underscore, then letters/digits/underscores.
 *   This mirrors the SPEC-020 §9.2 pattern and avoids matching shell-expansion edge cases.
 */
const ENV_VAR_PATTERN = /^\$\{([A-Z_][A-Z0-9_]*)\}$/;

// ─── resolveEnvInHeaders ──────────────────────────────────────────────────────

/**
 * Resolve `${ENV_VAR}` references in a headers map.
 *
 * Each header value is checked against the pattern `^\$\{([A-Z_][A-Z0-9_]*)\}$`.
 * Values that match are replaced with the corresponding environment variable value.
 * Values that do not match are passed through as-is.
 *
 * Fails fast on the first missing or empty env var with VALIDATION_ERROR:
 *   - `field` contains the full path (e.g. "ai.http.headers.x-api-key")
 *   - `message` names the env var by name (NOT its value — D-004)
 *
 * @param headers - Raw headers record from AiHttpConfig (may contain `${VAR}` values)
 * @param env - Environment map to resolve against (pass `process.env` in production)
 * @returns Result wrapping the resolved headers map — never throws
 *
 * @example
 * // Success: env var is set
 * const result = resolveEnvInHeaders(
 *   { "x-api-key": "${ANTHROPIC_API_KEY}", "anthropic-version": "2023-06-01" },
 *   { ANTHROPIC_API_KEY: "sk-ant-..." },
 * );
 * // result.ok === true
 * // result.value === { "x-api-key": "sk-ant-...", "anthropic-version": "2023-06-01" }
 *
 * @example
 * // Failure: env var unset
 * const result = resolveEnvInHeaders({ "x-api-key": "${MISSING_VAR}" }, {});
 * // result.ok === false
 * // result.error.code === "VALIDATION_ERROR"
 * // result.error.field === "ai.http.headers.x-api-key"
 * // result.error.message includes "MISSING_VAR" (the name, NOT any value)
 */
export function resolveEnvInHeaders(
  headers: Record<string, string>,
  env: NodeJS.ProcessEnv,
): Result<Record<string, string>, LoreError> {
  const resolved: Record<string, string> = {};

  for (const [headerKey, headerValue] of Object.entries(headers)) {
    const match = ENV_VAR_PATTERN.exec(headerValue);
    if (match === null) {
      // Literal value — not an env-var reference; pass through unchanged
      resolved[headerKey] = headerValue;
      continue;
    }

    // headerValue is of the form "${VAR_NAME}" — resolve from env
    const varName = match[1]!; // guaranteed by the capture group in ENV_VAR_PATTERN
    const envValue = env[varName];

    // Empty string is treated as unset — avoids silently accepting a misconfigured env
    if (!envValue) {
      return err({
        code: "VALIDATION_ERROR",
        field: `ai.http.headers.${headerKey}`,
        // reason: message names the env var by name (not value) per D-004 secret policy.
        // The token value (e.g. the API key) MUST NOT appear in any error output.
        message:
          `Header '${headerKey}' references env var '${varName}' which is not set or empty. ` +
          `Set ${varName} in your shell environment before starting lore.`,
        value: headerValue, // safe: this is the "${VAR_NAME}" string, not the secret value
      });
    }

    resolved[headerKey] = envValue;
  }

  return ok(resolved);
}
