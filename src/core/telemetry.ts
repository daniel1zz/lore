/**
 * Telemetry module — append-only JSONL event sink for service instrumentation.
 *
 * Public surface:
 *   - TelemetryEvent — schema for a single recorded event (Zod + z.infer)
 *   - Telemetry — interface for recording events and lifecycle
 *   - JsonlTelemetry — writes events to a JSONL file; IO errors are swallowed (never breaks caller)
 *   - NoOpTelemetry — null implementation for tests and opt-out mode
 *   - createTelemetry — factory that reads TelemetryConfig and returns the right impl
 *
 * Invariants:
 *   - record() MUST NOT throw even if the underlying IO fails
 *   - close() is idempotent; subsequent record() calls after close() are no-ops
 *   - JsonlTelemetry never creates directories; caller must ensure the .lore/ dir exists
 *
 * Side-effect class: IO (JsonlTelemetry only; NoOpTelemetry is pure)
 *
 * Source: SPEC-012
 */

import { z } from "zod";
import { appendFileSync, mkdirSync } from "fs";
import { dirname } from "path";

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
});

/** Derived type — never duplicate the shape as an interface. */
export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>;

// ─── Telemetry Interface ──────────────────────────────────────────────────────

/**
 * Telemetry sink contract.
 * Implementations MUST be safe to call at any time without wrapping in try/catch.
 */
export interface Telemetry {
  /**
   * Record a single telemetry event.
   * Must never throw — IO errors MUST be swallowed internally.
   *
   * @param event - Validated telemetry event to persist
   */
  record(event: TelemetryEvent): void;

  /**
   * Flush pending events and release file handles.
   * Idempotent — safe to call multiple times.
   * Subsequent record() calls after close() are no-ops.
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

  close(): void {
    // intentional no-op
  }
}

// ─── JsonlTelemetry ───────────────────────────────────────────────────────────

/**
 * JSONL file-based telemetry implementation.
 * Appends one JSON line per event to the configured path.
 *
 * IO errors are caught and silently discarded to satisfy the invariant that
 * telemetry failures MUST NOT propagate to the caller.
 *
 * @example
 * const tel = new JsonlTelemetry("/project/.lore/telemetry.jsonl");
 * tel.record({ ts: new Date().toISOString(), service: "CorpusService", method: "create", ok: true, duration_ms: 12 });
 * tel.close();
 */
export class JsonlTelemetry implements Telemetry {
  private readonly filePath: string;
  private closed: boolean = false;

  /**
   * @param filePath - Absolute or relative path to the JSONL output file.
   *   The parent directory is created if it does not exist.
   */
  constructor(filePath: string) {
    this.filePath = filePath;
    // Ensure parent directory exists (e.g. .lore/) — reason: appendFileSync
    // will throw if the directory is missing; we create it once here
    try {
      mkdirSync(dirname(filePath), { recursive: true });
    } catch {
      // If mkdirSync fails (permissions, etc.), we stay in a degraded state
      // where record() will silently fail. This is acceptable per the invariant.
    }
  }

  /**
   * Append event as a JSON line to the JSONL file.
   * No-op if already closed. IO errors are swallowed — see invariant.
   */
  record(event: TelemetryEvent): void {
    if (this.closed) return;
    try {
      const line = JSON.stringify(event) + "\n";
      appendFileSync(this.filePath, line, "utf8");
    } catch {
      // reason: telemetry failures MUST NOT break service callers (SPEC-012 §4)
    }
  }

  /**
   * Mark this instance as closed; subsequent record() calls are ignored.
   * Synchronous flush is implicit since appendFileSync is synchronous.
   */
  close(): void {
    this.closed = true;
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

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create the appropriate Telemetry implementation based on config.
 *
 * - config undefined or enabled=false → NoOpTelemetry (no file side effects)
 * - enabled=true → JsonlTelemetry writing to config.path
 *
 * @param config - Optional telemetry config from LoreConfig.telemetry
 * @returns A Telemetry implementation ready to record events
 *
 * @example
 * // Caller must opt-in explicitly via config:
 * const tel = createTelemetry({ enabled: true, path: ".lore/telemetry.jsonl" });
 */
export function createTelemetry(config?: TelemetryConfig): Telemetry {
  if (config === undefined || !config.enabled) {
    return new NoOpTelemetry();
  }
  return new JsonlTelemetry(config.path);
}
