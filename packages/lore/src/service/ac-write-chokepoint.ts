/**
 * Module: ac-write-chokepoint — the ONE function every write that touches
 * `extra.acceptance_criteria` passes through (baseline slice 2a §C3, closes issue #36 for ACs).
 *
 * Public surface: {@link applyAcChange}, {@link AcWritePath}, {@link AC_WRITE_NOT_VIA_AC_VERB}.
 * Invariants:
 *   - A change is detected on the canonical JSON of the array (`JSON.stringify`; order and every
 *     field significant) — reordered, reworded, appended, dropped, added-from-absent all count.
 *   - `"ac-verb"` (the `AcService` verbs) is the only sanctioned path that may change the array.
 *   - `"wholesale"` (CorpusService.create/set — hence CLI `lore set`, MCP `lore_set`, HTTP PATCH)
 *     passes only when the incoming array is byte-identical to the stored one (an echo).
 *   - Pure: no IO, no clock. Returns a Result; never throws.
 * Side-effect class: pure.
 *
 * Source: spec-baseline-slice-2-completeness-census-per-branch-citation §C3, AC-BLS2-1.
 */

import { err, ok, type LoreError, type Result } from "@lore/core";

/** The refusal code — also the `LoreError` discriminant in `@lore/core` errors.ts. */
export const AC_WRITE_NOT_VIA_AC_VERB = "AC_WRITE_NOT_VIA_AC_VERB" as const;

/** Who is writing: an `AcService` verb, or any other path that replaces `extra` wholesale. */
export type AcWritePath = "ac-verb" | "wholesale";

const KEY = "acceptance_criteria";

/** Canonical JSON of the criteria value; `undefined` (absent) is its own distinct token. */
function canonical(value: unknown): string {
  return value === undefined ? "<absent>" : JSON.stringify(value);
}

/**
 * Admit or refuse a write by whether it changes `extra.acceptance_criteria`.
 *
 * @param path - `"ac-verb"` always admits; `"wholesale"` admits only a byte-identical echo.
 * @param before - the stored `extra` (`undefined` on create — no stored doc yet).
 * @param after - the `extra` the write would persist (`undefined` = write carries no extra → no change).
 * @param docId - the doc being written, for the refusal (absent on create).
 *
 * @example
 * applyAcChange("wholesale", doc.extra, { acceptance_criteria: changed }, doc.id); // err AC_WRITE_NOT_VIA_AC_VERB
 */
export function applyAcChange(
  path: AcWritePath,
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
  docId?: string,
): Result<void, LoreError> {
  if (path === "ac-verb" || after === undefined) return ok(undefined);
  if (canonical(before?.[KEY]) === canonical(after[KEY])) return ok(undefined);
  return err({
    code: AC_WRITE_NOT_VIA_AC_VERB,
    ...(docId !== undefined ? { id: docId } : {}),
    message:
      `extra.${KEY} is owned by \`lore ac add|set|rm|cite\` — \`lore set\`/\`lore_set\`/PATCH/create ` +
      `replace \`extra\` wholesale and must not add, drop, reword or reorder criteria. ` +
      `Use the \`lore ac\` verbs, or pass the stored array byte-identical.`,
  });
}
