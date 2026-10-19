/**
 * `lore status` integrate-loss surface — branches that keep losing the race for main.
 *
 * Purpose: one place that reads the loss ledger `lore integrate` writes (`<corpus dir>/integrate-losses/`) and renders
 * it for the plain `lore status` (text lines, printed only when a branch is starving; `integrate_losses` in `--json`,
 * ALWAYS present, `[]` when none, so an absent key can never read as "not measured").
 * Public surface: collectIntegrateLosses, renderIntegrateLossLines, IntegrateLossRow. Each row also carries `attempts_recorded` and
 * `median_attempt_ms` (the attempt ledger, `integrate-attempt-ledger.ts`), so the ADR's per-attempt cost assumption is re-checkable.
 * Invariants:
 *   - Read-only: never writes or prunes the ledger (the entry disappears when `lore integrate` lands the branch).
 *   - A malformed entry is returned as err, never skipped — a status that hid it would show a starving branch as healthy.
 * Side-effect class: IO (reads the ledger directory).
 *
 * Source: spec-main-advances-only-through-lore-integrate-per-session AC-INT-1 (5).
 */
import { dirname, resolve as resolvePath } from "node:path";
import type { LoreError, Result } from "@lore/core";
import { err, ok } from "@lore/core";
import { IntegrateLossLedger, type IntegrateLossEntry } from "../../service/integrate-loss-ledger.js";
import { IntegrateAttemptLedger, medianMs } from "../../service/integrate-attempt-ledger.js";

/**
 * One starving branch as `lore status` shows it: its loss entry plus the cost of its recorded attempts.
 * `median_attempt_ms` is `null` (never 0) when no attempt was recorded (a loss entry written before attempt records existed).
 */
export type IntegrateLossRow = IntegrateLossEntry & { readonly attempts_recorded: number; readonly median_attempt_ms: number | null };

/** Every starving branch of the corpus at `dbPath`, most losses first, each with its recorded attempt count and median attempt duration. */
export function collectIntegrateLosses(dbPath: string): Result<IntegrateLossRow[], LoreError> {
  const corpusDir = dirname(resolvePath(dbPath));
  const losses = new IntegrateLossLedger(corpusDir).list();
  if (!losses.ok) return losses;
  const attempts = new IntegrateAttemptLedger(corpusDir);
  const rows: IntegrateLossRow[] = [];
  for (const entry of losses.value) {
    const recorded = attempts.read(entry.branch);
    if (!recorded.ok) return err(recorded.error);
    const totals = (recorded.value?.attempts ?? []).map((a) => a.total_ms);
    rows.push({ ...entry, attempts_recorded: totals.length, median_attempt_ms: medianMs(totals) });
  }
  return ok(rows);
}

function renderMedian(entry: IntegrateLossRow): string {
  if (entry.median_attempt_ms === null) return "median attempt not measured (no attempt record)";
  return `median attempt ${(entry.median_attempt_ms / 1000).toFixed(1)}s over ${entry.attempts_recorded} recorded attempt(s)`;
}

/** Text lines for the plain status; empty when no branch is starving. */
export function renderIntegrateLossLines(entries: readonly IntegrateLossRow[]): string[] {
  if (entries.length === 0) return [];
  const lines = ["Branches losing the race for main (lore integrate exited 75; re-run `lore integrate <branch>`):"];
  for (const entry of entries) {
    const last = entry.moved_by[entry.moved_by.length - 1];
    lines.push(`  ${entry.branch}: ${entry.losses} consecutive lost race${entry.losses === 1 ? "" : "s"}${last !== undefined ? ` (last moved by ${last})` : ""}; ${renderMedian(entry)}`);
  }
  return lines;
}
