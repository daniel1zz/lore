/**
 * ac-cite-status — the pure decision behind `lore status --json` `data.ac_cite` (Baseline slice 3a, BL-8, AC-BLS3-8).
 *
 * Public surface: {@link decideAcCiteStatus}, {@link lastAdoptedModeOf}, {@link isEnforceRefusingNothing},
 * {@link ENFORCE_REFUSES_NOTHING_WARNING}, {@link AcCiteStatus}.
 *
 * Invariants:
 *   - A STORED mode is `audited` iff it equals the `new.mode` of the last `baseline_adopt` audit row, else
 *     `unaudited` (never adopted, or hand-edited after the last adopt).
 *   - No stored mode -> the effective default (off/report by baseline presence) with provenance `default`:
 *     nothing was set, so nothing is unaudited.
 *   - `lore baseline adopt` and `lore setup --project` (seeding an absent mode) write the SAME `baseline_adopt`
 *     audit row, so "audited" has ONE mechanism (BR-987): a setup-seeded mode equals the last row's `new.mode`.
 *   - `enforce_refuses_nothing` is true iff the mode is `enforce` and no branch is armed (BR-987).
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
  /** The armed baseline branch slugs (`[]` when none), in first-arm order. */
  readonly armed_branches: readonly string[];
  /** True iff mode is `enforce` and `armed_branches` is empty: the gate is on but refuses nothing (BR-987). */
  readonly enforce_refuses_nothing: boolean;
}

/** The one sentence `lore baseline adopt` and human `lore status` print when {@link isEnforceRefusingNothing} holds. */
export const ENFORCE_REFUSES_NOTHING_WARNING =
  "ac-cite mode is enforce but no branch is armed, so enforce refuses nothing (arm a baseline branch with `lore baseline adopt --arm <branch-slug>`)";

/** True iff `enforce` is the mode and no branch is armed (enforce then refuses nothing; BR-987). */
export function isEnforceRefusingNothing(mode: CiteGateMode, armedBranches: readonly string[]): boolean {
  return mode === "enforce" && armedBranches.length === 0;
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
  readonly armedBranches: readonly string[];
}): AcCiteStatus {
  const armed_branches = [...input.armedBranches];
  const enforce_refuses_nothing = isEnforceRefusingNothing(input.effectiveMode, armed_branches);
  if (input.storedMode === null) {
    return { mode: input.effectiveMode, provenance: "default", armed_branches, enforce_refuses_nothing };
  }
  return {
    mode: input.effectiveMode,
    provenance: input.storedMode === input.lastAdoptedMode ? "audited" : "unaudited",
    armed_branches,
    enforce_refuses_nothing,
  };
}

/** Reads `details.new.mode` off a `baseline_adopt` audit row; null for no row, a null mode, or a malformed row. */
export function lastAdoptedModeOf(row: AuditEntry | undefined): string | null {
  const next = row?.details?.["new"];
  if (typeof next !== "object" || next === null) return null;
  const mode = (next as Record<string, unknown>)["mode"];
  return typeof mode === "string" ? mode : null;
}
