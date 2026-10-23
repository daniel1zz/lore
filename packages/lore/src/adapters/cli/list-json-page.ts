/**
 * The `--json` page of `lore list` (BR-1371): a split-out pure module so unit tests need no `bun:sqlite`.
 * Public surface: `DEFAULT_JSON_LIMIT`, `boundedJsonPage`. Side-effect class: pure.
 */

/** Rows `lore list --json` returns when the caller gave no `--limit` (BR-1371: command output is bounded). */
export const DEFAULT_JSON_LIMIT = 200;

/**
 * The `--json` page of `lore list`: every row when the caller named a `--limit` (their page size already applied),
 * else at most {@link DEFAULT_JSON_LIMIT} rows, with `truncated: true`, the cap as `limit` and the full matched count
 * as `total` when more matched. Pure.
 *
 * @param rows - the already-rendered rows of the listing
 * @param explicitLimit - the caller's `--limit`, `undefined` when omitted
 * @returns `{ docs, total }`, plus `truncated` and `limit` only when the cap cut rows (the shape is otherwise unchanged)
 * @example
 *   boundedJsonPage(rows250, undefined) // { docs: <200 rows>, total: 250, truncated: true, limit: 200 }
 *   boundedJsonPage(rows250, 250)       // { docs: <250 rows>, total: 250 }
 */
export function boundedJsonPage<T>(
  rows: readonly T[],
  explicitLimit: number | undefined,
): { docs: T[]; total: number; truncated?: true; limit?: number } {
  if (explicitLimit !== undefined || rows.length <= DEFAULT_JSON_LIMIT) return { docs: [...rows], total: rows.length };
  return { docs: rows.slice(0, DEFAULT_JSON_LIMIT), total: rows.length, truncated: true, limit: DEFAULT_JSON_LIMIT };
}
