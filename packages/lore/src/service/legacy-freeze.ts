/**
 * Legacy freeze: the marker a completed document carries and the guard that refuses authoring writes to it.
 *
 * Purpose: spec-every-document-is-stored-as-structured-fields-validated-by §Legacy documents (AC-ST-7) — a document
 *   completed before structured templates keeps its body and fields as they are; every write except a lifecycle
 *   transition (deprecate, invalidate, supersede) is refused.
 * Public surface: {@link LEGACY_REASON}, {@link LegacyMarker}, {@link buildLegacyMarker}, {@link isLegacyFrozen},
 *   {@link guardLegacyFrozenWrite}.
 * Invariants:
 *   - The marker is `extra.legacy = {since, reason}`; its presence alone means frozen (classification is computed once by
 *     `lore migrate legacy` and stored, never recomputed on a write).
 *   - Called ONLY by `CorpusService` (`set`, `writeDoc`): the one write path, so the guard cannot be bypassed by an adapter.
 *   - A status change is never refused here (deprecate / archive keep their own gates); the legacy marker itself is
 *     added by the migration (the one patch that only adds it) and can never be removed or edited afterwards.
 *   - Reading is never touched: this module has no read-side effect.
 * Side-effect class: pure.
 */

import { err, ok, validationError, type DocRecord, type LoreError, type Result } from "@lore/core";
import { isDeepStrictEqual } from "node:util";
import { bodyDiffers } from "./record-lock-service.js";

/** The `reason` every legacy marker carries (grep-friendly, stable). */
export const LEGACY_REASON = "completed before structured templates";

/** `extra.legacy`: when the document was classified and why it is frozen. */
export interface LegacyMarker {
  readonly since: string;
  readonly reason: typeof LEGACY_REASON;
}

/** `extra` keys a lifecycle transition writes on a frozen document (invalidate, supersede); never refused. */
const LIFECYCLE_EXTRA_KEYS: ReadonlySet<string> = new Set(["validity", "decision_status", "superseded_by"]);

/**
 * `extra` keys that are authoring content: refused on the row route (`writeDoc`, which services use for lifecycle,
 * link and anchor writes) while other metadata those services keep writing stays allowed. `legacy` is here so the
 * marker cannot be edited or dropped once present.
 */
const AUTHORING_EXTRA_KEYS: ReadonlySet<string> = new Set([
  "acceptance_criteria",
  "file_anchors",
  "code_anchors",
  "fields",
  "dimensions",
  "template_ref",
  "legacy",
]);

/** Which write route is asking: `set` (the user-facing edit) is strict, `row` (service lifecycle writes) is authoring-only. */
export type LegacyGuardSurface = "set" | "row";

/**
 * @param now - classification timestamp (ISO 8601)
 * @returns the marker to store in `extra.legacy`
 */
export function buildLegacyMarker(now: string): LegacyMarker {
  return { since: now, reason: LEGACY_REASON };
}

/**
 * @param doc - any stored document
 * @returns true when it carries a legacy marker
 */
export function isLegacyFrozen(doc: Pick<DocRecord, "extra">): boolean {
  const marker: unknown = doc.extra["legacy"];
  return typeof marker === "object" && marker !== null && !Array.isArray(marker);
}

/** Extra keys whose value differs between the stored and the incoming `extra` (a key missing on either side counts). */
function changedExtraKeys(stored: Record<string, unknown>, incoming: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(stored), ...Object.keys(incoming)]);
  return [...keys].filter((key) => !isDeepStrictEqual(stored[key], incoming[key]));
}

/**
 * Refuse an authoring write to a legacy-frozen document.
 *
 * @param doc - the stored document
 * @param patch - the write about to be made (only the fields it sets)
 * @param surface - `set` refuses any change except a status change and lifecycle `extra` keys; `row` refuses content,
 *   title, priority, tags, and the authoring `extra` keys (criteria, anchors, fields, dimensions, template pin, marker)
 * @returns `ok(undefined)` to proceed, or a VALIDATION_ERROR (exit 4) naming what was refused
 * @example
 * guardLegacyFrozenWrite(frozenSpec, { content: "new" }, "set"); // => err(VALIDATION_ERROR, field "legacy")
 */
export function guardLegacyFrozenWrite(
  doc: DocRecord,
  patch: {
    readonly content?: string | undefined;
    readonly title?: string | undefined;
    readonly priority?: string | undefined;
    readonly tags?: readonly string[] | undefined;
    readonly slug?: string | undefined;
    readonly extra?: Record<string, unknown> | undefined;
  },
  surface: LegacyGuardSurface,
): Result<undefined, LoreError> {
  if (!isLegacyFrozen(doc)) return ok(undefined);
  const refused: string[] = [];
  if (patch.content !== undefined && bodyDiffers(doc.content, patch.content)) refused.push("content");
  if (patch.title !== undefined && patch.title !== doc.title) refused.push("title");
  if (patch.priority !== undefined && patch.priority !== doc.priority) refused.push("priority");
  if (patch.slug !== undefined && patch.slug !== doc.slug) refused.push("slug");
  if (patch.tags !== undefined && !isDeepStrictEqual([...patch.tags], doc.tags)) refused.push("tags");
  if (patch.extra !== undefined) {
    for (const key of changedExtraKeys(doc.extra, patch.extra)) {
      if (LIFECYCLE_EXTRA_KEYS.has(key)) continue;
      if (surface === "set" || AUTHORING_EXTRA_KEYS.has(key)) refused.push(`extra.${key}`);
    }
  }
  if (refused.length === 0) return ok(undefined);
  return err(
    validationError(
      "legacy",
      `${doc.slug} is legacy-frozen (${LEGACY_REASON}): it keeps its body, fields, criteria and anchors as they are, so ` +
        `${refused.join(", ")} cannot change. Only lifecycle transitions are allowed (lore set --status deprecated, lore invalidate, supersede); ` +
        "write the follow-up work in a new document",
      refused,
    ),
  );
}
