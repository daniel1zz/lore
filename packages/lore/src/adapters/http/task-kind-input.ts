/**
 * Module: task-kind-input — the one check every HTTP create route runs on a task's kind (AC-DCS1-4, BR-1488).
 *
 * Purpose: `POST /api/docs` and `POST /api/dashboard/docs` both create documents, so both must require a task kind; one
 *   function holds the rule so the two routes cannot drift apart.
 * Public surface: {@link requireTaskKindOnCreate}.
 * Invariants: a document that is not a task passes through untouched; a task's kind is read from the top-level `kind` or from
 *   `extra.kind` and is stored in `extra.kind` only; a missing or unknown kind is a `VALIDATION_ERROR` on field `kind` that names
 *   all three kinds.
 * Side-effect class: pure.
 */

import { formatTaskKindRequiredMessage, isTaskKind } from "@lore/core";
import type { CreateDocInput } from "@lore/core";

/**
 * Requires a task kind on a create request body.
 *
 * @param body - the parsed request body
 * @returns the input to create, or the refusal (a `VALIDATION_ERROR` on field `kind`, to answer 400)
 */
export function requireTaskKindOnCreate(
  body: Record<string, unknown>,
):
  | { readonly ok: true; readonly input: CreateDocInput }
  | { readonly ok: false; readonly error: { code: "VALIDATION_ERROR"; field: string; message: string } } {
  if (body["type"] !== "task") return { ok: true, input: body as unknown as CreateDocInput };
  const extra = typeof body["extra"] === "object" && body["extra"] !== null ? (body["extra"] as Record<string, unknown>) : {};
  const { kind: topLevelKind, ...rest } = body;
  const kind = topLevelKind ?? extra["kind"];
  if (!isTaskKind(kind)) {
    return {
      ok: false,
      error: { code: "VALIDATION_ERROR", field: "kind", message: formatTaskKindRequiredMessage(kind, "kind") },
    };
  }
  return { ok: true, input: { ...rest, extra: { ...extra, kind } } as unknown as CreateDocInput };
}
