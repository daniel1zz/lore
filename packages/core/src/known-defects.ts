/**
 * Known defects: the plan's own record of the GitHub issues it was accepted with (BR-1421, BR-1372, BR-1379).
 *
 * Purpose: a plan whose milestone review fails closes "accepted with known defects" once every failed dimension has an
 *   open GitHub issue recorded for it. That record is a fact ABOUT the plan, not work, so it lives on the plan itself
 *   as `extra.known_defects`; no corpus document carries it and no link type names it.
 * Public surface: {@link KNOWN_DEFECT_WRITES_FIELD}, {@link knownDefectWrites}, {@link withKnownDefects}, {@link knownDefectEntrySchema}, {@link KnownDefectEntry}, {@link KNOWN_DEFECTS_FIELD},
 *   {@link judgeKnownDefectsExtra}, {@link readKnownDefects}, {@link knownDefectKey}, {@link appendKnownDefects}.
 * Invariants:
 *   - `extra.known_defects` is an array of `{repo_id, number, dimension, fingerprint}`; `dimension` is one of the
 *     milestone review dimensions; the triple (repo_id, number, dimension) is unique within the array.
 *   - Only a plan carries the field; any other document type refuses it, naming `extra.known_defects`.
 *   - {@link appendKnownDefects} is idempotent by key: an entry whose key is already present is not added twice.
 * Side-effect class: pure.
 *
 * @spec_ref spec-a-plan-s-known-defects-are-its-own-record-of-github-issues (AC-KD-1, D1, D2)
 */

import { z } from "zod";
import type { LoreError } from "./errors.js";
import { MILESTONE_DIMENSIONS } from "./milestone-review.js";

/** The `extra` key a plan stores its known defects under. */
export const KNOWN_DEFECTS_FIELD = "known_defects";

/**
 * The `extra` key counting the writes that only recorded known defects. Recording an entry bumps the plan's version,
 * and the plan-state fingerprint (BR-1379) hashes that version: without this count every recording would make the
 * plan's own review read as stale. The fingerprint uses the version NET of this count, so a known-defect write leaves
 * it unchanged while every other plan write still changes it.
 */
export const KNOWN_DEFECT_WRITES_FIELD = "known_defect_writes";

/** One failed dimension of the plan, filed as one GitHub issue. `repo_id` is GitHub's numeric repository id. */
export const knownDefectEntrySchema = z.object({
  repo_id: z.number().int().positive(),
  number: z.number().int().positive(),
  dimension: z.enum(MILESTONE_DIMENSIONS),
  fingerprint: z.string().min(1),
});
export type KnownDefectEntry = z.infer<typeof knownDefectEntrySchema>;

/** The uniqueness key of an entry: `<repo_id>#<number>/<dimension>`. */
export function knownDefectKey(entry: Pick<KnownDefectEntry, "repo_id" | "number" | "dimension">): string {
  return `${String(entry.repo_id)}#${String(entry.number)}/${entry.dimension}`;
}

/**
 * Judges the `extra.known_defects` of an `extra` bag about to be written to a document of `docType`.
 *
 * @param docType - type of the document being created or patched
 * @param extra - the `extra` bag the write carries (`undefined` = nothing to judge)
 * @returns a VALIDATION_ERROR naming `extra.known_defects` (and the offending entry), or `undefined` when acceptable
 */
export function judgeKnownDefectsExtra(docType: string, extra: Record<string, unknown> | undefined): LoreError | undefined {
  if (extra === undefined) return undefined;
  if (KNOWN_DEFECT_WRITES_FIELD in extra) {
    const writes = extra[KNOWN_DEFECT_WRITES_FIELD];
    if (docType !== "plan") {
      return { code: "VALIDATION_ERROR", field: `extra.${KNOWN_DEFECT_WRITES_FIELD}`, message: `extra.known_defect_writes is allowed only on a plan (a ${docType} does not record known defects)`, value: writes };
    }
    if (typeof writes !== "number" || !Number.isInteger(writes) || writes < 0) {
      return { code: "VALIDATION_ERROR", field: `extra.${KNOWN_DEFECT_WRITES_FIELD}`, message: "extra.known_defect_writes must be a non-negative integer", value: writes };
    }
  }
  if (!(KNOWN_DEFECTS_FIELD in extra)) return undefined;
  const value = extra[KNOWN_DEFECTS_FIELD];
  const refuse = (message: string): LoreError => ({ code: "VALIDATION_ERROR", field: `extra.${KNOWN_DEFECTS_FIELD}`, message, value });
  if (docType !== "plan") {
    return refuse(`extra.known_defects is allowed only on a plan (a ${docType} does not record known defects)`);
  }
  if (!Array.isArray(value)) return refuse("extra.known_defects must be an array of {repo_id, number, dimension, fingerprint}");
  const seen = new Set<string>();
  for (const [index, entry] of value.entries()) {
    const parsed = knownDefectEntrySchema.safeParse(entry);
    if (!parsed.success) {
      return refuse(
        `extra.known_defects[${String(index)}] ${JSON.stringify(entry)} is invalid: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")} (dimension must be one of ${MILESTONE_DIMENSIONS.join(", ")})`,
      );
    }
    const key = knownDefectKey(parsed.data);
    if (seen.has(key)) return refuse(`extra.known_defects[${String(index)}] duplicates ${key}`);
    seen.add(key);
  }
  return undefined;
}

/**
 * The valid entries of a plan's `extra.known_defects`, in stored order; `[]` when absent or not an array. A malformed
 * element is skipped (the write path refuses a malformed record, so malformed data is hand-edited and must never abort
 * a read already underway).
 *
 * @param extra - a document's `extra`
 */
export function readKnownDefects(extra: unknown): KnownDefectEntry[] {
  if (extra === null || typeof extra !== "object") return [];
  const raw = (extra as Record<string, unknown>)[KNOWN_DEFECTS_FIELD];
  if (!Array.isArray(raw)) return [];
  const entries: KnownDefectEntry[] = [];
  for (const element of raw) {
    const parsed = knownDefectEntrySchema.safeParse(element);
    if (parsed.success) entries.push(parsed.data);
  }
  return entries;
}

/**
 * `existing` plus every `additions` entry whose key is not yet present (idempotent by key).
 *
 * @param existing - the entries already recorded
 * @param additions - the entries to record
 * @returns the merged list, or `existing` itself (same reference) when nothing is new
 */
export function appendKnownDefects(existing: readonly KnownDefectEntry[], additions: readonly KnownDefectEntry[]): readonly KnownDefectEntry[] {
  const keys = new Set(existing.map(knownDefectKey));
  const fresh: KnownDefectEntry[] = [];
  for (const entry of additions) {
    const key = knownDefectKey(entry);
    if (keys.has(key)) continue;
    keys.add(key);
    fresh.push(entry);
  }
  return fresh.length === 0 ? existing : [...existing, ...fresh];
}

/** How many writes of this plan only recorded known defects (0 when absent or malformed). */
export function knownDefectWrites(extra: unknown): number {
  if (extra === null || typeof extra !== "object") return 0;
  const raw = (extra as Record<string, unknown>)[KNOWN_DEFECT_WRITES_FIELD];
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 ? raw : 0;
}

/**
 * The plan `extra` after recording `entries`: the entries and the write count raised by one, so the plan-state
 * fingerprint (which reads the version net of the count) is unchanged by this write.
 *
 * @param extra - the plan's current `extra`
 * @param entries - the full merged entry list to store
 */
export function withKnownDefects(extra: Readonly<Record<string, unknown>>, entries: readonly KnownDefectEntry[]): Record<string, unknown> {
  return { ...extra, [KNOWN_DEFECTS_FIELD]: entries, [KNOWN_DEFECT_WRITES_FIELD]: knownDefectWrites(extra) + 1 };
}
