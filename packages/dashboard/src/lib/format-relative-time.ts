/**
 * Relative time formatter — single derivation point for "N days ago"-style
 * strings rendered anywhere in the dashboard (SPEC-037 §1 D3 extraction).
 * Previously duplicated inline inside `DocCard`; hoisted here so the new
 * claim/evidence timeline (`TaskExecution.tsx`) reuses the exact same rule
 * instead of hand-rolling a second one.
 *
 * Public surface: formatRelativeTime
 * Invariants:
 *   - Reads `Date.now()` at call time — not memoized, not a pure fn in the
 *     strict sense, but has no other side effects (no IO, no state).
 * Side-effect class: pure except for the `Date.now()` wall-clock read
 * Source: SPEC-036 §1 D3 (origin), SPEC-037 §1 D3 (extraction)
 *
 * @example
 * formatRelativeTime("2026-07-05T00:00:00.000Z") // => "2 days ago" (relative to now)
 */

/**
 * Format an ISO timestamp as a human-readable relative time string.
 * @param iso - ISO 8601 date string.
 * @returns Relative time string like "2 days ago".
 */
export function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 30) return `${diffDays} days ago`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths} months ago`;
  return `${Math.floor(diffMonths / 12)} years ago`;
}
