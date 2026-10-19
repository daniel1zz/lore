/**
 * Demotion notice: the one value a write returns when it moved an approved document to draft.
 *
 * Purpose: give every demoting write (`rule add|set`, `ac set`) ONE shape and ONE sentence, so the CLI,
 * `--json` and MCP announce the approved->draft move identically (D18, BR-722; the demotion rule itself
 * is `resolveStatusAfterContractEdit` in `@lore/core`, unchanged).
 * Public surface: {@link Demotion}, {@link demotionOf}, {@link formatDemotionLine}.
 * Invariants: pure; `demotionOf` is defined only over an OBSERVED status change, never inferred from
 * which operation ran, so a write that did not demote yields `undefined`.
 * Side effects: none (pure).
 */
import type { DocRecord } from "@lore/core";

/** The announcement a demoting write carries as `demoted`. `version` is the version that holds the draft status. */
export interface Demotion {
  readonly slug: string;
  readonly from: "approved";
  readonly to: "draft";
  readonly version: number;
}

/**
 * Builds the {@link Demotion} for a write that took `before` to `after`.
 *
 * @param before - the doc as read before the demoting write
 * @param after - the doc the write returned (carries the demotion's version)
 * @returns the notice when `before` was approved and `after` is draft, else `undefined`
 */
export function demotionOf(
  before: Pick<DocRecord, "status">,
  after: Pick<DocRecord, "status" | "slug" | "version">,
): Demotion | undefined {
  if (before.status !== "approved" || after.status !== "draft") return undefined;
  return { slug: after.slug, from: "approved", to: "draft", version: after.version };
}

/** The one human sentence for a {@link Demotion}. */
export function formatDemotionLine(demotion: Demotion): string {
  return `${demotion.slug} was ${demotion.from} and is now ${demotion.to} (v${demotion.version}): re-review and approve it`;
}
