/**
 * One-line human render of the stamp-verdict distribution that `lore status` prints (SPEC-143 AC-CT-9(d)).
 * A sibling of `commands/status.ts` so a vitest file can import it without `bun:sqlite` (the command file
 * transitively imports `loader.ts`).
 *
 * Public surface: `formatStampVerdictLine(distribution)`.
 *
 * Invariants: a RENDERER only. The five buckets arrive already derived by `computeStampVerdictDistribution`
 * (via `CorpusService.stampVerdictDistribution`); this module derives nothing.
 *
 * Side-effect class: pure
 */

import type { StampVerdictDistribution } from "../../service/gate-predicates.js";

/**
 * Renders the stamp-verdict distribution on one line. `radius_unmeasured` keeps its own count; the five buckets
 * sum to the attested-row total printed first.
 *
 * @param distribution - Buckets derived by `computeStampVerdictDistribution`.
 * @returns A single line, no trailing newline.
 * @example
 * formatStampVerdictLine(d); // "Stamp verdicts (3 attested rows): 2 bound / 0 stale / ..."
 */
export function formatStampVerdictLine(distribution: StampVerdictDistribution): string {
  const reasons = Object.entries(distribution.unbound_reasons)
    .filter(([, count]) => count > 0)
    .map(([reason, count]) => `${reason} ${count}`)
    .join(", ");
  return (
    `Stamp verdicts (${distribution.total} attested rows): ${distribution.bound} bound / ` +
    `${distribution.stale} stale / ${distribution.radius_unmeasured} radius-unmeasured / ` +
    `${distribution.unbound} unbound${reasons === "" ? "" : ` (${reasons})`} / ` +
    `${distribution.legacy_unbound} legacy-unbound`
  );
}
