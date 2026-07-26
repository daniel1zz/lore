/**
 * `lore status`'s exempt-plans text-projection helper (SPEC-080 §C4, AC-080-5).
 * `CorpusService.status()` already computes `CorpusStatus.exempt_plans` (the DATA
 * layer — see that field's own JSDoc in `corpus-service.ts`); this module owns the
 * RENDER layer alone, mirroring `drift-flow.ts`'s `renderDriftRepairHint` /
 * `staleness-flow.ts`'s pure-render-helper split: `commands/status.ts` (bun-only,
 * not vitest-reachable — it statically imports `../loader.js`) calls into this
 * plain-TS module the same way it already calls `renderDriftRepairHint`.
 *
 * Public surface:
 *   renderExemptPlansSection(plans) — one line per exempt plan slug plus a count
 *   line; `[]` (no lines at all) for zero exemptions — the "byte-stable vs the
 *   pre-change baseline, which never printed this section" contract AC-080-5
 *   itself names.
 *
 * Side-effect class: pure (no IO, no wall-clock reads, no randomness).
 * Source: spec-080-prd-as-outline-contract-structured-outline-domain §C4,
 *   §Acceptance Criteria AC-080-5.
 */

/**
 * Renders `lore status`'s "Exempt plans" text section from `CorpusStatus.
 * exempt_plans` (pointer-only — slug alone, never the exemption's `reason`/`by`/
 * `at`, mirroring that field's own pointer-not-dump convention).
 *
 * Zero exemptions renders to `[]` (no lines appended at all) rather than a
 * "0 exempt plans" line — the pre-SPEC-080 `lore status` baseline never printed
 * any exempt-plans section, and AC-080-5 pins that baseline as byte-stable: a
 * corpus with no exemptions must produce IDENTICAL `lore status` text output to
 * before this feature existed.
 *
 * @param plans - `CorpusStatus.exempt_plans` (or any equivalently-shaped
 *   pointer list) — order preserved, never re-sorted.
 * @returns One line per plan (`  - <slug>`) preceded by a count line, or `[]`
 *   when `plans` is empty.
 * @example
 * renderExemptPlansSection([{ slug: "plan-a" }, { slug: "plan-b" }]);
 * // => ["Exempt plans (2):", "  - plan-a", "  - plan-b"]
 * @example
 * renderExemptPlansSection([]); // => []
 */
export function renderExemptPlansSection(plans: ReadonlyArray<{ slug: string }>): string[] {
  if (plans.length === 0) {
    return [];
  }
  const lines: string[] = [`Exempt plans (${plans.length}):`];
  for (const plan of plans) {
    lines.push(`  - ${plan.slug}`);
  }
  return lines;
}
