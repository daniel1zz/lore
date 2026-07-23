/**
 * Shared feed-pack pointer vocabulary (SPEC-070 §Design Decisions D6) — the two
 * pointer-only shapes every "feed a work-item start pack" flow renders a linked
 * knowledge doc / latest handoff into. Previously declared privately inside
 * `phase-feed-flow.ts`; extracted here so `task-feed-flow.ts` (SPEC-070) can share
 * the SAME types rather than redeclaring a structurally-identical pair —
 * `phase-feed-flow.ts` re-exports both names verbatim so its existing importers
 * (e.g. `adapters/cli/phase-wiring.ts`) keep compiling unchanged (import-compat).
 *
 * Neither feature module "owns" the other's vocabulary — this is the shared home.
 *
 * Public surface:
 *   - KnowledgePointer — one linked-knowledge doc pointer (hygiene-filter-aware)
 *   - HandoffPointer — the latest handoff doc for a plan, pointer-only
 *
 * Side-effect class: none (pure type declarations)
 * Source: SPEC-070 §Design Decisions D6, §Module Boundary
 */

/**
 * A linked-knowledge pointer — the port surfaces invalidation state rather than
 * silently omitting rows; the consuming flow applies the hygiene exclusion itself
 * (defense-in-depth — SPEC-043 D3 "filtered by default" read-surface class).
 */
export interface KnowledgePointer {
  readonly doc_id: string;
  readonly slug: string;
  readonly title: string;
  readonly invalidated: boolean;
}

/** The latest handoff knowledge doc for a plan, pointer-only (never its full body here). */
export interface HandoffPointer {
  readonly slug: string;
  readonly title: string;
}
