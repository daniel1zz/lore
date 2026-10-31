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
  // reason: BR-1/BR-2 (baseline-slice-3b D5) — a spec takes NO parent: it belongs to the
  // product trees through its criteria's rule citations. Empty list here + membership in
  // PARENTLESS_TYPES below; spec is deliberately NOT a root type (see ROOT_TYPES).
  spec:      [],
  adr:       ["prd", "spec"],
  plan:      ["prd", "spec"],
  task:      ["plan"],
  knowledge: ["prd", "spec", "adr", "plan", "knowledge"],
  // reason: phase's parent is always a plan (SPEC-056 §Design Decisions D1) —
  // registered by SPEC-056's PhaseWorkflowService rename task.
  phase:     ["plan"],
  // baseline: root under a prd, branch/leaf under a baseline (node/parent detail: baseline.ts).
  baseline:  ["prd", "baseline"],
  // reason: a template takes NO parent (structured-documents T2): it governs a whole doc type, so it
  // hangs under no single prd/spec; the first template must be creatable in an empty corpus.
  template:  [],
} as const satisfies Record<DocType, readonly DocType[]>;

/**
 * Returns true iff `parent` is a valid parent type for `child`.
 */
export function isValidParentType(child: DocType, parent: DocType): boolean {
  return (PARENT_TYPE_CONTRACT[child] as readonly DocType[]).includes(parent);
}

/**
 * DocTypes that take no parent at all and are NOT tree roots: a parentless doc of
 * these types is legal, and a parent on one is refused (BR-2). They relate to the
 * rest of the corpus by other means (a spec: criterion citations of BR/AS rules).
 */
export const PARENTLESS_TYPES: readonly DocType[] = ["spec", "template"];

/** True iff `type` takes no parent (see {@link PARENTLESS_TYPES}). */
export function isParentlessType(type: DocType): boolean {
  return PARENTLESS_TYPES.includes(type);
}

/**
 * Operator-facing refusal text for a parent supplied to a parentless type.
 * SSOT for create, link and gate paths so every surface names the same relation.
 */
export function parentlessRefusalMessage(type: DocType): string {
  return (
    `a ${type} takes no parent: it belongs to the product trees through its criteria's ` +
    "citations of business and architecture rules — cite with `lore ac cite <spec> <ac-id> <rule-id>`"
  );
}

/**
 * DocTypes that have no valid parents — i.e., root documents (the tree roots).
 * Only "prd" qualifies; parentless types (spec) are excluded on purpose — treating
 * spec as a root would leak the ad-hoc-task exemption (tree-check) and the link
 * parent guard (corpus-service) to spec parents.
 */
export const ROOT_TYPES: readonly DocType[] =
  (Object.keys(PARENT_TYPE_CONTRACT) as DocType[])
    .filter(t => PARENT_TYPE_CONTRACT[t].length === 0 && !isParentlessType(t));
