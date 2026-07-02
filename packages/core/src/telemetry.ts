/**
 * Telemetry module — schemas, interface, and the null sink. Browser-safe.
 *
 * Public surface:
 *   - TelemetryEvent — schema for a single recorded event (Zod + z.infer)
 *   - Telemetry — interface for recording events and lifecycle
 *   - NoOpTelemetry — null implementation for tests, opt-out mode, and browser callers
 *   - TelemetryConfigSchema / TelemetryConfig — config shape consumed by LoreConfigSchema
 *
 * Invariants:
 *   - record() MUST NOT throw even if the underlying implementation fails
 *   - close() is idempotent; subsequent record() calls after close() are no-ops
 *   - This file MUST NOT import Node builtins (fs/path/os/child_process/...), even
 *     transitively — it is re-exported from the browser-safe `@lore/core` barrel
 *     (`index.ts`) and consumed by `@lore/dashboard`. The file-writing implementation
 *     (`JsonlTelemetry`) and its factory (`createTelemetry`) live in the Node-only
 *     sibling `telemetry-node.ts`, exported only via the `@lore/core/node` subpath.
 *     Regression oracle: `packages/dashboard/tests/e2e/write-flow.pw.ts` (SPEC-022) —
 *     a `fs` import reachable from this file crashes the dashboard SPA at load time.
 *
 * Side-effect class: pure (JsonlTelemetry's IO lives in telemetry-node.ts)
 *
 * Source: SPEC-012
 */

import { z } from "zod";
import { DocTypeSchema } from "./ai.js";

// ─── Event Schema (Zod SSOT) ──────────────────────────────────────────────────

/**
 * Zod schema for a single telemetry event.
 * All fields are validated on creation; types derive from the schema.
 */
export const TelemetryEventSchema = z.object({
  /** ISO 8601 UTC timestamp (e.g. "2026-06-24T12:00:00.000Z") */
  ts: z.string(),
  /** Service class name (e.g. "CorpusService") */
  service: z.string(),
  /** Method name (e.g. "create") */
  method: z.string(),
  /** Whether the service call succeeded */
  ok: z.boolean(),
  /** Wall-clock duration in milliseconds */
  duration_ms: z.number(),
  /** LoreError.code when ok=false */
  error_code: z.string().optional(),
  /** Optional structured context (doc id, type, query, etc.) */
  meta: z.record(z.unknown()).optional(),
  /**
   * Caller surface that originated the write.
   * "cli" — command-line; "dashboard" — browser dashboard (SPEC-022 §9.6).
   * Absent on events from services that don't discriminate the surface (pre-SPEC-022 events).
   * Source: SPEC-022 AC-DASH-WRITE-TEL-1
   */
  source: z.enum(["cli", "dashboard"]).optional(),
});

/** Derived type — never duplicate the shape as an interface. */
export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>;

// ─── AI Generation Event Schema ──────────────────────────────────────────────

/**
 * Zod schema for the ai.generation telemetry event.
 * Written to the same JSONL sink as TelemetryEvent; discriminated by the `event` field.
 * Emitted by AIProviderService.generate() on both success and failure paths.
 *
 * @example
 * aiGenerationEventSchema.parse({
 *   event: "ai.generation", ts: new Date().toISOString(),
 *   provider: "claude-cli", doc_type: "prd", template_source: "built-in",
 *   duration_ms: 3200, output_chars: 512, exit_code: 0,
 * });
 *
 * Source: SPEC-017 §3.10
 */
export const aiGenerationEventSchema = z.object({
  event: z.literal("ai.generation"),
  /** ISO 8601 UTC timestamp */
  ts: z.string().datetime(),
  /** Provider name as registered in the registry (e.g. "claude-cli") */
  provider: z.string(),
  /** Document type that was being generated */
  doc_type: DocTypeSchema,
  /** Whether the built-in template or a user-override was used */
  template_source: z.enum(["built-in", "user-override"]),
  /** Wall-clock milliseconds for the full provider round-trip (integer; AIProviderService uses Math.round) */
  duration_ms: z.number().int().nonnegative(),
  /** Length of output content in characters (0 on failure) */
  output_chars: z.number().int().nonnegative(),
  /** Provider process exit code (0 for success, -1 if killed) */
  exit_code: z.number().int(),
  /** Error message when generation failed */
  error: z.string().optional(),
  /**
   * How the AI on/off decision was resolved. SPEC-024 AC-NOAI-8.
   * Optional for backward compatibility with events emitted before SPEC-024 landed.
   */
  ai_default_source: z.enum(["explicit_arg", "config", "env", "cli_flag"]).optional(),
  /**
   * Surface from which the AI generation was triggered. SPEC-024 AC-NOAI-8.
   * Optional for backward compatibility with events emitted before SPEC-024 landed.
   */
  caller_surface: z.enum(["cli", "agent", "mcp", "http_cookie", "http_token"]).optional(),
  /**
   * Token usage from the provider API (SPEC-020 AC-HTTP-TEL-1).
   * Populated by HttpAIProvider when the Anthropic API returns usage data.
   * Absent for ClaudeCliProvider (CLI exit-code model has no token tracking).
   * Optional for backward compatibility with events emitted before SPEC-020 landed.
   */
  usage: z
    .object({
      input_tokens: z.number().int().nonnegative(),
      output_tokens: z.number().int().nonnegative(),
      /**
       * Anthropic stop reason from the top-level response (e.g. "end_turn", "max_tokens").
       * Optional: absent when the provider does not return a stop reason.
       */
      stop_reason: z.string().optional(),
    })
    .optional(),
  /**
   * Discriminator for what kind of AI operation produced this event.
   *   "create"     — lore create --ai (SPEC-017; existing events without this field default here)
   *   "regenerate" — lore set --regenerate (SPEC-019)
   *   "refine"     — lore set --refine / --refine-stdin (SPEC-019)
   *   "infer"      — lore link --infer (SPEC-019)
   *
   * .default("create") so events emitted before SPEC-019 parse cleanly at schema validation
   * time — the field is optional in the INPUT to .parse() but required in the OUTPUT type.
   * Source: SPEC-019 §8 Q6, AC-AI-TEL-1
   */
  kind: z.enum(["create", "regenerate", "refine", "infer"]).default("create"),
  /**
   * ULID of the document that was mutated by the AI operation.
   *   null — for "create" (doc does not exist yet at call time)
   *   string — for "regenerate"/"refine" (the doc being re-written)
   *   string — for "infer" (the from-doc's ID)
   * Optional for backward compat with pre-SPEC-019 events.
   * Source: SPEC-019 AC-AI-TEL-1
   */
  target_doc_id: z.string().nullable().optional(),
}).strict();

/** Derived type for an AI generation telemetry event. */
export type AiGenerationEvent = z.infer<typeof aiGenerationEventSchema>;

// ─── Telemetry Interface ──────────────────────────────────────────────────────

/**
 * Telemetry sink contract.
 * Implementations MUST be safe to call at any time without wrapping in try/catch.
 */
export interface Telemetry {
  /**
   * Record a single service-layer telemetry event.
   * Must never throw — IO errors MUST be swallowed internally.
   *
   * @param event - Validated telemetry event to persist
   */
  record(event: TelemetryEvent): void;

  /**
   * Emit an AI generation event to the same JSONL sink.
   * Must never throw — IO errors MUST be swallowed internally.
   * Discriminated from record() events by the `event: "ai.generation"` field.
   *
   * @param event - Validated AI generation event to persist
   */
  emit(event: AiGenerationEvent): void;

  /**
   * Flush pending events and release file handles.
   * Idempotent — safe to call multiple times.
   * Subsequent record()/emit() calls after close() are no-ops.
   */
  close(): void;
}

// ─── NoOpTelemetry ────────────────────────────────────────────────────────────

/**
 * Null implementation — discards all events.
 * Used when telemetry is disabled (config.telemetry.enabled=false)
 * and in unit tests where side effects must be suppressed.
 *
 * @example
 * const telemetry: Telemetry = new NoOpTelemetry();
 * telemetry.record({ ts: "...", service: "S", method: "m", ok: true, duration_ms: 1 });
 * telemetry.close(); // no-op
 */
export class NoOpTelemetry implements Telemetry {
  record(_event: TelemetryEvent): void {
    // intentional no-op — reason: test/disabled mode, no side effects desired
  }

  emit(_event: AiGenerationEvent): void {
    // intentional no-op — reason: test/disabled mode, no side effects desired
  }

  close(): void {
    // intentional no-op
  }
}

// ─── Config Schema ────────────────────────────────────────────────────────────

/**
 * Telemetry configuration sub-schema.
 * Used inside LoreConfigSchema (src/core/config.ts).
 */
export const TelemetryConfigSchema = z.object({
  /** Whether telemetry recording is active. Default: true. */
  enabled: z.boolean().default(true),
  /**
   * File path for JSONL output.
   * Default: ".lore/telemetry.jsonl" (relative to cwd).
   */
  path: z.string().default(".lore/telemetry.jsonl"),
});

export type TelemetryConfig = z.infer<typeof TelemetryConfigSchema>;

// reason: The file-writing factory (createTelemetry) lives in telemetry-node.ts —
// it must import NoOpTelemetry from here to fall back on when telemetry is disabled,
// which is why NoOpTelemetry stays exported from this browser-safe file. See
// `@lore/core/node` (src/node.ts) for `createTelemetry` / `JsonlTelemetry`.
