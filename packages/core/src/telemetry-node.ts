/**
 * Node-only telemetry sink — JSONL file writer + factory.
 *
 * Public surface:
 *   - JsonlTelemetry — writes events to a JSONL file; IO errors are swallowed (never breaks caller)
 *   - createTelemetry — factory that reads TelemetryConfig and returns the right impl
 *
 * Invariants:
 *   - record()/emit() MUST NOT throw even if the underlying IO fails
 *   - close() is idempotent; subsequent record()/emit() calls after close() are no-ops
 *   - JsonlTelemetry never creates directories beyond the target file's parent;
 *     caller must ensure the project root itself exists
 *   - This module imports `fs`/`path` — it MUST only be reached via the `@lore/core/node`
 *     subpath (`src/node.ts`), never via the default `@lore/core` barrel (`src/index.ts`).
 *     `@lore/dashboard` (browser) MUST NOT import this file, directly or transitively.
 *
 * Side-effect class: IO (JsonlTelemetry only; createTelemetry may return the pure NoOpTelemetry)
 *
 * Source: SPEC-012
 */

import { appendFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import {
  NoOpTelemetry,
  type Telemetry,
  type TelemetryEvent,
  type AiGenerationEvent,
  type TelemetryConfig,
} from "./telemetry.js";

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
   * Append an AI generation event as a JSON line to the same JSONL file.
   * Discriminated from record() events by `event: "ai.generation"` field.
   * No-op if already closed. IO errors are swallowed — see invariant.
   */
  emit(event: AiGenerationEvent): void {
    if (this.closed) return;
    try {
      const line = JSON.stringify(event) + "\n";
      appendFileSync(this.filePath, line, "utf8");
    } catch {
      // reason: telemetry failures MUST NOT break service callers (SPEC-012 §4)
    }
  }

  /**
   * Mark this instance as closed; subsequent record()/emit() calls are ignored.
   * Synchronous flush is implicit since appendFileSync is synchronous.
   */
  close(): void {
    this.closed = true;
  }
}

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
