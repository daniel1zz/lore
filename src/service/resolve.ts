import { err, ok, type LoreError, type Result } from "@core/errors";
import type { DocId, DocRecord } from "@core/types";
import type { StoreInterface } from "@store/store-interface";

const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

export function resolveDoc(
  store: StoreInterface,
  idOrSlug: string,
): Result<DocRecord, LoreError> {
  const isUlid = ULID_REGEX.test(idOrSlug);
  const findResult = isUlid
    ? store.find(idOrSlug)
    : store.findBySlug(idOrSlug);
  if (!findResult.ok) return findResult;
  if (findResult.value === null) {
    return err({ code: "DOC_NOT_FOUND", id: idOrSlug });
  }
  return ok(findResult.value);
}

export function resolveDocId(
  store: StoreInterface,
  idOrSlug: string,
): Result<DocId, LoreError> {
  const result = resolveDoc(store, idOrSlug);
  if (!result.ok) return result;
  return ok(result.value.id);
}
