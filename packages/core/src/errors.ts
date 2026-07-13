/**
 * Core error model and Result type for the Lore service layer.
 * All service methods return Result<T, LoreError> — no thrown exceptions crossing service boundary.
 * Source: SPEC-001 §5
 */

/** Discriminated union of all service-layer errors. 13 error codes total (16 with AI_PROVIDER_ERROR + CLAIM_CONFLICT + NEEDS_APPROVAL). */
export type LoreError =
  | { code: "DOC_NOT_FOUND"; id: string; suggestions?: string[] }
  | { code: "SLUG_NOT_FOUND"; slug: string; suggestions?: string[] }
  | { code: "STALE_VERSION"; id: string; expected: number; actual: number }
  | { code: "VALIDATION_ERROR"; field: string; message: string; value?: unknown }
  | { code: "SCHEMA_VIOLATION"; type: string; missing: string[]; extra?: string[] }
  | { code: "LINK_CYCLE"; path: string[] }
  | { code: "DUPLICATE_SLUG"; slug: string; existing_id: string }
  | { code: "DUPLICATE_LINK"; from: string; to: string; type: string }
  | { code: "DELETE_REQUIRES_CONFIRM"; id: string }
  | { code: "INVALID_TRANSITION"; from: string; to: string; allowed: string[] }
  | { code: "PARENT_REQUIRED"; type: string }
  | { code: "INVALID_PARENT_TYPE"; child: string; parent: string; allowed: string[] }
  | { code: "STORE_ERROR"; message: string; cause?: Error }
  /**
   * AI provider failed to generate content. Occurs when the spawned binary is missing,
   * exits with non-zero, produces empty stdout, or exceeds timeout_ms.
   * CLI exit code: 6 (SPEC-017 §3.4). Fail loud — no silent fallback to editor.
   * Source: SPEC-017 §3.4
   */
  | {
      code: "AI_PROVIDER_ERROR";
      message: string;
      /** Provider name as registered in the registry (e.g. "claude-cli") */
      provider?: string;
      /** Exit code of the spawned process (-1 if killed / unknown) */
      exit_code?: number;
      /** First 1024 chars of provider stderr for diagnosis */
      stderr?: string;
    }
  /**
   * A `lore claim` or `lore release` write was rejected because the task's advisory
   * lease is held by someone else and neither the fresh-claim exemption (stale lease)
   * nor an explicit override (--steal / --force) applies.
   * CLI exit code: 5 (mapped alongside STALE_VERSION — both are write-contention errors).
   * Source: SPEC-025 §3 D2, §4 AC-WF-3, AC-WF-6
   */
  | {
      code: "CLAIM_CONFLICT";
      id: string;
      /** Current claim holder's actor identity */
      holder: string;
      /** Current claim age in minutes at the time of the conflicting request */
      age_minutes: number;
    }
  /**
   * `lore verify` refused to execute a script-mode AC's command because it is NEW or
   * CHANGED relative to the target task's recorded evidence history (SPEC-039 M2
   * trust-hardening, command-provenance approval gate) and neither an interactive
   * confirmation nor `--allow-new-commands` / `allow_new_commands` approved it.
   * CLI exit code: 7 (distinct from every other bucket — this is neither a store
   * failure nor a generic validation error, it's "the runner refused to trust an
   * unreviewed command").
   * Source: SPEC-039 §M2 (env allowlist + command-provenance approval hardening)
   */
  | {
      code: "NEEDS_APPROVAL";
      message: string;
      /** The exact command string that was rejected. */
      command: string;
      /** The acceptance criterion id the rejected command belongs to. */
      ac_id: string;
    };

/** Result type — success or failure. Use ok()/err() helpers to construct. */
export type Result<T, E = LoreError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/** Wrap a successful value in a Result. */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/** Wrap an error in a Result. */
export function err<E extends LoreError>(error: E): Result<never, E> {
  return { ok: false, error };
}
