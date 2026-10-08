// Fixture for AC-BLS2-15 — the fixture's product error type and Result constructor.
export interface FxError {
  code: string;
  field?: string;
  message?: string;
}
export type FxResult<T> = { ok: true; value: T } | { ok: false; error: FxError };

export function err(error: FxError): { ok: false; error: FxError } {
  return { ok: false, error };
}
