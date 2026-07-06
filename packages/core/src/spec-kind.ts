/**
 * Spec-kind taxonomy — classifies `spec` documents by what they primarily describe.
 *
 * Pure, browser-safe leaf module: no IO, no other `@lore/core` imports. This is the
 * single source of truth for the enum; `specExtraSchema` (schemas.ts) validates
 * against it and `CorpusService._createImpl` (packages/lore) materializes the
 * default. CLI flags (`create.ts` / `set.ts` `--kind`) also import `SPEC_KINDS`
 * for their `--help` text rather than redeclaring the literal tuple.
 *
 * @invariant Every consumer of `spec_kind` imports `SPEC_KINDS` / `SpecKind` from
 *   here rather than hand-rolling the string union — adding a fourth kind is a
 *   one-line change in this file, not a multi-file find-and-replace.
 * Source: SPEC-032 §3.1
 */

/**
 * The three spec kinds a `spec` document's `extra.spec_kind` may take:
 * - `"feature"` — user-facing feature behavior spec (default when the field is
 *   absent at creation — see `CorpusService._createImpl`).
 * - `"tech"` — internal technical / infrastructure spec with no direct
 *   user-facing behavior (e.g. monorepo skeleton, sync protocol).
 * - `"design"` — UI/UX design spec.
 */
export const SPEC_KINDS = ["feature", "tech", "design"] as const;

/** Derived TypeScript union for a spec document's `extra.spec_kind`. */
export type SpecKind = (typeof SPEC_KINDS)[number];
