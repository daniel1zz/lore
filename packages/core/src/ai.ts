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
 * @invariant content is always non-empty on success — empty stdout → AI_PROVIDER_ERROR instead
 */
export interface GenerateOutput {
  /** Full text output from the provider (typically Markdown) */
  content: string;
  /** Wall-clock milliseconds from spawn to last byte captured */
  duration_ms: number;
  /** Provider process exit code (0 for success) */
  exit_code: number;
  /** Provider name as registered in the provider registry */
  provider_name: string;
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
 * // → { command: "claude", args: ["-p"], timeout_ms: 60000 }
 */
export const AiProviderConfigSchema = z.object({
  /** Executable to spawn (e.g. "claude") */
  command: z.string().min(1),
  /** Additional CLI arguments appended after the command (e.g. ["-p"]) */
  args: z.array(z.string()).default([]),
  /** Milliseconds before SIGTERM is sent to the spawned process */
  timeout_ms: z.number().int().positive().default(60_000),
}).strict();

/** Validated per-provider CLI configuration. */
export type AiProviderConfig = z.infer<typeof AiProviderConfigSchema>;

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
export const AiConfigSchema = z.object({
  /**
   * Active provider name — must match a key in the merged provider map.
   * Unknown provider name at createApp time → STORE_ERROR (AC-AI-11).
   */
  provider: z.string().min(1).default("claude-cli"),
  /**
   * Per-provider config overrides.
   * Each entry REPLACES (not merges) the corresponding built-in provider entry.
   * Empty by default — built-in "claude-cli" is always present.
   */
  providers: z.record(z.string(), AiProviderConfigSchema).default({}),
  /**
   * Per-doc-type template overrides keyed by DocType.
   * When present, overrides the built-in template for that type.
   * Absent key → built-in template from BUILT_IN_TEMPLATES is used.
   * Telemetry tags the event `template_source: "user-override"` when this key is present.
   */
  templates: z.record(DocTypeSchema, z.string().min(1)).default({}),
  /**
   * Whether to emit ai.generation JSONL telemetry events.
   * Independent kill switch from the root telemetry.enabled flag (AC-AI-21).
   */
  telemetry: z.boolean().default(true),
}).strict();

/** Validated full AI configuration. */
export type AiConfig = z.infer<typeof AiConfigSchema>;
