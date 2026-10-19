/**
 * AI provider contract for @lore/core.
 * Pure types and Zod schemas — NO IO, NO Bun.* imports (SPEC-017 §3.2, §3.3, AC-AI-13).
 *
 * Public surface:
 *   - DocTypeSchema — Zod enum matching DocType union (re-exported from schemas.ts for tester discoverability)
 *   - GenerateInputSchema / GenerateInput — validated input to AI provider
 *   - GenerateOutput — provider result shape (interface, not Zod — provider controls output)
 *   - AIProvider — provider interface (type-only; implementations live in packages/lore/src/ai/)
 *   - AiProviderConfigSchema / AiProviderConfig — per-provider CLI config
 *   - AiConfigSchema / AiConfig — full AI config section for LoreConfigSchema
 *
 * Invariants:
 *   - @lore/core MUST NOT reference Bun.* — verified by AC-AI-13 grep check
 *   - AIProvider is an interface only; concrete classes live in packages/lore/src/ai/
 *   - AiConfigSchema.parse({}) produces a fully-populated default config (no undefined fields)
 *   - DocTypeSchema is a re-export alias for docTypeSchema from schemas.ts (SSOT preserved)
 *
 * Side-effect class: pure (no IO, no Bun.*)
 *
 * Source: SPEC-017 §3.2, §3.3
 */

import { z } from "zod";
import { docTypeSchema } from "./schemas.js";
import type { Result, LoreError } from "./errors.js";
import type { JudgeIdentity } from "./review-judgment.js";

// ─── DocTypeSchema (re-export alias for SPEC-017 consumers) ──────────────────

/**
 * Zod enum for DocType — re-exported from schemas.ts so SPEC-017 consumers can import it
 * from @lore/core without knowing the internal module layout.
 *
 * @invariant Must stay in sync with DocType in types.ts and docTypeSchema in schemas.ts.
 *   Both names point to the same Zod schema object; there is no duplication.
 *
 * @example
 * const input = GenerateInputSchema.parse({ prompt: "...", doc_type: "prd", title: "X" });
 */
export const DocTypeSchema = docTypeSchema;

// ─── GenerateInput / GenerateOutput ──────────────────────────────────────────

/**
 * Input to an AI provider's generate() method.
 * Validated at the callsite using GenerateInputSchema.parse() before dispatch.
 *
 * @throws ZodError — never escapes; callers wrap in Result via service layer
 *
 * @example
 * const input = GenerateInputSchema.parse({ prompt: "...", doc_type: "prd", title: "X" });
 */
export const GenerateInputSchema = z.object({
  prompt: z.string().min(1),
  doc_type: DocTypeSchema,
  title: z.string().min(1),
  parent_title: z.string().optional(),
}).strict();

/** Validated input to an AI provider generate() call. */
export type GenerateInput = z.infer<typeof GenerateInputSchema>;

/**
 * Output from an AI provider's generate() method on success.
 * Interface (not Zod) — provider classes return this shape directly.
 *
 * @invariant content is always non-empty on success — empty output → AI_PROVIDER_ERROR instead
 * @invariant usage is populated by HttpAIProvider when the API returns token counts;
 *   ClaudeCliProvider leaves it undefined (no token tracking in CLI exit-code model)
 */
export interface GenerateOutput {
  /** Full text output from the provider (typically Markdown) */
  content: string;
  /** Wall-clock milliseconds from provider round-trip (spawn/fetch to last byte) */
  duration_ms: number;
  /** Provider process exit code (0 for success; -1 for HTTP/network failures) */
  exit_code: number;
  /** Provider name as registered in the provider registry */
  provider_name: string;
  /**
   * Token usage from the provider API (populated by HttpAIProvider; absent for ClaudeCliProvider).
   * Forwarded to aiGenerationEventSchema.usage in telemetry (AC-HTTP-TEL-1).
   * Source: SPEC-020 §8 Q4
   */
  usage?: {
    input_tokens: number;
    output_tokens: number;
    /**
     * Anthropic stop reason from the top-level response (e.g. "end_turn", "max_tokens").
     * Distinct from content-block stop reasons. Optional: absent when not provided by the API.
     */
    stop_reason?: string;
  };
  /**
   * Which provider/model/prompt-version produced `content` (SPEC-103 §Mechanisms M2 I1,
   * `judgeIdentitySchema`'s shape reused verbatim — same "who authored this" tuple a
   * review judgment's own `judge` field carries). Populated ONLY by
   * `AIProviderService.generate()` (the `lore create --ai` seam, SPEC-017) — NOT by
   * `regenerateContent`/`refineContent` (SPEC-019, which mutate an EXISTING already-
   * provenanced doc; re-stamping provenance on every edit is out of this spec's scope).
   * The caller (`adapters/cli/commands/create.ts`) folds this into the new doc's
   * `extra.ai_provenance` — never invented for a non-AI (editor-authored) create.
   */
  ai_provenance?: JudgeIdentity;
}

// ─── AIProvider interface (type-only) ────────────────────────────────────────

/**
 * Contract for any AI provider implementation.
 * Type-only — all implementations live in packages/lore/src/ai/.
 * @lore/core stays IO-free per SPEC-014 §3.2 (verified by AC-AI-13).
 *
 * @invariant Implementations MUST NOT throw — convert all errors to Result<GenerateOutput, LoreError>.
 * @invariant The `name` property MUST match the key used in the provider registry.
 *
 * @example
 * class MyProvider implements AIProvider {
 *   readonly name = "my-provider";
 *   async generate(input: GenerateInput): Promise<Result<GenerateOutput, LoreError>> {
 *     return ok({ content: "# Hello\n", duration_ms: 100, exit_code: 0, provider_name: this.name });
 *   }
 * }
 */
export interface AIProvider {
  readonly name: string;
  generate(input: GenerateInput): Promise<Result<GenerateOutput, LoreError>>;
}

// ─── Provider Config Schema ───────────────────────────────────────────────────

/**
 * Per-provider CLI-spawner configuration.
 * v1 supports only CLI-spawning providers; future SPECs will add a `kind` discriminator
 * to support HTTP providers (SPEC-017 §3.5 deliberate deferral).
 *
 * @example
 * const cfg = AiProviderConfigSchema.parse({ command: "claude", args: ["-p"] });
 * // → { command: "claude", args: ["-p"], timeout_ms: 180000 }
 */
export const AiProviderConfigSchema = z.object({
  /** Executable to spawn (e.g. "claude") */
  command: z.string().min(1),
  /** Additional CLI arguments appended after the command (e.g. ["-p"]) */
  args: z.array(z.string()).default([]),
  /**
   * Milliseconds before SIGTERM is sent to the spawned process.
   * Default 180_000 (SPEC-067 D1) — a real `lore assess` judge round measures ~73s under
   * normal load; 180s gives 2x headroom plus margin without adopting the full 300s some
   * production configs use. Explicit config (`ai.providers.<name>.timeout_ms`) always wins
   * over this schema default.
   */
  timeout_ms: z.number().int().positive().default(180_000),
}).strict();

/** Validated per-provider CLI configuration. */
export type AiProviderConfig = z.infer<typeof AiProviderConfigSchema>;

// ─── HTTP Provider Config Schema (SPEC-020) ──────────────────────────────────

/**
 * HTTP AI provider configuration — Anthropic Messages v1 wire format.
 * Required under `ai.http` when `ai.provider: "http"` is set (AC-HTTP-2).
 *
 * Header values matching the exact pattern `^\$\{[A-Z_][A-Z0-9_]*\}$` are resolved
 * from process.env at registry-build time (AC-HTTP-3). Missing or empty env vars
 * → VALIDATION_ERROR naming the env var. Literal header values are passed through unchanged.
 *
 * @invariant url must be a valid absolute HTTP(S) URL
 * @invariant headers values with the ${ENV_VAR} pattern are resolved at createApp() time,
 *   not at request time — the token value MUST NOT appear in error messages or logs (D-004)
 *
 * @example
 * AiHttpConfigSchema.parse({
 *   url: "https://api.anthropic.com/v1/messages",
 *   model: "claude-opus-4-8",
 *   headers: { "x-api-key": "${ANTHROPIC_API_KEY}", "anthropic-version": "2023-06-01" },
 * });
 * // → { url: "...", model: "claude-opus-4-8", headers: {...}, timeout_ms: 60000, max_tokens: 4096 }
 *
 * Source: SPEC-020 §9.2
 */
export const AiHttpConfigSchema = z
  .object({
    /** Anthropic Messages API endpoint (e.g. "https://api.anthropic.com/v1/messages") */
    url: z.string().url(),
    /** Model identifier sent in the request body (e.g. "claude-opus-4-8") */
    model: z.string().min(1).default("claude-opus-4-8"),
    /**
     * HTTP headers map. Values of the form `${ENV_VAR}` are resolved against process.env
     * at registry-build time (buildProviderRegistry). Missing or empty env vars → VALIDATION_ERROR.
     * Literal values (not matching the pattern) are passed through unchanged.
     */
    headers: z.record(z.string(), z.string()).default({}),
    /** Milliseconds before AbortController aborts the in-flight fetch (AC-HTTP-6) */
    timeout_ms: z.number().int().positive().default(60_000),
    /** Maximum tokens in the generated response (sent as `max_tokens` in request body) */
    max_tokens: z.number().int().positive().default(4096),
  })
  .strict();

/** Validated HTTP AI provider configuration. Source: SPEC-020 §9.2 */
export type AiHttpConfig = z.infer<typeof AiHttpConfigSchema>;

// ─── Per-Surface AI Default Schema (SPEC-024) ────────────────────────────────

/**
 * Per-surface AI default overrides.
 * Keys are optional — absent keys fall back to SPEC-024 built-in defaults:
 *   cli: true, agent: false, mcp: false, http_cookie: true, http_token: false
 *
 * @example
 * // Disable AI for ALL surfaces (paranoid / CI setup):
 * { cli: false, agent: false, mcp: false, http_cookie: false, http_token: false }
 *
 * Source: SPEC-024 §2.1, §8 Q2
 */
export const AiDefaultPerSurfaceSchema = z.object({
  cli: z.boolean().optional(),
  agent: z.boolean().optional(),
  mcp: z.boolean().optional(),
  http_cookie: z.boolean().optional(),
  http_token: z.boolean().optional(),
}).strict();

/** Validated per-surface AI default overrides. */
export type AiDefaultPerSurface = z.infer<typeof AiDefaultPerSurfaceSchema>;

// ─── Full AI Config Schema ────────────────────────────────────────────────────

/**
 * Full AI configuration section, embedded under LoreConfigSchema.ai (optional).
 * Defaults make `ai: {}` (or absent `ai:`) parse to a fully-populated config.
 * .strict() rejects typos at config-load time — fail loud (AC-AI-12).
 *
 * @example
 * const aiCfg = AiConfigSchema.parse({});
 * // → { provider: "claude-cli", providers: {}, templates: {}, telemetry: true }
 *
 * @example
 * AiConfigSchema.parse({ provder: "claude-cli" }); // throws ZodError — .strict() catches typo
 */
export const AiConfigSchema = z
  .object({
    /**
     * Active provider name — must match a key in the merged provider map.
     * Valid values: "claude-cli" (default) | "http" (SPEC-020).
     * Unknown provider name at createApp time → STORE_ERROR (AC-AI-11).
     */
    provider: z.string().min(1).default("claude-cli"),
    /**
     * Per-provider CLI config overrides.
     * Each entry REPLACES (not merges) the corresponding built-in provider entry.
     * Empty by default — built-in "claude-cli" is always present.
     * Not used when provider === "http" (HTTP config lives in ai.http, not here).
     */
    providers: z.record(z.string(), AiProviderConfigSchema).default({}),
    /**
     * Template overrides keyed by template name.
     * Accepted keys:
     *   - DocType values ("prd", "spec", "adr", "plan", "knowledge", "task") — override the
     *     built-in per-type content generation template used by `lore create --ai` /
     *     `lore set --regenerate`. Absent key → built-in from BUILT_IN_TEMPLATES is used.
     *   - "refine" — override the refinement prompt template used by `lore set --refine` /
     *     `--refine-stdin`. Absent → REFINE_TEMPLATE default in templates.ts.
     *   - "link_inference" — override the link-type inference prompt used by `lore link --infer`.
     *     Absent → LINK_INFERENCE_TEMPLATE default in templates.ts.
     * Telemetry tags the event `template_source: "user-override"` when this key is present.
     * Source: SPEC-017 §3.9 (doc-type keys), SPEC-019 §9.1 (refine + link_inference keys)
     */
    templates: z.record(z.string(), z.string().min(1)).default({}),
    /**
     * Whether to emit ai.generation JSONL telemetry events.
     * Independent kill switch from the root telemetry.enabled flag (AC-AI-21).
     */
    telemetry: z.boolean().default(true),
    /**
     * Per-surface AI default overrides (SPEC-024).
     * When absent, built-in defaults apply:
     *   cli=true, agent=false, mcp=false, http_cookie=true, http_token=false
     * When a surface key is present, it overrides the built-in for that surface only.
     * source is reported as "config" in telemetry when this overrides the built-in.
     */
    default_per_surface: AiDefaultPerSurfaceSchema.optional(),
    /**
     * HTTP AI provider configuration (SPEC-020).
     * Required when `provider === "http"` — Zod superRefine enforces this (AC-HTTP-2).
     * Ignored when `provider === "claude-cli"`.
     * Header values matching `^\$\{[A-Z_][A-Z0-9_]*\}$` are resolved from process.env
     * at registry-build time (AC-HTTP-3).
     */
    http: AiHttpConfigSchema.optional(),
    /**
     * Refinement operation configuration (SPEC-019).
     * Controls content truncation for the `lore set --refine` / `--refine-stdin` path.
     */
    refine: z
      .object({
        /**
         * Maximum characters of existing doc content to include in the refine prompt.
         * Prevents runaway prompt cost on large docs.
         * Default: 8000 chars. Source: SPEC-019 §6 risk mitigation.
         */
        max_input_chars: z.number().int().positive().default(8000),
      })
      .strict()
      .default({}),
    /**
     * Plan-outcome assessment operation configuration (SPEC-026).
     * Character budgets for each material section embedded in the `lore assess` judge
     * prompt. Any section exceeding its budget is truncated and its name is recorded in
     * `judgment.truncated[]` (AC-ASSESS-7) — mirrors the `ai.refine.max_input_chars`
     * precedent so budget config lives in one consistent place.
     *
     * @invariant `max_diff_chars` RAISED to 80_000 (2026-08-11,
     *   task-raise-capture-timeout-ms-and-max-diff-chars-to-the-values,
     *   spec-governance-defaults-must-ship-and-every-recorded-gap-must D2): the
     *   prior 24_000 default had been measured to truncate a real `lore assess`
     *   diff of 5.3M characters, and that dogfood-validated raise had lived ONLY
     *   in this repo's `.lore/config.yaml` (never reaching any other consumer)
     *   until this default absorbed it. ⛔ Unlike `capture_timeout_ms`, this is
     *   NOT a free ceiling raise: a larger `max_diff_chars` costs real tokens on
     *   EVERY `lore assess` call whose diff is large enough to reach the new
     *   ceiling, not only the rare oversized one — the trade is accepted because
     *   the alternative (a judge scoring an assessment against a truncated diff)
     *   is worse, but the next reader raising this further should re-measure the
     *   token cost, not just repeat this raise.
     */
    assess: z
      .object({
        /** Max chars of the plan document's content included in the prompt. Default: 8000. */
        max_plan_chars: z.number().int().positive().default(8000),
        /** Max chars of the linked spec's content included in the prompt. Default: 12000. */
        max_spec_chars: z.number().int().positive().default(12000),
        /** Max chars of each task's content included in the prompt (per task). Default: 4000. */
        max_task_chars: z.number().int().positive().default(4000),
        /** Max chars of the optional git diff included in the prompt. Default: 80000. */
        max_diff_chars: z.number().int().positive().default(80_000),
      })
      .strict()
      .default({}),
    /**
     * Document review operation configuration (SPEC-034).
     * Character budgets for the two material sections embedded in the `lore review` judge
     * prompt — mirrors the `ai.assess.*` budget precedent.
     */
    review: z
      .object({
        /**
         * Read ONLY by the frozen review prompt versions v1-v5. From v6 the document under review is never cut
         * (BR-268), so this key no longer bounds the active prompt; only `max_context_chars` does.
         */
        max_doc_chars: z.number().int().positive().default(12000),
        /** Max chars of the parent document's content included as context. Default: 8000. */
        max_context_chars: z.number().int().positive().default(8000),
      })
      .strict()
      .default({}),
    /**
     * Staleness-probe operation configuration (SPEC-044 §Design Decisions D8).
     * Character/count budgets for the `lore review --staleness` judge prompt — mirrors
     * the `ai.review.*` precedent (D8 explicitly rejects a new top-level `review.*`
     * config block; this section stays under `ai.*` like every other prompt-shaping
     * budget).
     */
    staleness: z
      .object({
        /** Max chars of the probed document's own content included in the prompt. Default: 12000. */
        max_doc_chars: z.number().int().positive().default(12000),
        /** Max incoming-link neighbors shown to the judge before a loud "+n more" tail. Default: 20. */
        neighbor_limit: z.number().int().positive().default(20),
      })
      .strict()
      .default({}),
  })
  .strict()
  // Cross-field constraint: when provider === "http", ai.http is required (AC-HTTP-2).
  // reason: Zod object.strict() only validates field shapes, not cross-field dependencies.
  // superRefine runs after all field-level validation passes, so http fields are already
  // validated by AiHttpConfigSchema before this check fires.
  .superRefine((val, ctx) => {
    if (val.provider === "http" && val.http === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["http"],
        message:
          "ai.http config is required when ai.provider is 'http'. " +
          "Add ai.http.url (and ai.http.headers with ${ENV_VAR} for auth) to your .lore/config.yaml.",
      });
    }
  });

/** Validated full AI configuration. */
export type AiConfig = z.infer<typeof AiConfigSchema>;
