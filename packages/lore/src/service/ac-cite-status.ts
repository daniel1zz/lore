/**
 * ac-cite-status — the pure decision behind `lore status --json` `data.ac_cite` (Baseline slice 3a, BL-8, AC-BLS3-8).
 *
 * Public surface: {@link decideAcCiteStatus}, {@link lastAdoptedModeOf}, {@link AcCiteStatus}.
 *
 * Invariants:
 *   - A STORED mode is `audited` iff it equals the `new.mode` of the last `baseline_adopt` audit row, else
 *     `unaudited` (never adopted, or hand-edited after the last adopt).
 *   - No stored mode -> the effective default (off/report by baseline presence) with provenance `default`:
 *     nothing was set, so nothing is unaudited.
 *
 * Side-effect class: pure.
 */

import type { AuditEntry, CiteGateMode } from "@lore/core";

/** How the reported mode came to be: set through `lore baseline adopt`, set another way, or nobody set it. */
export type AcCiteProvenance = "audited" | "unaudited" | "default";

/** The `data.ac_cite` block of `lore status --json`. */
export interface AcCiteStatus {
  readonly mode: CiteGateMode;
  readonly provenance: AcCiteProvenance;
}

/**
 * @param input.storedMode - `workflow.gates."ac-cite".mode` as stored (null when absent)
 * @param input.effectiveMode - the resolved mode (absent mode resolves to off/report by baseline presence)
 * @param input.lastAdoptedMode - `new.mode` of the newest `baseline_adopt` row (null when there is none)
 */
export function decideAcCiteStatus(input: {
  readonly storedMode: string | null;
  readonly effectiveMode: CiteGateMode;
  readonly lastAdoptedMode: string | null;
}): AcCiteStatus {
  if (input.storedMode === null) return { mode: input.effectiveMode, provenance: "default" };
  return {
    mode: input.effectiveMode,
    provenance: input.storedMode === input.lastAdoptedMode ? "audited" : "unaudited",
  };
}

/** Reads `details.new.mode` off a `baseline_adopt` audit row; null for no row, a null mode, or a malformed row. */
export function lastAdoptedModeOf(row: AuditEntry | undefined): string | null {
  const next = row?.details?.["new"];
  if (typeof next !== "object" || next === null) return null;
  const mode = (next as Record<string, unknown>)["mode"];
  return typeof mode === "string" ? mode : null;
}
