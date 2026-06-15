/**
 * Parent-type contract for the Lore corpus.
 * Defines which DocTypes are valid parents for each child DocType.
 * Source: TECH-01KV4W88GZF74B98BHCBBV9GHD §3.1
 */

import type { DocType } from "./types.js";

/**
 * Maps each DocType to its allowed parent DocTypes.
 * An empty array means the type is a root (no valid parents).
 */
export const PARENT_TYPE_CONTRACT = {
  prd:       [],
  spec:      ["prd"],
  adr:       ["prd", "spec"],
  plan:      ["prd", "spec"],
  task:      ["plan"],
  knowledge: ["prd", "spec", "adr", "plan", "knowledge"],
} as const satisfies Record<DocType, readonly DocType[]>;

/**
 * Returns true iff `parent` is a valid parent type for `child`.
 */
export function isValidParentType(child: DocType, parent: DocType): boolean {
  return (PARENT_TYPE_CONTRACT[child] as readonly DocType[]).includes(parent);
}

/**
 * DocTypes that have no valid parents — i.e., root documents.
 * Per spec §3: only "prd" qualifies.
 */
export const ROOT_TYPES: readonly DocType[] =
  (Object.keys(PARENT_TYPE_CONTRACT) as DocType[])
    .filter(t => PARENT_TYPE_CONTRACT[t].length === 0);
