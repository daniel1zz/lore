/**
 * HTTP AI provider — POSTs to an Anthropic Messages API endpoint and returns the
 * generated text content. Implements the same AIProvider interface as ClaudeCliProvider,
 * enabling transparent provider switching via ai.provider config (SPEC-020).
 *
 * Public surface:
 *   - ResolvedHttpConfig — AiHttpConfig with headers values already substituted from env
 *   - HttpAIProvider — class implementing AIProvider via fetch() + AbortController
 *
 * Invariants:
 *   - All ${ENV_VAR} patterns in headers are resolved BEFORE the constructor is called;
 *     buildProviderRegistry calls resolveEnvInHeaders at createApp() time (AC-HTTP-3).
 *     The constructor never reads process.env — env resolution is a caller responsibility.
 *   - Never throws — all errors wrapped in err({ code: "AI_PROVIDER_ERROR", ... })
 *   - Uses the global fetch() (Web standard, available in Bun); does NOT use Bun.fetch
 *   - Response body is validated via aiHttpResponseSchema.safeParse() before extraction;
 *     schema mismatch → AI_PROVIDER_ERROR (not a thrown ZodError)
 *   - Token/secret values from resolved headers MUST NOT appear in error messages (D-004)
 *
 * Side-effect class: IO (fetch(), AbortController, performance.now())
 *
 * Source: SPEC-020 §9.3, §9.4, §9.5 (AC-HTTP-4 through AC-HTTP-8, AC-HTTP-CORE-1)
 */

import { ok, err, aiHttpResponseSchema } from "@lore/core";
import type { AIProvider, AiHttpConfig, GenerateInput, GenerateOutput, LoreError } from "@lore/core";
import type { Result } from "@lore/core";

// ─── ResolvedHttpConfig ───────────────────────────────────────────────────────

/**
 * AiHttpConfig with all `${ENV_VAR}` header values replaced with their concrete env values.
 * Produced by buildProviderRegistry after calling resolveEnvInHeaders.
 *
 * Using a type alias rather than a separate Zod schema because the shape is identical to
 * AiHttpConfig (same fields, same types) — only the semantic guarantee differs:
 * headers values are concrete strings with no `${...}` patterns remaining.
 *
 * @invariant headers values contain NO `${...}` patterns — all were resolved at createApp() time
 */
export type ResolvedHttpConfig = AiHttpConfig;

// ─── HttpAIProvider ───────────────────────────────────────────────────────────

/**
 * HTTP-backed AI provider. Posts an Anthropic Messages API request and extracts
 * `content[0].text` from the validated JSON response (SPEC-020 §9.3, §9.4).
 *
 * Wire format: Anthropic Messages v1 (hardcoded per SPEC-020 §8 Q1 ratification).
 * OpenAI wire format is deferred to SPEC-020.1.
 *
 * Failure surface (all return err({ code: "AI_PROVIDER_ERROR" })):
 *   - Network timeout > cfg.timeout_ms (AC-HTTP-6)
 *   - HTTP 4xx / 5xx (AC-HTTP-5)
 *   - Response body not valid JSON (AC-HTTP-7)
 *   - Response schema mismatch via aiHttpResponseSchema (AC-HTTP-7)
 *   - content[0].text empty or whitespace-only (AC-HTTP-8)
 *
 * @example
 * const provider = new HttpAIProvider("http", resolvedConfig);
 * const result = await provider.generate({ prompt: "Write a PRD…", doc_type: "prd", title: "X" });
 * if (result.ok) console.log(result.value.content);
 */
export class HttpAIProvider implements AIProvider {
  constructor(
    /** Registry key — returned in GenerateOutput.provider_name */
    public readonly name: string,
    /**
     * Resolved HTTP config. All `${ENV_VAR}` header values have been replaced with concrete
     * strings by buildProviderRegistry before this constructor is called (AC-HTTP-3).
     */
    private readonly cfg: ResolvedHttpConfig,
  ) {}

  /**
   * POST the prompt to the configured Anthropic Messages endpoint.
   *
   * Follows the Anthropic Messages v1 wire format (SPEC-020 §9.3):
   *   - Request: POST { model, max_tokens, messages: [{role:"user", content: prompt}] }
   *   - Response: validated via aiHttpResponseSchema; content[0].text extracted
   *
   * @param input - Validated generate input from AIProviderService (prompt already rendered)
   * @returns Result<GenerateOutput, LoreError> with usage field populated — never throws
   */
  async generate(input: GenerateInput): Promise<Result<GenerateOutput, LoreError>> {
    const t0 = performance.now();

    // AbortController for network timeout (AC-HTTP-6)
    // reason: AbortController is the Web-standard mechanism for cancelling a fetch() call.
    // Bun honours AbortSignal on fetch — verified at SPEC-020 §6 Q6 ratification.
    // The timer id is always cleared (success or failure) to prevent stale-timer leaks.
    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), this.cfg.timeout_ms);

    // Anthropic Messages request body (SPEC-020 §9.3)
    const requestBody = {
      model: this.cfg.model,
      max_tokens: this.cfg.max_tokens,
      messages: [{ role: "user" as const, content: input.prompt }],
    };

    let response: Response;
    try {
      response = await fetch(this.cfg.url, {
        method: "POST",
        headers: {
          // reason: "content-type" must come before user-supplied headers so that a user
          // can override it (unlikely but semantically correct HTTP behaviour).
          "content-type": "application/json",
          ...this.cfg.headers,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } catch (fetchError) {
      clearTimeout(timeoutTimer);
      // reason: AbortError is the DOM-standard DOMException thrown by fetch() when the
      // AbortController signals abort (e.g. timeout). Bun throws name="AbortError".
      // The word "timeout" MUST appear literally in the message so AC-HTTP-6 assertions
      // and monitoring tooling can detect timeouts by string match rather than numeric codes.
      const isTimeout =
        fetchError instanceof Error &&
        (fetchError.name === "AbortError" || fetchError.name === "TimeoutError");

      return err({
        code: "AI_PROVIDER_ERROR",
        provider: this.name,
        message: isTimeout
          ? `provider "${this.name}" timeout: fetch aborted after ${this.cfg.timeout_ms}ms`
          : `provider "${this.name}" network error: ${
              fetchError instanceof Error ? fetchError.message : String(fetchError)
            }`,
        exit_code: -1,
      });
    }
    clearTimeout(timeoutTimer);

    const duration_ms = Math.round(performance.now() - t0);

    // Handle HTTP 4xx / 5xx (AC-HTTP-5)
    // reason: response.ok covers 200–299; any other 2xx that isn't body-readable is extremely
    // rare with Anthropic, but guarding response.ok is the correct semantic check.
    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      return err({
        code: "AI_PROVIDER_ERROR",
        provider: this.name,
        // reason: truncate body at 1024 chars to keep LoreError payloads bounded (mirrors
        // ClaudeCliProvider stderr truncation). status is included for rapid triage.
        message: `provider "${this.name}" HTTP ${response.status}: ${bodyText.slice(0, 1024)}`,
        exit_code: -1,
      });
    }

    // Parse JSON response body (AC-HTTP-7)
    // reason: response.json() throws SyntaxError on non-JSON bodies. We catch it and
    // return AI_PROVIDER_ERROR with "response parse" in the message so the telemetry
    // error field carries the same literal for log-based alerting.
    let rawJson: unknown;
    try {
      rawJson = await response.json();
    } catch {
      return err({
        code: "AI_PROVIDER_ERROR",
        provider: this.name,
        message: `provider "${this.name}" response parse: response body is not valid JSON`,
        exit_code: -1,
      });
    }

    // Validate response shape via Zod (AC-HTTP-7, AC-HTTP-CORE-1)
    // reason: safeParse (not parse) so that ZodError never escapes as an exception.
    // The first issue's path is included in the error message for rapid diagnosis.
    const parsed = aiHttpResponseSchema.safeParse(rawJson);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      const issuePath = firstIssue?.path.join(".") ?? "unknown";
      const issueMessage = firstIssue?.message ?? "unknown validation error";
      return err({
        code: "AI_PROVIDER_ERROR",
        provider: this.name,
        message: `provider "${this.name}" response schema mismatch at '${issuePath}': ${issueMessage}`,
        exit_code: -1,
      });
    }

    // Extract content text from the first content block (AC-HTTP-8)
    // reason: aiHttpResponseSchema enforces content.min(1) and content[0].type === "text",
    // so firstBlock is guaranteed to exist and have a `text` field after safeParse succeeds.
    const firstBlock = parsed.data.content[0]!;
    const text = firstBlock.text;

    if (text.trim() === "") {
      // reason: mirrors ClaudeCliProvider's "empty output" check (SPEC-017 AC-AI-7)
      // so that AIProviderService telemetry records output_chars: 0 on both providers.
      return err({
        code: "AI_PROVIDER_ERROR",
        provider: this.name,
        message: `provider "${this.name}" produced empty output`,
        exit_code: -1,
      });
    }

    // Build GenerateOutput — populate usage for telemetry (AC-HTTP-TEL-1)
    // reason: stop_reason lives at the top level of the Anthropic response, NOT inside usage.
    // We merge it into the usage object for a consistent telemetry shape (SPEC-020 §8 Q4).
    // reason: exactOptionalPropertyTypes=true prohibits assigning `undefined` to optional fields.
    // Use conditional spread at both the `usage` level and the `stop_reason` level to omit the
    // property entirely when absent, rather than setting it to undefined.
    return ok({
      content: text,
      duration_ms,
      exit_code: 0,
      provider_name: this.name,
      ...(parsed.data.usage !== undefined
        ? {
            usage: {
              input_tokens: parsed.data.usage.input_tokens,
              output_tokens: parsed.data.usage.output_tokens,
              // stop_reason from top-level Anthropic response (not from usage sub-object)
              ...(parsed.data.stop_reason !== undefined
                ? { stop_reason: parsed.data.stop_reason }
                : {}),
            },
          }
        : {}),
    });
  }
}
