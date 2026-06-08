import { err, ok, type LoreError, type Result } from "@core/errors";
import type { DocId, DocRecord } from "@core/types";
import type { StoreInterface } from "@store/store-interface";

const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

export async function resolveDoc(
  store: StoreInterface,
  idOrSlug: string,
): Promise<Result<DocRecord, LoreError>> {
  const isUlid = ULID_REGEX.test(idOrSlug);
  const findResult = isUlid
    ? await store.find(idOrSlug)
    : await store.findBySlug(idOrSlug);
  if (!findResult.ok) return findResult;
  if (findResult.value === null) {
    return err({ code: "DOC_NOT_FOUND", id: idOrSlug });
  }
  return ok(findResult.value);
}

export async function resolveDocId(
  store: StoreInterface,
  idOrSlug: string,
): Promise<Result<DocId, LoreError>> {
  const result = await resolveDoc(store, idOrSlug);
  if (!result.ok) return result;
  return ok(result.value.id);
}
