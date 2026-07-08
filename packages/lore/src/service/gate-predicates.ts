/**
 * Deterministic gate predicates for `lore gate spec-create` — the "deterministic zone"
 * of the corpus-governed spec-production loop (IoC vertical slice tech-spec §4.1/§11).
 *
 * Pure, side-effect-free functions. No store, no IO, no bun:sqlite. Each predicate
 * checks exactly one precondition a candidate `spec` document must satisfy before it
 * may be created, and returns a machine-readable failure `reason` rather than a
 * human-prose message — the caller (the not-yet-implemented `lore gate spec-create`
 * command) maps `reason` to CLI exit codes / messages.
 *
 * @invariant `parentLegal`'s notion of "legal parent type for spec" is sourced
 *   exclusively from `PARENT_TYPE_CONTRACT.spec` (`@lore/core`, doc-type-rules.ts) —
 *   never a locally hardcoded type list. That table is the corpus-wide SSOT also
 *   consumed by `CorpusService._createImpl` and `TreeCheckService`.
 * @invariant `specKindValid`'s notion of "valid spec kind" is sourced exclusively
 *   from `SPEC_KINDS` (`@lore/core`, spec-kind.ts) — never a locally hardcoded
 *   literal union. `undefined` is explicitly PASS (not a failure): `CorpusService.
 *   _createImpl` defaults an absent `spec_kind` to `"feature"` at creation time, so
 *   a gate that rejected `undefined` would block the normal create path.
 */

import { PARENT_TYPE_CONTRACT, SPEC_KINDS, type DocType } from "@lore/core";

/** Result of a single gate predicate: either a pass, or a fail carrying a machine-readable reason. */
export type PredicateResult = { ok: true } | { ok: false; reason: string };

const SPEC_LEGAL_PARENT_TYPES: readonly DocType[] = PARENT_TYPE_CONTRACT.spec;

/**
 * Checks whether `parent` is a legal parent document for a new `spec`.
 *
 * @param parent - The candidate parent's type, or `null`/`undefined` when no parent
 *   was supplied (a `spec` always requires a `parent_id` — see `createDocInputSchema`
 *   `superRefine` in `@lore/core/schemas.ts`).
 * @returns `{ok: true}` when `parent.type` is a member of `PARENT_TYPE_CONTRACT.spec`;
 *   `{ok: false, reason: "PARENT_REQUIRED"}` when `parent` is missing;
 *   `{ok: false, reason: "INVALID_PARENT_TYPE"}` when `parent.type` is not legal.
 * @example
 * parentLegal({ type: "prd" });  // => { ok: true }
 * parentLegal(null);             // => { ok: false, reason: "PARENT_REQUIRED" }
 * parentLegal({ type: "task" }); // => { ok: false, reason: "INVALID_PARENT_TYPE" }
 */
export function parentLegal(parent: { type: string } | null | undefined): PredicateResult {
  if (parent === null || parent === undefined) {
    return { ok: false, reason: "PARENT_REQUIRED" };
  }
  if (!SPEC_LEGAL_PARENT_TYPES.includes(parent.type as DocType)) {
    return { ok: false, reason: "INVALID_PARENT_TYPE" };
  }
  return { ok: true };
}

/**
 * Checks whether `kind` is a valid `extra.spec_kind` value for a new `spec`.
 *
 * @param kind - The candidate `spec_kind`, or `undefined` when the caller omitted it
 *   (the create path defaults an absent kind to `"feature"` — see module invariant).
 * @returns `{ok: true}` when `kind` is `undefined` or a member of `SPEC_KINDS`;
 *   `{ok: false, reason: "INVALID_SPEC_KIND"}` otherwise.
 * @example
 * specKindValid("tech");     // => { ok: true }
 * specKindValid(undefined);  // => { ok: true } — defaults to "feature", must not block
 * specKindValid("bogus");    // => { ok: false, reason: "INVALID_SPEC_KIND" }
 */
export function specKindValid(kind: string | undefined): PredicateResult {
  if (kind === undefined) {
    return { ok: true };
  }
  if (!(SPEC_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, reason: "INVALID_SPEC_KIND" };
  }
  return { ok: true };
}

/** Matches a markdown level-2 heading line (`## ...`) anywhere in the content. */
const SKELETON_HEADING_PATTERN = /^##\s/m;

/**
 * Checks whether `content` contains the minimal document skeleton the gate requires:
 * at least one level-2 markdown heading line (`## `).
 *
 * @param content - The candidate spec body (markdown).
 * @returns `{ok: true}` when a `## ` heading line is present anywhere in `content`;
 *   `{ok: false, reason: "MISSING_SKELETON"}` otherwise (including empty content).
 * @example
 * hasSkeleton("## Overview\nx");  // => { ok: true }
 * hasSkeleton("no heading here"); // => { ok: false, reason: "MISSING_SKELETON" }
 * hasSkeleton("");                // => { ok: false, reason: "MISSING_SKELETON" }
 */
export function hasSkeleton(content: string): PredicateResult {
  if (SKELETON_HEADING_PATTERN.test(content)) {
    return { ok: true };
  }
  return { ok: false, reason: "MISSING_SKELETON" };
}
