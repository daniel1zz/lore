/**
 * Computed `validity_state` payload — the SPEC-043 §Design Decisions D6 structured
 * signal for agent-facing surfaces that return JSON (MCP `lore_get`, the HTTP doc
 * route) rather than a rendered markdown banner (CLI `get`/export-docs/`lore feed`
 * use `renderDocMarkdown`/`resolveValidityBanner` instead — see `feed-flow.ts` and
 * `outline-service.ts`). Surface-neutral shared helper (mirrors `calibration-hook.ts`/
 * `supersede-flow.ts`'s placement in `flows/`) so MCP and HTTP never diverge on this
 * computation.
 *
 * Public surface:
 *   computeValidityState(app, doc, nowIso?) — `{invalidated: false}` for a currently
 *     valid doc, else `{invalidated: true, invalid_at?, invalidated_by_slug?, reason?}`.
 *
 * @invariant Resolves `invalidated_by` to a slug via one `corpusService.get` call —
 *   `corpusService.get`/`resolve` apply no `deleted_at` filter (same as
 *   `OutlineService.resolveValidityBanner`'s `store.find` call), so a soft-deleted
 *   successor still resolves to its slug here. The text-only "(deleted)" marker is a
 *   markdown-projection concern (D4), deliberately NOT part of this structured field.
 *
 * Side-effect class: IO (one `corpusService.get` call, only when `invalidated_by` is set)
 * Source: SPEC-043 §Design Decisions D6
 */

import { extractValidity, isInvalidated } from "@lore/core";
import type { DocRecord } from "@lore/core";
import type { App } from "../app.js";

export interface ValidityState {
  invalidated: boolean;
  invalid_at?: string;
  invalidated_by_slug?: string;
  reason?: string;
}

/**
 * @param app - Wired `App` providing `corpusService` (for the invalidated_by → slug lookup).
 * @param doc - The document to compute validity state for.
 * @param nowIso - Time seam (D3 convention); defaults to `new Date().toISOString()`.
 * @example
 * const state = await computeValidityState(app, doc);
 * // { invalidated: false }
 * // or: { invalidated: true, invalid_at: "2026-07-01T00:00:00.000Z", invalidated_by_slug: "knowledge-new", reason: "obsolete" }
 */
export async function computeValidityState(
  app: App,
  doc: DocRecord,
  nowIso: string = new Date().toISOString(),
): Promise<ValidityState> {
  if (!isInvalidated(doc, nowIso)) return { invalidated: false };

  const validity = extractValidity(doc);
  let invalidatedBySlug: string | undefined;
  if (validity?.invalidated_by !== undefined) {
    const successorResult = await app.corpusService.get(validity.invalidated_by);
    if (successorResult.ok) invalidatedBySlug = successorResult.value.doc.slug;
  }

  return {
    invalidated: true,
    ...(validity?.invalid_at !== undefined ? { invalid_at: validity.invalid_at } : {}),
    ...(invalidatedBySlug !== undefined ? { invalidated_by_slug: invalidatedBySlug } : {}),
    ...(validity?.reason !== undefined ? { reason: validity.reason } : {}),
  };
}
