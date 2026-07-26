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

const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

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
 * Resolution order: (1) exact 26-char ULID match via `store.find`, or exact
 * slug match via `store.findBySlug` for anything shorter/longer; (2) on a
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
 * @param store - storage abstraction (any `StoreInterface` implementation)
 * @param idOrSlug - full ULID, slug, ordinal reference (`SPEC-84`), or a
 *   6-25 char ID prefix
 * @returns the resolved `DocRecord`, or `DOC_NOT_FOUND` / `VALIDATION_ERROR`
 *   (ambiguous prefix) / a propagated store error
 */
export async function resolveDoc(
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
  });
}

export async function resolveDocId(
  store: StoreInterface,
  idOrSlug: string,
): Promise<Result<DocId, LoreError>> {
  const result = await resolveDoc(store, idOrSlug);
  if (!result.ok) return result;
  return ok(result.value.id);
}
