/**
 * Navigation roots — the ONE place that decides which document is "the strategy document"
 * (the first PRD) and which is "the baseline root" (the `node: "root"` baseline doc).
 *
 * Public surface: {@link pickStrategyDocument}, {@link pickBaselineRoot}.
 * Invariants:
 *   - Pure over a caller-supplied `DocRecord[]`; soft-deleted docs are never picked.
 *   - ONE ordering for "first": `created_at` ASC (oldest first), ties keep input order. Every
 *     navigation caller (bootstrap Root/Strategy, `lore tree` / HTTP `/api/tree` / MCP `lore_tree`
 *     default root, project pointers via bootstrap `data.root`, dashboard home via `/api/tree`) reaches
 *     this module — never `findMany({type:"prd"})[0]`, whose store order is `updated_at` DESC.
 *   - Several baseline roots (not a legal steady state, but the store does not forbid it): the OLDEST
 *     created wins, deterministically, rather than failing navigation.
 * Side-effect class: pure.
 *
 * Out of scope on purpose (other groups / slice 3b): requirement coverage, prd-sync, ad-hoc task
 * parenting, issue intake and the spec parent contract keep their own PRD lookups.
 *
 * Source: spec-baseline-slice-3a-architecture-tree-baseline-root (Navigation), AC-BLS3-3, BR-981, BR-982.
 */

import type { DocRecord } from "@lore/core";

/** Ascending `created_at` comparator (stable for ties via Array.prototype.sort). */
function byCreatedAtAsc(a: DocRecord, b: DocRecord): number {
  if (a.created_at < b.created_at) return -1;
  if (a.created_at > b.created_at) return 1;
  return 0;
}

function oldestLive(docs: readonly DocRecord[], matches: (doc: DocRecord) => boolean): DocRecord | undefined {
  return docs.filter((d) => d.deleted_at === null && matches(d)).sort(byCreatedAtAsc)[0];
}

/**
 * The strategy document: the oldest live PRD, or `undefined` when the corpus has none.
 *
 * @param docs - Any superset of the corpus' docs (only `type === "prd"` rows are considered).
 * @returns the first PRD by `created_at` ASC.
 * @example
 * pickStrategyDocument(allDocs)?.slug;
 */
export function pickStrategyDocument(docs: readonly DocRecord[]): DocRecord | undefined {
  return oldestLive(docs, (d) => d.type === "prd");
}

/**
 * The baseline root: the oldest live baseline doc with `extra.node === "root"`, or `undefined`.
 *
 * @param docs - Any superset of the corpus' docs.
 * @returns the baseline root (oldest created when, abnormally, several exist).
 */
export function pickBaselineRoot(docs: readonly DocRecord[]): DocRecord | undefined {
  return oldestLive(docs, (d) => d.type === "baseline" && d.extra["node"] === "root");
}
