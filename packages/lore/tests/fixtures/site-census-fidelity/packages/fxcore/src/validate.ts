// Fixture for AC-BLS2-15 — pure core functions: one refuses WITHOUT err(), one with err().
import { err, type FxResult } from "./errors.js";

/** Pure refusal built as a literal typed with the fixture's error type; no err() call. */
export function validateX(x: string): FxResult<string> {
  if (x === "") return { ok: false, error: { code: "VALIDATION_ERROR", field: "x" } };
  return { ok: true, value: x };
}

/** Pure refusal through err(): keeps the two layouts observably different even before the fix. */
export function validateY(y: number): FxResult<number> {
  if (y < 0) return err({ code: "RANGE_ERROR", field: "y" });
  return { ok: true, value: y };
}
