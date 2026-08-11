/**
 * SPEC-084 corpus-allocated ordinal identity — core contract module.
 *
 * Public surface: `ORDINAL_REGISTRY` (which doc types get a store-allocated
 * display number, and which `spec_kind`s of that type are exempt from
 * allocation), the two display-composition formatters
 * (`formatDocDisplayId` / `composeDocDisplayTitle`), the mirror-only padded
 * variant (`formatMirrorHumanId` — reformats `formatDocDisplayId`'s OWN
 * output, never a second composition site), `parseOrdinalRef` (parses a
 * human-typed `SPEC-84` / `adr-007` reference back into `{type, ordinal}`),
 * and the title-purity predicate shared by every write surface that must
 * reject a self-declared number in a title.
 *
 * Invariant: this module is the ONLY legal site in the whole repo that
 * composes a `"SPEC-"`/`"ADR-"` display string from a prefix + number — see
 * `packages/lore/tests/unit/service/ordinal-identity.test.ts`'s
 * "display-id composition — single-site import-graph pin" suite, which greps
 * `packages/core/src` and `packages/lore/src` for any OTHER file doing the
 * same template-literal/string-concat composition. Do not add a second site;
 * import `formatDocDisplayId`/`composeDocDisplayTitle` from here instead.
 *
 * SPEC-mirror-identifier-ssot D3/D4 — the mirror's `human_id` invariant is
 * now a MECHANISM, not prose: `formatMirrorHumanId` returns the nominal
 * brand {@link MirrorHumanId} (type-only — erased at compile time, zero
 * runtime footprint, so the browser-safe barrel below stays browser-safe).
 * A plain `string` — including `formatDocDisplayId`'s own unpadded output —
 * cannot be assigned where a `MirrorHumanId` is expected, so the two-writer
 * reversion loop this header used to describe only in prose is now a `tsc`
 * error instead of a silent runtime oscillation. The brand's ONE sanctioned
 * textual cast (written `as` immediately followed by the brand name) lives at
 * the JSON parse boundary in `packages/core/src/schemas.ts`
 * (`exportIndexMappingSchema`); every OTHER legitimate producer — this
 * module's own `formatMirrorHumanId`, and `ExportDocsService`'s legacy
 * per-type allocator for non-numbered doc types — narrows via the exported
 * assertion function {@link assertIsMirrorHumanId} instead of a textual cast,
 * so the cast escape really does stay singular. `scripts/check-ordinal-write-sites.mjs`
 * greps for the cast text itself and flags any occurrence outside
 * `schemas.ts`.
 *
 * Side-effect class: pure. Zero Node imports (browser-safe — re-exported
 * from the default `@lore/core` barrel, consumed by `@lore/dashboard`).
 *
 * Explicitly OUT of scope for this module (SPEC-084 §Module Boundary):
 * - Allocation itself (`insertWithAllocatedOrdinal` / `allocateOrdinalForExisting`)
 *   lives on `StoreInterface` — this module only declares WHICH types/kinds
 *   are eligible, never performs a read/write.
 * - `resolveDoc`'s ordinal-ref resolution step and `CorpusService`'s
 *   create/set wiring consume this module but live in `packages/lore/src/service`.
 *
 * @spec_ref SPEC-084 §Module Boundary D3, D4, D5, D6; SPEC-mirror-identifier-ssot D3, D4
 */

import type { DocType } from "./types.js";

/** One `ORDINAL_REGISTRY` entry: the display prefix plus any `spec_kind`
 *  values of that doc type that never receive an allocated ordinal. */
export interface OrdinalRegistryEntry {
  /** Display prefix, e.g. `"SPEC"` composes as `"SPEC-84"`. */
  readonly prefix: string;
  /** `extra.spec_kind` values that get a permanent NULL ordinal instead of
   *  allocation — e.g. `domain-overview` specs (SPEC-080 taxonomy). Absent
   *  entirely for types with no kind-based exemption (e.g. `adr`). */
  readonly exemptKinds?: readonly string[];
}

/**
 * Doc types eligible for store-allocated ordinal numbering (SPEC-084 D1–D3).
 *
 * SSOT tuple-then-derive pattern (mirrors `SPEC_KINDS` in `spec-kind.ts` /
 * `DECISION_STATUSES` in `types.ts`) rather than `keyof typeof ORDINAL_REGISTRY`
 * — `ORDINAL_REGISTRY` below is declared against the WIDE
 * `Partial<Record<DocType, ...>>` shape the spec's Module Boundary text
 * specifies, which does not narrow to a literal key union on its own.
 */
export const ORDINAL_REGISTERED_TYPES = ["spec", "adr"] as const;

/** Derived TypeScript union: the doc types `parseOrdinalRef` can return. */
export type OrdinalDocType = (typeof ORDINAL_REGISTERED_TYPES)[number];

/**
 * Declarative registry of which doc types get a store-allocated display
 * ordinal, their display prefix, and (as DATA, not logic — SPEC-084 D4) which
 * `spec_kind`s of that type are exempt from allocation. Consumed at exactly
 * one allocation site (`CorpusService._createImpl`, out of this module's
 * scope) plus the formatters/parser below.
 *
 * Hardcoded (no `numbering.prefixes` config knob, SPEC-084 D8) — per-corpus
 * prefix drift would break ordinal-ref parsing across SPEC-078 multi-project
 * dashboard mounts.
 */
export const ORDINAL_REGISTRY: Readonly<Partial<Record<DocType, OrdinalRegistryEntry>>> = {
  spec: { prefix: "SPEC", exemptKinds: ["domain-overview"] },
  adr: { prefix: "ADR" },
};

/**
 * Composes the human display id for a doc — reads `ORDINAL_REGISTRY[doc.type].prefix`
 * and composes as `SPEC-${ordinal}` (specs) / `ADR-${ordinal}` (adrs); the actual
 * prefix text is registry DATA, never re-hardcoded here.
 *
 * Returns `null` when the doc's type is not in {@link ORDINAL_REGISTRY} or
 * `doc.ordinal` is `null`/`undefined` (exempt kind, or a type that never
 * allocates) — never a fabricated id. The composed string is NEVER stored
 * (SPEC-084 D5); callers render it fresh from `type` + `ordinal` every time.
 *
 * @param doc - the `type` and `ordinal` of a doc (structurally, so callers
 *   need not construct a full `DocRecord`).
 * @returns `"{PREFIX}-{ordinal}"` (no zero-padding) or `null`.
 */
export function formatDocDisplayId(doc: {
  type: DocType;
  ordinal?: number | null;
}): string | null {
  const entry = ORDINAL_REGISTRY[doc.type];
  if (entry === undefined) return null;
  if (doc.ordinal === null || doc.ordinal === undefined) return null;
  return `${entry.prefix}-${doc.ordinal}`;
}

/**
 * Composes the full display title: `"{PREFIX}-{ordinal} — {title}"` when a
 * display id exists, the bare `title` otherwise. The ONLY legal composition
 * site for this string (see the module header's import-graph-pin note) —
 * never re-interpolate `${prefix}-${ordinal}` at a call site.
 *
 * @param doc - the `type`, `ordinal`, and `title` of a doc.
 */
export function composeDocDisplayTitle(doc: {
  type: DocType;
  ordinal?: number | null;
  title: string;
}): string {
  const displayId = formatDocDisplayId(doc);
  return displayId === null ? doc.title : `${displayId} — ${doc.title}`;
}

/**
 * Nominal brand for a mirror `human_id` — the corpus→file mirror's zero-padded display id
 * (e.g. `"SPEC-021"`), producible ONLY via {@link formatMirrorHumanId} or the schema parse
 * boundary in `packages/core/src/schemas.ts` (SPEC-mirror-identifier-ssot D3/D4). Type-only:
 * the intersection with a `unique symbol`-tagged property has no runtime representation, so
 * this adds zero bytes to the compiled/transpiled output and never threatens the `@lore/core`
 * barrel's browser-safety invariant (see the module header).
 *
 * A plain `string` is NOT assignable to this type (it lacks the phantom `__mirrorHumanIdBrand`
 * property), so the two-writer reversion loop the module header describes — `formatDocDisplayId`'s
 * UNPADDED output landing in an export-index `human_id` field — becomes a `tsc` TS2322 error
 * rather than a silent runtime oscillation. There is exactly one legal way to narrow a `string`
 * into this type WITHOUT the sanctioned schema-boundary cast: {@link assertIsMirrorHumanId}.
 */
export type MirrorHumanId = string & { readonly __mirrorHumanIdBrand: unique symbol };

/**
 * Runtime shape a mirror `human_id` must have: an uppercase-letter prefix, a hyphen, and one
 * or more digits (e.g. `"SPEC-021"`, `"PRD-004"`, `"KN-017"`) — the same token class
 * {@link formatDocDisplayId} composes, and the one `ExportDocsService`'s legacy per-type
 * allocator independently composes for doc types that carry no {@link ORDINAL_REGISTRY} entry.
 * Backs {@link assertIsMirrorHumanId}'s runtime check.
 */
const MIRROR_HUMAN_ID_SHAPE = /^[A-Z]+-\d+$/;

/**
 * Narrows a plain `string` to {@link MirrorHumanId} via a TypeScript assertion signature —
 * deliberately NOT a textual cast (`as` immediately followed by the brand name), which
 * SPEC-mirror-identifier-ssot D4 confines to the ONE sanctioned site in
 * `packages/core/src/schemas.ts` (the
 * `.lore/export-index.json` parse boundary) and `scripts/check-ordinal-write-sites.mjs`
 * mechanically enforces by grepping for that cast text outside that one file. Every OTHER
 * legitimate producer of an export-index `human_id` calls this function instead:
 * {@link formatMirrorHumanId} itself, and `ExportDocsService`'s legacy per-type
 * sequential/title-claimed/title-match allocator for doc types with no
 * {@link ORDINAL_REGISTRY} entry (prd/plan/knowledge/task/phase) — a composition the
 * two-writer reversion loop (D1) never touched, since those types never had a
 * `formatDocDisplayId`/`formatMirrorHumanId` pair to disagree over in the first place.
 *
 * @param value - the composed id string to narrow.
 * @throws if `value` does not match `{PREFIX}-{digits}` — every caller composes `value` from
 *   its own prefix + a numeric suffix, so this is defensive and not expected to trip; a silent
 *   mis-narrow would be worse than a loud, never-triggered throw.
 */
export function assertIsMirrorHumanId(value: string): asserts value is MirrorHumanId {
  if (!MIRROR_HUMAN_ID_SHAPE.test(value)) {
    throw new Error(
      `assertIsMirrorHumanId: "${value}" does not match the mirror human_id shape {PREFIX}-{digits}`,
    );
  }
}

/**
 * The corpus→file MIRROR's zero-padded display id — `formatDocDisplayId(doc)`'s composed
 * string with its numeric suffix left-padded to `width` digits (default 3), e.g.
 * `"SPEC-021"` not `"SPEC-21"`.
 *
 * Deliberately a SEPARATE function from {@link formatDocDisplayId}, which keeps its own
 * "no zero-padding" CLI/MCP/dashboard display contract byte-for-byte unchanged (pinned by
 * `ordinal-identity.test.ts`'s AC-084-3 regression case — `formatDocDisplayId({type:"spec",
 * ordinal:84})` must keep returning `"SPEC-84"`). This function never re-derives the
 * `{prefix}-{ordinal}` composition independently (that would create a SECOND composition
 * site, violating this module's "one legal site" invariant, see the header) — it only
 * reformats the numeric suffix of {@link formatDocDisplayId}'s own output.
 *
 * Consumed ONLY by the corpus→file mirror write path (`ExportDocsService`'s
 * `.lore/export-index.json` `human_id` allocation for numbered types, and the generated
 * `docs/requirements/<type>/*.md` filenames/frontmatter `id:` derived from it) — never by
 * general CLI/MCP/dashboard display, which stays on {@link formatDocDisplayId}. Zero-padding
 * to 3 digits is the mirror's canonical form (user decision 2026-08-10,
 * `task-unify-mirror-identifiers-on-zero-padded-form-export-all`): the mirror's filenames
 * have always zero-padded (`SPEC-021-*.md`), and cross-type frontmatter `links:`/`parent:`
 * entries cite that padded form — aligning `human_id` to the FILENAME convention (not the
 * reverse) is what makes the migration-coverage eval's `links_broken` reach zero.
 *
 * Returns the branded {@link MirrorHumanId} (SPEC-mirror-identifier-ssot D3) — narrowed via
 * {@link assertIsMirrorHumanId}, never a textual cast, so this composition site itself never
 * trips `scripts/check-ordinal-write-sites.mjs`'s cast-escape rule.
 *
 * @param doc - the `type` and `ordinal` of a doc (same shape {@link formatDocDisplayId} takes).
 * @param width - minimum digit width for the numeric suffix (default 3); a wider ordinal
 *   (≥1000) is never truncated, only ever padded UP to at least `width` digits.
 * @returns the padded display id, or `null` under the same conditions
 *   {@link formatDocDisplayId} returns `null` (non-numbered type, or no allocated ordinal).
 */
export function formatMirrorHumanId(
  doc: { type: DocType; ordinal?: number | null },
  width = 3,
): MirrorHumanId | null {
  const displayId = formatDocDisplayId(doc);
  if (displayId === null) return null;
  const separatorIdx = displayId.indexOf("-");
  if (separatorIdx === -1) {
    // defensive — every registry prefix embeds "-", so this branch is unreachable in practice.
    assertIsMirrorHumanId(displayId);
    return displayId;
  }
  const prefix = displayId.slice(0, separatorIdx);
  const ordinalText = displayId.slice(separatorIdx + 1);
  const padded = `${prefix}-${ordinalText.padStart(width, "0")}`;
  assertIsMirrorHumanId(padded);
  return padded;
}

/** Matches `SPEC-84` / `adr-007` (case-insensitive, optional leading zeros
 *  on the number) — feeds both `parseOrdinalRef` and `resolveDoc`'s ordinal
 *  resolution step (out of this module's scope). */
const ORDINAL_REF_PATTERN = /^(spec|adr)-0*(\d+)$/i;

/**
 * Parses a human-typed ordinal reference (`"SPEC-84"`, `"spec-084"`,
 * `"ADR-7"`) into its type + numeric ordinal. Returns `null` for anything
 * that doesn't match the `{registered-type}-{digits}` shape — including
 * ULID-shaped strings and arbitrary prose — so callers (`resolveDoc`) can
 * fall through to the next resolution step on a `null` result (SPEC-065
 * id-prefix regression).
 */
export function parseOrdinalRef(input: string): { type: OrdinalDocType; ordinal: number } | null {
  const match = ORDINAL_REF_PATTERN.exec(input.trim());
  if (match === null) return null;
  const [, rawType, rawOrdinal] = match;
  if (rawType === undefined || rawOrdinal === undefined) return null;
  // reason: the capture group is anchored to exactly `(spec|adr)` case-insensitively
  // (ORDINAL_REF_PATTERN above), so lowercasing it always yields a valid OrdinalDocType.
  return { type: rawType.toLowerCase() as OrdinalDocType, ordinal: Number.parseInt(rawOrdinal, 10) };
}

/** Matches a title that self-declares a display id at its start, e.g.
 *  `"SPEC-99 — Self Declared Number"` or `"ADR-7: whatever"` — deliberately
 *  case-SENSITIVE (uppercase prefix only) and requires a word boundary after
 *  the digits, per SPEC-084 §Changed semantics' literal regex. */
const TITLE_ORDINAL_PATTERN = /^(SPEC|ADR)-\d+\b/;

/**
 * True when `title` self-declares a store-allocated display id for a doc
 * `type` that IS in {@link ORDINAL_REGISTRY} — REGARDLESS of exempt kind
 * (SPEC-084 D6: the title-purity rule is independent of whether this
 * particular doc will actually receive an ordinal at write time — a
 * `domain-overview` spec's title must still be pure prose). Non-registered
 * types (`prd`/`plan`/`knowledge`/`task`/`phase`) are never restricted.
 *
 * Shared by every write surface that must enforce this rule: the
 * `createDocInputSchema` superRefine below (create path) and
 * `CorpusService.set`'s title-patch guard (update path, out of this
 * module's scope — see the spec's D6 "same re-check on set" precedent).
 */
export function isSelfDeclaredOrdinalTitle(type: DocType, title: string): boolean {
  return ORDINAL_REGISTERED_TYPES.includes(type as OrdinalDocType) && TITLE_ORDINAL_PATTERN.test(title);
}
