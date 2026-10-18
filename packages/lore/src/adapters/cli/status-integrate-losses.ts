/**
 * `lore status` integrate-loss surface — branches that keep losing the race for main.
 *
 * Purpose: one place that reads the loss ledger `lore integrate` writes (`<corpus dir>/integrate-losses/`) and renders
 * it for the plain `lore status` (text lines, printed only when a branch is starving; `integrate_losses` in `--json`,
 * ALWAYS present, `[]` when none, so an absent key can never read as "not measured").
 * Public surface: collectIntegrateLosses, renderIntegrateLossLines.
 * Invariants:
 *   - Read-only: never writes or prunes the ledger (the entry disappears when `lore integrate` lands the branch).
 *   - A malformed entry is returned as err, never skipped — a status that hid it would show a starving branch as healthy.
 * Side-effect class: IO (reads the ledger directory).
 *
 * Source: spec-main-advances-only-through-lore-integrate-per-session AC-INT-1 (5).
 */
import { dirname, resolve as resolvePath } from "node:path";
import type { LoreError, Result } from "@lore/core";
import { IntegrateLossLedger, type IntegrateLossEntry } from "../../service/integrate-loss-ledger.js";

/** Every starving branch of the corpus at `dbPath`, most losses first. */
export function collectIntegrateLosses(dbPath: string): Result<IntegrateLossEntry[], LoreError> {
  return new IntegrateLossLedger(dirname(resolvePath(dbPath))).list();
}

/** Text lines for the plain status; empty when no branch is starving. */
export function renderIntegrateLossLines(entries: readonly IntegrateLossEntry[]): string[] {
  if (entries.length === 0) return [];
  const lines = ["Branches losing the race for main (lore integrate exited 75; re-run `lore integrate <branch>`):"];
  for (const entry of entries) {
    const last = entry.moved_by[entry.moved_by.length - 1];
    lines.push(`  ${entry.branch}: ${entry.losses} consecutive lost race${entry.losses === 1 ? "" : "s"}${last !== undefined ? ` (last moved by ${last})` : ""}`);
  }
  return lines;
}
