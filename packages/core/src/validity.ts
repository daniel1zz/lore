/**
 * Bi-temporal validity metadata for `knowledge` / `adr` documents — SPEC-043 §Design
 * Decisions D1 (memory hygiene part 1). Pure, browser-safe module: no IO, no
 * wall-clock reads (`nowIso` is always caller-injected).
 *
 * Public surface:
 *   - validitySchema / Validity — {valid_at?, invalid_at?, invalidated_by?, reason?}
 *   - extractValidity(doc) — defensive extraction from doc.extra.validity
 *   - effectiveValidAt(doc) — valid_at, defaulting to doc.created_at (zero-migration)
 *   - isInvalidated(doc, nowIso) — the SSOT predicate every read surface calls
 *   - validityEqual(a, b) — deep-equality (CorpusService.set's D10 writer guard)
 *   - renderValidityBanner(input) — pure D4 banner-line formatter (format only; the
 *     invalidated_by → slug resolution that feeds it is a store lookup and lives in
 *     `packages/lore/src/service/outline-service.ts::resolveValidityBanner`)
 *
 * @invariant Validation split (D1, review S8): the ordering rule (`invalid_at >=
 *   valid_at`, equality legal) is enforced HERE via a pure `superRefine` — no
 *   wall-clock read required. The "not in the future" rule is deliberately NOT
 *   enforced here (it needs `nowIso`, which this module never reads) — that check
 *   lives in `packages/lore/src/service/validity-service.ts` (the service layer
 *   `CorpusService.set` "now" convention).
 * @invariant Absent `extra.validity` (or an absent `valid_at` within it) is NOT an
 *   error — a doc with no validity metadata is simply currently valid, with its
 *   `valid_at` implicitly equal to its `created_at` (zero-migration for the entire
 *   pre-SPEC-043 corpus — no backfill required).
 * @invariant `isInvalidated` accepts EITHER a DocRecord-shaped input (`{extra}`) OR a
 *   SearchHit-shaped input (`{validity}` hoisted to a top-level field, since SearchHit
 *   carries no `extra` — SPEC-043 review S3, "no N+1 per-hit fetch") — both are legal
 *   callers of the SAME predicate, never two parallel implementations.
 *
 * Side-effect class: pure
 *
 * Source: SPEC-043 §Design Decisions D1, D4; §Acceptance Criteria AC-MH-1
 */

import { z } from "zod";
import type { DocRecord } from "./types.js";

// ─── Schema ─────────────────────────────────────────────────────────────────

export const validitySchema = z
  .object({
    /** ISO 8601. Absent → {@link effectiveValidAt} falls back to the doc's created_at. */
    valid_at: z.string().optional(),
    /** ISO 8601. Absent → the doc is currently valid (never invalidated). */
    invalid_at: z.string().optional(),
    /**
     * ULID of the doc that superseded this one, when applicable. Works for ANY
     * target type — an incident/retro knowledge doc is a legitimate successor
     * pointer, not only a same-typed doc (review U8). Mirrors `docIdSchema`
     * (schemas.ts) — redeclared as a bare `z.string().min(1)` here rather than
     * imported, to avoid a schemas.ts ⇄ validity.ts import cycle (schemas.ts
     * imports THIS module, never the reverse).
     */
    invalidated_by: z.string().min(1).optional(),
    /**
     * Free-text reason, capped at 500 chars — longer narratives belong in a
     * linked knowledge/retro doc pointed to by `invalidated_by` (D1).
     */
    reason: z.string().max(500).optional(),
  })
  .superRefine((data, ctx) => {
    // reason: ordering is only checkable when BOTH timestamps are present — see
    // this module's class-level @invariant for why "not in the future" is NOT
    // checked here (that needs nowIso; service-layer only, D1 validation split).
    // Equality is explicitly LEGAL (boundary, AC-MH-1) — only strictly-before fails.
    if (data.valid_at !== undefined && data.invalid_at !== undefined) {
      if (new Date(data.invalid_at).getTime() < new Date(data.valid_at).getTime()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "invalid_at must be >= valid_at (equality is legal)",
          path: ["invalid_at"],
        });
      }
    }
  });

/** Derived TypeScript type for one doc's bi-temporal validity metadata. */
export type Validity = z.infer<typeof validitySchema>;

// ─── Extraction ─────────────────────────────────────────────────────────────

/**
 * Defensively extracts `extra.validity`, tolerating a corrupted/legacy row whose
 * `extra` is `null`/non-object at runtime (same guard shape as `task-workflow.ts`'s
 * `safeTaskExtra` — duplicated, not imported, to keep this module dependency-free of
 * that one).
 */
function safeExtra(extra: unknown): Record<string, unknown> {
  return extra !== null && typeof extra === "object" && !Array.isArray(extra)
    ? (extra as Record<string, unknown>)
    : {};
}

/**
 * Extracts and validates `extra.validity` from a DocRecord-shaped input.
 * Returns `undefined` when absent or malformed (defensive — `extra` is untyped
 * storage; matches `extractClaim`/`extractEvidence`'s degrade-to-undefined contract).
 */
export function extractValidity(doc: Pick<DocRecord, "extra">): Validity | undefined {
  const raw = safeExtra(doc.extra)["validity"];
  if (raw === undefined || raw === null) return undefined;
  const parsed = validitySchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/**
 * The doc's effective "valid since" instant — `extra.validity.valid_at` when present,
 * else the doc's own `created_at` (zero-migration default, D1).
 */
export function effectiveValidAt(doc: Pick<DocRecord, "extra" | "created_at">): string {
  return extractValidity(doc)?.valid_at ?? doc.created_at;
}

// ─── isInvalidated (SSOT predicate) ────────────────────────────────────────

/**
 * Structural union covering both shapes {@link isInvalidated} accepts: a
 * DocRecord-shaped input (`extra.validity` nested, the corpus row's real shape) OR a
 * SearchHit-shaped input (`validity` hoisted to a top-level field — SearchHit carries
 * no `extra`, SPEC-043 review S3). Exactly one of the two fields is expected to be
 * present on any real caller's input; both present is harmless (the pre-extracted
 * `validity` wins, avoiding a redundant `extra.validity` parse).
 */
export interface ValidityCarrier {
  extra?: Record<string, unknown>;
  validity?: Validity;
}

/**
 * The bi-temporal SSOT predicate every read surface calls (D1) — true iff `doc` has
 * an `invalid_at` at or before `nowIso`. Flips exactly at the injected `nowIso`
 * instant (boundary: `invalid_at === nowIso` → invalidated). Does NOT consider
 * `valid_at`/future-dating — a future `valid_at` never excludes a doc from view
 * (AC-MH-5); the "not in the future" write-time rule lives in ValidityService, not
 * here (D1 split).
 *
 * @example
 * isInvalidated({ extra: { validity: { invalid_at: "2026-01-01T00:00:00.000Z" } } }, "2026-06-01T00:00:00.000Z");
 * // => true
 * @example
 * isInvalidated({ validity: { invalid_at: "2026-01-01T00:00:00.000Z" } }, "2026-06-01T00:00:00.000Z"); // SearchHit shape
 * // => true
 */
export function isInvalidated(doc: ValidityCarrier, nowIso: string): boolean {
  const validity = doc.validity !== undefined ? doc.validity : extractValidity({ extra: doc.extra ?? {} });
  if (validity?.invalid_at === undefined) return false;
  return new Date(validity.invalid_at).getTime() <= new Date(nowIso).getTime();
}

// ─── Equality (D10 writer guard) ───────────────────────────────────────────

/**
 * Deep-equality over two (possibly absent) {@link Validity} values — used by
 * `CorpusService.set`'s D10 writer guard to detect whether a patch's `extra.validity`
 * differs from the doc's current one (a change → rejected, naming `lore invalidate`).
 */
export function validityEqual(a: Validity | undefined, b: Validity | undefined): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  return (
    a.valid_at === b.valid_at &&
    a.invalid_at === b.invalid_at &&
    a.invalidated_by === b.invalidated_by &&
    a.reason === b.reason
  );
}

// ─── Banner Rendering (D4) ──────────────────────────────────────────────────

/** Pre-resolved input to {@link renderValidityBanner} — the store lookup for
 *  `invalidated_by` → slug/deleted-state happens at the call site, not here. */
export interface ValidityBannerInput {
  invalid_at: string;
  /** Resolved slug of `invalidated_by`, when it resolves to a live/known doc. */
  successor_slug?: string;
  /** `true` iff the resolved successor doc is itself soft-deleted. */
  successor_deleted?: boolean;
  reason?: string;
}

/**
 * Renders the pinned D4 banner line: `> ⚠ INVALIDATED <invalid_at>` optionally
 * followed by `— superseded by <slug>` (only when `successor_slug` resolves, `
 * (deleted)` suffix when the successor is soft-deleted) and `; <reason>` (only when
 * `reason` is present) — never a dangling separator when either optional part is
 * absent. Pure — no store access; `outline-service.ts::resolveValidityBanner` (the
 * shared adapter-facing wrapper CLI `get`, `export-docs`, and `lore feed` all call)
 * resolves `invalidated_by` to a slug/deleted-state first, then calls this.
 *
 * @example
 * renderValidityBanner({ invalid_at: "2026-07-01T00:00:00.000Z" });
 * // => "> ⚠ INVALIDATED 2026-07-01T00:00:00.000Z"
 * @example
 * renderValidityBanner({
 *   invalid_at: "2026-07-01T00:00:00.000Z", successor_slug: "knowledge-new", reason: "obsolete",
 * });
 * // => "> ⚠ INVALIDATED 2026-07-01T00:00:00.000Z — superseded by knowledge-new; obsolete"
 */
export function renderValidityBanner(input: ValidityBannerInput): string {
  let line = `> ⚠ INVALIDATED ${input.invalid_at}`;
  if (input.successor_slug !== undefined) {
    line += ` — superseded by ${input.successor_slug}${input.successor_deleted === true ? " (deleted)" : ""}`;
  }
  if (input.reason !== undefined) {
    line += `; ${input.reason}`;
  }
  return line;
}
