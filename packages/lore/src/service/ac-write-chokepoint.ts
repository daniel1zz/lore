/**
 * Module: ac-write-chokepoint — the ONE function every write that touches
 * `extra.acceptance_criteria` passes through (baseline slice 2a §C3, closes issue #36 for ACs).
 *
 * Public surface: {@link applyAcChange}, {@link AcWritePath}, {@link AC_WRITE_NOT_VIA_AC_VERB}.
 * Invariants:
 *   - A change is detected on the canonical JSON of the array (`JSON.stringify`; order and every
 *     field significant) — reordered, reworded, appended, dropped, added-from-absent all count.
 *   - `"ac-verb"` (the `AcService` verbs) is a sanctioned path: it always passes (the verb has
 *     already schema-validated and linted its candidate).
 *   - `"create"`, `"restore"`, `"import"` are the other sanctioned paths (spec amendment log,
 *     2026-10-08: refusing create deleted baseline rule BR-5). Their incoming array is treated
 *     as an addition and re-validated here with `specAcceptanceCriteriaSchema` (shape, unique
 *     ids, 50 cap); create's wording gate (`acQuantifiable` via GateEnforcer) runs in
 *     `_createImpl` on the same array. An invalid array is refused with VALIDATION_ERROR.
 *   - `"wholesale"` (CorpusService.set — hence CLI `lore set`, MCP `lore_set`, HTTP PATCH)
 *     passes only when the incoming array is byte-identical to the stored one (an echo).
 *   - Pure: no IO, no clock. Returns a Result; never throws.
 * Side-effect class: pure.
 *
 * Source: spec-baseline-slice-2-completeness-census-per-branch-citation §C3, AC-BLS2-1.
 */

import { err, ok, specAcceptanceCriteriaSchema, type LoreError, type Result } from "@lore/core";

/** The refusal code — also the `LoreError` discriminant in `@lore/core` errors.ts. */
export const AC_WRITE_NOT_VIA_AC_VERB = "AC_WRITE_NOT_VIA_AC_VERB" as const;

/** Who is writing: a sanctioned path (verb/create/restore/import) or a wholesale `extra` replace. */
export type AcWritePath = "ac-verb" | "create" | "restore" | "import" | "wholesale";

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
  if (after === undefined) return ok(undefined);
  if (path === "ac-verb") return ok(undefined);
  if (path !== "wholesale") {
    const incoming = after[KEY];
    if (incoming === undefined) return ok(undefined);
    const parsed = specAcceptanceCriteriaSchema.safeParse(incoming);
    if (parsed.success) return ok(undefined);
    const issue = parsed.error.issues[0];
    return err({
      code: "VALIDATION_ERROR",
      field: issue !== undefined ? `${KEY}.${issue.path.join(".")}` : KEY,
      message: `${path}: ${issue !== undefined ? issue.message : "invalid acceptance criteria"}`,
      value: incoming,
    });
  }
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
