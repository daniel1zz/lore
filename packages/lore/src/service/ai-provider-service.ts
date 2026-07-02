/**
 * AIProviderService — dispatch AI generation, render templates, emit telemetry.
 * Seventh stateless service in the service layer. All state lives in injected dependencies.
 *
 * Public surface:
 *   - AIProviderService class
 *     - activeProviderName: string (getter — read by CLI spinner)
 *     - generate(args) → Promise<Result<GenerateOutput, LoreError>>
 *
 * Invariants:
 *   - Stateless: every dependency is constructor-injected; no module-level state or globals
 *   - AI provider existence is guaranteed at construction (validated by buildProviderRegistry)
 *   - Telemetry is emitted on BOTH success and failure paths when aiTelemetryEnabled is true
 *   - Never throws — all errors from provider.generate() are forwarded as Result values
 *   - AIProviderService is constructed exclusively by app.ts (AC-AI-14)
 *
 * Side-effect class: IO (delegates to AIProvider.generate and Telemetry.emit)
 *
 * Source: SPEC-017 §3.6
 */

import type { AIProvider, DocType, GenerateOutput, LoreError, Telemetry } from "@lore/core";
import type { Result } from "@lore/core";
import type { CallerSurface, AiDefaultSource } from "@lore/core";
import { BUILT_IN_TEMPLATES, renderTemplate } from "../ai/templates.js";

// ─── AIProviderService ────────────────────────────────────────────────────────

/**
 * Stateless service that owns AI provider dispatch, template rendering, and telemetry.
 * Constructed once at createApp() time via the injected provider registry.
 *
 * @example
 * const svc = new AIProviderService(providers, "claude-cli", templates, telemetry, true);
 * const result = await svc.generate({ doc_type: "prd", title: "My PRD" });
 */
export class AIProviderService {
  constructor(
    /** Immutable provider map from buildProviderRegistry — keyed by provider name */
    private readonly providers: ReadonlyMap<string, AIProvider>,
    /** Active provider name — validated by registry before construction */
    private readonly active: string,
    /**
     * Per-doc-type template overrides from config.ai.templates.
     * Keys present here override BUILT_IN_TEMPLATES; absent keys fall back to built-in.
     */
    private readonly templates: Partial<Record<DocType, string>>,
    /** Telemetry sink — NoOpTelemetry when telemetry is disabled */
    private readonly telemetry: Telemetry,
    /** Whether to emit ai.generation events (config.ai.telemetry — independent kill switch) */
    private readonly aiTelemetryEnabled: boolean,
  ) {}

  /**
   * Active provider name. Exposed for CLI spinner ("⏳ Generating via <name>...").
   *
   * @returns Provider name as registered in the registry (e.g. "claude-cli")
   */
  get activeProviderName(): string {
    return this.active;
  }

  /**
   * Generate document content for the given doc type and title.
   *
   * Steps:
   *   1. Determine template source (user-override or built-in)
   *   2. Render the template with title + optional parent_title
   *   3. Dispatch to the active provider
   *   4. Emit ai.generation telemetry (if enabled) — on both success and failure
   *   5. Return the provider result
   *
   * @param args - Generation arguments
   * @param args.doc_type - DocType being created
   * @param args.title - Document title (interpolated into template as {{title}})
   * @param args.parent_title - Optional parent document title (for {{#parent_title}}…{{/parent_title}})
   * @param args.caller_surface - Surface that initiated the call (SPEC-024 AC-NOAI-8; included in telemetry)
   * @param args.ai_default_source - How the AI decision was resolved (SPEC-024 AC-NOAI-8; included in telemetry)
   * @returns Result<GenerateOutput, LoreError> — never throws
   *
   * @example
   * const result = await svc.generate({ doc_type: "spec", title: "Auth Flow", parent_title: "Security PRD" });
   * if (!result.ok) { console.error(result.error.message); return; }
   * console.log(result.value.content.slice(0, 80));
   *
   * @example
   * // SPEC-024: pass surface + source for telemetry
   * const result = await svc.generate({
   *   doc_type: "spec", title: "Auth Flow",
   *   caller_surface: "cli", ai_default_source: "cli_flag",
   * });
   */
  async generate(args: {
    doc_type: DocType;
    title: string;
    parent_title?: string;
    /**
     * Caller surface for telemetry (SPEC-024 AC-NOAI-8).
     * When provided, emitted in the ai.generation event as `caller_surface`.
     */
    caller_surface?: CallerSurface;
    /**
     * Source of the AI on/off decision for telemetry (SPEC-024 AC-NOAI-8).
     * When provided, emitted in the ai.generation event as `ai_default_source`.
     */
    ai_default_source?: AiDefaultSource;
  }): Promise<Result<GenerateOutput, LoreError>> {
    // Determine template source — user-override wins over built-in
    const userOverride = args.doc_type in this.templates;
    const tpl = this.templates[args.doc_type] ?? BUILT_IN_TEMPLATES[args.doc_type];

    // Render the prompt template with provided variables.
    // reason: exactOptionalPropertyTypes=true prohibits assigning undefined to optional prop.
    // Use conditional spread to only include parent_title when it is present.
    const prompt = renderTemplate(tpl, {
      title: args.title,
      ...(args.parent_title !== undefined ? { parent_title: args.parent_title } : {}),
    });

    // reason: provider existence guaranteed by buildProviderRegistry validation at createApp time;
    // non-null assertion is safe here (AC-AI-14 — service constructed only after registry ok).
    const provider = this.providers.get(this.active)!;

    const t0 = performance.now();
    const result = await provider.generate({
      prompt,
      doc_type: args.doc_type,
      title: args.title,
      ...(args.parent_title !== undefined ? { parent_title: args.parent_title } : {}),
    });
    const duration_ms = Math.round(performance.now() - t0);

    // Emit telemetry on both success and failure paths (when enabled)
    if (this.aiTelemetryEnabled) {
      this.telemetry.emit({
        event: "ai.generation",
        ts: new Date().toISOString(),
        provider: this.active,
        doc_type: args.doc_type,
        template_source: userOverride ? "user-override" : "built-in",
        duration_ms,
        output_chars: result.ok ? result.value.content.length : 0,
        exit_code: result.ok
          ? 0
          : result.error.code === "AI_PROVIDER_ERROR"
            ? (result.error.exit_code ?? -1)
            : -1,
        // reason: LoreError is a discriminated union — not all variants have a `message` field.
        // Only AI_PROVIDER_ERROR and STORE_ERROR and VALIDATION_ERROR do. Use type narrowing
        // to extract a display string that works for any error code.
        ...(result.ok
          ? {}
          : {
              error:
                "message" in result.error
                  ? result.error.message
                  : result.error.code,
            }),
        // SPEC-024 AC-NOAI-8: optional surface + source for AI default traceability
        ...(args.caller_surface !== undefined ? { caller_surface: args.caller_surface } : {}),
        ...(args.ai_default_source !== undefined ? { ai_default_source: args.ai_default_source } : {}),
        // SPEC-020 AC-HTTP-TEL-1: populate usage when the provider returns token counts.
        // HttpAIProvider always populates usage on success; ClaudeCliProvider never does.
        // reason: usage is omitted from the spread when absent (not set to undefined) to
        // keep the strict aiGenerationEventSchema happy — undefined optional fields are
        // valid in Zod, but omitting them produces cleaner JSONL output for downstream consumers.
        ...(result.ok && result.value.usage !== undefined
          ? { usage: result.value.usage }
          : {}),
      });
    }

    return result;
  }
}
