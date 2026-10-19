/**
 * Doc-id-or-slug resolution — the single service-level helper every surface
 * (CLI, MCP, HTTP) routes through to turn a caller-supplied string into a
 * `DocRecord`/`DocId`. SPEC-065 D1 added unique ID-PREFIX resolution here
 * (not per-command) specifically so a truncated id a caller copy-pasted from
 * ANY surface's output resolves identically everywhere.
 *
 * Public surface: `resolveDoc`, `resolveDocId`.
 * Side-effect class: IO (delegates to the injected `StoreInterface`).
 */
import { err, ok, parseOrdinalRef, type LoreError, type Result } from "@lore/core";
import type { DocId, DocRecord } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { describeSoftDeleted } from "./soft-delete-window.js";

/**
 * Options for {@link resolveDoc} / {@link resolveDocId}.
 *
 * `includeDeleted` is the ONLY way to address a soft-deleted doc: `lore undelete` (it must find
 * what it restores) and the read-only history verbs (`lore log`, `lore diff`, `lore audit <doc>`)
 * pass it. Every other caller gets the default: `DOC_NOT_FOUND` naming the deletion.
 */
export interface ResolveDocOptions {
  readonly includeDeleted?: boolean;
}

/**
 * ULID-shape detector — 25 OR 26 chars, digits + ANY letter (not just
 * Crockford's base32 subset), case-insensitive.
 *
 * @invariant A REAL system-generated ULID (`ulidx`'s output, stored on every
 *   `DocRecord.id`/`parent_id`) is ALWAYS exactly 26 Crockford-base32 chars
 *   (excludes I/L/O/U). This pattern is DELIBERATELY wider than that —
 *   task-skill-implement-fix-corpusservice-resolve-duplicate ported this
 *   widening here from a since-deleted CorpusService-local copy, itself
 *   introduced by the SPEC-056 T4 discovery: hand-typed test-fixture
 *   pseudo-IDs (e.g. `"01HPLAN000000000000000000"`, 25 chars, containing an
 *   `L`) previously fell through the strict-Crockford/26-char regex,
 *   misrouting an id lookup to `findBySlug` (which always misses an
 *   uppercase input) and silently producing `DOC_NOT_FOUND` instead of the
 *   intended `find`. Widening is safe for every REAL caller: it never
 *   changes behavior for a genuine 26-char ULID, and it can never
 *   misclassify a legitimate slug — `slugSchema` (`@lore/core`) requires a
 *   lowercase-leading `{type}-{kebab-name}` shape, which always contains a
 *   `-` this charset (`[0-9A-Z]`) never matches, regardless of length.
 *
 * Exported so `CorpusService.resolve` (a public method that predates and
 * still wraps this SSOT for its own richer NOT_FOUND-suggestion behavior,
 * see `corpus-service.ts`) can reuse this exact pattern instead of keeping
 * its own copy.
 */
export const ULID_REGEX = /^[0-9A-Z]{25,26}$/i;

/**
 * Shape of a truncated-but-not-yet-disambiguated identifier: shorter than a
 * full 26-char ULID (so an exact `find`/`findBySlug` miss is expected), but
 * long enough (6+ chars) to bound both prefix-scan cost and the odds of an
 * accidental collision across unrelated docs. Only tested AFTER exact
 * ID/slug resolution has already missed (SPEC-065 D1) — a real slug or full
 * ULID never reaches this branch.
 */
const ID_PREFIX_REGEX = /^[0-9A-HJKMNP-TV-Z]{6,25}$/i;

/** Full ULID length — quoted in the truncation diagnostic, kept as one named constant. */
const FULL_ULID_LENGTH = 26;

/**
 * Resolves a caller-supplied identifier to its `DocRecord`.
 *
 * Resolution order: (1) exact ULID-shaped match (`ULID_REGEX`, 25-26 chars)
 * via `store.find`, or exact slug match via `store.findBySlug` otherwise;
 * (2) on a
 * miss, if the input parses as an ordinal reference (`parseOrdinalRef`, e.g.
 * `"SPEC-84"` / `"adr-007"`), a direct lookup via `store.findByTypeOrdinal`
 * (SPEC-084 §Module Boundary) — a match resolves immediately, a miss falls
 * through to (3) (an ordinal-ref-shaped string like `"SPEC-84"` never matches
 * `ID_PREFIX_REGEX` below anyway, since it contains a literal hyphen); (3) if
 * the input is SHAPED like a truncated ID (`ID_PREFIX_REGEX`), a
 * unique-prefix lookup via `store.findByIdPrefix` — exactly one candidate
 * resolves, two or more is `VALIDATION_ERROR` (ambiguous, lists every
 * candidate), zero falls through to (4); (4) `DOC_NOT_FOUND`, with a
 * truncation diagnostic appended to `suggestions` when the input was
 * prefix-shaped.
 *
 * A soft-deleted doc is NOT addressable (spec-defect-clusters-round-2-part-a D6): on EVERY branch
 * above, a match whose `deleted_at` is set resolves to `DOC_NOT_FOUND` carrying `deleted_at`
 * (so the message names the date and `lore undelete`) unless `opts.includeDeleted` is true.
 *
 * @param store - storage abstraction (any `StoreInterface` implementation)
 * @param idOrSlug - full ULID, slug, ordinal reference (`SPEC-84`), or a
 *   6-25 char ID prefix
 * @param opts - `includeDeleted` opts into addressing a soft-deleted doc (see {@link ResolveDocOptions})
 * @returns the resolved `DocRecord`, or `DOC_NOT_FOUND` / `VALIDATION_ERROR`
 *   (ambiguous prefix) / a propagated store error
 */
export async function resolveDoc(
  store: StoreInterface,
  idOrSlug: string,
  opts?: ResolveDocOptions,
): Promise<Result<DocRecord, LoreError>> {
  const found = await lookupDoc(store, idOrSlug);
  if (!found.ok) return found;
  const deletedAt = found.value.deleted_at ?? null;
  if (deletedAt !== null && opts?.includeDeleted !== true) {
    // reason: a deleted doc must not be actable on by any verb — approve/reject/set/invalidate/link/
    // set-label all resolve here, so this ONE check over every lookup branch is the root fix.
    return err({
      code: "DOC_NOT_FOUND",
      id: idOrSlug,
      deleted_at: deletedAt,
      suggestions: [describeSoftDeleted(idOrSlug, deletedAt)],
      rule: "BR-338",
    });
  }
  return found;
}

/** Raw resolution (ULID / slug / ordinal / id prefix) — deleted docs included. */
async function lookupDoc(
  store: StoreInterface,
  idOrSlug: string,
): Promise<Result<DocRecord, LoreError>> {
  const isUlid = ULID_REGEX.test(idOrSlug);
  const findResult = isUlid
    ? await store.find(idOrSlug)
    : await store.findBySlug(idOrSlug);
  if (!findResult.ok) return findResult;
  if (findResult.value !== null) {
    return ok(findResult.value);
  }

  // SPEC-084 §Module Boundary — ordinal-ref resolution step, BEFORE the
  // SPEC-065 id-prefix fallback below (an unambiguous `{registered-prefix}-
  // {digits}` shape never needs prefix disambiguation). A parse miss (input
  // isn't ordinal-ref-shaped at all) OR a lookup miss (well-formed reference
  // to a nonexistent doc) both fall through unchanged to the id-prefix step.
  const ordinalRef = parseOrdinalRef(idOrSlug);
  if (ordinalRef !== null) {
    const ordinalResult = await store.findByTypeOrdinal(ordinalRef.type, ordinalRef.ordinal);
    if (!ordinalResult.ok) return ordinalResult;
    if (ordinalResult.value !== null) {
      return ok(ordinalResult.value);
    }
  }

  const looksLikeIdPrefix = ID_PREFIX_REGEX.test(idOrSlug);
  if (looksLikeIdPrefix) {
    const prefixResult = await store.findByIdPrefix(idOrSlug);
    if (!prefixResult.ok) return prefixResult;
    const candidates = prefixResult.value;
    const [onlyCandidate] = candidates;
    if (candidates.length === 1 && onlyCandidate !== undefined) {
      return ok(onlyCandidate);
    }
    if (candidates.length > 1) {
      const candidateLines = candidates
        .map((c) => `${c.id}  ${c.slug}`)
        .join("\n");
      return err({
        code: "VALIDATION_ERROR",
        field: "id",
        value: idOrSlug,
        message:
          `Ambiguous ID prefix "${idOrSlug}" matches ${candidates.length} documents — ` +
          `use the full ID or slug to disambiguate:\n${candidateLines}`,
        rule: "BR-338",
      });
    }
    // zero candidates — fall through to DOC_NOT_FOUND below, with the
    // truncation diagnostic (D1's "existing NOT_FOUND path, now appending…").
  }

  return err({
    code: "DOC_NOT_FOUND",
    id: idOrSlug,
    ...(looksLikeIdPrefix
      ? {
          suggestions: [
            `input looks like a truncated ID (${idOrSlug.length} chars; full IDs are ${FULL_ULID_LENGTH}) — ` +
              "copy the full ID from --json output or use the slug",
          ],
        }
      : {}),
    rule: "BR-338",
  });
}

/**
 * `resolveDoc`, projected to just the resolved `DocId` — for callers that
 * only need the id (e.g. to pass into a further store call) and don't want
 * to carry the full `DocRecord` around.
 *
 * @param store - storage abstraction (any `StoreInterface` implementation)
 * @param idOrSlug - full ULID, slug, ordinal reference (`SPEC-84`), or a
 *   6-25 char ID prefix — same accepted shapes as `resolveDoc`
 * @param opts - same as `resolveDoc`'s (`includeDeleted`)
 * @returns the resolved `DocId`, or the same error `resolveDoc` would return
 */
export async function resolveDocId(
  store: StoreInterface,
  idOrSlug: string,
  opts?: ResolveDocOptions,
): Promise<Result<DocId, LoreError>> {
  const result = await resolveDoc(store, idOrSlug, opts);
  if (!result.ok) return result;
  return ok(result.value.id);
}
