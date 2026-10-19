/**
 * The soft-delete recovery window — the ONE definition of how long a deleted document stays
 * recoverable (`lore delete` promises it, `lore undelete` enforces it).
 *
 * Public surface: `SOFT_DELETE_RECOVERY_DAYS`, `computeRecoverableUntil`.
 * Invariants: `recoverable_until` is never stored; it is always `deleted_at + window`, so delete,
 *   undelete and the "deleted" diagnostic can never disagree.
 * Side-effect class: pure.
 */

/** Days a soft-deleted document stays recoverable by `lore undelete`. */
export const SOFT_DELETE_RECOVERY_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The instant after which a document deleted at `deletedAtIso` can no longer be undeleted.
 *
 * @param deletedAtIso - the doc's `deleted_at` (ISO 8601)
 * @returns ISO 8601 `deleted_at + SOFT_DELETE_RECOVERY_DAYS`
 * @example computeRecoverableUntil("2026-01-01T00:00:00.000Z") // "2026-01-31T00:00:00.000Z"
 */
export function computeRecoverableUntil(deletedAtIso: string): string {
  return new Date(Date.parse(deletedAtIso) + SOFT_DELETE_RECOVERY_DAYS * MS_PER_DAY).toISOString();
}

/**
 * The one sentence every surface shows for an address that hit a soft-deleted doc: the deletion
 * date, the end of the recovery window, and the command that reverses it.
 *
 * @param idOrSlug - the address the caller used (echoed into the `lore undelete` hint)
 * @param deletedAtIso - the doc's `deleted_at`
 * @example describeSoftDeleted("knowledge-x", "2026-01-01T00:00:00.000Z")
 * // "deleted on 2026-01-01; recoverable until 2026-01-31 with `lore undelete knowledge-x`"
 */
export function describeSoftDeleted(idOrSlug: string, deletedAtIso: string): string {
  return (
    `deleted on ${deletedAtIso.slice(0, 10)}; recoverable until ` +
    `${computeRecoverableUntil(deletedAtIso).slice(0, 10)} with \`lore undelete ${idOrSlug}\``
  );
}
