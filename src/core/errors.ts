/**
 * Core error model and Result type for the Lore service layer.
 * All service methods return Result<T, LoreError> — no thrown exceptions crossing service boundary.
 * Source: SPEC-001 §5
 */

/** Discriminated union of all service-layer errors. 12 error codes total. */
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
  | { code: "STORE_ERROR"; message: string; cause?: Error };

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
